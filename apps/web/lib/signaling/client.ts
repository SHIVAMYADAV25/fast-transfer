// apps/web/lib/signaling/client.ts
"use client";

import type { PeerRole, SignalingMessage } from "@fast-transfer/protocol";

const SIGNALING_HTTP_URL =
  process.env.NEXT_PUBLIC_SIGNALING_HTTP_URL ?? "http://localhost:8787";
const SIGNALING_WS_URL =
  process.env.NEXT_PUBLIC_SIGNALING_WS_URL ?? "ws://localhost:8787";

/**
 * How often we ping the room's WebSocket while it's open. This is the fix
 * for "waits a while, then the connection never happens": Cloudflare's edge
 * (and plenty of home/corporate NATs and proxies in between) will silently
 * drop an idle WebSocket without ever sending a close frame the browser can
 * react to. `ws.readyState` keeps reporting OPEN even though nothing will
 * ever arrive again. A steady heartbeat keeps the path alive, and doubles
 * as a liveness probe.
 */
const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * If we haven't seen ANY traffic (a PONG, or any other message) in this
 * long, treat the socket as dead even though it never fired a close event,
 * and force it closed so callers can reconnect.
 */
const HEARTBEAT_TIMEOUT_MS = 40_000;

export interface CreateRoomResult {
  roomId: string;
  code: string;
  expiresAt: number;
}

/** POST /room — sender calls this to mint a fresh code before anyone joins. */
export async function createRoom(): Promise<CreateRoomResult> {
  const res = await fetch(`${SIGNALING_HTTP_URL}/room`, { method: "POST" });
  if (!res.ok) throw new Error(`failed to create room (${res.status})`);
  return res.json();
}

/** GET /room/:code — receiver calls this before joining, to fail fast on a bad code. */
export async function checkRoom(
  code: string,
): Promise<{ exists: boolean; expired?: boolean; full?: boolean }> {
  const res = await fetch(`${SIGNALING_HTTP_URL}/room/${encodeURIComponent(code)}`);
  if (res.status === 404) return { exists: false };
  if (res.status === 410) return { exists: false, expired: true };
  return res.json();
}

type SignalingHandler = (msg: SignalingMessage) => void;
type CloseHandler = () => void;

/**
 * Thin wrapper around the room WebSocket. Only ever carries small JSON
 * control messages (OFFER/ANSWER/ICE_CANDIDATE/PEER_JOINED/PEER_LEFT) —
 * never file bytes. That part happens entirely over the RTCDataChannel
 * once `onPeerJoined` fires.
 *
 * Keeps itself alive with a PING/PONG heartbeat and exposes `onClose` so
 * callers can detect — and recover from — a connection that died silently
 * while nothing else was happening (e.g. the sender is just sitting on the
 * "waiting for recipient" screen).
 */
export class SignalingClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<SignalingHandler>();
  private closeHandlers = new Set<CloseHandler>();
  private readonly code: string;
  private readonly role: PeerRole;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivityAt = 0;
  private explicitlyClosed = false;

  constructor(code: string, role: PeerRole) {
    this.code = code;
    this.role = role;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.explicitlyClosed = false;
      const url = `${SIGNALING_WS_URL}/room/${encodeURIComponent(this.code)}/ws?role=${this.role}`;
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.addEventListener("open", () => {
        this.lastActivityAt = Date.now();
        this.startHeartbeat();
        resolve();
      });
      ws.addEventListener("error", () => reject(new Error("signaling connection failed")));
      ws.addEventListener("close", () => {
        this.stopHeartbeat();
        const wasExplicit = this.explicitlyClosed;
        this.ws = null;
        if (!wasExplicit) {
          this.closeHandlers.forEach((h) => h());
        }
      });
      ws.addEventListener("message", (event) => {
        this.lastActivityAt = Date.now();
        try {
          const msg: SignalingMessage = JSON.parse(event.data);
          if (msg.type === "PONG") return; // heartbeat reply only, nothing to forward
          this.handlers.forEach((h) => h(msg));
        } catch {
          /* ignore malformed frames */
        }
      });
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastActivityAt > HEARTBEAT_TIMEOUT_MS) {
        // No traffic at all for too long — readyState still says OPEN, but
        // the path is almost certainly dead. Force-close so the "close"
        // handler fires and whoever's using us can reconnect instead of
        // waiting forever on a socket that will never deliver anything.
        this.ws.close();
        return;
      }
      try {
        this.ws.send(JSON.stringify({ type: "PING", roomId: this.code }));
      } catch {
        /* the close handler above will pick this up */
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  onMessage(handler: SignalingHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Fires when the socket closes unexpectedly — never on a local close() call. */
  onClose(handler: CloseHandler): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  send(msg: Omit<SignalingMessage, "roomId">): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ ...msg, roomId: this.code }));
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.explicitlyClosed = true;
    this.stopHeartbeat();
    this.ws?.close(1000, "done");
    this.ws = null;
    this.handlers.clear();
    this.closeHandlers.clear();
  }
}

/**
 * Waits for one message of a specific type, resolving with its payload —
 * or `fallback` if nothing arrives within `timeoutMs`. Used for the CONFIG
 * handshake (receiver waiting to be told how many connections to expect)
 * but generic enough for similar one-shot waits.
 */
export function waitForMessage<T>(
  client: SignalingClient,
  type: SignalingMessage["type"],
  extract: (msg: SignalingMessage) => T,
  fallback: T,
  timeoutMs: number,
): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        unsubscribe();
        resolve(fallback);
      }
    }, timeoutMs);
    const unsubscribe = client.onMessage((msg) => {
      if (msg.type !== type || settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(extract(msg));
    });
  });
}