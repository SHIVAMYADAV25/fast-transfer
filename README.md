# fast-transfer

Direct browser-to-browser file transfer over WebRTC. Files never touch the
server — the signaling layer only exchanges tiny SDP/ICE messages to help two
browsers find each other and open a peer connection.

Status: **All PRD milestones built** — two browsers can pair via a code and
transfer files directly over WebRTC (single or, toggle-enabled, up to 4
parallel `RTCPeerConnection`s), with chunking, backpressure, adaptive
windows, live speed/ETA, SHA-256 verification, a `getStats()` benchmark
harness, configurable TURN fallback, and automatic reconnect-and-resume —
**plus stored/async transfers** (croc-style: encrypt locally, upload only
ciphertext, decryption key lives after `#` in the URL, single-download by
default, auto-expires in 24h) for when both people can't be online at once.
See "Known limitations" below for the honest gaps — this is a working MVP
that's been typechecked and built at every step, not a finished product.

## Structure

```
apps/
  web/         Next.js app (Vercel) — UI, WebRTC client, transfer engine
  signaling/   Cloudflare Worker + Durable Object — signaling only
packages/
  protocol/    Shared message types/shapes used by both apps
```

**Before adding anything else, work through `TESTING.md`.** Nothing in this
codebase has been exercised against a real browser, a real WebRTC
connection, or a real R2 bucket yet — every "done" above means "typechecks
and builds," which is real signal but not the same as working.

## Run it locally

**Before touching a browser, run the automated test:**
```bash
cd apps/web
pnpm test:e2e
```
This runs `transfer-e2e-test.mts` — the real `sendFiles()`/`FileReceiver`
production code, exercised end-to-end (including simulated multi-channel
out-of-order delivery) via mock `RTCDataChannel`s in Node. No browser, no
signaling server needed. It already found and fixed one real bug — see
"Recent fixes" below. Takes a few seconds.

You need two terminal tabs — one for signaling, one for the web app.

```bash
# from the repo root
pnpm install

# terminal 1 — signaling worker (Cloudflare Workers local dev)
pnpm dev:signaling
# → runs on http://localhost:8787

# terminal 2 — web app
cp apps/web/.env.local.example apps/web/.env.local
pnpm dev:web
# → runs on http://localhost:3000
```

Open `http://localhost:3000` in two separate browser tabs (or two different
browsers/devices on the same network) to test a transfer:
1. Tab A: drop a file into **Send**, click **Send file**, wait for a code.
2. Tab B: paste that code into **Receive**, hit Enter.
3. Watch the connection establish and the file transfer directly between
   the two tabs — check DevTools → Network to confirm no file bytes hit
   `localhost:8787`.

## Deploying

- **Web app → Vercel.** Set `NEXT_PUBLIC_SIGNALING_HTTP_URL` and
  `NEXT_PUBLIC_SIGNALING_WS_URL` to your deployed Worker's URL
  (e.g. `https://fast-transfer-signaling.<you>.workers.dev`), and
  `NEXT_PUBLIC_APP_URL` to your Vercel domain.
- **Signaling → Cloudflare.** `cd apps/signaling && npx wrangler deploy`.
  Update `wrangler.toml`'s `ALLOWED_ORIGINS` to your real Vercel domain
  before deploying (it currently only allows `localhost:3000`).

## What's actually implemented right now

- Room creation + 3-word pairing code (`apps/signaling/src/code.ts`)
- Durable Object per room, WebSocket Hibernation API, auto-expiry via alarm
  (`apps/signaling/src/room.ts`)
- Full WebRTC offer/answer/ICE exchange (`apps/web/lib/webrtc/peer.ts`)
- Chunked file transfer over `RTCDataChannel` with `bufferedAmount`
  backpressure (`apps/web/lib/webrtc/transfer.ts`)
- Rolling-window rate/ETA calculation
- SHA-256 end-to-end integrity check
- UI matching the reference screenshots: Send/Receive panels, code + QR +
  browser link, progress bar with rate/ETA stat boxes
