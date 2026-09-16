/**
 * Incremental SHA-256, with the actual hashing pushed off the main thread.
 *
 * Web Crypto's crypto.subtle.digest() is one-shot: it needs the entire
 * buffer up front, which is what used to force a whole extra read + copy of
 * the file before anything could be verified. @noble/hashes gives us a real
 * streaming API instead.
 *
 * But streaming isn't enough on its own. SHA-256 in JS runs somewhere around
 * 150-400 MB/s, so on a fast link hashing alone can eat most of a core — the
 * same core that has to call RTCDataChannel.send() and run React. So the
 * default path here is a Worker:
 *
 *   hashFileInBackground(file)   sender: hand the worker the File and let it
 *                                read and hash independently of the send loop
 *   createStreamingHasher()      receiver: feed it the contiguous prefix as
 *                                it fills in, await the digest at the end
 *
 * Both fall back to synchronous main-thread hashing wherever Worker isn't
 * available (the Node e2e test environment, old WebViews). Same results,
 * just slower — never a correctness difference.
 */

import { sha256 } from "@noble/hashes/sha2";

export interface IncrementalHasher {
  update(bytes: Uint8Array): void;
  digestHex(): string;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/** Synchronous, main-thread. Kept for the fallback paths and for tests. */
export function createHasher(): IncrementalHasher {
  const hasher = sha256.create();
  return {
    update(bytes: Uint8Array) {
      hasher.update(bytes);
    },
    digestHex() {
      return toHex(hasher.digest());
    },
  };
}

// ---------------------------------------------------------------------------
// Worker plumbing
// ---------------------------------------------------------------------------

type WorkerResult =
  | { type: "result"; id: string; hex: string }
  | { type: "error"; id: string; message: string };

let workerInstance: Worker | null = null;
let workerUnavailable = false;

const pending = new Map<
  string,
  { resolve: (hex: string) => void; reject: (err: Error) => void }
>();

let nextId = 0;
const makeId = () => `h${nextId++}`;

/**
 * Lazily spin up the shared hash worker. Returns null — permanently, after
 * the first failure — if this environment can't run one.
 */
function getWorker(): Worker | null {
  if (workerInstance) return workerInstance;
  if (workerUnavailable) return null;

  if (typeof Worker === "undefined" || typeof URL === "undefined") {
    workerUnavailable = true;
    return null;
  }

  try {
    const worker = new Worker(new URL("./hash-worker.ts", import.meta.url), {
      type: "module",
    });

    worker.addEventListener("message", (event: MessageEvent<WorkerResult>) => {
      const msg = event.data;
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.type === "result") entry.resolve(msg.hex);
      else entry.reject(new Error(msg.message));
    });

    worker.addEventListener("error", () => {
      // Whatever is in flight can't be recovered — fail it and stop trying
      // to use the worker for anything new.
      const inFlight = [...pending.values()];
      pending.clear();
      workerInstance = null;
      workerUnavailable = true;
      inFlight.forEach((entry) => entry.reject(new Error("hash worker failed")));
    });

    workerInstance = worker;
    return worker;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

/** True when hashing will actually happen off the main thread. */
export function hasHashWorker(): boolean {
  return getWorker() != null;
}

// ---------------------------------------------------------------------------
// Sender side — hash a whole file in the background
// ---------------------------------------------------------------------------

/**
 * Start hashing `file` off-thread and return the digest promise.
 *
 * The Blob is structured-cloneable by reference, so posting it costs nothing
 * — the worker reads the same underlying data the send loop reads, in
 * parallel with it. On a link fast enough to be CPU-bound this is the
 * difference between hashing stealing send time and hashing being free.
 *
 * Returns null when no worker is available; callers must then hash inline.
 */
export function hashFileInBackground(file: Blob): Promise<string> | null {
  const worker = getWorker();
  if (!worker) return null;

  const id = makeId();
  const promise = new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });

  try {
    worker.postMessage({ type: "file", id, file });
  } catch {
    pending.delete(id);
    return null;
  }

  return promise;
}

// ---------------------------------------------------------------------------
// Receiver side — stream the contiguous prefix into a worker
// ---------------------------------------------------------------------------

export interface StreamingHasher {
  /** Feed the next contiguous run of bytes. */
  update(bytes: Uint8Array): void;
  /** Resolve the final digest. Safe to call exactly once. */
  digestHex(): Promise<string>;
  /** Give up on this hash and release worker state. */
  abort(): void;
}

/**
 * A hasher whose work happens in the worker when possible.
 *
 * Chunks are copied into the worker via structured clone rather than
 * transferred, because the receiver still needs the bytes to write them out.
 * A 256 KiB memcpy is roughly 25 microseconds; hashing the same 256 KiB on
 * the main thread is closer to a millisecond. The copy is the cheap option
 * by a wide margin.
 */
export function createStreamingHasher(): StreamingHasher {
  const worker = getWorker();

  if (!worker) {
    const fallback = createHasher();
    return {
      update: (bytes) => fallback.update(bytes),
      digestHex: async () => fallback.digestHex(),
      abort: () => {},
    };
  }

  const id = makeId();
  let aborted = false;
  worker.postMessage({ type: "open", id });

  return {
    update(bytes: Uint8Array) {
      if (aborted) return;
      worker.postMessage({ type: "update", id, bytes });
    },

    digestHex() {
      if (aborted) return Promise.reject(new Error("hash aborted"));
      const promise = new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      worker.postMessage({ type: "digest", id });
      return promise;
    },

    abort() {
      if (aborted) return;
      aborted = true;
      pending.delete(id);
      try {
        worker.postMessage({ type: "abort", id });
      } catch {
        /* worker already gone */
      }
    },
  };
}