/**
 * StoredTransfer — one Durable Object instance per stored (async) transfer.
 *
 * Holds only metadata: expiry, download allowance, revoke token hash, and
 * (once upload finishes) the chunk count. The actual encrypted bytes live in
 * R2 (`env.STORE_BUCKET`) — this object never touches file content, same
 * principle as TransferRoom never touching live-transfer file content.
 *
 * Lifecycle: uploading -> available -> consumed | revoked | expired.
 * Cleanup (deleting the R2 objects) happens here, since this object is the
 * only thing that reliably knows how many chunks exist and fires exactly
 * once via `alarm()` regardless of whether anyone ever visits again.
 */

import { STORED_TRANSFER_DEFAULT_TTL_MS } from "@fast-transfer/protocol";
import type { StoredTransferStatus } from "@fast-transfer/protocol";

interface StoredMeta {
  id: string;
  createdAt: number;
  expiresAt: number;
  maxDownloads: number; // 0 = unlimited within the TTL
  downloadsUsed: number;
  totalChunks: number | null; // null until /complete is called
  complete: boolean;
  consumed: boolean;
  revoked: boolean;
  revokeTokenHash: string;
}

export interface Env {
  STORE_BUCKET: R2Bucket;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class StoredTransfer {
  private state: DurableObjectState;
  private env: Env;
  private meta: StoredMeta | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/init" && request.method === "POST") return this.handleInit(request);
    if (path === "/complete" && request.method === "POST") return this.handleComplete(request);
    if (path === "/status") return this.handleStatus();
    if (path === "/commit" && request.method === "POST") return this.handleCommit();
    if (path === "/revoke" && request.method === "POST") return this.handleRevoke(request);

    return new Response("not found", { status: 404 });
  }

  private async handleInit(request: Request): Promise<Response> {
    const body = (await request.json()) as { maxDownloads: number; ttlMs?: number };
    const now = Date.now();
    const ttlMs = body.ttlMs ?? STORED_TRANSFER_DEFAULT_TTL_MS;
    const revokeToken = randomToken();

    this.meta = {
      id: this.state.id.toString(),
      createdAt: now,
      expiresAt: now + ttlMs,
      maxDownloads: body.maxDownloads ?? 1,
      downloadsUsed: 0,
      totalChunks: null,
      complete: false,
      consumed: false,
      revoked: false,
      revokeTokenHash: await sha256Hex(revokeToken),
    };
    await this.state.storage.put("meta", this.meta);
    await this.state.storage.setAlarm(this.meta.expiresAt);

    return Response.json({ revokeToken, expiresAt: this.meta.expiresAt });
  }

  private async handleComplete(request: Request): Promise<Response> {
    const meta = await this.loadMeta();
    if (!meta || this.isExpiredOrGone(meta)) return new Response("not found", { status: 404 });
    const body = (await request.json()) as { totalChunks: number };
    meta.totalChunks = body.totalChunks;
    meta.complete = true;
    this.meta = meta;
    await this.state.storage.put("meta", meta);
    return Response.json({ ok: true });
  }

  private async handleStatus(): Promise<Response> {
    const meta = await this.loadMeta();
    if (!meta) return Response.json({ status: "expired" satisfies StoredTransferStatus }, { status: 404 });

    let status: StoredTransferStatus;
    if (meta.revoked) status = "revoked";
    else if (meta.consumed) status = "consumed";
    else if (Date.now() > meta.expiresAt) status = "expired";
    else if (!meta.complete) status = "uploading";
    else status = "available";

    const downloadsRemaining = meta.maxDownloads === 0 ? null : Math.max(0, meta.maxDownloads - meta.downloadsUsed);

    return Response.json({
      status,
      expiresAt: meta.expiresAt,
      downloadsRemaining,
      totalChunks: meta.totalChunks,
    });
  }

  private async handleCommit(): Promise<Response> {
    const meta = await this.loadMeta();
    if (!meta || this.isExpiredOrGone(meta)) return new Response("not found", { status: 404 });

    meta.downloadsUsed += 1;
    const exhausted = meta.maxDownloads !== 0 && meta.downloadsUsed >= meta.maxDownloads;
    if (exhausted) {
      meta.consumed = true;
      await this.deleteObjects(meta);
    }
    this.meta = meta;
    await this.state.storage.put("meta", meta);
    return Response.json({ ok: true, consumed: meta.consumed });
  }

  private async handleRevoke(request: Request): Promise<Response> {
    const meta = await this.loadMeta();
    if (!meta) return new Response("not found", { status: 404 });
    const body = (await request.json()) as { revokeToken: string };
    const providedHash = await sha256Hex(body.revokeToken ?? "");
    if (providedHash !== meta.revokeTokenHash) {
      return new Response("forbidden", { status: 403 });
    }
    meta.revoked = true;
    await this.deleteObjects(meta);
    this.meta = meta;
    await this.state.storage.put("meta", meta);
    return Response.json({ ok: true });
  }

  async alarm(): Promise<void> {
    const meta = await this.loadMeta();
    if (!meta || meta.consumed || meta.revoked) return; // already cleaned up
    await this.deleteObjects(meta);
    await this.state.storage.deleteAll();
    this.meta = null;
  }

  private async deleteObjects(meta: StoredMeta): Promise<void> {
    const keys = [`manifest:${meta.id}`];
    // NOTE (known limitation, see README): if the upload never completed,
    // totalChunks is null and we don't know how many chunk objects exist —
    // an abandoned partial upload can leave orphaned R2 objects behind.
    // Tracking chunk uploads incrementally (rather than only at /complete)
    // would close this gap; not required for the common "upload finished"
    // path, which is correctly cleaned up here.
    if (meta.totalChunks != null) {
      for (let i = 0; i < meta.totalChunks; i++) keys.push(`chunk:${meta.id}:${i}`);
    }
    await Promise.all(keys.map((k) => this.env.STORE_BUCKET.delete(k).catch(() => {})));
  }

  private isExpiredOrGone(meta: StoredMeta): boolean {
    return meta.consumed || meta.revoked || Date.now() > meta.expiresAt;
  }

  private async loadMeta(): Promise<StoredMeta | null> {
    if (this.meta) return this.meta;
    const stored = await this.state.storage.get<StoredMeta>("meta");
    this.meta = stored ?? null;
    return this.meta;
  }
}
