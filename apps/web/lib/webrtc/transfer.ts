"use client";

import type { FileMetadata } from "@fast-transfer/protocol";
import { AdaptiveWindowController } from "./adaptive";
import { createHasher } from "./hash";

/**
 * Chunk size for MVP. Not yet adaptive — this is the per-`send()` call read
 * granularity. The *window* (how much can be in flight at once) is what
 * actually adapts now, via AdaptiveWindowController — see adaptive.ts.
 */
const CHUNK_SIZE = 256 * 1024; // 256 KiB

export interface TransferProgress {
  bytesTransferred: number;
  totalBytes: number;
  fileName: string;
  fileIndex: number;
  totalFiles: number;
  ratePerSec: number;
  etaSeconds: number;
  windowBytes?: number; // current adaptive sending window (sender-side only)
}

export interface TransferCallbacks {
  onMetadata?: (meta: FileMetadata) => void;
  onProgress?: (progress: TransferProgress) => void;
  onFileComplete?: (file: File) => void;
  /** Fires right after TRANSFER_COMPLETE is sent for a file — lets the
   * caller checkpoint how far it got, so a reconnect can resume with the
   * remaining files instead of restarting the whole batch (PRD §21). */
  onFileFullySent?: (fileIndex: number) => void;
  onAllComplete?: () => void;
  onError?: (message: string) => void;
}

// Binary chunk framing: 4-byte big-endian chunk index, followed by raw bytes.
// `ordered: true` on the DataChannel already guarantees delivery order, but
// carrying the index keeps the wire format ready for out-of-order / resume
// logic later (PRD §21) without a protocol change.
function frameChunk(index: number, bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(4 + bytes.byteLength);
  new DataView(buf).setUint32(0, index);
  new Uint8Array(buf, 4).set(bytes);
  return buf;
}

function unframeChunk(buf: ArrayBuffer): { index: number; bytes: Uint8Array } {
  return { index: new DataView(buf).getUint32(0), bytes: new Uint8Array(buf, 4) };
}

/** Rolling-window rate calculator (PRD §24) — smoother than instantaneous per-chunk rate. */
class RateMeter {
  private samples: { t: number; bytes: number }[] = [];
  private readonly windowMs: number;

  constructor(windowMs = 3000) {
    this.windowMs = windowMs;
  }

  record(totalBytes: number): number {
    const now = performance.now();
    this.samples.push({ t: now, bytes: totalBytes });
    while (this.samples.length > 1 && now - this.samples[0].t > this.windowMs) {
      this.samples.shift();
    }
    const first = this.samples[0];
    const elapsedSec = (now - first.t) / 1000;
    if (elapsedSec <= 0) return 0;
    return (totalBytes - first.bytes) / elapsedSec;
  }
}

/**
 * Minimal single-producer/single-consumer async queue. Backs the
 * read-and-hash-sequentially / send-in-parallel pipeline below: SHA-256
 * must see every chunk in strict file order to produce a correct digest,
 * but sending across multiple parallel connections is inherently
 * out-of-order relative to file position. Splitting "read+hash" (one
 * sequential producer) from "send" (N parallel consumers, one per channel)
 * satisfies both constraints at once — see the comment above `sendFiles`.
 */
