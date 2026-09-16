// apps/web/lib/webrtc/transfer.ts
"use client";

import type { FileMetadata } from "@fast-transfer/protocol";
import { AdaptiveWindowController } from "./adaptive";
import {
  createHasher,
  createStreamingHasher,
  hashFileInBackground,
  type StreamingHasher,
} from "./hash";
import { memorySinkFactory, type FileSink, type SinkFactory } from "./sink";
import { toFriendlyError } from "./errors";

/**
 * Minimal RTCDataChannel surface required by this transfer module.
 *
 * The browser's RTCDataChannel is structurally compatible with this type,
 * while tests can use a lightweight mock without having to implement all
 * browser-only RTCDataChannel properties. It's also the seam a non-WebRTC
 * transport (a raw socket on LAN, a WebTransport stream) slots into.
 */
export interface TransferDataChannel {
  bufferedAmount: number;
  bufferedAmountLowThreshold: number;

  send(data: string | ArrayBuffer): void;

  addEventListener(type: string, callback: (event: MessageEvent) => void): void;

  removeEventListener(
    type: string,
    callback: (event: MessageEvent) => void,
  ): void;
}

/**
 * Chunk framing overhead: a 4-byte big-endian chunk index prefixed to every
 * binary message.
 */
const FRAME_HEADER_BYTES = 4;

/**
 * Extra headroom subtracted from the browser-reported max message size.
 */
const SAFETY_MARGIN_BYTES = 1024;

/**
 * Preferred chunk payload size.
 */
const PREFERRED_CHUNK_SIZE = 256 * 1024;

/**
 * Soft minimum chunk size.
 *
 * This is only a preference. It must never cause the returned chunk size
 * to exceed the actual negotiated message limit.
 */
const MIN_CHUNK_SIZE = 16 * 1024;

/**
 * Conservative fallback when the real negotiated limit is unavailable.
 */
const DEFAULT_MAX_MESSAGE_SIZE_FALLBACK = 64 * 1024;

/**
 * How many chunk reads the producer keeps in flight.
 *
 * The old producer was strictly serial — read, hash, enqueue, then start the
 * next read — so a chunk's disk read never overlapped anything. Keeping a
 * few reads outstanding means the storage layer always has work queued while
 * the previous chunk is being framed and handed to a channel.
 */
const READ_AHEAD_CHUNKS = 4;

/**
 * Upper bound on chunks sitting in the send queue, per channel.
 *
 * This is what stops the producer reading an entire multi-gigabyte file into
 * memory: the old queue was unbounded and the producer never blocked, so
 * sender memory grew with file size rather than staying flat.
 */
const QUEUE_DEPTH_PER_CHANNEL = 8;

/**
 * How often progress callbacks are allowed to fire.
 *
 * Progress used to be emitted once per chunk. At 125 MB/s with 256 KiB
 * chunks that's roughly 500 React state updates a second, on the same thread
 * that has to keep the data channel fed. Nobody can read a number changing
 * 500 times a second, so coalesce to something humane and give the main
 * thread the time back.
 */
const PROGRESS_INTERVAL_MS = 100;

/**
 * Convert the negotiated SCTP maximum message size into a safe payload size.
 *
 * The returned value is the payload size only. The 4-byte framing header is
 * added separately by frameChunk().
 */
export function resolveChunkSize(
  maxMessageSize: number | null | undefined,
): number {
  /**
   * null / undefined means the browser did not expose a usable limit.
   *
   * A value of 0 has the WebRTC meaning "no limit negotiated".
   */
  if (maxMessageSize == null) {
    return DEFAULT_MAX_MESSAGE_SIZE_FALLBACK;
  }

  if (maxMessageSize === 0) {
    return PREFERRED_CHUNK_SIZE;
  }

  /**
   * Try to leave safety margin.
   */
  const usable = maxMessageSize - FRAME_HEADER_BYTES - SAFETY_MARGIN_BYTES;

  if (usable > 0) {
    const preferred = Math.max(
      MIN_CHUNK_SIZE,
      Math.min(PREFERRED_CHUNK_SIZE, usable),
    );

    /**
     * Never allow the soft minimum to exceed the actual limit.
     */
    return Math.min(preferred, usable);
  }

  /**
   * If the safety margin doesn't fit, at least try to fit the framing header.
   */
  const bareMinimum = maxMessageSize - FRAME_HEADER_BYTES;

  if (bareMinimum > 0) {
    return bareMinimum;
  }

  /**
   * There is no possible valid payload.
   */
  throw new Error(
    `Connection's negotiated max message size (${maxMessageSize} bytes) is too small to send any data.`,
  );
}

export interface TransferProgress {
  bytesTransferred: number;
  totalBytes: number;
  fileName: string;
  fileIndex: number;
  totalFiles: number;
  ratePerSec: number;
  etaSeconds: number;
  windowBytes?: number;
}

