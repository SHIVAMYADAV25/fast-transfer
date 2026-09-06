/**
 * End-to-end test for the REAL production sendFiles()/FileReceiver
 * implementation from lib/webrtc/transfer.ts.
 *
 * Runs entirely in Node with mock RTCDataChannels.
 *
 * Run:
 *
 *   npx tsx transfer-e2e-test.mts
 */

import {
  sendFiles,
  FileReceiver,
  resolveChunkSize,
  type TransferDataChannel,
} from "./lib/webrtc/transfer";

// ---------------------------------------------------------------------------
// Mock RTCDataChannel
// ---------------------------------------------------------------------------

type Listener = (event: MessageEvent) => void;

class MockDataChannel implements TransferDataChannel {
  bufferedAmount = 0;

  bufferedAmountLowThreshold = 0;

  peer: MockDataChannel | null = null;

  private listeners: Record<
    string,
    Listener[]
  > = {
    message: [],
    bufferedamountlow: [],
  };

  sentBytes = 0;

  sentMessages = 0;

  /**
   * Optional simulated network delay.
   */
  deliveryDelayMs: () => number = () => 0;

  /**
   * 0 = no artificial message-size limit.
   */
  maxMessageSize = 0;

  addEventListener(
    type: string,
    cb: Listener,
  ): void {
    (
      this.listeners[type] ??=
        []
    ).push(cb);
  }

  removeEventListener(
    type: string,
    cb: Listener,
  ): void {
    this.listeners[type] = (
      this.listeners[type] ?? []
    ).filter(
      (listener) =>
        listener !== cb,
    );
  }

  send(
    data: string | ArrayBuffer,
  ): void {
    const size =
      typeof data === "string"
        ? new TextEncoder().encode(data)
            .byteLength
        : data.byteLength;

    /**
     * Simulate the browser's RTCDataChannel
     * max-message-size restriction.
     */
    if (
      this.maxMessageSize > 0 &&
      size > this.maxMessageSize
    ) {
      throw new Error(
        "Failed to execute 'send' on 'RTCDataChannel': Trying to send message larger than max-message-size",
      );
    }

    this.sentBytes += size;

    this.sentMessages++;

    this.bufferedAmount += size;

    queueMicrotask(() => {
      /**
       * Simulate buffered data being consumed.
       */
      this.bufferedAmount = Math.max(
        0,
        this.bufferedAmount - size,
      );

      if (
        this.bufferedAmount <=
        this.bufferedAmountLowThreshold
      ) {
        this.listeners[
          "bufferedamountlow"
        ]?.forEach((cb) => {
          cb(
            new MessageEvent(
              "bufferedamountlow",
            ),
          );
        });
      }

      /**
       * Simulate network delivery.
       */
      const delay =
        this.deliveryDelayMs();

      if (delay > 0) {
        setTimeout(() => {
          this.peer?.deliver(data);
        }, delay);
      } else {
        this.peer?.deliver(data);
      }
    });
  }

  private deliver(
    data: string | ArrayBuffer,
  ): void {
    const event =
      new MessageEvent("message", {
        data,
      });

    this.listeners.message?.forEach(
      (cb) => cb(event),
    );
  }
}

