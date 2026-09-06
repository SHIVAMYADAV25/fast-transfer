/** @type {import('next').NextConfig} */

// The web app (Vercel) and the desktop app (Tauri) are built from this
// exact same Next.js project. Vercel gets the normal server-rendered
// build; the desktop build sets BUILD_TARGET=desktop (see
// apps/desktop/src-tauri/tauri.conf.json's beforeBuildCommand /
// package.json's "build:desktop" script) to produce a static `out/`
// folder that Tauri's webview can load with no Node server behind it.
const isDesktopBuild = process.env.BUILD_TARGET === "desktop";

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@kimo/protocol"],
  ...(isDesktopBuild
    ? {
        output: "export",
        // Static export can't use the default Image Optimization API
        // (there's no server to run it) — the app doesn't need it since
        // all images are local, hand-drawn PNGs served as-is.
        images: { unoptimized: true },
        // Tauri serves the exported site from a local file/embedded
        // server, not from a subpath — keep asset URLs relative.
        trailingSlash: true,
      }
    : {}),
};

module.exports = nextConfig;
