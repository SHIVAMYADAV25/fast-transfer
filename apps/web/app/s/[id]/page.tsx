"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { deriveKeys, parseShareLink, type StoredKeys } from "@/lib/store/storecrypto";
import {
  fetchStoredStatus,
  fetchStoredManifest,
  downloadStoredFiles,
  type StoreDownloadProgress,
} from "@/lib/store/storeclient";
import { downloadFile } from "@/lib/webrtc/transfer";
import { formatBytes } from "@/lib/format";
import type { StoredManifest } from "@fast-transfer/protocol";

type Phase = "loading" | "review" | "downloading" | "done" | "error" | "no-key";

/**
 * This is the page a share link (`{appUrl}/s/{id}#v1.{key}`) actually opens.
 * The decryption key lives entirely in the URL fragment, which Next.js's
 * server-side routing never sees — `window.location.hash` is read client-side
 * only, after the page has already loaded, so the key never appears in any
 * server log or the Next.js route params. See storecrypto.ts for the full
 * reasoning (mirrors the "small URL trick" from the reference blog posts).
 */
export default function StoredTransferPage() {
  const params = useParams<{ id: string }>();
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<StoredManifest | null>(null);
  const [progress, setProgress] = useState<StoreDownloadProgress | null>(null);
  const [keys, setKeys] = useState<StoredKeys | null>(null);

  useEffect(() => {
    const id = params.id;
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    // Reuse the same parser as the pasted-link path by handing it a
    // synthetic "id#v1.key" string built from the route param + fragment.
    const parsed = parseShareLink(`${id}${hash}`);
    if (!parsed) {
      setPhase("no-key");
      return;
    }

    (async () => {
      try {
        const status = await fetchStoredStatus(parsed.id);
        if (status.status !== "available") {
          setError(
            status.status === "uploading"
              ? "This transfer hasn't finished uploading yet. Try again in a moment."
              : `This transfer is ${status.status}.`,
          );
          setPhase("error");
          return;
        }
        const derived = await deriveKeys(parsed.masterKey);
        setKeys(derived);
        const m = await fetchStoredManifest(parsed.id, derived);
        setManifest(m);
        setPhase("review");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load this transfer.");
        setPhase("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const download = async () => {
    if (!manifest || !keys) return;
    setPhase("downloading");
    try {
      const files = await downloadStoredFiles(params.id, keys, manifest, setProgress);
      files.forEach(downloadFile);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
      setPhase("error");
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6 py-10">
      <div className="w-full max-w-md border border-line bg-white p-6">
        <h1 className="mb-1 text-lg font-bold">fast-transfer</h1>
        <p className="mb-4 text-xs text-muted">Stored transfer — encrypted end-to-end.</p>

        {phase === "no-key" && (
          <p className="text-xs font-medium text-warn">
            This link is missing its decryption key (the part after <code>#</code> in the URL). Make
            sure you copied the complete link, not just part of it.
          </p>
        )}

        {phase === "loading" && (
          <div className="space-y-2">
            <p className="text-xs text-muted">Fetching and decrypting manifest…</p>
            <div className="progress-track">
              <div className="h-full w-1/3 animate-pulse bg-ink" />
            </div>
          </div>
        )}

        {phase === "review" && manifest && (
          <div>
            <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted">
              <span>Incoming transfer</span>
              <span>{formatBytes(manifest.totalSize)}</span>
            </div>
            <ul className="mb-4 divide-y divide-line border-y border-line">
              {manifest.files.map((f) => (
                <li key={f.name} className="flex items-center justify-between py-1.5 text-xs">
                  <span className="truncate">{f.name}</span>
                  <span className="shrink-0 text-muted">{formatBytes(f.size)}</span>
                </li>
              ))}
            </ul>
            <button type="button" onClick={download} className="btn-primary">
              Download
            </button>
          </div>
        )}

        {phase === "downloading" && progress && (
          <div className="space-y-2">
            <p className="text-xs text-muted">Downloading and decrypting…</p>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${Math.min(100, (progress.bytesDownloaded / progress.totalBytes) * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-muted">
              {formatBytes(progress.bytesDownloaded)} / {formatBytes(progress.totalBytes)}
            </p>
          </div>
        )}

        {phase === "done" && manifest && (
          <p className="text-xs font-medium text-accent">
            ✓ All files verified and downloaded — {manifest.files.length} file
            {manifest.files.length === 1 ? "" : "s"}.
          </p>
        )}

        {phase === "error" && error && <p className="text-xs font-medium text-warn">{error}</p>}
      </div>
    </main>
  );
}
