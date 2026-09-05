// apps/web/lib/webrtc/errors.ts  (NEW FILE)
"use client";

/**
 * Translates raw, internal/browser error strings into short, user-facing
 * copy. Nothing that reaches the UI should ever say things like
 * "RTCDataChannel send queue is full" — this is the one place that maps
 * the known set of raw errors this app can throw into something a
 * non-technical person can actually act on.
 */
export function toFriendlyError(raw: string): string {
  const msg = raw.toLowerCase();

  if (msg.includes("send queue is full")) {
    return "The connection couldn't keep up with the transfer speed and had to stop. Please try again — this is usually a one-off network hiccup.";
  }
  if (msg.includes("hash_mismatch") || msg.includes("does not match sender")) {
    return "The received file failed its integrity check. Please ask the sender to try again.";
  }
  if (msg.includes("max message size") || msg.includes("max-message-size") || msg.includes("too small to send")) {
    return "This connection couldn't negotiate a usable transfer size. Please try again.";
  }
  if (msg.includes("missing chunk") || msg.includes("transfer incomplete")) {
    return "The transfer stopped before all the data arrived. Please try again.";
  }
  if (msg.includes("invalid chunk index")) {
    return "Something went wrong reassembling the file. Please try the transfer again.";
  }
  if (msg.includes("the sender cancelled") || msg.includes("the receiver cancelled")) {
    return raw; // already a clean, user-facing sentence
  }
  if (msg.includes("cancelled") || msg.includes("canceled")) {
    return "The transfer was cancelled.";
  }
  if (msg.includes("invalid control message")) {
    return "The connection sent something unexpected. Please try the transfer again.";
  }
  if (msg.includes("closed") || msg.includes("invalidstateerror") || msg.includes("network")) {
    return "The connection closed unexpectedly. Please try again.";
  }
  if (raw.trim().length === 0) {
    return "The transfer failed for an unknown reason. Please try again.";
  }

  // Fallback — don't leak raw browser-internal phrasing, but don't
  // pretend to know more than we do either.
  return "The transfer ran into a problem and couldn't continue. Please try again.";
}