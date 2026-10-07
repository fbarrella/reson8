# CLAUDE.md — apps/server

Guidance specific to the Reson8 server. See the repo-root `CLAUDE.md` first for architecture and cross-cutting conventions (shared-types-first workflow, progress.txt logging requirement, etc).

## Commands

```bash
npm run dev            # tsx watch src/index.ts — auto-restarts on change
npm run build           # tsc
npm run start            # node dist/index.js — run the built server
npx tsc --noEmit         # typecheck without emitting (verification step)
npm run test              # vitest run
npm run test:watch        # vitest
npx vitest run src/__tests__/permissions.test.ts   # single test file
npm run db:generate       # prisma generate (after schema.prisma changes)
npm run db:migrate        # prisma migrate dev (creates + applies a migration)
npm run db:push           # prisma db push (schema sync without a migration)
```

Requires `.env` (copy from `.env.example`) and `docker compose -f docker-compose.dev.yml up -d` running from the repo root for Postgres + Redis.

## Structure

- `src/handlers/*.handler.ts` — one file per Socket.io event domain (connection, voice, channel, message, dm, admin, moderation, reaction). This is where new client↔server events get wired up after being added to `packages/shared-types/src/socket-events.ts`. `upload.handler.ts` holds the upload-pipeline events (`REQUEST_UPLOAD_TOKEN`, `DISCARD_UPLOAD`).
- `src/services/` — stateful business logic consumed by handlers: `mediasoup.service.ts` (SFU worker/router/transport lifecycle, AudioLevelObserver), `presence.service.ts` (Redis-backed online/channel tracking), `permissions.service.ts` (bitwise role aggregation), `channel-tree.service.ts` (flat rows → nested tree), `socket-ownership.ts` (which socket owns each `userId` — see the root `CLAUDE.md`'s "Socket ownership"), `reaction.service.ts` (the one place reactions are aggregated, with reactor nicknames), `message-text.ts` (`normalizeNewlines`: CRLF → LF before length checks/persistence). Phase 16 added `stored-file.service.ts` (the upload ledger: claim/release/discard/sweep, upload tokens), `attachment.service.ts` (a message's images), `reply.service.ts` (reply snippets and the reply-target rules) and `upload-sweeper.ts` (the hourly sweep).
- `src/middleware/permissions.middleware.ts` — `requirePermission()` guard used to gate handlers by `PermissionFlags`; `requireAnyPermission()` for a handler shared by more than one permission (e.g. `GET_ALL_USERS`, needed by both `MANAGE_ROLES` and `BAN_USER` holders for the User Management tab).
- `src/plugins/` — Fastify plugins registering Prisma and Redis clients on the `app` instance.
- `src/config/mediasoup.config.ts` — Worker/Router/Transport settings, including the public/private dual-announce-IP logic for LAN/WAN NAT traversal. `src/config/upload.config.ts` holds the upload tunables (`ALLOW_TOKENLESS_UPLOADS`, token TTL, the 24 h unclaimed-upload TTL, sweep interval).
- `src/routes/upload.route.ts` — REST (not Socket.io) endpoints for image uploads (`/api/upload`, `/api/upload/emoji`), animated-GIF custom emoji (`/api/upload/emoji-animated`, its own larger size cap + GIF-only MIME allowlist), and custom text-channel icons (`/api/upload/channel-icon`, shares the emoji route's 512KB cap, no approval-queue gating since channel icons are already admin-only via `UPDATE_CHANNEL`'s `MANAGE_CHANNELS` check); dual-backend (local disk vs Cloudinary) selected by presence of `CLOUDINARY_*` env vars. Every route authenticates BEFORE reading the body (`Authorization: Bearer <token>`; a bad token is a 401, no header is accepted as an ownerless upload while `ALLOW_TOKENLESS_UPLOADS` is true) and records the file in the ledger, replying `{ url, publicId, uploadId }`.
- `prisma/schema.prisma` — source of truth for the data model; `prisma/seed.ts` creates the default server/channels/roles (idempotent, upsert-based). `scripts/prune-orphan-uploads.mjs` (`npm run uploads:prune`) is plain ESM so it runs in the production image; its pure logic is exported and typed by a sibling `.d.mts` so a vitest test can import it.
- `src/__tests__/` — vitest unit tests (`channel-tree`, `permissions`, `socket-ownership`, `reaction.service`, `message-text`) — pure-logic tests, no DB/Redis required. The Socket.io handlers themselves are not unit-tested; keep logic that needs testing in a pure service like these. Phase 16 added `stored-file.service`, `attachment.service`, `reply.service` and `prune-orphan-uploads` tests (still pure logic — anything touching Postgres was verified against a throwaway database, see below).

## Conventions worth knowing

- Anything `userId`-keyed that a `disconnect` can tear down (mediasoup session, presence, the grace timer) must be guarded by `SocketOwnership` — a user can have an old and a new socket at once, and the stale one's late disconnect must not touch the live one's state.
- Reactions are aggregated only via `reaction.service.ts`; message/DM history load every reactor's nickname in one query per page (`loadReactorNicknames`).
- New Socket.io events always start in `packages/shared-types/src/socket-events.ts` (both `ClientToServerEvents` and `ServerToClientEvents` as needed), then get a handler here.
- Presence (who's online, who's in which channel) lives in Redis, not Postgres — don't add DB queries for that; use `presence.service.ts`.
- Permission checks go through `hasPermission`/`hasAnyPermission`/`isAdmin` in `permissions.service.ts`, never inline bit math in a handler.
- **Never trust a client-supplied file URL or Cloudinary `public_id`** — not to persist, not to delete. Files are used by *claiming* an upload id (`claimUploads()`, an atomic compare-and-set) on the **same `$transaction` client** as the write that uses it, and are removed with `releaseStoredFile()` only *after* the referencing row is gone (DB first, so a failed delete never loses a file), using the ledger's own url/public_id and a reference-count check (`countFileReferences` matches local files by name, so the relative and the pre-v2.5.0 absolute URL forms both count). Any new feature that stores a file must go through the ledger (add a `StoredFileKind`), and any new table that references files must be added to `countFileReferences()` and `collectChannelFileUrls()` or its files will be deleted from under it. Details and the threat model are in the root `CLAUDE.md`.
- Replies: validate with `parseReplyToId` + `isChannelReplyAllowed`/`isDmReplyAllowed` (a target in another channel/conversation is refused; a missing one is accepted), never inline; add `loadReplyPreviews()` to any new path that returns messages so snippets stay one query per page.
- Migrations that need a backfill: generate the SQL with `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <scratch db> --script` (it never touches the dev DB), then hand-append the backfill. Verify on a throwaway database — create `reson8_scratch` in the dev Postgres container, apply the older migrations with `psql`, insert realistic rows, apply the new one, then `prisma migrate deploy` on a fresh scratch DB — and drop it afterwards. Don't use `migrate dev` to test a migration against the dev database.
- Booting the real server for an end-to-end test: `dotenv/config` loads `apps/server/.env` **regardless of the working directory**, and never overrides variables that are already set — so pass explicit `DATABASE_URL`, `REDIS_URL` (use a separate Redis db number), `PORT`, and an empty `SERVER_PRIVATE_PASSWORD=` or the test silently talks to your dev database / hits the join password. The server also reads `package.json` from the cwd (version config), so a scratch cwd needs a copy. Seed only *after* the server has created its `Server` row.
- `resolveNickname()` in `connection.handler.ts` is the pattern for any lookup that might race a Redis presence write during reconnect — prefer Redis, fall back to Postgres, only default to a placeholder as a last resort.
