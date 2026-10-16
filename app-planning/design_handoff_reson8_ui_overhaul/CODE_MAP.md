# Code map: study → `reson8/apps/client`

Status legend:
- **Exists:** the behaviour is already there, so restyle only.
- **Modify:** change existing behaviour.
- **New:** build from scratch.
- **🖧:** needs `packages/shared-types` + `apps/server` work first (follow the repo's shared-types-first workflow).

All `renderer.ts` line numbers are as of v2.7.0 and are only a guide; search by function name.

## 0. Foundation
| Item | Where | Status |
| --- | --- | --- |
| Tokens | `src/renderer/index.html` `:root` (lines ~25–49): replace with the Nocturne tokens, alias the old names (see README) | Modify |
| Fonts / icons | vendor Inter + Phosphor into `assets/`; add them to `package.json` `build.files`; check the CSP in `index.html` | New |
| Emoji/SVG icons in menus and buttons | `attachChannelContextMenu()` (~2920) uses emoji labels; `OCC_*_ICON` SVG constants (~3005); the toolbar SVGs in `index.html` | Modify |
| Menu builder | today, each menu builds `innerHTML` by hand (`.occupant-ctx-menu`, `.channel-ctx-menu-item`). Extract one `openMenu(items, x, y, anchorEl)` that supports labels, dividers, danger items, a slider item and hints | New |

## 1. Shell and servers
| Item | Where | Status |
| --- | --- | --- |
| Server rail + saved servers (1a, 2b) | today it's the `#toolbar` connect form + `reson8-server-url`/`-password` (~1378, ~2245). Replace with the welcome screen + `reson8-saved-servers`, and migrate the old keys into the first entry | New |
| Connect flow states (2a–3b) | `startConnect()` → `resolveConnectionTarget()`; `#tls-trust-modal`, `#tls-changed-modal`, `#approval-screen`, `#invite-code` | Exists (restyle) |
| Title-bar pill / switcher (1d) | new; uses the saved servers | New |
| Server header + dropdown (1e) | `#tree-header` (index.html ~5321), with its `#btn-online-users`, `#btn-server-settings` and `#btn-create-channel` buttons → becomes the header + caret menu | Modify |
| "{n} online" in the header | derive it from presence (the same source `renderOnlineUsers()` uses) | New |
| About server (16a) | new modal. **Name + feature toggles:** `GET_SERVER_SETTINGS` (`nudgeEnabled`, `screenShareEnabled`) + the join-gate settings (approve, invite, signed identity). **Encryption:** the TLS state from `resolveConnectionTarget()`. **Latency:** a socket ping round trip; add a preload method if none exists | New |
| About server: admins and total members | 🖧 `GET_ALL_USERS` is permission-gated, so ordinary members can't read it. Add a member-visible summary event (e.g. `GET_SERVER_SUMMARY → { name, admins: {userId,nickname,isOnline}[], memberCount, onlineCount, features }`) | New 🖧 |
| Server icon (12a–12d) | 🖧 new `iconUrl` on the server settings model + an upload route served from a **public, unauthenticated** path; reuse the channel-icon crop (`showChannelIconModal()` ~11329, `applyChannelIconCropTransform()` ~11445) and the upload plumbing in `preload.ts` (`uploadTo()`). Cache `iconUrl` in `reson8-saved-servers` on connect and on `SERVER_SETTINGS_UPDATED` | New 🖧 |
| Status bar ("Encrypted", "Client {v}") | new element; the version comes from the existing app-version IPC | New |

## 2. Channel tree
| Item | Where | Status |
| --- | --- | --- |
| Tree render | `renderTree()` (~2578), `renderCategory()` (~2666). Keep the targeted-update rule (collapsed state) | Modify (restyle) |
| Mute channel | `isChannelMuted()`/`setChannelMuted()`/`applyChannelMuteState()` (~2716–2800), `reson8-muted-channels` | Exists. **Check:** muted channels hide the tree count *and* the tab badge, and show the bell-slash |
| Unread counts | `markChannelUnread()` (~7117), `unreadChannelIds`. Today these are dots; change them to **counts** (a per-channel number) | Modify |
| Occupants + local volume/mute marks | `renderOccupants()` (~3037), `updateOccupants()` (~4410), `getSavedLocalVolume()` (clamped 0–200 ✓), `getSavedLocalMute()` | Modify (add the "{n}%" mark) |
| Voice count pill | `renderTree()` voice rows | Modify |
| Per-channel session timer (§2.2) | 🖧 the server needs to send `occupiedSince` per voice channel in `CHANNEL_TREE_UPDATE` (set when the first person joins, cleared when it empties). `#voice-session-timer` (index.html ~5360) is the *user's own* call timer in the voice dock; keep it | New 🖧 |

## 3. Context menus
| Item | Where | Status |
| --- | --- | --- |
| Text channel menu (6a) | `attachChannelContextMenu(el, node, canMute)` (~2920); Keep open = `setTabKept()`; Mute = `setChannelMuted()` | Exists (restyle; add the "Manage channel" label; hide the admin items for non-admins) |
| Rename (6c) | `showRenameModal()` (~3755), `#rename-channel-modal` | Exists (restyle + pre-select + inline validation) |
| Set icon (6d, 6e) | `showChannelIconModal()` (~11329), `#channel-icon-modal` | Exists (restyle) |
| Move (6f) | `showMoveModal()` (~3838), `#move-channel-modal`, `MOVE_CHANNEL` | Exists (restyle) |
| NSFW | `api.updateChannel(id, { isNsfw })` inside the menu | Exists |
| Delete (6g, 7b) | `showDeleteModal()` (~3727), `#delete-channel-modal`; add the voice-occupant count line | Modify |
| Voice channel menu (7a) | the same function; `isVoice` already drops Set icon and NSFW. Also drop Keep and Mute for voice (`canMute` is already false) | Exists (restyle) |
| Category menu (14a–14d) | **new**, attached in `renderCategory()`. Rename → `UPDATE_CHANNEL` on the category node. Delete with "keep channels" → `MOVE_CHANNEL` each child to `newParentId: null`, then `DELETE_CHANNEL`. Delete with "delete channels" → 🖧 check whether `DELETE_CHANNEL` on a parent cascades; if not, add a cascading option server-side so it's atomic | New (maybe 🖧) |
| Occupant menu (8a–8c) | the existing `.occupant-ctx-menu` in `renderOccupants()`; volume and local mute already persist; Kick = `KICK_USER` (permission `KICK_USER = 1<<6`), with `CHANNEL_USER_KICKED` updating others | Modify (slider item, "Only for you" hint, the "Moderate" group, reuse it on tiles, self = Voice settings only) |
| Tab menu (6b) | `showChannelTabContextMenu()` (~5414) | Modify (add Close others / Close to the right; DM + voice tabs) |

## 4. Tabs
| Item | Where | Status |
| --- | --- | --- |
| Preview / kept | `previewTabId`, `ChatTab.mode` (~2053–2067), `openChatTab()` (~5140), `setTabKept()` (~5383), `restoreKeptTabs()` (~5456), `persistKeptTabs()` | Exists |
| DMs as preview tabs | `openDmTab()` (~5265): today DM tabs are "unaffected" by the preview rules and `mode` is "channel tabs only". Give DM tabs a `mode`; let `previewTabId` hold a DM; persist kept DMs in `reson8-kept-tabs` (a key prefix like `dm:{userId}`). **Watch** `autoOpenUnreadDmTabs()` (~3187) and `applyAccessState()`; unread DMs auto-opening should use preview mode | Modify |
| Voice room tab | **new** `kind: "voice"` tab (§6). Opened by the voice dock button and voice-row clicks; × closes the tab only (not `leaveVoice`) | New |
| Tab badges (counts, muted) | the tab bar (`#tab-bar`) render; tie it into the `markChannelUnread()` / `unreadDmPartners` paths | Modify |
| Overflow "{n} more" | the tab bar; a ResizeObserver on `#tab-bar` measures the real tab widths | New |
| Remove "+" | the tab bar markup | Modify |
| `closeTab()` | (~5352); voice tab close → show the first text tab | Modify |

## 5. Direct messages
| Item | Where | Status |
| --- | --- | --- |
| DM list in the sidebar | today it's `#online-users-modal` + `renderOnlineUsers()` (~7308), with nudge from `buildNudgeButton()` (~7389) / `canNudge()`. Move it into the sidebar (the rail button swaps `#left-pane` content) | Modify |
| All registered members, not only online | `renderOnlineUsers()` already receives `{userId, nickname, isOnline}[]`. **Confirm** the payload includes offline members for non-admins; if not 🖧 | Verify |
| Ordering + "No messages yet" | needs the last DM per partner. 🖧 if there's no "conversation list" event yet (check the `GET_DM_*` events in `socket-events.ts`) | Verify / maybe 🖧 |
| Unread counts | `unreadDmPartners` (today a set of dots) → counts; `markDmTabRead()` (~2158) is the only way to mark something read (keep it) | Modify |
| Rail DM badge total | new | New |

## 6. Voice room
| Item | Where | Status |
| --- | --- | --- |
| In-app voice room view | **new** (a tab body). Data comes from the channel occupants + `activeSpeakers` + the share state (`SET_SCREEN_SHARE_STATE`, the LIVE badges from Phase 12) | New |
| Mosaic / Featured + "…and n more" popover | new; persist as `reson8-voice-layout` | New |
| Single-share stage | **Decided:** in-app by default; each window has its own copy, one at a time (the stage stops watching, then the Viewer starts; the reverse on bring-back). A short reconnect is acceptable. Plan in PENDING_FEATURES.md › C10 | New |
| Pop-out window (10a) | `viewer.html` / `viewer.ts`: add Always on top (a main-process `setAlwaysOnTop` via IPC), the title format, and a "Return" action that closes the window and focuses the main stage | Modify |
| 5-stream cap | 🖧 the server must refuse a 6th `SET_SCREEN_SHARE_STATE` per room with an error code; the client shows the toast. `updateShareScreenButton()` (~3397) shows "· 5/5" | New 🖧 |
| Focus / Grid | new | New |
| Voice card, always shown (17a, 17b) · rev 2 | the voice dock (the element that holds `#voice-session-timer`, mute/deafen and their device menus). **Verify** where it's shown and hidden today (probably in the join/leave handlers or a `renderVoiceDock()`-style function) and how the mute/deafen state is stored | Modify |
| Share picker (1k–1m) | `openScreenShareModal()` (~10567), `startScreenShareViaSystemPicker()` (~3601), `promptForStreamName()` (~3636) | Exists (restyle) |

## 7. Settings
| Item | Where | Status |
| --- | --- | --- |
| Client settings pages (4a–4h) | the settings modal in `index.html` (~6200–6520) | Exists (restyle) |
| Glass category menu (17c, 17d) · rev 2 | the left nav column of the client settings modal and of `#admin-modal`. **Verify** whether both use one shared nav class; if they do, the change is one CSS rule plus the glow element(s) | Modify (visual) |
| Server settings (5a–5f) | `#admin-modal` with tabs `roles` / `emojis` / `server` (~5933). The study reorganises it into General · Members · Joining & invites · Bans · Sign-in security · Identity log · Emoji (a left nav) | Modify (restructure) |

## 8. Updates
| Item | Where | Status |
| --- | --- | --- |
| Startup check → corner card | `main.ts` electron-updater → `update-available` / `download-progress` events → today `showUpdateFoundModal()` (~12139) + `#update-modal`. Swap the modal for the corner card with the same state machine (`idle → found → downloading → ready`); errors still go through `showUpdateError()` | Modify |
| About row states | `#btn-check-updates`, `#about-update-status` (index.html ~6498) | Modify |
| Gear dot | new; set from `updateModalState` | New |
| What's new only before connecting | `checkForWhatsNew()` (~12228): gate it on "not connected / welcome screen". After restart-to-update the app starts on the welcome screen anyway | Modify |
| Release notes from About / pending update | reuse `#whats-new-modal`, adding the kicker and footer variants | Modify |

## Server and shared-types work (🖧) to scope first
> The full, step-by-step plan for each item is in PENDING_FEATURES.md (A1–A7). Also new there: **A5, unread counts for channels**: the tree only carries a boolean `hasUnread` today.
1. A member-visible server summary (admins, counts, features) for About.
2. Server icon: storage, a public URL, `iconUrl` in the settings payload and `SERVER_SETTINGS_UPDATED`.
3. `occupiedSince` per voice channel in the channel tree.
4. A cap of 5 concurrent screen shares per room, with an error code.
5. *(verify)* a category delete that cascades; a DM conversation list with last message; offline members visible to non-admins.