function makeChannelPair(): [
  MockDataChannel,
  MockDataChannel,
] {
  const a =
    new MockDataChannel();

  const b =
    new MockDataChannel();

  a.peer = b;
  b.peer = a;

  return [a, b];
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let failed = false;

async function test(
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();

    console.log(
      `✅ ${name}`,
    );
  } catch (error) {
    failed = true;

    console.log(
      `❌ ${name}:`,
      error instanceof Error
        ? error.message
        : error,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeterministicFile(
  name: string,
  size: number,
): File {
  const bytes =
    new Uint8Array(size);

  for (
    let i = 0;
    i < size;
    i++
  ) {
    bytes[i] =
      (i * 2654435761 +
        name.length) %
      256;
  }

  return new File(
    [bytes],
    name,
    {
      type:
        "application/octet-stream",
    },
  );
}

async function fileBytesEqual(
  a: File,
  b: File,
): Promise<boolean> {
  if (a.size !== b.size) {
    return false;
  }

  const [ab, bb] =
    await Promise.all([
      a.arrayBuffer(),
      b.arrayBuffer(),
    ]);

  const au =
    new Uint8Array(ab);

  const bu =
    new Uint8Array(bb);

  for (
    let i = 0;
    i < au.length;
    i++
  ) {
    if (au[i] !== bu[i]) {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Test 1
// ---------------------------------------------------------------------------

await test(
  "single-connection small file transfers correctly",
  async () => {
    const [
      senderCh,
      receiverCh,
    ] = makeChannelPair();

    const original =
      makeDeterministicFile(
        "hello.bin",
        50_000,
      );

    let received: File | null =
      null;

    let errored: string | null =
      null;

    const receiver =
      new FileReceiver(
        {
          onFileComplete: (
            file,
          ) => {
            received = file;
          },

          onError: (message) => {
            errored = message;
          },
        },
        1,
        original.size,
      );

    receiver.setControlChannel(
      receiverCh,
    );

    receiverCh.addEventListener(
      "message",
      (event) => {
        receiver.handleMessage(
          event.data,
        );
      },
    );

    await sendFiles(
      [senderCh],
      [original],
      {},
    );

    await new Promise(
      (resolve) =>
        setTimeout(resolve, 50),
    );

    if (errored) {
      throw new Error(
        `receiver reported error: ${errored}`,
      );
    }

    if (!received) {
      throw new Error(
        "receiver never completed the file",
      );
    }

    if (
      !(await fileBytesEqual(
        original,
        received,
      ))
    ) {
      throw new Error(
        "received bytes don't match original",
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Test 2
// ---------------------------------------------------------------------------

await test(
  "single-connection multi-chunk file transfers correctly",
  async () => {
    const [
      senderCh,
      receiverCh,
    ] = makeChannelPair();

    const size =
      256 * 1024 * 5 +
      12_345;

    const original =
      makeDeterministicFile(
        "bigfile.bin",
        size,
      );

    let received: File | null =
      null;

    let errored: string | null =
      null;

    const receiver =
      new FileReceiver(
        {
          onFileComplete: (
            file,
          ) => {
            received = file;
          },

          onError: (message) => {
            errored = message;
          },
        },
        1,
        original.size,
      );

    receiver.setControlChannel(
      receiverCh,
    );

    receiverCh.addEventListener(
      "message",
      (event) => {
        receiver.handleMessage(
          event.data,
        );
      },
    );

    await sendFiles(
      [senderCh],
      [original],
      {},
    );

    await new Promise(
      (resolve) =>
        setTimeout(resolve, 100),
    );

    if (errored) {
      throw new Error(
        `receiver reported error: ${errored}`,
      );
    }

    if (!received) {
      throw new Error(
        "receiver never completed the file",
      );
    }

    if (
      !(await fileBytesEqual(
        original,
        received,
      ))
    ) {
      throw new Error(
        "received bytes don't match original",
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Test 3
// ---------------------------------------------------------------------------

await test(
  "4-channel parallel transfer reassembles correctly despite out-of-order delivery",
  async () => {
    const NUM_CHANNELS = 4;

    const pairs =
      Array.from(
        {
          length:
            NUM_CHANNELS,
        },
        () =>
          makeChannelPair(),
      );

    const senderChannels =
      pairs.map(
        (pair) => pair[0],
      );

    const receiverChannels =
      pairs.map(
        (pair) => pair[1],
      );

    const size =
      256 * 1024 * 17 +
      777;

    const original =
      makeDeterministicFile(
        "parallel.bin",
        size,
      );

    let received: File | null =
      null;

    let errored: string | null =
      null;

    const receiver =
      new FileReceiver(
        {
          onFileComplete: (
            file,
          ) => {
            received = file;
          },

          onError: (message) => {
            errored = message;
          },
        },
        1,
        original.size,
      );

    receiver.setControlChannel(
      receiverChannels[0],
    );

    receiverChannels.forEach(
      (channel) => {
        channel.addEventListener(
          "message",
          (event) => {
            receiver.handleMessage(
              event.data,
            );
          },
        );
      },
    );

    /**
     * Random network jitter.
     */
    for (const channel of senderChannels) {
      channel.deliveryDelayMs =
        () =>
          Math.floor(
            Math.random() * 5,
          );
    }

    /**
     * Make channel 0 deliberately slower.
     *
     * This stresses the pre-metadata buffering
     * logic inside FileReceiver.
     */
    senderChannels[0].deliveryDelayMs =
      () =>
        15 +
        Math.floor(
          Math.random() * 10,
        );

    await sendFiles(
      senderChannels,
      [original],
      {},
    );

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          800,
        ),
    );

    if (errored) {
      throw new Error(
        `receiver reported error: ${errored}`,
      );
    }

    if (!received) {
      throw new Error(
        "receiver never completed the file",
      );
    }

    if (
      !(await fileBytesEqual(
        original,
        received,
      ))
    ) {
      throw new Error(
        "received bytes don't match original — chunk reassembly bug",
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Test 4
// ---------------------------------------------------------------------------

await test(
  "resume skips chunks the receiver already has",
  async () => {
    const [
      senderCh,
      receiverCh,
    ] = makeChannelPair();

    const size =
      256 * 1024 * 4;

    const original =
      makeDeterministicFile(
        "resume.bin",
        size,
      );

    let received: File | null =
      null;

    let errored: string | null =
      null;

    const receiver =
      new FileReceiver(
        {
          onFileComplete: (
            file,
          ) => {
            received = file;
          },

          onError: (message) => {
            errored = message;
          },
        },
        1,
        original.size,
      );

    receiver.setControlChannel(
      receiverCh,
    );

    receiverCh.addEventListener(
      "message",
      (event) => {
        receiver.handleMessage(
          event.data,
        );
      },
    );

    const fileId =
      `f0-${original.name}-${original.size}`;

    /**
     * Simulate previous attempt's metadata.
     */
    receiver.handleMessage(
      JSON.stringify({
        type:
          "FILE_METADATA",

        meta: {
          fileId,
          name: original.name,
          size: original.size,
          chunkSize:
            256 * 1024,
          totalChunks: 4,
        },
      }),
    );

    /**
     * Simulate chunks 0 and 1 already received.
     */
    const buf =
      await original.arrayBuffer();

    for (const idx of [
      0,
      1,
    ]) {
      const start =
        idx * 256 * 1024;

      const chunk =
        new Uint8Array(
          buf.slice(
            start,
            start +
              256 * 1024,
          ),
        );

      const framed =
        new ArrayBuffer(
          4 +
            chunk.byteLength,
        );

      new DataView(
        framed,
      ).setUint32(
        0,
        idx,
      );

      new Uint8Array(
        framed,
        4,
      ).set(chunk);

      receiver.handleMessage(
        framed,
      );
    }

    /**
     * Count binary chunks sent by this attempt.
     */
    let chunksSentThisAttempt =
      0;

    const originalSend =
      senderCh.send.bind(
        senderCh,
      );

    senderCh.send = (
      data,
    ) => {
      if (
        data instanceof
        ArrayBuffer
      ) {
        chunksSentThisAttempt++;
      }

      originalSend(data);
    };

    await sendFiles(
      [senderCh],
      [original],
      {},
      undefined,
      300_000,
    );

    await new Promise(
      (resolve) =>
        setTimeout(resolve, 50),
    );

    if (errored) {
      throw new Error(
        `receiver reported error: ${errored}`,
      );
    }

    if (!received) {
      throw new Error(
        "receiver never completed the file",
      );
    }

    if (
      !(await fileBytesEqual(
        original,
        received,
      ))
    ) {
      throw new Error(
        "received bytes don't match original",
      );
    }

    if (
      chunksSentThisAttempt !== 2
    ) {
      throw new Error(
        `expected 2 chunks sent, got ${chunksSentThisAttempt}`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Test 5
// ---------------------------------------------------------------------------

await test(
  "corrupted data is detected via hash mismatch",
  async () => {
    const [
      senderCh,
      receiverCh,
    ] = makeChannelPair();

    const original =
      makeDeterministicFile(
        "corrupt-me.bin",
        10_000,
      );

    let received: File | null =
      null;

    let errorMsg: string | null =
      null;

    const receiver =
      new FileReceiver(
        {
          onFileComplete: (
            file,
          ) => {
            received = file;
          },

          onError: (message) => {
            errorMsg = message;
          },
        },
        1,
        original.size,
      );

    receiver.setControlChannel(
      receiverCh,
    );

    receiverCh.addEventListener(
      "message",
      (event) => {
        if (
          event.data instanceof
          ArrayBuffer
        ) {
          /**
           * Make a copy and corrupt one byte.
           */
          const corrupted =
            event.data.slice(0);

          /**
           * Only mutate when enough bytes exist.
           */
          if (
            corrupted.byteLength >
            10
          ) {
            new Uint8Array(
              corrupted,
            )[10] ^= 0xff;
          }

          receiver.handleMessage(
            corrupted,
          );
        } else {
          receiver.handleMessage(
            event.data,
          );
        }
      },
    );

    await sendFiles(
      [senderCh],
      [original],
      {},
    );

    await new Promise(
      (resolve) =>
        setTimeout(resolve, 100),
    );

    if (received) {
  throw new Error(
    "receiver accepted corrupted data",
  );
}

if (!errorMsg || !/integrity check/i.test(errorMsg)) {
  throw new Error(
    `expected integrity check error, got: ${errorMsg}`,
  );
}
  },
);

// ---------------------------------------------------------------------------
// Test 6
// ---------------------------------------------------------------------------

await test(
  "small negotiated max-message-size still transfers correctly",
  async () => {
    const [
      senderCh,
      receiverCh,
    ] = makeChannelPair();

    const NEGOTIATED_MAX_MESSAGE_SIZE =
      20_000;

    senderCh.maxMessageSize =
      NEGOTIATED_MAX_MESSAGE_SIZE;

    const size = 500_000;

    const original =
      makeDeterministicFile(
        "small-max-message.bin",
        size,
      );

    let received: File | null =
      null;

    let errored: string | null =
      null;

    const receiver =
      new FileReceiver(
        {
          onFileComplete: (
            file,
          ) => {
            received = file;
          },

          onError: (message) => {
            errored = message;
          },
        },
        1,
        original.size,
      );

    receiver.setControlChannel(
      receiverCh,
    );

    receiverCh.addEventListener(
      "message",
      (event) => {
        receiver.handleMessage(
          event.data,
        );
      },
    );

    await sendFiles(
      [senderCh],
      [original],
      {},
      undefined,
      NEGOTIATED_MAX_MESSAGE_SIZE,
    );

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          100,
        ),
    );

    if (errored) {
      throw new Error(
        `receiver reported error: ${errored}`,
      );
    }

    if (!received) {
      throw new Error(
        "receiver never completed the file",
      );
    }

    if (
      !(await fileBytesEqual(
        original,
        received,
      ))
    ) {
      throw new Error(
        "received bytes don't match original",
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Test 7
// ---------------------------------------------------------------------------

await test(
  "sender error propagates to receiver via CANCEL",
  async () => {
    const [
      senderCh,
      receiverCh,
    ] = makeChannelPair();

    /**
     * Too small for a real data chunk.
     *
     * Still large enough for control messages.
     */
    senderCh.maxMessageSize = 500;

    const original =
      makeDeterministicFile(
        "will-fail.bin",
        50_000,
      );

    let receiverErrored:
      | string
      | null = null;

    const receiver =
      new FileReceiver(
        {
          onError: (message) => {
            receiverErrored =
              message;
          },
        },
        1,
        original.size,
      );

    receiver.setControlChannel(
      receiverCh,
    );

    receiverCh.addEventListener(
      "message",
      (event) => {
        receiver.handleMessage(
          event.data,
        );
      },
    );

    let senderErrored:
      | string
      | null = null;

    await sendFiles(
      [senderCh],
      [original],
      {
        onError: (message) => {
          senderErrored =
            message;
        },
      },
    );

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          100,
        ),
    );

    if (!senderErrored) {
      throw new Error(
        "expected sendFiles to report an error to the sender",
      );
    }

    if (!receiverErrored) {
      throw new Error(
        "receiver was never notified of sender failure",
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Test 8
// ---------------------------------------------------------------------------

await test(
  "resolveChunkSize never exceeds the real message limit",
  async () => {
    const validCases = [
      262_144,
      65_536,
      20_000,
      500,
      100,
      10,
      6,
    ];

    for (
      const limit of validCases
    ) {
      const result =
        resolveChunkSize(
          limit,
        );

      /**
       * Payload + 4-byte frame header
       * must fit within the limit.
       */
      if (
        result + 4 >
        limit
      ) {
        throw new Error(
          `resolveChunkSize(${limit}) returned ${result}; framed size ${result + 4} exceeds limit`,
        );
      }

      if (result <= 0) {
        throw new Error(
          `resolveChunkSize(${limit}) returned invalid size ${result}`,
        );
      }
    }

    /**
     * No possible payload can fit.
     */
    for (
      const limit of [
        4,
        3,
        1,
      ]
    ) {
      let threw = false;

      try {
        resolveChunkSize(
          limit,
        );
      } catch {
        threw = true;
      }

      if (!threw) {
        throw new Error(
          `resolveChunkSize(${limit}) should have thrown`,
        );
      }
    }
  },
);

// ---------------------------------------------------------------------------
// Test 9
// ---------------------------------------------------------------------------

await test(
  "sendFiles catches pathological resolveChunkSize errors via onError",
  async () => {
    const [senderCh] =
      makeChannelPair();

    const original =
      makeDeterministicFile(
        "impossible.bin",
        1000,
      );

    let caughtViaOnError:
      | string
      | null = null;

    /**
     * maxMessageSize = 3 is below the
     * 4-byte frame header.
     *
     * resolveChunkSize() throws.
     *
     * sendFiles() must catch it and report
     * through onError instead of rejecting.
     */
    await sendFiles(
      [senderCh],
      [original],
      {
        onError: (message) => {
          caughtViaOnError =
            message;
        },
      },
      undefined,
      3,
    );

    if (!caughtViaOnError) {
      throw new Error(
        "expected sendFiles to report the resolveChunkSize error via onError",
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Final result
// ---------------------------------------------------------------------------

if (failed) {
  console.log(
    "\n❌ SOME TESTS FAILED",
  );

  /**
   * Throwing at top-level gives tsx a non-zero exit
   * without requiring Node's `process` typings.
   */
  throw new Error(
    "Transfer E2E tests failed.",
  );
}

console.log(
  "\n✅ ALL TESTS PASSED",
);