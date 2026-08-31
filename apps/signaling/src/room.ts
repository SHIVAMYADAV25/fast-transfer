/**
 * TransferRoom — one Durable Object instance per active transfer room.
 *
 * Responsibilities (and ONLY these):
 *   - hold at most two WebSocket connections: one "sender", one "receiver"
 *   - forward CONFIG / OFFER / ANSWER / ICE_CANDIDATE messages between them verbatim
 *   - tell each side when the other joins/leaves
 *   - expire itself after ROOM_TTL_MS
 *
 * It never inspects, stores, or forwards file bytes. Once the two browsers'
 * RTCPeerConnection completes its handshake, this object is no longer in
 * the data path at all — the whole point of the architecture.
 */

import type { PeerRole, SignalingMessage } from "@fast-transfer/protocol";
import { ROOM_TTL_MS } from "@fast-transfer/protocol";

interface RoomState {
  roomId: string;
  createdAt: number;
  expiresAt: number;
}

export class TransferRoom {
  private state: DurableObjectState;
  private sockets: Partial<Record<PeerRole, WebSocket>> = {};
  private room: RoomState | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      return this.handleInit(request);
    }

    if (url.pathname === "/status") {
      return this.handleStatus();
    }

    if (url.pathname.endsWith("/ws")) {
      return this.handleWebSocketUpgrade(request);
    }

    return new Response("not found", { status: 404 });
  }

  private async handleInit(request: Request): Promise<Response> {
    const body = (await request.json()) as { roomId: string; ttlMs: number };
    const now = Date.now();
    this.room = {
      roomId: body.roomId,
      createdAt: now,
      expiresAt: now + (body.ttlMs ?? ROOM_TTL_MS),
    };
    await this.state.storage.put("room", this.room);
    // Wake up automatically to clean up after expiry, even if nobody visits.
    await this.state.storage.setAlarm(this.room.expiresAt);
    return Response.json({ ok: true });
  }

  private async handleStatus(): Promise<Response> {
    const room = await this.loadRoom();
    if (!room) return Response.json({ exists: false }, { status: 404 });
    if (Date.now() > room.expiresAt) {
      return Response.json({ exists: false, expired: true }, { status: 410 });
    }
    return Response.json({
      exists: true,
      expiresAt: room.expiresAt,
      full: Boolean(this.sockets.sender && this.sockets.receiver),
    });
  }

  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const room = await this.loadRoom();
    if (!room) {
      return new Response("room not found", { status: 404 });
    }
    if (Date.now() > room.expiresAt) {
      return new Response("room expired", { status: 410 });
    }

    const url = new URL(request.url);
    const role = url.searchParams.get("role") as PeerRole | null;
    if (role !== "sender" && role !== "receiver") {
      return new Response("missing or invalid ?role=sender|receiver", { status: 400 });
    }
    if (this.sockets[role]) {
      // A role reconnecting (e.g. page refresh) replaces its old socket.
      try {
        this.sockets[role]?.close(1000, "replaced by new connection");
      } catch {
        /* ignore */
      }
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Hibernation API: accept() registers the socket with the runtime so the
    // Durable Object can be evicted from memory between messages and still
    // wake up on the next one — this is what keeps idle rooms cheap.
    this.state.acceptWebSocket(server, [role]);
    this.sockets[role] = server;

    const other = role === "sender" ? "receiver" : "sender";
    if (this.sockets[other]) {
      this.send(this.sockets[other]!, { type: "PEER_JOINED", roomId: room.roomId, role });
      this.send(server, { type: "PEER_JOINED", roomId: room.roomId, role: other });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // Hibernation-API callback — invoked for every inbound message, including
  // after the object has been evicted and respun back up.
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return; // signaling is JSON text only
    let parsed: SignalingMessage;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }

    const role = this.roleOf(ws);
    if (!role) return;
    const other = role === "sender" ? "receiver" : "sender";
    const target = this.sockets[other];

    // Only forward the handshake message types; everything else is dropped.
    if (
      parsed.type === "CONFIG" ||
      parsed.type === "OFFER" ||
      parsed.type === "ANSWER" ||
      parsed.type === "ICE_CANDIDATE"
    ) {
      if (target) this.send(target, parsed);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const role = this.roleOf(ws);
    if (!role) return;
    delete this.sockets[role];
    const other = role === "sender" ? "receiver" : "sender";
    const target = this.sockets[other];
    const room = await this.loadRoom();
    if (target && room) {
      this.send(target, { type: "PEER_LEFT", roomId: room.roomId, role });
    }
  }

  async alarm(): Promise<void> {
    // Room TTL hit — close any remaining sockets and drop stored state.
    for (const ws of Object.values(this.sockets)) {
      try {
        ws?.close(1000, "room expired");
      } catch {
        /* ignore */
      }
    }
    this.sockets = {};
    await this.state.storage.deleteAll();
    this.room = null;
  }

  private roleOf(ws: WebSocket): PeerRole | null {
    for (const tag of this.state.getTags(ws)) {
      if (tag === "sender" || tag === "receiver") return tag;
    }
    return null;
  }

  private send(ws: WebSocket, msg: SignalingMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already gone, ignore */
    }
  }

  private async loadRoom(): Promise<RoomState | null> {
    if (this.room) return this.room;
    const stored = await this.state.storage.get<RoomState>("room");
    this.room = stored ?? null;
    return this.room;
  }
}