type ControlMessage =
  | {
      type: "BATCH_INFO";
      totalFiles: number;
      totalBytes: number;
    }
  | {
      type: "FILE_METADATA";
      meta: FileMetadata;
    }
  | {
      type: "RESUME_QUERY";
      fileId: string;
    }
  | {
      type: "RESUME_STATUS";
      fileId: string;
      receivedIndexes: number[];
      /**
       * Every chunk below this index has been received. See
       * replyResumeStatus() — a literal list of every received index can
       * exceed the channel's own max message size on a large file, which
       * would break the very resume it exists to enable.
       */
      contiguousUpTo?: number;
    }
  | {
      type: "CANCEL";
      reason?: string;
    }
  | {
      type: "TRANSFER_COMPLETE";
      fileId: string;
      sha256?: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseControlMessage(data: string): ControlMessage | null {
  let value: unknown;

  try {
    value = JSON.parse(data) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  switch (value.type) {
    case "BATCH_INFO":
      if (
        isFiniteNumber(value.totalFiles) &&
        isFiniteNumber(value.totalBytes) &&
        value.totalFiles >= 0 &&
        value.totalBytes >= 0
      ) {
        return {
          type: "BATCH_INFO",
          totalFiles: value.totalFiles,
          totalBytes: value.totalBytes,
        };
      }
      return null;

    case "FILE_METADATA": {
      const meta = value.meta;
      if (!isRecord(meta)) return null;

      if (
        typeof meta.fileId !== "string" ||
        typeof meta.name !== "string" ||
        !isFiniteNumber(meta.size) ||
        !isFiniteNumber(meta.chunkSize) ||
        !isFiniteNumber(meta.totalChunks)
      ) {
        return null;
      }

      return {
        type: "FILE_METADATA",
        meta: meta as unknown as FileMetadata,
      };
    }

    case "RESUME_QUERY":
      return typeof value.fileId === "string"
        ? { type: "RESUME_QUERY", fileId: value.fileId }
        : null;

    case "RESUME_STATUS":
      if (
        typeof value.fileId === "string" &&
        Array.isArray(value.receivedIndexes) &&
        value.receivedIndexes.every(
          (index): index is number =>
            typeof index === "number" &&
            Number.isInteger(index) &&
            index >= 0,
        )
      ) {
        return {
          type: "RESUME_STATUS",
          fileId: value.fileId,
          receivedIndexes: value.receivedIndexes,
          ...(isFiniteNumber(value.contiguousUpTo) && value.contiguousUpTo >= 0
            ? { contiguousUpTo: Math.floor(value.contiguousUpTo) }
            : {}),
        };
      }
      return null;

    case "CANCEL":
      return {
        type: "CANCEL",
        ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
      };

    case "TRANSFER_COMPLETE":
      if (typeof value.fileId !== "string") return null;

      return {
        type: "TRANSFER_COMPLETE",
        fileId: value.fileId,
        ...(typeof value.sha256 === "string" ? { sha256: value.sha256 } : {}),
      };

    default:
      return null;
  }
}

export interface TransferCallbacks {
  onMetadata?: (meta: FileMetadata) => void;
  onProgress?: (progress: TransferProgress) => void;
  /**
   * Fired when a received file was held in memory and is ready to be handed
   * to the browser's download machinery.
   */
  onFileComplete?: (file: File) => void;
  /**
   * Fired instead of onFileComplete when the bytes were streamed straight to
   * a destination the person chose — there is no File to download because
   * it is already saved.
   */
  onFileSaved?: (fileName: string) => void;
  onFileFullySent?: (fileIndex: number) => void;
  onAllComplete?: () => void;
  onError?: (message: string) => void;
  /**
   * Fired on the receiver once 100% of a file's bytes have arrived and the
   * final integrity check runs. With prefix hashing this is now close to
   * instantaneous — the hash finishes as the last chunk lands — but the
   * callback is kept so the UI has a state to show while the last write
   * flushes.
   */
  onVerifying?: (fileName: string) => void;
}

/**
 * Raw substring the browser throws when its internal SCTP send queue is
 * momentarily full — this is normal backpressure, not a fatal error, and is
 * retried by safeSend() below rather than surfaced to the user.
 */
const SEND_QUEUE_FULL_PATTERN = /send queue is full/i;

/**
 * Backoff schedule for retrying a send() that hit a full send queue.
 */
const SEND_RETRY_DELAYS_MS = [20, 50, 120, 250, 500, 1000, 1500, 2000];

/**
 * send() that survives the browser's "RTCDataChannel send queue is full"
 * error. That error is thrown synchronously by the browser when its internal
 * SCTP send queue — a separate, lower-level limit than the `bufferedAmount`
 * this module already backs off against — is momentarily saturated. It's
 * transient backpressure, not a broken connection, so the right response is
 * a short wait and a retry, not failing the whole transfer.
 */
async function safeSend(
  channel: TransferDataChannel,
  data: string | ArrayBuffer,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      channel.send(data);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        !SEND_QUEUE_FULL_PATTERN.test(message) ||
        attempt >= SEND_RETRY_DELAYS_MS.length
      ) {
        throw err;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, SEND_RETRY_DELAYS_MS[attempt]),
      );
    }
  }
}

/**
 * Binary chunk framing:
 *
 * [4-byte big-endian chunk index][raw chunk bytes]
 */
function frameChunk(index: number, bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(FRAME_HEADER_BYTES + bytes.byteLength);

  new DataView(buf).setUint32(0, index);

  new Uint8Array(buf, FRAME_HEADER_BYTES).set(bytes);

  return buf;
}

