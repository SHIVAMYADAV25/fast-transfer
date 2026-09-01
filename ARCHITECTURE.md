# fast-transfer — Architecture

This document explains exactly how this repository works: every file's job,
every network hop, every route, and specifically what makes it fast. Read
this and you should understand the whole system without opening the code —
though the code itself is the source of truth if the two ever disagree.

**One-sentence summary:** two browsers exchange a short code, use a
Cloudflare-hosted signaling server to introduce themselves to each other,
then open a direct WebRTC connection and stream the file straight between
them — the server only ever sees a handful of small setup messages, never
the file itself.

---

## 1. The core idea, in one diagram

```
                    SIGNALING ONLY (small JSON messages)
   Sender Browser  ───────────────────────────────────  Cloudflare Worker
        │                                                  (+ Durable Object)
        │                                                       │
        │                                                       │
        │            SIGNALING ONLY                             │
        └──────────────────────────────────────────────────── Receiver Browser
        │
        │  FILE DATA — direct WebRTC, peer-to-peer
        └──────────────────────────────────────────────────►  Receiver Browser
```

The server's job ends the moment the two browsers have exchanged enough
information to find each other directly. After that, file bytes travel
**peer-to-peer** — sender's upload speed and receiver's download speed are
the only ceiling, not any server's bandwidth. This one architectural
decision is *why* the system can be fast and cheap to run at the same time:
there's no server in the middle paying to relay gigabytes of file data.

---

## 2. Repository layout

```
fast-transfer/
├── apps/
│   ├── web/            Next.js app — the actual UI + all WebRTC/crypto logic
│   └── signaling/       Cloudflare Worker — introduces the two browsers, nothing else
├── packages/
│   └── protocol/         Shared TypeScript types both apps import, so their
│                          message formats can never silently drift apart
├── docs/
│   └── turn-server.md   How to self-host a TURN relay (only needed as a fallback)
├── TESTING.md           Manual test checklist for real-browser verification
└── README.md            Setup instructions + running log of fixes/decisions
```

Two independently-deployable apps, one shared types package. `apps/web`
goes to Vercel (or any Next.js host). `apps/signaling` goes to Cloudflare
Workers. They talk to each other only over the small HTTP/WebSocket API
described in §5.

---

## 3. File-by-file reference

### `packages/protocol/src/index.ts`
The single source of truth for every message shape that crosses a wire in
this system — signaling messages, transfer control messages, stored-transfer
API shapes, error codes. Both `apps/web` and `apps/signaling` import from
here. If you're trying to understand what a message *looks like* on the
wire, this file has the answer, not the code that sends it.

### `apps/signaling/src/index.ts`
The Cloudflare Worker's HTTP entry point. Every route in the system (§5)
is dispatched from here. It does almost no work itself — for anything
stateful (a room, a stored transfer) it looks up the right Durable Object
and forwards the request to it. This file also holds the CORS handling
(`ALLOWED_ORIGINS`).

### `apps/signaling/src/room.ts` — the `TransferRoom` Durable Object
One instance of this class exists **per active live transfer**. It holds
at most two WebSocket connections (tagged `"sender"` / `"receiver"`) and
does exactly three things:
1. Matches the two sockets by room ID.
2. Forwards `CONFIG` / `OFFER` / `ANSWER` / `ICE_CANDIDATE` messages between
   them verbatim, without ever inspecting their contents beyond the `type` field.
3. Expires itself (via a Durable Object `alarm()`) after the room's TTL.

It uses the **WebSocket Hibernation API**, which is why this is cheap to
run: Cloudflare can evict an idle room from memory between messages and
wake it back up on demand, so an open-but-silent room doesn't cost
continuous compute.

### `apps/signaling/src/store.ts` — the `StoredTransfer` Durable Object
One instance per **stored (async)** transfer. Tracks only metadata —
expiry, download allowance, a hashed revoke token, and (once upload
finishes) the chunk count. It never touches file bytes; those live in R2
(§8). It's also responsible for actually deleting the R2 objects once a
transfer is consumed, revoked, or expires.

### `apps/signaling/src/code.ts`
Generates the human-facing pairing code (`mango-hunt-rage`) and hashes it
down to an opaque room ID. Splitting "what the person types" from "what
keys the Durable Object lookup" means the literal words never need to be
treated as sensitive server-side state.

