# Reson8 — Phase 19 PRD (UI Overhaul, "Nocturne")

**Created:** 13/10/2026
**Author:** Felipe B. Netto (assisted by AI)
**Status:** Draft — all 18 open decisions answered by the user (13/10/2026); awaiting final approval before implementation starts
**Source:** `app-planning/design_handoff_reson8_ui_overhaul/` (README, `PENDING_FEATURES.md` = the plan, `SPEC.md` = final behaviour rules, `CODE_MAP.md`, `TEST_STATES.md`, `screenshots/<frameId>.png`), plus the user's beta-release requirements (item R0)
**Branch:** `ui-overhaul-beta` (confirmed with `git branch --show-current` on 13/10/2026). **Never commit to or merge into `main`** — the move to `main` is done later, by the user.
**Versioning:** every bump in this phase is a **beta prerelease of the next minor/major line: `3.0.0-beta.1`, `3.0.0-beta.2`, …** — never a plain `3.0.0`.

---

## Table of Contents

0. [Verification Findings (every "Verify" in PENDING_FEATURES.md, resolved against the code)](#verification-findings)
1. [How to Execute This PRD (read before starting any item)](#how-to-execute-this-prd-read-before-starting-any-item)
2. **P0 — Release pipeline**
   - [R0 — Beta Release Pipeline (prereleases, update channel, version comparison)](#r0--beta-release-pipeline)
3. **P1 — Protocol and server groundwork (🖧)**
   - [A1 — Member-Visible Server Summary](#a1--member-visible-server-summary-)
   - [A2 — Server Icon (upload, validation, public URL)](#a2--server-icon-)
   - [A3 — Complete the Existing Per-Channel Voice Session Timer (rewritten)](#a3--complete-the-existing-per-channel-voice-session-timer-)
   - [A4 — Cap of 5 Concurrent Screen Shares per Room](#a4--cap-of-5-concurrent-screen-shares-per-room-)
   - [A5 — Unread Counts for Channels](#a5--unread-counts-for-channels-)
   - [A6 — Category Delete With Children (+ server-side voice teardown on delete)](#a6--category-delete-with-children-)
   - [A7 — DM Directory](#a7--dm-directory-)
   - [A8 — The Client Learns Its Own Permissions (NEW, from the audit)](#a8--the-client-learns-its-own-permissions--new)
   - [A9 — Enforce the Screen-Share Switch at PRODUCE and CONSUME (NEW, security — D7)](#a9--enforce-the-screen-share-switch-at-produce-and-consume--new-security)
   - [A10 — Validate Every Upload by Its Real Bytes (NEW, security — D9)](#a10--validate-every-upload-by-its-real-bytes--new-security)
4. **P2 — Behaviour in the current UI**
   - [B1 — Unread Counts in the Current UI](#b1--unread-counts-in-the-current-ui)
   - [B2 — Muted Channels Are Fully Silent](#b2--muted-channels-are-fully-silent)
   - [B3 — One "Mark Channel Read" Rule for Tree and Tab](#b3--one-mark-channel-read-rule-for-tree-and-tab)
   - [B4 — DM Tabs Follow the Preview/Kept Rules](#b4--dm-tabs-follow-the-previewkept-rules)
   - [B5 — Tab Menu Additions](#b5--tab-menu-additions)
   - [B6 — Menu Permissions and the Voice Channel Menu](#b6--menu-permissions-and-the-voice-channel-menu)
   - [B7 — Deleting a Voice Channel Says Who's Affected](#b7--deleting-a-voice-channel-says-whos-affected)
   - [B8 — Occupant Menu](#b8--occupant-menu)
   - [B9 — Tree Marks for Local Volume and Mute](#b9--tree-marks-for-local-volume-and-mute)
   - [B10 — Voice Row Count and Session Timer (mostly exists)](#b10--voice-row-count-and-session-timer)
   - [B11 — What's New Only Before Connecting](#b11--whats-new-only-before-connecting)
   - [B12 — Update State Machine: Logic Part](#b12--update-state-machine-logic-part)
   - **→ First beta release: `3.0.0-beta.1`** (end of P2)
5. **P3 — Nocturne foundation**
   - [F1 — Tokens](#f1--tokens)
   - [F2 — Fonts and Icons (vendored Inter + Phosphor)](#f2--fonts-and-icons)
   - [F3 — One Menu Builder](#f3--one-menu-builder)
   - [F4 — Base Component Styles](#f4--base-component-styles)
6. **P4 — New surfaces (built directly in Nocturne)**
   - [C1 — Saved Servers, Welcome Screen and Server Rail](#c1--saved-servers-welcome-screen-and-server-rail)
   - [C2 — Title-Bar Server Pill, Switcher and Status Bar](#c2--title-bar-server-pill-switcher-and-status-bar)
   - [C3 — Server Header and Dropdown](#c3--server-header-and-dropdown)
   - [C4 — About {server} Modal](#c4--about-server-modal)
   - [C5 — Server Icon UI](#c5--server-icon-ui)
   - [C6 — Category Context Menu and Dialogs](#c6--category-context-menu-and-dialogs)
   - [C7 — DM Sidebar](#c7--dm-sidebar)
   - [C8 — Tab Bar Overflow](#c8--tab-bar-overflow)
   - [C9 — Voice Room Tab: People](#c9--voice-room-tab-people)
   - [C10 — In-App Stream Stage With an Optional Pop-Out](#c10--in-app-stream-stage-with-an-optional-pop-out)
   - [C11 — Multiple Streams: Focus and Grid](#c11--multiple-streams-focus-and-grid)
   - [C12 — Update Corner Card](#c12--update-corner-card)
   - **→ Second beta release: `3.0.0-beta.2`** (end of P4)
7. **P5 — Restyle of the remaining screens (§R)**
   - [R1 — Connect States](#r1--connect-states)
   - [R2 — Chat](#r2--chat)
   - [R3 — Client Settings](#r3--client-settings)
   - [R4 — Server Settings (left-nav restructure)](#r4--server-settings-left-nav-restructure)
   - [R5 — Dialogs](#r5--dialogs)
   - [R6 — Hard-Coded Colours and Alias Removal](#r6--hard-coded-colours-and-alias-removal)
   - **→ Third beta release: `3.0.0-beta.3`** (end of P5)
8. [Cross-Cutting Dependencies & Implementation Order](#cross-cutting-dependencies--implementation-order)
9. [Compatibility Summary](#compatibility-summary)
10. [Pre-Existing Issues Noticed During the Audit](#pre-existing-issues-noticed-during-the-audit)
11. [Open Decisions](#open-decisions) (all 18 confirmed with the user on 13/10/2026)

> **Naming note:** the handoff's P5 section ("§R") has no item ids. Its items are numbered **R1–R6** here. **R0** is the release-pipeline item you asked for; it shares the letter but not the phase (it runs first, as P0).

---

> [!IMPORTANT]
> **Binding rules for this whole phase.**
> - **Branch:** all work happens on `ui-overhaul-beta`. Before every item run `git branch --show-current`; if it prints anything else, **stop and ask**. Never commit to, merge into, or rebase onto `main`.
> - **Versions:** every bump is `3.0.0-beta.N` through the prerelease-ready bump procedure (R0 makes it ready). Never `3.0.0`.
> - **Order:** P0 (R0) → P1 → P2 → P3 → P4 → P5. **One PRD item at a time.** Within an item: shared-types → server → preload → renderer.
> - **Old servers:** every new wire field is optional (`?`) and every new event has a fallback (ack timeout / "unknown event" → today's behaviour). A 3.0.0-beta client must keep working against a v2.7.0 server.
> - **After each item:** `npm run typecheck` (= `npx tsc --noEmit`) in every touched workspace, `npm run lint` at the root (must exit 0), `npm run test` in `apps/server` when the server changed (add or extend a test whenever server logic changes), every relevant `npm run test:*` in `apps/client`, drive the real app headlessly (recipe in `apps/client/AGENTS.md`) and screenshot it against the matching study frame (`app-planning/design_handoff_reson8_ui_overhaul/screenshots/<id>.png`), then `/log-progress`, then a local commit (no push) and **stop for the user's go-ahead**.
> - **Security:** never weaken a security check to make something pass. `textContent` for dynamic text; `escapeHtml()` before `showToast()` (it uses `innerHTML`); new Node/Electron access only via `preload.ts` + a validated `ipcMain` handler.
> - **If the plan conflicts with the code or the conventions, stop and tell the user** instead of improvising.

> [!NOTE]
> This PRD was written after reading the root and `apps/client` `AGENTS.md`, the progress-log summaries, every handoff document, the Phase 18 PRD (for format), and the code each item touches: `socket-events.ts`, `models.ts`, `schema.prisma`, `connection.handler.ts`, `voice.handler.ts`, `channel.handler.ts`, `dm.handler.ts`, `nudge.handler.ts`, `moderation.handler.ts`, `admin.handler.ts`, `access.service.ts`, `voice-session.service.ts`, `presence.service.ts`, `admin-users.ts`, `upload.route.ts`, `index.ts` (server), `main.ts`, `preload.ts`, `preload-viewer.ts`, `renderer.ts`, `index.html` (client), `scripts/release-all.mjs`, `.claude/commands/bump-version.md`, and the published `electron-updater@6.8.9` sources (`GitHubProvider.js`, `AppUpdater.js` — the version locked in `package-lock.json`). Line numbers are as of 13/10/2026 (v2.7.0, commit `d284725`) and **will drift** — always find code by searching for the function name.

---

## Verification Findings

Every **Verify** in `PENDING_FEATURES.md` (and the "verify"/"check" notes in `CODE_MAP.md`), resolved by reading the code. "Plan holds" = the handoff's approach is kept; "Plan changed" = the item below was rewritten to match reality.

| # | Item | Question | What the code shows (file:line, approx.) | Verdict |
|---|------|----------|------------------------------------------|---------|
| V1 | A1 | Where is `GET_SERVER_SETTINGS` handled? | `apps/server/src/handlers/nudge.handler.ts:76`. Admin-only fields are gated by `isAdmin(perms)` (`:103`). The broadcast `SERVER_SETTINGS_UPDATED` (`:258`) carries only `nudgeEnabled`, `screenShareEnabled`, `maxMessageLength` (`socket-events.ts:972`). | Plan holds. **Addition:** the broadcast must also carry the three join-gate booleans (and A2's `iconUrl`) so About updates live. |
| V2 | A1/A7 | Does `GET_ONLINE_USERS` include offline users, and for whom? | `dm.handler.ts:326–388`: everyone **online** on the server **plus** offline users who have **an existing DM with the caller**. Never-messaged offline members are not included. One Prisma query per user (N+1). | Plan holds: A7 needs a new event. |
| V3 | A1 | Is a "user" a person or an identity? | `userId` = the per-install `instanceId` (root `AGENTS.md` › Identity). The same person on two PCs is two users. The server cannot count "people". | **Plan changed:** counts are per `userId`, documented (user decision Q2). |
| V4 | A1 | Who are "members"? | Membership = `user_servers` rows (`schema.prisma` `UserServer`, PRD 18.17), access = aggregated perms include `CONNECT` or `ADMIN` (`access.service.ts:hasServerAccess`). Bans in `banned_users`. | Plan holds: total = members **with access**, not banned (user decision Q2). |
| V5 | A1 | How is a new event gated for restricted users? | `access.service.ts:EVENT_ACCESS` — a `Record<keyof ClientToServerEvents, "open" \| "member">`, so the compiler forces a classification. | Plan holds: `GET_SERVER_SUMMARY` = `"open"`, `GET_DM_DIRECTORY` = `"member"` (user decision Q8). |
| V6 | A2 | Are uploaded files publicly fetchable without a token? | **Yes.** `apps/server/src/index.ts:106` registers `@fastify/static` on `/uploads/` with no auth; `@fastify/cors` is registered globally with `origin: true` (`:100`). Each stored file name is `<uuid>-<sanitized client name>` (`upload.route.ts:saveLocally`), so a new upload always gets a new URL. Cloudinary mode returns an absolute `https` URL. | **Plan changed:** no new public route. The icon's public link *is* its `/uploads/…` URL (or Cloudinary URL), resolved with `resolveMediaUrl()`. A new **upload** route is still needed for validation. |
| V7 | A2 | Is the image validated server-side? | Only the **client-declared** multipart MIME type is checked (`upload.route.ts:167`), and the stored extension comes from the **client's file name**. No magic-byte check, no dimension check, and the server has no image library (`apps/server/package.json`). | **Plan changed:** no re-encoding on the server (no `sharp`, user decision Q6). A pure TS sniffer checks the magic bytes and reads the dimensions; the client re-encodes a square PNG. See also Pre-existing issue P1. |
| V8 | A2 | Does the renderer CSP allow the server's images? | `index.html:8`: `img-src 'self' blob: http: https: data:`. | Plan holds. |
| V9 | A3 | Is there any per-channel occupied-since time today? | **Yes — already built in Phase 8.** Server: an in-memory `voiceSessionStartedAt: Map<channelId, Date>` (`connection.handler.ts:114`), set when the first occupant joins a VOICE channel (`:973`), deleted when the occupant set is empty (`:237, :265, :946, :1044`), and sent as `sessionStartedAt` on **every** `PRESENCE_UPDATE` from `connection.handler.ts` and `voice.handler.ts`. Deletion runs only in the ownership-checked paths (`supersedeSocket`, `finalizeDisconnect` after the 10 s grace), so a blip does not reset it. Client: `sessionTimers` map (`renderer.ts:1207`), a `.session-timer` badge in the tree (`:2864`), **one** global 1 s `setInterval` (`:4373`), and clock-skew correction via `correctedNow()` / `api.getClockOffset()` (PING_LATENCY, PRD 11.2). | **Plan changed (rewritten):** A3 no longer adds Redis keys or a new field name. It completes the existing feature. |
| V10 | A3 | Gaps in the existing timer | (a) The **join-time** `CHANNEL_TREE_UPDATE` carries no start time, so a client that connects while a room is occupied shows no timer until the next `PRESENCE_UPDATE`. (b) `KICK_USER` (`moderation.handler.ts:95`) and `broadcastChannelOccupants()` (`voice-session.service.ts:61`, used by the PRD 18.18 access change) emit `PRESENCE_UPDATE` **without** `sessionStartedAt` and **without** clearing the map when the room empties. The client then **deletes** the timer for a room that is still occupied (`renderer.ts:4246–4250`). (c) A server restart re-seeds the start time to "now" at the next join (`:819`). | A3 fixes (a) and (b), and documents (c). |
| V11 | A4 | Is sharing gated at `PRODUCE` or only at `SET_SCREEN_SHARE_STATE`? | `PRODUCE` (`voice.handler.ts:234`) checks **nothing** about screen sharing: no toggle, no cap. It stores the producer in `session.screenVideoProducer` when `appData.mediaType === "screen-video"` (`:262`). `SET_SCREEN_SHARE_STATE` (`:504`) only coerces the presence flag to `false` when the toggle is off. The real enforcement of the toggle is in `WATCH_SCREEN_SHARE` (`:561`). | Plan holds: the cap goes in `PRODUCE` (screen-video) with a per-channel critical section, and is mirrored in `SET_SCREEN_SHARE_STATE`. |
| V12 | A5 | How is `hasUnread` computed? | `connection.handler.ts:annotateUnreadChannels` (`:142`): one `groupBy` of the latest message per channel **excluding the user's own** vs. `channel_reads.lastReadAt`. Never read = unread. Only on the per-socket join tree (tree broadcasts don't carry it). | Plan holds. Counting uses a capped LATERAL query (see A5). |
| V13 | A6 | What happens to children when a parent is deleted? | `channel.handler.ts:131–197`: children are **re-parented by the FK's `onDelete: SetNull`**. They keep their **old `position`**, so they interleave with existing top-level channels. **No voice teardown at all on any channel delete:** occupants' mediasoup sessions and presence are left to each client's `channel-deleted` handler (`renderer.ts:4356`), and `voiceSessionStartedAt` is not cleared. | **Plan changed:** the default (no `children` field) stays exactly today's behaviour. `"keep"` re-parents with fresh positions. `"delete"` deletes the subtree. Every deleted VOICE channel now gets a **server-side** quiet voice teardown (decision D6, confirmed). |
| V14 | A7 | Can a member DM an offline person who never had a conversation? | **Yes**, server-side: `SEND_DIRECT_MESSAGE` only checks that the recipient exists and has access (`dm.handler.ts:113–131`). The Phase 7 "first contact needs both online" limit is gone from the server; only the UI (online-users modal) limits it. No "conversation list" event exists. | Plan holds: new `GET_DM_DIRECTORY`. |
| V15 | B2 | Does a muted channel's tab still show an unread dot? Do alerts respect mute? | `refreshTabUnread()` (`renderer.ts:2133`) already hides the dot for muted channels, and the tree suppresses it (`:2884`). **There is no sound alert for channel messages at all** (only DMs play `hey_wake_up.mp3`). | **Plan changed (smaller):** B2 adds only the fade, the bell-slash and the count-pill behaviour. |
| V16 | B3 | Does `switchTab()` call the read routine? | **Yes:** `switchTab()` calls `markChannelRead(tabId)` unconditionally (`renderer.ts:5080`), so opening from a tab already clears unread. Neither path checks window focus; `MESSAGE_RECEIVED` on the active tab is never counted, even when the window is unfocused. | **Plan changed:** B3 is about one helper and the focus rule (decision D1, confirmed: adopt the focus rule), not about a missing call. |
| V17 | B4 | DM tab id format | Already `dm:<userId>` everywhere (`renderer.ts:5267`, `refreshTabUnread`'s `slice(3)`), so ids can't collide with channel UUIDs. **`openDmTab()` always switches to the tab**, and an **incoming DM from someone without a tab calls `openDmTab()`** (`:7266`), so it steals the view today. | Plan holds. Incoming DMs open as **kept, unfocused** tabs (user decision Q5). |
| V18 | B6 | Where does the client learn its own permissions? | **It doesn't.** It probes: `GET_ROLES` succeeds ⇒ `isAdminUser` (= MANAGE_ROLES despite the name), `GET_BANNED_USERS` ⇒ `canBanUsers`, `GET_PENDING_EMOJIS` ⇒ `canManageEmojis` (`renderer.ts:3994–4002`, `:7813`). There is no signal for MANAGE_CHANNELS, CREATE_CHANNEL, KICK_USER or ADMIN. | **New item A8** (own permissions on the join ack + a change event). B6, B8 and C3 depend on it. |
| V19 | B7 | Does leaving voice after a channel delete hide the voice panel? | **Yes:** the `channel-deleted` handler calls `api.leaveVoiceChannel()`, sets `isInVoice = false` and `updateVoiceUI()`, which removes `#voice-panel.visible` (`renderer.ts:3362`). | Plan holds. B7 only changes the dialog text (and, after C9, the tab switch). |
| V20 | B8 | What does the occupant menu do today? | `renderOccupants()` (`renderer.ts:~3080–3145`): a 0–200 step-5 slider that **persists on every `input`**, a mute toggle that triggers a **full `renderTree()`**, a Kick button gated on **`isAdminUser` (MANAGE_ROLES)** while the server requires **KICK_USER** (`moderation.handler.ts:53`), a result in the Server Log (not a toast), and **no menu at all on yourself** (`if (targetId === myId) return`). | Plan holds, with the corrections listed in B8. |
| V21 | B10 | Voice row count pill | Already rendered as `.ch-count` when the count > 0 (`renderer.ts:2856`); the timer also exists (V9). | **Plan changed:** B10 shrinks to the tooltip/icon plus seeding from A3. |
| V22 | B11 | Does the app auto-connect on launch? | **No.** "Remember Me" only pre-fills the fields (`renderer.ts:1376`). `checkForWhatsNew()` runs at startup (`:12215`) while never connected, **but** it awaits a GitHub fetch, so a fast user can connect before the notes arrive and get the modal over a live session. | **Plan changed:** no "connect after Got it" sequencing is needed; B11 guards the late arrival. |
| V23 | B12 | What does `main.ts` do on `update-downloaded`? | `main.ts` only forwards `update-downloaded` to the renderer (`:946`). The **renderer** auto-restarts: `setTimeout(() => api.quitAndInstall(), 1200)` (`renderer.ts:~12189`). `autoDownload = false` (`main.ts:871`). The `quit-and-install` IPC already exists (`:1292`). | **Plan changed:** no new `update-restart-now` IPC; remove the renderer's timer and use the existing IPC. |
| V24 | F2 | Are Inter / Phosphor vendored? `build.files`? CSP? packaged test build? | **Inter is loaded from Google Fonts' CDN** (`index.html:10–11`; the CSP allows `fonts.googleapis.com`/`fonts.gstatic.com`). No Phosphor. `build.files` already has `assets/**/*` (`apps/client/package.json`). `font-src 'self'` is present. `npm run test-build:linux` exists (`scripts/test-build.mjs`). | Plan holds. **Addition:** remove the Google Fonts links and the two CSP hosts once Inter is vendored (no request leaves the app on launch). |
| V25 | C3 | Permission for "Create channel" | `CREATE_CHANNEL` (flag `1<<3`), **not** MANAGE_CHANNELS (`channel.handler.ts:93`). Rename/Move/Delete/NSFW/icon/reorder are all MANAGE_CHANNELS (`:138, :209, :327, :386, :470, :528`). | C3 uses CREATE_CHANNEL; B6 uses MANAGE_CHANNELS. |
| V26 | C8 | Is there a "+" button in the tab bar? | **No.** `#tab-bar` holds only the Server Log tab (`index.html:5405`); tabs are appended by code. | "Remove +" is dropped from C8. |
| V27 | C10 | Can the main socket consume screen video? | Technically `CONSUME` (`voice.handler.ts:337`) accepts any producer in the router, but the main socket **never learns existing screen producers** (`EXISTING_PRODUCERS` lists mic only; `mediasoup.service.ts:getExistingProducers`). Worse, **`WATCH_SCREEN_SHARE`/`STOP_WATCHING_SCREEN_SHARE` on a primary socket would replace its voice `recvTransport` (`CREATE_WEBRTC_TRANSPORT` overwrites the slot) and `cleanupUserSession(channelId, userId)` would tear down the user's whole voice session** on a v2.7.0 server. | **Plan holds:** viewer-socket path, opened by the **main preload** (user decision Q3). The main socket never calls WATCH/STOP_WATCHING. |
| V28 | C10 | Viewer window tracking | `open-screen-share-viewer` (`main.ts:1447`) creates "one more" window with **no tracking** of which share it shows and no IPC to focus/close it from the main window. Viewer tickets are kept per `webContents.id` (`:454`). | C10 adds a small registry in `main.ts`. |
| V29 | C11 | Can a client pick an SVC layer? | Layer choice is a **server-side** mediasoup call (`consumer.setPreferredLayers`); mediasoup-client has no such method, and no event exists for it. Phase 12 settled on **VP9 L1T3**: **one spatial layer, three temporal layers**, so "lowest spatial layer" previews don't exist. Only the frame rate can be lowered. | **Plan changed:** C11 starts with static LIVE cards; live previews at temporal layer 0 need a new server event and a measurement first (decision D2, confirmed: static cards first, measure, then decide). |
| V30 | R0 | How do electron-updater 6.8.9 and the bump procedure treat prereleases? | **electron-updater** (`AppUpdater.js`): `allowPrerelease` defaults to **true when the app's own version has a prerelease part** (`3.0.0-beta.1`), false for `2.7.0`. `GitHubProvider.js`: with `allowPrerelease`, it scans the releases Atom feed, derives the channel from the running version (`beta`), accepts stable or `beta` tags (never `alpha` or custom), and downloads **`beta.yml`** (`beta-linux.yml`, `beta-mac.yml`) for a beta tag, falling back to `latest*.yml` if that 404s. **Without** `allowPrerelease` (stable users) it asks `/releases/latest`, which GitHub never resolves to a release marked **pre-release**. Setting `autoUpdater.channel` also forces `allowDowngrade = true`. `isUpdateAvailable` is a plain semver `gt`. **Bump procedure** (`.claude/commands/bump-version.md`): "Expect a plain semver `X.Y.Z`", no prerelease handling, no publishing steps. **Renderer** `compareVersions()` (`renderer.ts:12287`) splits on `.`, so `"3.0.0-beta.1"` gives `NaN` parts and the version-mismatch modal picks the wrong direction. **What's new** (`checkForWhatsNew`, `:12228`) compares strings for equality and fetches `releases/tags/v<version>`. That works for prerelease tags. **Shields badge:** `-` in a static badge must be escaped as `--`. | **Plan changed:** R0 rewrites the procedure, fixes `compareVersions`, makes the channel explicit without setting `channel`, and adds a publishing checklist. Detail in R0. |

---

## How to Execute This PRD (read before starting any item)

Each item has: **Phase**, **Depends on**, **Study frames**, **Current Behavior (verified)**, **Goal**, **Design**, **Implementation Steps** (in order), **Pitfalls**, **Regression Risk**, **Verification**, **Done When**. Follow the steps in order. If reality contradicts a step (a function was renamed, a line moved, a Step 0 finds something else), **stop and re-plan that step from the code**. If the contradiction changes user-visible behaviour or scope, **ask the user** before continuing.

### The per-item routine (every item, no exceptions)

1. `git branch --show-current` must print `ui-overhaul-beta`, and `git status` must be clean (the previous item is committed). Read the item fully, then the "Read first" files **completely** around the named functions. Line numbers are approximate (`~`); find code by searching for the function name.
2. If the item has a **Step 0**, do it first and write down what it found before changing code.
3. Change order: **`packages/shared-types` → build it (`npx tsc --build` in `packages/shared-types`) → `apps/server` → `apps/client/src/preload.ts` (+ `main.ts` when IPC is needed) → `apps/client/src/renderer/renderer.ts` + `index.html`.**
4. Prisma changes: edit `schema.prisma` → generate the SQL with `npx prisma migrate diff` (never `migrate dev` against the dev DB) → `npm run db:generate` → verify the migration on a **throwaway database** (`apps/server/AGENTS.md`).
5. After the code: `npx tsc --noEmit` in every touched workspace; `npm run lint` at the root (exit 0); `npm run test` in `apps/server` if the server changed (**add or extend a test** under `apps/server/src/__tests__/` whenever server logic changed — keep the logic in a pure, exported function so it can be tested like `admin-users.ts`/`access.service.ts` are); every relevant client `npm run test:*`; the item's own Verification list.
6. **Headless UI check** for anything visible: build (`npx tsc --build && node scripts/copy-html.mjs` in `apps/client`), launch under Xvfb with `--user-data-dir=<tmp>` and `--remote-debugging-port`, drive it over CDP, `Page.captureScreenshot`, and **open the screenshot and compare it with the study frame named in the item**. (On this Windows machine there is no Xvfb: run Electron with its own `--user-data-dir` and keep the window off-screen, or run the check in WSL/Linux. Write down which.) Never `pkill -f` a pattern that's in your own command line; stop Electron by the PID on the debug port.
7. `/log-progress` with: what was built, the Step 0 findings, deviations from this PRD and why, test evidence, open questions.
8. `git add` only this item's files (check `git status` for scratch files), commit `feat:`/`fix:`/`chore:` + `(PRD 19 <id>)` with the attribution trailer, **do not push**, and **stop and wait for the user**.

### Project rules that apply to every item

- **Never trust the client:** ids come from `socket.data.userId` or server-issued tickets; file URLs are never accepted from clients (the stored-file ledger); permission checks live in the server handler. Hiding a button is cosmetic only.
- **Validate every payload field** (`typeof`, length bounds, enums) in handlers and every IPC argument in `main.ts`.
- **CommonJS gotcha:** anything imported by `main.ts`/`preload.ts`/`voice.service.ts` must have a real CommonJS build. Check `type`/`exports` with `npm view <pkg>` before adding a dependency. This phase adds **no runtime npm dependency**: fonts and icons are vendored files.
- **The renderer is a classic script** without imports. Constants it needs from shared-types (`MAX_SCREEN_SHARES_PER_ROOM`, permission flags) are mirrored locally with a comment naming the source.
- **DOM safety:** `textContent` for dynamic text; any `innerHTML` with dynamic parts uses `escapeHtml`; escape before `showToast`.
- **`localStorage`:** `reson8-*` keys only, `grep "reson8-"` before adding one, every read/write in `try/catch` with a safe default.
- **Message DOM rules:** anything that adds/removes `.chat-msg` calls `applyGrouping()`/`regroupFrom()`; message text only via `setMessageBody()`; scrolling only via `stickToBottom`/`setScroll`/`smoothScroll`.
- **Media URLs** from the server pass through `resolveMediaUrl()` in `preload.ts` at **every** inbound entry point (this phase adds three: the server icon in `GET_SERVER_SETTINGS`, `SERVER_SETTINGS_UPDATED` and `GET_SERVER_SUMMARY`).
- **`userId`-keyed teardown** in disconnect paths goes through `SocketOwnership`.
- **Targeted DOM updates** over `renderTree()` (a full re-render loses collapsed categories).
- **`requireServerAccess()`** guards every new entry point that opens a tab, joins voice, uploads, nudges or watches a stream.
- **Modals over Settings** need a higher `z-index`, with the CSS override placed after the base modal block. Check with `document.elementFromPoint()`.
- **No silent behaviour changes** outside the item's scope; note anything else you find in the progress entry instead of fixing it.
- **Design files** (`design/*.dc.html`) are references only: **never port their markup or state code.** Recreate the look in vanilla TS/DOM + `index.html` CSS. Colours, type, spacing, radii, states and copy are final (README › Fidelity); icons are Phosphor.

### Shared definition of done (in addition to each item's "Done When")

- [ ] Typechecks, `npm run lint`, server tests and relevant client smoke tests pass; outputs summarized in the progress entry.
- [ ] Every Verification bullet actually run, or explicitly marked "user to verify by hand" with the reason (needs Windows/macOS, two real machines, a real GitHub release…).
- [ ] The matching `TEST_STATES.md` boxes for this item are reached in the real app (headless screenshot compared with the frame).
- [ ] A v2.7.0 server still works with the new client (start the server from the `main` branch build, or check that every new call has a fallback path; say which).
- [ ] No unrelated files changed, no debug logging, no scratch files committed; progress entry written; local commit made; nothing pushed; waiting for the user.

---

# P0 — Release pipeline

## R0 — Beta Release Pipeline

**Type:** 🧹 CHORE (+ one 🐛 fix: `compareVersions`)
**Phase:** P0 — do it **first**, before A1. The fixes must ship in `3.0.0-beta.1` itself.
**Depends on:** nothing.
**Affected Components:**
- `.claude/commands/bump-version.md`
- new pure module `apps/client/src/app-version.ts`, plus `apps/client/scripts/app-version-smoke.mjs` and a `test:version` script
- `apps/client/src/main.ts` (updater setup)
- `apps/client/src/preload.ts` (exposes the comparer)
- `apps/client/src/renderer/renderer.ts` (`compareVersions`/`checkVersionMismatch`)
- root `AGENTS.md` (Electron gotchas + the bump note)
- `apps/client/AGENTS.md` (the new test script)

> [!NOTE]
> **Step 0 outcome (13/10/2026, R0 done):** electron-builder 25 does **not** apply the version-derived channel to the GitHub provider, so a plain beta build writes `latest*.yml`. The user chose to build prereleases on an explicit `beta` channel: `apps/client/scripts/update-channel.mjs` adds `-c.publish.channel=beta` on every packaging path. A real Windows build confirmed it writes `beta.yml` only, and bakes `channel: beta` into `app-update.yml` without enabling downgrades. Details are in progress.txt (R0 entry) and `.claude/commands/bump-version.md`.

### Current Behavior (verified — see V30)

- **Bump procedure:** it accepts only `X.Y.Z` and has no publishing steps. Publishing is done by hand: `npm run release:all` builds, and the user uploads to GitHub.
- **Publish config:** `apps/client/package.json` → `build.publish` = GitHub `fbarrella/reson8`, with no `releaseType`. That doesn't matter, because electron-builder never publishes in this workflow.
- **electron-updater 6.8.9 handles betas by itself**, provided the GitHub release is marked pre-release and carries the right yml files:
  - A running `3.0.0-beta.N` sets `allowPrerelease = true` automatically. It scans `releases.atom`, takes the newest stable-or-beta tag, and reads `beta*.yml`.
  - A running `2.7.0` asks `/releases/latest`, which **never** points at a pre-release.
  - So stable users are safe **only if every beta is marked "pre-release" on GitHub**.
  - The real risk is two mistakes together: a beta release that carries `latest.yml`/`latest-linux.yml`/`latest-mac.yml` **and** isn't marked pre-release. Every stable user would then be offered the beta.
- **`compareVersions()` bug:** `renderer.ts:compareVersions()` isn't semver-aware and returns NaN on `-beta.N`.
- **What's new needs no change:** `checkForWhatsNew()` compares versions by string equality and fetches `GET /repos/fbarrella/reson8/releases/tags/v<version>`. That already works for `v3.0.0-beta.N` tags, including pre-releases.
- **Server version:** the server reports `version` from `apps/server/package.json` (`config/version.config.ts`). That file is bumped too, so beta servers report `3.0.0-beta.N`.

### Goal

1. `/bump-version 3.0.0-beta.N` works, and refuses anything else on this branch.
2. Beta builds update only to newer betas, or later to the final stable line. Stable builds on `main` are never offered a beta.
3. Version comparisons in the client understand `-beta.N`.
4. A written, checkable publishing checklist exists for prereleases, so a release is never improvised.

### Design

**A. Pure version helper — `apps/client/src/app-version.ts`** (no Electron or DOM imports; compiled to CommonJS like the other pure modules):
```ts
export interface ParsedVersion { major: number; minor: number; patch: number; pre: (string | number)[] }
/** Strict: /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/ (leading "v" stripped); anything else → null. */
export function parseVersion(v: string): ParsedVersion | null;
/** Semver §11 precedence: <0, 0, >0 — or null if either side is unparseable. */
export function compareVersions(a: string, b: string): number | null;
export function isPrerelease(v: string): boolean;           // parsed && pre.length > 0
export function prereleaseChannel(v: string): string | null; // "beta" for 3.0.0-beta.2
```
Implement these semver rules exactly:
- Compare major, minor and patch numerically.
- A version **without** a prerelease part is **greater** than the same version with one: `3.0.0 > 3.0.0-beta.9`.
- Compare prerelease identifiers left to right:
  - two numeric identifiers compare as numbers (`beta.10 > beta.9`);
  - a numeric identifier is lower than an alphanumeric one;
  - when every earlier identifier is equal, the longer list wins.

**B. Main process.** In `main.ts`, next to `autoUpdater.autoDownload = false`:
```ts
// PRD 19 R0: a -beta.N build follows the beta line; a stable build never sees prereleases.
// electron-updater already defaults to this; stated so a future edit can't silently change it.
// NEVER set autoUpdater.channel: its setter also turns on allowDowngrade.
autoUpdater.allowPrerelease = isPrerelease(app.getVersion());
```
Nothing else in the updater changes. The Windows `verifyUpdateCodeSignature` override stays untouched.

**C. Renderer.** Delete the local `compareVersions`. `checkVersionMismatch()` calls `api.version.compare(server, client)`, which the preload exposes (it imports `app-version.ts`). When it returns `null` (an unparseable version from an odd server), show the neutral text "This server runs v{s}; your client is v{c}." and hide the Releases button.

**D. Bump procedure (`.claude/commands/bump-version.md`).** Rewrite these parts and keep the rest:
1. **Accepted versions:** `X.Y.Z` **or** `X.Y.Z-beta.N` (N ≥ 1).
   - On branch `ui-overhaul-beta`, **only** `3.0.0-beta.N` is accepted. N must be exactly the previous beta's N + 1, or 1 when the current version is `2.7.0`. Anything else: stop and ask.
   - A plain `X.Y.Z` on this branch is refused with "Stable versions are cut on `main` by the owner."
2. **Files to bump** (the list is unchanged):
   - the root, `apps/client` and `apps/server` `package.json` files;
   - the README badge;
   - the "Current version" sentence in root `AGENTS.md`, written as "Current version: 3.0.0-beta.N (beta, branch `ui-overhaul-beta`; stable is 2.7.0 on `main`)".
3. **README badge:** shields.io static badges use `-` as a separator, so double it inside the version: `version-3.0.0--beta.1-<color>`. Check it by fetching the badge URL (`curl -sI` → 200) and reading the SVG text.
4. **Catch-all sweep:** unchanged. Never touch `packages/shared-types/package.json`.
5. **Release notes:** `app-planning/releases/v3.0.0-beta.N.md`.
   - Title: `# 🎧 Reson8 v3.0.0-beta.N Release Notes (Beta)`.
   - Under the intro, a `> [!WARNING]` box: "This is a beta. Install it only if you want to test the new interface. Beta builds update to newer betas automatically; stable builds never see them. To go back to stable, install 2.7.x from the Releases page." (Going back to an AppImage or NSIS stable build means reinstalling by hand.)
   - Content: the progress.txt entries **since the previous beta's notes** (for beta.1: since the v2.7.0 release). Every bullet must trace back to an entry.
   - From beta.2 on, end the intro with one line linking the earlier beta notes, e.g. "Earlier in this beta: [beta.1](v3.0.0-beta.1.md)." (decision D8). The final 3.0.0 notes, written later on `main`, collect everything.
   - Installation table: the beta file names electron-builder actually produced. Read them from `apps/client/release/`; don't guess the pattern.
6. **New section: "Publishing a prerelease (done by the owner; Claude only prepares and checks)."**
   1. Build: `npm run release:all` (or the per-platform `build:*`).
   2. In `apps/client/release/`, confirm that `beta.yml`, `beta-linux.yml` and `beta-mac.yml` exist (for each platform built). If any `latest*.yml` was generated, **do not upload it**.
   3. Create the GitHub release:
      - tag **`v3.0.0-beta.N`**, target branch **`ui-overhaul-beta`**;
      - **"Set as a pre-release" checked**, **"Set as the latest release" unchecked**;
      - body = the release-notes file.
   4. Upload the installers, their `.blockmap` files and the `beta*.yml` files.
   5. Check that stable users are still safe:
      - `gh release view --json isPrerelease -R fbarrella/reson8 v3.0.0-beta.N` → `true`;
      - `curl -sI https://github.com/fbarrella/reson8/releases/latest` still redirects to the newest **stable** tag.
   6. Check that beta users get it: an installed `3.0.0-beta.(N-1)` build → Settings › About › Check for updates offers `3.0.0-beta.N`.
7. **Step 7 ("Report a summary")** also lists the publishing checklist for the owner, and says that nothing has been pushed or published.

### Implementation Steps

0. **Step 0 — confirm the two facts R0 relies on, from installed code rather than memory.**
   - After `npm install` (this machine has no `node_modules` yet), read `node_modules/electron-updater/out/AppUpdater.js` (search `hasPrereleaseComponents`) and `out/providers/GitHubProvider.js` (`getLatestVersion`). Confirm V30.
   - Read `node_modules/app-builder-lib/out/publish/updateInfoBuilder.js` (search `generateUpdatesFilesForAllChannels` and `getChannelFilename`). Confirm that a `3.0.0-beta.N` build writes `beta*.yml` and **not** `latest*.yml` when `generateUpdatesFilesForAllChannels` is false (the default).
   - Record both in the progress entry. If either differs, **stop and tell the user**: the publishing checklist depends on them.
1. Create `app-version.ts` with the functions above, with JSDoc citing semver §11.
2. Create `scripts/app-version-smoke.mjs` (pattern: `avatar-smoke.mjs`). It must assert at least:
   - `2.7.0 < 3.0.0-beta.1 < 3.0.0-beta.2`
   - `3.0.0-beta.9 < 3.0.0-beta.10 < 3.0.0`
   - `v3.0.0 == 3.0.0`
   - `compareVersions("3.0", "3.0.0") === null` and `compareVersions("x", "2.7.0") === null`
   - `isPrerelease("3.0.0-beta.1")` is true and `isPrerelease("2.7.0")` is false
   - `prereleaseChannel("3.0.0-beta.3") === "beta"`

   Then add `"test:version": "tsc --build && node scripts/app-version-smoke.mjs"` to `apps/client/package.json`.
3. `main.ts`: import `isPrerelease` and add the `allowPrerelease` line (Design B).
4. `preload.ts`: expose `version: { compare(a, b) }` on `reson8Api`, and add it to the renderer's `Reson8Api` type declaration.
5. `renderer.ts`: remove the local `compareVersions` and update `checkVersionMismatch()` (Design C).
6. Rewrite `bump-version.md` (Design D). Keep the frontmatter and the numbered-step style.
7. Docs:
   - Root `AGENTS.md`, Electron gotchas: "Beta builds: a `-beta.N` version auto-enables `allowPrerelease`; stable users are protected only by GitHub's pre-release flag. Never upload `latest*.yml` to a beta release; never set `autoUpdater.channel` (it enables downgrades)."
   - `apps/client/AGENTS.md`: add `test:version` to the command list.
8. `/log-progress`, commit, stop. **Do not bump the version in this item.** The first bump happens at the end of P2.

### Pitfalls

- Don't "fix" the What's new logic. Equality is correct there: each new version, beta or not, shows its notes once.
- Don't set `autoUpdater.channel = "beta"`, even though it looks like the obvious fix. Its setter also turns on `allowDowngrade`, so a beta user would be offered an *older* stable.
- Don't add `releaseType: "prerelease"` to `build.publish`. Publishing is a manual upload, so it would be dead config that suggests otherwise.
- The `--` escaping applies only to the shields URL. Everywhere else the version is written normally.

### Regression Risk

Low:
- `compareVersions` only feeds the version-mismatch modal's text.
- `allowPrerelease` keeps the value electron-updater computes anyway.
- Stable builds are made from `main`, so this branch doesn't touch them.

### Verification

- `npm run test:version` passes; `npx tsc --noEmit` in `apps/client`; `npm run lint`.
- **Version-mismatch modal (headless):** in a scratch build, never committed, set the client's version to `3.0.0-beta.1` and connect it to a v2.7.0 server. The mismatch modal must say the *server* needs updating.
- **Bump procedure (dry read):** walk `bump-version.md` with `3.0.0-beta.1` (accepted), `3.0.0` (refused) and `3.0.0-beta.3` when beta.2 doesn't exist yet (refused).
- **Publishing:** the user verifies it by hand at the first beta (it needs a real GitHub release).

### Done When

- [ ] Step 0 facts recorded.
- [ ] `app-version.ts`, its smoke test and `test:version` exist; the renderer uses them; the mismatch modal is correct for beta/stable pairs.
- [ ] `allowPrerelease` is explicit in `main.ts`; `channel` is never set.
- [ ] `bump-version.md` supports `3.0.0-beta.N`, with the branch guard, badge escaping, the beta notes format and the publishing checklist.
- [ ] Docs updated.

---

# P1 — Protocol and server groundwork (🖧)

## A1 — Member-Visible Server Summary 🖧

**Phase:** P1 · **Depends on:** — · **Study frames:** 16a (About), 1e (header count) · **Confirmed decisions:** Q2 (counts), Q8 (open to restricted users)

### Current Behavior (verified — V1–V5)

`GET_SERVER_SETTINGS` (`nudge.handler.ts:76`) gives everyone `name`, `nudgeEnabled`, `screenShareEnabled`, `maxMessageLength` and `version`. It gives `requireSignedIdentity`, `requireApproval` and `requireInvite` only to ADMINs. `GET_ALL_USERS` needs MANAGE_ROLES or BAN_USER. Nothing gives an ordinary member the admins, the member total or the feature list. `SERVER_SETTINGS_UPDATED` doesn't carry the join gates.

### Goal

One event that every signed-in user can call, restricted users included, returning the data for About and the header. Plus additive fields on `SERVER_SETTINGS_UPDATED`, so About's feature list updates live.

### Design

**shared-types `models.ts`:**
```ts
/** Member-visible facts about the server (PRD 19 A1). Counts are per userId (= per install), not per person. */
export interface IServerSummary {
    name: string;
    /** user_servers members whose permissions include CONNECT or ADMIN, minus banned users. */
    memberCount: number;
    /** Distinct userIds present on the server right now, limited to the members counted above. */
    onlineCount: number;
    /** Members whose aggregated permissions include ADMIN, sorted by nickname (case-insensitive). */
    admins: { userId: string; nickname: string; isOnline: boolean; avatarUrl: string | null }[];
    features: { nudge: boolean; screenShare: boolean; requireApproval: boolean; requireInvite: boolean; requireSignedIdentity: boolean };
    /** Filled in by A2; server-relative for local disk — resolve with resolveMediaUrl(). */
    iconUrl?: string | null;
}
```

**shared-types `socket-events.ts`:**
- `GET_SERVER_SUMMARY: (ack: (res: { success: boolean; summary?: IServerSummary; error?: string }) => void) => void;`, with a doc comment.
- `SERVER_SETTINGS_UPDATED`'s payload gains **optional** `requireApproval?`, `requireInvite?` and `requireSignedIdentity?`. A2 adds `iconUrl?`.

**Server — pure builder.** New file `services/server-summary.ts` with `buildServerSummary(input)`.
- Input:
  - member rows `{ id, nickname, avatarUrl, perms: bigint }`;
  - `bannedIds: Set`, `onlineIds: Set`;
  - `features`, `name`, `iconUrl`.
- Rules:
  - members = rows where `hasServerAccess(perms)` is true and the id isn't banned;
  - admins = members with the ADMIN bit;
  - online = online ids ∩ member ids.

**Server — handler.** `GET_SERVER_SUMMARY`, next to `GET_SERVER_SETTINGS` in `nudge.handler.ts`:
- **Members:** `prisma.user.findMany({ where: { servers: { some: { serverId } } }, select: { id, nickname, avatarUrl, roles: { select: { role: { select: { serverId, permissions } } } } } })`.
  - Aggregate role permissions **for this server only**, with bitwise OR, mirroring `permissions.service.ts`.
  - If that file exports an aggregation helper, reuse it. Otherwise add an exported pure `aggregatePermissions(roles, serverId)` there and test it.
- **Banned ids:** `bannedUser.findMany({ where: { serverId } })`.
- **Online:** `presence.getOnlineUsers(serverId)`.
- **Features:** from the server row, plus the config getters `requireApproval()`, `requireInvite()` and `requireSignedIdentity()`. These are the values in effect, environment overrides included.

**Server — wiring and privacy:**
- `EVENT_ACCESS.GET_SERVER_SUMMARY = "open"`. Restricted users may open About, just as they see the tree and presence (Q8).
- `UPDATE_SERVER_SETTINGS`'s broadcast (`nudge.handler.ts:~258`) adds the three join-gate booleans, read from the same config getters **after** the update.
- **Never** include `unprotectedActiveUsers`, `authAllowedHosts`, `observedAuthHosts`, addresses, fingerprints or `publicKey`.

**Preload:**
- `getServerSummary(): Promise<IServerSummary | null>`, using `socket.timeout(5000)`. Error or timeout resolves `null` (an old server).
- Run `iconUrl` through `resolveMediaUrl()` (A2 fills it in).
- The `server-settings-updated` forwarder passes the new optional fields through unchanged.

**Renderer.** C3 and C4 build the UI. This item only adds the data plumbing:
- `refreshServerSummary()`, with a **2 s trailing debounce**. It runs on `connected`, `user-joined`, `user-left`, `server-settings-updated` and A8's permissions change, and stores `serverSummary: IServerSummary | null`.
- **One** function, `getOnlineCountForDisplay()`. It returns `serverSummary.onlineCount`; on an old server, the number of `isOnline` users in the last `GET_ONLINE_USERS` result. The header and About must both call it.

### Implementation Steps

1. shared-types: the model, the event and the broadcast fields; build shared-types.
2. Server: `services/server-summary.ts` (the pure builder) and `__tests__/server-summary.test.ts`. Test cases:
   - a banned member is excluded;
   - a restricted member (no CONNECT/ADMIN) is excluded from the total **and** from online;
   - an admin who is online, and one who is offline;
   - online ∩ members: an unknown online id is ignored;
   - admins are sorted case-insensitively.
3. Server: the handler (on any error, `try/catch` acks `{ success: false, error: "Failed to load the server summary" }`), the `EVENT_ACCESS` entry (the compiler forces it), and the extra broadcast fields.
4. If `access.service.test.ts` asserts the full table, extend it.
5. Preload: the method, plus its entry in the renderer's `Reson8Api` type. Renderer: `refreshServerSummary()` and `getOnlineCountForDisplay()`. No UI yet, and no leftover debug logging.
6. Typecheck the three workspaces, lint, and run `npm run test` in `apps/server`.

### Pitfalls

- `presence.getOnlineUsers()` returns a Redis set of ids, so they're already distinct. Never count sockets.
- Roles belong to a server (`Role.serverId`). Aggregate only this server's roles, or an admin role somewhere else would count.
- The broadcast's new fields are optional in the type, even though this server always sends them. The client must treat `undefined` as "unchanged", because an old server won't send them.

### Regression Risk

Low: one new read-only event and three extra fields on an existing broadcast.

### Verification

- The server test passes.
- Against a real server:
  - a **member** (not admin) socket gets `success: true` with the right counts;
  - a restricted socket gets it too;
  - a socket that hasn't signed in is refused by the packet gate ("Not signed in").
- The counts equal `GET_ONLINE_USERS`'s online entries **minus restricted users**. Note the difference if there is one.
- A v2.7.0 client is unaffected: it never calls the event and ignores the extra broadcast fields.

### Done When

- [ ] Event, model and broadcast fields exist.
- [ ] Pure builder, with its test.
- [ ] `EVENT_ACCESS` entry.
- [ ] Preload method with the old-server fallback.
- [ ] One shared online-count function.

---

## A2 — Server Icon 🖧

**Phase:** P1 · **Depends on:** A1 (the summary carries `iconUrl`) · **Study frames:** 12a–12d · **Confirmed decisions:** Q6 (sniff the bytes, no new dependency); Q7 (clients cache a thumbnail, done in C1/C5)

### Current Behavior (verified — V6–V8)

- **Channel icons today:** `POST /api/upload/channel-icon` (512 KB, ledger kind `CHANNEL_ICON`), then `UPDATE_CHANNEL { iconUploadId }` claims the upload.
- **Storage:** files under `/uploads/` are public, unauthenticated and uuid-named.
- **Validation:** the server checks only the MIME type the client declares. The stored extension comes from the client's file name.

### Goal

- ADMINs can set, replace and remove a server icon.
- Everyone receives its URL in the settings, the summary and the live broadcast.
- The server checks the file by its real bytes, not by what the client declares.

### Design

**Prisma:**
- Add `Server.iconUrl String?` and `Server.iconPublicId String?`, mirroring `Channel`.
- Add `SERVER_ICON` to `enum StoredFileKind`.
- One migration. Postgres pitfall: a value added with `ALTER TYPE … ADD VALUE` can't be used in the same transaction that adds it, so nothing in the migration may use the new value. Generate the SQL with `migrate diff` and read it before applying.

**Pure sniffer — `apps/server/src/services/image-sniff.ts`:**
```ts
export type SniffedImage = { type: "png" | "jpeg" | "gif" | "webp"; width: number; height: number };
export function sniffImage(buf: Buffer): SniffedImage | null;
```
How to read each format:

| Format | How to recognise it | Where width and height are |
| --- | --- | --- |
| PNG | Signature `89 50 4E 47 0D 0A 1A 0A`, then IHDR | Big-endian u32 at offsets 16 and 20 |
| GIF | `GIF87a` or `GIF89a` | Little-endian u16 at 6 and 8 |
| WebP `VP8 ` | `RIFF????WEBP`, chunk tag `VP8 ` at 12 | 14-bit values at 26 and 28 |
| WebP `VP8L` | `RIFF????WEBP`, chunk `VP8L`, signature `0x2f` at 20 | 14-bit fields packed from byte 21 |
| WebP `VP8X` | `RIFF????WEBP`, chunk `VP8X` | 24-bit (value + 1) at 24 and 27 |
| JPEG | Starts `FF D8`, then walk the markers | Big-endian u16 height at SOF segment offset +5, width at +7 |

JPEG marker walk: skip `FF D0–D9`, `FF 01` and fill bytes until an SOF marker (`C0–C3`, `C5–C7`, `C9–CB`, `CD–CF`). Bounds-check every read, stop at the buffer end, and give up after 64 segments.

Rules for every format:
- Anything truncated or unrecognised → `null`.
- **No SVG**, ever.

**Route `POST /api/upload/server-icon`** (`upload.route.ts`). Reuse `handleUpload` through a new optional `validate(buffer, declaredMime)` hook, so the other routes stay byte-for-byte the same.
- **Limits:** at most 1 MB. MIME must be png, jpeg, gif or webp.
- **The hook:** `sniffImage` must succeed, the sniffed type must match the declared MIME, and width and height must each be between 256 and 4096. Otherwise answer 400 with "The icon must be a PNG, JPEG, GIF or WebP image of at least 256×256 pixels."
- **Stored name:** `server-icon.<sniffed ext>`, **never** the client's file name. Local files therefore end up as `/uploads/<uuid>-server-icon.png`.
- **Who may upload** (defence in depth; the claim checks again):
  - A token is **required** on this route; a tokenless request gets 401.
  - The token's owner must be ADMIN on `app.serverId` (`getUserPermissions` + `isAdmin`); otherwise 403.
- **Caching:** in `index.ts`'s `fastifyStatic` registration, add `setHeaders(res, filePath)`. When the base name matches `/^[0-9a-f-]{36}-server-icon\.(png|jpg|jpeg|gif|webp)$/`, set `Cache-Control: public, max-age=31536000, immutable`. Every other file keeps today's headers.

**Settings — `UPDATE_SERVER_SETTINGS` gains `iconUploadId?: string | null`.** (Named after the existing `UPDATE_CHANNEL.iconUploadId`; the handoff called it `iconAttachmentId`.) The handler already requires ADMIN (`nudge.handler.ts:~141`).
- **A string sets or replaces the icon.** In **one** `prisma.$transaction`:
  1. `claimUploads(tx, [id], "SERVER_ICON", socket.data.userId)`. Read its real signature in `stored-file.service.ts`, and mirror the channel-icon claim in `channel.handler.ts`'s `UPDATE_CHANNEL`.
  2. `server.update({ iconUrl: file.url, iconPublicId: file.publicId })`.
- **`null` removes it:** clear both columns.
- **After the commit,** release the previous file with `releaseStoredFile()`, as the channel-icon replacement path does. Only release it if one was set and it differs from the new one.

**Reads and broadcasts:** `GET_SERVER_SETTINGS` (for everyone), `SERVER_SETTINGS_UPDATED` and `IServerSummary.iconUrl` all carry `iconUrl`. It's optional on the wire; `null` means no icon.

**Preload:**
- Run `resolveMediaUrl()` on `iconUrl` at all three entry points.
- Add `uploadServerIcon(blob)`, built on the existing `uploadTo()` (it already handles the token and the retry after a 401).
- `updateServerSettings` accepts `iconUploadId`.
- When the admin cancels after uploading, call `discardUpload`.

### Implementation Steps

1. Schema, migration (checked on a throwaway DB) and `db:generate`.
2. `image-sniff.ts` and `__tests__/image-sniff.test.ts`. Test cases:
   - hand-built minimal headers for every format, at 512×512 and at 100×100;
   - a truncated header;
   - a PNG declared as JPEG (the mismatch is refused);
   - random bytes → null;
   - an SVG text → null;
   - a JPEG with an APP1 segment before SOF0.
3. The route, the `validate` hook and the static `setHeaders`.
4. shared-types fields; the handler's claim, clear and release; the broadcast and the summary.
5. Server test for the claim: if the stored-file tests already exercise `claimUploads` with a fake transaction, reuse that approach. If not, verify it on a throwaway DB and write down how.
6. Preload methods and `resolveMediaUrl` at the three entry points.

### Pitfalls

- Don't widen the existing routes' behaviour. Sniffing *every* upload is done separately in A10 (decision D9).
- With Cloudinary, the stored URL is absolute and the `public_id` comes only from the ledger. Never accept a URL from the client.
- Call `releaseStoredFile` only after the new row is committed. A failed update must not lose the old icon.

### Regression Risk

Low to medium: an additive migration and a new route. Existing uploads are untouched, because the hook is opt-in.

### Verification

- Server tests pass, and the migration was checked on a throwaway DB.
- Logged-out `curl`: `GET /uploads/<uuid>-server-icon.png` returns 200 with the `Cache-Control … immutable` header and no cookie.
- Refusals (curl with a token):
  - a member's token → 403;
  - a PNG renamed `.jpg` and sent as `image/jpeg` → 400;
  - 200×200 → 400;
  - 1.5 MB → 413.
- `UPDATE_SERVER_SETTINGS { iconUploadId }` reaches everyone as `SERVER_SETTINGS_UPDATED` with an `iconUrl`.
- Replacing the icon deletes the old file: the ledger row and the file on disk are both gone.
- Sending `null` removes the icon.

### Done When

- [ ] Migration.
- [ ] Sniffer, with its test.
- [ ] Admin-only route with validation, and immutable caching for icons.
- [ ] Claim, replace and remove, with the old file released.
- [ ] `iconUrl` in the settings, the broadcast and the summary.
- [ ] Preload methods.

---

## A3 — Complete the Existing Per-Channel Voice Session Timer 🖧

**Phase:** P1 · **Depends on:** — · **Study frames:** 6a, 7a (timer next to a voice room) · **Rewritten** after V9/V10: the timer already exists.

### Current Behavior (verified — V9, V10)

The timer already exists end to end:
- **Server:** `voiceSessionStartedAt` is kept in memory and sent as `sessionStartedAt` on `PRESENCE_UPDATE`.
- **Client:** shows it, corrected for clock skew, with one global 1-second interval.

Three gaps remain:
- **(a)** The join-time tree doesn't carry it.
- **(b)** The kick and access-change broadcasts drop it, so other clients **lose** the timer for a room that's still occupied. Those two paths also don't clear the map when they empty a room.
- **(c)** A server restart resets it.

### Goal

- Every client shows the correct timer for every occupied voice room, from the moment it connects, through kicks and access changes.
- Keep the existing field name `sessionStartedAt`. The handoff's `occupiedSince` would duplicate a field that already exists.

### Design

**shared-types:** add `IChannelTreeNode.sessionStartedAt?: string` (ISO). Its doc comment says: voice channels only, set while the room is occupied, the same value that `PRESENCE_UPDATE` carries.

**Server — new helper.** Exported from `services/voice-session.service.ts`:
```ts
/** The PRESENCE_UPDATE payload for a channel; clears the session start when the room is empty (PRD 19 A3). */
export async function presencePayload(app, presence, channelId): Promise<{ channelId: string; occupants: IUserPresence[]; sessionStartedAt?: string }>
```
- Move `voiceSessionStartedAt` into this service module and re-export it from `connection.handler.ts`. Existing imports keep working, and you avoid a circular import.
- Check that `voice.handler.ts`'s import (`from "./connection.handler.js"`) still resolves.

**Server — where the helper is used:**
- Only in the **two broken paths**: `broadcastChannelOccupants()` (the access change) and `KICK_USER`'s broadcast.
- The other six emitters already send the right value. Leave them alone (non-regression rule).

**Server — the tree carries the start time:**
- `hydrateOccupants()` (the join-time tree), right after its existing bootstrap line: `node.sessionStartedAt = voiceSessionStartedAt.get(node.id)?.toISOString()` for each occupied VOICE node.
- `channel.handler.ts`'s `broadcastTreeUpdate()` sets it the same way. The tree broadcast is shared by everyone, and that's correct here: this value is global, not per user.

**Server restart (gap c):** the start time stays in memory and is re-seeded at the next join after a restart. Say so in the doc comment (decision D5, confirmed: stay in memory).

**Client (`renderer.ts`):**
- Where the `channel-tree` event stores `currentTree` (or in `renderTree()`'s walk):
  - for every VOICE node with `occupants.length > 0` and a `node.sessionStartedAt`, seed `sessionTimers`;
  - delete the entries for nodes that have no occupants.
- The existing tick and the `presence` handler stay as they are.

### Implementation Steps

1. Add the shared-types field and build.
2. Server: the helper, moving the map (with the re-export), the two call sites, and tree hydration in both builders.
3. Test `__tests__/voice-session.test.ts`: `presencePayload` with a fake `presence` (`getChannelOccupants` returns `[]`, then `["a"]`) and a stub prisma for `buildOccupant`'s fallback. Assert:
   - an empty room deletes the map entry and leaves `sessionStartedAt` out;
   - an occupied room keeps it.
4. Client seeding.

### Pitfalls

- Clear the map **only** when the ownership-checked occupant set is empty. The helper reads Redis presence, which the grace timer keeps during a blip. Never clear it in a raw `disconnect` path.
- Moving the map must not create a second map. Every import must reach the same object; check with `grep voiceSessionStartedAt`.

### Regression Risk

Low:
- Two broadcasts gain a field they should always have had.
- The tree gains one optional field.

### Verification

- The test passes.
- Two clients in a room, plus a third that connects later:
  - The late client sees the running timer at once.
  - An admin kicks one of two occupants: the timer stays on every tree.
  - The last occupant leaves: the timer disappears. Rejoining starts from 00:00.
  - A network blip under 10 s (cut the client's network briefly) doesn't reset it.
- A v2.7.0 client still works (it ignores the tree field).

### Done When

- [ ] Field added.
- [ ] Helper written.
- [ ] Both broken paths fixed.
- [ ] Tree carries the start time (join and broadcast).
- [ ] Client seeds its timers from the tree.
- [ ] Test passes.

---

## A4 — Cap of 5 Concurrent Screen Shares per Room 🖧

**Phase:** P1 · **Depends on:** — · **Study frames:** 15d (5 sharers), the "Share screen · 5/5" toast

### Current Behavior (verified — V11)

`PRODUCE` creates screen-video producers without any check. The share toggle is only enforced at `WATCH_SCREEN_SHARE`.

### Design

**shared-types (`models.ts`):**
- Add `export const MAX_SCREEN_SHARES_PER_ROOM = 5;`.
- The acks of `PRODUCE` and `SET_SCREEN_SHARE_STATE` gain an optional `errorCode?: "SCREEN_SHARE_LIMIT"`.

**Server: a per-channel lock.** New pure helper in `services/channel-lock.ts`:
- `withChannelLock<T>(channelId, fn: () => Promise<T>): Promise<T>`.
- It's a promise chain per key: each call waits for the previous call on the same key.
- A failed call doesn't break the chain.
- The map entry is removed once the chain has drained.

**Server: counting live shares.** Add `MediasoupService.countScreenVideoProducers(channelId): number`. It counts the channel's sessions whose `screenVideoProducer` is set and **not closed** (`!p.closed`).

**Server: enforcing the cap in `PRODUCE`.** Only when `appData?.mediaType === "screen-video"`:
- Run the count, `sendTransport.produce` and the slot assignment together inside `withChannelLock(channelId, …)`.
- If this session already has an open screen producer, don't count it against itself.
- If the count is ≥ `MAX_SCREEN_SHARES_PER_ROOM`, stop and ack:
  `{ success: false, error: "All 5 stream slots are in use. You can share when someone stops.", errorCode: "SCREEN_SHARE_LIMIT" }`.
- Mic and screen-audio producers never take the lock.

**Server: mirroring it in `SET_SCREEN_SHARE_STATE`.** When `isSharingScreen` is `true`, this user has **no** live screen producer, **and** the room is at the cap:
- coerce the flag to `false`, the same way the disabled-toggle check does;
- ack `{ success: false, errorCode: "SCREEN_SHARE_LIMIT", error: … }`.
- Today's clients ignore this ack, so old clients are unaffected.

**Client: when the server refuses.** The share starts in `startScreenShareViaSystemPicker()` (`renderer.ts`) and `voice.service.ts` (find it with `grep -n "screen-video" apps/client/src/services/voice.service.ts`). When the produce ack has `errorCode === "SCREEN_SHARE_LIMIT"`:
- Stop every captured track at once:
  - the video track;
  - the native audio capture (the stop IPC sits next to `screenAudioCapture` in `main.ts`).
- Close the local producer if one was created.
- Do **not** call `setScreenShareState(true)`.
- Show the toast "All 5 stream slots are in use. You can share when someone stops." It's static text, so it needs no escaping.

**Client: the button.** Mirror `MAX_SCREEN_SHARES_PER_ROOM` as a renderer constant, with a comment pointing at `models.ts`. In `updateShareScreenButton()`:
- When you aren't sharing and the current room has ≥ 5 occupants with `isSharingScreen`, label the button "Share screen · 5/5".
- Clicking it then shows the same toast **without** opening the picker.
- The server remains the authority.

### Implementation Steps

1. shared-types: the constant and the ack fields; build.
2. `channel-lock.ts` and `__tests__/channel-lock.test.ts`. The test checks that:
   - two calls on the same key run in order (the second starts after the first resolves);
   - calls on different keys run concurrently;
   - a rejected call doesn't block the next one;
   - the map is empty afterwards.
3. `countScreenVideoProducers`, then the `PRODUCE` and `SET_SCREEN_SHARE_STATE` changes.
4. Client: the refusal handling and the button state.

### Pitfalls

- **Race:** the count and `produce()` must run inside the same lock, or two simultaneous 5th shares both get through.
- A producer closed through `transportclose` sets its slot to `null` (`voice.handler.ts:274`). Still check `.closed` in the counter.
- Viewer sockets never produce, but their sessions live in the same channel map, keyed by socket id. The counter must count only `screenVideoProducer`, which they never have.

### Regression Risk

Low: only screen-video `PRODUCE` gains a lock and a check.

### Verification

- The lock test passes.
- Set up six sharers. Either:
  - a headless harness that creates send transports and produces a dummy VP9 track, or
  - six app instances by hand, each with its own `--user-data-dir`.
- Then check:
  - The 6th share is refused with the toast. Its capture stops: no OS "sharing" indicator, and the native audio capture is closed.
  - When someone stops sharing, the slot is free immediately.
  - Killing a sharer's process frees the slot once its transport closes.

### Done When

- [ ] Constant added to shared-types and mirrored in the renderer.
- [ ] Per-channel lock written and tested.
- [ ] Cap enforced at `PRODUCE` and mirrored at `SET_SCREEN_SHARE_STATE`.
- [ ] Refused share: the client stops capture and shows the toast.
- [ ] Button shows "5/5" when the room is full.

---

## A5 — Unread Counts for Channels 🖧

**Phase:** P1 · **Depends on:** — · **Study frames:** 6a ("Santos 3"), tab badges

### Current Behavior (verified — V12)

- `IChannelTreeNode.hasUnread` is a boolean set by `annotateUnreadChannels()`.
- It compares the newest message by someone else with `channel_reads.lastReadAt`. A channel the user never read counts as unread.
- DMs already have counts.

### Design

**shared-types.** Add `IChannelTreeNode.unreadCount?: number`. Its doc comment says:
- It counts messages by others after the read cursor.
- It is **capped at 100**; the client shows "99+" for ≥ 100.
- Like `hasUnread`, it's only set on the join-time tree.

**Server: the count.** New `services/unread.service.ts` with `countUnreadByChannel(prisma, userId, channelIds): Promise<Map<string, number>>`. It runs **one** raw query:

```sql
SELECT c.id AS "channelId", LEAST(cnt.n, 100)::int AS n
FROM unnest($1::text[]) AS c(id)
LEFT JOIN channel_reads r ON r."channelId" = c.id AND r."userId" = $2
CROSS JOIN LATERAL (
  SELECT COUNT(*) AS n FROM (
    SELECT 1 FROM messages m
    WHERE m."channelId" = c.id AND m."userId" <> $2
      AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")
    LIMIT 100
  ) t
) cnt
```

- Run it through `prisma.$queryRaw` with tagged-template parameters. **Never** build the SQL by string concatenation.
- Check the real table and column names against the `@@map`s in `schema.prisma` (`messages`, `channel_reads`), and that the columns are quoted camelCase.
- The `messages(channelId, createdAt)` index this relies on already exists.

**Server: filling the tree.**
- `annotateUnreadChannels()` keeps its `hasUnread` logic unchanged.
- It also sets `node.unreadCount` from the map, only when the count is > 0.
- Keep a small pure function, `applyUnreadCounts(tree, map)`, so this step can be tested.

**Client:** nothing in this item; B1 uses the field.

### Implementation Steps

1. Add the shared-types field and build.
2. Write `unread.service.ts` and `applyUnreadCounts`. Test the pure part: a nested tree, the cap passed through, zero counts left out.
3. Run the SQL on a throwaway database with seeded rows, and paste the results into the progress entry. Expected:
   - 3 unread messages → 3
   - 150 unread messages → 100
   - your own messages aren't counted
   - a never-read channel counts its messages up to the cap
   - a read cursor after the last message → 0

### Pitfalls

- Deleted messages are simply gone from the table, so the counts are right at join time. Live decrements on delete aren't attempted; B1 documents that.
- Don't change what `hasUnread` means: old clients still read it.

### Regression Risk

Low: one extra query at join, bounded by `LIMIT 100` per text channel.

### Verification

- The test passes, and the throwaway-database results match the expected values.
- Join a seeded server and inspect the tree payload over CDP (`api.on("channel-tree")` or a preload log).

### Done When

- [ ] `unreadCount` field in shared-types.
- [ ] Capped count query.
- [ ] Pure helper, with its test.
- [ ] Throwaway-database evidence in the progress entry.

---

## A6 — Category Delete With Children 🖧

**Phase:** P1 · **Depends on:** A3 (where `presencePayload` and the map live) · **Study frames:** 14c, 14d, 7b

### Current Behavior (verified — V13)

- Deleting any channel re-parents its direct children through the foreign key's `onDelete: SetNull`. The children keep their stale `position`.
- Deleting a VOICE channel tears nothing down on the server.

### Design

**shared-types**
- `DELETE_CHANNEL` payload gains `children?: "keep" | "delete"`. **When it's absent, behaviour stays exactly as today**, which is what v2.7.0 clients get.
- The ack gains `deletedChannelIds?: string[]`.

**Pure planner (`services/channel-delete.ts`)**
```ts
export function planChannelDelete(channels: { id: string; parentId: string | null; position: number; type: "TEXT" | "VOICE" }[],
                                  targetId: string, mode: "legacy" | "keep" | "delete")
  : { deleteIds: string[]; reparent: { id: string; position: number }[]; voiceIds: string[] }
```

| Mode | `deleteIds` | `reparent` |
| --- | --- | --- |
| `legacy` | the target only | empty — the foreign key re-parents, exactly as today |
| `keep` | the target only | its direct children, in their current order, at positions `maxTopLevelPosition + 1 + i` |
| `delete` | the target and every descendant | empty |

- `maxTopLevelPosition` is computed over the top-level channels, **excluding the target**.
- For `delete`, walk the descendants breadth-first. Keep a visited set to guard against cycles, even though the server already cycle-checks moves.
- `voiceIds` = the VOICE channels in `deleteIds`.

**Handler `DELETE_CHANNEL`** — still needs MANAGE_CHANNELS, unchanged.
1. Validate `children`: only `undefined`, `"keep"` or `"delete"`. Anything else → `{ success: false, error: "Invalid option" }`.
2. Load the server's channels (id, parentId, position, type). If the target isn't there → 404. Run the planner.
3. Before deleting anything, collect the files that will be orphaned, for **every** id in `deleteIds` (`collectChannelFileUrls`).
4. In one `prisma.$transaction`:
   - `channel.update` each `reparent` entry (`parentId: null` and its new position);
   - then `channel.deleteMany({ where: { id: { in: deleteIds } } })`.

   Children of a deleted node that aren't themselves deleted only happen in legacy mode, and there the foreign key handles them as today.
5. **Voice teardown**, in every mode, for each id in `voiceIds`. Walk `io.sockets.sockets` and skip any socket with `s.data.superseded` (ownership).
   - **Primary** socket with `socket.data.currentChannelId === id`: `await removeSocketFromChannel(deps, socket, id)`. This is the same quiet removal the access-loss path uses; it sends `PRODUCER_CLOSED` to the room.
   - **Viewer** socket with that `currentChannelId`: `mediasoup.cleanupUserSession(id, getMediasoupSessionKey(s))`, then `s.disconnect(true)`.
   - Then `voiceSessionStartedAt.delete(id)`.
6. `ack({ success: true, deletedChannelIds: deleteIds })`.
7. Broadcast **one** `CHANNEL_TREE_UPDATE`, then one `CHANNEL_DELETED` per deleted id. The client's existing handler closes the tabs and leaves voice for each one.
8. Release the files in the background, using the existing pattern.

**Client:** nothing in this item. C6 builds the dialog and B7 the voice-channel text. The existing `channel-deleted` handler already copes with several deletions in a row.

### Implementation Steps

1. shared-types changes; build.
2. `channel-delete.ts` plus `__tests__/channel-delete.test.ts`. Test cases:
   - `legacy` mode.
   - `keep` with 3 children while the top level holds positions [0, 1, 5]: the children get 6, 7 and 8, in their old order.
   - `delete` on a nested subtree (a category holding a text channel, a voice channel, and a sub-category with a text channel): every id is deleted.
   - `voiceIds` lists exactly the voice channels.
   - A target with no children, in every mode.
3. Rewrite the handler in the order above.
   - Legacy mode keeps today's observable behaviour: the same broadcasts, in the same order.
   - The one addition is the server-side voice teardown (decision D6, confirmed).
4. Run each branch on a throwaway database.
   - Include **a category holding a voice channel with an occupant** (a connected test client sitting in it).
   - Expected: the occupant's voice session closes on the server, and their client leaves voice.

### Pitfalls

- `deleteMany` doesn't change how cascades behave: messages, reactions, attachments, pins and reads all go through their foreign keys. Confirm both in the schema: `Message.channel` is `onDelete: Cascade`; `Channel.pinnedMessage` is `SetNull`.
- Tear voice down only **after** the database transaction commits, so a failed delete never kicks anyone.
- Don't send `USER_KICKED`: it plays the kick sound. The client's `channel-deleted` handler is the notice.

### Regression Risk

Medium: this is a destructive server path. What limits the risk:
- the planner is pure and covered by tests;
- every branch is run against a throwaway database;
- legacy mode keeps today's behaviour.

### Verification

- Planner tests pass.
- Throwaway-database runs of `legacy`, `keep` and `delete`, including the occupied voice channel.
- A v2.7.0 client deleting a category still gets today's result.

### Done When

- [ ] Payload option.
- [ ] Planner, with its tests.
- [ ] Transactional handler.
- [ ] Deleted voice rooms are torn down on the server.
- [ ] One tree broadcast, plus a `CHANNEL_DELETED` per deleted id.
- [ ] Evidence for each branch.

---

## A7 — DM Directory 🖧

**Phase:** P1 · **Depends on:** A1 (the member and access rules) · **Study frames:** 9a · **Confirmed decisions:** Q8 (`"member"`)

### Current Behavior (verified — V2, V14)

- `GET_ONLINE_USERS` returns online members plus existing DM partners.
- The server accepts a DM to anyone who has access.
- There is no last-message data.

### Design

**shared-types**
```ts
export interface IDmDirectoryEntry {
    userId: string; nickname: string; avatarUrl: string | null; isOnline: boolean;
    /** Latest DM between the caller and this member; absent = never messaged. `text` is RAW message text (≤ 300 chars) — render with markdownToPlainText. */
    lastMessage?: { text: string; hasAttachments: boolean; at: string; fromMe: boolean };
    unreadCount: number;
}
GET_DM_DIRECTORY: (ack: (res: { success: boolean; members?: IDmDirectoryEntry[]; error?: string }) => void) => void;
```

**Server (`dm.handler.ts`)**
- **Members**
  - Same rule as A1: `user_servers` rows with access, not banned, excluding the caller. Reuse A1's loader and aggregation; don't copy them.
  - Users without access are **not listed**, because they can't receive DMs (decision D4, confirmed).
  - A past partner who loses access disappears from the list. Their history stays reachable from an open tab for as long as the caller still has access.
- **Last message per partner**, in one raw query:
  ```sql
  SELECT DISTINCT ON (partner) partner, id, content, "senderId", "createdAt"
  FROM (SELECT CASE WHEN "senderId" = $1 THEN "receiverId" ELSE "senderId" END AS partner, id, content, "senderId", "createdAt"
        FROM direct_messages WHERE "senderId" = $1 OR "receiverId" = $1) d
  ORDER BY partner, "createdAt" DESC
  ```
  - Then run one `attachment.groupBy({ by: ["dmId"], where: { dmId: { in: ids } } })` to fill `hasAttachments`.
  - `text` = `content.slice(0, 300)`.
- **Unread counts:** reuse the existing `groupBy` from `GET_UNREAD_DM_PARTNERS`.
- **Online status:** `presence.getOnlineUsers`.
- **Assembly:** a pure `buildDmDirectory(...)`, covered by a test.
  - It doesn't sort. The client orders the list, because it re-sorts live.
- **Access:** `EVENT_ACCESS.GET_DM_DIRECTORY = "member"`.

**Preload**
- `getDmDirectory(): Promise<IDmDirectoryEntry[] | null>`, with a 5-second timeout. `null` means an old server.
- `avatarUrl` doesn't need `resolveMediaUrl`: Libravatar and Gravatar URLs are already absolute.

**Old-server fallback** (C7 uses it)
- Build the entries from `GET_ONLINE_USERS`. `lastMessage` is absent; `unreadCount` comes from `GET_UNREAD_DM_PARTNERS`.
- C7 then shows the note "This server only lists people who are online or you've talked to."

### Implementation Steps

1. shared-types changes; build.
2. Server: the loader reuse, the raw query (as a tagged template), and `buildDmDirectory` with a test. The test covers:
   - the caller is excluded;
   - banned users are excluded;
   - restricted users are excluded;
   - the newest message is picked as the last message;
   - `fromMe` is correct;
   - `unreadCount` defaults to 0.
3. Check the `DISTINCT ON` query on a throwaway database, with messages in both directions.
4. Preload method.

### Pitfalls

- Table and column names: check `@@map("direct_messages")` and that the camelCase columns are quoted.
- Never send other people's DM contents. The query only reads pairs that include the caller.

### Regression Risk

Low: this is a new read-only event.

### Verification

- The test passes.
- A member with no DMs receives every other member who has access.
- After sending a DM, that entry has `lastMessage.fromMe === true`.

### Done When

- [ ] Event and model added.
- [ ] Pure builder, with its test.
- [ ] Query checked on a throwaway database.
- [ ] `"member"` classification.
- [ ] Preload method returns `null` on an old server.

---

## A8 — The Client Learns Its Own Permissions 🖧 (NEW)

**Phase:** P1 · **Depends on:** —

**Why new:** V18. B6, B8 and C3 need MANAGE_CHANNELS, CREATE_CHANNEL, KICK_USER and ADMIN on the client. Today the client learns only three permissions, by probing admin calls.

### Design

**shared-types**
- The `USER_JOIN_SERVER` ack gains `permissions?: string`. It's the aggregated bigint, as a decimal string, because bigints aren't valid JSON.
- New server→client event: `PERMISSIONS_CHANGED: (payload: { permissions: string }) => void;`. It goes to the user's **primary** sockets when their roles change.

**Server**
- **Join:** in `USER_JOIN_SERVER`'s success path, where `hasAccess` is computed from `getUserPermissions` (`connection.handler.ts:~741`), add `permissions: perms.toString()` to the ack.
- **Role changes:** add a helper `emitPermissionsChanged(io, app, userId, serverId)` to `access-change.ts`.
  - It recomputes the target's permissions and emits `PERMISSIONS_CHANGED` to each primary socket whose `data.userId` is the target, using the same socket loop as `applyAccessChange`.
  - Call it from `access-change.ts` itself, so every role-change path gets it. That includes `ASSIGN_ROLE` (`admin.handler.ts:223`), which runs it after the role is written.

**Client**
- Mirror `PermissionFlags` in the renderer: `const PERM = { CONNECT: 1n, …, MANAGE_EMOJIS: 512n }`, with a comment pointing at `models.ts`.
- State: `let myPermissions: bigint | null = null`. `null` means unknown, i.e. an old server.
- `function hasPerm(flag: bigint): boolean | null`:
  - returns `null` while the permissions are unknown;
  - otherwise returns `(myPermissions & PERM.ADMIN) !== 0n || (myPermissions & flag) !== 0n`.
- `myPermissions` is set from the join ack (the preload passes it through on the `connected` event's payload) and from `PERMISSIONS_CHANGED`. It goes back to `null` on disconnect.
- **No gate changes in this item.** The existing probes (`isAdminUser`, `canBanUsers`, `canManageEmojis`) stay as they are.

### Implementation Steps

1. shared-types changes; build.
2. Server: the join ack field, the helper, and the call from the role-change path. Test the helper with a fake `io`, either in an existing test or in a new `__tests__/permissions-changed.test.ts`.
3. Preload forwarding:
   - add the field to the `connected` payload;
   - add the new `permissions-changed` event to the preload's event map.
4. Renderer: the state and `hasPerm`.

### Pitfalls

- `bigint` literals such as `1n` need ES2020. Check `target` and `lib` in the renderer's tsconfig first; if they're older, use `BigInt(…)` calls instead of literals.

### Done When

- [ ] Join ack carries `permissions`.
- [ ] Every role-change path emits `PERMISSIONS_CHANGED`.
- [ ] Client state and `hasPerm()`, with `null` meaning unknown.
- [ ] Test for the helper.

---

## A9 — Enforce the Screen-Share Switch at PRODUCE and CONSUME 🖧 (NEW, security)

**Phase:** P1 · **Depends on:** A4, which already wraps screen-video `PRODUCE` in the channel lock · **Why new:** Pre-existing issue P2, accepted as decision D7 on 13/10/2026.

### Current Behavior (verified — V11, V27)

The server-wide switch `servers.screenShareEnabled` is checked in only two places:
- **`SET_SCREEN_SHARE_STATE`:** it coerces the presence flag to `false`.
- **`WATCH_SCREEN_SHARE`:** it refuses to start a watch.

Two gaps follow from that:
- **`PRODUCE` creates screen producers even when sharing is off** (`voice.handler.ts:234`). A modified client can still produce `screen-video` or `screen-audio`.
- **`CONSUME` accepts any producer in the router** (`:337`). A socket in the room can consume a screen producer directly, which skips `WATCH_SCREEN_SHARE` and its checks: the switch, the occupant check and the sharer's "viewer joined" notice.

The official client never does either of these. Only a modified client can.

### Goal

Sharing off means nobody can produce or consume screen media. Screen media is consumed only through the watch path, as the protocol comments in `socket-events.ts` already describe.

### Design

**shared-types**
- The `PRODUCE` ack's `errorCode` (from A4) also allows `"SCREEN_SHARE_DISABLED"`.
- `CONSUME`'s ack gains an optional `errorCode?: "SCREEN_SHARE_DISABLED" | "NOT_WATCHING"`.

**Server — a cached switch value**
- New `config/screen-share.config.ts`, the same pattern as `approval.config.ts`: `screenShareEnabled()` returns an in-memory value.
- Load it at boot from the server row (find where `approval.config` is loaded in `index.ts` and do the same).
- Update it in `UPDATE_SERVER_SETTINGS` when `screenShareEnabled` changes.
- Use it in the new checks below. The two existing checks may keep their DB reads (non-regression rule), or switch to the cached value; write down which you chose.

**Server — finding a producer's owner and kind**
- New method `MediasoupService.findProducer(channelId, producerId): { ownerKey: string; mediaType: "mic" | "screen-video" | "screen-audio" } | null`.
- It walks the channel's sessions and compares `producerId` with each session's `producer`, `screenVideoProducer` and `screenAudioProducer`.

**Server — `PRODUCE`**
- When `mediaType` is `"screen-video"` or `"screen-audio"` and `screenShareEnabled()` is false, ack:
  `{ success: false, error: "Screen sharing is disabled on this server", errorCode: "SCREEN_SHARE_DISABLED" }`.
- For `screen-video`, run this check inside A4's channel lock, **before** the cap check.

**Server — `CONSUME`.** Before `canConsume`, look the producer up with `findProducer`. Then:

| What the lookup finds | Result |
| --- | --- |
| `null` (unknown producer) | keep today's behaviour: `router.canConsume` decides, and the call fails as before |
| a mic producer | unchanged |
| a screen producer, sharing switched off | refuse with `SCREEN_SHARE_DISABLED` |
| a screen producer, and the socket isn't a viewer socket watching that sharer | refuse with `NOT_WATCHING` |

"A viewer socket watching that sharer" means `socket.data.role === "viewer"` **and** `socket.data.watchingUserId === ownerKey`. The sharer's session is keyed by their `userId`, because sharers use primary sockets.

**Compatibility.** The v2.7.0 Viewer window and C10's stage watch both consume through a viewer socket after `WATCH_SCREEN_SHARE`, so they pass these checks unchanged.

**Out of scope.** Switching sharing off while someone is already sharing doesn't stop that share. Write that down in the progress entry.

### Implementation Steps

1. shared-types `errorCode` additions; build.
2. `screen-share.config.ts`: load it at boot and update it when the setting changes.
3. `findProducer`, plus the `PRODUCE` and `CONSUME` checks.
4. Tests:
   - extract the rule as a pure `screenConsumeDecision({ mediaType, enabled, role, watchingUserId, ownerKey })`;
   - unit-test every row of the table above;
   - add a `findProducer` test using fake session objects.

### Pitfalls

- Never refuse a **mic** consume. Voice must work whatever the switch says.
- `watchingUserId` is set by `WATCH_SCREEN_SHARE` and cleared by `STOP_WATCHING_SCREEN_SHARE`. When C11 adds swaps, each swap must go through STOP → WATCH on its own socket, which C10/C11 already do.

### Verification

- **Tests:** the new unit tests pass.
- **Real server, sharing on:** the Viewer window still plays a share, and so does C10's stage once it exists.
- **Real server, sharing off:**
  - a test socket's screen-video `PRODUCE` gets `SCREEN_SHARE_DISABLED`;
  - a primary socket's `CONSUME` of a screen producer gets `NOT_WATCHING`; produce it while sharing is on, then flip the switch, or use a viewer-less socket;
  - voice consuming is unaffected.

### Done When

- [ ] Cached switch value.
- [ ] `PRODUCE` refuses screen media while sharing is off.
- [ ] `CONSUME` only allows screen media to a viewer socket that is watching that sharer, and only while sharing is on.
- [ ] Pure decision function with tests.
- [ ] Viewer flow unchanged.

---

## A10 — Validate Every Upload by Its Real Bytes 🖧 (NEW, security)

**Phase:** P1 · **Depends on:** A2 (the `image-sniff.ts` sniffer and the `validate` hook) · **Why new:** Pre-existing issue P1, accepted as decision D9 on 13/10/2026.

### Current Behavior (verified — V7)

All four existing upload routes behave the same way:

| Route | Size limit | Allowed MIME types |
| --- | --- | --- |
| `/api/upload` | 5 MB | `ALLOWED_MIME_TYPES` |
| `/api/upload/emoji` | 512 KB | `ALLOWED_MIME_TYPES` |
| `/api/upload/emoji-animated` | 2 MB | gif |
| `/api/upload/channel-icon` | 512 KB | `ALLOWED_MIME_TYPES` |

`ALLOWED_MIME_TYPES` is `image/jpeg`, `image/png`, `image/gif` and `image/webp` (`upload.route.ts:42`). These are exactly the formats A2's sniffer recognizes.

Every route trusts the **declared** multipart MIME type, and stores the file under the **client's** file name and extension. So a request can store HTML or SVG bytes as `/uploads/<uuid>-x.html`, and the public static route then serves it as `text/html` from the server's origin.

### Goal

- Every stored upload is a real PNG, JPEG, GIF or WebP whose bytes match its declared type.
- Its stored extension comes from the sniffed type.
- No other behaviour changes: same size limits, same allowed types, same ledger, same response.

### Design

**A shared validator.** One function in `upload.route.ts`, used by every route through A2's `validate` hook:

```ts
validateImageBytes(buffer, declaredMime): { ok: true; ext: "png" | "jpg" | "gif" | "webp" } | { ok: false; error: string }
```

- `sniffImage(buffer)` must succeed.
- The sniffed type must match the declared MIME. Note that `image/jpeg` → `jpeg`.
- The route's own MIME set still applies. The animated-emoji route still accepts only GIF.
- **No dimension rules here.** Only the server icon (A2) has those.

**Storage name.** `saveLocally` stores `<uuid>-<sanitized base name without its extension>.<sniffed ext>`.
- An empty base name becomes `image`.
- Cloudinary uploads only gain the validation. Cloudinary sets its own format.

**Refusal.** Send 400 with: "That file isn't a valid PNG, JPEG, GIF or WebP image."
- The client already shows upload errors per card (PRD 16.10), with retry and remove.
- **Check before relying on it:** that the error text reaches the user for chat attachments, emoji and channel icons. Look at how `uploadTo()` surfaces a non-OK response.

**Stored files are untouched.** Existing files on disk stay as they are. P1's risk for old files is left to the existing `npm run uploads:prune` tooling and the owner. Write that down in the progress entry.

### Implementation Steps

1. Add `validateImageBytes` and wire it into all four routes. Keep A2's icon route on its stricter hook, which builds on the same function.
2. Change `saveLocally` to take the extension separately. `grep` for every caller and update them.
3. Write `__tests__/upload-validate.test.ts`, covering:
   - each format accepted when its declared type matches;
   - a PNG declared as GIF is refused;
   - HTML bytes declared as `image/png` are refused;
   - an SVG is refused;
   - the base-name and extension result for `photo.final.JPG` → `photo.final.jpg` and for `x.html` → `x.png`, with PNG bytes;
   - an empty name gives `image.<ext>`.

### Pitfalls

- **Some files are already broken today.** A real JPEG saved with a `.png` name used to be stored as declared. Under A10 it's accepted if its declared type matches its bytes, and stored as `.jpg`. If the declared type doesn't match the bytes, it's now refused.
- **Mismatched clipboard images are a regression risk.** Some apps paste images whose declared type doesn't match their bytes. Test pasting from at least one browser and one screenshot tool. If that case shows up, tell the user before shipping. Don't loosen the check on your own.

### Regression Risk

Medium-low. Every upload path is touched. The tests and a headless upload of each kind (attachment, static emoji, animated emoji, channel icon) cover it.

### Verification

- The unit tests pass.
- curl checks:
  - each route accepts a real file of every allowed type;
  - HTML or SVG bytes declared as an image get a 400;
  - an accepted file is served back with an image `Content-Type`.
- Headless: one upload of each kind still works end to end.

### Done When

- [ ] One validator used by every route.
- [ ] Stored extension comes from the bytes.
- [ ] Refusal message reaches the user.
- [ ] Tests pass.
- [ ] All four upload kinds verified end to end.

---

# P2 — Behaviour in the current UI

These items change behaviour only. Styling stays as it is today and gets restyled in P3–P5. Where a new visual element is needed, such as a count pill or a bell-slash icon, give it a plain class and minimal CSS that uses the **existing** variables. F1 re-skins it later.

## B1 — Unread Counts in the Current UI

**Phase:** P2 · **Depends on:** A5 · **Study frames:** 6a (tree count), 13b (tab badges)

### Current Behavior (verified)

- **Channels:** `unreadChannelIds: Set<string>` (`renderer.ts:1215`).
  - `markChannelUnread()` (`:7117`) returns early if the channel is already unread, so it can't count.
  - The tree shows an `.unread-dot`.
- **DMs:** `unreadDmPartners: Set<string>` (`:1219`). The server's `unreadCount` is only used as a hint for the "Unread Messages" line.
- **Tabs:** `refreshTabUnread()` toggles `.has-unread` and shows a `.tab-unread-dot` element.

### Design

**State**
- Replace the sets with maps:
  - `unreadChannelCounts: Map<string, number>`
  - `unreadDmCounts: Map<string, number>`
- Keep thin helpers so existing call sites still read naturally:
  - `channelUnread(id): number` (0 = read)
  - `hasChannelUnread(id): boolean`
  - `dmUnread(partnerId): number`, `hasDmUnread(partnerId): boolean`
- `-1` means "unread, count unknown". An old server only sends `hasUnread`, and we show a dot for that.

**Seeding**
- `renderTree()` seeds from `node.unreadCount`. If that's missing but `node.hasUnread` is set, it seeds `-1`.
- Seed only when there's no entry yet, mirroring today's `if (node.hasUnread …) add` rule.
- `autoOpenUnreadDmTabs()` / the connect path seed DMs from `GET_UNREAD_DM_PARTNERS`' `unreadCount`.

**Live increments**
- `markChannelUnread(channelId)` becomes `bumpChannelUnread(channelId)`. It adds 1, or leaves `-1` as it is.
  - **Own messages are never counted.** The `message` handler already only calls it for non-active channels; add `msg.userId !== api.getInstanceId()`.
- The `dm-received` handler adds 1 for messages from the partner. It must not do this when `markDmTabRead()` then clears it straight away; keep the existing order: `add`, then `markDmTabRead`.

**Clearing**
- `markChannelRead()` deletes the entry.
- `markDmTabRead()` deletes the DM entry. **It stays the only DM read path**: no new `api.markDmsRead()` calls.

**Display** (tree row and tab use the same element)
- A count pill `<span class="unread-count">` showing the number, or "99+" for ≥ 100, or "•" for `-1`.
- In the tree it replaces `.unread-dot`, created by `markChannelUnread`'s targeted path and by `renderTree`.
- On tabs, set the text of the existing `.tab-unread-dot`, renamed to `.tab-unread-count` with the CSS updated.
- `aria-label` stays: `"{name} ({n} unread)"`.

**Online-users modal** (until C7 replaces it): show the count next to a partner with unread DMs, if the modal shows unread today. Check first; don't add it if it doesn't.

**Deleted messages:** counts are not decremented on `MESSAGE_DELETED` (accepted; documented in the code comment).

### Implementation Steps

1. Find every `unreadChannelIds` and `unreadDmPartners` use (`grep -n`). Convert each one, keeping its behaviour, through the helpers.
2. Add the seeding, the increments and the display.
3. Check the muted rules still hold. `isChannelMuted` still suppresses painting, but the count keeps counting (that's PRD 16.4).

### Pitfalls

- `markChannelRead()` also clears `node.hasUnread`, so a re-render can't re-seed the channel. Keep that, and also clear `node.unreadCount`.
- A `renderTree()` must not reset counts that were already incremented live. Seed only when there's no entry.

### Verification

- Headless, with a second client sending messages:
  - join with 3 unread → the tree and the tab show 3;
  - a new message → 4;
  - open the channel → cleared;
  - reconnect → still cleared.
- DMs: 2 unread → 2 on the tab while it's in the background.
- Old-server path: a v2.7.0 server shows "•".

### Done When

- [ ] Count maps and helpers replace the sets.
- [ ] Own messages are excluded.
- [ ] Tree and tab show the same number.
- [ ] Old-server dot works.
- [ ] `markDmTabRead()` is still the only DM read path.

---

## B2 — Muted Channels Are Fully Silent

**Phase:** P2 · **Depends on:** B1 · **Study frames:** 6a (muted row), SPEC §2.3, §4

### Current Behavior (verified — V15)

Already done:
- The tree hides the dot for muted channels.
- `refreshTabUnread()` hides the tab badge.
- Channel messages play no sound at all.

Missing:
- the fade rule;
- the bell-slash icon;
- the faded, badge-less tab.

### Design

**Tree row**
- `.tree-channel.muted` fades to `opacity: 0.5`, except when the row also has `.viewing`: `.tree-channel.muted:not(.viewing) { opacity: .5 }`.
- Check the current `.muted` CSS first; keep its other rules.
- It gets a bell-slash icon (`<span class="ch-muted-icon" aria-label="Muted">`).
  - Until F2, use an inline SVG constant `BELL_SLASH_ICON_SVG`.
  - F2 swaps it for the Phosphor `ph-bell-slash` glyph.

**Tab**
- A muted channel's tab gets `.muted`: `opacity: .55`, the bell-slash next to the label, and never `.has-unread`.

**Updates**
- All of this goes through `applyChannelMuteState(channelId)`, as targeted DOM updates. It already exists; extend it to update the tab too.
- `renderTree()` builds the same state on a full render.

**Unmuting** shows the stored count again. B1's count keeps counting while muted.

### Verification

- Mute a channel with 2 unread: it fades, shows the bell-slash, no count, and its tab shows no badge.
- Open it: full opacity while viewing.
- Unmute: the count 2 comes back.
- Collapsed categories survive (no `renderTree()`).

### Done When

- [ ] Fade except while viewing, bell-slash, muted tab.
- [ ] All done as targeted updates.
- [ ] Unmuting restores the count.

---

## B3 — One "Mark Channel Read" Rule for Tree and Tab

**Phase:** P2 · **Depends on:** B1

### Current Behavior (verified — V16)

- `switchTab()` calls `markChannelRead(tabId)` unconditionally, so opening a channel from its tab already clears it. The handoff assumed it didn't.
- Neither the tree path nor the tab path checks window focus.
- A message arriving on the active tab while the window is unfocused is never counted.

### Design (decision D1, confirmed by the user: adopt the DM focus rule)

Mirror the DM rule (PRD 18.13):
- **New helper `markChannelTabRead(tab)`.** It marks the channel read only when the tab is active, `document.hasFocus()` is true, and the tab's page has rendered (`tab.initialLoadDone`).
- **Who calls it:**
  - `switchTab()`, instead of the direct `markChannelRead`;
  - the window `focus` handler, wherever `markDmTabRead` is called on focus;
  - the end of the channel history load;
  - the `message` handler.
- **`message` handler:** count a message when its channel is **not active, or the window is not focused**. Then call `markChannelTabRead()`, which clears it at once when you're actually looking at it.
- **No sound changes.** Channel messages have no sound.


### Verification

- With the window unfocused:
  - a message on the active channel counts as 1;
  - focusing the window clears it.
- Opening a channel from the tree and from its tab both clear it.

### Done When

- [ ] One helper, called from every view path.
- [ ] Focus rule applied (D1).

---

## B4 — DM Tabs Follow the Preview/Kept Rules

**Phase:** P2 · **Depends on:** — · **Study frames:** 9b, 13a · **Confirmed decision:** Q5 (an incoming DM without a tab opens as a **kept, unfocused** tab)

### Current Behavior (verified — V17)

- **Modes:** `ChatTab.mode` is used for channel tabs only. `previewTabId` holds channel ids only. `openChatTab()` (`:5140`) does the preview replacement.
- **Opening:** `openDmTab()` (`:5265`) always creates a permanent tab **and switches to it**.
- **Incoming DMs:**
  - An incoming DM without a tab calls `openDmTab()`, which steals the view.
  - `autoOpenUnreadDmTabs()` (`:3187`) does the same for every unread partner at connect.
- **Persistence:** `persistKeptTabs()` keeps channel tabs only.
- **Tab ids:** `dm:<userId>`.

### Design

**1. One placement helper.** Extract `placeTab(tab, { mode, focus })` from `openChatTab()`'s preview logic. Both `openChatTab()` and `openDmTab()` use it.

- `mode: "preview"`:
  - If a different preview tab exists, it is **replaced in place**: the new tab element takes its slot in the bar, and the old one is closed with `closeTab(oldId, { reason: "replaced" })`. That disposes its observers and its `replyTargets` entry.
  - `previewTabId = tab.id`.
- `mode: "kept"`: appended at the end of the bar, then `persistKeptTabs()`.
- `focus: true` → `switchTab(tab.id)`; `focus: false` leaves the active tab alone.

**2. The new `openDmTab` signature.**
```ts
openDmTab(userId, nickname, opts: { mode?: "preview" | "kept"; focus?: boolean; unreadCountHint?: number } = {})
```
Defaults: `mode: "preview"`, `focus: true`. Every caller passes its options explicitly:

| Caller | Mode | Focus |
| --- | --- | --- |
| User clicks a person (online-users modal now, the DM sidebar in C7, profile card "Message") | preview | yes |
| Incoming DM from someone with no open tab (`dm-received`) | kept | **no** (Q5) |
| `autoOpenUnreadDmTabs()` at connect, and when access returns | kept | **no** |
| An already-open tab | unchanged | `switchTab` only when `focus` is true |

**3. Double-click** on a DM tab keeps it, as on channel tabs. Wire the same `dblclick` → `setTabKept()`. Make `setTabKept()` work for both kinds, and rename its parameter from `channelId` to `tabId`.

**4. Persistence.**
- `persistKeptTabs()` also keeps `dm:<userId>` ids. Keep the tab-bar order; keep the same store and shape.
- `restoreKeptTabs()` restores channel ids as today, but **skips `dm:` entries** (it runs before any DM data exists).
- **New** `restoreKeptDmTabs()` runs after the DM data arrives: the directory from A7, or `GET_ONLINE_USERS` on an old server. It opens each `dm:` entry whose user is still listed, as kept and unfocused. Entries for users who aren't listed are **left in the store**, not deleted: the person may just be temporarily without access.
- Both functions do nothing while access is restricted (the existing rule).

**5. Access loss and restore.** `applyAccessState()` already closes tabs with `reason: "access"` and restores kept tabs and unread DM tabs. Make the restore path call `restoreKeptDmTabs()` and `autoOpenUnreadDmTabs()` with the new options.

**6. Labels and preview styling.** DM tabs keep the "✉️" icon until F2, when it becomes `@`. A preview DM tab gets the same italic class (`.preview`) through `renderTabMode()`, which already handles both kinds once `mode` is set.

### Pitfalls

- The scroll keeper's `ResizeObserver`/`MutationObserver` and `replyTargets` belong to each tab. A replaced preview must go through `closeTab(…, { reason: "replaced" })`, never a bare `.remove()`.
- `markDmTabRead()` must still require the tab to be active. A background kept DM tab stays unread with its count; `refreshTabUnread` already handles DM tabs.
- The DM sound logic captures `wasTabActive` before opening. Keep that ordering exactly (PRD 14.4).

### Verification (9b)

- Open DM A, then DM B: B replaces A in place.
- Keep B, open channel C: both stay.
- Restart: B and C are restored.
- Receive a DM from D while reading C: a kept D tab appears in the background with a count and the sound plays; C stays active.
- Lose access, then regain it: B is restored.

### Done When

- [ ] `placeTab` is shared by channel and DM tabs.
- [ ] DM preview and kept modes, double-click to keep.
- [ ] Incoming and auto-opened DMs open kept and unfocused.
- [ ] Kept DMs are persisted and restored after the DM data arrives.
- [ ] Observers and reply drafts are disposed on replacement.

---

## B5 — Tab Menu Additions

**Phase:** P2 · **Depends on:** B4 · **Study frames:** 6b

### Current Behavior (verified)

`showChannelTabContextMenu()` (`:5414`) has two items, Keep/Stop keeping and Close tab, and is attached to channel tabs only.

### Design

**Attach the menu to DM tabs too.** Rename the function to `showTabContextMenu(e, tabId)`.

**Items, in this order:**
1. Keep open / Stop keeping open
2. Close tab
3. Close other tabs
4. Close tabs to the right

**What the new items do:**
- **Close other tabs** closes every tab in the bar except this one and `server-log`.
- **Close tabs to the right** closes the tabs after this one in DOM order, skipping `server-log`.
- Each tab closes with `closeTab(id, { reason: "user" })`. For a kept tab, that already calls `persistKeptTabs()`, so the tab is also un-kept.
- Disable an item, rather than hide it, when it would do nothing: no other tabs, or nothing to the right.

**The Server Log tab** gets no menu: it can't be closed.

**Wording:** the labels follow SPEC §3.5's casing ("Keep open", "Close tab", "Close other tabs", "Close tabs to the right"), which replaces today's "Keep Tab Open". Update the tooltip text in `renderTabMode()` to match.

### Verification

- With 5 tabs open, "Close tabs to the right" on the 2nd tab leaves Server Log, tab 1 and tab 2.
- Closed kept tabs don't come back after a restart.

### Done When

- [ ] Menu works on DM tabs.
- [ ] The two new actions work and follow the kept-tab rules.
- [ ] Server Log is protected.

---

## B6 — Menu Permissions and the Voice Channel Menu

**Phase:** P2 · **Depends on:** A8 · **Study frames:** 6a, 7a

### Current Behavior (verified — V18, V25)

- `attachChannelContextMenu()` (`:2920`) shows Rename, Move and Delete (and Icon and NSFW on text channels) to everyone.
- The server refuses non-holders and the client plays `insufficient_perms.mp3`.

### Design

**Who sees the admin group**
- `const canManage = hasPerm(PERM.MANAGE_CHANNELS)`.
- When `canManage === false`, the menu has no "Manage channel" group at all.
- When `canManage === null` (an old server), keep today's behaviour: show the items and let the server refuse.

**Grouping**
- **Text channel:** Keep open, then Mute, at the top. Then, if allowed: a divider, the "Manage channel" label, Rename…, Set icon…, Move to category…, Mark/Unmark NSFW. Then a divider and Delete channel… (in red).
- **Voice channel:** only the "Manage channel" group: Rename…, Move to category…, a divider, Delete channel…. A member sees no menu at all on a voice channel (don't open an empty one).

**Re-rendering on permission changes**
- `PERMISSIONS_CHANGED` needs no re-render: the menu builds its items each time it opens.

**Rendering**
- Keep today's menu DOM for now. Add the label as a non-interactive `div.ctx-menu-label` with `textContent`. F3 moves it onto the shared builder.

### Verification

- A member right-clicking a text channel sees only Keep open and Mute.
- An admin sees everything.
- A member right-clicking a voice channel sees nothing.
- Against a v2.7.0 server, everyone sees today's menu.

### Done When

- [ ] Admin group gated by `hasPerm`, with the old-server fallback.
- [ ] Grouping and order as specified.
- [ ] No empty menu.

---

## B7 — Deleting a Voice Channel Says Who's Affected

**Phase:** P2 · **Depends on:** A6 (server teardown) · **Study frames:** 7b

### Design

**The dialog text.** `showDeleteModal(channelId, channelName)` (`:3727`) looks the node up in `currentTree`.
- For a VOICE channel with `n` occupants (n > 0), the body reads, through `textContent`:
  `The ${n} people in it will be disconnected. The channel is removed for everyone on the server. This can't be undone.`
- With n = 1 it says "The 1 person in it will be disconnected."
- Any other channel keeps today's text.
- Recompute `n` when the modal opens. If a `presence` event for that channel arrives while the modal is open, update the text.

**When you're in it.** The existing `channel-deleted` handler leaves voice. It already hides the panel (V19). Then:
- if the active tab is the voice room tab (after C9), switch to the first text tab;
- before C9, nothing changes.

### Verification

- Delete a voice room with 2 people in it, one of them you: the text says "The 2 people…".
- After confirming, both people leave voice, the voice panel is hidden, and the server log shows the deletion.

### Done When

- [ ] Occupant count shown with the singular form, kept live while the dialog is open.
- [ ] Clean exit for the deleting user.

---

## B8 — Occupant Menu

**Phase:** P2 · **Depends on:** A8 · **Study frames:** 8a, 8b, 8c

### Current Behavior (verified — V20)

- The volume slider persists on every `input` event.
- Toggling mute runs a full `renderTree()`.
- Kick is gated on MANAGE_ROLES, but the server requires KICK_USER.
- The kick result goes to the server log.
- There's no menu on yourself.

### Design — one builder

`buildOccupantMenuModel(occ, channelNode): MenuModel` returns plain data. A temporary renderer, `renderOccupantMenu(model, x, y)`, draws it with today's `.occupant-ctx-menu` styles; F3 replaces that renderer. C9 reuses the same model on voice tiles.

**When the person is someone else, the menu holds:**
- **Volume slider:** label "Volume", a live `{n}%` readout, range 0–200 in steps of 5, with tick labels 0% / 100% / 200%.
  - On `input`: `api.setLocalUserVolume(id, v)` and update the readout only.
  - On `change`: `setSavedLocalVolume(id, v)` and refresh B9's marks.
- **A divider, then Mute locally / Unmute locally,** with the hint "Only for you" in muted text.
  - Click: `api.setLocalUserMute` + `setSavedLocalMute`, then B9's targeted mark update. **Not `renderTree()`.**
- **The "Moderate" label and "Kick from channel"** (red, last), behind a divider. Shown only when `hasPerm(PERM.KICK_USER)` is true, or, on an old server (`null`), when today's `isAdminUser` is true.
  - On success: `showToast(escapeHtml(occ.nickname) + " was kicked from " + escapeHtml(channelNode.name))`.
  - On failure: keep the existing log and sound.

**When the person is you,** the menu holds a single item, **Voice settings…**. It opens the Settings modal on the Voice & Shortcuts tab: find the function or tab id the gear uses and select `data-settings-tab` for voice.

### Verification

- **Volume:** change it and restart; it's remembered.
- **Local mute:** the mark appears immediately (with B9), and collapsed categories survive.
- **Kick:** a member never sees it. An admin whose role has KICK_USER but not MANAGE_ROLES now sees it (that's the bug fix). Kicking someone shows the toast.
- **Yourself:** the menu shows only Voice settings….

### Done When

- [ ] One builder producing a model.
- [ ] The slider saves on `change`.
- [ ] Targeted updates only.
- [ ] Kick gated on KICK_USER, with a toast.
- [ ] Self menu.

---

## B9 — Tree Marks for Local Volume and Mute

**Phase:** P2 · **Depends on:** B8 · **Study frames:** 8b, SPEC §2.1

### Design

`renderOccupants()` (`:3037`) adds two marks after the name:
- `<span class="occ-local-volume">{n}%</span>` (monospace, muted colour) when the saved volume isn't 100 and the person isn't locally muted.
- The existing `OCC_LOCALLY_MUTED_ICON` when the person is locally muted. Restyle it to the muted colour; it's no longer the accent.

Add `refreshOccupantMarks(userId)`, which updates every `.tree-occupant[data-user-id]` element for that user in place. B8 calls it, and C9 tiles will too.

### Done When

- [ ] Both marks render on full renders and through the targeted update.

---

## B10 — Voice Row Count and Session Timer

**Phase:** P2 · **Depends on:** A3 · **Mostly exists** (V9, V21)

### Design

What's left:
- The count pill gets a tooltip, `{n} people connected` ("1 person connected" for one), and a person icon before the number. Until F2, use an inline SVG; after F2, `ph-user`.
- Confirm the timer format is `mm:ss`, switching to `h:mm:ss` from one hour. `formatDuration` already does this.
- Confirm the timer is hidden for an empty room.
- Leave the single global interval as it is. It's already one interval for the whole tree.

### Done When

- [ ] Tooltip and icon on the count pill.
- [ ] The timer appears for a room that was already occupied when you connected (from A3).

---

## B11 — What's New Only Before Connecting

**Phase:** P2 · **Depends on:** — · **Study frames:** 15c

### Current Behavior (verified — V22)

- The app never auto-connects.
- `checkForWhatsNew()` runs at launch, then awaits a GitHub fetch. If the user connects before that fetch returns, the modal can appear over a live session.

### Design

- **Late notes:** in `checkForWhatsNew()`, right before showing the modal (after `fetchReleaseNotes` resolves), check that the app is still disconnected and not connecting: `!isConnected` and no connect in flight (find the flag `startConnect()` sets).
  - If it is connected, `return` **without** marking the version as seen. The notes then show at the next launch.
- **Starting a connection while the modal is open:** the modal's backdrop makes that impossible. Leave it.
- **Keep unchanged:** `isExistingInstall()`, "only Got it marks the version as seen", and "a backdrop click doesn't".

### Verification

- With the GitHub fetch delayed (CDP `Fetch` domain), connect first: the modal doesn't appear, and `reson8-last-seen-version` is unchanged.
- Next launch without connecting: the modal appears.

### Done When

- [ ] Guard in place.
- [ ] Existing seen-marking rules unchanged.

---

## B12 — Update State Machine: Logic Part

**Phase:** P2 · **Depends on:** R0 · **Study frames:** 4g, 15a–15c (logic only; the UI comes in C12)

### Current Behavior (verified — V23)

- `UpdateModalState = "idle" | "found" | "downloading" | "ready"` (`renderer.ts:~12136`).
- On `update-downloaded`, the **renderer** waits 1.2 s and then calls `api.quitAndInstall()`.
- `main.ts` sends only `{ version }` with `update-available`, and `{ percent }` with download progress.

### Design

**1. Main process** (additive IPC payloads)
- `update-available` sends `{ version, releaseDate?, sizeBytes? }`. `sizeBytes` is the size of the file for this platform: the first of `info.files`.
- `download-progress` also sends `{ transferred, total }`.

**2. Renderer: one source of truth**
```ts
type UpdatePhase = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";
interface UpdateState { phase: UpdatePhase; current: string; next?: string; releaseDate?: string; sizeBytes?: number; percent?: number; checkedAt?: number; error?: string }
let updateState: UpdateState;
const updateListeners = new Set<(s: UpdateState) => void>();
function setUpdateState(patch: Partial<UpdateState>): void  // merges, then notifies every listener
```
- The existing modal, the About row (`#about-update-status`, `#btn-check-updates`) and a new gear dot (`#btn-settings` gets `.has-update` in the `available` and `ready` phases) subscribe to it.
- The manual "Check for updates" button sets `checking`, then `up-to-date`/`available`/`error`, with `checkedAt`.

**3. "Ready" waits for you**
- Remove the `setTimeout(quitAndInstall)`.
- In the ready state, the existing modal shows two buttons:
  - **Restart now** → `api.quitAndInstall()`;
  - **On next launch** → closes the modal and keeps `phase: "ready"`.
- Installing on quit is electron-updater's `autoInstallOnAppQuit`, which defaults to `true`. Confirm that in `AppUpdater.js` during R0's Step 0; **don't set it**.

**4. Release notes for a pending update**
- A "Release notes" button in the available state calls the existing `api.fetchReleaseNotes(next)` and opens the existing What's new modal. That modal doesn't mark anything as seen when opened this way: pass a `mode: "pending"` flag, and Got it closes it without writing `reson8-last-seen-version`.

**5. Keep unchanged:** the Windows signature-verifier override, and `showUpdateError()`'s text with its manual GitHub download hint.

### Verification

- Drive the state machine headlessly by emitting the IPC events from the main process (`--inspect`, `mainWindow.webContents.send(...)`):
  - each phase renders correctly in the modal, the About row and the gear dot;
  - in the ready state nothing restarts until you click.
- The real download and install: the user verifies by hand with the first beta.

### Done When

- [ ] Main sends the richer payloads.
- [ ] One state object with listeners drives the modal, the About row and the gear dot.
- [ ] No auto-restart: Restart now / On next launch.
- [ ] Pending release notes open without marking anything seen.

---

> ### → End of P2: first beta release `3.0.0-beta.1`
>
> **Before bumping:**
> - every P1/P2 item is confirmed by the user;
> - the full test suite passes (server `npm run test`, every client `test:*`, lint);
> - a headless smoke run against a **v2.7.0** server and a **3.0.0-beta.1** server.
>
> **Then:** run `/bump-version 3.0.0-beta.1`, which uses the R0 procedure, and hand the publishing checklist to the user. Stop.

# P3 — Nocturne foundation

## F1 — Tokens

**Phase:** P3 · **Depends on:** — · **Study frames:** all (palette only)

### Design

**Add the Nocturne variables** to `index.html`'s `:root`. Copy them verbatim from `design/_ds/nocturne-*/styles.css` (`:root` block) and the README's token list:
- `--color-bg`, `--color-surface`, `--color-text`, `--color-divider`, `--color-accent`;
- the accent ramp `--color-accent-100…900` and the neutral ramp `--color-neutral-100…900`;
- `--radius-sm/md/lg`, `--space-1…8`, `--shadow-sm/md/lg`.

**Add the status colours** the README lists, as new tokens:
- `--color-success: oklch(0.78 0.14 150)`
- `--color-danger-text: oklch(0.8 0.12 22)`
- `--color-danger-border: oklch(0.55 0.14 22)`
- `--color-live: oklch(0.65 0.2 22)`
- `--color-warning-text: oklch(0.86 0.08 80)`
- `--color-warning-bg: color-mix(in oklch, oklch(0.82 0.1 80) 8%, transparent)`

**Redefine every old variable as an alias**, following the README's mapping table exactly:
- e.g. `--bg-primary: var(--color-bg);`
- `--voice-icon`/`--text-icon` → `var(--color-neutral-400)`
- `--pin-*` retinted from the amber family
- Nothing else changes in this item, so the whole app shifts palette in one step.

**Inventory hard-coded colours (don't fix them yet):**
- `grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(" apps/client/src/renderer/index.html apps/client/src/renderer/renderer.ts apps/client/src/renderer/viewer.html`
- Save the list to `app-planning/phase19-hardcoded-colours.md`, with a count per file. R6 works through it.

**Check Electron 34 / Chromium supports what we use:** `oklch()` and `color-mix()` are supported from Chromium 111. Confirm by rendering a test swatch headlessly.

### Verification

Headless screenshots of the main window (connected and disconnected), the Settings modal and a chat. Compare them side by side with 1a and 4a, for palette only.

### Done When

- [ ] Tokens added.
- [ ] Old names aliased.
- [ ] Colour inventory file written.
- [ ] Screenshots reviewed.

---

## F2 — Fonts and Icons

**Phase:** P3 · **Depends on:** F1 · **Finding:** V24 (Inter comes from the Google Fonts CDN today)

### Design

**Inter.** Vendor the variable WOFF2 into `apps/client/assets/fonts/inter/`:
- Files: `InterVariable.woff2`, `InterVariable-Italic.woff2`, `LICENSE.txt` (OFL), and an `inter.css` with `@font-face` rules using relative URLs.
- Source: the official release at rsms.me / github.com/rsms/inter, at its latest tagged version. Record the version and the SHA-256 of each file in the CSS header.
- In `index.html`:
  - Remove the two `fonts.googleapis.com` `<link>`s.
  - Add `<link href="../../assets/fonts/inter/inter.css" rel="stylesheet">`, after the emoji CSS.
  - Remove `https://fonts.googleapis.com` from `style-src` and `https://fonts.gstatic.com` from `font-src`.
- The `--font` stack stays `'Reson8 Emoji', 'Inter', …`: the emoji family stays first.

**Phosphor.** Vendor the Phosphor web font, **regular + fill weights**, from the `@phosphor-icons/web` npm package's `src/regular` and `src/fill` folders, into `apps/client/assets/icons/phosphor/`:
- Copy the files; **don't** add the package as a dependency. Fetch it with `npm pack @phosphor-icons/web@<exact version>`, extract it into the scratchpad and copy from there.
- Include the MIT `LICENSE`, and record the exact version in a `README.md` in that folder.
- Check that the CSS references its fonts by relative path.
- Usage: `<i class="ph ph-bell-slash" aria-hidden="true"></i>` / `ph-fill`.
- Replace the temporary SVGs from B2, B9 and B10, and the DM tab icon (`@` = `ph-at`), with Phosphor.

**Viewer window.** If the Viewer will use the same icons (C10 adds buttons there), link the same CSS from `viewer.html`. Its CSP is separate (`viewer.html:~7`); give it the same `font-src 'self'`.

**Packaging.** `build.files` already includes `assets/**/*` (V24), so nothing to change there. Verify with a **packaged** build (`npm run test-build:linux`), then launch the AppImage with `--remote-debugging-port` and check `document.fonts.check("12px Inter")` and that a Phosphor glyph renders. This is the incident class from root `AGENTS.md`.

### Pitfalls

- Phosphor's CSS sets `font-family` on `.ph`. Check it doesn't override the emoji font for text.
- Don't vendor the five other weights. Regular + fill is what the study uses.

### Done When

- [ ] Inter vendored, with the CDN links and CSP hosts removed.
- [ ] Phosphor regular + fill vendored, with license and version recorded.
- [ ] The temporary SVGs swapped for Phosphor glyphs.
- [ ] A packaged build checked.

---

## F3 — One Menu Builder

**Phase:** P3 · **Depends on:** F1, F2 · **Study frames:** 6a, 6b, 7a, 8a–8c, 14a

### Design

New section in `renderer.ts`, "Menu builder (PRD 19 F3)":
```ts
type MenuItem =
  | { label: string; icon?: string; onClick: () => void; hint?: string; danger?: boolean; disabled?: boolean }
  | { heading: string }
  | { divider: true }
  | { slider: { label: string; min: number; max: number; step: number; value: number; ticks?: number[]; format?: (v: number) => string;
                onInput: (v: number) => void; onChange: (v: number) => void } };
function openMenu(items: MenuItem[], x: number, y: number, opts?: { anchor?: HTMLElement; returnFocusTo?: HTMLElement }): void;
function closeMenu(): void;
```

**One menu at a time.** `openMenu` calls `closeMenu()` first.

**It closes on:**
- a pointerdown outside it (capture phase, as today);
- `Escape`;
- the window losing focus (`blur`);
- `scroll` of `#channel-tree`, of any `.chat-messages` and of the window (one capture listener);
- `resize`.

**Position.** Measure after rendering, then clamp to the window on all four sides with an 8 px margin. Flip left or up when there's no room.

**The anchor** (the row the menu belongs to) gets the `menu-open` class while the menu is open: that's the accent ring.

**Keyboard:**
- Up and Down move focus between the enabled items; Home and End jump to the ends.
- Enter or Space activates the focused item.
- In a slider, Left and Right adjust the value.
- On close, focus returns to `returnFocusTo`, or else to the anchor.

**Text and accessibility:**
- Every label, hint and heading is set with `textContent`.
- The menu is a `role="menu"`; items are `role="menuitem"`, and headings and dividers are `role="presentation"`.

**Look** (README › Menus):
- Surface `--color-surface`, `--shadow-lg`, 5 px padding.
- Items are 32 px tall with a 15 px icon. Hover uses `--color-accent-900` behind `--color-accent-200` text.
- Section labels: 10.5 px, uppercase. Dividers: 1 px `--color-divider`.
- Danger items: red, placed last.

**Move every existing menu onto it:**
- channel menus (B6);
- tab menus (B5);
- occupant menus (B8's model maps straight onto `MenuItem`s);
- the old `.occupant-ctx-menu` / `.channel-ctx-menu-item` code and CSS are deleted once nothing uses them (check with `grep`).

### Verification

Headless:
- open each menu near every window edge: it's clamped;
- `Esc` closes it; scrolling the tree closes it;
- keyboard-only navigation works;
- the slider persists on release.

Screenshots against 6a, 6b, 7a and 8a.

### Done When

- [ ] Builder written.
- [ ] All three menus migrated.
- [ ] Old menu code removed.
- [ ] Keyboard and clamping work.

---

## F4 — Base Component Styles

**Phase:** P3 · **Depends on:** F1 · **Study frames:** every dialog (6c, 6g, 14b, 14c, 16a)

### Design

Add these CSS classes in `index.html`, all written to the README's visual rules:

**Buttons**
- `.btn`, `.btn-primary` (outlined: 1 px accent border, transparent fill), `.btn-secondary`, `.btn-ghost`, `.btn-icon`, `.btn-danger` (the destructive confirm: a secondary button with red text and a red border).
- Every button gets `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px }`.

**Small components**
- `.tag`
- `.input` (also applied to the existing inputs by selector; check the PRD 16.1 switch-row exception still holds)
- `.count-pill` (16–18 px tall, `--color-accent-800` fill, `--color-accent-200` text, 10.5–11 px, weight 600)
- `.section-label` (11 px, weight 600, 0.08em letter-spacing, uppercase, `--color-neutral-500`)

**Dialogs and toasts**
- `.dialog`: title 18–20 px weight 500, subtitle 13 px `--color-neutral-400`, actions right-aligned.
- `.toast`

**Apply them**
- `.count-pill` → the B1 count pills.
- The new classes → modals and buttons touched by P4. Existing modals keep their ids; R1–R5 restyle the rest.

### Done When

- [ ] Classes added.
- [ ] B1 pills use `.count-pill`.
- [ ] A visual check against 6c (rename dialog) and 14c (delete dialog).

---

# P4 — New surfaces (built directly in Nocturne)

## C1 — Saved Servers, Welcome Screen and Server Rail

**Phase:** P4 · **Depends on:** A2, F1–F4 · **Study frames:** 1a, 2a, 2b · **Confirmed decisions:** Q1 (passwords via `safeStorage` in main), Q7 (cached thumbnail)

### Current Behavior (verified)

- `#toolbar` holds the address, nickname, password and invite inputs, plus Remember.
- One remembered server lives in `reson8-remember-me` / `reson8-server-url` / `reson8-nickname` / `reson8-server-password`, **all plaintext** (`renderer.ts:1376`, `:2244`).
- The app never auto-connects.

### Design

**1. Store `reson8-saved-servers`** (localStorage, every access in try/catch):
```ts
interface SavedServer {
  id: string;            // crypto.randomUUID()
  address: string;       // EXACTLY what the user typed (scheme optional) — see Pitfall 1
  name: string;          // server name from GET_SERVER_SETTINGS, else the host
  nickname: string;
  iconUrl?: string | null;   // the public URL (A2), for the About/settings dialogs
  iconThumb?: string | null; // "data:image/png;base64,…" 80×80, shown in the rail/list (Q7)
  hasPassword?: boolean;     // a password is stored in the main process
  lastConnected: number;     // ms epoch
}
```
- At most 50 entries, sorted by `lastConnected` descending.
- The same address with the same nickname updates the existing entry instead of adding one.

**2. Migration (first run).** If `reson8-remember-me === "true"` and `reson8-server-url` is set:
- create one entry from the old keys;
- move the old password into the main-process store (below);
- then **delete** all four old keys.
- If the secure store isn't available, drop the password and show a one-time toast: "Your saved server password couldn't be stored securely and was removed. You'll be asked for it next time."

**3. Passwords: a main-process module `apps/client/src/saved-passwords.ts`** (MAIN ONLY, like `identity-key.ts`).
- Storage: `<userData>/server-passwords.json` = `{ [savedServerId]: base64(safeStorage.encryptString(pw)) }`, written with mode 0600.
- Availability: `safeStorage.isEncryptionAvailable()` is true **and**, on Linux, `safeStorage.getSelectedStorageBackend() !== "basic_text"` (the same rule as PRD 18.6). If not available, `set` refuses with `{ stored: false }`.
- IPC, every argument validated (`id`: a UUID string; `pw`: a string ≤ 256 chars):
  - `saved-password-set(id, pw) → { stored: boolean }`
  - `saved-password-delete(id) → void`
  - `saved-password-has(id) → boolean`
- **The plaintext never goes back to the renderer.**
  - `preload.ts`'s `connect()` gains an optional `savedServerId`. When the password field is empty and an id is given, the **preload** asks the main process for the password through a separate internal IPC, `saved-password-get-for-connect(id)`. That IPC is only reachable from the main window's own webContents: check `event.sender === mainWindow.webContents`.
  - The preload uses the password for the join and keeps no copy.
  - A **typed** password always wins over a stored one.

**4. Welcome screen (2a, 2b)** replaces `#toolbar` while disconnected.
- **Left:** the connect form. It contains:
  - the address, nickname and optional password inputs, and Remember;
  - the existing hidden `#invite-code` field, **kept inside the form with the same id** so the `error` handler still reveals it.
- **Right:** the saved list. Each row shows the icon thumbnail or the initials on `--color-accent-900`, the name, the address in monospace, the nickname, a relative "last connected" time, and Connect / Edit / Remove.
  - Clicking a row fills the form and connects.
  - Remove deletes the entry and its stored password.
- **Connect** runs the existing `startConnect()` → `resolveConnectionTarget()` chain **unchanged**. Only the source of the values changes.
- **Remember checked** saves or updates the entry on `connected`, not before, so a failed connect doesn't create one.

**5. Rail (1a)** — a 64 px column on the left, top to bottom:
- **Servers** button (shows the tree; see C7);
- **Direct messages** button with its badge (C7). Disabled while disconnected, with the tooltip "Direct messages — connect to a server first";
- a divider;
- the saved servers as 40×40 tiles (`--radius-md`). The active one gets a ring. Hover shows the name;
- **Add a server** (opens the welcome screen's form);
- the **settings gear** at the bottom. It shows the 8 px accent dot from B12 when an update is waiting.

**6. Switching servers** (clicking another tile while connected):
- the full existing disconnect path;
- wait for the `disconnected` event;
- then connect to the chosen entry.
- Tabs, unread counts, mutes and kept tabs are already per server.

**7. Name and icon refresh.** On `connected` and on `server-settings-updated`, write `name` and `iconUrl` into the active entry.
- When `iconUrl` changed, refresh `iconThumb`: fetch the bytes with the existing validated `fetch-image-bytes` IPC (main's `net.fetch` honours the pinned certificates).
- Then `createImageBitmap(new Blob([bytes]))`, draw it into an 80×80 canvas, and call `toDataURL("image/png")`.
- On failure, keep the old thumbnail.
- `iconUrl: null` clears both fields.

### Pitfalls

1. **Identity host.** The identity proof signs the address **as typed, without the scheme** (`identityHostOf()`, PRD 18.3), and `AUTH_ALLOWED_HOSTS` matches on it. Store `address` exactly as typed and connect with exactly that string. Never re-serialize it from a parsed host and port, or bound identities stop matching.
2. Approval (`#approval-screen`), the TLS trust and changed-certificate modals, and the invite flow must keep working. Drive each one headlessly from the new screen.
3. Thumbnails count against the localStorage quota: 50 × ~8 KB is fine. Cap the data URL at 32 KB; if one is larger, store none.

### Verification

- 2a: a fresh profile shows no saved servers.
- 2b: after connecting with Remember, then disconnecting, the server is listed with its icon and connects again from the list.
- Restart with the network unplugged: the icon still shows (it's the thumbnail).
- A password-protected server reconnects without asking (on a desktop with a keyring). On Linux `basic_text`, it asks, and the note is shown.
- The migration from v2.7.0 keys works: those keys are gone from localStorage afterwards.
- The password is never seen in the renderer: search the renderer heap or devtools for the test password string after connecting.

### Done When

- [ ] Store and migration.
- [ ] Main-process password store with validated IPC; the renderer never receives the plaintext.
- [ ] Welcome screen with the invite field preserved.
- [ ] Rail.
- [ ] Server switching.
- [ ] Icon thumbnail refresh.
- [ ] Address stored as typed.

---

## C2 — Title-Bar Server Pill, Switcher and Status Bar

**Phase:** P4 · **Depends on:** C1 · **Study frames:** 1a, 1d

### Design

**Title bar**
- The logo and "Reson8" — no version number.
- A pill that reads "Not connected", or the server name once connected.
- Clicking the pill opens a popover (built with F3's menu builder) listing:
  - the saved servers (icon, name, address; the active one ticked);
  - a divider;
  - "Disconnect", when connected;
  - "Add a server…".
- Find the current title-bar element first (PRD 12's server name in the title bar, `grep -n "title" index.html`) and replace its content rather than adding a second bar.

**Status bar** (28 px, along the bottom)
- A connection dot.
- "Connected as {nickname}".
- The latency. **Reuse the existing 3-second latency poll** (`renderer.ts:~4400`, `api.getLatency()`); don't add a second ping loop. The handoff's "every 15 s" is superseded because a value already exists.
- "Encrypted" when the connection scheme is https (the existing lock indicator state from PRD 18.3), otherwise the existing "Not encrypted" indicator.
- "Client {version}" on the right, from `api.getAppVersion()`.
- The existing `statusInstance` "ID: …" element and its copy button move here unchanged (identity support needs them).

### Done When

- [ ] Pill and switcher work.
- [ ] Status bar shows the existing latency and TLS state with no new polling.
- [ ] The ID copy is preserved.

---

## C3 — Server Header and Dropdown

**Phase:** P4 · **Depends on:** A1, A2, A8, F3 · **Study frames:** 1e

### Design

**What it replaces.** `#tree-header`'s three buttons — `#btn-online-users`, `#btn-server-settings` and `#btn-create-channel` — become:
- the 38×38 server icon (initials on `--color-accent-900` when there's none);
- the name;
- "{host} · {N} online" underneath, where `N` comes from `getOnlineCountForDisplay()` (A1);
- a caret button.

**Caret menu** (F3):
1. About {server}
2. Copy server address — copies `address` as typed; toast "Server address copied"
3. a divider
4. Create channel — only when `hasPerm(PERM.CREATE_CHANNEL)` is true (V25: it's CREATE_CHANNEL, not MANAGE_CHANNELS); when `null`, as today
5. Server settings — shown when the user has **any** of its pages: ADMIN, MANAGE_ROLES, BAN_USER or MANAGE_EMOJIS (decision D3, confirmed). Each page inside stays gated exactly as today.

**Pending approvals.** The badge (`#pending-badge-gear`, PRD 18.8) moves onto the caret and onto the "Server settings" item. Keep the element id, or update `refreshPendingApprovals()` in the same commit.

**Online-users list.** `#btn-online-users` goes away. Its list lives in the DM sidebar (C7). Keep `#online-users-modal` until C7 lands, then remove it.

### Verification

- A member sees only About and Copy address.
- An admin sees everything.
- A BAN_USER moderator sees Server settings and the badge.
- The header count equals About's count after a third user joins (within the 2-second debounce).

### Done When

- [ ] Header built, with the shared online count.
- [ ] Permission-gated menu.
- [ ] Badge moved.

---

## C4 — About {server} Modal

**Phase:** P4 · **Depends on:** A1, A2, C3 · **Study frames:** 16a

### Design

A 560 px read-only dialog, laid out as SPEC §1.4.

**Header**
- The icon or initials, the name, and the address in monospace with a copy button.
- An × at the top right.

**Summary cards** (a three-column grid)
- **Connection:** "Encrypted" or "Not encrypted", from the scheme `resolveConnectionTarget()` chose. Read it through the same state C2 uses.
- **Latency:** new preload method `measureLatency(samples = 3): Promise<number | null>`. It sends `PING_LATENCY` 3 times in sequence (a 3-second timeout each) and returns the median round-trip time.
  - The ↻ button measures again and spins while it does.
  - Bars: < 40 ms = Excellent (4 bars), < 90 = Good (3), < 160 = Slow (2), otherwise 1.
- **People:** "{online} online of {total}", with a thin green bar. Both numbers come from the summary; the online number goes through `getOnlineCountForDisplay()`.

**Admins**
- Chips with an avatar and an online dot.
- Clicking one opens that person's profile card (`openProfileCard(userId)`, PRD 17.3; find the real function name).
- The current user's chip is suffixed "(you)".

**Features**
- Five rows, each showing On or Off: Nudge, Screen sharing, Approval to join, Invite code required, Signed identity required.
- The header reads "{n} of 5 on".
- It updates live from `server-settings-updated`, whose new fields arrive in A1.

**Restricted users can open it** (Q8).

**Old server.** When the summary is `null`, show what `GET_SERVER_SETTINGS` gives (name, Nudge, Screen sharing). Hide the People and Admins sections, and show "Some details need a newer server." The join-gate features show as "Unknown".

All text goes through `textContent`.

### Done When

- [ ] Every section is built.
- [ ] Re-measuring latency works.
- [ ] The count matches the header.
- [ ] The feature list updates live.
- [ ] Old-server fallback.

---

## C5 — Server Icon UI

**Phase:** P4 · **Depends on:** A2, C3 · **Study frames:** 12a–12d

### Design

**Where it lives.** Server settings › General starts with an "Identity" row: a 56 px preview, "Server icon", a note, and Upload / Change / Remove.

**The crop code.** Reuse it by **extracting** a shared `IconCropper` from `showChannelIconModal()` / `applyChannelIconCropTransform()` / `clampChannelIconCropOffsets()` (`renderer.ts:~11329–11460`). The channel-icon dialog must use the extracted cropper in the same commit and behave exactly as before; check it headlessly. Do not fork the code.

**The dialog**
- Drop or choose a file. The client checks it first: type png/jpeg/gif/webp, size ≤ 1 MB, at least 256×256 (read with `createImageBitmap`).
- A square crop with a Zoom slider.
- Previews at 40 px and 24 px.
- The public-link notice box, with the exact copy from SPEC §1.5. Its URL is the resolved URL of the current icon, or "Shown after you save" for a new one.
- "Save icon" stays disabled until a file is chosen.

**Saving**
1. Export the crop to a 512×512 PNG canvas (`toBlob`). If the result is over 1 MB, retry as `image/webp` at quality 0.9.
2. `api.uploadServerIcon(blob)`.
3. `api.updateServerSettings({ iconUploadId })`.
4. If step 3 fails, `discardUpload(uploadId)`.

**Removing** sends `iconUploadId: null`, after a small confirm.

**Without an icon,** every place the server appears shows the initials on `--color-accent-900`. Use one helper, `serverAvatarElement(name, iconUrl | thumb, size)`, everywhere.

### Done When

- [ ] Shared cropper (the channel-icon dialog is unchanged).
- [ ] Upload, replace and remove work.
- [ ] Public-link notice.
- [ ] Initials fallback everywhere.

---

## C6 — Category Context Menu and Dialogs

**Phase:** P4 · **Depends on:** A6, A8, F3, F4 · **Study frames:** 14a–14d

### Design

**Menu.** Attached in `renderCategory()` (`:2666`), only when `hasPerm(PERM.MANAGE_CHANNELS)` is true (when `null`, as today: nothing). Items: the "Manage category" label, Rename category…, a divider, Delete category….

**Rename dialog (14b, 400 px)**
- Title and subtitle as in SPEC §3.3.
- The input is pre-selected and limited to 32 characters. Check the server's own name limit in `UPDATE_CHANNEL`; if the server allows less, use the server's value.
- Inline errors:
  - empty → "Give the category a name.";
  - a duplicate among **categories**, i.e. nodes with children, compared case-insensitively → "Another category is already called that.".
- Enter saves, Esc cancels. Rename is disabled while there's an error or the name is unchanged.
- Saving calls `UPDATE_CHANNEL { channelId, name }`.
- The collapsed state survives: the tree update rebuilds the tree, so check the existing collapsed-state store keeps the category's collapse.

**Delete dialog (14c/14d, 460 px)**
- Title: "Delete {name}?"
- Counts of text and voice descendants. Use the same descendant set as A6's `delete` mode, recomputed from `currentTree`.
- Two radio cards:
  - **Keep the channels** — the default, with an accent ring;
  - **Delete the channels too** — red ring.
- The amber line about people in voice, when any of its voice descendants has occupants. It's recomputed live on `presence` events while the dialog is open.
- An empty category gets the "nothing else changes" text.
- The confirm label: "Delete category", or "Delete category and {n} channels".
- Sends `DELETE_CHANNEL { channelId, children: "keep" | "delete" }`.
- **Old server:** the ack has no `deletedChannelIds`. You can't detect support before sending, so on a v2.7.0 server **hide the "Delete the channels too" option**. Detect a v2.7.0 server by A1's summary being `null`, and say so in a short note in the dialog.

**Side effects** come from the server events: tabs close, voice is left, and the voice room tab (C9) closes when your room was among the deleted channels.

### Done When

- [ ] Menu gated.
- [ ] Rename with validation.
- [ ] Delete with both branches and live counts.
- [ ] Old-server guard.

---

## C7 — DM Sidebar

**Phase:** P4 · **Depends on:** A7, B1, B4, C1 · **Study frames:** 1c, 9a, 9b

### Design

**Switching the sidebar**
- The rail's DM button swaps what `#left-pane` shows: the channel tree **or** `#dm-list`.
- **Hide the other; never destroy it.** Toggle a class on the container so the tree's DOM and its collapsed state survive.
- The main area doesn't change. The Servers button swaps back.

**Header:** "Direct messages", then "On {server name}" with a server glyph and the tooltip from SPEC §5. No compose button.

**Data**
- `api.getDmDirectory()` on connect, and again on `user-joined`/`user-left` (debounced 2 s).
- Kept current live:
  - `dm-received` updates the last message and the count;
  - `presence`/`user-joined`/`user-left` update online status.
- On an old server, the A7 fallback, with its note.

**Groups**
- "Online — {n}" and "Offline — {n}", each with the note from SPEC §5.
- Inside each group: people you've already messaged first (newest first), then everyone else in alphabetical order. Implement this as one pure renderer function, `sortDmDirectory(entries)`.

**Rows**
- Avatar (`createAvatarElement`), nickname, then either:
  - the last-message preview: `api.markdownToPlainText(text)`, truncated to 80 characters, prefixed "You: " when `fromMe`, or "Image" when there's no text but there are attachments; or
  - the italic "No messages yet — start a conversation".
- The count pill from B1's `unreadDmCounts`.
- The nudge button (`buildNudgeButton()`/`canNudge()`, unchanged).

**Click** → `openDmTab(userId, nickname, { mode: "preview", focus: true })` (B4).

**Rail badge** = the sum of `unreadDmCounts`, excluding the conversation you're reading right now (active tab + focused window).

**When it isn't available**
- Not connected: the DM button is disabled.
- Restricted user: the DM button is disabled with the access text (`requireServerAccess()`), because `GET_DM_DIRECTORY` is `"member"`.

**Removing the old modal.** `#online-users-modal` and its button are removed in this item. Grep for every use first; the profile card's "Message" button uses `openDmTab` directly.

### Done When

- [ ] Sidebar swap keeps the tree's state.
- [ ] Every member is listed and grouped and sorted.
- [ ] Previews and the "No messages yet" text.
- [ ] Counts on the row, the background tab and the rail.
- [ ] Nudge kept.
- [ ] Old-server fallback.
- [ ] Old modal removed.

---

## C8 — Tab Bar Overflow

**Phase:** P4 · **Depends on:** B4, B5, F3 · **Study frames:** 13a, 13b · **Finding:** V26 (there's no "+" button, so there's nothing to remove)

### Design

**Measuring**
- A `ResizeObserver` on `#tab-bar` (and on the window).
- Measure each tab's real `offsetWidth` and cache it in a `WeakMap<HTMLElement, number>`.
- The cache is invalidated when a label, mode or badge changes. Hook this into `refreshTabUnread`, `renderTabMode` and the rename path.

**Fitting**
- Compute how many tabs fit, keeping room for the "{n} more ▾" button.
- The **active tab always stays visible**: if it would overflow, it swaps places **visually** with the last tab that fits. Use CSS `order`, not DOM moves, so the order stored in `reson8-kept-tabs` is untouched.
- Hidden tabs get `display: none`. They are **not** detached: their `.tab-content` and scroll keeper stay untouched.

**The overflow button**
- Shows a 7 px accent dot when any hidden tab is unread and not muted.
- Opens a 260 px dropdown headed "Open tabs that don't fit". Each row: icon, label, a pin if kept, the count, and × if closable.
- Build it with F3's builder, extended with an optional trailing action, or as its own small popover. Either way, labels go through `textContent`.

**No layout loop.** Measure inside the `ResizeObserver` callback and change only `display`/`order`. Never change widths there.

### Done When

- [ ] Overflow works with real widths.
- [ ] The active tab is always visible.
- [ ] Unread dot on the button.
- [ ] The list opens and closes tabs.
- [ ] No layout thrash: check with the CDP Performance domain, or count callback runs while resizing.

---

## C9 — Voice Room Tab: People

**Phase:** P4 · **Depends on:** B8, B9, F3 · **Study frames:** 1f, 11a, 11b, 11d, 13a

### Design

**A separate object.** `voiceTab: { tabEl, contentEl, layout: "mosaic" | "featured" } | null`, **not** a `ChatTab`, so the chat-only machinery (scroll keeper, sentinels) never applies. There is at most one. It's never a preview tab and never replaced. Its tab id is `voice-room`.

**Opening.** It opens from:
- a new "Expand voice room" button in the voice dock (`#voice-panel`), with that text as its tooltip;
- a click on a voice channel row **while you're in that channel**.

Clicking a voice row joins voice as today. Whether it opens the tab is SPEC §4: "clicking a voice channel in the tree" opens it. Join-then-open is the default.

**Closing**
- Its × closes the tab only. **It never leaves voice.**
- Leaving voice, being kicked, or the channel being deleted closes it.
- When it was active, switch to the first text tab, or Server Log if there's none.

**Header:** the room name, "{n} / {cap}" (`maxUsers`, or just "{n}" when it's unlimited), and a Mosaic | Featured toggle.

**Mosaic**
- Every person gets a tile.
- Tiles fit the area at 4:3. Compute the column count that maximises the tile size, recompute in a `ResizeObserver`, and never scroll.
- Small tiles get the class `.tile-sm`: a smaller name and no volume readout.

**Featured**
- Five tiles, then a "…and {n} more" block.
- The block opens a popover listing the rest: avatar, name, marks. Right-clicking a row there opens B8's menu.

**Remembering the layout.** The choice is saved in `reson8-voice-layout`. It's forced to Featured while anyone shares, and that forced value is **not** saved (C10).

**Tiles**
- Avatar with a green speaking ring, the name ("(you)" for yourself), the mic-muted icon, and B9's local marks.
- Right-click opens B8's menu, via `buildOccupantMenuModel` → `openMenu`.

**Live updates**
- `active-speakers` only toggles a class on existing tiles (`[data-user-id]`). Never rebuild tiles for it.
- `presence` for this channel does a keyed add/remove of tiles.

### Done When

- [ ] One voice tab, with the open and close rules.
- [ ] Mosaic fits 16 people with no scroll.
- [ ] Featured with the "more" popover.
- [ ] Layout remembered.
- [ ] Class-only speaking updates.
- [ ] Shared menu on tiles.

---

## C10 — In-App Stream Stage With an Optional Pop-Out

**Phase:** P4 · **Depends on:** C9, A4 · **Study frames:** 1b, 10a, 11d · **Confirmed decision:** Q3 (a viewer socket opened by the main preload) · **Owner decision (handoff):** each window has its own copy, one at a time; a short reconnect is acceptable.

### Current Behavior (verified — V27, V28)

**The Viewer window today**
- It runs its own `role: "viewer"` socket, authenticated with a ticket that the main socket requested (`REQUEST_VIEWER_TICKET`). `main.ts` keeps the ticket per `webContents.id`.
- That socket then runs `WATCH_SCREEN_SHARE`, opens its own recv transport, consumes and resumes.
- It ends with `STOP_WATCHING_SCREEN_SHARE`. Closing the window disconnects the socket, and the server cleans up.

**Why the main socket can't do this.** A primary socket must **never** call WATCH or STOP_WATCHING. On a v2.7.0 server it would break the user's voice session (V27).

**What main.ts lacks.** Nothing records which Viewer window shows which share.

### Design

**1. Extract the recv pipeline** from `preload-viewer.ts` into a shared module, `apps/client/src/screen-watch.ts`:
```ts
export interface WatchHandle { videoEl: HTMLVideoElement; audioEl: HTMLAudioElement | null; streamName: string; close(): Promise<void>; setVolume(pct: number): void }
export async function startScreenWatch(opts: { serverBaseUrl: string; tlsOptions?: …; ticket: string; targetUserId: string; channelId: string;
    onEnded: (reason: string) => void }): Promise<WatchHandle>
```
- It does everything the Viewer does today: the socket with `query: { role: "viewer" }` and the same TLS options; `VIEWER_AUTHENTICATE { ticket }`; `WATCH_SCREEN_SHARE`; a `Device` loaded with the returned capabilities; the recv transport; consuming video (and audio, if any); resuming.
- It creates the `<video>` element itself, and the `<audio>` element with `document.createElement("audio")`, appended to `document.body` (root `AGENTS.md` rule).
- `close()` sends `STOP_WATCHING_SCREEN_SHARE`, closes the consumers and the transport, disconnects the socket, and removes the media elements.
- `preload-viewer.ts` is rewritten to use this module **with no behaviour change**. Verify the Viewer window headlessly before going on.

**2. The main preload owns the stage watch.** `MediaStream` and DOM nodes can't cross `contextBridge`, so the preload attaches the video into a container that the renderer names by id, exactly as `preload-viewer.ts` does with `#video-container`.
- `api.stage.watch(targetUserId, channelId, containerId): Promise<{ success: boolean; streamName?: string; error?: string }>`
  1. requests a fresh viewer ticket itself (the existing `requestViewerTicket()`; the ticket never reaches the renderer);
  2. passes the TLS options and the pin the main socket used;
  3. starts the watch and appends the `videoEl` into `document.getElementById(containerId)`.
- `api.stage.stop(): Promise<void>`
- `api.stage.setVolume(pct)`
- `api.stage.onEnded(cb)`

**3. One state machine** in the renderer: `stageWatch: "idle" | "stage" | "popping" | "popped" | "returning"`, plus the target `{ userId, channelId, nickname }`. Clicks are ignored while it's `popping` or `returning`.

**4. Pop out**
1. `stage → popping`.
2. `await api.stage.stop()`.
3. Open the Viewer with the existing `api.openScreenShareViewer(...)`. It now returns `{ success, windowId }` (see 6).
4. `popping → popped`.
5. The stage shows the placeholder, top-left aligned: "{sharer}'s stream is in its own window", with **Bring it back** and **Show window**.

**5. Bring back**
1. `popped → returning`.
2. `api.closeViewerWindow(windowId)`.
3. Wait for the `viewer-closed` event for that window. The Viewer's own close already disconnects its socket, and the server cleans up its session.
4. `await api.stage.watch(...)`, then `returning → stage`.

The same thing happens when the user closes the Viewer with its own × or Return. On `viewer-closed` while the state is `popped`, the stream returns to the stage automatically.

**6. `main.ts` changes** (all IPC arguments validated):
- `open-screen-share-viewer` returns `{ success: true, windowId: viewerWindow.id }` and records `viewerWindows: Map<number, { targetUserId, channelId }>`.
- On the window's `closed`, it sends `viewer-closed { windowId }` to the main window.
- New IPCs:
  - `viewer-focus(windowId)` → `show()`, `focus()`, `flashFrame(true)`;
  - `viewer-close(windowId)` → `close()`.

  Both accept only ids in the map.
- From the Viewer window, `event.sender`-based:
  - `viewer-set-always-on-top(flag: boolean)` → `win.setAlwaysOnTop(flag, "floating")`;
  - `viewer-return` → close the window, then `showMainWindow()`.
- The window title becomes "{sharer} · {stream name} — {room}". The room name is passed as a new argument, **not** a secret, so it may go through `additionalArguments`.

**7. Viewer window additions** (`viewer.html` / `viewer.ts` / `preload-viewer.ts`):
- An "Always on top" toggle, on by default, remembered in `reson8-viewer-on-top` (the Viewer's localStorage, in try/catch). Applied on load through the IPC.
- Volume 0–200 %.
- Fullscreen: the existing native `setFullScreen` path (PRD 12.13).
- A "Return to Reson8" button.

**8. Sharer side.** In the sharer's `VIEWER_JOINED_YOUR_STREAM` / `VIEWER_LEFT_YOUR_STREAM` handlers, debounce the sounds:
- a leave followed by a join within 3 s plays neither sound;
- client-side only; the server is unchanged.

**9. Stage UI (1b)**
- The stream fills the stage, with a LIVE badge, the quality (from the track settings' height, e.g. "1080p"), and the sharer + title.
- Top right: a volume control, Pop out, and Fullscreen.
- Fullscreen: `requestFullscreen()` on the stage container. The `"fullscreen"` permission is already granted to the main window (PRD 18.19). Verify on Windows and on Wayland: `nextsteps.txt` lists it as untested.
- People appear as a strip under the stage: two full tiles plus the aggregator block.
- Mosaic is disabled while anyone shares: greyed at 0.4 opacity, a not-allowed cursor, and the tooltip from SPEC §6.2. The layout is forced to Featured; the user's own choice returns when the last stream ends.

**10. Where a watch can start**
- The stage watches **by default** when someone in your room shares and the voice tab is open. The existing LIVE-badge click opens the stage instead of the Viewer. Its confirm prompt stays.
- `requireServerAccess()` guards every start.

**11. Teardown.** All of these stop the stage watch and close any popped Viewer:
- losing access (`applyAccessState(false)`);
- leaving voice or switching rooms;
- the sharer stopping (`PRODUCER_CLOSED` for their screen producer, or their `isSharingScreen` turning false);
- disconnecting.

### Pitfalls

- **Never two consumers at once.** Every transition waits for the previous side to close. Check the server log's consumer creation and close, or `chrome://webrtc-internals`.
- Each stage watch uses a **new** ticket. Check `viewer-ticket.service.ts` for single-use or TTL behaviour and don't reuse a ticket.
- The preload must remove its `videoEl` when the container is destroyed, e.g. when the voice tab is closed. Expose `api.stage.stop()` and call it from the tab close path.

### Done When

- [ ] Shared module, with the Viewer unchanged in behaviour.
- [ ] Preload stage API (the ticket never reaches the renderer).
- [ ] State machine.
- [ ] Pop out, bring back, and closing the Viewer returns the stream.
- [ ] Always-on-top, title, Return.
- [ ] Sharer sound debounce.
- [ ] Forced Featured layout.
- [ ] Every teardown path.
- [ ] No moment where both windows consume.

---

## C11 — Multiple Streams: Focus and Grid

**Phase:** P4 · **Depends on:** A4, C10 · **Study frames:** 15d, 15e · **Finding:** V29 (L1T3 has one spatial layer; the server alone picks layers)

### Design

**Step 0 — measure before building live previews.** With 3 and 5 sharers, take one viewer client (one watch socket per stream) and record its CPU % and inbound kbit/s:
- (a) every stream at full quality;
- (b) the main stream full, the others paused through `consumer.pause()` on the client.

Record the numbers and show them to the user, then **stop and wait**: decision D2 says live previews are decided only after this measurement.

**Default build** (no server change):
- **Focus:** the main stream uses one `startScreenWatch` (C10). The "Also live · {n}" column (212 px) shows **static LIVE cards**: the sharer's avatar, the stream name and a LIVE dot, with no video. Clicking a card swaps it into the main slot: stop the current watch, then start the new one, with the same sequencing as C10.
- **Grid:** every stream at the same 16:9 size, each with its own watch, fitted to the area. Double-click or the ⤢ button focuses one.

**Optional live previews** (only if the user says yes after seeing the measurement — D2):
- A new **viewer-socket** event, `SET_CONSUMER_LAYERS { consumerId, temporalLayer: 0 | 1 | 2 }`. The server validates that the consumer belongs to this socket's own session, then calls `consumer.setPreferredLayers({ spatialLayer: 0, temporalLayer })`. Add it to shared-types and to `EVENT_ACCESS` as `"member"`.
- Previews run at temporal layer 0 (about ¼ of the frame rate). Swapping raises one stream and lowers the other, without closing either.
- On an old server (an unknown event), fall back to static cards.

**People** collapse to a row of 44 px chips (avatar, name, mute and sharing icons) when the strip's tiles would be shorter than 90 px.

**Header:** "{n} / 5 sharing", plus a Focus | Grid toggle. The people toggle stays forced to Featured.

**Popping out one stream** follows C10, for that stream only.

### Done When

- [ ] Measurement recorded.
- [ ] Focus works with static cards (live previews only if the user approves them after the measurement).
- [ ] Grid, with double-click to focus.
- [ ] Chips layout.
- [ ] Per-stream pop-out.

---

## C12 — Update Corner Card

**Phase:** P4 · **Depends on:** B12, F4 · **Study frames:** 4g, 15a, 15b, 15c

### Design

**A 360 px card, not a modal.** It sits in the bottom-right corner above the status bar, with an accent edge and a soft glow. It subscribes to B12's `updateState`.

| Phase | What the card shows |
| --- | --- |
| available | "Reson8 {next} is available", a one-line summary, "You have {v}." Buttons: What's new (ghost, opens the pending notes from B12), Later, **Update** |
| downloading | "Downloading Reson8 {next}…", "You can keep chatting. We'll ask before restarting.", a progress bar with a %. Button: Hide |
| ready | "Ready to restart". Buttons: On next launch, **Restart now** |

**In a call** (`isInVoice`): an amber box saying "Restarting drops you from **{room}** for a few seconds." The room name is set with `textContent` inside a `<strong>`. The icon aligns with the first line.

**Dismissing.** × and Later only hide the card. The About row (SPEC §8.1 table, driven by the same state) and the gear dot keep showing the state.

**Errors** still use `showUpdateError()`'s text, inside the card.

**Retire `#update-modal`** in this item, after a grep shows nothing else uses it. **`#version-mismatch-modal` stays.**

**What's new restyle (15c).** `#whats-new-modal` gets the 600 px layout:
- a header with a radial accent wash, the logo, a kicker and the date;
- the "View on GitHub" link.

It has three variants:

| Variant | Kicker | Button | Marks the version seen? |
| --- | --- | --- | --- |
| Launch | "Updated · you're on the new version" | Got it | Yes |
| From About | "Release notes" | Close | No |
| Pending update | "Available update" | Close | No |

### Done When

- [ ] Card shows all three phases.
- [ ] In-call note.
- [ ] Dismissing keeps the state elsewhere.
- [ ] Update modal retired.
- [ ] About row table complete.
- [ ] What's new has its three variants.

> ### → End of P4: second beta release `3.0.0-beta.2`
>
> Same gate as beta.1: every item confirmed, the full test suite, and smoke runs against a v2.7.0 server and a beta server.
>
> Then run `/bump-version 3.0.0-beta.2` and hand over the publishing checklist.

# P5 — Restyle of the remaining screens (§R)

These are visual-only items. Each one is checked against its study frame.

**Rules that apply to all of them:**
- No behaviour change.
- Keep every element id the code queries. If one has to change, update every query in the same commit; `grep -n "getElementById(\"<id>\")"` finds them.
- Use only the F1 tokens and the F4 components.
- Icons are Phosphor.

**The routine for every R item:**
1. Screenshot every state the item lists, before and after the change.
2. Compare each with its frame.
3. Check the light details: focus rings, hover states, disabled states.

## R1 — Connect States

**Frames:** 2a, 2b, 3a (connection failed, with Try again and an editable address), 3b (password required).

**Screens:** the TLS trust modal (`#tls-trust-modal`), the changed-certificate modal (`#tls-changed-modal`), the approval screen (`#approval-screen`) and the invite field.

**Check:** drive the TLS trust, approval and invite flows headlessly. They must behave exactly as before.

## R2 — Chat

**Frames:** 1a, 3c (the NSFW prompt).

**Covers:** the message list, the hover toolbar, replies, the pinned bar (retinted `--pin-*`), link-preview cards (blur overlays included), the lightbox and the composer.

**Check:** run `npm run test:markdown` (rendering must be unchanged). Then look at grouped messages, a reply, a pinned bar and a blurred preview.

## R3 — Client Settings

**Frames:** 4a–4h, every page.

**Check:**
- Settings keeps a fixed height across pages (PRD 14.9).
- The switch-row exception (PRD 16.1) still holds.
- The modals that open from inside Settings stay above it: check with `elementFromPoint`.

## R4 — Server Settings (left-nav restructure)

**Frames:** 5a–5f.

**The new layout:** `#admin-modal` becomes a left-nav dialog with these pages:
- General (C5's Identity row on top, then Messages and Features)
- Members
- Joining & invites
- Bans
- Sign-in security
- Identity log
- Emoji

**Where today's content goes:**

| Today | New page |
| --- | --- |
| `roles` tab | Members |
| `emojis` tab | Emoji |
| `server` tab, general settings | General |
| `server` tab, sign-in settings (signed identity, allowed hosts) | Sign-in security |
| User Management sub-sections: pending approvals and invites | Joining & invites |
| User Management sub-sections: bans and address bans | Bans |
| User Management sub-section: identity log | Identity log |

**Which pages each person sees** — exactly as today's per-tab rules:
- `isAdminUser` / `canBanUsers` / `canManageEmojis`;
- or `hasPerm()` once the server provides permissions.

**Step 0:** list every id inside `#admin-modal` and the Settings User Management tab that `renderer.ts` queries (`grep -o 'getElementById("[^"]*")'`, filtered to those subtrees). That list is the checklist for this item.

## R5 — Dialogs

**Frames:**

| Frame | Dialog |
| --- | --- |
| 1k–1m | the share picker (`openScreenShareModal()`, `promptForStreamName()`) |
| 1g/1h | create channel |
| 1j | the profile card |
| 1i | search — **not built** (see below) |

**Search:** verified — v2.7.0 has no message search (the only search box is the emoji picker's `#emoji-search`). R5 does **not** build it (D10).

**Also restyle:** the rename, move, delete and channel-icon dialogs (6c–6g), onto `.dialog`.

## R6 — Hard-Coded Colours and Alias Removal

**Steps:**
1. Work through `app-planning/phase19-hardcoded-colours.md` (from F1), replacing each colour with a token.
2. Then grep for every old alias: `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--bg-input`, `--text-primary`, `--text-secondary`, `--text-muted`, `--accent`, `--accent-hover`, `--accent-dim`, `--border`, `--success`, `--danger`, `--warning`, `--radius`, `--voice-icon`, `--text-icon`.
3. When there are no uses left, delete the aliases.
4. Delete the inventory file in the same commit.

**Check:** take a full screenshot pass again (every TEST_STATES frame that's reachable headlessly).

> ### → End of P5: third beta release `3.0.0-beta.3`
>
> **Gate:** everything in `TEST_STATES.md` checked, or marked "user to verify by hand" with the reason.
>
> **Then:**
> - run `/bump-version 3.0.0-beta.3`;
> - update the three `AGENTS.md` files (the `CLAUDE.md` files only import them) and the `README.md` with the new UI architecture: the menu builder, the voice tab, the stage, saved servers and tokens;
> - condense progress.txt's ongoing log into a Phase 19 summary block, following the established pattern.
>
> Moving this PRD to `archive/` and merging to `main` are the user's call.

---

## Cross-Cutting Dependencies & Implementation Order

```
R0 beta pipeline ─────────────────────────────────────────────► every bump (end of P2 / P4 / P5)

P1:  A1 summary ──► A2 icon (iconUrl in summary)
     A1 ──► A7 DM directory (member/access rules)
     A3 timer helper ──► A6 category delete (uses presencePayload / the map)
     A4 share cap ──► A9 screen-share switch at PRODUCE/CONSUME
     A2 sniffer ──► A10 validate every upload
     A5 unread counts, A8 own permissions   (independent)

P2:  A5 ──► B1 counts ──► B2 muted ──► B3 read rule
     B4 DM preview/kept ──► B5 tab menu
     A8 ──► B6 menu permissions;  A8 ──► B8 occupant menu ──► B9 marks
     A6 ──► B7 voice delete text;  A3 ──► B10;  B11 (independent);  R0 ──► B12

P3:  F1 tokens ──► F2 fonts/icons ──► F3 menu builder (moves B5/B6/B8 menus) ;  F1 ──► F4 components

P4:  A2+F* ──► C1 saved servers/rail ──► C2 pill/status bar
     A1+A2+A8 ──► C3 header ──► C4 About ;  A2+C3 ──► C5 icon UI
     A6+A8 ──► C6 category dialogs ;  A7+B1+B4+C1 ──► C7 DM sidebar
     B4+B5 ──► C8 overflow ;  B8+B9 ──► C9 voice tab ──► C10 stage ──► C11 multi-stream (+A4)
     B12 ──► C12 update card

P5:  R1 … R6 (after all of P4)
```

**Order within each phase** follows the numbering: R0 → A1 … A10 → B1 … B12 → F1 … F4 → C1 … C12 → R1 … R6. Each item ends with `/log-progress`, a local commit, and a stop for the user's go-ahead.

**Shared-types touchpoints.** All of them are additive and optional:

| Item | Change |
| --- | --- |
| A1 | `IServerSummary`, `GET_SERVER_SUMMARY`; `SERVER_SETTINGS_UPDATED` gains `requireApproval`/`requireInvite`/`requireSignedIdentity` |
| A2 | `iconUrl` on settings, the broadcast and the summary; `UPDATE_SERVER_SETTINGS.iconUploadId` |
| A3 | `IChannelTreeNode.sessionStartedAt` |
| A4 | `MAX_SCREEN_SHARES_PER_ROOM`; `errorCode` on the PRODUCE and SET_SCREEN_SHARE_STATE acks |
| A5 | `IChannelTreeNode.unreadCount` |
| A6 | `DELETE_CHANNEL.children`, ack `deletedChannelIds` |
| A7 | `IDmDirectoryEntry`, `GET_DM_DIRECTORY` |
| A8 | join ack `permissions`, `PERMISSIONS_CHANGED` |
| A9 | `errorCode` values `SCREEN_SHARE_DISABLED` / `NOT_WATCHING` on the PRODUCE and CONSUME acks |
| C11 (only if approved after the measurement — D2) | `SET_CONSUMER_LAYERS` |

**Migrations** (each verified on a throwaway database): only **A2**, which adds `servers.iconUrl` and `iconPublicId`, plus the `StoredFileKind.SERVER_ICON` enum value.

**New server files:**
- `services/server-summary.ts`
- `services/image-sniff.ts`
- `services/channel-lock.ts`
- `services/unread.service.ts`
- `services/channel-delete.ts`
- `config/screen-share.config.ts` (A9)
- one test file for each of the above, plus `voice-session.test.ts`, `permissions-changed.test.ts`, a screen-consume decision test (A9) and `upload-validate.test.ts` (A10)

**New client files:**
- `app-version.ts` (+ `test:version`)
- `saved-passwords.ts` (main process only)
- `screen-watch.ts`
- `assets/fonts/inter/`
- `assets/icons/phosphor/`

**New `localStorage` keys** (`reson8-*`):
- `reson8-saved-servers`
- `reson8-voice-layout`
- `reson8-viewer-on-top`

**Keys removed after migration** (C1): `reson8-remember-me`, `reson8-server-url`, `reson8-nickname`, `reson8-server-password`.

---

## Compatibility Summary

(For the beta release notes.)

**3.0.0-beta client → v2.7.0 server: works, with less information.** Gaps on the old server:

| Area | What's missing on a v2.7.0 server |
| --- | --- |
| About | Shows name and the two toggles only: no admins, no member count |
| Unread counts | Shown as dots |
| Session timers | Appear only after the first presence change |
| Category delete | No "delete the channels too" option |
| DM list | Online people and past conversations only (with a note) |
| Permissions-based menus | Fall back to today's behaviour |
| Screen-share cap | Not enforced |
| Server icon | None |

**v2.7.0 client → 3.0.0-beta server: works unchanged.** Every new field is optional and every new event is opt-in. Two differences, both on the server side:
- A deleted voice room now disconnects its occupants server-side (D6).
- A 6th screen share is refused (the old client shows the error text).
- With sharing switched off, screen media can't be produced or consumed at all; the v2.7.0 Viewer is unaffected while sharing is on (A9).
- Uploads whose bytes don't match their declared image type are refused (A10). The official v2.7.0 client sends real images, so it's only affected by mismatched clipboard/paste sources.

**Beta and stable update lines are separated** by GitHub's pre-release flag and the `beta*.yml` files (R0):
- Beta testers move to newer betas.
- Stable users never see them.
- When 3.0.0 final ships, beta testers move to it too: electron-updater accepts a stable tag from the beta channel.

**Privacy improvements:**
- Inter no longer loads from Google Fonts (F2).
- Saved server passwords leave plaintext localStorage (C1).

---

## Pre-Existing Issues Noticed During the Audit

None of these are fixed silently. Each is either assigned to an item or left for your decision.

**P1. Uploads trust the client's MIME type and file extension** (`upload.route.ts:167`, `saveLocally`).
- Because of this, a crafted request can store, say, `x.html` declared as `image/png` under the public `/uploads/`. It would then be served as `text/html` from the server's origin.
- **Assigned to A10** (decision D9): every route validates the real bytes and stores the sniffed extension.

**P2. `PRODUCE` doesn't check the server-wide screen-share toggle**, and `CONSUME` accepts any producer in the router (`voice.handler.ts:234`, `:337`).
- So the toggle is enforced only at `WATCH_SCREEN_SHARE`. A modified client in the room could produce, or consume a screen producer directly, while sharing is disabled.
- **Assigned to A9** (decision D7).

**P3. `CREATE_WEBRTC_TRANSPORT` creates a router for any `channelId` in the payload** (`voice.handler.ts:107`). It doesn't check that it equals `socket.data.currentChannelId`. A member could make the server create mediasoup routers for arbitrary ids, a resource cost. Not assigned; worth its own small fix.

**P4. The occupant menu's Kick is gated on MANAGE_ROLES instead of KICK_USER.** Fixed in B8.

**P5. Kick and access-change presence broadcasts drop `sessionStartedAt`.** Fixed in A3.

**P6. Deleting a voice room never tears down its sessions server-side.** Fixed in A6 (D6).

**P7. Children re-parented by a parent delete keep stale positions.** Fixed for categories in A6's `keep` mode; the legacy default is unchanged.

**P8. `compareVersions()` returns NaN on prerelease versions.** Fixed in R0.

**P9. `GET_ONLINE_USERS` runs one query per user (N+1).** Not assigned; A7 replaces its main use.

**P10. Saved server password stored in plaintext localStorage.** Fixed in C1.

**P11. A failed `USER_JOIN_SERVER` leaves the socket signed in** (`connection.handler.ts`, found during A1 on 13/10/2026). `socket.data.userId`/`serverId` are set before the role upsert; when that step throws (for example an unseeded database), the ack is `{ success: false }` but the packet gate lets the socket call every event it allows for a signed-in user. Only reachable when a join fails on a database error.
- **TO-DO, not assigned yet:** clear `userId`, `serverId` and the other join-derived `socket.data` fields on any failed join (or set them only after the last fallible step), and add a test that a failed join leaves the socket default-denied. Decide the item at the next planning pass.

---

## Open Decisions

### Confirmed with the user while drafting (13/10/2026)

1. **Q1 — C1, remembered passwords:** stored with `safeStorage` through a main-process module. The renderer never receives them. On Linux `basic_text` they aren't remembered, and the user sees a note.
2. **Q2 — A1/C4, counts:**
   - Total = `user_servers` members holding CONNECT or ADMIN, not banned.
   - Online = distinct present userIds within that set.
   - One install counts as one person (documented).
   - The header and About share one number.
3. **Q3 — C10/C11, watch path:** a viewer-role socket opened by the main preload, one per watched stream. The main socket never calls WATCH or STOP_WATCHING.
4. **Q4 — beta cadence:**
   - `3.0.0-beta.1` after P2;
   - `3.0.0-beta.2` after P4;
   - `3.0.0-beta.3` after P5.
5. **Q5 — incoming DM without a tab:** opens as a **kept tab in the background**, with no focus change. The connect-time unread auto-open does the same.
6. **Q6 — A2, icon validation:** a pure-TS magic-byte and dimension sniffer, with no new server dependency. The client re-encodes a square PNG.
7. **Q7 — saved-server icon offline:** an 80×80 thumbnail data URL cached in the saved entry.
8. **Q8 — restricted users:** About is open to them (`GET_SERVER_SUMMARY` = `"open"`). The DM directory is not (`"member"`).

### Answered by the user after the first draft (13/10/2026) — every recommendation accepted

**D1 — B3 channel read rule.** Should a channel count as read only when its tab is active **and the window is focused**, like DMs (PRD 18.13)? Today, opening it is enough, and messages arriving on the active tab while the window is in the background are never counted.
→ **yes:** one rule for channels and DMs, and the counts become trustworthy.

**D2 — C11 live previews.** VP9 L1T3 has only one spatial layer, so previews can only drop to about ¼ of the frame rate, and that needs a new server event.
→ ship static LIVE cards first. Show the user the CPU and bandwidth measurement from C11's Step 0, then decide on `SET_CONSUMER_LAYERS`.

**D3 — C3 "Server settings" visibility.** SPEC says "admin only", but moderators with BAN_USER, MANAGE_ROLES or MANAGE_EMOJIS reach their pages (approvals, bans, emoji) through Settings today.
→ show the item to anyone who has at least one of its pages, each page gated as today. Otherwise moderators lose access to the approval queue.

**D4 — A7, who the DM directory lists.** Users without access (Member removed) can't receive DMs.
→ don't list them, even when you have history with them; an already-open tab keeps working

**D5 — A3 timer persistence.** Keep the start times in memory (a server restart resets running timers to the restart time) or move them to Redis?
→ **memory:** the server is a single process, presence survives restarts only partially anyway, and Redis adds a key lifecycle to keep correct.

**D6 — A6 server-side voice teardown on *every* voice-channel delete,** not only category deletes. It's a behaviour change: today each client leaves on its own.
→ **yes:** a modified or crashed client otherwise keeps a mediasoup session for a channel that no longer exists.

**D7 — P2, enforce the screen-share toggle at `PRODUCE`/`CONSUME`?**
→ **yes — added as item A9** in P1, right after A4.

**D8 — Release notes per beta.** Should each `v3.0.0-beta.N.md` list only what changed since the previous beta, or everything since 2.7.0?
→ only the changes since the previous beta, plus one line linking the earlier beta notes. The final 3.0.0 notes, written later on `main`, collect everything.

**D9 — P1, sniff every upload?** Should A2's sniffer also validate the chat-attachment, emoji and channel-icon routes, and name stored files by the sniffed type?
→ **yes — added as item A10** in P1, after A2. It changes those routes' behaviour (a file whose bytes don't match its declared type is refused), so it has its own item and tests.

**D10 — Search (frame 1i).** Verified: v2.7.0 has no message search (only `#emoji-search` in the emoji picker), so R5 will **not** build one. Search would be a new feature, with server work and its own PRD item.
→ confirmed, it's out of scope for Phase 19.