function unframeChunk(buf: ArrayBuffer): { index: number; bytes: Uint8Array } {
  if (buf.byteLength < FRAME_HEADER_BYTES) {
    throw new Error("Invalid chunk frame: message is too small.");
  }

  return {
    index: new DataView(buf).getUint32(0),
    bytes: new Uint8Array(buf, FRAME_HEADER_BYTES),
  };
}

/**
 * Rolling-window transfer rate calculator.
 *
 * The previous implementation pushed a sample per chunk and used
 * Array.shift() to expire old ones — an O(n) operation run hundreds of times
 * a second over a list of a thousand-plus entries. This keeps a fixed-size
 * ring of coarser samples instead: same number, none of the cost.
 */
class RateMeter {
  private readonly times: Float64Array;
  private readonly totals: Float64Array;
  private readonly capacity: number;
  private head = 0;
  private count = 0;
  private lastRecordedAt = 0;
  private lastRate = 0;

  constructor(
    private readonly windowMs = 3000,
    private readonly sampleEveryMs = 50,
  ) {
    this.capacity = Math.ceil(windowMs / sampleEveryMs) + 2;
    this.times = new Float64Array(this.capacity);
    this.totals = new Float64Array(this.capacity);
  }

  record(totalBytes: number): number {
    const now = performance.now();

    if (this.count > 0 && now - this.lastRecordedAt < this.sampleEveryMs) {
      return this.lastRate;
    }

    this.lastRecordedAt = now;
    this.times[this.head] = now;
    this.totals[this.head] = totalBytes;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;

    // Walk forward from the oldest retained sample, dropping anything that
    // has fallen out of the window. Bounded by `capacity` (~62).
    let oldest = (this.head - this.count + this.capacity) % this.capacity;
    while (this.count > 1 && now - this.times[oldest] > this.windowMs) {
      this.count--;
      oldest = (oldest + 1) % this.capacity;
    }

    const elapsedSec = (now - this.times[oldest]) / 1000;
    if (elapsedSec <= 0) return this.lastRate;

    this.lastRate = (totalBytes - this.totals[oldest]) / elapsedSec;
    return this.lastRate;
  }
}

/**
 * Throttles progress callbacks to something a human can read, while
 * guaranteeing the final value is always delivered.
 */
class ProgressEmitter {
  private pending: TransferProgress | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastEmitAt = 0;

  constructor(private readonly sink?: (progress: TransferProgress) => void) {}

  push(progress: TransferProgress): void {
    if (!this.sink) return;

    this.pending = progress;

    const now = performance.now();
    const elapsed = now - this.lastEmitAt;

    if (elapsed >= PROGRESS_INTERVAL_MS) {
      this.flush();
      return;
    }

    if (!this.timer) {
      this.timer = setTimeout(
        () => this.flush(),
        PROGRESS_INTERVAL_MS - elapsed,
      );
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const progress = this.pending;
    this.pending = null;
    if (!progress || !this.sink) return;
    this.lastEmitAt = performance.now();
    this.sink(progress);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }
}

interface SendFrame {
  index: number;
  data: ArrayBuffer;
  payloadBytes: number;
}

/**
 * Bounded queue shared by every channel.
 *
 * Chunks used to be assigned to a channel at production time, round-robin.
 * That meant a slow connection still got exactly its 1/N share of the file
 * and the whole transfer finished when the slowest one did. With one shared
 * queue, consumers pull as they free up: a fast connection naturally takes
 * more chunks and a struggling one takes fewer, with no explicit scheduling.
 *
 * The bound is the other half of the job — it's what makes the producer
 * block instead of reading the entire file into memory.
 */
class ChunkQueue {
  private items: SendFrame[] = [];
  private head = 0;
  private consumers: ((frame: SendFrame | null) => void)[] = [];
  private producers: (() => void)[] = [];
  private closed = false;

  constructor(private readonly capacity: number) {}

  private get size(): number {
    return this.items.length - this.head;
  }

  /** Resolves once the frame has been handed off, or there was room for it. */
  async push(frame: SendFrame): Promise<void> {
    while (this.size >= this.capacity && !this.closed) {
      await new Promise<void>((resolve) => this.producers.push(resolve));
    }

    if (this.closed) return;

    const waiting = this.consumers.shift();
    if (waiting) {
      waiting(frame);
      return;
    }

    this.items.push(frame);
  }

  pull(): Promise<SendFrame | null> {
    if (this.size > 0) {
      const frame = this.items[this.head++];

      // Compact occasionally so the backing array doesn't grow without bound.
      if (this.head > 32 && this.head * 2 >= this.items.length) {
        this.items = this.items.slice(this.head);
        this.head = 0;
      }

      this.producers.shift()?.();
      return Promise.resolve(frame);
    }

    if (this.closed) return Promise.resolve(null);

    return new Promise((resolve) => this.consumers.push(resolve));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.consumers.length > 0) this.consumers.shift()!(null);
    while (this.producers.length > 0) this.producers.shift()!();
  }
}

/**
 * Last-resort main-thread hash, used only when the worker becomes
 * unavailable mid-flight. Reads in bounded slices so it never needs the
 * whole file resident at once.
 */
