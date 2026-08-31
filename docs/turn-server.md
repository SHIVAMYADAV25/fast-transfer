# Self-hosting a TURN server

Why this is a separate doc: Cloudflare Workers can't run coturn (it needs a
real UDP-capable host — a Worker has no persistent process and no raw UDP
socket access). This is the one piece of the stack that genuinely needs its
own small VPS. Per the PRD (§16 step 18, §31), this should be the *last*
thing you add — get the P2P-only path solid first, add this once you have
real users hitting the "can't connect directly" wall.

## Why you need this at all

WebRTC's ICE layer automatically prefers a direct connection over a relayed
one — you don't write "try P2P, catch failure, use TURN" logic. You only
need a TURN server to be *available* in the ICE server list; it's used only
when no direct candidate pair succeeds (roughly 10–20% of real-world pairs:
symmetric NAT, some corporate firewalls, some mobile carrier NATs).

## Cheapest path: self-hosted coturn on a $4–6/mo VPS

Any small VPS with a public IPv4 address works (DigitalOcean, Hetzner,
Linode, etc.). You need:
- Ports **3478/udp** and **3478/tcp** (STUN/TURN)
- A UDP relay port range, e.g. **49152–49452/udp** (open this range in your
  provider's firewall/security group, not just on the host)
- TLS on 5349 if you want TURNS (recommended, but optional for MVP)

### docker-compose.yml

```yaml
services:
  coturn:
    image: coturn/coturn:latest
    restart: unless-stopped
    network_mode: host # coturn needs to see real client IPs; host networking is simplest
    volumes:
      - ./turnserver.conf:/etc/coturn/turnserver.conf:ro
    command: ["-c", "/etc/coturn/turnserver.conf"]
```

### turnserver.conf

```conf
listening-port=3478
tls-listening-port=5349
min-port=49152
max-port=49452

# Replace with your VPS's actual public IP
external-ip=YOUR.PUBLIC.IP.ADDRESS

# Static long-term credential (simplest option for MVP — see "Production"
# below for time-limited credentials instead)
lt-cred-mech
user=fasttransfer:CHANGE_ME_TO_A_LONG_RANDOM_SECRET

realm=turn.yourdomain.com

# Reduce abuse surface
no-multicast-peers
no-cli
fingerprint

# TLS (optional but recommended) — point at real certs, e.g. from certbot
# cert=/etc/coturn/cert.pem
# pkey=/etc/coturn/key.pem
```

Bring it up:

```bash
docker compose up -d
```

Test it's reachable (from a different machine):

```bash
# Replace with your values
turnutils_uclient -T -u fasttransfer -w CHANGE_ME_TO_A_LONG_RANDOM_SECRET YOUR.PUBLIC.IP.ADDRESS
```

## Wiring it into fast-transfer

You have two options — use whichever fits your situation:

### Option A — env vars (baked in at deploy time, applies to everyone)

Set these on your Vercel project (or wherever you deploy `apps/web`):

```
NEXT_PUBLIC_TURN_URLS=turn:YOUR.PUBLIC.IP.ADDRESS:3478
NEXT_PUBLIC_TURN_USERNAME=fasttransfer
NEXT_PUBLIC_TURN_CREDENTIAL=CHANGE_ME_TO_A_LONG_RANDOM_SECRET
```

See `apps/web/lib/webrtc/ice-config.ts` — these get appended to the STUN
server list automatically for every connection.

### Option B — the in-app "Relay settings" panel (session-only, per-user)

The bar at the bottom of the app (`components/relay-settings.tsx`, matching
the reference UI) lets anyone type in their own TURN server for just their
session, without redeploying anything. Good for testing, or for people
self-hosting their own relay who don't want to touch the main deployment's
env vars. This takes priority over the env-var config when set.

## Production hardening (do this before real traffic)

- **Don't use a static long-term credential in production.** Static
  credentials leak — anyone who gets one can relay unlimited traffic through
  your server forever. Use coturn's REST API auth
  (`use-auth-secret` + `static-auth-secret` in `turnserver.conf`) and mint
  short-lived (e.g. 24h) time-limited credentials server-side, one per
  transfer. This is the standard pattern most WebRTC TURN deployments use.
- **Rate-limit and monitor bandwidth.** A relayed transfer means the file
  bytes flow through your VPS — this is real bandwidth cost, unlike the
  direct-P2P path. Watch `coturn`'s logs / a bandwidth alert on the VPS so
  one bad actor can't run up a huge bill.
- **Put it behind a real domain + TLS (TURNS)**, not just a bare IP —
  some restrictive networks block plain UDP/3478 but allow TURN-over-TLS
  on 443/5349.
- **Consider a managed TURN provider** (Cloudflare Realtime/Calls, Twilio
  Network Traversal, Xirsys) once self-hosting becomes a maintenance burden
  — they handle the credential rotation and scaling for you, at a per-GB
  cost that may be cheaper than your own ops time past a certain scale.
