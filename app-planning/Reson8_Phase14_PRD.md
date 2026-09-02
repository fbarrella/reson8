# Reson8 — Phase 14 PRD

**Created:** 01/09/2026
**Author:** Felipe B. Netto (assisted by AI)
**Status:** Draft — Pending Review
**Source:** `app-planning/nextsteps.txt`
**Branch:** `phase14-go`

---

## Table of Contents

1. [PRD 14.1 — Fix: Chat/DM Doesn't Open at the Most Recent Message](#prd-141--fix-chatdm-doesnt-open-at-the-most-recent-message)
2. [PRD 14.2 — Paginated Chat Loading (Cursor Pagination + Infinite Scroll Up)](#prd-142--paginated-chat-loading-cursor-pagination--infinite-scroll-up)
3. [PRD 14.3 — "Jump to Most Recent Message" Floating Button](#prd-143--jump-to-most-recent-message-floating-button)
4. [PRD 14.4 — Fix: DM "Wake Up" Sound Alert Not Playing (Intermittent)](#prd-144--fix-dm-wake-up-sound-alert-not-playing-intermittent)
5. [PRD 14.5 — Re-parent an Existing Channel](#prd-145--re-parent-an-existing-channel)
6. [PRD 14.6 — Rename a Parent Channel](#prd-146--rename-a-parent-channel)
7. [PRD 14.7 — Custom Icons for Text Channels](#prd-147--custom-icons-for-text-channels)
8. [PRD 14.8 — Fix: Rich Link Preview Failing on Bot-Walled Sites](#prd-148--fix-rich-link-preview-failing-on-bot-walled-sites)
9. [PRD 14.9 — Fix: Settings Modal Height Changes Per Tab](#prd-149--fix-settings-modal-height-changes-per-tab)
10. [PRD 14.10 — Self-Hear Mic Monitor](#prd-1410--self-hear-mic-monitor)
11. [PRD 14.11 — Fix: Own-Voice Active-Speaker Indicator Latency](#prd-1411--fix-own-voice-active-speaker-indicator-latency)
12. [PRD 14.12 — Fix: AI Noise Cancelling Too Aggressive (Voice Fades)](#prd-1412--fix-ai-noise-cancelling-too-aggressive-voice-fades)
13. [Cross-Cutting Dependencies & Recommended Implementation Order](#cross-cutting-dependencies--recommended-implementation-order)
14. [Open Decisions Confirmed With the User](#open-decisions-confirmed-with-the-user)

---

> [!IMPORTANT]
> Every implementation must be tracked and logged into `app-planning/progress.txt`
> using the `/log-progress` slash command immediately after the item is completed
> and verified, following the established `--- Entry: DD/MM/YYYY ---` format. After
> each item: stage the code and commit locally (no push — the user pushes
> manually), then **stop and wait for explicit confirmation** before starting the
> next item. Complex UI/UX testing is done by hand by the user, not by Claude.
>
> Only after every item below is implemented and confirmed: run `/bump-version`
> to bump the app version (SemVer — this phase is feature-additive, adds new
> DB columns/events, and is backward compatible, so a **minor** bump is
> expected pending the skill's own check), write the release notes into
> `app-planning/releases/`, and update all three `CLAUDE.md` files plus
> `README.md` to reflect the final Phase 14 feature set.

> [!NOTE]
> This PRD was written after five parallel research passes over the chat/
> pagination code (`renderer.ts`, `message.handler.ts`, `dm.handler.ts`,
> `socket-events.ts`), the sound-alert system, the channel-tree/settings
> subsystems (`schema.prisma`, `channel-tree.service.ts`, `channel.handler.ts`,
> the custom-emoji upload precedent), the link-preview system (`main.ts`,
> including a live fetch of the exact URL from the request and a real
> hidden-`BrowserWindow` experiment), and the voice/audio pipeline
> (`voice.service.ts`, `mediasoup.service.ts`) — not from a clean-slate
> reading of the roadmap text alone. File paths and line numbers below
> reflect the code as of 01/09/2026 (branch `phase14-go`, post-Phase-13) —
> re-check them if the surrounding code has moved by the time an item is
> implemented. Several points were genuinely ambiguous or newly-discovered
> during research; the ones resolved directly with the user are recorded in
> [Open Decisions](#open-decisions-confirmed-with-the-user) alongside the
> reasonable-default assumptions made for smaller items — review both lists
> and flag anything you'd rather change before implementation starts.

---

## PRD 14.1 — Fix: Chat/DM Doesn't Open at the Most Recent Message

**Type:** 🐛 FIX
**Priority:** High
**Affected Components:** Client only — `renderer.ts`.

### Root Cause (confirmed via audit)

`renderChatMessage`/`renderDmMessage` (`renderer.ts:3406, 3617`) set
`tab.messagesEl.scrollTop = tab.messagesEl.scrollHeight` after **every**
message appended during `loadChatHistory` (`renderer.ts:3265-3309`), and the
tab is switched to (made visible/laid-out) *before* history loads — so this
isn't a hidden-container measurement bug. The real problem is twofold:

1. Attachment `<img>` elements (`renderer.ts:3372, 3602`) have **no `load`
   listener** that re-applies `scrollTop` once an image finishes decoding and
   grows `scrollHeight` — only the async link-preview path currently
   re-corrects scroll on load. Since there is today **no pagination** (the
   client fetches the entire history in one shot — see PRD 14.2), a channel
   with real age can have dozens of images scattered through it, each
   finishing layout *after* the synchronous render loop already fixed
   `scrollTop` against a `scrollHeight` measured before those images loaded.
   The cumulative height added afterward pushes the true bottom down while
   `scrollTop` stays put — worse the more historical images sit below the
   fold. This matches the reported symptom ("opens a day or few days back")
   far better than a simple one-off race.
2. Reopening an **already-loaded** tab (`renderer.ts:3127-3130, 3200-3203`)
   just toggles CSS visibility and never re-scrolls — if the user had
   scrolled up earlier, switching away and back silently resumes at that
   stale position.

### Design Decisions

- After the initial render loop, wait for all just-inserted images to
  finish loading (`Promise.all` over each `<img>`'s `decode()`/`load` event,
  with a short timeout fallback so one slow/broken image can't hang the
  scroll-fix indefinitely) before doing a final authoritative
  `scrollTop = scrollHeight`.
- Explicitly force scroll-to-bottom every time a tab transitions from
  not-open → open, or is freshly created — never rely on whatever
  `scrollTop` happened to be left over from a prior session/switch.
- **Implement together with PRD 14.2**, not before/after it — both change
  the same scroll-management code inside `loadChatHistory`/
  `renderChatMessage`/`renderDmMessage`, and PRD 14.2 shrinks the initial
  page to 20 messages, which independently makes the image-count trigger
  for this bug much rarer (fewer images to wait on) even though the fix
  here is still worth having in its own right. See
  [Cross-Cutting](#cross-cutting-dependencies--recommended-implementation-order).

### Files to Modify

- `apps/client/src/renderer/renderer.ts` — `loadChatHistory`,
  `renderChatMessage`, `renderDmMessage`, the tab-open/tab-switch path.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): open a channel/DM with several older image attachments
  and confirm it opens scrolled all the way to the true latest message, not
  partway up; switch away from a tab you'd scrolled up in and back, confirm
  it resets to the bottom rather than resuming the old position.

---

## PRD 14.2 — Paginated Chat Loading (Cursor Pagination + Infinite Scroll Up)

**Type:** ✨ FEATURE
**Priority:** High
**Affected Components:** Client only — `renderer.ts`. **No server or
shared-types changes required** — see below.

### Current State (confirmed via audit — not from progress.txt's claim)

- `FETCH_MESSAGES` (`apps/server/src/handlers/message.handler.ts:181-263`)
  and `FETCH_DIRECT_MESSAGES` (`apps/server/src/handlers/dm.handler.ts:129-153`)
  **already** support a `before` (ISO timestamp) cursor + `limit` (capped at
  100, default 50), return ascending-chronological results, and there's even
  an `aroundMessageId` window-fetch mode used by pinned-message jump.
  `packages/shared-types/src/socket-events.ts:103` already documents this
  exact contract in its own doc comment. This was clearly built, then never
  wired up client-side — the same "declared but unwired" pattern the project
  hit before with `UPDATE_CHANNEL`/rename (Phase 9) and `CHANNEL_MOVED` (see
  PRD 14.5).
- The bottleneck is 100% client-side: `loadChatHistory` (`renderer.ts:3298`)
  calls `api.fetchMessages(tab.channelId)`/`api.fetchDirectMessages(partnerId)`
  with **no `before`/`limit` args at all** — full unbounded history (or an
  implicit default-50 single shot for DMs), every time a tab opens.
- **No infinite-scroll infrastructure exists anywhere in the client** — no
  scroll listeners, no `IntersectionObserver`, no "load more" pattern.
  `ChatTab` (`renderer.ts:1272-1287`) has no cursor/hasMore fields. This is a
  from-scratch client feature, not a wiring tweak.
- The pinned-message jump-to feature's history-loading behavior
  (`jumpToPinnedMessage`, `renderer.ts:4762-4787`) is the closest existing
  precedent — see PRD 14.3 for how it's reused there.

### Design Decisions

- Keep the existing `before`/`limit` cursor shape as-is — no server or
  shared-types changes needed.
- Initial page size: **20** for both channels and DMs (nextsteps.txt
  specifies 20 for channels; unified onto DMs too rather than leaving DMs on
  their current implicit 50 — see the DM unread-separator point below for
  why this needs a companion fix, and see
  [Open Decisions](#open-decisions-confirmed-with-the-user) since this
  specific unification wasn't explicitly asked for).
- `ChatTab` gains `oldestLoadedMessageId`/`oldestLoadedTimestamp` and
  `hasMoreOlder` fields.
- Scroll-up trigger: a sentinel element pinned to the top of the message
  list + `IntersectionObserver` (not a scroll-event/threshold check) — the
  standard, throttle-free chat-app pattern. On intersection (and while
  `hasMoreOlder` is true), fetch `before=<oldest loaded message's
  createdAt>`, `limit=20`, and prepend. Defensively skip any incoming
  message whose `id` is already in the DOM before prepending, in case of a
  same-millisecond cursor boundary edge case.
- **Scroll-position preservation on prepend (critical UX detail):** before
  inserting older messages above current content, record
  `messagesEl.scrollHeight`; after inserting, set
  `messagesEl.scrollTop += (newScrollHeight - oldScrollHeight)` so the
  user's visual anchor doesn't jump — the same technique Slack/Discord/Teams
  use. Apply this delta-correction independently for any image-load-driven
  height change within the newly-prepended batch too, not just the initial
  insert. This must be scoped to **only** the "load older" prepend path —
  the bottom-anchoring auto-scroll from PRD 14.1 must never fire during a
  prepend, or the two corrections will fight each other.
- **Date-section dividers need a lookback variant** for prepending: compute
  dividers based on the *oldest already-rendered* message's date, not the
  tab's forward-only `lastRenderedDateKey`, or a boundary divider could be
  duplicated or missing at the page seam.
- `jumpToPinnedMessage`'s full wipe-and-rebuild (`renderer.ts:4774`) must
  explicitly reset the new cursor/`hasMore` state whenever it rebuilds a
  tab, or the next scroll-up will either wrongly report "no more history" or
  duplicate messages already shown.
- **DM unread-separator regression:** the unread-divider logic
  (`renderer.ts:3276-3287`, `firstUnreadIndex`) scans whatever single batch
  was fetched. Shrinking DMs' initial page to 20 means a user with more than
  20 unread messages from one partner would see the divider missing or
  misplaced. Fix: when the known unread count for a DM exceeds the page
  size, expand that specific initial fetch to cover the full unread range
  (not hard-capped at 20) rather than accepting the regression — this
  project's explicit "don't break existing features" requirement applies
  directly here.

### Files to Modify

- `apps/client/src/renderer/renderer.ts` — `ChatTab` type, `loadChatHistory`,
  scroll-sentinel/`IntersectionObserver` wiring, prepend logic, date-divider
  lookback, DM unread-range fetch adjustment.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): open a channel/DM with well over 20 messages, confirm it
  opens on the latest 20 with no full-history load delay; scroll to the top
  and confirm the next chunk loads seamlessly with no visible jump; keep
  scrolling until real history is exhausted and confirm no further fetch
  attempts fire; confirm the "Unread Messages" divider still lands correctly
  on a DM with a large unread backlog from one partner.

---

## PRD 14.3 — "Jump to Most Recent Message" Floating Button

**Type:** ✨ FEATURE
**Priority:** Medium
**Affected Components:** Client only — `renderer.ts`, `index.html`.
**Depends on PRD 14.2** (reuses its scroll/sentinel infrastructure) — build
after, not in parallel.

### Design Decisions

- Precedent: `jumpToPinnedMessage` (`renderer.ts:4762-4787`) wipes
  `tab.messagesEl.innerHTML`, resets `tab.lastRenderedDateKey`, and rebuilds
  via a fresh `fetchMessages` call rather than trying to scroll through a
  potentially huge unloaded gap — this item follows the same shape for the
  "target isn't in the loaded DOM" case.
- Show the button once the newest message's element is no longer
  intersecting the viewport (reuse/extend the `IntersectionObserver` from
  PRD 14.2 with a bottom sentinel); hide it once back in view.
- Click behavior: if the newest message is already in the DOM (the common
  case — user only scrolled up a little), `scrollTo({ top: scrollHeight,
  behavior: "smooth" })`. If it isn't (deep history scroll after loading
  many older pages), rebuild the tab from a fresh latest-page fetch exactly
  like `jumpToPinnedMessage` does — resetting the PRD 14.2 cursor/`hasMore`
  state in the process — then scroll to bottom.
- Bottom-centered floating button, "Jump to Most Recent Message" label, a
  downward arrow icon, per the request.
- Landing at the bottom via this button clears the channel/DM's unread
  state the same way naturally scrolling to bottom / switching to the tab
  already does — treated as equivalent for read-state purposes.

### Files to Modify

- `apps/client/src/renderer/renderer.ts` — visibility logic, click handler.
- `apps/client/src/renderer/index.html` — button markup + CSS.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): scroll up in a long channel and confirm the button
  appears/disappears at the right moments and reliably jumps to the true
  latest message, including after crossing multiple loaded-older-page
  boundaries.

---

## PRD 14.4 — Fix: DM "Wake Up" Sound Alert Not Playing (Intermittent)

**Type:** 🐛 FIX
**Priority:** High
**Affected Components:** Client only — `renderer.ts`.

### Root Cause (confirmed via audit, high confidence — no live repro needed)

The `dm-received` handler (`renderer.ts:3628-3659`):

```js
const tab = chatTabs.get(tabKey);
if (tab) {
    renderDmMessage(tab, msg);
    ...
} else {
    if (msg.senderId !== myId) {
        openDmTab(partnerId, partnerNick);   // synchronously calls switchTab(tabKey)
    }
}
if (msg.senderId !== myId) {
    const isTabActive = activeTabId === tabKey;   // now stale/wrong
    const isFocused = await api.isWindowFocused();
    if (!isTabActive || !isFocused) SoundAlert.play("hey_wake_up.mp3");
}
```

`openDmTab()` calls `switchTab(tabKey)`, which sets `activeTabId = tabKey`
**synchronously, before** the `isTabActive` check below it runs. Exactly
when a DM tab doesn't already exist (first message from that partner, or a
previously-closed tab), the auto-open path flips `activeTabId` to the new
tab *before* the code asks "is this tab active?" — the answer is now
trivially "yes," regardless of whether the user was actually looking at it a
moment ago.

Net effect: the sound is suppressed only in the narrow combination of (a) a
new/reopened DM conversation **and** (b) the window being OS-focused (user
in-app, on some other tab). It plays correctly in every other case —
already-open tab (unaffected by `openDmTab`), or window unfocused (`!isFocused`
catches it regardless) — which is exactly why it reads as "intermittent"
rather than "always broken."

`main.ts`'s `is-window-focused` handler (`mainWindow?.isFocused()`) is fine
as-is — correctly ignores the screen-share Viewer window, no multi-window
bug there.

### Design Decisions

- Capture `isTabActive` (and `isFocused`) **before** calling `openDmTab()` —
  evaluate "was the user already looking at this" prior to the auto-open
  side effect, not after.

### Files to Modify

- `apps/client/src/renderer/renderer.ts` — the `dm-received` handler only.

### Regression Risk

`SoundAlert.play` is shared by ~20 other call sites (mute/deafen, kicks,
nudge, etc.) — untouched, since only this one handler's variable-capture
order changes. `nudge-received` has its own independent `isFocused` check
with no `openDmTab`-style auto-switch — not affected by this bug, don't
touch it.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): close/never-open a DM tab with a partner, keep the
  Reson8 window focused on a different channel, have that partner DM you —
  confirm the sound now plays every time; confirm it still plays correctly
  when the window is unfocused, and correctly stays silent when you're
  already looking at that exact open DM tab.

---

## PRD 14.5 — Re-parent an Existing Channel

**Type:** ✨ FEATURE
**Priority:** Medium
**Affected Components:** Both — `packages/shared-types`,
`apps/server/src/handlers/channel.handler.ts`, `apps/client/src/renderer/renderer.ts`.

### Current State (confirmed via audit)

- `Channel.parentId` is a plain self-referencing nullable FK
  (`schema.prisma:57`, `onDelete: SetNull`) — no cycle-prevention constraint
  at the DB level.
- `UPDATE_CHANNEL` (`channel.handler.ts:172-229`) does not accept `parentId`
  today — only `name`/`position`/`isNsfw`.
- **`packages/shared-types/src/socket-events.ts:52-56` already declares a
  `CHANNEL_MOVED` event** (`{channelId, newParentId, newPosition}`) in
  `ClientToServerEvents` — with **zero implementation** anywhere (no server
  handler, no client emit). Same "declared but unwired" pattern this project
  hit before with `UPDATE_CHANNEL`/rename in Phase 9.
- Drag-and-drop today (`renderer.ts:1429-1477`) only reorders within the
  *same* siblings array — no cross-parent drop exists client-side.
- `updateParentSelect`/`addParentOptions` (`renderer.ts:1756-1773`) already
  builds a flattened, indented parent-picker `<select>` for channel
  *creation* — directly reusable for a "move to" picker.

### Design Decisions

- Implement the already-declared `CHANNEL_MOVED` event server-side, rather
  than inventing a new one. The handler must:
  - Be gated by `MANAGE_CHANNELS`, like other channel mutations.
  - Reject `newParentId === channelId`.
  - Reject cycles: walk up from `newParentId`, rejecting the move if it's
    ever `channelId` itself or a descendant of it.
  - Recompute position within the new sibling set, then broadcast
    `CHANNEL_TREE_UPDATE` (same pattern as `REORDER_CHANNELS`).
- Client UI: a "Move to…" context-menu item next to Rename, opening a small
  modal that reuses the existing parent-`<select>` markup (consistent with
  the rename modal's own pattern) — rather than extending HTML5
  drag-and-drop to cross-parent drops, which has a much higher blast radius
  and would touch the sibling-set invariant `REORDER_CHANNELS` already
  relies on and tests.
- Moving a channel with active voice occupants or existing text history
  happens silently, with no confirmation modal — consistent with how
  rename/reorder already behave today. (The NSFW toggle's confirmation
  modal is a distinct case — a content-safety warning — not applicable
  here; see [Open Decisions](#open-decisions-confirmed-with-the-user).)

### Files to Modify

- `packages/shared-types/src/socket-events.ts` — verify/finalize the
  existing `CHANNEL_MOVED` payload shape.
- `apps/server/src/handlers/channel.handler.ts` — new handler, cycle-check.
- `apps/client/src/renderer/renderer.ts` — "Move to…" menu item + modal.
- `apps/client/src/preload.ts` — expose a `moveChannel` method.

### Verification

- `npx tsc --build` in `packages/shared-types`, then `npx tsc --noEmit` in
  `apps/server` and `apps/client`.
- Manual (by user): move a channel between two different parents, move a
  channel to top-level and back, attempt to move a channel into its own
  descendant and confirm it's rejected with a clear error toast, confirm the
  live tree updates on all connected clients.

---

## PRD 14.6 — Rename a Parent Channel

**Type:** ✨ FEATURE (smaller than it looks — mostly a UI gap, no schema/server change)
**Priority:** Low/Medium
**Affected Components:** Client only — `renderer.ts`, `index.html`.

### Current State (confirmed via audit)

There is no distinct category/parent `ChannelType` — `ChannelType` is only
`TEXT | VOICE` (`schema.prisma:47-50`). A "parent channel" is simply any
channel (text or voice) that currently has `children.length > 0`.
`renderCategory()` (`renderer.ts:1405-1414, 1479-1509`) is used instead of
`renderChannel()` whenever a node has children, and it only wires
collapse-toggle + drag-reorder — **no context menu is attached at all**, so
Rename/NSFW-toggle/Delete/Move-to are simply unreachable once a channel
gains a child, even though server-side `UPDATE_CHANNEL` rename already works
unconditionally for any channel ID today.

A latent gap was also found in the same code: a dead comment
(`renderer.ts:1504-1506`, "categories can also be voice channels users can
join") describes behavior that was never implemented — a voice channel that
becomes a parent silently stops being joinable/showing occupants, with
nothing in the UI acknowledging this.

### Design Decisions

- Attach the same context-menu (Rename, Delete, Move-to from PRD 14.5; NSFW
  toggle only when `type === TEXT`, gated exactly as it is today) to
  `renderCategory()`'s label element. No schema or server change is
  needed — rename already works unconditionally server-side.
- Per the confirmed decision below: a voice channel that becomes a parent
  **stays non-joinable** (no scope expansion into restoring occupancy), but
  the UI must now visibly badge it as a category instead of silently
  dropping its join affordance with no explanation.

### Files to Modify

- `apps/client/src/renderer/renderer.ts` — `renderCategory()` context-menu
  wiring, category badge.
- `apps/client/src/renderer/index.html` — minor CSS for the badge.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): rename a channel, then add a child to it so it becomes a
  category, and confirm Rename/Delete/Move-to are still reachable; confirm a
  voice channel with children now shows a clear "category" badge instead of
  silently losing its join button.

---

## PRD 14.7 — Custom Icons for Text Channels

**Type:** ✨ FEATURE
**Priority:** Medium
**Affected Components:** Both — `schema.prisma` (migration),
`apps/server/src/routes/upload.route.ts`, `apps/server/src/handlers/channel.handler.ts`,
`apps/client/src/renderer/renderer.ts`.

### Current State (confirmed via audit)

`Channel`/`IChannel` has no icon field; `renderChannel()` hardcodes
`icon = isVoice ? "🔊" : "💬"` (`renderer.ts:1518-1520`). The direct, almost
exact precedent is the custom-emoji upload flow: `/api/upload/emoji`
(`upload.route.ts`) already caps at `MAX_EMOJI_FILE_SIZE = 512 * 1024` —
**exactly** the 512KB this request specifies — via a dual local-disk/
Cloudinary backend and a generic `handleUpload()` helper. The crop tool
(`renderer.ts:5416-5499` — cover+pan+zoom, 220×220 viewport → 128×128
output) is implemented against hardcoded emoji-modal DOM/state, not a
generalized component. Crucially, channel icons are admin-only via
`MANAGE_CHANNELS` already (the same gate as rename/NSFW/delete) — unlike
custom emoji, which any member can upload — so **no approval queue is
needed** here, a meaningful simplification versus the emoji precedent.

### Design Decisions

- Schema: add nullable `Channel.iconEmoji String?` and
  `iconUrl`/`iconPublicId String?` (mutually exclusive — emoji mode vs.
  upload mode), migrated the same way `isNsfw`/`pinnedMessageId` were added.
- `UPDATE_CHANNEL` gains `iconEmoji`/`iconUrl` fields, enforced **TEXT-only**
  server-side exactly like `isNsfw` is today (reject if applied to a
  `VOICE` channel).
- New REST route `/api/upload/channel-icon` reusing
  `handleUpload(app, req, reply, MAX_EMOJI_FILE_SIZE)`, `MANAGE_CHANNELS`-gated.
- Client: **duplicate** (not generalize) the emoji crop-modal pattern for a
  channel-icon crop modal — consistent with this codebase's established
  duplication-over-premature-abstraction convention, and this is only the
  second use of this exact pattern, so a shared abstraction isn't yet
  justified.
- Icon picker UI in the channel edit modal offers two options: "Choose
  Emoji" (reuses the existing 552-entry emoji picker as-is — no curated
  subset) or "Upload Image" (opens the new crop modal, 512KB cap, square
  output).
- Replacing/removing an uploaded icon (switching back to emoji, or deleting
  the channel) must call the existing `deleteAttachment()`-style cleanup in
  `storage.service.ts` to avoid orphaned files, exactly like message/emoji
  deletion already does.

### Files to Modify

- `apps/server/prisma/schema.prisma` (+ migration)
- `apps/server/src/routes/upload.route.ts` — new route
- `apps/server/src/handlers/channel.handler.ts` — `UPDATE_CHANNEL` validation
- `packages/shared-types/src/socket-events.ts` + `models.ts` — new fields
- `apps/client/src/renderer/renderer.ts` — icon rendering, edit modal, crop
  modal duplication
- `apps/client/src/preload.ts` — upload method

### Verification

- `npx tsc --build` in `packages/shared-types`, then `npx tsc --noEmit` in
  `apps/server` and `apps/client`.
- Manual (by user): set a channel's icon via emoji, then via image upload —
  confirm crop/preview/512KB-rejection work, confirm the icon renders
  correctly in the channel tree for all connected clients, confirm it's
  impossible to set an icon on a voice channel, confirm replacing/removing
  an uploaded icon doesn't leave orphaned files on disk/Cloudinary.

---

## PRD 14.8 — Fix: Rich Link Preview Failing on Bot-Walled Sites

**Type:** 🐛 FIX
**Priority:** Medium
**Affected Components:** Client only (Electron main process) — `main.ts`.

### Investigation (confirmed via a live fetch of the exact URL, not guessed)

The current implementation (`main.ts`) is already reasonably robust: a bot
User-Agent, a 5s timeout, default redirect-following, metascraper
(`-title`/`-description`/`-image`/`-url`/`-video`) plus a manual OG/Twitter-card
fallback for whatever metascraper misses.

Fetching the exact OLX URL from `nextsteps.txt` directly with the app's own
bot User-Agent returned **HTTP 403** — a Cloudflare block page
("Attention Required! | Cloudflare"). Retesting with a full, realistic
desktop-Chrome User-Agent (plus Accept/Accept-Language headers) **still**
returned the identical 403/Cloudflare block. This rules out "missing/wrong
header" as the cause — it's IP-reputation/TLS-fingerprint-based bot
management on Cloudflare's side, not something a plain Node `fetch()` can
get past by changing what it sends, regardless of plugin/header tuning.

**Heavier-fix experiment (pursued per the confirmed decision below):**
tested a hidden Electron `BrowserWindow` (the repo's own bundled Electron
34.5.8, zero new dependency — Electron already ships a full Chromium)
navigating to the real URL under a headless (`xvfb-run`) display. **It
worked.** `did-finish-load` fired at ~6.2s; extraction (after a short settle
delay) pulled genuine OG/Twitter-card metadata — real title, description,
price, and a real `img.olx.com.br` image URL — with zero Cloudflare block
markers in the page body. `navigator.webdriver` read back `false`: Electron's
default `BrowserWindow` doesn't expose the automation flag that Cloudflare/
bot-management commonly fingerprints on CDP-controlled browsers. Total round
trip was ~10.2s including the settle delay — this cannot complete
synchronously with a chat message being sent.

### Design Decisions

- Keep the existing plain-`fetch()` + metascraper + OG-fallback path as the
  **first** attempt — cheap, fast, and already works for the vast majority
  of links.
- Only when that first attempt returns non-2xx **or** finds none of
  title/description/image/OG tags, fall back to spinning up a hidden
  (`show: false`, sandboxed, `contextIsolation: true`) `BrowserWindow`,
  navigating to the URL, waiting for `did-finish-load` + a short settle
  delay, then `executeJavaScript` to extract `document.title` + OG/
  Twitter-card meta tags (+ JSON-LD if present) — always `win.destroy()` in
  a `try/finally`, so a failure/timeout can never leak a renderer process.
  Hard timeout: 15s on the whole fallback attempt.
- Since this can't complete synchronously with message send, it follows the
  existing async-update precedent (`injectLinkPreview` already re-corrects
  the preview card after the fact for video embeds): post the message
  immediately with no/minimal preview, then patch in the rich preview once
  the fallback resolves.
- **Resource safety:** cap concurrent hidden-window fallback fetches at a
  small number (e.g. 2) client-wide, with any additional requests either
  briefly queued or skipped (falling back to no preview) rather than
  spawning unbounded renderer processes if multiple blocked links get
  pasted at once — a full Chromium renderer per invocation is genuinely
  expensive and must not become a resource-exhaustion vector against the
  user's own client. (See [Open Decisions](#open-decisions-confirmed-with-the-user) — this
  cap value is a reasonable default, not something explicitly requested.)

### Files to Modify

- `apps/client/src/main.ts` — `fetch-link-preview` IPC handler: add the
  `BrowserWindow` fallback path + concurrency guard.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): paste the exact OLX URL from `nextsteps.txt` and confirm
  a rich preview now appears (title/price/image); paste an already-working
  link (e.g. YouTube) and confirm no behavior change (the fast path still
  succeeds, so the fallback never triggers); paste several bot-walled links
  in quick succession and confirm the app doesn't spawn unbounded hidden
  windows or hang the UI.

---

## PRD 14.9 — Fix: Settings Modal Height Changes Per Tab

**Type:** 🐛 FIX
**Priority:** Low
**Affected Components:** Client only — `index.html` (CSS only).

### Root Cause (confirmed via audit — one CSS rule)

`.modal-content.wide` (`index.html:1715-1720`) sets `max-height: 70vh` (a
**cap**, not a fixed height) with `display: flex; flex-direction: column`.
`.settings-panel { flex: 1; overflow-y: auto }` (`index.html:1934-1938`) is
already correct — but since the parent only caps height, a short tab (e.g.
About) shrinks the whole modal to fit-content, while a long tab (e.g. User
Management's list) expands up to the 70vh cap. That's the entire bug.

`.modal-content.wide` is **shared** by four modals (Screen Share source
picker, "What's New", Settings, and one more to confirm at implementation
time) — the other three are meant to size-to-content (a short "What's New"
post shouldn't force a tall empty box), so the shared class must not be
touched.

### Design Decisions

- Scope the fix specifically to the settings modal, e.g.
  `#admin-modal .modal-content.wide { height: 70vh; max-height: none; }`,
  leaving the shared rule untouched for the other three modals.

### Files to Modify

- `apps/client/src/renderer/index.html`

### Verification

- `npx tsc --noEmit` in `apps/client` (CSS/markup-only, included for
  completeness).
- Manual (by user): switch between every Settings tab and confirm the
  modal's outer height stays fixed — a short tab shows empty space, a long
  tab scrolls internally — and confirm the other three modals sharing
  `.modal-content.wide` are visually unaffected.

---

## PRD 14.10 — Self-Hear Mic Monitor

**Type:** ✨ FEATURE
**Priority:** Medium
**Affected Components:** Client only — `voice.service.ts`, `renderer.ts`,
`index.html`.

### Current State (confirmed via audit)

The mic graph (`voice.service.ts:957-996`, `buildMicProcessingGraph()`):
`micSourceNode → [noiseCancelNode] → gateGainNode → volumeGainNode →
micDestinationNode → produce()`. The final processed signal sits on
`volumeGainNode`. The deafen/mute state machine (`toggleDeafen()`,
`voice.service.ts:909-937`) auto-mutes on deafen (remembering only if it had
to) and undeafen restores exactly that — **not directly reusable as-is**:
if the user is already deafened before enabling self-hear, calling
`toggleDeafen()` again would *undeafen* them, which is wrong. Outside a
voice channel, `startPreview()` (`voice.service.ts:1214-1256`) builds only
`audioContext` + analyser — no gate/volume/noise-cancel chain, so self-hear
standalone needs that chain extended into preview mode to actually reflect
live settings (the entire point of the feature). Local playback already has
a separate `AudioContext` (`getPlaybackAudioContext()`,
`voice.service.ts:808-813`) — self-hear should tap the **send-side**
context directly, not the playback one, to avoid cross-context routing.

### Design Decisions (per the confirmed decision: full UI — toggle + volume slider + banner)

- Add a `monitorGainNode` connected from `volumeGainNode` (post
  noise-cancel/gate/volume — the true "how you'll sound to others" signal)
  to `audioContext.destination`, gated by a new `setSelfHearEnabled(enabled)`
  method, with its **own** independent monitor-volume gain — a dedicated
  slider, separate from mic-volume and from global voice-chat volume.
- In-channel: on enable, capture "was I already muted" / "was I already
  deafened" **before** forcing anything; force mute+deafen only for
  whichever wasn't already true; on disable, restore only what self-hear
  itself forced. This needs two new flags (`_selfHearForcedMute`,
  `_selfHearForcedDeafen`) — a variant of the existing
  `_deafenAutoMuted` pattern, not a reuse of `toggleDeafen()` verbatim, to
  avoid incorrectly undeafening a user who was already deafened beforehand.
- Show a visible "Previewing — you're muted & deafened" banner in the voice
  control area while self-hear is active and the user is in a channel, so
  the forced mute+deafen doesn't read as a bug to the user or to others
  they're voice-chatting with.
- Out-of-channel: extend preview mode to also build the gate+volume+
  noise-cancel chain (not just the analyser), so self-hear genuinely
  reflects live noise-gate/mic-volume/noise-cancelling adjustments.
- Teardown: leaving the voice channel while self-hear is active, or closing
  Settings, must tear down the monitor node in `cleanup()`/
  `leaveVoiceChannel()` so it never leaks into the next join.

### Files to Modify

- `apps/client/src/services/voice.service.ts` — monitor node, forced-mute/
  deafen flags, preview-mode graph extension.
- `apps/client/src/renderer/renderer.ts` — toggle + slider + banner wiring.
- `apps/client/src/renderer/index.html` — new Voice & Shortcuts UI, banner
  markup/CSS.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): enable self-hear while in a voice channel and confirm
  you hear your own processed mic, are shown muted+deafened to other
  participants, and other participants' audio doesn't play through your
  speakers while previewing; disable it and confirm your exact prior
  mute/deafen state is restored (including when you were already deafened
  before enabling); enable self-hear outside any voice channel and confirm
  it still reflects live noise-gate/mic-volume/noise-cancel adjustments.

---

## PRD 14.11 — Fix: Own-Voice Active-Speaker Indicator Latency

**Type:** 🐛 FIX
**Priority:** Medium
**Affected Components:** Client only — `renderer.ts` (`voice.service.ts`
already exposes what's needed).

### Root Cause (confirmed via audit)

The server's `AudioLevelObserver` (`mediasoup.service.ts:194-207`) polls
every 100ms and broadcasts `ACTIVE_SPEAKERS` — genuinely necessary for
*other* users, since their audio really does arrive via the server, but for
the **local** user this adds a full needless round-trip (encode → SFU →
observer interval → broadcast → decode). `renderer.ts`'s `active-speakers`
handler (`renderer.ts:2627-2659`) applies/removes the `.speaking` class for
every ID in the broadcast, local user included, with no special-casing
today. A ready-made local analyser loop already runs continuously while in
voice: `startMicLevelMeter()` (`renderer.ts:5972-5982`) → `getCurrentLevel()`
(`voice.service.ts:1127-1129`) → `readAnalyserLevel()` on the post-noise-cancel
analyser, via `requestAnimationFrame` — the exact node the noise gate
already uses for its own threshold logic.

### Design Decisions

- Reuse this existing loop (not the server-driven path) to derive a local
  "is speaking" boolean via a dB threshold, and apply/remove `.speaking`
  directly on the local user's own `.tree-occupant` element immediately,
  client-side only.
- Threshold source: reuse the noise gate's own `sensitivityThreshold` when
  the gate is enabled (consistent "gate-open = speaking" behavior); fall
  back to a fixed default (-50dB, matching the server observer's own
  threshold) when the gate is disabled. (Flagged as an assumption — see
  [Open Decisions](#open-decisions-confirmed-with-the-user).)
- In the `active-speakers` handler, skip processing entries where
  `userId === myId` — the local override owns that element exclusively —
  so an instant local update and a 100ms-delayed server one never fight
  over the same class.

### Files to Modify

- `apps/client/src/renderer/renderer.ts` — `active-speakers` handler
  local-user skip; new local-VAD-driven class toggle hooked into the
  existing mic-level animation-frame loop.

### Regression Risk

Don't touch `active-speakers` handling for other users; don't remove the
local user from the server-side `speakers` array (the server may still need
it) — only skip it client-side for DOM purposes.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): speak and confirm your own halo appears with no
  perceptible delay versus before; confirm other participants' halos remain
  completely server-driven and unaffected; confirm consistent behavior
  whether or not the noise gate is enabled.

---

## PRD 14.12 — Fix: AI Noise Cancelling Too Aggressive (Voice Fades)

**Type:** 🐛 FIX
**Priority:** High
**Affected Components:** Client only — `voice.service.ts`, `renderer.ts`,
`index.html`.

### Root Cause (confirmed via audit, not guessed)

The vendored `deepfilternet3-noise-filter` package exposes a public
`setSuppressionLevel(level: number)` method (0–100 scale,
`node_modules/deepfilternet3-noise-filter/dist/index.d.ts:26-42`) —
`voice.service.ts:105-109` constructs `DeepFilterNet3Core` with
`noiseReductionLevel: 100` (hardcoded to maximum) and never adjusts it
afterward anywhere in the file. Max suppression is exactly what would cause
quiet/paused speech to fade toward silence: the model has no signal to
distinguish "quiet speech" from "silence" at full strength.

### Design Decisions (per the confirmed decision: user-adjustable slider)

- Add a "Noise Cancelling Strength" slider (0–100) in Voice & Shortcuts,
  next to the existing Noise Cancelling toggle, styled consistently with
  the mic-volume/mic-sensitivity sliders.
- Calls `noiseCancelCore.setSuppressionLevel(value)` live — a plain runtime
  call, **not** a graph rewire, so it doesn't touch the fragile ESM/
  `dynamicImport` interop (`resolveNoiseCancelModuleUrl`) at all.
- Default to a more moderate value (~60) rather than 100, persisted to
  `localStorage` under the existing `reson8-*` convention (e.g.
  `reson8-noise-cancel-strength`).
- Verify at implementation time whether the level needs to be reasserted
  after a bypass/unbypass cycle (`setSuppressionLevel` is separate from the
  existing `SET_BYPASS` postMessage toggle used by `setNoiseCancelEnabled()`,
  `voice.service.ts:1181`) — not a known bug, just an interaction to confirm.

### Files to Modify

- `apps/client/src/services/voice.service.ts` — `setSuppressionLevel`
  wiring, default value change.
- `apps/client/src/renderer/renderer.ts` — slider wiring, `localStorage`
  persistence.
- `apps/client/src/renderer/index.html` — new slider markup.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- Manual (by user): confirm the slider audibly changes suppression strength
  live while noise cancelling is enabled; confirm a moderate default (~60)
  no longer fades a paused/quiet voice to silence the way 100 did; confirm
  the value persists across restarts; confirm toggling noise cancelling off
  and back on doesn't silently reset the level to something unexpected.

---

## Cross-Cutting Dependencies & Recommended Implementation Order

Section numbers above follow `nextsteps.txt`'s original order for easy
cross-referencing. The **build order** below differs where dependencies or
risk-sequencing make that worthwhile — a recommendation, not a requirement.

1. **PRD 14.1 and PRD 14.2 together, first** — both rewrite the same
   scroll-management code inside `loadChatHistory`/`renderChatMessage`/
   `renderDmMessage`; doing them as one combined pass avoids writing
   bottom-anchor/top-anchor scroll logic twice, and PRD 14.2's smaller
   initial page size independently reduces PRD 14.1's trigger frequency.
2. **PRD 14.3** next — depends directly on PRD 14.2's `IntersectionObserver`
   sentinel infrastructure.
3. **PRD 14.4** (DM sound fix) is fully independent, a small ordering fix —
   good candidate to slot in anytime, including early for a quick win.
4. **PRD 14.6 before PRD 14.5** — 14.6 is the smaller, lower-risk, UI-only
   change that establishes a context-menu on category/parent nodes; 14.5
   then adds the new "Move to…" modal and server `CHANNEL_MOVED` handler on
   top of that same context-menu.
5. **PRD 14.7** is independent of 14.5/14.6 but touches the same channel
   edit modal — fine to interleave, no hard ordering requirement.
6. **PRD 14.8** (link preview) is fully independent, main-process only —
   good candidate for anytime.
7. **PRD 14.9** (settings height) is fully independent and trivial —
   good quick win anytime.
8. **PRD 14.12 → 14.11 → 14.10**, in that order, for the three voice-graph
   items — mirrors the Phase 13 precedent of doing the highest-complexity
   audio-graph change last, once the surrounding code has been touched and
   verified stable by the smaller items first:
   - 14.12 is the simplest (one new runtime call, no graph change).
   - 14.11 reuses the existing analyser loop with no graph changes.
   - 14.10 is the highest complexity of the three (new graph node,
     forced-mute/deafen state, preview-mode extension) — do it last.
9. Whenever PRD 14.5 or PRD 14.7 change `packages/shared-types`, remember to
   run `npx tsc --build` there before typechecking `apps/server`/
   `apps/client` — repo convention.

No two items modify the exact same function in a conflicting way, so this
order is a suggestion for risk/complexity pacing, not a strict correctness
requirement.

---

## Open Decisions Confirmed With the User

Five points were genuinely ambiguous, newly-discovered during research, or
had more than one reasonable path — confirmed directly with the user before
this PRD was finalized:

1. **Noise-cancelling fix shape (PRD 14.12):** rather than just lowering the
   hardcoded suppression value, **decision: add a user-adjustable
   "Noise Cancelling Strength" slider** (default ~60), since the right
   strength is inherently mic/environment-dependent and the vendored
   package already exposes the exact knob needed.
2. **Self-hear UI scope (PRD 14.10):** rather than a bare toggle reusing the
   existing output volume, **decision: add a dedicated monitor-volume
   slider plus a visible "Previewing — muted & deafened" banner** while
   self-hear is active.
3. **Voice-channel-becomes-a-parent gap (PRD 14.6):** this latent gap (a
   voice channel with children silently stops being joinable, with a dead
   code comment describing intent that was never built) wasn't in the
   original request. **Decision: badge it as read-only/category in the UI**
   rather than restoring full voice functionality or leaving it silently
   unexplained.
4. **OLX link-preview scope (PRD 14.8):** the specific URL is blocked by a
   Cloudflare bot wall that a plain `fetch()` cannot get past regardless of
   headers. **Decision: pursue the heavier fix** — a hidden Electron
   `BrowserWindow` fallback, verified working in a real experiment against
   the exact URL — rather than reframing the item as generic graceful
   degradation only.
5. **Archiving the Phase 13 PRD:** already done prior to this PRD being
   drafted — `Reson8_Phase13_PRD.md` was already in `app-planning/archive/`
   at the start of this phase, so no action was needed here.

### Assumptions Made From Research Recommendations (please flag any disagreement during review)

These weren't put to a direct decision point, but reflect a specific
research recommendation rather than an arbitrary guess — call out any of
these you'd rather change before implementation starts:

- **PRD 14.2:** DM pagination unified onto the same 20-message initial page
  as channels (rather than DMs' current implicit 50), with the unread-range
  fetch expanded as needed to keep the unread divider correct.
- **PRD 14.3:** landing at the bottom via "Jump to Most Recent" clears
  unread state, same as a natural scroll-to-bottom/tab-switch.
- **PRD 14.7:** the "choose a default emoji" icon option reuses the full
  existing 552-entry emoji picker, not a curated subset.
- **PRD 14.8:** hidden-`BrowserWindow` fallback fetches are capped at 2
  concurrent, to bound the resource cost of spinning up full Chromium
  renderers.
- **PRD 14.9:** the settings modal's fixed height stays at 70vh (matching
  the existing cap it currently only approaches), rather than a specific
  pixel value.
- **PRD 14.11:** the local speaking-detection threshold reuses the noise
  gate's own `sensitivityThreshold` when the gate is enabled, falling back
  to a fixed -50dB default when the gate is off.
