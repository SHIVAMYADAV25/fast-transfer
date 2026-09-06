# Kimo Mobile

The same Kimo UI — same responsive mobile layout, same hand-drawn cat
artwork, same animations — running natively on iOS and Android via
[Expo](https://expo.dev) SDK 54. Nothing in the UI is reimplemented for
mobile: this app is a thin native `WebView` shell around the exact same
`apps/web` Next.js site that runs on the desktop app and the website.

## Why a WebView shell (and why Expo)

You explicitly asked to reuse the UI, images, and animations rather than
rebuild them — the only way to guarantee that with zero drift is to not
rebuild them. A few options were on the table:

| Approach | UI reuse | Native feel | Effort |
|---|---|---|---|
| **Expo + WebView (this)** | 100% — same site, same everything | Good — native shell, native share sheet | Small |
| React Native rewrite + `react-native-webrtc` | 0% — every screen rebuilt in RN components | Best | Very large |
| Capacitor (Ionic) | 100% — same idea as this, different tooling | Good, arguably more mature filesystem/share plugins out of the box | Small |

Since you asked for Expo specifically, that's what this is. **Capacitor is
worth knowing about as the alternative** if you ever want to revisit this:
it's built for exactly this "wrap an existing web app natively" use case
and ships official, well-tested Filesystem/Share plugins, whereas the
Expo version below hand-rolls that bridge with `expo-file-system` +
`expo-sharing`. Both are legitimate; Expo's ecosystem, tooling (EAS
Build/Submit), and React-based dev experience are why it's the
recommendation here given you already asked for it.

A full React Native rewrite would look and feel slightly more "native"
(true native scroll physics, no webview compositing layer) but means
maintaining two UIs that can drift apart — the opposite of what you
asked for — plus `react-native-webrtc` requires a custom dev client
(no Expo Go) and its own signaling wiring separate from what
`apps/web/lib/webrtc/*` already does.

## What's native vs. what's the same

| | Website / Desktop | Mobile (this app) |
|---|---|---|
| UI, styling, images, animations | Next.js app | **identical** — loaded live from the same deployed site |
| WebRTC / chunking / crypto | `lib/webrtc/*`, `lib/store/*` | **identical**, unmodified — runs inside the WebView exactly as in a mobile browser tab |
| Saving a finished file | Native dialog (desktop) / browser download (web) | Native share sheet (`Sharing.shareAsync`) — the standard mobile "save this somewhere" pattern |
| Distribution | URL / installer | App Store / Play Store, or a direct `.apk`/`.ipa` via EAS |

## How it loads the UI

`config.ts` points the WebView at `WEB_URL` — your deployed Kimo site.
**This means UI changes ship instantly to everyone** with no app-store
review cycle, since the app itself never changes, only the site it
loads. The tradeoff: the app needs network access to load its own
interface, not just to transfer files (a bad connection shows the
`OfflineView` retry screen in `App.tsx` rather than a broken blank
screen).

If you'd rather trade that instant-update property away for full
offline-first UI loading (matching how `apps/desktop` bundles a static
export), point the WebView at a bundled local copy instead:
`source={{ uri: 'file:///android_asset/...' }}` (Android) or a bundled
asset path (iOS) built the same way `apps/web`'s `build:desktop` script
produces `apps/web/out`. Not done here since it adds real complexity
(you'd need to rebuild and resubmit to both app stores for every UI
change) — worth it only if you specifically want offline support.

## The native file-save bridge

WebViews can't trigger a real "save to disk" the way a desktop browser
can. `apps/web/lib/native/save.ts` detects `window.ReactNativeWebView`
(auto-injected by `react-native-webview`, no setup needed) and, instead
of the usual `<a download>` trick:

1. Base64-encodes the finished file in the webview.
2. `window.ReactNativeWebView.postMessage(...)`s `{ type: "SAVE_FILE",
   name, base64 }` to the native side.
