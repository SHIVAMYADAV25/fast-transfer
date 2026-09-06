// apps/web/lib/webrtc/transfer.ts
"use client";

import type { FileMetadata } from "@fast-transfer/protocol";
import { AdaptiveWindowController } from "./adaptive";
import { createHasher } from "./hash";
import { toFriendlyError } from "./errors";

/**
 * Minimal RTCDataChannel surface required by this transfer module.
 *
 * The browser's RTCDataChannel is structurally compatible with this type,
 * while tests can use a lightweight mock without having to implement all
 * browser-only RTCDataChannel properties.
 */
export interface TransferDataChannel {
  bufferedAmount: number;
  bufferedAmountLowThreshold: number;

  send(data: string | ArrayBuffer): void;

  addEventListener(
    type: string,
    callback: (event: MessageEvent) => void,
  ): void;

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
  const usable =
    maxMessageSize - FRAME_HEADER_BYTES - SAFETY_MARGIN_BYTES;

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
        };
      }
      return null;

    case "CANCEL":
      return {
        type: "CANCEL",
        ...(typeof value.reason === "string"
          ? { reason: value.reason }
          : {}),
      };

    case "TRANSFER_COMPLETE":
      if (typeof value.fileId !== "string") return null;

      return {
        type: "TRANSFER_COMPLETE",
        fileId: value.fileId,
        ...(typeof value.sha256 === "string"
          ? { sha256: value.sha256 }
          : {}),
      };

    default:
      return null;
  }
}

export interface TransferCallbacks {
  onMetadata?: (meta: FileMetadata) => void;
  onProgress?: (progress: TransferProgress) => void;
  onFileComplete?: (file: File) => void;
  onFileFullySent?: (fileIndex: number) => void;
  onAllComplete?: () => void;
  onError?: (message: string) => void;
  /**
   * Fired on the receiver right after 100% of a file's bytes have arrived,
   * before hash verification (which can take a real, visible amount of time
   * on large files — reassembling + SHA-256'ing a multi-GB blob is not
   * instant). Without this the UI has nothing to show between "100%
   * received" and the download actually starting, which reads as frozen.
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
 * error. That error is thrown synchronously by the browser when its
 * internal SCTP send queue — a separate, lower-level limit than the
 * `bufferedAmount` this module already backs off against — is momentarily
 * saturated. It's transient backpressure, not a broken connection, so the
 * right response is a short wait and a retry, not failing the whole
 * transfer (which is what was happening before, and exactly why users saw
 * this raw browser error surface as a fatal one).
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

function unframeChunk(
  buf: ArrayBuffer,
): { index: number; bytes: Uint8Array } {
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
 */
class RateMeter {
  private samples: { t: number; bytes: number }[] = [];

  private readonly windowMs: number;

  constructor(windowMs = 3000) {
    this.windowMs = windowMs;
  }

  record(totalBytes: number): number {
    const now = performance.now();

    this.samples.push({
      t: now,
      bytes: totalBytes,
    });

    while (
      this.samples.length > 1 &&
      now - this.samples[0].t > this.windowMs
    ) {
      this.samples.shift();
    }

    const first = this.samples[0];

    const elapsedSec = (now - first.t) / 1000;

    if (elapsedSec <= 0) {
      return 0;
    }

    return (totalBytes - first.bytes) / elapsedSec;
  }
}

/**
 * Small single-producer / single-consumer async queue.
 */
class AsyncQueue<T> {
  private items: T[] = [];

  private waiting: ((result: IteratorResult<T>) => void)[] = [];

  private closed = false;

  push(item: T): void {
    if (this.closed) {
      return;
    }

    const resolve = this.waiting.shift();

    if (resolve) {
      resolve({
        value: item,
        done: false,
      });
    } else {
      this.items.push(item);
    }
  }

  close(): void {
    this.closed = true;

    while (this.waiting.length > 0) {
      this.waiting.shift()!({
        value: undefined as unknown as T,
        done: true,
      });
    }
  }

