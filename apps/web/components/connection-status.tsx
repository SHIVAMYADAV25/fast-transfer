"use client";

import type { ConnectionType } from "@/lib/webrtc/stats";

interface ConnectionStatusProps {
  connectionType: ConnectionType;
  rttMs: number | null;
}

export function ConnectionStatus({ connectionType, rttMs }: ConnectionStatusProps) {
  const label =
    connectionType === "direct" ? "Direct P2P" : connectionType === "relayed" ? "Relayed" : "Connecting…";
  const dotColor =
    connectionType === "direct" ? "bg-accent" : connectionType === "relayed" ? "bg-warn" : "bg-muted";

  return (
    <div className="flex items-center justify-between border border-line px-3 py-2 text-[11px]">
      <span className="flex items-center gap-1.5 text-muted">
        <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
        Connection: <span className="font-medium text-ink">{label}</span>
      </span>
      <span className="text-muted">
        RTT: <span className="font-medium text-ink">{rttMs != null ? `${Math.round(rttMs)} ms` : "—"}</span>
      </span>
    </div>
  );
}
