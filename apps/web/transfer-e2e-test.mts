/**
 * Runs the REAL production sendFiles()/FileReceiver from lib/webrtc/transfer.ts
 * end-to-end, wired together with mock RTCDataChannels, entirely in Node —
 * no browser needed. This is not a reimplementation-for-testing like the
 * earlier AsyncQueue check; it imports and exercises the actual exported
 * functions that ship to production.
 *
 * Run with: npx tsx transfer-e2e-test.ts
 */
import transferModule from "./lib/webrtc/transfer";
// tsx/Node's CJS<->ESM interop doesn't always statically detect named
// exports from an esbuild-compiled getter-based module — confirmed via a
// throwaway debug import that `transferModule.default` contains all three
// as getters. This is a tooling quirk in how the test runs, not a defect
// in the actual module (Next.js's own bundler resolves the named exports
// fine, as proven by every `next build` throughout this project).
const { sendFiles, FileReceiver } = transferModule as unknown as {
  sendFiles: typeof import("./lib/webrtc/transfer").sendFiles;
  FileReceiver: typeof import("./lib/webrtc/transfer").FileReceiver;
};

// ---------------------------------------------------------------------------
// Mock RTCDataChannel — implements exactly the surface sendFiles/FileReceiver
// actually use: send(), bufferedAmount, bufferedAmountLowThreshold, and the
// "message"/"bufferedamountlow" events. Delivery is async (queueMicrotask)
// to mimic a real channel not delivering synchronously, which is what
// exercises the backpressure/await paths for real instead of trivially.
// ---------------------------------------------------------------------------
type Listener = (...args: any[]) => void;

class MockDataChannel {
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  peer: MockDataChannel | null = null;
  private listeners: Record<string, Listener[]> = { message: [], bufferedamountlow: [] };
  sentBytes = 0;
  sentMessages = 0;
  /** Optional per-message delivery delay (ms) — for simulating genuine
   * out-of-order arrival across channels. Deliberately only affects when
   * the *peer* sees the message, not this channel's own bufferedAmount
   * bookkeeping (which must stay accurate for backpressure to mean
   * anything) — conflating the two was a real bug in an earlier version of
   * this test that produced a false failure, caught by cross-checking
   * against a no-jitter run before trusting the result.
   */
  deliveryDelayMs: () => number = () => 0;

  addEventListener(type: string, cb: Listener) {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener(type: string, cb: Listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== cb);
  }

  send(data: string | ArrayBuffer) {
    const size = typeof data === "string" ? data.length : data.byteLength;
    this.sentBytes += size;
    this.sentMessages++;
    this.bufferedAmount += size;
    queueMicrotask(() => {
      this.bufferedAmount = Math.max(0, this.bufferedAmount - size);
      if (this.bufferedAmount <= this.bufferedAmountLowThreshold) {
        this.listeners.bufferedamountlow?.forEach((cb) => cb());
      }
      const delay = this.deliveryDelayMs();
      if (delay > 0) setTimeout(() => this.peer?.deliver(data), delay);
      else this.peer?.deliver(data);
    });
  }

  private deliver(data: string | ArrayBuffer) {
    this.listeners.message?.forEach((cb) => cb({ data }));
  }
}

function makeChannelPair(): [MockDataChannel, MockDataChannel] {
  const a = new MockDataChannel();
  const b = new MockDataChannel();
  a.peer = b;
  b.peer = a;
  return [a, b];
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
let failed = false;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    failed = true;
    console.log(`❌ ${name}:`, e instanceof Error ? e.message : e);
  }
}

function makeDeterministicFile(name: string, size: number): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 2654435761 + name.length) % 256;
  return new File([bytes], name, { type: "application/octet-stream" });
}