### `apps/web/app/page.tsx`
The entire UI lives in one file: a `SendPanel` and a `ReceivePanel`
component, side by side. This is intentionally not split into many small
files — the send/receive flows each have a lot of interdependent state
(connection objects, timers, phase machines) that's easier to reason about
linearly than scattered across a dozen files. It's the **orchestrator**:
it owns no networking logic itself, just wires together the pieces from
`lib/` in response to user actions and network events.

### `apps/web/app/s/[id]/page.tsx`
The page a **stored-transfer share link** actually opens
(`{appUrl}/s/{id}#v1.{key}`). Reads the decryption key from the URL
fragment client-side (see §8 for why that matters), fetches and decrypts
the manifest, and lets the person review file names/sizes before
downloading.

### `apps/web/lib/webrtc/peer.ts` — `PeerConnection`
Wraps exactly one `RTCPeerConnection`. Handles the offer/answer/ICE
exchange, exposes the resulting `RTCDataChannel`, and exposes two pieces
of live connection info other code needs: `getStats()` (for the benchmark
card) and `getMaxMessageSize()` (the real negotiated SCTP limit — see §7.4).

### `apps/web/lib/webrtc/multi-peer.ts`
Orchestrates **multiple independent `PeerConnection`s** between the same
two browsers — the parallel-connections experiment (§7.3). Also home to
`MAX_PARALLEL_CONNECTIONS` (currently 4).

### `apps/web/lib/webrtc/transfer.ts`
The actual file-transfer engine. Exports:
- `sendFiles()` — reads a file, hashes it, chunks it, sends it, with
  backpressure, adaptive windowing, and resume support.
- `FileReceiver` — reassembles incoming chunks into a file, verifies its
  hash, handles resume queries and cancellation.
- `resolveChunkSize()` — computes a safe per-connection chunk size (§7.4).
- `downloadFile()` — triggers the browser's native download for a
  reassembled file.

This is the most important file in the repo if you want to understand how
a transfer actually works — read §4 alongside it.

### `apps/web/lib/webrtc/adaptive.ts` — `AdaptiveWindowController`
A simple hill-climbing probe that grows or shrinks the sender's
backpressure window based on measured throughput, instead of using one
fixed guess for every network (§7.2).

### `apps/web/lib/webrtc/hash.ts`
Wraps `@noble/hashes`' **incremental** SHA-256 API. Exists because Web
Crypto's `crypto.subtle.digest()` is one-shot only — it can't hash data as
it streams in, which is what `sendFiles()` needs (§7.1).

### `apps/web/lib/webrtc/stats.ts` — `StatsMonitor`
Polls `RTCPeerConnection.getStats()` every second and extracts the two
numbers that matter for judging performance: RTT, and whether the winning
ICE candidate pair is direct or relayed.

### `apps/web/lib/webrtc/ice-config.ts`
Builds the ICE server list (STUN always; TURN if configured via env vars
or the in-app "Relay settings" panel). See §9.

### `apps/web/lib/signaling/client.ts` — `SignalingClient`
Thin WebSocket wrapper around the room's signaling channel. Also exports
`waitForMessage()`, a small helper used for the `CONFIG` handshake.
Everything sent through here is small JSON — never file bytes.

### `apps/web/lib/store/storecrypto.ts` / `storeclient.ts`
Client-side encryption and upload/download orchestration for stored
transfers. See §8.

### `apps/web/components/*.tsx`
Presentation only — `FileDropzone`, `CodeDisplay`, `TransferProgress`,
`ConnectionStatus`, `BenchmarkSummary`, `RelaySettings`. None of these
contain networking logic; they render props and call callbacks.

