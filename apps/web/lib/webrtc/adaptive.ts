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

const MIN_WINDOW = 1 * 1024 * 1024; // 1 MiB floor
const MAX_WINDOW = 64 * 1024 * 1024; // 64 MiB ceiling
const START_WINDOW = 4 * 1024 * 1024; // conservative starting point, per PRD §17 example

const GROW_FACTOR = 1.5;
const BACKOFF_FACTOR = 0.6;
const IMPROVEMENT_THRESHOLD = 0.08; // ignore noise under ~8% change
const SAMPLE_INTERVAL_MS = 2000; // don't react to every single chunk — too noisy

export interface WindowSample {
  windowBytes: number;
  ratePerSec: number;
  action: "probing-up" | "backing-off" | "holding" | "baseline";
}

export class AdaptiveWindowController {
  private windowBytes = START_WINDOW;
  private lastRate = 0;
  private lastSampleAt = 0;
  private settled = false;

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
