"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileDropzone } from "@/components/file-dropzone";
import { CodeDisplay } from "@/components/code-display";
import { TransferProgress } from "@/components/transfer-progress";
import { createRoom, checkRoom, SignalingClient, waitForMessage } from "@/lib/signaling/client";
import { PeerConnection } from "@/lib/webrtc/peer";
import { sendFiles, FileReceiver, downloadFile, type TransferProgress as Progress } from "@/lib/webrtc/transfer";
import { StatsMonitor, type ConnectionType } from "@/lib/webrtc/stats";
import {
  establishParallelSenderConnections,
  establishParallelReceiverConnections,
  MAX_PARALLEL_CONNECTIONS,
  chooseConnectionCount,
} from "@/lib/webrtc/multi-peer";
import { ConnectionStatus } from "@/components/connection-status";
import { BenchmarkSummary } from "@/components/benchmark-summary";
import { RelaySettings } from "@/components/relay-settings";
import { getIceServers, type TurnOverride } from "@/lib/webrtc/ice-config";
import { uploadStored, fetchStoredStatus, fetchStoredManifest, downloadStoredFiles, revokeStored, type StoreUploadProgress, type StoreDownloadProgress } from "@/lib/store/storeclient";
import { deriveKeys, parseShareLink } from "@/lib/store/storecrypto";
import { STORED_TRANSFER_DEFAULT_TTL_MS } from "@fast-transfer/protocol";
import type { StoredManifest } from "@fast-transfer/protocol";
import { formatBytes } from "@/lib/format";

type SendPhase = "idle" | "waiting" | "connecting" | "sending" | "reconnecting" | "done" | "error";
type ReceivePhase = "idle" | "connecting" | "receiving" | "reconnecting" | "done" | "error";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://getfasttransfer.app";
const RECONNECT_BACKOFF_MS = [1000, 2000, 4000];

function waitForConfig(signaling: SignalingClient, fallback: number, timeoutMs: number): Promise<number> {
  return waitForMessage(
    signaling,
    "CONFIG",
    (msg) => (msg.payload as { connectionCount: number })?.connectionCount ?? fallback,
    fallback,
    timeoutMs,
  );
}

export default function HomePage() {
  const [turnOverride, setTurnOverride] = useState<TurnOverride | null>(null);

  return (
  <main className="relative min-h-screen w-full overflow-hidden  text-[#1a1a1a]">
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <img
          src="/handdrawn-bg.png"
          alt=""
          draggable={false}
          className="h-full w-full object-cover"
        />
      </div>
      <div className="mx-auto max-w-5xl z-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">
            fast-transfer<span className="text-muted">.</span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            Direct browser-to-browser file transfer. Encrypted end-to-end. Nothing touches our servers.
          </p>
        </header>

        <div className="grid gap-6 border-none bg-transparent p-0 sm:grid-cols-2">
          <div className=" border-none sm:border-b-0 sm:border-r">
            <SendPanel turnOverride={turnOverride} />
          </div>
          <div className=" border-0">
            <ReceivePanel turnOverride={turnOverride} />
          </div>
        </div>

        {/* <div className="mt-4">
          <RelaySettings value={turnOverride} onChange={setTurnOverride} />
        </div> */}

        <footer className="mt-4 flex items-center justify-between text-[11px] text-muted">
          <span>Signaling only. Files travel peer-to-peer via WebRTC.</span>
          <span>
            {turnOverride ? "Custom TURN configured for this session." : "STUN only — no relay fallback by default."}
          </span>
        </footer>
      </div>
    </main> 
  );
}

interface ModeTabsProps {
  storeMode: boolean;
  setStoreMode: (mode: boolean) => void;
  disabled?: boolean;
}

function PencilTextureCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // 1. Light off-white base paper layer
    ctx.fillStyle = "#dedcd5";
    ctx.fillRect(0, 0, w, h);

    // 2. Heavy diagonal pencil shading pass 1 (dark gray/black)
    ctx.strokeStyle = "#1e1e1e";
    for (let x = -h; x < w + h; x += 3.5) {
      ctx.lineWidth = 1.2 + Math.random() * 1.5;
      ctx.globalAlpha = 0.6 + Math.random() * 0.35;
      ctx.beginPath();
      ctx.moveTo(x + (Math.random() * 2 - 1), 0);
      ctx.lineTo(x + h * 1.1 + (Math.random() * 4 - 2), h);
      ctx.stroke();
    }

    // 3. Dense cross-hatching pass 2 (medium graphite)
    ctx.strokeStyle = "#383838";
    for (let x = -h; x < w + h; x += 4) {
      ctx.lineWidth = 1 + Math.random() * 1.2;
      ctx.globalAlpha = 0.4 + Math.random() * 0.3;
      ctx.beginPath();
      ctx.moveTo(x + h, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // 4. Dark smudge patches along the edges
    ctx.fillStyle = "#121212";
    for (let i = 0; i < 40; i++) {
      ctx.globalAlpha = 0.15 + Math.random() * 0.25;
      const rx = Math.random() * w;
      const ry = Math.random() < 0.5 ? Math.random() * 8 : h - Math.random() * 8;
      ctx.beginPath();
      ctx.arc(rx, ry, 3 + Math.random() * 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Hand-drawn outer border
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "#101010";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, h - 4, 6);
    ctx.stroke();

    // 6. Inner sketch outline
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.roundRect(5, 5, w - 10, h - 10, 4);
    ctx.stroke();

    // 7. Corner 'X' registration marks
    const drawX = (cx: number, cy: number) => {
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(cx - 3, cy - 3);
      ctx.lineTo(cx + 3, cy + 3);
      ctx.moveTo(cx + 3, cy - 3);
      ctx.lineTo(cx - 3, cy + 3);
      ctx.stroke();
    };
    drawX(10, 10);
    drawX(w - 10, 10);
    drawX(10, h - 10);
    drawX(w - 10, h - 10);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={240}
      height={40}
      className="absolute inset-0 h-full w-full rounded-[6px]"
    />
  );
}

export function ModeTabs({ storeMode, setStoreMode, disabled }: ModeTabsProps) {
  return (
    <div className="mb-3 w-full">
      {/* Rough edge displacement filter */}
      <svg className="absolute h-0 w-0" aria-hidden="true">
        <defs>
          <filter id="pencil-rough">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.08"
              numOctaves="2"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="1.8"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      {/* Segmented Outer Shell */}
      <div className="flex h-11 w-full overflow-hidden rounded-md border-2 border-[#dcdbdb] bg-transparent">
        {/* Direct Button */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setStoreMode(false)}
          className={`relative flex flex-1 items-center justify-center text-sm font-bold transition-all ${
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
          } ${!storeMode ? "text-white" : "text-[#101010] hover:bg-[#101010]/5"}`}
        >
          {!storeMode && (
            <div
              className="absolute inset-0 z-0 h-full w-full overflow-hidden"
              style={{ filter: "url(#pencil-rough)" }}
            >
              <PencilTextureCanvas />
            </div>
          )}
          <span
            className="relative z-10"
            style={
              !storeMode
                ? {
                    textShadow:
                      "1px 1px 2px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000",
                  }
                : undefined
            }
          >
            Direct
          </span>
        </button>

        {/* Store for 1 day Button */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setStoreMode(true)}
          className={`relative flex flex-1 items-center justify-center text-sm font-bold transition-all ${
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
          } ${storeMode ? "text-white" : "text-[#101010] hover:bg-[#101010]/5"}`}
        >
          {storeMode && (
            <div
              className="absolute inset-0 z-0 h-full w-full overflow-hidden"
              style={{ filter: "url(#pencil-rough)" }}
            >
              <PencilTextureCanvas />
            </div>
          )}
          <span
            className="relative z-10"
            style={
              storeMode
                ? {
                    textShadow:
                      "1px 1px 2px #000, -1px -1px 2px #000, 1px -1px 2px #000, -1px 1px 2px #000",
                  }
                : undefined
            }
          >
            Store for 1 day
          </span>
        </button>
      </div>
    </div>
  );
}

interface SketchedBackgroundProps {
  mode?: "light" | "dark" | "outline";
  className?: string;
}

export function SketchedBackground({ mode = "light", className = "" }: SketchedBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const w = (canvas.width = rect.width || 460);
    const h = (canvas.height = rect.height || 48);

    ctx.clearRect(0, 0, w, h);

    if (mode === "dark") {
      // Dark Active State
      ctx.fillStyle = "#121212";
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "#000000";
      for (let x = -h; x < w + h; x += 3) {
        ctx.lineWidth = 1.2 + Math.random();
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + h, h);
        ctx.stroke();
      }

      ctx.fillStyle = "#000000";
      for (let i = 0; i < 35; i++) {
        ctx.globalAlpha = 0.35;
        const rx = Math.random() * w;
        const ry = Math.random() * h;
        ctx.beginPath();
        ctx.arc(rx, ry, 3 + Math.random() * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (mode === "light") {
      // Idle State (Exact snippet provided)
      ctx.fillStyle = "#dedcd5";
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "#1e1e1e";
      for (let x = -h; x < w + h; x += 3.5) {
        ctx.lineWidth = 1.2 + Math.random() * 1.5;
        ctx.globalAlpha = 0.6 + Math.random() * 0.35;
        ctx.beginPath();
        ctx.moveTo(x + (Math.random() * 2 - 1), 0);
        ctx.lineTo(x + h * 1.1 + (Math.random() * 4 - 2), h);
        ctx.stroke();
      }

      ctx.strokeStyle = "#383838";
      for (let x = -h; x < w + h; x += 4) {
        ctx.lineWidth = 1 + Math.random() * 1.2;
        ctx.globalAlpha = 0.4 + Math.random() * 0.3;
        ctx.beginPath();
        ctx.moveTo(x + h, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      ctx.fillStyle = "#121212";
      for (let i = 0; i < 40; i++) {
        ctx.globalAlpha = 0.15 + Math.random() * 0.25;
        const rx = Math.random() * w;
        const ry = Math.random() < 0.5 ? Math.random() * 8 : h - Math.random() * 8;
        ctx.beginPath();
        ctx.arc(rx, ry, 3 + Math.random() * 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Outer & Inner borders
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "#101010";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, h - 4, 6);
    ctx.stroke();

    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.roundRect(5, 5, w - 10, h - 10, 4);
    ctx.stroke();

    // Registration Marks
    const drawX = (cx: number, cy: number) => {
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(cx - 3, cy - 3);
      ctx.lineTo(cx + 3, cy + 3);
      ctx.moveTo(cx + 3, cy - 3);
      ctx.lineTo(cx - 3, cy + 3);
      ctx.stroke();
    };
    drawX(10, 10);
    drawX(w - 10, 10);
    drawX(10, h - 10);
    drawX(w - 10, h - 10);
  }, [mode]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 h-full w-full pointer-events-none rounded-[6px] ${className}`}
    />
  );
}

// ---------------------------------------------------------------------------
// Send panel
// ---------------------------------------------------------------------------

function SendPanel({ turnOverride }: { turnOverride: TurnOverride | null }) {
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<SendPhase>("idle");
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parallelMode, setParallelMode] = useState(false);
  const [storeMode, setStoreMode] = useState(false);
  const [storePhase, setStorePhase] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [storeProgress, setStoreProgress] = useState<StoreUploadProgress | null>(null);
  const [storeResult, setStoreResult] = useState<{ shareUrl: string; revokeToken: string; id: string } | null>(
    null,
  );
  const [progress, setProgress] = useState<Progress | null>(null);
  const [connStats, setConnStats] = useState<{ type: ConnectionType; rttMs: number | null }>({
    type: "unknown",
    rttMs: null,
  });

  const signalingRef = useRef<SignalingClient | null>(null);
  const peersRef = useRef<PeerConnection[]>([]);
  const statsRef = useRef<StatsMonitor | null>(null);
  const timingRef = useRef<{ start: number; end: number; peakBps: number }>({
    start: 0,
    end: 0,
    peakBps: 0,
  });
  // Resume checkpoint: how far we got before a drop, so a reconnect can
  // continue with only the remaining files instead of restarting the batch
  // (PRD §21). bytesAlreadySent is an *estimate* used only for progress
  // display continuity — the chunk-level resume protocol in sendFiles is
  // what actually guarantees correctness, this just keeps the bar honest.
  const resumeRef = useRef<{
    remainingFiles: File[];
    bytesAlreadySent: number;
    totalFiles: number;
    totalBytes: number;
  } | null>(null);
  const reconnectAttemptRef = useRef(0);
  const terminalRef = useRef(false); // set once done/error, so a late connection-state event doesn't trigger a pointless reconnect

  const cleanup = useCallback(() => {
    statsRef.current?.stop();
    peersRef.current.forEach((p) => p.close());
    signalingRef.current?.close();
    statsRef.current = null;
    peersRef.current = [];
    signalingRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startSend = async () => {
    if (files.length === 0) return;
    setError(null);
    setPhase("waiting");
    reconnectAttemptRef.current = 0;
    terminalRef.current = false;
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    resumeRef.current = {
      remainingFiles: files,
      bytesAlreadySent: 0,
      totalFiles: files.length,
      totalBytes,
    };
    // Auto-scale connection count by size instead of relying only on the
    // manual checkbox — the checkbox still forces it on for small files.
    setParallelMode((prev) => prev || chooseConnectionCount(totalBytes) > 1);

    try {
      const room = await createRoom();
      setCode(room.code);

      let signaling = new SignalingClient(room.code, "sender");
      signalingRef.current = signaling;
      await signaling.connect();

      const attachTopLevelHandlers = (client: SignalingClient) => {
        client.onMessage((msg) => {
          if (msg.type === "PEER_JOINED") {
            void establishAndRun();
          }
          if (msg.type === "PEER_LEFT") {
            terminalRef.current = true;
            setError("The receiver disconnected.");
            setPhase("error");
          }
        });
      };

      const runTransfer = (channels: RTCDataChannel[], primaryPeer: PeerConnection) => {
        setPhase("sending");
        if (timingRef.current.start === 0) {
          timingRef.current = { start: performance.now(), end: 0, peakBps: 0 };
        }

        statsRef.current?.stop();
        const stats = new StatsMonitor(
          () => primaryPeer.getStats(),
          (s) => setConnStats({ type: s.connectionType, rttMs: s.rttMs }),
        );
        stats.start();
        statsRef.current = stats;

        const checkpoint = resumeRef.current!;
        // The real, per-connection negotiated SCTP limit — take the
        // minimum across every connection in use (parallel mode can have
        // more than one) so no single connection's chunk gets rejected.
        // This is the actual fix for "Trying to send message larger than
        // max-message-size" — see resolveChunkSize in transfer.ts.
        const maxMessageSize = peersRef.current.reduce<number | null>((min, p) => {
          const size = p.getMaxMessageSize();
          if (size == null) return min;
          return min == null ? size : Math.min(min, size);
        }, null);
        void sendFiles(
          channels,
          checkpoint.remainingFiles,
          {
            onProgress: (p) => {
              setProgress(p);
              timingRef.current.peakBps = Math.max(timingRef.current.peakBps, p.ratePerSec);
            },
            onFileFullySent: () => {
              // Drop the file that just finished — whatever's left is what
              // a reconnect would need to send.
              checkpoint.bytesAlreadySent += checkpoint.remainingFiles[0].size;
              checkpoint.remainingFiles = checkpoint.remainingFiles.slice(1);
            },
            onAllComplete: () => {
              terminalRef.current = true;
              timingRef.current.end = performance.now();
              setPhase("done");
            },
            onError: (msg) => {
              terminalRef.current = true;
              setError(msg);
              setPhase("error");
            },
          },
          {
            totalFiles: checkpoint.totalFiles,
            totalBytes: checkpoint.totalBytes,
            bytesAlreadySent: checkpoint.bytesAlreadySent,
          },
          maxMessageSize,
        );
      };

      const establishAndRun = async () => {
        setPhase("connecting");

        // Tell the receiver exactly how many RTCPeerConnections to expect,
        // so it doesn't have to eagerly open MAX_PARALLEL_CONNECTIONS and
        // prune the unused ones (see multi-peer.ts / README "Known
        // limitations" — this closes that gap).
        const connectionCount = parallelMode
          ? MAX_PARALLEL_CONNECTIONS
          : chooseConnectionCount(resumeRef.current!.totalBytes);
        signaling.send({
          type: "CONFIG",
          role: "sender",
          payload: { connectionCount },
        });

        const onConnectionStateChange = (state: RTCPeerConnectionState) => {
          if (state !== "failed" && state !== "disconnected") return;
          if (terminalRef.current) return; // already done/errored — nothing to resume
          const remaining = resumeRef.current?.remainingFiles.length ?? 0;
          if (remaining === 0) return; // already finished — nothing to resume
          void attemptReconnect();
        };

        if (connectionCount > 1) {
          const { peers, channels } = await establishParallelSenderConnections(
            signaling,
            connectionCount,
            { onConnectionStateChange },
            undefined,
            getIceServers(turnOverride),
          );
          peersRef.current = peers;
          if (channels.length === 0) {
            terminalRef.current = true;
            setError("Failed to establish any parallel connection.");
            setPhase("error");
            return;
          }
          runTransfer(channels, peers[0]);
        } else {
          const peer = new PeerConnection(
            "sender",
            signaling,
            {
              onDataChannelOpen: (channel) => runTransfer([channel], peer),
              onConnectionStateChange,
            },
            undefined,
            getIceServers(turnOverride),
          );
          peersRef.current = [peer];
          void peer.initiate();
        }
      };

      const attemptReconnect = async () => {
        if (reconnectAttemptRef.current >= RECONNECT_BACKOFF_MS.length) {
          terminalRef.current = true;
          setError("Connection lost and could not be re-established.");
          setPhase("error");
          return;
        }
        const delay = RECONNECT_BACKOFF_MS[reconnectAttemptRef.current];
        reconnectAttemptRef.current++;
        setPhase("reconnecting");
        statsRef.current?.stop();
        peersRef.current.forEach((p) => p.close());
        peersRef.current = [];
        await new Promise((r) => setTimeout(r, delay));

        // Full signaling-reconnect: if the WebSocket itself also dropped
        // (not just the RTCPeerConnection — a Wi-Fi hiccup or brief NAT
        // rebinding usually only kills the latter), rebuild it against the
        // same room. The room (and its code) outlives a single socket
        // disconnect on the Durable Object side — see room.ts — so this is
        // safe to retry as long as the room hasn't hit its own TTL.
        if (!signaling.isConnected()) {
          signaling.close();
          signaling = new SignalingClient(room.code, "sender");
          signalingRef.current = signaling;
          try {
            await signaling.connect();
          } catch {
            terminalRef.current = true;
            setError("Lost connection to the pairing server and could not reconnect.");
            setPhase("error");
            return;
          }
          attachTopLevelHandlers(signaling);
          // Don't call establishAndRun() directly here — the room's
          // Durable Object only sends PEER_JOINED once it can confirm the
          // receiver's socket is also present (room.ts's
          // handleWebSocketUpgrade). If the receiver is already connected,
          // that PEER_JOINED arrives immediately and attachTopLevelHandlers
          // (just re-registered above) picks it up and calls
          // establishAndRun for us. If the receiver is *also* mid-reconnect,
          // this just waits for their socket to show up — trying to
          // establish a WebRTC offer before the room can confirm a
          // receiver is listening would silently go nowhere.
          setPhase("waiting");
          return;
        }

        void establishAndRun();
      };

      attachTopLevelHandlers(signaling);
    } catch (err) {
      terminalRef.current = true;
      setError(err instanceof Error ? err.message : "Failed to start transfer");
      setPhase("error");
    }
  };

  const cancel = () => {
    cleanup();
    setPhase("idle");
    setCode(null);
    setProgress(null);
  };

  const startStoreSend = async () => {
    if (files.length === 0) return;
    setError(null);
    setStorePhase("uploading");
    setStoreResult(null);
    try {
      const result = await uploadStored(
        files,
        { maxDownloads: 1, ttlMs: STORED_TRANSFER_DEFAULT_TTL_MS, appUrl: APP_URL },
        (p) => setStoreProgress(p),
      );
      setStoreResult(result);
      setStorePhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload");
      setStorePhase("error");
    }
  };

  const revokeStoreSend = async () => {
    if (!storeResult) return;
    await revokeStored(storeResult.id, storeResult.revokeToken).catch(() => {});
    setStorePhase("idle");
    setStoreResult(null);
    setStoreProgress(null);
    setFiles([]);
  };

  const isLocked = phase !== "idle";
  const isStoreLocked = storePhase !== "idle";

  return (
    <div className="flex h-full flex-col">
<div className="mb-4 flex items-center gap-3">
  <IconBox>
    <UploadIcon />
  </IconBox>
  <div className="flex flex-col justify-center leading-snug mt-2">
    <h2 className="text-xl font-bold text-[#575656] leading-none [word-spacing:0.5rem] mb-2 ml-2">
      Send
    </h2>
    <p className="text-xs font-medium text-[#555555] leading-snug ml-2">
      Choose several files. Share one croc code.
    </p>
  </div>
</div>

      {/* Direct / Store tabs */}
      <ModeTabs
  storeMode={storeMode}
  setStoreMode={setStoreMode}
  disabled={isLocked || isStoreLocked}
/>

      {storeMode && (
        <p className="mb-3 text-[11px] text-muted">
          Encrypted on your device before upload. We only ever store ciphertext. Single download,
          expires in 24h, or revoke it early below.
        </p>
      )}

      <label className={`mb-4 flex items-center gap-2 text-[11px] text-muted ${storeMode ? "hidden" : ""}`}>
        <input
          type="checkbox"
          checked={parallelMode}
          disabled={isLocked}
          onChange={(e) => setParallelMode(e.target.checked)}
          className="h-3.5 w-3.5 accent-ink"
        />
        Parallel connections ({MAX_PARALLEL_CONNECTIONS}x, experimental) — benchmark this against
        Direct before trusting it on your network
      </label>

      <FileDropzone
        files={files}
        disabled={isLocked || isStoreLocked}
        onFilesSelected={setFiles}
        onRemoveFile={(i) => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
      />

      {!storeMode && (
        <>
          {code && phase !== "idle" && (
            <div className="mt-4">
              <CodeDisplay code={code} browserLink={`${APP_URL}/?code=${code}`} />
            </div>
          )}

          {phase === "waiting" && (
            <div className="mt-4">
              <p className="mb-2 text-xs text-muted">Waiting for recipient…</p>
              <IndeterminateBar />
            </div>
          )}

          {phase === "connecting" && (
            <div className="mt-4">
              <p className="mb-2 text-xs text-muted">Opening encrypted data channels…</p>
              <IndeterminateBar />
            </div>
          )}

          {phase === "sending" && progress && (
            <div className="mt-4 space-y-3">
              <ConnectionStatus connectionType={connStats.type} rttMs={connStats.rttMs} />
              <TransferProgress
                label="Sending"
                fileName={progress.fileName}
                bytesTransferred={progress.bytesTransferred}
                totalBytes={progress.totalBytes}
                percent={(progress.bytesTransferred / progress.totalBytes) * 100}
                ratePerSec={progress.ratePerSec}
                etaSeconds={progress.etaSeconds}
                fileIndex={progress.fileIndex}
                totalFiles={progress.totalFiles}
                windowBytes={progress.windowBytes}
              />
            </div>
          )}

          {phase === "reconnecting" && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-medium text-warn">
                Connection dropped — attempting to reconnect and resume…
              </p>
              <IndeterminateBar />
              {progress && (
                <p className="text-[11px] text-muted">
                  {formatBytes(progress.bytesTransferred)} of {formatBytes(progress.totalBytes)} already sent —
                  resuming from there, not from zero.
                </p>
              )}
            </div>
          )}

          {phase === "done" && (
            <div className="mt-4 space-y-3">
              <p className="text-xs font-medium text-accent">
                ✓ Transfer complete — {formatBytes(files.reduce((s, f) => s + f.size, 0))} sent.
              </p>
              <BenchmarkSummary
                totalBytes={files.reduce((s, f) => s + f.size, 0)}
                durationSeconds={(timingRef.current.end - timingRef.current.start) / 1000}
                avgBytesPerSec={
                  files.reduce((s, f) => s + f.size, 0) /
                  ((timingRef.current.end - timingRef.current.start) / 1000 || 1)
                }
                peakBytesPerSec={timingRef.current.peakBps}
                connectionType={connStats.type}
                rttMs={connStats.rttMs}
                finalWindowBytes={progress?.windowBytes}
              />
            </div>
          )}

          {phase === "error" && error && (
            <p className="mt-4 text-xs font-medium text-warn">{error}</p>
          )}
        </>
      )}

      {storeMode && (
        <>
          {storePhase === "uploading" && storeProgress && (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-muted">Encrypting and uploading…</p>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.min(100, (storeProgress.bytesUploaded / storeProgress.totalBytes) * 100)}%` }}
                />
              </div>
              <p className="text-[11px] text-muted">
                {formatBytes(storeProgress.bytesUploaded)} / {formatBytes(storeProgress.totalBytes)}
              </p>
            </div>
          )}

          {storePhase === "done" && storeResult && (
            <div className="mt-4 space-y-3">
              <p className="text-xs font-medium text-accent">✓ Uploaded — ciphertext only, key never left your device.</p>
              <CodeDisplay code={storeResult.shareUrl.split("#")[0].split("/").pop() ?? ""} browserLink={storeResult.shareUrl} />
              <p className="text-[11px] text-muted">
                Single download, expires in 24h. Whoever opens this link can decrypt it — share it privately.
              </p>
              <button type="button" onClick={revokeStoreSend} className="btn-secondary border-warn text-warn">
                Revoke now
              </button>
            </div>
          )}

          {storePhase === "error" && error && (
            <p className="mt-4 text-xs font-medium text-warn">{error}</p>
          )}
        </>
      )}

<div className="mt-auto pt-6">
  {storeMode ? (
    !isStoreLocked ? (
      <button
        type="button"
        onClick={startStoreSend}
        disabled={files.length === 0}
        className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-white transition-transform active:scale-[0.99] cursor-pointer disabled:cursor-not-allowed"
      >
        <div className="absolute inset-0 z-0 h-full w-full overflow-hidden" style={{ filter: "url(#pencil-rough)" }}>
          <SketchedBackground mode={files.length > 0 ? "dark" : "light"} />
        </div>
        <span className="relative z-10 flex items-center gap-2" style={{ textShadow: "1px 1px 2px #000, -1px -1px 2px #000" }}>
          <UploadIcon /> Upload &amp; get link
        </span>
      </button>
    ) : storePhase === "done" ? (
      <button
        type="button"
        onClick={() => {
          setStorePhase("idle");
          setStoreResult(null);
          setFiles([]);
        }}
        className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-[#101010] transition-transform active:scale-[0.99] cursor-pointer"
      >
        <div className="absolute inset-0 z-0 h-full w-full overflow-hidden" style={{ filter: "url(#pencil-rough)" }}>
          <SketchedBackground mode="outline" />
        </div>
        <span className="relative z-10">New store transfer</span>
      </button>
    ) : (
      <button
        type="button"
        disabled
        className="relative flex h-12 w-full items-center justify-center font-bold text-white cursor-not-allowed"
      >
        <div className="absolute inset-0 z-0 h-full w-full overflow-hidden" style={{ filter: "url(#pencil-rough)" }}>
          <SketchedBackground mode="dark" />
        </div>
        <span className="relative z-10" style={{ textShadow: "1px 1px 2px #000, -1px -1px 2px #000" }}>Uploading…</span>
      </button>
    )
  ) : !isLocked ? (
    <button
      type="button"
      onClick={startSend}
      disabled={files.length === 0}
      className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-white transition-transform active:scale-[0.99] cursor-pointer disabled:cursor-not-allowed"
    >
      <div className="absolute inset-0 z-0 h-full w-full overflow-hidden" style={{ filter: "url(#pencil-rough)" }}>
        <SketchedBackground mode={files.length > 0 ? "dark" : "light"} />
      </div>
      <span className="relative z-10 flex items-center gap-2" style={{ textShadow: "1px 1px 2px #000, -1px -1px 2px #000" }}>
        <UploadIcon color="#fff"/> Send file
      </span>
    </button>
  ) : (
    <button
      type="button"
      onClick={cancel}
      className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-[#101010] transition-transform active:scale-[0.99] cursor-pointer"
    >
      <div className="absolute inset-0 z-0 h-full w-full overflow-hidden" style={{ filter: "url(#pencil-rough)" }}>
        <SketchedBackground mode="outline" />
      </div>
      <span className="relative z-10 flex items-center gap-2">
         Cancel send
      </span>
    </button>
  )}
</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Receive panel
// ---------------------------------------------------------------------------

function ReceivePanel({ turnOverride }: { turnOverride: TurnOverride | null }) {
  const [codeInput, setCodeInput] = useState("");
  const [phase, setPhase] = useState<ReceivePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [receivedFile, setReceivedFile] = useState<File | null>(null);
  const [connStats, setConnStats] = useState<{ type: ConnectionType; rttMs: number | null }>({
    type: "unknown",
    rttMs: null,
  });
  const [storePhase, setStorePhase] = useState<
    "idle" | "loading" | "review" | "downloading" | "done" | "error"
  >("idle");
  const [storeManifest, setStoreManifest] = useState<StoredManifest | null>(null);
  const [storeDownloadProgress, setStoreDownloadProgress] = useState<StoreDownloadProgress | null>(
    null,
  );
  const storeKeysRef = useRef<{ id: string; keys: Awaited<ReturnType<typeof deriveKeys>> } | null>(null);

  const signalingRef = useRef<SignalingClient | null>(null);
  const peersRef = useRef<any[]>([]);
  const receiverRef = useRef<FileReceiver | null>(null);
  const statsRef = useRef<StatsMonitor | null>(null);
  const timingRef = useRef<{ start: number; end: number; peakBps: number }>({
    start: 0,
    end: 0,
    peakBps: 0,
  });
  const reconnectAttemptRef = useRef(0);
  const terminalRef = useRef(false);
  const lastActivityRef = useRef(Date.now());

  const cleanup = useCallback(() => {
    statsRef.current?.stop();
    peersRef.current.forEach((p) => p.close());
    signalingRef.current?.close();
    statsRef.current = null;
    peersRef.current = [];
    signalingRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const STALL_TIMEOUT_MS = 45_000;
  useEffect(() => {
    if (phase !== "connecting" && phase !== "receiving" && phase !== "reconnecting") return;
    lastActivityRef.current = Date.now();
    const interval = setInterval(() => {
      if (terminalRef.current) return;
      if (Date.now() - lastActivityRef.current > STALL_TIMEOUT_MS) {
        terminalRef.current = true;
        cleanup();
        setError("No response from the sender for a while — the connection may have been lost.");
        setPhase("error");
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [phase, cleanup]);

  const startReceive = async () => {
    const input = codeInput.trim();
    if (!input) return;
    const parsed = parseShareLink(input);
    if (parsed) {
      await startStoreReceive(parsed.id, parsed.masterKey);
    } else {
      await startLiveReceive(input);
    }
  };

  const startStoreReceive = async (id: string, masterKey: Uint8Array) => {
    setError(null);
    setStorePhase("loading");
    try {
      const status = await fetchStoredStatus(id);
      if (status.status !== "available") {
        setError(
          status.status === "uploading"
            ? "This transfer hasn't finished uploading yet."
            : `This transfer is ${status.status}.`,
        );
        setStorePhase("error");
        return;
      }
      const keys = await deriveKeys(masterKey);
      const manifest = await fetchStoredManifest(id, keys);
      setStoreManifest(manifest);
      setStorePhase("review");
      storeKeysRef.current = { id, keys };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load this stored transfer.");
      setStorePhase("error");
    }
  };

  const confirmStoreDownload = async () => {
    if (!storeManifest || !storeKeysRef.current) return;
    setStorePhase("downloading");
    try {
      const files = await downloadStoredFiles(
        storeKeysRef.current.id,
        storeKeysRef.current.keys,
        storeManifest,
        (p) => setStoreDownloadProgress(p),
      );
      files.forEach(downloadFile);
      setStorePhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
      setStorePhase("error");
    }
  };

  const startLiveReceive = async (code: string) => {
    setError(null);
    setPhase("connecting");
    reconnectAttemptRef.current = 0;
    terminalRef.current = false;

    try {
      const status = await checkRoom(code);
      if (!status.exists) {
        setError(status.expired ? "This code has expired." : "That code doesn't exist.");
        setPhase("error");
        return;
      }

      let signaling = new SignalingClient(code, "receiver");
      signalingRef.current = signaling;
      await signaling.connect();

      receiverRef.current = new FileReceiver({
        onProgress: (p) => {
          lastActivityRef.current = Date.now();
          setPhase((prev) => (prev === "done" ? prev : "receiving"));
          setProgress(p);
          timingRef.current.peakBps = Math.max(timingRef.current.peakBps, p.ratePerSec);
        },
        onFileComplete: (file) => {
          setReceivedFile(file);
          downloadFile(file);
        },
        onAllComplete: () => {
          terminalRef.current = true;
          timingRef.current.end = performance.now();
          setPhase("done");
        },
        onError: (msg) => {
          terminalRef.current = true;
          setError(msg);
          setPhase("error");
        },
      });

      const establishAndListen = async () => {
        const connectionCount = await waitForConfig(signaling, MAX_PARALLEL_CONNECTIONS, 3000);

        const onConnectionStateChange = (state: RTCPeerConnectionState) => {
          if (state !== "failed" && state !== "disconnected") return;
          if (terminalRef.current) return;
          void attemptReconnect();
        };

        let statsStarted = false;
        const { peers, channels } = await establishParallelReceiverConnections(
          signaling,
          connectionCount,
          {
            onConnectionStateChange,
            onDataChannelOpen: (channel, peer) => {
              if (peer.getConnectionIndex() === 0) {
                receiverRef.current?.setControlChannel(channel);
              }
              if (!statsStarted) {
                statsStarted = true;
                statsRef.current?.stop();
                if (timingRef.current.start === 0) {
                  timingRef.current = { start: performance.now(), end: 0, peakBps: 0 };
                }
                const stats = new StatsMonitor(
                  () => peer.getStats(),
                  (s) => setConnStats({ type: s.connectionType, rttMs: s.rttMs }),
                );
                stats.start();
                statsRef.current = stats;
              }
              channel.addEventListener("message", (event) => {
                receiverRef.current?.handleMessage(event.data);
              });
            },
          },
          undefined,
          getIceServers(turnOverride),
        );
        peersRef.current = peers;

        if (channels.length === 0 && !terminalRef.current) {
          setError("No connection from the sender arrived. Check the code and try again.");
          setPhase("error");
        }
      };

      const attemptReconnect = async () => {
        if (reconnectAttemptRef.current >= RECONNECT_BACKOFF_MS.length) {
          terminalRef.current = true;
          setError("Connection lost and could not be re-established.");
          setPhase("error");
          return;
        }
        const delay = RECONNECT_BACKOFF_MS[reconnectAttemptRef.current];
        reconnectAttemptRef.current++;
        setPhase("reconnecting");
        statsRef.current?.stop();
        peersRef.current.forEach((p) => p.close());
        peersRef.current = [];
        await new Promise((r) => setTimeout(r, delay));

        if (!signaling.isConnected()) {
          signaling.close();
          signaling = new SignalingClient(code, "receiver");
          signalingRef.current = signaling;
          try {
            await signaling.connect();
          } catch {
            terminalRef.current = true;
            setError("Lost connection to the pairing server and could not reconnect.");
            setPhase("error");
            return;
          }
        }
        void establishAndListen();
      };

      await establishAndListen();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join transfer");
      setPhase("error");
    }
  };

  const cancel = () => {
    cleanup();
    setPhase("idle");
    setProgress(null);
    setCodeInput("");
  };

  const isLocked = phase !== "idle";
  const isStoreLocked = storePhase !== "idle";
  const anyLocked = isLocked || isStoreLocked;

  return (
    <div className="flex h-full flex-col">
      {/* Header — Matched to SendPanel */}
      <div className="mb-4 flex items-center gap-3">
        <IconBox>
          <DownloadIcon />
        </IconBox>
        <div className="mt-2 flex flex-col justify-center leading-snug">
          <h2 className="mb-2 ml-2 text-xl font-bold text-[#575656] leading-none [word-spacing:0.5rem]">
            Receive
          </h2>
          <p className="ml-2 text-xs font-medium text-[#555555] leading-snug">
            Enter a code. Review before saving.
          </p>
        </div>
      </div>

      {/* Code Input Field */}
      <div className="mb-2">
        <label className="mb-2 mt-3 block text-[12px] font-thin uppercase tracking-wider text-[#6e6a61]">
          Code
        </label>
        <div className="relative rounded-[6px] bg-[#f4f2eb]/70 p-1">
          <div>
  <div
    className="pointer-events-none absolute inset-0 rounded-md border border-[#2b2b2b]/30"
  />

  <input
    className="relative z-10 h-8 w-full rounded-md bg-transparent px-2 text-[12px] font-normal text-[#101010] outline-none placeholder:font-normal placeholder:text-[#9c9b98] disabled:opacity-50"
    placeholder="word-word-word or a stored link"
    value={codeInput}
    disabled={anyLocked}
    onChange={(e) => setCodeInput(e.target.value)}
    onKeyDown={(e) => e.key === "Enter" && startReceive()}
  />
</div>
        </div>
      </div>
      <p className="text-[12px] font-medium leading-5 w-[388px] text-[#494946] m-1">
        Paste a live code (word-word-word) or a stored transfer link, then press Enter or select Receive.
      </p>

      {/* Progress / Status States */}
      {phase === "connecting" && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-[#625e55]">Securing channel…</p>
          <IndeterminateBar />
        </div>
      )}

      {phase === "receiving" && progress && (
        <div className="mt-4 space-y-3">
          <ConnectionStatus connectionType={connStats.type} rttMs={connStats.rttMs} />
          <TransferProgress
            label="Receiving"
            fileName={progress.fileName}
            bytesTransferred={progress.bytesTransferred}
            totalBytes={progress.totalBytes}
            percent={(progress.bytesTransferred / progress.totalBytes) * 100}
            ratePerSec={progress.ratePerSec}
            etaSeconds={progress.etaSeconds}
            fileIndex={progress.fileIndex}
            totalFiles={progress.totalFiles}
          />
        </div>
      )}

      {phase === "reconnecting" && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-bold text-[#a84232]">
            Connection dropped — attempting to reconnect and resume…
          </p>
          <IndeterminateBar />
          {progress && (
            <p className="text-[11px] font-medium text-[#625e55]">
              {formatBytes(progress.bytesTransferred)} of {formatBytes(progress.totalBytes)} already
              received — resuming from there, not from zero.
            </p>
          )}
        </div>
      )}

      {phase === "done" && receivedFile && (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-bold text-[#1b5e20]">
            ✓ All files received and verified — {receivedFile.name}
          </p>
          <BenchmarkSummary
            totalBytes={receivedFile.size}
            durationSeconds={(timingRef.current.end - timingRef.current.start) / 1000}
            avgBytesPerSec={
              receivedFile.size / ((timingRef.current.end - timingRef.current.start) / 1000 || 1)
            }
            peakBytesPerSec={timingRef.current.peakBps}
            connectionType={connStats.type}
            rttMs={connStats.rttMs}
          />
        </div>
      )}

      {phase === "error" && error && !isStoreLocked && (
        <p className="mt-4 text-xs font-bold text-[#a84232]">{error}</p>
      )}

      {/* --- Stored (async) transfer flow --- */}

      {storePhase === "loading" && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-[#625e55]">Securing channel…</p>
          <IndeterminateBar />
        </div>
      )}

      {storePhase === "review" && storeManifest && (
        <div className="relative mt-4 rounded-[6px] bg-[#f4f2eb]/70 p-3 text-[#181818]">
          <div
            className="pointer-events-none absolute inset-0 rounded-[6px] border border-[#a09c93]"
            style={{ filter: "url(#pencil-rough)" }}
          />
          <div className="relative z-10 mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[#6e6a61]">
            <span>Incoming transfer</span>
            <span>{formatBytes(storeManifest.totalSize)}</span>
          </div>
          <ul className="relative z-10 mb-3 divide-y divide-[#d4d0c5] border-y border-[#d4d0c5]">
            {storeManifest.files.map((f) => (
              <li key={f.name} className="flex items-center justify-between py-1.5 text-xs font-medium">
                <span className="truncate text-[#101010]">{f.name}</span>
                <span className="shrink-0 text-[#625e55]">{formatBytes(f.size)}</span>
              </li>
            ))}
          </ul>
          <div className="relative z-10 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setStorePhase("idle");
                setStoreManifest(null);
                setCodeInput("");
              }}
              className="relative flex h-10 flex-1 items-center justify-center font-bold text-[#101010] transition-transform active:scale-[0.99] cursor-pointer"
            >
              <div
                className="absolute inset-0 z-0 h-full w-full overflow-hidden"
                style={{ filter: "url(#pencil-rough)" }}
              >
                <SketchedBackground mode="outline" />
              </div>
              <span className="relative z-10 text-xs">Refuse</span>
            </button>
            <button
              type="button"
              onClick={confirmStoreDownload}
              className="relative flex h-10 flex-1 items-center justify-center gap-1.5 font-bold text-white transition-transform active:scale-[0.99] cursor-pointer"
            >
              <div
                className="absolute inset-0 z-0 h-full w-full overflow-hidden"
                style={{ filter: "url(#pencil-rough)" }}
              >
                <SketchedBackground mode="dark" />
              </div>
              <span
                className="relative z-10 flex items-center gap-1.5 text-xs"
                style={{ textShadow: "1px 1px 2px #000, -1px -1px 2px #000" }}
              >
                <DownloadIcon color="#fff" /> Download
              </span>
            </button>
          </div>
        </div>
      )}

      {storePhase === "downloading" && storeDownloadProgress && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-[#625e55]">Downloading and decrypting…</p>
          <div
            className="relative h-2.5 w-full overflow-hidden rounded-[4px] border border-[#7a766c] bg-[#eae7df]"
            style={{ filter: "url(#pencil-rough)" }}
          >
            <div
              className="h-full bg-[#181818] transition-all duration-200 ease-out"
              style={{
                width: `${Math.min(
                  100,
                  (storeDownloadProgress.bytesDownloaded / storeDownloadProgress.totalBytes) * 100,
                )}%`,
              }}
            />
          </div>
          <p className="text-[11px] font-medium text-[#625e55]">
            {formatBytes(storeDownloadProgress.bytesDownloaded)} / {formatBytes(storeDownloadProgress.totalBytes)}
          </p>
        </div>
      )}

      {storePhase === "done" && storeManifest && (
        <p className="mt-4 text-xs font-bold text-[#1b5e20]">
          ✓ All files verified and downloaded — {storeManifest.files.length} file
          {storeManifest.files.length === 1 ? "" : "s"}.
        </p>
      )}

      {storePhase === "error" && error && (
        <p className="mt-4 text-xs font-bold text-[#a84232]">{error}</p>
      )}

      {/* Main Action Button Area — Matched to SendPanel */}
      <div className="mt-auto pt-6">
        {!anyLocked ? (
          <button
            type="button"
            onClick={startReceive}
            disabled={!codeInput.trim()}
            className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-white transition-transform active:scale-[0.99] cursor-pointer disabled:cursor-not-allowed"
          >
            <div
              className="absolute inset-0 z-0 h-full w-full overflow-hidden"
              style={{ filter: "url(#pencil-rough)" }}
            >
              <SketchedBackground mode={codeInput.trim() ? "dark" : "light"} />
            </div>
            <span
              className="relative z-10 flex items-center gap-2"
              style={{ textShadow: "1px 1px 2px #000, -1px -1px 2px #000" }}
            >
              <DownloadIcon color="#fff" /> Receive
            </span>
          </button>
        ) : isStoreLocked && storePhase !== "review" ? (
          <button
            type="button"
            onClick={() => {
              setStorePhase("idle");
              setStoreManifest(null);
              setCodeInput("");
            }}
            className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-[#101010] transition-transform active:scale-[0.99] cursor-pointer"
          >
            <div
              className="absolute inset-0 z-0 h-full w-full overflow-hidden"
              style={{ filter: "url(#pencil-rough)" }}
            >
              <SketchedBackground mode="outline" />
            </div>
            <span className="relative z-10 flex items-center gap-2">
              <CloseIcon /> {storePhase === "done" ? "Done" : "Cancel"}
            </span>
          </button>
        ) : isLocked ? (
          <button
            type="button"
            onClick={cancel}
            className="relative flex h-12 w-full items-center justify-center gap-2 font-bold text-[#101010] transition-transform active:scale-[0.99] cursor-pointer"
          >
            <div
              className="absolute inset-0 z-0 h-full w-full overflow-hidden"
              style={{ filter: "url(#pencil-rough)" }}
            >
              <SketchedBackground mode="outline" />
            </div>
            <span className="relative z-10 flex items-center gap-2">
              <CloseIcon /> Cancel receive
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

export function IndeterminateBar() {
  return (
    <div className="relative h-1 w-full overflow-hidden rounded-[3px] bg-[#eae7df]">
      {/* Smooth border */}
      <div className="pointer-events-none absolute inset-0 z-10 rounded-[3px] border border-[#7a766c]" />

      {/* Animated charcoal bar */}
      <div
        className="h-full w-1/3 animate-[sketch-slide_1.5s_ease-in-out_infinite] rounded-[2px] bg-[#181818]"
      />

      <style jsx>{`
        @keyframes sketch-slide {
          0% {
            transform: translateX(-100%);
          }

          100% {
            transform: translateX(300%);
          }
        }
      `}</style>
    </div>
  );
}

function IconBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[#050505]/70 bg-transparent">
      {children}
    </div>
  );
}

function UploadIcon({ color = "#050505" }: { color?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function DownloadIcon({ color = "#050505" }: { color?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4v12M6 10l6 6 6-6" />
      <path d="M4 20h16" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
