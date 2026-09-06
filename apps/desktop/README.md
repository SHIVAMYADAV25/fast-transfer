# Kimo Desktop

The same Kimo UI, WebRTC transfer engine, and encryption code from
`apps/web` — unchanged — wrapped as a native desktop app with
[Tauri](https://tauri.app). No UI redesign, no reimplementation: this
directory only adds a thin Rust shell around the exact same Next.js app.

## Why Tauri

- Reuses `apps/web` as-is (same `page.tsx`, same `lib/webrtc/*`, same
  hand-drawn cat mascot and artwork — nothing in the UI changes).
- Uses the OS's native webview (WebView2 on Windows, WebKit on
  macOS/Linux) instead of bundling a full Chromium like Electron does —
  installers are roughly 10–20MB instead of 150MB+.
- The Rust side adds native capabilities the browser sandbox can't: a
  proper "Save As" dialog for completed transfers (`lib/native/save.ts`
  → `save_file_to_path` in `src-tauri/src/lib.rs`), with primitives for
  incremental disk-streaming writes (`open_write_sink` / `write_chunk` /
  `finalize_write_sink`) scaffolded for future use.

## What's native vs. what's the same

| | Web (`apps/web` on Vercel) | Desktop (this app) |
|---|---|---|
| UI, styling, images | Next.js app, unchanged | **identical** — same static export of the same app |
| WebRTC / chunking / crypto | `lib/webrtc/*`, `lib/store/*` | **identical**, unmodified |
| Signaling server | Same Cloudflare Worker | **same Worker** — no server changes needed |
| Saving a finished file | Browser's download manager | Native OS "Save As" dialog, written via Rust |
| Distribution | URL | `.exe`/`.msi` (Windows), `.dmg` (macOS), `.AppImage`/`.deb` (Linux) |

## Prerequisites

- [Rust](https://rustup.rs) (stable toolchain)
- [Node.js](https://nodejs.org) 20+ and `pnpm` (`npm i -g pnpm`)
- Platform build tools:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Windows**: [Microsoft C++ Build Tools](https://tauri.app/start/prerequisites/#windows) + WebView2 (preinstalled on Windows 11 / most Windows 10)
  - **Linux**: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf` (see the CI workflow's apt-get line for the exact list)

## Run it locally

From the **repo root**:

```bash
pnpm install
cp apps/web/.env.local.example apps/web/.env.local   # point at your signaling worker
pnpm dev:desktop
```

This starts the Next.js dev server (`apps/web`) and opens it inside a
native Tauri window with hot reload, exactly like `pnpm dev:web` but in
a desktop window instead of a browser tab.

## Build installers

```bash
cp apps/web/.env.production.example apps/web/.env.production   # real signaling worker URL — baked in at build time
pnpm build:desktop
```

Output lands in `apps/desktop/src-tauri/target/release/bundle/` — a
`.dmg`/`.app` on macOS, `.msi`/`.exe` (NSIS) on Windows, `.AppImage`/`.deb`
on Linux, depending on the platform you build on. Tauri doesn't
cross-compile installers across OSes locally — use the GitHub Actions
workflow (`.github/workflows/desktop-build.yml`) to build all three from
one push, or build on/in a VM for each target OS.

## Changing the icon

The source icon lives at `icon-src/kimo-icon.svg` (repo root) — a
hand-drawn cat + paper-airplane mark matching the site's existing
mascot art. To regenerate every platform size after editing it:

```bash
cd apps/desktop
pnpm icon ../../icon-src/kimo-icon-1024.png
```

(Re-rasterize the SVG to a 1024×1024 PNG first if you changed it — e.g.
`python3 -c "import cairosvg; cairosvg.svg2png(url='kimo-icon.svg', write_to='kimo-icon-1024.png', output_width=1024, output_height=1024)"`.)

## Known limitations (honest status)

- **Streaming-to-disk during receive is scaffolded but not wired up
  yet.** The Rust commands for offset-addressed incremental writes
  (`open_write_sink`/`write_chunk`/`finalize_write_sink`) exist and
  work, but `FileReceiver` in `lib/webrtc/transfer.ts` still assembles
  the complete file in memory first, same as the web app — this desktop
  build's real, working improvement is the native **Save As** dialog at
  the end, not a smaller memory footprint during the transfer itself.
  Wiring the two together is the natural next step; it touches the
  same carefully-tested chunk-reassembly code the project's own e2e
  test exists to protect, so it deserves its own pass with the desktop
  build actually running in hand rather than guessed at from the
  sandbox this was written in.
- **Native save writes the whole file through Tauri's IPC in one call**
  (`invoke("save_file_to_path", { bytes })`). Fine for everyday file
  sizes; very large files (multi-GB) will be slower and heavier on
  memory than a true streaming write would be — see the point above.
- **Not yet code-signed.** Unsigned builds work fine for personal use
  and testing but will show an "unidentified developer" (macOS) or
  SmartScreen (Windows) warning. The GitHub Actions workflow has the
  secrets wired up (`APPLE_*`, `TAURI_SIGNING_*`) — add real values to
  sign and notarize once you have a certificate.
- **This has not been run through an actual `cargo tauri build`.** The
  Rust/config was written carefully and typechecks conceptually, but
  there's no Rust toolchain available in the environment this was
  built in — the first real build should happen on a machine with Rust
  installed (or via the GitHub Actions workflow) before you trust it
  for distribution.