async function hashFileOnMainThread(file: Blob): Promise<string> {
  const hasher = createHasher();
  const SLICE = 8 * 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += SLICE) {
    const slice = file.slice(offset, Math.min(offset + SLICE, file.size));
    hasher.update(new Uint8Array(await slice.arrayBuffer()));
  }
  return hasher.digestHex();
}

/**
 * Send one or more files over one or more RTCDataChannels.
 */
export async function sendFiles(
  channels: TransferDataChannel[],
  files: File[],
  callbacks: TransferCallbacks,
  batchOverride?: {
    totalFiles: number;
    totalBytes: number;
    bytesAlreadySent: number;
  },
  maxMessageSize?: number | null,
  signal?: AbortSignal,
  /**
   * Starting point for each channel's adaptive send window, normally
   * AdaptiveWindowController.estimateInitialWindow(rttMs) computed from an
   * RTT sample taken right after the connection opens. Omit to start cold.
   */
  initialWindowBytes?: number,
): Promise<void> {
  if (channels.length === 0) {
    throw new Error("sendFiles needs at least one open channel");
  }

  const rate = new RateMeter();
  const progress = new ProgressEmitter(callbacks.onProgress);
  const controlChannel = channels[0]!;

  /**
   * Cooperative cancellation. Two things can trigger it:
   *   - the caller aborting `signal` (local "Cancel send" click)
   *   - a CANCEL control message arriving from the receiver
   */
  let cancelled = false;
  let cancelledByPeer = false;
  let cancelReason = "Transfer cancelled.";
  let resolveCancelled: (() => void) | null = null;
  const cancelledPromise = new Promise<void>((resolve) => {
    resolveCancelled = resolve;
  });
  const triggerCancel = (reason: string, byPeer: boolean) => {
    if (cancelled) return;
    cancelled = true;
    cancelledByPeer = byPeer;
    cancelReason = reason;
    resolveCancelled?.();
  };
  if (signal) {
    if (signal.aborted) {
      triggerCancel("Transfer cancelled.", false);
    } else {
      signal.addEventListener(
        "abort",
        () => triggerCancel("Transfer cancelled.", false),
        { once: true },
      );
    }
  }

  const fileCountOffset = batchOverride
    ? batchOverride.totalFiles - files.length
    : 0;

  let bytesTransferredAllFiles = batchOverride?.bytesAlreadySent ?? 0;

  const totalBytesAllFiles =
    batchOverride?.totalBytes ??
    files.reduce((sum, file) => sum + file.size, 0);

  const totalFilesReported = batchOverride?.totalFiles ?? files.length;

  let onControlMessage: ((event: MessageEvent) => void) | null = null;

  try {
    const CHUNK_SIZE = resolveChunkSize(maxMessageSize);

    const windows = channels.map(
      () => new AdaptiveWindowController(initialWindowBytes),
    );

    /**
     * Tell receiver the true batch shape.
     */
    await safeSend(
      controlChannel,
      JSON.stringify({
        type: "BATCH_INFO",
        totalFiles: totalFilesReported,
        totalBytes: totalBytesAllFiles,
      }),
    );

    /**
     * Resume handshake.
     */
    const pendingResumeReplies = new Map<
      string,
      (status: { upTo: number; extra: number[] }) => void
    >();

    onControlMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        return;
      }

      const msg = parseControlMessage(event.data);

      // Anything unparseable is ignored rather than treated as fatal — a
      // single odd frame must never destroy a healthy transfer.
      if (!msg) {
        return;
      }

      if (msg.type === "RESUME_STATUS") {
        const resolver = pendingResumeReplies.get(msg.fileId);

        if (resolver) {
          resolver({
            upTo: msg.contiguousUpTo ?? 0,
            extra: msg.receivedIndexes,
          });
          pendingResumeReplies.delete(msg.fileId);
        }
      }

      if (msg.type === "CANCEL") {
        triggerCancel(
          msg.reason || "The receiver cancelled the transfer.",
          true,
        );
      }
    };

    controlChannel.addEventListener("message", onControlMessage);

    const queryAlreadyReceived = (
      fileId: string,
    ): Promise<{ upTo: number; extra: number[] }> => {
      return new Promise((resolve) => {
        const empty = { upTo: 0, extra: [] as number[] };

        const timeout = setTimeout(() => {
          pendingResumeReplies.delete(fileId);
          resolve(empty);
        }, 2500);

        pendingResumeReplies.set(fileId, (status) => {
          clearTimeout(timeout);
          resolve(status);
        });

        safeSend(
          controlChannel,
          JSON.stringify({ type: "RESUME_QUERY", fileId }),
        ).catch(() => {
          clearTimeout(timeout);
          pendingResumeReplies.delete(fileId);
          resolve(empty);
        });
      });
    };

    /**
     * Process files sequentially.
     */
    for (let i = 0; i < files.length; i++) {
      if (cancelled) break;

      const file = files[i];

      const fileIndex = i + fileCountOffset;

      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      const meta: FileMetadata = {
        fileId: `f${fileIndex}-${file.name}-${file.size}`,
        name: file.name,
        size: file.size,
        chunkSize: CHUNK_SIZE,
        totalChunks,
        mimeType: file.type || undefined,
      };

      /**
       * Start hashing immediately, off the main thread.
       *
       * The worker reads the same File independently of the send loop, so
       * hashing costs the send path nothing and finishes around the same
       * time the last chunk is read. Only when no worker is available do we
       * fall back to hashing inline in the producer, the way this used to
       * work for everyone.
       */
      const backgroundHash = hashFileInBackground(file);
      const inlineHasher = backgroundHash ? null : createHasher();

      /**
       * FILE_METADATA is safe to resend.
       */
      await safeSend(
        controlChannel,
        JSON.stringify({ type: "FILE_METADATA", meta }),
      );

      callbacks.onMetadata?.(meta);

      /**
       * Ask receiver what it already has.
       */
      const resumeStatus = await queryAlreadyReceived(meta.fileId);
      const resumeUpTo = Math.min(resumeStatus.upTo, totalChunks);
      const resumeExtra = new Set(resumeStatus.extra);
      const alreadyHas = (index: number) =>
        index < resumeUpTo || resumeExtra.has(index);

      /**
       * Account for already-received chunks in the progress numbers.
       */
      if (resumeUpTo > 0 || resumeExtra.size > 0) {
        let skippedBytes = 0;

        for (let idx = 0; idx < totalChunks; idx++) {
          if (!alreadyHas(idx)) continue;
          const start = idx * CHUNK_SIZE;
          if (start >= file.size) continue;
          skippedBytes += Math.min(CHUNK_SIZE, file.size - start);
        }

        bytesTransferredAllFiles += skippedBytes;
      }

      const queue = new ChunkQueue(channels.length * QUEUE_DEPTH_PER_CHANNEL);

      /**
       * Which chunks the producer needs to touch at all.
       *
       * With worker hashing, resumed chunks don't need to be read — the
       * worker hashes the file end to end regardless. Without it, every
       * chunk must still be read in order so the inline hash covers the
       * whole file.
       */
      const readEveryChunk = inlineHasher != null;

      const readChunk = async (index: number): Promise<Uint8Array> => {
        const start = index * CHUNK_SIZE;
        const slice = file.slice(
          start,
          Math.min(start + CHUNK_SIZE, file.size),
        );
        return new Uint8Array(await slice.arrayBuffer());
      };

      /**
       * Producer: reads ahead, hands frames to the shared queue, blocks when
       * the queue is full.
       */
      const producer = (async () => {
        const inFlight: { index: number; read: Promise<Uint8Array> }[] = [];
        let nextToRead = 0;

        const topUp = () => {
          while (
            inFlight.length < READ_AHEAD_CHUNKS &&
            nextToRead < totalChunks
          ) {
            const index = nextToRead++;
            if (!readEveryChunk && alreadyHas(index)) continue;
            inFlight.push({ index, read: readChunk(index) });
          }
        };

        try {
          topUp();

          while (inFlight.length > 0) {
            if (cancelled) break;

            const next = inFlight.shift()!;
            const bytes = await next.read;

            // Issue the next read before doing anything with this chunk, so
            // I/O and framing overlap instead of alternating.
            topUp();

            inlineHasher?.update(bytes);

            if (!alreadyHas(next.index)) {
              await queue.push({
                index: next.index,
                data: frameChunk(next.index, bytes),
                payloadBytes: bytes.byteLength,
              });
            }
          }
        } finally {
          queue.close();
        }
      })();

      /**
       * One consumer per channel, all pulling from the same queue.
       */
      const consumers = channels.map((channel, channelIdx) =>
        (async () => {
          const window = windows[channelIdx]!;

          for (;;) {
            if (cancelled) break;

            const frame = await queue.pull();
            if (!frame) break;
            if (cancelled) break;

            await waitForBufferSpace(
              channel,
              window.getWindow(),
              window.getLowWatermark(),
              cancelledPromise,
            );

            if (cancelled) break;

            await safeSend(channel, frame.data);

            bytesTransferredAllFiles += frame.payloadBytes;

            const r = rate.record(bytesTransferredAllFiles);

            window.maybeAdjust(r);

            const remaining = totalBytesAllFiles - bytesTransferredAllFiles;

            progress.push({
              bytesTransferred: bytesTransferredAllFiles,
              totalBytes: totalBytesAllFiles,
              fileName: file.name,
              fileIndex,
              totalFiles: totalFilesReported,
              ratePerSec: r,
              etaSeconds: r > 0 ? remaining / r : Infinity,
              windowBytes: windows.reduce(
                (sum, currentWindow) => sum + currentWindow.getWindow(),
                0,
              ),
            });
          }
        })(),
      );

      /**
       * Wait for the producer and every channel consumer.
       */
      try {
        await Promise.all([producer, ...consumers]);
      } finally {
        // If any consumer threw, the others may still be parked on pull() —
        // closing releases them instead of leaking a pending promise.
        queue.close();
      }

      progress.flush();

      if (cancelled) {
        throw new Error(cancelReason);
      }

      /**
       * Hash: normally already finished in the worker by now.
       */
      let sha256: string;
      if (backgroundHash) {
        try {
          sha256 = await backgroundHash;
        } catch {
          sha256 = await hashFileOnMainThread(file);
        }
      } else {
        sha256 = inlineHasher!.digestHex();
      }

      await safeSend(
        controlChannel,
        JSON.stringify({
          type: "TRANSFER_COMPLETE",
          fileId: meta.fileId,
          sha256,
        }),
      );

      callbacks.onFileFullySent?.(fileIndex);
    }

    if (!cancelled) {
      progress.flush();
      callbacks.onAllComplete?.();
    }
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : "transfer failed";
    const message = toFriendlyError(rawMessage);

    /**
     * Best-effort cancellation notification — skip it if this cancellation
     * came FROM the receiver in the first place.
     */
    if (!cancelledByPeer)
      try {
        controlChannel.send(JSON.stringify({ type: "CANCEL", reason: message }));
      } catch {
        // The channel may itself be broken.
      }

    callbacks.onError?.(message);
  } finally {
    progress.dispose();
    if (onControlMessage) {
      controlChannel.removeEventListener("message", onControlMessage);
    }
  }
}

