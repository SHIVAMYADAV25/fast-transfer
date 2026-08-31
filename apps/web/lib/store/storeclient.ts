"use client";

import type { StoredManifest, StoredManifestEntry, StoredTransferStatusResponse } from "@fast-transfer/protocol";
import {
  generateMasterKey,
  deriveKeys,
  sealManifest,
  openManifest,
  sealChunk,
  openChunk,
  buildShareUrl,
  type StoredKeys,
} from "./storecrypto";

const STORE_HTTP_URL = process.env.NEXT_PUBLIC_SIGNALING_HTTP_URL ?? "http://localhost:8787";
const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB — larger than the live-transfer chunk size since
// this is a sequence of independent HTTP requests, not a backpressure-controlled stream.

export interface StoreUploadProgress {
  bytesUploaded: number;
  totalBytes: number;
  fileIndex: number;
  totalFiles: number;
}

export interface StoreUploadResult {
  shareUrl: string;
  id: string;
  revokeToken: string;
  expiresAt: number;
}

async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function uploadStored(
  files: File[],
  options: { maxDownloads: number; ttlMs: number; appUrl: string },
  onProgress?: (p: StoreUploadProgress) => void,
): Promise<StoreUploadResult> {
  const masterKey = generateMasterKey();
  const keys = await deriveKeys(masterKey);

  const createRes = await fetch(`${STORE_HTTP_URL}/store`, {
    method: "POST",
    body: JSON.stringify({ maxDownloads: options.maxDownloads, ttlMs: options.ttlMs }),
  });
  if (!createRes.ok) throw new Error(`failed to create stored transfer (${createRes.status})`);
  const { id, revokeToken, expiresAt } = await createRes.json();

  // Build the manifest first (needs each file's hash + chunk plan), then
  // upload it, then stream chunk uploads for every file.
  const entries: StoredManifestEntry[] = [];
  for (const file of files) {
    entries.push({
      name: file.name,
      size: file.size,
      sha256: await hashFile(file),
      mimeType: file.type || undefined,
      chunkSize: CHUNK_SIZE,
      totalChunks: Math.ceil(file.size / CHUNK_SIZE),
    });
  }
  const manifest: StoredManifest = { files: entries, totalSize: files.reduce((s, f) => s + f.size, 0), createdAt: Date.now() };
  const sealedManifest = await sealManifest(keys, JSON.stringify(manifest));

  const manifestRes = await fetch(`${STORE_HTTP_URL}/store/${id}/manifest`, {
    method: "PUT",
    body: sealedManifest as unknown as BodyInit,
  });
  if (!manifestRes.ok) throw new Error("failed to upload manifest");

  const totalBytes = manifest.totalSize;
  let bytesUploaded = 0;
  let globalChunkIndex = 0;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    const entry = entries[fileIndex];
    for (let i = 0; i < entry.totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const slice = file.slice(start, start + CHUNK_SIZE);
      const bytes = new Uint8Array(await slice.arrayBuffer());
      const sealed = await sealChunk(keys, bytes);

      const res = await fetch(`${STORE_HTTP_URL}/store/${id}/chunk/${globalChunkIndex}`, {
        method: "PUT",
        body: sealed as unknown as BodyInit,
      });
      if (!res.ok) throw new Error(`failed to upload chunk ${globalChunkIndex}`);

      bytesUploaded += bytes.byteLength;
      globalChunkIndex++;
      onProgress?.({ bytesUploaded, totalBytes, fileIndex, totalFiles: files.length });
    }
  }

  const completeRes = await fetch(`${STORE_HTTP_URL}/store/${id}/complete`, {
    method: "POST",
    body: JSON.stringify({ totalChunks: globalChunkIndex }),
  });
  if (!completeRes.ok) throw new Error("failed to finalize upload");

  return { shareUrl: buildShareUrl(options.appUrl, id, masterKey), id, revokeToken, expiresAt };
}

export async function fetchStoredStatus(id: string): Promise<StoredTransferStatusResponse> {
  const res = await fetch(`${STORE_HTTP_URL}/store/${id}`);
  if (!res.ok) throw new Error("stored transfer not found");
  return res.json();
}

export async function fetchStoredManifest(id: string, keys: StoredKeys): Promise<StoredManifest> {
  const res = await fetch(`${STORE_HTTP_URL}/store/${id}/manifest`);
  if (!res.ok) throw new Error("failed to fetch manifest — it may have expired or been consumed");
  const sealed = new Uint8Array(await res.arrayBuffer());
  const json = await openManifest(keys, sealed);
  return JSON.parse(json);
}

export interface StoreDownloadProgress {
  bytesDownloaded: number;
  totalBytes: number;
  fileIndex: number;
  totalFiles: number;
}

/** Downloads every file in the manifest, verifies each against its sha256, and returns them. */
export async function downloadStoredFiles(
  id: string,
  keys: StoredKeys,
  manifest: StoredManifest,
  onProgress?: (p: StoreDownloadProgress) => void,
): Promise<File[]> {
  const results: File[] = [];
  let globalChunkIndex = 0;
  let bytesDownloaded = 0;
  const totalBytes = manifest.totalSize;

  for (let fileIndex = 0; fileIndex < manifest.files.length; fileIndex++) {
    const entry = manifest.files[fileIndex];
    const parts: Uint8Array[] = [];
    for (let i = 0; i < entry.totalChunks; i++) {
      const res = await fetch(`${STORE_HTTP_URL}/store/${id}/chunk/${globalChunkIndex}`);
      if (!res.ok) throw new Error(`failed to download chunk ${globalChunkIndex}`);
      const sealed = new Uint8Array(await res.arrayBuffer());
      const plain = await openChunk(keys, sealed);
      parts.push(plain);
      bytesDownloaded += plain.byteLength;
      globalChunkIndex++;
      onProgress?.({ bytesDownloaded, totalBytes, fileIndex, totalFiles: manifest.files.length });
    }

    const blob = new Blob(parts as BlobPart[], { type: entry.mimeType || "application/octet-stream" });
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hex !== entry.sha256) {
      throw new Error(`HASH_MISMATCH: ${entry.name} does not match the sender's checksum`);
    }
    results.push(new File([blob], entry.name, { type: blob.type }));
  }

  // Tell the server this download is verified-complete — this is what
  // decrements the download allowance / triggers cleanup once exhausted,
  // matching the blog's "opening the link does not burn it" behavior: the
  // transfer isn't consumed just because someone fetched bytes, only once
  // they're confirmed intact.
  await fetch(`${STORE_HTTP_URL}/store/${id}/commit`, { method: "POST" }).catch(() => {});

  return results;
}

export async function revokeStored(id: string, revokeToken: string): Promise<void> {
  await fetch(`${STORE_HTTP_URL}/store/${id}/revoke`, {
    method: "POST",
    body: JSON.stringify({ revokeToken }),
  });
}
