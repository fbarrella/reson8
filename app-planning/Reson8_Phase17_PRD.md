# Reson8 — Phase 17 PRD

**Created:** 07/10/2026
**Author:** Felipe B. Netto (assisted by AI)
**Status:** Draft — Pending Review
**Source:** `app-planning/nextsteps.txt` (11 items) + the reference screenshot `app-planning/print_chat_avatar.png` + one security fix found during the audit and added at the user's request (PRD 17.12)
**Branch:** `phase17-go`

---

## Table of Contents

1. [PRD 17.1 — Feat: Avatars via Libravatar / Gravatar (Profile Settings + Server Storage)](#prd-171--feat-avatars-via-libravatar--gravatar-profile-settings--server-storage)
2. [PRD 17.2 — Feat: Avatars Next to Nicknames in Text Chats](#prd-172--feat-avatars-next-to-nicknames-in-text-chats)
3. [PRD 17.3 — Feat: User Profile Card (Click a Nickname or Avatar)](#prd-173--feat-user-profile-card-click-a-nickname-or-avatar)
4. [PRD 17.4 — Chore: Microphone Volume up to 300%](#prd-174--chore-microphone-volume-up-to-300)
5. [PRD 17.5 — Feat: Preview Tabs and "Keep Tab Open" for Text Channels](#prd-175--feat-preview-tabs-and-keep-tab-open-for-text-channels)
6. [PRD 17.6 — Feat: Unread Indicator on Unfocused Channel Tabs](#prd-176--feat-unread-indicator-on-unfocused-channel-tabs)
7. [PRD 17.7 — Chore: Collapse Only Messages Longer Than ~15 Lines](#prd-177--chore-collapse-only-messages-longer-than-15-lines)
8. [PRD 17.8 — Fix: Pinned-Message Jump with Paginated History (Two-Way Pagination)](#prd-178--fix-pinned-message-jump-with-paginated-history-two-way-pagination)
9. [PRD 17.9 — Feat: Social-Media Link "Fixers" for Rich Previews](#prd-179--feat-social-media-link-fixers-for-rich-previews)
10. [PRD 17.10 — Fix: Keep Whitespace-Only Lines as Blank Lines in Markdown](#prd-1710--fix-keep-whitespace-only-lines-as-blank-lines-in-markdown)
11. [PRD 17.11 — Chore: Emoji Autocomplete in the Message Edit Box](#prd-1711--chore-emoji-autocomplete-in-the-message-edit-box)
12. [PRD 17.12 — Security Fix: Cryptographic Identity (Stop Instance-ID Impersonation)](#prd-1712--security-fix-cryptographic-identity-stop-instance-id-impersonation)
13. [Cross-Cutting Dependencies & Recommended Implementation Order](#cross-cutting-dependencies--recommended-implementation-order)
14. [Open Decisions Confirmed With the User](#open-decisions-confirmed-with-the-user)
15. [Pre-Existing Issues Noticed During the Audit](#pre-existing-issues-noticed-during-the-audit)
16. [Mapping to `nextsteps.txt`](#mapping-to-nextstepstxt)

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
> (SemVer: this phase adds user-facing features, two additive DB migrations,
> additive wire-format fields/events and a security fix whose strict mode is
> opt-in, all backward compatible with v2.5.0 clients/servers, so a **minor** bump to `2.6.0` is expected, pending the skill's
> own check), write the release notes into `app-planning/releases/`, and update all
> three `CLAUDE.md` files plus `README.md` to reflect the final Phase 17 feature set.
>
> **Non-regression rule:** no item may change behavior outside its stated scope.
> Each item's "Regression Risk" section lists exactly what it touches. Verification
> for every item always includes `npx tsc --noEmit`/`--build` in each affected
> workspace (shared-types → server → client, in that order), `npm run test` for
> server items, and `npm run test:markdown` (in `apps/client`) for any item that
> touches message rendering. Where an item changes real UI behavior, Claude also
> drives the built app headlessly (the Phase 16 recipe in `apps/client/CLAUDE.md`:
> Xvfb + `--user-data-dir` + DevTools protocol, screenshots inspected) before
> handing it to the user for hand-testing.

> [!NOTE]
> This PRD was written after reading every `nextsteps.txt` item and the reference
> screenshot, and auditing the code each item touches: `renderer.ts`, `index.html`,
> `preload.ts`, `main.ts`, `markdown.ts`, `voice.service.ts`, `connection.handler.ts`,
> `message.handler.ts`, `dm.handler.ts`, `nudge.handler.ts`, `schema.prisma`,
> `instance-id.ts`, `preload-viewer.ts`, and the
> shared-types event maps/models. Several external facts were **verified live on
> 07/10/2026** rather than assumed (Libravatar/Gravatar URL formats, every fixer
> service's response to our User-Agent, and that the fixers' video URLs really serve
> `video/mp4`) — see each item. File paths and line numbers reflect the code as of
> 07/10/2026 (branch `phase17-go`, post-Phase-16, v2.5.0). They *will* drift between
> items that edit the same regions of `renderer.ts`; re-check before editing.
> Eight design decisions were resolved directly with the user (see
> [Open Decisions](#open-decisions-confirmed-with-the-user)); the remaining
> reasonable-default assumptions are listed there too. Flag anything you'd rather
> change before implementation starts.

> [!NOTE]
> **Archiving:** every completed PRD (phases 1–16) was already in
> `app-planning/archive/` when this phase started (`Reson8_Phase16_PRD.md` was
> archived by the v2.5.0 release commit `701a249`), so no archive move was needed.
> This file lives at `app-planning/Reson8_Phase17_PRD.md` while active and gets
> moved to `archive/` when Phase 17 wraps up.

---

## PRD 17.1 — Feat: Avatars via Libravatar / Gravatar (Profile Settings + Server Storage)

**Type:** ✨ FEATURE
**Priority:** High (17.2 and 17.3 build on it)
**Affected Components:** shared-types (models + events), server (Prisma migration, new pure `avatar.service.ts`, `connection.handler.ts`, a new `profile.handler.ts`), client (`preload.ts`, a new pure `avatar.ts`, `renderer.ts`, `index.html`).

### Current Behavior

There are no avatars anywhere. Users are identified by nickname only. `User` (`schema.prisma`) has `id`, `username`, `nickname`, `password`, `createdAt`, `updatedAt`.

### Goal

Each user can choose an avatar hosted on **Libravatar** (default) or **Gravatar**, identified by an email address the user types in Settings. The client turns the email into the provider's avatar URL; the **server stores the latest avatar URL per user** so everyone else can show it, even when that user is offline. Users who never set one get a deterministic random "wavatar" from Libravatar.

### How the Providers Work (verified live, 07/10/2026)

Both providers identify an avatar by the **SHA-256 hex digest of the trimmed, lower-cased email**:

| Purpose | URL | Live result |
|:---|:---|:---|
| Libravatar (user's own) | `https://seccdn.libravatar.org/avatar/<sha256(email)>?d=wavatar` | `302` → the image (falls back to a wavatar if the email has no avatar) |
| Gravatar (user's own) | `https://gravatar.com/avatar/<sha256(email)>?d=wavatar` | `200 image/png` |
| Default (no email set) | `https://seccdn.libravatar.org/gravatarproxy/<sha256(userId)>?s=80&default=wavatar` | `200 image/png`, deterministic per id |

- **Default avatar uses `sha256(userId)`, not the raw user id** (user decision). In this app `userId` **is** the `instanceId` (`connection.handler.ts:~306` upserts `User.id = instanceId`), i.e. the user's identity credential. Sending it raw to a third party would put every user's credential in Libravatar's logs. The hash gives the same "random but stable per user" result and leaks nothing. (Once 17.12 lands the id is no longer a credential, but hashing still keeps a stable cross-server identifier out of a third party's logs, so it stays.)
- Size is controlled by the `s` query parameter (1–512). The stored URL has **no** size; the client appends `&s=<px>` for the size it renders (2× the CSS size for HiDPI).
- Only `https://seccdn.libravatar.org` (Libravatar's secure CDN) is used. Libravatar's per-domain federation (DNS SRV lookup) is out of scope.

### Privacy Rules (built into the design)

1. **The email never leaves the device.** The client hashes it locally; only `{ provider, hash }` is sent to the Reson8 server. The email itself is kept in `localStorage` only so the Settings field can show it again.
2. **The server never accepts a URL from a client** (the same rule the upload ledger follows, root `CLAUDE.md` "Uploads"). It receives `{ provider, hash }`, validates both strictly, and builds the URL itself from a fixed template. A modified client therefore cannot make every other client load an image from a host of its choosing (an IP-logging tracking pixel).
3. **Opt-out (user decision):** a per-user switch, *"Load avatars from Libravatar/Gravatar"* (default **on**). When off, no avatar request ever leaves the client: every avatar renders as a colored initials circle instead. This keeps the README's "no third-party servers" promise available to anyone who wants it; the README wording is adjusted in the close-out.

### Wire Format (shared-types first; all additive)

`packages/shared-types/src/models.ts`:
```ts
export type AvatarProvider = "libravatar" | "gravatar";
/** What a client sends: never a URL (PRD 17.1). `hash` = sha256 hex of the trimmed, lower-cased email. */
export interface IAvatarSelection { provider: AvatarProvider; hash: string; }
```
`IUser` gains `avatarUrl?: string | null`.

`socket-events.ts`:
- `USER_JOIN_SERVER` payload gains `avatar?: IAvatarSelection | null`.
  - **absent** (`undefined`, i.e. a v2.5.0 client) → leave the stored avatar untouched;
  - `null` → clear it (user removed their email);
  - an object → validate and store.
  This is the "check once at login" from `nextsteps.txt`: every (re)join refreshes the stored URL.
- New C2S `SET_AVATAR: (payload: { avatar: IAvatarSelection | null }, ack: (r: { success: boolean; avatarUrl?: string | null; error?: string }) => void)` — the "warn the server to update" when the user changes their settings while connected.
- New S2C `USER_AVATAR_UPDATED: (payload: { userId: string; avatarUrl: string | null }) => void`, broadcast to `server:<serverId>`.

### Server

1. **Migration** `<timestamp>_add_user_avatar_url`: `ALTER TABLE "users" ADD COLUMN "avatarUrl" TEXT;` (nullable, no backfill: `NULL` means "use the default"). Generate it with the `prisma migrate diff` recipe from `apps/server/CLAUDE.md`, verify on a scratch database, never `migrate dev` against the dev DB.
2. **New pure module `src/services/avatar.service.ts`** (no Prisma/Fastify imports, like `reply.service.ts`):
   - `parseAvatarSelection(input: unknown): { ok: true; value: IAvatarSelection | null } | { ok: false; error: string }` — `provider` must be exactly `"libravatar"` or `"gravatar"`; `hash` must match `/^[0-9a-f]{64}$/`; anything else (extra keys are ignored, wrong types, a URL) is refused.
   - `buildAvatarUrl(sel: IAvatarSelection): string` — the two fixed templates above.
   - Unit tests in `src/__tests__/avatar.service.test.ts`: both providers, uppercase hex refused, 63/65-char hash refused, URL-in-hash refused, `null` accepted, unknown provider refused.
3. **`USER_JOIN_SERVER`** (`connection.handler.ts:~278`): when `payload.avatar !== undefined` and it parses, include `avatarUrl` in both the `update` and `create` branches of the existing `user.upsert`. An invalid selection is ignored with a server log line; it **never** fails the join.
4. **New `src/handlers/profile.handler.ts`** (registered in `index.ts` next to the others), holding `SET_AVATAR` now and `GET_USER_PROFILE` in 17.3:
   - Refuse unless the socket has joined a server (`socket.data.serverId` set) and is not a viewer socket (`socket.data.role === "viewer"` is refused).
   - Parse → `prisma.user.update({ where: { id: socket.data.userId }, data: { avatarUrl } })`.
   - Light rate limit: in-memory, 2 s minimum between updates per user (same pattern as the nudge cooldown in `nudge.handler.ts`).
   - Broadcast `USER_AVATAR_UPDATED` only if the URL actually changed. Ack with the new `avatarUrl`.

### Client

1. **New pure module `apps/client/src/avatar.ts`** (no Electron/DOM imports, like `markdown.ts`), imported by `preload.ts`:
   - `normalizeEmail(email)` → `trim().toLowerCase()`.
   - `hashEmail(email)` / `sha256Hex(text)` via Node's `crypto.createHash("sha256")` (the preload has Node; the renderer is a plain script).
   - `buildAvatarUrl(sel)` — mirrors the server's templates (used for the live preview only; the URL that *other* clients see always comes from the server).
   - `defaultAvatarUrl(userId)` → the `gravatarproxy` URL with `sha256(userId)`.
   - `withAvatarSize(url, px)` — sets/replaces `s=` with `URL`/`URLSearchParams` (never string concatenation).
   - Exposed through `reson8Api` as `avatar.*` helpers. A smoke script `scripts/avatar-smoke.mjs` (`npm run test:avatar`) checks known hashes (`test@example.com` → `973dfe46…`, the value used in the live probe) and the URL builders.
2. **Preferences** (`localStorage`, every access in `try/catch`, `reson8-*` namespace):
   - `reson8-avatar-provider` = `"libravatar"` (default) | `"gravatar"`
   - `reson8-avatar-email` = the email as typed (only to refill the field)
   - `reson8-avatars-external` = `"false"` disables external avatars (absent = on)
3. **Joining:** the renderer hands the current selection (or `null`) to the preload via a new `api.setAvatarSelection(sel)` *before* connecting, and the preload includes it in every `USER_JOIN_SERVER` it emits, including the automatic re-join after a Socket.io reconnect.
4. **Settings → Application → new "Profile" section, placed first** (the tab is reachable while disconnected, so the profile can be set up before connecting). Layout:
   ```
   PROFILE
   ┌──────────┐  Avatar source   [ Libravatar | Gravatar ]      ← segmented control
   │  avatar  │  Email           [ you@example.com        ]
   │  96 px   │  ⓘ Create a free account at libravatar.org with this email and
   └──────────┘    upload your picture there. Your email never leaves this
                   computer: only an anonymous hash of it is shared.
                  [ Remove ]                          [ Save avatar ]
   ( ) Load avatars from Libravatar/Gravatar   ← toggle row, existing .toggle-row markup
   ```
   - The info line's provider name and link follow the segmented control (`libravatar.org` / `gravatar.com`); links open in the system browser through the existing validated `open-external-url` IPC.
   - **Live preview:** as the user types a syntactically valid email (debounced 400 ms), the preview loads the provider URL with `d=404` instead of `d=wavatar`. If it loads, show *"Avatar found ✓"*; if it 404s, show the wavatar that will actually be used and the hint *"No picture on Libravatar for this email yet — you'll get a generated one. Changes can take a few minutes to appear."* An empty field previews the default avatar. An invalid email shows an inline error and disables Save.
   - **Save** stores the preferences and, if connected, calls `SET_AVATAR` with a 5 s timeout (`socket.timeout(5000).emit(...)`, the `getUploadToken()` pattern). Toast on success. On timeout: *"This server doesn't support avatars yet — it needs Reson8 2.6.0."* The preference is still saved locally and sent on the next join to an updated server.
   - **Remove** clears the email and sends `avatar: null`.
   - Save/Remove are disabled while nothing changed.
5. **Avatar rendering helper** (used by 17.2/17.3, built here so this item can show the user's own avatar in Settings):
   - `avatarUrlCache: Map<string, string | null>` (userId → stored URL; `null` = default), fed by every DTO that carries `avatarUrl` and by `USER_AVATAR_UPDATED`.
   - `createAvatarElement(userId, nickname, cssPx)` returns a `<span class="avatar">` holding an `<img width height loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false" alt="">` with `data-avatar-user-id`. Fallback chain on `error`: stored URL → default URL → initials (first letter(s) of the nickname on a background color derived from a hash of the userId, so it is stable and the same everywhere). With external avatars off, it goes straight to initials and sets no `src` at all.
   - `refreshAvatars(userId?)` re-applies the chain to every `[data-avatar-user-id]` element (all of them when the opt-out toggles).
   - Fixed `width`/`height` attributes so an avatar never causes layout shift (this matters for the chat's scroll anchoring, see 17.8).
6. **`USER_AVATAR_UPDATED`** → update the cache → `refreshAvatars(userId)`.

### Edge Cases

- **Old server (v2.5.0):** ignores the extra join field; `SET_AVATAR` times out (handled above); every user shows the default avatar. Nothing breaks.
- **Old client (v2.5.0) on a new server:** never sends `avatar`, so the stored value stays as it was; it ignores the new fields and event.
- **Dev mode** regenerates the instance id every launch, so the default avatar changes per launch in dev. Expected; packaged builds keep it.
- **Gravatar 'd' param on a hash with an avatar:** ignored by the provider, as intended.
- **Offline/blocked CDN:** the fallback chain ends at initials, never a broken-image icon.

### Regression Risk

Additive column and fields. `USER_JOIN_SERVER` gains one optional field and the upsert gets one extra optional column; the join's success/failure paths are unchanged (an invalid avatar never fails a join). No existing UI changes except the new Settings section.

### Verification

- `npx tsc --build` shared-types → `npx tsc --noEmit` server → `npx tsc --noEmit` client; `npm run test` (server, incl. the new `avatar.service` tests); `npm run test:avatar` (client).
- Migration applied to a scratch DB with the `apps/server/CLAUDE.md` recipe, then `prisma migrate deploy` on a fresh scratch DB; dropped afterwards.
- Real server booted with explicit `DATABASE_URL`/`REDIS_URL`/`PORT`: join with an avatar → row updated; `SET_AVATAR` with a URL in `hash` → refused; valid update → broadcast received by a second socket.
- **Manual (user):**
  1. Settings → Application → Profile while disconnected: type your email → preview shows your Libravatar picture (or the generated one + hint); switch to Gravatar → preview follows.
  2. Save, connect → (verified in 17.2 once avatars show in chat) other clients receive the URL.
  3. Turn "Load avatars from Libravatar/Gravatar" off → the preview becomes an initials circle.
  4. Remove → the preview returns to the default wavatar.

---

## PRD 17.2 — Feat: Avatars Next to Nicknames in Text Chats

**Type:** ✨ FEATURE
**Priority:** High
**Depends on:** 17.1
**Affected Components:** shared-types (`IMessage`, `IDirectMessage`), server (`message.handler.ts`, `dm.handler.ts` includes/DTOs), client (`renderer.ts` message shell, `index.html` CSS).

### Current Behavior

Every message is built by `buildMessageShell()` (`renderer.ts:~4560`) as `.chat-msg` > `.msg-header` (nick + HH:MM) + `.msg-body`. Continuations (`.msg-continuation`, PRD 16.6) hide the header. There is no left gutter.

### Goal (per `print_chat_avatar.png`)

Discord-style: a **round avatar in a left gutter**, top-aligned with the group's header line; the name + time sit to its right, and the text column starts under the name. **Continuation messages show no avatar** but keep the same indent, so a group reads as one block:

```
 (av)  barrella  21:32
       This is my first message
       This is my second message
       This is my third message
```

This applies to **channel and DM messages** (both use `buildMessageShell()`).

### Data (additive wire fields)

- `IMessage` gains `avatarUrl?: string | null`; `IDirectMessage` gains `senderAvatarUrl?: string | null`.
- Server: add `avatarUrl: true` to the `user` select in `messageInclude` (`message.handler.ts:55`) and to the DM sender select in `dm.handler.ts`; map it in `toMessageDto()` and the DM DTO builder. Every path that returns messages (send echo, fetch latest/`before`/`around`, edit broadcast) goes through those builders, so they all carry it. The value is the author's **current** avatar (not a snapshot), so a changed avatar updates history too, as in Discord.
- The client feeds each received `avatarUrl` into `avatarUrlCache` (17.1). A field that is `undefined` (old server) leaves the cache alone, so the default avatar is used.

### DOM & CSS

- `buildMessageShell()` takes `avatarUrl` and inserts `createAvatarElement(ownerId, nickname, 40)` as the **first child of `.msg-header`**, absolutely positioned into the gutter. Anchoring it to the header (not to `.chat-msg`) keeps it aligned with the name line even when a reply snippet (PRD 16.11) sits above the header.
- CSS (tokens in `index.html`):
  - `--msg-gutter: 56px` → `.chat-msg { padding-left: var(--msg-gutter) }` (the existing `margin: 0 -6px` hover-tint trick stays; the gutter is inside the tint).
  - `.msg-header { position: relative }`, `.msg-header .avatar { position: absolute; left: calc(-1 * var(--msg-gutter) + 6px); top: 2px; width: 40px; height: 40px; border-radius: 50% }`.
  - `.chat-msg.msg-group-start { min-height: 44px }` so a one-line group never lets the avatar overlap the next row.
  - `.chat-msg.msg-continuation .avatar` needs no rule: the whole header is already `display: none`.
- **Continuation time on hover (polish, matches the reference app):** a continuation shows its HH:MM, muted and small, in the gutter while hovered (`.msg-continuation:hover::before { content: attr(data-hhmm) }`, `data-hhmm` set by `buildMessageShell()`). Today a continuation's time is not visible at all.
- Nothing else moves: date dividers and the "Unread Messages" separator are not `.chat-msg`, so they stay full-width; the floating toolbar is anchored to the right; attachments, link previews, the reaction strip and "See more" all live in the content column and simply shift right with it.
- Live updates: `USER_AVATAR_UPDATED` → `refreshAvatars(userId)` updates every rendered message of that user.

### Grouping

`applyGrouping()`/`regroupFrom()` are **not** changed: the avatar lives inside the header, so it appears/disappears exactly when the header does. The rule "anything that adds/removes `.chat-msg` must call them" still holds.

### Regression Risk

Purely visual plus one optional field per DTO. Touches `buildMessageShell()` and the message CSS block. Everything that measures messages (scroll anchoring on prepend, `stickToBottom`, truncation) keeps working because the avatar has a fixed size and the text column only gets narrower; truncation is re-checked in 17.7 anyway.

### Verification

- Typecheck all three workspaces; `npm run test` (server); `npm run test:markdown`.
- Headless run: a channel with a 3-message group, a reply, an image message, a link preview, a solo-emoji message, and a DM conversation; screenshots compared against `print_chat_avatar.png`.
- **Manual (user):** groups look like the reference; avatars in DMs; changing your avatar in Settings updates all your rendered messages live on another client; turning external avatars off shows initials everywhere; scroll up through history (prepend) and confirm no jumpiness.

---

## PRD 17.3 — Feat: User Profile Card (Click a Nickname or Avatar)

**Type:** ✨ FEATURE
**Priority:** Medium
**Depends on:** 17.1, 17.2
**Affected Components:** shared-types, server (`profile.handler.ts`), client (`renderer.ts`, `index.html`).

### Current Behavior

The only way to act on a user (DM, Nudge) is the Online Users modal (`createUserRow()`, `renderer.ts:~5562`). Nicknames in chat are plain text.

### Goal

Clicking a user's **avatar or nickname** in any chat message (channel or DM) opens a profile card with: a larger avatar, the nickname, the **first-login date**, the user's **roles**, **online/offline** status, and shortcuts **Message** (open DM) and **Nudge**, plus a close button.

### "First login" — already stored, no migration needed

`User.createdAt` (`@default(now())`) is written exactly once, when `USER_JOIN_SERVER`'s upsert first **creates** the row, i.e. at the user's first ever login, and the upsert's `update` branch never touches it. This has been true since Phase 4 for every user, so the data already exists for everyone; `nextsteps.txt`'s fallback ("start storing it if we don't have it") is not needed. The card labels it **"Member since"**.

### Wire Format

- `models.ts`:
  ```ts
  export interface IUserProfile {
      userId: string;
      nickname: string;
      avatarUrl: string | null;
      /** ISO; User.createdAt = first login (PRD 17.3). */
      memberSince: string;
      /** This server's roles, highest powerLevel first. */
      roles: { id: string; name: string; color: string | null; powerLevel: number }[];
      isOnline: boolean;
  }
  ```
- New C2S `GET_USER_PROFILE: (payload: { userId: string }, ack: (r: { success: boolean; profile?: IUserProfile; error?: string }) => void)`.

### Server (`profile.handler.ts`)

- Same guards as `SET_AVATAR` (joined, not a viewer). No permission flag: everything on the card is already visible to members (roles drive what people can do; presence is shown in the Online Users modal).
- One `user.findUnique` with `roles: { where: { role: { serverId } }, include: { role: true } }` (shape per the actual `UserRole` relation in `schema.prisma`), `isOnline` from `presence.getOnlineUsers(serverId)` (Redis, never Postgres, per `apps/server/CLAUDE.md`). Unknown user → `{ success: false, error: "User not found" }`.

### Client

1. **Triggers:** `.msg-header .avatar` and `.msg-nick` get `role="button"`, `tabindex="0"`, `cursor: pointer` and a hover underline on the nick. One **delegated** `click` + `keydown` (Enter/Space) listener on `tabContentArea` opens the card for `closest(".chat-msg")`'s `data-msg-owner`. Reply snippets keep their existing "jump to original" click.
2. **Card** (`#user-profile-modal`, the existing modal backdrop pattern; ~340 px wide):
   ```
   ┌──────────────────────────────────────┐
   │▓▓▓▓▓▓▓▓▓▓ accent banner ▓▓▓▓▓▓▓▓▓▓ ✕ │
   │  ╭──────╮                             │
   │  │avatar│● online dot                 │
   │  ╰──────╯ 96px                        │
   │  barrella                             │  ← nickname, 18px semibold
   │  Member since 12 March 2026 · 7 months ago
   │  ROLES   [● Admin] [● Member]         │  ← chips, dot in role.color
   │  STATUS  ● Online                     │
   │  [ ✉ Message ]   [ 👋 Nudge ]          │
   └──────────────────────────────────────┘
   ```
   - Dates via `Intl.DateTimeFormat(undefined, { dateStyle: "long" })` + `Intl.RelativeTimeFormat` ("7 months ago"); full timestamp in a `title` tooltip.
   - Role chips: a dot in `role.color` (neutral token when `null`), text in the normal text color for contrast.
   - **Message:** closes the card and calls `openDmTab(userId, nickname)` (DMs work for offline users; the server only requires that the recipient exists).
   - **Nudge:** shown only when the target is online, is not you, and `serverNudgeEnabled` is true, exactly the Online Users rules. Its button logic (cooldown countdown, `lastNudgeSentAt`) is **extracted** from `createUserRow()` into a shared `buildNudgeButton(userId, nickname)` used by both places, so the cooldown is shared and the Online Users modal behaves exactly as before.
   - **Your own card:** no actions; instead a small *"Edit profile"* link that opens Settings → Application.
   - Closes on ✕, Escape, or a backdrop click. Focus moves into the card on open and back to the trigger on close (`aria-modal`, `role="dialog"`, labelled by the nickname).
3. **Loading:** the card opens **immediately** with what the message already knows (nickname, avatar) and skeleton rows for the rest, then fills in when the ack arrives. A per-open request id discards stale answers if the user opens another card quickly. Errors show *"Couldn't load this profile"* with Retry. A 5 s timeout against an old server shows *"Profile details need a newer server"* and keeps the Message button working.
4. **Live while open:** `USER_AVATAR_UPDATED` refreshes the avatar (17.1's helper does it for free); `USER_JOINED`/`USER_LEFT` for that user flip the status and show/hide Nudge.

### Regression Risk

New modal and event, plus the Nudge-button extraction (the one refactor of existing code; it must keep the Online Users modal pixel-identical and behavior-identical). The new click target on `.msg-nick` must not interfere with text selection or the floating toolbar.

### Verification

- Typecheck all workspaces; `npm run test`.
- Real server: `GET_USER_PROFILE` for an online user, an offline user, an unknown id, and from a viewer socket (refused).
- **Manual (user):** open the card from a channel message, a DM, and a continuation's group header; Message opens/focuses the DM; Nudge works and its cooldown is shared with the Online Users modal; your own card shows "Edit profile"; keyboard (Tab to a nick, Enter, Escape).

---

## PRD 17.4 — Chore: Microphone Volume up to 300%

**Type:** 🧹 CHORE
**Priority:** Low
**Affected Components:** client only: `index.html`, `renderer.ts`, `voice.service.ts`.

### Current Behavior

`#mic-volume-slider` is `min=0 max=200 step=5` (`index.html:~4525`); `VoiceService.setMicVolume()` clamps to 0–200 (`voice.service.ts:~1188`); the renderer loads `reson8-mic-volume` from `localStorage` without clamping (`renderer.ts:~1247`). The value drives `volumeGainNode.gain` in the send-side graph `micSource → [noiseCancel] → gateGain → volumeGain → destination` (self-hear taps post-volume).

### Goal

Allow up to **300%**.

### Design

1. Slider `max="300"`; `setMicVolume()` clamps to 0–300; the renderer clamps the stored value on load (`Number.isFinite`, 0–300, default 100) so a corrupt key can't produce a NaN gain.
2. **Clipping protection (best practice for >2× digital gain):** at 3× gain a normal speaking voice easily exceeds full scale, and Opus would receive hard-clipped samples (harsh distortion). Add a **soft clipper** right after `volumeGainNode`: a `WaveShaperNode` whose curve is **exactly linear up to |x| = 0.8** and bends smoothly (tanh-shaped knee) toward ±1.0 above that, `oversample = "2x"`.
   - Its `curve` is `null` (a true pass-through) whenever `micVolume ≤ 100%`, so behavior at or below 100% is **bit-identical** to today; it engages only when the user boosts.
   - A waveshaper adds no look-ahead latency (unlike a `DynamicsCompressorNode`, which adds ~6 ms), which matters for voice.
   - Wiring: `gateGain → volumeGain → softClip → destination`; the self-hear monitor (`setSelfHearEnabled()`) must tap **post-clipper** so the user hears exactly what is sent. This lives in the shared `buildProcessingChain()` so preview mode and a real call stay identical (`apps/client/CLAUDE.md`).
3. Description text: *"Scales your outgoing mic signal — 100% is your unprocessed input level. Above 100%, loud peaks are softly limited instead of distorting."*

### Regression Risk

The send-side graph gets one extra node that is a pass-through at ≤100%. The level meter's tap point is unchanged (post-noise-cancel, pre-gate). Noise gate, noise cancelling and self-hear are untouched apart from self-hear's tap moving one node later.

### Verification

- `npx tsc --noEmit` (client).
- Headless: build the chain in preview mode with an `OscillatorNode` source at known amplitude; read an analyser after the clipper: unity at 100%, ×3 up to the knee at 300%, never above 1.0.
- **Manual (user):** slider reaches 300%; at 300% your voice is louder but not crackly (use Hear Yourself); at 100% nothing changed.

---

## PRD 17.5 — Feat: Preview Tabs and "Keep Tab Open" for Text Channels

**Type:** ✨ FEATURE
**Priority:** High
**Affected Components:** client only: `renderer.ts` (tab management, tree context menu), `index.html` (tab CSS, a tab context menu).

### Current Behavior

`handleChannelClick()` → `openChatTab()` (`renderer.ts:~3911`) opens a **new tab for every channel clicked**; tabs pile up until closed one by one with ✕. All tabs close on disconnect (`renderer.ts:~3088`). There is no tab context menu.

### Goal (VS Code "preview tab" model, adapted)

- Clicking a text channel opens it in **the preview tab**. There is **at most one** preview tab: clicking another channel **replaces** it, in the same position in the tab bar.
- A tab can be **kept open**: right-click the tab (or the channel in the tree) → **"Keep Tab Open"**. A kept tab is never replaced.
- Double-click has **no** special meaning (unlike VS Code; explicitly requested).
- **DM tabs and the Server Log tab are unaffected.** Only text-channel tabs have preview/kept behavior.
- **Kept tabs are remembered (user decision):** per server, across reconnects and restarts.

### Wording & Visuals

- Menu items: **"Keep Tab Open"** / **"Stop Keeping Open"** (user decision; avoids "pin", which already means pinned messages).
- **Preview tab:** title in *italics* (the VS Code convention people already recognize) and a tooltip: *"Preview — opening another channel replaces this tab. Right-click → Keep Tab Open to keep it."*
- **Kept tab:** upright title and a small **bookmark** SVG icon (Lucide `bookmark`, 12 px, accent color) before the name; tooltip *"Kept open"*. (Not the pushpin: that icon already means "pinned message" in this app.)
- Tab markup becomes structured so the title can be updated without losing icons: `<span class="tab-icon">💬</span><span class="tab-kept-icon">svg</span><span class="tab-label">name</span><span class="tab-unread-dot"></span><span class="tab-close">✕</span>`. `syncOpenTabNames()` (`renderer.ts:~3203`, which currently rewrites `innerHTML`) is changed to update only `.tab-label`'s `textContent`.

### Behavior Spec

`ChatTab` gains `kind: "channel" | "dm"` and, for channels, `mode: "preview" | "kept"`. A module-level `previewTabId: string | null` tracks the single preview tab.

1. **Opening a channel** (`openChatTab(channelId, name, opts?)`, used by the tree click and the NSFW confirm):
   - Tab already open (preview or kept) → just `switchTab()`; its mode does not change.
   - Otherwise, if a preview tab exists → **replace it**: build the new tab, `insertBefore` the old tab's element, then dispose of the old one with `closeTab(oldId, { reason: "replaced" })` (no switch to Server Log in between, so there is no flicker), and focus the new one. The new tab is the preview tab.
   - Otherwise → append a new preview tab.
2. **Keep Tab Open** — offered in a new **tab context menu** (right-click on a channel tab; same `.occupant-ctx-menu` styling as the tree menu) and in the **tree context menu** for text channels (next to Mute, `attachChannelContextMenu()` `renderer.ts:~2001`):
   - On the preview tab → becomes kept in place; `previewTabId = null`.
   - From the tree, for a channel with no tab → opens it directly as a **kept** tab and focuses it (the preview tab, if any, is left alone).
3. **Stop Keeping Open** → the tab becomes the preview tab. Only one preview tab may exist, so if another preview tab is already open, **the one the user is currently looking at survives** and the other is closed. (Unkeeping a background tab while viewing the preview tab therefore closes the unkept tab; unkeeping the active tab closes the old background preview tab.)
4. **✕ on a kept tab** closes it and removes it from the remembered list. ✕ on the preview tab closes it (`previewTabId = null`).
5. **Persistence:** `localStorage` `reson8-kept-tabs` = `{ [serverId]: channelId[] }` (ordered as in the tab bar), same shape and `try/catch` discipline as `reson8-muted-channels` (PRD 16.4).
   - Written on keep/unkeep/✕ and on reordering only (there's no tab reordering today).
   - **Restore:** after the first `CHANNEL_TREE_UPDATE` of a connection, kept channels that still exist as text channels are reopened in order as kept tabs **without stealing focus**, and missing ones are pruned from the store.
   - History of a restored tab loads **lazily** on its first activation (`switchTab()` calls `loadChatHistory()` if `!tab.loaded`), so a user with many kept tabs doesn't fire N history fetches at connect. Unread indicators (17.6) don't need history, so they still work immediately.
   - A restored NSFW tab does **not** prompt: keeping it open was a deliberate choice after the original confirmation.
   - Disconnect still closes every tab as today, but with `reason: "disconnect"`, which **does not** touch the store. Channel deleted (`renderer.ts:~3090`) → close + remove from the store. Channel turned into a voice channel or category → same, on the next tree update.
6. `closeTab(id, opts?)` gets a `reason: "user" | "replaced" | "disconnect" | "deleted"` (default `"user"`) that decides store and `previewTabId` bookkeeping; the existing cleanup (observer, DOM, `replyTargets`) is unchanged. A replaced or closed tab loses its reply draft, exactly as closing a tab does today.

### Edge Cases

- **Clicking the channel of the active preview tab:** no-op switch.
- **Replacing a preview tab while it has an open edit box or reply draft:** they're discarded with it (same as ✕ today). The shared composer text and pending attachments are global and unaffected.
- **Pinned-bar / reply-snippet jumps** (`jumpToMessage`) operate inside the current tab and never open tabs. Unaffected.
- **Viewing indicator** (`updateViewingIndicator()`, PRD 16.3) keeps following `activeTabId`.

### Regression Risk

Changes when channel tabs are created and closed; the tab content, history, pagination and composer are untouched. DM tab code paths must not change (`openDmTab()` gets only the structured tab markup). The tree context menu gets one new item.

### Verification

- `npx tsc --noEmit` (client).
- Headless: click 5 channels → exactly 1 channel tab, in the same slot; keep one, click 3 others → 2 tabs; unkeep rules (both cases in step 3); restart with a fresh connection → kept tabs restored, unfocused, history fetched only on activation; delete a kept channel → tab and store entry gone; DM tabs still accumulate.
- **Manual (user):** the italics/bookmark visuals read clearly; tab and tree context menus; restart persistence; NSFW channel kept + restart.

---

## PRD 17.6 — Feat: Unread Indicator on Unfocused Channel Tabs

**Type:** ✨ FEATURE
**Priority:** Medium
**Depends on:** 17.5 (the structured tab markup)
**Affected Components:** client only: `renderer.ts`, `index.html`.

### Current Behavior

`api.on("message")` (`renderer.ts:~5338`) calls `markChannelUnread()` for any channel that isn't the active tab, which paints only the **tree** row (and nothing when the channel is muted, PRD 16.4). An open-but-unfocused tab shows nothing. `switchTab()` → `markChannelRead()` clears it.

### Goal

An **open channel tab that is not focused** shows an unread indicator when new messages arrive, **unless the channel is muted** (then the tab shows only its name). Applies to **every open channel tab — kept or preview** (user decision). DM tabs are out of scope (they are marked read on arrival today).

### Design

- Single source of truth stays `unreadChannelIds` + `isChannelMuted()`. Extend the three functions that already own that state rather than adding a parallel one:
  - `markChannelUnread(id)` → also `setTabUnread(id, true)` unless muted.
  - `markChannelRead(id)` → also `setTabUnread(id, false)`.
  - `applyChannelMuteState(id)` (mute/unmute) → hides/restores the tab indicator, so unmuting reveals what was missed, exactly like the tree.
  - A tab opened (or restored by 17.5) for a channel already in `unreadChannelIds` starts with the indicator.
- Visual: the `.tab-unread-dot` (6 px, accent color, the tree's `.unread-dot` look) after the label, and the label switches to the normal text color + semibold (inactive tabs are muted-colored today). `aria-label` on the tab gets "(unread)" appended.
- The active tab never shows it (it's cleared by `switchTab()`), including while the window is unfocused (unchanged behavior).

### Regression Risk

Small: three existing functions gain one line each; the tree indicator is untouched.

### Verification

- `npx tsc --noEmit` (client).
- Headless with two clients: keep channel A, focus channel B, send to A from the other client → A's tab shows the dot; switch to A → cleared; mute A → no dot on new messages; unmute → dot appears.
- **Manual (user):** look and feel next to the italics/bookmark visuals from 17.5.

---

## PRD 17.7 — Chore: Collapse Only Messages Longer Than ~15 Lines

**Type:** 🧹 CHORE
**Priority:** Low
**Affected Components:** client only: `renderer.ts` (`attachMessageTruncation()`), `index.html` (clamp CSS).

### Current Behavior

`attachMessageTruncation()` (`renderer.ts:~4823`) adds `.msg-text-clamped` (4 lines: `-webkit-line-clamp: 4` for inline text, `max-height: calc(1.4em * 4)` for Markdown blocks, `index.html:~862`) and keeps it if the text overflows. So the **collapse threshold equals the collapsed height**: anything over 4 lines collapses.

### Goal

Decouple the two: **collapse only when the message is taller than 15 lines**; a collapsed message still shows **4 lines** (the user is happy with that size).

### Design

- Constants: `COLLAPSE_THRESHOLD_LINES = 15`, `COLLAPSED_LINES = 4` (the CSS keeps the 4).
- Measure the **natural** height first (without the clamp class): `lineHeight = parseFloat(getComputedStyle(textEl).lineHeight)`; collapse only if `textEl.scrollHeight > lineHeight * 15 + 2`. "Lines" are rendered visual lines, so one very long wrapped paragraph counts by its wrapped height, which is what the user sees.
- **Hidden-tab measurement (pre-existing bug, fixed here because 17.5/17.6 make background tabs common):** inactive `.tab-content` is `display: none`, so a message rendered into a background tab measures 0 and is **never** collapsed. When `textEl` isn't rendered (`!textEl.isConnected || textEl.offsetParent === null`), mark the message `data-truncation-pending` and let `switchTab()` run `attachMessageTruncation()` on that tab's pending messages right after activation.
- "See more"/"See less", `collapseAllExpandedMessages()` (on minimize), the edit path and `applyMessageEdit()` keep calling the same function and need no change. Solo-emoji messages stay exempt. DMs remain un-truncated (pre-existing, documented in `buildDmMessageElement()`).

### Regression Risk

Only the decision of *whether* to collapse changes. Prepend anchoring is unaffected (truncation runs on the forward path; the prepend path already calls it per message before the batch anchor correction).

### Verification

- `npx tsc --noEmit` (client); `npm run test:markdown`.
- Headless: messages of 4, 14, 15, 16 and 40 lines (plain lines, one wrapped paragraph, a Markdown list) → only >15 collapse, collapsed ones show 4 lines; a 40-line message arriving in a background tab is collapsed once the tab is focused.
- **Manual (user):** a long warning-style message now shows in full up to ~15 lines.

---

## PRD 17.8 — Fix: Pinned-Message Jump with Paginated History (Two-Way Pagination)

**Type:** 🐛 FIX
**Priority:** High
**Affected Components:** shared-types (`FETCH_MESSAGES`/`FETCH_DIRECT_MESSAGES` payload + ack), server (`message.handler.ts`, `dm.handler.ts`), client (`renderer.ts`: `jumpToMessage`, pagination, render paths).

### Current Behavior (from code reading)

`jumpToMessage(tabId, messageId)` (`renderer.ts:~7366`, serves the pinned bar **and** reply snippets, channels and DMs): if the target isn't rendered, it fetches a 50-message window with `aroundMessageId`, **wipes** the list, re-adds both sentinels, renders the window with the normal append path, sets `hasMoreOlder = true`, `atTrueLatest = false`, then `scrollIntoView({ behavior: "smooth", block: "center" })`.

The user reports: clicking the banner scrolls up and stops at the edge of the loaded page instead of reaching the pinned message. Three defects in that path can each produce it:

- **H1 — the top sentinel interrupts the scroll.** Right after the wipe, the top sentinel is in view, so the `IntersectionObserver` fires `loadOlderMessages()`; its anchor-preserving `scrollTop = …` assignment **cancels the in-flight smooth scroll** and leaves the view near the window's top edge.
- **H2 — the window is rendered as if the user were "at the bottom".** `renderChatMessage()` computes `wasNearBottom` per message; on an empty list that is `true`, so every message calls `stickToBottom()` and registers image-load and link-preview callbacks that **re-stick to the bottom later**, yanking the view away from the target as images decode.
- **H3 — there is no forward pagination.** After a jump the window is detached from the present; scrolling down simply ends at the window's last message (`FETCH_*` only supports `before`). The only way back is the "Jump to Most Recent" button. This is exactly the second half of `nextsteps.txt`'s request ("retroactively load the next messages as the user scrolls down").

Also related: a **live message** arriving while the tab shows a detached window is appended after the window's last message, leaving an invisible **gap** of unloaded messages, and sets `atTrueLatest = true` (wrong).

### Step 0 — Reproduce before fixing

Reproduce headlessly (seed a channel with ~150 messages, some with images, pin message #10, open the tab, click the bar) and record which of H1–H3 actually fire, with the trace in the progress log. The fix below covers all three regardless, but the log must state the observed root cause, not only the hypotheses (project practice since PRD 13.1).

### Goal

Clicking the pinned bar (or a reply snippet) lands **on** the target, centered and highlighted, whatever page it is on. From there the user can scroll **up** (older pages, as today) and **down** (newer pages load on demand until the present, after which live messages flow normally).

### Wire Format (additive)

- `FETCH_MESSAGES` / `FETCH_DIRECT_MESSAGES` payload gains `after?: string` (ISO `createdAt` cursor, mutually exclusive with `before` and `aroundMessageId`; the server refuses combinations).
- Both acks gain `hasMoreBefore?: boolean; hasMoreAfter?: boolean`, filled for `aroundMessageId` and `after` fetches (the server fetches `half + 1` on each side to know, then trims). Old clients ignore them.

### Server

- `after`: `where: { channelId, createdAt: { gt: after } }, orderBy: { createdAt: "asc" }, take: take + 1` → `hasMoreAfter = rows.length > take`, return `take` rows ascending. Same for DMs (both directions of the conversation, as the existing DM query does).
- `aroundMessageId`: fetch `halfBefore + 1` / `halfAfter + 1` and report both flags.
- Every returned page still goes through `loadReactorNicknames` and `loadReplyPreviews` (one query per page, `apps/server/CLAUDE.md`).
- Cursor note: `before` already uses `createdAt` alone; `after` mirrors it for consistency (two messages with the *same millisecond* in one channel are practically impossible from one client, and the existing `before` path has the same property). Not changed in this phase.

### Client

1. **`ChatTab` gains** `hasMoreNewer: boolean`, `loadingNewer: boolean`, `newestLoadedTimestamp?: string`, `jumpInProgress: boolean`. `atTrueLatest` keeps its meaning and becomes `!hasMoreNewer`.
2. **Render without sticking:** `renderChatMessage()`/`renderDmMessage()` get an options argument `{ stick?: boolean }` (default: today's behavior). The jump window and forward pages render with `stick: false`, so no `stickToBottom()`, no image-load or preview re-stick callbacks.
3. **`jumpToMessage()`:**
   - Set `tab.jumpInProgress = true` before anything; both sentinel handlers return early while it's set (fixes H1).
   - Target not rendered → fetch around (window of 41: 20 + target + 20), wipe/rebuild as today, render with `stick: false` (fixes H2), set `hasMoreOlder`/`hasMoreNewer` from the ack flags (fallback for an old server: `true`/`true`).
   - Scroll: **instant** (`behavior: "instant"`) centering when the window was just rebuilt (there's nothing meaningful to animate across), smooth only when the target was already on screen-adjacent DOM.
   - Images above the target that load afterwards would shift it: rely on Chromium's CSS scroll anchoring (keep `overflow-anchor` at its default `auto` on `.chat-messages`, confirm nothing disables it), and as a belt-and-braces measure re-center on `load` of images/previews inside the window for up to 1.5 s or until the user scrolls (wheel/touch/key).
   - Clear `jumpInProgress` on the next `scrollend` (Chromium ≥ 114; Electron 34 ships 132) with a 600 ms fallback timer. Highlight as today.
4. **`loadNewerMessages(tab)`** (fixes H3): triggered when the **bottom sentinel** intersects and `tab.hasMoreNewer && !tab.loadingNewer && !tab.jumpInProgress`. Fetches `after: newestLoadedTimestamp`, page size `CHAT_PAGE_SIZE`, appends with `stick: false` (appending below the viewport doesn't move what the user sees), runs grouping/date dividers through the normal append path, updates `newestLoadedTimestamp`, and sets `hasMoreNewer` from the ack (old server: `result.messages.length >= CHAT_PAGE_SIZE`). A small "Loading newer messages…" state on the bottom sentinel mirrors the top one. When `hasMoreNewer` becomes false the tab is live again.
5. **Live messages while detached:** if `tab.hasMoreNewer` is true, **don't** render the incoming message (it would create a gap); leave it to forward pagination, and keep the "Jump to Most Recent Message" button visible. Unread handling (tree + 17.6 tab dot) is unchanged because it doesn't depend on rendering. Edits/deletes/reactions for unrendered messages are already no-ops.
6. `trackOldestOnFirstAppend()` gets its mirror `trackNewestOnAppend()`; `rebuildTabAtLatest()` and the initial load set `hasMoreNewer = false`.

### Regression Risk

Touches the central render/pagination paths, so the default behavior of `renderChatMessage()`/`renderDmMessage()` (sticking for live messages and the initial load) must stay exactly as it is; only explicit `stick: false` callers change. The initial load, scroll-up pagination, "Jump to Most Recent", reply-snippet jumps, DM `aroundMessageId` and the Unread separator must all still work.

### Verification

- Typecheck all workspaces; `npm run test` (add pure tests if the window/flag computation is extracted into a service, which is recommended: `pagination.service.ts`).
- Real server: `after` / `around` flags at both ends of history; combined cursors refused.
- Headless, channel **and** DM: pinned message on page 7 → lands centered and highlighted; scroll down repeatedly → newer pages load until the present, then live messages appear; a live message arriving mid-window doesn't create a gap; images above the target don't push it away; reply-snippet jump to a very old message behaves the same.
- **Manual (user):** the banner on a long real channel; scroll both ways; "Jump to Most Recent" still works.

---

## PRD 17.9 — Feat: Social-Media Link "Fixers" for Rich Previews

**Type:** ✨ FEATURE
**Priority:** Medium
**Affected Components:** client: `main.ts` (link-preview orchestration), a new pure `link-fixers.ts`, a smoke script. The renderer's preview card already supports what's needed.

### Current Behavior

`fetchLinkPreview(url)` (`main.ts:~356`): cache → `fetchLinkPreviewFast()` (plain `fetch` with the `Reson8Bot` UA + metascraper + OG fallback) → `fetchLinkPreviewViaHiddenWindow()` on failure. The card (`createPreviewCard()`, `renderer.ts:~3623`) plays **direct videos** (`og:video:type` = `video/*`) inline in a `<video controls>`; HTML embeds (YouTube today) show a thumbnail with a play overlay that **opens the browser**.

### Goal

For a fixed list of social networks, first ask the matching "fixer" proxy (which serves embed-friendly metadata, usually including a **direct video URL**), so videos play inline. If the fixer fails, fall back to **exactly today's flow** on the original URL. Links outside the list behave exactly as before.

### The Mapping

| Network | Original hosts (exact match after lower-casing) | Fixer | Rewrite |
|:---|:---|:---|:---|
| YouTube | `youtube.com`, `www.`, `m.youtube.com`, `youtu.be` | `koutube.com` | host swap, path + query kept (verified: `/watch?v=`, `/<id>`, `/shorts/<id>`) |
| Twitter / X | `twitter.com`, `x.com`, `www.`, `mobile.` | `fxtwitter.com` | host swap |
| Instagram | `instagram.com`, `www.` | `oginstagram.com` | host swap |
| Reddit | `reddit.com`, `www.`, `old.`, `new.`, `m.` | `vxreddit.com` | host swap |
| Twitch | `twitch.tv`, `www.`, `m.`; `clips.twitch.tv` | `fxtwitch.seria.moe` | host swap; `clips.twitch.tv/<slug>` → `/clip/<slug>` (verified) |
| Bluesky | `bsky.app` | `vxbsky.app` | host swap |
| Imgur | `imgur.com`, `www.`, `m.` (**not** `i.imgur.com`, already a direct image) | `imgurez.com` | host swap |

Matching is on the parsed `URL.hostname`, **never** a substring (so `notyoutube.com` or `youtube.com.evil.net` never match); only `http(s)`; the fragment is dropped.

### Live Findings (07/10/2026) that shape the design

- The fixers decide whether to serve embed metadata **by User-Agent**. With our current UA, `fxtwitter` served metadata, but `vxreddit` **redirected to reddit.com** (no metadata). With a UA that also contains the `Discordbot/2.0` token, `vxreddit` served full metadata. A normal browser UA makes `fxtwitter` redirect to `x.com`. → Fixer requests use a dedicated UA: `Mozilla/5.0 (compatible; Reson8Bot/1.0; Discordbot/2.0; +https://github.com/fbarrella/reson8)`. The existing UA for every other request stays as it is.
- `koutube` returned `og:video` = an Invidious-proxied MP4 (`og:video:type: video/mp4`, checked to answer `206 video/mp4`), and `fxtwitch` an MP4 too: these play inline in the **existing** card. YouTube links therefore change from "thumbnail → browser" to an inline player.
- Failure modes seen: `oginstagram` answered `200` with the title *"Temporarily unavailable"* and no media; `imgurez` redirected every tested link to `embedez.com/download…`; `vxbsky` returned 404/500 for the tested posts. → "Worked" must be defined strictly (below), or junk previews would replace good ones.

### Design

1. **New pure module `apps/client/src/link-fixers.ts`** (no Electron imports): the table above as data, plus `toFixerUrl(original: string): { fixerUrl: string; fixerHost: string } | null`. Smoke-tested by `scripts/link-fixers-smoke.mjs` (`npm run test:link-fixers`): every row, `www/m/mobile` variants, `clips.twitch.tv`, `i.imgur.com` (no match), look-alike hosts (no match), non-http schemes (no match), query preserved.
2. **`main.ts`:** `fetchLinkPreviewFast()` gains an options argument `{ userAgent?: string; strict?: { expectedHost: string } }` (defaults = today's behavior). `fetchLinkPreview(url)` becomes:
   1. cache hit → return (cache key stays the **original** URL);
   2. if `toFixerUrl(url)` → `fetchLinkPreviewFast(fixerUrl, { userAgent: FIXER_UA, strict: { expectedHost: fixerHost } })`. **Strict success** = the final response URL's host is still the fixer host (no redirect away), **and** the result has an image or a video (title alone is not enough: that's the proxy's error page). On success, override `url` = the original URL (clicking the card opens the real post) and `domain` = the original domain;
   3. otherwise → today's `fetchLinkPreviewFast(url)` → `fetchLinkPreviewViaHiddenWindow(url)`, unchanged, on the **original** URL.
   This is the "3 tries" from `nextsteps.txt`: fixer → fast → hidden window.
3. Same 5 s timeout per attempt as today. The fixer attempt adds at most 5 s before the old flow on a dead proxy; acceptable, and only for these hosts.
4. **Renderer:** no change required. One small improvement inside scope: when `video` is a direct video with **no** `image` (the koutube Shorts case returned an empty `og:image`), keep `preload="metadata"` so the first frame shows instead of a black box (already the case; verify).

### Out of Scope

TikTok and other networks; per-user disable of fixers; server-side previews. NSFW content from proxied posts follows the existing link-preview rules (see "Pre-existing issues").

### Regression Risk

Only URLs on the listed hosts take a new path, and their fallback is the untouched old flow. Everything else hits `fetchLinkPreviewFast()` with its defaults. The card renderer is not modified.

### Verification

- `npx tsc --noEmit` (client); `npm run test:link-fixers`.
- Main process driven headlessly (`--inspect`): call the IPC with one real link per network and print which attempt answered; force the fixer to fail (map to an unreachable host in a debug build) → old flow answers.
- **Manual (user):** paste a YouTube, X, Reddit, Twitch clip, Instagram, Bluesky and Imgur link; videos play inline where the fixer works; clicking the card opens the original site; a normal news link looks exactly as before.

---

## PRD 17.10 — Fix: Keep Whitespace-Only Lines as Blank Lines in Markdown

**Type:** 🐛 FIX
**Priority:** Medium
**Affected Components:** client: `markdown.ts`, `scripts/markdown-smoke.mjs`.

### Current Behavior

`markdown-it` (`markdown.ts`, `breaks: true`) treats a line containing only spaces/tabs as a **blank line**, i.e. a paragraph boundary, and paragraphs inside messages have no vertical margin, so `"Line 1\n \nLine 3"` renders as two lines with **no gap**. There's no way to put a visible empty line between paragraphs.

The server only trims the **whole** message (`message.handler.ts:214`, `dm.handler.ts:145`, edit `:456`), and the client only `trim()`s the whole input (`renderer.ts:~4883`, edit `:~7700`), so the inner `" "` line reaches the renderer intact. The fix is purely in rendering.

### Goal

A line that contains **only whitespace** (at least one space or tab) is kept as a **visible blank line**. A truly empty line (no characters) keeps today's behavior (a paragraph break that may collapse), as `nextsteps.txt` allows.

### Design

- In `renderMessageMarkdown()`, before `md.parse`, a pure `preserveWhitespaceOnlyLines(text)` replaces every line matching `/^[ \t]+$/` with a single `U+00A0` (no-break space) — **outside fenced code blocks only** (track ` ``` ` / `~~~` fences with up to 3 leading spaces, closing fence = same char and ≥ the opening length, per CommonMark). For markdown-it a NBSP line is ordinary paragraph text, so with `breaks: true` the result is `Line 1<br>&nbsp;<br>Line 3`: exactly one blank line per whitespace line, and several of them in a row stay several blank lines.
- Inside a list item or a quote the NBSP line becomes a lazy continuation, which shows a blank line inside that item/quote and keeps the list/quote going. That's the intuitive reading of "keep the line"; documented.
- A message whose only change is this gets `block: true` (it has line breaks), as any multi-line message already does.
- `markdownToPlainText()` (pinned bar, reply snippets) needs no change: it collapses all whitespace, NBSP included (`\s` matches U+00A0).
- The sanitizer passes plain text through untouched.

### Regression Risk

Only whitespace-only lines outside code fences change; every other input renders identically. Code blocks keep their whitespace-only lines verbatim.

### Verification

- `npm run test:markdown` with new cases: `"a\n \nb"` (one blank line), `"a\n \n \nb"` (two), `"a\n\nb"` (unchanged), a fenced block containing a `"  "` line (unchanged), list/quote continuation, a `~~~` fence, a tab-only line; the existing XSS vectors still pass.
- `npx tsc --noEmit` (client).
- **Manual (user):** type a warning with Shift+Enter, space, Shift+Enter between paragraphs → visible gaps; edit it → still there.

---

## PRD 17.11 — Chore: Emoji Autocomplete in the Message Edit Box

**Type:** 🧹 CHORE
**Priority:** Low
**Affected Components:** client only: `renderer.ts` (emoji autocomplete section, `startMessageEdit()`), `index.html` (one CSS tweak).

### Current Behavior

The emoji autocomplete (PRD 16.7, `renderer.ts:~5005–5330`) is hard-wired to `chatInput`: `updateEmojiAutocomplete()`, `positionEmojiAutocomplete()`, `selectEmojiAutocompleteItem()`, `convertClosedEmojiShortcode()` and the ARIA attributes all reference `chatInput` directly. The edit box (`startMessageEdit()`, `renderer.ts:~7678`) is a separate `<textarea class="msg-edit-input">` with its own Enter (save) / Escape (cancel) / blur (save) handlers. Message editing is channel-only.

### Goal

The same autocomplete (same search, same card, same keys) works while editing a message.

### Design

1. **Generalize, don't duplicate:** introduce `emojiAcTarget: HTMLTextAreaElement` (default `chatInput`) and replace every `chatInput` reference inside the autocomplete section with it. Add `attachEmojiAutocomplete(textarea, { onAfterInsert? }): () => void` that wires `input`/`click`/`keyup`/`blur` to the target (setting `emojiAcTarget` on focus) and returns a detach function. The composer calls it once at startup with `onAfterInsert: autosizeChatInput`, so its behavior is **unchanged**; the composer-specific bits (`autosizeChatInput`, reply cancel on Escape) stay in the composer's own handlers.
2. **Edit box:** `startMessageEdit()` calls `attachEmojiAutocomplete(input)` and the returned detach in `finish()`. Its `onKeydown` first calls `handleEmojiAutocompleteKeydown(e)`; only if that didn't consume the key does Enter save / Escape cancel. So Enter/Tab pick an emoji while the card is open, and Escape closes the card before it ever cancels the edit (the same precedence the composer uses for reply cancel).
3. **Blur:** the card's rows already `preventDefault()` on `mousedown`, so clicking a suggestion never blurs the edit box (which would save it). The edit box's `onBlur` also closes the card.
4. **Positioning:** the card opens upward from the colon. An edit box near the top of the message list may not have room → when the space above is under 120 px, **open below** the caret line instead (a generic improvement in `positionEmojiAutocomplete()`; for the composer at the bottom of the window it never triggers). Close the card when the tab's `.chat-messages` scrolls, since the edit box moves with it.
5. The edit box doesn't autosize today; out of scope.

### Regression Risk

A mechanical refactor of the autocomplete's target plus new wiring in the edit box. The composer must behave exactly as before (keys, Escape order with replies, autosize, ARIA attributes).

### Verification

- `npx tsc --noEmit` (client).
- Headless: in the composer, `:hea` + Enter inserts and doesn't send; Escape order with a reply open; in an edit box, `:hea` → card opens near the edit box, Enter inserts without saving, Escape closes the card and a second Escape cancels the edit, clicking a suggestion inserts without saving, `:red_heart:` converts on the closing colon; an edit box on the first visible message opens the card below.
- **Manual (user):** edit a message and use the autocomplete with mouse and keyboard.

---

## PRD 17.12 — Security Fix: Cryptographic Identity (Stop Instance-ID Impersonation)

**Type:** 🔒 SECURITY FIX
**Priority:** Critical
**Source:** not in `nextsteps.txt`; found during this PRD's audit and added at the user's request (07/10/2026).
**Affected Components:** shared-types, server (migration, a new pure `identity.service.ts`, `connection.handler.ts`, `admin`/moderation handler for the reset, Redis viewer tickets), client (`main.ts` + a new `identity-key.ts`, `preload.ts`, `preload-viewer.ts`, `renderer.ts`, `index.html`).

### The Vulnerability (confirmed by code reading)

Reson8 has no login: a user **is** whatever `instanceId` a socket presents.

1. **`USER_JOIN_SERVER`** (`connection.handler.ts:~278`) takes `payload.instanceId` at face value and makes it `socket.data.userId`. Once the server password (if any) is passed, nothing proves the caller owns that id.
2. **Every id is public.** `userId === instanceId`, and it's sent to every client: `USER_JOINED`, presence occupants, message/DM DTOs, the Online Users list, reactions. It's also printed in the client's footer.
3. **So anyone can become anyone.** Anyone can copy another user's id into their own `instance-id.txt` (or send it from a script) and join as that user: their roles, their DMs (history included), the ability to delete their messages. If they copy the admin's id (the `ADMIN_INSTANCE_ID` user), they become **Server Admin**.
4. **The same id is used on every server.** The operator of *any* server a user ever joined (or anyone sniffing the plain `http://`/`ws://` connection) learns that id and can use it on every other server that user belongs to.
5. **`VIEWER_AUTHENTICATE` is worse** (`connection.handler.ts:~461`). It accepts any `instanceId` with **no password check and no ban check**. So someone who doesn't even know the server password can use the id of anyone in a voice channel to watch that channel's screen shares (`WATCH_SCREEN_SHARE` only checks that the impersonated id is an occupant).

### Why Not Just a Secret Token

A random per-install secret sent on join would be readable by every server the user connects to, just like the id is today. A malicious or compromised server could then replay it elsewhere. The community-standard answer for "prove you own this identity to many independent servers without trusting any of them with a secret" is a **public-key challenge–response** (the SSH/WebAuthn model):

- Each install has an **Ed25519 key pair**. The private key never leaves the Electron **main process**, not even into the preload or renderer.
- On every connection the server issues a fresh **random, single-use nonce** bound to that socket; the client signs it; the server verifies the signature with the user's **bound public key**.
- What goes over the wire (public key, a signature over a one-time nonce) is useless to anyone else, so a malicious server operator or an eavesdropper can't reuse it.
- Ed25519 is built into Node's `crypto` (`generateKeyPairSync("ed25519")`, `sign(null, …)`, `verify(null, …)`) on both sides, so **no new dependency**.

### Design

#### Identity model (unchanged ids, new proof)

- `User.id` stays the existing `instanceId`. It's already public, so from now on it's treated as a **public handle**, not a secret. No foreign keys, bans, roles, DMs or `localStorage` keys keyed by user id change.
- New nullable columns on `users`: `publicKey TEXT` (base64 SPKI DER) and `publicKeyBoundAt TIMESTAMP`. Migration `<timestamp>_add_user_identity_key`, additive (same `migrate diff` + scratch-DB recipe as 17.1).
- **Trust on first use (TOFU), per server:** the first valid signed join for an id **binds** that key to the id on that server. From then on only that key can use the id there. Binding is an atomic compare-and-set, `UPDATE users SET "publicKey" = $1, "publicKeyBoundAt" = now() WHERE id = $2 AND "publicKey" IS NULL`, so two racing first-joins can't both win (the `claimUploads()` pattern).
- **Key fingerprint:** `SHA256:` + base64 (no padding) of SHA-256 of the SPKI DER, SSH style (e.g. `SHA256:3q2+7w…`). Shown in the client and used by the admin env var.

#### Client: the key (`apps/client/src/identity-key.ts`, main process only)

- Packaged builds: on first launch generate the key pair and write the private key as PKCS#8 PEM to `<userData>/identity-key.pem` with mode `0o600`, next to `instance-id.txt` (same protection level as the id file today). Read it on later launches. A missing or corrupt file is regenerated **only if no id file existed either**; otherwise the corruption is logged, and the admin reset below is the recovery path.
- Dev mode (`!app.isPackaged`): an ephemeral key per launch, matching the dev convention of a fresh `instanceId` per launch.
- `electron.safeStorage` (OS keychain encryption) was considered and **rejected**: on Linux without a keyring it silently falls back to plain text, and if the keyring later becomes unavailable decryption fails and the identity is lost for good. A `0600` file is the predictable, recoverable choice.
- IPC (all `ipcMain.handle`, validated in `main.ts`):
  - `identity-get-public` → `{ publicKey, fingerprint }`.
  - `identity-sign-challenge(nonce, host)` → signature (base64). The main process signs **only** the fixed, domain-separated message `"reson8-auth-v1\n" + nonce + "\n" + host`, and refuses unless `nonce` matches `/^[A-Za-z0-9_-]{43}$/` (32 random bytes, base64url) and `host` is ≤ 255 printable ASCII characters. A compromised renderer can't get a signature over anything else.

#### Wire format (additive)

- New C2S `REQUEST_AUTH_CHALLENGE: (ack: (r: { nonce: string }) => void)`. The server stores the nonce in `socket.data.authNonce` (new optional `SocketData` field). It's single-use: consumed by the next `USER_JOIN_SERVER` on that socket whatever the outcome, and it expires after 60 s.
- `USER_JOIN_SERVER` payload gains `identity?: { publicKey: string; signature: string; host: string }`.
- New C2S `REQUEST_VIEWER_TICKET: (ack: (r: { success: boolean; ticket?: string; error?: string }) => void)` (primary sockets only).
- `VIEWER_AUTHENTICATE` payload becomes `{ ticket?: string; instanceId?: string }` (`instanceId` kept only for the legacy path below).
- New C2S `RESET_IDENTITY_KEY: (payload: { userId: string }, ack: …)`, gated with `requirePermission(PermissionFlags.ADMIN)`.
- `GET_ALL_USERS` rows gain `hasIdentityKey: boolean` (never the key itself).

#### Client: connecting

In `preload.ts`'s `socket.on("connect")` (which also runs on every automatic reconnect):

1. `socket.timeout(3000).emit("REQUEST_AUTH_CHALLENGE")`.
2. Got a nonce → ask the main process to sign `(nonce, host)`, where `host` is the `host[:port]` the user typed (what `serverBaseUrl` was built from) → emit `USER_JOIN_SERVER` with `identity`.
3. Timed out (a v2.5.0 server) → emit the legacy join without `identity`, exactly as today. Old servers keep working.

The existing `joinServerInFlight` guard covers the extra round trip. The viewer window no longer reads the id or touches the key (below). The `query: { instanceId }` the viewer currently puts in its handshake is removed (the server never reads it).

#### Server: the join decision (pure `src/services/identity.service.ts`)

`decideIdentity(input)` is a pure function (no Prisma/Redis), fully unit-tested, that `USER_JOIN_SERVER` calls **after** the password and ban checks and **before** any upsert or socket-state write:

| Join carries a valid signature? | Key bound for this id? | Outcome |
|:---|:---|:---|
| yes, same key | yes | ✅ join |
| yes, different key | yes | ❌ *"This identity is registered to another device. Ask a server admin to reset it."* |
| yes | no | ✅ **bind** (atomic CAS above), then join. If the CAS loses a race, re-read and apply row 1 or 2 |
| signature present but invalid / nonce missing, used or expired | — | ❌ *"Identity verification failed — please reconnect."* |
| no (legacy client) | yes | ❌ *"This identity is protected — update Reson8 to connect."* |
| no (legacy client) | no | ✅ join the old way if `REQUIRE_SIGNED_IDENTITY` is not `true`, otherwise ❌ *"This server requires Reson8 2.6.0 or newer."* |

- "Valid" means `crypto.verify(null, message, publicKey, signature)` over the exact message format, with the nonce taken from `socket.data.authNonce` (never from the payload) and the `publicKey` parsed as Ed25519 SPKI (any other key type is refused).
- **`host` check (optional hardening):** if `AUTH_ALLOWED_HOSTS` (comma-separated `host[:port]`) is set, the signed `host` must be one of them. This stops a malicious server from **relaying** a live challenge from this server to its own users (see Residual Risks). When unset, the host is only logged. It's optional because a server reachable by several names (LAN IP + domain, the documented hairpin-NAT setup) would need all of them listed.
- **Admin protection (user decision):** if `ADMIN_KEY_FINGERPRINT` is set, the `ADMIN_INSTANCE_ID` id can only be **bound** by a key with that fingerprint (a different key gets the "registered to another device" refusal, and the attempt is logged at `warn`), and `role-admin` is only auto-assigned to a signed join with that key. If it's unset, the admin id is bound by first use like everyone else, and the release notes tell the admin to connect with the updated client first.
- Every bind, refusal and reset is logged with `userId`, fingerprint and remote address (never the signature).

#### Server: viewer tickets (replacing the bare-id viewer auth)

- `REQUEST_VIEWER_TICKET` (a primary socket that has joined, so it's already authenticated): 32 random bytes (base64url); Redis key `viewer-ticket:<sha256(ticket)>` → `{ userId, serverId }`, TTL 10 minutes (the upload-token pattern from PRD 16.8: only the hash is stored).
- `VIEWER_AUTHENTICATE { ticket }`: look up by hash → `socket.data.userId` comes **from the ticket**, never from the payload. The TTL is refreshed on each use, so the viewer's own Socket.io reconnects keep working while the window is open. Tickets of a user are deleted when that user's primary session is finalized (the existing disconnect-finalize path) and when the viewer window closes.
- **Legacy** `VIEWER_AUTHENTICATE { instanceId }` (a v2.5.0 client) is accepted **only** if that id has no bound key, `REQUIRE_SIGNED_IDENTITY` is not `true`, **and** that user currently has a live, owned primary socket (`SocketOwnership.hasOwner()`). The ban and password gaps are closed for new clients immediately and narrowed for old ones.
- Client: `openScreenShareViewer()` requests a ticket on the primary socket and passes it to the main process with the existing window parameters; `preload-viewer.ts` sends it instead of the id.

#### Recovery (user decision): admin "Reset identity key"

- Settings → User Management: each row shows a small 🔒 when that user has a bound key. Users holding **ADMIN** see a **"Reset key"** button (a confirm modal explains: *"The next device that connects as <nick> will be bound to this identity. Use this if they reinstalled, changed computer, or someone else claimed their identity."*).
- `RESET_IDENTITY_KEY` clears `publicKey`/`publicKeyBoundAt`, **force-disconnects that user's live primary and viewer sockets** (so an impostor who bound the id loses the session, and the rightful owner can bind on their next connect), and deletes their viewer tickets. Logged.
- Moving to a new computer stays as today: copy the Reson8 `userData` folder (now containing `identity-key.pem` too), or ask an admin for a reset. Export/import was not chosen for this phase.

#### Client UI

- Settings → About: an **"Identity"** row with the key fingerprint, a copy button, and *"Your server admin may ask for this to protect the admin account (ADMIN_KEY_FINGERPRINT)."*
- The new join errors surface through the existing connection-failure toast/log. The "protected identity" one tells the user exactly what to do.

### Residual Risks (documented, out of scope)

- **TOFU window:** until a user connects once with 2.6.0, someone else can bind their id first. The admin account is covered by `ADMIN_KEY_FINGERPRINT`; everyone else by the visible refusal plus the admin reset. Recommended rollout (release notes): update the server, set `ADMIN_KEY_FINGERPRINT`, let everyone update (the auto-updater does this), then set `REQUIRE_SIGNED_IDENTITY=true`.
- **No transport encryption by default:** the client connects over `http://`/`ws://` unless the self-hoster puts TLS in front. A network attacker in the path can still hijack a *live* session, but can no longer steal the identity for later. Moving to TLS by default is a separate item.
- **Relay by a malicious server** is only stopped when `AUTH_ALLOWED_HOSTS` is set.
- **Local malware** that can read the user's `userData` can copy the key, as it can copy anything there today.
- **Ban evasion** with a fresh install is unchanged (bans are per identity, as before).

### Regression Risk

The join path changes, which every feature depends on, so the decision runs before any state is written and is covered by an exhaustive table test. Legacy clients keep working on servers with `REQUIRE_SIGNED_IDENTITY` unset as long as their id isn't bound, and a 2.6.0 client keeps working on an old server through the challenge timeout. Reconnects (Socket.io auto-reconnect, voice auto-rejoin, the stale-socket ownership logic) must behave exactly as before. Each reconnect simply does one extra round trip. Screen-share viewing must keep working, including the viewer's own reconnects.

### Verification

- Typecheck shared-types → server → client; `npm run test` (new `identity.service.test.ts`: every row of the table, wrong key type, tampered message, reused/expired nonce, CAS race, admin-fingerprint cases, `AUTH_ALLOWED_HOSTS` on/off); a client smoke `npm run test:identity` (key generation, PEM round trip, the main-process signer refusing malformed nonces/hosts, sign → verify with the server's verifier).
- Migration on a scratch DB (recipe in `apps/server/CLAUDE.md`).
- Real server booted with explicit env, scripted sockets:
  1. first signed join binds; reconnect with the same key works;
  2. a second key on the same id is refused;
  3. a legacy join on a bound id is refused, on an unbound id accepted, and refused with `REQUIRE_SIGNED_IDENTITY=true`;
  4. a replayed signature on a new socket is refused;
  5. `ADMIN_KEY_FINGERPRINT` blocks a foreign key from binding the admin id;
  6. `VIEWER_AUTHENTICATE` with a forged id is refused, with a valid ticket accepted, and with a ticket after the owner disconnects refused;
  7. `RESET_IDENTITY_KEY` by a non-admin is refused; by an admin it disconnects the bound socket and the next key binds.
- Headless client against that server: connect, auto-reconnect after killing the socket, voice rejoin, open a screen-share viewer.
- **Manual (user):** packaged build on Windows and Linux: first connect binds (User Management shows 🔒); restart reconnects silently; copy the fingerprint from About into `ADMIN_KEY_FINGERPRINT` and restart the server → still admin; reset a test user's key from User Management; a v2.5.0 client still connects to an unbound id.

---

## Cross-Cutting Dependencies & Recommended Implementation Order

```
17.1 avatars foundation ──► 17.2 avatars in chat ──► 17.3 profile card
17.5 preview/kept tabs ──► 17.6 tab unread dot ──► 17.7 collapse threshold (its hidden-tab fix matters more once tabs stay in the background)
17.8 two-way pagination        (independent; touches render paths 17.2 also touches: implement after 17.2)
17.4, 17.9, 17.10, 17.11       (independent)
17.12 cryptographic identity   (independent; touches the join path, so it goes last, once every other item's join-path change (17.1's avatar field) is in)
```

Recommended order (the numbering; 1–11 follow `nextsteps.txt`): **17.1 → 17.2 → 17.3 → 17.4 → 17.5 → 17.6 → 17.7 → 17.8 → 17.9 → 17.10 → 17.11 → 17.12**. Each item ends with `/log-progress`, a local commit, and a stop for the user's go-ahead.

Shared-types touchpoints in this phase (all additive): `AvatarProvider`, `IAvatarSelection`, `IUser.avatarUrl`, `IMessage.avatarUrl`, `IDirectMessage.senderAvatarUrl`, `IUserProfile`; events `SET_AVATAR`, `GET_USER_PROFILE`, `USER_AVATAR_UPDATED`; `USER_JOIN_SERVER.avatar`; `FETCH_MESSAGES`/`FETCH_DIRECT_MESSAGES` `after` + `hasMoreBefore`/`hasMoreAfter`; `REQUEST_AUTH_CHALLENGE`, `USER_JOIN_SERVER.identity`, `REQUEST_VIEWER_TICKET`, `VIEWER_AUTHENTICATE.ticket`, `RESET_IDENTITY_KEY`, `GET_ALL_USERS` `hasIdentityKey`, `SocketData.authNonce`. Two migrations (`users.avatarUrl`; `users.publicKey` + `publicKeyBoundAt`). New server env vars (all optional): `REQUIRE_SIGNED_IDENTITY`, `ADMIN_KEY_FINGERPRINT`, `AUTH_ALLOWED_HOSTS`, to be added to `.env.example` and the README.

Compatibility summary for the release notes: a v2.6.0 client on a v2.5.0 server works (everyone gets the default avatar, the profile card shows partial info, forward pagination falls back to the page-size heuristic); a v2.5.0 client on a v2.6.0 server works (it just doesn't see avatars) **as long as its id has not been bound by a 2.6.0 client and `REQUIRE_SIGNED_IDENTITY` is not set** (PRD 17.12). In practice the auto-updater moves users to 2.6.0, and from then on their identity is protected.

---

## Open Decisions Confirmed With the User

1. **Default avatar identifier:** `sha256(userId)`, not the raw user id, because the user id is the instanceId (identity credential). *(07/10/2026)*
2. **Kept tabs:** labelled **"Keep Tab Open" / "Stop Keeping Open"** and **remembered** per server across reconnects/restarts. *(07/10/2026)*
3. **Tab unread indicator:** on **every** open, unfocused channel tab (kept or preview), never for muted channels. *(07/10/2026)*
4. **Avatar privacy opt-out:** a "Load avatars from Libravatar/Gravatar" switch, default on; off = initials, no external requests. *(07/10/2026)*
5. **Identity fix placement:** in this phase, as PRD 17.12 (the last item). *(07/10/2026)*
6. **Old clients during the transition:** gradual. Bound identities are protected at once, unbound legacy joins are still accepted until the admin sets `REQUIRE_SIGNED_IDENTITY=true`. *(07/10/2026)*
7. **Admin protection:** optional `ADMIN_KEY_FINGERPRINT` env, with the fingerprint shown in Settings → About. *(07/10/2026)*
8. **Recovery:** an ADMIN-only "Reset key" in User Management that also disconnects the bound sockets. No export/import this phase. *(07/10/2026)*

Reasonable defaults assumed (say so if you'd rather change any):

- The email is stored locally in plain `localStorage` (it's your own machine); only its hash is ever sent anywhere.
- Avatars appear in **channel and DM** messages (both are "text chats"). Not (yet) in the channel tree, the Online Users modal or the status bar.
- The profile card opens from a message's avatar and nickname only; reply-snippet names keep their "jump to original" click.
- The profile card's date is labelled "Member since" and uses `User.createdAt`.
- Mic volume above 100% goes through a soft clipper (pass-through at ≤100%).
- Unkeeping a tab when another preview tab exists keeps whichever tab you're looking at.
- Restored kept tabs load their history only when first opened; a kept NSFW tab is restored without a prompt.
- The collapse threshold counts rendered (wrapped) lines.
- The fixer request uses a UA containing the `Discordbot/2.0` token (verified necessary for vxreddit); every other request keeps the current UA.
- The identity private key is a `0600` PEM file in `userData`, not OS-keychain encrypted (see 17.12 for why).
- A key is bound per server on first signed use (TOFU). `AUTH_ALLOWED_HOSTS` (relay protection) is optional, because servers reachable by several names would need all of them listed.
- Only `seccdn.libravatar.org` is used (no Libravatar federation lookup).

---

## Pre-Existing Issues Noticed During the Audit

Fixed in this phase (inside an item's scope):

- **Background-tab truncation never runs** — a long message rendered into a hidden tab measures 0 height and is never collapsed (fixed in 17.7).
- **Live message after a jump creates a gap** and wrongly marks the tab as up to date (fixed in 17.8).
- **Identity = a broadcast secret.** `userId` is the `instanceId` and is sent to every client, so anyone could join as anyone, including the admin (fixed in 17.12; the Phase 16 PRD had recorded it as out of scope).
- **The screen-share viewer socket skipped the password and ban checks** and accepted any id (fixed in 17.12).

Not fixed (out of scope, for a future phase):

- **No transport encryption by default.** The client builds `http://` URLs, so unless a self-hoster puts TLS in front, traffic (messages included) is readable on the network path. 17.12 stops identity theft but not live-session hijacking on a hostile network.
- **Link previews ignore NSFW context.** A preview image from any link (proxied Reddit posts included) is shown unblurred, even in non-NSFW channels, and isn't covered by the NSFW-channel blur. The fixers don't create this, but make video previews more common.
- **Link-preview cache never expires** in a session, and `response.text()` has no size cap.
- **DM tabs have no unread indicator** (they're marked read on arrival even when unfocused) and DM messages are never truncated.
- **`npm run lint` is broken** (eslint not installed), as documented in the root `CLAUDE.md`.

---

## Mapping to `nextsteps.txt`

| `nextsteps.txt` item | PRD |
|:---|:---|
| feat: enable setting up avatars (libravatar / gravatar) | 17.1 |
| feat: show avatars next to users nicknames on text chats | 17.2 |
| feat: expand user stats when clicking its name | 17.3 |
| chore: make possible to raise mic volume to 300% | 17.4 |
| feature: only keep 'fixed' chat tabs opened… | 17.5 |
| feat: unfocused fixed chats should have unread message alerts… | 17.6 |
| chore: increase size tolerance until a message gets collapsed | 17.7 |
| fix: pinned message quick link impacted by paginated feed | 17.8 |
| feat: implement 'fixers' to rich context metadata for social media links | 17.9 |
| fix: the markdown processing … misses support for blank lines | 17.10 |
| chore: add the implemented emoji autocomplete to text messages editing text boxes | 17.11 |
| *(not in `nextsteps.txt` — audit finding, added at the user's request)* instance-id impersonation | 17.12 |
