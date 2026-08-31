# Manual Test Checklist

Nothing in this codebase has touched a real browser, a real WebRTC
connection, or a real R2 bucket yet — everything so far has only passed a
compiler and a dry-run deploy. That's real signal, but it's not the same as
working. Work through this checklist **in order** before adding anything
else. Each section assumes the previous one passed.

Fix what breaks before moving to the next section. If something in section 3
breaks, it's more valuable to fix it than to discover sections 4–7 also
depend on the same broken assumption.

---

## 0. Setup

```bash
pnpm install
```

Terminal 1:
```bash
pnpm dev:signaling
# should print a local URL, typically http://localhost:8787
```

Terminal 2:
```bash
cp apps/web/.env.local.example apps/web/.env.local
pnpm dev:web
# http://localhost:3000
```

**Checkpoint:** both dev servers start with no errors in their terminal
output. If `wrangler dev` complains about Durable Objects or R2 bindings, fix
that before continuing — nothing downstream will work otherwise.

---

## 1. Basic live transfer (single connection, same machine)

Open **two browser tabs** at `localhost:3000` (same browser is fine for this
first pass — Chrome is the priority target per the PRD).

1. Tab A: drop a small file (a few KB — a text file is fine) into **Send**.
2. Click **Send file**. A 3-word code should appear within ~1 second.
3. Tab B: paste the code into **Receive**, press Enter.
4. **Watch for:**
   - [ ] Tab A shows "Waiting for recipient…" then transitions to "Opening encrypted data channels…" once Tab B joins
   - [ ] Both tabs show a `ConnectionStatus` pill — does it say **Direct P2P**? (It should, same machine.)
   - [ ] Progress bars move on both sides
   - [ ] Tab B actually downloads a file (check your Downloads folder / browser download bar)
   - [ ] The downloaded file's content matches the original exactly (open both, diff them)
   - [ ] Tab B shows "✓ All files received and verified"
   - [ ] The `BenchmarkSummary` card renders with non-garbage numbers (not `NaN`, not `Infinity`)

**If this section fails**, check browser DevTools console on both tabs first
— most likely failure points are the signaling WebSocket URL
(`NEXT_PUBLIC_SIGNALING_*` in `.env.local`) or a CORS rejection from the
Worker (`ALLOWED_ORIGINS` in `wrangler.toml`).

---

## 2. Larger file (real chunking + backpressure)

Repeat section 1 with a **100MB+ file**.

