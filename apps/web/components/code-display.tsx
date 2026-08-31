"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { useEffect, useRef } from "react";

interface CodeDisplayProps {
  code: string;
  browserLink: string;
}

export function CodeDisplay({ code, browserLink }: CodeDisplayProps) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [showQr, setShowQr] = useState(false);

  const copy = async (text: string, which: "code" | "link") => {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">
          Use this code: <span className="font-semibold text-ink">{code}</span>
        </span>
        <button
          type="button"
          onClick={() => copy(code, "code")}
          className="flex h-8 w-8 shrink-0 items-center justify-center border border-line hover:border-ink"
          aria-label="Copy code"
        >
          {copied === "code" ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>

      <div>
        <div className="mb-1 text-xs text-muted">Browser link</div>
        <div className="flex">
          <div className="flex-1 truncate border border-r-0 border-line bg-white px-3 py-2 text-xs text-muted">
            {browserLink}
          </div>
          <button
            type="button"
            onClick={() => copy(browserLink, "link")}
            className="flex items-center gap-1.5 border border-line px-3 py-2 text-xs font-medium hover:border-ink"
          >
            {copied === "link" ? <CheckIcon /> : <CopyIcon />} Copy
          </button>
        </div>
      </div>

      <button type="button" onClick={() => setShowQr((v) => !v)} className="btn-secondary border-line">
        <QrIcon /> {showQr ? "Hide QR code" : "Show QR code"}
      </button>

      {showQr && <QrPanel value={browserLink} />}
    </div>
  );
}

function QrPanel({ value }: { value: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, value, { width: 180, margin: 1 }).catch(() => {});
    }
  }, [value]);

  return (
    <div className="flex justify-center border border-line bg-white py-4">
      <canvas ref={canvasRef} />
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="9" y="9" width="12" height="12" rx="1" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function QrIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20v.01" />
    </svg>
  );
}
