"use client";

/**
 * Where received bytes go.
 *
 * The receiver used to hold every chunk in an array for the whole transfer,
 * build a Blob from them, and then copy that Blob into one contiguous
 * ArrayBuffer to hash it — peak memory of roughly 2x the file size, which is
 * why anything past a couple of gigabytes killed the tab.
 *
 * A sink lets the receiver hand off each contiguous run of bytes the moment
 * it's complete and forget about it. Two implementations:
 *
 *   MemorySink  keeps chunks and produces a File at the end. This is the
 *               fallback for browsers without the File System Access API,
 *               and what the Node test environment uses.
 *
 *   DiskSink    writes straight through to a real file the person picked
 *               before the transfer started. Memory stays flat regardless of
 *               file size, and when the last byte lands the file is already
 *               on disk — nothing to assemble, nothing to download.
 *
 * Writes are always issued in order and awaited, so a sink never has to
 * handle seeking or gaps.
 */

export interface FileSinkResult {
  /** The assembled File, when the sink held the bytes in memory. */
  file: File | null;
  /** True when the bytes were written directly to their final destination. */
  savedToDisk: boolean;
}

export interface FileSink {
  write(bytes: Uint8Array): Promise<void> | void;
  finish(): Promise<FileSinkResult>;
  abort(): Promise<void> | void;
}

// ---------------------------------------------------------------------------

export class MemorySink implements FileSink {
  private parts: Uint8Array[] = [];

  constructor(
    private readonly name: string,
    private readonly mimeType: string,
  ) {}

  write(bytes: Uint8Array): void {
    this.parts.push(bytes);
  }

  async finish(): Promise<FileSinkResult> {
    const blob = new Blob(this.parts as BlobPart[], { type: this.mimeType });
    // Release our own references before constructing the File so the two
    // copies don't coexist any longer than they have to.
    this.parts = [];
    return {
      file: new File([blob], this.name, { type: this.mimeType }),
      savedToDisk: false,
    };
  }

  abort(): void {
    this.parts = [];
  }
}

// ---------------------------------------------------------------------------

/**
 * Minimal shape of the File System Access API pieces used here. Declared
 * locally rather than pulled from lib.dom so this module still typechecks
 * against TypeScript versions whose DOM lib predates the API.
 */
interface WritableFileStream {
  write(data: Uint8Array | ArrayBuffer): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface WritableFileHandle {
  name?: string;
  createWritable(options?: {
    keepExistingData?: boolean;
  }): Promise<WritableFileStream>;
}

export class DiskSink implements FileSink {
  private stream: WritableFileStream | null = null;

  constructor(private readonly handle: WritableFileHandle) {}

  private async ensureStream(): Promise<WritableFileStream> {
    if (!this.stream) {
      this.stream = await this.handle.createWritable({ keepExistingData: false });
    }
    return this.stream;
  }

  async write(bytes: Uint8Array): Promise<void> {
    const stream = await this.ensureStream();
    await stream.write(bytes);
  }

  async finish(): Promise<FileSinkResult> {
    const stream = await this.ensureStream();
    await stream.close();
    this.stream = null;
    return { file: null, savedToDisk: true };
  }

  async abort(): Promise<void> {
    if (!this.stream) return;
    const stream = this.stream;
    this.stream = null;
    try {
      if (stream.abort) await stream.abort();
      else await stream.close();
    } catch {
      /* the handle may already be gone */
    }
  }
}

// ---------------------------------------------------------------------------

/** True when this browser can write a received file straight to disk. */
export function supportsDiskSink(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { showSaveFilePicker?: unknown })
      .showSaveFilePicker === "function"
  );
}

/**
 * Ask the person where to put an incoming file. Must be called from a user
 * gesture — that's why the receive flow asks up front, before connecting,
 * rather than when the bytes arrive.
 *
 * Returns null if unsupported or if they dismissed the picker, in which case
 * the caller should fall back to a MemorySink.
 */
export async function pickSaveHandle(
  suggestedName: string,
): Promise<WritableFileHandle | null> {
  if (!supportsDiskSink()) return null;
  try {
    const picker = (
      window as unknown as {
        showSaveFilePicker: (opts: {
          suggestedName?: string;
        }) => Promise<WritableFileHandle>;
      }
    ).showSaveFilePicker;
    return await picker({ suggestedName });
  } catch {
    return null;
  }
}

/**
 * Factory handed to FileReceiver. Given the metadata for a file that's about
 * to arrive, decide where its bytes should go. Defaults to memory so every
 * existing caller keeps its current behaviour until it opts in.
 */
export type SinkFactory = (meta: {
  name: string;
  size: number;
  mimeType: string;
}) => FileSink | Promise<FileSink>;

export const memorySinkFactory: SinkFactory = (meta) =>
  new MemorySink(meta.name, meta.mimeType);