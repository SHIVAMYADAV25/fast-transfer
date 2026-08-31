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
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-xs">
        <span>
          {label} <span className="font-medium text-ink">{truncateName(fileName, 36)}</span>
        </span>
        <span className="text-muted">
          {formatBytes(bytesTransferred)} / {formatBytes(totalBytes)}
        </span>
      </div>

      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${Math.min(100, percent)}%` }} />
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted">
        <span>
          {fileIndex + 1}/{totalFiles} {truncateName(fileName, 40)}
        </span>
        <span>{percent.toFixed(0)}%</span>
      </div>

      <div className={`grid gap-2 ${windowBytes ? "grid-cols-3" : "grid-cols-2"}`}>
        <div className="stat-box">
          <div className="stat-label">Rate</div>
          <div className="stat-value">{formatRate(ratePerSec)}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">ETA</div>
          <div className="stat-value">{formatEta(etaSeconds)}</div>
        </div>
        {windowBytes && (
          <div className="stat-box">
            <div className="stat-label">Window</div>
            <div className="stat-value">{formatBytes(windowBytes)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