- **`getStats()` benchmark harness** (`apps/web/lib/webrtc/stats.ts`,
  `components/connection-status.tsx`, `components/benchmark-summary.tsx`):
  polls the RTCPeerConnection every second for RTT and the selected ICE
  candidate pair (tells you direct P2P vs TURN-relayed — useful today even
  with no TURN configured, since it'll clearly show `unknown`/failed rather
  than silently pretending to be direct), and renders a benchmark card
  (size, duration, average/peak throughput, efficiency) after each transfer
  completes.
- **Adaptive sending window** (`lib/webrtc/adaptive.ts`): a simple
  hill-climbing probe (grow while throughput keeps improving, back off once
  it drops, hold once it plateaus) replacing the old fixed 8MiB backpressure
  threshold — this is what PRD §17 actually asked for, driven by real
  measured throughput instead of a guessed constant.
- **Multi-`RTCPeerConnection` parallelism experiment** (`lib/webrtc/multi-peer.ts`):
  the actual fix for the thing flagged earlier when reviewing this PRD —
  opening more `RTCDataChannel`s on *one* `RTCPeerConnection` does **not**
  multiply throughput (they share one SCTP/DTLS/congestion-control state).
  This opens up to `MAX_PARALLEL_CONNECTIONS` (4) fully independent
  `RTCPeerConnection`s, each with its own ICE/DTLS/SCTP handshake and its
  own `AdaptiveWindowController`, and round-robins file chunks across them.
  **It's a checkbox on the Send panel ("Parallel connections, experimental")
  — off by default** — so you can A/B it against the single-connection path
  with the benchmark card above rather than assuming it's a win. The
  receiver doesn't need a matching toggle: it eagerly opens up to 4
  receiver-role connections and just uses whichever ones actually receive
  an offer (see "Known limitations" below for the cost of that choice).
- **TURN fallback** (`lib/webrtc/ice-config.ts`, `components/relay-settings.tsx`,
  `docs/turn-server.md`): WebRTC's ICE already tries direct candidates before
  relayed ones automatically — there's no manual "try P2P, catch, switch to
  TURN" code. The actual work was making a TURN server *configurable*: via
  `NEXT_PUBLIC_TURN_*` env vars (applies to everyone) or the in-app "Relay
  settings" panel matching the reference UI (session-only override, no
  redeploy needed). Cloudflare Workers can't run coturn itself — see
  `docs/turn-server.md` for a docker-compose + `turnserver.conf` you can
  drop on any cheap VPS, plus the production hardening steps (time-limited
  credentials, bandwidth monitoring) you'll want before real traffic.
- **Resume-on-reconnect** (`lib/webrtc/transfer.ts`'s `RESUME_QUERY`/
  `RESUME_STATUS` protocol, `app/page.tsx`'s `attemptReconnect` in both
  panels): if a connection drops mid-transfer, both sides retry with
  backoff (1s/2s/4s, 3 attempts) instead of failing immediately.
  - **Chunk-level resume** happens automatically and needs no special-casing:
    before sending any file, the sender always asks "which chunk indexes do
    you already have for this fileId?" and skips them — this is the *same*
    code path on a first attempt (answer: none) and a resumed one (answer:
    whatever survived the drop), because `FileReceiver` now treats a
    repeated `FILE_METADATA` for the same `fileId` as a no-op instead of
    wiping progress.
  - **Whole-file-level resume** happens at the orchestration layer: the
    sender tracks which files it's fully finished (`onFileFullySent`) and a
    reconnect only re-sends the remaining ones — combined with chunk-level
    resume, a drop mid-way through file 3 of 5 resumes file 3 partway
    through, not files 1–5 from scratch.
  - Fixed a real bug while building this: `FileReceiver` was hardcoded to
    `totalFiles=1`, which would've broken progress/completion tracking for
    any multi-file send. Replaced with a `BATCH_INFO` control message the
    sender sends once up front, so the receiver always knows the true batch
    shape regardless of how many files survive a resume.
