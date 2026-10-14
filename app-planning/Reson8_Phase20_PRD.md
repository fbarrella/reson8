# Reson8 — Phase 20 PRD (Finishing the Nocturne UI)

**Created:** 14/10/2026
**Author:** Felipe B. Netto (assisted by AI)
**Status:** Draft — the five open decisions below need the owner's answer before the items that depend on them start
**Source:** what Phase 19 (the "Nocturne" UI overhaul) deliberately did not build — frames in `app-planning/design_handoff_reson8_ui_overhaul/screenshots/` that show new behaviour rather than a restyle — plus the verification Phase 19 could not do on its own and two housekeeping items. Phase 19's rationale lives in `app-planning/archive/Reson8_Phase19_PRD.md` and the Phase 19 block of `progress.txt`.
**Branch:** `ui-overhaul-beta` (the beta line continues: `3.0.0-beta.4`, `-beta.5`, …). **Never commit to or merge into `main`** — the move to `main` is the owner's.

---

## Table of Contents

1. [Open Decisions](#open-decisions)
2. [How to Execute This PRD](#how-to-execute-this-prd)
3. **P1 — Verify what Phase 19 built** — [V1](#v1--streams-picture-and-sound) · [V2](#v2--the-integrated-title-bar-on-macos-and-linux) · [V3](#v3--connect-flows-that-need-a-real-setup) · [V4](#v4--the-test_states-pass)
4. **P2 — Voice** — [U1 Voice dock](#u1--voice-dock-restyle) · [U2 Voice room header and call bar](#u2--voice-room-header-and-call-controls) · [U3 Title-bar pill with your nickname](#u3--title-bar-pill-server--nickname)
5. **P3 — Server settings** — [M1 Members](#m1--members-search-filters-and-rows) · [M2 Bans](#m2--bans-a-list-of-banned-people) · [M3 Emoji](#m3--emoji-approve-all-and-the-library) · [M4 Nav counts](#m4--counts-in-the-server-settings-nav)
6. **P4 — Welcome and chat** — [W1 Saved-server latency](#w1--saved-server-latency-and-offline) · [W2 Typing indicator](#w2--typing-indicator)
7. **P5 — Dialogs** — [S1 Share picker tabs](#s1--share-picker-screens--windows-tabs) · [S2 Linux picker flow](#s2--the-linux-system-picker-flow) · [S3 Icon in Create channel](#s3--channel-icon-in-create-channel)
8. **P6 — Settings** — [G1 Beta updates](#g1--get-beta-updates) · [G2 Play sound alerts](#g2--play-sound-alerts-wording)
9. **P7 — Decision-gated features** — [L1 Live stream previews](#l1--live-previews-on-also-live-cards) · [Q1 Message search](#q1--message-search)
10. **P8 — Housekeeping** — [H1 Minimize-to-tray state](#h1--minimize-to-tray-leaves-the-window-minimized-and-hidden) · [H2 TypeScript module resolution](#h2--typescript-moduleresolution-migration)
11. [Order and Releases](#order-and-releases)

---

## Open Decisions

| # | Decision | Blocks | Options |
|---|---|---|---|
| D1 | Live previews on the "Also live" cards | L1 | (a) build after the measurement shows the cost is acceptable; (b) keep static cards. The measurement itself (3 and 5 sharers, CPU % and inbound kbit/s, all-full vs. non-focused paused) has to be run by the owner on real machines — the dev machine delivers no screen-capture frames. |
| D2 | Message search | Q1 | (a) server-side search per channel/DM with Postgres full-text; (b) not now. Phase 19 decision D10 deferred it. |
| D3 | "Get beta updates" in a stable build | G1 | (a) build it with the safeguards in G1; (b) betas stay install-by-hand only. |
| D4 | Typing indicator | W2 | (a) build it (a new throttled server event); (b) not now. It tells others when you are typing, which some people dislike — if (a), should there be a "Don't show that I'm typing" switch? |
| D5 | "Last seen" in Members | M1 | (a) add `users.lastSeenAt` (written on disconnect, coarse — the day is enough); (b) show only Online/Offline. |

---

## How to Execute This PRD

The Phase 19 rules still apply (`apps/client/AGENTS.md` collects them):

- Shared-types first for anything that crosses the wire; every new client→server event gets an `EVENT_ACCESS` classification and goes through the packet guard; additive optional fields so a 2.7.0 / beta.3 peer keeps working.
- One implementation per concern: menus through `openMenu()`, icon cropping through `IconCropper`, settings pages as `.settings-tab-btn` + `.settings-panel` in the right mode group, stream watching through `screen-watch.ts` / `api.stage`, update text through `updateState`.
- Tokens only (no colour literals outside `:root` — R6), Phosphor icons, `textContent` for every user-supplied string.
- Every item: typecheck the workspaces it touches, `npm run lint` from the root (exit 0), drive it in a real client (CDP), screenshot it against its frame, log it in `progress.txt` (`/log-progress`), one local commit.

---

## P1 — Verify what Phase 19 built

These are not new code; they are checks only a person with the right setup can run. A failure becomes a fix item.

### V1 — Streams: picture and sound
The in-app stage, the pop-out Viewer and the Grid were driven end to end, but on the dev machine the received video track stayed muted at 0×0 (the pre-refactor Viewer did the same, so it is the machine's capture/ICE). **Check on two real machines:** picture and sound on the stage, after Pop out and Bring it back, in the Viewer's Return, in Grid (every cell plays; sound only after Focus), stream volume up to 200 %, fullscreen on Windows and Wayland, and the sharer hearing no join/leave pair when a viewer pops out and back. Also confirm in the server log that no viewer ever has two consumers of the same stream at once.

### V2 — The integrated title bar on macOS and Linux
Windows was verified (one bar, native controls, drag, double-click maximize, minimize, saved position). **Check:** macOS (traffic lights centred in the bar, logo clear of them, fullscreen), Linux X11 and Wayland (controls drawn, dragging, maximize; if Wayland misbehaves, Settings › Window › "Use the system title bar" must restore the OS frame after a restart), Windows 11 snap layouts on hovering maximize, and the Viewer's bar on all three.

### V3 — Connect flows that need a real setup
- The certificate-trust and certificate-changed dialogs against a self-signed TLS server (restyled in R1).
- The "Waiting for approval" screen with Approve new people on.
- A password-protected server: the Password required dialog, a wrong password ("That password wasn't accepted."), Remember password.

### V4 — The `TEST_STATES.md` pass
Every state in `design_handoff_reson8_ui_overhaul/TEST_STATES.md` checked, or marked "user to verify by hand" with the reason. This is the gate for `3.0.0-beta.3`.

---

## P2 — Voice

### U1 — Voice dock restyle
**Frames:** 1a, 1b (bottom-left of the sidebar).
**Today:** the C9-era dock — "Voice: {room}" with the timer, an expand button, and four equal buttons (mute, deafen, share, leave).
**Design:**
- A card: a green signal icon, "Voice connected", "{room} / {parent category} · {latency} ms" (the existing 3 s latency poll), and the expand-voice-room button at the top right.
- A row of buttons: mic and headset as **split buttons** — the main part toggles mute/deafen as today, a narrow caret opens a menu with the input / output device list (the existing `audio-input-select` / `audio-output-select` options, saved the same way) and "Voice settings…"; then Share screen; then Leave in danger style.
- The screen-share alert banner and the self-hear banner stay above the card.
**Done when:** every dock action works as before; the device menus switch the device live; screenshot matches 1a.

### U2 — Voice room header and call controls
**Frames:** 1m, 11a, 11b.
**Today:** the voice tab's header is "{room} {n}" plus the Focus | Grid and Mosaic | Featured toggles.
**Design:**
- Header: a small kicker "{CATEGORY} · VOICE ROOM", the room name large, and on the right an Encrypted / Not encrypted pill (the connection's scheme, as in the status bar), the "{n} / {cap}" people pill, and the layout toggles.
- A call-controls bar centred at the bottom of the voice tab: mic and headset split buttons (as U1), Share screen, Leave — the same handlers as the dock, so the two can never disagree.
**Done when:** the bar and the dock stay in sync (mute in one shows in the other); the header pills are correct for http and https; screenshots match 1m/11a.

### U3 — Title-bar pill: "server · nickname"
**Frames:** 1a (`farewell-ts.reson8.com.br · 👤 PoPaDiNhAs ▾`).
**Today:** the pill shows the server name only.
**Design:** connected → "{server address or name} · {person icon} {nickname}". It stays centred on the window (R7 follow-up) and truncates the server part first.

---

## P3 — Server settings

### M1 — Members: search, filters and rows
**Frame:** 5a.
**Today:** the member list (moved as-is in R4) — role pills, Ban, Reset key, and a menu button.
**Design:**
- A search box ("Search by name or ID") and filter chips with counts: **All**, **Admins** (aggregated permissions include ADMIN), **No key** (`hasIdentityKey === false`), **No access** (no CONNECT and no ADMIN — the 18.18 rule). All from `GET_ALL_USERS`, filtered client-side.
- Rows: avatar with online dot, name with a lock when a key is bound, "(you)", a NO ACCESS tag; a second line with the short id and "Online · {room}" or "Last seen …" (D5); on the right two pills — **Member** and **Admin** — that add/remove those roles through `ASSIGN_ROLE` exactly as the current role pills do (other roles stay reachable in the ⋮ menu); a ⋮ menu with Identity log (filtered), Reset key, Ban / Unban.
- If D5 = (a): `users.lastSeenAt` (Prisma migration), written when the owning socket finally disconnects (after the grace period, through the socket-ownership check), returned by `GET_ALL_USERS` as an optional field.
**Done when:** search and every filter work with the real list; role changes, ban, reset key and the filtered identity log behave exactly as before; screenshot matches 5a.

### M2 — Bans: a list of banned people
**Today:** the Bans page shows address bans and says banned people are marked in Members.
**Design:** a "Banned people" card from `GET_BANNED_USERS` (BAN_USER) — name, when, who banned (if the DTO has it; additive otherwise), the address ban made with it, and Unban (the existing unban path). Address bans stay below.

### M3 — Emoji: Approve all and the library
**Frame:** 5e.
**Today:** the pending-emoji review list.
**Design:**
- "Requests · {n}" with **Approve all** (sequential `REVIEW_CUSTOM_EMOJI` calls, stopping on the first refusal and saying so).
- "On this server · {n}": a grid of approved emoji (image, `:name:`) with **Remove**.
- **Server:** a new `DELETE_CUSTOM_EMOJI { emojiId }` (MANAGE_EMOJIS), deleting the row and then releasing its file through `releaseStoredFile()` (never a client URL), broadcasting the emoji list change; `EVENT_ACCESS` "open" (it carries its own permission check) and a vitest suite.
**Done when:** approve-all and remove work for a MANAGE_EMOJIS holder and are refused for others; the removed emoji disappears from every client's picker live.

### M4 — Counts in the server settings nav
**Frames:** 5a–5f.
Members shows the member count, Joining & invites the waiting count (exists as the pending badge), Emoji the pending-request count — all from data the pages already load.

---

## P4 — Welcome and chat

### W1 — Saved-server latency and "Offline"
**Frame:** 2b ("18 ms" / "2 ms" / "Offline").
**Design:** while the welcome screen is showing, the main process probes each saved server's `/health` (it exists: `{ status, uptime }`) with a 3 s timeout, at most once a minute per server, through the same session (so a pinned certificate keeps working and a changed one fails), and returns the round trip or null. The row shows "{n} ms" (green/amber like the status bar) or "Offline". Nothing is sent but the GET — no identity, no nickname.
**Done when:** a running server shows its latency, a stopped one shows Offline within a minute, and nothing is probed while connected.

### W2 — Typing indicator
**Frame:** 1a ("Kdshy is typing…"). **Needs D4.**
**Design:**
- Client → server `TYPING { channelId } | { dmPartnerId }`, sent at most once every 3 s while the composer has text and focus; `EVENT_ACCESS` "member".
- Server → `USER_TYPING { userId, nickname, channelId | fromDm }` to the `members:` room for a channel (never to people without access) or to the DM partner only; rate-limited per socket.
- The composer's bottom line shows "{name} is typing…", "{a} and {b} are typing…", "Several people are typing…"; an entry expires after 5 s or when that person's message arrives.
- If the owner wants it: a "Don't show that I'm typing" switch in Privacy & safety (the client simply never sends `TYPING`).

---

## P5 — Dialogs

### S1 — Share picker: Screens | Windows tabs
**Frame:** 1k. The two labelled groups become a segmented control "Screens {n} | Windows {n}" over one grid; cards get an app icon and the window's process name when known; the Share audio row says which app's sound is shared ("Only sound from {app}"), from the existing `resolvePidForWindowSourceId` data.

### S2 — The Linux system-picker flow
**Frames:** 1l, 1m. Linux/Wayland hands the choice to the desktop portal.
- While the portal dialog is open: a card at the bottom of the window — "Waiting for your system's screen picker — On Linux, the desktop asks what to share. Reson8 never sees your screen until you choose." — with Cancel.
- After it: the Name your stream dialog shows "Chosen in the system picker: {source name}" with a **Change** link (re-opens the portal).

### S3 — Channel icon in Create channel
**Frame:** 1g. A square icon button left of the name field opens the existing channel-icon chooser (emoji or image through `IconCropper`); the choice is applied with `UPDATE_CHANNEL` right after `CREATE_CHANNEL` succeeds (an upload is discarded if the create fails). Text channels only, as today.

---

## P6 — Settings

### G1 — Get beta updates
**Frame:** 4g. **Needs D3.**
A stable install opting in to betas is delicate: `autoUpdater.channel`'s setter turns on `allowDowngrade` (never set it — root AGENTS.md), and a stable build's update lookup reads `latest*.yml`, which beta releases deliberately don't carry.
**Design if (a):** a switch in About ("Get beta updates — BETA"), stored by the main process. On: `allowPrerelease = true` **and** the provider asked for the beta channel's file through a code path that does not touch `allowDowngrade` (verify in electron-updater's source which property to set; add a unit test that `allowDowngrade` stays false). Off again: back to stable — the next stable release replaces the beta; nothing is downgraded automatically. Test with a real packaged stable build against a real beta release before shipping.

### G2 — "Play sound alerts" wording
**Frame:** 4b. Today's switch is "Mute sound alerts" (on = silent). The frame has "Play sound alerts" (on = sounds). Invert the presentation only: the stored preference keeps its meaning, the switch shows `!muted`, so no existing user's setting changes.

---

## P7 — Decision-gated features

### L1 — Live previews on "Also live" cards
**Needs D1.** Phase 19 C11's optional part.
- Viewer-socket event `SET_CONSUMER_LAYERS { consumerId, temporalLayer: 0 | 1 | 2 }`; the server checks the consumer belongs to this socket's own session and calls `consumer.setPreferredLayers({ spatialLayer: 0, temporalLayer })`. Shared-types + `EVENT_ACCESS` "member".
- In Focus, each "Also live" card runs a watch at temporal layer 0 (about ¼ of the frame rate, muted); clicking a card raises it and lowers the old main stream without closing either.
- An older server (unknown event): static cards, as today.

### Q1 — Message search
**Needs D2.** The frame (1i) shows a "Search" box with Ctrl F in the tab bar.
- Server: `SEARCH_MESSAGES { channelId | dmPartnerId, query, before? }` (member; only channels the user can read, DMs they are part of), Postgres full-text (`to_tsvector` with a GIN index — a migration), 25 results per page with a snippet.
- Client: the search box searches the active conversation; results in a dropdown; picking one uses `jumpToMessage()`.

---

## P8 — Housekeeping

### H1 — Minimize-to-tray leaves the window minimized and hidden
Found while verifying R7, identical with the OS frame: with Minimize to system tray on, the minimize button leaves the window both minimized and hidden — the state PRD 15.7 wanted to avoid (`will-minimize` didn't fire on this Windows build, so the `minimize` fallback hid it). Restoring through a second launch works. **Fix:** in the `minimize` fallback, `restore()` silently before `hide()` (or listen for the `system-command` minimize on Windows); verify the Windows re-launch freeze stays fixed.

### H2 — TypeScript `moduleResolution` migration
The editor's TypeScript 6 flags `"moduleResolution": "Node"` (node10) in `apps/client/tsconfig.json` as deprecated; the project's TypeScript 5.9.3 builds fine. When the project moves to TypeScript 6+: switch the client to `module`/`moduleResolution` `Node16` and fix the type-only imports of `@reson8/shared-types` from CommonJS files (`resolution-mode` attributes or a `.cts`/`"type"` change). `ignoreDeprecations: "6.0"` can't be used before then (5.9 rejects it).

---

## Order and Releases

1. P1 (V1–V4) first — V4 is the beta.3 gate.
2. P2 (U1–U3) and P8 H1 → **`3.0.0-beta.4`**.
3. P3 (M1–M4), P4 W1, P5 (S1–S3), P6 G2 → **`3.0.0-beta.5`**.
4. Decision-gated items (W2, G1, L1, Q1) as the owner decides, each in its own beta.
5. H2 whenever TypeScript is upgraded.

Every beta: the full suites, a smoke run against a v2.7.0 server and a beta server, then `/bump-version`. Merging to `main` and the stable `3.0.0` are the owner's call.