class AsyncQueue<T> {
  private items: T[] = [];
  private waiting: ((result: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(item: T): void {
    const resolve = this.waiting.shift();
    if (resolve) resolve({ value: item, done: false });
    else this.items.push(item);
  }

  close(): void {
    this.closed = true;
    while (this.waiting.length) {
      this.waiting.shift()!({ value: undefined as unknown as T, done: true });
    }
  }

  private next(): Promise<IteratorResult<T>> {
    if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
    if (this.closed) return Promise.resolve({ value: undefined as unknown as T, done: true });
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.next() };
  }
}


export async function sendFiles(
  channels: RTCDataChannel[],
  files: File[],
  callbacks: TransferCallbacks,
  // Absolute totals for progress reporting when this call is a *resumed*
  // continuation of a larger batch (i.e. `files` is a suffix of the
  // original list) — pass the true totals so the progress bar doesn't
  // reset to "0 of just-the-remaining-files" after a reconnect.
  batchOverride?: { totalFiles: number; totalBytes: number; bytesAlreadySent: number },
): Promise<void> {
  if (channels.length === 0) throw new Error("sendFiles needs at least one open channel");
  const rate = new RateMeter();
  const windows = channels.map(() => new AdaptiveWindowController());
  const fileCountOffset = batchOverride ? batchOverride.totalFiles - files.length : 0;
  let bytesTransferredAllFiles = batchOverride?.bytesAlreadySent ?? 0;
  const totalBytesAllFiles = batchOverride?.totalBytes ?? files.reduce((sum, f) => sum + f.size, 0);
  const totalFilesReported = batchOverride?.totalFiles ?? files.length;

  // One-time control message so the receiver knows the true batch shape
  // even when this is a resumed call with a shorter `files` list — without
  // this, a multi-file transfer's progress/completion tracking on the
  // receiver would be based on whatever subset it happens to see.
  channels[0].send(
    JSON.stringify({ type: "BATCH_INFO", totalFiles: totalFilesReported, totalBytes: totalBytesAllFiles }),
  );

  // Sender-side half of the resume handshake: ask the receiver which chunk
  // indexes it already has for a given fileId, and await its reply. Works
  // identically on a first attempt (the answer is simply "none yet") and on
  // a resumed attempt (the answer reflects whatever survived the drop) —
  // no special-casing needed between the two.
  const pendingResumeReplies = new Map<string, (indexes: number[]) => void>();
  const onControlMessage = (event: MessageEvent) => {
    if (typeof event.data !== "string") return;
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "RESUME_STATUS") {
        pendingResumeReplies.get(msg.fileId)?.(msg.receivedIndexes ?? []);
        pendingResumeReplies.delete(msg.fileId);
      }
    } catch {
      /* ignore */
    }
  };
  channels[0].addEventListener("message", onControlMessage);

  const queryAlreadyReceived = (fileId: string): Promise<number[]> => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingResumeReplies.delete(fileId);
        resolve([]); // no reply in time — safe default is "send everything"
      }, 2500);
      pendingResumeReplies.set(fileId, (indexes) => {
        clearTimeout(timeout);
        resolve(indexes);
      });
      channels[0].send(JSON.stringify({ type: "RESUME_QUERY", fileId }));
    });
  };

  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileIndex = i + fileCountOffset; // absolute index in the original batch
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      const meta: FileMetadata = {
        fileId: `f${fileIndex}-${file.name}-${file.size}`,
        name: file.name,
        size: file.size,
        chunkSize: CHUNK_SIZE,
        totalChunks,
        // sha256 intentionally omitted here — see below for why.
        mimeType: file.type || undefined,
      };
      // FILE_METADATA is safe to resend even for a file already in
      // progress — the receiver treats a repeat of the same fileId as a
      // no-op rather than resetting its partial progress (see FileReceiver
      // below). That's what makes the resume path and the first-attempt
      // path the same code, instead of two.
      channels[0].send(JSON.stringify({ type: "FILE_METADATA", meta }));
      callbacks.onMetadata?.(meta);

      const alreadyReceived = new Set(await queryAlreadyReceived(meta.fileId));
      if (alreadyReceived.size > 0) {
        // Count what the receiver already has toward progress immediately,
        // so the bar jumps ahead on resume instead of crawling back up.
        let skippedBytes = 0;
        for (const idx of alreadyReceived) {
          const start = idx * CHUNK_SIZE;
          skippedBytes += Math.min(CHUNK_SIZE, file.size - start);
        }
        bytesTransferredAllFiles += skippedBytes;
      }

      // The whole reason this is a producer/consumer pipeline rather than
      // one loop: SHA-256 needs every chunk in strict file order to
      // produce a correct digest, but sending across multiple parallel
      // RTCPeerConnections is inherently out-of-order relative to file
      // position (channel i%N races channel j%N). So exactly one sequential
      // task reads the file start-to-finish and feeds a running hash — this
      // is what lets hashing overlap with sending instead of blocking it,
      // fixing the thing that was working directly against "the file
      // should start moving now" (see git history / PRD §20). Chunks the
      // receiver already has (resume) are still read and hashed locally —
      // required for a correct whole-file digest — just not enqueued for
      // sending, since re-sending bytes over the network that already
      // arrived would defeat the point of resuming.
      const hasher = createHasher();
      const queues = channels.map(() => new AsyncQueue<{ index: number; bytes: Uint8Array }>());

      const producer = (async () => {
        for (let idx = 0; idx < totalChunks; idx++) {
          const start = idx * CHUNK_SIZE;
          const slice = file.slice(start, start + CHUNK_SIZE);
          const bytes = new Uint8Array(await slice.arrayBuffer());
          hasher.update(bytes);
          if (!alreadyReceived.has(idx)) {
            queues[idx % queues.length].push({ index: idx, bytes });
          }
        }
        queues.forEach((q) => q.close());
      })();

      const consumers = channels.map((channel, channelIdx) =>
        (async () => {
          const window = windows[channelIdx];
          for await (const { index, bytes } of queues[channelIdx]) {
            await waitForBufferSpace(channel, window.getWindow(), window.getLowWatermark());
            channel.send(frameChunk(index, bytes));

            bytesTransferredAllFiles += bytes.byteLength;
            const r = rate.record(bytesTransferredAllFiles);
            window.maybeAdjust(r); // throttled internally — safe to call every chunk
            const remaining = totalBytesAllFiles - bytesTransferredAllFiles;
            callbacks.onProgress?.({
              bytesTransferred: bytesTransferredAllFiles,
              totalBytes: totalBytesAllFiles,
              fileName: file.name,
              fileIndex,
              totalFiles: totalFilesReported,
              ratePerSec: r,
              etaSeconds: r > 0 ? remaining / r : Infinity,
              windowBytes: windows.reduce((s, w) => s + w.getWindow(), 0),
            });
          }
        })(),
      );
      await Promise.all([producer, ...consumers]);

      // Only known now — the producer has necessarily finished reading (and
      // therefore hashing) the entire file by the time every consumer has
      // drained its queue, so this is always the true, complete digest,
      // never a partial one.
      const sha256 = hasher.digestHex();
      channels[0].send(JSON.stringify({ type: "TRANSFER_COMPLETE", fileId: meta.fileId, sha256 }));
      callbacks.onFileFullySent?.(fileIndex);
    }
    callbacks.onAllComplete?.();
  } catch (err) {
    callbacks.onError?.(err instanceof Error ? err.message : "transfer failed");
  } finally {
    channels[0].removeEventListener("message", onControlMessage);
  }
}