  private next(): Promise<IteratorResult<T>> {
    if (this.items.length > 0) {
      return Promise.resolve({
        value: this.items.shift()!,
        done: false,
      });
    }

    if (this.closed) {
      return Promise.resolve({
        value: undefined as unknown as T,
        done: true,
      });
    }

    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(),
    };
  }
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
): Promise<void> {
  if (channels.length === 0) {
    throw new Error("sendFiles needs at least one open channel");
  }

  const rate = new RateMeter();
  const controlChannel = channels[0]!;

  /**
   * Cooperative cancellation. Two things can trigger it:
   *   - the caller aborting `signal` (local "Cancel send" click)
   *   - a CANCEL control message arriving from the receiver (they clicked
   *     "Cancel receive")
   * Either way we stop promptly instead of continuing to blast chunks into
   * a channel nobody's listening to anymore.
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

  let bytesTransferredAllFiles =
    batchOverride?.bytesAlreadySent ?? 0;

  const totalBytesAllFiles =
    batchOverride?.totalBytes ??
    files.reduce((sum, file) => sum + file.size, 0);

  const totalFilesReported =
    batchOverride?.totalFiles ?? files.length;

  let onControlMessage:
    | ((event: MessageEvent) => void)
    | null = null;

  try {
    const CHUNK_SIZE = resolveChunkSize(maxMessageSize);

    const windows = channels.map(
      () => new AdaptiveWindowController(),
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
      (indexes: number[]) => void
    >();

    onControlMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        return;
      }

      try {
        const msg = parseControlMessage(event.data);

        if (!msg) {
          return;
        }

        if (msg.type === "RESUME_STATUS") {
          const resolver = pendingResumeReplies.get(msg.fileId);

          if (resolver) {
            resolver(msg.receivedIndexes);
            pendingResumeReplies.delete(msg.fileId);
          }
        }

        if (msg.type === "CANCEL") {
          triggerCancel(
            msg.reason || "The receiver cancelled the transfer.",
            true,
          );
        }
      } catch {
        // Ignore malformed control messages.
      }
    };

    controlChannel.addEventListener(
      "message",
      onControlMessage,
    );

    const queryAlreadyReceived = (
      fileId: string,
    ): Promise<number[]> => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          pendingResumeReplies.delete(fileId);
          resolve([]);
        }, 2500);

        pendingResumeReplies.set(fileId, (indexes) => {
          clearTimeout(timeout);
          resolve(indexes);
        });

        safeSend(
          controlChannel,
          JSON.stringify({
            type: "RESUME_QUERY",
            fileId,
          }),
        ).catch(() => {
          clearTimeout(timeout);
          pendingResumeReplies.delete(fileId);
          resolve([]);
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

      const totalChunks = Math.ceil(
        file.size / CHUNK_SIZE,
      );

      const meta: FileMetadata = {
        fileId: `f${fileIndex}-${file.name}-${file.size}`,
        name: file.name,
        size: file.size,
        chunkSize: CHUNK_SIZE,
        totalChunks,
        mimeType: file.type || undefined,
      };

      /**
       * FILE_METADATA is safe to resend.
       */
      await safeSend(
        controlChannel,
        JSON.stringify({
          type: "FILE_METADATA",
          meta,
        }),
      );

      callbacks.onMetadata?.(meta);

      /**
       * Ask receiver what it already has.
       */
      const alreadyReceived = new Set(
        await queryAlreadyReceived(meta.fileId),
      );

      /**
       * Account for already-received chunks.
       */
      if (alreadyReceived.size > 0) {
        let skippedBytes = 0;

        for (const idx of alreadyReceived) {
          const start = idx * CHUNK_SIZE;

          if (start >= file.size) {
            continue;
          }

          skippedBytes += Math.min(
            CHUNK_SIZE,
            file.size - start,
          );
        }

        bytesTransferredAllFiles += skippedBytes;
      }

      /**
       * SHA-256 has to process chunks in strict file order.
       */
      const hasher = createHasher();

      /**
       * One queue per channel.
       */
      const queues = channels.map(
        () =>
          new AsyncQueue<{
            index: number;
            bytes: Uint8Array;
          }>(),
      );

      /**
       * Sequential producer.
       */
      const producer = (async () => {
        try {
          for (
            let idx = 0;
            idx < totalChunks;
            idx++
          ) {
            if (cancelled) break;

            const start = idx * CHUNK_SIZE;

            const slice = file.slice(
              start,
              start + CHUNK_SIZE,
            );

            const bytes = new Uint8Array(
              await slice.arrayBuffer(),
            );

            /**
             * Hash EVERY chunk, including resumed chunks.
             */
            hasher.update(bytes);

            /**
             * Don't resend chunks receiver already has.
             */
            if (!alreadyReceived.has(idx)) {
              queues[idx % queues.length].push({
                index: idx,
                bytes,
              });
            }
          }
        } finally {
          queues.forEach((queue) => queue.close());
        }
      })();

      /**
       * One consumer per channel.
       */
      const consumers = channels.map(
        (channel, channelIdx) =>
          (async () => {
            const window = windows[channelIdx]!;

            for await (const {
              index,
              bytes,
            } of queues[channelIdx]) {
              if (cancelled) break;

              await waitForBufferSpace(
                channel,
                window.getWindow(),
                window.getLowWatermark(),
                cancelledPromise,
              );

              if (cancelled) break;

              await safeSend(
                channel,
                frameChunk(index, bytes),
              );

              bytesTransferredAllFiles +=
                bytes.byteLength;

              const r = rate.record(
                bytesTransferredAllFiles,
              );

              window.maybeAdjust(r);

              const remaining =
                totalBytesAllFiles -
                bytesTransferredAllFiles;

              callbacks.onProgress?.({
                bytesTransferred:
                  bytesTransferredAllFiles,
                totalBytes: totalBytesAllFiles,
                fileName: file.name,
                fileIndex,
                totalFiles: totalFilesReported,
                ratePerSec: r,
                etaSeconds:
                  r > 0
                    ? remaining / r
                    : Infinity,
                windowBytes: windows.reduce(
                  (sum, currentWindow) =>
                    sum +
                    currentWindow.getWindow(),
                  0,
                ),
              });
            }
          })(),
      );

      /**
       * Wait for producer and every channel consumer.
       */
      await Promise.all([
        producer,
        ...consumers,
      ]);

      if (cancelled) {
        throw new Error(cancelReason);
      }

      /**
       * Hash is now complete.
       */
      const sha256 = hasher.digestHex();

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
      callbacks.onAllComplete?.();
    }
  } catch (err) {
    const rawMessage =
      err instanceof Error
        ? err.message
        : "transfer failed";
    const message = toFriendlyError(rawMessage);

    /**
     * Best-effort cancellation notification — skip it if this cancellation
     * came FROM the receiver in the first place, no need to echo it back.
     */
    if (!cancelledByPeer) try {
      controlChannel.send(
        JSON.stringify({
          type: "CANCEL",
          reason: message,
        }),
      );
    } catch {
      // The channel may itself be broken.
    }

    callbacks.onError?.(message);
  } finally {
    if (onControlMessage) {
      controlChannel.removeEventListener(
        "message",
        onControlMessage,
      );
    }
  }
}