### `apps/web/transfer-e2e-test.mts`
A real integration test — runs the **actual, unmodified** `sendFiles()`/
`FileReceiver` against mock `RTCDataChannel`s in Node, no browser required.
Run it with `pnpm test:e2e`. This already found and fixed two real bugs
(see README's "Recent fixes") — treat it as load-bearing documentation of
what's actually been verified to work, not just typechecked.

---

## 4. A live transfer, step by step

This walks through everything that happens between clicking "Send file"
and the receiver having a verified copy, in order.

### Step 1 — Room creation
Sender's browser calls `POST /room` on the Worker. The Worker generates a
3-word code (`code.ts`), creates a `TransferRoom` Durable Object keyed by
the code's hash, and returns the code. **No file has been touched yet.**

### Step 2 — Both sides join the room
Sender opens `wss://.../room/{code}/ws?role=sender`. Receiver, once someone
types/pastes the code, opens `wss://.../room/{code}/ws?role=receiver`. The
`TransferRoom` object matches them and sends both sides a `PEER_JOINED`
message once both sockets are present.

### Step 3 — CONFIG
The sender tells the receiver how many `RTCPeerConnection`s to expect (1
for normal mode, 4 for parallel mode) via a `CONFIG` message, relayed
through the room. This lets the receiver open exactly the right number of
connections instead of guessing.

### Step 4 — WebRTC handshake (per connection)
For each connection: sender creates an `RTCDataChannel` + SDP offer,
sends it through the signaling socket. Receiver gets the offer, creates an
SDP answer, sends it back. Both sides exchange ICE candidates as they're
discovered (also relayed through the room). Once ICE finds a working path
— direct if possible, through TURN if configured and necessary — the data
channel opens.

**From this point on, the signaling server is no longer involved in this
connection's data path at all.**

### Step 5 — Chunk size negotiation
The moment a data channel opens, `sendFiles()` calls
`peer.getMaxMessageSize()` to find the real SCTP-negotiated limit for that
specific connection, and computes a safe chunk size from it
(`resolveChunkSize()`, §7.4) instead of assuming a fixed value.

### Step 6 — Batch info + per-file loop
Sender sends one `BATCH_INFO` message (total file count/bytes), then for
each file: sends `FILE_METADATA`, asks the receiver "which chunks do you
already have?" (`RESUME_QUERY`/`RESUME_STATUS` — this is what makes resume
work, and it's the same code path whether or not this is actually a
resume), then streams chunks.

### Step 7 — Chunk streaming
Chunks are read from the `File` object, hashed incrementally, framed with
a 4-byte index prefix, and sent with backpressure (§7.1/§7.2). In parallel
mode, chunks are distributed round-robin across the open connections.

### Step 8 — Reassembly
The receiver writes each incoming chunk into an array slot by index (not
push order — this is what makes out-of-order, multi-connection delivery
work correctly, §7.3). Progress events fire continuously.

### Step 9 — Completion + verification
Once every chunk for a file is sent, the sender sends `TRANSFER_COMPLETE`
carrying the file's SHA-256 (computed as a side effect of the streaming
hash in step 7, not recomputed separately). The receiver assembles the
final `Blob`, hashes it, compares. Match → the file downloads. Mismatch →
`HASH_MISMATCH` error, nothing is silently accepted.

### If something goes wrong
Any failure on the sender's side triggers a `CANCEL` message to the
receiver with the reason, so it never sits on "Receiving…" forever with no
explanation. If the connection drops entirely, both sides attempt
reconnection with backoff and resume from where they left off (§10).

---

## 5. Every route, explained

All routes below are served by the single Cloudflare Worker in
`apps/signaling/src/index.ts`.

### Live transfer routes

| Route | Method | Purpose |
|---|---|---|
| `/room` | `POST` | Create a room. Returns `{ roomId, code, expiresAt }`. |
| `/room/:code` | `GET` | Check a room's status before joining (exists? expired? full?). |
| `/room/:code/ws` | `GET` (upgrades to WS) | The actual signaling socket. Requires `?role=sender` or `?role=receiver`. |

### Stored (async) transfer routes

| Route | Method | Purpose |
|---|---|---|
| `/store` | `POST` | Create a stored-transfer slot. Returns `{ id, revokeToken, expiresAt }`. |
| `/store/:id` | `GET` | Status: `uploading` / `available` / `consumed` / `revoked` / `expired`. |
| `/store/:id/manifest` | `PUT` | Sender uploads the sealed (encrypted) file manifest. |
| `/store/:id/chunk/:n` | `PUT` | Sender uploads one sealed chunk. |
| `/store/:id/complete` | `POST` | Sender marks the upload finished; body carries the total chunk count. |
| `/store/:id/manifest` | `GET` | Receiver downloads the sealed manifest. |
| `/store/:id/chunk/:n` | `GET` | Receiver downloads one sealed chunk. |
| `/store/:id/commit` | `POST` | Receiver confirms a *verified* download — this is what decrements the download allowance / triggers cleanup. |
| `/store/:id/revoke` | `POST` | Sender deletes the transfer early. Requires the `revokeToken` from creation. |

