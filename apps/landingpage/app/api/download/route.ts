import { NextRequest } from 'next/server';

// This route must run on the Node.js runtime (not Edge) because we stream
// large binary files and need Node's fetch/Response body piping.
export const runtime = 'nodejs';

// ------------------------------------------------------------------------
// Config
// ------------------------------------------------------------------------
// Update this if the repo ever moves.
const GITHUB_OWNER_REPO = 'SHIVAMYADAV25/fast-transfer';

// Optional. Only required if the repo (or its releases) are private.
// Set in your deployment's environment variables — NEVER commit this.
// Needs at least "Contents: Read" access on the repo (a fine-grained PAT works).
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Required for the Android download to work. After every new EAS build:
//   1. Open the build page (the one `eas build` prints at the end).
//   2. Click the "Install" / download button on that page — it resolves to
//      the real signed binary URL (something like https://d1abc...cloudfront.net/... or
//      https://artifacts.expo.dev/...). Copy THAT url, not the expo.dev build page url.
//   3. Put it in ANDROID_APK_URL in your environment variables.
// These signed URLs can expire after a while, so refresh this whenever
// downloads start failing.
const ANDROID_APK_URL = process.env.ANDROID_APK_URL;

// Each desktop platform is resolved by matching a stable substring in the
// release asset's filename, so this keeps working release after release
// even though the version number embedded in the filename changes
// (e.g. Kimo_0.1.0_x64-setup.exe -> Kimo_0.2.0_x64-setup.exe).
const DESKTOP_MATCHERS: Record<string, { includes: string; downloadName: string }> = {
  windows: { includes: '-setup.exe', downloadName: 'Kimo-Setup.exe' },
  'mac-arm': { includes: 'aarch64.dmg', downloadName: 'Kimo-macOS-AppleSilicon.dmg' },
  'mac-intel': { includes: '_x64.dmg', downloadName: 'Kimo-macOS-Intel.dmg' },
  'linux-appimage': { includes: '.AppImage', downloadName: 'Kimo-Linux.AppImage' },
  'linux-deb': { includes: 'amd64.deb', downloadName: 'Kimo-Linux.deb' },
  'linux-rpm': { includes: '.x86_64.rpm', downloadName: 'Kimo-Linux.rpm' },
};

function githubHeaders(accept: string) {
  const headers: Record<string, string> = {
    Accept: accept,
    'User-Agent': 'kimo-landingpage-download-proxy',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  return headers;
}

async function streamDesktopAsset(platformKey: string): Promise<Response> {
  const matcher = DESKTOP_MATCHERS[platformKey];
  if (!matcher) {
    return new Response('Unknown platform', { status: 400 });
  }

  // Listing releases (rather than /releases/latest) means this still works
  // even while a release is sitting as a draft, as long as GITHUB_TOKEN
  // belongs to someone with access to the repo. Newest first by default.
  const releasesRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER_REPO}/releases?per_page=5`,
    { headers: githubHeaders('application/vnd.github+json'), cache: 'no-store' }
  );

  if (!releasesRes.ok) {
    return new Response('Could not reach the release source right now.', { status: 502 });
  }

  const releases: Array<{ assets: Array<{ name: string; url: string; size: number }> }> =
    await releasesRes.json();

  const latestWithAsset = releases.find((r) =>
    r.assets?.some((a) => a.name.includes(matcher.includes))
  );
  const asset = latestWithAsset?.assets.find((a) => a.name.includes(matcher.includes));

  if (!asset) {
    return new Response('That build is not available yet.', { status: 404 });
  }

  // Fetching the asset by its API url (not browser_download_url) with
  // Accept: application/octet-stream is what lets this work for private
  // repos/draft releases too, as long as GITHUB_TOKEN has access.
  const assetRes = await fetch(asset.url, {
    headers: githubHeaders('application/octet-stream'),
    cache: 'no-store',
  });

  if (!assetRes.ok || !assetRes.body) {
    return new Response('Failed to download the build.', { status: 502 });
  }

  return new Response(assetRes.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${matcher.downloadName}"`,
      ...(asset.size ? { 'Content-Length': String(asset.size) } : {}),
      'Cache-Control': 'no-store',
    },
  });
}

async function streamAndroidApk(): Promise<Response> {
  if (!ANDROID_APK_URL) {
    return new Response(
      'Android build link is not configured yet (set ANDROID_APK_URL).',
      { status: 503 }
    );
  }

  const apkRes = await fetch(ANDROID_APK_URL, { cache: 'no-store' });

  if (!apkRes.ok || !apkRes.body) {
    return new Response('Failed to download the Android build.', { status: 502 });
  }

  return new Response(apkRes.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="Kimo.apk"',
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(request: NextRequest) {
  const platform = request.nextUrl.searchParams.get('platform') ?? '';

  try {
    if (platform === 'android') {
      return await streamAndroidApk();
    }
    if (platform in DESKTOP_MATCHERS) {
      return await streamDesktopAsset(platform);
    }
    return new Response('Unknown platform', { status: 400 });
  } catch (err) {
    console.error('download proxy error:', err);
    return new Response('Something went wrong preparing that download.', { status: 500 });
  }
}