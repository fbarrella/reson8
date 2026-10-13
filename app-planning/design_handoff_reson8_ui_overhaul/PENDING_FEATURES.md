# Pending implementations: detailed plan

This document lists what the study (`design/`, screenshots in `screenshots/`) defines that the Reson8 client **v2.7.0 doesn't do yet**, and how to build each item in the real repository.

Frame ids such as `13b` refer to the study screenshots. "🖧" means the item changes the wire protocol: `packages/shared-types` changes first, then `apps/server`, then the client. This is the repo's own shared-types-first rule, from the root `AGENTS.md`.

> **This plan was written by reading the code, not by running it.** Every "Today" section describes what the source shows at v2.7.0. Anything marked **Verify** is an assumption the implementer must confirm in the code before building on it. Function names and approximate line numbers are given so they can be found by search; line numbers will drift.

---

## 0. Rules that apply to every item

1. **Finishing an item:** run `/log-progress` (`.claude/commands/log-progress.md`) to append a `progress.txt` entry, run `npm run typecheck` in every package you touched, and run any `test:*` script that covers a file you changed (the list is in `apps/client/AGENTS.md`).
2. **Shared types first.** A payload change goes into `packages/shared-types/src/socket-events.ts` or `models.ts`, then `apps/server`, then `preload.ts`, then `renderer.ts`. The renderer is a classic script and **can't import shared-types**, so constants it needs (such as `MAX_SCREEN_SHARES_PER_ROOM`) must be mirrored locally with a comment pointing at the source, like `MAX_ATTACHMENTS_PER_MESSAGE` already is.
3. **Old servers.** A new client must keep working against a v2.7.0 server. Every new field is optional (`?`). A missing event ack (timeout or "unknown event") falls back to today's behaviour, like `getUploadToken()` falls back for pre-2.5.0 servers. Gate new UI on the field being present, not on version comparisons.
4. **Security boundary.** Anything that needs Node, Electron or the window manager goes through a new `preload.ts` method plus a validated `ipcMain` handler in `main.ts`. Never use `nodeIntegration`.
5. **Rendering text.** Dynamic text uses `textContent`. `showToast()` uses `innerHTML`, so anything user-supplied that goes into it (names, channel names) goes through `escapeHtml()` first.
6. **Storage.** Persist only through `localStorage`, under `reson8-*` keys, with every read and write in `try/catch` and a safe default. Grep `reson8-` before adding a key.
7. **Targeted updates.** Prefer targeted DOM updates over `renderTree()`; a full re-render loses the collapsed-category state.
8. **Access.** Respect `requireServerAccess()`: every new entry point that opens a tab, joins voice, uploads or nudges goes through it.
9. **Modals over Settings.** A modal opened from the Settings modal needs a higher `z-index`, and its CSS override must come **after** the base modal block in `index.html` (see the identity modals precedent). Check it with `document.elementFromPoint()`.
10. **Headless verification.** Use the recipe in `apps/client/AGENTS.md`: Xvfb, `--user-data-dir`, CDP, and take screenshots and look at them. Never `pkill -f` a pattern that's in your own command line.

---

## Phase overview

| Phase | Contents | Rationale |
| --- | --- | --- |
| **P1** | §A: protocol and server groundwork | Everything later depends on it; no UI. |
| **P2** | §B: behaviour changes in the **current** UI | Logic only, so it survives the restyle. |
| **P3** | §F: Nocturne foundation (tokens, fonts, icons, menu builder) | Small; lets P4 be built once in its final look. |
| **P4** | §C: new surfaces, built directly in Nocturne | |
| **P5** | §R: restyle of the remaining existing screens | Pure visuals, safest last. |

Each numbered item below is sized to be one PRD item and one `progress.txt` entry.

---

# P1: Protocol and server (🖧)

## A1. Member-visible server summary 🖧
**Goal.** Give the About modal (16a) and the server header (1e) data that every member may read: who the admins are, how many members exist, how many are online, and which features are on.

**Today.**
- `GET_SERVER_SETTINGS` returns `name`, `nudgeEnabled`, `screenShareEnabled`, `maxMessageLength` and `version` to everyone. It returns `requireSignedIdentity`, `requireApproval` and `requireInvite` **to admins only** (PRD 18.4/18.8/18.9 comments in `socket-events.ts`).
- `GET_ALL_USERS` requires `MANAGE_ROLES` or `BAN_USER`.
- `GET_ONLINE_USERS` returns `IOnlineUser[]`. **Verify** whether it includes offline users (see A7).

**Plan.**
1. **Event.** In `socket-events.ts`, add `GET_SERVER_SUMMARY: (ack: (res: { success: boolean; summary?: IServerSummary; error?: string }) => void) => void`.
2. **Model.** In `models.ts`, add:
   ```ts
   export interface IServerSummary {
     name: string;
     memberCount: number;            // distinct users with the Member role (or every non-banned user — pick and document)
     onlineCount: number;            // distinct users with presence on this server now
     admins: { userId: string; nickname: string; isOnline: boolean; avatarUrl?: string | null }[];
     features: {
       nudge: boolean; screenShare: boolean;
       requireApproval: boolean; requireInvite: boolean; requireSignedIdentity: boolean;
     };
     iconUrl?: string | null;        // filled in by A2; optional so A1 can ship first
   }
   ```
