# Reson8 — Phase 10 PRD

**Created:** 12/08/2026
**Author:** Felipe B. Netto (assisted by AI)
**Status:** Draft — Pending Review
**Source:** `app-planning/nextsteps.txt`
**Branch:** `phase-10`

---

## Table of Contents

1. [PRD 10.1 — Client Auto-Updater](#prd-101--client-auto-updater)
2. [PRD 10.2 — Audio Settings Tab](#prd-102--audio-settings-tab)
3. [PRD 10.3 — Fix Session Timer Blink on Mute/Deafen Toggle](#prd-103--fix-session-timer-blink-on-mutedeafen-toggle)
4. [PRD 10.4 — Mute/Deafen Accumulation](#prd-104--mutedeafen-accumulation)
5. [PRD 10.5 — Fix False-Positive Unread Indicator on Own Message](#prd-105--fix-false-positive-unread-indicator-on-own-message)
6. [PRD 10.6 — Fix Generic AppImage Icon on Wayland](#prd-106--fix-generic-appimage-icon-on-wayland)
7. [Cross-Cutting Dependencies & Implementation Order](#cross-cutting-dependencies--implementation-order)
8. [Open Decisions Confirmed With the User](#open-decisions-confirmed-with-the-user)

> [!IMPORTANT]
> Every implementation must be tracked and logged into `app-planning/progress.txt`
> using the `/log-progress` slash command immediately after the item is completed
> and verified, following the established `--- Entry: DD/MM/YYYY ---` format. This
> is not optional cleanup — treat it as part of finishing each PRD item, exactly as
> it was for every prior phase (see `app-planning/progress.txt` and
> `app-planning/archive/progress-phases-1-8.txt`).

> [!NOTE]
> This PRD was written after auditing the current codebase (three parallel
> research passes over the settings modal/sound system, the mute/deafen state
> machine, and the unread/icon bugs) rather than assuming a clean slate. File
> paths and line numbers below reflect the code as of 12/08/2026 (branch
> `phase-10`, HEAD `4129aa5`) — re-check them if the surrounding code has moved
> by the time an item is implemented. Two things worth flagging up front:
> - Per-user voice volume (0–200%, right-click context menu) **already exists**
>   from Phase 9 (PRD 4.1/4.2) — PRD 10.2 below builds a *global* multiplier on
>   top of it, it does not reintroduce it.
> - Mute/deafen are **already presence-driven** (`SET_VOICE_STATE` →
>   `PRESENCE_UPDATE`, wired in Phase 9 PRD 4.3) — PRD 10.3 and 10.4 build on
>   that plumbing, no new schema/socket-event work is needed for either.

---

## PRD 10.1 — Client Auto-Updater

**Type:** ✨ NEW FEATURE
**Priority:** High
**Affected Components:** Client only (`main.ts`, `preload.ts`, `renderer.ts`,
`index.html`, `package.json`) — no server/schema changes.

### Overview

The app checks GitHub Releases once per launch for a newer version. If one is
found, a modal informs the user and offers "Update Now" / "Not Now". The same
check (with the same fetch/retry behavior) is also triggerable at will from a
new "About the app" settings tab, which shows the app logo, version, a short
description, and a "Check for Updates" button.

### Design Decisions

- **Library:** `electron-updater`, added as a runtime **dependency** (not
  devDependency) since it ships inside the packaged app.
- **Publish config** (`apps/client/package.json` → `build.publish`):
  `{ "provider": "github", "owner": "fbarrella", "repo": "reson8" }`, per your
  instruction. This is what makes `electron-builder` emit the `latest.yml` /
  `latest-linux.yml` / `latest-mac.yml` metadata files electron-updater reads
  from GitHub Releases — **without this, nothing to check against exists**, so
  the very first release built after this PRD ships is the first one the
  updater can detect.
- **Platform scope — confirmed with you:** ship the same auto-updater code
  path for all three platforms (Windows/Linux/macOS), even though no code
  signing/notarization certificates exist in this repo today. **Known
  limitation to document, not block on:** macOS auto-update via
  electron-updater's Squirrel.Mac generally requires a signed + notarized
  `.zip` to pass Gatekeeper on the downloaded update; without that, the mac
  "Update Now" path will likely download successfully but fail to apply. This
  should be called out in the modal's mac-specific error path (fall back to
  "please download manually from GitHub" on install failure) and tracked as a
  fast-follow once signing is set up — not a reason to withhold Windows/Linux.
- **Packaged-only:** the checker never runs when `!app.isPackaged` (matches
  the existing convention for packaged-only concerns, e.g. `instance-id.ts`'s
  persisted-vs-regenerated UUID split).
- **Check vs. download are separate steps** (`autoUpdater.autoDownload =
  false`): the app fetches release *metadata* only, on both the automatic
  startup check and the manual button. Nothing downloads until the user
  clicks "Update Now" — respects the fact the modal explicitly offers Cancel,
  and avoids silently consuming bandwidth/disk for a user who says no.
- **Retry semantics apply only to the metadata fetch**, exactly as specified:
  1 attempt, then up to 3 retries with a 20-second wait between each, for
  both the startup check and the manual button. This does **not** apply to
  the download step (`downloadUpdate()`), which has its own
  progress/error events and a simpler once-through failure path (see below).
  - **Startup check, all attempts fail:** fail silently — no error modal on
    every launch for a user with e.g. no internet connectivity that day.
  - **Manual button, all attempts fail:** show an inline error in the About
    tab ("Could not check for updates. Try again later.") since the user
    explicitly asked and deserves feedback.
  - **Manual button, no update found:** show inline "You're up to date"
    feedback — the automatic startup check stays silent in this case (no
    popup for the common case of already being current), but a
    user-initiated check should always confirm *something* happened.
- **Update-found modal:** title/message disclosing a newer version exists
  and that "some features might fail if you don't update", with "Update Now"
  and "Not Now" buttons — matches your spec directly. "Not Now" just closes
  the modal; there is no persistent snooze/dismissal, so the next launch (or
  manual check) will detect the same update and prompt again — this is
  intentional, not a gap, per the "once per app open" spec.
- **"Update Now" flow:** triggers `downloadUpdate()`, the modal switches to a
  progress state (percentage via the `download-progress` event) in place,
  and once `update-downloaded` fires, briefly shows "Update ready —
  restarting..." before calling `quitAndInstall()`. This is a single
  committed action once clicked (no second confirmation), consistent with
  the spec's "let the app do the rest by itself".
- **Version source of truth:** `app.getVersion()` (from packaged
  `package.json`, currently `1.2.0`) — no new versioning scheme needed.

### Implementation

1. **`apps/client/package.json`**
   - Add `"electron-updater"` to `dependencies`.
   - Add `"publish": { "provider": "github", "owner": "fbarrella", "repo":
     "reson8" }` inside `build`.
2. **`apps/client/src/main.ts`**
   - Import and configure `autoUpdater` from `electron-updater`
     (`autoUpdater.autoDownload = false`).
   - Wire `checking-for-update` / `update-available` / `update-not-available`
     / `error` / `download-progress` / `update-downloaded` listeners, each
     forwarding to the renderer via `webContents.send(...)`.
   - Implement the check-with-retry loop in the main process (electron-updater
     has no built-in configurable retry-with-delay for the metadata fetch):
     wrap `autoUpdater.checkForUpdates()` in a promise, catch failure,
     `setTimeout` 20s, up to 3 retries, surfacing a final success/failure
     signal to the caller (both the startup trigger and the IPC handler used
     by the manual button share this one function).
   - Trigger the startup check automatically shortly after the window is
     ready (e.g. on `did-finish-load` + a short delay so it doesn't compete
     with initial app load), gated on `app.isPackaged`.
   - `ipcMain.handle` for: `check-for-updates` (manual trigger), `download-
     update`, `quit-and-install`, `get-app-version`.
   - Explicit BrowserWindow `icon` option is added here too, incidentally
     shared with PRD 10.6 — see that section, do not duplicate the change.
3. **`apps/client/src/preload.ts`**
   - Bridge methods on `reson8Api`: `checkForUpdates()`, `downloadUpdate()`,
     `quitAndInstall()`, `getAppVersion(): Promise<string>`.
   - Event forwarding: `onUpdateAvailable`, `onUpdateNotAvailable`,
     `onUpdateError`, `onDownloadProgress`, `onUpdateDownloaded`.
4. **`apps/client/src/renderer/renderer.ts`**
   - New update-confirm/progress modal (state machine: idle → found →
     downloading → ready-to-restart), driven by the events above.
   - Startup: no explicit renderer-side trigger needed if the check is fired
     from main automatically — renderer only needs to *listen* for
     `update-available` and open the modal when it fires.
   - New "About" tab hydration: on tab open, call `getAppVersion()` and
     populate; wire "Check for Updates" button to `checkForUpdates()`,
     showing a "Checking..." disabled state, then either opening the shared
     update modal (found), an inline "up to date" message (not found), or an
     inline error (all retries failed).
5. **`apps/client/src/renderer/index.html`**
   - New `settings-tab-btn`/`settings-panel` pair, `data-settings-tab="about"`
     (e.g. "ℹ️ About", following the existing emoji-prefixed tab-label
     convention seen on "🎤 Voice & Shortcuts" / "🖥 Application"). Content:
     reuse the existing `logo.png` (`index.html:2310` already renders it in
     the toolbar brand — same asset, no new packaging needed), version text,
     a short static description, "Check for Updates" button, inline status
     area.
   - New update-confirm modal markup + CSS (title, disclosure text, progress
     bar, Update Now/Not Now buttons).

### Files to Modify

| File | Change |
|:---|:---|
| `apps/client/package.json` | `electron-updater` dependency, `build.publish` config |
| `apps/client/src/main.ts` | `autoUpdater` wiring, retry-loop helper, IPC handlers, startup trigger |
| `apps/client/src/preload.ts` | Update-related bridge methods + event forwarding, `getAppVersion` |
| `apps/client/src/renderer/renderer.ts` | Update modal state machine, About tab hydration/wiring |
| `apps/client/src/renderer/index.html` | About tab markup, update modal markup + CSS |

### Verification

1. Client typecheck (`npx tsc --noEmit`).
2. Unpackaged dev mode: confirm the checker never fires (`app.isPackaged` is
   `false` under `electron .`).
3. **Inherently limited immediate verification:** electron-updater needs a
   real published GitHub release with `latest*.yml` metadata to check
   against — this PRD item can be code-reviewed and typechecked now, but the
   "update available" path can only be exercised for real once the *next*
   version after this ships is published. Plan to smoke-test the "up to
   date" path immediately after this release, and the "update available"
   path retroactively on the release after that.
4. Manual "Check for Updates" button: verify the disabled/"Checking..." state,
   the "up to date" inline message, and (by temporarily pointing
   `dev-app-update.yml` at a test feed or forcing a version mismatch) the
   found-update modal and its progress/restart flow if feasible before a
   real release exists.

---

## PRD 10.2 — Audio Settings Tab

**Type:** ✨ NEW FEATURE
**Priority:** Medium
**Affected Components:** Client only (`preload.ts`, `voice.service.ts`,
`renderer.ts`, `index.html`) — no server/schema changes.

### Overview

A new "🔊 Audio" settings tab with three sliders — **Nudge Volume**, **Sound
Alerts Volume**, and **Global Voice Chat Volume** — each client-local and
persisted. Global Voice Chat Volume acts as a master multiplier on top of the
existing per-user volume (Phase 9 PRD 4.1): if global is at 90% and a
participant's personal volume is at 80%, the participant is heard at 80% of
90% (72% effective gain).

### Design Decisions

- **Ranges:** all three sliders **0–100%, default 100%**. Global Voice
  Chat Volume is a master *attenuator* only (it doesn't need to boost past
  100% — the existing per-user slider already covers boosting a specific
  quiet talker up to 200%). Nudge/Alerts also 0–100% — alert sounds
  shouldn't be boostable past their recorded level.
- **Persistence:** `localStorage`, following the existing `reson8-` prefix
  convention: `reson8-nudge-volume`, `reson8-alert-volume`,
  `reson8-voice-volume` (each defaulting to `"100"` if unset).
- **Sound Alerts Volume applies to every `SoundAlert.play()` call except
  `nudge.mp3`**, which is governed by Nudge Volume instead — matching the
  roadmap's explicit three-way split (nudge / general alerts / voice). This
  covers mute/unmute, deafen/undeafen, connect/disconnect, channel
  create/delete, kick/ban, DM notification (`hey_wake_up.mp3`), etc. — the
  full list of ~17 call sites currently in `renderer.ts`.
- **Interaction with the existing `reson8-mute-alerts` boolean:** kept
  independent, not replaced. That checkbox (in the existing Application tab)
  remains a fast full-mute toggle; the new slider is finer-grained volume
  control. Setting the slider to 0% is functionally equivalent to the
  checkbox but the two aren't merged, matching how similar apps (e.g.
  Discord) keep a quick-mute alongside a volume slider.
- **Global Voice Chat Volume is applied live**, not just at connect time —
  moving the slider while already in a voice channel immediately re-applies
  gain to every currently-consumed participant, no rejoin needed.

### Implementation

1. **`apps/client/src/services/voice.service.ts`**
   - Add `private globalVoiceVolume = 1.0;` and
     `setGlobalVoiceVolume(percent: number): void` (0–100, clamped, stores as
     a 0–1 factor, then re-applies to every entry in `remoteGainNodes` via
     the existing per-consumer gain-update path).
   - Multiply the global factor into both existing gain-computation sites
     (currently `volumePercent / 100`): the initial gain set inside
     `consumeProducer()` and the update in `applyOverrideForUser()`. New
     formula: `(userVolumePercent / 100) * globalVoiceVolume`, with the
     existing per-user mute branch (`muted ? 0 : ...`) unchanged and taking
     precedence.
2. **`apps/client/src/renderer/renderer.ts`**
   - `SoundAlert` (currently a single shared helper with no volume support):
     extend `play(filename)` to look up `filename === "nudge.mp3" ?
     nudgeVolume : alertVolume` and set `audio.volume = pct / 100` before
     calling `.play()`.
   - On app load, hydrate `nudgeVolume`/`alertVolume`/`voiceVolume` from
     `localStorage` (default 100 each); call
     `reson8Api.setGlobalVoiceVolume(voiceVolume)` once at startup so it's
     already correct before the user ever joins a channel.
   - New Audio tab panel: three `<input type="range">` sliders wired to
     `input` events that update the in-memory value, persist to
     `localStorage`, and (for the voice slider) call
     `reson8Api.setGlobalVoiceVolume()` immediately.
3. **`apps/client/src/preload.ts`**
   - Expose `setGlobalVoiceVolume(percent)` on `reson8Api`, mirroring the
     existing `setLocalUserVolume` bridge pattern.
4. **`apps/client/src/renderer/index.html`**
   - New `settings-tab-btn`/`settings-panel` pair, `data-settings-tab="audio"`
     ("🔊 Audio"), with the three labeled sliders + current-value display.

### Files to Modify

| File | Change |
|:---|:---|
| `apps/client/src/services/voice.service.ts` | `globalVoiceVolume` field, `setGlobalVoiceVolume()`, multiply into both gain-computation sites |
| `apps/client/src/preload.ts` | `setGlobalVoiceVolume` bridge method |
| `apps/client/src/renderer/renderer.ts` | `SoundAlert.play()` volume support, localStorage hydration, Audio tab wiring |
| `apps/client/src/renderer/index.html` | Audio tab markup + CSS |

### Verification

1. Client typecheck.
2. Join a voice channel with two other clients (A, B). Set Global Voice
   Volume to 50% — both should get uniformly quieter on your client only.
3. With global at 50%, set A's per-user volume to 150% — A should now sound
   noticeably louder than B (150% × 50% = 75% effective vs. B's 50%
   effective), confirming the multiplicative relationship rather than one
   overriding the other.
4. Set Sound Alerts Volume to 0% — trigger mute/disconnect/etc., confirm
   silence; confirm the nudge sound still plays at its own (separately set)
   volume.
5. Set Nudge Volume to 0% — confirm nudge is silent while other alerts are
   unaffected.
6. Restart the app, rejoin — all three settings and their effects should
   persist without re-adjusting.

---

## PRD 10.3 — Fix Session Timer Blink on Mute/Deafen Toggle

**Type:** 🐛 FIX
**Priority:** Medium
**Affected Components:** Client only (`renderer.ts`).

### Root Cause (confirmed via audit)

Mute/deafen toggles are presence-driven (Phase 9): `toggleMuteAndNotify()` /
`toggleDeafenAndNotify()` call `api.setVoiceState(...)` → server rebroadcasts
`PRESENCE_UPDATE` to the whole server room, **including the sender**. The
client's `presence` handler calls `updateOccupants()`, which unconditionally
calls `renderTree(currentTree)` — and `renderTree()` does
`channelTree.innerHTML = ""` (a full teardown) before rebuilding everything
via `renderChannel()`/`renderCategory()`/`renderOccupants()`.

The session-timer `<span data-session-channel="...">` is recreated **empty**
inside `renderChannel()` — it's only filled in by the next tick of the
existing `setInterval` (up to 1000ms later). Occupant icons don't show the
same blink because `renderOccupants()` fills their correct markup
synchronously in the same rebuild — there's no async gap for them. The timer
is the only element left blank because its text is populated on a delayed
timer tick rather than computed synchronously at render time. This is a
direct regression from wiring mute/deafen through real presence broadcasts
(every toggle now round-trips the server and forces a full re-render),
matching your hypothesis that it's tied to the mute/deafen icon work.

### Fix

Compute and set the timer's correct elapsed-time text **synchronously**
inside `renderChannel()`, using the same calculation the existing
`setInterval` uses, instead of leaving `textContent` empty until the next
tick. This is a surgical fix scoped to the reported symptom — it does not
require restructuring `renderTree()`'s full-teardown-and-rebuild approach,
which is used broadly and isn't itself broken (only this one element has a
render-then-fill-later timing gap).

### Files to Modify

| File | Change |
|:---|:---|
| `apps/client/src/renderer/renderer.ts` | `renderChannel()` sets initial timer text synchronously from the same elapsed-time source the interval tick uses, instead of leaving it blank |

### Verification

1. Client typecheck.
2. Join a voice channel, let the timer run a few seconds, then toggle
   mute/unmute/deafen/undeafen repeatedly — confirm the timer text never
   goes blank (visual/manual check, since this is a rendering-timing bug).

---

## PRD 10.4 — Mute/Deafen Accumulation

**Type:** 🔧 IMPROVEMENT
**Priority:** Medium-High
**Affected Components:** Client only (`voice.service.ts`, `renderer.ts`) —
no server/schema changes (existing `SET_VOICE_STATE`/`PRESENCE_UPDATE`
already carries both `isMuted` and `isDeafened`).

### Overview

Deafening should always imply muting (can't speak while deaf), and the
prior mute state should be restored correctly on undeafen:

- **Not muted → Deafen:** mic auto-mutes, both icons appear, only the
  *deafen* sound plays (not mute + deafen).
- **Undeafen from that state:** both mic and audio resume, both icons
  clear, only the *undeafen* sound plays.
- **Muted → Deafen:** mic was already muted; deafening only stops audio,
  adds the deafened icon (muted icon stays), plays only the deafen sound.
- **Undeafen from that state:** only audio resumes, mic **stays** muted,
  only the deafened icon clears, plays only the undeafen sound.

### Design Decisions

- **State needed:** `voice.service.ts` currently tracks only
  `_isManuallyMuted` and `_isDeafened` independently, with **no memory** of
  "was I already muted before I deafened" — this has to be added. New field:
  `_deafenAutoMuted: boolean` — true only when deafening had to mute the mic
  itself (i.e., the user was *not* already manually muted), so undeafen knows
  whether to also unmute.
- **Confirmed with you — push-to-talk while deafened:** PTT stays **fully
  blocked** while deafened, matching the roadmap's literal wording ("NOT BE
  ABLE to speak when it is deaf"). Holding PTT does nothing until the user
  explicitly undeafens. This closes a real gap the audit found: PTT's
  keydown/keyup handlers call `api.setMuted()` **directly**, bypassing
  `toggleMuteAndNotify()`/`toggleDeafenAndNotify()` entirely and never
  checking `isDeafened` today — those handlers need an explicit
  `isDeafened` guard added.
- **New edge case surfaced during this audit, not covered by the original
  roadmap text — explicit call, flag for review:** what happens if the user
  clicks the *Mute* button/shortcut while already deafened (and thus
  auto-muted)? Toggling it "off" would unmute while still deafened, which
  contradicts "can't speak while deaf". **Decision:** the Mute
  button/shortcut is **disabled (no-op)** while `isDeafened` is true — mic
  control is fully owned by deafen state in that condition, and the only way
  to change it is to undeafen first. This mirrors the same reasoning as the
  PTT decision above and avoids an ambiguous "sticky mute" sub-state. Flag
  this to the user during review if a different behavior (e.g. auto-undeafen
  on mute-click) is preferred.
- **Single atomic state change:** deafen now sets both `isMuted` and
  `isDeafened` together and sends **one** `SET_VOICE_STATE` call (the payload
  already carries both flags) rather than two sequential toggle calls — this
  avoids double `PRESENCE_UPDATE` round-trips (also keeps PRD 10.3's fix
  clean: one state change, one re-render, not two).

### Implementation

1. **`apps/client/src/services/voice.service.ts`**
   - Add `_deafenAutoMuted: boolean` alongside existing `_isManuallyMuted` /
     `_isDeafened`.
   - Rework `toggleDeafen()`/deafen setter into a single method that:
     - On deafen: `_deafenAutoMuted = !_isManuallyMuted`; if
       `_deafenAutoMuted`, pause the mic `producer` and set
       `_isManuallyMuted = true`; always mute every entry in
       `audioElements`; set `_isDeafened = true`.
     - On undeafen: unmute every entry in `audioElements`; set
       `_isDeafened = false`; if `_deafenAutoMuted`, resume the `producer`,
       set `_isManuallyMuted = false`, clear `_deafenAutoMuted`.
   - Leave the existing manual `toggleMute()`/`setMuted()` behavior for the
     not-deafened case unchanged (still pauses/resumes `producer` directly).
2. **`apps/client/src/renderer/renderer.ts`**
   - `toggleDeafenAndNotify()`: call the new combined service method, then a
     single `api.setVoiceState(isMuted, isDeafened)` and play **only** the
     deafen sound pair (`sound_muted.mp3`/`sound_resumed.mp3`) — never the
     mute pair in the same action.
   - Mute button/shortcut handler: no-op while `voiceService.isDeafened` is
     true (per the decision above); reflect this in the UI (disabled/greyed
     state while deafened).
   - Icon rendering (`renderOccupants()`, currently a mutually-exclusive
     ternary `occ.isDeafened ? DEAFENED_ICON : occ.isMuted ? MUTED_ICON :
     ""`): change to render **both** when both are true —
     `${occ.isMuted ? MUTED_ICON : ""}${occ.isDeafened ? DEAFENED_ICON :
     ""}`.
   - PTT keydown/keyup handlers (currently call `api.setMuted()` directly):
     add an `isDeafened` guard so PTT press is a no-op while deafened.

### Files to Modify

| File | Change |
|:---|:---|
| `apps/client/src/services/voice.service.ts` | `_deafenAutoMuted` field, combined deafen/undeafen state machine |
| `apps/client/src/renderer/renderer.ts` | Single-sound deafen toggle, mute-button no-op while deafened, icon accumulation, PTT `isDeafened` guard |

### Verification

1. Client typecheck.
2. Scenario A — deafen while unmuted: deafen → both icons appear, only
   deafen sound plays; undeafen → both icons clear, mic and audio resume,
   only undeafen sound plays.
3. Scenario B — mute, then deafen: mute → muted icon + mute sound; deafen →
   deafened icon added (muted icon stays), only deafen sound plays;
   undeafen → deafened icon clears (muted icon stays), only audio resumes,
   only undeafen sound plays.
4. While deafened, hold PTT — confirm no audio reaches other participants
   and the mic stays off.
5. While deafened, click/press the Mute shortcut — confirm no state change
   (still deafened, same muted state as before the click).
6. Confirm only one `PRESENCE_UPDATE` round-trip per deafen/undeafen toggle
   (server log or breakpoint), not two.

---

## PRD 10.5 — Fix False-Positive Unread Indicator on Own Message

**Type:** 🐛 FIX
**Priority:** Medium
**Affected Components:** Server only (`connection.handler.ts`,
`message.handler.ts`) — no schema changes.

### Root Cause (confirmed via audit)

Two independent gaps in the unread computation, both contributing:

1. **`annotateUnreadChannels()`** (`connection.handler.ts`, run during
   `USER_JOIN_SERVER`/tree hydration) finds each channel's latest-message
   timestamp via `message.groupBy({ by: ["channelId"], where: { channelId:
   { in: textChannelIds } }, _max: { createdAt: true } })` — **with no
   exclusion of the requesting user's own messages.** It compares that
   timestamp against the user's `ChannelRead.lastReadAt` with no author
   check at all.
2. **`SEND_MESSAGE`** (`message.handler.ts`) persists the message and
   broadcasts it, but never advances the *sender's own* `ChannelRead`
   cursor — only `MARK_CHANNEL_READ` (explicit "I opened this channel")
   writes that row.

Combined: a user sends the last message in a channel (their own cursor
doesn't move), disconnects, reconnects — hydration finds their own message
as the channel's latest, compares it to their stale cursor, and flags the
channel unread even though nobody else has posted since.

This is a distinct, previously-unfixed **server-side** root cause — two
prior progress.txt entries already fixed *client-side* reappearance bugs
(stale `hasUnread` surviving `renderTree()` re-renders after voice
join/leave); neither touched server-side unread computation or message
authorship.

### Fix (both parts — each closes a different edge case)

1. **`annotateUnreadChannels()`**: exclude the requesting user's own
   messages from the latest-message query (`userId: { not: userId }` on the
   `message.groupBy` `where` clause) — so "unread" only ever reflects
   messages authored by *others*.
2. **`SEND_MESSAGE`**: upsert the sender's own `ChannelRead.lastReadAt` (to
   the new message's `createdAt`) at send time, using the same upsert
   pattern already used by `MARK_CHANNEL_READ` — so the cursor advancing
   isn't solely dependent on a client explicitly re-opening the channel
   later.

Doing both is the more robust fix: (1) alone prevents the false positive at
hydration time regardless of cursor state; (2) alone keeps the cursor
generally accurate for other flows (e.g. a currently-open-but-backgrounded
tab). Neither alone fully substitutes for the other.

### Files to Modify

| File | Change |
|:---|:---|
| `apps/server/src/handlers/connection.handler.ts` | `annotateUnreadChannels()` excludes sender's own messages from the latest-message query |
| `apps/server/src/handlers/message.handler.ts` | `SEND_MESSAGE` upserts the sender's own `ChannelRead.lastReadAt` |

### Verification

1. Server typecheck (`npx tsc --noEmit`), existing vitest suite
   (`npm run test`).
2. Repro fix: User A sends the last message in channel X, disconnects,
   reconnects — X must **not** show unread.
3. Regression guard (fix must not over-suppress real unreads): User A
   disconnects; User B posts in X; User A reconnects — X **must** show
   unread as before.

---

## PRD 10.6 — Fix Generic AppImage Icon on Wayland

**Type:** 🐛 FIX
**Priority:** Low
**Affected Components:** Client only (`main.ts`, `package.json`).

### Root Cause (confirmed via audit)

- `BrowserWindow` is constructed in `main.ts` with **no explicit `icon`**
  option — it relies entirely on platform packaging to resolve the icon.
- No `app.setName()` call exists anywhere — Electron falls back to deriving
  the runtime app name/WM_CLASS from the packaged `package.json` `"name"`
  field, `"@reson8/client"` (scoped, contains `@`/`/`), not `"Reson8"`.
- `electron-builder`'s Linux config (`package.json` → `build.linux`) has no
  `desktop.StartupWMClass` set. On Wayland/GNOME, the app-switcher and
  title-bar icon resolve via the `.desktop` file whose `StartupWMClass`
  matches the **running window's actual WM_CLASS** — without an explicit,
  matching `StartupWMClass`, that lookup fails even though the `.desktop`
  file itself correctly points at `assets/icon.png`, and the window falls
  back to a generic icon. Icon *asset* resolution is not the defect (a
  single 512×512 RGBA PNG already exists and satisfies electron-builder's
  convention) — this is purely a WM_CLASS/desktop-file matching issue.

### Fix

1. **`main.ts`**: pass an explicit `icon: path.join(__dirname, "..",
   "assets", "icon.png")` in the `BrowserWindow` constructor, so the runtime
   window icon is set directly regardless of platform/theme icon lookup.
2. **`main.ts`**: call `app.setName("Reson8")` early (before
   `app.whenReady()`/window creation) so Electron's runtime WM_CLASS
   actually matches `productName`.
3. **`package.json`** → `build.linux`: add `"desktop": { "StartupWMClass":
   "Reson8" }` so the generated `.desktop` file's `StartupWMClass` matches
   the runtime WM_CLASS from step 2, fixing icon resolution in the Wayland
   app switcher and title bar.

### Files to Modify

| File | Change |
|:---|:---|
| `apps/client/src/main.ts` | Explicit `BrowserWindow` `icon` option, `app.setName("Reson8")` |
| `apps/client/package.json` | `build.linux.desktop.StartupWMClass` |

### Verification

1. Client typecheck.
2. `npm run build:linux`, run the resulting AppImage under an actual Wayland
   session, confirm the real Reson8 icon appears in both the title bar and
   the alt-tab app switcher. **This is inherently a windowing-system-level
   visual check** — cannot be verified by typecheck/unit test, needs a
   manual pass on Wayland specifically (the bug doesn't reproduce on X11 per
   the original report).
3. Sanity-check the Windows/macOS builds still show the correct icon
   afterward (the `icon:` option change is cross-platform, low risk of
   regression, but worth a quick look).

---

## Cross-Cutting Dependencies & Implementation Order

None of these six items block each other structurally, but there's a
sensible ordering:

1. **PRD 10.6** (AppImage icon) and **PRD 10.5** (unread fix) — fully
   independent, low-risk, quick fixes. Good to knock out first/anytime.
2. **PRD 10.3** (timer blink) before **PRD 10.4** (mute/deafen
   accumulation) — both touch the same mute/deafen toggle → re-render path;
   fixing the blink first isolates that change, and 10.4's move to a single
   atomic `SET_VOICE_STATE` call per toggle (instead of two) further reduces
   redundant re-renders, so doing them in this order avoids re-verifying the
   blink fix against a still-changing toggle flow.
3. **PRD 10.2** (Audio tab) — independent, but shares the "add a settings
   tab" pattern with 10.1's About tab; no hard ordering between the two.
4. **PRD 10.1** (auto-updater) — largest, most isolated item, and the one
   whose full "update available" path can't be end-to-end verified until a
   release actually exists. Reasonable to do last so its unavoidable
   verification gap doesn't block anything else, and so the *next* version
   bump (which the updater will detect) naturally includes the rest of this
   phase's completed work.

---

## Open Decisions Confirmed With the User

- **Auto-updater platform scope:** all three platforms (Windows/Linux/macOS)
  ship the same code path; macOS's lack of code signing/notarization is
  documented as a known limitation with a manual-download fallback, not a
  reason to scope mac out of PRD 10.1.
- **Push-to-talk while deafened:** fully blocked — holding PTT produces no
  audio while deafened, matching the roadmap's literal wording. (See PRD
  10.4 for the related, newly-surfaced decision — disabling the Mute
  button/shortcut while deafened — which was not explicitly asked about but
  follows the same reasoning; flag during review if a different behavior is
  preferred.)
