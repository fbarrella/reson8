# Reson8 — Phase 16 PRD

**Created:** 07/10/2026
**Author:** Felipe B. Netto (assisted by AI)
**Status:** Draft — Pending Review
**Source:** `app-planning/nextsteps.txt` (8 items) + the five reference screenshots in `app-planning/` (`print_discord_*.png`) + two upload-pipeline issues found during the audit and added at the user's request (PRD 16.8, 16.9)
**Branch:** `phase16-go`

---

## Table of Contents

1. [PRD 16.1 — Chore: "Don't Warn Me Again" for NSFW Channels](#prd-161--chore-dont-warn-me-again-for-nsfw-channels)
2. [PRD 16.2 — Chore: Optional Image Blurring in NSFW Channels (Per User)](#prd-162--chore-optional-image-blurring-in-nsfw-channels-per-user)
3. [PRD 16.3 — Chore: Highlight the Text Channel Being Viewed (Eye Icon)](#prd-163--chore-highlight-the-text-channel-being-viewed-eye-icon)
4. [PRD 16.4 — Feat: Mute Text Channels (Per User, Client-Side)](#prd-164--feat-mute-text-channels-per-user-client-side)
5. [PRD 16.5 — Refactor: Floating Message Action Toolbar (Foundation for 16.6 and 16.11)](#prd-165--refactor-floating-message-action-toolbar-foundation-for-166-and-1611)
6. [PRD 16.6 — Chore: Group Consecutive Messages + Header Layout + HH:MM Timestamps](#prd-166--chore-group-consecutive-messages--header-layout--hhmm-timestamps)
7. [PRD 16.7 — Feat: Emoji Autocomplete While Typing `:name`](#prd-167--feat-emoji-autocomplete-while-typing-name)
8. [PRD 16.8 — Security Fix: Server-Side Upload Ownership (Stored-File Ledger + Upload Tokens)](#prd-168--security-fix-server-side-upload-ownership-stored-file-ledger--upload-tokens)
9. [PRD 16.9 — Fix: Orphaned Upload Cleanup (Discard, Sweeper, Channel Delete, One-Time Prune)](#prd-169--fix-orphaned-upload-cleanup-discard-sweeper-channel-delete-one-time-prune)
10. [PRD 16.10 — Chore: Multi-Image Upload, Persistent Previews, Preview Viewer, Drag & Drop](#prd-1610--chore-multi-image-upload-persistent-previews-preview-viewer-drag--drop)
11. [PRD 16.11 — Feat: Message Replies (Channels and DMs)](#prd-1611--feat-message-replies-channels-and-dms)
12. [Cross-Cutting Dependencies & Recommended Implementation Order](#cross-cutting-dependencies--recommended-implementation-order)
13. [Open Decisions Confirmed With the User](#open-decisions-confirmed-with-the-user)
14. [Pre-Existing Issues Noticed During the Audit](#pre-existing-issues-noticed-during-the-audit)
15. [Mapping to `nextsteps.txt`](#mapping-to-nextstepstxt)

---

> [!IMPORTANT]
> Every implementation must be tracked and logged into `app-planning/progress.txt`
> using the `/log-progress` slash command immediately after the item is completed
> and verified, following the established `--- Entry: DD/MM/YYYY ---` format. After
> each item: stage the code and commit locally (**no push**, the user pushes
> manually), then **stop and wait for explicit confirmation** before starting the
> next item. Complex UI/UX testing is done by hand by the user, not by Claude.
>
> Only after every item below is implemented and confirmed: run `/bump-version`
> (SemVer: this phase adds user-facing features, three additive DB migrations,
> additive wire-format fields and a security fix, all backward compatible with
> v2.4.0 clients/servers,
> so a **minor** bump to `2.5.0` is expected, pending the skill's own check), write
> the release notes into `app-planning/releases/`, and update all three `CLAUDE.md`
> files plus `README.md` to reflect the final Phase 16 feature set.
>
> **Non-regression rule:** no item may change behavior outside its stated scope.
> Each item's "Regression Risk" section lists exactly what it touches. Verification
> for every item always includes `npx tsc --noEmit`/`--build` in each affected
> workspace (shared-types → server → client, in that order), `npm run test` for
> server items, and `npm run test:markdown` (in `apps/client`) for any item that
> touches message rendering.

> [!NOTE]
> This PRD was written after reading every `nextsteps.txt` item, the five reference
> screenshots, and auditing the code each item touches: `renderer.ts`, `index.html`,
> `preload.ts`, `main.ts`, `markdown.ts`, `message.handler.ts`, `dm.handler.ts`,
> `emoji.handler.ts`, `channel.handler.ts`, `upload.route.ts`, `storage.service.ts`, `index.ts`, `schema.prisma`, and the shared-types
> event maps/models. File paths and line numbers reflect the code as of 07/10/2026
> (branch `phase16-go`, post-Phase-15, v2.4.0). Re-check them if the surrounding
> code has moved by the time an item is implemented; items 16.5–16.11 all edit the
> same message-rendering or upload regions of `renderer.ts`, so line numbers *will* drift
> between them. Nine design decisions were resolved directly with the user (see
> [Open Decisions](#open-decisions-confirmed-with-the-user)); the remaining
> reasonable-default assumptions are listed there too. Flag anything you'd rather
> change before implementation starts.

> [!NOTE]
> **Archiving:** every completed PRD (phases 1–15) was already in
> `app-planning/archive/` when this phase started (`Reson8_Phase15_PRD.md` was
> archived with the phase 14–15 condensation commit `09012a2`), so no archive move
> was needed. This file lives at `app-planning/Reson8_Phase16_PRD.md` while active
> and gets moved to `archive/` when Phase 16 wraps up.

---

## PRD 16.1 — Chore: "Don't Warn Me Again" for NSFW Channels

**Type:** 🧹 CHORE
**Priority:** Low
**Affected Components:** Client only: `index.html` (NSFW modal + Settings → Application), `renderer.ts`. No server or wire-format change.

### Current Behavior

- Clicking an NSFW text channel in the tree (`handleChannelClick()`, `renderer.ts:1965`, NSFW branch at ~`:2047`) stores the node in `pendingNsfwChannel`, fills `#nsfw-confirm-channel-name` and shows `#nsfw-confirm-modal` (`index.html:3691`).
- **Continue** (`btnNsfwConfirm`, `renderer.ts:~2600`) opens the tab via `openChatTab()` and re-renders the tree. **Cancel** or a backdrop click just closes the modal.
- The prompt shows on **every** click, including when the tab is already open in the background (re-focusing an open NSFW tab from the tree re-prompts). Tab-bar clicks go straight to `switchTab()` and never prompt.

### Goal

Let a user tick **"Don't warn me again for NSFW channels"** inside the warning. Once it is ticked and they press Continue, **no NSFW channel** shows the warning again: clicking one opens it like any other chat. The choice must be reversible from Settings.

### Design

1. **The modal** gets a checkbox row between the text and the buttons:
   ```
   🔞 NSFW Channel
   #memes is marked as Not Safe For Work. Are you sure you want to open it?
   [ ] Don't warn me again for NSFW channels
                                         [Cancel] [Continue]
   ```
   - Reuse the existing modal checkbox styling (the Create Channel modal's NSFW checkbox row, `#new-channel-nsfw-row`, is the closest precedent) so it matches.
   - The checkbox is **reset to unchecked every time the modal opens**.
   - The preference is saved **only when Continue is pressed with the box ticked**. Cancel and backdrop-close discard the tick. A user who says "don't ask again" and then cancels did not actually agree to open anything.
2. **Persistence:** `localStorage` key `reson8-nsfw-warning-dismissed` = `"true"`. Absent or anything else means warn (the default). This follows the client's `reson8-*` convention (`apps/client/CLAUDE.md`). It is per install, matching every other client preference, since identity is per install anyway.
3. **Reversal:** a new **"Content"** section in Settings → Application (`index.html:4145`, placed after "Sound") with a toggle row in the existing `.toggle-row` markup:
   - Title: **Warn before opening NSFW channels**
   - Description: *Ask for confirmation before opening a channel marked NSFW*
   - **Checked = warn**, i.e. the inverse of the stored key, so the switch reads naturally. Default checked.
   - Takes effect immediately on `change`, like the tray toggles (no Save button involved; the Settings Save button only stages audio devices).
   - The settings panel syncs the checkbox from `localStorage` every time it opens, because the modal can change the value while Settings is closed.
   - PRD 16.2 adds a second row to this same "Content" section.

### Implementation Steps

1. **`index.html`:** add the checkbox row (`<label class="…"><input type="checkbox" id="chk-nsfw-dont-warn"> Don't warn me again for NSFW channels</label>`) to `#nsfw-confirm-modal`; add the "Content" section label and the `chk-nsfw-warn` toggle row to the Application panel.
2. **`renderer.ts`:**
   - Add a small accessor pair near the NSFW modal block (`~:1231`): `isNsfwWarningEnabled(): boolean` / `setNsfwWarningEnabled(enabled: boolean)`, with every `localStorage` access wrapped in `try/catch` (default: enabled).
   - `handleChannelClick()`: change the NSFW branch condition to `if (node.isNsfw && isNsfwWarningEnabled() && !chatTabs.has(node.id))`. The `!chatTabs.has(...)` part means re-focusing an *already-open* NSFW tab from the tree no longer re-prompts: the user already confirmed for that tab's lifetime. This is a small friendliness fix inside the same branch. It only applies to a tab the user already opened.
   - Reset `chk-nsfw-dont-warn` when the modal is shown.
   - `btnNsfwConfirm`: if the checkbox is ticked, call `setNsfwWarningEnabled(false)` *before* opening the tab.
   - Settings: initialize `chk-nsfw-warn` in `openSettingsPanel()` and wire its `change` listener to `setNsfwWarningEnabled(checked)`.

### Edge Cases

- **A channel becomes NSFW while its tab is open:** with the `!chatTabs.has` rule the open tab keeps working without a prompt. Closing and reopening it prompts (if warnings are on). That is acceptable and matches the "already confirmed this tab" reasoning.
- **Storage unavailable:** the `try/catch` falls back to "warn", the safe default.

### Regression Risk

Touches only the NSFW branch of `handleChannelClick()`, the NSFW modal, and a new Settings row. Voice-channel clicks, non-NSFW text clicks, and the NSFW tree badge are untouched.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- **Manual (user):**
  1. Click an NSFW channel and press Cancel with the box ticked → the next click still warns.
  2. Tick the box and press Continue → the channel opens; another NSFW channel now opens with no prompt.
  3. Settings → Application → "Warn before opening NSFW channels" is shown unchecked; check it → warnings return.
  4. Restart the app → the preference persists.
  5. With warnings on, open an NSFW channel, click another channel, then click the NSFW one in the tree again → no re-prompt while its tab is still open.

---

## PRD 16.2 — Chore: Optional Image Blurring in NSFW Channels (Per User)

**Type:** 🧹 CHORE
**Priority:** Low
**Affected Components:** Client only: `index.html` (CSS + Settings → Application), `renderer.ts`.

### Current Behavior

`buildChatMessageElement()` (`renderer.ts:4044`, NSFW block at `~:4072`) wraps every image in an NSFW channel in `.msg-image-nsfw-wrap`. The image gets `filter: blur(20px)` (`index.html:963`) and an `.msg-image-nsfw-overlay` ("NSFW. Click to open image and reveal content.") whose click opens the lightbox. DM images are never blurred, and that stays unchanged.

### Goal

A per-user toggle in **Settings → Application → Content**: **"Blur images in NSFW channels"**, **on by default**. On: today's behavior, exactly. Off: NSFW-channel images render like any other image, unblurred and with no overlay; clicking still opens the viewer.

### Design: CSS-driven, applies live

The blur becomes a body-level class instead of a render-time branch, so flipping the toggle updates **every already-rendered message instantly** with no re-render or scroll jump:

```css
body.nsfw-blur-off .msg-image-nsfw-wrap .msg-image { filter: none; transform: none; }
body.nsfw-blur-off .msg-image-nsfw-overlay { display: none; }
```

The render code keeps always wrapping NSFW images exactly as now, so turning the toggle back on re-blurs everything immediately too. The wrap's own `cursor: pointer` and the image's existing click → `openLightbox(...)` handler keep working once the overlay is hidden, because the overlay sat *on top of* the image and the image itself already has the click listener.

### Implementation Steps

1. **`index.html`:** add the two CSS rules above next to the existing NSFW thumbnail block (`~:952`). Add the toggle row `chk-nsfw-blur` (title **Blur images in NSFW channels**, description *Hide images in NSFW channels behind a blur until you open them*) to the "Content" section created in 16.1.
2. **`renderer.ts`:**
   - `reson8-nsfw-blur-images` key: absent or `"true"` → blur, `"false"` → no blur (default on). Accessor with `try/catch`, like 16.1.
   - `applyNsfwBlurPreference()`: `document.body.classList.toggle("nsfw-blur-off", !enabled)`. Call it once at startup next to the other preference initializers (the tray-prefs block, `~:7300`) and on the toggle's `change`.
   - Sync the checkbox in `openSettingsPanel()`.

### Edge Cases

- Admin toggles a channel's NSFW flag while it's open: pre-existing behavior (already-rendered messages keep their original wrapping until the tab is rebuilt) is unchanged and out of scope.
- PRD 16.10 renders multiple images per message and **must keep wrapping each NSFW image in `.msg-image-nsfw-wrap`** so this toggle covers them too (called out in 16.10's regression section).

### Regression Risk

CSS override only, plus one body class. The default (on) state is byte-for-byte today's rendering.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- **Manual (user):** open an NSFW channel with images → blurred. Turn the toggle off → they unblur instantly with no overlay, and clicking opens the viewer. Turn it on → blurred again instantly. Restart → the preference persists. DM images are unaffected either way.

---

## PRD 16.3 — Chore: Highlight the Text Channel Being Viewed (Eye Icon)

**Type:** 🧹 CHORE
**Priority:** Low
**Affected Components:** Client only: `renderer.ts`, `index.html` (CSS).

### Current Behavior

- `.tree-channel:hover` gets `background: rgba(79,195,247,0.08)` (`index.html:293`).
- `.tree-channel.active` (`index.html:310`, `--accent-dim` background) marks the **voice** channel you're connected to (`renderChannel()` → `currentChannelId === node.id`, `renderer.ts:1654`). Text channels never get `.active`.
- Nothing in the tree marks which text channel's tab is currently shown.

### Goal

The text channel whose chat tab is **currently active** gets a highlight similar to (slightly stronger than) the hover highlight, plus a small **eye SVG icon** on the row's right side in a muted color, meaning "currently viewing this channel".

### Design

- New class **`.tree-channel.viewing`**. A separate name avoids colliding with the voice `.active` semantics.
  - `background: rgba(79, 195, 247, 0.12)`: one step above hover (0.08) so it reads as selected, and below `.active`'s `--accent-dim` so a joined voice channel still stands out more.
  - Hover on a `.viewing` row keeps the `.viewing` background (no flicker darker/lighter).
- **Eye icon:** `<span class="ch-viewing-icon" title="You're viewing this channel" aria-label="Currently viewing">` with an inline 13×13 Feather-style eye SVG (the same path as the NSFW overlay's eye, `renderer.ts:4082`), `color: var(--text-muted)`, `opacity: 0.75`, `flex-shrink: 0`. It is appended **last** in the row, so `.ch-name`'s `flex: 1` pushes it to the far right after any unread dot or NSFW badge.
- "Viewed" means `activeTabId === node.id` (the chat tab is the active tab). Switching to the Server Log or a DM tab removes the highlight; closing the tab removes it.

### Implementation Steps

1. **`index.html`:** add the `.tree-channel.viewing` and `.ch-viewing-icon` rules.
2. **`renderer.ts`:**
   - `renderChannel()`: for text channels, if `node.id === activeTabId` add `viewing` and append the icon span.
   - New `updateViewingIndicator()`: removes `.viewing` and the icon from whatever row has them, then adds both to `.tree-channel[data-channel-id="${CSS.escape(activeTabId)}"]` if that row exists. This is a **targeted DOM update, not a `renderTree()`**: a full re-render loses collapsed-category state (the reason `markChannelUnread()` avoids it, `renderer.ts:4337`).
   - Call `updateViewingIndicator()` at the end of `switchTab()`. `closeTab()` already funnels through `switchTab()` when the active tab is closed.

### Regression Risk

Additive class and icon; `switchTab()` gains one trailing call. Voice `.active` styling, drag-reorder (`.drag-over`), unread dot, and NSFW badge are unaffected.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- **Manual (user):** open a text channel → highlighted with an eye on the right. Switch to the Server Log / a DM → highlight gone. Switch back → it returns. Close the tab → it's gone. Collapse a category, switch tabs → the category stays collapsed. A joined voice channel still shows its stronger highlight.

---

## PRD 16.4 — Feat: Mute Text Channels (Per User, Client-Side)

**Type:** ✨ FEATURE
**Priority:** Medium
**Affected Components:** Client only: `renderer.ts`, `index.html` (CSS). No server or wire-format change. Muting is a personal, local preference ("only to the user, on its own client" per `nextsteps.txt`), so no permission and no persistence on the server.

### Current Behavior

- Channel-message unread state is tracked entirely client-side: `MESSAGE_RECEIVED` → `markChannelUnread()` (`renderer.ts:4338`) adds the id to `unreadChannelIds` and paints the `.unread` class (bold name) and a red `.unread-dot`. On join, the server's per-user `hasUnread` seeds the same set (`renderChannel()`, `:1700`). There is **no sound or taskbar flash for channel messages**, only the dot and bold name. DMs have their own separate notification path, which stays untouched.
- The channel context menu (`attachChannelContextMenu()`, `:1732`) is shown to everyone, with admin-gated actions rejected server-side.

### Goal

Any user can right-click a **text channel** and choose **Mute Channel** / **Unmute Channel**. A muted channel:
- never shows the unread dot or bold "unread" name;
- is rendered **faded** (icon and name), almost like "disabled", but stays fully clickable and openable.

### Design

- **Context menu:** for text, non-category rows only (`node.type === "TEXT"` and it was rendered by `renderChannel()`, i.e. it has no children; a text channel with children is a category and can't be opened as a chat). The new item goes **first**, followed by a thin separator, then the existing admin items:
  - `🔕 Mute Channel` / `🔔 Unmute Channel` (the existing items use emoji prefixes, so this matches).
  - Separator: a new `.ctx-menu-divider` (1px `var(--border)` line, 4px vertical margin).
- **Faded rendering:** `.tree-channel.muted .ch-icon, .tree-channel.muted .ch-name { opacity: 0.45; }`, and `0.7` on hover so the user can still read what they're about to click. It combines with `.viewing` (16.3): a muted channel you're reading keeps the faded text on the highlighted row.
- **Unread while muted:** the client **keeps tracking** unread in `unreadChannelIds` (and the server's read cursor keeps working), but **suppresses the visuals** while muted. Unmuting a channel that received messages meanwhile shows its dot again, which is Discord's behavior and means no information is silently lost.
- **Persistence:** `localStorage` key `reson8-muted-channels` = JSON `{ [serverId]: string[] }`. Keyed by server so connecting to another Reson8 server doesn't mix lists. All reads and writes go through one accessor with `try/catch` and JSON-shape validation; malformed data is treated as empty.
- **Pruning:** on every non-empty `channel-tree` update (`renderer.ts:2895`), drop muted ids for the current server that no longer exist in the tree, so deleted channels don't accumulate.

### Implementation Steps

1. **`renderer.ts`:**
   - `mutedChannelIds: Set<string>`, loaded for `currentServerId` on `connected`; `isChannelMuted(id)`, `setChannelMuted(id, muted)` (persists, then calls `applyChannelMuteState(id)`).
   - `renderChannel()`: if muted, add `.muted` and **don't** add `.unread` or the `.unread-dot`, even when `unreadChannelIds.has(id)`.
   - `markChannelUnread()`: still `unreadChannelIds.add(id)`, but return before touching the DOM if muted.
   - `applyChannelMuteState(id)`: a targeted DOM update (toggle `.muted`; add or remove `.unread` and the dot according to `unreadChannelIds` and the mute state). No `renderTree()`.
   - `attachChannelContextMenu(el, node, isLeafTextChannel)`: pass a flag from `renderChannel()` (true for text) and `renderCategory()` (false), and render the mute item and separator only when it's set.
   - Prune in the `channel-tree` handler.
2. **`index.html`:** `.tree-channel.muted` rules, `.ctx-menu-divider`.

### Edge Cases

- **Opening a muted channel** marks it read normally (`switchTab()` → `markChannelRead()`), no change.
- **Muting the channel you're viewing:** fine; it fades and stays highlighted.
- **Join-time `hasUnread` for a muted channel:** seeded into the set, but not displayed.

### Regression Risk

The context-menu signature changes (one call site each in `renderChannel`/`renderCategory`). The unread pipeline only gains a "don't paint" guard; the set, `markChannelRead()`, and the server cursor are unchanged. Voice channels and categories don't get the item.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- **Manual (user):**
  1. Right-click a text channel → "Mute Channel" is first, above a separator. It doesn't appear on voice channels or category rows.
  2. Mute it → it fades. Have another user post there → no dot, no bold.
  3. Unmute → the dot appears (messages arrived meanwhile).
  4. Restart and reconnect → still muted.
  5. Mute a channel, have an admin delete it → it is pruned from storage (DevTools → Application → Local Storage).
  6. Collapse a category, then mute/unmute a channel → the category stays collapsed.

---

## PRD 16.5 — Refactor: Floating Message Action Toolbar (Foundation for 16.6 and 16.11)

**Type:** 🔧 REFACTOR (user-approved, enabling change)
**Priority:** High (blocks 16.6 and 16.11)
**Affected Components:** Client only: `renderer.ts` (`buildReactionBar`, `attachEditButton`, `attachPinButton`, `updatePinBarUI`, `updateReactionBar`, message element builders), `index.html` (CSS).

### Why This Exists

Today the message actions (react, edit, pin, delete) are appended **inside** `.msg-reactions` (`buildReactionBar()`, `renderer.ts:5889`), and that bar has `min-height: 20px` (`index.html:990`) on **every** message so the hover-only buttons have somewhere to appear. That is why every message carries a fixed empty strip under it. It directly contradicts the grouping item (16.6): *"even though the grouped messages are vertically close, whenever a reaction is added, the space respective to the reactions section should be reinstated"*. It also leaves no good place for 16.11's Reply button. The user approved moving the actions into a floating hover toolbar like the one in `print_discord_grouped_messages.png`.

This item is purely structural: **every existing action keeps working exactly as before**. It just moves.

### Design

- **Message element** gets `position: relative`. A new `.msg-actions` toolbar (`role="toolbar"`, `aria-label="Message actions"`) is appended to every `.chat-msg`:
  - `position: absolute; top: -14px; right: 8px; z-index: 2;` background `var(--bg-secondary)`, `1px solid var(--border)`, `border-radius: 6px`, a soft shadow, `padding: 2px`, `display: flex; gap: 2px`.
  - Hidden by default (`opacity: 0; pointer-events: none`). Shown on `.chat-msg:hover`, `.chat-msg:focus-within` (keyboard access), and while `.chat-msg.actions-open` is set. That class is set while this message's reaction picker is open, so the toolbar doesn't vanish when the pointer moves into the picker. It is cleared in `closeEmojiPicker()` (`renderer.ts:6568`).
  - **Near the top edge:** if a message's top is within ~18px of its scroll container's visible top, the toolbar would be clipped. On `mouseenter`, add `.actions-inside` (`top: 2px`) when `el.getBoundingClientRect().top - messagesEl.getBoundingClientRect().top < 18`.
  - Buttons: 26×26, 16px Feather-style SVG icons, `aria-label` + `title` on each, hover background `rgba(255,255,255,0.08)`. Delete hovers to `var(--danger)` as today.
  - **Order (left → right):** React · *(Reply, added in 16.11)* · Edit (own, within the 2-min window) · Pin (channels only) · Delete (own). This mirrors the reference's order (react → edit → reply → more).
- **Row hover tint:** `.chat-msg:hover { background: rgba(255,255,255,0.03); }` with a small negative horizontal margin and matching padding, so the user sees which line the toolbar applies to. This is essential once 16.6 packs lines tightly.
- **Reaction bar becomes reactions-only:**
  - `.msg-reactions` holds only the pills plus, *when at least one pill exists*, a trailing small "add reaction" button (the same smiley SVG, the Discord pattern).
  - With zero reactions the bar is `display: none` (`.msg-reactions:not(.has-reactions)`). **This is the space-reclaim the grouping item requires**: the strip appears only when there are reactions and is "reinstated" the moment one is added (the `reaction-updated` → `updateReactionBar()` rebuild toggles `.has-reactions`).
  - `min-height: 20px` is removed.
- **Pinned indicator:** today the active pin button stays visible without hovering (`.btn-pin-msg.active { opacity: 1 }`) so you can see which message is pinned. Since the toolbar is now hidden until hover, a pinned message instead gets `.chat-msg.is-pinned`, which shows a small persistent pin icon (`.msg-pin-indicator`, 12px, `var(--accent)`) at the message's top-right, hidden while the toolbar is visible. `updatePinBarUI()` (`:6089`) already finds the old and new pinned elements; it now also toggles `.is-pinned` on them.

### Implementation Steps

1. **Split `buildReactionBar()`** into:
   - `buildReactionBar(msgId, isDm, reactions)`: pills + the trailing add button when non-empty, and sets `.has-reactions`. Keeps `data-react-bar` and `reactionPillData` / hover-card behavior (PRD 15.11) intact, including `hideReactionCard()` on rebuild.
   - `buildMessageActions(msgId, isDm, ownerId)`: the toolbar with React (opens `openReactionPicker(msgId, isDm, btn)` and sets `actions-open`) and Delete (own messages → `showDeleteMessageModal`).
2. **`attachEditButton()` / `attachPinButton()`** take the **toolbar** instead of the reaction bar (the signature's `bar` parameter becomes `toolbar`). Insertion order must follow the design order above. Use `insertBefore` relative to the Delete button rather than plain `append`, so 16.11 can slot Reply in deterministically. The edit button's 2-minute self-removal timer is unchanged.
3. **`updateReactionBar()`** (`:5968`) no longer needs `data-msg-owner` to rebuild owner-only buttons, since the bar no longer contains any. Simplify accordingly (keep the attribute itself; 16.6 uses it).
4. **Both builders** (`buildChatMessageElement` `:4044`, `buildDmMessageElement` `:4387`) append the reaction bar *and* the toolbar.
5. **`attachMessageTruncation()`** (`:4215`) still inserts "See more" before `.msg-reactions`. The bar is always present in the DOM (just hidden when empty), so this keeps working unchanged.
6. **CSS:** remove the four `.btn-*` "opacity 0 until `.chat-msg:hover`" blocks (`index.html:1092-1195`) in favor of toolbar-scoped `.msg-actions button` rules. Keep the class names `.btn-react`, `.btn-edit-msg`, `.btn-pin-msg`, `.btn-delete-msg` on the buttons; other code (`updatePinBarUI`, the edit timer) queries them.

### Regression Risk

**Medium**: this touches every message's DOM. Everything that queries message internals must be re-checked: `updatePinBarUI` (`.btn-pin-msg`), `updateReactionBar` (`[data-react-bar]`), `attachMessageTruncation` (`.msg-reactions`), the reaction hover card (`reactionPillFrom`), `startMessageEdit`/`applyMessageEdit` (`.msg-text`, `.msg-time`), `removeMessageElement`, and `jumpToPinnedMessage` (`.msg-highlight`). None of them change behavior; they must simply still find their elements.

### Verification

- `npx tsc --noEmit` in `apps/client`; `npm run test:markdown`.
- **Manual (user):** in a channel **and** a DM:
  1. Hover a message → the toolbar appears top-right; the row tints.
  2. React via the toolbar → the reaction strip appears and the add button sits after the pills.
  3. Remove the last reaction → the strip disappears and the message shrinks back.
  4. Edit your own fresh message → the edit button disappears after 2 minutes.
  5. Pin/unpin → the pin indicator follows, and the pinned bar still jumps.
  6. Delete your own message.
  7. The first message right under the tab's top edge shows its toolbar inside, not clipped.
  8. The reaction hover card still works.
  9. "See more" still sits above the reactions.
  10. Tab through a message with the keyboard → the toolbar appears (`:focus-within`).

---

## PRD 16.6 — Chore: Group Consecutive Messages + Header Layout + HH:MM Timestamps

**Type:** 🧹 CHORE
**Priority:** Medium
**Depends on:** 16.5
**Affected Components:** Client only: `renderer.ts` (message builders, append/prepend/delete paths, edit paths), `index.html` (CSS). Applies to **channel and DM** chats ("all of the apps text chats"). The Server Log tab is unchanged.

### Current Behavior

Every message is one inline line: `<span.msg-time>HH:MM:SS</span>[(edited)]<span.msg-nick>nick</span><span.msg-text>…` (`buildChatMessageElement()` `:4044`, `buildDmMessageElement()` `:4387`). The time comes from `new Date(createdAt).toLocaleTimeString()`, which includes seconds.

### Goal (user-approved layout: Discord-style header)

```
barrella  23:32
This is my first message
This is my second message        ← grouped: no repeated nick/time
This is my third message

fenetto  23:40
hey!
```

- **Header line:** nickname (accent, semibold) + time **HH:MM** (muted, small). The full date and time are in the time's `title` (`toLocaleString([], { dateStyle: "medium", timeStyle: "short" })`).
- **Grouping rule** (pure function `canGroupWith(prev, cur)`): a message becomes a *continuation* (no header) when **all** of the following hold:
  1. The immediately preceding DOM sibling is a `.chat-msg`. A date divider (`.date-separator`), the "Unread Messages" separator (`.unread-separator`), or the top sentinel in between breaks the group naturally.
  2. Same author (`data-msg-owner`).
  3. `cur.createdAt − groupStart(prev) < 5 min` (`GROUP_WINDOW_MS = 5 * 60 * 1000`), measured **from the group's first message** (user decision). A group never spans more than 5 minutes, so the header time stays meaningful.
  4. `cur.createdAt ≥ prev.createdAt` (defensive against clock skew).
  5. `cur` is **not a reply** (16.11: a reply always starts a new group with its own header, matching `print_discord_reply2.png`). Until 16.11 lands, this condition is a no-op.
- **Continuation timestamp:** a continuation shows no visible time. Its `.msg-body` carries a `title` with the full date/time, so hovering the text reveals when it was sent. (The project has no avatar gutter, so Discord's hover-time-in-the-gutter has no place to go; a native tooltip on the text keeps the layout unchanged.)
- **Reactions:** unchanged behavior. Thanks to 16.5, a continuation with no reactions takes only its text line; adding a reaction shows its strip directly under that line (the "space reinstated" requirement).
- **"(edited)" label:** moves from after the time to **after the message text** (`.msg-edited` inline at the end of `.msg-body`), the Discord placement. A continuation has no header to hold it, so this is the only consistent spot for both message kinds.
- **Spacing:** a group start gets `margin-top: 8px` (except the first message after a divider or sentinel); a continuation gets `padding: 1px 0`. `.chat-messages` keeps its `gap: 2px`, and continuation rows use `margin-top: -2px` to cancel it, so lines sit as tightly as in the reference.

### DOM Structure (both builders)

```html
<div class="chat-msg msg-group-start|msg-continuation"
     data-msg-id data-msg-type data-msg-owner
     data-created-at="ISO" data-group-start="ISO">
  <!-- 16.11: .msg-reply snippet goes here -->
  <div class="msg-header">                        <!-- always rendered; hidden by CSS on continuations -->
    <span class="msg-nick">nick</span><span class="msg-time" title="full date">23:32</span>
  </div>
  <div class="msg-body" title="(continuations only) full date">
    <span class="msg-text">…</span><span class="msg-edited">(edited)</span>
  </div>
  <!-- attachments, link preview, "See more", .msg-reactions, .msg-actions (16.5) -->
</div>
```

Rendering the header **always** and hiding it with `.msg-continuation .msg-header { display: none }` makes re-grouping a class toggle, which the delete and prepend paths below need.

### Where Grouping Must Be (Re)computed

1. **Append** (`renderChatMessage` `:4100`, `renderDmMessage` `:4423`, which serve the initial load, live messages, `rebuildTabAtLatest`, and the jump-to-message rebuild): after `maybeInsertDateDivider()`, compare against `tab.bottomSentinelEl.previousElementSibling` and set the classes plus `data-group-start` (inherit the previous message's when grouped, otherwise its own `createdAt`).
2. **Prepend** (`prependOlderMessages` `:4149`): compute grouping in forward order within the batch while building. After insertion, **re-evaluate the junction**: the previously-first message may now continue the batch's last message. Call `regroupRun(oldFirstEl)`.
3. **Delete** (`removeMessageElement` `:2647`): capture `el.nextElementSibling` before removal, then `regroupRun(next)`. Deleting a group's head promotes the next line to head. Deleting the only message *between* two runs by the same author can merge them (A1, B1, A2 → delete B1 → A2 joins A1's group if within 5 minutes of A1).
4. **`regroupRun(startEl)`:** walks forward from `startEl` while siblings are `.chat-msg`, recomputing each one's state from its previous sibling. It stops at the first non-message sibling or after the author changes. Bounded work, and correct because a changed `groupStart` can cascade (a former continuation may now exceed the 5-minute window and must become a head).
5. **Edit** never changes grouping. `startMessageEdit()` (`:6420`) and `applyMessageEdit()` (`:6491`) must insert `(edited)` at the end of `.msg-body` instead of after `.msg-time`.

### HH:MM

A single helper `formatMessageTime(iso)`: `new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })`. This respects the OS 12/24-hour locale the same way the current seconds-format does. Replace the two `toLocaleTimeString()` calls in the builders. The Server Log's own timestamps are a separate code path and stay unchanged.

### Interactions to Preserve

- **Solo-emoji messages** (`msg-text-solo-emoji`, PRD 13.14), **Markdown block vs inline** (`msg-text-block`, PRD 15.10), and **long-message truncation** (`attachMessageTruncation`) all operate on `.msg-text` and are unaffected. The inline/block distinction no longer changes *where* text starts, since it is always below the header, but keeps its clamp CSS.
- **Jump highlight** (`.msg-highlight`) applies to the single message row, not the whole group.
- **Unread separator** in DMs (`:3814`) breaks a group, which is correct: the first unread message shows a header.
- **Link previews** and attachments stay inside their own message row.

### Regression Risk

**Medium-high**: this is the most visible change in the phase and touches every chat path (append, prepend, live, jump, rebuild, delete, edit). Each must be hand-verified. No server change.

### Verification

- `npx tsc --noEmit` in `apps/client`; `npm run test:markdown`.
- **Manual (user), in a channel and a DM:**
  1. Send 3 quick messages → one header, three lines.
  2. Wait over 5 minutes from the *first* and send again → new header.
  3. Another user posts in between → new header.
  4. Messages across midnight → the date divider splits the group.
  5. React to the middle line → its strip appears under it only.
  6. Delete the head → the next line gains the header.
  7. Delete the lone middle message between two same-author runs → they merge if within 5 minutes.
  8. Scroll up to load older pages → no duplicate header at the page junction.
  9. Jump to a pinned message and use "Jump to Most Recent" → grouping is correct after each rebuild.
  10. Edit → "(edited)" sits after the text.
  11. Times show HH:MM; hovering the header time or a continuation's text shows the full date/time.
  12. Solo-emoji, Markdown blocks, and "See more" still look right.

---

## PRD 16.7 — Feat: Emoji Autocomplete While Typing `:name`

**Type:** ✨ FEATURE
**Priority:** Medium
**Affected Components:** Client only: `renderer.ts`, `index.html` (markup + CSS). No server change.

### Current Behavior

Emoji are inserted only via the picker (`insertEmojiAtCursor()`, `:6772`). Custom emoji can be typed as `:name:` (rendered by `markdown.ts`'s `reson8_emoji` rule) if you remember the name; Unicode emoji have no typed form. A `:snake_name:` derivation for Unicode emoji already exists for the reaction card (`emojiShortName()`, `:5719`: `"face with tears of joy"` → `:face_with_tears_of_joy:`).

### Goal (per `print_discord_emoji_autocomplete.png`)

Typing `:` followed by a **letter** in the chat box opens a floating card **right above the colon**, listing matching emoji (**illustration on the left, `:name:` on the right**). It filters as you type and closes when nothing matches, when a closing `:` is typed, or on the usual dismissals. It covers **both custom and Unicode emoji**.

### Behavior Spec

- **Trigger:** on `input`/`keyup`/`click` (caret moves), inspect the text **before the caret** with
  `/(?:^|[\s([{"'])(:([a-zA-Z][a-zA-Z0-9_+-]{0,31}))$/`.
  - The colon must be at the start or after whitespace or an opening bracket/quote. This prevents false triggers on `http://`, `10:30`, `a:b`.
  - The first character after the colon must be a letter (per `nextsteps.txt`); the query is everything after the colon.
  - Ignored while `e.isComposing` (IME).
- **Matching** (case-insensitive, at most **10 results**, then ranked):
  1. name **starts with** the query;
  2. a name **word** (split on `_`) starts with the query;
  3. a **keyword** starts with the query (this is how `:laug` finds 🤣 `:rolling_on_the_floor_laughing:` via its keywords, like `:rofl:` in the reference);
  4. name **contains** the query.

  Ties: custom emoji first (server-specific, the ones people can't otherwise discover), then shorter names. Sources: `customEmojis` (approved only, `:name:` as-is) and `EMOJI_DATA` (`:snake_name:` via the same normalization as `emojiShortName()`, extracted into a shared `toEmojiSnakeName(name)` so both stay in sync). The Unicode index is built once, lazily; the custom list is read live each query, since it's small and can change via `custom-emoji-approved`.
- **Card** (`#emoji-autocomplete`, one shared element, like the reaction card):
  - Header: **`EMOJI MATCHING :laug`** (small, uppercase, muted, like the reference's "RESULTADOS DE EMOJIS PARA :LAUG").
  - Rows: emoji (22px; a custom emoji is an `<img class="custom-emoji-img">`) then `:name:` (text, ellipsized). The active row has an accent-tinted background.
  - Width 280px; `max-height` = min(320px, space available above); scrolls internally; the active row is kept in view with `scrollIntoView({ block: "nearest" })`.
  - `role="listbox"`; rows `role="option"` with `aria-selected`; the textarea gets `aria-expanded`, `aria-controls`, `aria-activedescendant` while open.
- **Positioning ("right where the colon was typed, without breaking app boundaries"):**
  - Compute the colon character's on-screen coordinates inside the `<textarea>` with the standard **mirror-div technique** (the approach of the widely used `textarea-caret-position` component). Mirror the textarea's computed font, padding, border, width, line-height, letter-spacing, `white-space: pre-wrap` and `word-wrap` into an off-screen div, place a marker span at the colon index, read its offset, and subtract `textarea.scrollTop`. Implemented as a small local helper (`getTextareaCharCoords(textarea, index)`) rather than a new dependency, given the no-bundler renderer.
  - Card **bottom** = the colon line's top − 6px (it opens upward, since the input sits at the bottom of the window). **Left** = the colon's x, clamped to `[8px, window.innerWidth − cardWidth − 8px]`. If the space above is less than ~120px (a tiny window), shrink `max-height` rather than overflow.
  - Repositioned on every query change and on `resize`.
- **Keyboard (while open):**
  - `↑`/`↓` move the selection (wrapping).
  - `Enter` or `Tab` **select**, and must *not* send the message. Integrate into the existing `chatInput` keydown handler (`:4302`): if the autocomplete consumed the key, `preventDefault()` and return before the send logic.
  - `Escape` closes the card only (and must not also cancel 16.11's reply mode; use `stopPropagation`).
  - `Shift+Enter` closes the card and inserts a newline as usual.
- **Mouse:** hover highlights; `mousedown` → `preventDefault()` (keeps textarea focus); `click` selects.
- **Selecting:** replace the `:query` span (from the colon to the caret) using `setRangeText(..., "end")`:
  - **Unicode** → the **emoji character itself** plus a trailing space (user decision, Discord behavior; needed because only custom emoji render from `:name:` text).
  - **Custom** → `:name:` plus a trailing space.
  - Then call `autosizeChatInput()` and close.
- **Closing colon typed manually:** if the text before the caret now ends with `:name:` (the trigger-boundary rule applies) and `name` **exactly equals** a Unicode emoji's snake name, replace it in place with the emoji character (e.g. `:red_heart:` → ❤️). Custom names stay as typed text (they already render). The card closes either way.
- **Also closes on:** no matches; caret leaving the token; whitespace typed; textarea `blur`; tab switch (`switchTab`); message sent; the emoji picker opening (and opening the autocomplete closes the picker if visible).

### Implementation Steps

1. **`index.html`:** `<div id="emoji-autocomplete" role="listbox" hidden>` (header + list), CSS using the existing tokens (`--bg-secondary`, `--border`, `--radius`, shadow like the reaction card).
2. **`renderer.ts`:** a self-contained section `// ── Emoji Autocomplete (PRD 16.7)` with `toEmojiSnakeName`, a lazy Unicode index, `searchEmoji(query)`, `getTextareaCharCoords`, `openAutocomplete`/`updateAutocomplete`/`closeAutocomplete`, `selectAutocompleteItem`, and the closing-colon conversion. Hook it into the `chatInput` `input`, `keydown`, `click`, and `blur` listeners. Refactor `emojiShortName()` to use `toEmojiSnakeName` (no behavior change).

### Out of Scope

The inline message-edit textarea (`.msg-edit-input`) and the emoji picker's own search box. The module is written against a `textarea` parameter so the edit box can adopt it later in one line.

### Regression Risk

Low-medium: the main risk is the Enter key. Sending must keep working whenever the card is closed. Shift+Enter newline, IME composition, the emoji picker, and the reaction picker must all be unaffected.

### Verification

- `npx tsc --noEmit` in `apps/client`.
- **Manual (user):**
  1. Type `:la` → the card opens above the colon with 😆-style results.
  2. Keep typing → it narrows; type a nonsense letter → it closes.
  3. `↑`/`↓` + Enter inserts the emoji (doesn't send); Tab works too; click works.
  4. `:` followed by a custom emoji's prefix → it lists with its image; selecting inserts `:name:`.
  5. Type `:red_heart:` by hand → it becomes ❤️.
  6. `http://x`, `10:30`, `a:b` → no card.
  7. Colon near the right edge of a narrow window → the card stays fully inside the window.
  8. A multi-line message with the colon on line 3 → the card sits above that line.
  9. Escape closes only the card.
  10. With the card closed, Enter still sends and Shift+Enter still adds a newline.

---

## PRD 16.8 — Security Fix: Server-Side Upload Ownership (Stored-File Ledger + Upload Tokens)

**Type:** 🔒 SECURITY FIX (with a schema change)
**Priority:** Critical (must land before 16.10, which multiplies the number of files per message)
**Source:** found during this PRD's audit; added at the user's request
**Affected Components:** shared-types, server (`schema.prisma` + migration, `routes/upload.route.ts`, `message.handler.ts`, `dm.handler.ts`, `emoji.handler.ts`, `channel.handler.ts`, new `services/stored-file.service.ts` + tests), client (`preload.ts`, `renderer.ts`).

### The Vulnerability (confirmed by code reading)

The server stores whatever file URL and Cloudinary `publicId` a client *says* belongs to it, then later **deletes the file at that URL / `publicId`**:

| Path | Trusted client input | Destructive follow-up |
|:---|:---|:---|
| `SEND_MESSAGE` (`message.handler.ts:~90`), `SEND_DIRECT_MESSAGE` (`dm.handler.ts:~52`) | `attachmentUrl`, `attachmentPublicId` | `DELETE_MESSAGE`/`DELETE_DIRECT_MESSAGE` → `deleteAttachment(url, publicId)` |
| `CREATE_CUSTOM_EMOJI` (`emoji.handler.ts:70`) | `imageUrl`, `imagePublicId` | an admin **rejecting** it → `deleteAttachment(...)` (`:201`) |
| `UPDATE_CHANNEL` icon (`channel.handler.ts:~177`, MANAGE_CHANNELS only) | `iconUrl`, `iconPublicId` | replacing the icon deletes the *previous* one |

Concrete attacks (a modified client, or simply the DevTools console calling the preload API):
1. Post a message whose "attachment" is another user's image URL (visible to everyone in chat), then delete your own message. The **victim's file is deleted** from local disk (`storage.service.ts:40` deletes by basename).
2. Same, but with an arbitrary `attachmentPublicId`. `cloudinary.uploader.destroy()` is called with it, so **any asset in the server's Cloudinary account** can be destroyed, even ones outside the `reson8/` folder.
3. Submit a custom emoji pointing at someone's image. An admin who rejects it unknowingly deletes the victim's file.
4. Side issue: any external URL can be posted as an "attachment" (e.g. a tracking pixel on a third-party host that logs the IP of everyone who opens the chat). Today only uploaded files *should* ever be attachments.

### Design: a Stored-File Ledger + Socket-Issued Upload Tokens

The server keeps its own record of every file it stores. Consumers reference those records by id. Each record is claimable **once**, **only by its uploader**, **only for its purpose**. Deletion only ever uses the ledger's own `url`/`publicId`.

**1. Ledger model**

```prisma
enum StoredFileKind {
  MESSAGE_ATTACHMENT
  CUSTOM_EMOJI
  CHANNEL_ICON
}

model StoredFile {
  id        String         @id @default(uuid())
  url       String         @unique
  publicId  String?        // Cloudinary public_id — null for local-disk storage
  kind      StoredFileKind
  ownerId   String?        // uploader's instance id; null = tokenless legacy upload or backfilled row
  claimedAt DateTime?      // null = uploaded but not attached to anything yet
  createdAt DateTime       @default(now())

  @@index([claimedAt, createdAt]) // the 16.9 sweeper's query
  @@map("stored_files")
}
```

Migration `add_stored_file_ledger` (`--create-only`, then hand-append the backfill). Every file **already referenced** today is recorded as claimed:

```sql
INSERT INTO "stored_files" ("id","url","publicId","kind","ownerId","claimedAt","createdAt")
SELECT gen_random_uuid(), "attachmentUrl", "attachmentPublicId", 'MESSAGE_ATTACHMENT', "userId", "createdAt", "createdAt"
FROM "messages" WHERE "attachmentUrl" IS NOT NULL
ON CONFLICT ("url") DO NOTHING;
-- same for "direct_messages" (owner "senderId"), "custom_emojis"."imageUrl"
-- (kind CUSTOM_EMOJI, owner "uploadedBy"), "channels"."iconUrl" (kind CHANNEL_ICON, owner NULL)
```

`ON CONFLICT DO NOTHING` matters: the same URL can legitimately appear twice already (or because the exploit was used), and `url` is unique in the ledger. The release guard below handles shared URLs safely.

**2. Upload tokens** (who uploaded this?)

`/api/upload*` is plain HTTP with no identity, while the socket *is* the user's identity. So:
- New socket event `REQUEST_UPLOAD_TOKEN` → ack `{ success, token?, expiresAt? }`. The server generates `crypto.randomBytes(32).toString("base64url")` and stores `upload-token:<sha256(token)>` → `userId` in Redis with `EX 600` (10 minutes). The Redis key is hashed so a Redis dump doesn't contain usable tokens. One token covers any number of uploads until it expires (no extra round trip per file). **Viewer sockets** (`role: "viewer"`) are refused.
- `preload.ts` `uploadTo()` caches the token, fetches a new one when under 60s remain, and on a `401` refreshes once and retries. It sends `Authorization: Bearer <token>`. (Fastify CORS is registered with `origin: true`, which reflects requested headers in the preflight; verify the preflight passes in manual testing.)
- `handleUpload(app, request, reply, maxSize, mimeTypes, kind)`:
  - header present → resolve the owner from Redis; missing or expired → `401 { error: "Upload session expired" }`;
  - header absent → `ownerId = null` (v2.4.0 client compatibility, see below).

  After storing the file it creates the ledger row (`claimedAt: null`) and responds with `{ url, publicId, uploadId }`. `url`/`publicId` are kept so old clients keep working.

**3. `services/stored-file.service.ts`**
- `claimUploads(tx, { ids?, legacyUrls?, kind, userId })`: one conditional `updateMany` (`where: { id|url in …, kind, claimedAt: null, OR: [{ ownerId: userId }, { ownerId: null }] }`, `data: { claimedAt: now }`). If `count` ≠ the number requested, it throws `UploadClaimError`, which the handler acks as *"Attachment is no longer available. Please re-attach it."* It then returns the ledger rows, whose `url`/`publicId` are what get persisted.
  - The conditional update is an **atomic compare-and-set**: two concurrent sends of the same upload can't both win, and there's no read-then-write race.
  - It runs inside the **same `$transaction`** as the message, emoji, or channel write, so a failed write rolls the claim back.
- `releaseStoredFile(prisma, url)`: deletes the ledger row (`DELETE … RETURNING "url","publicId"`). Then the **reference-count guard**: the physical file is deleted only if no `messages`/`direct_messages` (and, after 16.10, `attachments`)/`custom_emojis`/`channels` row still references that URL. It always uses the **ledger's** `publicId`, never a client value. A URL absent from the ledger is never physically deleted.
- Pure, unit-tested helpers (`src/__tests__/stored-file.service.test.ts`): `isClaimableBy(row, kind, userId)` (mirrors the `where` clause), the claim-count check, and token-key hashing.

**4. Consumers**

| Event | New input (shared-types, additive) | Behavior |
|:---|:---|:---|
| `SEND_MESSAGE` / `SEND_DIRECT_MESSAGE` | `attachmentIds?: string[]` (ledger ids; max **1** in this item, raised to 10 by 16.10) | claim `MESSAGE_ATTACHMENT`; persist the ledger's url/publicId |
| | legacy `attachmentUrl` (v2.4.0 clients) | claimed **by URL** under the same rules |
| | `attachmentPublicId` | **ignored from now on**: the `publicId` always comes from the ledger |
| `DELETE_MESSAGE` / `DELETE_DIRECT_MESSAGE` | n/a | `releaseStoredFile(url)` instead of `deleteAttachment(clientValues)` |
| `CREATE_CUSTOM_EMOJI` | `imageUploadId?` (legacy `imageUrl` accepted, `imagePublicId` ignored) | claim `CUSTOM_EMOJI` |
| `REVIEW_CUSTOM_EMOJI` (reject) | n/a | `releaseStoredFile(emoji.imageUrl)` |
| `UPDATE_CHANNEL` (icon) | `iconUploadId?` (legacy `iconUrl` accepted, `iconPublicId` ignored) | claim `CHANNEL_ICON`; the replaced or cleared icon → `releaseStoredFile` |

The **kind** check prevents cross-purpose reuse (e.g. a chat upload can't become an emoji). The route-specific size and MIME limits stay as they are.

**5. Client**
- `preload.ts`: `uploadFile`/`uploadEmojiFile`/`uploadEmojiAnimatedFile`/`uploadChannelIcon` return `uploadId` as well. `sendMessage`/`sendDirectMessage` send `attachmentIds`; `createCustomEmoji` and `updateChannel` send the new id fields.
- `renderer.ts`: keep `pendingAttachmentUploadId` alongside the existing pending state and pass it on send. The emoji crop/animated flows and the channel-icon flow pass their upload ids.

### Backward Compatibility (v2.4.0 clients on a v2.5.0 server)

Tokenless uploads are still accepted, recorded **ownerless**, and claimable **by URL, once**. The exploit is closed for old clients too, because every attack above relies on referencing a file **already in use**, and a claimed file can never be claimed again.

The only residual window is that someone could claim another user's *ownerless, not-yet-sent* upload first, which requires guessing a random-UUID URL that only the uploader knows. A single config constant `ALLOW_TOKENLESS_UPLOADS = true` (`src/config/upload.config.ts`) makes "require tokens" a one-line change for a later phase, once v2.4.0 clients are gone.

### Honest Scope Note

Reson8 has no login. A user *is* the `instanceId` presented at `USER_JOIN_SERVER`. An upload token proves "connected as user X", which is exactly the strength of every other socket-gated action. It cannot defend against `instanceId` impersonation; that is the project's identity model and out of scope.

### Regression Risk

**High**: every upload path (chat, DM, static emoji, animated emoji, channel icon), message/DM delete, emoji review, and channel icon replace. Mitigated by the legacy fallbacks and by the claim running in the same transaction as each write.

### Verification

- **Typecheck:** shared-types → server → client. `npm run test` (new `stored-file.service` tests). `npm run db:migrate` on a DB with existing images, emoji and icons → all backfilled as claimed, and everything still renders.
- **Manual (user):**
  1. Send/delete an image in a channel and a DM → the file is created and removed.
  2. Upload a static and an animated emoji → approve one, reject one → the rejected file is removed.
  3. Set, replace and clear a channel icon → old files removed.
  4. **Exploit regression:** from client B's DevTools console, send a message whose legacy `attachmentUrl` is client A's already-posted image URL → rejected ("no longer available"); A's image is intact.
  5. Send with a fabricated `attachmentPublicId` → ignored.
  6. Send with an external `https://…` URL as the attachment → rejected.
  7. A v2.4.0 build (if available) can still send an image to the new server.
  8. Leave the app idle for over 10 minutes, then upload → the token refreshes transparently.

---

## PRD 16.9 — Fix: Orphaned Upload Cleanup (Discard, Sweeper, Channel Delete, One-Time Prune)

**Type:** 🐛 FIX
**Priority:** Medium
**Depends on:** 16.8 (the ledger is what makes "unreferenced" knowable)
**Source:** found during this PRD's audit; added at the user's request
**Affected Components:** shared-types, server (`channel.handler.ts`, new `services/upload-sweeper.ts`, new socket event, new prune script, `index.ts`), client (`preload.ts`, `renderer.ts`), `README.md`.

### Where Orphans Come From Today

1. An image picked, then removed from the tray (✕), or abandoned when the app closes. It was already uploaded the moment it was picked.
2. A custom-emoji or channel-icon upload that is cancelled or fails after the file was uploaded (e.g. the emoji name is already taken).
3. A send that fails after its upload.
4. **`DELETE_CHANNEL`** (`channel.handler.ts:~147`): the messages cascade-delete in the DB, but their files (and the channel's icon) are never deleted.
5. Historical leftovers from all of the above, from before this phase.

### Fixes

1. **Immediate discard.** New socket event `DISCARD_UPLOAD { uploadId }` → ack `{ success }`. One atomic statement: `DELETE FROM "stored_files" WHERE "id" = $1 AND "claimedAt" IS NULL AND "ownerId" = $2 RETURNING "url","publicId"`, then delete the file. You can only discard **your own unclaimed** uploads; ownerless legacy uploads are left to the sweeper. The client fires it (fire-and-forget; any failure falls to the sweeper) when:
   - a pending image is removed from the tray (today's ✕; 16.10's trash button);
   - the emoji upload or crop flow, or the channel-icon flow, is cancelled or rejected after its upload completed.
2. **Unclaimed-upload sweeper** (`services/upload-sweeper.ts`, `startUploadSweeper(app)` called from `index.ts` after plugins load):
   - Runs 1 minute after boot, then **hourly** (`setInterval(...).unref()`), and is cleared in Fastify's `onClose` hook.
   - Each run, in batches of 500: `DELETE … WHERE "claimedAt" IS NULL AND "createdAt" < now() - interval '24 hours' RETURNING …`, then delete each file through the same reference-count guard as `releaseStoredFile` (16.8).
   - The `DELETE … RETURNING` is atomic against a concurrent claim: either the claim wins (row claimed, not swept) or the sweep wins (the claim count mismatches and the user is told to re-attach; 16.10 shows that as a failed card with Retry).
   - TTL constant `UNCLAIMED_UPLOAD_TTL_MS = 24h` in `config/upload.config.ts`. Logs `{ swept, freedBytes? }` at info level only when something was swept.
3. **Channel deletion cleans its files.** In `DELETE_CHANNEL`, *before* deleting, collect the URLs of every message attachment in that channel plus the channel's own icon, via `collectChannelFileUrls(prisma, channelId)`. In this item that reads the legacy `messages.attachmentUrl`; 16.10 switches it to the `attachments` table. Then delete the channel (**DB first**, so a failed delete never loses files), then `releaseStoredFile` each URL with bounded concurrency (20 at a time, `Promise.allSettled`). Child channels are re-parented (`SetNull`), not deleted, so their messages and files are correctly untouched.
4. **One-time historical prune** (local-disk storage): `apps/server/scripts/prune-orphan-uploads.mjs` (plain ESM + `@prisma/client`, so it runs in the production Docker image without `tsx`), exposed as `npm run uploads:prune`.
   - Lists `uploads/`. A file is **kept** if its `/uploads/<name>` URL is in `stored_files` *or* still referenced by any of the referencing columns, or if it was modified in the last 24h (in-flight uploads).
   - **Dry run by default:** prints each orphan and the total size. `--apply` deletes.
   - README gets a short "Cleaning up orphaned uploads" section with the dev and `docker compose exec server npm run uploads:prune` usage. (Add a `COPY scripts` line to the server `Dockerfile` if the image doesn't already include it.)
   - Cloudinary is **not** auto-pruned: listing assets uses the rate-limited Admin API, and the account may hold non-Reson8 assets. The README documents the manual approach (compare the `reson8/` folder against `stored_files`).

### Regression Risk

Medium. Deletion is the dangerous direction, so every delete path goes through `releaseStoredFile`'s reference-count guard, the sweeper only touches **unclaimed rows older than 24h**, and the prune script is dry-run by default and skips recent files.

### Verification

- **Typecheck** shared-types → server → client; `npm run test`.
- **Manual (user):**
  1. Pick an image, remove it → its file disappears from `apps/server/uploads/` immediately.
  2. Cancel an emoji upload after picking the file → removed.
  3. To test the sweeper without waiting 24h, temporarily lower the TTL (or backdate a row's `createdAt` in psql), restart → swept, and the server log shows the count.
  4. Delete a channel that had images → their files are gone; a child channel's images remain.
  5. `npm run uploads:prune` lists pre-existing orphans without deleting; `--apply` removes them; every image still in chat keeps loading.

---

## PRD 16.10 — Chore: Multi-Image Upload, Persistent Previews, Preview Viewer, Drag & Drop

**Type:** 🧹 CHORE (with a schema change)
**Priority:** High
**Depends on:** 16.8 (uploads are referenced by ledger id and claimed server-side), 16.9 (removing a card discards its upload)
**Affected Components:** shared-types (`models.ts`, `socket-events.ts`), server (`schema.prisma` + migration, `message.handler.ts`, `dm.handler.ts`, `channel.handler.ts`, `stored-file.service.ts`, new `services/attachment.service.ts` + tests), client (`preload.ts`, `renderer.ts`, `index.html`, `main.ts`).

### Current Behavior

- **One** pending image at a time: globals `pendingAttachmentUrl`/`pendingAttachmentPublicId` (`renderer.ts:879`). `handleFileUpload()` (`:5264`) validates (`image/*`, ≤ 5 MB), shows a 24px thumbnail + spinner, uploads **immediately** via `api.uploadFile()` → `POST /api/upload`, then **drops the thumbnail** and shows only `📎 filename ✕` (`showAttachmentPreview()`, `:5312`). Paste handles the first image item only; `#file-input` has no `multiple`.
- The tray (`#attachment-preview`, `index.html:3601`) sits **below** the input bar.
- Data model: `Message.attachmentUrl`/`attachmentPublicId` and the same pair on `DirectMessage`: **one image per message**. `SEND_MESSAGE`/`SEND_DIRECT_MESSAGE` take single `attachmentUrl`/`attachmentPublicId` fields. `IMessage`/`IDirectMessage` expose `attachmentUrl`.
- Dropping a file anywhere on the window currently makes Chromium **navigate the main window to the file** (there is no `will-navigate` guard in `main.ts` and no document-level drop handling).

### Goal (per `print_discord_attachments.png`)

1. The preview **stays** after the upload finishes.
2. Previews are **bigger** (cards, like the reference).
3. Each preview can be opened at full size in a **limited image viewer** (zoom only: no copy image, copy link, open in browser, or download).
4. **Several images** per message.
5. **Drag & drop** images onto the chat (user decision).
6. Card actions are **Preview (eye) + Remove (trash)**, as SVG icon buttons (user decision; Discord's pencil is dropped because Reson8 has no attachment rename or spoiler concept).

### Data Model: `Attachment` Table (expand/contract migration)

```prisma
model Attachment {
  id        String   @id @default(uuid())
  messageId String?
  dmId      String?
  url       String
  publicId  String?  // Cloudinary public_id — null for local-disk storage
  position  Int      // order within the message, 0-based
  createdAt DateTime @default(now())

  message       Message?       @relation("MessageAttachments", fields: [messageId], references: [id], onDelete: Cascade)
  directMessage DirectMessage? @relation("DmAttachments", fields: [dmId], references: [id], onDelete: Cascade)

  @@index([messageId])
  @@index([dmId])
  @@map("attachments")
}
```

- This mirrors the existing `Reaction` model's "nullable `messageId` **or** `dmId`" convention instead of inventing a new one. `Message`/`DirectMessage` gain `attachments Attachment[]`.
- **Migration** `add_attachments`: generate it with `npx prisma migrate dev --create-only --name add_attachments`, then **hand-append a backfill** to the SQL before applying:
  ```sql
  INSERT INTO "attachments" ("id","messageId","url","publicId","position","createdAt")
  SELECT gen_random_uuid(), "id", "attachmentUrl", "attachmentPublicId", 0, "createdAt"
  FROM "messages" WHERE "attachmentUrl" IS NOT NULL;
  -- same for "direct_messages" → "dmId"
  ```
  (`gen_random_uuid()` is built into Postgres 13+; the project runs 16.) The backfill runs inside the migration transaction, so it's all-or-nothing.
- **Expand/contract:** the legacy `attachmentUrl`/`attachmentPublicId` columns are **kept, marked `// @deprecated (PRD 16.10)`, and no longer written or read** after the backfill. Dropping them is deferred to a future phase. That keeps a server rollback non-destructive, which is standard zero-downtime schema-change practice. The `Attachment` table becomes the single source of truth.
- Docker deployments pick the migration up automatically (`entrypoint.sh` runs migrate on start).

### Wire Format (shared-types first; additive and backward compatible)

- `models.ts`: `export interface IAttachment { url: string; }` and `export const MAX_ATTACHMENTS_PER_MESSAGE = 10;` (Discord's limit; shared by client validation and server enforcement).
- `IMessage` / `IDirectMessage`: add `attachments?: IAttachment[]`. **Keep** `attachmentUrl`, now documented as deprecated and **always filled with `attachments[0]?.url ?? null`**, so a v2.4.0 client connected to a v2.5.0 server still renders the first image of a multi-image message instead of nothing.
- `SEND_MESSAGE` / `SEND_DIRECT_MESSAGE` payloads: `attachmentIds?: string[]` (introduced by 16.8 with a max of 1) is raised to `MAX_ATTACHMENTS_PER_MESSAGE`. The legacy single `attachmentUrl` (v2.4.0 clients) keeps working through 16.8's claim-by-URL path. **No client-supplied URL or `publicId` is ever persisted:** `url`/`publicId` always come from the claimed ledger rows.

### Server

1. **New `services/attachment.service.ts`** (pure where possible, the same pattern as `reaction.service.ts` / `message-text.ts`):
   - `normalizeAttachmentInput(payload)`: validates `attachmentIds` (an array of non-empty strings, de-duplicated, order preserved) plus the legacy `attachmentUrl`, and rejects (returns an error) when there are more than `MAX_ATTACHMENTS_PER_MESSAGE`. Returns `{ ids, legacyUrls }` for 16.8's `claimUploads`; the claimed ledger rows (in request order) become the attachment list.
   - `toAttachmentDtos(rows)`: sorts by `position` and maps to `IAttachment[]` (never exposes `publicId`, the same as today).
   - `releaseAttachmentFiles(rows)`: `Promise.allSettled` over 16.8's `releaseStoredFile(url)` (ledger `publicId` + reference-count guard). Never calls `deleteAttachment` with message-row values directly.
   - 16.8's reference-count guard and 16.9's `collectChannelFileUrls()` are updated to read the new `attachments` table (in addition to the deprecated columns, which still hold pre-migration values).
   - **Unit tests** `src/__tests__/attachment.service.test.ts`: legacy-only input, array-only input, both, empty, over-limit, malformed entries, ordering.
2. **`message.handler.ts`:**
   - `SEND_MESSAGE`: normalize; the empty-message check becomes "no text **and** no attachments". In one `$transaction`: `claimUploads(...)` (16.8), then create the message with a nested `attachments: { create: claimed.map((f, i) => ({ url: f.url, publicId: f.publicId, position: i })) }`. A failed claim aborts the whole send. The DTO includes `attachments` + `attachmentUrl`.
   - `messageInclude` (`:40`): add `attachments: { orderBy: { position: "asc" } }`. `toMessageDto` and the `MessageWithRelations` type are updated.
   - `DELETE_MESSAGE`: delete the row first (attachments cascade), then `releaseAttachmentFiles(…)` on the URLs read beforehand. DB first, so a failed delete never loses files.
   - `EDIT_MESSAGE`: the "Image messages cannot be edited" rule becomes `attachments.length > 0` (same rule, new source). Its DTO includes attachments.
3. **`dm.handler.ts`:** the same changes for `SEND_DIRECT_MESSAGE`, `FETCH_DIRECT_MESSAGES`, `DELETE_DIRECT_MESSAGE`.
4. **Upload route unchanged:** one file per `POST /api/upload`, with the same 5 MB cap and MIME allowlist. The client uploads N files as N requests (simpler and more robust than a multi-part batch, and each card gets independent progress and retry).

### Client: Composer Restructure

- Wrap the input area in a `#chat-composer` column: **(16.11's reply bar) → `#attachment-tray` → `#chat-input-bar`**. The tray moves **above** the input, as in the reference. `switchTab()`'s show/hide of `chatInputBar` (`:3586`) toggles `#chat-composer` instead. The old `#attachment-preview` element and its CSS are removed and replaced.
- `#file-input` gets `multiple`.

### Client: Pending Attachments State

```ts
interface PendingAttachment {
  id: string;            // local id (crypto.randomUUID())
  file: File;
  objectUrl: string;     // kept alive for the card + preview until removed or sent
  status: "uploading" | "ready" | "failed";
  uploadId?: string;     // 16.8 ledger id, set once uploaded
  error?: string;
}
let pendingAttachments: PendingAttachment[] = [];
```

- **Global, not per tab**, preserving today's behavior where a pending image survives a tab switch. (Per-channel drafts are a separate, larger change and not requested.)
- `addFiles(files: File[])`: filter to `image/*` (toast on skipped non-images), reject files over 5 MB (toast per file), cap at `MAX_ATTACHMENTS_PER_MESSAGE` total (toast *"You can attach up to 10 images per message"*, the extras are skipped), then push them and start uploading.
- **Upload queue:** at most **3 concurrent** uploads (each card shows its own spinner meanwhile); retry re-runs the same `File`.
- `revokeObjectURL` happens **only** when a card is removed or after a **successful** send. That fixes the "preview disappears after upload" problem at its root (today the object URL is revoked as soon as the upload finishes).

### Client: Tray UI (cards)

- Horizontal row, `overflow-x: auto`, `gap: 8px`, `padding: 8px 12px`, `border-top: 1px solid var(--border)`, hidden when empty.
- **Card:** 156px wide; a 140px-tall image area (`object-fit: contain` on `var(--bg-input)`, `border-radius: var(--radius)`); filename below, single line, ellipsized, full name in `title`.
- **Action group** (top-right of the card, the reference's floating pill): `var(--bg-secondary)` background, border, radius. Revealed on card hover or `:focus-within`, and **always visible on a failed card**. Buttons (SVG, `aria-label` + tooltip):
  - 👁 **Preview** (eye): opens the limited viewer on the local `objectUrl`; works even while uploading.
  - 🗑 **Remove** (trash, hover `var(--danger)`): drops the card, revokes its object URL, and calls 16.9's `DISCARD_UPLOAD` if it was already uploaded. If it's still uploading, the discard runs as soon as the upload resolves.
  - ↻ **Retry** (rotate-ccw): **only** on failed cards.
- **States:** uploading = image dimmed + a centered spinner (reuse `@keyframes attachment-spin`); ready = normal; failed = `var(--danger)` border + a warning icon overlay, with the error in the card's `title`.

### Client: Limited Preview Viewer

`openLightbox(url, meta?)` gains `meta.previewOnly?: boolean`. When set, the modal gets a `.preview-only` class that hides **Copy Image, Copy Link, Open in Browser, Download** and the separator before them, and the "Sent by" pill (there's no sender yet). **Zoom in/out, wheel zoom, pan, keyboard + / − / 0, Escape, and Close** all keep working. `closeLightbox()` removes the class so the next normal open is unaffected. The CSP already allows `blob:` in `img-src` (Phase 9 fix), so object URLs load.

### Client: Sending

- **Gating:** if any card is `uploading`, Send and Enter don't send; show a toast *"Waiting for images to finish uploading…"*. If any card is `failed`, show *"Remove or retry the failed image first"*. The Send button gets a disabled look in both cases.
- Payload: `attachmentIds: ready.map(a => a.uploadId!)`, in tray order (the 16.8 preload signature already takes the array). If the server answers *"no longer available"* (e.g. the 16.9 sweeper removed an upload left in the tray for over 24h), the restored cards for those uploads are marked failed with Retry, which re-uploads the same `File`.
- Keep today's optimistic clear (input + tray clear immediately). On an **ack failure**, restore the tray items (their object URLs were deliberately not revoked yet) if the tray is still empty, and log the error as today. **Only revoke after success.**

### Client: Rendering Multiple Images in Messages

- A new shared `buildAttachmentsElement(attachments, meta, isNsfw)` used by **both** builders, with input `msg.attachments ?? (msg.attachmentUrl ? [{ url: msg.attachmentUrl }] : [])` so an older server's DTO still renders.
- **1 image:** exactly today's look (`.msg-image`, max 300×200).
- **2+ images:** a `.msg-attachments` CSS grid of square tiles, `repeat(min(n, 3), 150px)` columns, `gap: 4px`, `object-fit: cover`, rounded.
- Every image opens the full viewer with the usual "Sent by" meta.
- **NSFW (PRD 13.5 + 16.2):** in an NSFW channel, **each** image is wrapped in its own `.msg-image-nsfw-wrap` + overlay, exactly the current per-image structure, so the blur toggle from 16.2 keeps covering every tile.
- Each image's `load` re-sticks the scroll to the bottom when the user was at the bottom (the PRD 14.1 behavior, now per image).

### Client: Drag & Drop

- **Window-level guard (always on):** `document` `dragover` and `drop` call `preventDefault()` **when `dataTransfer.types` includes `"Files"`**. Text/HTML drags, including the channel tree's reorder drag (which uses `text/plain`), are left alone, so a stray file drop can never navigate the app away.
- **Defense in depth, `main.ts`:** add a `will-navigate` handler on the main window's `webContents` that cancels any navigation away from the app's own page. This is the Electron security checklist's "limit navigation" recommendation. External links already go through `setWindowOpenHandler`, and same-window link clicks are already forced to `target="_blank"`, so nothing legitimate navigates the main window.
- **Drop zone:** over the chat area (the tab content area), while a **chat tab** (not the Server Log) is active and the user is connected, dragging files shows a `#chat-drop-overlay`: a translucent accent-bordered panel with an upload icon and *"Drop images to attach"*. It uses an enter/leave **counter** to avoid flicker over child elements. On drop: `addFiles([...dataTransfer.files])`.
- Paste: iterate **all** clipboard image items into `addFiles`.

### Out of Scope (documented)

- Gallery left/right navigation between a message's images in the viewer.
- Non-image file types.

### Regression Risk

**High** (schema + wire format + composer). Key checks:
- **Old ↔ new compatibility** in both directions: a v2.4.0 client sends a single image to the new server; the new client reads history containing backfilled single images.
- The edit rule for image messages.
- Delete removing **all** files.
- NSFW blur on every tile.
- Scroll-to-bottom with images.
- The channel-tree drag-reorder still works.
- Custom-emoji and channel-icon uploads (separate routes) are untouched.

### Verification

- **Typecheck:** shared-types `npx tsc --build` → server `npx tsc --noEmit` → client `npx tsc --noEmit`.
- **Server:** `npm run test` (including the new `attachment.service` tests).
- **Migration:** `npm run db:migrate` on a dev DB that already contains single-image messages and DMs → confirm the `attachments` rows were backfilled and that old messages still show their images.
- **Manual (user):**
  1. Pick 3 images via the paperclip → 3 cards with previews that stay after upload.
  2. Eye → limited viewer (zoom works; copy/link/browser/download are absent).
  3. Remove one; send → a 2-tile message. Repeat in a DM.
  4. Paste 2 images → 2 cards. Drag 2 images onto the chat → overlay, then 2 cards.
  5. Drop a file onto the channel tree → nothing happens (no navigation).
  6. Try 11 images → capped at 10 with a toast. Try a 6 MB image → toast.
  7. Stop the server mid-upload → failed card → Retry works after restart.
  8. Press Send mid-upload → toast, not sent.
  9. NSFW channel: all tiles blurred; with the 16.2 toggle off, all clear.
  10. Delete a multi-image message → all files gone from `apps/server/uploads/`.
  11. Old single-image history still renders.
  12. Edit stays blocked on image messages.
  13. Channel drag-reorder still works.

---

## PRD 16.11 — Feat: Message Replies (Channels and DMs)

**Type:** ✨ FEATURE (with a schema change)
**Priority:** High
**Depends on:** 16.5 (toolbar), 16.6 (grouping rule 5), 16.10 (composer layout)
**Affected Components:** shared-types, server (`schema.prisma` + migration, `message.handler.ts`, `dm.handler.ts`, new `services/reply.service.ts` + tests), client (`preload.ts`, `renderer.ts`, `index.html`).

### Goal (per `print_discord_reply1.png` / `print_discord_reply2.png`)

Every message (channel **and DM**, per the user's decision) gets a **Reply** button (the curved back-arrow SVG) in its toolbar. Clicking it puts the composer into **reply mode**: a bar above the input reads *"Replying to **nick**"* with a cancel ✕. The sent message renders with a **one-line snippet of the original above it**, connected by a curved line, and clicking the snippet jumps to the original. Replies can be replied to, and **snippets never nest**: a reply shows only the message it directly answers.

### Data Model

- `Message.replyToId String?` and `DirectMessage.replyToId String?`: **plain columns, intentionally without a foreign-key relation.** With an FK `onDelete: SetNull`, deleting the original would erase the fact that the message *was* a reply. Keeping the id lets the client render Discord's *"Original message was deleted"* snippet. Lookups are batched by primary key, so no extra index is needed.
- Migration `add_message_replies` (additive, nullable, no backfill).

### Wire Format (additive)

- `models.ts`:
  ```ts
  /** Snapshot of the message a reply points at (PRD 16.11). `deleted: true`
   *  means the original no longer exists; the other fields are then empty. */
  export interface IReplyPreview {
      id: string;
      deleted: boolean;
      userId?: string;
      nickname?: string;
      content?: string;        // truncated to REPLY_PREVIEW_MAX_CHARS server-side
      hasAttachments?: boolean;
  }
  ```
  `IMessage.replyTo?: IReplyPreview | null` and `IDirectMessage.replyTo?: IReplyPreview | null`.
- `SEND_MESSAGE` / `SEND_DIRECT_MESSAGE` payloads: `replyToId?: string`.
- `FETCH_DIRECT_MESSAGES` payload: add `aroundMessageId?: string`, the DM counterpart of the channel's existing jump-to-message window (PRD 11.5). Clicking a DM reply snippet needs it.

### Server

1. **`services/reply.service.ts`:**
   - `REPLY_PREVIEW_MAX_CHARS = 200`.
   - `truncateForPreview(content)` (pure: normalizes whitespace runs and newlines to single spaces, cuts at 200 chars, adds `…`).
   - `loadReplyPreviews(prisma, "message" | "dm", ids)`: **one** `findMany` per page, `where id in ids`, selecting `id, userId, content, user.nickname` (DMs use `sender.nickname`) and `_count.attachments`; returns a `Map`.
   - `toReplyPreview(id, row | undefined)`: `deleted: true` when the row is missing.
   - **Unit tests** for the pure parts (truncation edges, the deleted mapping).
2. **`SEND_MESSAGE`:** if `replyToId` is present it must be a string. If the target **exists**, it must be in the **same channel**; otherwise reject with `"Invalid reply target"` (prevents cross-channel leaks of content into the snippet). If it **doesn't exist** (deleted while the user was typing), accept and store it; it renders as "Original message was deleted", as Discord does. Persist `replyToId`; the broadcast DTO carries `replyTo` (single lookup).
3. **`SEND_DIRECT_MESSAGE`:** same, except an existing target must belong to the **same pair of users** (either direction).
4. **`FETCH_MESSAGES`, `FETCH_DIRECT_MESSAGES`, `EDIT_MESSAGE`:** after loading the page, `loadReplyPreviews()` over the page's non-null `replyToId`s (one query, mirroring `loadReactorNicknames`), then attach `replyTo` in `toMessageDto` / the DM mapper.
5. **`FETCH_DIRECT_MESSAGES` `aroundMessageId`:** the same half-before / target / half-after window logic as `FETCH_MESSAGES` (`message.handler.ts:~195`), constrained to the pair.

### Client: Reply Mode (composer)

- `#reply-bar` at the top of `#chat-composer` (from 16.10): `Replying to <strong class="reply-bar-nick">nick</strong>` (nick in accent) on the left, a ✕ SVG button (`aria-label="Cancel reply"`) on the right, `var(--bg-tertiary)` background, small text, like the reference.
- **State per tab:** `replyTargets: Map<tabId, { messageId; nickname }>`. A draft reply belongs to the conversation it was started in. `switchTab()` renders the bar for the newly active tab; `closeTab()` deletes its entry.
- **Entering:** toolbar Reply → set the target, show the bar, focus `chatInput`, and add `.msg-reply-target` to the original message (a subtle accent left border, so the user sees what they're answering).
- **Cancel:** the ✕, or **Escape** in the input when the emoji autocomplete (16.7) isn't open. Remove `.msg-reply-target`.
- **Send:** pass `replyToId`; clear reply mode on send, and restore it on ack failure (the same pattern as 16.10's attachment restore).
- **Original deleted while replying** (`message-deleted` / `dm-deleted` for the target id): cancel reply mode and toast *"The message you were replying to was deleted."*

### Client: Rendering a Reply

- Inserted **first** in the message element (above `.msg-header`), only when `msg.replyTo` is set:
  ```html
  <div class="msg-reply" data-reply-to-id="…" role="button" tabindex="0" aria-label="Jump to replied message">
    <span class="msg-reply-spine"></span>              <!-- curved connector: border-left + border-top, top-left radius -->
    <span class="msg-reply-nick">barrella</span>
    <span class="msg-reply-text">https://github.com/…</span>  <!-- one line, ellipsis -->
  </div>
  ```
  - Text: `api.markdownToPlainText(content)`, the same one-line plain-text path as the pinned bar, so no Markdown syntax or HTML leaks in.
  - If the content is empty but `hasAttachments`: an image SVG + italic *"Click to see attachment"*.
  - `deleted`: italic muted *"Original message was deleted"*, **not** clickable.
  - Font one step smaller than message text; the nick is accent-colored and semibold; the text is `var(--text-secondary)`.
- **Grouping:** a reply always starts a new group (16.6 rule 5), so its header shows under the snippet, as in the reference.
- **Click / Enter on the snippet** → `jumpToMessage(tabId, replyToId)`.

### Client: `jumpToPinnedMessage` → `jumpToMessage`

Generalize `jumpToPinnedMessage(channelId, messageId)` (`:6114`) into `jumpToMessage(tabId, messageId)`: same find-or-load-window-then-scroll-and-flash flow. DM tabs use `fetchDirectMessages(partnerId, undefined, 50, messageId)` (the new `aroundMessageId`) and the DM render path. The pin bar calls the new function; its behavior is unchanged.

### Client: Live Updates

- `message-edited`: also update every `.msg-reply[data-reply-to-id="<id>"] .msg-reply-text` with the new plain text. Snippets reflect edits, as they would on a reload.
- `message-deleted` / `dm-deleted`: switch those snippets to the deleted state (and handle the reply-mode case above).

### Explicitly Not Included

Mentions or "ping the author" (Reson8 has no mention or notification system for channel messages), and reply threads or nesting.

### Regression Risk

Medium: the composer (shared with 16.10), the Escape key (shared with 16.7), the pin-bar jump refactor, and two more DTO fields. Old clients ignore `replyTo` and just render the reply text as a normal message. That degrades gracefully with no breakage.

### Verification

- **Typecheck:** shared-types → server → client; `npm run test` (with the new `reply.service` tests); apply the migration with `npm run db:migrate`.
- **Manual (user), in a channel and a DM:**
  1. Hover → Reply → bar "Replying to X"; the original gets the accent border.
  2. Send → a snippet sits above the new message's header, and clicking it scrolls to and flashes the original.
  3. Reply to a reply → only one snippet level.
  4. Reply to an image-only message → "Click to see attachment".
  5. Delete the original → existing snippets show "Original message was deleted" live, and stay so after a reload.
  6. Edit the original → snippets update live.
  7. Start a reply, switch tabs and come back → the bar is still there; start another in a different tab → independent.
  8. Escape cancels the reply; with the autocomplete open, Escape closes only the card.
  9. Reply to a very old message (outside the loaded page) → clicking the snippet loads the window around it (channel and DM).
  10. A reply always shows its own header even within 5 minutes of the same author's previous message.
  11. The pinned bar jump still works.

---

## Cross-Cutting Dependencies & Recommended Implementation Order

| Order | Item | Why here |
|:---:|:---|:---|
| 1 | **16.1** NSFW don't-warn | Isolated; creates the Settings → Application "Content" section |
| 2 | **16.2** NSFW blur toggle | Adds the second row to that section; CSS-only switch |
| 3 | **16.3** Viewing highlight | Isolated tree change; `switchTab()` hook |
| 4 | **16.4** Mute text channels | Tree + context menu; builds on 16.3's targeted-update pattern |
| 5 | **16.5** Action toolbar | Foundation: frees the reaction strip, hosts Reply |
| 6 | **16.6** Grouping + header + HH:MM | Needs 16.5; defines rule 5 that 16.11 activates |
| 7 | **16.7** Emoji autocomplete | Composer keyboard handling; must exist before 16.11's Escape rule |
| 8 | **16.8** Upload ownership (security) | Schema migration #1 (ledger); must precede 16.10 so multi-image is built on claimed ids, not client URLs |
| 9 | **16.9** Orphan cleanup | Needs the 16.8 ledger; provides `DISCARD_UPLOAD` used by 16.10's Remove |
| 10 | **16.10** Multi-image + composer | Schema migration #2 (`attachments`); creates `#chat-composer` that 16.11 uses |
| 11 | **16.11** Replies | Schema migration #3; uses 16.5, 16.6, 16.7, 16.10 |

Shared touch points to watch:
- **`switchTab()`** is touched by 16.3 (viewing), 16.7 (close autocomplete), 16.10 (composer visibility), and 16.11 (reply bar).
- **`chatInput` keydown** is touched by 16.7 (Enter/Tab/Escape) and 16.11 (Escape). Precedence: autocomplete, then reply cancel, then send.
- **Message builders** are touched by 16.5, 16.6, 16.10, and 16.11. Each item re-verifies the previous items' behavior.
- **Settings → Application "Content" section** is touched by 16.1 and 16.2.
- **Every upload/delete path** (`upload.route.ts`, message/DM/emoji/channel handlers) is touched by 16.8, 16.9 and 16.10. After 16.10, re-run 16.8's exploit-regression checks and 16.9's discard/sweeper checks against multi-image messages.

Wrap-up after 16.11 (only after user confirmation): `/bump-version` (expected **2.4.0 → 2.5.0**, minor); release notes `app-planning/releases/v2.5.0.md` (mention that v2.4.0 clients see only the first image of multi-image messages and no reply snippets, and recommend updating; describe the upload security fix at a high level, without a step-by-step exploit, and the new `npm run uploads:prune` maintenance command for self-hosters); update the root, client, and server `CLAUDE.md` files (the `StoredFile` ledger and "never persist or delete a client-supplied URL/publicId" rule, upload tokens, the sweeper, the new `Attachment` model + expand/contract note, `stored-file.service.ts`/`upload-sweeper.ts`/`reply.service.ts`/`attachment.service.ts`, the toolbar and grouping conventions, the `will-navigate` guard, the new `reson8-*` keys) and `README.md` (features + roadmap row 16); move this PRD to `archive/`.

---

## Open Decisions Confirmed With the User

| # | Question | Decision |
|:---:|:---|:---|
| 1 | NSFW "don't warn again" scope | **All NSFW channels** (one global preference), reversible in Settings → Application |
| 2 | Message layout for grouping | **Discord-style header** (nick + HH:MM above, text lines below) |
| 3 | 5-minute grouping window | Measured **from the group's first message** |
| 4 | Replies in DMs? | **Yes, channels and DMs** |
| 5 | Move message actions to a floating hover toolbar? | **Yes** (becomes PRD 16.5) |
| 6 | Pending-image card actions | **Preview (eye) + Remove (trash)**; no pencil |
| 7 | Drag & drop images onto the chat | **Yes** |
| 8 | Autocomplete inserts for Unicode emoji | **The emoji character itself**; a fully typed known `:name:` converts too |
| 9 | Fix the two upload-pipeline issues found in the audit? | **Yes, both** (they become PRD 16.8 and 16.9) |

**Reasonable-default assumptions (flag any you'd like changed):**
- Autocomplete opens after **1 letter** (as written in `nextsteps.txt`; Discord waits for 2), shows at most 10 results, and ranks custom emoji first on ties.
- Max **10 images** per message (Discord's limit); 5 MB per image (unchanged).
- Pending images stay **global across tabs** (today's behavior); reply drafts are **per tab**.
- Muted-channel unread state keeps being tracked silently, so **unmuting reveals the dot** (Discord behavior).
- Re-focusing an **already-open** NSFW tab from the tree no longer re-prompts, even with warnings on.
- Continuation messages show their time via a **hover tooltip** on the text (there's no avatar gutter for Discord's hover-time slot).
- "(edited)" moves to the **end of the message text**.
- Legacy attachment columns are **kept but unused** this phase (expand/contract); dropping them is a future cleanup.
- Tokenless (v2.4.0-client) uploads stay **accepted but ownerless and claim-once** for this release (`ALLOW_TOKENLESS_UPLOADS = true`); requiring tokens is a one-line change for a later phase.
- Unclaimed uploads are swept after **24 hours**; the sweeper runs **hourly**. Upload tokens last **10 minutes**.
- Historical orphan pruning is **local-disk only** and **dry-run by default**; Cloudinary cleanup stays manual (documented).

---

## Pre-Existing Issues Noticed During the Audit

Not part of the original `nextsteps.txt`. All three are now **in scope**:

1. **Attachment URLs and Cloudinary `publicId`s were trusted from the client** (messages, DMs, custom emoji, channel icons), letting a modified client get other users' files, or any Cloudinary asset, deleted. → **PRD 16.8**.
2. **Orphaned uploads**: files removed from the tray, abandoned, cancelled, or left behind by channel deletion were never deleted. → **PRD 16.9**.
3. **Main-window navigation on file drop**: dropping a file anywhere on the window navigates the app away. → fixed inside **PRD 16.10** (drop guard + `will-navigate`), since drag & drop makes it easy to hit.

---

## Mapping to `nextsteps.txt`

| `nextsteps.txt` item | PRD |
|:---|:---|
| chore: dismiss warning from nsfw text channels | **16.1** |
| chore: make the image blurring in nsfw text channels optional (per user) | **16.2** |
| feat: autocomplete for emojis when typing them on text chats | **16.7** |
| chore: improve image upload system (multiple, persistent preview, viewer) | **16.10** |
| chore: group subsequent messages from the same user within an interval | **16.6** (+ enabling refactor **16.5**) |
| chore: highlight the text chat currently open, with an eye icon | **16.3** |
| feat: mute text channels (per user, faded in the tree) | **16.4** |
| feat: message replies in general text chats | **16.11** |
| *(audit finding, added by the user)* upload URL/`publicId` trust | **16.8** |
| *(audit finding, added by the user)* orphaned uploads | **16.9** |
