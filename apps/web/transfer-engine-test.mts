/**
 * Focused tests for the behaviours introduced by the transfer-engine
 * rewrite. transfer-e2e-test.mts still covers the end-to-end flows; this
 * file covers the invariants that rewrite depends on, which nothing was
 * exercising before:
 *
 *   - the contiguous-prefix hasher gets the same answer as hashing the whole
 *     file at the end, including when every chunk arrives backwards
 *   - duplicate chunks are counted once, not twice
 *   - an unparseable control frame is survivable rather than fatal
 *   - RESUME_STATUS stays small on a file with tens of thousands of chunks
 *   - a sink that writes somewhere other than memory gets every byte, in
 *     order, exactly once
 *
 * Run with: npx tsx transfer-engine-test.mts
 */

import { createHash } from "node:crypto";

import {
  FileReceiver,
  sendFiles,
  type TransferDataChannel,
} from "./lib/webrtc/transfer.js";
import type { FileSink, FileSinkResult } from "./lib/webrtc/sink.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

type Listener = (event: MessageEvent) => void;

class MockDataChannel implements TransferDataChannel {
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  peer: MockDataChannel | null = null;
  maxMessageSize = 0;

  /** Collected instead of delivered when set, so tests can reorder. */
  capture: ((data: string | ArrayBuffer) => void) | null = null;

  private listeners: Record<string, Listener[]> = {
    message: [],
    bufferedamountlow: [],
  };

  addEventListener(type: string, cb: Listener): void {
    (this.listeners[type] ??= []).push(cb);
  }

  removeEventListener(type: string, cb: Listener): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== cb);
  }

  send(data: string | ArrayBuffer): void {
    const size =
      typeof data === "string"
        ? new TextEncoder().encode(data).byteLength
        : data.byteLength;

    this.bufferedAmount += size;

    queueMicrotask(() => {
      this.bufferedAmount = Math.max(0, this.bufferedAmount - size);
      if (this.bufferedAmount <= this.bufferedAmountLowThreshold) {
        this.listeners.bufferedamountlow?.forEach((cb) =>
          cb(new MessageEvent("bufferedamountlow")),
        );
      }
      if (this.capture && typeof data !== "string") {
        this.capture(data);
        return;
      }
      this.peer?.deliver(data);
    });
  }

  deliver(data: string | ArrayBuffer): void {
    this.listeners.message?.forEach((cb) =>
      cb(new MessageEvent("message", { data })),
    );
  }
}

