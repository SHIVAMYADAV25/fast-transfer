"use client";

import { DEFAULT_ICE_SERVERS, type IceServerConfig } from "@fast-transfer/protocol";

/**
 * WebRTC's ICE layer already does "try direct, fall back to relay"
 * automatically — candidate pairs are prioritized so host/srflx (direct)
 * candidates are preferred over relay ones, and TURN candidates are only
 * used when no direct pair succeeds (PRD §9/§31). There's no manual
 * "attempt P2P, catch failure, switch to TURN" code to write. The only
 * actual work is making TURN servers *available* to be tried — this file
 * builds that list from three sources, in priority order:
 *
 *   1. A user-supplied override (the "Relay settings" panel — lets someone
 *      self-hosting coturn point the app at their own server for a session)
 *   2. Env vars baked in at build/deploy time (NEXT_PUBLIC_TURN_*)
 *   3. STUN only (the MVP default — DEFAULT_ICE_SERVERS from the protocol
 *      package) if neither of the above is set
 *
 * See /docs/turn-server.md for how to actually stand up a TURN server —
 * Cloudflare Workers can't run one (it needs a real UDP-capable host), so
 * this is a deliberate "bring your own" seam rather than something bundled.
 */

export interface TurnOverride {
  urls: string; // e.g. "turn:turn.example.com:3478"
  username: string;
  credential: string;
}

function turnServersFromEnv(): IceServerConfig[] {
  const urlsRaw = process.env.NEXT_PUBLIC_TURN_URLS; // comma-separated
  const username = process.env.NEXT_PUBLIC_TURN_USERNAME;
  const credential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;
  if (!urlsRaw || !username || !credential) return [];
  const urls = urlsRaw.split(",").map((u) => u.trim()).filter(Boolean);
  if (urls.length === 0) return [];
  return [{ urls, username, credential }];
}

export function getIceServers(override?: TurnOverride | null): IceServerConfig[] {
  const stun = DEFAULT_ICE_SERVERS;
  if (override?.urls && override.username && override.credential) {
    return [...stun, { urls: override.urls, username: override.username, credential: override.credential }];
  }
  const envTurn = turnServersFromEnv();
  return [...stun, ...envTurn];
}