/**
 * Wait until the channel's buffered amount drops below the adaptive
 * low-watermark.
 */
function waitForBufferSpace(
  channel: TransferDataChannel,
  highWaterMark: number,
  lowWaterMark: number,
  cancelledPromise?: Promise<void>,
): Promise<void> {
  if (channel.bufferedAmount <= highWaterMark) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    channel.bufferedAmountLowThreshold = lowWaterMark;

    const onLow = () => {
      channel.removeEventListener("bufferedamountlow", onLow);
      resolve();
    };

    channel.addEventListener("bufferedamountlow", onLow);

    // Don't hang forever waiting for room if the transfer got cancelled
    // while we were blocked here.
    cancelledPromise?.then(() => {
      channel.removeEventListener("bufferedamountlow", onLow);
      resolve();
    });
  });
}

/**
 * Receiver side.
 *
 * The important change here is that bytes are no longer accumulated for the
 * whole transfer and then processed at the end. Chunks arrive out of order,
 * so the receiver tracks a contiguous prefix pointer: every time the chunk
 * at `nextIndex` shows up, it and anything queued behind it are hashed and
 * written out immediately, then dropped. By the time the last chunk lands,
 * the hash is already computed and the bytes are already where they need to
 * be — there is no reassemble pass, no second copy of the file, and no
 * verification stall.
 */