function makeChannelPair(): [MockDataChannel, MockDataChannel] {
  const a = new MockDataChannel();
  const b = new MockDataChannel();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

let failed = false;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    failed = true;
    console.log(
      `❌ ${name}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function makeFile(name: string, size: number): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) % 251;
  return new File([bytes], name, { type: "application/octet-stream" });
}

async function sha256Hex(file: File): Promise<string> {
  const hash = createHash("sha256");
  hash.update(Buffer.from(await file.arrayBuffer()));
  return hash.digest("hex");
}

/** Records every write in arrival order so ordering can be asserted. */
class RecordingSink implements FileSink {
  parts: Uint8Array[] = [];
  finished = false;
  aborted = false;

  write(bytes: Uint8Array): void {
    this.parts.push(bytes.slice());
  }

  async finish(): Promise<FileSinkResult> {
    this.finished = true;
    return { file: null, savedToDisk: true };
  }

  abort(): void {
    this.aborted = true;
  }

  concat(): Uint8Array {
    const total = this.parts.reduce((n, p) => n + p.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------

await test(
  "chunks delivered in reverse order still hash and assemble correctly",
  async () => {
    const [senderCh, receiverCh] = makeChannelPair();

    const original = makeFile("reversed.bin", 400_000);

    let received: File | null = null;
    let errored: string | null = null;

    const receiver = new FileReceiver({
      onFileComplete: (file) => {
        received = file;
      },
      onError: (message) => {
        errored = message;
      },
    });
    receiver.setControlChannel(receiverCh);

    // Hold every binary frame, then hand them over newest-first once the
    // sender is done. This is the worst case for a prefix hasher: nothing
    // can be consumed until the very first chunk finally arrives.
    const heldChunks: ArrayBuffer[] = [];
    senderCh.capture = (data) => {
      if (typeof data !== "string") heldChunks.push(data);
    };

    const controlBacklog: string[] = [];
    receiverCh.addEventListener("message", () => {});
    senderCh.peer = {
      deliver: (data: string | ArrayBuffer) => {
        if (typeof data === "string") {
          // TRANSFER_COMPLETE must not be processed before the chunks, so
          // hold it back with the rest and replay in order below.
          const parsed = JSON.parse(data) as { type: string };
          if (parsed.type === "TRANSFER_COMPLETE") {
            controlBacklog.push(data);
            return;
          }
          receiver.handleMessage(data);
        }
      },
    } as unknown as MockDataChannel;

    await sendFiles([senderCh], [original], {
      onError: (message) => {
        errored = message;
      },
    });

    assert(errored === null, `sender errored: ${errored}`);
    assert(heldChunks.length > 1, "expected a multi-chunk file");

    for (let i = heldChunks.length - 1; i >= 0; i--) {
      receiver.handleMessage(heldChunks[i]);
    }
    for (const message of controlBacklog) {
      receiver.handleMessage(message);
    }

    // finishCurrentFile is async (it awaits the write chain and the digest).
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert(errored === null, `receiver errored: ${errored}`);
    assert(received !== null, "no file was produced");
    assert(
      (await sha256Hex(received!)) === (await sha256Hex(original)),
      "reassembled file does not match the original",
    );
  },
);

await test("duplicate chunks are ignored, not double-counted", async () => {
  const [, receiverCh] = makeChannelPair();

  const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

  const frame = (index: number, bytes: Uint8Array) => {
    const buf = new ArrayBuffer(4 + bytes.byteLength);
    new DataView(buf).setUint32(0, index);
    new Uint8Array(buf, 4).set(bytes);
    return buf;
  };

  const sink = new RecordingSink();
  let lastProgressBytes = 0;

  const receiver = new FileReceiver(
    {
      onProgress: (p) => {
        lastProgressBytes = p.bytesTransferred;
      },
    },
    1,
    payload.byteLength * 2,
    () => sink,
  );
  receiver.setControlChannel(receiverCh);

  receiver.handleMessage(
    JSON.stringify({
      type: "FILE_METADATA",
      meta: {
        fileId: "dup-1",
        name: "dup.bin",
        size: payload.byteLength * 2,
        chunkSize: payload.byteLength,
        totalChunks: 2,
      },
    }),
  );

  receiver.handleMessage(frame(0, payload));
  receiver.handleMessage(frame(0, payload)); // exact duplicate
  receiver.handleMessage(frame(1, payload));
  receiver.handleMessage(frame(1, payload)); // exact duplicate

  await new Promise((resolve) => setTimeout(resolve, 250));

  assert(
    sink.parts.length === 2,
    `sink received ${sink.parts.length} writes, expected 2`,
  );
  assert(
    lastProgressBytes === payload.byteLength * 2,
    `progress counted ${lastProgressBytes} bytes, expected ${payload.byteLength * 2}`,
  );
});

await test(
  "an unparseable control frame does not end the transfer",
  async () => {
    const [senderCh, receiverCh] = makeChannelPair();

    const original = makeFile("resilient.bin", 120_000);

    let received: File | null = null;
    const errors: string[] = [];

    const receiver = new FileReceiver({
      onFileComplete: (file) => {
        received = file;
      },
      onError: (message) => errors.push(message),
    });
    receiver.setControlChannel(receiverCh);

    receiverCh.addEventListener("message", (event) => {
      receiver.handleMessage(event.data as string | ArrayBuffer);
    });

    // Garbage arriving mid-stream, from both directions.
    receiver.handleMessage("{not json at all");
    receiver.handleMessage(JSON.stringify({ type: "SOMETHING_NEW", v: 2 }));
    senderCh.deliver("}{");

    await sendFiles([senderCh], [original], {
      onError: (message) => errors.push(message),
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    assert(errors.length === 0, `unexpected errors: ${errors.join(", ")}`);
    assert(received !== null, "transfer did not complete");
    assert(
      (await sha256Hex(received!)) === (await sha256Hex(original)),
      "file did not survive the malformed frames",
    );
  },
);

await test(
  "RESUME_STATUS stays small for a file with 40,000 chunks",
  async () => {
    const [, receiverCh] = makeChannelPair();

    const receiver = new FileReceiver({});
    receiver.setControlChannel(receiverCh);

    const totalChunks = 40_000;
    const chunkSize = 256 * 1024;

    receiver.handleMessage(
      JSON.stringify({
        type: "FILE_METADATA",
        meta: {
          fileId: "big-1",
          name: "big.bin",
          size: totalChunks * chunkSize,
          chunkSize,
          totalChunks,
        },
      }),
    );

    // Pretend a long contiguous prefix has landed by driving the receiver's
    // own accounting through real (tiny) frames.
    const tiny = new Uint8Array(4);
    const frame = (index: number) => {
      const buf = new ArrayBuffer(4 + tiny.byteLength);
      new DataView(buf).setUint32(0, index);
      return buf;
    };
    for (let i = 0; i < 5000; i++) receiver.handleMessage(frame(i));

    let reply: string | null = null;
    receiverCh.send = (data) => {
      if (typeof data === "string") reply = data;
    };

    receiver.handleMessage(
      JSON.stringify({ type: "RESUME_QUERY", fileId: "big-1" }),
    );

    assert(reply !== null, "no RESUME_STATUS was sent");

    const parsed = JSON.parse(reply!) as {
      contiguousUpTo: number;
      receivedIndexes: number[];
    };

    assert(
      parsed.contiguousUpTo === 5000,
      `contiguousUpTo was ${parsed.contiguousUpTo}, expected 5000`,
    );
    assert(
      parsed.receivedIndexes.length === 0,
      "contiguous chunks should not be listed individually",
    );
    assert(
      reply!.length < 1024,
      `RESUME_STATUS was ${reply!.length} bytes — it must fit in one message`,
    );
  },
);

await test(
  "a non-memory sink receives every byte, in order, exactly once",
  async () => {
    const [senderCh, receiverCh] = makeChannelPair();

    const original = makeFile("streamed.bin", 700_000);
    const sink = new RecordingSink();

    let savedName: string | null = null;
    let errored: string | null = null;

    const receiver = new FileReceiver(
      {
        onFileSaved: (name) => {
          savedName = name;
        },
        onFileComplete: () => {
          errored = "onFileComplete should not fire for a disk sink";
        },
        onError: (message) => {
          errored = message;
        },
      },
      1,
      original.size,
      () => sink,
    );
    receiver.setControlChannel(receiverCh);

    receiverCh.addEventListener("message", (event) => {
      receiver.handleMessage(event.data as string | ArrayBuffer);
    });

    await sendFiles([senderCh], [original], {
      onError: (message) => {
        errored = message;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 150));

    assert(errored === null, `errored: ${errored}`);
    assert(sink.finished, "sink was never finished");
    assert(savedName === "streamed.bin", "onFileSaved did not fire");

    const written = sink.concat();
    const expected = new Uint8Array(await original.arrayBuffer());

    assert(
      written.byteLength === expected.byteLength,
      `sink got ${written.byteLength} bytes, expected ${expected.byteLength}`,
    );
    for (let i = 0; i < expected.length; i++) {
      if (written[i] !== expected[i]) {
        throw new Error(`sink bytes diverge at offset ${i}`);
      }
    }
  },
);

await test("a hash mismatch aborts the sink instead of finishing it", async () => {
  const [, receiverCh] = makeChannelPair();

  const payload = new Uint8Array([9, 9, 9, 9]);
  const sink = new RecordingSink();
  let errored: string | null = null;

  const receiver = new FileReceiver(
    {
      onError: (message) => {
        errored = message;
      },
    },
    1,
    payload.byteLength,
    () => sink,
  );
  receiver.setControlChannel(receiverCh);

  receiver.handleMessage(
    JSON.stringify({
      type: "FILE_METADATA",
      meta: {
        fileId: "bad-1",
        name: "bad.bin",
        size: payload.byteLength,
        chunkSize: payload.byteLength,
        totalChunks: 1,
      },
    }),
  );

  const buf = new ArrayBuffer(4 + payload.byteLength);
  new DataView(buf).setUint32(0, 0);
  new Uint8Array(buf, 4).set(payload);
  receiver.handleMessage(buf);

  receiver.handleMessage(
    JSON.stringify({
      type: "TRANSFER_COMPLETE",
      fileId: "bad-1",
      sha256: "0".repeat(64),
    }),
  );

  await new Promise((resolve) => setTimeout(resolve, 80));

  assert(errored !== null, "hash mismatch was not reported");
  assert(sink.aborted, "sink should have been aborted");
  assert(!sink.finished, "sink must not be finished on a mismatch");
});

// ---------------------------------------------------------------------------

if (failed) {
  console.log("\n❌ SOME TESTS FAILED");
  process.exit(1);
}

console.log("\n✅ ALL ENGINE TESTS PASSED");