function waitForBufferSpace(
  channel: RTCDataChannel,
  highWaterMark: number,
  lowWaterMark: number,
): Promise<void> {
  if (channel.bufferedAmount <= highWaterMark) return Promise.resolve();
  return new Promise((resolve) => {
    channel.bufferedAmountLowThreshold = lowWaterMark;
    const onLow = () => {
      channel.removeEventListener("bufferedamountlow", onLow);
      resolve();
    };
    channel.addEventListener("bufferedamountlow", onLow);
  });
}

/**
 * Receiver side. Reassembles incoming chunks per file into an array indexed
 * by chunk index — not push order — so it's correct whether chunks arrive
 * from one channel (already ordered) or from several channels in parallel
 * (arbitrary interleaving across connections, PRD §8 experiment). Call
 * `handleMessage` for every message event from every open channel; this
 * class doesn't care which channel a message came in on.
 *
 * Uses an in-memory array of chunk buffers (simplest correct approach for
 * MVP) rather than streaming to disk via the File System Access API — see
 * PRD §19 for why that's the right v2 upgrade (Chromium-only today, and
 * this keeps the MVP working identically across browsers while we validate
 * the transfer path).
 */
export class FileReceiver {
  private currentMeta: FileMetadata | null = null;
  private chunks: (Uint8Array | undefined)[] = [];
  private chunksReceived = 0;
  private bytesReceived = 0;
  private bytesReceivedAllFiles = 0;
  private totalBytesAllFiles = 0;
  private fileIndex = 0;
  private totalFiles = 1;
  private rate = new RateMeter();
  private readonly callbacks: TransferCallbacks;
  /** Binary chunks that arrive before FILE_METADATA does. In parallel mode,
   * FILE_METADATA travels on channel 0 alongside every other control
   * message and now (as of the streaming-hash change) isn't sent until the
   * producer has started — meanwhile data chunks on channels 1..N can
   * legitimately arrive first if channel 0 happens to be slower at that
   * moment. Found via the multi-channel end-to-end test with randomized
   * delivery jitter (transfer-e2e-test.mts) — without this buffer, those
   * early chunks were written into `this.chunks` (auto-growing a plain JS
   * array past its current length) and then silently wiped out the moment
   * FILE_METADATA arrived and reset `this.chunks` to a freshly-sized array,
   * producing real, silent data loss disguised as a generic "transfer
   * incomplete" error. */
  private pendingChunks = new Map<number, Uint8Array>();
  /** The connection-index-0 channel — used to reply to RESUME_QUERY. Any of
   * the (possibly several, in parallel mode) channels can deliver JSON
   * control messages, but replies must go out on the one channel whose
   * connectionIndex matches the sender's channels[0] — see multi-peer.ts. */
  private controlChannel: RTCDataChannel | null = null;

  constructor(callbacks: TransferCallbacks, totalFiles = 1, totalBytesAllFiles = 0) {
    this.callbacks = callbacks;
    this.totalFiles = totalFiles;
    this.totalBytesAllFiles = totalBytesAllFiles;
  }

  /** Called once by the caller when the connectionIndex-0 channel opens. */
  setControlChannel(channel: RTCDataChannel): void {
    this.controlChannel = channel;
  }

