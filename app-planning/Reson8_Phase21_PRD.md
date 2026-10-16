# Reson8 — Phase 21 PRD (Nocturne polish: sidebar, streams, Linux chrome and fixes)

**Created:** 16/10/2026
**Author:** Felipe B. Netto (assisted by AI)
**Status:** Approved by the owner (16/10/2026, decisions D1–D10). Build the items one at a time, in the order of [Order and dependencies](#order-and-dependencies), waiting for the owner's OK after each (H.5).
**Source:** the 12 items of `app-planning/nextsteps.txt` (16/10/2026) and the reference images next to it in `app-planning/`. The Phase 20 open-items list that `nextsteps.txt` used to hold is preserved in `app-planning/archive/open-items-after-phase-20.md`.
**Branch:** `ui-overhaul-beta`. **Never commit to, merge into or push `main`. Never push at all** — the owner pushes the branch at the end.
**Target release:** `3.0.0-beta.5` (SemVer: the next pre-release of the same 3.0.0 line — a pre-release identifier increments, nothing else changes).

> **Who this is written for.** An implementer (human or AI) who has not seen this conversation. Every item says which files and functions to touch, what to write, in what order, what must not change and how to prove it works. Line numbers drift — **always find code by the function, id or class name given here, never by a line number.** Where this document gives code it is the reference implementation: keep its names and behaviour, adapt only what a `grep` shows is named differently.

---

## Table of Contents

1. [Owner decisions](#owner-decisions)
2. [Executor's handbook](#executors-handbook) — read first; every item depends on it
3. **P1 — Fixes**
   - [21.1 Kick really removes someone from a room](#211--kick-really-removes-someone-from-a-room) (item 9)
   - [21.2 Long text never overflows the window](#212--long-text-never-overflows-the-window) (item 11)
   - [21.3 The composer joins the reply bar seamlessly](#213--the-composer-joins-the-reply-bar-seamlessly) (item 6)
   - [21.4 The image viewer fits images below its controls](#214--the-image-viewer-fits-images-below-its-controls) (item 12)
   - [21.5 Linux: darkened backdrops keep the rounded corners](#215--linux-darkened-backdrops-keep-the-rounded-corners) (item 8)
   - [21.6 Linux: window buttons that belong to the app](#216--linux-window-buttons-that-belong-to-the-app) (item 7)
4. **P2 — The left column**
   - [21.7 The voice card leaves the channel list](#217--the-voice-card-leaves-the-channel-list) (item 1)
   - [21.8 A balanced channel tree](#218--a-balanced-channel-tree) (item 2)
   - [21.9 Avatars and a speaking ring in the tree](#219--avatars-and-a-speaking-ring-in-the-tree) (item 3)
   - [21.10 The "Disconnected" voice card and mute/deafen before joining](#2110--the-disconnected-voice-card-and-mutedeafen-before-joining) (item 4)
5. **P3 — Settings**
   - [21.11 Glass category menu in both Settings dialogs](#2111--glass-category-menu-in-both-settings-dialogs) (item 5)
6. **P4 — Streams inside the room tab** (item 10)
   - [21.12 Stream thumbnails: protocol and server](#2112--stream-thumbnails-protocol-and-server)
   - [21.13 Stream thumbnails: taking and showing them](#2113--stream-thumbnails-taking-and-showing-them)
   - [21.14 The room tab switches to stream mode by itself](#2114--the-room-tab-switches-to-stream-mode-by-itself)
7. [21.15 Release 3.0.0-beta.5 and documentation](#2115--release-300-beta5-and-documentation)
8. [Order and dependencies](#order-and-dependencies)
9. [Appendix A — Values taken from the reference images and the design study](#appendix-a--values-taken-from-the-reference-images-and-the-design-study)
10. [Appendix B — Research notes](#appendix-b--research-notes)

---

## Owner decisions

Answered by the owner on 16/10/2026. The implementer never re-decides these.

| # | Question | Answer |
|---|---|---|
| D1 | Item 7: if the native window buttons can't be made transparent on KDE, what then? | **HTML window buttons on Linux** (21.6). Windows and macOS keep the native ones. |
| D2 | Item 3: colour of the speaking ring in the tree | **Voice green** (`--color-voice`), the same as the voice room tiles. |
| D3 | Item 9: should the server also block a kicked user from re-entering for a while? | **No — client fix only.** A kick removes you; you may click back in yourself. Persistent trouble is what Ban is for. |
| D4 | Item 10: you are in a room whose tab is CLOSED and someone starts sharing | **Nothing happens until you click** (the existing sound and LIVE badge only). |
| D5 | Item 4: does mute/deafen chosen before joining survive an app restart? | **Yes — remembered on this device.** |
| D6 | Item 10: how often is a stream's thumbnail refreshed? | **About 2 s after the share starts, then every 2 minutes.** This also gives the "Also live" cards a picture (Phase 20's D1, "update the static cards", is answered by this). |
| D7 | Item 10: what does the SHARER see in their own room tab? | **A "You're live" card** showing their own capture locally (no server consumer) with Stop sharing. |
| D8 | Frames 17a–17d (the always-on voice card and the glass Settings) | **Design revision 2** is in the handoff: frames `screenshots/17a.png`–`17d.png`, the rules in `SPEC.md` **§1.6** (voice card) and **§9** (glass menu), the mockup's `<!-- voice dock -->` and Settings markup in `design/Reson8 App.dc.html`. **SPEC wins** over the reference images in `app-planning/`, which were the owner's early captures. 21.7, 21.10 and 21.11 quote SPEC's values. |
| D9 | Item 10: clicking a sharer's LIVE badge (tree or room tile) | **Keep the "Watch {name}'s stream?" dialog, but show it AFTER the room tab is open and focused with that stream in "ready" mode** — not before. Confirm → the live feed starts; Cancel → you stay on the ready stage (thumbnail + Watch button). |
| D10 | Item 2: the open-channel highlight (PRD 16.3) | **Keep the eye icon with its tooltip** ("You're viewing this channel") — people know it. The design's tinted row and left accent bar are added around it; the eye stays at the right of the row. |

---

## Executor's handbook

### H.1 Where things are

| What | Where |
|---|---|
| Renderer (all UI logic; one classic script, no imports) | `apps/client/src/renderer/renderer.ts` (~17 800 lines) |
| Renderer markup **and all CSS** | `apps/client/src/renderer/index.html` (CSS in the `<style>` block at the top; markup below). Design tokens live in ONE `:root` block — **no colour literal anywhere else** (PRD 19 R6). New colours become tokens there. |
| The renderer's view of the preload API | `interface Reson8Api` in `renderer.ts`. **Every new preload method must be added there too.** |
| Preload (socket, IPC bridge, voice engine host) | `apps/client/src/preload.ts` |
| Voice engine | `apps/client/src/services/voice.service.ts` |
| Main process | `apps/client/src/main.ts`; window frame options in `apps/client/src/window-chrome.ts` |
| Viewer window | `apps/client/src/renderer/viewer.html` / `viewer.ts`, `apps/client/src/preload-viewer.ts` |
| Wire protocol (source of truth) | `packages/shared-types/src/socket-events.ts`, DTOs in `packages/shared-types/src/models.ts` |
| Server handlers / services / tests | `apps/server/src/handlers/*.handler.ts`, `apps/server/src/services/*.ts`, `apps/server/src/__tests__/*.test.ts` (vitest, pure logic only) |
| Per-event access class | `EVENT_ACCESS` in `apps/server/src/services/access.service.ts` — TypeScript refuses an unclassified event |
| Reference images for this phase | `app-planning/*.jpg`, `app-planning/*.png` (named in each item) |
| Design study | `app-planning/design_handoff_reson8_ui_overhaul/design/Reson8 App.dc.html` and `screenshots/` |

### H.2 Rules for every item (breaking one fails review)

1. **Do not break existing features.** Before changing a function, `grep` every caller and every CSS selector that touches what you change, and list them in the progress entry. The root and workspace `AGENTS.md` files describe the invariants (grouping, scroll keeper, the one menu builder, the one stage state machine, socket ownership, the packet gate…). Read the paragraphs relevant to your item before starting.
2. **Shared types first.** A payload change goes into `packages/shared-types` first (`npx tsc --build` there), then the server, then `preload.ts`, then `renderer.ts`.
3. **Old servers and old clients keep working.** New fields are optional (`?`). A new event that an older server doesn't know never answers, so every new client call has a timeout and a fallback (see `api.getServerSummary()`'s 5 s pattern). An older client simply ignores a new server event.
4. **Text from other people** goes into the DOM with `textContent`, never `innerHTML` (except through `escapeHtml()`; `showToast()` uses `innerHTML`).
5. **Persistence:** `localStorage` under a `reson8-*` key, every read and write in `try/catch` with a safe default. `grep -n "reson8-" renderer.ts` before adding a key.
6. **Targeted DOM updates** over `renderTree()` for small state changes (a full re-render loses collapsed categories).
7. **Motion:** every new animation sits behind `@media (prefers-reduced-motion: no-preference)` (or is disabled inside `@media (prefers-reduced-motion: reduce)`), and animates only `opacity`, `transform`, colours and grid/flex track sizes — never `top/left/width` of large areas.
8. **Accessibility:** icon-only buttons have `aria-label` and `title`; controls that are visually hidden are also unreachable (`inert` or `hidden`/`disabled`), never just `opacity: 0`.
9. **Security boundary:** anything needing Node/Electron goes through a validated `ipcMain` handler + a preload method. Main-process handlers check `BrowserWindow.fromWebContents(event.sender)` is the window they expect.
10. **Phosphor:** only the **regular** (`ph ph-*`) and **fill** (`ph-fill ph-*`) weights are vendored. `ph-bold` draws nothing.
11. **Dialog CSS:** the generic `.modal-content input/label` rules out-specify a single class — scope new dialog rules under the dialog's own id/class.
12. **When the code doesn't match this document** (a function was renamed, a behaviour described under "Today" isn't what you find), do not improvise a different design: find the equivalent with `grep`, and if there is none or the difference changes the plan, **stop and ask the owner**. Note every such difference in the progress entry under "Differences from the PRD".
13. **Scope:** build exactly the item's steps. No drive-by refactors, renames, reformatting (never run `npm run format` over the repo) or "improvements" to neighbouring code; a bug you notice elsewhere goes into the report to the owner, not into the commit.
14. **Owner decisions are final** (the table above). Never re-ask them and never contradict them.

### H.3 Commands

```bash
# after editing packages/shared-types:
cd packages/shared-types && npx tsc --build
# typecheck every workspace you touched:
cd apps/server && npx tsc --noEmit && npm run test
cd apps/client && npx tsc --noEmit
# lint from the repo root (must exit 0; warnings are fine):
npm run lint
# rebuild the client for a running test instance:
cd apps/client && npx tsc --build && node scripts/copy-html.mjs
# client smoke suites that cover what you touched, e.g.:
cd apps/client && npm run test:window-chrome
```

### H.4 Driving the real app

The owner does the complex UI testing by hand; the implementer still proves every item works before handing it over:
- **Build, then drive the real client over CDP:** `electron . --remote-debugging-port=<p> --user-data-dir=<tmp>` (add `--inspect=<q>` for the main process). The renderer is a classic script: its functions and top-level state are reachable from `Runtime.evaluate` (wrap snippets in an IIFE). Use trusted input (`Input.dispatchMouseEvent`). Take `Page.captureScreenshot` and **look at it**.
- **Other people** are Socket.io bots against the dev server (`npm run dev` in `apps/server`, Postgres + Redis from `docker-compose.dev.yml`). A dev build mints a fresh instance id each launch — grant a test role to the current id when needed and remove it afterwards.
- **Native window parts** (the OS window buttons, the window border, rounded corners) do NOT appear in CDP screenshots — capture the real window through the OS (on KDE: `spectacle -b -a -n -o <file>` for the active window). The development machine is Arch Linux + KDE Plasma, so Linux items can be checked for real.
- Unset `ELECTRON_RUN_AS_NODE` before launching Electron. Never `pkill -f` a pattern that is also in your own command line; stop Electron by the PID listening on the debug port.
- Clean up afterwards: test roles, scripts, channels, scratch databases.

### H.5 Finishing an item (every item, no exceptions)

1. Typecheck every touched workspace, run the server tests if the server changed, run the client smoke suites that cover changed files, `npm run lint` from the root (exit 0).
2. Append the `progress.txt` entry with `/log-progress` (`.claude/commands/log-progress.md`): Feature/Fix, Problem, Solution, Key Files Modified, Verification (what was driven and what was NOT exercised), Next Step.
3. Stage **only the files of this item** by path (`git add <paths>`; never `git add -A`), commit with the message given in the item (end it with the attribution trailer the session asks for), then `git show --stat HEAD` to check nothing is missing or extra.
4. **Do not push.** Report to the owner — what changed, what was verified, what the owner should check by hand — and **wait for the owner's OK before starting the next item.**

---

## P1 — Fixes

### 21.1 — Kick really removes someone from a room

**Item 9.** *"I kicked a participant from a voice channel and it reappeared connected 10 seconds later … it was impossible to kick the participant."*

**Root cause (found by reading the code; reproduce it first, step 1):**
- Server: `KICK_USER` (`apps/server/src/handlers/moderation.handler.ts`) calls `removeSocketFromChannel()` (closes the mediasoup session, leaves presence and the room) and emits `USER_KICKED { channelId }` to the target.
- Client preload: `socket.on("USER_KICKED", …)` (`preload.ts`) **only forwards** the event to the renderer. `lastVoiceChannelId` stays set and the old `VoiceService` stays alive.
- The server closed that user's transports, so the client's ICE fails a few seconds later → `VoiceService.onConnectionLost` (wired by `wireVoiceServiceCallbacks()`) → `attemptVoiceRejoin(lastVoiceChannelId)` → a fresh `USER_JOIN_CHANNEL` that the server accepts. The user is back ~10 s later, every time.
- The renderer's `api.on("user-kicked")` handler also resets less than `leaveVoiceAndNotify()` does (the mic level meter and self-hear are left running).

**Steps:**
1. **Reproduce first.** Two clients (or a client + a bot that does the full voice handshake) in one room; kick from an admin client; watch the server log for a second `USER_JOIN_CHANNEL` from the kicked user and the renderer log for `voice-reconnecting`. Write down the timings in the progress entry.
2. **Preload — stop the session the moment a kick arrives.** Replace the bare forwarder:
   ```ts
   socket.on("USER_KICKED", (payload) => {
       // A kick ends this voice session for good: no automatic rejoin (PRD 21.1).
       if (payload.channelId === lastVoiceChannelId || payload.channelId === voiceService?.currentChannelId) {
           endVoiceSessionLocally();
       }
       emit("user-kicked", payload);
   });
   ```
   and add next to `attemptVoiceRejoin()`:
   ```ts
   /** Bumped whenever the session is ended on purpose; a rejoin that started earlier gives up. */
   let voiceSessionGeneration = 0;

   /** Ends the local voice session WITHOUT telling the server (it already removed us). */
   function endVoiceSessionLocally(): void {
       voiceSessionGeneration++;
       lastVoiceChannelId = null;
       voiceRejoinInFlight = false;
       voiceService?.cleanup();
       voiceService = null;
   }
   ```
3. **Preload — make an in-flight rejoin respect it.** In `attemptVoiceRejoin()` capture `const generation = voiceSessionGeneration;` at the top. After **every** `await` in the loop (the `USER_JOIN_CHANNEL` ack, `joinVoiceChannel()`, the 1.5 s retry sleep) check `if (generation !== voiceSessionGeneration) { … return; }`. If the join had already succeeded at that point, emit `USER_LEAVE_CHANNEL { channelId }` and `cleanup()` the service before returning; never emit `voice-reconnected` or `voice-rejoin-failed` in that case.
4. **Preload — ignore a stale service's callbacks.** In `wireVoiceServiceCallbacks(vs)`, make `onConnectionLost` start with `if (vs !== voiceService) return;` (a service that was cleaned up must never trigger a rejoin).
5. **Preload — the user leaving on purpose uses the same guard.** `leaveVoiceChannel()` and `disconnect()` also bump `voiceSessionGeneration` (call `endVoiceSessionLocally()` after their own server notifications), so a rejoin racing a manual Leave also stops.
6. **Renderer — one local teardown.** Extract the body of `leaveVoiceAndNotify()` that resets local state (everything except `api.leaveVoiceChannel()`, the "Left voice channel" log and the `leaving-channel.mp3` sound) into `resetLocalVoiceState()`. Call it from `leaveVoiceAndNotify()` and from `api.on("user-kicked")` (which keeps its own log line, its sound and `suppressNextPresenceSound`). This also stops the mic level meter and self-hear on a kick, and closes the room tab and any stage watch through `updateVoiceUI()` as before.
7. Do **not** change the server (D3). Do not change `VOICE_SESSION_LOST` handling (that one is a server-side failure and must keep rejoining).

**Must not change:** automatic rejoin after a real network drop (Socket.io reconnect → `connect` handler) and after a transport failure while signaling stays up; `VOICE_SESSION_LOST` rejoin; the kick sounds for the kicked user and for the room.

**Verify:**
- The repro from step 1: after the fix the kicked user's client sends no `USER_JOIN_CHANNEL` for 60 s (server log), the room tab closes, the dock shows the not-in-voice state, the mic meter stopped (`api` level stays 0).
- The kicked user can click the room and join again normally.
- Kick while the target is mid-rejoin (cut their network for 2 s with the CDP `Network.emulateNetworkConditions` offline toggle, kick during "Reconnecting…"): they do not come back.
- Regression: drop the network for 5 s without a kick → the client still rejoins its room by itself.
- Kick while the target is sharing its screen: the share stops, nobody keeps a LIVE badge.

**Commit:** `fix: a kick ends the voice session instead of auto-rejoining (PRD 21.1)`

---

### 21.2 — Long text never overflows the window

**Item 11.** `app-planning/example_message.txt` is Braille art: 7 743 characters of ~140-character runs of Braille cells separated by single spaces. U+2800 (the blank Braille cell) is **not** whitespace, so each run is one unbreakable "word" wider than the chat.

**Root cause:** `.chat-msg .msg-text.msg-text-block` has `overflow-wrap: anywhere`, but a **single-line (inline) message** — `.msg-text` without `.msg-text-block` — has no wrap rule at all, so its min-content width is the longest run and the whole message list scrolls sideways.

**Steps:**
1. **Reproduce:** send the file's content as a message (paste it in the composer, or emit `SEND_MESSAGE` from a bot) and screenshot the horizontal scrollbar. Also send: a 300-character URL, a 300-character word without spaces, a 200-character inline code span, a long word inside a reply snippet, a long nickname.
2. Move the wrap rule to **every** message text: in the base `.chat-msg .msg-text` rule add `overflow-wrap: anywhere;` (keep it on `.msg-text-block` — harmless). `anywhere` (not `break-word`) is required: it is the only value that also shrinks the min-content size, which is what flex/grid parents measure.
3. Make sure no ancestor reintroduces the overflow: each flex child on the path `.chat-messages > .chat-msg > .msg-body > .msg-text` must be allowed to shrink (`min-width: 0` where it is a flex item). Check with the long run in step 1, not by reading.
4. Apply the same rule where other people's text is shown in a box that does NOT already ellipsize: reply snippets (`.msg-reply`, built by `buildReplySnippet()` — check its text child; it may already ellipsize), link-preview card title/description, search result snippets (Q1's results column), the pinned bar's preview, the profile card's name, toasts. Leave single-line ellipsized texts (`white-space: nowrap; text-overflow: ellipsis`) alone — they already can't overflow.
5. Code blocks (`.msg-text pre`) keep `white-space: pre` and their own horizontal scroll (`overflow-x: auto`) — that is correct for code. Check the pre box itself never grows wider than the message (`max-width: 100%`).
6. **Do not** add `overflow-x: hidden` to `.chat-messages` as a "fix": it would hide content instead of wrapping it and break the toolbar's positioning.

**Verify:** every case from step 1 wraps inside the chat with no horizontal scrollbar at 1024 px and at the minimum window width; the Braille art wraps (it will not keep its shape on a narrow window — expected, the same as Discord); grouping, the "See more" collapse (a long wrapped message must still collapse past 15 lines) and the hover toolbar still work; a normal message looks exactly as before (compare screenshots).

**Commit:** `fix: wrap long unbroken text in messages and snippets (PRD 21.2)`

---

### 21.3 — The composer joins the reply bar seamlessly

**Item 6.** Reference: `app-planning/text_box_with_reply.jpg`. In reply mode `#reply-bar` (rounded top corners, no bottom border) sits on top of `#chat-input-bar`, which still has all four corners rounded, so the two boxes meet with gaps at both top corners.

**Steps:**
1. Pure CSS, no JS state (so it can never get out of sync — the bar's visibility already toggles `.visible` in `renderReplyBar()`). In the composer restyle block (search `/* Composer: one rounded box`), add:
   ```css
   /* Reply mode (PRD 21.3): the bar and the box are one shape. */
   #chat-composer:has(#reply-bar.visible) #chat-input-bar {
     border-top-left-radius: 0;
     border-top-right-radius: 0;
   }
   /* Focus colours the whole shape, not just its lower half. */
   #chat-composer:has(#reply-bar.visible):has(#chat-input-bar:focus-within) #reply-bar {
     border-color: var(--color-accent-700);
   }
   ```
2. The `transition` of the input bar (if any) must not animate the radius change (it would show a gap for a few frames) — check and exclude `border-radius` from it.
3. **The attachment tray case:** the composer stacks `[reply bar → attachment tray → input bar]`. With a reply AND picked images, the tray sits between the two. Make the three read as one shape: while `#reply-bar.visible`, give `#attachment-tray.has-items` the same side margins as the bar (`margin: 0 14px`), left/right borders in `--color-divider` (accent-700 when focused, as above) and no radius. Without a reply nothing about the tray changes.
4. Sending a reply calls `cancelReply()` → `.visible` goes → the radius comes back by itself. Escape and the bar's ✕ do the same.

**Verify (CDP screenshots, compare with the reference):** reply mode — no corner gaps, focused and unfocused; reply + 2 picked images; after sending, after Escape, after ✕ — four rounded corners again; switching to a tab without a reply draft shows a plain composer, back to the tab with a draft shows the joined shape; DM tabs the same.

**Commit:** `fix: square the composer's top corners under the reply bar (PRD 21.3)`

---

### 21.4 — The image viewer fits images below its controls

**Item 12.** Reference: `app-planning/image_viewer_with_actions_overlapping_content.png`. Since the title-bar work (Phase 20) the viewer's controls sit one row below the window-button band (`top: calc(var(--titlebar-h) + 8px)`), but the fit-to-window size still uses the whole stage, so a window-shaped image fills the window and the toolbar, Close and "Sent by" pill cover its top.

**Today:** `openLightbox()` → `onload` → `lightbox.fit = lightboxComputeFit()`; `lightboxComputeFit()` uses `lightboxStageSize()` (the full-window `#lightbox-stage`) × `LIGHTBOX_FIT_MARGIN`; `lightboxClampPan()` keeps the image inside the stage; the window `resize` handler recomputes the fit.

**Steps:**
1. Add `lightboxChromeInset(): number` — the height to keep clear at the top: the largest `getBoundingClientRect().bottom` among the **visible** `.lightbox-toolbar`, `.lightbox-close` and `.lightbox-sender` (skip `hidden` ones and `display: none` ones — the preview-only viewer has fewer controls), plus 8 px. Measure, don't hard-code: it already includes `--titlebar-h` and adapts to the system-title-bar mode (band 0).
2. In `lightboxComputeFit()`, fit into `{ w, h: h - 2 * inset }` — the same inset at the top **and** the bottom, so the fitted image stays centred in the window (the stage, the centring and `transform` maths are unchanged).
3. The fitted scale is the **floor** of zooming (`lightboxSetScale` clamps to `lightbox.fit`); keep it that way: zooming in may still go under the controls (that's expected while zoomed and panning). Panning limits (`lightboxClampPan`) stay based on the full stage.
4. A small image (natural size already smaller than the safe box) keeps its natural size (fit ≤ 1, as today).
5. The resize handler already recomputes the fit — check it calls the same function (no second copy of the maths).

**Verify:** open images of 1920×1080, 1080×1920, 3000×600, 400×300 and one exactly the window's size: at fit, no pixel of the image is under the toolbar, Close or the pill; the image is centred; zoom in/out, wheel, drag-pan and double-click still behave; preview-only viewer (attachment tray "eye") the same; with "Use the system title bar" on (band 0) the image gets correspondingly larger; resizing the window keeps the rule.

**Commit:** `fix: image viewer fit keeps clear of its controls (PRD 21.4)`

---

### 21.5 — Linux: darkened backdrops keep the rounded corners

**Item 8.** Reference: `app-planning/linux_app_modal_with_darkened_background.png`. On Linux with the integrated title bar the page draws its own 1 px border and 10 px radius (`body.platform-linux.integrated-titlebar:not(.window-maximized):not(.window-fullscreen)`), and `html` has `overflow: hidden` so the body clips its children. **But `overflow` never clips `position: fixed` descendants** (their containing block is the viewport), and every dialog backdrop and the image/video lightbox are `position: fixed; inset: 0` — so they paint square, pointy corners over the rounded window.

**Steps:**
1. Clip with a graphical effect instead, which DOES apply to fixed descendants: in the same rule as the border/radius add
   ```css
   clip-path: inset(0 round 10px);
   ```
   (keep `border-radius: 10px`; the two use the same radius so the border stays visible — check the four corners). Do not use `contain: paint`/`transform` on the body: they would make the body the containing block of every fixed element and change their layout.
2. When maximized or fullscreen the rule doesn't match, so nothing is clipped (correct — square window).
3. Check the window buttons' area (top-right): until 21.6 lands the native buttons are drawn by the OS outside the page and are NOT affected; after 21.6 the HTML buttons are inside the clip, as wanted.
4. The Viewer window (`viewer.html`) has no rounded body today — leave it.

**Verify on KDE (OS capture, H.4):** Settings open, a confirmation dialog, the image viewer, the video lightbox, the user profile card, the NSFW prompt — the darkened layer follows the rounded corners and the 1 px border stays visible all around; maximize → square, no border; restore → rounded again; Windows unaffected (the selector is Linux-only).

**Commit:** `fix: clip full-window overlays to the rounded window on Linux (PRD 21.5)`

---

### 21.6 — Linux: window buttons that belong to the app

**Item 7.** References: `app-planning/linux_app_version.png` (a grey opaque block at the top right) and `linux_app_modal_with_open_image_viewer.png` (the block over a full-screen image). On KDE the native buttons from Electron's window-controls overlay ignore the transparent `titleBarOverlay.color` (`#00000000`, `TITLEBAR_COLOR` in `window-chrome.ts`) and draw an opaque grey strip. See Appendix B for what is known.

**Step 1 — one last attempt at the native buttons (time-box: 2 hours).** On this KDE machine, try, in order, and screenshot each through the OS:
- (a) the overlay colour with partial alpha (`#00000001`) instead of fully transparent;
- (b) `win.setTitleBarOverlay({ color: "#00000000", symbolColor, height })` after `ready-to-show`;
- (c) X11 vs Wayland (`--ozone-platform=x11` / `wayland`) — note which one the owner runs.
If any gives truly transparent buttons on both X11 and Wayland, stop here, keep the native buttons, document the change in the progress entry and skip step 2. **Otherwise (expected) go to step 2 — the owner chose it (D1).**

**Step 2 — HTML window buttons on Linux only.**
1. `window-chrome.ts`: for `platform === "linux"` and not `systemTitleBar`, return `{ frame: false }` (add `frame?: false` to `FrameOptions`) instead of `titleBarStyle` + `titleBarOverlay`. Windows and macOS options stay byte-identical. Update `scripts/window-chrome-smoke.mjs` (Linux expectation) and run `npm run test:window-chrome`.
2. `main.ts`: the Linux window stays `transparent: true, backgroundColor: "#00000000"` (Phase 20). Add one IPC handler:
   ```ts
   ipcMain.handle("window-control", (event, action: unknown) => {
       const win = BrowserWindow.fromWebContents(event.sender);
       if (!win || (win !== mainWindow && !viewerWindows.has(win.id))) return false; // viewerWindows is keyed by BrowserWindow.id
       if (action === "minimize") win.minimize();          // the existing "minimize" handler still does minimize-to-tray
       else if (action === "toggle-maximize") { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
       else if (action === "close") win.close();            // the existing "close" handler still does close-to-tray
       else return false;
       return true;
   });
   ```
   (`mainWindow` and `viewerWindows` — a `Map<number, …>` keyed by `viewerWindow.id` — are the real names in `main.ts` today.) `window-chrome-state` is already sent on maximize/unmaximize/fullscreen — make sure it is also sent for the Viewer window if it isn't.
3. `preload.ts` + `preload-viewer.ts`: `windowControl(action: "minimize" | "toggle-maximize" | "close"): Promise<boolean>` (validate the string before `ipcRenderer.invoke`). Add it to `interface Reson8Api` (and the Viewer's API type).
4. Markup: at the end of `#titlebar` (and of `#viewer-titlebar` in `viewer.html`):
   ```html
   <div class="window-controls" id="window-controls">
     <button type="button" class="wc-btn" data-wc="minimize" aria-label="Minimize" title="Minimize"><i class="ph ph-minus" aria-hidden="true"></i></button>
     <button type="button" class="wc-btn" data-wc="toggle-maximize" aria-label="Maximize" title="Maximize"><i class="ph ph-square" aria-hidden="true"></i></button>
     <button type="button" class="wc-btn wc-close" data-wc="close" aria-label="Close" title="Close"><i class="ph ph-x" aria-hidden="true"></i></button>
   </div>
   ```
   Hidden by default; shown only by `body.platform-linux.integrated-titlebar .window-controls { display: flex; }`. Wire the clicks in `renderer.ts`/`viewer.ts`; on `window-chrome-state` swap the maximize icon to `ph-copy` (restore) with label/title "Restore" while maximized.
5. CSS (tokens only, in the restyle area of `index.html`; the Viewer copies the same rules):
   - Buttons 46 × 38 px (the bar's height), transparent background, `color: var(--color-neutral-300)`, `-webkit-app-region: no-drag`, `font-size: 16px`.
   - Hover: `background: color-mix(in srgb, var(--color-text) 8%, transparent)`; close hover: a new `:root` token `--color-wc-close-hover: oklch(0.58 0.2 25)` (a solid red, like every OS close button — `--color-danger-hover` is too faint) with the icon in `--color-white`.
   - The close button's top-right corner follows the window radius (`border-top-right-radius: 10px` when not maximized) — 21.5's clip does the rest.
   - Focus ring visible (`:focus-visible`).
   - Set the safe-area tokens for Linux: in the `:root` override that today reads `env(titlebar-area-*)`, add a Linux branch: `body.platform-linux.integrated-titlebar { --titlebar-h: 38px; --controls-right: 138px; }` (3 × 46). Everything that already keeps out of the buttons (dialogs, toasts, the image viewer controls, the server pill centring) then keeps working unchanged — check each.
6. **Behaviour to keep:** dragging by the bar (KDE handles `-webkit-app-region: drag` natively, including snapping to edges — verify); **double-click on an empty part of the bar maximizes/restores** — test first; if KDE/Electron doesn't do it natively for a frameless window, add a `dblclick` handler on `#titlebar` that ignores clicks on buttons/the pill and calls `windowControl("toggle-maximize")` (make sure it never toggles twice); minimize-to-tray and close-to-tray (they hang off the window's own events, so they keep working); the Viewer window gets the same three buttons.
7. **Known loss (document it in the progress entry and the release notes' known-issues):** right-clicking the bar no longer opens the window manager's menu (KDE's Alt+F3 still does). If the owner later wants the native buttons back, "Use the system title bar" gives the full OS frame.
8. `AGENTS.md` (client): update the "Integrated title bar" and "Window-button safe area" bullets: Linux draws its own buttons, why, and the IPC.

**Verify on KDE (OS captures):** the buttons blend into the bar on the welcome screen, connected, over Settings, over the image viewer (no grey block — compare with both reference images); hover/close-hover colours; minimize (and with minimize-to-tray on: hidden to tray, tray click restores), maximize/restore icon swap, close (and close-to-tray); drag, edge snapping, double-click; keyboard Tab reaches the three buttons; Viewer window the same; "Use the system title bar" + restart → KDE's own frame, no HTML buttons; **Windows build unchanged** (run the Windows-specific check list in the progress entry as "owner to verify" if no Windows machine is available).

**Commit:** `feat: app-drawn window buttons on Linux (PRD 21.6)`

---

## P2 — The left column

References for 21.7–21.9: `app-planning/current_menu.jpg` (today) and `app-planning/should_been_menu.png` (target); the design study's sidebar markup (`Reson8 App.dc.html`, search `<!-- sidebar -->` and `<!-- voice dock -->`). Exact values are in Appendix A.

### 21.7 — The voice card leaves the channel list

**Item 1.** Today `#voice-panel` (the dock card plus the screen-share and self-hear banners) is the last child **inside** `#left-pane`, the bordered card that also holds `#tree-header`, `#channel-tree` and `#dm-list`. The design puts the voice card **below** that card, as its own card, separated by the same gap as the panes.

**Steps:**
1. Markup: wrap the two in a new column and move `#voice-panel` out of `#left-pane`:
   ```html
   <div id="left-column">
     <div id="left-pane"> … #tree-header, #channel-tree, #dm-list (unchanged) … </div>
     <div id="voice-panel"> … unchanged content … </div>
   </div>
   ```
   **Keep the ids** — `#left-pane.show-dms`, `body.no-access`, `voicePanel`, `getElementById("left-pane")` and many CSS rules rely on them. `grep -n "left-pane\|voice-panel\|leftPane\|voicePanel" renderer.ts index.html` and check every hit still makes sense with the new parent (anything that measured `#left-pane`'s height, e.g. the tree's scroll area, now gets the card's height — correct).
2. CSS:
   - `#left-column { width: 280px; min-width: 220px; flex-shrink: 0; display: flex; flex-direction: column; gap: 10px; min-height: 0; }` (10 px, the study's sidebar gap — frames 17a/17b). Move `width/min-width` off `#left-pane`; `#left-pane { flex: 1; min-height: 0; }` keeps its card look (border, radius, background from the R2 restyle block).
   - `#voice-panel { padding: 0; }` (it no longer needs inner padding — it is not inside a card) and the dock card gets the same frame as the tree card: `border: 1px solid var(--color-divider); border-radius: var(--radius-lg);` + its gradient background (unchanged colours). The banners keep their look and sit above the dock card inside `#voice-panel`.
   - When `#voice-panel` is hidden (not in voice, until 21.10) the tree card simply fills the column.
3. The welcome screen hides `#main`'s panes today — check the new wrapper is hidden with them (`body.is-connected` rules).
4. The DM sidebar (`#left-pane.show-dms`) keeps the voice card below it (it is outside the card now) — that's intended (the design shows the dock in both views).

**Verify:** screenshots vs frame `17b.png` and `should_been_menu.png` (in voice): two separate cards, 10 px apart, aligned with the right pane's top and bottom; the tree scrolls inside its card and never under the dock; DM view; share-screen banner and self-hear banner show above the dock card; minimum window width (220 px column) — nothing overflows; leaving voice — the tree card grows to the bottom.

**Commit:** `feat: voice card below the channel list, as its own card (PRD 21.7)`

---

### 21.8 — A balanced channel tree

**Item 2.** Compare `current_menu.jpg` with `should_been_menu.png`: more padding around the rows, a 9 px gap between icon and name, 14 px names, 30 px rows, a 26 px category header, a Phosphor speaker for voice rooms instead of the 🔊 emoji, and an **initials square** for a text channel with no custom icon (instead of 💬).

**Today:** `renderChannel()` builds `.tree-channel` with `.ch-icon` (`🔊` voice, `💬` text, or the custom emoji/image), `.ch-name`, unread pill, NSFW badge, session timer, count pill, the muted bell and the viewing eye (`createViewingIcon()`); `renderCategory()` builds `.tree-category-label` with `<span class="arrow">▾</span>`; CSS in the "Left Pane (Channel Tree)" block of `index.html`.

**Steps:**
1. **Voice icon:** `renderChannel()` — a voice room's icon is `<i class="ph ph-speaker-high ch-icon voice" aria-hidden="true"></i>` (no emoji). Colour: `--color-neutral-500`; `--color-voice` when you are in that room (`.tree-channel.active`); `--color-accent` when its row is the "viewed" one (step 6).
2. **Text channel without a custom icon:** a new helper next to `serverAvatarElement()`:
   ```ts
   /** An 18 px rounded square with a text channel's initials and a colour from its id (PRD 21.8). */
   function channelInitialsIcon(node: TreeNode): string {
       const hue = channelHue(node.id);                     // stable per channel, survives renames
       return `<span class="ch-icon text ch-initials" style="--ch-hue:${hue}">${escapeHtml(serverInitials(node.name))}</span>`;
   }
   ```
   `channelHue(id)`: the same 31-multiplier string hash as `avatarColor()`, `Math.abs(hash) % 360`. Reuse **`serverInitials()`** (the server avatar's initials rule) so channels and servers abbreviate identically. CSS (`.ch-initials`): 18 × 18 px, `border-radius: var(--radius-sm)`, `display: grid; place-items: center`, `font-size: 7.5px; font-weight: 700; letter-spacing: -0.02em`, `background: oklch(0.42 0.08 var(--ch-hue)); color: oklch(0.92 0.05 var(--ch-hue));`. These two stay in the `.ch-initials` rule: a custom property defined on `:root` is computed there, where `--ch-hue` doesn't exist, so they can't be `:root` tokens. They are a per-channel formula, like `avatarColor()`'s `hsl()` in `renderer.ts`, not palette colours; say so in a one-line comment so R6's "no colour literal outside `:root`" check knows it is deliberate. The custom emoji and custom image paths are unchanged (image: 18 px, `--radius-sm`; emoji: 14.5 px inside an 18 px box).
3. **Row geometry** (Appendix A, "Tree"): `#channel-tree { padding: 6px 8px 10px; }`; `.tree-channel { height: 30px; padding: 0 8px; gap: 9px; border-radius: var(--radius-md); font-size: 14px; color: var(--color-neutral-300); position: relative; }`, hover `color: var(--color-neutral-100); background: color-mix(in srgb, var(--color-text) 4%, transparent)`; every icon sits in an 18 px wide box (`width: 18px; text-align: center; flex: none`). Nested channels: today depth is shown with left padding (`24px` for children) — keep a visible indent for children of a category (`padding-left: 8px` for root-level rows under a category header, `+16px` per extra nesting level), check against `should_been_menu.png`.
4. **Category header:** `.tree-category-label { height: 26px; padding: 0 6px; gap: 6px; border-radius: var(--radius-sm); font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-neutral-500); }`; `.tree-category { margin-top: 8px; }` (not on the first). Replace the `▾` text glyph with `<i class="ph ph-caret-down arrow" aria-hidden="true"></i>` (10 px) — the existing `.collapsed .arrow { transform: rotate(-90deg) }` keeps working. The Category badge (`.category-badge`) keeps its text, gets `font-size: 9.5px; line-height: 16px; padding: 0 6px; border-radius: var(--radius-sm)`.
5. **Right-side items:** session timer `font: 500 11px ui-monospace, Menlo, monospace; color: var(--color-neutral-500)`; count pill `height: 18px; padding: 0 6px; border-radius: 9px; background: color-mix(in srgb, var(--color-text) 6%, transparent); font-size: 11px; font-weight: 500; color: var(--color-neutral-300)` with the user icon 11 px `--color-neutral-500`; the unread pill, NSFW badge and muted bell keep their meaning (sizes per Appendix A).
6. **The viewed row (D10):** `.tree-channel.viewing` → `background: color-mix(in srgb, var(--color-accent) 14%, transparent); color: var(--color-neutral-100); font-weight: 600;` plus `::before` — an accent bar `position: absolute; left: -8px; top: 7px; bottom: 7px; width: 3px; border-radius: 0 3px 3px 0; background: var(--color-accent); box-shadow: 0 0 10px var(--color-accent);`. **Keep the eye icon** (`createViewingIcon()`, its tooltip "You're viewing this channel" and its `aria-label`): it stays the last item of the row; only re-check its colour/opacity over the new tint (it should read like the muted bell, `--color-neutral-500`→`--color-neutral-400`). `updateViewingIndicator()` keeps toggling `.viewing` and the eye exactly as now. The voice room row is NOT marked as viewed (text channels only, as today).
7. **Unread:** `.tree-channel.unread` keeps bold + `--color-neutral-100`; muted keeps its fade (`opacity: 0.5` on the row, as the design).
8. Do NOT touch: click handlers, drag-and-drop reordering (`attachChannelDragHandlers` — check the drop indicator still lines up with the new row height), context menus, NSFW prompt, unread seeding, keyboard behaviour, `renderOccupants()` (that is 21.9).

**Verify:** the eye and its tooltip still mark the open text channel and move with the active tab; side-by-side screenshot with `should_been_menu.png` and frame `17b.png` (a server with categories, nested channels, text channels with emoji, image and no icon, NSFW, unread, muted, a voice room you are in with a timer and three people); drag-reorder a channel and a category; collapse/expand; rename a channel (initials update, colour stays); long names ellipsize; the minimum column width.

**Commit:** `feat: balanced channel tree with speaker and initials icons (PRD 21.8)`

---

### 21.9 — Avatars and a speaking ring in the tree

**Item 3.** Today each person in a voice room is `.tree-occupant` = `<span class="occ-dot">` (a 6 px green dot that turns accent and pulses with `speaking-pulse` while they talk) + nickname + marks. Target: their **round avatar** (20 px, the same avatar as in chat) and, while speaking, a **green ring with a soft glow** around it (D2).

**What depends on this (do not break):**
- `speakingEls(userId)` selects `.tree-occupant[data-user-id]` and `.voice-tile[data-user-id]`; `api.on("active-speakers")` and the local halo (`refreshLocalSpeakingHalo()`, search "PRD 14.11") toggle `.speaking` on them with a 300 ms hold. **Keep `.speaking` on the row element** — only the CSS that draws it changes.
- `refreshOccupantMarks(userId)` inserts the volume mark / local-mute icon before `.occ-voice-icon, .occ-local-muted, .sharing-badge`.
- The LIVE badge (`.sharing-badge`) click, the occupant context menu (`renderOccupantMenu(buildOccupantMenuModel(...))`).
- `refreshAvatars(userId)` re-applies every `.avatar[data-avatar-user-id]` on `USER_AVATAR_UPDATED` — the tree avatars must be such elements so they update live.

**The avatar data gap:** occupants (`IUserPresence`) carry no `avatarUrl`, and the renderer's `avatarUrlCache` is only filled from messages, DMs, the DM directory and profiles — someone in a room who never wrote anything would show the default avatar instead of theirs.

**Steps:**
1. **shared-types** — `IUserPresence` gains `avatarUrl?: string | null;` (doc: server-built URL, PRD 17.1; absent = older server).
2. **Server — keep it in the Redis presence hash** (presence is Redis, never per-update DB queries):
   - `presence.service.ts`: `joinServer(..., avatarUrl: string | null)` writes `avatarUrl` (empty string = null) into `presence:user:{id}`; new `setAvatarUrl(userId, url)`; `getUserPresence()` returns it. Update the hash's doc comment.
   - `connection.handler.ts` (`USER_JOIN_SERVER`): pass the user's current `avatarUrl` (the join already computes/reads it — `avatarData` / the user row) to `joinServer`.
   - `profile.handler.ts` (`SET_AVATAR`) and the join path that broadcasts `USER_AVATAR_UPDATED`: also call `presence.setAvatarUrl()`.
   - `buildOccupant()` returns `avatarUrl` from presence; its Postgres fallback selects `avatarUrl` too.
   - Tests: if `buildOccupant`'s logic moves into a pure helper, cover it; at least extend an existing presence test if one exists (`grep -rn "getUserPresence" src/__tests__`).
3. **Client — the row:** in `renderOccupants()`:
   ```ts
   rememberAvatarUrl(occ.userId, occ.avatarUrl);           // undefined from an older server leaves the cache alone
   const avatar = createAvatarElement(occ.userId, occ.nickname, 20);
   avatar.classList.add("occ-avatar");
   ```
   build the row with DOM calls (avatar, a `.occ-name` span with `textContent`, then the existing marks HTML), instead of the `occ-dot` string. Remove `.occ-dot` and the `speaking-pulse` keyframes **only if** `grep` finds no other user.
4. **CSS** (Appendix A "Occupant"): `.tree-occupant { height: 26px; padding: 0 8px 0 34px; gap: 8px; font-size: 13px; color: var(--color-neutral-400); border-radius: var(--radius-md); }`, hover `background: color-mix(in srgb, var(--color-text) 5%, transparent)`; `.occ-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`;
   ```css
   .tree-occupant .occ-avatar { flex: none; transition: box-shadow 0.15s ease; }
   .tree-occupant.speaking .occ-avatar {
     box-shadow: 0 0 0 2px var(--color-voice), 0 0 8px color-mix(in srgb, var(--color-voice) 55%, transparent);
   }
   .tree-occupant.speaking .occ-name { color: var(--color-neutral-100); }
   @media (prefers-reduced-motion: reduce) { .tree-occupant .occ-avatar { transition: none; } }
   ```
   Remove the old `.tree-occupant.speaking { color: accent }`.
5. **No flash on re-render:** `renderTree()` rebuilds rows often (presence updates), and `applyAvatar()` fades the image in on `load`. In `applyAvatar()`, after `img.src = …`, add `if (img.complete && img.naturalWidth > 0) img.classList.add("loaded");` so a cached avatar appears at once (benefits every avatar; no other behaviour change).
6. The external-avatars switch (`areExternalAvatarsEnabled()`) still turns them into initials — nothing to do, `applyAvatar()` handles it.

**Verify:** a room with you + 3 bots (one with a Libravatar avatar set, one never wrote a message, one with the default): every row shows the right avatar on first render (the "never wrote" one included — that's the gap fix); speaking (bot sends audio, or your own mic) shows the green ring + glow within ~100 ms and clears after the hold; your own ring follows mute/PTT exactly as before; volume/local-mute marks, muted/deafened icons, LIVE badge and context menu still work; `SET_AVATAR` on a bot updates its tree avatar live; against a **2.7.0/3.0.0-beta.4 server** (no `avatarUrl`) rows still render (cache or default avatar); a tree re-render (mute someone) causes no avatar flicker.

**Commit:** `feat: avatars with a speaking ring in the channel tree (PRD 21.9)`

---

### 21.10 — The "Disconnected" voice card and mute/deafen before joining

**Item 4.** Design: frames `17a.png` (not in a room) and `17b.png` (in a room), rules in `design_handoff_reson8_ui_overhaul/SPEC.md` §1.6, the implementation notes in `PENDING_FEATURES.md` › P6 D1 and the acceptance list in `TEST_STATES.md` › "Revision 2" — **read all three before starting.** After 21.7 the bottom of the left column is empty whenever you are not in a room. The card now shows **all the time while the sidebar does (connected to a server)**, in two versions:

| | Not in a room ("disconnected", 17a) | In a room ("connected", 17b) — today's card |
|---|---|---|
| Background | `linear-gradient(180deg, color-mix(in srgb, <yellow> 8%, var(--color-surface)), var(--color-surface))` | the same gradient from voice green at **8 %** (the study's value; today 7 % — update `--color-voice-tint`) |
| Icon | `ph-fill ph-cell-signal-slash`, `oklch(0.75 0.16 65)` | `ph-fill ph-cell-signal-full`, `--color-voice` |
| Title | "Disconnected", `oklch(0.8 0.15 75)` | "Voice connected", `--color-voice-text` |
| Sub-line | none | "{room} / {category} · {n}ms" (unchanged) |
| Expand button | none | shown |
| Buttons | Mute and Deafen split buttons only, each with its device caret and menu, sharing the width equally | Mute, Deafen, Share screen, Leave (unchanged) |
| Height | identical in both: the title block has `min-height: 28px` (SPEC §1.6 "Height"), so the tree above never jumps | |

Switching between them is animated (step 5 — the owner's request; the study itself switches instantly). "Reconnecting" (`#voice-panel.reconnecting`, PRD 11.1) keeps its pulsing warning signal on the connected version. Leave switches to Disconnected immediately and closes the room tab (already true — `updateVoiceUI()` → `closeVoiceTab()`). PENDING_FEATURES P6 D1 calls the switch `setVoiceCardState("in-room" | "idle")`: implement it as that one function (setting `voicePanel.dataset.voiceState`), called from `updateVoiceUI()` — never toggle the card from anywhere else.

**Step 1 — tokens.** Add beside the green ones in `:root` (SPEC §1.6 names it `--color-voice-idle`): `--color-voice-idle: oklch(0.75 0.16 65);` (icon and gradient), `--color-voice-idle-text: oklch(0.8 0.15 75);` (title), `--color-voice-idle-tint: color-mix(in srgb, oklch(0.75 0.16 65) 8%, var(--color-surface));`. Check the title's contrast on `--color-surface` (≥ 4.5:1 expected).

**Step 2 — mute/deafen owned by the renderer, before and across joins.** Today `isMuted`/`isDeafened` (renderer) mirror the per-join `VoiceService`, the toggles do nothing useful outside a room (`api.toggleMute()` returns `false` without a service) and every join resets both to `false` (`handleChannelClick()` → `isDeafened = false`, `isMuted = false`).
1. Keep `isMuted`, `isDeafened` and add `deafenAutoMuted` as the renderer's **intended** state, persisted under `reson8-voice-self-state` (`{ muted, deafened, deafenAutoMuted }`, D5), read once at startup (safe default all `false`), written on every change.
2. `toggleMuteAndNotify()` / `toggleDeafenAndNotify()`: **when not in voice**, apply the same rules the engine applies (PRD 10.4): deafen → also mute, remembering whether it had to (`deafenAutoMuted`); undeafen → restore exactly that; Mute while deafened → undeafen first, then toggle mute. Then `updateVoiceUI()` and play the same sounds as in a room (`mic_muted.mp3`/`mic_activated.mp3`, `sound_muted.mp3`/`sound_resumed.mp3` — an explicit click deserves feedback). No `SET_VOICE_STATE` outside a room. **In a room** nothing changes (they call the engine and send `SET_VOICE_STATE` as today) — but they now also persist the result.
3. **PTT mode** keeps its meaning: `isMuted === true` means "PTT locked". Outside a room the toggle just flips the lock.
4. **Joining with the intended state** — no audio may leak while joining muted:
   - `preload.ts`: `joinVoiceChannel(channelId, initial?: { muted: boolean; deafened: boolean; deafenAutoMuted: boolean })` (also used by `attemptVoiceRejoin()` — keep the last intended state in the preload, updated by a new `api.setIntendedVoiceState(state)` the renderer calls on every change, so a rejoin restores it too).
   - `VoiceService.joinVoiceChannel(channelId, initial)`: when `initial.muted || initial.deafened`, set the processed mic track's `enabled = false` **before** `produce()`, then `producer.pause()` right after `produce()` resolves (mediasoup-client's default `disableTrackOnPause` keeps the track disabled while paused; resume re-enables it). Check the installed mediasoup-client's `ProducerOptions` — if it supports starting paused, prefer that and say so in the progress entry. Set `_isDeafened = initial.deafened` and `_deafenAutoMuted = initial.deafenAutoMuted` before any consumer is created (consumers already read `computeGainForUser()`, which checks `_isDeafened`).
   - Renderer join path (`handleChannelClick()` voice branch): **remove** the two resets; pass the intended state to `api.joinVoiceChannel()`; keep the PTT branch (`api.setMuted(true)` resting state when not locked); then `api.setVoiceState(isMuted, isDeafened)` as today so others see the right icons from the first moment. Self-hear forcing (`applySelfHearMuteDeafenForcing()`) still runs after — check its "only if not already deafened" logic with a pre-deafened join.
   - Leaving, a kick (21.1) or a disconnect must NOT reset the intended state.
5. **Markup and animation.** One card, two states, driven by ONE attribute written ONLY by `setVoiceCardState(state: "in-room" | "idle")` (sets `voicePanel.dataset.voiceState = state`), which `updateVoiceUI()` calls with `isInVoice ? "in-room" : "idle"`. All CSS below selects `#voice-panel[data-voice-state="in-room"]` / `[data-voice-state="idle"]`. `#voice-panel` is visible whenever `body.is-connected` (not only in voice): replace the `voicePanel.classList.add/remove("visible")` calls in `updateVoiceUI()` with a CSS rule `body.is-connected #voice-panel { display: flex; }` and remove the `.visible` toggling (grep for other readers of it first). Keep every existing id (`#btn-mute`, `#btn-deafen`, `#btn-input-devices`, `#btn-output-devices`, `#btn-share-screen`, `#btn-leave-voice`, `#btn-expand-voice`, `#voice-channel-name`, `#voice-dock-latency`).
   - **Background:** register `@property --dock-tint { syntax: "<color>"; inherits: false; initial-value: transparent; }`, give `.voice-dock-card` `background: linear-gradient(180deg, color-mix(in srgb, var(--dock-tint) 8%, var(--color-surface)), var(--color-surface)); transition: --dock-tint 320ms ease, border-color 320ms ease;` with `--dock-tint: var(--color-voice-idle)` (`idle`) / `var(--color-voice)` (`in-room`). The `--color-voice-tint`/`--color-voice-idle-tint` tokens stay for any other user (grep). (`@property` is what makes a gradient colour animatable in Chromium.)
   - **Title block:** `min-height: 28px; display: flex; flex-direction: column; justify-content: center;` (SPEC §1.6) — measure the card's height in both states in the verify step; they must be equal.
   - **Icon and title:** render both icons and both titles, stacked in the same grid cell; cross-fade with `opacity` + a small `transform: scale(0.9)` on the leaving one (200 ms). The texts are in the DOM so screen readers get the right one: the hidden one has `aria-hidden="true"`.
   - **Buttons:** make `#voice-controls` a grid with **`column-gap: 0`** and four cells (mute split, deafen split, share, leave). Every cell except the first has `padding-left: 6px` (that is the 6 px gap). `in-room`: `grid-template-columns: 1.4fr 1.4fr 1fr 1fr`. `idle`: `grid-template-columns: 1fr 1fr 0fr 0fr`, and the share/leave cells get `padding-left: 0; min-width: 0; overflow: hidden;` so they take exactly 0 px. Transition `grid-template-columns` and `padding-left` over 280 ms `cubic-bezier(.2,.8,.2,1)`; the Share and Leave buttons themselves fade/scale (`opacity`, `transform: scale(.9)`) in with a 60 ms delay on joining and out at once on leaving. In `idle` the two cells get the `inert` attribute (set by `setVoiceCardState()`). Check against `17a.png`: the two split buttons fill the row edge to edge with one 6 px gap.
   - **Sub-line and expand button:** collapse with `grid-template-rows: 0fr ↔ 1fr` (sub-line) and fade (expand button); both `inert` in `idle` (set by `setVoiceCardState()`).
   - All transitions inside `@media (prefers-reduced-motion: no-preference)`.
6. **Device carets outside a room** already work through `applyAudioDevice()` / `openAudioDeviceMenu()` — verify they open (placement "above") and change the stored device when not in voice, and that the next join uses it.
7. **Screen-share banner / self-hear banner** keep their current visibility rules (in voice only).
   - **Things that used to key off "the dock is visible"** must now key off "in a room" (`isInVoice`): the update card's in-call restart note (`updateCardVoiceHook`, PRD 19 C12 / frame 15b) and anything else a `grep -n "voicePanel\|voice-panel" renderer.ts` turns up that reads its visibility.
   - **Leaving takes you out of the tree at once** (PENDING_FEATURES P6 D1 step 4): after Leave or a kick, your own occupant row disappears in the same frame the card turns yellow — remove yourself from `currentTree`'s room locally (targeted update) rather than waiting for the next `PRESENCE_UPDATE`. Check it with the server delayed (CDP throttling).
8. **Old servers:** no protocol change.

**Verify:** every line of `TEST_STATES.md` › "Revision 2" for 17a/17b (tick them in that file with a note, as the Phase 20 sweep did); screenshots vs `17a.png` and `17b.png`; the card's height is the same in both states (`getBoundingClientRect().height`); the tree doesn't count or list you while disconnected (SPEC §1.6 — already true); connect → the yellow "Disconnected" card is there at once; mute, deafen, mute-while-deafened, undeafen restores — icons, red states and sounds; quit and relaunch → the same state (D5); join a room muted → others' trees show you muted from the first presence update and **no audio frames are received from you** (bot consumer: no RTP / zero audio level while muted — record how it was measured); join deafened → you hear nobody, a person joining after you is silent too; unmute in the room works; PTT mode: locked/unlocked carries over; the animation both ways (watch at 0.25× with the CDP `Animation.setPlaybackRate`), reduced-motion → instant; kick (21.1) and leave keep the state; reconnecting state still pulses; the DM view; the welcome screen shows no card.

**Commit:** `feat: disconnected voice card and mute/deafen before joining (PRD 21.10)`

---

## P3 — Settings

### 21.11 — Glass category menu in both Settings dialogs

**Item 5.** Design: frames `17c.png` (App settings) and `17d.png` (Server settings), rules in `design_handoff_reson8_ui_overhaul/SPEC.md` **§9**, notes in `PENDING_FEATURES.md` › P6 D2, acceptance in `TEST_STATES.md` › "Revision 2" (17c/17d); the owner's captures `app-planning/glass_app_settings.jpg` / `glass_server_settings.jpg` show the same thing. The left category menu (`.settings-nav`) becomes **purple frosted glass**. The content side, the dialog's size and the nav items themselves are unchanged.

**Today:** `#admin-modal .modal-content.wide.settings-shell` (opaque `--color-surface`, border, radius, `overflow: hidden`) contains `.settings-nav` (248 px, `background: color-mix(in srgb, var(--color-bg) 55%, var(--color-surface))`, right border) and `.settings-main`. Both modes (client/server) use this one nav, so one change covers both (the CODE_MAP "Verify" note is answered: they share it).

**How the glass works (SPEC §9):** the blur needs something behind it, so two soft accent "lights" are painted **on the dialog itself, behind the menu** (not on the app behind the dialog). The dialog's existing `overflow: hidden` clips them.

**Steps (CSS + two decorative elements; tokens in `:root`):**
1. **Tokens** (`:root`, next to the accent scale):
   ```css
   --glass-glow-1: color-mix(in srgb, var(--color-accent) 55%, transparent);
   --glass-glow-2: color-mix(in srgb, var(--color-accent-600) 50%, transparent);
   --glass-fill: linear-gradient(170deg, color-mix(in srgb, var(--color-accent-500) 22%, transparent), color-mix(in srgb, var(--color-accent-800) 30%, transparent));
   --glass-edge-right: color-mix(in srgb, var(--color-accent-300) 22%, transparent);
   --glass-edge-top: color-mix(in srgb, var(--color-text) 8%, transparent);
   ```
2. **The glows** — two empty elements, first children of `.settings-shell` (before `.settings-nav`), `aria-hidden="true"`:
   ```html
   <span class="settings-glow settings-glow-1" aria-hidden="true"></span>
   <span class="settings-glow settings-glow-2" aria-hidden="true"></span>
   ```
   ```css
   #admin-modal .settings-shell { position: relative; }          /* if it isn't already */
   .settings-glow { position: absolute; border-radius: 50%; pointer-events: none; z-index: 0; }
   .settings-glow-1 { left: -60px; top: -80px; width: 340px; height: 340px;
                      background: radial-gradient(closest-side, var(--glass-glow-1), transparent); }
   .settings-glow-2 { left: 120px; bottom: -60px; width: 260px; height: 260px;
                      background: radial-gradient(closest-side, var(--glass-glow-2), transparent); }
   ```
   `pointer-events: none` (SPEC: "they don't intercept clicks"). `.settings-nav` and `.settings-main` get `position: relative; z-index: 1` so they paint above the glows. `.settings-main` keeps its own background so the glow never shows through the content side (give it `background: var(--color-surface)` if it relies on the shell's today). Keep the shell's `background: var(--color-surface)` — the glows sit on it.
3. **The menu:**
   ```css
   .settings-nav {
     background: var(--glass-fill);
     -webkit-backdrop-filter: blur(28px) saturate(150%);
     backdrop-filter: blur(28px) saturate(150%);
     border-right: none;                                 /* the lit edge below replaces it */
     box-shadow: inset -1px 0 0 var(--glass-edge-right), inset 0 1px 0 var(--glass-edge-top);
   }
   ```
4. **Selected and hover rows keep their current styles** (SPEC §9). Labels stay `--color-neutral-*`.
5. **Contrast check (SPEC §9):** measure the 11 px section labels (`.settings-nav-group .section-label`) over the brightest spot (top left, under glow 1). If below 4.5:1, change glow 1 from 55 % to **45 %** — the tint, never the text. Record the measured ratio in the progress entry.
6. Server mode's header (server avatar, name, "Admins only · applies to everyone") and the nav count pills (M4) stay readable — check in 17d's state (Members open).
7. Interplay: modals opened from Settings (identity export/import, ban dialog…) keep their higher `z-index`; the glow elements are inside the shell so they never overlap them. On Linux, 21.5's corner clip still holds with Settings open.
8. Performance: the blur covers one 248 × 740 px column; open/close Settings and scroll Members with 200+ users — no dropped frames in the CDP Performance timeline.

**Verify:** the 17c/17d lines of `TEST_STATES.md` › "Revision 2" (tick them with a note); screenshots of both modes vs `17c.png` and `17d.png`; every nav page still opens by click and keyboard (focus ring visible on the glass); clicking where the glows are (nav items over glow 1, the lower nav area over glow 2) works — nothing intercepts; contrast numbers recorded.

**Commit:** `feat: glass category menu in Settings (PRD 21.11)`

---

## P4 — Streams inside the room tab

**Item 10.** *"Whenever a user starts streaming on a voice room, it should immediately switch the voice room tab to the stream mode (frame `1b.png`) and show the stream 'ready to be watched' with a thumbnail of a frozen frame as a placeholder, with a button to enter the stream in the middle. Clicking it plays the live feed in the room tab. A separate window opens ONLY through 'Pop out'."* Plus D4 (closed tab: nothing until you click), D6 (thumbnail ~2 s after start, then every 2 min), D7 (the sharer sees a "You're live" card), D9 (the LIVE badge opens the room tab on that stream first, then asks "Watch {name}'s stream?").

**How it works (the community practice this follows):** a viewer can't show a frame of a stream it isn't consuming, and consuming a video stream just to grab one frame costs a full-rate consumer per viewer per sharer (and the stage's rule is "never two consumers"). So, like Discord's stream previews, **the sharer's own app takes a small JPEG of its capture and sends it to the server, which relays it to the people in that voice room only, keeping it in memory** (never stored, never in the upload ledger). Viewers show it until they press Watch.

### 21.12 — Stream thumbnails: protocol and server

**Steps:**
1. **shared-types** (`socket-events.ts`):
   ```ts
   // ClientToServerEvents
   /** The sharer's latest frame of its screen share (PRD 21.12): JPEG or WebP bytes, ≤ 128 KB. */
   SET_STREAM_THUMBNAIL: (
       payload: { channelId: string; image: ArrayBuffer | Uint8Array },
       ack: (r: { success: boolean; error?: string }) => void,
   ) => void;
   /** The current thumbnails of a room you are in (sent on entering a room). */
   GET_STREAM_THUMBNAILS: (
       payload: { channelId: string },
       ack: (r: { success: boolean; thumbnails?: IStreamThumbnail[]; error?: string }) => void,
   ) => void;
   // ServerToClientEvents
   STREAM_THUMBNAIL_UPDATED: (payload: IStreamThumbnail) => void;
   STREAM_THUMBNAIL_CLEARED: (payload: { channelId: string; userId: string }) => void;
   ```
   `models.ts`: `export interface IStreamThumbnail { channelId: string; userId: string; mime: "image/jpeg" | "image/webp"; image: ArrayBuffer | Uint8Array; takenAt: string }`. Socket.io carries binary natively (no base64). The server's `maxHttpBufferSize` is Socket.io's default 1 MB — enough; do not raise it.
2. **Access class** (`EVENT_ACCESS`): both client events `"member"`.
3. **Pure rules** — `apps/server/src/services/stream-thumbnail.service.ts` (+ `__tests__/stream-thumbnail.service.test.ts`):
   - `validateThumbnail(buf)`: `sniffImage()` (`services/image-sniff.ts`) must say `jpeg` or `webp` (never trust a declared type), `buf.length ≤ 128 * 1024`, `1 ≤ width ≤ 960`, `1 ≤ height ≤ 960`; returns `{ ok, mime }` or `{ ok: false, error }`.
   - `ThumbnailStore` class: `Map<"<channelId>:<userId>", { mime, image: Buffer, takenAt: Date }>`; `set`, `get`, `listForChannel(channelId)`, `clear(channelId, userId)`, `clearUser(userId)`; and a per-socket throttle `canAccept(socketId, now)` — at most one accepted thumbnail per **20 s** per socket (the client sends at +2 s and then every 120 s; 20 s leaves room for a restart of the share).
   - Tests: wrong magic, PNG refused, oversize bytes, oversize dimensions, throttle window, clear paths.
4. **Handler** — `apps/server/src/handlers/stream-thumbnail.handler.ts`, registered in `index.ts` next to the other handlers:
   - `SET_STREAM_THUMBNAIL`: refuse unless `socket.data.role === "primary"`, `socket.data.currentChannelId === payload.channelId`, and the user's presence says `isSharingScreen` (the sharer only — `presence.getUserPresence(userId)`); validate; throttle; store; `io.to(\`channel:${channelId}\`).emit("STREAM_THUMBNAIL_UPDATED", …)` — **the voice room's members only** (the same audience as the stream; never `server:`/`members:`).
   - `GET_STREAM_THUMBNAILS`: only for a socket whose `currentChannelId === payload.channelId`; answers `listForChannel()`.
   - Log size and dimensions at debug level, never the bytes.
5. **Clearing** — a thumbnail must disappear the moment its share does. Find every place a share ends (`grep -n "setScreenShareState\|leaveChannel(\|screenVideoProducer\|cleanupUserSession\|finalizeDisconnect" apps/server/src`): share stopped (`SET_SCREEN_SHARE_STATE` false, the screen-video producer closing), leaving/kicked from the room (`removeSocketFromChannel`), access loss, final disconnect, channel deleted. At each, `store.clear(channelId, userId)` and emit `STREAM_THUMBNAIL_CLEARED` to `channel:<id>`. Prefer one helper (`clearStreamThumbnail(io, channelId, userId)`) called from those paths over scattered code. Memory is bounded: at most 5 shares per room (`MAX_SCREEN_SHARES_PER_ROOM`) × ~128 KB.
6. `apps/server/AGENTS.md`: a "Stream thumbnails (PRD 21.12)" convention bullet (audience = the room, memory only, sniffed bytes, cleared on every share-ending path).

**Verify:** `npm run test` (new tests pass); a bot that is sharing (`SET_SCREEN_SHARE_STATE true`) sends a real JPEG → a second bot in the room receives `STREAM_THUMBNAIL_UPDATED`, a bot in ANOTHER room and a signed-in bot in no room receive nothing; a non-sharer is refused; PNG/oversize/second-within-20 s refused; `GET_STREAM_THUMBNAILS` from inside/outside the room; stopping the share, leaving, kicking, disconnecting each produce `STREAM_THUMBNAIL_CLEARED` and empty the store; the packet gate refuses both events before sign-in.

**Commit:** `feat: stream thumbnails relayed to the room (PRD 21.12)`

### 21.13 — Stream thumbnails: taking and showing them

**Steps:**
1. **Taking (sharer, `voice.service.ts`):** after the screen-video producer exists (`produceScreenVideoStream()`), start a thumbnail loop owned by the service: first capture 2 s after the track's first frame (wait for the track to be unmuted / a `requestVideoFrameCallback` on a hidden `<video>`), then every **120 s**, stopped in `stopScreenVideoProducing()` and `cleanup()`.
   - Grab a frame: `new ImageCapture(track).grabFrame()` (Chromium); if it throws (some portal tracks), fall back to drawing a hidden, muted `<video>` playing the same `MediaStream` into a canvas.
   - Scale to **480 px wide** (keep aspect; ≤ 480 × 480 for a portrait window) on an `OffscreenCanvas`, `convertToBlob({ type: "image/jpeg", quality: 0.72 })`; if > 120 KB, retry at quality 0.5, then at 320 px; give up silently if still too big.
   - Hand the bytes to the preload: add `setStreamThumbnail(channelId: string, image: ArrayBuffer): Promise<void>` to the `VoiceSignaling` interface (`voice.service.ts`) and implement it in `createSignaling()` (`preload.ts`) as `socket.emit("SET_STREAM_THUMBNAIL", { channelId, image }, ack)` with a 5 s timeout; failures are ignored and never retried (an older server simply never acks).
   - Never send while the share is paused/stopped; never more often than the timer.
2. **Receiving (preload):** keep `Map<userId, { channelId, url, takenAt }>`; on `STREAM_THUMBNAIL_UPDATED` make a `blob:` URL from the bytes with the sniffed `mime` (`URL.createObjectURL(new Blob([bytes], { type: mime }))`), **revoke the previous URL** for that user, emit `"stream-thumbnail"` `{ channelId, userId, url, takenAt }`; on `STREAM_THUMBNAIL_CLEARED`, revoke and emit `{ …, url: null }`. When you join a room (after the voice handshake) call `GET_STREAM_THUMBNAILS` (5 s timeout → none) and emit each. Leaving the room revokes all. The renderer CSP already allows `img-src blob:`.
3. **Renderer:** `streamThumbnails = new Map<userId, string>()` fed by `api.on("stream-thumbnail")`; `streamThumbnailUrl(userId): string | null`. Use it in:
   - the **"Also live" cards** (`renderStageSide()`): the card's background becomes the thumbnail (`<img>` with `object-fit: cover`, `alt=""`), keeping the LIVE tag and name; without one, today's static look;
   - the **ready stage** (21.14);
   - update in place (keyed by user id) — never rebuild a card for a new thumbnail.
4. **Old pieces:** a sharer on an older client sends nothing → placeholders; an older server never sends → placeholders. Nothing breaks.

**Verify:** two real clients on this machine (screen capture works on KDE through the portal — if this machine delivers no frames, see the Phase 19 note and mark "owner to verify"): the viewer sees a thumbnail ~2–3 s after the share starts and a new one 2 min later (blob URL replaced, the old one revoked — check `performance`/memory isn't growing); the Also live card shows it; stop sharing → gone at once; a Wayland portal share (KDE) produces thumbnails too; sizes logged ≤ 128 KB.

**Commit:** `feat: take and show stream thumbnails (PRD 21.13)`

### 21.14 — The room tab switches to stream mode by itself

**Today:** the stage state machine (`renderer.ts`, "In-app stream stage (PRD 19 C10)"): `type StageState = "idle" | "starting" | "stage" | "popping" | "popped" | "returning" | "grid"`, `stageTarget`, `startStageWatch()`, `stopStageWatch()`, `popOutStage()`, `returnToStage()`, `renderStage()`, `renderStageSide()`, `syncStreamGrid()`, `layoutVoiceTiles()` (people become a strip while `stageState !== "idle"`); `renderVoiceRoom()` stops the stage when the target stops sharing; the tree's LIVE badge (`renderOccupants()`, and the tile badge in the room) opens `watchShareConfirmModal` whose confirm calls `startStageWatch()`. **Read the root/client `AGENTS.md` "Stream stage and Viewer" and "Several streams" bullets before touching it: one pipeline, one state machine, never two consumers, every teardown ends in `stopStageWatch()`.**

**New states (no consumer in either):**
- `"ready"` — `stageTarget` set, the stage shows the target's thumbnail (or a placeholder: the sharer's 64 px avatar on a dark gradient) blurred-free, a centred **Watch stream** button (`btn btn-primary`, `ph-play` icon), the title "{name} is sharing · {stream name}" and the LIVE tag. Pop out and Fullscreen are **not** offered in ready (Pop out exists only while watching — the owner's rule).
- `"self"` — you are the sharer: the stage shows **your own capture**, attached locally (step 4), "You're sharing · {stream name}", a **Stop sharing** button; no Pop out, no Watch.

**Steps:**
1. Add `"ready" | "self"` to `StageState`. **Audit every use of `stageState`** (`grep -n "stageState" renderer.ts`) and decide per use whether ready/self behave like idle (e.g. `stopStageWatch()`'s early return must also handle them: no consumer to stop, just reset) or like a stage (e.g. `layoutVoiceTiles()`'s people strip, `renderStage()`'s `has-stream`). Write the classification as a comment above the type. `renderVoiceRoom()`'s "the sharer stopped" check covers ready/self too, but for ready it **moves to the next sharer** (if any) silently instead of the "The stream ended" toast.
2. **Choosing what the stage shows — one function** `syncStageWithRoom()`, called from `renderVoiceRoom()` (presence changes) and `openVoiceTab()`:
   - if `stageState` is a watching state (`starting/stage/popping/popped/returning/grid`) → leave it alone (a new sharer just becomes an Also live card / a grid cell, as today);
   - else if someone else is sharing → `ready` on the **most recent** sharer (track start order from presence: `previousSharingIds` diffing already detects new sharers — record a start timestamp per sharer id);
   - else if you are sharing → `self`;
   - else → `idle`.
   It only runs while the room tab **exists**; with the tab closed nothing happens (D4) and nothing opens the tab automatically.
3. **Watch:** the ready stage's button calls `startStageWatch(stageTarget)` (unchanged function: it already opens the tab, sets `starting`, waits for the watch, sets `stage`). Clicking an Also live card while in ready changes the ready target (no watch); while watching it switches the watch (today's behaviour).
4. **Your own capture ("self"):** the `MediaStream` is `VoiceService`'s **private** `screenVideoStream`; add a read-only getter `get localScreenStream(): MediaStream | null` to `VoiceService` (do not make the field public). Add `api.stage.showOwnPreview(containerId: string | null)`: the preload creates (or reuses) a muted `<video playsinline autoplay>` inside the container and sets `srcObject` to the local stream (`null` → removes it). No socket, no consumer, no server traffic. The renderer calls it when entering/leaving `self` and from `stopStageWatch()`'s reset.
5. **Entry points:**
   - **Tree LIVE badge and the room tile's LIVE badge (D9):** the order changes, the dialog stays. Today the click sets `pendingWatchShare` and opens `watchShareConfirmModal` first; its confirm then calls `startStageWatch()`, which opens the tab. New order, in one function `enterStreamFromBadge({ userId, nickname, channelId })` used by both badges:
     1. Not in that voice room → today's toast ("Join the voice channel to watch its stream."), stop.
     2. Already watching that sharer (`stage`/`popped`/`grid` with them) → just `openVoiceTab({ focus: true })`, no dialog.
     3. Otherwise `openVoiceTab({ focus: true })`, put the stage in `ready` on that sharer (switching away from another ready target; if you are watching someone else, leave that watch running until the user confirms), then open `watchShareConfirmModal` (same text "Watch {name}'s stream?", same buttons) **on top of the focused room tab**.
     4. Confirm → `startStageWatch(target)` (it stops any other watch first, as today). Cancel / Escape / backdrop → the dialog closes and the stage stays `ready` on that sharer.
     Keep `pendingWatchShare` and the modal's markup and handlers; only the confirm handler's body and the two badge click handlers change. If the sharer stops while the dialog is open, close the dialog and let `syncStageWithRoom()` decide (no watch starts).
   - **Opening the room tab** any other way (dock expand, clicking your room in the tree, the call bar) → `syncStageWithRoom()` → `ready`/`self`/`idle`.
   - **Pop out** stays exactly as today, offered only in `stage`.
6. **Teardown paths** unchanged and now also cover ready/self: leaving voice, a kick, access loss, a deleted room, closing the tab — all end in `stopStageWatch()`, which resets ready/self and calls `api.stage.showOwnPreview(null)`.
7. **Layout:** ready/self use the same stage box as watching (16:9 region, people strip below, Focus/Grid toggle from 2 sharers). Grid stays "watch everyone" (it starts consumers, as today) — choosing Grid from ready is allowed.
8. `apps/client/AGENTS.md`: update the stage bullets (the two new states, `syncStageWithRoom()`, thumbnails, `enterStreamFromBadge()` and its badge → tab → dialog order, D9).

**Verify (CDP + bots, then the owner by hand):**
- Room tab open on a chat-free view, bot B starts sharing → the tab switches to stream mode within one presence update: B's thumbnail (or the avatar placeholder until it arrives), "B is sharing", Watch button; no consumer exists (`api.stage.isWatching() === false`, server log shows no CONSUME).
- Watch → live feed; Pop out → Viewer window; Bring back → stage; Fullscreen.
- Room tab closed, B starts sharing → **no tab opens** (D4); click B's LIVE badge → the tab opens, focused, on B's ready stage, and only THEN "Watch B's stream?" appears (D9); Confirm → live; Cancel → ready stage stays; B stops while the dialog is open → the dialog closes, nothing starts.
- Two sharers: ready on the newest, the other is an Also live card with its thumbnail; clicking it moves ready; Grid starts both watches.
- You share → `self`: your own capture plays locally, no CONSUME on the server; Stop sharing ends it and the stage goes to ready (if someone else shares) or idle.
- B stops while you are in ready on B → next sharer or idle, no toast; while watching B → today's "The stream ended".
- Leave voice / kicked / access loss / room deleted in each state → idle, no leftover Viewer window, no consumer.
- A beta.4 server (no thumbnails): ready shows the avatar placeholder; everything else works.

**Commit:** `feat: room tab switches to a ready-to-watch stream (PRD 21.14)`

---

## 21.15 — Release 3.0.0-beta.5 and documentation

Only after **every** item above is committed and the owner approved the last one.

1. `/bump-version 3.0.0-beta.5` (`.claude/commands/bump-version.md`): every version reference, `app-planning/releases/v3.0.0-beta.5.md` in the established beta format (warning box, then New Features & Improvements, Bug Fixes, Known issues — include the Linux right-click title-bar menu loss from 21.6 and anything left "owner to verify"; compatibility note: avatars in the tree and stream thumbnails need the matching server; an older server keeps working without them).
2. Update `README.md` (the 3.0 beta feature list: voice card states and pre-join mute/deafen, tree avatars, stream thumbnails and ready-to-watch, glass Settings, Linux window buttons; the roadmap row for Phase 21), the root `AGENTS.md` (history paragraph: Phase 21 PRD, progress entries at the end of `progress.txt`) and `apps/client/AGENTS.md` / `apps/server/AGENTS.md` for anything an item didn't already add. Edit `AGENTS.md` files only — the `CLAUDE.md` stubs import them.
3. Run every suite once more (shared-types build, server `tsc` + tests, client `tsc` + all `test:*` scripts, `npm run lint`).
4. Log it with `/log-progress`, commit (`chore: bump version to 3.0.0-beta.5`, plus a `docs:` commit if the doc updates are separate), **do not push** — the owner pushes the branch.

---

## Order and dependencies

| Order | Item | Depends on | Touches the server |
|---|---|---|---|
| 1 | 21.1 Kick | — | no |
| 2 | 21.2 Text wrap | — | no |
| 3 | 21.3 Reply corners | — | no |
| 4 | 21.4 Viewer fit | — | no |
| 5 | 21.5 Linux backdrop corners | — | no |
| 6 | 21.6 Linux window buttons | 21.5 (corner clip) | no |
| 7 | 21.7 Voice card out of the tree | — | no |
| 8 | 21.8 Tree spacing and icons | 21.7 | no |
| 9 | 21.9 Tree avatars + ring | 21.8 | **yes** (presence `avatarUrl`) |
| 10 | 21.10 Disconnected card | 21.7, 21.1 (the shared teardown) | no |
| 11 | 21.11 Glass Settings | — | no |
| 12 | 21.12 Thumbnails: server | — | **yes** |
| 13 | 21.13 Thumbnails: client | 21.12 | no |
| 14 | 21.14 Stream mode | 21.13 | no |
| 15 | 21.15 Release | all | — |

One item at a time, each committed and approved by the owner before the next (H.5). Every beta-relevant item must keep the client working against a **3.0.0-beta.4** and a **2.7.0** server — check once at 21.9 and 21.14.

---

## Appendix A — Values taken from the reference images and the design study

Values marked *(study)* are copied from `Reson8 App.dc.html` (revision 2) or `SPEC.md`; *(image)* are measured on the owner's reference images and are starting points to tune by eye. SPEC.md wins on any conflict (D8).

**Left column** *(study)*: column 264–280 px (keep 280 / min 220); the two cards 10 px apart (frames 17a/17b); tree card radius `--radius-lg`, background `linear-gradient(180deg, var(--color-surface), color-mix(in srgb, var(--color-surface) 55%, var(--color-bg)))`, `box-shadow: var(--shadow-sm)`.

**Tree** *(study)*: list padding `6px 8px 10px`; category: margin-top 8 px, height 26, padding `0 6px`, gap 6, radius sm, 11 px / 600, letter-spacing 0.08em, uppercase, `--color-neutral-500` (hover `--color-neutral-300`), caret 10 px; Category tag 9.5 px / 500, letter-spacing 0.04em, line-height 16 px, padding `0 6px`, radius sm, `box-shadow: inset 0 0 0 1px var(--color-neutral-800)`. Channel row: height 30, padding `0 8px`, gap 9, radius md, 14 px; colours: idle `--color-neutral-300`, unread `--color-neutral-100` + 600, muted `--color-neutral-500` + opacity 0.5, viewed `--color-neutral-100` + 600 on `color-mix(in srgb, var(--color-accent) 14%, transparent)`; viewed bar: left −8 px, top/bottom 7 px, 3 px wide, radius `0 3px 3px 0`, `--color-accent`, glow `0 0 10px var(--color-accent)`. Icons: box 18 px; Phosphor 17 px; emoji 14.5 px; image/initials 18 × 18, radius sm, initials 7.5 px / 700, letter-spacing −0.02em, colours `oklch(0.42 0.08 h)` / `oklch(0.92 0.05 h)`. Voice icon colour: `--color-neutral-500`; in the room `--color-voice`; viewed `--color-accent`. NSFW tag 10 px, padding `1px 6px`, radius sm, letter-spacing 0.04em. Unread pill min-width 18, height 18, padding `0 5px`, radius 9, `--color-accent-800` / `--color-accent-200`, 11 px / 600. Timer `500 11px ui-monospace`, `--color-neutral-500`. Count pill height 18, padding `0 6px`, radius 9, `color-mix(in srgb, var(--color-text) 6%, transparent)`, 11 px / 500, `--color-neutral-300`, icon 11 px `--color-neutral-500`.

**Occupant** *(study)*: height 26, padding `0 8px 0 34px`, gap 8, 13 px, `--color-neutral-400`, radius md, hover `color-mix(in srgb, var(--color-text) 5%, transparent)`; avatar 20 px round, initials 9 px / 600; speaking ring `0 0 0 2px <green>, 0 0 8px <green>` (we soften the glow to 55 %) and name `--color-neutral-100`; local volume `500 11px ui-monospace` `--color-neutral-500`; icons 13 px.

**Voice card** *(study rev 2, SPEC §1.6)*: radius `--radius-lg`, padding `10px 12px`, gap 10, `box-shadow: var(--shadow-sm)`; head gap 10, signal 16 px; title block `min-height: 28px`, title 13 px / 600; sub 11.5 px `--color-neutral-500`; buttons 32 px high, split buttons `flex: 1.4`, caret 20 px wide, gap 6; background `linear-gradient(180deg, color-mix(in srgb, <tint> 8%, var(--color-surface)), var(--color-surface))`; connected tint/icon `oklch(0.78 0.14 155)`, title `oklch(0.8 0.13 155)`; disconnected tint/icon `oklch(0.75 0.16 65)`, title `oklch(0.8 0.15 75)`, icon `ph-fill ph-cell-signal-slash`, title "Disconnected", no sub-line, no Expand, no Share, no Leave.

**Glass Settings** *(study rev 2, SPEC §9)*: nav 248 px; glow 1 — 340 px circle at left −60 / top −80, `radial-gradient(closest-side, color-mix(in srgb, var(--color-accent) 55%, transparent), transparent)` (45 % if the labels fail 4.5:1); glow 2 — 260 px circle at left 120 / bottom −60, the same with `--color-accent-600` at 50 %; menu fill `linear-gradient(170deg, color-mix(in srgb, var(--color-accent-500) 22%, transparent), color-mix(in srgb, var(--color-accent-800) 30%, transparent))`; `backdrop-filter: blur(28px) saturate(150%)`; edges `inset -1px 0 0 color-mix(in srgb, var(--color-accent-300) 22%, transparent), inset 0 1px 0 color-mix(in srgb, var(--color-text) 8%, transparent)`; selected/hover rows unchanged; the dialog backdrop in the study is `color-mix(in srgb, var(--color-bg) 65%, transparent)` (unchanged from revision 1 — keep today's).

**Image viewer**: controls `top: calc(var(--titlebar-h) + 8px)`, 8 px clearance below them (21.4).

## Appendix B — Research notes

- **Linux window-controls overlay.** Electron added the Window Controls Overlay on Linux in 30.2 ([electron/electron#41769](https://github.com/electron/electron/pull/41769)); `titleBarOverlay.symbolColor` is documented as supported there ([#46535](https://github.com/electron/electron/pull/46535)). Transparent overlay colours have a history of breaking (Windows hover: [#38431](https://github.com/electron/electron/issues/38431), [#48193](https://github.com/electron/electron/issues/48193)), and the owner's KDE captures show Electron 34 painting an opaque strip. Electron 44 re-themed the Linux buttons (Breeze-sized) ([microsoft/vscode#337058](https://github.com/microsoft/vscode/issues/337058)) — an Electron upgrade was rejected (D1) as too risky for this phase. VS Code's "custom" title bar on Linux and the official [Custom Title Bar tutorial](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar) document the frameless + HTML controls approach chosen here.
- **Clipping fixed descendants.** `overflow` never clips `position: fixed` boxes (their containing block is the viewport); `clip-path` is a graphical effect applied to the element and everything it paints, fixed descendants included, without changing any containing block.
- **Animating a gradient colour.** Gradients are not interpolable, but a registered custom property (`@property` with `syntax: "<color>"`) used inside the gradient is, in Chromium.
- **Wrapping.** `overflow-wrap: anywhere` is the only `overflow-wrap` value that lowers an element's min-content size, so it is the one that works inside flex/grid items; `break-word` does not.
- **Stream previews.** Discord's "Go Live" previews are images uploaded by the streamer at an interval, not frames decoded by each viewer — the approach of 21.12/21.13.
