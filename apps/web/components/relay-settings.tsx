"use client";

import { useState } from "react";
import type { TurnOverride } from "@/lib/webrtc/ice-config";

interface RelaySettingsProps {
  value: TurnOverride | null;
  onChange: (turn: TurnOverride | null) => void;
}

/**
 * Matches the "Relay settings ... ADVANCED" bar at the bottom of the
 * reference UI. This is a session-only override (not persisted) — mostly
 * useful for people self-hosting coturn (see /docs/turn-server.md) who want
 * to point this session at their own TURN server, or for testing the
 * relayed path deliberately.
 */
export function RelaySettings({ value, onChange }: RelaySettingsProps) {
  const [open, setOpen] = useState(false);
  const [urls, setUrls] = useState(value?.urls ?? "");
  const [username, setUsername] = useState(value?.username ?? "");
  const [credential, setCredential] = useState(value?.credential ?? "");

  const apply = () => {
    if (urls.trim() && username.trim() && credential.trim()) {
      onChange({ urls: urls.trim(), username: username.trim(), credential: credential.trim() });
    } else {
      onChange(null);
    }
  };

  const clear = () => {
    setUrls("");
    setUsername("");
    setCredential("");
    onChange(null);
  };

  return (
    <div className="border border-line bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-xs"
      >
        <span className="flex items-center gap-2 text-muted">
          <RelayIcon />
          Relay settings
          {value && <span className="text-[10px] font-medium text-accent">custom TURN active</span>}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          {open ? "Hide" : "Advanced"}
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-line px-4 py-3">
          <p className="text-[11px] text-muted">
            By default this app only uses STUN — direct P2P only, no relay fallback. If a transfer
            can&apos;t connect directly (symmetric NAT, strict firewall), point this session at your
            own TURN server. See <code className="text-[10px]">/docs/turn-server.md</code> for how to
            run one.
          </p>
          <Field label="TURN URL" value={urls} onChange={setUrls} placeholder="turn:turn.example.com:3478" />
          <Field label="Username" value={username} onChange={setUsername} placeholder="" />
          <Field label="Credential" value={credential} onChange={setCredential} placeholder="" type="password" />
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={apply} className="btn-primary flex-1 py-2 text-xs">
              Apply for this session
            </button>
            <button type="button" onClick={clear} className="btn-secondary flex-1 border-line py-2 text-xs">
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-field !py-2 text-xs"
      />
    </label>
  );
}

function RelayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M9 6h6a3 3 0 0 1 3 3v3M15 18H9a3 3 0 0 1-3-3v-3" />
    </svg>
  );
}
