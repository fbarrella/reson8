# Reson8 — Phase 15 PRD

**Created:** 04/10/2026
**Author:** Felipe B. Netto (assisted by AI)
**Status:** Draft — Pending Review
**Source:** `app-planning/nextsteps.txt` (11 items) + the two server log files and three reference screenshots in `app-planning/`
**Branch:** `phase15-go`

---

## Table of Contents

1. [PRD 15.1 — Fix: Users Showing Offline After a Quick Reconnect (Stale-Socket Race)](#prd-151--fix-users-showing-offline-after-a-quick-reconnect-stale-socket-race)
2. [PRD 15.2 — Investigation: Constant Disconnects/Reconnects Session (Log Analysis + Diagnostics)](#prd-152--investigation-constant-disconnectsreconnects-session-log-analysis--diagnostics)
3. [PRD 15.3 — Fix: Pause Own Voice Halo While Muted](#prd-153--fix-pause-own-voice-halo-while-muted)
4. [PRD 15.4 — Chore: Show a Disabled Ban Button on Your Own User](#prd-154--chore-show-a-disabled-ban-button-on-your-own-user)
5. [PRD 15.5 — Chore: Pinned Message Bar → Dark Yellow](#prd-155--chore-pinned-message-bar--dark-yellow)
6. [PRD 15.6 — Fix: Remember Window Size and Position Between Sessions](#prd-156--fix-remember-window-size-and-position-between-sessions)
7. [PRD 15.7 — Fix: App Freezes After Re-Clicking the App Icon (Windows)](#prd-157--fix-app-freezes-after-re-clicking-the-app-icon-windows)
8. [PRD 15.8 — Chore: Google (Noto) Emoji on Every OS](#prd-158--chore-google-noto-emoji-on-every-os)
9. [PRD 15.9 — Image Viewer: Toolbar, Zoom, Copy, Open in Browser, "Sent By"](#prd-159--image-viewer-toolbar-zoom-copy-open-in-browser-sent-by)
10. [PRD 15.10 — Multi-Line Messages + Markdown Rendering](#prd-1510--multi-line-messages--markdown-rendering)
11. [PRD 15.11 — Reaction Hover Card](#prd-1511--reaction-hover-card)
12. [Cross-Cutting Dependencies & Recommended Implementation Order](#cross-cutting-dependencies--recommended-implementation-order)
13. [Open Decisions Confirmed With the User](#open-decisions-confirmed-with-the-user)
14. [Mapping to `nextsteps.txt`](#mapping-to-nextstepstxt)

---

> [!IMPORTANT]
> Every implementation must be tracked and logged into `app-planning/progress.txt`
> using the `/log-progress` slash command immediately after the item is completed
> and verified, following the established `--- Entry: DD/MM/YYYY ---` format. After
> each item: stage the code and commit locally (**no push** — the user pushes
> manually), then **stop and wait for explicit confirmation** before starting the
> next item. Complex UI/UX testing is done by hand by the user, not by Claude.
>
> Only after every item below is implemented and confirmed: run `/bump-version`
> (SemVer — this phase adds user-facing features, one additive wire-format field
> and no DB migration, all backward compatible, so a **minor** bump to `2.4.0` is
> expected pending the skill's own check), write the release notes into
> `app-planning/releases/`, and update all three `CLAUDE.md` files plus
> `README.md` to reflect the final Phase 15 feature set.
>
> **Non-regression rule:** no item may change behavior outside its stated scope.
> Each item's "Regression Risk" section lists exactly what it touches. Verification
> for every item always includes `npx tsc --noEmit`/`--build` in each affected
> workspace (shared-types → server → client, in that order) and, for server items,
> `npm run test`.

> [!NOTE]
> This PRD was written after reading the full `nextsteps.txt`, both log files line
> by line (correlating timestamps and socket IDs), the three reference images,
> and auditing the code each item touches: `connection.handler.ts`,
> `presence.service.ts`, `reaction.handler.ts`, `message.handler.ts`,
> `dm.handler.ts`, `main.ts`, `preload.ts`, `renderer.ts`, `index.html`, and the
> shared-types event maps. File paths and line numbers reflect the code as of
> 04/10/2026 (branch `phase15-go`, post-Phase-14, v2.3.0) — re-check them if the
> surrounding code has moved by the time an item is implemented. Where a root
> cause is **confirmed** (by log + code correlation) vs. **hypothesised** (cannot
> be reproduced from the repo alone) each item says so explicitly. Four points
> were resolved directly with the user (see
> [Open Decisions](#open-decisions-confirmed-with-the-user)); the rest are
> reasonable-default assumptions listed there too — flag anything you'd rather
> change before implementation starts.

---

## PRD 15.1 — Fix: Users Showing Offline After a Quick Reconnect (Stale-Socket Race)

**Type:** 🐛 FIX
**Priority:** Critical (it is also the main amplifier behind PRD 15.2)
**Affected Components:** Server only — `connection.handler.ts` (plus a small new helper module and tests). No wire-format change.

### Log Analysis (`logs 03-09-2026 2h08 (user reconnecting but staying offline).txt`)

This file alone **cannot** prove the bug: it contains no disconnect events at all, only
a user (`379d…`, nickname "DNG") hopping between `chan-game-room-1` ↔ `chan-lobby`
within 2 seconds (an ordinary click-through, which is where the interleaved
"Router destroyed / Cleaned up session" lines come from). It is consistent with, but
not evidence of, the race below. The conclusive evidence is in the second log file
(see PRD 15.2), which contains five complete occurrences of the exact sequence.

### Root Cause (confirmed — five-for-five log correlation + code audit)

Every occurrence in the 23h30–2h30 log follows the same shape (timestamps UTC):

| # | User | **New** socket connects + rejoins voice | **Old** socket "ping timeout" | Gap | Voice rejoin again |
|---|---|---|---|---|---|
| 1 | barrelleitor | 04:25:02 (`1Ai1…`) | 04:25:18 (`IVr1…`) | 16s | 04:25:30 (+12.4s) |
| 2 | Kdshy | 05:02:49 (`nEuH…`) | 05:03:16 (`KVaA…`) | 27s | 05:03:29 (+12.7s) |
| 3 | DNG | 05:04:10 (`6g4g…`) | 05:04:46 (`X28U…`) | 36s | 05:04:59 (+12.9s) |
| 4 | barrelleitor | 05:17:52 (`B-dz…`) | 05:18:21 (`1Ai1…`) | 29s | 05:18:33 (+12.2s) |
| 5 | barrelleitor | 05:20:36 (`XDpB…`) | 05:21:07 (`B-dz…`) | 31s | 05:21:20 (+12.7s) |

The client detects its dead connection first, Socket.io auto-reconnects, and the
client immediately re-runs `USER_JOIN_SERVER` + `attemptVoiceRejoin` on the **new**
socket (`preload.ts:313-345`). The server, meanwhile, still holds the **old,
half-open** socket (a TCP/WebSocket that never got a FIN — typical behind a
Cloudflare Tunnel or after a network change) until its own ping/pong times out
(`pingInterval 25s + pingTimeout 20s`, `index.ts:119-120`, so up to 45s). When the
old socket finally times out, its `disconnect` handler
(`connection.handler.ts:578-675`) runs and — because every piece of state is keyed
by **`userId`**, not by socket — it destroys the **new** socket's state:

1. `mediasoup.cleanupUserSession(currentChannelId, userId)` (`:626`) tears down the
   *live* voice session the new socket just built (this is the stray
   `[mediasoup] Cleaned up session for user …` line printed right before every
   `Client disconnected (grace period started) … ping timeout` in the log), and
   emits `PRODUCER_CLOSED` to the room. → The user's voice dies a **second time**,
   ~12s later the client's recovery notices and rejoins (the "+12.x s" column).
2. A 10s `pendingDisconnects` timer is armed for that `userId` (`:656-662`). The
   cancellation point lives in `USER_JOIN_SERVER` (`:290-297`), but the new socket
   already joined **before** this timer was created, so nothing ever cancels it.
   When it fires, `finalizeDisconnect` runs `presence.leaveChannel` +
   `presence.leaveServer` (deletes the user's Redis hash and `presence:server:*`
   membership) and broadcasts `USER_LEFT` — for a user who is, right now, connected
   and talking.
3. The client's second voice rejoin (+12s) then calls `presence.joinChannel`, which
   `HSET`s `channelId` into the just-deleted hash. The user is back in the channel's
   occupant set but has **no `serverId`** field and is absent from
   `presence:server:*` → they appear in the voice channel but vanish from the
   Online Users list, and everyone else received `USER_LEFT` for them. They stay
   "offline" until a full reconnect. This is precisely the reported symptom ("after
   a quick reconnect the users also stopped appearing as online, even though they
   got back to the chat room and kept using the app").

Secondary defect found while auditing: when the *new* socket's `USER_JOIN_SERVER`
runs `presence.joinServer`, it overwrites `channelId` with `""` without removing the
user from the old channel's `presence:channel:*` set. If the reconnecting client does
**not** rejoin the same channel (e.g. it wasn't in voice), the user remains a ghost
occupant of the old channel. (To be confirmed against the live code path when
implementing — see Verification.)

### Design Decisions

- **Socket ownership registry.** Introduce a small, pure, unit-testable helper
  (`apps/server/src/services/socket-ownership.ts`) that maps `userId → owning
  socketId` for **primary** sockets only (viewer sockets are excluded — they already
  use their own `viewer:{socket.id}` mediasoup key, `getMediasoupSessionKey`).
  `USER_JOIN_SERVER` registers the new socket as owner.
- **Supersede on re-authentication (the proper fix).** When `USER_JOIN_SERVER`
  arrives for a `userId` that already has a *different* live owner socket, the old
  socket is explicitly **superseded**, deterministically and *before* the new
  socket's voice handshake can race it: flag it (`socket.data.superseded = true`),
  run its `userId`-keyed cleanup once right there (mediasoup session cleanup +
  `PRODUCER_CLOSED`, `presence.leaveChannel` + `PRESENCE_UPDATE` broadcast if it had
  a `currentChannelId`), then `oldSocket.disconnect(true)`. Zombie sockets stop
  lingering for up to 45s.
- **Ownership-guarded `disconnect` handler (defense in depth).** At the top of the
  non-viewer branch: if this socket is **not** the registered owner of its `userId`
  (it was superseded, or something newer took over), do *only* socket-scoped work
  (log "Stale socket disconnected (superseded)") — no `userId`-keyed mediasoup
  cleanup, no `pendingDisconnects`, no `finalizeDisconnect`. If it **is** the owner,
  behavior is exactly today's (immediate mediasoup cleanup, grace period, immediate
  finalize on `"client namespace disconnect"`), and the registry entry is cleared.
- **Re-check at timer fire.** The `pendingDisconnects` callback verifies no live
  owner has appeared for that `userId` before calling `finalizeDisconnect` (covers
  any interleaving the above two layers miss).
- **Ghost-occupant cleanup.** On supersede, if the old socket had a
  `currentChannelId`, remove the user from that channel's presence set and broadcast
  `PRESENCE_UPDATE` (the new socket's own `USER_JOIN_CHANNEL` re-adds them if it
  rejoins).
- **No change to** the 10s grace period, the `"client namespace disconnect"`
  fast-path, the viewer-socket path, the client reconnect logic, or Socket.io ping
  settings.

### Files to Modify

- `apps/server/src/services/socket-ownership.ts` — **new**, pure registry (`claim`,
  `release`, `isOwner`, `ownerOf`).
- `apps/server/src/handlers/connection.handler.ts` — `USER_JOIN_SERVER` (claim +
  supersede), `disconnect` (ownership guard, release), the grace-timer callback
  (re-check).
- `packages/shared-types/src/` — `SocketData` gains an optional `superseded?:
  boolean` (types only; not on the wire).
- `apps/server/src/__tests__/socket-ownership.test.ts` — **new** (vitest).

### Regression Risk

Touches the disconnect/presence path that every user hits. The ownership guard is a
strict *narrowing*: the only behavior change is for sockets that are provably not the
current owner of their `userId`. The ordinary single-socket flows (normal quit,
brief drop with reconnect, kick, ban, channel switch) must behave identically —
verified with the checklist below. Kick/ban handlers that iterate `io.sockets` by
`userId` should be re-read to confirm they target the owner socket.

### Verification

- `npm run test` (server) — new unit tests with `vi.useFakeTimers()`: stale-socket
  disconnect does **not** finalize; owner disconnect still starts the grace period
  and finalizes after it; a re-claim during the grace period cancels the finalize;
  timer-fire re-check skips finalize when a live owner exists.
- `npx tsc --noEmit` (shared-types, server).
- Manual (two clients, same `instanceId` is hard — use the dev server and simulate
  the zombie by blocking the first client's network, e.g. `iptables`/disconnecting
  the NIC, then reconnecting): after reconnect the user **stays** in Online Users,
  stays in the voice channel, and voice is **not** dropped a second time ~12–45s
  later; server log shows the old socket logged as superseded, with no stray
  `Cleaned up session` for the live user.
- Regression sweep: normal quit still removes presence immediately; a real
  disconnect (kill the client) still removes presence after ~10s; kick, ban, channel
  switching, screen share viewer open/close behave as before.

---

## PRD 15.2 — Investigation: Constant Disconnects/Reconnects Session (Log Analysis + Diagnostics)

**Type:** 🔍 INVESTIGATION (+ small diagnostics)
**Priority:** High
**Affected Components:** Server `connection.handler.ts` logging; client Server Log tab messaging. Deliverable also includes a written report appended to `progress.txt`.

### Findings (`logs 03-09-2026 23h30-2h30 disconnections and connections.txt`)

Log window is 02:34–05:32 UTC (23:34–02:32 local). Findings, separated by what is
proven and what is not:

**Proven — an application bug amplified every blip (fixed by PRD 15.1).** The five
events in the table in PRD 15.1 account for **all** of the abnormal disconnect/
reconnect churn in the log. Each *single* network blip produced **two** voice drops
for that user: the real one (when the client reconnects and rebuilds its voice
session on the new socket), and a **second, self-inflicted** one 16–36s later when the
zombie socket's timeout destroyed the freshly rebuilt session, followed by a
consistent ~12.2–12.9s recovery delay (the client's transport-failure detection →
`attemptVoiceRejoin`). It also made those users "go offline" (PRD 15.1). From the
users' perspective this reads as "constant disconnections and reconnections" and as
a flapping presence list. The remaining events in the log are normal:
02:35:39 `transport close` → reconnect 8s later (one genuine blip); rapid
channel-hopping at 02:36:12 (user clicking); the 05:32 shutdown is clean
(`client namespace disconnect`, finalized immediately).

**Not provable from the logs — the underlying network drops themselves.** The log is
server-side only. What *can* be said: every old socket died by `ping timeout` while
the client had already reconnected 16–36s earlier (all under the 45s
`pingInterval+pingTimeout` ceiling), which is the signature of **half-open
connections** — the path between client and server went away without either side
receiving a close. Three different users hit it within one hour (04:25–05:21) with
no events 02:45–04:25, which points to an upstream/path cause (ISP, the Cloudflare
Tunnel edge reconnecting, or the server host's uplink) rather than a defect in any
one client. There is **no evidence in the logs of an application-level cause** for the
drops themselves, and nothing that would justify changing the Socket.io ping
settings (lowering them would trade fewer zombies for more false disconnects on
weak links; with PRD 15.1 a zombie is harmless anyway).

### Deliverables

1. **The fix:** PRD 15.1 (removes the second drop and the offline-presence bug).
2. **Diagnostics so the *next* incident can be classified without guesswork** (small,
   additive, no behavior change):
   - Server `disconnect` log line gains `transport` (`socket.conn.transport.name`),
     `connectedForMs` (socket lifetime), and `superseded: boolean`. The `connect`
     log gains the handshake `address`/`x-forwarded-for` (already available) so
     per-user network pathing is visible (IP changes = roaming Wi-Fi/cellular).
   - Client: the `"disconnected"` event (`renderer.ts:2717`) currently drops the
     reason; surface it in the Server Log tab ("Disconnected: ping timeout —
     reconnecting…") and log the reconnect duration when it recovers. That gives the
     user a client-side timeline to put next to the server log.
3. **Written report** appended to the PRD 15.1/15.2 `progress.txt` entry (the
   findings above, in the established Problem/Solution format) stating clearly that
   the root network drops are connectivity-side and not fixable in-app, while the
   amplification was.

### Explicitly Out of Scope (decided, not forgotten)

- Changing `pingInterval`/`pingTimeout`, enabling Socket.io `connectionStateRecovery`,
  or adding a client-side keepalive: no evidence they'd help, and PRD 15.1 neutralizes
  the harm. Revisit only if post-15.1 logs still show user-visible churn.

### Files to Modify

- `apps/server/src/handlers/connection.handler.ts` — log fields only.
- `apps/client/src/renderer/renderer.ts` — `"disconnected"`/`"connected"` log messaging.
- `app-planning/progress.txt` — via `/log-progress`.

### Regression Risk

Log-text/field changes only. Ensure nothing parses the existing Server Log strings
(grep before editing).

### Verification

`npx tsc --noEmit` (server, client). Force a disconnect (stop the server briefly) and
confirm the new server fields and the client's Server Log message appear.

---

## PRD 15.3 — Fix: Pause Own Voice Halo While Muted

**Type:** 🐛 FIX
**Priority:** Medium
**Affected Components:** Client only — `renderer.ts`.

### Root Cause (confirmed via audit)

`startMicLevelMeter()` (`renderer.ts:6942`) computes "speaking" purely from the
local analyser level vs. the noise-gate threshold, and `setLocalSpeakingClass()`
toggles the halo on the user's own `.tree-occupant`. The analyser taps the graph
*before* the point where mute takes effect (`track.enabled`/gate, see
`voice.service.ts` `setMuted`/`toggleMute`), so the halo keeps reacting to your voice
while you are muted — which looks like "you're being heard". The same applies to
deafen (which implies mute) and to push-to-talk idle (mic closed while the PTT key
isn't held; `isMuted` there means "PTT locked", see the comment at `renderer.ts:1986`).

### Design Decisions

- Define one derived predicate, e.g. `isLocalMicTransmitting()`: `isInVoice &&
  !isMuted && !isDeafened && (!pttModeEnabled || pttKeyHeld)`. The exact PTT-held
  state variable is wired in `api.on("ptt-pressed"/"ptt-released")`
  (`renderer.ts:4986-4993`); reuse it, don't add a second source of truth.
- In the `tick()` loop, `speaking = transmitting && dB > threshold`.
- On **every** mute/deafen/PTT transition, immediately clear the halo (cancel
  `localSpeakingHoldTimer`, set `isLocalSpeaking = false`, `setLocalSpeakingClass(false)`)
  rather than waiting for the 300ms hold timer — so the halo vanishes the instant
  you mute.
- The **Settings → Voice mic level meter bar stays live while muted** (it is a
  configuration aid; the user asked only for the voice-channel participant visual).
  Flagged in Open Decisions.
- Other participants' halos (server-driven `ACTIVE_SPEAKERS`) are unchanged.

### Files to Modify

- `apps/client/src/renderer/renderer.ts` — `startMicLevelMeter`, the mute/deafen/PTT
  handlers (a single `refreshLocalSpeakingHalo()` call from each).

### Regression Risk

Must not delay the halo for the un-muted case (PRD 14.11's latency work). The
predicate is a pure additional AND on the existing condition.

### Verification

`npx tsc --noEmit` (client). Manual: talk → halo; mute → halo disappears immediately
and stays off while talking; unmute → returns; deafen → off; PTT mode: no halo until
the key is held; Settings meter still moves while muted; others' halos unaffected.

---

## PRD 15.4 — Chore: Show a Disabled Ban Button on Your Own User

**Type:** 🔧 CHORE
**Priority:** Low
**Affected Components:** Client only — `renderer.ts` (User Management tab), `index.html` (CSS).

### Current State

`renderer.ts:3403-3431`: the Ban/Unban button is rendered only `if (canBanUsers &&
user.id !== myId)`, so your own row has no button and the rows are visually
inconsistent.

### Design Decisions

- Render the button for your own row too when `canBanUsers`, as a real `<button
  disabled>` (semantic disabled — unclickable, not focusable, no listener attached),
  with `aria-disabled="true"` and `title="You can't ban yourself"`. Same Ban icon and
  label so the row layout matches.
- Styling via `.btn-ban:disabled` — greyed-out (muted text/border, no hover effect,
  `cursor: not-allowed`).
- Server remains the authority: verify `moderation.handler.ts` already rejects
  self-ban (and add the check if not) so the disabled UI is never the only guard.

### Files to Modify

- `apps/client/src/renderer/renderer.ts` — the conditional at `:3407`.
- `apps/client/src/renderer/index.html` — `.btn-ban:disabled` rule.
- `apps/server/src/handlers/moderation.handler.ts` — only if the self-ban guard is missing.

### Regression Risk

Row layout for other users unchanged; confirm the click handler is attached only for
non-self rows.

### Verification

Typecheck. Manual: your row shows a grey, unclickable Ban; others' rows still ban/
unban and refresh the list; hover/click on yours does nothing.

---

## PRD 15.5 — Chore: Pinned Message Bar → Dark Yellow

**Type:** 🔧 CHORE
**Priority:** Low
**Affected Components:** Client only — `index.html` CSS (`.pinned-bar`, `:684-714`).

### Current State

`.pinned-bar` uses `--bg-secondary` (#16213e) with `--text-secondary` — nearly the
same blue as the background, so it doesn't stand out.

### Design Decisions

Readability is the stated priority, so choose from measured contrast, not taste:

- Background: dark amber, e.g. `#4a3b0a`; text `#fff3c4`; icon `#ffd54f`; bottom
  border `#b8860b`; hover a slightly lighter amber. Estimated text/background
  contrast ≈ **9.8:1** (WCAG AAA ≥ 7:1) — re-measure the final values with a
  contrast checker during implementation, and keep ≥ 7:1.
- Define the colors as CSS custom properties next to the existing theme tokens
  (`--pin-bg`, `--pin-text`, `--pin-accent`, `--pin-border`) instead of hard-coding
  in the rule, matching how the rest of `index.html` themes.
- Keep it sitting well beside the app's blue chrome: no change to height, padding,
  ellipsis behavior or click-to-jump.
- The pinned-message preview text becomes plain text once PRD 15.10 lands (see
  there); this item only restyles.

### Files to Modify

- `apps/client/src/renderer/index.html` — `.pinned-bar`, `:hover`, `svg`, text rules, tokens.

### Regression Risk

CSS-only. Check the bar's other states (no pinned message → hidden; very long text →
ellipsis).

### Verification

Manual visual check in a channel with a pinned message — legible at a glance, hover
state visible, icon visible.

---

## PRD 15.6 — Fix: Remember Window Size and Position Between Sessions

**Type:** 🐛 FIX (UX)
**Priority:** Medium
**Affected Components:** Client only — `main.ts` (+ a new small module).

### Current State

`createWindow()` (`main.ts:443`) always opens a hard-coded `1024×768`
(`minWidth 800`, `minHeight 600`); nothing is persisted.

### Design Decisions

- **Hand-rolled, no new dependency.** A small `apps/client/src/window-state.ts`
  (≈80 LOC) rather than `electron-window-state` (unmaintained; this project's
  history shows the cost of dependency surprises — see the ESM/CJS gotchas in the
  root `CLAUDE.md`).
- Persist `{ x, y, width, height, isMaximized }` as JSON under
  `app.getPath('userData')/window-state.json`. Always save **`getNormalBounds()`**,
  so a maximized/minimized window doesn't overwrite the "normal" size the user
  returns to when un-maximizing.
- **Save triggers:** `resize`/`move` debounced (~500ms) and a synchronous flush on
  `close`. Never save while minimized or hidden-to-tray (bounds are meaningless
  there). Atomic write (temp file + `rename`) so a crash can't leave corrupt JSON;
  a corrupt/missing file falls back to defaults, never throws.
- **Restore validation (the part that usually breaks):** only restore `x/y` if the
  saved rectangle still sufficiently intersects some `screen.getAllDisplays()`
  `workArea` (monitor unplugged / resolution changed → fall back to centered on the
  primary display); clamp `width/height` to ≥ the existing min size and ≤ the target
  display's work area; reject non-finite/negative values. Then `maximize()` after
  construction if `isMaximized`.
- **Wayland caveat (documented, not fixable):** Wayland compositors don't let apps
  set their own window position; size and maximized state restore, position is up to
  the compositor. (The primary dev environment is KDE/Wayland — see memory.) X11,
  Windows and macOS restore position fully.
- Applies to dev and packaged builds alike. The PRD 15.7 hide/restore logic and the
  tray flows are not touched.
- Out of scope: the Viewer window (`main.ts:930`), the Settings modal.

### Files to Modify

- `apps/client/src/window-state.ts` — **new**.
- `apps/client/src/main.ts` — `createWindow()` construction options + event wiring.

### Regression Risk

Window creation is on the startup path; every failure branch must fall back to
today's defaults so a bad state file can never prevent launch. The min-size
constraints must still hold.

### Verification

Typecheck. Manual: resize/move, quit, relaunch → same size/position; maximize, quit,
relaunch → maximized, un-maximize returns to the previous normal size; delete/
corrupt the JSON → launches with defaults; (multi-monitor) move to monitor 2, quit,
unplug monitor 2, relaunch → lands on the primary display, fully visible.

---

## PRD 15.7 — Fix: App Freezes After Re-Clicking the App Icon (Windows)

**Type:** 🐛 FIX
**Priority:** High
**Affected Components:** Client only — `main.ts`.

### Current State and Honest Confidence

The single-instance handler (`main.ts:29-34`) does `restore()` if minimized, `show()`
if hidden, then `focus()`. The reported symptom — the window comes forward but is
unresponsive/not repainting until minimized and reopened, **on Windows** — **cannot be
reproduced from the repo**, so the root cause is **hypothesised, not confirmed**. The
two leading hypotheses (both have well-known Electron/Windows precedent) and one
diagnostic step are specified; the item is complete only when the user confirms on a
Windows machine.

- **H1 — `hide()` called inside the `minimize` event.** With minimize-to-tray on,
  `main.ts:527` calls `mainWindow.hide()` from the `'minimize'` handler, leaving a
  window that is *both* minimized and hidden. The second-instance and tray-Restore
  paths then do `restore()`/`show()` on a window in that half-state (the tray's
  Restore only calls `show()`, `:561`). **Fix:** use `will-minimize` (Windows/macOS)
  with `event.preventDefault()` + `hide()` when minimize-to-tray is on, so the window
  never enters the minimized state; keep the existing `'minimize'` path (and its
  `window-minimized` IPC for collapsing expanded messages) for plain minimizes.
- **H2 — Chromium native window occlusion tracking (Windows).** A known cause of "the
  window is shown but frozen until you minimize/restore": Chromium wrongly marks the
  restored window as occluded and stops painting. **Fix:** on Windows only, before
  `app.whenReady()`, `app.commandLine.appendSwitch('disable-features',
  'CalculateNativeWinOcclusion')` (merging with any existing `disable-features`
  value). Trade-off: slightly more background work when the window is covered —
  acceptable for a voice app that must keep timers/animations live.
- **Diagnostics (always):** log window state (`isMinimized/isVisible/isFocused/
  isMaximized`, `webContents.isCrashed()/isLoading()`) on `second-instance` and on
  tray restore to the main-process console, so if both fixes don't resolve it there
  is evidence, not guesses.

### Design Decisions

- Centralise the "bring the window forward" logic into one `showMainWindow()` helper
  used by `second-instance`, the tray click and the tray "Restore" item (currently
  three divergent code paths): guard `!mainWindow || isDestroyed()`;
  `restore()` if minimized; `show()` if hidden; `moveTop()`; `focus()`.
- Do **not** add speculative hacks (`setAlwaysOnTop` toggling, forced
  `webContents.invalidate()` loops) unless the diagnostics show they're needed.
- Interplay with PRD 15.6: window-state saving must ignore the hidden/minimized
  states (already specified there).

### Files to Modify

- `apps/client/src/main.ts` — `second-instance` handler, `createTray()` handlers,
  the minimize handler, a pre-ready `commandLine` switch (Windows only), the new helper.

### Regression Risk

Minimize-to-tray and close-to-tray are user-visible features: re-test both, plus
the collapse-expanded-messages-on-minimize behavior (`window-minimized` IPC must
still fire for a plain minimize, and should also fire when `will-minimize` intercepts
for tray, to preserve current behavior).

### Verification

Typecheck. **Manual, on Windows (cannot be done on the Linux dev machine):**
minimize-to-tray on → minimize → click the app icon again → window returns and is
interactive; same from close-to-tray; same from plain minimize and from behind other
windows; repeat 10×; confirm tray click/Restore also work. If it still freezes,
attach the new diagnostics output and revisit.

---

## PRD 15.8 — Chore: Google (Noto) Emoji on Every OS

**Type:** 🔧 CHORE
**Priority:** Medium
**Affected Components:** Client only — `index.html` (CSS/CSP), `assets/`, `package.json` (packaging).

### Current State

Emoji are plain Unicode text rendered by each OS's system emoji font (Segoe UI Emoji
on Windows, Apple Color Emoji on macOS, Noto on most Linux) → the same message looks
different per platform. Windows also lacks flag glyphs entirely (flags render as
letter pairs).

### Design Decisions (per the confirmed decision: bundle the font)

- **Vendor Google's Noto Color Emoji as a web font**, self-hosted under
  `apps/client/assets/fonts/noto-color-emoji/` (same vendoring principle as
  `assets/deepfilternet/` — never a third-party CDN; the CSP wouldn't allow it and the
  app must work offline). Use the COLRv1/woff2 build with its `unicode-range`
  subsets (the Google Fonts / `@fontsource/noto-color-emoji` distribution), taken as
  *assets* (copied once, no runtime npm dependency). Include the OFL license text
  alongside it. Final asset size is measured and recorded when implemented (the PRD
  does not assume one; target well under ~10 MB).
- **Why a font and not per-emoji images:** emoji stay real text, so selection, copy/
  paste, the chat `<textarea>`, the emoji picker, solo-emoji 4× scaling (COLRv1 is
  vector — crisp at any size), reactions, and `Intl.Segmenter`-based logic keep
  working untouched; no DOM rewriting.
- **Critical gotcha — keep `unicode-range`:** Noto Color Emoji also contains glyphs
  for `0-9 # * © ® ™`. Declaring it without `unicode-range` would render digits in
  the emoji font. The vendored `@font-face` rules must carry Google's emoji-only
  ranges.
- **Font stack:** add `'Reson8 Emoji'` as the first family in the shared `--font`
  stack and on every element that overrides `font-family` and can display emoji
  (grep `font-family` in `index.html`: the monospace event log `:721`, code-ish
  blocks `:1462`, `:1476`, `:1861`, inputs/textarea/buttons that don't inherit).
- **CSP:** `font-src` currently allows only `https://fonts.gstatic.com`; add `'self'`.
  No other directive changes.
- **Packaging:** `assets/**/*` already ships in `build.files`; still verify the fonts
  are present in a packed build (the CLAUDE.md "silently vanish from packaged
  builds" gotcha) and that the relative URL resolves the same way the sound-alert /
  deepfilternet assets do from `dist/renderer/index.html`.
- `font-display: block` (short block period) so first paint doesn't flash a system
  emoji then swap.
- **Out of scope (OS-rendered, cannot be styled):** the native window title
  (`🔴` while sharing), tray menu, native notifications, and the Viewer window
  title bar.

### Files to Modify

- `apps/client/assets/fonts/noto-color-emoji/**` — **new** vendored font + license.
- `apps/client/src/renderer/index.html` — `@font-face`, `--font` and per-element
  stacks, CSP `font-src`.
- `apps/client/package.json` — only if packaging needs an explicit entry.

### Regression Risk

Typography-wide change: digits/punctuation must still render in the normal UI font
(the `unicode-range` check), line-heights must not shift (emoji glyph metrics differ
slightly per font — check chat rows, the picker grid, reaction pills, solo-emoji
messages, channel-tree icons).

### Verification

Typecheck + build. Manual (**Windows verification is required** — COLRv1 web-font
rendering is expected on Chromium/Electron 34 on all platforms, but it's the one
thing not provable from Linux): emoji look identical on Windows and Linux; flags
render; digits and `#`/`*` in text still use Inter; picker, reactions, solo-emoji,
custom-emoji `:name:` tokens and the chat input all fine; packed build contains the
font files (`npm run build:linux` + inspect the asar/unpacked output). Fallback if
COLRv1 misbehaves on a target: ship the bitmap (CBDT) build instead (larger, same
approach).

---

## PRD 15.9 — Image Viewer: Toolbar, Zoom, Copy, Open in Browser, "Sent By"

**Type:** ✨ FEATURE
**Priority:** Medium
**Affected Components:** Client — `index.html`, `renderer.ts`, `preload.ts`, `main.ts`. No server/shared-types change.

### Current State

`openLightbox(imageUrl)` (`renderer.ts:5189`) shows the image in `#image-lightbox-modal`
(`index.html:1310-1387`, markup `:3973`) with `max-width/height: 90vw/90vh`, a text
"Close" button at top-left and a text "Download" button at top-right
(`api.downloadImage` → `webContents.downloadURL`, `main.ts:728`). Callers:
`renderer.ts:3937`, `:3950` (NSFW overlay click) and `:4262` (DM). Esc and backdrop
click close it. Very tall images are shrunk to fit and become unreadable.

### Design (modeled on `print_discord_image_viewer.png`)

**Layout.** A horizontal, icon-only toolbar pill (rounded, translucent dark) in the
top-right containing, in order: **Zoom In · Zoom Out · Copy Image · Copy Link · Open
in Browser · Download**. The **Close** button is a separate square button at the far
top-right, outside the pill. Every control is an inline SVG (stroke style matching the
app's existing icons: 24-viewBox, `currentColor`, 2px stroke), a real `<button
type="button">` with `aria-label`, `:focus-visible` outline, and a **tooltip with the
full action name** (CSS `data-tooltip` pseudo-element for instant, consistent display
instead of the ~1s native `title` delay; `aria-label` carries the name for assistive
tech). The toolbar and close button are `-webkit-app-region: no-drag`.

**"Sent by".** A translucent pill at the **top-left**: `Sent by <nickname> · <date,
time>`. `openLightbox(imageUrl, meta?)` gains an optional `{ senderNickname, sentAt }`
second argument; all three call sites pass it from the message in scope (channel and
DM both have nickname + `createdAt`). Missing meta → the pill simply isn't rendered
(the viewer must never break if a caller omits it).

**Zoom (per the confirmed decision: percent of natural size).**
- State: `naturalW/H` from the loaded `<img>`; `fitScale = min(1, 0.9·vw/naturalW,
  0.9·vh/naturalH)` (never upscales small images, same as today); `scale ∈ [fitScale,
  2.0]` where **2.0 = 200% of the image's natural pixel size**; opens at `fitScale`.
- Zoom In/Out step through the stops `[fitScale, 0.25, 0.5, 0.75, 1, 1.25, 1.5,
  1.75, 2]` (filtered to ≥ fitScale); buttons disable at the ends. Also: mouse wheel
  zooms toward the cursor, `+`/`-` keys zoom, `0` resets to fit, double-click toggles
  fit ↔ 100%/200%.
- Rendering: apply `transform: translate() scale()` on the `<img>` (GPU-composited,
  no layout thrash, GIFs keep animating, no re-decode); pan by dragging with Pointer
  Events + `setPointerCapture` while `scale > fitScale` (`cursor: grab/grabbing`),
  clamped so the image can't be dragged out of view; recompute `fitScale` on window
  resize; reset on every open/close. A drag must not be treated as a backdrop click.
- A small transient zoom-percentage indicator appears while zooming.

**Copy Image.** Renderer asks main (`ipcMain.handle("fetch-image-bytes", url)`) to
`net.fetch` the bytes — in the main process, so there are no CORS/`<canvas>`-taint
problems — validating `http:`/`https:` only, `Content-Type: image/*`, a 25 MB cap and a
15s timeout. The renderer decodes with `createImageBitmap`, re-encodes to PNG via an
offscreen canvas (this also normalizes WebP/GIF, which `nativeImage.createFromBuffer`
doesn't reliably read; an animated GIF copies as its first frame — documented), and
sends the PNG bytes to a new preload method that calls Electron's `clipboard.writeImage(
nativeImage.createFromBuffer(...))`. (Chosen over `navigator.clipboard.write` because
the app's `setPermissionRequestHandler` only whitelists media permissions, making the
async-clipboard permission path unreliable.) Success/failure → the existing toast.

**Copy Link.** New preload method → `clipboard.writeText(absoluteUrl)` + toast.

**Open in Browser.** New IPC → `shell.openExternal(url)` after validating
`http:`/`https:` (same rule as the existing `setWindowOpenHandler`).

**Download.** Unchanged behavior (`api.downloadImage`), just moved into the toolbar.
Close, Esc, backdrop-click, NSFW click-through, and `closeLightbox()` clearing `src`
all keep working. Video lightbox is untouched.

### Files to Modify

- `apps/client/src/renderer/index.html` — toolbar/sent-by markup + CSS (replaces the
  old two-button CSS at `:1339-1387`), zoom states.
- `apps/client/src/renderer/renderer.ts` — `openLightbox`/`closeLightbox`, zoom/pan
  controller, toolbar handlers, the three call sites.
- `apps/client/src/preload.ts` — `copyImageToClipboard(pngBytes)`, `copyText(text)`,
  `openExternal(url)`, `fetchImageBytes(url)`.
- `apps/client/src/main.ts` — `fetch-image-bytes` and `open-external-url` IPC handlers.

### Regression Risk

Moderate: the lightbox is opened from channel, DM and NSFW paths. Keep `#image-
lightbox-modal`'s id, `.visible` toggle and Esc handler contract. Make sure the new
wheel/keyboard handlers are only active while the modal is visible (the global
`keydown` listener at `renderer.ts:5213` must not swallow `+`/`-`/`0` from the chat
input).

### Verification

Typecheck (client). Manual: open from a channel image, a DM image, and an NSFW image;
toolbar order/icons/tooltips match the reference; zoom in/out limits (fit → 200% of
natural), wheel-zoom, pan, reset, double-click; a very tall and a very wide image;
a tiny image; copy image → paste into the chat attachment area / an external app; copy
link; open in browser; download; Esc/backdrop/Close; sent-by shown for channel + DM;
a failing/blocked URL shows an error toast instead of hanging.

---

## PRD 15.10 — Multi-Line Messages + Markdown Rendering

**Type:** ✨ FEATURE
**Priority:** High (largest item — touches the message pipeline end to end)
**Affected Components:** Client (`index.html`, `renderer.ts`, `preload.ts`, a new `markdown.ts`), server only for input normalization. No DB or wire-format change.

### Current State (confirmed via audit)

- The chat box is a single-line `<input type="text" id="chat-input">`
  (`index.html:3306`, typed as `HTMLInputElement` at `renderer.ts:986`) — newlines
  can't even be typed; pasting multi-line text collapses it to one line.
- Message bodies are built with `linkifyContent()` (`renderer.ts:3129`): HTML-escape +
  URL linkify + `:custom_emoji:` tokens, placed in an **inline** `<span
  class="msg-text">` after `[time] nick` (`renderer.ts:3929` channel, `:4254` DM, plus
  the edit paths around `:5815`/`applyMessageEdit`). Single-emoji messages get a 4×
  class via `isSoloEmojiMessage()`; long messages clamp to 4 lines with a "See more"
  pill (`attachMessageTruncation`, `:4082`, CSS line-clamp `index.html:793`).
- The server already preserves interior newlines (`content.trim()` only trims the
  ends, `message.handler.ts:137`, `:359`; DMs likewise) and enforces a max length.
- `markdown-it` is already a dependency but used **only in the main process** for the
  "What's New" modal (`main.ts:14`, `:108`). The renderer is a plain `<script>` with no
  bundler and a strict CSP (`script-src 'self' blob:`), so it can't `import` it.

### Design Decisions

**Input.**
- `<input>` → `<textarea id="chat-input" rows="1">` (retype to `HTMLTextAreaElement`,
  audit every `chatInput` use incl. emoji-picker insertion via `selectionStart`/
  `setRangeText`, `.value = ""` after send, focus handling, and `chatInputBar` flex
  alignment so attach/emoji/send buttons stay bottom-aligned).
- **Enter sends, Shift+Enter inserts a newline** (the existing handler already checks
  `!e.shiftKey`, `renderer.ts:4158`), ignoring Enter while `e.isComposing` (IME
  composition). Auto-grow to ~8 lines then scroll internally; collapse back after send
  or when emptied. The in-place **edit** box (`renderer.ts:~5800`) becomes a textarea
  with the same keys (Enter saves, Shift+Enter newline, Esc cancels, blur saves —
  unchanged).
- Paste keeps newlines natively. Server: normalize `\r\n`→`\n` before trim/length
  check (messages + DMs + edits); the existing character cap now counts newlines too.

**Markdown (per the confirmed decision: Discord-style).** One new module,
`apps/client/src/markdown.ts`, a *pure* function with no Electron imports (so it can
be smoke-tested in plain Node), imported by `preload.ts` and exposed to the renderer as
a synchronous `reson8Api.renderMarkdown(text)` — the same pattern that already keeps
Node-only libraries out of the renderer, with no async round-trip per message when
rendering 20+ messages.
- Engine: `markdown-it` (`html: false`, `linkify: true`, `breaks: true`, no
  typographer), already a dependency, real CJS build (safe per the CLAUDE.md ESM/CJS
  gotcha — verify with `npm view markdown-it exports` anyway).
- **Enabled:** `**bold**`, `*italic*`/`_italic_`, `__underline__`, `~~strike~~`, `>`
  quotes, `-`/`*`/`1.` lists, `#`–`###` titles, `` `inline code` `` and fenced code
  blocks (monospace, horizontal scroll, **no syntax highlighting** — non-goal), and
  bare-URL auto-links (linkify) rendered with `target="_blank" rel="noopener
  noreferrer" class="msg-link"` (the existing `setWindowOpenHandler` routes them to the
  system browser — never navigates the app window).
- **Underline** is the one non-CommonJS-Markdown piece: markdown-it parses `__x__` as
  `strong` with `token.markup === "__"`; override the `strong_open`/`strong_close`
  renderer rules to emit `<u>` when `markup === "__"` and `<strong>` otherwise.
- **Disabled on purpose:** raw HTML (never), images `![](…)` (no remote loads/tracking
  /layout abuse), masked links `[text](url)` (phishing spoof — Discord also forbids
  them for users; auto-links only; **flagged in Open Decisions**), tables, setext
  headings, horizontal rules, link reference definitions, `h4+` (rendered as plain
  paragraph).
- **Custom emoji `:name:`:** a custom inline rule registered **before** `emphasis` so
  names containing underscores (`:my_emoji_name:` — legal in this app) aren't eaten as
  italics. The preload keeps the approved-emoji list (a `setCustomEmojis(list)` call
  made by the renderer whenever its list changes, rather than copying the list across
  the context bridge on every render). Unknown `:name:` stays literal text — same
  behavior as today.
- **Defense in depth:** `html:false` + markdown-it's `validateLink` (blocks
  `javascript:`/`vbscript:`/`file:`/`data:`) is the primary guard; additionally the
  renderer passes the output through a ~30-line allow-list sanitizer (DOMParser; allowed
  tags `p br strong em u s del blockquote ul ol li h1 h2 h3 pre code a span img`;
  attributes only `href`/`class`/`src` and only on the tags that need them; `img` only
  for the custom-emoji class; `href` restricted to `http(s):`) before assigning
  `innerHTML` — chosen over adding DOMPurify, which needs a bundler this project
  deliberately doesn't have.
- **Layout (non-regression for existing messages):** a message that is a single line
  with no block syntax keeps today's **inline** layout (`[time] nick text`), rendered
  via the inline path (drop markdown-it's wrapping `<p>` when the token stream is a
  lone paragraph with no soft breaks). Anything with a newline or block syntax renders
  as a **block** (`.msg-text.msg-text-block`) starting on its own line under the
  `[time] nick` header. Solo-emoji messages bypass markdown entirely (existing
  `isSoloEmojiMessage` path) so the 4× rendering is untouched.
- **One rendering helper** — a single `renderMessageBody(el, content)` used by channel
  messages, DMs, and edit re-render — replacing the three ad-hoc `linkifyContent` call
  sites so behavior can't drift between them. `linkifyContent` is removed or reduced to
  a fallback if the preload API is unavailable.
- **Truncation:** `-webkit-line-clamp` is unreliable across nested block children
  (lists, quotes, code blocks), so switch the clamp to `max-height` (≈4 lines) +
  `overflow: hidden`, detecting overflow with the same `scrollHeight > clientHeight`
  check; "See more"/"See less" and collapse-on-minimize keep working.
- **Link previews** are unchanged: `extractFirstUrl(rawText)` still reads the raw
  source, so a previewable URL inside a message still produces its card.
- **Pinned bar preview and any other one-line previews** (grep for places that show
  `content` — pinned bar, notifications/toasts) use a `markdownToPlainText()` helper
  (token walk → text, newlines → spaces) so they never show `**`/`#` syntax or
  multi-line text.
- **Verification without new test infra:** the client has no unit-test runner.
  Because `markdown.ts` is a pure module, add a Node smoke script
  (`apps/client/scripts/markdown-smoke.mjs`, run after `tsc --build`) asserting the
  important cases: each syntax renders as expected, underline vs bold, custom emoji
  with underscores, and a table of **XSS vectors** (`<script>`, `<img onerror>`,
  `[x](javascript:…)`, `data:` URLs, nested HTML, malformed markdown) all coming out
  inert.

### Files to Modify

- `apps/client/src/markdown.ts` — **new** (pure).
- `apps/client/scripts/markdown-smoke.mjs` — **new**.
- `apps/client/src/preload.ts` — `renderMarkdown`, `markdownToPlainText`, `setCustomEmojis`.
- `apps/client/src/renderer/renderer.ts` — textarea wiring, `renderMessageBody`, sanitizer, the call sites, edit box, pinned-bar preview, truncation.
- `apps/client/src/renderer/index.html` — textarea markup/CSS, message block/quote/list/code/heading styles, clamp change.
- `apps/server/src/handlers/message.handler.ts`, `dm.handler.ts` — newline normalization.

### Regression Risk

**Highest in the phase.** Existing single-line messages must look pixel-identical
(inline path); history rendering/pagination (`buildChatMessageElement`,
`prependOlderMessages`) share the same helper so scroll-position math must be
re-checked; reactions, pin, edit, delete, "See more", NSFW images, link previews and
the emoji picker all hang off `.chat-msg`. Messages already in the database were
written as plain text — Markdown characters in *old* messages (e.g. someone wrote
`*sigh*` or `a_b_c`) will now render with formatting; that is inherent to the feature
and called out in the release notes.

### Verification

Typecheck (client + server), `markdown-smoke.mjs`, `npm run test` (server).
Manual: Shift+Enter newlines; Enter sends; paste a multi-paragraph/list text; every
syntax in channel + DM + edit; XSS strings sent as real messages render inert; custom
emoji with underscores inside a sentence; solo emoji still 4×; very long multi-line
and long-list messages truncate with a working "See more"; pinned bar shows clean
one-line plain text; old plain messages and link previews unchanged; scrolling up
through history still pages correctly.

---

## PRD 15.11 — Reaction Hover Card

**Type:** ✨ FEATURE
**Priority:** Medium
**Affected Components:** Shared-types, server (`reaction.handler.ts`, `message.handler.ts`, `dm.handler.ts` + a new service), client (`renderer.ts`, `index.html`).

### Current State (confirmed via audit)

Reaction pills (`buildReactionBar`, `renderer.ts:~5237`) show the emoji + count with a
native `title="Reacted by N users"`. The wire format carries `{ emoji, count,
userIds[] }` only (`socket-events.ts:618`, `models.ts:154,170`) — **no nicknames**, and
the `Reaction` table has no relation to `User` (plain `userId` column), so the client
cannot name reactors who are offline or not in a shared list. Reaction aggregation is
**duplicated in three places** (`reaction.handler.ts:28-56`, `message.handler.ts:55-70`,
`dm.handler.ts:153-181`).

### Design (modeled on `print_discord_emoji.png` / `print_discord_emoji2.png`)

**Card content.** A dark rounded card with the emoji large on the left (same size as a
solo-emoji message: unicode ≈ 52px glyph; custom emoji `<img>` 52px) and, on the right:
- one reactor: **`<nick> reacted with :emoji_name:`**
- several: **`<nick1>, <nick2>, <nick3> and N other(s) reacted with :emoji_name:`** —
  up to three names, then the remainder as an accent-colored "N other(s)" (static
  text, not a link). Reactor order = reaction order (the server already
  `orderBy createdAt asc`). Your own entry reads **"You"**.
- Emoji name: custom → its `:name:`; unicode → looked up in a one-time
  `emoji → name` map built from `EMOJI_DATA` (`renderer.ts:97`), snake_cased
  (`:thumbs_up:`), tolerant of the `U+FE0F` variation selector; unknown glyph → omit
  the name part and show just "X reacted".

**Trigger.** Hover dwell: starts on `mouseenter` of a pill, restarts if the pointer
moves more than a few px ("still"), fires after **1000 ms**; cancelled by `mouseleave`,
click (toggling a reaction), scroll, tab switch, blur, or the bar being rebuilt.
Keyboard: showing on `:focus-visible` (immediately, no dwell) so it isn't mouse-only.

**Behavior.** One shared card element appended to `document.body` (not per pill, and
outside any `overflow:hidden` message container), positioned above the pill and
flipped below / clamped horizontally when it would leave the viewport; non-interactive
(`pointer-events: none`, `role="tooltip"`, `aria-describedby` on the pill). Use event
**delegation** on the messages container (`mouseover`/`mouseout`) since pills are
rebuilt on every `REACTION_UPDATED`. If a pill is rebuilt while its card is open for it,
refresh the card contents (or close it) rather than leaving stale data. Remove the
pill's native `title` (it would double up with the card). Works identically in channel
and DM messages. Respect `prefers-reduced-motion` for the fade-in.

**Data (server).**
- New `apps/server/src/services/reaction.service.ts` with a pure
  `aggregateReactions(rows, nicknameById)` and a `loadReactorNicknames(prisma, userIds)`
  doing **one** `prisma.user.findMany({ where: { id: { in } }, select: { id, nickname } })`
  per batch (a page of 20 messages = 1 extra query, not N). All three call sites switch
  to it — this removes the duplication instead of triplicating the new field.
- Wire format (shared-types, **additive and backward compatible**): the reaction
  aggregate gains `users?: Array<{ userId: string; nickname: string }>`; `userIds` and
  `count` stay as they are so a not-yet-updated client (the app already has a
  client/server version-mismatch warning) keeps working. Define it once as a named
  `IReactionSummary` type used by `IChatMessage`/`IDirectMessage` and
  `REACTION_UPDATED`, instead of three copies of the inline object type.
- Nicknames are the user's *current* nickname (`User.nickname` is updated on each
  join). Deleted/unknown users fall back to "Unknown".

### Files to Modify

- `packages/shared-types/src/models.ts`, `socket-events.ts` — `IReactionSummary`.
- `apps/server/src/services/reaction.service.ts` — **new**.
- `apps/server/src/handlers/reaction.handler.ts`, `message.handler.ts`, `dm.handler.ts` — use the service.
- `apps/server/src/__tests__/reaction.service.test.ts` — **new** (grouping, order, nickname fallback).
- `apps/client/src/renderer/renderer.ts` — `buildReactionBar`, the shared card + dwell controller, emoji-name map.
- `apps/client/src/renderer/index.html` — card CSS.

### Regression Risk

Reaction toggling, counts, "mine" highlighting, the picker, live `REACTION_UPDATED`
updates, and history/pagination hydration all flow through the code being
consolidated; the aggregation's output shape for the *existing* fields must be
byte-identical (covered by the unit tests). Build shared-types first
(`npx tsc --build`) before the server/client typecheck.

### Verification

`npx tsc --build` (shared-types) → `npx tsc --noEmit` (server, client), `npm run test`
(server). Manual: hover a single-reactor pill 1s → card matches the reference;
multi-reactor (4+) shows 3 names + "N others"; custom emoji shows its `:name:` and
image; own reaction says "You"; moving the mouse resets the dwell; leaving/clicking/
scrolling hides it; card stays on-screen near viewport edges; works in DMs; an
offline reactor's nickname still resolves; a new reaction while the card is open
doesn't show stale data; old messages (history) show the card too.

---

## Cross-Cutting Dependencies & Recommended Implementation Order

| Order | Item | Why here |
|:---:|---|---|
| 1 | **15.1** stale-socket fix | Critical, server-only, and 15.2's findings depend on it. |
| 2 | **15.2** investigation + diagnostics | Builds directly on 15.1's logging (`superseded` field). |
| 3 | **15.3** mute halo | Small, isolated client fix. |
| 4 | **15.4** disabled Ban button | Trivial; also checks the server self-ban guard. |
| 5 | **15.5** pinned bar color | CSS-only. |
| 6 | **15.6** window state | `main.ts`; do before 15.7 so the hide/restore work builds on settled window code. |
| 7 | **15.7** Windows freeze | Same file as 15.6; needs a Windows hand-test. |
| 8 | **15.8** Google emoji | Typography foundation — do **before** 15.9–15.11 so their emoji (viewer, markdown, hover card) are verified against the final font. |
| 9 | **15.9** image viewer | Independent; adds the shared clipboard/openExternal preload+IPC helpers. |
| 10 | **15.10** multi-line + markdown | Largest/riskiest; benefits from a stable font and a settled preload surface. Also supplies `markdownToPlainText` used by 15.5's pinned preview. |
| 11 | **15.11** reaction hover card | Only item changing the wire format (additive); last so the shared-types rebuild doesn't ripple through earlier commits. Uses 15.8's emoji rendering and 15.10's emoji-name handling. |

Cross-item notes: 15.1 ↔ 15.2 (same root cause); 15.6 ↔ 15.7 (same `main.ts` window
lifecycle — 15.6 must save state only for visible, non-minimized windows); 15.5 ↔
15.10 (the pinned preview becomes plain text); 15.8 ↔ 15.10/15.11 (emoji rendering and
`:name:` tokens); 15.9/15.10 both add preload methods — keep the `reson8Api` surface
tidy and typed.

---

## Open Decisions Confirmed With the User

**Resolved directly with the user (04/10/2026):**

1. **Image-viewer zoom baseline** → percent of the image's **natural pixel size**:
   zoom runs from "fit to window" up to 200% of natural size, with zoom out back to
   fit, drag-to-pan and wheel zoom (PRD 15.9).
2. **Markdown dialect** → **Discord-style**, including `__underline__` (PRD 15.10).
3. **Freeze context** → the app-icon freeze (PRD 15.7) happens on **Windows**; the
   user confirmed no other detail, so the fix is hypothesis-driven with diagnostics and
   a Windows hand-test gate.
4. **Emoji method** → **bundle the Noto Color Emoji font** (not per-emoji images)
   (PRD 15.8).

**Reasonable-default assumptions (change any you disagree with before work starts):**

- **Masked Markdown links `[text](url)` are disabled** (only bare-URL auto-links), to
  prevent spoofed link text; "links" in the request is read as auto-linking. Easy to
  flip later (possibly with a "this link goes to <host>" confirmation).
- **Images in Markdown (`![]()`), tables, HTML, `h4+`** are not rendered.
- **No syntax highlighting** in code blocks; no spoilers/mentions (not requested).
- **Enter sends, Shift+Enter = newline** (the existing convention).
- **Settings mic-level meter stays live while muted** (15.3); only the voice-channel
  participant halo pauses.
- **"Sent by" is shown at the top-left** of the image viewer as `Sent by <nick> ·
  <date time>` (the request didn't specify placement).
- **Animated GIFs copy as a still frame** via "Copy Image" (clipboard images are
  static); the viewer itself keeps them animated.
- **Reaction names for unicode emoji** are shown as snake_case `:thumbs_up:` derived
  from the existing emoji dataset names (Discord's short-codes differ slightly, e.g.
  `:thumbsup:`).
- **Window position can't be restored on Wayland** (compositor limitation); size and
  maximized state do restore.
- **Socket.io ping settings are left unchanged** after the log analysis (15.2).
- Version bump expected: **minor → 2.4.0** (final call made by `/bump-version`).

---

## Mapping to `nextsteps.txt`

| # in `nextsteps.txt` | Request | PRD item |
|:---:|---|:---:|
| 1 | Image viewer actions + "sent by" | 15.9 |
| 2 | Emoji reaction info card | 15.11 |
| 3 | Google-style emoji everywhere | 15.8 |
| 4 | Disabled (not hidden) Ban button on own user | 15.4 |
| 5 | Multi-line messages + Markdown | 15.10 |
| 6 | Pinned bar → dark yellow | 15.5 |
| 7 | Users offline after quick reconnect | 15.1 |
| 8 | Pause own halo while muted | 15.3 |
| 9 | Remember window size/position | 15.6 |
| 10 | App freezes when re-clicking the icon | 15.7 |
| 11 | Constant disconnect/reconnect log investigation | 15.2 |