- [ ] **Progress starts moving within ~1 second of clicking Send file, not
      after a multi-second pause.** This is the specific thing the
      streaming-hash fix (see README's "Recent fixes") was built to fix —
      before that fix, the sender would silently hash the entire file
      before sending byte one, which for a large file meant real dead time
      with zero user feedback. Use an even bigger file (1GB+) here if you
      want to make this obvious — the old behavior would have been a
      several-second stall before the progress bar even appeared.
- [ ] Rate/ETA numbers update continuously, not just at the end
- [ ] Browser tab doesn't freeze or become unresponsive during transfer
- [ ] Memory usage (DevTools → Performance/Memory) doesn't balloon to the
      full file size — chunking should keep it bounded
- [ ] Transfer actually completes and hash-verifies — this now depends on
      the *receiver's* one-shot `crypto.subtle.digest()` matching the
      *sender's* incremental `@noble/hashes` digest exactly; these are two
      different implementations computing what should be the same SHA-256,
      so a real end-to-end pass here is the actual proof they agree (a
      Node-side unit test already confirmed they agree in principle — see
      README — but that's not the same as this exact code path running)

**Known risk area:** `AdaptiveWindowController` in `adaptive.ts` has never
run against real throughput data. Watch the "Window" stat in the progress
card — does it move at all, or stay pinned at the 4MiB starting value the
whole time? If it never adjusts, the `maybeAdjust` throttle logic or the
rate-change threshold may need tuning.

---

## 3. Cross-network transfer (the actual point of this app)

Repeat section 1 with the two tabs on **genuinely different networks** —
laptop on home Wi-Fi + phone on cellular, or two different physical
locations. This is the scenario the whole PRD is about; same-machine testing
in sections 1–2 proves the code paths execute, not that P2P actually works
across NAT.

- [ ] `ConnectionStatus` still shows **Direct P2P** (most home/mobile network
      pairs should manage this via STUN alone)
- [ ] If it shows **Relayed** or never connects: expected without TURN
      configured — this is what section 5 is for, not a bug
- [ ] Note the RTT shown — sanity check it against reality (a same-country
      transfer should be double-digit ms, not 3 digits)
- [ ] Record the benchmark numbers somewhere — this is your first real data
      point for whether `CHUNK_SIZE` (256 KiB in `transfer.ts`) is a
      reasonable default or needs adjusting

---

## 4. Parallel connections toggle

**Before doing this manually, run `npx tsx transfer-e2e-test.mts` (from
`apps/web/`) if you haven't already.** This exact scenario — chunk
reassembly across multiple parallel channels with out-of-order delivery —
used to be the highest-risk *untested* path in the codebase. It's no longer
untested: that script simulates it directly (with randomized delivery
jitter deliberately biased to stress the worst-case timing) and already
found and fixed a real silent-data-loss bug there (see README's "Recent
fixes"). It's not a substitute for the real-browser test below — it proves
`FileReceiver`'s reassembly logic is correct in principle, not that the
actual WebRTC wiring around it behaves the same way — but it means a
failure here now more likely points at something browser/WebRTC-specific
rather than the chunk logic itself.

Repeat section 3 with **"Parallel connections (4x)"** checked on the sender.

- [ ] All 4 connections actually establish (check `chrome://webrtc-internals`
      in a Chromium tab — you should see 4 separate `RTCPeerConnection`
      entries, not 1)
- [ ] Transfer still completes and hash-verifies
- [ ] **Compare the benchmark card's Average/Peak numbers against section 3's
      single-connection numbers.** This is the actual question this feature
      exists to answer — do not assume parallel is faster without this
      comparison. It may not be, especially on a fast/low-latency link where
      one connection was already saturating available bandwidth.

**If chunk reassembly fails** (downloaded file doesn't match / hash
mismatch) despite `transfer-e2e-test.mts` passing, the bug is likely
specific to real WebRTC timing/behavior rather than the reassembly logic
itself — worth first checking whether `chrome://webrtc-internals` shows
anything unusual about the 4 connections (wildly different RTTs, one
failing ICE restart mid-transfer, etc.) before assuming it's the same class
of bug as the one already fixed.

---

## 5. TURN fallback

Requires a real coturn instance — see `docs/turn-server.md`. If you don't
have one yet, stand up the cheapest version (single VPS, static credential)
just for this test; harden it later per that doc before real traffic.

1. Open the **Relay settings** panel at the bottom of the page.
2. Enter your TURN URL/username/credential, click **Apply for this session**.
3. Repeat section 3. This time, deliberately force a relay by testing from
   a network known to block direct WebRTC (many corporate/university
   networks do), or by setting `iceTransportPolicy: "relay"` temporarily in
   `peer.ts` to force it for testing purposes (revert after).

- [ ] `ConnectionStatus` shows **Relayed**
- [ ] Transfer still completes correctly through the relay
- [ ] Check your coturn server's logs — does it show the relayed session?
- [ ] Confirm bandwidth actually flowed through the VPS (check its network
      usage) — this is the cost model the PRD is built around, worth
      seeing it happen once

---

## 6. Resume-on-reconnect

This is the least-tested code path in the entire project — it was written
and typechecked but never run. Test **two distinct failure modes**
separately, since they now take different code paths:

**6a. RTCPeerConnection drop, signaling WebSocket survives** (the common
case — brief Wi-Fi hiccup, NAT rebinding):

1. Start a large-file transfer (section 2 or 3 scale).
2. Partway through, **kill the network on one side** — turn off Wi-Fi,
   unplug ethernet, or use DevTools' network throttling set to "Offline"
   for ~5 seconds, then restore it.
3. **Watch for:**
   - [ ] The UI shows "Connection dropped — attempting to reconnect and
         resume…" (the `reconnecting` phase)
   - [ ] It actually reconnects within the 1s/2s/4s backoff window
   - [ ] Progress **does not reset to 0** — it should resume from
         approximately where it left off, not restart the file
   - [ ] The transfer eventually completes and hash-verifies correctly
         despite the interruption

**6b. Full signaling-socket drop** (both the WS and the RTCPeerConnection
die — e.g. actually toggling airplane mode, or closing/reopening the
laptop lid):

1. Same setup as 6a, but this time close the tab's network connection hard
   enough that the WebSocket itself drops (airplane mode is more reliable
   for this than DevTools throttling, which sometimes only simulates the
   data path, not the WS).
2. **Watch for everything in 6a, plus:**
   - [ ] Check `signaling.isConnected()`'s code path actually triggered —
         add a temporary `console.log` in `attemptReconnect` if needed to
         confirm the `!signaling.isConnected()` branch ran rather than the
         WS having silently survived
   - [ ] The sender specifically should show "waiting" phase briefly after
         reconnecting signaling (it's re-waiting for the room's
         `PEER_JOINED` confirmation) rather than immediately erroring
   - [ ] If **both** sides drop simultaneously and both reconnect, do they
         actually re-pair? This is the least-exercised scenario of all —
         the room's `room.ts` is designed to handle it (a reconnecting
         role's socket replaces the old one, and `PEER_JOINED` fires once
         both are present again) but has never been tested end-to-end

**This is where I'd bet the highest chance of finding a real bug.** The
`RESUME_QUERY`/`RESUME_STATUS` handshake in `transfer.ts`, the
`onFileFullySent` checkpoint tracking in `page.tsx`, and the assumption that
the signaling WebSocket survives a brief network drop have all only been
reasoned about, never executed. If it fails outright (transfer just dies, no
resume attempt), check that `onConnectionStateChange` is actually firing —
some browsers are slow to transition a `RTCPeerConnection` to `failed` after
a network drop, sometimes taking 20-30+ seconds, which could exceed a naive
test's patience.

---

## 7. Stored/async mode

The newest and least-verified subsystem — R2 has never been touched by
actual running code, only typechecked.

1. `cd apps/signaling && npx wrangler r2 bucket create fast-transfer-store`
   (one-time, if not already done)
2. Sender: switch to **"Store for 1 day"** tab, select a file, click
   **Upload & get link**.
3. **Watch for:**
   - [ ] Upload progress actually updates (not stuck at 0% until the end)
   - [ ] A share link appears on completion
   - [ ] Check the R2 bucket (Cloudflare dashboard, or
         `wrangler r2 object list fast-transfer-store`) — are `manifest:*`
         and `chunk:*` objects actually there?
4. **Open the share link in a fresh incognito/private window** (simulates
   "different person, different session" — this is the actual test of
   whether the `/s/[id]` page and the `#`-fragment key-passing works, since
   a same-tab test wouldn't catch a server-side leak of the fragment).
   - [ ] The review screen shows the correct file name/size
   - [ ] Clicking **Download** actually decrypts and downloads a working file
   - [ ] The downloaded file's hash matches the original
5. **Single-download enforcement:** try opening the *same* share link again
   after a successful download.
   - [ ] It should now report `consumed` — if it lets you download again,
         the DO's `/commit` decrement logic or the default `maxDownloads: 1`
         has a bug
6. **Revoke:** upload a second file, click **Revoke now** before anyone
   downloads it, then try opening that share link.
   - [ ] Should report `revoked`, and the R2 objects should actually be
         gone (check the bucket)

**Highest-risk area here:** the AES-GCM seal/open round-trip in
`storecrypto.ts` was fixed for a TypeScript strictness issue right before
this checklist was written (the `bufferSource()` cast) — worth specifically
confirming decryption actually produces correct bytes and doesn't just
silently produce garbage that happens to pass a build.

---

## After this checklist

Whatever fails, fix it before touching anything on the "Next steps" list in
`README.md`. A codebase where every existing feature actually works is more
valuable than one with more typechecked-but-unverified features stacked on
top. If everything above passes, *then* it's reasonable to move on to the
`CONFIG` signaling message, full signaling-reconnect, or the R2 cleanup
improvements documented in the README's "Known limitations."
