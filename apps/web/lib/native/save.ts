/**
 * Bridge to native capabilities when this UI is running inside one of
 * Kimo's native shells — the Tauri desktop app (apps/desktop) or the
 * Expo mobile app (apps/mobile). Every export here degrades gracefully
 * to `false`/no-op in a plain browser tab, so `apps/web` keeps working
 * completely unchanged when deployed to Vercel — nothing in this file
 * is required for the web app to function, and nothing about the UI
 * itself changes between the three: this only affects how a finished
 * transfer gets saved to disk.
 */

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void };
  }
}

/** True only when running inside the Kimo desktop app's webview. */
export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** True only when running inside the Kimo mobile app's WebView. */
export function isMobileApp(): boolean {
  return typeof window !== "undefined" && !!window.ReactNativeWebView;
}

/**
 * Save a completed file to disk via the OS's native "Save As" dialog.
 * Returns `true` if the native path was used (caller should not also do
 * a browser-style download), `false` if we're not in the desktop app or
 * the user cancelled the dialog and the caller should fall back.
 */
export async function saveFileNatively(file: File): Promise<boolean> {
  if (isDesktopApp()) return saveFileViaTauri(file);
  if (isMobileApp()) return saveFileViaReactNativeWebView(file);
  return false;
}

async function saveFileViaTauri(file: File): Promise<boolean> {
  try {
    const [{ save }, { invoke }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/api/core"),
    ]);

    const path = await save({ defaultPath: file.name });
    if (!path) {
      // User cancelled — this is a normal outcome, not a failure. Don't
      // fall back to a browser download the person didn't ask for.
      return true;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    await invoke("save_file_to_path", { path, bytes: Array.from(bytes) });
    return true;
  } catch (err) {
    // If anything about the native path fails unexpectedly, fall back to
    // the browser download so the person still gets their file.
    console.error("Native save failed, falling back to browser download:", err);
    return false;
  }
}

async function saveFileViaReactNativeWebView(file: File): Promise<boolean> {
  try {
    const base64 = await fileToBase64(file);
    window.ReactNativeWebView!.postMessage(
      JSON.stringify({ type: "SAVE_FILE", name: file.name, base64 }),
    );
    // The RN shell (apps/mobile/App.tsx) writes the file and opens the
    // native share sheet on its side — there's no round-trip result to
    // await here, so treat "message sent" as success. If it silently
    // fails on the native side, the app shows its own alert; nothing
    // for the web UI to fall back to in that case anyway.
    return true;
  } catch (err) {
    console.error("Native (mobile) save failed, falling back to browser download:", err);
    return false;
  }
}

/**
 * Base64-encode a File's bytes without blowing the call stack on large
 * files — `String.fromCharCode(...bigArray)` fails for anything past a
 * few hundred KB, so this walks the buffer in chunks instead.
 */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
