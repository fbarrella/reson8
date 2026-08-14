# Reson8 — Phase 11 PRD

**Created:** 13/08/2026
**Author:** Felipe B. Netto (assisted by AI)
**Status:** Draft — Pending Review
**Source:** `app-planning/nextsteps.txt`
**Branch:** `phase-11`

---

## Table of Contents

1. [PRD 11.1 — Fix Random Voice Chat Disconnections](#prd-111--fix-random-voice-chat-disconnections)
2. [PRD 11.2 — Fix Voice Session Timer Starting From Negative Numbers](#prd-112--fix-voice-session-timer-starting-from-negative-numbers)
3. [PRD 11.3 — Fix Emoji Picker Custom-Emoji Tab Visibility](#prd-113--fix-emoji-picker-custom-emoji-tab-visibility)
4. [PRD 11.4 — Post-Update "What's New" Modal](#prd-114--post-update-whats-new-modal)
5. [PRD 11.5 — Pin Messages in Text Channels](#prd-115--pin-messages-in-text-channels)
6. [Cross-Cutting Dependencies & Implementation Order](#cross-cutting-dependencies--implementation-order)
7. [Open Decisions Confirmed With the User](#open-decisions-confirmed-with-the-user)

> [!IMPORTANT]
> Every implementation must be tracked and logged into `app-planning/progress.txt`
> using the `/log-progress` slash command immediately after the item is completed
> and verified, following the established `--- Entry: DD/MM/YYYY ---` format. This
> is not optional cleanup — treat it as part of finishing each PRD item, exactly as
> it was for every prior phase.
>
> When every item below is implemented and verified, run `/bump-version 1.4.0` and
> update `README.md` to reflect the final Phase 11 feature set (new Roadmap row,
> Features section entries for the pin bar / update modal / emoji picker fix, and
> the version badge).

> [!NOTE]
> This PRD was written after three parallel research passes over the voice
> lifecycle (mediasoup/socket.io), the emoji picker + auto-updater code, and the
> message/channel data model — not from a clean-slate reading of the roadmap
> text alone. File paths and line numbers below reflect the code as of
> 13/08/2026 (branch `p10-client-fixes`, post-Phase-10) — re-check them if the
> surrounding code has moved by the time an item is implemented.

---

## PRD 11.1 — Fix Random Voice Chat Disconnections

**Type:** 🐛 FIX (+ hardening)
**Priority:** Highest
**Affected Components:** Server (`mediasoup.service.ts`, `voice.handler.ts`,
`connection.handler.ts`, `index.ts`) and Client (`voice.service.ts`,
`preload.ts`, `renderer.ts`) — no schema changes.

### Overview

Voice participants intermittently and unpredictably get dropped from a voice
channel with no clear trigger. A full audit of the voice lifecycle — Socket.io
signaling, the mediasoup WebRTC handshake, and the reconnect path — surfaced
several concrete, independent gaps that each plausibly cause this symptom.
Per your direction, this item fixes all of them rather than only the single
most-likely cause, since the bug is "highest priority" and a partial fix risks
leaving the report open under a different trigger.

### Root Causes Identified (ranked by likelihood)

1. **No automatic voice-channel rejoin after a Socket.io reconnect.**
   `preload.ts` tears down the voice engine (`voiceService.cleanup()`) on
   `disconnect`. Socket.io is configured with `reconnection: true` and
   silently reconnects the transport, re-firing `connect`, but only
   `USER_JOIN_SERVER` is re-emitted — nothing re-runs the voice-channel join
   sequence. Server-side, `connection.handler.ts`'s `disconnect` handler
   already ran full mediasoup + presence cleanup for the old socket. Net
   effect: any transient network hiccup that trips Socket.io's own disconnect
   detection silently ejects the user from voice with zero recovery — this is
   the most likely explanation for "random" drops.
2. **Aggressive Socket.io ping/pong timeout.** `index.ts` sets
   `pingInterval: 10_000, pingTimeout: 5_000` — far tighter than Socket.io's
   defaults (25000/20000). A brief GC pause, laptop sleep/wake, wifi
   hand-off, or main-thread stall longer than 5s trips a *real* disconnect
   even though the underlying connection would otherwise have recovered on
   its own, directly feeding gap 1.
3. **No WebRTC connection-state monitoring, client or server.** Neither
   `voice.service.ts` (client) nor `mediasoup.service.ts` (server) listens
   for transport-level `connectionstatechange`/`icestatechange`. An ICE
   failure or NAT rebind independent of the Socket.io signaling channel (a
   very plausible cause of *voice-specific* drops that leave text chat/
   presence intact) goes completely undetected — audio just stops with no
   client-side awareness, notification, or recovery attempt.
4. **A single mediasoup worker crash kills the entire server.**
   `mediasoup.service.ts`'s worker `"died"` handler calls `process.exit(1)`.
   A crash in one worker (out of what may be several, depending on CPU count)
   currently takes down every voice session on the server, not just the ones
   assigned to that worker.
5. **Transport-level producer close never notifies peers.**
   `voice.handler.ts`'s `producer.on("transportclose", …)` nulls out the
   session's producer but never emits `PRODUCER_CLOSED` to other channel
   members — only the explicit `CLOSE_PRODUCER`/leave/kick paths do. If a
   transport closes unexpectedly (e.g., as a side effect of fixing gap 3),
   other clients are left with a phantom consumer for a producer that no
   longer exists.
6. **No retry bound / UI feedback for `PRODUCE`/`CONSUME` failures.**
   `voice.service.ts`'s `queueConsumeProducer` path only `console.error`s on
   failure — no retry, no user-visible signal that voice partially failed.

### Lower-priority code smells (documented, not required for this fix)

- `voice.handler.ts`'s `consumer.on("producerclose")` emits `PRODUCER_CLOSED`
  with `userId: ""` — functionally harmless today (client matches by
  `producerId`), but a latent data-quality gap for any future consumer of
  that field.
- `voice.handler.ts`'s `catch (observerErr)` around
  `addProducerToObserver` only logs a warning — active-speaker detection can
  silently stop working for a user with no visible indication.
- `preload.ts`'s Socket.io client config uses a fixed 1000ms
  `reconnectionDelay` with `reconnectionAttempts: 5` and no backoff — after 5
  failed attempts the socket gives up with no distinct "couldn't reconnect"
  UI state.

### Design Decisions

- **Voice-channel auto-rejoin is the centerpiece fix.** Track the
  currently-joined voice channel ID client-side. On a Socket.io `connect`
  event that follows a `disconnect` (i.e., a reconnect, not the initial
  connect), if a voice channel was active, automatically replay the full
  6-step join handshake for that channel. Show a small non-blocking
  "Reconnecting to voice…" indicator in the voice panel during this window;
  clear it on success. If the rejoin itself fails (e.g., channel was deleted,
  or the join is rejected), fall back to the current behavior — clear voice
  state and let the user rejoin manually — rather than retrying forever.
- **Ping/pong timeout retuned toward Socket.io defaults**, not restored
  exactly to 25000/20000 (self-hosting over the open internet benefits from
  somewhat faster dead-connection detection than the default), but away from
  the current 5s cliff — e.g. `pingInterval: 25000, pingTimeout: 20000`,
  matching Socket.io's own defaults, which are already tuned for typical
  internet jitter. This alone should eliminate a meaningful fraction of
  false-positive disconnects, independent of the rejoin fix.
- **ICE/connection-state monitoring, both ends:**
  - Client: listen to `connectionstatechange` on both `sendTransport` and
    `recvTransport`. On `"disconnected"`, start a short grace period (e.g.
    3–5s, since ICE frequently self-recovers from a transient
    disconnected state without intervention). If it reaches `"failed"`, or
    stays `"disconnected"` past the grace period, treat it as a voice
    failure and trigger the same rejoin path used for Socket.io reconnects.
  - Server: add an `icestatechange` listener on `WebRtcTransport` alongside
    the existing `dtlsstatechange` one, closing the transport and running
    the existing cleanup + peer notification on `"failed"`/`"closed"`.
- **Worker crash no longer kills the process.** On a worker `"died"` event,
  log it as a critical error, remove the dead worker from the pool, spawn a
  replacement, and — since sessions bound to that specific worker are
  unavoidably lost — proactively notify only the affected users' clients
  (not the whole server) so their client-side voice-failure detection above
  triggers a rejoin, instead of a global `process.exit(1)` that drops every
  voice user on the server for a single worker's crash.
- **`PRODUCER_CLOSED` is emitted on transport-level producer close**, not
  only on the explicit close/leave/kick paths, so peers never hold a phantom
  consumer.
- **Bounded retry + UI surfacing for `PRODUCE`/`CONSUME` failures:** cap at a
  small number of attempts (e.g. 2) with a short backoff; on final failure,
  surface an inline error in the voice panel rather than only logging to the
  console.

### Implementation

1. **`apps/server/src/index.ts`** — retune `pingInterval`/`pingTimeout`.
2. **`apps/server/src/services/mediasoup.service.ts`**
   - Worker `"died"` handler: replace `process.exit(1)` with
     log-and-respawn + targeted client notification for sessions bound to
     the dead worker.
   - `createWebRtcTransport()`: add an `icestatechange` listener mirroring
     the existing `dtlsstatechange` handling.
3. **`apps/server/src/handlers/voice.handler.ts`**
   - `producer.on("transportclose", …)`: emit `PRODUCER_CLOSED` to the
     channel before nulling the session's producer.
   - Add a server→client event/notification path for the worker-crash case
     above (reuse `PRODUCER_CLOSED`/`USER_LEAVE_CHANNEL`-style broadcast
     conventions already used for kick/leave).
4. **`apps/client/src/services/voice.service.ts`**
   - Add `connectionstatechange` listeners on `sendTransport`/`recvTransport`
     with the grace-period logic described above; on confirmed failure,
     invoke a new `attemptVoiceRejoin()` path.
   - Bound `PRODUCE`/`CONSUME` retries; surface failure to the renderer via
     an event instead of only `console.error`.
5. **`apps/client/src/preload.ts`**
   - Track the active voice channel ID; on the Socket.io `connect` handler,
     detect "this is a reconnect, not the first connect" (e.g. a
     `hadConnectedBefore` flag) and, if a voice channel was active, call the
     same join sequence used for a manual join instead of only re-emitting
     `USER_JOIN_SERVER`.
   - Expose a "voice reconnecting" event to the renderer for the UI
     indicator.
6. **`apps/client/src/renderer/renderer.ts`**
   - "Reconnecting to voice…" indicator in the voice panel, driven by the
     new event; inline error state for exhausted `PRODUCE`/`CONSUME`
     retries.

### Files to Modify

| File | Change |
|:---|:---|
| `apps/server/src/index.ts` | Retune Socket.io `pingInterval`/`pingTimeout` |
| `apps/server/src/services/mediasoup.service.ts` | Worker-crash respawn instead of `process.exit`, `icestatechange` listener |
| `apps/server/src/handlers/voice.handler.ts` | `PRODUCER_CLOSED` on transport-close, worker-crash client notification |
| `apps/client/src/services/voice.service.ts` | Connection-state monitoring + grace period, bounded retry for `PRODUCE`/`CONSUME` |
| `apps/client/src/preload.ts` | Reconnect detection, voice-channel auto-rejoin trigger |
| `apps/client/src/renderer/renderer.ts` | "Reconnecting to voice…" indicator, retry-exhausted error state |

### Verification

1. Server + client typecheck (`npx tsc --noEmit` in each workspace),
   existing vitest suite.
2. Manually simulate a Socket.io disconnect while in a voice channel (e.g.
   toggle network off/on briefly, or kill/restart the server process) and
   confirm the client automatically rejoins voice without manual
   intervention, showing the reconnecting indicator in between.
3. Kill a mediasoup worker process (or simulate via a forced error) and
   confirm only sessions on that worker are affected, the server process
   stays up, and affected clients auto-rejoin.
4. Extended soak test: leave 2–3 clients connected to a voice channel for an
   extended period under normal conditions and confirm no spontaneous drops
   occur (this bug is intermittent, so absence of repro over a longer window
   is the best available signal beyond the targeted repros above).

---

## PRD 11.2 — Fix Voice Session Timer Starting From Negative Numbers

**Type:** 🐛 FIX
**Priority:** Medium
**Affected Components:** Client only (`renderer.ts`) — no server changes
required if the existing ping/latency round-trip is reused as designed
below; if no such round-trip exists at implementation time, a minimal
server timestamp-echo addition is needed (see below).

### Root Cause (confirmed via audit)

The server sets an absolute session-start timestamp (`new Date()` in
`connection.handler.ts`, broadcast as an ISO string `sessionStartedAt` via
`PRESENCE_UPDATE`). The client computes elapsed time as
`Date.now() - new Date(sessionStartedAt).getTime()` in two places
(`renderer.ts`'s synchronous render path and its 1s interval tick), with no
correction for clock skew between the server host and the client host.
`formatDuration()` performs no clamping, so any skew where the client's clock
reads *behind* the server's produces a negative elapsed value — e.g. -2:00 —
which counts up to zero and then continues normally once real elapsed time
exceeds the skew. This matches the reported symptom exactly and explains why
it "goes away" after a minute or two: it isn't a bug in the counting logic,
it's an uncorrected difference between two independent clocks.

### Fix

Compute a client↔server clock offset and apply it consistently everywhere
`sessionStartedAt` is diffed against, rather than only hiding the symptom
with a clamp.

- Reuse the existing ping/latency round-trip mechanism already used for the
  status-bar latency display: on each round trip, in addition to the
  existing RTT/latency calculation, derive a clock offset estimate
  (`offset ≈ serverTimestamp - (localSendTime + rtt / 2)`, the standard
  NTP-style approximation) and keep a running/latest value in a
  module-level variable.
- Change both elapsed-time computations (`renderer.ts`'s synchronous render
  path and the 1s interval tick) to use
  `(Date.now() + clockOffsetMs) - new Date(sessionStartedAt).getTime()`
  instead of a raw `Date.now()` diff.
- As defense in depth against any residual skew (the offset estimate is a
  single round-trip approximation, not a full NTP sync), also clamp the
  final value in `formatDuration()` so a negative result never renders —
  displaying `0:00` instead. This is a safety net, not the primary fix.

### Files to Modify

| File | Change |
|:---|:---|
| `apps/client/src/renderer/renderer.ts` | Derive clock offset from the existing ping round-trip; apply it in both elapsed-time computation sites; clamp `formatDuration()` against negative input |

### Verification

1. Client typecheck.
2. Artificially skew the test machine's clock forward/backward by a couple
   of minutes relative to the server (or run the server in a container/VM
   with a deliberately offset clock) and confirm the session timer starts
   at (or very near) `0:00` regardless, instead of showing a large negative
   value.
3. Confirm the latency display (which shares the underlying round-trip
   mechanism) is unaffected.

---

## PRD 11.3 — Fix Emoji Picker Custom-Emoji Tab Visibility

**Type:** 🐛 FIX
**Priority:** Medium
**Affected Components:** Client only (`index.html`, `renderer.ts`).

### Root Cause (confirmed via audit)

The emoji picker's category tab bar (`.emoji-category-tabs`,
`index.html`) is a single non-wrapping flex row with `overflow-x: auto` and
a **hidden** scrollbar (`scrollbar-width: none` + hidden WebKit scrollbar).
The custom-emoji tab is appended as the 10th tab, after the 9 built-in
categories, using a plain `➕` emoji character as its icon
(`buildEmojiCategoryTabs()`, `renderer.ts`) — inconsistent in size/weight
across platforms/fonts, and rendered at reduced opacity unless active. In a
fixed 320px-wide picker, the 10th tab is frequently pushed off-screen with no
visible cue that more tabs exist, since the scrollbar itself is hidden by
design (matching the picker's overall visual style, which otherwise has no
visible scrollbars).

### Fix

- **Replace the `➕` character** with an inline SVG icon matching the app's
  existing icon convention (`14×14`, `viewBox="0 0 24 24"`,
  `stroke="currentColor"`, `stroke-width="2"`, feather-icons style — the
  same wrapper used by `#btn-emoji` and the message edit/delete icons), sized
  and weighted consistently regardless of platform/font.
- **Pin the custom-emoji tab outside the scrollable region.** Restructure
  the tab bar into two zones within the same flex container: an inner
  scrollable `div` holding the 9 built-in category tabs (unchanged
  scroll/overflow behavior), and the custom-emoji tab as a sibling
  `flex-shrink: 0` element *outside* that inner scrollable div, at the end
  of the bar. This guarantees the custom tab is always visible regardless of
  how many built-in categories exist or how far the user has scrolled,
  without changing the picker's overall width or the existing category
  browsing behavior.

### Implementation

1. **`apps/client/src/renderer/index.html`**
   - Wrap the 9 category tabs in a new inner scrollable container; keep the
     existing `.emoji-category-tabs` scroll/overflow CSS on that inner
     element instead of the outer bar.
   - Add CSS for the new fixed custom-emoji tab slot (non-scrolling,
     `flex-shrink: 0`, consistent padding/hover/active states matching the
     existing `.emoji-cat-tab` styling).
2. **`apps/client/src/renderer/renderer.ts`**
   - `buildEmojiCategoryTabs()`: append the 9 built-in category buttons to
     the new inner scrollable container; append the custom-emoji button to
     the new fixed slot instead of the same scrollable list.
   - Replace `customBtn.textContent = "➕"` with the new inline SVG icon.

### Files to Modify

| File | Change |
|:---|:---|
| `apps/client/src/renderer/index.html` | Split tab bar into scrollable category zone + fixed custom-tab slot; new SVG icon markup/CSS |
| `apps/client/src/renderer/renderer.ts` | `buildEmojiCategoryTabs()` appends to the correct zone; SVG icon instead of `➕` |

### Verification

1. Client typecheck.
2. Open the emoji picker and confirm the custom-emoji tab is visible
   immediately, with no scrolling required, at the current picker width.
3. Confirm the 9 built-in categories still scroll/browse correctly in their
   zone, and that clicking each (including the custom tab) still shows the
   correct panel — this is purely a layout change, the click/active-state
   logic itself shouldn't change behavior.

---

## PRD 11.4 — Post-Update "What's New" Modal

**Type:** ✨ NEW FEATURE
**Priority:** Medium
**Affected Components:** Client only (`main.ts`, `preload.ts`, `renderer.ts`,
`index.html`) — no server/schema changes. Builds on the Phase 10
auto-updater (`electron-updater`, GitHub Releases publish config) but is
independent of it — this modal is about the version the user is *currently
running*, not about detecting a *newer* one.

### Overview

The first time the app is opened after an update, a modal shows the new
version's release notes (fetched from GitHub Releases) with a link to the
GitHub page and a dismiss button. Once dismissed, it doesn't show again until
the next version bump.

### Design Decisions

- **Trigger logic:** on startup, compare `app.getVersion()` against a new
  `localStorage` key `reson8-last-seen-version` (following the existing
  `reson8-*` prefix convention).
  - **No stored value at all (first-ever launch):** silently record the
    current version and do **not** show the modal — a brand-new user
    doesn't need a "what's new since your last version" prompt for the
    version they just installed.
  - **Stored value differs from the current version:** an update just
    happened — fetch release notes and show the modal once.
  - **Stored value matches:** nothing to do.
  - `reson8-last-seen-version` is only updated to the current version **after
    the modal has been successfully shown and dismissed** (or, for the
    first-launch case, immediately). If the release-notes fetch fails (no
    network, GitHub rate limit, etc.), the version is *not* marked as seen —
    the app will retry the fetch on the next launch instead of silently
    skipping the notification forever. This is a deliberate choice: a single
    extra background fetch attempt per launch is cheap, and it guarantees
    the notification is eventually delivered once connectivity returns,
    rather than requiring the user to have been online at the exact moment
    of the first post-update launch.
- **Release notes source:** GitHub Releases API
  (`https://api.github.com/repos/fbarrella/reson8/releases/tags/v{version}`),
  fetched from the **main process** via a new IPC handler, following the
  same fetch-from-main pattern already used for link previews
  (`fetch-link-preview` in `main.ts`). No network calls happen directly in
  the renderer.
  - **Tag format assumption:** electron-builder's default GitHub publish
    behavior tags releases as `v{version}` (e.g. `v1.4.0`) — this should be
    verified against the actual tags once this version's release goes out
    via `/bump-version`; adjust the tag template string if the real
    convention differs.
- **Rendering release notes safely:** the release body is untrusted remote
  content (Markdown/plain text from GitHub). Render it as sanitized
  HTML/plain text using the same sanitization approach already applied to
  link-preview content, never raw `innerHTML` of the unprocessed API
  response.
- **Modal content:** version header (e.g. "What's new in v1.4.0"), the
  release notes body, a "View on GitHub" button (`shell.openExternal` to the
  release's HTML URL from the API response), and a single "Got it" dismiss
  button — no snooze/"remind me later", matching the "shown once" spec.
- **Fetch/render failure fallback:** if the API call fails or returns no
  matching release, don't show a broken/empty modal — skip silently for this
  launch (see the retry-on-next-launch behavior above).

### Implementation

1. **`apps/client/src/main.ts`**
   - New `ipcMain.handle("fetch-release-notes", (version) => ...)`: calls
     the GitHub Releases API for the `v{version}` tag, returns
     `{ name, body, htmlUrl } | null`. Reuses the existing HTTP-fetch
     pattern from `fetch-link-preview`.
2. **`apps/client/src/preload.ts`**
   - `fetchReleaseNotes(version): Promise<{...} | null>` bridge method.
3. **`apps/client/src/renderer/renderer.ts`**
   - On startup (near the existing `getAppVersion()` call in the About tab
     hydration), run the version-comparison logic described above; on a
     detected update, call `fetchReleaseNotes()` and, on success, render and
     show the new modal; on dismiss, persist `reson8-last-seen-version`.
4. **`apps/client/src/renderer/index.html`**
   - New modal markup + CSS: version header, scrollable notes body, "View on
     GitHub" / "Got it" buttons — styled consistently with the existing
     custom-modal component used elsewhere in the app (not a native
     `alert`/`confirm`, per the project's established Electron-safe modal
     pattern).

### Files to Modify

| File | Change |
|:---|:---|
| `apps/client/src/main.ts` | `fetch-release-notes` IPC handler |
| `apps/client/src/preload.ts` | `fetchReleaseNotes` bridge method |
| `apps/client/src/renderer/renderer.ts` | Version-check-on-startup logic, modal show/dismiss, `localStorage` persistence |
| `apps/client/src/renderer/index.html` | "What's new" modal markup + CSS |

### Verification

1. Client typecheck.
2. Manually set `reson8-last-seen-version` in `localStorage` to a prior
   version, relaunch, and confirm the modal appears with real release notes
   for the current version and the correct GitHub link.
3. Dismiss the modal, relaunch again, and confirm it does **not** reappear.
4. Clear `localStorage` entirely (simulating first-ever launch) and confirm
   the modal does **not** appear, but the version is recorded.
5. Temporarily disable network access, relaunch with a stale
   `last-seen-version`, and confirm the modal fails silently rather than
   showing broken/empty content — then re-enable network and relaunch again
   to confirm it now appears (retry-on-next-launch behavior).

---

## PRD 11.5 — Pin Messages in Text Channels

**Type:** ✨ NEW FEATURE
**Priority:** Medium
**Affected Components:** Server (`schema.prisma`, `channel.handler.ts`,
`message.handler.ts`) and Client (`preload.ts`, `renderer.ts`,
`index.html`), plus `packages/shared-types` (new Socket.io events).

### Overview

Admins can pin exactly one message per text channel. A bar above the message
list shows a cropped preview of the pinned message with a pin icon; clicking
it scrolls to and briefly highlights the original message in the channel
history. Only text channels are affected — voice-channel UI and layout must
be untouched by this change.

### Data Model

Add a nullable pointer from `Channel` to `Message` in
`apps/server/prisma/schema.prisma`:

```prisma
model Channel {
  // ...existing fields...
  pinnedMessageId String?
  pinnedMessage   Message? @relation("ChannelPinnedMessage", fields: [pinnedMessageId], references: [id], onDelete: SetNull)
}

model Message {
  // ...existing fields...
  pinnedInChannel Channel? @relation("ChannelPinnedMessage")
}
```

`onDelete: SetNull` on the relation means deleting the pinned message
automatically clears the pin **at the database level** — this is the
foundation for the confirmed "auto-unpin on delete" behavior; the app layer
additionally needs to broadcast the change so already-connected clients
update their UI in real time (the DB update alone doesn't reach a live
Socket.io room).

Requires `npx prisma migrate dev` (new migration) and `npx prisma generate`
in `apps/server`.

### Protocol (packages/shared-types/src/socket-events.ts)

New client→server events, modeled directly on the existing `UPDATE_CHANNEL`
pattern (permission-gated, ack-based, followed by a broadcast):

- `PIN_MESSAGE: (payload: { channelId: string; messageId: string }, ack) => void`
- `UNPIN_MESSAGE: (payload: { channelId: string }, ack) => void`

New server→client broadcast, modeled on `CHANNEL_TREE_UPDATE`'s
broadcast-based sync:

- `CHANNEL_PIN_UPDATED: (payload: { channelId: string; pinnedMessage: { id: string; content: string; authorNickname: string; createdAt: string } | null }) => void`

### Design Decisions

- **Permission:** gated by the existing `MANAGE_CHANNELS` flag, the same
  permission already used for channel rename and the NSFW toggle — pinning
  is channel-level content curation, consistent with that existing pattern.
  No new permission flag.
- **Replace behavior — confirmed with you:** pinning a new message while one
  is already pinned shows a confirmation prompt ("This will replace the
  currently pinned message — continue?") using the app's existing
  custom-modal component (never a native `confirm()`, which doesn't work in
  the Electron renderer — see the established pattern from Phase 3). On
  confirmation, the server performs a simple auto-replace (a single
  `PIN_MESSAGE` call overwrites `pinnedMessageId` unconditionally — no
  separate unpin step required server-side). If no message is currently
  pinned, pinning happens directly with no prompt.
- **Auto-unpin on delete — confirmed with you:** when a message is deleted
  (via the existing Phase 9 delete-message flow) and it was the channel's
  pinned message, the delete handler additionally broadcasts
  `CHANNEL_PIN_UPDATED` with `pinnedMessage: null` so all connected clients
  clear the bar immediately, in addition to the DB-level `SetNull`.
- **Server-log entry — confirmed with you:** pinning/unpinning posts a
  system-style line to the server log tab (e.g. `"Alice pinned a message in
  #general"` / `"Alice unpinned a message in #general"`), following the same
  event/broadcast convention already used for kick/ban and other moderation
  actions.
- **Jump-to-message across pagination.** Chat history is paginated
  (cursor-based `FETCH_MESSAGES`), so the pinned message may not currently
  be loaded in the DOM when the bar is clicked. Handling:
  - If the target message's `data-msg-id` element already exists in the DOM
    (it's within the currently loaded page), scroll directly to it with
    `scrollIntoView({ behavior: "smooth", block: "center" })`.
  - If not found, fetch a window of messages centered on the pinned message
    (extend `FETCH_MESSAGES` with an optional `aroundMessageId` parameter,
    or add a small new query path in `message.handler.ts` that selects N
    messages before/after the target by `createdAt`), replace the currently
    rendered page with that window, then scroll and highlight. This is a
    necessary implementation detail for "clicking the bar places the user
    directly onto the original message" to actually hold for pins made
    against older history, not just recently-scrolled-to messages.
  - Highlight: apply a temporary CSS class to the target message's DOM node
    producing a brief background flash (a couple of seconds), then remove
    the class — a new, self-contained animation, not reusing the active-
    speaker pulse (which is a different visual language for a different
    context).
- **Visibility of the pin/unpin control:** the pin icon button is added to
  the existing per-message action bar (alongside the edit/delete icons from
  Phase 9), but only rendered for users who currently have `MANAGE_CHANNELS`
  — reusing the same cached, connect-time permission check already used to
  decide Settings-modal admin-tab visibility (Phase 9 fix), not a live
  per-render permission query. Non-admin users see the pin bar (read-only)
  and can click it to jump to the message, but never see the pin/unpin
  button itself.
- **Scope guard — text channels only, and no voice-UI regressions.** The
  pinned-message bar is a new element prepended inside each `.tab-content`
  container, above `.chat-messages`, shown/hidden per the active tab's
  pinned state — it is not a global bar above `#tab-bar`, and it has no
  relationship to `#voice-panel` (a separate sibling in the layout). Voice
  channels have no text tab content and are therefore structurally
  unaffected; this should still be spot-checked during verification per your
  explicit caution about not breaking the voice experience while touching
  chat UI.
- **Bar content:** a single-line, ellipsis-truncated preview (~100
  characters) of the pinned message's content, prefixed with the pin SVG
  icon (14×14, same feather-icon convention as the edit/delete/pin-button
  icons, thumbtack path).

### Implementation

1. **`apps/server/prisma/schema.prisma`** — `Channel.pinnedMessageId` +
   relation as above; migration.
2. **`packages/shared-types/src/socket-events.ts`** — `PIN_MESSAGE`,
   `UNPIN_MESSAGE`, `CHANNEL_PIN_UPDATED`; extend `FETCH_MESSAGES`'s payload
   with an optional `aroundMessageId` if that approach is taken over a new
   dedicated event.
3. **`apps/server/src/handlers/channel.handler.ts`**
   - `PIN_MESSAGE`/`UNPIN_MESSAGE` handlers: `requirePermission(...,
     MANAGE_CHANNELS)`, validate the channel is a text channel and (for pin)
     that the message belongs to it, update `pinnedMessageId`, ack, broadcast
     `CHANNEL_PIN_UPDATED`, post the server-log line.
4. **`apps/server/src/handlers/message.handler.ts`**
   - Existing delete-message handler: after deletion, check whether the
     deleted message was the channel's pin; if so, broadcast
     `CHANNEL_PIN_UPDATED` with `null`.
   - `FETCH_MESSAGES` (or a new handler): support fetching a window of
     messages around a given `messageId` for the jump-to-pin case.
5. **`apps/client/src/preload.ts`**
   - `pinMessage(channelId, messageId)`, `unpinMessage(channelId)` bridge
     methods; `onChannelPinUpdated` event forwarding; extend the existing
     `fetchMessages` bridge (or add `fetchMessagesAround`) to match the new
     server capability.
6. **`apps/client/src/renderer/renderer.ts`**
   - Pin/unpin button in the per-message action bar, gated on cached
     `MANAGE_CHANNELS`.
   - Confirm-before-replace modal reusing the existing custom-modal
     component.
   - Pinned-bar render/update logic per tab, driven by `onChannelPinUpdated`
     and by the channel's pin state on initial tab open.
   - Click-to-jump: DOM lookup by `data-msg-id`, fallback fetch-and-replace
     for off-screen history, `scrollIntoView` + temporary highlight class.
7. **`apps/client/src/renderer/index.html`**
   - Pin SVG icon (message action bar + pinned bar), pinned-bar markup +
     CSS (prepended inside `.tab-content`), highlight-flash animation CSS.

### Files to Modify

| File | Change |
|:---|:---|
| `apps/server/prisma/schema.prisma` | `Channel.pinnedMessageId` + relation, migration |
| `packages/shared-types/src/socket-events.ts` | `PIN_MESSAGE`, `UNPIN_MESSAGE`, `CHANNEL_PIN_UPDATED`, `FETCH_MESSAGES` extension |
| `apps/server/src/handlers/channel.handler.ts` | Pin/unpin handlers, permission gate, broadcast, server-log line |
| `apps/server/src/handlers/message.handler.ts` | Auto-unpin broadcast on delete, around-message fetch support |
| `apps/client/src/preload.ts` | Pin/unpin + pin-update-event bridge methods |
| `apps/client/src/renderer/renderer.ts` | Pin button, confirm modal, pinned-bar rendering, click-to-jump + highlight |
| `apps/client/src/renderer/index.html` | Pin icon, pinned-bar markup/CSS, highlight animation |

### Verification

1. Server + client typecheck, existing vitest suite (add a small unit test
   for the pin/unpin permission gate alongside the existing
   `permissions.test.ts` patterns if practical).
2. As an admin, pin a message in a text channel — confirm the bar appears
   for all connected clients (including non-admins) in real time.
3. Pin a second message — confirm the replace-confirmation prompt appears,
   and confirming correctly swaps the bar to the new message.
4. As a non-admin, confirm no pin/unpin button is visible, but clicking the
   bar still jumps to the message.
5. Click the bar for a message still within the loaded page — confirm
   direct scroll + highlight. Scroll far up (or reload) to unload it, then
   click the bar again — confirm the fallback fetch-and-jump works for an
   off-screen pinned message.
6. Delete the pinned message (as its author, within the edit/delete window,
   or as an admin) — confirm the bar disappears for all connected clients
   without any manual unpin.
7. Confirm a system log line appears in the server log tab for both pin and
   unpin actions.
8. Join and use a voice channel throughout the above — confirm no layout or
   behavioral regression in the voice panel/session timer/occupant list.

---

## Cross-Cutting Dependencies & Implementation Order

None of these five items block each other structurally, but there's a
sensible ordering:

1. **PRD 11.1** (voice disconnects) first — highest priority per your
   explicit ranking, and the largest/riskiest item, so it benefits from the
   most runway before the phase wraps up.
2. **PRD 11.2** (timer) — touches the same general "voice panel" surface
   area as 11.1 (both live in `renderer.ts`'s voice-related rendering); doing
   it right after 11.1 means both are verified together in the same voice-
   channel testing pass rather than requiring two separate sessions.
3. **PRD 11.3** (emoji picker) — fully independent, low-risk, quick fix; can
   be done any time, including in parallel with the above if convenient.
4. **PRD 11.4** (update modal) — independent; shares no code with the other
   four items beyond general modal/localStorage conventions.
5. **PRD 11.5** (pin messages) — largest scope after 11.1, and the only item
   touching the Prisma schema and shared-types protocol; doing it last means
   its migration and new events are the final schema change before the
   version bump, minimizing the number of migrations needed between now and
   `1.4.0`.

`shared-types` must be rebuilt (`npx tsc --build`) after PRD 11.5's protocol
changes before the server/client workspaces will typecheck against them, per
the project's standard shared-types-first workflow.

---

## Open Decisions Confirmed With the User

- **PRD 11.1 scope:** comprehensive fix — auto-rejoin on reconnect, retuned
  ping/pong timeouts, ICE/connection-state monitoring on both ends, and
  removing the crash-the-whole-server behavior on a single mediasoup worker
  death — rather than only the single highest-likelihood fix (auto-rejoin
  alone).
- **PRD 11.2 depth:** proper client↔server clock-offset correction (reusing
  the existing ping/latency round-trip), not just a clamp hiding the visual
  symptom — the clamp is still included as a defense-in-depth safety net.
- **PRD 11.3 layout approach:** pin the custom-emoji tab in a fixed slot
  outside the scrollable category row, rather than widening the picker or
  wrapping the tab bar to two rows.
- **PRD 11.4 notes source:** fetch release notes live from the GitHub
  Releases API at runtime, rather than bundling a generated notes file into
  the app package at build time.
- **PRD 11.5 permission:** reuse the existing `MANAGE_CHANNELS` flag rather
  than introducing a new dedicated permission bit.
- **PRD 11.5 replace behavior:** show a confirmation prompt before replacing
  an existing pin, then auto-replace on confirmation (no separate
  unpin-first requirement).
- **PRD 11.5 delete behavior:** auto-unpin (bar disappears) when the pinned
  message is deleted, rather than showing a "message deleted" placeholder
  state.
- **PRD 11.5 logging:** pin/unpin actions post a system log line to the
  server log tab, consistent with existing moderation-action logging.
