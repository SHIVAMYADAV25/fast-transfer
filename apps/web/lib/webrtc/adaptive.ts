// apps/web/lib/webrtc/adaptive.ts
"use client";

/**
 * Adaptive sending window (PRD §17).
 *
 * The fixed HIGH_WATER_MARK in transfer.ts was a guess. This replaces it
 * with a simple hill-climbing probe: periodically compare current
 * throughput to the last sample.
 *
 *   - meaningfully faster  -> the window was the bottleneck, grow it
 *   - meaningfully slower  -> we overshot (buffer bloat / congestion), back off
 *   - roughly flat         -> we've found the plateau for this link, hold steady
 *
 * This is deliberately simple (not real congestion control — no loss
 * signal, no RTT-based BDP estimate). It's the "measure, then adjust"
 * loop the PRD describes, good enough to stop guessing a single constant
 * for every network. A proper CC algorithm is future work, not MVP scope.
 */

/**
 * Ceiling was originally 64 MiB, then cut to 4 MiB because a window that
 * large let the send loop fire far more `send()` calls than the browser's
 * internal SCTP send queue could hold, throwing "RTCDataChannel send queue
 * is full". That was the wrong fix for that problem: the queue-full error is
 * transient backpressure, not a sign the window itself is unsafe, and
 * transfer.ts's safeSend() now retries it with backoff instead of failing
 * the transfer. So the 4 MiB ceiling has been solving an already-solved
 * problem, while acting as a hard throughput cap everywhere else.
 *
 * Concretely: bandwidth-delay product at 1 Gbps with 100ms RTT is about
 * 12.5 MiB. With a 4 MiB ceiling, no amount of tuning gets a connection on
 * that kind of path past roughly 320 Mbps — the window physically cannot
 * hold enough in flight to fill the pipe. Raising the ceiling back up (with
 * safeSend covering the transient error) removes that artificial cap on
 * exactly the long-fat-pipe links where it mattered most.
 */
const MIN_WINDOW = 256 * 1024; // 256 KiB floor
const MAX_WINDOW = 32 * 1024 * 1024; // 32 MiB ceiling — bounds worst-case buffering, not throughput
const START_WINDOW = 512 * 1024; // cold-start default when no RTT sample is available

const GROW_FACTOR = 1.5;
const BACKOFF_FACTOR = 0.6;
const IMPROVEMENT_THRESHOLD = 0.08; // ignore noise under ~8% change
const SAMPLE_INTERVAL_MS = 2000; // don't react to every single chunk — too noisy

/**
 * Baseline throughput assumed when seeding the initial window from a
 * measured RTT (see estimateInitialWindow below). This is deliberately
 * conservative rather than a real bandwidth estimate — we have no way to
 * measure available bandwidth before sending anything — so it only matters
 * on higher-latency paths, where a cold 512 KiB start would otherwise take
 * several hill-climbing samples (each gated to one per SAMPLE_INTERVAL_MS)
 * before the window is anywhere near the path's real bandwidth-delay
 * product. On a low-latency LAN this assumption barely moves the seed at
 * all, which is correct: LAN throughput is bounded by the per-connection
 * SCTP ceiling (see ARCHITECTURE notes on transport), not by window size.
 */
const ASSUMED_BASELINE_BITS_PER_SEC = 100 * 1_000_000; // 100 Mbps

/**
 * Turn a one-shot RTT sample (see stats.ts's sampleRttMs) into a starting
 * window size. Returns the cold-start default when no sample is available —
 * this is always safe to call, including with null.
 */
export function estimateInitialWindow(rttMs: number | null): number {
  if (rttMs == null || !Number.isFinite(rttMs) || rttMs <= 0) {
    return START_WINDOW;
  }

  const bdpEstimate = (ASSUMED_BASELINE_BITS_PER_SEC / 8) * (rttMs / 1000);

  return Math.round(
    Math.min(MAX_WINDOW, Math.max(START_WINDOW, bdpEstimate)),
  );
}

export interface WindowSample {
  windowBytes: number;
  ratePerSec: number;
  action: "probing-up" | "backing-off" | "holding" | "baseline";
}

export class AdaptiveWindowController {
  private windowBytes: number;
  private lastRate = 0;
  private lastSampleAt = 0;
  private settled = false;

  /**
   * `initialWindowBytes` seeds the starting point — pass the result of
   * estimateInitialWindow(rttMs) when an RTT sample is available, or omit
   * it to start cold at START_WINDOW as before.
   */
  constructor(initialWindowBytes: number = START_WINDOW) {
    this.windowBytes = Math.min(
      MAX_WINDOW,
      Math.max(MIN_WINDOW, initialWindowBytes),
    );
  }

  getWindow(): number {
    return this.windowBytes;
  }

  /** Low watermark scales with the window so backpressure resume timing stays proportional. */
  getLowWatermark(): number {
    return Math.max(256 * 1024, this.windowBytes / 4);
  }

  /**
   * Call this often (e.g. on every progress tick) — internally throttles
   * itself to SAMPLE_INTERVAL_MS so it only actually adjusts every couple
   * of seconds, using whatever the current smoothed rate is at that moment.
   */
  maybeAdjust(currentRatePerSec: number): WindowSample {
    const now = performance.now();
    if (now - this.lastSampleAt < SAMPLE_INTERVAL_MS) {
      return { windowBytes: this.windowBytes, ratePerSec: currentRatePerSec, action: "holding" };
    }
    this.lastSampleAt = now;

    if (this.lastRate === 0 || currentRatePerSec === 0) {
      this.lastRate = currentRatePerSec;
      return { windowBytes: this.windowBytes, ratePerSec: currentRatePerSec, action: "baseline" };
    }

    const change = (currentRatePerSec - this.lastRate) / this.lastRate;
    let action: WindowSample["action"] = "holding";

    if (!this.settled && change > IMPROVEMENT_THRESHOLD) {
      this.windowBytes = Math.min(MAX_WINDOW, Math.round(this.windowBytes * GROW_FACTOR));
      action = "probing-up";
    } else if (change < -IMPROVEMENT_THRESHOLD) {
      this.windowBytes = Math.max(MIN_WINDOW, Math.round(this.windowBytes * BACKOFF_FACTOR));
      this.settled = true; // once we've backed off once, stop aggressively growing again
      action = "backing-off";
    } else if (!this.settled) {
      // Plateaued while still in the growth phase — we found the sweet spot.
      this.settled = true;
      action = "holding";
    }

    this.lastRate = currentRatePerSec;
    return { windowBytes: this.windowBytes, ratePerSec: currentRatePerSec, action };
  }
}