export class FileReceiver {
  private currentMeta: FileMetadata | null = null;

  /** Chunks that arrived ahead of the contiguous prefix, keyed by index. */
  private reorderBuffer = new Map<number, Uint8Array>();

  /** Every chunk below this index has been hashed and written. */
  private nextIndex = 0;

  private chunksReceived = 0;

  private bytesReceived = 0;

  private bytesReceivedAllFiles = 0;

  private totalBytesAllFiles = 0;

  private fileIndex = 0;

  private totalFiles = 1;

  private rate = new RateMeter();

  private progress: ProgressEmitter;

  private readonly callbacks: TransferCallbacks;

  private sinkFactory: SinkFactory;

  private sink: FileSink | null = null;

  /**
   * Serialises sink writes. Every write is chained onto this, so the sink
   * only ever sees bytes in order and never has to deal with a gap — even
   * though chunks arrive out of order and the sink itself may not exist yet
   * when the first chunk lands.
   */
  private writeChain: Promise<void> = Promise.resolve();

  private writeError: Error | null = null;

  private hasher: StreamingHasher | null = null;

  private finished = false;

  /**
   * Chunks which arrive before FILE_METADATA.
   *
   * This can happen in parallel mode when channel 1/2/3 delivers before
   * channel 0.
   */
  private pendingChunks = new Map<number, Uint8Array>();

  /**
   * Channel 0 used for control replies.
   */
  private controlChannel: TransferDataChannel | null = null;

  constructor(
    callbacks: TransferCallbacks,
    totalFiles = 1,
    totalBytesAllFiles = 0,
    sinkFactory: SinkFactory = memorySinkFactory,
  ) {
    this.callbacks = callbacks;
    this.totalFiles = totalFiles;
    this.totalBytesAllFiles = totalBytesAllFiles;
    this.sinkFactory = sinkFactory;
    this.progress = new ProgressEmitter(callbacks.onProgress);
  }

  /**
   * Choose where incoming files are written. Call before the transfer
   * starts; the default keeps everything in memory and produces a File.
   */
  setSinkFactory(factory: SinkFactory): void {
    this.sinkFactory = factory;
  }

  /**
   * Set the channel used for control responses.
   */
  setControlChannel(channel: TransferDataChannel): void {
    this.controlChannel = channel;
  }

  /**
   * Best-effort notification to the sender that the receiver cancelled.
   */
  notifyCancel(reason: string): void {
    try {
      this.controlChannel?.send(JSON.stringify({ type: "CANCEL", reason }));
    } catch {
      // Best effort only — the channel may already be gone.
    }
  }

  /**
   * Release everything this receiver is holding. Safe to call more than
   * once; used by the UI's cancel path so an abandoned transfer doesn't keep
   * a half-written file or a worker hash stream alive.
   */
  dispose(): void {
    this.finished = true;
    this.progress.dispose();
    this.hasher?.abort();
    this.hasher = null;
    this.reorderBuffer.clear();
    this.pendingChunks.clear();
    const sink = this.sink;
    this.sink = null;
    if (sink) void Promise.resolve(sink.abort()).catch(() => {});
  }

