"use client";

/**
 * Stored-transfer crypto, mirroring croc's storecrypto.go design (see the
 * "When both computers cannot be online at once" blog post this whole
 * feature is based on):
 *
 *   1. One random 256-bit master key, generated client-side, never sent
 *      anywhere.
 *   2. HKDF-split into separate sub-keys for separate jobs — manifest and
 *      data — so a compromise of one doesn't imply the other (same
 *      reasoning croc's PAKE key schedule uses: don't reuse one key for
 *      everything).
 *   3. Manifest and every chunk are sealed independently with AES-256-GCM.
 *   4. Only ciphertext ever leaves the browser. The server (apps/signaling's
 *      /store routes + R2) stores bytes it cannot read.
 *   5. The share link's key lives after `#` — browsers never send URL
 *      fragments in HTTP requests, so the server never sees it even by
 *      accident in its own access logs.
 */

const MASTER_KEY_BYTES = 32;

/**
 * TS's DOM lib types `BufferSource`/`Uint8Array<ArrayBuffer>` more strictly
 * than the runtime actually requires — a `Uint8Array` is always fine to pass
 * to WebCrypto. This local cast is the single place that acknowledges that
 * mismatch instead of scattering `as unknown as X` across every call site.
 */
function bufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

export interface StoredKeys {
  masterKey: Uint8Array;
  manifestKey: CryptoKey;
  dataKey: CryptoKey;
}

export function generateMasterKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(MASTER_KEY_BYTES));
}

async function hkdfDerive(masterKey: Uint8Array, purpose: string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", bufferSource(masterKey), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: bufferSource(new Uint8Array(0)), // master key is already high-entropy random; no extra salt needed
      info: bufferSource(new TextEncoder().encode(`fast-transfer-store-v1:${purpose}`)),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function deriveKeys(masterKey: Uint8Array): Promise<StoredKeys> {
  const [manifestKey, dataKey] = await Promise.all([
    hkdfDerive(masterKey, "manifest"),
    hkdfDerive(masterKey, "data"),
  ]);
  return { masterKey, manifestKey, dataKey };
}

/** AES-GCM seal: random 12-byte nonce prepended to the ciphertext (nonce || ciphertext || tag). */
async function seal(key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: bufferSource(nonce) }, key, bufferSource(plaintext)),
  );
  const out = new Uint8Array(nonce.length + ciphertext.length);
  out.set(nonce, 0);
  out.set(ciphertext, nonce.length);
  return out;
}

async function open(key: CryptoKey, sealed: Uint8Array): Promise<Uint8Array> {
  const nonce = sealed.slice(0, 12);
  const ciphertext = sealed.slice(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bufferSource(nonce) },
    key,
    bufferSource(ciphertext),
  );
  return new Uint8Array(plaintext);
}

export async function sealManifest(keys: StoredKeys, manifestJson: string): Promise<Uint8Array> {
  return seal(keys.manifestKey, new TextEncoder().encode(manifestJson));
}

export async function openManifest(keys: StoredKeys, sealed: Uint8Array): Promise<string> {
  const bytes = await open(keys.manifestKey, sealed);
  return new TextDecoder().decode(bytes);
}

export async function sealChunk(keys: StoredKeys, chunk: Uint8Array): Promise<Uint8Array> {
  return seal(keys.dataKey, chunk);
}

export async function openChunk(keys: StoredKeys, sealed: Uint8Array): Promise<Uint8Array> {
  return open(keys.dataKey, sealed);
}

// ---------------------------------------------------------------------------
// Share link encoding — the "small URL trick" from the blog: everything
// after # never reaches the server.
// ---------------------------------------------------------------------------

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function buildShareUrl(appUrl: string, id: string, masterKey: Uint8Array): string {
  return `${appUrl}/s/${id}#v1.${bytesToBase64Url(masterKey)}`;
}

export interface ParsedShareLink {
  id: string;
  masterKey: Uint8Array;
}

/** Accepts either a full URL or a bare "id#v1.key" fragment pasted directly. */
export function parseShareLink(input: string): ParsedShareLink | null {
  const trimmed = input.trim();
  const hashIndex = trimmed.indexOf("#v1.");
  if (hashIndex === -1) return null;
  const keyPart = trimmed.slice(hashIndex + 4);
  let idPart = trimmed.slice(0, hashIndex);
  const slashIndex = idPart.lastIndexOf("/");
  if (slashIndex !== -1) idPart = idPart.slice(slashIndex + 1);
  if (!idPart || !keyPart) return null;
  try {
    return { id: idPart, masterKey: base64UrlToBytes(keyPart) };
  } catch {
    return null;
  }
}
