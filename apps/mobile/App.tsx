import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  BackHandler,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import WebView, { type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
// expo-file-system's SDK-54 default export switched to a new class-based
// File/Directory API; `/legacy` keeps the simple base64
// writeAsStringAsync()-style API this bridge wants, and is still fully
// supported (not deprecated) for that use case.
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useShareIntent } from "expo-share-intent";

import { WEB_URL } from "./config";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { OfflineView } from "./components/OfflineView";

/**
 * Kimo mobile app.
 *
 * This is a thin native shell around the exact same Kimo web app that
 * runs on kimo's website and inside the desktop (Tauri) build — same
 * React/Next.js UI, same responsive layout, same hand-drawn artwork and
 * animations, loaded here inside a native WebView. Nothing about the UI
 * is reimplemented for mobile; `WEB_URL` in ./config.ts just points at
 * the deployed site, which already has the responsive mobile layout
 * built in (see apps/web's Tailwind breakpoints).
 *
 * There are two native bridges layered on top of the WebView:
 *
 * 1. Save bridge (WebView -> native): apps/web's `lib/native/save.ts`
 *    detects `window.ReactNativeWebView` and posts the finished file
 *    over as base64 instead of doing the usual `<a download>`
 *    click-simulation trick. This app receives that message, writes it
 *    to a temp file via expo-file-system, and hands it to the OS's
 *    native share sheet (Sharing.shareAsync) so the person can save it
 *    to Files/Drive/AirDrop/etc.
 *
 * 2. Incoming-share bridge (native -> WebView): this is what makes Kimo
 *    show up as a target in the Android/iOS Sharesheet. `expo-share-intent`
 *    (config plugin in app.json) registers the native intent filters;
 *    `useShareIntent()` below surfaces whatever was shared as local file
 *    URIs. We read each one into base64 via expo-file-system and post it
 *    into the WebView, where apps/web's `lib/native/incoming-share.ts`
 *    picks it up and drops the file(s) straight into the Send panel, as
 *    if the person had picked them from the file dropzone themselves.
 */
export default function App() {
  const webviewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  // The WebView isn't ready to receive postMessage()s until it's finished
  // its first load — if the app was cold-started *by* a share (user shared
  // straight from the Sharesheet with Kimo not already running), the share
  // intent can be available before that happens, so we wait for both.
  const [webviewReady, setWebviewReady] = useState(false);

  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();

  const handleNavigationStateChange = useCallback((nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
  }, []);

  const handleAndroidBackPress = useCallback(() => {
    if (canGoBack && webviewRef.current) {
      webviewRef.current.goBack();
      return true;
    }
    return false;
  }, [canGoBack]);

  // Android hardware back button should navigate the webview's own
  // history (e.g. back out of a stored-transfer review screen) before
  // falling through to the OS default (minimize/exit).
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", handleAndroidBackPress);
    return () => sub.remove();
  }, [handleAndroidBackPress]);

  const handleMessage = useCallback(async (event: WebViewMessageEvent) => {
    let msg: { type?: string; name?: string; base64?: string } = {};
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    if (msg.type !== "SAVE_FILE" || !msg.name || !msg.base64) return;

    try {
      const dest = `${FileSystem.cacheDirectory}${sanitizeFileName(msg.name)}`;
      await FileSystem.writeAsStringAsync(dest, msg.base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(dest, { dialogTitle: `Save ${msg.name}` });
      } else {
        Alert.alert("Saved", `${msg.name} was saved to the app's temporary storage.`);
      }
    } catch (err) {
      Alert.alert(
        "Couldn't save file",
        err instanceof Error ? err.message : "Something went wrong saving the file.",
      );
    }
  }, []);

  // When a share intent is present, read every shared file into base64 and
  // hand it to the web app. Runs again each time `shareIntent` changes
  // (the native side is configured with singleTask launch mode, so sharing
  // again while Kimo is already open re-fires this with the new files).
  useEffect(() => {

    const files = shareIntent.files;

    if (!hasShareIntent || !webviewReady || !files || files.length === 0) {
      return;
    }

    // if (!hasShareIntent || !webviewReady || shareIntent.files.length === 0) return;

    let cancelled = false;

    (async () => {
      try {
        const incomingFiles  = await Promise.all(
          files.map(async (f) => ({
            name: f.fileName || sanitizeFileName(f.path.split("/").pop() ?? "shared-file"),
            mimeType: f.mimeType || "application/octet-stream",
            base64: await FileSystem.readAsStringAsync(f.path, {
              encoding: FileSystem.EncodingType.Base64,
            }),
          })),
        );
        if (cancelled) return;
        webviewRef.current?.postMessage(JSON.stringify({ type: "INCOMING_SHARE", incomingFiles }));
      } catch (err) {
        if (!cancelled) {
          Alert.alert(
            "Couldn't open shared file",
            err instanceof Error ? err.message : "Something went wrong reading the shared file.",
          );
        }
      } finally {
        if (!cancelled) resetShareIntent();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasShareIntent, shareIntent, webviewReady, resetShareIntent]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <StatusBar style="dark" />
        {loadFailed ? (
          <OfflineView
            onRetry={() => {
              setLoadFailed(false);
              setLoading(true);
              setReloadKey((k) => k + 1);
            }}
          />
        ) : (
          <>
            <WebView
              key={reloadKey}
              ref={webviewRef}
              source={{ uri: WEB_URL }}
              style={styles.webview}
              onNavigationStateChange={handleNavigationStateChange}
              onMessage={handleMessage}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => {
                setLoading(false);
                setWebviewReady(true);
              }}
              onError={() => setLoadFailed(true)}
              onHttpError={(e) => {
                // Only treat the top-level document failing to load as a
                // hard error — a failed subresource shouldn't blank the
                // whole app.
                if (e.nativeEvent.url === WEB_URL) setLoadFailed(true);
              }}
              // No camera/mic permissions are requested anywhere in this
              // flow (Kimo only ever opens an RTCDataChannel, never
              // getUserMedia), so there's nothing extra to configure for
              // WebRTC here beyond letting JS run normally.
              javaScriptEnabled
              domStorageEnabled
              allowsBackForwardNavigationGestures={Platform.OS === "ios"}
              sharedCookiesEnabled
              startInLoadingState={false}
             
              overScrollMode="never"
              bounces={false}
              originWhitelist={["https://*", "kimo://*"]}
            />
            {loading && <LoadingOverlay />}
          </>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "download";
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FDF8EE",
  },
  webview: {
    flex: 1,
    backgroundColor: "#FDF8EE",
  },
});