  /**
   * Handle either JSON control data or binary chunks.
   */
  handleMessage(data: string | ArrayBuffer): void {
    /**
     * JSON/control message.
     */
    if (typeof data === "string") {
      const msg = parseControlMessage(data);

      /**
       * An unparseable control frame is ignored, not fatal. A single odd
       * message — a field from a newer build, a truncated frame — must never
       * destroy an otherwise healthy multi-gigabyte transfer. The sender's
       * equivalent handler has always behaved this way.
       */
      if (!msg) {
        return;
      }

      if (msg.type === "BATCH_INFO") {
        this.totalFiles = msg.totalFiles;
        this.totalBytesAllFiles = msg.totalBytes;
        return;
      }

      if (msg.type === "FILE_METADATA") {
        this.beginFile(msg.meta);
        return;
      }

      if (msg.type === "RESUME_QUERY") {
        this.replyResumeStatus(msg.fileId);
        return;
      }

      if (msg.type === "CANCEL") {
        this.callbacks.onError?.(
          msg.reason || "The sender cancelled the transfer.",
        );
        return;
      }

      if (msg.type === "TRANSFER_COMPLETE") {
        const meta = this.currentMeta;
        if (!meta || meta.fileId !== msg.fileId) {
          return;
        }
        void this.finishCurrentFile(msg.sha256);
        return;
      }

      return;
    }

    /**
     * Binary chunk.
     */
    const { index, bytes } = unframeChunk(data);

    /**
     * Metadata has not arrived yet — hold on to the chunk instead of losing
     * it.
     */
    if (!this.currentMeta) {
      if (!this.pendingChunks.has(index)) {
        this.pendingChunks.set(index, bytes);
      }
      return;
    }

    this.acceptChunk(index, bytes);
    this.emitProgress();
  }

  // -------------------------------------------------------------------------

  private beginFile(meta: FileMetadata): void {
    /**
     * Same file announced again during resume — keep everything we have.
     */
    if (this.currentMeta?.fileId === meta.fileId) {
      return;
    }

    this.currentMeta = meta;
    this.nextIndex = 0;
    this.reorderBuffer.clear();
    this.chunksReceived = 0;
    this.bytesReceived = 0;
    this.finished = false;
    this.writeError = null;

    this.hasher?.abort();
    this.hasher = createStreamingHasher();

    /**
     * Create the destination and make it the head of the write chain, so
     * writes queued before it resolves still land in order.
     */
    const sinkPromise = Promise.resolve(
      this.sinkFactory({
        name: meta.name,
        size: meta.size,
        mimeType: meta.mimeType || "application/octet-stream",
      }),
    );

    this.writeChain = sinkPromise.then((sink) => {
      this.sink = sink;
    });

    this.writeChain.catch((err: unknown) => {
      this.writeError =
        err instanceof Error ? err : new Error("could not open destination");
    });

    /**
     * Absorb chunks that arrived before metadata, in index order so the
     * prefix pointer advances as far as it can.
     */
    if (this.pendingChunks.size > 0) {
      const early = [...this.pendingChunks.entries()].sort(
        (a, b) => a[0] - b[0],
      );
      this.pendingChunks.clear();
      for (const [index, bytes] of early) {
        this.acceptChunk(index, bytes);
      }
    }

    this.callbacks.onMetadata?.(meta);
  }

  /**
   * Store or consume a chunk, maintaining the contiguous prefix.
   */
  private acceptChunk(index: number, bytes: Uint8Array): void {
    const meta = this.currentMeta;
    if (!meta) return;

    if (index >= meta.totalChunks) {
      this.callbacks.onError?.(
        toFriendlyError(
          `Invalid chunk index ${index} for file with ${meta.totalChunks} chunks.`,
        ),
      );
      return;
    }

    // Duplicate: either already consumed, or already waiting in the buffer.
    if (index < this.nextIndex || this.reorderBuffer.has(index)) {
      return;
    }

    this.chunksReceived++;
    this.bytesReceived += bytes.byteLength;
    this.bytesReceivedAllFiles += bytes.byteLength;

    if (index !== this.nextIndex) {
      this.reorderBuffer.set(index, bytes);
      return;
    }

    this.consume(bytes);
    this.nextIndex++;

    // Drain whatever was queued behind this chunk.
    for (;;) {
      const queued = this.reorderBuffer.get(this.nextIndex);
      if (!queued) break;
      this.reorderBuffer.delete(this.nextIndex);
      this.consume(queued);
      this.nextIndex++;
    }
  }

  /**
   * Hash and write one chunk of the contiguous prefix, then drop it.
   */
  private consume(bytes: Uint8Array): void {
    this.hasher?.update(bytes);

    this.writeChain = this.writeChain
      .then(() => {
        if (this.writeError) return;
        return this.sink?.write(bytes);
      })
      .catch((err: unknown) => {
        if (!this.writeError) {
          this.writeError =
            err instanceof Error ? err : new Error("failed to write file data");
        }
      });
  }