  handleMessage(data: string | ArrayBuffer): void {
    if (typeof data === "string") {
      const msg = JSON.parse(data);

      if (msg.type === "BATCH_INFO") {
        this.totalFiles = msg.totalFiles;
        this.totalBytesAllFiles = msg.totalBytes;
        return;
      }

      if (msg.type === "FILE_METADATA") {
        const meta = msg.meta as FileMetadata;
        if (this.currentMeta?.fileId === meta.fileId) {
          // Same file re-announced (resume attempt) — this is expected and
          // must NOT wipe partial progress already received. No-op.
          return;
        }
        this.currentMeta = meta;
        this.chunks = new Array(meta.totalChunks);
        this.chunksReceived = 0;
        this.bytesReceived = 0;

        // Absorb any chunks for this exact file that raced ahead of its
        // own metadata, instead of the array-reset above silently
        // discarding them (see this.pendingChunks's comment).
        for (const [index, bytes] of this.pendingChunks) {
          if (index < meta.totalChunks && !this.chunks[index]) {
            this.chunks[index] = bytes;
            this.chunksReceived++;
            this.bytesReceived += bytes.byteLength;
            this.bytesReceivedAllFiles += bytes.byteLength;
          }
        }
        this.pendingChunks.clear();

        this.callbacks.onMetadata?.(meta);
        return;
      }

      if (msg.type === "RESUME_QUERY") {
        const receivedIndexes =
          this.currentMeta?.fileId === msg.fileId
            ? this.chunks.reduce<number[]>((acc, c, i) => {
                if (c) acc.push(i);
                return acc;
              }, [])
            : [];
        this.controlChannel?.send(
          JSON.stringify({ type: "RESUME_STATUS", fileId: msg.fileId, receivedIndexes }),
        );
        return;
      }

      if (msg.type === "TRANSFER_COMPLETE") {
        void this.finishCurrentFile(msg.sha256 as string | undefined);
      }
      return;
    }

    const { index, bytes } = unframeChunk(data);

    if (!this.currentMeta) {
      // FILE_METADATA hasn't arrived yet for whatever file this belongs to
      // — hold onto it rather than dropping it (see pendingChunks comment).
      // Progress can't be reported meaningfully yet (no fileName/size known
      // for certain), so just buffer and return.
      if (!this.pendingChunks.has(index)) this.pendingChunks.set(index, bytes);
      return;
    }

    // Binary chunk — may arrive out of order (parallel channels), so it's
    // written directly to its slot rather than pushed.
    if (!this.chunks[index]) {
      this.chunks[index] = bytes;
      this.chunksReceived++;
      this.bytesReceived += bytes.byteLength;
      this.bytesReceivedAllFiles += bytes.byteLength;
    }

    const r = this.rate.record(this.bytesReceivedAllFiles);
    const remaining = this.totalBytesAllFiles - this.bytesReceivedAllFiles;
    this.callbacks.onProgress?.({
      bytesTransferred: this.bytesReceivedAllFiles,
      totalBytes: this.totalBytesAllFiles || this.currentMeta?.size || this.bytesReceived,
      fileName: this.currentMeta?.name ?? "",
      fileIndex: this.fileIndex,
      totalFiles: this.totalFiles,
      ratePerSec: r,
      etaSeconds: r > 0 ? remaining / r : Infinity,
    });
  }

  private async finishCurrentFile(sha256?: string): Promise<void> {
    if (!this.currentMeta) return;
    if (this.chunksReceived < this.currentMeta.totalChunks) {
      // A TRANSFER_COMPLETE arrived before every chunk did — possible if one
      // of several parallel channels lagged. Give the stragglers a brief
      // window rather than failing immediately; full resume (PRD §21) would
      // replace this with an explicit re-request of missing indexes.
      await new Promise((r) => setTimeout(r, 500));
      if (this.chunksReceived < this.currentMeta.totalChunks) {
        this.callbacks.onError?.(
          `Transfer incomplete: received ${this.chunksReceived}/${this.currentMeta.totalChunks} chunks.`,
        );
        return;
      }
    }

    const blob = new Blob(this.chunks as BlobPart[], {
      type: this.currentMeta.mimeType || "application/octet-stream",
    });

    // The hash now arrives with TRANSFER_COMPLETE, not FILE_METADATA — the
    // sender only knows it once the whole file has been read (streamed
    // hashing, see sendFiles), which happens to line up with roughly when
    // the last chunk is sent, not before the first one.
    if (sha256) {
      const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      if (hex !== sha256) {
        this.callbacks.onError?.("HASH_MISMATCH: received file does not match sender's hash");
        return;
      }
    }

    const file = new File([blob], this.currentMeta.name, { type: blob.type });
    this.callbacks.onFileComplete?.(file);
    this.fileIndex++;

    if (this.fileIndex >= this.totalFiles) {
      this.callbacks.onAllComplete?.();
    }
  }
}

/** Trigger a browser download for a reassembled file (fallback path). */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