### Web app routes (Next.js, `apps/web`)

| Route | Purpose |
|---|---|
| `/` | The whole Send/Receive UI (`app/page.tsx`). |
| `/s/[id]` | Opens when someone clicks a stored-transfer share link. Reads the decryption key from the URL fragment (never sent to any server) and shows the review/download screen. |

**Every route above that touches file data (`/store/:id/manifest`,
`/store/:id/chunk/:n`) only ever sees ciphertext** — see §8. Every route
that isn't a stored-transfer route never sees file bytes at all — the file
travels over WebRTC, not HTTP.

---

## 6. WebRTC and WebSocket, explained from scratch

If you're not already deeply familiar with WebRTC, read this section.

### WebSocket's job here: signaling only
A WebSocket is just a persistent, two-way connection to a server. In this
project it's used for exactly one thing: letting two browsers, who don't
know how to reach each other directly yet, pass small setup messages back
and forth via a server they both already know how to reach (the Worker).
Once that setup is done, the WebSocket's job is finished for that
connection — it stays open in case reconnection is needed later, but no
file data ever goes through it.

### WebRTC's job here: the actual file transport
WebRTC is a browser API for direct peer-to-peer connections. Setting one
up requires:
- **SDP (Session Description Protocol)** — an offer/answer exchange
  describing what each side supports (codecs, in this case just data
  channels).
- **ICE (Interactive Connectivity Establishment)** — the process of
  finding an actual network path between two browsers, which is hard
  because most computers are behind NAT/firewalls that block unsolicited
  incoming connections.
- **STUN** — a server that tells a browser "here's your public IP/port as
  seen from the outside," letting most NAT types be traversed without any
  data relay at all. This project uses Google's public STUN servers by
  default (`ice-config.ts`).
- **TURN** — a relay server, used *only* when STUN-based direct
  connectivity genuinely isn't possible (symmetric NAT, some corporate
  firewalls — roughly 10-20% of real-world pairs). WebRTC tries direct
  candidates first automatically; TURN is a fallback, not a choice you
  make in code (§9).
- **RTCDataChannel** — once ICE finds a path, this is the actual pipe data
  flows through. It's built on **SCTP over DTLS over UDP**: SCTP gives you
  ordered-or-unordered, reliable-or-unreliable message delivery (this
  project uses ordered+reliable), DTLS encrypts everything, UDP is the
  underlying transport.

**Every byte of a live file transfer in this project is DTLS-encrypted by
WebRTC itself** — that's a property of the RTCDataChannel, not something
this codebase implements. Even if a transfer falls back to a TURN relay,
the relay only ever sees encrypted bytes it can't read.

---

## 7. What makes this fast — every technique, and which file implements it

This is the part worth reading closely if the goal is understanding *why*
this can move a large file quickly. Each subsection is one real technique,
in the order they matter most.

### 7.1 — Direct peer-to-peer, no server relay (the big one)
**File:** the whole signaling/WebRTC split described in §1 and §4.
The server's total involvement in a transfer is: creating a room, relaying
a handful of small JSON messages, then getting out of the way. File bytes
travel sender→receiver directly. This means: (a) there's no server
bandwidth cost that scales with file size, and (b) there's no server
bandwidth *ceiling* — the only limits are the two people's actual internet
connections.

### 7.2 — Streaming hash instead of hash-then-send
**File:** `lib/webrtc/hash.ts`, `sendFiles()` in `transfer.ts`.
Web Crypto's `crypto.subtle.digest()` can only hash a complete buffer at
once — which used to mean reading and hashing the *entire* file before
sending the first byte. For a large file, that's real, visible dead time
with zero progress shown. Fixed with an incremental hasher
(`@noble/hashes`) fed chunk-by-chunk as the file is read for sending, so
hashing and sending happen concurrently instead of hashing blocking
sending. The final hash is only known once the last chunk is read, so it's
sent with `TRANSFER_COMPLETE` (after the last chunk) instead of
`FILE_METADATA` (before the first).

