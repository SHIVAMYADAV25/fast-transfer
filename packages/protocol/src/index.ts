/**
 * @fast-transfer/protocol
 *
 * Single source of truth for every message shape that crosses a wire in this
 * system. `apps/signaling` (Cloudflare Worker/DO) and `apps/web` (Next.js)
 * both import from here. Never redefine these shapes locally in either app —
 * if the two drift, signaling breaks in ways that are annoying to debug.
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export type PeerRole = "sender" | "receiver";

// ---------------------------------------------------------------------------
// Signaling messages (client <-> Durable Object, over WebSocket)
// ---------------------------------------------------------------------------

export type SignalingMessageType =
  | "JOIN" // client -> server: "I am the sender/receiver for this room"
  | "PEER_JOINED" // server -> client: the other side just connected
  | "PEER_LEFT" // server -> client: the other side disconnected
  | "CONFIG" // sender -> receiver: "expect N RTCPeerConnections" — lets the
  // receiver open exactly that many instead of eagerly opening a fixed max
  // and pruning unused slots (see multi-peer.ts)
  | "OFFER" // sender -> server -> receiver: SDP offer
  | "ANSWER" // receiver -> server -> sender: SDP answer
  | "ICE_CANDIDATE" // either direction: ICE candidate relay
  | "ROOM_FULL" // server -> client: room already has two peers
  | "ROOM_EXPIRED" // server -> client: room TTL exceeded
  | "PING" // client -> server: heartbeat, keeps the WS alive and lets the
  // client detect a silently-dead connection (idle WS can get dropped by
  // intermediate proxies/NATs without ever firing a close event)
  | "PONG" // server -> client: heartbeat reply
  | "ERROR"; // server -> client: something went wrong, see ErrorCode

export interface SignalingMessage {
  type: SignalingMessageType;
  roomId: string;
  role?: PeerRole;
  /**
   * Which independent RTCPeerConnection this message belongs to. Used by the
   * multi-connection parallelism experiment (PRD §8) — sender and receiver
   * can negotiate several peer connections over the same signaling socket
   * simultaneously; this field lets each PeerConnection instance pick out
   * only the messages meant for it. Omitted (or 0) for the normal
   * single-connection path.
   */
  connectionIndex?: number;
  payload?: unknown;
}

// These mirror the shape of the browser's native RTCSessionDescriptionInit /
// RTCIceCandidateInit, but are declared locally (rather than importing the
// DOM lib types) so this package stays environment-agnostic — it's imported
// by both the Cloudflare Worker (no DOM lib) and the Next.js app (has DOM lib).
export interface SdpDescription {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp?: string;
}

export interface IceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface OfferPayload {
  sdp: SdpDescription;
}

export interface AnswerPayload {
  sdp: SdpDescription;
}

export interface IceCandidatePayload {
  candidate: IceCandidateInit;
}

export interface ConfigPayload {
  connectionCount: number;
}

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

export interface RoomInfo {
  roomId: string;
  code: string; // human-facing pairing code, e.g. "river-cloud-daisy"
  createdAt: number;
  expiresAt: number;
}

export const ROOM_TTL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Transfer protocol (runs *inside* the RTCDataChannel once connected —
// the signaling server never sees any of this)
// ---------------------------------------------------------------------------

export type TransferMessageType =
  | "HELLO"
  | "FILE_METADATA"
  | "READY"
  | "CHUNK"
  | "CHUNK_ACK"
  | "TRANSFER_COMPLETE"
  | "VERIFY"
  | "VERIFIED"
  | "PAUSE"
  | "RESUME"
  | "CANCEL";

export interface FileMetadata {
  fileId: string;
  name: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  sha256?: string; // populated once sender finishes hashing (may lag metadata send)
  mimeType?: string;
}

export interface ChunkMeta {
  fileId: string;
  chunkIndex: number;
  offset: number;
  size: number;
}

// ---------------------------------------------------------------------------
// Client-side transfer state machine
// ---------------------------------------------------------------------------

export type TransferState =
  | "CREATED"
  | "WAITING_FOR_PEER"
  | "PAIRING"
  | "CONNECTING"
  | "CONNECTED"
  | "NEGOTIATING"
  | "TRANSFERRING"
  | "VERIFYING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED"
  | "CONNECTION_LOST";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ErrorCode =
  | "PEER_NOT_FOUND"
  | "ROOM_EXPIRED"
  | "ROOM_FULL"
  | "CONNECTION_FAILED"
  | "ICE_FAILED"
  | "DATA_CHANNEL_FAILED"
  | "TRANSFER_CANCELLED"
  | "FILE_READ_FAILED"
  | "FILE_WRITE_FAILED"
  | "HASH_MISMATCH"
  | "BROWSER_UNSUPPORTED"
  | "RELAY_UNAVAILABLE"
  | "INVALID_ROOM"
  | "SIGNALING_DISCONNECTED";

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  PEER_NOT_FOUND: "The other device hasn't joined yet.",
  ROOM_EXPIRED: "This transfer code has expired. Generate a new one.",
  ROOM_FULL: "This room already has two people connected.",
  CONNECTION_FAILED: "Couldn't establish a connection to the other device.",
  ICE_FAILED: "Network connectivity check failed. Try again, or check your network.",
  DATA_CHANNEL_FAILED: "The data channel closed unexpectedly.",
  TRANSFER_CANCELLED: "Transfer was cancelled.",
  FILE_READ_FAILED: "Couldn't read the selected file.",
  FILE_WRITE_FAILED: "Couldn't write the incoming file to disk.",
  HASH_MISMATCH: "File integrity check failed the received file doesn't match the original.",
  BROWSER_UNSUPPORTED: "Your browser doesn't support a feature this app needs.",
  RELAY_UNAVAILABLE: "Direct connection failed and no relay is available.",
  INVALID_ROOM: "That transfer code doesn't exist.",
  SIGNALING_DISCONNECTED: "Lost connection to the pairing server.",
};

// ---------------------------------------------------------------------------
// Stored / async transfer (croc-style: encrypt locally, upload only
// ciphertext, decryption key lives after # in the URL so it never reaches
// the server). See docs/stored-transfers.md for the full design.
// ---------------------------------------------------------------------------

export type StoredTransferStatus = "uploading" | "available" | "consumed" | "revoked" | "expired";

export interface StoredManifestEntry {
  name: string;
  size: number;
  sha256: string;
  mimeType?: string;
  chunkSize: number;
  totalChunks: number;
}

/** The plaintext manifest, before it's AES-GCM sealed with the manifest sub-key. */
export interface StoredManifest {
  files: StoredManifestEntry[];
  totalSize: number;
  createdAt: number;
}

export interface CreateStoredTransferRequest {
  maxDownloads: number; // e.g. 1 for "single download", 0 for unlimited within the TTL
  ttlMs: number;
}

export interface CreateStoredTransferResponse {
  id: string;
  revokeToken: string; // kept client-side only, lets the sender delete early
  expiresAt: number;
}

export interface StoredTransferStatusResponse {
  status: StoredTransferStatus;
  expiresAt: number;
  downloadsRemaining: number | null; // null = unlimited
  totalChunks: number | null; // null until upload is marked complete
}

export const STORED_TRANSFER_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 1 day, matches reference UI

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** ICE servers for MVP: public STUN only. Add TURN here once built (§9/§11 of PRD). */
export const DEFAULT_ICE_SERVERS: IceServerConfig[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
