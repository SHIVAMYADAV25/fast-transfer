"use client";

import { formatBytes, formatEta, formatRate, truncateName } from "@/lib/format";

interface TransferProgressProps {
  label: string; // "Sending" | "Receiving"
  fileName: string;
  bytesTransferred: number;
  totalBytes: number;
  percent: number;
  ratePerSec: number;
  etaSeconds: number;
  fileIndex: number;
  totalFiles: number;
  windowBytes?: number; // shown only on the sender side, where the adaptive window applies
}

export function TransferProgress({
  label,
  fileName,
  bytesTransferred,
  totalBytes,
  percent,
  ratePerSec,
  etaSeconds,
  fileIndex,
  totalFiles,
  windowBytes,
}: TransferProgressProps) {
  return (
    <div className="space-y-2 text-[#181818]">
      {/* File Label & Size Counter */}
      <div className="flex items-baseline justify-between text-xs font-medium">
        <span>
          {label} <span className="font-semibold text-[#101010]">{truncateName(fileName, 32)}</span>
        </span>
        <span className="text-[#625e55]">
          {formatBytes(bytesTransferred)} / {formatBytes(totalBytes)}
        </span>
      </div>

      {/* Sketched Progress Bar */}
      <div 
        className="relative h-2.5 w-full overflow-hidden rounded-[4px] border border-[#7a766c] bg-[#eae7df]"
        style={{ filter: "url(#pencil-rough)" }}
      >
        <div
          className="h-full bg-[#181818] transition-all duration-200 ease-out"
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>

      {/* Index & Percentage */}
      <div className="flex items-center justify-between text-[11px] font-medium text-[#625e55]">
        <span>
          {fileIndex + 1}/{totalFiles} {truncateName(fileName, 36)}
        </span>
        <span className="font-semibold text-[#101010]">{percent.toFixed(0)}%</span>
      </div>

      {/* Stat Boxes Grid (Rate, ETA, Window) */}
      <div className={`grid gap-2 ${windowBytes ? "grid-cols-3" : "grid-cols-2"}`}>
        <StatBox label="RATE" value={formatRate(ratePerSec)} />
        <StatBox label="ETA" value={formatEta(etaSeconds)} />
        {windowBytes !== undefined && (
          <StatBox label="WINDOW" value={formatBytes(windowBytes)} />
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="relative rounded-[6px] bg-[#f4f2eb]/70 p-2 text-left">
      {/* Outer hand-drawn pencil border */}
      <div
        className="pointer-events-none absolute inset-0 rounded-[6px] border border-[#a09c93]"
        style={{ filter: "url(#pencil-rough)" }}
      />
      
      {/* Label */}
      <div className="relative text-[10px] font-bold uppercase tracking-wider text-[#6e6a61]">
        {label}
      </div>

      {/* Value */}
      <div className="relative mt-0.5 text-sm font-bold text-[#101010] leading-tight">
        {value}
      </div>
    </div>
  );
}