- **Stored/async mode** (`lib/store/storecrypto.ts`, `lib/store/storeclient.ts`,
  `apps/signaling/src/store.ts`, `app/s/[id]/page.tsx`) — the croc-style
  "send now, they grab it later" path:
  - Client-side only crypto: one random master key, HKDF-split into
    `manifest`/`data` sub-keys, AES-256-GCM seals everything before it
    leaves the browser. The server (`/store/*` routes on the signaling
    Worker + an R2 bucket) only ever stores and serves ciphertext.
  - The share link (`{appUrl}/s/{id}#v1.{key}`) puts the key after `#` —
    browsers never send URL fragments in HTTP requests, so the key never
    reaches the server, not even in access logs. `app/s/[id]/page.tsx` is
    the actual page a clicked link opens (reads the fragment client-side);
    pasting the same link into the Receive box on the main page works too
    (`parseShareLink` handles both).
  - `StoredTransfer` (a new Durable Object) tracks the
    uploading → available → consumed/revoked/expired lifecycle and does the
    actual R2 cleanup — via `alarm()` on expiry, immediately on revoke, or
    once the download allowance (default: 1) is exhausted after a
    *verified* download (matches the blog's "opening the link does not burn
    it" behavior — a failed/partial download doesn't consume the transfer).
  - The "Store for 1 day" tab on the Send panel (previously a disabled stub)
    is now functional, with a revoke button once uploaded.

## Recent fixes

**A real, silent-data-loss bug in parallel-mode chunk reassembly — found by
an actual end-to-end test, not by reading code.** This is worth describing
in some detail because it's the first bug in this project caught by running
real production code instead of typechecking or reasoning about it:

- `transfer-e2e-test.mts` (`apps/web/`, run with `npx tsx transfer-e2e-test.mts`)
  wires the **real, unmodified** `sendFiles()`/`FileReceiver` from
  `lib/webrtc/transfer.ts` together via mock `RTCDataChannel`s in Node — no
  browser needed, but no reimplementation-for-testing either. One of its
  five scenarios simulates a 4-channel parallel transfer with randomized
  per-channel delivery jitter, deliberately biasing channel 0 (the one
  carrying `FILE_METADATA`) to be the *slowest*.
- That scenario failed intermittently — **not flakily-in-the-uninteresting-
  sense**, but a real bug: when data chunks legitimately arrived on faster
  channels before `FILE_METADATA` arrived on the slow one, `FileReceiver`
  would silently discard those early chunks the moment it processed the
  (late) metadata and reset its chunk array to a freshly-sized empty one.
  The transfer would then either time out waiting for chunks that were
  already received-and-discarded, or complete with a hash mismatch.
- **Fixed** by buffering pre-metadata chunks in a `pendingChunks` map and
  merging them in once metadata arrives, instead of dropping them
  (`FileReceiver`'s `pendingChunks` in `transfer.ts`).
- **Verified the fix, not just the absence of the specific failure message**:
  the exact stress configuration that reproduced the bug ~50-60% of the
  time now passes 35+/35+ consecutive runs. That stress configuration is
  kept permanently in the test (not reverted to something gentler) so a
  regression would get caught again.

This is exactly the kind of bug that only exists in the parallel-connection
path and would never show up in any single-connection testing, which is
part of why the parallel-mode toggle in this app defaults to *off* and is
explicitly framed as something to benchmark and validate, not trust blindly.

**Streaming hash** — the sender no longer blocks on hashing the whole file
before sending the first byte. Also found by re-reading the codebase against
the project's own stated goal ("the file should start moving now"):

- `lib/webrtc/hash.ts` wraps `@noble/hashes`' incremental SHA-256 API
  (`.update()` per chunk, `.digest()` once at the end) — Web Crypto's
  `crypto.subtle.digest()` has no equivalent; it's one-shot only.
- `sendFiles()` in `transfer.ts` is now a producer/consumer pipeline: one
  sequential task reads the file start-to-finish and feeds the running
  hash (hashing *must* see bytes in strict file order), while N parallel
  tasks (one per connection, in parallel mode) pull from per-channel queues
  and actually send — decoupling "must be sequential" from "should be
  parallel" instead of forcing the whole operation to be one or the other.
  (This restructuring is *why* the metadata-race bug above became possible
  to trigger in the first place — worth knowing if you're auditing this
  code further.)
- The file's hash moved from the `FILE_METADATA` message (sent before any
  chunk — but the hash wasn't computed yet, so this required hashing the
  whole file first) to the `TRANSFER_COMPLETE` message (sent after the
  last chunk — computing it exactly here is free, since the producer has
  necessarily already finished reading the whole file by then).
- Verified in isolation too: the incremental hasher was checked against Web
  Crypto's one-shot `digest()` on a 10MB+ deliberately-non-chunk-aligned
  buffer (exact match), and the hand-rolled `AsyncQueue` concurrency
  primitive backing the pipeline was stress-tested against 5 timing
  scenarios before the end-to-end test above existed.

**Run `transfer-e2e-test.mts` yourself** before trusting any further changes
to `transfer.ts`:
```bash
cd apps/web && npx tsx transfer-e2e-test.mts
```
It's not exhaustive — see "Known limitations" for what it doesn't cover —
but it's real signal in a way nothing else in this project has been until now.

## Known limitations (intentional, see PRD)

- **Receiver buffers chunks in memory (as Blob parts), not streaming to
  disk.** File System Access API streaming write is Chromium-only; this
  keeps cross-browser behavior consistent for now. See PRD §19. (Note: the
  sender no longer has this problem — see "Recent fixes" below — but the
  receiver still assembles the full file in memory before the final
  verify-and-download step. Fixing this is the natural next performance
  target once the streaming-hash fix below is confirmed working.)
- **Word list is a small placeholder** (`apps/signaling/src/code.ts`) —
  swap in the full EFF short wordlist (1296 words) before shipping, matching
  croc's approach.
- **No re-request of missing chunks for a file that finished with gaps** —
  the resume protocol covers a *dropped connection* mid-file well (that's
  the common case), but if `TRANSFER_COMPLETE` arrives while a few chunks
  are still missing (e.g. one straggling parallel channel) and the brief
  grace period in `finishCurrentFile` still isn't enough, the file fails
  outright rather than the receiver proactively asking for just those
  specific indexes. A small addition to the existing `RESUME_QUERY`
  mechanism (receiver-initiated instead of only sender-initiated) would
  close this gap.
- **Retry budget (3 attempts, 1/2/4s backoff) is shared across the whole
  transfer**, not reset per-drop. Simple and predictable, but a transfer
  with several independent brief drops over a long download could
  exhaust it faster than a transfer with one bad drop — worth revisiting
  once there's real usage data on how often this actually happens. This
  budget now covers *both* RTCPeerConnection drops and full
  signaling-socket drops (they share the same counter) — a transfer that
  hits one of each only gets 3 total attempts, not 3 of each.
- **TURN, if configured, defaults to a static long-term credential** in the
  example `turnserver.conf` — fine for testing your own setup, a real
  liability in production (anyone who gets the credential can relay
  unlimited traffic through your server indefinitely). Switch to coturn's
  REST API auth with short-lived tokens before pointing this at real users
  — see `docs/turn-server.md`.
- **Stored mode's cleanup only knows a chunk count after `/complete` is
  called.** An abandoned upload (browser closed mid-upload, never calls
  `/complete`) leaves its already-uploaded R2 objects orphaned until you
  manually sweep them — the `StoredTransfer` Durable Object's `alarm()`
  still fires and deletes the manifest key, but can't know how many
  `chunk:*` keys to delete without a completed manifest. Tracking chunk
  uploads incrementally (increment a counter in the DO on every successful
  `PUT`, not just at `/complete`) would close this — noted directly in
  `store.ts`'s `deleteObjects`.
- **Stored mode has no upload progress via native browser APIs** — each
  chunk `PUT` is a separate `fetch()`, and progress updates after each one
  completes rather than continuously mid-request (fetch doesn't expose
  upload progress events; `XMLHttpRequest` does, but wasn't worth the extra
  complexity for the chunk sizes involved here, ~4 MiB).
- **The "code" shown for a stored transfer is a raw hex id**, not a
  memorable phrase — `CodeDisplay`'s copy ("Use this code:") was written
  for the live 3-word codes and doesn't quite fit stored links. Cosmetic,
  not functional — the actual shareable link is correct either way.
- **Stored transfers aren't wired into the resume-on-reconnect system** —
  a dropped connection mid-*upload* currently just fails; the sender would
  need to restart the "Store" flow from scratch. Live transfers' resume
  logic doesn't apply here since stored mode isn't a live peer connection —
  a proper fix would be per-chunk upload retry with backoff, not full
  session resume.

## Next steps, in order (per the PRD)

1. ~~Build the `getStats()` benchmark harness (PRD §10)~~ — done.
2. ~~Adaptive chunk size / send window based on real numbers~~ — done
   (`lib/webrtc/adaptive.ts`).
3. ~~Multi-`RTCPeerConnection` parallelism experiment (PRD §8)~~ — done,
   behind a toggle (`lib/webrtc/multi-peer.ts`). **Not yet benchmarked against
   the single-connection path on a real cross-network transfer — do that
   before turning it on by default.**
4. ~~TURN fallback for the ~10–20% of pairs that can't do direct P2P~~ —
   done (`lib/webrtc/ice-config.ts` + `docs/turn-server.md`). **STUN-only by
   default** — you need to actually stand up a coturn instance (or point at
   a managed provider) and set the env vars / Relay settings panel for this
   to do anything. Also still needs the production hardening steps in
   `docs/turn-server.md` (time-limited credentials especially) before real
   traffic — static credentials are fine for testing, not for shipping.
5. ~~Resume-on-reconnect~~ — done (`lib/webrtc/transfer.ts`'s
   `RESUME_QUERY`/`RESUME_STATUS` protocol + `attemptReconnect` in both
   panels). Closes the old "no re-request of missing chunks" gap for the
   dropped-connection case specifically; the narrower "file finished with a
   few straggling chunks" case (no drop, just stragglers) is still open —
   see "Known limitations" above.
6. ~~Small `CONFIG` signaling message~~ — done. The sender now tells the
   receiver exactly how many `RTCPeerConnection`s to expect
   (`waitForConfig` in `page.tsx`, `waitForMessage` in
   `lib/signaling/client.ts`) instead of the receiver eagerly opening
   `MAX_PARALLEL_CONNECTIONS` and pruning unused slots. Falls back to the
   old eager-open behavior after a 3s timeout if no `CONFIG` arrives (e.g.
   an older/incompatible sender), so this is backward-compatible rather
   than a breaking change.
7. ~~Full signaling-reconnect~~ — done. Both panels now check
   `signaling.isConnected()` before re-establishing peer connections on a
   drop; if the WebSocket itself died (not just the `RTCPeerConnection`),
   they rebuild a fresh `SignalingClient` against the same room (rooms
   outlive a single socket disconnect on the Durable Object side — see
   `room.ts`) before retrying. The sender specifically waits for the room's
   `PEER_JOINED` confirmation again rather than assuming the receiver is
   still there — calling `establishAndRun()` immediately after a signaling
   reconnect would silently go nowhere if the receiver's socket isn't
   registered in the room yet (a real bug caught and fixed while building
   this, not a hypothetical).
8. ~~Stored/async mode~~ — done (`lib/store/`, `apps/signaling/src/store.ts`,
   `app/s/[id]/page.tsx`). Needs, before real traffic:
   - `wrangler r2 bucket create fast-transfer-store` (not automatic —
     see `apps/signaling/wrangler.toml`'s comment on the R2 binding)
   - Incremental chunk-upload tracking in `StoredTransfer`, to fix the
     orphaned-R2-objects-on-abandoned-upload gap above
   - Per-chunk upload retry with backoff (a dropped connection mid-upload
     currently just fails the whole stored-transfer attempt)

## Deploying stored mode specifically

The R2 bucket referenced in `apps/signaling/wrangler.toml` doesn't exist
until you create it:

```bash
cd apps/signaling
npx wrangler r2 bucket create fast-transfer-store
```

Everything else deploys the same way as before (`wrangler deploy`) — the
new `StoredTransfer` Durable Object and `/store/*` routes ship in the same
Worker as the live-transfer signaling.