async function fileBytesEqual(a: File, b: File): Promise<boolean> {
  if (a.size !== b.size) return false;
  const [ab, bb] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const au = new Uint8Array(ab);
  const bu = new Uint8Array(bb);
  for (let i = 0; i < au.length; i++) if (au[i] !== bu[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Test 1: single-connection, single small file
// ---------------------------------------------------------------------------
await test("single-connection small file transfers correctly", async () => {
  const [senderCh, receiverCh] = makeChannelPair();
  const original = makeDeterministicFile("hello.bin", 50_000); // smaller than one chunk

  const receiver = new FileReceiver({}, 1, original.size);
  receiver.setControlChannel(receiverCh);
  receiverCh.addEventListener("message", (e: MessageEvent) => receiver.handleMessage(e.data));

  let received: File | null = null;
  let errored: string | null = null;
  const receiverWithCallbacks = new FileReceiver(
    {
      onFileComplete: (f) => (received = f),
      onError: (msg) => (errored = msg),
    },
    1,
    original.size,
  );
  receiverWithCallbacks.setControlChannel(receiverCh);
  receiverCh.addEventListener("message", (e: MessageEvent) => receiverWithCallbacks.handleMessage(e.data));

  await sendFiles([senderCh], [original], {});
  // give queued microtasks a moment to fully settle
  await new Promise((r) => setTimeout(r, 50));

  if (errored) throw new Error(`receiver reported error: ${errored}`);
  if (!received) throw new Error("receiver never completed the file");
  if (!(await fileBytesEqual(original, received))) throw new Error("received bytes don't match original");
});

// ---------------------------------------------------------------------------
// Test 2: single-connection, multi-chunk file (exercises real chunk framing)
// ---------------------------------------------------------------------------
await test("single-connection multi-chunk file (non-aligned size) transfers correctly", async () => {
  const [senderCh, receiverCh] = makeChannelPair();
  // 256 KiB is the production CHUNK_SIZE — use a size that's several chunks
  // plus a partial final chunk, the case most likely to expose an off-by-one.
  const size = 256 * 1024 * 5 + 12345;
  const original = makeDeterministicFile("bigfile.bin", size);

  let received: File | null = null;
  let errored: string | null = null;
  const receiver = new FileReceiver(
    { onFileComplete: (f) => (received = f), onError: (msg) => (errored = msg) },
    1,
    original.size,
  );
  receiver.setControlChannel(receiverCh);
  receiverCh.addEventListener("message", (e: MessageEvent) => receiver.handleMessage(e.data));

  await sendFiles([senderCh], [original], {});
  await new Promise((r) => setTimeout(r, 100));

  if (errored) throw new Error(`receiver reported error: ${errored}`);
  if (!received) throw new Error("receiver never completed the file");
  if (!(await fileBytesEqual(original, received))) throw new Error("received bytes don't match original");
});

// ---------------------------------------------------------------------------
// Test 3: multi-connection (parallel mode) — the highest-risk untested path
// ---------------------------------------------------------------------------
await test("4-channel parallel transfer reassembles correctly despite out-of-order delivery", async () => {
  const NUM_CHANNELS = 4;
  const pairs = Array.from({ length: NUM_CHANNELS }, () => makeChannelPair());
  const senderChannels = pairs.map((p) => p[0]);
  const receiverChannels = pairs.map((p) => p[1]);

  const size = 256 * 1024 * 17 + 777; // odd size, doesn't divide evenly across 4 channels
  const original = makeDeterministicFile("parallel.bin", size);

  let received: File | null = null;
  let errored: string | null = null;
  const receiver = new FileReceiver(
    { onFileComplete: (f) => (received = f), onError: (msg) => (errored = msg) },
    1,
    original.size,
  );
  receiver.setControlChannel(receiverChannels[0]); // matches connectionIndex 0, same as production wiring
  receiverChannels.forEach((ch) => ch.addEventListener("message", (e: MessageEvent) => receiver.handleMessage(e.data)));

  // Deliberately vary each channel's simulated delivery timing — this is
  // what actually forces genuinely out-of-order arrival across channels
  // rather than all 4 happening to stay in lockstep (queueMicrotask alone
  // tends to preserve a fairly predictable interleaving). See
  // MockDataChannel.deliveryDelayMs's comment for why this only touches
  // delivery timing, not backpressure bookkeeping.
  for (const ch of senderChannels) {
    ch.deliveryDelayMs = () => Math.floor(Math.random() * 5);
  }
  // Extra stress, kept permanently rather than reverted: deliberately make
  // channel 0 (carries FILE_METADATA) the SLOWEST of the four. This is the
  // specific timing skew that exposed a real bug — FILE_METADATA arriving
  // after some data chunks had already arrived on faster channels, causing
  // FileReceiver to silently discard those early chunks when it reset its
  // chunk array upon finally processing the (late) metadata. Fixed by
  // buffering pre-metadata chunks instead of dropping them — see
  // FileReceiver's `pendingChunks` in transfer.ts. This exact stress
  // configuration reproduced that bug reliably (~50-60% of runs) before the
  // fix and 0/35+ runs after — keep it here so a regression gets caught
  // again if this logic ever changes.
  senderChannels[0].deliveryDelayMs = () => 15 + Math.floor(Math.random() * 10);

  await sendFiles(senderChannels, [original], {});
  // FileReceiver has its own internal 500ms grace period for straggling
  // chunks before it gives up (see finishCurrentFile) — this wait must
  // comfortably exceed that or the test catches things mid-grace-period
  // and reports a misleading "never completed" instead of the real outcome.
  await new Promise((r) => setTimeout(r, 800));

  if (errored) throw new Error(`receiver reported error: ${errored}`);
  if (!received) throw new Error("receiver never completed the file");
  if (!(await fileBytesEqual(original, received))) throw new Error("received bytes don't match original — chunk reassembly bug");
});

// ---------------------------------------------------------------------------
// Test 4: resume protocol — receiver already has some chunks (simulates the
// RESUME_QUERY/RESUME_STATUS handshake actually working end-to-end)
// ---------------------------------------------------------------------------
await test("resume: sender skips chunks the receiver already reports having", async () => {
  const [senderCh, receiverCh] = makeChannelPair();
  const size = 256 * 1024 * 4;
  const original = makeDeterministicFile("resume.bin", size);

  let received: File | null = null;
  let errored: string | null = null;
  const receiver = new FileReceiver(
    { onFileComplete: (f) => (received = f), onError: (msg) => (errored = msg) },
    1,
    original.size,
  );
  receiver.setControlChannel(receiverCh);
  receiverCh.addEventListener("message", (e: MessageEvent) => receiver.handleMessage(e.data));

  // First "attempt": send only half the file's worth of a fake prior state
  // by manually feeding the receiver FILE_METADATA + 2 of the 4 chunks
  // directly, simulating "a previous connection got this far before
  // dropping" — then run the REAL sendFiles() as the "resumed" attempt and
  // confirm it only sends what's missing.
  const fileId = `f0-${original.name}-${original.size}`;
  receiver.handleMessage(
    JSON.stringify({
      type: "FILE_METADATA",
      meta: { fileId, name: original.name, size: original.size, chunkSize: 256 * 1024, totalChunks: 4 },
    }),
  );
  const buf = await original.arrayBuffer();
  for (const idx of [0, 1]) {
    const start = idx * 256 * 1024;
    const chunk = new Uint8Array(buf.slice(start, start + 256 * 1024));
    const framed = new ArrayBuffer(4 + chunk.byteLength);
    new DataView(framed).setUint32(0, idx);
    new Uint8Array(framed, 4).set(chunk);
    receiver.handleMessage(framed);
  }

  let chunksSentThisAttempt = 0;
  const realSend = senderCh.send.bind(senderCh);
  senderCh.send = (data: string | ArrayBuffer) => {
    if (data instanceof ArrayBuffer) chunksSentThisAttempt++;
    realSend(data);
  };

  await sendFiles([senderCh], [original], {});
  await new Promise((r) => setTimeout(r, 50));

  if (errored) throw new Error(`receiver reported error: ${errored}`);
  if (!received) throw new Error("receiver never completed the file");
  if (!(await fileBytesEqual(original, received))) throw new Error("received bytes don't match original");
  // Should have sent only the 2 missing chunks, not all 4 — proves the
  // RESUME_QUERY/RESUME_STATUS round trip actually suppressed re-sending.
  if (chunksSentThisAttempt !== 2) {
    throw new Error(`expected 2 chunks sent (resume should skip 2 already-received), got ${chunksSentThisAttempt}`);
  }
});

// ---------------------------------------------------------------------------
// Test 5: hash mismatch is actually detected (negative test — corrupt one byte
// in transit and confirm the receiver rejects it instead of silently accepting)
// ---------------------------------------------------------------------------
await test("corrupted data is detected via hash mismatch, not silently accepted", async () => {
  const [senderCh, receiverCh] = makeChannelPair();
  const original = makeDeterministicFile("corrupt-me.bin", 10_000);

  let received: File | null = null;
  let errorMsg: string | null = null;
  const receiver = new FileReceiver(
    { onFileComplete: (f) => (received = f), onError: (msg) => (errorMsg = msg) },
    1,
    original.size,
  );
  receiver.setControlChannel(receiverCh);
  receiverCh.addEventListener("message", (e: MessageEvent) => {
    // Corrupt exactly one byte of any binary chunk in transit, simulating
    // real-world bit corruption the hash check exists to catch.
    if (e.data instanceof ArrayBuffer) {
      const corrupted = e.data.slice(0);
      new Uint8Array(corrupted)[10] ^= 0xff;
      receiver.handleMessage(corrupted);
    } else {
      receiver.handleMessage(e.data);
    }
  });

  await sendFiles([senderCh], [original], {});
  await new Promise((r) => setTimeout(r, 50));

  if (received) throw new Error("receiver accepted a corrupted file — hash check did not catch it!");
  if (!errorMsg || !errorMsg.includes("HASH_MISMATCH")) {
    throw new Error(`expected a HASH_MISMATCH error, got: ${errorMsg}`);
  }
});

console.log(failed ? "\n❌ SOME TESTS FAILED" : "\n✅ ALL TESTS PASSED");
process.exit(failed ? 1 : 0);