3. **Server handler.** Put it next to `GET_SERVER_SETTINGS` (search `apps/server/src/handlers/` for it; likely `admin.handler.ts` or `connection.handler.ts`).
   - **Admins:** users holding the role(s) with the admin permission bits. Reuse `permissions.service.ts` and `admin-users.ts`; don't hard-code a role name.
   - **Counts:** `memberCount` from Postgres; `onlineCount` from `presence.service.ts` (Redis), counting **distinct `userId`s**, not sockets.
   - **Features:** expose the three join-gate booleans to everyone. They are facts about how to join, not secrets. Keep `unprotectedActiveUsers`, the allowed-hosts list and anything else admin-only **out** of the summary.
   - **Access gate:** gate the event like other member events (`EVENT_ACCESS` in the access service). A restricted user (no Member role) should probably still be refused. Decide this deliberately and write it down.
4. **Live updates.** Add an optional `SERVER_SUMMARY_UPDATED` broadcast, *or* have the client re-fetch on `PRESENCE_UPDATE`, `USER_JOINED`/`USER_LEFT` and `SERVER_SETTINGS_UPDATED`. Re-fetching is simpler; debounce it to at most one request every 2 s.
5. **Preload.** Add `getServerSummary()` in `preload.ts` with a 5 s timeout that resolves `null` on old servers.

**Cautions.**
- Online count: a person with several identities (the same nickname with different keys, as `MEM` shows in the study) counts once **per userId**. The study's "count distinct people" assumes userId = person. **Verify** that the server's notion of a user is per identity. If two identities of one person are two users, show users, and keep the header and About agreeing (they must use the same number).
- Don't leak the IP addresses or identity fingerprints that `GET_ALL_USERS` carries.

**Done when.** A member account (not admin) receives the summary; the counts match `GET_ONLINE_USERS`; an old client is unaffected; a server test exists in `apps/server/src/__tests__/` (pattern: `admin-users.test.ts`).

## A2. Server icon 🖧
**Goal.** Admins upload a server icon (12a–12b). It's served from a **public, unauthenticated URL** so saved server lists can show it while disconnected (12d).

**Today.**
- Channel icons already go through the upload pipeline: `iconUrl`/`iconPublicId` in `UPDATE_CHANNEL`, `routes/upload.route.ts`, `storage.service.ts` and `stored-file.service.ts` (the ownership ledger, PRD 16.8).
- Uploaded media URLs are resolved through `preload.ts` `resolveMediaUrl()`. **Verify** whether uploaded files are already publicly fetchable without a token. If they are, the "public link" is simply the existing file URL. If not, you need a public route.

**Plan.**
1. **Models.** Add `iconUrl?: string | null` to `IServer` and to `GET_SERVER_SETTINGS`'s ack (for everyone), to `SERVER_SETTINGS_UPDATED`'s payload, and to `IServerSummary` (A1).
2. **Setting it.** Add `iconAttachmentId?: string | null` to `UPDATE_SERVER_SETTINGS` (`null` removes it). The server claims the upload through the ledger exactly like a channel icon (only the uploader may claim it), checks the admin permission, stores the file id, and deletes the previously stored icon file (reuse the orphan cleanup in `upload-sweeper.ts`).
3. **Validation on the server**, not only the client:
   - **MIME:** PNG, JPEG, GIF or WebP, checked by sniffing, not by the extension.
   - **Size:** ≤ 1 MB.
   - **Dimensions:** ≥ 256×256.
   - **Shape:** the client crops to a square; the server should re-encode to a square PNG or WebP of at most 512×512. That strips metadata and bounds the size.
4. **Public URL.** It must be absolute (`https://host:port/public/server-icon/<hash>.png`) and content-addressed, so a changed icon gets a new URL and caches never serve a stale one. Send `Cache-Control: public, max-age=31536000, immutable`. No auth, no cookies. Add a CORS `Access-Control-Allow-Origin: *` only if the client loads it cross-origin from the renderer. **Verify** the renderer CSP `img-src` allows the server's origin (it already loads avatars and attachments from it).
5. **Migration.** A Prisma migration adds a nullable icon column, or a relation to the stored-file ledger, on the Server model.

**Cautions.**
- Users must not be able to point the icon at an arbitrary URL. Only a ledger-claimed upload is accepted, mirroring the avatar rule ("never a URL" in `IAvatarSelection`).
- The URL is public by design, and the dialog says so (SPEC §1.5). Don't put anything sensitive in the path.

**Done when.** Upload, replace and remove work. A logged-out `curl` fetches the URL. The old file is deleted after replacement. There's a server test for permission refusal and MIME refusal.

## A3. `occupiedSince` per voice channel 🖧
**Goal.** Drive the per-channel session timer in the tree (SPEC §2.2; frames 6a and 7a show `27:28` next to Sala Precisa).

