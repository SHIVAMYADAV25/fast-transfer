"use client";

import type { FileMetadata } from "@fast-transfer/protocol";
import { AdaptiveWindowController } from "./adaptive";
import { createHasher } from "./hash";

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

export interface TransferCallbacks {
  onMetadata?: (meta: FileMetadata) => void;
  onProgress?: (progress: TransferProgress) => void;
  onFileComplete?: (file: File) => void;
  onFileFullySent?: (fileIndex: number) => void;
  onAllComplete?: () => void;
  onError?: (message: string) => void;
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
): Promise<void> {
  if (channels.length === 0) {
    throw new Error("sendFiles needs at least one open channel");
  }

  const rate = new RateMeter();

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
    channels[0].send(
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
        const msg = JSON.parse(event.data);

        if (msg.type === "RESUME_STATUS") {
          const resolver =
            pendingResumeReplies.get(msg.fileId);

          if (resolver) {
            resolver(msg.receivedIndexes ?? []);
            pendingResumeReplies.delete(msg.fileId);
          }
        }
      } catch {
        // Ignore malformed control messages.
      }
    };

    channels[0].addEventListener(
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

        channels[0].send(
          JSON.stringify({
            type: "RESUME_QUERY",
            fileId,
          }),
        );
      });
    };

    /**
     * Process files sequentially.
     */
    for (let i = 0; i < files.length; i++) {
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
      channels[0].send(
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
            const window = windows[channelIdx];

            for await (const {
              index,
              bytes,
            } of queues[channelIdx]) {
              await waitForBufferSpace(
                channel,
                window.getWindow(),
                window.getLowWatermark(),
              );

              channel.send(
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

      /**
       * Hash is now complete.
       */
      const sha256 = hasher.digestHex();

      channels[0].send(
        JSON.stringify({
          type: "TRANSFER_COMPLETE",
          fileId: meta.fileId,
          sha256,
        }),
      );

      callbacks.onFileFullySent?.(fileIndex);
    }

    callbacks.onAllComplete?.();
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "transfer failed";

    /**
     * Best-effort cancellation notification.
     */
    try {
      channels[0]?.send(
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
      channels[0].removeEventListener(
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
  private pendingChunks = new Map<
    number,
    Uint8Array
  >();

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
   * Handle either JSON control data or binary chunks.
   */
  handleMessage(
    data: string | ArrayBuffer,
  ): void {
    /**
     * JSON/control message.
     */
    if (typeof data === "string") {
      let msg: any;

      try {
        msg = JSON.parse(data);
      } catch {
        this.callbacks.onError?.(
          "Invalid control message received.",
        );
        return;
      }

      /**
       * Batch information.
       */
      if (msg.type === "BATCH_INFO") {
        this.totalFiles =
          msg.totalFiles;

        this.totalBytesAllFiles =
          msg.totalBytes;

        return;
      }

      /**
       * File metadata.
       */
      if (msg.type === "FILE_METADATA") {
        const meta =
          msg.meta as FileMetadata;

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
          this.currentMeta?.fileId ===
          msg.fileId
            ? this.chunks.reduce<
                number[]
              >(
                (acc, chunk, index) => {
                  if (chunk) {
                    acc.push(index);
                  }

                  return acc;
                },
                [],
              )
            : [];

        this.controlChannel?.send(
          JSON.stringify({
            type: "RESUME_STATUS",
            fileId: msg.fileId,
            receivedIndexes,
          }),
        );

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
      if (
        msg.type ===
        "TRANSFER_COMPLETE"
      ) {
        void this.finishCurrentFile(
          msg.sha256 as
            | string
            | undefined,
        );

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
        `Invalid chunk index ${index} for file with ${this.currentMeta.totalChunks} chunks.`,
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
     * TRANSFER_COMPLETE can arrive slightly before
     * the final parallel channel's data.
     */
    if (
      this.chunksReceived <
      this.currentMeta.totalChunks
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, 500),
      );

      if (
        this.chunksReceived <
        this.currentMeta.totalChunks
      ) {
        this.callbacks.onError?.(
          `Transfer incomplete: received ${this.chunksReceived}/${this.currentMeta.totalChunks} chunks.`,
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
          `Transfer incomplete: missing chunk ${i}.`,
        );

        return;
      }
    }

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
          "HASH_MISMATCH: received file does not match sender's hash",
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
 * Trigger a browser download.
 */
export function downloadFile(
  file: File,
): void {
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