/**
 * Wait until the channel's buffered amount drops below
 * the adaptive low-watermark.
 */
function waitForBufferSpace(
  channel: TransferDataChannel,
  highWaterMark: number,
  lowWaterMark: number,
  cancelledPromise?: Promise<void>,
): Promise<void> {
  if (
    channel.bufferedAmount <=
    highWaterMark
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    channel.bufferedAmountLowThreshold =
      lowWaterMark;

    const onLow = () => {
      channel.removeEventListener(
        "bufferedamountlow",
        onLow,
      );

      resolve();
    };

    channel.addEventListener(
      "bufferedamountlow",
      onLow,
    );

    // Don't hang forever waiting for room if the transfer got cancelled
    // while we were blocked here.
    cancelledPromise?.then(() => {
      channel.removeEventListener(
        "bufferedamountlow",
        onLow,
      );

      resolve();
    });
  });
}

/**
 * Receiver side.
 */
export class FileReceiver {
  private currentMeta: FileMetadata | null =
    null;

  private chunks: (
    | Uint8Array
    | undefined
  )[] = [];

  private chunksReceived = 0;

  private bytesReceived = 0;

  private bytesReceivedAllFiles = 0;

  private totalBytesAllFiles = 0;

  private fileIndex = 0;

  private totalFiles = 1;

  private rate = new RateMeter();

  private readonly callbacks: TransferCallbacks;

  /**
   * Chunks which arrive before FILE_METADATA.
   *
   * This can happen in parallel mode when channel 1/2/3
   * delivers before channel 0.
   */
  private pendingChunks = new Map<number, Uint8Array>();

  /**
   * Channel 0 used for control replies.
   */
  private controlChannel:
    | TransferDataChannel
    | null = null;

  constructor(
    callbacks: TransferCallbacks,
    totalFiles = 1,
    totalBytesAllFiles = 0,
  ) {
    this.callbacks = callbacks;
    this.totalFiles = totalFiles;
    this.totalBytesAllFiles =
      totalBytesAllFiles;
  }

