"use client";

import type { PeerRole, SignalingMessage } from "@fast-transfer/protocol";

const SIGNALING_HTTP_URL =
  process.env.NEXT_PUBLIC_SIGNALING_HTTP_URL ?? "http://localhost:8787";
const SIGNALING_WS_URL =
  process.env.NEXT_PUBLIC_SIGNALING_WS_URL ?? "ws://localhost:8787";

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

/**
 * Thin wrapper around the room WebSocket. Only ever carries small JSON
 * control messages (OFFER/ANSWER/ICE_CANDIDATE/PEER_JOINED/PEER_LEFT) —
 * never file bytes. That part happens entirely over the RTCDataChannel
 * once `onPeerJoined` fires.
 */
export class SignalingClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<SignalingHandler>();
  private readonly code: string;
  private readonly role: PeerRole;

  constructor(code: string, role: PeerRole) {
    this.code = code;
    this.role = role;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${SIGNALING_WS_URL}/room/${encodeURIComponent(this.code)}/ws?role=${this.role}`;
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error("signaling connection failed")));
      ws.addEventListener("message", (event) => {
        try {
          const msg: SignalingMessage = JSON.parse(event.data);
          this.handlers.forEach((h) => h(msg));
        } catch {
          /* ignore malformed frames */
        }
      });
    });
  }

  onMessage(handler: SignalingHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  send(msg: Omit<SignalingMessage, "roomId">): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ ...msg, roomId: this.code }));
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.ws?.close(1000, "done");
    this.ws = null;
    this.handlers.clear();
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
