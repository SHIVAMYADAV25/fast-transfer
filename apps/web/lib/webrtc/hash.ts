/**
 * Incremental SHA-256. The Web Crypto API (crypto.subtle.digest) only
 * supports one-shot hashing — you hand it the entire buffer and get a
 * digest back, with no way to feed it bytes as they arrive. That's exactly
 * what was forcing sendFiles() to read a whole file into memory and hash it
 * before sending the first byte, which directly worked against this
 * project's whole reason for existing ("the file should start moving now").
 *
 * @noble/hashes provides a real incremental/streaming API instead:
 * create a hasher, .update() it as chunks arrive, .digest() once at the end.
 */

import { sha256 } from "@noble/hashes/sha2";

export interface IncrementalHasher {
  update(bytes: Uint8Array): void;
  digestHex(): string;
}

export function createHasher(): IncrementalHasher {
  const hasher = sha256.create();
  return {
    update(bytes: Uint8Array) {
      hasher.update(bytes);
    },
    digestHex() {
      const digest = hasher.digest();
      return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
    },
  };
}
