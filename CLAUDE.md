# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Reson8 is a self-hosted voice and text communication platform (TeamSpeak-3-style) with an Electron desktop client and a standalone Node.js server. Current version: 2.2.0, phases 1–13 complete — see "Project history" below before assuming something is unbuilt.

npm workspaces monorepo:
- `apps/client/` — Electron desktop client (TypeScript, no framework — vanilla DOM in the renderer)
- `apps/server/` — Fastify + Socket.io signaling server with mediasoup SFU (ESM, `"type": "module"`)
- `packages/shared-types/` — Socket.io event maps (`ClientToServerEvents`/`ServerToClientEvents`) and DTOs shared by both apps

## Commands

Databases (required before running the server):
```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres + Redis only
```

Server (`apps/server`):
```bash
npm run dev            # tsx watch src/index.ts
npm run build           # tsc
npm run test            # vitest run
npm run test:watch      # vitest
npx vitest run src/__tests__/permissions.test.ts   # single test file
npm run db:migrate      # prisma migrate dev
npm run db:generate     # prisma generate
npx tsc --noEmit        # typecheck without emitting — the actual verification step used throughout this project's history
```

Client (`apps/client`):
```bash
npm run dev             # tsc --build && copy-html.mjs && electron .
npm run typecheck       # tsc --noEmit
npm run build:linux     # electron-builder (also :win, :mac)
```

Root:
```bash
npm run build            # tsc --build --force across all workspaces
npm run dev:server       # -> apps/server dev
npm run dev:client       # -> apps/client dev
npm run format            # prettier --write — works, prettier is installed
npm run lint              # BROKEN: references eslint, but eslint is not an installed dependency anywhere in the repo. Don't rely on it or tell users to run it.
```

There is no CI pipeline. `npx tsc --noEmit` (or `--build`) per affected workspace — shared-types, server, client — is the verification step consistently used before treating a change as done; run it in each workspace touched.

Shared-types must be built (`npx tsc --build`) before server/client typecheck against changes made there, since both consume it via the `@reson8/shared-types` workspace package.

## Architecture

