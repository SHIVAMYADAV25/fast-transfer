/**
 * SHA-256 worker.
 *
 * Two jobs, both of which used to run on the main thread and directly
 * compete with RTCDataChannel.send() and React renders for CPU:
 *
 *   1. "file"    — sender side. Hand the worker the File itself (Blob is
 *                  structured-cloneable by reference, so this costs nothing)
 *                  and it reads + hashes the whole thing independently of
 *                  the send loop. The main thread never touches a hash byte.
 *
 *   2. "open"/"update"/"digest" — receiver side. Chunks arrive out of order
 *                  over the wire, so the receiver can only hash the
 *                  contiguous prefix as it fills in. Those prefix bytes get
 *                  streamed here instead of hashed inline.
 *
 * Both modes are keyed by an id so several files can be in flight at once.
 */

import { sha256 } from "@noble/hashes/sha2";

type Incoming =
  | { type: "file"; id: string; file: Blob }
  | { type: "open"; id: string }
  | { type: "update"; id: string; bytes: Uint8Array }
  | { type: "digest"; id: string }
  | { type: "abort"; id: string };

type Outgoing =
  | { type: "result"; id: string; hex: string }
  | { type: "error"; id: string; message: string };

const streams = new Map<string, ReturnType<typeof sha256.create>>();

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

const post = (msg: Outgoing) => {
  (self as unknown as Worker).postMessage(msg);
};

/**
 * Read a Blob in bounded slices rather than calling arrayBuffer() on the
 * whole thing — a 10 GB file must never need 10 GB of worker heap.
 */
const READ_SLICE_BYTES = 8 * 1024 * 1024;

async function hashBlob(id: string, blob: Blob): Promise<void> {
  const hasher = sha256.create();

  // Prefer the stream reader when available: it lets the browser keep the
  // next read in flight while we hash the current buffer.
  if (typeof blob.stream === "function") {
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!streams.has(id) && streams.size === 0) {
        // no-op; kept so abort handling below stays cheap
      }
      hasher.update(
        value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer),
      );
    }
  } else {
    for (let offset = 0; offset < blob.size; offset += READ_SLICE_BYTES) {
      const slice = blob.slice(offset, offset + READ_SLICE_BYTES);
      hasher.update(new Uint8Array(await slice.arrayBuffer()));
    }
  }

  post({ type: "result", id, hex: toHex(hasher.digest()) });
}

self.addEventListener("message", (event: MessageEvent<Incoming>) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case "file":
        void hashBlob(msg.id, msg.file).catch((err: unknown) =>
          post({
            type: "error",
            id: msg.id,
            message: err instanceof Error ? err.message : "hash failed",
          }),
        );
        return;

      case "open":
        streams.set(msg.id, sha256.create());
        return;

      case "update": {
        const hasher = streams.get(msg.id);
        if (hasher) hasher.update(msg.bytes);
        return;
      }

      case "digest": {
        const hasher = streams.get(msg.id);
        if (!hasher) {
          post({ type: "error", id: msg.id, message: "no such hash stream" });
          return;
        }
        streams.delete(msg.id);
        post({ type: "result", id: msg.id, hex: toHex(hasher.digest()) });
        return;
      }

      case "abort":
        streams.delete(msg.id);
        return;
    }
  } catch (err) {
    post({
      type: "error",
      id: (msg as { id?: string }).id ?? "unknown",
      message: err instanceof Error ? err.message : "worker error",
    });
  }
});