**Today.** `IChannelTreeNode.occupants` comes from Redis presence (`hydrateOccupants()` in `connection.handler.ts`). The client's `#voice-session-timer` is the user's **own** call time, a different thing; keep it.

**Plan.**
1. **Model.** Add `occupiedSince?: string | null` (ISO-8601) to `IChannelTreeNode`, voice channels only.
2. **Server.** In `presence.service.ts`, when a user joins a voice channel whose occupant set was empty, write `voice:occupiedSince:<channelId>` to Redis with the server's `Date.now()`. When the last occupant leaves, including through the grace-timer finalize and kicks, delete it. `hydrateOccupants()` copies it onto the node.
3. **Clock skew.** Send the server time as well (`CHANNEL_TREE_UPDATE` could carry `serverNow`), or let the client compute an offset from `PING_LATENCY`, whose ack already returns `serverTime`. Client timer = `now + offset − occupiedSince`.

**Cautions.**
- **The stale-socket race (root `AGENTS.md` › "Socket ownership").** A reconnecting user's old socket can fire a late `disconnect`. Clear `occupiedSince` only when the channel's **ownership-checked** occupant set is empty, or a blip resets the timer.
- **Restarts.** Server restart: Redis keeps the key with presence; if presence is wiped, wipe the key too. Don't let a key outlive its occupants. Give it the same TTL refresh presence uses.

**Done when.** Two users join, the first leaves, and the timer continues. Both leave and the timer disappears. A rejoin starts again from 00:00. A network blip under 12 s doesn't reset it.

## A4. Cap of 5 concurrent screen shares per room 🖧
**Goal.** Enforce on the server what the UI explains (15d, SPEC §6.3).

**Today.** `SET_SCREEN_SHARE_STATE` checks the server-wide toggle. The producer itself is created via `PRODUCE` (`voice.handler.ts`, `mediasoup.service.ts`). **Verify** whether sharing is gated at `PRODUCE` (by producer `appData`, e.g. `source: "screen"`) or only at `SET_SCREEN_SHARE_STATE`.

**Plan.**
1. **Constant.** Add `export const MAX_SCREEN_SHARES_PER_ROOM = 5;` to `models.ts`, mirrored in `renderer.ts`.
2. **Server.** Refuse the share where the **screen video producer is created** (`PRODUCE` with the screen marker): count the channel's live screen video producers, and if there are already 5, ack `{ error: "SCREEN_SHARE_LIMIT" }`. Also refuse `SET_SCREEN_SHARE_STATE { isSharingScreen: true }` past the cap, for consistency. Count per **channel**, not per server.
3. **Count at the producer, not the flag.** A client that crashes after producing must be released through `PRODUCER_CLOSED` / transport close. Count live producers, not a flag the client sets.
4. **Client.** In `voice.service.ts`'s share start path, map `SCREEN_SHARE_LIMIT` to the toast "All 5 stream slots are in use. You can share when someone stops." and stop the local capture tracks immediately (don't leave the OS picker's capture running). `updateShareScreenButton()` shows "Share screen · 5/5" while the room is full. Compute that from occupants' `isSharingScreen`, as the LIVE badges already do.

**Cautions.**
- **Race:** two people starting the 5th share at the same moment. Do the count and the creation inside one critical section per channel (a per-channel promise chain in the handler), or the cap can be exceeded by one.
- Share **audio** producers don't count; only video does.

**Done when.** Five shares are allowed and the 6th is refused, with the capture stopped and the toast shown. Someone stopping frees a slot immediately. Crash-closing a sharer frees the slot.

## A5. Unread **counts** for channels 🖧 (new finding)
**Goal.** The study shows counts (`3`), not dots, in the tree and on tabs (6a "Santos 3"; SPEC §2.1, §4).

**Today.**
- `IChannelTreeNode.hasUnread` is a **boolean**, computed only on the per-socket tree at join time (see its doc comment). The client keeps `unreadChannelIds` (a set) and `markChannelUnread()`. `MARK_CHANNEL_READ` stores the read point.
- DMs already have counts (`GET_UNREAD_DM_PARTNERS` returns `unreadCount`).

**Plan.**
1. **Model.** Add `unreadCount?: number` next to `hasUnread` on `IChannelTreeNode`, computed the same way `hasUnread` is (messages after the user's read marker, **excluding the user's own messages**). Cap it at 99 server-side to keep the query cheap (`take: 100`), and display "99+".
2. **Client state.** Replace `unreadChannelIds: Set<string>` with `unreadChannelCounts: Map<string, number>`. Keep a helper `hasUnread(id)` so existing call sites still read well.
3. **Live increments.** On `MESSAGE_RECEIVED` for a channel that isn't currently visible and read, increment by 1 in `markChannelUnread()` (the same conditions it already uses). Don't count your own messages, or deleted ones. On `MESSAGE_DELETED` the count *may* stay as it is, which is acceptable and should be documented.
4. **Old servers.** When the server only gives `hasUnread`, show `•` instead of a number.

**Done when.** Join with 3 unread and the tree shows 3. A new message arrives and it shows 4. Open the channel and it's cleared, and stays cleared after reconnecting.