### 7.3 — Chunking with real backpressure
**File:** `sendFiles()` in `transfer.ts`.
A naive implementation calls `channel.send()` in a tight loop, which lets
the browser's outgoing buffer grow unbounded — memory blows up and
throughput becomes bursty/unstable. This implementation checks
`channel.bufferedAmount` before every send and waits for the
`bufferedamountlow` event if the queue is too full, keeping memory bounded
and throughput smooth.

### 7.4 — Adaptive sending window
**File:** `lib/webrtc/adaptive.ts` — `AdaptiveWindowController`.
The backpressure threshold above ("how much can be queued before we
pause") used to be one fixed number for every network. It's now a simple
hill-climbing probe: grow the window while throughput keeps improving,
back off once it drops, hold once it plateaus. A slow/high-latency
international link and a fast local link end up with genuinely different
windows instead of the same guessed constant.

### 7.5 — Multi-connection parallelism (experimental, opt-in)
**File:** `lib/webrtc/multi-peer.ts`, the round-robin chunk distribution in
`sendFiles()`.
Here's a subtlety worth understanding: opening multiple `RTCDataChannel`s
on **one** `RTCPeerConnection` does **not** give you parallelism in any
meaningful sense — they all share one SCTP association, one DTLS session,
one congestion-control state. Real parallelism (the kind that helps on
high-latency links, where a single connection's congestion window takes
longer to ramp up) requires **multiple independent `RTCPeerConnection`s**,
each with its own ICE/DTLS/SCTP handshake and its own congestion control.
That's what this does — up to 4 independent connections, chunks
round-robined across them, each with its own `AdaptiveWindowController`.
It's **off by default** and framed as something to benchmark, not assume —
the extra connection-setup overhead may not pay off on every network.

### 7.6 — Dynamic, per-connection chunk sizing
**File:** `resolveChunkSize()` and `getMaxMessageSize()` in `transfer.ts`/`peer.ts`.
This one is more of a *correctness-enabling-speed* fix than a raw speed
technique: a fixed chunk size can simply fail outright if it exceeds
what a given browser pair negotiated (`RTCSctpTransport.maxMessageSize`,
which varies by browser/version and isn't knowable in advance). Chunk size
is now computed from the connection's real negotiated limit, so transfers
succeed reliably across different browsers instead of only working by
coincidence on whichever browser happened to match the hardcoded assumption.

### 7.7 — Resume instead of restart
**File:** the `RESUME_QUERY`/`RESUME_STATUS` protocol in `sendFiles()`/`FileReceiver`.
If a connection drops mid-transfer, a naive implementation starts over
from zero. This one reconnects (§10) and, before sending anything, asks
"which chunks do you already have?" — skipping everything already
delivered. For a large file over a flaky connection, this is the
difference between "finishes eventually" and "never finishes because it
keeps restarting."

### 7.8 — Measurement before tuning
**File:** `lib/webrtc/stats.ts`, `components/benchmark-summary.tsx`.
None of 7.2–7.6 were tuned by guessing — the `StatsMonitor` polls real
`RTCPeerConnection.getStats()` (RTT, selected candidate type,
bytes-over-time) and the app renders a benchmark card after every transfer
(size, duration, average/peak throughput, direct-vs-relayed, final
adaptive window size). The right move with any of these constants is:
run a real transfer, look at this card, then decide — not assume.

### What's *not* a speed technique here, for clarity
STUN/TURN (§9) affects whether a transfer can happen at all on a given
network, not how fast it is once connected. Encryption (DTLS on the live
path, AES-GCM on stored transfers) is close to free on modern hardware and
isn't a speed trade-off worth worrying about.

---

## 8. Stored (async) transfers — separate architecture

For when both people can't be online at the same time. This is
**intentionally a different code path** from the live-transfer flow above
— it's not WebRTC at all, just encrypted HTTP upload/download.

```
Sender's browser                Cloudflare Worker              R2 bucket
      │                                │                            │
      │  1. generate random master key (never leaves browser)       │
      │  2. HKDF-split into manifest-key + data-key                 │
      │  3. AES-GCM seal manifest + every chunk                     │
      │                                │                            │
      ├── POST /store ────────────────►│                            │
      │◄── { id, revokeToken } ────────┤                            │
      │                                │                            │
      ├── PUT /store/:id/manifest ────►│── stores ciphertext ──────►│
      ├── PUT /store/:id/chunk/0 ─────►│── stores ciphertext ──────►│
      ├── PUT /store/:id/chunk/N ─────►│── stores ciphertext ──────►│
      ├── POST /store/:id/complete ───►│                            │
      │                                │                            │
      │  share link: {appUrl}/s/{id}#v1.{key}
      │  (key is after # — never sent to any server, ever)
```

The receiver, opening that link later:
1. `app/s/[id]/page.tsx` reads the key from `window.location.hash` —
   entirely client-side; the Next.js server never sees it, and neither
   does the Worker, because browsers never include URL fragments in HTTP
   requests.
2. Fetches and decrypts the manifest, shows a review screen.
3. On confirm: downloads and decrypts every chunk, verifies the hash.
4. Calls `POST /store/:id/commit` — **only on a verified success**, this
   is what actually decrements the download allowance / triggers cleanup.
   A failed or abandoned download doesn't burn the transfer's one-time use.

**The server (Worker + R2) never has the decryption key and never sees
plaintext file names, contents, or metadata** — only ciphertext, an opaque
ID, and coarse metadata like ciphertext size and upload/download timing.

---

## 9. STUN, TURN, and the "Relay settings" panel

WebRTC's ICE layer automatically prefers a direct connection over a
relayed one — **there is no code in this repo that decides "try direct,
then fall back to TURN."** You only need a TURN server to be *available*
in the ICE server list (`ice-config.ts`); ICE tries it only when no direct
candidate pair succeeds.

- **Default:** STUN only (`lib/webrtc/ice-config.ts`'s `DEFAULT_ICE_SERVERS`,
  from the shared `protocol` package). No relay fallback exists unless
  configured.
- **To add TURN:** either set `NEXT_PUBLIC_TURN_*` env vars (applies to
  everyone), or use the in-app "Relay settings" panel
  (`components/relay-settings.tsx`) to point a single session at a TURN
  server without redeploying anything.
- **Self-hosting TURN:** Cloudflare Workers can't run coturn (no
  persistent process, no raw UDP). `docs/turn-server.md` has a full
  docker-compose setup for a cheap VPS, plus production-hardening notes
  (short-lived credentials instead of a static one).

---

## 10. Reconnection and resume

If an `RTCPeerConnection` fails mid-transfer (common case: brief Wi-Fi
hiccup, NAT rebinding), both sides attempt reconnection with backoff
(1s/2s/4s, 3 attempts). Two layers of recovery:

1. **RTCPeerConnection-level:** if the signaling WebSocket itself is still
   alive, just rebuild the peer connection over it.
2. **Full signaling-level:** if the WebSocket also died, rebuild it against
   the same room (rooms outlive a single socket disconnect on the Durable
   Object side) before retrying the peer connection.

Once reconnected, the sender picks up with whatever files/chunks are left
(§7.7) — it does not restart the whole batch. A 45-second stall watchdog
on the receiver (`app/page.tsx`) is a backstop for the case where even a
`CANCEL` message can't get through — a genuinely dead connection rather
than a clean, explained failure.

---

## 11. Testing infrastructure

- **`apps/web/transfer-e2e-test.mts`** (`pnpm test:e2e`) — runs the real,
  unmodified `sendFiles()`/`FileReceiver` against mock `RTCDataChannel`s
  in Node. No browser needed. Covers: basic transfer, multi-chunk framing,
  parallel-connection out-of-order reassembly, resume, hash-mismatch
  detection, small negotiated max-message-size (the real bug this was
  built for), and error propagation via `CANCEL`. This has already found
  and fixed two real bugs — it's not a formality, it's load-bearing.
- **`TESTING.md`** — a manual checklist for everything that genuinely
  needs a real browser/real network to verify (actual P2P connectivity
  across NAT, TURN relay behavior, real-world resume timing).

---

## 12. Honest status

Every piece described above builds and typechecks (`next build`,
`tsc --noEmit`, `wrangler deploy --dry-run`), and the transfer engine
specifically has real integration-test coverage (§11). What hasn't been
exhaustively verified: TURN relay behavior against a real coturn instance,
resume across a genuinely dropped WebSocket (not just a dropped
RTCPeerConnection), and whether the parallel-connections mode actually
helps on a real international link versus just adding connection-setup
overhead. See README's "Known limitations" for the full, current list —
that section is kept up to date as things get fixed or found.