3. `App.tsx`'s `onMessage` handler writes it to a temp file via
   `expo-file-system/legacy`, then opens the OS's native share sheet
   (`expo-sharing`) so the person can save it to Files/Drive/AirDrop/etc.

This is the same "native save capability, same tested transfer engine
underneath" pattern as the desktop app's `save_file_to_path` Tauri
command — see `apps/desktop/README.md` for that side.

## Prerequisites

- Node.js 20+ and `pnpm` (`npm i -g pnpm`)
- The [Expo Go](https://expo.dev/go) app on your phone for local dev
  (this app uses no custom native modules beyond what Expo Go already
  bundles — `react-native-webview`, `expo-file-system`, and
  `expo-sharing` are all supported in Expo Go, so no custom dev client
  is needed for development)
- An [EAS](https://expo.dev) account (free tier is fine) for producing
  real installable builds — EAS Build compiles both iOS and Android in
  the cloud, so you don't need Xcode or Android Studio installed either

## Run it locally

From the **repo root**:

```bash
pnpm install
```

Then point `apps/mobile/config.ts`'s `WEB_URL` at your deployed site (or
`http://<your-computer's-LAN-IP>:3000` while running `pnpm dev:web`
locally — `localhost` won't resolve from a physical phone), and:

```bash
pnpm dev:mobile
```

Scan the QR code with Expo Go (Android) or the Camera app (iOS).

## Build real installers

```bash
cd apps/mobile
npx eas login          # first time only
npx eas build --platform android --profile preview   # installable .apk
npx eas build --platform ios --profile preview        # requires an Apple Developer account for device builds
```

Or push a `mobile-v*.*.*` tag / run the `Build Kimo Mobile` GitHub Actions
workflow manually — it calls the same `eas build` commands, given an
`EXPO_TOKEN` repo secret.

Before your first real build:
- Set `app.json`'s `extra.eas.projectId` (created automatically the
  first time you run `eas build`, or via `eas init`)
- Replace `com.kimo.app` in `app.json` if you don't own that identifier
- Point `config.ts` at your real production URL

## Known limitations (honest status)

- **Not yet run on an actual device or simulator.** Everything here
  typechecks and the dependency versions are pinned to Expo SDK 54's
  exact known-compatible set (verified against `expo`'s own
  `bundledNativeModules.json`, not guessed), but there's no
  iOS/Android toolchain available in the environment this was built
  in. Run `pnpm dev:mobile` with Expo Go as the first real check.
- **WebRTC-in-WebView needs on-device verification.** Both WKWebView
  (iOS 14.3+) and Android's Chromium-based WebView support
  `RTCPeerConnection`/`RTCDataChannel` — and this app only ever opens a
  data channel, never `getUserMedia`, so there's no camera/mic
  permission dance to get wrong — but "should work" isn't the same as
  "verified working" for the actual offer/answer/ICE/data-channel path
  on a real phone network (particularly cellular NAT, which is stricter
  than most home networks). Test a real transfer over both Wi-Fi and
  cellular before trusting this for real use.
- **The file-save bridge sends the whole file through the WebView
  bridge as one base64 string.** Fine for everyday file sizes; large
  files (multi-hundred-MB+) will be slow and memory-heavy — base64 adds
  ~33% size overhead and `postMessage` isn't a streaming API. This is
  the same class of limitation as the desktop app's native-save IPC
  call, just tighter given phones have less RAM than desktops.
- **Backgrounding the app mid-transfer will likely drop the connection.**
  Neither iOS nor Android guarantee a WebView keeps running JS timers
  and open WebSocket/WebRTC connections once the app is backgrounded —
  this hasn't been tested, and there's no background-transfer handling
  built in. A transfer probably needs to stay in the foreground to
  reliably complete.
- **No deep-linking wired up yet.** A stored-transfer share link
  (`https://.../s?id=...#v1.key`) opens fine if the person taps it while
  already in the app, but there's no `Linking`/universal-link config to
  open the app directly from a link tapped elsewhere on the phone —
  `app.json`'s `"scheme": "kimo"` is there as a starting point, not a
  finished feature.