  /**
   * Set the channel used for control responses.
   */
  setControlChannel(
    channel: TransferDataChannel,
  ): void {
    this.controlChannel = channel;
  }

  /**
   * Best-effort notification to the sender that the receiver cancelled —
   * called from the UI's "Cancel receive" handler. Safe to call even if no
   * control channel is open yet (e.g. cancelled before connecting).
   */
  notifyCancel(reason: string): void {
    try {
      this.controlChannel?.send(
        JSON.stringify({ type: "CANCEL", reason }),
      );
    } catch {
      // Best effort only — the channel may already be gone.
    }
  }

  /**
   * Handle either JSON control data or binary chunks.
   */
  handleMessage(
    data: string | ArrayBuffer,
  ): void {
    /**
     * JSON/control message.
     */
    if (typeof data === "string") {
      const msg = parseControlMessage(data);

      if (!msg) {
        this.callbacks.onError?.(
          toFriendlyError("Invalid control message received."),
        );
        return;
      }

      /**
       * Batch information.
       */
      if (msg.type === "BATCH_INFO") {
        this.totalFiles = msg.totalFiles;
        this.totalBytesAllFiles = msg.totalBytes;

        return;
      }

      /**
       * File metadata.
       */
      if (msg.type === "FILE_METADATA") {
        const meta = msg.meta;

        /**
         * Same file announced again during resume.
         *
         * Do NOT reset existing chunks.
         */
        if (
          this.currentMeta?.fileId ===
          meta.fileId
        ) {
          return;
        }

        this.currentMeta = meta;

        this.chunks = new Array(
          meta.totalChunks,
        );

        this.chunksReceived = 0;

        this.bytesReceived = 0;

        /**
         * Absorb chunks that arrived before metadata.
         */
        for (const [
          index,
          bytes,
        ] of this.pendingChunks) {
          if (
            index < meta.totalChunks &&
            !this.chunks[index]
          ) {
            this.chunks[index] = bytes;

            this.chunksReceived++;

            this.bytesReceived +=
              bytes.byteLength;

            this.bytesReceivedAllFiles +=
              bytes.byteLength;
          }
        }

        this.pendingChunks.clear();

        this.callbacks.onMetadata?.(
          meta,
        );

        return;
      }

      /**
       * Resume query.
       */
      if (
        msg.type === "RESUME_QUERY"
      ) {
        const receivedIndexes =
          this.currentMeta?.fileId === msg.fileId
            ? this.chunks.reduce<number[]>(
                (acc, chunk, index) => {
                  if (chunk) {
                    acc.push(index);
                  }

                  return acc;
                },
                [],
              )
            : [];

        try {
          this.controlChannel?.send(
            JSON.stringify({
              type: "RESUME_STATUS",
              fileId: msg.fileId,
              receivedIndexes,
            }),
          );
        } catch {
          // Best effort only — the control channel may already be gone.
        }

        return;
      }

      /**
       * Sender cancellation.
       */
      if (msg.type === "CANCEL") {
        this.callbacks.onError?.(
          msg.reason ||
            "The sender cancelled the transfer.",
        );

        return;
      }

      /**
       * File finished.
       */
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
    const { index, bytes } =
      unframeChunk(data);

    /**
     * Metadata has not arrived yet.
     *
     * Preserve the chunk instead of losing it.
     */
    if (!this.currentMeta) {
      if (
        !this.pendingChunks.has(index)
      ) {
        this.pendingChunks.set(
          index,
          bytes,
        );
      }

      return;
    }

    /**
     * Ignore invalid indexes.
     */
    if (
      index >=
      this.currentMeta.totalChunks
    ) {
      this.callbacks.onError?.(
        toFriendlyError(
          `Invalid chunk index ${index} for file with ${this.currentMeta.totalChunks} chunks.`,
        ),
      );

      return;
    }

    /**
     * Store by index rather than arrival order.
     */
    if (!this.chunks[index]) {
      this.chunks[index] = bytes;

      this.chunksReceived++;

      this.bytesReceived +=
        bytes.byteLength;

      this.bytesReceivedAllFiles +=
        bytes.byteLength;
    }

    /**
     * Progress.
     */
    const r = this.rate.record(
      this.bytesReceivedAllFiles,
    );

    const total =
      this.totalBytesAllFiles ||
      this.currentMeta.size ||
      this.bytesReceived;

    const remaining =
      total -
      this.bytesReceivedAllFiles;

    this.callbacks.onProgress?.({
      bytesTransferred:
        this.bytesReceivedAllFiles,
      totalBytes: total,
      fileName:
        this.currentMeta.name,
      fileIndex: this.fileIndex,
      totalFiles: this.totalFiles,
      ratePerSec: r,
      etaSeconds:
        r > 0
          ? Math.max(
              0,
              remaining / r,
            )
          : Infinity,
    });
  }

  /**
   * Complete and verify the current file.
   */
  private async finishCurrentFile(
    sha256?: string,
  ): Promise<void> {
    if (!this.currentMeta) {
      return;
    }

    /**
     * TRANSFER_COMPLETE can arrive slightly before the final chunk(s),
     * especially in parallel mode where channels finish at slightly
     * different times, or on a slow/jittery link. A single fixed 500ms
     * wait was too short for that — it's exactly what made big transfers
     * look "stuck at 100%" on the receiver even though the sender had
     * already finished and the rest of the data was still in flight. Poll
     * instead of a one-shot wait, and give it a real window before giving
     * up.
     */
    const totalChunks = this.currentMeta.totalChunks;
    const COMPLETION_POLL_MS = 200;
    const COMPLETION_MAX_WAIT_MS = 8000;
    if (this.chunksReceived < totalChunks) {
      const deadline =
        performance.now() + COMPLETION_MAX_WAIT_MS;

      while (
        this.chunksReceived < totalChunks &&
        performance.now() < deadline
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, COMPLETION_POLL_MS),
        );
      }

      if (this.chunksReceived < totalChunks) {
        this.callbacks.onError?.(
          toFriendlyError(
            `Transfer incomplete: received ${this.chunksReceived}/${totalChunks} chunks.`,
          ),
        );

        return;
      }
    }

