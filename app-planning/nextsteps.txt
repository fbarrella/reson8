# Reson8 — Open Risks (carried over from Phase 17)

**Created:** 08/10/2026
**Source:** the Phase 17 PRD (`Reson8_Phase17_PRD.md`): PRD 17.12's "Residual Risks" and the audit's "Pre-Existing Issues… Not fixed" list.
**Purpose:** input for the next phase's planning. Nothing here is being fixed in Phase 17. Each entry says what the risk is, why it was left open, and a suggested direction.

---

## Security

### 1. No transport encryption by default
- **What:** the client builds `http://` / `ws://` URLs (`preload.ts` `connect()`: ``const serverUrl = port ? `http://${host}:${port}` : `http://${host}` ``). Unless a self-hoster puts TLS in front (reverse proxy, Cloudflare Tunnel), messages, DMs, upload tokens and session traffic travel in clear text.
- **After 17.12:** an attacker on the network path can no longer steal an identity for later use (they only see one-time signatures), but they can still **read everything and hijack a live session** (inject events on the open socket).
- **Direction:** support `https://`/`wss://` in the connect form (accept a scheme in the URL, default to https when a domain is given), document a reverse-proxy TLS setup, and consider warning in the UI when connected without TLS. Self-signed certificates on LAN servers need a trust story (e.g. pin on first use).

### 2. Trust-on-first-use window for identity keys (PRD 17.12)
- **What:** every user id was public before 2.6.0, so until a user connects once with a 2.6.0+ client, **someone else can bind their id to their own key** on that server.
- **Mitigations in place:** `ADMIN_KEY_FINGERPRINT` protects the admin account; a hijacked user sees "registered to another device", and an ADMIN can "Reset key" (which also disconnects the impostor).
- **Direction:** once most users are on 2.6.0, set `REQUIRE_SIGNED_IDENTITY=true` (the release notes should keep recommending it). Possibly add an admin view of recent binds (who, when, from which address) so suspicious binds of privileged users are noticed.

### 3. Challenge relay by a malicious server (PRD 17.12)
- **What:** if a user connects to an attacker's server while that attacker is actively connected to another server the user belongs to, the attacker can forward that server's challenge to the user and relay the signature back, getting **one live session** as that user.
- **Mitigation in place:** optional `AUTH_ALLOWED_HOSTS`: the signed message includes the host the client connected to, and the server refuses hosts outside the list. It's off by default because a server reachable by several names (LAN IP + domain, the hairpin-NAT setup) must list all of them.
- **Direction:** TLS (risk 1) with channel binding would close this properly. Alternatively, have the server announce a canonical name that the client checks, or derive per-server keys once there's a stable server identity the client can verify.

### 4. Local malware can copy the identity key
- **What:** the private key is a `0600` PEM file in the Reson8 `userData` folder (OS-keychain encryption was rejected, see PRD 17.12). Anything running as the user can copy it, as it can copy anything else there.
- **Direction:** revisit `safeStorage` with a safe fallback and migration path (and a recovery story for when the keychain becomes unavailable), or accept it as equal to how SSH keys are stored by default.

### 5. Ban evasion with a fresh install
- **What:** bans are per identity (user id). Deleting the Reson8 `userData` folder (or reinstalling) creates a new identity that isn't banned.
- **Direction:** inherent to an account-less design. Options: optional IP/subnet bans, an "approval required for new users" server mode, or invite-only servers.

### 6. Link previews ignore NSFW context
- **What:** a preview image (including proxied posts from the 17.9 fixers, e.g. Reddit) is shown unblurred in any channel, and isn't covered by the NSFW-channel blur (PRD 13.5/16.2). Fixers make video previews more common.
- **Direction:** apply the NSFW blur to preview media in NSFW channels; honor `og:restrictions:age`/Reddit's `over_18` where available; maybe a per-user "blur all link-preview media" option.

---

## Robustness

### 7. Link-preview fetching has no size cap and the cache never expires
- **What:** `fetchLinkPreviewFast()` (`main.ts`) does `response.text()` on any response, so a huge page is read fully into memory. The in-memory `linkPreviewCache` (main) and the renderer's cache keep every entry, including failures, for the whole session. Signed video URLs from fixers can expire while still cached.
- **Direction:** stream with a byte cap (e.g. 2 MB, stop at `</head>`), a TTL for both caches (shorter for failures), and an LRU bound.

---

## UX gaps

### 8. DM tabs have no unread indicator, and DMs are never truncated
- **What:** a DM is marked read on arrival even when its tab isn't focused, so an open DM tab never shows unread state (17.6 covers channel tabs only). DM messages also never get the "See more" collapse.
- **Direction:** apply the 17.6 tab indicator and 17.7 truncation to DMs, with "read" set only when the DM tab is actually focused.

---

## Tooling

### 9. `npm run lint` is broken
- **What:** the root script references eslint, which isn't installed anywhere in the repo (documented in the root `CLAUDE.md`).
- **Direction:** install and configure eslint (flat config, typescript-eslint) or remove the script.
