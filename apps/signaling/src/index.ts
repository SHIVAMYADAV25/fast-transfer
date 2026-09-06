/**
 * Fast Transfer — signaling worker.
 *
 * Live transfers:
 *   1. POST /room          -> create a new transfer room, return its code
 *   2. GET  /room/:id      -> check whether a room exists / is still valid
 *   3. GET  /room/:id/ws   -> upgrade to WebSocket, hand off to the room's
 *                             Durable Object for the actual signaling relay
 *
 * Stored (async) transfers — see docs/stored-transfers.md:
 *   4. POST /store                    -> create a stored-transfer slot
 *   5. PUT  /store/:id/manifest       -> upload sealed manifest ciphertext
 *   6. PUT  /store/:id/chunk/:n       -> upload sealed chunk ciphertext
 *   7. POST /store/:id/complete       -> mark upload finished (totalChunks)
 *   8. GET  /store/:id                -> status (uploading/available/etc)
 *   9. GET  /store/:id/manifest       -> download sealed manifest
 *  10. GET  /store/:id/chunk/:n       -> download sealed chunk
 *  11. POST /store/:id/commit         -> receiver confirms a verified download
 *  12. POST /store/:id/revoke         -> sender deletes early (needs revokeToken)
 *
 * In every case this Worker only ever handles ciphertext bytes it cannot
 * read (stored transfers) or small JSON control messages (live transfers).
 * It never has the encryption key for either.
 */

import { TransferRoom } from "./room";
import { StoredTransfer } from "./store";
import { generateCode, codeToRoomId } from "./code";
import { ROOM_TTL_MS, STORED_TRANSFER_DEFAULT_TTL_MS } from "@fast-transfer/protocol";

export { TransferRoom, StoredTransfer };

export interface Env {
  TRANSFER_ROOM: DurableObjectNamespace;
  STORED_TRANSFER: DurableObjectNamespace;
  STORE_BUCKET: R2Bucket;
  // Comma-separated list of allowed origins, e.g. "https://fasttransfer.app,http://localhost:3000"
  ALLOWED_ORIGINS?: string;
}