  private emitProgress(): void {
    const meta = this.currentMeta;
    if (!meta) return;

    const r = this.rate.record(this.bytesReceivedAllFiles);

    const total = this.totalBytesAllFiles || meta.size || this.bytesReceived;

    const remaining = total - this.bytesReceivedAllFiles;

    this.progress.push({
      bytesTransferred: this.bytesReceivedAllFiles,
      totalBytes: total,
      fileName: meta.name,
      fileIndex: this.fileIndex,
      totalFiles: this.totalFiles,
      ratePerSec: r,
      etaSeconds: r > 0 ? Math.max(0, remaining / r) : Infinity,
    });
  }

  /**
   * Answer a RESUME_QUERY.
   *
   * The literal list of every received index can be enormous — a 10 GB file
   * at 256 KiB chunks is roughly 40,000 indexes, which as JSON is far larger
   * than the channel's own max message size. Since nearly everything
   * received is contiguous, send the prefix as a single number and list only
   * the stragglers. Older senders that ignore `contiguousUpTo` simply resend
   * more than they need to, which is safe.
   */
  private replyResumeStatus(fileId: string): void {
    const matches = this.currentMeta?.fileId === fileId;

    const payload = {
      type: "RESUME_STATUS",
      fileId,
      contiguousUpTo: matches ? this.nextIndex : 0,
      receivedIndexes: matches ? [...this.reorderBuffer.keys()] : [],
    };

    try {
      this.controlChannel?.send(JSON.stringify(payload));
    } catch {
      // Best effort only — the control channel may already be gone.
    }
  }

  /**
   * Complete and verify the current file.
   */
  private async finishCurrentFile(sha256?: string): Promise<void> {
    const meta = this.currentMeta;
    if (!meta || this.finished) {
      return;
    }

    /**
     * TRANSFER_COMPLETE can arrive slightly before the final chunk(s),
     * especially in parallel mode where channels finish at slightly
     * different times. Poll rather than assume.
     */
    const totalChunks = meta.totalChunks;
    const COMPLETION_POLL_MS = 100;
    const COMPLETION_MAX_WAIT_MS = 15_000;

    if (this.chunksReceived < totalChunks) {
      const deadline = performance.now() + COMPLETION_MAX_WAIT_MS;

      while (this.chunksReceived < totalChunks && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, COMPLETION_POLL_MS));
      }

      if (this.chunksReceived < totalChunks) {
        this.fail(
          `Transfer incomplete: received ${this.chunksReceived}/${totalChunks} chunks.`,
        );
        return;
      }
    }

    if (this.nextIndex < totalChunks) {
      this.fail(`Transfer incomplete: missing chunk ${this.nextIndex}.`);
      return;
    }

    this.finished = true;

    this.callbacks.onVerifying?.(meta.name);

    /**
     * Flush every queued write before touching the result.
     */
    try {
      await this.writeChain;
    } catch (err) {
      this.writeError =
        err instanceof Error ? err : new Error("failed to write file data");
    }

    if (this.writeError) {
      this.fail(`Could not save the file: ${this.writeError.message}`);
      return;
    }

    /**
     * The hash was computed as the bytes arrived — this just collects it.
     */
    if (sha256) {
      let digest: string;
      try {
        digest = (await this.hasher?.digestHex()) ?? "";
      } catch {
        this.fail("Could not verify the received file.");
        return;
      }

      if (digest !== sha256) {
        this.fail("HASH_MISMATCH: received file does not match sender's hash");
        return;
      }
    } else {
      this.hasher?.abort();
    }

    this.hasher = null;

    const sink = this.sink;
    this.sink = null;

    if (!sink) {
      this.fail("Could not save the file: no destination was available.");
      return;
    }

    let result;
    try {
      result = await sink.finish();
    } catch (err) {
      this.fail(
        `Could not save the file: ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      );
      return;
    }

    this.progress.flush();

    if (result.file) {
      this.callbacks.onFileComplete?.(result.file);
    } else {
      this.callbacks.onFileSaved?.(meta.name);
    }

    this.fileIndex++;

    if (this.fileIndex >= this.totalFiles) {
      this.callbacks.onAllComplete?.();
    }
  }

  /**
   * Report a terminal problem with the current file and throw away anything
   * partially written, so a failed transfer never leaves a plausible-looking
   * file behind.
   */
  private fail(message: string): void {
    this.finished = true;
    this.hasher?.abort();
    this.hasher = null;

    const sink = this.sink;
    this.sink = null;
    if (sink) void Promise.resolve(sink.abort()).catch(() => {});

    this.callbacks.onError?.(toFriendlyError(message));
  }
}

/**
 * Save a completed file to disk.
 *
 * Inside the Kimo desktop app this opens a native "Save As" dialog and
 * writes the file directly via Rust (see apps/desktop/src-tauri) instead of
 * relying on the browser's download manager. In a plain browser tab this is
 * the classic `<a download>` click-simulation trick.
 *
 * When the receiver used a DiskSink this is never called — the bytes went
 * straight to their destination as they arrived.
 */
export async function downloadFile(file: File): Promise<void> {
  const { saveFileNatively } = await import("../native/save");
  const savedNatively = await saveFileNatively(file);
  if (savedNatively) return;

  const url = URL.createObjectURL(file);

  const a = document.createElement("a");

  a.href = url;

  a.download = file.name;

  document.body.appendChild(a);

  a.click();

  a.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}