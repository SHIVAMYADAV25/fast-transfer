"use client";

import { PeerConnection, type PeerConnectionCallbacks } from "./peer";
import type { SignalingClient } from "../signaling/client";
import type { PeerRole, IceServerConfig } from "@fast-transfer/protocol";
import { DEFAULT_ICE_SERVERS } from "@fast-transfer/protocol";

/**
 * The actual fix for the thing flagged when reviewing the PRD: opening more
 * RTCDataChannels on ONE RTCPeerConnection does not multiply throughput,
 * because they all share one SCTP association / one DTLS session / one
 * congestion-control state. Real parallelism (matching what croc gets from
 * multiple independent TCP connections) requires multiple independent
 * RTCPeerConnections, each with its own ICE/DTLS/SCTP handshake and its own
 * congestion control.
 *
 * This is deliberately kept as an explicit, toggleable "N connections"
 * experiment rather than silently replacing the single-connection path —
 * benchmark it against single-connection before assuming it's a net win on
 * a given network (extra ICE gathering + handshake overhead is a real cost,
 * and small/fast transfers may not amortize it).
 */

export const MAX_PARALLEL_CONNECTIONS = 4;

/**
 * Auto-picks a connection count based on total transfer size, so parallel
 * mode doesn't have to be a manual checkbox. Small files skip the extra
 * ICE/DTLS handshake overhead since it wouldn't be amortized.
 */
export function chooseConnectionCount(totalBytes: number): number {
  if (totalBytes < 8 * 1024 * 1024) return 1;    // <8MB: not worth parallel overhead
  if (totalBytes < 64 * 1024 * 1024) return 2;   // 8-64MB
  return MAX_PARALLEL_CONNECTIONS;               // 64MB+: full 4x
}

export interface ParallelConnectionsResult {
  peers: PeerConnection[];
  channels: RTCDataChannel[];
}

/**
 * Sender side: creates `count` independent PeerConnections, each initiates
 * its own offer, and resolves once every one of them has an open data
 * channel. If any fails to open within `timeoutMs`, its slot is dropped
 * rather than failing the whole batch — partial parallelism still beats
 * blocking the entire transfer on the flakiest connection.
 */
export async function establishParallelSenderConnections(
  signaling: SignalingClient,
  count: number,
  perConnectionCallbacks?: Partial<PeerConnectionCallbacks>,
  timeoutMs = 15_000,
  iceServers: IceServerConfig[] = DEFAULT_ICE_SERVERS,
): Promise<ParallelConnectionsResult> {
  const results = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      establishOne("sender", signaling, i, perConnectionCallbacks, timeoutMs, iceServers),
    ),
  );
  return mergeResults(results);
}

/**
 * Receiver side: since the receiver doesn't know in advance how many
 * connections the sender will open (no dedicated signaling message for it
 * yet — see README "known limitations"), it eagerly stands up `count`
 * receiver-role PeerConnections and waits for whichever ones actually get
 * an incoming offer. Unused slots (e.g. sender ran in single-connection
 * mode) simply never open a channel and are dropped after the timeout —
 * harmless, just a little wasted ICE-gathering work.
 */
export async function establishParallelReceiverConnections(
  signaling: SignalingClient,
  count: number,
  perConnectionCallbacks?: Partial<PeerConnectionCallbacks>,
  timeoutMs = 15_000,
  iceServers: IceServerConfig[] = DEFAULT_ICE_SERVERS,
): Promise<ParallelConnectionsResult> {
  const results = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      establishOne("receiver", signaling, i, perConnectionCallbacks, timeoutMs, iceServers),
    ),
  );
  return mergeResults(results);
}

function establishOne(
  role: PeerRole,
  signaling: SignalingClient,
  index: number,
  extraCallbacks: Partial<PeerConnectionCallbacks> | undefined,
  timeoutMs: number,
  iceServers: IceServerConfig[],
): Promise<{ peer: PeerConnection; channel: RTCDataChannel | null }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ peer, channel: null });
      }
    }, timeoutMs);

    const peer = new PeerConnection(
      role,
      signaling,
      {
        ...extraCallbacks,
        onDataChannelOpen: (channel, peerArg) => {
          extraCallbacks?.onDataChannelOpen?.(channel, peerArg);
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve({ peer, channel });
          }
        },
      },
      index,
      iceServers,
    );

    if (role === "sender") void peer.initiate();
  });
}

function mergeResults(
  results: { peer: PeerConnection; channel: RTCDataChannel | null }[],
): ParallelConnectionsResult {
  const opened = results.filter((r): r is { peer: PeerConnection; channel: RTCDataChannel } => r.channel != null);
  const closedPeers = results.filter((r) => r.channel == null);
  // Slots that never opened aren't useful — free their resources immediately.
  closedPeers.forEach((r) => r.peer.close());
  return { peers: opened.map((r) => r.peer), channels: opened.map((r) => r.channel) };
}
