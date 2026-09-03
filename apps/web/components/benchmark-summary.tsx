// "use client";

// import { formatBytes, formatRate } from "@/lib/format";
// import type { ConnectionType } from "@/lib/webrtc/stats";

// interface BenchmarkSummaryProps {
//   totalBytes: number;
//   durationSeconds: number;
//   avgBytesPerSec: number;
//   peakBytesPerSec: number;
//   connectionType: ConnectionType;
//   rttMs: number | null;
//   finalWindowBytes?: number;
// }

// export function BenchmarkSummary({
//   totalBytes,
//   durationSeconds,
//   avgBytesPerSec,
//   peakBytesPerSec,
//   connectionType,
//   rttMs,
//   finalWindowBytes,
// }: BenchmarkSummaryProps) {
//   // Efficiency = how close the average throughput got to the peak observed.
//   // This is a proxy for "% of usable bandwidth achieved" (PRD §27) — a true
//   // utilization figure needs a separate speed-test baseline for the sender's
//   // actual uplink, which the benchmark harness doesn't measure yet.
//   const efficiency = peakBytesPerSec > 0 ? (avgBytesPerSec / peakBytesPerSec) * 100 : 0;

//   return (
//     <div className="border border-ink bg-white">
//       <div className="border-b border-ink px-3 py-1.5 text-center text-[10px] font-bold uppercase tracking-widest">
//         Transfer Benchmark
//       </div>
//       <div className="space-y-1.5 p-3 text-[11px]">
//         <Row label="Size" value={formatBytes(totalBytes)} />
//         <Row label="Time" value={`${durationSeconds.toFixed(1)} s`} />
//         <Row label="Average" value={`${formatRate(avgBytesPerSec)}  (${toMbps(avgBytesPerSec)} Mbps)`} />
//         <Row label="Peak" value={`${formatRate(peakBytesPerSec)}  (${toMbps(peakBytesPerSec)} Mbps)`} />
//         <Row label="Connection" value={connectionType === "direct" ? "Direct P2P" : connectionType === "relayed" ? "Relayed" : "—"} />
//         <Row label="RTT" value={rttMs != null ? `${Math.round(rttMs)} ms` : "—"} />
//         {finalWindowBytes && <Row label="Final window" value={formatBytes(finalWindowBytes)} />}
//         <div className="mt-1 flex items-center justify-between border-t border-line pt-1.5 font-semibold">
//           <span>Efficiency</span>
//           <span>{efficiency.toFixed(1)}%</span>
//         </div>
//       </div>
//     </div>
//   );
// }

// function toMbps(bytesPerSec: number): string {
//   return ((bytesPerSec * 8) / 1_000_000).toFixed(1);
// }

// function Row({ label, value }: { label: string; value: string }) {
//   return (
//     <div className="flex items-center justify-between text-muted">
//       <span>{label}</span>
//       <span className="font-medium text-ink">{value}</span>
//     </div>
//   );
// }


"use client";

import { formatBytes, formatRate } from "@/lib/format";
import type { ConnectionType } from "@/lib/webrtc/stats";

interface BenchmarkSummaryProps {
  totalBytes: number;
  durationSeconds: number;
  avgBytesPerSec: number;
  peakBytesPerSec: number;
  connectionType: ConnectionType;
  rttMs: number | null;
  finalWindowBytes?: number;
}

export function BenchmarkSummary({
  totalBytes,
  durationSeconds,
  avgBytesPerSec,
  peakBytesPerSec,
  connectionType,
  rttMs,
  finalWindowBytes,
}: BenchmarkSummaryProps) {
  const efficiency = peakBytesPerSec > 0 ? (avgBytesPerSec / peakBytesPerSec) * 100 : 0;

  return (
    <div className="relative w-full rounded-[12px] bg-transparent p-3 text-[#181818]">
      {/* Light, extra-curved pencil border */}
      <div 
        className="pointer-events-none absolute inset-0 rounded-[12px] border border-[#7a766c]" 
        style={{ filter: "url(#pencil-rough)" }} 
      />

      {/* Header with floating divider */}
      <div className="relative text-center text-[11px] font-bold uppercase tracking-wider text-[#222222]">
        TRANSFER BENCHMARK
        <div className="mx-2 mt-1.5 border-b border-[#a09c93]" />
      </div>

      {/* Compact Stats Body */}
      <div className="relative mt-2 space-y-1 text-[11px]">
        <Row label="Size" value={formatBytes(totalBytes)} />
        <Row label="Time" value={`${durationSeconds.toFixed(1)} s`} />
        <Row label="Average" value={`${formatRate(avgBytesPerSec)} (${toMbps(avgBytesPerSec)} Mbps)`} />
        <Row label="Peak" value={`${formatRate(peakBytesPerSec)} (${toMbps(peakBytesPerSec)} Mbps)`} />
        <Row
          label="Connection"
          value={connectionType === "direct" ? "Direct P2P" : connectionType === "relayed" ? "Relayed" : "—"}
        />
        <Row label="RTT" value={rttMs != null ? `${Math.round(rttMs)} ms` : "—"} />
        {finalWindowBytes !== undefined && (
          <Row label="Final window" value={formatBytes(finalWindowBytes)} />
        )}

        {/* Floating Divider & Efficiency */}
        <div className="mt-2">
          <div className="mx-2 mb-1.5 border-t border-[#b5b0a5]" />
          <div className="flex items-center justify-between font-bold text-[#111111]">
            <span>Efficiency</span>
            <span>{efficiency.toFixed(1)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function toMbps(bytesPerSec: number): string {
  return ((bytesPerSec * 8) / 1_000_000).toFixed(1);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between leading-tight">
      <span className="italic text-[#5d5a52]">{label}</span>
      <span className="font-semibold text-[#1a1a1a]">{value}</span>
    </div>
  );
}