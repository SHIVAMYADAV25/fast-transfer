// "use client";

// import { useState } from "react";
// import QRCode from "qrcode";
// import { useEffect, useRef } from "react";

// interface CodeDisplayProps {
//   code: string;
//   browserLink: string;
// }

// export function CodeDisplay({ code, browserLink }: CodeDisplayProps) {
//   const [copied, setCopied] = useState<"code" | "link" | null>(null);
//   const [showQr, setShowQr] = useState(false);

//   const copy = async (text: string, which: "code" | "link") => {
//     await navigator.clipboard.writeText(text);
//     setCopied(which);
//     setTimeout(() => setCopied(null), 1500);
//   };

//   return (
//     <div className="space-y-2">
//       <div className="flex items-center justify-between gap-2">
//         <span className="text-xs text-muted">
//           Use this code: <span className="font-semibold text-ink">{code}</span>
//         </span>
//         <button
//           type="button"
//           onClick={() => copy(code, "code")}
//           className="flex h-8 w-8 shrink-0 items-center justify-center border border-line hover:border-ink"
//           aria-label="Copy code"
//         >
//           {copied === "code" ? <CheckIcon /> : <CopyIcon />}
//         </button>
//       </div>

//       <div>
//         <div className="mb-1 text-xs text-muted">Browser link</div>
//         <div className="flex">
//           <div className="flex-1 truncate border border-r-0 border-line bg-white px-3 py-2 text-xs text-muted">
//             {browserLink}
//           </div>
//           <button
//             type="button"
//             onClick={() => copy(browserLink, "link")}
//             className="flex items-center gap-1.5 border border-line px-3 py-2 text-xs font-medium hover:border-ink"
//           >
//             {copied === "link" ? <CheckIcon /> : <CopyIcon />} Copy
//           </button>
//         </div>
//       </div>

//       <button type="button" onClick={() => setShowQr((v) => !v)} className="btn-secondary border-line">
//         <QrIcon /> {showQr ? "Hide QR code" : "Show QR code"}
//       </button>

//       {showQr && <QrPanel value={browserLink} />}
//     </div>
//   );
// }

// function QrPanel({ value }: { value: string }) {
//   const canvasRef = useRef<HTMLCanvasElement>(null);

//   useEffect(() => {
//     if (canvasRef.current) {
//       QRCode.toCanvas(canvasRef.current, value, { width: 180, margin: 1 }).catch(() => {});
//     }
//   }, [value]);

//   return (
//     <div className="flex justify-center border border-line bg-white py-4">
//       <canvas ref={canvasRef} />
//     </div>
//   );
// }

// function CopyIcon() {
//   return (
//     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
//       <rect x="9" y="9" width="12" height="12" rx="1" />
//       <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
//     </svg>
//   );
// }

// function CheckIcon() {
//   return (
//     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
//       <path d="M20 6 9 17l-5-5" />
//     </svg>
//   );
// }

// function QrIcon() {
//   return (
//     <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
//       <rect x="3" y="3" width="7" height="7" />
//       <rect x="14" y="3" width="7" height="7" />
//       <rect x="3" y="14" width="7" height="7" />
//       <path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20v.01" />
//     </svg>
//   );
// }


"use client";

import { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";

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
    <div className="space-y-3 font-sans text-[#2c2c2e]">
      {/* Top Row: Code Box & Actions */}
      <div className="flex items-center justify-between text-xs sm:text-sm">
        <div className="flex items-center gap-2">
          <span className="text-[#272727] font-medium">Use this code:</span>
          <span className="rounded-md border border-dashed border-[#2b2b2b]/30 bg-transparent px-4 py-[6px] font-mono text-sm font-bold text-[#272727]">
            {code}
          </span>
          <button
            type="button"
            onClick={() => copy(code, "code")}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[#2b2b2b]/30 bg-transparent hover:bg-[#f0ece1] transition-colors"
            aria-label="Copy code"
          >
            {copied === "code" ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>

        {/* Send text instead - Underlined Link style as in image 2 */}
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-[#2c2c2e] hover:opacity-80 transition-opacity"
        >
          <SpeechBubbleIcon />
          <span className="underline underline-offset-2">Send text instead</span>
        </button>
      </div>

      {/* Browser Link Section */}
      <div>
        <div className="mb-2 mt-4 text-xs font-semibold text-[#272727] ">Browser link</div>
        <div className="flex items-center overflow-hidden rounded-md border border-[#050505]/30 bg-transparent">
          <div className="flex-1 truncate px-3 py-[10px] font-mono text-xs text-[#333333]">
            {browserLink}
          </div>
          <button
            type="button"
            onClick={() => copy(browserLink, "link")}
            className="flex items-center gap-1.5 border-l border-[#2b2b2b]/30 bg-[#f4f1ea]/60 px-3 py-2 text-xs font-medium text-[#050505] hover:bg-[#eadecc] transition-colors"
          >
            {copied === "link" ? <CheckIcon /> : <CopyIcon />}
            <span>Copy</span>
          </button>
        </div>
      </div>

      {/* QR Code Toggle Button */}
      <button
        type="button"
        onClick={() => setShowQr((v) => !v)}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-[#2b2b2b]/30 bg-transparent py-2.5 text-xs font-semibold text-[#050505] hover:bg-[#f0ece1] transition-colors"
      >
        <QrIcon />
        <span>{showQr ? "Hide QR code" : "Show QR code"}</span>
      </button>

      {showQr && <QrPanel value={browserLink} />}
    </div>
  );
}

function QrPanel({ value }: { value: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, value, { width: 150, margin: 1 }).catch(() => {});
    }
  }, [value]);

  return (
    <div className="flex justify-center rounded-xl border border-[#2b2b2b]/30 bg-[#fbf9f5] py-3">
      <canvas ref={canvasRef} />
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SpeechBubbleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function QrIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v3M14 20h3" />
    </svg>
  );
}