function corsHeaders(origin: string | null, env: Env): HeadersInit {
  const allowed = (env.ALLOWED_ORIGINS ?? "*").split(",").map((s) => s.trim());

  // Tauri's desktop webview origin on Windows has been observed as both
  // `https://tauri.localhost` and `http://tauri.localhost` depending on
  // the Tauri/WebView2 version — nothing in Tauri's own docs guarantees
  // which one a given build will use, and getting this wrong means every
  // request from the desktop app silently fails CORS with no obvious
  // cause (see git history / README for the real debugging story here).
  // Rather than keep guessing exact strings, treat any `tauri.localhost`
  // origin (either scheme) as the desktop app, in addition to whatever
  // is explicitly listed in ALLOWED_ORIGINS.
  const isTauriDesktopOrigin =
    origin != null && /^https?:\/\/tauri\.localhost$/.test(origin);

  const allowOrigin =
    allowed.includes("*") || isTauriDesktopOrigin || (origin && allowed.includes(origin))
      ? origin ?? "*"
      : "null";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const headers = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    // POST /room  — create a new room
    if (request.method === "POST" && url.pathname === "/room") {
      const code = generateCode();
      const roomId = await codeToRoomId(code);

      const id = env.TRANSFER_ROOM.idFromName(roomId);
      const stub = env.TRANSFER_ROOM.get(id);

      // Tell the DO to initialize itself (sets createdAt/expiresAt in its storage)
      await stub.fetch("https://internal/init", {
        method: "POST",
        body: JSON.stringify({ roomId, ttlMs: ROOM_TTL_MS }),
      });

      return Response.json(
        {
          roomId,
          code,
          expiresAt: Date.now() + ROOM_TTL_MS,
        },
        { headers },
      );
    }

    // GET /room/:id  — check room validity (used by receiver before joining)
    const roomMatch = url.pathname.match(/^\/room\/([a-zA-Z0-9-]+)$/);
    if (request.method === "GET" && roomMatch) {
      const code = roomMatch[1];
      const roomId = await codeToRoomId(code);
      const id = env.TRANSFER_ROOM.idFromName(roomId);
      const stub = env.TRANSFER_ROOM.get(id);

      const res = await stub.fetch("https://internal/status");
      const body = await res.json();
      return Response.json(body, { headers, status: res.status });
    }

    // GET /room/:id/ws  — upgrade to WebSocket, forward straight to the DO
    const wsMatch = url.pathname.match(/^\/room\/([a-zA-Z0-9-]+)\/ws$/);
    if (wsMatch) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket upgrade", { status: 426 });
      }
      const code = wsMatch[1];
      const roomId = await codeToRoomId(code);
      const id = env.TRANSFER_ROOM.idFromName(roomId);
      const stub = env.TRANSFER_ROOM.get(id);

      // Pass the role (?role=sender|receiver) straight through to the DO
      return stub.fetch(request);
    }

    // ---- Stored (async) transfers ----------------------------------------

    // POST /store — create a stored-transfer slot
    if (request.method === "POST" && url.pathname === "/store") {
      const body = (await request.json().catch(() => ({}))) as {
        maxDownloads?: number;
        ttlMs?: number;
      };
      const id = crypto.randomUUID().replace(/-/g, "");
      const stub = env.STORED_TRANSFER.get(env.STORED_TRANSFER.idFromName(id));
      const res = await stub.fetch("https://internal/init", {
        method: "POST",
        body: JSON.stringify({
          maxDownloads: body.maxDownloads ?? 1,
          ttlMs: body.ttlMs ?? STORED_TRANSFER_DEFAULT_TTL_MS,
        }),
      });
      const initResult = (await res.json()) as { revokeToken: string; expiresAt: number };
      return Response.json({ id, ...initResult }, { headers });
    }

    const storeIdMatch = url.pathname.match(/^\/store\/([a-zA-Z0-9]+)$/);
    const storeManifestMatch = url.pathname.match(/^\/store\/([a-zA-Z0-9]+)\/manifest$/);
    const storeChunkMatch = url.pathname.match(/^\/store\/([a-zA-Z0-9]+)\/chunk\/(\d+)$/);
    const storeCompleteMatch = url.pathname.match(/^\/store\/([a-zA-Z0-9]+)\/complete$/);
    const storeCommitMatch = url.pathname.match(/^\/store\/([a-zA-Z0-9]+)\/commit$/);
    const storeRevokeMatch = url.pathname.match(/^\/store\/([a-zA-Z0-9]+)\/revoke$/);

    // GET /store/:id — status
    if (request.method === "GET" && storeIdMatch) {
      const stub = storedTransferStub(env, storeIdMatch[1]);
      const res = await stub.fetch("https://internal/status");
      return Response.json(await res.json(), { headers, status: res.status });
    }

    // PUT /store/:id/manifest — upload sealed manifest ciphertext
    if (request.method === "PUT" && storeManifestMatch) {
      const id = storeManifestMatch[1];
      if (!(await isUploadable(env, id))) return new Response("not found or already complete", { status: 404, headers });
      const bytes = await request.arrayBuffer();
      await env.STORE_BUCKET.put(`manifest:${id}`, bytes);
      return Response.json({ ok: true }, { headers });
    }

    // PUT /store/:id/chunk/:n — upload one sealed chunk
    if (request.method === "PUT" && storeChunkMatch) {
      const [, id, n] = storeChunkMatch;
      if (!(await isUploadable(env, id))) return new Response("not found or already complete", { status: 404, headers });
      const bytes = await request.arrayBuffer();
      await env.STORE_BUCKET.put(`chunk:${id}:${n}`, bytes);
      return Response.json({ ok: true }, { headers });
    }

    // POST /store/:id/complete — mark upload finished
    if (request.method === "POST" && storeCompleteMatch) {
      const stub = storedTransferStub(env, storeCompleteMatch[1]);
      const res = await stub.fetch("https://internal/complete", { method: "POST", body: request.body });
      return Response.json(await res.json(), { headers, status: res.status });
    }

    // GET /store/:id/manifest — download sealed manifest (receiver)
    if (request.method === "GET" && storeManifestMatch) {
      const id = storeManifestMatch[1];
      const guard = await requireAvailable(env, id, headers);
      if (guard) return guard;
      return fetchObject(env, `manifest:${id}`, headers);
    }

    // GET /store/:id/chunk/:n — download one sealed chunk (receiver)
    if (request.method === "GET" && storeChunkMatch) {
      const [, id, n] = storeChunkMatch;
      const guard = await requireAvailable(env, id, headers);
      if (guard) return guard;
      return fetchObject(env, `chunk:${id}:${n}`, headers);
    }

    // POST /store/:id/commit — receiver confirms a verified download
    if (request.method === "POST" && storeCommitMatch) {
      const stub = storedTransferStub(env, storeCommitMatch[1]);
      const res = await stub.fetch("https://internal/commit", { method: "POST" });
      return Response.json(await res.json(), { headers, status: res.status });
    }

    // POST /store/:id/revoke — sender deletes early
    if (request.method === "POST" && storeRevokeMatch) {
      const stub = storedTransferStub(env, storeRevokeMatch[1]);
      const res = await stub.fetch("https://internal/revoke", { method: "POST", body: request.body });
      return Response.json(await res.json(), { headers, status: res.status });
    }

    return new Response("not found", { status: 404, headers });
  },
};

function storedTransferStub(env: Env, id: string): DurableObjectStub {
  return env.STORED_TRANSFER.get(env.STORED_TRANSFER.idFromName(id));
}

async function isUploadable(env: Env, id: string): Promise<boolean> {
  const res = await storedTransferStub(env, id).fetch("https://internal/status");
  if (!res.ok) return false;
  const status = (await res.json()) as { status: string };
  return status.status === "uploading";
}

/** Returns a Response to short-circuit with if the transfer isn't downloadable, else null. */
async function requireAvailable(env: Env, id: string, headers: HeadersInit): Promise<Response | null> {
  const res = await storedTransferStub(env, id).fetch("https://internal/status");
  if (!res.ok) return new Response("not found", { status: 404, headers });
  const status = (await res.json()) as { status: string };
  if (status.status !== "available") {
    return Response.json({ error: status.status }, { status: 410, headers });
  }
  return null;
}

async function fetchObject(env: Env, key: string, headers: HeadersInit): Promise<Response> {
  const obj = await env.STORE_BUCKET.get(key);
  if (!obj) return new Response("not found", { status: 404, headers });
  return new Response(obj.body, {
    headers: { ...headers, "Content-Type": "application/octet-stream" },
  });
}