    /**
     * Make sure there are no holes.
     */
    for (
      let i = 0;
      i < this.currentMeta.totalChunks;
      i++
    ) {
      if (!this.chunks[i]) {
        this.callbacks.onError?.(
          toFriendlyError(
            `Transfer incomplete: missing chunk ${i}.`,
          ),
        );

        return;
      }
    }

    /**
     * All bytes are in. Reassembling + hashing a large file is not
     * instant — tell the UI so it can show "Verifying…" instead of
     * looking frozen at 100%.
     */
    this.callbacks.onVerifying?.(
      this.currentMeta.name,
    );

    /**
     * Reassemble in chunk-index order.
     */
    const blob = new Blob(
      this.chunks as BlobPart[],
      {
        type:
          this.currentMeta.mimeType ||
          "application/octet-stream",
      },
    );

    /**
     * Verify sender hash.
     */
    if (sha256) {
      const digest =
        await crypto.subtle.digest(
          "SHA-256",
          await blob.arrayBuffer(),
        );

      const hex = [
        ...new Uint8Array(digest),
      ]
        .map((byte) =>
          byte
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");

      if (hex !== sha256) {
        this.callbacks.onError?.(
          toFriendlyError(
            "HASH_MISMATCH: received file does not match sender's hash",
          ),
        );

        return;
      }
    }

    /**
     * Construct final File.
     */
    const file = new File(
      [blob],
      this.currentMeta.name,
      {
        type: blob.type,
      },
    );

    this.callbacks.onFileComplete?.(
      file,
    );

    this.fileIndex++;

    if (
      this.fileIndex >=
      this.totalFiles
    ) {
      this.callbacks.onAllComplete?.();
    }
  }
}

/**
 * Save a completed file to disk.
 *
 * Inside the Kimo desktop app this opens a native "Save As" dialog and
 * writes the file directly via Rust (see apps/desktop/src-tauri) instead
 * of relying on the browser's download manager. In a plain browser tab
 * (the Vercel-deployed web app) this is unchanged from before: the
 * classic `<a download>` click-simulation trick.
 */
export async function downloadFile(
  file: File,
): Promise<void> {
  const { saveFileNatively } = await import("../native/save");
  const savedNatively = await saveFileNatively(file);
  if (savedNatively) return;

  const url =
    URL.createObjectURL(file);

  const a =
    document.createElement("a");

  a.href = url;

  a.download = file.name;

  document.body.appendChild(a);

  a.click();

  a.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}