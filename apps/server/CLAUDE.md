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
- `src/services/` — stateful business logic consumed by handlers: `mediasoup.service.ts` (SFU worker/router/transport lifecycle, AudioLevelObserver), `presence.service.ts` (Redis-backed online/channel tracking), `permissions.service.ts` (bitwise role aggregation), `channel-tree.service.ts` (flat rows → nested tree).
- `src/middleware/permissions.middleware.ts` — `requirePermission()` guard used to gate handlers by `PermissionFlags`; `requireAnyPermission()` for a handler shared by more than one permission (e.g. `GET_ALL_USERS`, needed by both `MANAGE_ROLES` and `BAN_USER` holders for the User Management tab).
- `src/plugins/` — Fastify plugins registering Prisma and Redis clients on the `app` instance.
- `src/config/mediasoup.config.ts` — Worker/Router/Transport settings, including the public/private dual-announce-IP logic for LAN/WAN NAT traversal.
- `src/routes/upload.route.ts` — REST (not Socket.io) endpoints for image uploads (`/api/upload`, `/api/upload/emoji`) and animated-GIF custom emoji (`/api/upload/emoji-animated`, its own larger size cap + GIF-only MIME allowlist); dual-backend (local disk vs Cloudinary) selected by presence of `CLOUDINARY_*` env vars.
- `prisma/schema.prisma` — source of truth for the data model; `prisma/seed.ts` creates the default server/channels/roles (idempotent, upsert-based).
- `src/__tests__/` — vitest unit tests (currently `channel-tree.test.ts`, `permissions.test.ts`) — pure-logic tests of the tree-building and bitwise permission algorithms, no DB/Redis required.

## Conventions worth knowing

- New Socket.io events always start in `packages/shared-types/src/socket-events.ts` (both `ClientToServerEvents` and `ServerToClientEvents` as needed), then get a handler here.
- Presence (who's online, who's in which channel) lives in Redis, not Postgres — don't add DB queries for that; use `presence.service.ts`.
- Permission checks go through `hasPermission`/`hasAnyPermission`/`isAdmin` in `permissions.service.ts`, never inline bit math in a handler.
- `resolveNickname()` in `connection.handler.ts` is the pattern for any lookup that might race a Redis presence write during reconnect — prefer Redis, fall back to Postgres, only default to a placeholder as a last resort.
