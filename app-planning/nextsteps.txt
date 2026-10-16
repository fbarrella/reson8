# Reson8 — Open Items

**Created:** 10/10/2026 (v2.7.0) · **Updated:** 15/10/2026 (3.0.0-beta.4, after Phase 20)
**Source:** what Phase 18's and Phase 20's own verification could not cover, decisions they left open, and findings made along the way. Their rationale lives in `app-planning/archive/Reson8_Phase18_PRD.md`, `app-planning/archive/Reson8_Phase20_PRD.md` and the progress summary.
**Purpose:** input for the next phase's planning, and a checklist for the manual test passes of the 3.0 betas and 2.7.x.

---

## Phase 18 — to verify by hand (could not be exercised headless)

- **Fullscreen on Windows and Wayland/XWayland** (18.19) — only X11 was exercised; the permission grant is expected to behave the same.
- **A real reverse proxy in front** for address bans and the identity log (18.2/18.7) — a trusted loopback peer with a forged `X-Forwarded-For` exercised the same code path; IPv6 clients only at unit level.
- **A Cloudflare-style bot-walled page** through the hidden preview window (18.10) — the hardened window ran, but no walled URL was available.
- **Age-restricted YouTube and Reddit NSFW signals** (18.11) — only `og:restrictions:age` and `<meta name="rating">` are implemented; a Reddit-specific signal was not observed live, so it is deliberately absent.
- **A photo-only X post and a Reddit video post** (18.14) — no valid sample was reachable.
- **The voice media handshake end to end for a restricted user** and **a Viewer window closing when access is lost** (18.18) — events are refused at the gate and the teardown is covered by presence checks; the media path itself wasn't driven.
- **A real OS-level window blur** for DM read rules (18.13) — simulated by overriding `document.hasFocus`.
- **Backfill timing on a large production database** (18.17) — set-based and idempotent, verified on a throwaway database.

## Phase 18 — known limitations worth a decision

- **Attachments don't reserve their size** (18.12) — they rely on the scroll keeper; adding stored dimensions needs a server change.
- **The connected server's own host never previews** (18.10) — deliberate (a LAN server's links are on a private address).
- **A signed-in socket's cached `hasAccess`** assumes one server process (`io.sockets.sockets` is local). Running more than one instance would need the Socket.io adapter's `fetchSockets()` in `applyAccessChange()`.
- **`GET_ALL_USERS` / `GET_ROLES` take `serverId` from the payload** (pre-existing; gated by permission, and a deployment has one server today). Using `socket.data.serverId` would be tidier.
- **Moderators without Member can't exist with the two fixed roles**, so "open" moderator events don't need an extra access check; if custom roles arrive, revisit `EVENT_ACCESS`.

---

## Phase 20 (3.0 beta) — owner checks on real hardware

The full checklists are in `archive/Reson8_Phase20_PRD.md` (P1, H1, G1, S2).

- **V1 — streams on two machines:** the shared app's sound on the stage, the 0–200 % stream volume, Pop out / Bring back keeping picture and sound (one viewer left/joined pair at most), Grid with 2+ sharers (sound only from the focused one), fullscreen on Windows and Linux Wayland, never two consumers of one producer in the server log.
- **V2 — the integrated title bar on macOS and Linux** (X11 and Wayland, drag, double-click maximize, the system-title-bar fallback), Windows 11 snap layouts, the Viewer's bar on all three.
- **V3 — connect flows:** a self-signed certificate (trust dialog, then "certificate changed" with no override), "Approve new users" letting a waiting identity in without reconnecting by hand, a password server (wrong password, Remember password).
- **The Linux window border and rounded corners** (Arch/KDE) — only simulated on Windows. A setup without a compositor may show black corners ("Use the system title bar" is the way back).
- **The S2 Linux portal flow for real:** Cancel then pick in the portal shares nothing; Change re-opens the portal; Start announces LIVE with the typed or default name.
- **H1 minimize-to-tray on Windows, 10 times each:** tray click, tray Restore, launching the app again, after 10 minutes hidden.
- **G1 "Get beta updates" on a packaged stable build** against the real GitHub feed: on → the newest beta; off → nothing newer than stable; never a downgrade.
- **Update download / restart from a real published release** (TEST_STATES 4g/15a only drove the renderer's handlers).
- **Sharing with app audio on** (S1) and Cmd+F on macOS (Q1).

## Phase 20 — open decisions and gaps

- **D1's "update every 10 minutes"** — the answer was "keep static cards and update it every 10 minutes", but the "Also live" cards are still fully static (no picture at all). Needs a definition (a still frame taken from the stream every 10 minutes? by whom — the sharer or the watcher?) before it can be built; live previews (L1) stay out.
- **Search filter chips** — the design's Has image / Has link / From / Any date chips (frame 1i) were not built.
- **The Members nav item is decided at connect time** — someone granted a role mid-session has to reconnect before Members enables (pre-existing; a live re-check in `openSettingsPanel()` would fix it).
- **Create channel opens on Voice** — the hidden type select defaults to Voice on first open, so the new icon button is hidden until Text is picked.
- **A BAN_USER-only moderator sees no Member/Admin pills** in Members (they don't receive the roles list) — by design today; revisit if moderators should see roles read-only.
- **The window buttons' hover box is square** at the rounded top-right corner on Linux, and a snapped (not maximized) window keeps its border and radius.
- **Merging to `main` and the stable 3.0.0** — the owner's call (PRD 20: every beta is smoke-tested against a 2.7.0 server and the previous beta's server first).
