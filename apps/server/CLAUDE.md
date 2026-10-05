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

- `src/handlers/*.handler.ts` — one file per Socket.io event domain (connection, voice, channel, message, dm, admin, moderation, reaction). This is where new client↔server events get wired up after being added to `packages/shared-types/src/socket-events.ts`.
- `src/services/` — stateful business logic consumed by handlers: `mediasoup.service.ts` (SFU worker/router/transport lifecycle, AudioLevelObserver), `presence.service.ts` (Redis-backed online/channel tracking), `permissions.service.ts` (bitwise role aggregation), `channel-tree.service.ts` (flat rows → nested tree), `socket-ownership.ts` (which socket owns each `userId` — see the root `CLAUDE.md`'s "Socket ownership"), `reaction.service.ts` (the one place reactions are aggregated, with reactor nicknames), `message-text.ts` (`normalizeNewlines`: CRLF → LF before length checks/persistence).
- `src/middleware/permissions.middleware.ts` — `requirePermission()` guard used to gate handlers by `PermissionFlags`; `requireAnyPermission()` for a handler shared by more than one permission (e.g. `GET_ALL_USERS`, needed by both `MANAGE_ROLES` and `BAN_USER` holders for the User Management tab).
- `src/plugins/` — Fastify plugins registering Prisma and Redis clients on the `app` instance.
- `src/config/mediasoup.config.ts` — Worker/Router/Transport settings, including the public/private dual-announce-IP logic for LAN/WAN NAT traversal.
- `src/routes/upload.route.ts` — REST (not Socket.io) endpoints for image uploads (`/api/upload`, `/api/upload/emoji`), animated-GIF custom emoji (`/api/upload/emoji-animated`, its own larger size cap + GIF-only MIME allowlist), and custom text-channel icons (`/api/upload/channel-icon`, shares the emoji route's 512KB cap, no approval-queue gating since channel icons are already admin-only via `UPDATE_CHANNEL`'s `MANAGE_CHANNELS` check); dual-backend (local disk vs Cloudinary) selected by presence of `CLOUDINARY_*` env vars.
- `prisma/schema.prisma` — source of truth for the data model; `prisma/seed.ts` creates the default server/channels/roles (idempotent, upsert-based).
- `src/__tests__/` — vitest unit tests (`channel-tree`, `permissions`, `socket-ownership`, `reaction.service`, `message-text`) — pure-logic tests, no DB/Redis required. The Socket.io handlers themselves are not unit-tested; keep logic that needs testing in a pure service like these.

## Conventions worth knowing

- Anything `userId`-keyed that a `disconnect` can tear down (mediasoup session, presence, the grace timer) must be guarded by `SocketOwnership` — a user can have an old and a new socket at once, and the stale one's late disconnect must not touch the live one's state.
- Reactions are aggregated only via `reaction.service.ts`; message/DM history load every reactor's nickname in one query per page (`loadReactorNicknames`).
- New Socket.io events always start in `packages/shared-types/src/socket-events.ts` (both `ClientToServerEvents` and `ServerToClientEvents` as needed), then get a handler here.
- Presence (who's online, who's in which channel) lives in Redis, not Postgres — don't add DB queries for that; use `presence.service.ts`.
- Permission checks go through `hasPermission`/`hasAnyPermission`/`isAdmin` in `permissions.service.ts`, never inline bit math in a handler.
- `resolveNickname()` in `connection.handler.ts` is the pattern for any lookup that might race a Redis presence write during reconnect — prefer Redis, fall back to Postgres, only default to a placeholder as a last resort.