## A6. Category delete with children 🖧 (Verify first)
**Goal.** 14c/14d: delete a category either **keeping** its channels (they move to the top level) or **deleting** them.

**Today.** Categories are channel nodes with children (`renderCategory()`; `parentId`). `DELETE_CHANNEL` exists. **Verify** what the server does today with children when a parent is deleted: cascade, re-parent, or refuse.

**Plan.**
1. **Payload.** Add `children?: "keep" | "delete"` to `DELETE_CHANNEL`; the default must equal today's behaviour.
2. **"keep":** in one transaction, set `parentId = null` on every direct child and append them at the end of the top level (positions continue after the current maximum), then delete the category. Emit **one** `CHANNEL_TREE_UPDATE`, not one per child.
3. **"delete":** in one transaction, delete every descendant (messages, pins, attachments through the existing channel-delete path, so the stored-file ledger cleans up), disconnect voice occupants of descendant voice channels (reuse the existing voice-channel delete path), then delete the category. Emit `CHANNEL_DELETED` for each, or one tree update, and let the client's `pruneClosedChannelTabs()` close tabs.
4. **Permissions** match deleting a channel (`MANAGE_CHANNELS`).

**Cautions.** This is destructive: write a server test for each branch, including a category containing a voice channel with an occupant.

## A7. DM directory 🖧 (Verify first)
**Goal.** The DM sidebar lists **every registered member** (online and offline), puts people you've messaged first, and shows a last-message preview (9a; SPEC §5).

**Today.**
- `GET_ONLINE_USERS` returns `IOnlineUser[]`, and `renderOnlineUsers()` takes `{ userId, nickname, isOnline }[]`. **Verify** whether offline users are included and for whom.
- There's no "conversation list" event. `GET_UNREAD_DM_PARTNERS` gives only partners with unread messages.

**Plan.**
1. **Event.** Add `GET_DM_DIRECTORY → { members: { userId, nickname, avatarUrl?, isOnline, lastMessage?: { preview: string; at: string; fromMe: boolean }, unreadCount: number }[] }`, excluding the caller and banned users.
2. **Preview** = plain text produced server-side from the latest DM, truncated to 80 characters. Attachments-only shows "Image". Run it through the same plain-text logic the client has (`markdownToPlainText`), or send raw text and let the client run `api.markdownToPlainText()`. The second option is preferred: it keeps a single Markdown implementation.
3. **Live updates:** `DIRECT_MESSAGE_RECEIVED` and `PRESENCE_UPDATE` are enough to keep it current client-side.

**Done when.** A member with no DMs sees everyone; after sending a DM, that person moves to the top of their group.

---

# P2: Behaviour in the current UI

## B1. Unread counts in the current UI
**Depends on** A5 (channels). DMs already have counts.
**Change.**
- **Channels:** the tree's unread dot becomes a count pill (keep the current CSS for now; restyled in P3).
- **DMs:** convert `unreadDmPartners` from a set to a `Map<partnerId, count>` fed by `GET_UNREAD_DM_PARTNERS` and incremented on `DIRECT_MESSAGE_RECEIVED`.
- **Tabs:** non-active channel and DM tabs show the count.
**Caution.** `markDmTabRead()` stays **the only** way a DM becomes read (tab active, `document.hasFocus()` synchronously, and the page rendered). Add no new call to `api.markDmsRead()`.
**Done when.** The counts match across the tree, tab and online-users list.

