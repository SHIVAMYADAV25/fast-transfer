/**
 * Bridge for files shared *into* the Kimo mobile app from the OS
 * Sharesheet (Android's "Share via..." screen, iOS's share sheet).
 *
 * apps/mobile's `expo-share-intent` integration reads the shared file(s)
 * into base64 and posts them into this WebView as
 * `{ type: "INCOMING_SHARE", files: [...] }` (see apps/mobile/App.tsx).
 * This module listens for that message, turns each payload back into a
 * real `File`, and hands it to whoever subscribed via
 * `onIncomingSharedFiles` — normally the Send panel, so a shared file
 * lands in the dropzone exactly as if the person had picked it manually.
 *
 * A no-op everywhere else (plain browser tab, desktop app): nothing here
 * fires unless `window.ReactNativeWebView` posts a matching message.
 */

export interface IncomingSharedFilePayload {
  name: string;
  mimeType: string;
  base64: string;
}

type Listener = (files: File[]) => void;

const listeners = new Set<Listener>();

/** Subscribe to files shared in from the native shell. Returns an unsubscribe fn. */
export function onIncomingSharedFiles(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function base64ToFile(payload: IncomingSharedFilePayload): File {
  const binary = atob(payload.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], payload.name, {
    type: payload.mimeType || "application/octet-stream",
  });
}

function handleNativeMessage(event: MessageEvent) {
  let msg: { type?: string; files?: IncomingSharedFilePayload[] };
  try {
    msg = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
  } catch {
    return;
  }
  if (msg?.type !== "INCOMING_SHARE" || !Array.isArray(msg.files) || msg.files.length === 0) {
    return;
  }

  let files: File[];
  try {
    files = msg.files.map(base64ToFile);
  } catch (err) {
    console.error("Failed to decode incoming shared file(s):", err);
    return;
  }

  listeners.forEach((listener) => listener(files));
}

if (typeof window !== "undefined") {
  // react-native-webview's postMessage() fires a `message` event on
  // `document` on Android and on `window` on iOS — listening on both
  // covers either platform without needing to detect which one we're on.
  document.addEventListener("message", handleNativeMessage as EventListener);
  window.addEventListener("message", handleNativeMessage as EventListener);
}
