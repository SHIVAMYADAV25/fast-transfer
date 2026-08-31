"use client";

/**
 * Polls RTCPeerConnection.getStats() on an interval and extracts the numbers
 * that actually matter for judging transfer performance (PRD §10/§25):
 *   - which ICE candidate pair won (tells us direct P2P vs TURN-relayed)
 *   - round-trip time
 *   - bytes sent/received, differenced across polls into a throughput series
 *
 * This never touches file bytes — it only reads the browser's own WebRTC
 * telemetry. Safe to run continuously during a transfer.
 */

export type ConnectionType = "direct" | "relayed" | "unknown";

export interface StatsSnapshot {
  connectionType: ConnectionType;
  rttMs: number | null;
  localCandidateType: string | null;
  remoteCandidateType: string | null;
  bytesSent: number;
  bytesReceived: number;
  throughputBps: number; // instantaneous, based on delta since last poll
}

function candidateTypeToConnectionType(
  local: string | null,
  remote: string | null,
): ConnectionType {
  if (!local || !remote) return "unknown";
  if (local === "relay" || remote === "relay") return "relayed";
  return "direct";
}

export class StatsMonitor {
  private readonly getStats: () => Promise<RTCStatsReport>;
  private readonly onSample: (snapshot: StatsSnapshot) => void;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastBytes = 0;
  private lastSampleAt = 0;

  constructor(getStats: () => Promise<RTCStatsReport>, onSample: (s: StatsSnapshot) => void) {
    this.getStats = getStats;
    this.onSample = onSample;
  }

  start(intervalMs = 1000): void {
    this.stop();
    this.intervalId = setInterval(() => void this.poll(), intervalMs);
    void this.poll();
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
  }

  private async poll(): Promise<void> {
    let report: RTCStatsReport;
    try {
      report = await this.getStats();
    } catch {
      return;
    }

    let selectedPair: any = null;
    let localCandidate: any = null;
    let remoteCandidate: any = null;
    let bytesSent = 0;
    let bytesReceived = 0;

    report.forEach((stat: any) => {
      if (stat.type === "candidate-pair" && (stat.selected || stat.nominated) && stat.state === "succeeded") {
        selectedPair = stat;
      }
      if (stat.type === "transport" && stat.bytesSent != null) {
        bytesSent = Math.max(bytesSent, stat.bytesSent);
        bytesReceived = Math.max(bytesReceived, stat.bytesReceived ?? 0);
      }
      if (stat.type === "data-channel" && stat.bytesSent != null) {
        bytesSent = Math.max(bytesSent, stat.bytesSent);
        bytesReceived = Math.max(bytesReceived, stat.bytesReceived ?? 0);
      }
    });

    if (selectedPair) {
      report.forEach((stat: any) => {
        if (stat.id === selectedPair.localCandidateId) localCandidate = stat;
        if (stat.id === selectedPair.remoteCandidateId) remoteCandidate = stat;
      });
    }

    const totalBytes = bytesSent + bytesReceived;
    const now = performance.now();
    const elapsedSec = this.lastSampleAt ? (now - this.lastSampleAt) / 1000 : 0;
    const throughputBps =
      elapsedSec > 0 && this.lastBytes ? ((totalBytes - this.lastBytes) * 8) / elapsedSec : 0;
    this.lastBytes = totalBytes;
    this.lastSampleAt = now;

    const localType = localCandidate?.candidateType ?? null;
    const remoteType = remoteCandidate?.candidateType ?? null;

    this.onSample({
      connectionType: candidateTypeToConnectionType(localType, remoteType),
      rttMs: selectedPair?.currentRoundTripTime != null ? selectedPair.currentRoundTripTime * 1000 : null,
      localCandidateType: localType,
      remoteCandidateType: remoteType,
      bytesSent,
      bytesReceived,
      throughputBps: Math.max(0, throughputBps),
    });
  }
}
