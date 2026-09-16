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

/** True when this browser can write a received file straight to disk via a single-file picker. */
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
 * A folder the person picked once, that individual files get written into.
 *
 * A batch can be more than one file, and a save-file picker only ever
 * produces one destination — asking for a fresh one per file would mean a
 * native dialog for every file in the batch. A directory handle sidesteps
 * that: pick it once, before connecting, and each file gets its own entry
 * inside it as FILE_METADATA for it arrives.
 */
export interface WritableDirectoryHandle {
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<WritableFileHandle>;
}

/** True when this browser can write straight to a chosen folder. */
export function supportsDirectorySink(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { showDirectoryPicker?: unknown })
      .showDirectoryPicker === "function"
  );
}

/**
 * Ask the person for a destination folder. Must be called from a user
 * gesture, same as pickSaveHandle — the receive flow calls this as the
 * first thing it does, before checkRoom or connecting, so the click that
 * started the receive is still what triggers it.
 *
 * Returns null if unsupported or dismissed; callers fall back to memory.
 */
export async function pickSaveDirectory(): Promise<WritableDirectoryHandle | null> {
  if (!supportsDirectorySink()) return null;
  try {
    const picker = (
      window as unknown as {
        showDirectoryPicker: (opts: {
          mode?: "read" | "readwrite";
        }) => Promise<WritableDirectoryHandle>;
      }
    ).showDirectoryPicker;
    return await picker({ mode: "readwrite" });
  } catch {
    return null;
  }
}

/**
 * The sender's file name is attacker-controlled data, not a trusted path
 * component. The File System Access API itself already rejects names
 * containing "/" or "..", but that surfaces as a thrown error rather than a
 * safe file — sanitizing up front means a hostile or merely weird name
 * degrades to "still saves the file" instead of "fails the whole transfer".
 */
function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/]/g, "_")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, "")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 255) : "download";
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

/**
 * Build a SinkFactory that writes every file in the batch into `dir`.
 *
 * A per-file failure (a name the filesystem rejects, a permission that
 * lapsed mid-batch) falls back to a MemorySink for just that file rather
 * than aborting the transfer — the person still gets the file, just via a
 * download instead of straight to the folder they picked.
 */
export function directorySinkFactory(dir: WritableDirectoryHandle): SinkFactory {
  return async (meta) => {
    const name = sanitizeFileName(meta.name);
    try {
      const handle = await dir.getFileHandle(name, { create: true });
      return new DiskSink(handle);
    } catch {
      return new MemorySink(name, meta.mimeType);
    }
  };
}