## B2. Muted channels are fully silent
**Today.** `applyChannelMuteState()` handles the tree and the mute logic (PRD 16.4). **Verify** whether a muted channel's tab still shows an unread dot.
**Change.**
- **Muted:** a muted channel shows no count in the tree and no badge on its tab, and plays no sound alert (verify the alerts already respect mute).
- **Unmuted:** the stored count reappears (keep counting while muted; just don't display it).
- **Visuals:** fade the muted row to 0.5 opacity unless it's the channel being viewed (`updateViewingIndicator()` knows which that is), and add a bell-slash icon.
**Caution.** Use targeted DOM updates, not `renderTree()`.

## B3. Opening a channel from its tab clears unread
**Today.** Opening a channel from the tree marks it read. **Verify** the `switchTab()` path calls the same read routine (`MARK_CHANNEL_READ`) and clears `unreadChannelCounts`.
**Change.** Have one function `markChannelTabRead(tab)`, mirroring `markDmTabRead()`'s rules (the tab is active, the window is focused, the page is rendered), and call it from both paths.

## B4. DM tabs follow the preview/kept rules
**Today.**
- **Preview logic:** `ChatTab.mode` exists for channel tabs only ("DM tabs are unaffected", PRD 17.5). `previewTabId` holds channel ids only. `openChatTab()` (~5140) does the preview replacement, and `openDmTab()` (~5265) always creates a permanent tab.
- **Keys:** channel tabs are keyed by `channelId` and DM tabs by **(verify)** `userId` or a `dm:` key.
**Change.**
1. **Shared helper.** Give DM tabs `mode: "preview" | "kept"`. Move the "replace the preview tab" logic out of `openChatTab()` into a shared `placeTab(tab, mode)` used by both.
2. **Ids.** Make sure DM and channel tab ids can never collide; prefix DM tab ids with `dm:` if they don't already.
3. **Persistence.** Extend `reson8-kept-tabs` entries to include `dm:<userId>` alongside channel ids, still per server. `restoreKeptTabs()` must skip `dm:` entries for users who no longer exist, and must do nothing while access is restricted (the existing rule).
4. **Auto-opened DMs.** `autoOpenUnreadDmTabs()` (~3187) opens unread DMs on connect. Today they're permanent; open them as **kept**, so several unread DMs don't keep replacing each other. Document this choice.
5. **Access.** `applyAccessState()` closes tabs with `reason: "access"` and restores "kept tabs and unread DM tabs". Make sure the restore path uses the new modes.
6. **Double-click** on any tab keeps it, as channel tabs already do.
**Caution.** The scroll keeper, the `followBottom` state and the reply targets are keyed per tab. When a preview tab is **replaced**, dispose of the old tab's `ResizeObserver` and `MutationObserver` and its `replyTargets` entry exactly as `closeTab()` does.
**Done when.** 9b: open DM A then DM B, and B replaces A. Keep B, open channel C, and both stay. Restart, and B and C are restored.

## B5. Tab menu additions
**Today.** `showChannelTabContextMenu()` (~5414).
**Change.** Attach the menu to DM tabs too. Add **Close other tabs** (closes every closable tab except this one and the Server Log) and **Close tabs to the right**. Closing kept tabs through these items also un-keeps them (and calls `persistKeptTabs()`).

## B6. Menu permissions and the voice channel menu
**Today.** `attachChannelContextMenu()` (~2920) shows Rename, Move and Delete to everyone; the server refuses non-admins (`insufficient_perms.mp3`).
**Change.**
- **Admin items:** hide them when the user lacks `MANAGE_CHANNELS`. **Verify** where the client learns its own permissions (role data on join); the server check stays authoritative.
- **Grouping:** Keep open and Mute stay at the top for text channels.
- **Voice channels:** Rename, Move and Delete only (already true: `isVoice` drops Icon and NSFW, and `canMute` is false).

## B7. Deleting a voice channel says who's affected
**Today.** `showDeleteModal()` (~3727) uses one text for all channels.
**Change.** For a voice channel with occupants, the body reads "The {n} people in it will be disconnected. The channel is removed for everyone on the server. This can't be undone." ("The 1 person" when singular). If **you** are in it, the existing `VOICE_SESSION_LOST`/channel-deleted handling must leave voice cleanly and show your first text tab. **Verify** that path doesn't leave the voice panel visible.

## B8. Occupant menu
**Today.** The `.occupant-ctx-menu` in `renderOccupants()` has local volume and local mute (persisted by `setSavedLocalVolume()`, clamped 0–200, and `setSavedLocalMute()`), and probably Kick (`KICK_USER`).
**Change.**
1. **Volume:** an in-menu slider, 0–200 in steps of 5, with a live "{n}%" readout and 0% / 100% / 200% ticks. Apply it live through the existing per-consumer gain on `input`, and persist on `change` (not every frame).
2. **Local mute:** "Mute locally" / "Unmute locally", with the hint "Only for you".
3. **Kick:** a "Moderate" label, then **Kick from channel** in red, shown only with the `KICK_USER` permission (`1 << 6`). On success, show the toast `escapeHtml(name) + " was kicked from " + escapeHtml(channel)`.
4. **On yourself:** only "Voice settings…" (opens Settings › Voice).
5. **One builder.** Build this menu with one function so P4 reuses it on voice tiles.

## B9. Tree marks for local volume and mute
**Change.** `renderOccupants()` adds "{n}%" (monospace, muted colour) when the saved volume isn't 100 and the person isn't locally muted, and a speaker-slash when they are locally muted. The existing accent `OCC_LOCALLY_MUTED_ICON` becomes this mark. Update the marks with a targeted update when the menu changes the value.

## B10. Voice row count and session timer
**Depends on** A3.
**Change.** The voice row shows the occupant count (hidden at 0) and, when `occupiedSince` is present, `mm:ss` or `h:mm:ss`.
- **Ticking:** use **one** `setInterval(1000)` for the whole tree that updates every timer's `textContent`. Never one interval per row, and never `renderTree()`. Stop it when no channel is occupied.
- **Server time:** use the server time offset from A3.

## B11. What's new only before connecting
**Today.** `checkForWhatsNew(currentVersion)` (~12228) shows `#whats-new-modal` whenever the version changed. It's marked seen only by the dismiss button.
**Change.** Call it only while **not connected** (welcome/connect state). If the app auto-connects on launch (the remembered credentials path), show What's new **before** starting the connection, and start connecting after Got it or a backdrop close. Alternatively, defer showing it until the user disconnects, which would contradict SPEC §8.3, so prefer the first. After "Restart to update" the app relaunches unconnected anyway.
**Caution.** Keep the `isExistingInstall()` logic and the "backdrop click doesn't mark it seen" rule exactly as they are.

## B12. Update state machine: logic part
**Today.** `UpdateModalState = "idle" | "found" | "downloading" | "ready"`, driven by `update-available` / `download-progress` from `main.ts`. `showUpdateReadyToRestart()` immediately says "restarting…".
**Change.**
1. **One source of truth.** Keep the state in one place and expose it to the About row (`#about-update-status`) and the gear badge.
2. **Ready waits for you.** The "ready" state no longer auto-restarts. The user chooses **Restart now** or **On next launch**. **Verify** what `main.ts` does on `update-downloaded` today (it may call `quitAndInstall()` automatically). Change it to wait for an IPC `update-restart-now`. For "on next launch", electron-updater's `autoInstallOnAppQuit` (default true) installs on quit.
3. **Release notes for a pending update.** Add a preload method that fetches the *available* version's notes (reuse `api.fetchReleaseNotes(version)`).
**Caution.** Keep the Windows unsigned-update verifier override in `main.ts` untouched (root `AGENTS.md`).

---

# P3: Nocturne foundation

## F1. Tokens
- **Add the tokens.** In `index.html`'s `:root`, add every Nocturne variable (README › Design tokens), then **redefine** the old names as aliases (`--bg-primary: var(--color-bg);` and so on, following the README mapping table). Nothing else changes in this item, so the whole app shifts palette at once and can be reviewed in one screenshot pass.
- **Watch for hard-coded colours** in `index.html` and `renderer.ts` (grep `#[0-9a-f]{3,6}` and `rgba(`). List them; replace them in P5, not here.

## F2. Fonts and icons
- **Inter:** check whether Inter is vendored (the `--font` stack names it, but only Noto emoji is in `assets/fonts/`). If it isn't, vendor Inter variable WOFF2 into `assets/fonts/inter/` with its LICENSE.
- **Phosphor:** vendor the Phosphor regular + fill web fonts (or an SVG sprite) into `assets/icons/phosphor/` with the LICENSE.
- **Packaging and CSP:** add both folders to `package.json` `build.files` (it already includes `assets/**/*`, but check). Make sure the CSP `font-src` allows `'self'`. **Test a packaged build** (`npm run test-build:linux`), because missing assets only show up there (root `AGENTS.md` incident).
- **Keep the emoji font:** the emoji font stack (`'Reson8 Emoji'`) must stay first for emoji glyphs, so put Inter after it in `--font`.

## F3. One menu builder
`openMenu(items: MenuItem[], x: number, y: number, opts?: { anchor?: HTMLElement })`, where `MenuItem` is:
- `{ label, icon, onClick, hint?, danger?, disabled? }`
- `{ heading }`
- `{ divider: true }`
- `{ slider: { label, min, max, step, value, onInput, onChange } }`

Behaviour:
- **Lifecycle:** only one menu at a time (closes any other); closes on outside click (capture phase, as today), Esc, `blur` of the window, and scroll of the tree or chat.
- **Position:** clamped to the window on all four sides.
- **Anchor:** adds a `menu-open` class to `anchor` while open (the accent ring).
- **Keyboard:** arrow keys move focus, Enter activates, and focus returns to the trigger on close.
- **Text:** labels set with `textContent`.

Move the channel, tab and occupant menus onto it (they keep their items from B5–B8).

## F4. Base component styles
Buttons (outlined primary, secondary, ghost, icon), tags, inputs, dialogs, toasts and count pills, as classes in `index.html`, written to the README's visual rules. Existing modals keep their ids; only their classes and markup are updated.

---

# P4: New surfaces (build in Nocturne)

## C1. Saved servers, welcome screen and server rail
**Today.** `#toolbar` holds the server URL, nickname, password and invite inputs plus Remember. `reson8-server-url` / `reson8-server-password` hold one remembered server (~1378, ~2245).
**Plan.**
1. **Store.** `reson8-saved-servers`: `[{ id, name, host, port, scheme?, nickname, iconUrl?, lastConnected }]`.
   - **Migration:** on first run, migrate the old keys into one entry, then delete the old keys.
   - **Passwords:** **don't put passwords in localStorage in the new format.** If "Remember" must keep passwords, store them through a new main-process IPC using `safeStorage` (the identity key already uses it, in `identity-key.ts`). Flag this decision to the owner.
2. **Welcome screen.** It replaces the toolbar: a connect form on the left and the saved list on the right (2a/2b). Connect calls the existing `startConnect()` → `resolveConnectionTarget()` chain unchanged.
3. **Rail.** Servers and DMs buttons, the saved servers (icon or initials, active ring), Add, and the settings gear at the bottom.
4. **Switching server.** Disconnect fully (the existing disconnect path), then connect to the new one. Tabs, unread state, the muted store and kept tabs are already keyed per server.
5. **Icons.** On `connected` and on `SERVER_SETTINGS_UPDATED`, write `name` and `iconUrl` (A2) into the saved entry.
**Cautions.**
- `#invite-code` is still revealed by the existing `error` handler (`INVITE_REQUIRED` and related codes), so keep it inside the new form.
- The `#approval-screen` flow and the TLS modals must keep working unchanged; drive each one headless.

## C2. Title-bar server pill, switcher and status bar
The pill shows "Not connected" or "{host} · {nickname}", and opens a popover with the saved servers and Disconnect (1d). The status bar shows "Connected as …", latency from `PING_LATENCY` every 15 s, "Encrypted" when the scheme resolved to https/wss, and "Client {app version}".

## C3. Server header and dropdown
`#tree-header`'s three buttons are replaced by the header (icon, name, "{host} · {n} online") with a caret menu:
- About {server}
- Copy server address
- a divider
- Create channel (needs `MANAGE_CHANNELS`)
- Server settings (admin only)

`#btn-online-users` goes away (its content becomes the DM sidebar, C7). The pending-approvals badge (`#pending-badge-gear`) moves onto the caret, or onto the Server settings item.

## C4. About {server} modal
Data comes from A1 + A2, the TLS state, and latency (three `PING_LATENCY` round trips, take the median; ↻ re-measures). Layout and copy are in SPEC §1.4. The header's "{n} online" and About's online count **must be the same number**, from one function.

## C5. Server icon UI
Reuse the channel-icon crop code (`showChannelIconModal()`, `applyChannelIconCropTransform()`, `clampChannelIconCropOffsets()`). Either extract a shared `IconCropper` or copy it carefully; don't fork the two silently.
- **Upload:** export the cropped square as PNG (canvas), upload through `uploadTo()`, then `UPDATE_SERVER_SETTINGS { iconAttachmentId }`.
- **Copy:** the public-link notice text is in SPEC §1.5.
- **Remove** sends `null`.

## C6. Category context menu and dialogs
Attach the menu in `renderCategory()` (admins only). Rename uses `UPDATE_CHANNEL` on the category node, with the validation in SPEC §3.3. Delete uses A6's `children: "keep" | "delete"`. While the dialog is open, recompute its counts from the live tree, since occupants can change.

## C7. DM sidebar
The rail's DM button swaps `#left-pane`'s content between the channel tree and the DM list.
- **Don't destroy the tree DOM.** Hide it, so its collapsed state survives.
- **The main area doesn't change.** Data comes from A7.
- **Rows:** clicking opens the DM via B4 (preview tab). The nudge button stays (`buildNudgeButton()`, `canNudge()`).
- **Badge:** the rail badge is the sum of unread DM counts, minus the conversation currently read.
- **Not connected:** the button is disabled.

## C8. Tab bar: overflow, no "+"
- **Remove** the "+" button.
- **Measure:** use a `ResizeObserver` on `#tab-bar` and measure each tab's real `offsetWidth` (cache it per tab and invalidate it when the label or badge changes).
- **Overflow button:** tabs past the available width move into a "{n} more ▾" dropdown (SPEC §4). The active tab always stays visible (it swaps with the last one that fits). The button shows an accent dot when a hidden tab has unread messages.
- **Hide, don't detach.** Hidden tabs are `display: none`, not removed: their `.tab-content` and scroll state must be untouched.
- **No layout loop.** Measure in the ResizeObserver callback and change only visibility.

## C9. Voice room tab: people
- **The tab:** a `ChatTab`-like entry with `kind: "voice"` (or a separate `voiceTab` object; prefer separate, so the chat-only fields like the scroll keeper don't apply). There is **at most one**, and it's never a preview tab.
- **Opening and closing:** the voice dock's "Expand voice room" button (tooltip text) or clicking a voice channel row opens it. Its × only closes the tab; **don't call leave-voice**. Leaving voice closes the tab.
- **Tiles:** built from the room's occupants, with `activeSpeakers` driving the speaking ring and the existing mute/deafen icons plus the local marks (B9).
  - **Mosaic:** tiles fitted to the area at 4:3, recalculated on resize. Disabled while anyone shares.
  - **Featured:** five tiles plus "…and {n} more" (a popover list).
  - **Persist** the user's choice in `reson8-voice-layout`. The forced Featured during shares isn't persisted.
- **Right-click** a tile for the B8 menu (the shared builder).
- **Speaking updates:** they arrive often. Update with class toggles only (no rebuilding tiles on `ACTIVE_SPEAKERS`).

## C10. In-app stream stage, with an optional pop-out
**Decision (from the owner):** each window has its **own copy, one at a time**. A short reconnect when popping out or bringing back is acceptable.

**Today.**
- **Watching:** the Viewer window (`viewer.html`/`viewer.ts`, `preload-viewer.ts`) opens its **own** "viewer"-role socket using a ticket (`REQUEST_VIEWER_TICKET`, `viewer-ticket.service.ts`, `VIEWER_AUTHENTICATE`), then `WATCH_SCREEN_SHARE` → its own recv transport and consumers. It ends with `STOP_WATCHING_SCREEN_SHARE`.
- **Sharer notifications:** the sharer gets `VIEWER_JOINED_YOUR_STREAM` / `VIEWER_LEFT_YOUR_STREAM` (and the sound alerts).

**Plan.**
1. **In-app watching uses the same mechanism as the Viewer:** a hidden, in-process "stage viewer" that runs the same viewer-socket handshake from the **main renderer**. This reuses the server path that already works and keeps the main voice socket untouched.
   - **Alternative:** consume the screen producer on the main socket's existing recv transport (`CONSUME`). Only do this if `voice.service.ts` already receives `NEW_PRODUCER`/`EXISTING_PRODUCERS` for screen video and the server allows the main socket to consume it. **Verify both before choosing**; the viewer-socket path is the lower-risk default.
2. **Pop out:** stop the stage's watch (close its consumers and transport, `STOP_WATCHING_SCREEN_SHARE`, close its viewer socket), **then** open the Viewer window (the existing IPC). The stage shows the "in its own window" placeholder with **Bring it back** and **Show window** (an IPC to focus or flash the Viewer).
3. **Bring back:** close the Viewer (the existing close path does its own `STOP_WATCHING`), wait for its `closed` event (a new main → renderer IPC, `viewer-closed`), **then** start the stage watch again.
   - **Unexpected close:** if the user closes the Viewer with its window × or Return, the stream automatically comes back to the stage.
4. **Never two at once.** Keep a single state, `stageWatch: "idle" | "stage" | "popping" | "popped" | "returning"`, and ignore clicks while it's in a transition state.
5. **Viewer window additions.**
   - **Always on top:** a toggle, on by default. A new IPC calls `win.setAlwaysOnTop(flag, "floating")`; remember the setting in `reson8-viewer-on-top`.
   - **Title:** "{sharer} · {stream name} — {room}".
   - **Return to Reson8:** closes the window and focuses the main one.
6. **Sharer side.** The sharer sees one join and one leave each time someone pops out or brings back. That's acceptable but noisy. Consider suppressing the join/leave sound when the same viewer user rejoins within 3 s (a client-side debounce in the sharer's handler). Don't change the server.

**Cautions.**
- `requireServerAccess()` and the PRD 18.18 rule: losing access must close both the stage watch and the Viewer.
- Leaving voice or switching rooms stops the stage watch first.
- The sharer stopping (`PRODUCER_CLOSED`) returns the stage to the people view, and closes a popped-out Viewer as today.
- Audio from a share: one playback element per stream, created with `document.createElement("audio")` and appended to `document.body` (root `AGENTS.md` rule).
- Fullscreen: reuse the fullscreen approach validated in PRD 18.19 (verify it on Windows and Wayland; `nextsteps.txt` lists that as untested).

**Done when.**
- **Single stream:** watching in-app works.
- **Pop out and back:** pop out, then the stream appears in the Viewer within ~1–2 s and the stage shows the placeholder. Bring back reverses it.
- **Closing the Viewer** by its × brings the stream back.
- **Bandwidth:** at no point do both windows consume, as seen in the server's consumer count or `chrome://webrtc-internals`.

## C11. Multiple streams: Focus and Grid
**Depends on** A4 and C10.
- **Focus:** the main stream uses the full C10 stage watch. "Also live" previews show the other streams.
  - **Recommended:** live previews at the **lowest SVC spatial layer** through each stream's own consumer (`consumer.setPreferredLayers({ spatialLayer: 0 })`, VP9 SVC from Phase 12).
  - **Cheaper fallback:** a static "LIVE" card with the stream name, without video.
  - **Cost:** this means up to 5 concurrent consumers per watcher. **Measure the CPU and bandwidth before committing,** and make previews pause when the voice tab isn't visible.
- **Swapping:** clicking a preview swaps it in. Raise that consumer's preferred layers and lower the previous one's; don't close and reopen.
- **Grid:** every stream at the same size, at medium layers.
- **People row:** people collapse to the chip row.
- **Popping out one stream** follows C10 for that stream only. The others keep playing in-app.

## C12. Update corner card
This replaces `#update-modal`'s role with a corner card (15b) driven by the B12 state:
- **Available:** What's new, Later, Update.
- **Downloading:** progress, Hide.
- **Ready:** On next launch, Restart now.
- **In a call:** the amber note.
- **Dismissing** hides only the card; the About row and the gear dot keep the state.
- **Errors** still go through `showUpdateError()`'s text (with the manual GitHub download hint).
- **Keep `#update-modal` for `version-mismatch`?** No: `#version-mismatch-modal` is separate. Leave it.

---

# P5: Restyle the remaining existing screens
One item per screen group, visual only, each checked against its study frame.
- **Connect states:** connect, TLS trust/changed, approval, invite (2a–3b).
- **Chat:** message list, hover toolbar, replies, pins, link previews, lightbox (1a).
- **Client Settings:** every page (4a–4h).
- **Server settings:** restructured into a left-nav layout (5a–5f). This is a markup change of `#admin-modal`; keep every existing id the code queries, or update the queries in the same commit.
- **Dialogs:** the share picker (1k–1m), create channel (1g/1h), profile card (1j), search (1i).
- **Hard-coded colours:** replace the ones listed in F1.

Remove the old CSS variable aliases only after a final grep shows no remaining use.
