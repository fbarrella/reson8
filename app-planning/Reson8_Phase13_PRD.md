# Reson8 — Phase 13 PRD

**Created:** 29/08/2026
**Author:** Felipe B. Netto (assisted by AI)
**Status:** Draft — Pending Review
**Source:** `app-planning/nextsteps.txt`
**Branch:** `phase13-go`

---

## Table of Contents

1. [PRD 13.1 — Microphone Noise Cancelling (DeepFilterNet/WASM)](#prd-131--microphone-noise-cancelling-deepfilternetwasm)
2. [PRD 13.2 — Fix Choppy Noise Gate (Attack/Hold/Release Envelope)](#prd-132--fix-choppy-noise-gate-attackholdrelease-envelope)
3. [PRD 13.3 — Microphone Volume Slider (0–200%)](#prd-133--microphone-volume-slider-0200)
4. [PRD 13.4 — Close Button on Full-Screen Image Viewer](#prd-134--close-button-on-full-screen-image-viewer)
5. [PRD 13.5 — Blur NSFW Channel Image Thumbnails](#prd-135--blur-nsfw-channel-image-thumbnails)
6. [PRD 13.6 — Date/Day Sectioning in Text Chat](#prd-136--dateday-sectioning-in-text-chat)
7. [PRD 13.7 — Enlarge Custom-Emoji Tab Icon](#prd-137--enlarge-custom-emoji-tab-icon)
8. [PRD 13.8 — Reposition & Restyle "See More" Button](#prd-138--reposition--restyle-see-more-button)
9. [PRD 13.9 — Pointer Cursor on Voice Channel Nicknames](#prd-139--pointer-cursor-on-voice-channel-nicknames)
10. [PRD 13.10 — Faster Active-Speaker Indicator](#prd-1310--faster-active-speaker-indicator)
11. [PRD 13.11 — Fix Participant Count Contrast](#prd-1311--fix-participant-count-contrast)
12. [PRD 13.12 — Replace "Leave Voice" Icon (X → Hang-Up Phone)](#prd-1312--replace-leave-voice-icon-x--hang-up-phone)
13. [PRD 13.13 — Animated Custom Emoji (GIF Upload)](#prd-1313--animated-custom-emoji-gif-upload)
14. [PRD 13.14 — Bigger Rendering for Solo-Emoji Messages](#prd-1314--bigger-rendering-for-solo-emoji-messages)
15. [PRD 13.15 — Fix Voice-Connected-But-Offline Presence Bug](#prd-1315--fix-voice-connected-but-offline-presence-bug)
16. [PRD 13.16 — Screen-Share Sound Alerts](#prd-1316--screen-share-sound-alerts)
17. [PRD 13.17 — Move Ban to "User Management" Tab](#prd-1317--move-ban-to-user-management-tab)
18. [PRD 13.18 — Single-Instance Electron Lock](#prd-1318--single-instance-electron-lock)
19. [Cross-Cutting Dependencies & Recommended Implementation Order](#cross-cutting-dependencies--recommended-implementation-order)
20. [Open Decisions Confirmed With the User](#open-decisions-confirmed-with-the-user)

> [!IMPORTANT]
> Every implementation must be tracked and logged into `app-planning/progress.txt`
> using the `/log-progress` slash command immediately after the item is completed
> and verified, following the established `--- Entry: DD/MM/YYYY ---` format. After
> each item: stage the code and commit locally (no push — the user pushes
> manually), then **stop and wait for explicit confirmation** before starting the
> next item. Complex UI/UX testing is done by hand by the user, not by Claude.
>
> Only after every item below is implemented and confirmed: run `/bump-version`
> to bump the app version (SemVer — this phase is feature-additive and backward
> compatible, so a **minor** bump is expected pending the skill's own check),
> write the release notes into `app-planning/releases/`, and update all three
> `CLAUDE.md` files plus `README.md` to reflect the final Phase 13 feature set.

> [!NOTE]
> This PRD was written after three parallel research passes over the voice
> engine (`voice.service.ts`, mediasoup config), the client UI/chat rendering
> (`renderer.ts`, `index.html`), and the emoji/presence/admin subsystems
> (Prisma schema, `presence.service.ts`, `connection.handler.ts`,
> `admin.handler.ts`, `main.ts`) — not from a clean-slate reading of the
> roadmap text alone. File paths and line numbers below reflect the code as of
> 29/08/2026 (branch `phase13-go`, post-Phase-12) — re-check them if the
> surrounding code has moved by the time an item is implemented. Four points
> were genuinely ambiguous in the raw request text; they were resolved with
> the user up front and are recorded in the [Open Decisions](#open-decisions-confirmed-with-the-user)
> section rather than left as in-flight guesses.

---

## PRD 13.1 — Microphone Noise Cancelling (DeepFilterNet/WASM)

**Type:** ✨ FEATURE
**Priority:** Medium (highest complexity item in this phase — see recommended
order below; do not start with this one)
**Affected Components:** Client only — `voice.service.ts`, `index.html`
(Voice & Shortcuts settings tab), `package.json` (electron-builder `files`/
`asarUnpack`), a new vendored WASM+worklet bundle.

### Overview

Add an AI noise-suppression toggle to the Voice & Shortcuts settings tab that
runs a WASM build of DeepFilterNet inside an `AudioWorklet`, processing the
microphone stream in real time before it reaches the mediasoup producer.

### Current State (confirmed via audit)

- `voice.service.ts`'s `startProducing()` currently feeds the **raw**
  `getUserMedia()` track directly into `sendTransport.produce({ track })` —
  there is no Web Audio graph on the send path at all today. The only
  existing `AudioContext` usage is on the **receive** side (per-user volume,
  gain nodes on remote streams) and an **analysis-only** tap for the mic
  sensitivity meter (`hookAnalyser`), which reads a **cloned** raw track
  specifically so the meter still shows raw signal even while the gate
  disables the live track.
- There is no `AudioWorklet` or WASM usage anywhere in the client today.
- Electron 34 / Chromium ~132 fully supports `AudioWorklet` + streaming WASM
  instantiation — no version blocker.
- No official DeepFilterNet WASM build exists; per the decision recorded
  below, this item vendors a third-party npm package (evaluate
  `deepfilternet3-noise-filter`, `deepfilternet3-workers`, and the
  `boredland/noise` reference implementation; pick whichever has the
  smallest bundle size and the clearest license for a self-hosted app, pin
  an exact version).

### Design Decisions

- **This item builds on top of the send-side audio graph established by
  PRD 13.2 and 13.3** (see [Cross-Cutting](#cross-cutting-dependencies--recommended-implementation-order) —
  implement 13.2 and 13.3 first). By the time this item starts, the graph
  already looks like:
  `MediaStreamSource → GateGainNode (13.2) → VolumeGainNode (13.3) → MediaStreamAudioDestinationNode → produce()`.
  This item inserts the `AudioWorkletNode` as the **first** stage:
  `MediaStreamSource → AudioWorkletNode (noise cancel) → GateGainNode → VolumeGainNode → MediaStreamAudioDestinationNode → produce()`.
  Denoise-before-gate ordering matters: the gate's RMS/dB read should react
  to the cleaned signal, not raw noise, or the threshold becomes harder to
  reason about.
- **Toggle placement:** Voice & Shortcuts tab, next to the Noise Gate
  section (per the confirmed decision below), persisted to `localStorage`
  under the existing `reson8-*` key convention (e.g.
  `reson8-noise-cancel-enabled`).
- **No graph teardown on toggle.** Per the request, flipping the switch
  must never tear down the audio graph or the mediasoup connection. The
  worklet's `process()` reads a boolean state kept in sync via
  `port.postMessage({ enabled })`; when disabled, `process()` copies input
  buffers straight to output (passthrough) instead of running WASM
  inference, releasing CPU immediately.
- **Analyser re-routing:** the mic sensitivity meter's `AnalyserNode` must be
  re-routed to tap the graph **strictly after the `AudioWorkletNode`**
  (before the gate/volume gains), per the explicit instruction in the
  request — the meter should reflect denoised, not raw, signal. This
  replaces the current "clone the raw track" approach entirely; the
  analyser becomes a graph tap (`workletNode.connect(analyserNode)` as a
  parallel branch) rather than a separate cloned-track pipeline.
- **Packaging:** the `.wasm` binary and worklet processor `.js` go through
  the same `asarUnpack` pattern the project already uses for the native
  screen-share audio module (`apps/client/package.json`'s existing
  `.release-vendor/native-audio/prebuilds/**/*.node` entry) — binaries that
  must be read from real disk paths, not asar-transparent `fs`, need an
  explicit `build.files`/`build.asarUnpack` entry or they silently vanish
  from packaged builds (a documented Electron gotcha for this project).

### Files to Modify

- `apps/client/src/services/voice.service.ts` — build/extend the send-side
  Web Audio graph, instantiate the `AudioContext`/`AudioWorkletNode`, load
  the WASM module, re-route the analyser tap.
- `apps/client/src/renderer/index.html` — new toggle UI in Voice & Shortcuts
  tab.
- `apps/client/src/renderer/renderer.ts` — toggle wiring, `localStorage`
  persistence, `postMessage` calls to the worklet.
- `apps/client/package.json` — new dependency, `build.files`/
  `build.asarUnpack` entries for the `.wasm`/worklet assets.
- New vendored asset files (exact paths depend on the chosen npm package).

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): toggle on/off mid-call with no audio dropout or
  reconnect; confirm background noise (keyboard clicks, fan) is
  audibly suppressed while speech stays clear; confirm the mic sensitivity
  meter still responds correctly with the toggle on; confirm CPU usage
  drops back down when toggled off; confirm a packaged build (not just
  `npm run dev`) still finds the `.wasm` file.

---

## PRD 13.2 — Fix Choppy Noise Gate (Attack/Hold/Release Envelope)

**Type:** 🐛 FIX
**Priority:** High
**Affected Components:** Client only — `voice.service.ts`.

### Root Cause (confirmed via audit)

`hookAnalyser()` runs a `setInterval` every 50ms that computes an RMS→dB
value from the mic signal and does a **hard binary toggle**:
`track.enabled = dB > threshold`. There is no attack/hold/release envelope —
the instant the signal dips below the threshold mid-word (very common with
natural speech variance), the track is disabled immediately, producing the
reported abrupt cuts. The dB meter and the gate compare the exact same
computed value, so the slider itself is not misrepresenting anything — the
only problem is the missing envelope.

### Fix

Replace the boolean `track.enabled` toggle with a real gain-envelope gate:

1. Insert a `GateGainNode` into the send-side Web Audio graph (this is the
   **first** node built for this phase — see
   [Cross-Cutting](#cross-cutting-dependencies--recommended-implementation-order),
   since a `track.enabled` boolean can never fade, only snap, so a real
   `GainNode` is required to satisfy "fade off" at all).
2. On each 50ms check: if the signal is above threshold, ramp the gate gain
   to `1.0` quickly (e.g. `linearRampToValueAtTime` over ~15ms — fast enough
   to feel instant, slow enough to avoid a click).
3. If the signal drops below threshold, start a **hold** timer (~300–400ms)
   during which the gain stays at `1.0` (natural pauses between words/
   syllables shouldn't trigger a cut). Only after the hold period elapses
   with the signal still below threshold does the gate begin a **release**
   ramp (e.g. `linearRampToValueAtTime` down to a near-zero floor over
   ~150–250ms), instead of an instant cut.
4. Cancel any in-flight release ramp immediately if the signal crosses back
   above threshold before it completes (re-ramp up from wherever the gain
   currently sits, not from zero) — this avoids "stuttery" re-triggering.
5. `getCurrentLevel()` (used to drive the settings-panel meter) is
   unaffected — it keeps reading the same RMS/dB computation.

### Files to Modify

- `apps/client/src/services/voice.service.ts` — `hookAnalyser()` /
  `startProducing()`, replacing `track.enabled` with the new `GateGainNode`
  and scheduling logic.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): speak with natural pauses at a level near the threshold
  and confirm no abrupt mid-word cuts; confirm background noise below
  threshold is still fully suppressed after the release ramp completes.

---

## PRD 13.3 — Microphone Volume Slider (0–200%)

**Type:** ✨ FEATURE
**Priority:** High
**Affected Components:** Client only — `voice.service.ts`, `index.html`
(Voice & Shortcuts settings tab).

### Overview

Add a mic input volume slider (0–200%, default 100%) that actually scales
the outgoing produced track — not a "placebo" control. The project already
has one real precedent for a placebo-slider bug: the per-user **remote**
volume slider originally didn't audibly change anything because
`createMediaElementSource` wasn't reliably capturing an unmuted `<audio>`
element's output in this Electron build; it was fixed by tapping the stream
directly via `createMediaStreamSource` (see `progress.txt`). That fix is on
the playback side and not directly reusable code, but it's a reminder to
verify — by ear, not just by reading the graph — that gain actually reaches
the produced track before calling this done.

### Design Decisions

- Insert a `VolumeGainNode` (range 0.0–2.0) into the send-side graph, right
  after the `GateGainNode` from PRD 13.2:
  `MediaStreamSource → GateGainNode → VolumeGainNode → MediaStreamAudioDestinationNode → produce()`.
  The produced track becomes `destinationNode.stream.getAudioTracks()[0]`
  instead of the raw `getUserMedia` track.
- UI: a slider in the Voice & Shortcuts tab (per the confirmed decision
  below), consistent with the existing Noise Gate / mic sensitivity
  section's styling, persisted to `localStorage`
  (`reson8-mic-volume`), applied live (no re-produce needed — just update
  `gainNode.gain.value`).
- Since this is the item that first turns "raw track → produce()" into
  "processed graph → produce()", it's the natural point to introduce the
  `MediaStreamAudioDestinationNode` plumbing that PRD 13.1 will extend
  further — see the recommended order below for why this goes before 13.1.

### Files to Modify

- `apps/client/src/services/voice.service.ts` — graph wiring, gain node,
  public method to update volume live.
- `apps/client/src/renderer/index.html` / `renderer.ts` — new slider UI,
  persistence.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): confirm 0% is actually silent to other participants,
  100% matches current baseline volume, 200% is audibly louder — verified
  from a **second client**, not just locally, exactly like the per-user
  volume slider regression this is meant to avoid repeating.

---

## PRD 13.4 — Close Button on Full-Screen Image Viewer

**Type:** 🐛 FIX
**Priority:** Low
**Affected Components:** Client only — `index.html`, `renderer.ts`.

### Root Cause

The lightbox modal (`index.html:3326-3329`) only has `#lightbox-image` and
`#btn-lightbox-download`. The download button is styled at
`index.html:1206-1229` (`position:fixed; top:16px; right:16px` — note: the
request describes it as top-left, but it's actually top-right; not a
blocker). The only ways to close today are a background-click listener
(`renderer.ts:4318-4323`) and Escape (`renderer.ts:4336-4339`) — no visible
close affordance.

### Fix

Add a `#btn-lightbox-close` button, red-styled, positioned as a sibling to
the download button (e.g. top-left, mirroring the download button's
top-right placement) so both are visible together. Wire it to the same
close function the background-click/Escape handlers already call.

### Files to Modify

- `apps/client/src/renderer/index.html` — new button markup + CSS.
- `apps/client/src/renderer/renderer.ts` — click handler.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): confirm both the new button and the existing
  background-click/Escape paths all close the viewer.

---

## PRD 13.5 — Blur NSFW Channel Image Thumbnails

**Type:** ✨ FEATURE
**Priority:** Medium
**Affected Components:** Client only — `renderer.ts`, `index.html`.
(No server/schema changes — `isNsfw` already exists.)

### Current State (confirmed via audit)

`isNsfw` is already a real channel-level boolean in
`apps/server/prisma/schema.prisma:60`, in shared-types
(`packages/shared-types/src/models.ts:65`), and already wired through the
channel rename/create/toggle UI — **text channels only**, by existing
design. Image thumbnails render in two places: `renderChatMessage`
(`renderer.ts:3179-3187`, channel messages) and `renderDmMessage`
(`renderer.ts:3376-3384`, DMs — DMs have no channel/NSFW concept and are
out of scope for this item). `ChatTab` (`renderer.ts:1227-1237`) does not
currently carry `isNsfw` on the tab object itself; it must be resolved via
the existing `findChannelNodeById(currentTree, tab.channelId)` helper
(`renderer.ts:1331`) at render time. There is no "seen/opened" state
tracked anywhere for attachments, which confirms the request's expectation
that images stay blurred in the chat feed **permanently** — unblurring only
ever happens inside the full-screen lightbox.

### Design Decisions

- When rendering an image attachment inside `renderChatMessage`, resolve the
  owning channel's `isNsfw` flag and, if true, apply a `.nsfw-blurred`
  modifier class to the thumbnail (CSS `filter: blur(...)`) plus an overlay
  containing an eye SVG icon and the text "NSFW. Click to open image and
  reveal content."
- Clicking the blurred thumbnail still opens the existing full-screen
  lightbox (PRD 13.4's close button applies there too) at full clarity —
  the lightbox never blurs. Closing the lightbox returns to the chat feed
  where the thumbnail is still blurred, per the confirmed permanent-blur
  behavior.
- This only touches the thumbnail's presentation layer — no change to
  upload, storage, or the underlying `<img>` src.

### Files to Modify

- `apps/client/src/renderer/renderer.ts` — `renderChatMessage`'s attachment
  rendering path, resolving `isNsfw` via `findChannelNodeById`.
- `apps/client/src/renderer/index.html` — `.nsfw-blurred` CSS + overlay
  markup/icon.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): post an image in an NSFW-flagged channel and confirm it
  renders blurred with the overlay; click through to the lightbox and
  confirm full clarity there; close the lightbox and confirm the thumbnail
  is still blurred; confirm a non-NSFW channel's images are unaffected.

---

## PRD 13.6 — Date/Day Sectioning in Text Chat

**Type:** ✨ FEATURE (chore-flavored)
**Priority:** Medium
**Affected Components:** Client only — `renderer.ts`, `index.html`.

### Current State (confirmed via audit)

Every message DTO already carries `createdAt` as an ISO-8601 string
(`packages/shared-types/src/models.ts:49,66,76`). Messages are appended from
three call sites: `renderChatMessage`'s history-load loop
(`renderer.ts:3154-3156`), realtime receive (`renderer.ts:3304`), and the
pin-jump older-history loader (`renderer.ts:4584`) — plus `renderDmMessage`'s
own history loop (~`renderer.ts:3131-3139`). An existing `.unread-separator`
divider (`index.html:2174-2191` — a centered-label horizontal rule) is a
ready-made visual pattern to reuse for date dividers.

### Design Decisions

- Track "last rendered message date" as state on each `ChatTab` (and the
  equivalent DM tab structure). Insert the divider logic **inside**
  `renderChatMessage`/`renderDmMessage` themselves (not in the call sites)
  so all three channel call sites and the DM call site get date sectioning
  for free, with no duplicated logic.
- Divider label format: `--- April 13th ---` for the current year,
  `--- April 13th, 2025 ---` once the message predates the current year —
  exactly as specified in the request, no ambiguity here.
- Reuse the `.unread-separator` divider's visual style for consistency
  rather than inventing a new divider look.

### Files to Modify

- `apps/client/src/renderer/renderer.ts` — `renderChatMessage`,
  `renderDmMessage`, `ChatTab`/DM-tab state.
- `apps/client/src/renderer/index.html` — divider CSS (likely reusing
  `.unread-separator` directly or a near-identical sibling class).

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): scroll a channel with messages spanning multiple days
  and a prior year; confirm section titles appear correctly and only once
  per day; confirm behavior on initial history load, realtime receipt, and
  the pin-jump-to-older-history path.

---

## PRD 13.7 — Enlarge Custom-Emoji Tab Icon

**Type:** 🐛 FIX
**Priority:** Low
**Affected Components:** Client only — `renderer.ts`.

### Current State (confirmed via audit)

The custom-emoji tab icon lives at `renderer.ts:5068`, an inline SVG at
`width="12" height="12"` inside a `.emoji-cat-tab` button
(`index.html:2429-2450`: `padding: 4px 6px`, `font-size: 16px` for the
emoji-glyph tabs). There's plenty of headroom to size the icon up to
16–18px without overflowing the tab button.

### Fix

Bump the inline SVG's `width`/`height` from `12` to `17` (splitting the
difference, comfortably matching the 16px glyph size of sibling tabs
without touching button padding).

### Files to Modify

- `apps/client/src/renderer/renderer.ts` — the inline SVG at line ~5068.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): confirm the icon is clearly legible and doesn't overflow
  or misalign the tab row.

---

## PRD 13.8 — Reposition & Restyle "See More" Button

**Type:** 🐛 FIX
**Priority:** Medium
**Affected Components:** Client only — `renderer.ts`, `index.html`.

### Root Cause (confirmed via audit)

In `renderChatMessage`, DOM append order is: message text → attachment
image → reaction bar (`el.appendChild(reactBar)` at `renderer.ts:3191`).
`attachMessageTruncation()` then runs **afterward** (`renderer.ts:3203`) and
does `el.appendChild(btnSeeMore)` (`renderer.ts:3243`), which lands the
button after the reaction bar in DOM order — hence it visually reads as
belonging to the message below.

### Fix

- Change `el.appendChild(btnSeeMore)` to
  `el.insertBefore(btnSeeMore, reactBar)` so the button sits directly under
  the (now-collapsed) message content and above the reactions, matching how
  it visually reads as belonging to that message.
- Restyle from the current bare underlined text link
  (`index.html:717-731`) to a pill-shaped button: rounded (`border-radius`
  large enough to look like a pill), padding, a background fill, and
  `text-transform: uppercase` on the label.

### Files to Modify

- `apps/client/src/renderer/renderer.ts` — `attachMessageTruncation()`'s
  insertion call.
- `apps/client/src/renderer/index.html` — the button's CSS class.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): confirm a long message's "See More" button appears
  directly under that message's content, above its reactions, styled as a
  pill.

---

## PRD 13.9 — Pointer Cursor on Voice Channel Nicknames

**Type:** 🐛 FIX
**Priority:** Low
**Affected Components:** Client only — `index.html`.

### Root Cause (confirmed via audit)

`.tree-occupant` (`index.html:320-327`) is the entire clickable/
right-clickable row for a voice participant (there's no separate nickname
span — confirmed via `renderer.ts:1601` and the `data-user-id` selectors at
`:2556,2573`). No `cursor` property is set today, so it inherits the
browser default text cursor over the nickname text.

### Fix

Add `cursor: pointer` to `.tree-occupant`.

### Files to Modify

- `apps/client/src/renderer/index.html` — `.tree-occupant` rule.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): hover a voice participant's name and confirm a pointer
  cursor appears.

---

## PRD 13.10 — Faster Active-Speaker Indicator

**Type:** 🐛 FIX
**Priority:** Medium
**Affected Components:** Server only —
`apps/server/src/services/mediasoup.service.ts`.

### Root Cause (confirmed via audit)

The server's `AudioLevelObserver` is configured with
`{ maxEntries: 10, threshold: -50, interval: 300 }`
(`mediasoup.service.ts:194-198`) — mediasoup's own default `interval` is
1000ms; this project already lowered it once to 300ms. mediasoup emits
`volumes` at most every `interval` ms and internally averages over that
window, so 300ms is the dominant source of the reported lag. Client-side,
`renderer.ts:2544-2576` adds the `.speaking` CSS class **immediately** on
receiving the event (`:2572-2574`) — there's zero added client-side delay
on light-up. The only client-side timer is a 300ms **hold** before turning
the indicator back *off* (`:2552-2558`), which is an intentional
anti-flicker debounce, not the reported light-up lag.

### Fix

Lower the `AudioLevelObserver`'s `interval` further (e.g. to 100–150ms).

**Tradeoff to be aware of:** a shorter interval means mediasoup's internal
averaging window shrinks too, which increases CPU cost on the observer
slightly and raises the chance of brief flicker on short speech pauses — the
existing 300ms client-side hold-before-off timer should absorb most of
that, but this is worth watching during manual testing.

### Files to Modify

- `apps/server/src/services/mediasoup.service.ts` — the `AudioLevelObserver`
  config's `interval` value.

### Verification

- `npx tsc --noEmit` in `apps/server`.
- Manual (by user): compare perceived light-up latency before/after across
  a few speakers in a busy channel; confirm no new flicker on natural
  speech pauses.

---

## PRD 13.11 — Fix Participant Count Contrast

**Type:** 🐛 FIX
**Priority:** Low
**Affected Components:** Client only — `index.html`.

### Root Cause (confirmed via audit)

`.ch-count` (`index.html:298-304`) uses `color: var(--text-muted)`
(`#6a6a7a`) on `background: rgba(255,255,255,0.05)`, sitting atop
`--bg-secondary` (`#16213e`, dark navy) — genuinely low contrast, muted grey
on near-black.

### Fix

Change `.ch-count`'s `color` to `var(--text-secondary)` (`#a0a0b0`) — or
`var(--text-primary)` if that's still not enough contrast in practice — and
optionally bump the badge background's opacity slightly for a clearer
outline against the channel row.

### Files to Modify

- `apps/client/src/renderer/index.html` — `.ch-count` rule.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): confirm the participant count is comfortably legible at
  a glance against the channel tree background.

---

## PRD 13.12 — Replace "Leave Voice" Icon (X → Hang-Up Phone)

**Type:** 🎨 CHORE
**Priority:** Low
**Affected Components:** Client only — `index.html`.

### Current State (confirmed via audit)

`#btn-leave-voice` (`index.html:2782-2786`) is a plain X made of two crossed
`<line>` elements, `stroke="currentColor"`, in a 24×24 viewBox rendered at
14×14.

### Fix

Replace the inner SVG markup with a hang-up-style phone icon (a phone
handset with an X or slash), keeping the same `viewBox`, `stroke`/
`currentColor` convention, and rendered dimensions as the icon it replaces
so it drops in without any layout changes.

### Files to Modify

- `apps/client/src/renderer/index.html` — `#btn-leave-voice`'s inner SVG.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): confirm the new icon renders correctly at the existing
  button size and reads clearly as "hang up."

---

## PRD 13.13 — Animated Custom Emoji (GIF Upload)

**Type:** ✨ FEATURE
**Priority:** Medium
**Affected Components:** Server (`schema.prisma` + migration,
`upload.route.ts`, emoji approval handler) and Client (`renderer.ts`,
`index.html`).

### Current State (confirmed via audit)

- `CustomEmoji` (`apps/server/prisma/schema.prisma:259-275`) has no
  `isAnimated`/mime-type field today — needs a migration.
- The existing crop tool (`renderer.ts:1200-1219`, confirm ~`:5347`) always
  rasterizes the selection to `canvas.toBlob(..., "image/png")` — meaning a
  GIF picked through today's flow is already silently flattened to a single
  static PNG frame. A new "Add Animated Emoji" path must skip the crop tool
  entirely and upload the raw GIF buffer.
- The file input already accepts `image/gif` (`index.html:3028`). Size caps:
  client-side `EMOJI_MAX_UPLOAD_SIZE = 500 * 1024` (`renderer.ts:1213`,
  pre-crop) and server-side `MAX_EMOJI_FILE_SIZE = 512 * 1024`
  (`upload.route.ts:31`) — both apply to the existing static path and are
  too small for a decent animated GIF.
- Upload/storage (`upload.route.ts`, Cloudinary-or-local-disk) is format-
  agnostic — no changes needed there beyond the size limit. The approval
  handler (PENDING/APPROVED flow) is also format-agnostic and works as-is.

### Design Decisions

- Add an `isAnimated` boolean (or a `mimeType` string, whichever fits the
  existing schema conventions better) to `CustomEmoji`, via
  `npm run db:migrate` in `apps/server`.
- Add a distinct "Add Animated Emoji" button in the custom-emoji management
  section, next to the existing static-upload entry point. This path:
  skips the crop tool, uploads the raw GIF directly, and still requires a
  name, per the existing static-emoji flow's naming step.
- New size cap for this path specifically: **2 MB** (per the confirmed
  decision below) — enforced both client-side (before upload) and
  server-side (defense in depth, matching the existing dual-cap pattern for
  static emoji).
- Rendering: once approved, an animated emoji is used in chat/reactions
  exactly like a static one (`<img>` tag pointing at the stored GIF) — no
  special client rendering logic needed since GIFs animate natively in an
  `<img>` element.

### Files to Modify

- `apps/server/prisma/schema.prisma` + new migration — `isAnimated`/
  mime-type field.
- `apps/server/src/routes/upload.route.ts` — new size constant for the
  animated path.
- Emoji approval handler (server) — surface the animated flag if the admin
  approval UI should distinguish it.
- `apps/client/src/renderer/renderer.ts` / `index.html` — new upload button
  + flow, bypassing the crop tool.

### Verification

- `npx tsc --noEmit` in both `apps/server` and `apps/client`.
- Manual (by user): upload a GIF under 2MB, confirm it queues for approval,
  approve it as admin, confirm it renders animated in chat and as a
  reaction; confirm a GIF over 2MB is rejected client-side with a clear
  message; confirm the existing static-emoji crop-tool flow is completely
  unaffected.

---

## PRD 13.14 — Bigger Rendering for Solo-Emoji Messages

**Type:** 🎨 CHORE
**Priority:** Low
**Affected Components:** Client only — `renderer.ts`, `index.html`.

### Current State (confirmed via audit)

There's no existing "message is exactly one emoji" detector. Unicode emoji
render as plain escaped text with no wrapper element; custom emoji render
as `<img class="custom-emoji-inline">` (`renderer.ts:2673-2677`, sized via
CSS at `index.html:2540`, currently `1.3em`). Two render call sites need
this: `renderChatMessage` (`renderer.ts:3162`) and the DM equivalent
(~`renderer.ts:3371`).

### Design Decisions

- After building a message's rendered content, check: does the trimmed
  message consist of **exactly one** token — either a single Unicode emoji
  grapheme or a single `:custom_emoji_name:` — with no other text
  (whitespace-only surrounding the token is fine)?
- If so, apply a modifier class that bumps size to roughly **4×** the
  normal inline size (e.g. wrap the lone Unicode emoji in a span with a
  large `font-size`, and give the custom-emoji `<img>` a
  `.custom-emoji-inline-solo` class scaling `1.3em` up to ~`5.2em` or an
  equivalent fixed large px value).
- Any message with additional text alongside an emoji renders completely
  unaffected, exactly as today.

### Files to Modify

- `apps/client/src/renderer/renderer.ts` — the solo-emoji detection logic in
  both render call sites.
- `apps/client/src/renderer/index.html` — the new modifier CSS class(es).

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): send a message with a single emoji, a single custom
  emoji, and a message with an emoji plus text — confirm only the
  emoji-only cases render enlarged.

---

## PRD 13.15 — Fix Voice-Connected-But-Offline Presence Bug

**Type:** 🐛 FIX
**Priority:** High
**Affected Components:** Server only —
`apps/server/src/handlers/connection.handler.ts`.

### Root Cause (identified hypothesis, confirmed via code audit — not yet
### confirmed against a live repro, see Verification)

Presence uses two separate Redis key spaces: `presence:server:{id}` (the
server-wide online set, feeding the Online Users list) and
`presence:channel:{id}` (per-channel voice occupants) —
`presence.service.ts:8-10`. On disconnect, `connection.handler.ts` doesn't
immediately remove a user from either set — it defers both `leaveServer`
and `leaveChannel` behind a `DISCONNECT_GRACE_MS = 10_000` timer
(`:168,619-627`), specifically to tolerate brief reconnects (this is the
same mechanism behind the "Automatic Voice Reconnection" feature from
Phase 12/the recent `012873b` connection-resilience fix). That pending
timer is only ever cancelled from inside the **`USER_JOIN_SERVER`** handler
(`:293-296`) — **`USER_JOIN_CHANNEL` never touches `pendingDisconnects` at
all** (confirmed absent across `:431-480`).

If the client's voice-reconnect path re-establishes a dropped voice channel
by re-emitting `USER_JOIN_CHANNEL` alone (without a full
`USER_JOIN_SERVER` replay), the stale pending-disconnect timer from the
*old* socket is never cancelled. Ten seconds later it fires
`finalizeDisconnect` → `leaveServer`, silently wiping that user from the
online set — and potentially from their *current* channel's occupant set
too, since `leaveChannel` reads whatever channel ID is currently stored for
that user in Redis — even though their new socket is fully active in
voice. This matches the reported symptom exactly (4 voice participants, 2
in the online list).

### Fix

Cancel the pending-disconnect timer for a `userId` on **any**
presence-touching event from that user, not only `USER_JOIN_SERVER` — at
minimum, also `USER_JOIN_CHANNEL` (and any other handler that re-establishes
presence after a reconnect).

### Files to Modify

- `apps/server/src/handlers/connection.handler.ts` — extend pending-
  disconnect cancellation beyond `USER_JOIN_SERVER`.

### Verification

- `npx tsc --noEmit` in `apps/server`.
- `npm run test` in `apps/server` (existing presence-adjacent tests, if
  any, should still pass).
- Manual (by user, important since the root cause is a strong hypothesis
  rather than a confirmed repro): reproduce a voice reconnect under a flaky
  connection (or force one) and confirm the Online Users list stays
  consistent with actual voice occupancy afterward. If the symptom
  persists after this fix, that's a genuine new data point — the timer-
  cancellation gap was the most likely cause found in code, not the only
  possible one.

---

## PRD 13.16 — Screen-Share Sound Alerts

**Type:** ✨ FEATURE
**Priority:** Medium
**Affected Components:** Server (`packages/shared-types/src/socket-events.ts`,
`voice.handler.ts`) and Client (`renderer.ts`, new assets in
`apps/client/assets/`, `package.json`).

### Current State (confirmed via audit)

A central sound dispatcher (`SoundAlert.play("x.mp3")`,
`renderer.ts:827-829`) already respects the existing "mute sound alerts"
flag and the sound-alert volume slider — new sounds only need to route
through it. Assets live in `apps/client/assets/` and are bundled via
`build.files` in `apps/client/package.json` — a pattern to replicate for
the four new `.mp3` files (`user_started_sharing.mp3`,
`user_stopped_sharing.mp3`, `user_joined_your_stream.mp3`,
`user_exited_your_stream.mp3`).

- **Start/stop sharing sounds** have an exact existing precedent: join/leave
  sounds are driven by a `previousOccupantIds` diff inside the
  `PRESENCE_UPDATE` handler for the user's current channel
  (`renderer.ts:2502-2528`). This extends directly with a parallel
  `previousSharingIds` diff on `occ.isSharingScreen` — purely client-side,
  no new server event needed.
- **Viewer joined/exited your stream sounds** need a genuinely new signal:
  there is currently **no broadcast to the sharer** when someone calls
  `WATCH_SCREEN_SHARE` / `STOP_WATCHING_SCREEN_SHARE`
  (`socket-events.ts:393-407`) — confirming the request's own observation
  that "there is simply no existing cue." This requires a new
  server→sharer event.

### Design Decisions

- Client-only diff for start/stop-sharing sounds, mirroring the existing
  occupant-join/leave sound pattern exactly.
- New shared-types event (e.g. `VIEWER_JOINED_YOUR_STREAM` /
  `VIEWER_LEFT_YOUR_STREAM`, or one event with a `joined: boolean` payload)
  added to `ServerToClientEvents` first, per the project's shared-types-
  first workflow. `voice.handler.ts`'s existing `WATCH_SCREEN_SHARE`/
  `STOP_WATCHING_SCREEN_SHARE` handlers emit it to the sharer's socket only.
- All four new sounds route through the existing `SoundAlert.play()`
  dispatcher, inheriting mute + volume-slider behavior automatically.

### Files to Modify

- `packages/shared-types/src/socket-events.ts` — new server→client event(s).
- `apps/server/src/handlers/voice.handler.ts` — emit the new event(s) on
  watch/stop-watch.
- `apps/client/src/renderer/renderer.ts` — `previousSharingIds` diff logic,
  new event listener, four new `SoundAlert.play()` call sites.
- `apps/client/assets/` — four new `.mp3` files.
- `apps/client/package.json` — `build.files` entries for the new assets.

### Verification

- `npx tsc --build` in `packages/shared-types`, then `npx tsc --noEmit` in
  both `apps/server` and `apps/client`.
- Manual (by user): start/stop sharing with others in-channel and confirm
  both sounds play for listeners (respecting mute + volume settings); open
  and close the Viewer window from a second client and confirm the sharer
  hears the join/exit cues.

---

## PRD 13.17 — Move Ban to "User Management" Tab

**Type:** 🐛 FIX (UX + permissions restructuring)
**Priority:** Medium
**Affected Components:** Server (`admin.handler.ts`, permission gating) and
Client (`renderer.ts`, `index.html` — Online Users modal, Settings →
Roles tab).

### Current State (confirmed via audit)

- The Ban button lives today only in the Online-Users-sourced list
  (`renderer.ts:3616-3629`) — meaning an offline user can't be banned at all
  from there. A separate "Banned Users" section in the *same* modal already
  lists offline banned users with an Unban action
  (`renderer.ts:3449-3491`), fed by `getBannedUsers()`, which is already
  Postgres-backed and works regardless of online status.
- **Key finding:** the Roles tab already calls `GET_ALL_USERS`
  (`admin.handler.ts:41-90`), which lists **every DB user who has a role on
  the server, online or not** — gated by `MANAGE_ROLES`. This is exactly
  the user list this feature needs; no new listing mechanism is required.
- Gap: `GET_ALL_USERS`'s response doesn't currently include an `isBanned`
  flag, needed to decide whether to render a Ban or Unban control per row.

### Design Decisions

- Rename the Settings tab from "Roles" to "**User Management**" and update
  its icon to reflect the broader scope (role assignment + ban/unban),
  moving both the existing role-management UI and the Ban/Unban controls
  (merging in the existing "Banned Users" list from the Online Users modal)
  into this one tab.
- Remove the Ban button from the Online Users modal entirely, per the
  request.
- **Permission gating (per the confirmed decision below):** the tab becomes
  visible to a user holding **either** `MANAGE_ROLES` **or** `BAN_USER` —
  not `MANAGE_ROLES` alone — so a role that currently has `BAN_USER` but
  not `MANAGE_ROLES` doesn't lose ban capability. Inside the tab, each
  control stays individually gated by its own permission: role-editing
  controls require `MANAGE_ROLES`, ban/unban controls require `BAN_USER`. A
  user with only one of the two sees the tab but only the controls their
  permission covers.
- Server: add an `isBanned` flag to `GET_ALL_USERS`'s response (cross-
  referencing the existing banned-users table), so the client can render
  Ban vs. Unban per row without a second round trip.

### Files to Modify

- `apps/server/src/handlers/admin.handler.ts` — `GET_ALL_USERS`'s query,
  adding the `isBanned` cross-reference.
- `apps/server/src/middleware/permissions.middleware.ts` / relevant handler
  gating — tab-visibility check becomes `MANAGE_ROLES OR BAN_USER`.
- `packages/shared-types/src/socket-events.ts` — `isBanned` field on the
  `GET_ALL_USERS` response DTO.
- `apps/client/src/renderer/renderer.ts` — remove Ban button from Online
  Users modal, add Ban/Unban controls (individually permission-gated) to
  the renamed User Management tab, merge in the existing banned-users list
  rendering.
- `apps/client/src/renderer/index.html` — tab rename + new icon, layout for
  the merged section.

### Verification

- `npx tsc --build` in `packages/shared-types`, then `npx tsc --noEmit` in
  both `apps/server` and `apps/client`.
- Manual (by user): as a full admin, ban an *offline* user from the new
  tab and confirm it takes effect; confirm the Online Users modal no
  longer shows a Ban button; test with a role that has `BAN_USER` but not
  `MANAGE_ROLES` and confirm the tab is visible with only ban controls
  enabled (no role-editing controls).

---

## PRD 13.18 — Single-Instance Electron Lock

**Type:** 🐛 FIX
**Priority:** Medium
**Affected Components:** Client only — `apps/client/src/main.ts`.

### Current State (confirmed via audit)

There is no `app.requestSingleInstanceLock()` call and no `second-instance`
listener anywhere in `main.ts` today — every launch spawns a brand new
Electron instance, even with one already running (including minimized to
tray).

### Fix

Standard Electron single-instance pattern:

1. Call `app.requestSingleInstanceLock()` immediately, before
   `app.whenReady()` (`main.ts:~514`).
2. If the lock isn't obtained (another instance already holds it), call
   `app.quit()` right away and return — this process becomes a no-op.
3. Register a `'second-instance'` listener that, when a second launch
   attempt is detected: restores the existing `mainWindow` if minimized,
   shows it if hidden to tray, and calls `.focus()` — mirroring the
   restore-from-tray behavior the app already has for its tray context
   menu.

### Files to Modify

- `apps/client/src/main.ts` — lock acquisition + `second-instance` handler.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): launch the app, then attempt to launch it again (both
  normally and while minimized to tray) and confirm the second attempt
  simply focuses the existing window instead of opening a new instance.

---

## Cross-Cutting Dependencies & Recommended Implementation Order

Section numbers above follow `nextsteps.txt`'s original order for easy
cross-referencing back to the source list. The **build order** below is
different where dependencies or risk-sequencing make that worthwhile — feel
free to reorder further, this is a recommendation, not a requirement.

1. **PRD 13.2 (noise gate fix)** first, of the three audio-graph items —
   it's the item that *forces* a real Web Audio graph to exist (a boolean
   `track.enabled` can never fade), so it establishes the foundational
   `MediaStreamSource → GainNode → MediaStreamAudioDestinationNode →
   produce()` plumbing that both other audio items extend.
2. **PRD 13.3 (mic volume slider)** next — adds a second cascaded
   `GainNode` onto the graph 13.2 just built. Deliberately sequenced as a
   smaller, lower-risk step *before* the WASM/worklet work, so the new
   "processed graph feeds the producer" architecture gets proven out (and
   verified from a second client, per its own verification step) before the
   highest-complexity item touches it.
3. **PRD 13.1 (noise cancelling)** last of the three — inserts the
   `AudioWorkletNode` as the first stage of the now-proven graph. This is
   the single highest-complexity, highest-risk item in the phase (new
   external WASM dependency, first AudioWorklet usage in the app,
   electron-builder packaging changes) — do it once the underlying graph
   is known-good, not as the first audio change.
4. **PRD 13.4 → 13.12** (the nine small, independent UI/UX fixes) have no
   interdependencies and no dependencies on the audio-graph work — they can
   be done in any order, interleaved with the above for variety, or batched
   together. Suggested internal order is simplicity-first: 13.9, 13.11,
   13.7, 13.12 (single-line/single-property changes) before 13.4, 13.8
   (small new markup/handlers) before 13.5, 13.6 (state-tracking changes)
   before 13.10 (server-side, different workspace).
5. **PRD 13.13 (animated emoji)** and **PRD 13.14 (solo-emoji sizing)** are
   independent of everything else and of each other.
6. **PRD 13.15 (presence bug)** is independent but marked High priority —
   consider doing it earlier rather than later given it's a correctness bug
   affecting a "sensitive part of the app," per the original request's own
   caution.
7. **PRD 13.16 (screen-share sounds)** and **PRD 13.17 (ban button
   relocation)** both touch `packages/shared-types` — remember to run
   `npx tsc --build` in `packages/shared-types` before typechecking
   `apps/server`/`apps/client` after either.
8. **PRD 13.18 (single-instance lock)** is fully independent — good
   candidate for a quick, low-risk item any time.

No two items modify the exact same function in a conflicting way, so this
order is a suggestion for risk/complexity pacing, not a strict correctness
requirement.

---

## Open Decisions Confirmed With the User

Four points were genuinely ambiguous in the raw `nextsteps.txt` request text
(not inferable as a safe default) and were confirmed directly with the user
before this PRD was finalized:

1. **DeepFilterNet WASM sourcing (PRD 13.1):** no official WASM build exists
   from the DeepFilterNet project. **Decision: vendor a third-party npm
   package** (e.g. `deepfilternet3-noise-filter`, `deepfilternet3-workers`,
   or the `boredland/noise` reference implementation — pick whichever has
   the smallest footprint and clearest license at implementation time),
   rather than building from source or substituting a different denoiser
   like RNNoise.
2. **New audio-settings controls tab placement (PRD 13.1 & 13.3):** the
   request describes the noise-cancelling toggle as sitting "alongside"
   Global Voice Volume and Mic Sensitivity, but those two sliders currently
   live on two different Settings tabs. **Decision: both the new Noise
   Cancelling toggle and the new Mic Volume slider go in the Voice &
   Shortcuts tab**, grouped with the existing Mic Sensitivity/Noise Gate
   section, rather than the Audio tab or split across both.
3. **Animated emoji file size cap (PRD 13.13):** the existing 512KB static-
   emoji limit is unsuitable for GIFs and the request didn't specify a
   number. **Decision: 2 MB** max for the animated-emoji upload path
   specifically (static emoji's existing limit is untouched).
4. **Ban permission scope after moving into User Management (PRD 13.17):**
   moving Ban into a tab gated by `MANAGE_ROLES` would silently revoke ban
   ability from any role holding `BAN_USER` without `MANAGE_ROLES`.
   **Decision: open the tab to holders of either `MANAGE_ROLES` or
   `BAN_USER`**, with each control inside individually gated by its own
   permission, preserving every existing role's current capabilities.
