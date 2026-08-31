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
    <main className="min-h-screen bg-paper px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">
            fast-transfer<span className="text-muted">.</span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            Direct browser-to-browser file transfer. Encrypted end-to-end. Nothing touches our servers.
          </p>
        </header>

        <div className="grid gap-6 border border-line bg-white p-0 sm:grid-cols-2">
          <div className="panel border-0 border-b border-line sm:border-b-0 sm:border-r">
            <SendPanel turnOverride={turnOverride} />
          </div>
          <div className="panel border-0">
            <ReceivePanel turnOverride={turnOverride} />
          </div>
        </div>

        <div className="mt-4">
          <RelaySettings value={turnOverride} onChange={setTurnOverride} />
        </div>

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
    resumeRef.current = {
      remainingFiles: files,
      bytesAlreadySent: 0,
      totalFiles: files.length,
      totalBytes: files.reduce((s, f) => s + f.size, 0),
    };

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
        );
      };

      const establishAndRun = async () => {
        setPhase("connecting");

        // Tell the receiver exactly how many RTCPeerConnections to expect,
        // so it doesn't have to eagerly open MAX_PARALLEL_CONNECTIONS and
        // prune the unused ones (see multi-peer.ts / README "Known
        // limitations" — this closes that gap).
        signaling.send({
          type: "CONFIG",
          role: "sender",
          payload: { connectionCount: parallelMode ? MAX_PARALLEL_CONNECTIONS : 1 },
        });

        const onConnectionStateChange = (state: RTCPeerConnectionState) => {
          if (state !== "failed" && state !== "disconnected") return;
          if (terminalRef.current) return; // already done/errored — nothing to resume
          const remaining = resumeRef.current?.remainingFiles.length ?? 0;
          if (remaining === 0) return; // already finished — nothing to resume
          void attemptReconnect();
        };

        if (parallelMode) {
          const { peers, channels } = await establishParallelSenderConnections(
            signaling,
            MAX_PARALLEL_CONNECTIONS,
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
      <div className="mb-4 flex items-center gap-2">
        <IconBox><UploadIcon /></IconBox>
        <div>
          <h2 className="text-lg font-semibold">Send</h2>
          <p className="text-xs text-muted">Choose files. Share one code.</p>
        </div>
      </div>

      {/* Direct / Store tabs */}
      <div className="mb-3 flex gap-0">
        <button
          type="button"
          disabled={isLocked || isStoreLocked}
          onClick={() => setStoreMode(false)}
          className={`btn-tab ${!storeMode ? "btn-tab-active" : "btn-tab-inactive"}`}
        >
          Direct
        </button>
        <button
          type="button"
          disabled={isLocked || isStoreLocked}
          onClick={() => setStoreMode(true)}
          className={`btn-tab ${storeMode ? "btn-tab-active" : "btn-tab-inactive"}`}
        >
          Store for 1 day
        </button>
      </div>

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
              className="btn-primary"
            >
              <UploadIcon /> Upload &amp; get link
            </button>
          ) : storePhase === "done" ? (
            <button
              type="button"
              onClick={() => {
                setStorePhase("idle");
                setStoreResult(null);
                setFiles([]);
              }}
              className="btn-secondary border-ink"
            >
              New store transfer
            </button>
          ) : (
            <button type="button" disabled className="btn-primary opacity-60">
              Uploading…
            </button>
          )
        ) : !isLocked ? (
          <button type="button" onClick={startSend} disabled={files.length === 0} className="btn-primary">
            <UploadIcon /> Send file
          </button>
        ) : (
          <button type="button" onClick={cancel} className="btn-secondary border-ink">
            <CloseIcon /> Cancel send
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
  const peersRef = useRef<PeerConnection[]>([]);
  const receiverRef = useRef<FileReceiver | null>(null);
  const statsRef = useRef<StatsMonitor | null>(null);
  const timingRef = useRef<{ start: number; end: number; peakBps: number }>({
    start: 0,
    end: 0,
    peakBps: 0,
  });
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
        // Wait briefly for the sender's CONFIG message (tells us exactly how
        // many RTCPeerConnections to open) — falls back to eagerly opening
        // MAX_PARALLEL_CONNECTIONS if it doesn't arrive within the timeout
        // (e.g. an older/incompatible sender client), same as before.
        const connectionCount = await waitForConfig(signaling, MAX_PARALLEL_CONNECTIONS, 3000);

        const onConnectionStateChange = (state: RTCPeerConnectionState) => {
          if (state !== "failed" && state !== "disconnected") return;
          if (terminalRef.current) return; // already done — nothing to resume
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

        // Full signaling-reconnect: rebuild the WebSocket against the same
        // room if it also dropped (not just the RTCPeerConnection). Unlike
        // the sender, the receiver doesn't need to wait for an explicit
        // PEER_JOINED before proceeding — establishAndListen already waits
        // (with its own timeouts) for CONFIG and then for offers to arrive,
        // so it's safe to just call it again once signaling is back.
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
      <div className="mb-4 flex items-center gap-2">
        <IconBox><DownloadIcon /></IconBox>
        <div>
          <h2 className="text-lg font-semibold">Receive</h2>
          <p className="text-xs text-muted">Enter a code. Review before saving.</p>
        </div>
      </div>

      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">
        Code
      </label>
      <input
        className="input-field"
        placeholder="word-word-word or a stored link"
        value={codeInput}
        disabled={anyLocked}
        onChange={(e) => setCodeInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && startReceive()}
      />
      <p className="mt-1 text-[11px] text-muted">
        Paste a live code (word-word-word) or a stored transfer link, then press Enter or select
        Receive.
      </p>

      {phase === "connecting" && (
        <div className="mt-4">
          <p className="mb-2 text-xs text-muted">Securing channel…</p>
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
          <p className="text-xs font-medium text-warn">
            Connection dropped — attempting to reconnect and resume…
          </p>
          <IndeterminateBar />
          {progress && (
            <p className="text-[11px] text-muted">
              {formatBytes(progress.bytesTransferred)} of {formatBytes(progress.totalBytes)} already
              received — resuming from there, not from zero.
            </p>
          )}
        </div>
      )}

      {phase === "done" && receivedFile && (
        <div className="mt-4 space-y-3">
          <p className="text-xs font-medium text-accent">
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
        <p className="mt-4 text-xs font-medium text-warn">{error}</p>
      )}

      {/* --- Stored (async) transfer flow --- */}

      {storePhase === "loading" && (
        <div className="mt-4">
          <p className="mb-2 text-xs text-muted">Securing channel…</p>
          <IndeterminateBar />
        </div>
      )}

      {storePhase === "review" && storeManifest && (
        <div className="mt-4 border border-line bg-white p-3">
          <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted">
            <span>Incoming transfer</span>
            <span>{formatBytes(storeManifest.totalSize)}</span>
          </div>
          <ul className="mb-3 divide-y divide-line border-y border-line">
            {storeManifest.files.map((f) => (
              <li key={f.name} className="flex items-center justify-between py-1.5 text-xs">
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 text-muted">{formatBytes(f.size)}</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setStorePhase("idle");
                setStoreManifest(null);
                setCodeInput("");
              }}
              className="btn-secondary flex-1 border-line py-2 text-xs"
            >
              Refuse
            </button>
            <button
              type="button"
              onClick={confirmStoreDownload}
              className="btn-primary flex-1 py-2 text-xs"
            >
              <DownloadIcon /> Download
            </button>
          </div>
        </div>
      )}

      {storePhase === "downloading" && storeDownloadProgress && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-muted">Downloading and decrypting…</p>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{
                width: `${Math.min(100, (storeDownloadProgress.bytesDownloaded / storeDownloadProgress.totalBytes) * 100)}%`,
              }}
            />
          </div>
          <p className="text-[11px] text-muted">
            {formatBytes(storeDownloadProgress.bytesDownloaded)} / {formatBytes(storeDownloadProgress.totalBytes)}
          </p>
        </div>
      )}

      {storePhase === "done" && storeManifest && (
        <p className="mt-4 text-xs font-medium text-accent">
          ✓ All files verified and downloaded — {storeManifest.files.length} file
          {storeManifest.files.length === 1 ? "" : "s"}.
        </p>
      )}

      {storePhase === "error" && error && (
        <p className="mt-4 text-xs font-medium text-warn">{error}</p>
      )}

      <div className="mt-auto pt-6">
        {!anyLocked ? (
          <button type="button" onClick={startReceive} disabled={!codeInput.trim()} className="btn-primary">
            <DownloadIcon /> Receive
          </button>
        ) : isStoreLocked && storePhase !== "review" ? (
          <button
            type="button"
            onClick={() => {
              setStorePhase("idle");
              setStoreManifest(null);
              setCodeInput("");
            }}
            className="btn-secondary border-ink"
          >
            <CloseIcon /> {storePhase === "done" ? "Done" : "Cancel"}
          </button>
        ) : isLocked ? (
          <button type="button" onClick={cancel} className="btn-secondary border-ink">
            <CloseIcon /> Cancel receive
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

function IndeterminateBar() {
  return (
    <div className="progress-track overflow-hidden">
      <div className="h-full w-1/3 animate-[slide_1.2s_ease-in-out_infinite] bg-ink" />
      <style jsx>{`
        @keyframes slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
}

function IconBox({ children }: { children: React.ReactNode }) {
  return <div className="flex h-8 w-8 items-center justify-center border border-line">{children}</div>;
}

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 16V4M6 10l6-6 6 6" />
      <path d="M4 20h16" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M12 4v12M6 10l6 6 6-6" />
      <path d="M4 20h16" />
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