**Voice (SFU, not P2P mesh):** `apps/server/src/services/mediasoup.service.ts` runs mediasoup Workers/Routers; each client uploads one audio track, the server forwards it to other channel participants. Signaling is a fixed 6-step handshake driven by `apps/server/src/handlers/voice.handler.ts` and `apps/client/src/services/voice.service.ts`: `GET_ROUTER_CAPABILITIES → CREATE_WEBRTC_TRANSPORT → CONNECT_TRANSPORT → PRODUCE → CONSUME → RESUME_CONSUMER`. Active-speaker detection uses mediasoup's server-side `AudioLevelObserver` (not client-side analysis, interval currently 100ms) and broadcasts `ACTIVE_SPEAKERS`. Before the mic track is produced, it passes through a client-side Web Audio graph built once per join in `voice.service.ts`'s `buildMicProcessingGraph()`: `micSource → [noiseCancelNode] → gateGainNode → volumeGainNode → destination`, with the settings-panel level meter tapping the graph right after the (optional) noise-cancelling stage. Noise cancelling itself runs DeepFilterNet3 via a vendored WASM build (`apps/client/assets/deepfilternet/`, not the npm package's default third-party CDN) inside an `AudioWorkletNode`.

**Presence-quit signaling:** a socket disconnect defers presence cleanup by a grace period (`connection.handler.ts`'s `pendingDisconnects`) so a brief network drop doesn't flicker someone's presence off and on — *except* when the client explicitly called `socket.disconnect()` itself (reported as Socket.io's `"client namespace disconnect"` reason, e.g. the app quitting via `main.ts`'s `"before-quit"`/window `"close"` handlers), which finalizes immediately since there's no ambiguity about a possible reconnect.

**Identity:** no login/auth system. Each Electron install generates a persistent UUID (`apps/client/src/instance-id.ts`, stored under `app.getPath('userData')`) sent as `instanceId` on `USER_JOIN_SERVER`; the server upserts a `User` row and assigns default role via this ID. `ADMIN_INSTANCE_ID` env var grants Server Admin automatically. Dev mode regenerates the UUID each launch for easy multi-client testing — packaged builds (`app.isPackaged`) persist it.

**Permissions:** bitwise flags on `bigint` role columns, defined in `packages/shared-types/src/models.ts` (`PermissionFlags`: `CONNECT`, `SPEAK`, `MANAGE_CHANNELS`, `MANAGE_ROLES`, `KICK_USER`, `BAN_USER`, `ADMIN`, `MANAGE_EMOJIS`). `apps/server/src/services/permissions.service.ts` aggregates a user's roles via bitwise OR; `ADMIN` bypasses all checks. Socket.io handlers are gated with `requirePermission()` from `apps/server/src/middleware/permissions.middleware.ts`; `requireAnyPermission()` in the same file gates a handler shared by more than one permission (e.g. `GET_ALL_USERS`, needed by both `MANAGE_ROLES` and `BAN_USER` holders for the User Management tab).

**Presence:** tracked in Redis (`apps/server/src/services/presence.service.ts`), not Postgres — who's connected to which server/channel, with a TTL refreshed on activity. On `USER_JOIN_SERVER`, `hydrateOccupants()` in `connection.handler.ts` walks the channel tree and populates occupants from Redis before emitting `CHANNEL_TREE_UPDATE`. `resolveNickname()` falls back to Postgres when a Redis presence read races a reconnect (see progress.txt PRD 3.2).

**Protocol contract:** `packages/shared-types/src/socket-events.ts` (`ClientToServerEvents`/`ServerToClientEvents`) is the source of truth for the client↔server wire format. When a feature crosses that boundary, update shared-types first — both apps typecheck against it.

**Data model:** Prisma/Postgres (`apps/server/prisma/schema.prisma`) holds `Server`, `Channel` (self-referencing tree via `parentId`), `User`, `Role`, `Message`, `DirectMessage`, `BannedUser`, `Reaction`, `ChannelRead` (per-user-per-channel unread cursor), `CustomEmoji` (server-uploaded emoji, PENDING/APPROVED). Channel tree is flattened→nested in `apps/server/src/services/channel-tree.service.ts`.

**Client process boundaries:** `main.ts` (Electron main — window, tray, global shortcuts for PTT, permission handler for mic access, link-preview fetching via `metascraper`, native context menu) → `preload.ts` (contextBridge API surface, `reson8Api`, 60+ methods) → `renderer/renderer.ts` (vanilla TS DOM UI, no framework/build tooling beyond tsc).

**Electron gotchas that have bitten this project before** (see progress.txt for the incidents):
- `getUserMedia` is silently blocked by default — `session.defaultSession.setPermissionRequestHandler` in `main.ts` must auto-grant mic/audio permissions.
- Detached `new Audio()` elements produce no sound in the renderer; audio elements must be `document.createElement("audio")`, appended to `document.body`, and removed after use.
- Files referenced by the main process (tray icon, sound alerts under `apps/client/assets/`) must be listed in electron-builder's `build.files` in `apps/client/package.json` or they silently vanish from packaged builds while working fine in dev.
- electron-updater's GitHub provider needs `latest.yml`/`latest-linux.yml`/`latest-mac.yml` (electron-builder generates them locally under `apps/client/release/` alongside the installers) uploaded as release assets on every GitHub release — `npm run build:*` alone does not publish anything, so a release built and uploaded by hand without those yml files leaves every platform's update check silently failing (v1.3.0 → v1.4.0 incident, see progress.txt).
- A `main.ts`/`preload.ts`/`voice.service.ts` static `import` of an ESM-only npm dependency (a package with no real `"require"` export condition, or one whose own `package.json` sets `"type": "module"` — which makes Node treat *all* its plain `.js` files as ESM regardless of which export condition points at one) compiles to a `require()` call under this project's CommonJS `tsconfig` and crashes the whole preload script at startup with `ReferenceError: exports is not defined` (the `deepfilternet3-noise-filter` incident, Phase 13, see progress.txt) — check a candidate dependency's `package.json` `"type"`/`"exports"` *before* adding it. A plain `await import(...)` isn't a safe fix either: TypeScript rewrites dynamic `import()` back into a deferred `require()` under this same CommonJS target, hitting the identical crash lazily instead of at startup. The confirmed-working escape hatch when an ESM-only dependency is unavoidable is an indirect-eval dynamic import — `new Function("specifier", "return import(specifier)")` — which TypeScript can't see or rewrite (see `voice.service.ts`'s `dynamicImport` helper).
- Installers currently ship **unsigned** (no code-signing certificate) — on Windows, `main.ts` replaces `NsisUpdater`'s `verifyUpdateCodeSignature` with a verifier that always resolves `null` (not a boolean; it's a `(publisherNames, path) => Promise<string | null>` function per electron-updater's API). Without this, electron-updater checks a downloaded update's Authenticode publisher against the publisher name baked into the *currently-installed* app's own `app-update.yml` and rejects a legitimate unsigned update with "not signed by the application owner" (v2.2.0 incident — hit when updating a client that had been built and installed while still signed, see progress.txt). If code signing is ever reintroduced, that override must be removed again so updates are actually verified — see the "Code Signing" section in the root README.

## Environment

Server needs `apps/server/.env` (copy from `.env.example`): `DATABASE_URL`, `REDIS_URL`, `PORT` (9800), `MEDIASOUP_ANNOUNCED_IP`; optional `ADMIN_INSTANCE_ID`, `SERVER_PRIVATE_PASSWORD`, `MEDIASOUP_PRIVATE_ANNOUNCED_IP` (LAN/WAN dual-announce for hairpin NAT), `CLOUDINARY_*` (image uploads fall back to local disk storage if unset).

Ports: 9800 (Fastify + Socket.io signaling), 10000–10100 UDP/TCP (mediasoup media), 5432 (Postgres), 6379 (Redis).

## Project history and required practice

`app-planning/progress.txt` is the authoritative build log for this project — read it before assuming a feature doesn't exist or working out why something is built a certain way. As of 30/08/2026 it holds three condensed summary blocks — phases 1–8, phases 9–10, and (newly condensed this pass) phases 11–13 — with the "ongoing log" section below them empty and ready for the next phase's entries; condense those into a fourth summary block the same way once that section grows unwieldy again. The full unabridged entry-by-entry history — every bug's root cause, every file touched — lives in `app-planning/archive/progress-phases-1-8.txt` (phases 1–8), `app-planning/archive/progress-phases-9-10.txt` (phases 9–10), and `app-planning/archive/progress-phases-11-13.txt` (phases 11–13); reach for these when the summary compresses away a "why" you need. `app-planning/archive/` also holds the completed PRDs that drove earlier phases — `PRD.md` (1–6), `Reson8_Evolutions_PRD.md` (7), `Reson8_Improvements_PRD.md` (8), `Reson8_NextSteps_PRD.md` (9, 15 items — per-user voice controls, mute/deafen status icons, channel rename/reorder/NSFW, custom emoji uploads, message edit/delete, unread indicators, nudge), `Reson8_Phase10_PRD.md` (10, 6 items — auto-updater, audio settings, mute/deafen accumulation, and three bugfixes), `Reson8_Phase11_PRD.md` (11, 5 items — voice-disconnect and session-timer fixes, emoji picker custom-tab visibility, a post-update "what's new" modal, and pinned messages in text channels), `Reson8_Phase12_PRD.md` (12, 14 items — screen sharing with native per-app audio capture, VP9 SVC pipeline, a pop-out Viewer window, LIVE badges, and a server-wide toggle), and `Reson8_Phase13_PRD.md` (13, 18 items from `app-planning/nextsteps.txt` — AI noise cancelling, a noise-gate/mic-volume rework, several chat/emoji polish items, screen-share sound alerts, moving Ban into a renamed "User Management" tab, and a single-instance app lock) — all fully implemented, kept for historical rationale rather than active reference. There is no active phase PRD right now — the next one will be drafted when new requirements come in. Release notes live in `app-planning/releases/` (one file per version); use `/bump-version` to cut a new one.

**Every feature or bugfix gets an entry appended to `app-planning/progress.txt`** in the established format (`--- Entry: DD/MM/YYYY ---`, followed by Feature/Fix name, Problem, Solution, Key Files Modified, Verification, Next Step) — use the `/log-progress` slash command to do this. This was an explicit, repeated requirement in the project's own PRDs, and remains the working convention going forward even though those PRDs are now archived — treat it as part of finishing the task, not optional cleanup. If `progress.txt` itself grows unwieldy again, repeat this same archive-and-summarize pattern rather than letting it grow unbounded.
