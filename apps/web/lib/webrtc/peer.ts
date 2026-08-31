"use client";

import { DEFAULT_ICE_SERVERS } from "@fast-transfer/protocol";
import type { PeerRole, IceServerConfig } from "@fast-transfer/protocol";
import type { SignalingClient } from "../signaling/client";

export interface PeerConnectionCallbacks {
  onDataChannelOpen: (channel: RTCDataChannel, peer: PeerConnection) => void;
  onIceStateChange?: (state: RTCIceConnectionState) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
}

const DATA_CHANNEL_LABEL = "fast-transfer";

/**
 * Owns exactly one RTCPeerConnection for one transfer. The sender creates
 * the offer + data channel; the receiver answers and waits for the channel
 * to open. All signaling messages are relayed through `SignalingClient` —
 * this class never touches the WebSocket directly.
 */
export class PeerConnection {
  private pc: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private readonly role: PeerRole;
  private readonly signaling: SignalingClient;
  private readonly callbacks: PeerConnectionCallbacks;
  private readonly connectionIndex: number;
  private pendingRemoteCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;

  constructor(
    role: PeerRole,
    signaling: SignalingClient,
    callbacks: PeerConnectionCallbacks,
    connectionIndex = 0,
    iceServers: IceServerConfig[] = DEFAULT_ICE_SERVERS,
  ) {
    this.role = role;
    this.signaling = signaling;
    this.callbacks = callbacks;
    this.connectionIndex = connectionIndex;
    // RTCIceServer and our environment-agnostic IceServerConfig have the
    // same shape; this cast is safe (see protocol/src/index.ts for why the
    // shared type is declared locally instead of importing the DOM lib type).
    this.pc = new RTCPeerConnection({ iceServers: iceServers as RTCIceServer[] });

    this.pc.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        this.signaling.send({
          type: "ICE_CANDIDATE",
          role: this.role,
          connectionIndex: this.connectionIndex,
          payload: { candidate: event.candidate.toJSON() },
        });
      }
    });

    this.pc.addEventListener("iceconnectionstatechange", () => {
      this.callbacks.onIceStateChange?.(this.pc.iceConnectionState);
    });

    this.pc.addEventListener("connectionstatechange", () => {
      this.callbacks.onConnectionStateChange?.(this.pc.connectionState);
    });

    if (role === "receiver") {
      // Sender creates the data channel; receiver just listens for it.
      this.pc.addEventListener("datachannel", (event) => {
        this.dataChannel = event.channel;
        this.wireDataChannel(event.channel);
      });
    }

    this.signaling.onMessage((msg) => {
      if ((msg.connectionIndex ?? 0) !== this.connectionIndex) return; // not for this connection
      if (msg.type === "OFFER" && role === "receiver") {
        void this.handleOffer(msg.payload as { sdp: RTCSessionDescriptionInit });
      } else if (msg.type === "ANSWER" && role === "sender") {
        void this.handleAnswer(msg.payload as { sdp: RTCSessionDescriptionInit });
      } else if (msg.type === "ICE_CANDIDATE") {
        void this.handleRemoteCandidate(
          (msg.payload as { candidate: RTCIceCandidateInit }).candidate,
        );
      }
    });
  }

  /** Sender side: create the data channel + offer, send it through signaling. */
  async initiate(): Promise<void> {
    if (this.role !== "sender") throw new Error("only the sender initiates");
    const channel = this.pc.createDataChannel(`${DATA_CHANNEL_LABEL}-${this.connectionIndex}`, {
      ordered: true,
    });
    this.dataChannel = channel;
    this.wireDataChannel(channel);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.signaling.send({
      type: "OFFER",
      role: "sender",
      connectionIndex: this.connectionIndex,
      payload: { sdp: offer },
    });
  }

  private async handleOffer(payload: { sdp: RTCSessionDescriptionInit }): Promise<void> {
    await this.pc.setRemoteDescription(payload.sdp);
    this.remoteDescriptionSet = true;
    await this.flushPendingCandidates();

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.signaling.send({
      type: "ANSWER",
      role: "receiver",
      connectionIndex: this.connectionIndex,
      payload: { sdp: answer },
    });
  }

  private async handleAnswer(payload: { sdp: RTCSessionDescriptionInit }): Promise<void> {
    await this.pc.setRemoteDescription(payload.sdp);
    this.remoteDescriptionSet = true;
    await this.flushPendingCandidates();
  }

  private async handleRemoteCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.remoteDescriptionSet) {
      // ICE candidates can arrive before the SDP answer/offer is set — queue them.
      this.pendingRemoteCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch {
      /* benign — late/duplicate candidates are common */
    }
  }

  private async flushPendingCandidates(): Promise<void> {
    const queued = this.pendingRemoteCandidates;
    this.pendingRemoteCandidates = [];
    for (const c of queued) {
      try {
        await this.pc.addIceCandidate(c);
      } catch {
        /* ignore */
      }
    }
  }

  private wireDataChannel(channel: RTCDataChannel): void {
    channel.binaryType = "arraybuffer";
    channel.addEventListener("open", () => this.callbacks.onDataChannelOpen(channel, this));
  }

  getConnectionIndex(): number {
    return this.connectionIndex;
  }

  getStats(): Promise<RTCStatsReport> {
    return this.pc.getStats();
  }

  close(): void {
    this.dataChannel?.close();
    this.pc.close();
  }
}
