# Reson8 — Phase 18 PRD

**Created:** 10/10/2026
**Author:** Felipe B. Netto (assisted by AI)
**Status:** Draft — awaiting the user's review before implementation starts
**Source:** `app-planning/nextsteps.txt` (the 9 open risks carried over from Phase 17) + one UX fix requested by the user during planning (PRD 18.12: the chat jumping around while link previews load) + six items added by the user after the first draft (PRD 18.14–18.19)
**Branch:** `phase18-go`

---

## Table of Contents

0. [How to Execute This PRD (read before starting any item)](#how-to-execute-this-prd-read-before-starting-any-item)
1. [PRD 18.1 — Chore: Working ESLint Setup (`npm run lint`)](#prd-181--chore-working-eslint-setup-npm-run-lint)
2. [PRD 18.2 — Security: Server-Side TLS, Reverse Proxy and Trusted Client Addresses](#prd-182--security-server-side-tls-reverse-proxy-and-trusted-client-addresses)
3. [PRD 18.3 — Security: Encrypted Connections in the Client (HTTPS First, Trusted Self-Signed Certificates, Lock Indicator)](#prd-183--security-encrypted-connections-in-the-client-https-first-trusted-self-signed-certificates-lock-indicator)
4. [PRD 18.4 — Security: Identity Log and a "Require Signed Identity" Switch](#prd-184--security-identity-log-and-a-require-signed-identity-switch)
5. [PRD 18.5 — Security: Allowed Connection Names Managed in Settings (Challenge-Relay Protection)](#prd-185--security-allowed-connection-names-managed-in-settings-challenge-relay-protection)
6. [PRD 18.6 — Security: Identity Key Encrypted at Rest + Passphrase-Protected Backup](#prd-186--security-identity-key-encrypted-at-rest--passphrase-protected-backup)
7. [PRD 18.7 — Feat: Address (IP / Range) Bans](#prd-187--feat-address-ip--range-bans)
8. [PRD 18.8 — Feat: "Approve New Users" Mode](#prd-188--feat-approve-new-users-mode)
9. [PRD 18.9 — Feat: Invite Codes for New Users](#prd-189--feat-invite-codes-for-new-users)
10. [PRD 18.10 — Fix: Link-Preview Hardening (Size Cap, Caches, Private Networks, Direct Images, On/Off Switch)](#prd-1810--fix-link-preview-hardening-size-cap-caches-private-networks-direct-images-onoff-switch)
11. [PRD 18.11 — Feat: Blur Link Previews in NSFW Channels and for Adult Content](#prd-1811--feat-blur-link-previews-in-nsfw-channels-and-for-adult-content)
12. [PRD 18.12 — Fix: Chat Stays Put While Link Previews and Images Load](#prd-1812--fix-chat-stays-put-while-link-previews-and-images-load)
13. [PRD 18.13 — Feat: Unread Indicator and "See More" Collapse for DM Tabs](#prd-1813--feat-unread-indicator-and-see-more-collapse-for-dm-tabs)
14. [PRD 18.14 — Fix: X/Twitter Links Lose Their Video (fxtwitter Fixer)](#prd-1814--fix-xtwitter-links-lose-their-video-fxtwitter-fixer)
15. [PRD 18.15 — Fix: Same "Category" Badge on Every Parent Channel (Text and Voice)](#prd-1815--fix-same-category-badge-on-every-parent-channel-text-and-voice)
16. [PRD 18.16 — Chore: Center the App Description in Settings → About](#prd-1816--chore-center-the-app-description-in-settings--about)
17. [PRD 18.17 — Fix: Users Without Any Role Vanish From User Management](#prd-1817--fix-users-without-any-role-vanish-from-user-management)
18. [PRD 18.18 — Feat: Removing the "Member" Role Actually Restricts the User](#prd-1818--feat-removing-the-member-role-actually-restricts-the-user)
19. [PRD 18.19 — Fix: Link-Preview Videos Can't Go Fullscreen or Seek; Preview Images Open in the Image Viewer](#prd-1819--fix-link-preview-videos-cant-go-fullscreen-or-seek-preview-images-open-in-the-image-viewer)
20. [Cross-Cutting Dependencies & Recommended Implementation Order](#cross-cutting-dependencies--recommended-implementation-order)
21. [Compatibility Summary](#compatibility-summary)
22. [Open Decisions Confirmed With the User](#open-decisions-confirmed-with-the-user)
23. [Pre-Existing Issues Noticed During the Audit](#pre-existing-issues-noticed-during-the-audit)
24. [Mapping to `nextsteps.txt`](#mapping-to-nextstepstxt)

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
> (SemVer: this phase adds user-facing features, additive DB migrations and
> additive wire-format fields/events; every new server restriction — TLS-only,
> approval, invites, address bans, required signatures, allowed hosts — is opt-in
> and off by default, so v2.6.0 clients keep working against a default v2.7.0
> server. A **minor** bump to `2.7.0` is expected, pending the skill's own check),
> write the release notes into `app-planning/releases/`, and update all three
> `AGENTS.md` files (the `CLAUDE.md` files only import them) plus `README.md` to reflect the final Phase 18 feature set.
>
> **Non-regression rule:** no item may change behavior outside its stated scope.
> Each item's "Regression Risk" section lists exactly what it touches. Verification
> for every item always includes `npx tsc --noEmit`/`--build` in each affected
> workspace (shared-types → server → client, in that order), `npm run lint` from
> the repo root once PRD 18.1 has landed, `npm run test` for server items, and
> `npm run test:markdown` (in `apps/client`) for any item that touches message
> rendering. Where an item changes real UI behavior, Claude also drives the built
> app headlessly (the Phase 16 recipe in `apps/client/AGENTS.md`: Xvfb +
> `--user-data-dir` + DevTools protocol, screenshots inspected) before handing it
> to the user for hand-testing. Where an item changes a migration, it is verified on
> a throwaway database exactly as `apps/server/AGENTS.md` describes — never with
> `migrate dev` against the dev database.

> [!NOTE]
> This PRD was written after reading every `nextsteps.txt` item and auditing the
> code each one touches: `preload.ts` (`connect()`, upload plumbing), `renderer.ts`
> (`parseServerUrl()`, the link-preview card, NSFW blur, the scroll/jump helpers,
> DM tabs and unread handling, truncation), `main.ts` (link-preview fetching, window
> and session setup), `identity-key.ts`, `preload-viewer.ts`, `index.html`,
> `connection.handler.ts` (join path, client address), `dm.handler.ts`,
> `nudge.handler.ts` (server settings), `schema.prisma`, `index.ts` (Fastify /
> Socket.io bootstrap), the Docker Compose files and the installed
> `engine.io-client`. File paths and line numbers reflect the code as of
> 10/10/2026 (branch `phase18-go`, v2.6.0); they *will* drift between items that
> edit the same regions of `renderer.ts` — re-check before editing.
> Eleven design decisions were resolved directly with the user (see
> [Open Decisions](#open-decisions-confirmed-with-the-user)); the remaining
> reasonable-default assumptions are listed there too. Flag anything you'd rather
> change before implementation starts.

> [!NOTE]
> **Archiving:** every completed PRD (phases 1–17) was already in
> `app-planning/archive/` when this phase started (`Reson8_Phase17_PRD.md` was
> archived by the v2.6.0 release work), so no archive move was needed. This file
> lives at `app-planning/Reson8_Phase18_PRD.md` while active and gets moved to
> `archive/` when Phase 18 wraps up.

> [!NOTE]
> **Two facts found during the audit shape several items:**
> 1. **The preload's Socket.io connection does NOT use Chromium's network stack.**
>    `preload.ts` loads `socket.io-client` with `require()`, which resolves
>    `engine.io-client`'s Node build (`build/cjs/transports/websocket.node.js`), which
>    opens the WebSocket with the **`ws` package over Node's TLS**. Uploads (`fetch`
>    in the preload), `<img>`/`<video>` media and the Viewer's media go through
>    **Chromium**. So any certificate rule (PRD 18.3) must be applied to *both*
>    stacks or they will disagree (the socket connects but images are broken, or
>    vice versa). `engine.io-client` forwards `ca`, `rejectUnauthorized` and
>    `checkServerIdentity` to `ws`, which is what makes this possible.
> 2. **The server trusts forwarded-address headers from anyone.**
>    `connection.handler.ts:~268` takes `cf-connecting-ip`, then `x-forwarded-for`,
>    then the socket address. Any client can send those headers and choose the
>    address the server logs. That's harmless today (logs only) but would make
>    address bans (18.7) and the identity log (18.4) trivially spoofable, so PRD
>    18.2 fixes it first with an explicit `TRUST_PROXY` setting.

---

## How to Execute This PRD (read before starting any item)

Each item has: the problem, the design (**what** and **why**), **Implementation Steps** (**how**, in order), **Pitfalls**, **Regression Risk**, **Verification** and a **Done When** checklist. Follow the steps in order. If reality contradicts a step (a function was renamed, a line moved, a Step 0 shows a different cause), **stop and re-plan that step from the code**. If the contradiction changes user-visible behavior or scope, **ask the user** before continuing.

### The per-item routine (every item, no exceptions)

1. `git status` must be clean (the previous item is committed). Read the item fully, then its "Read first" files **completely** around the named functions. Line numbers in this PRD are approximate (`~`); always locate code by searching for the function name.
2. If the item has a **Step 0**, do it first and write down its findings before writing any fix.
3. Change order across workspaces: **`packages/shared-types` → build it (`npx tsc --build`) → `apps/server` → `apps/client`.**
4. Prisma changes: edit `schema.prisma` → generate the migration SQL with `prisma migrate diff` (never `migrate dev` against the dev DB) → `npm run db:generate` → verify the migration on a throwaway database, exactly as `apps/server/AGENTS.md` describes.
5. After the code: `npx tsc --noEmit` (or `--build`) in each touched workspace; `npm run lint` at the root (from 18.1 on); `npm run test` in `apps/server` if the server changed; every relevant `npm run test:*` in `apps/client`; the item's own Verification list; headless UI checks for anything visible (Phase 16 recipe in `apps/client/AGENTS.md`, screenshots **looked at**).
6. `/log-progress` with: what was built, Step 0 findings, deviations from this PRD (and why), test evidence, open questions.
7. `git add` only the files of this item (never `git add -A` blindly; check `git status` for stray scratch files) → commit with a conventional message (`feat:`, `fix:`, `security:`, `chore:` + "(PRD 18.x)") and the attribution trailer → **do not push** → stop and wait for the user.

### Project rules that apply to every item

- **Never trust the client:** user ids come from `socket.data.userId` (after join) or server-issued tickets, never from payloads; file URLs/public_ids are never accepted from clients (the stored-file ledger); permission checks run in the server handler, the UI hiding a button is only cosmetic.
- **Validate every payload field** in handlers (`typeof`, length bounds, enums) and every IPC argument in `main.ts`.
- **CommonJS gotcha:** anything imported by `main.ts`/`preload.ts`/`voice.service.ts` must have a real CommonJS build (check `type`/`exports` with `npm view` before installing).
- **The renderer is a classic script** without imports: pure modules reach it through the preload (`reson8Api`); duplicated small helpers in the renderer are acceptable (and must be kept in sync, with a comment saying where the original lives).
- **DOM safety:** dynamic text goes through `textContent`; any `innerHTML` with dynamic parts uses `escapeHtml`; `showToast` uses `innerHTML`, so escape what you pass it.
- **`localStorage`:** keys start with `reson8-`; every read/write is in `try/catch`; defaults apply when the value is missing or unreadable.
- **Message DOM:** anything that inserts or removes `.chat-msg` calls `applyGrouping()`/`regroupFrom()`; message text only through `setMessageBody()`; file URLs from the server through `resolveMediaUrl()` in the preload.
- **`userId`-keyed teardown** in disconnect paths goes through `SocketOwnership`.
- **Shared types first** for any wire change; additive fields are optional (`?`) so older clients/servers keep working.
- **No silent behavior changes** outside the item's scope; if you notice a bug elsewhere, write it down in the progress entry instead of fixing it.
- **Comments:** match the surrounding density; reference the PRD number (`// PRD 18.x`) where a decision would otherwise look arbitrary.

### Shared definition of done (in addition to each item's "Done When")

- [ ] All typechecks, `npm run lint`, server tests and relevant client smoke tests pass; outputs pasted into the progress entry (summarized).
- [ ] Every Verification bullet was actually run, or explicitly marked "user to verify by hand" with the reason (e.g. needs Windows, needs a real keyring).
- [ ] No unrelated files changed; no debug logging left; no scratch files committed.
- [ ] Progress entry written, local commit made, nothing pushed, waiting for the user.

---

## PRD 18.1 — Chore: Working ESLint Setup (`npm run lint`)

**Type:** 🧹 CHORE
**Priority:** Medium (it goes first so every later item is linted as it's written)
**Affected Components:** root `package.json` (script + devDependencies), a new root `eslint.config.mjs`, small mechanical fixes across the workspaces, root `AGENTS.md` (the "BROKEN" note becomes a verification step).

### Current Behavior

The root script is `"lint": "eslint . --ext .ts,.tsx"`, but `eslint` is not installed anywhere, so `npm run lint` fails with "command not found". The `--ext` flag also no longer exists in flat-config ESLint (ESLint 10, current as of 10/10/2026, supports *only* flat config). Prettier is installed but has no config file (it runs with defaults); `npm run format` works.

### Goal

`npm run lint` runs ESLint over the whole monorepo and exits **0** on the current code, using the community-standard setup for a TypeScript project in 2026: ESLint flat config + `typescript-eslint` + `eslint-config-prettier`. It becomes part of the verification step for every later item.

### Design

- **Dependencies (root `devDependencies`, exact versions checked with `npm view` at implementation time, latest stable):** `eslint`, `@eslint/js`, `typescript-eslint`, `globals`, `eslint-config-prettier`. Versions seen on 10/10/2026: `eslint@10.12.0` and `@eslint/js@10.0.1` (both need Node `^20.19 || ^22.13 || >=24`), `typescript-eslint@8.71.1` (supports `eslint ^10` and TypeScript `<6.1`; the repo uses TS 5.9.3), `globals@17`, `eslint-config-prettier@10`. If the developer's Node is older than 20.19, ESLint 10 refuses to run: document the requirement in the README instead of downgrading. These are dev-only tools: nothing is imported from `main.ts`/`preload.ts`, so the CommonJS/ESM-only gotcha does not apply.
- **`eslint.config.mjs` (root):**
  - `ignores`: `**/dist/**`, `**/release/**`, `**/node_modules/**`, `apps/client/assets/**` (vendored DeepFilterNet/fonts), `packages/native-audio/**` build output and `*.node`, `apps/server/prisma/migrations/**`, generated Prisma client.
  - `js.configs.recommended` + `tseslint.configs.recommended` (**not** the type-checked preset: a type-aware run over a ~10k-line `renderer.ts` is slow and would flood the first run; it can be a later opt-in).
  - Per-area `languageOptions.globals`: `globals.node` for `apps/server/**`, `apps/client/src/main.ts`, `apps/client/src/*.ts` (main/preload/pure modules), `apps/client/scripts/**`, root `scripts/**`; `globals.browser` for `apps/client/src/renderer/**` (+ `globals.node` for the preloads, which have both).
  - The renderer is a **classic script** (not a module) on purpose — functions are called from `Runtime.evaluate` in headless tests and many top-level declarations look "unused" to a module-oriented linter. Configure `no-unused-vars` for it accordingly (see rules) rather than restructuring it.
  - Rules: `@typescript-eslint/no-explicit-any: "warn"` (the codebase uses `any` at IPC/socket boundaries deliberately); `@typescript-eslint/no-unused-vars: ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }]`; `no-empty: ["error", { allowEmptyCatch: true }]` (the codebase uses `catch { /* best effort */ }` intentionally); `@typescript-eslint/no-require-imports: "off"` for the `.cjs`/preload files that legitimately `require()`; `eslint-config-prettier` **last** so formatting rules never fight Prettier.
- **Scripts:** root `"lint": "eslint ."`, plus `"lint:fix": "eslint . --fix"`.
- **Fixing the first run:** errors must reach **0**; warnings are allowed and reported in the progress entry (count by rule). Only **behavior-preserving** fixes are made (e.g. `let` → `const`, removing a truly dead import, `@ts-ignore` → `@ts-expect-error` where the error still exists). Anything that would change behavior is **not** fixed silently: it is listed in the progress entry and, if it looks like a real bug, raised with the user. If a rule produces many errors that are all deliberate project patterns, it is downgraded to `warn` or turned off with a one-line comment in the config explaining why — never sprinkled with `eslint-disable` comments across files.
- **No mass reformatting:** this item does not run `npm run format` over the repo (a huge whitespace-only diff would bury real changes in `git blame`). A `.prettierrc.json` capturing the current de-facto style (4-space indent, double quotes, semicolons, `printWidth` 120 — verified against the existing files first) is added so future `format` runs don't drift; running it repo-wide is left to the user.

### Implementation Steps (do them in this order)

1. **Check the toolchain.** `node -v` must be ≥ 20.19 (ESLint 10). Run `npm view eslint version engines`, `npm view typescript-eslint version peerDependencies` and record the versions you will pin.
2. **Install at the root only** (they are workspace-wide dev tools): `npm install -D -w . eslint @eslint/js typescript-eslint globals eslint-config-prettier` (or `npm install -D <pkgs>` from the repo root, without `-w`). Confirm `package.json` → `devDependencies` gained exactly those five and `package-lock.json` changed. Do **not** add them to `apps/*/package.json`.
3. **Create `eslint.config.mjs` at the repo root.** Skeleton (adjust paths only after checking them with `ls`):
   ```js
   // @ts-check
   import js from "@eslint/js";
   import tseslint from "typescript-eslint";
   import globals from "globals";
   import prettier from "eslint-config-prettier";

   export default tseslint.config(
     { ignores: ["**/dist/**", "**/release/**", "**/node_modules/**", "apps/client/assets/**",
                 "apps/server/prisma/migrations/**", "packages/native-audio/target/**", "**/*.node",
                 "**/*.d.ts" /* generated declaration output */] },
     js.configs.recommended,
     ...tseslint.configs.recommended,
     {
       rules: {
         "@typescript-eslint/no-explicit-any": "warn",
         "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
         "no-empty": ["error", { allowEmptyCatch: true }],
       },
     },
     { files: ["apps/server/**", "apps/client/src/*.ts", "apps/client/scripts/**", "apps/server/scripts/**", "scripts/**", "packages/**"],
       languageOptions: { globals: { ...globals.node } } },
     { files: ["apps/client/src/renderer/**"], languageOptions: { globals: { ...globals.browser } } },
     { files: ["apps/client/src/preload*.ts"], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
     { files: ["**/*.cjs", "apps/client/src/preload*.ts"], rules: { "@typescript-eslint/no-require-imports": "off" } },
     prettier, // LAST: turns off every stylistic rule Prettier owns
   );
   ```
   Check before relying on it: does `packages/native-audio` contain JS/TS sources (only `index.js`/`index.d.ts` generated by NAPI-RS?) — if generated, add it to `ignores`. Does any `.d.mts` file exist (`apps/server/scripts/prune-orphan-uploads.d.mts`)? It's hand-written: lint it.
4. **Fix the scripts** in the root `package.json`: `"lint": "eslint ."`, add `"lint:fix": "eslint . --fix"`.
5. **First run:** `npm run lint > /tmp/lint-first.txt; echo $?`. Summarize with `npx eslint . -f json | node -e '…count by ruleId and severity…'` (write the one-off counter in the scratchpad, not in the repo).
6. **Triage errors, rule by rule** (never file by file):
   - For each rule with errors, open 3 samples. If they're real problems → fix them all. If they're deliberate project patterns (e.g. `no-useless-escape` inside regexes copied from specs, `prefer-const` false positives don't exist — fix those) → set the rule to `"warn"` or `"off"` **in the config** with a `// why:` comment.
   - Safe autofix: run `npx eslint . --fix --rule '{"prefer-const":"error"}'`-style targeted fixes only for rules whose autofix is purely syntactic (`prefer-const`, `no-extra-boolean-cast`, `@typescript-eslint/no-inferrable-types`). **Never** run a blanket `--fix`.
   - `@typescript-eslint/no-unused-vars` in `renderer.ts`: the renderer is a classic script whose top-level functions are called from `index.html`'s inline handlers or from DevTools tests; a function flagged unused is **not** deleted unless `grep -rn "<name>" apps/client/src` shows no use at all (including in `index.html`). Report such candidates in the progress entry instead of deleting them.
   - `@ts-ignore` → `@ts-expect-error` (`ban-ts-comment`): only where removing the comment makes `tsc` fail (check). Where the comment is no longer needed, delete it.
7. **Re-run everything:** `npm run lint` (exit 0), `npx tsc --build` in `packages/shared-types`, `apps/server`, `apps/client`; `npm run test` in `apps/server`; every `test:*` in `apps/client`.
8. **Add `.prettierrc.json`** only after measuring the current style: `grep -c '^    ' apps/server/src/index.ts` (4-space), quote style (`grep -c "\"" vs "'"` in a few files), semicolons, and the longest common line length (`awk '{ if (length>120) n++ } END {print n}'` over `apps/**/src/*.ts`). Use the values found; don't guess. Do **not** run `npm run format`.
9. **Docs:** root `AGENTS.md` — replace the "BROKEN" lint line with `npm run lint # ESLint 10 flat config (eslint.config.mjs); must exit 0`, and add `npm run lint` to the "verification step" paragraph. README → "Development" / prerequisites: Node ≥ 20.19 for linting.
10. `/log-progress` (include: versions pinned, the warnings-by-rule table, rules downgraded and why, any suspected bugs found but not fixed), commit, stop.

### Pitfalls

- ESLint 10 ignores `.eslintignore` and `--ext`; everything is in `eslint.config.mjs`.
- `tseslint.config()` is a helper that flattens arrays — keep the spread `...tseslint.configs.recommended`.
- Linting `dist/` doubles every finding and flags compiled code: confirm `ignores` covers every `dist` (`find . -name dist -not -path '*/node_modules/*'`).
- Don't enable type-aware presets: they need `parserOptions.projectService` and make the run slow; out of scope.
- A lint "fix" that changes runtime behavior (removing a "useless" `await`, reordering, deleting an "unused" variable that has a side-effecting initializer) is forbidden in this item.

### Done When

- [ ] `npm run lint` exits 0 from the root; warnings summarized in the progress entry.
- [ ] All typechecks and all existing tests pass; the client still launches and chats (headless smoke).
- [ ] No file outside the config/package files changed except for behavior-preserving fixes, each listed by rule in the progress entry.

### Regression Risk

Low, but `--fix` style edits touch many files. Mitigation: run `eslint --fix` only for the explicitly safe rules, review the diff, and re-run all typechecks plus every existing test (`npm run test` in the server, all `test:*` scripts in the client) after the fixes. The renderer must still build and launch (headless smoke: connect, open a channel, send a message).

### Verification

- `npm run lint` exits 0 from the repo root; output summarized (warnings by rule).
- `npx tsc --build` in shared-types, server, client; `npm run test` (server); `npm run test:markdown`, `test:avatar`, `test:soft-clip`, `test:link-fixers`, `test:identity` (client).
- Headless smoke run of the built client against a local server.
- Root `AGENTS.md`: the "BROKEN" lint note replaced with the new command and its place in the verification step.

---

## PRD 18.2 — Security: Server-Side TLS, Reverse Proxy and Trusted Client Addresses

**Type:** 🔒 SECURITY
**Priority:** High
**Affected Components:** `apps/server/src/index.ts`, a new `apps/server/src/config/tls.config.ts`, a new `apps/server/src/services/client-address.ts`, `connection.handler.ts` (client address), `.env.example`, new `docker-compose.caddy.yml` + `deploy/caddy/Caddyfile`, `docker-compose.yml` (env passthrough), README.

### Current Behavior

- The server only speaks plain HTTP/WS (`app.listen()` with no TLS). Unless a self-hoster puts something in front of it, chat, DMs, the server password, upload tokens and the whole Socket.io session travel in clear text. (Voice/screen-share **media** is already encrypted end-to-server by WebRTC's DTLS-SRTP; this item is about everything else.)
- The client address used in logs is taken from `cf-connecting-ip` / `x-forwarded-for` **from any client** (`connection.handler.ts:~268`), so it can be forged. Fastify itself has no `trustProxy` set, so `request.ip` on HTTP routes is the proxy's address behind a proxy.

### Goal

Two supported ways to serve Reson8 over TLS, and a client address that can be trusted:

1. **Recommended for internet-facing servers — Caddy reverse proxy** (automatic Let's Encrypt certificates, renewals, HTTP/2/3, WebSocket proxying out of the box).
2. **Native TLS in the server** for LAN or self-signed setups, with certificate hot-reload.
3. **`TRUST_PROXY`**: forwarded headers are honored **only** from configured proxy addresses.

### Design

**Native TLS (`tls.config.ts`):**
- New optional env `TLS_CERT_FILE` and `TLS_KEY_FILE` (PEM; the cert file may hold the full chain). Both set → HTTPS/WSS; neither → plain HTTP (today's behavior); only one set → **fail fast at startup** with a clear message.
- `Fastify({ https: { key, cert } })` — Socket.io attaches to `app.server`, which is then the HTTPS server, so nothing else changes. `minVersion: "TLSv1.2"` (Node's default, stated explicitly).
- **Hot reload:** `fs.watch` both files (debounced 1 s, plus a 12 h safety re-read) → on a change, read both, validate them by building a context with `tls.createSecureContext()` first, and only then `app.server.setSecureContext({ key, cert })`. A failed reload is logged and the old certificate stays in use. This lets certbot/acme.sh renew without a restart.
- Startup log states the mode: `TLS: native (cert CN=…, expires …)`, `TLS: off — put a reverse proxy in front or set TLS_CERT_FILE/TLS_KEY_FILE`.
- **Self-signed certificates for LAN:** documented `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -days 825 -nodes -subj "/CN=reson8" -addext "subjectAltName=DNS:reson8.lan,IP:192.168.0.10" …` recipe in the README (SANs must list every name/IP clients type). Clients trust it through PRD 18.3's trust-on-first-use prompt.

**Caddy (`docker-compose.caddy.yml` + `deploy/caddy/Caddyfile`):**
- Override file adding a `caddy` service (official `caddy:2` image, pinned to a current 2.x tag at implementation time), ports `80`, `443`, `443/udp`, volumes for `/data` and `/config` (certificates persist across restarts).
- `Caddyfile`: `{$RESON8_DOMAIN} { encode zstd gzip  reverse_proxy reson8-server:9800 }` — Caddy proxies WebSockets automatically and sets `X-Forwarded-For`/`X-Forwarded-Proto`.
- The override sets `TRUST_PROXY` on `reson8-server` to the Docker network range so the real client address is used.
- The mediasoup UDP/TCP ports stay published directly (media never goes through Caddy).
- Port `9800` stays published by default **during the transition** so v2.6.0 clients (which only speak `http://`) keep working; the README says to remove that mapping once everyone runs ≥ 2.7.0.
- README: prerequisites (a domain pointing at the server, ports 80/443 open), `RESON8_DOMAIN=chat.example.com docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d`, plus short nginx notes (`proxy_set_header Upgrade/Connection` for WebSockets, `proxy_set_header Host $host`, `X-Forwarded-For`) for people who already run nginx. Cloudflare Tunnel users already get HTTPS at the edge and need no change besides `TRUST_PROXY`.

**Trusted client address (`client-address.ts`):**
- New env `TRUST_PROXY`: unset/`false` (default) → never trust forwarded headers; `true` is **refused** (trusting every hop would make the address client-controlled again — a warning is logged and nothing is trusted); otherwise a comma-separated list of addresses/CIDRs or the `proxy-addr` keywords `loopback`, `linklocal`, `uniquelocal` (Docker networks are `uniquelocal`).
- One pure function `resolveClientAddress(remoteAddress, headers, trust)` built on `@fastify/proxy-addr` (the fork Fastify 5 itself depends on — `node_modules/@fastify/proxy-addr`, v5.1.0 on 10/10/2026; same API as the classic `proxy-addr`: `proxyaddr(req, trust)`, `proxyaddr.compile(list)`, where `req` only needs `{ socket: { remoteAddress }, headers }`); add it as a **direct** dependency of `apps/server` so it isn't relied on transitively: walks `X-Forwarded-For` from the right, stopping at the first untrusted hop. `CF-Connecting-IP` is honored **only** when the immediate peer is trusted. IPv4-mapped IPv6 (`::ffff:1.2.3.4`) is normalized to IPv4.
- Fastify gets the same setting via its `trustProxy` option (so HTTP routes agree with sockets).
- `connection.handler.ts` stores the result once in `socket.data.clientAddress` (new `SocketData` field), and every later use (logs, 18.4, 18.7, 18.8) reads it from there.
- **Behavior change to call out in the release notes:** behind a proxy without `TRUST_PROXY`, logs now show the proxy's address instead of the forwarded one. That's the safe default; the README explains how to set it.

### Edge Cases

- Native TLS **and** a reverse proxy at once: allowed (proxy → HTTPS upstream), documented as unnecessary.
- `HOST=0.0.0.0` with a cert for a domain: unchanged — certificate name checks are the client's job.
- Certificate files unreadable at startup → exit with a clear error (never silently fall back to plain HTTP, which would downgrade a server the admin believes is encrypted).

### Implementation Steps (do them in this order)

1. **Read first:** `apps/server/src/index.ts` (whole file), `connection.handler.ts` lines around `clientAddress` (~265–272), `.env.example`, `docker-compose.yml`, `docker-compose.cloudflared.yml`, `packages/shared-types/src/socket-events.ts` (`SocketData`).
2. **shared-types:** add to `SocketData`: `/** Client address after TRUST_PROXY rules (PRD 18.2). */ clientAddress?: string;`. Build: `cd packages/shared-types && npx tsc --build`.
3. **`apps/server/src/services/client-address.ts` (pure):**
   ```ts
   import proxyaddr from "@fastify/proxy-addr";
   export type TrustFn = (addr: string, hopIndex: number) => boolean;
   /** Parses TRUST_PROXY: unset/""/"false" → trust nothing; "true" → reject (too broad, log a warning and trust nothing);
    *  otherwise a comma list of IPs/CIDRs/keywords (loopback, linklocal, uniquelocal). */
   export function parseTrustProxy(raw: string | undefined): { trust: TrustFn; description: string; list: string[] };
   export function normalizeAddress(addr: string): string; // "::ffff:1.2.3.4" → "1.2.3.4"; strips IPv6 zone ids
   export function resolveClientAddress(remoteAddress: string, headers: Record<string, string | string[] | undefined>, trust: TrustFn): string;
   ```
   - `resolveClientAddress`: if `trust(remoteAddress, 0)` is false → return `normalizeAddress(remoteAddress)` (headers ignored). Else if `cf-connecting-ip` is a single valid IP (`net.isIP`) → return it normalized. Else → `proxyaddr({ socket: { remoteAddress }, headers } as any, trust)` normalized.
   - **Decision on `TRUST_PROXY=true`:** refuse it (trusting every hop makes `X-Forwarded-For` client-controlled again). Log `TRUST_PROXY=true is not supported — list your proxy addresses (e.g. "loopback, uniquelocal")` and trust nothing.
4. `npm install -w apps/server @fastify/proxy-addr` (check the version already in `node_modules/@fastify/proxy-addr` and pin the same major).
5. **Tests** `apps/server/src/__tests__/client-address.test.ts`: untrusted peer + forged XFF → peer; trusted loopback + `XFF: 203.0.113.9` → 203.0.113.9; trusted + `XFF: 1.1.1.1, 10.0.0.2` with `uniquelocal` trusted → 1.1.1.1 (walks right to left past trusted hops); `cf-connecting-ip` from untrusted peer ignored; from trusted peer honored; `::ffff:127.0.0.1` normalized; IPv6 `2001:db8::1` untouched; `TRUST_PROXY` parsing (unset, "false", "true" refused, "loopback, 172.16.0.0/12").
6. **Wire it in `index.ts`:** compute `const trustProxy = parseTrustProxy(process.env.TRUST_PROXY)` once; pass `trustProxy: trustProxy.list.length ? trustProxy.list : false` to `Fastify({...})`; log `Trust proxy: <description>` at startup.
7. **`connection.handler.ts`:** replace the current `clientAddress` expression with `resolveClientAddress(socket.handshake.address, socket.handshake.headers, trust)` and store `socket.data.clientAddress = clientAddress` at the top of the `connection` handler (before any event). Pass `trust` into `registerConnectionHandlers` (add a parameter; update the call in `index.ts`). Every later item reads `socket.data.clientAddress`.
8. **`apps/server/src/config/tls.config.ts`:**
   ```ts
   export interface TlsFiles { certFile: string; keyFile: string }
   /** null = TLS off. Throws (startup error) when only one of the two is set. */
   export function readTlsEnv(env = process.env): TlsFiles | null;
   export function loadTlsMaterial(files: TlsFiles): { key: Buffer; cert: Buffer; summary: string };
   // summary: "CN=…, SAN=…, expires 2027-01-01" via new crypto.X509Certificate(cert)
   ```
   `loadTlsMaterial` must validate with `tls.createSecureContext({ key, cert })` (throws on a mismatched pair) before returning.
9. **`index.ts`:** `const tlsFiles = readTlsEnv();` `const tlsMaterial = tlsFiles ? loadTlsMaterial(tlsFiles) : null;` → `Fastify({ logger, trustProxy, ...(tlsMaterial ? { https: { key: tlsMaterial.key, cert: tlsMaterial.cert, minVersion: "TLSv1.2" } } : {}) })`. TypeScript: Fastify's generics change with `https`; if typing fights you, type `app` as `FastifyInstance` explicitly (the rest of the code only uses the base interface) — check that `app.server` is still accepted by `new SocketIOServer(app.server, …)`.
10. **Hot reload** (new function in `tls.config.ts`, called after `listen`): `watchTlsFiles(files, onChange)` using `fs.watch` on the **directory** of each file (certbot replaces files via symlink swaps/renames, which a file-level watch misses), filter by basename, debounce 1 s, plus `setInterval(…, 12 * 3600_000).unref()`. On change: `loadTlsMaterial()` in `try`; success → `(app.server as https.Server).setSecureContext({ key, cert })` and log the new summary; failure → log error, keep the old context. Never crash.
11. **Startup log** exactly one line: `TLS: native (<summary>)` or `TLS: off — use a reverse proxy (see README) or set TLS_CERT_FILE/TLS_KEY_FILE`.
12. **`.env.example`**: a commented `# ── TLS & proxies (Reson8 2.7.0+) ──` block with `TLS_CERT_FILE`, `TLS_KEY_FILE`, `TRUST_PROXY`, each with a one-line explanation and an example. **`docker-compose.yml`**: pass through `TLS_CERT_FILE: "${TLS_CERT_FILE:-}"`, `TLS_KEY_FILE`, `TRUST_PROXY` (empty defaults) and document mounting a `./certs:/app/certs:ro` volume (commented example).
13. **Caddy:** `deploy/caddy/Caddyfile`:
    ```
    {$RESON8_DOMAIN} {
        encode zstd gzip
        reverse_proxy reson8-server:9800
    }
    ```
    `docker-compose.caddy.yml`: service `caddy` (`image: caddy:2.<current minor>` — look up the current tag on Docker Hub, never `latest`), `restart: unless-stopped`, ports `80:80`, `443:443`, `443:443/udp`, volumes `./deploy/caddy/Caddyfile:/etc/caddy/Caddyfile:ro`, `caddy_data:/data`, `caddy_config:/config`, `environment: RESON8_DOMAIN: "${RESON8_DOMAIN:?set RESON8_DOMAIN}"`, `depends_on: [reson8-server]`; and an override of `reson8-server.environment.TRUST_PROXY: "uniquelocal"`. Validate with `RESON8_DOMAIN=example.com docker compose -f docker-compose.yml -f docker-compose.caddy.yml config`.
14. **README:** new section "🔒 Encryption (HTTPS)" with three subsections — *Caddy (recommended)*, *Native TLS (LAN / self-signed)* with the `openssl req` recipe, *Cloudflare Tunnel / nginx* (nginx block with `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`) — plus *Trusting your proxy* (`TRUST_PROXY`) and the transition note (keep 9800 open until clients are ≥ 2.7.0).
15. Verification (below), `/log-progress`, commit, stop.

### Pitfalls

- Don't call `app.listen()` with `https` *and* also create another server: Fastify creates the HTTPS server itself.
- `fs.watch` fires several events per write; debounce, and re-read **both** files together (a renewal changes both).
- Never log key material or full certificate PEMs.
- A self-signed cert without the right SANs works for TOFU pinning (the pin replaces the name check, PRD 18.3) but not for browsers/curl — say so in the README.
- `TRUST_PROXY` must also be applied to Fastify (`trustProxy`) or `request.ip` on upload routes disagrees with socket addresses.

### Done When

- [ ] Without new env vars: server behaves exactly as before except forwarded headers are ignored.
- [ ] With cert env vars: HTTPS + WSS work end to end, renewal reload works without restart, a broken renewal keeps the old cert.
- [ ] `client-address` + TLS env tests pass; Caddy override validates and proxies a WebSocket session (`tls internal` local test).

### Regression Risk

With no new env vars set, the only change is the address logic (forwarded headers ignored by default). Upload routes, static `/uploads/`, health check and Socket.io are unchanged. Native TLS swaps the listening server type; every route is exercised in verification.

### Verification

- Unit tests (`client-address.test.ts`): spoofed `X-Forwarded-For` from an untrusted peer is ignored; a trusted proxy chain resolves the right hop; `CF-Connecting-IP` only from a trusted peer; IPv4-mapped normalization; IPv6.
- Unit test for the TLS env parsing (both / neither / only one).
- Live: boot the real server with a throwaway self-signed cert → `curl --cacert` the `/health` route, connect a Socket.io client over `wss://`, upload a file, fetch `/uploads/…`; replace the cert files on disk → the new certificate is served without a restart (checked with `openssl s_client`).
- Caddy: `docker compose config` validates the override; a local run with Caddy's internal CA (`tls internal`, documented as the local-test variant) proxies a WebSocket session end to end.
- `npm run test`, `npx tsc --noEmit` (server).

---

## PRD 18.3 — Security: Encrypted Connections in the Client (HTTPS First, Trusted Self-Signed Certificates, Lock Indicator)

**Type:** 🔒 SECURITY
**Priority:** High
**Affected Components:** `renderer.ts` (`parseServerUrl()`, connect button, status bar, a new trust modal, Settings → Application "Trusted certificates"), `index.html` (markup/CSS), `preload.ts` (`connect()` signature, socket options, `serverBaseUrl`), `preload-viewer.ts` (socket options), `main.ts` (connection probe, certificate store, `setCertificateVerifyProc`), a new pure `apps/client/src/tls-trust.ts`, a new main-only `apps/client/src/tls-store.ts`.

### Current Behavior

- `parseServerUrl()` (`renderer.ts:~1899`) **strips** any `https://`/`wss://` the user typed and `preload.ts:~448` always builds `http://host[:port]`. Typing `https://…` today silently connects over plain HTTP.
- `parseServerUrl()` splits on `:`, so an IPv6 address (`[::1]:9800`) cannot be entered.
- The renderer keeps its own copy, `serverBaseUrl = \`http://…\`` (`renderer.ts:~1936`).
- The Viewer window receives `serverBaseUrl` and opens its own socket (`preload-viewer.ts:~262`).

### Goal (user decisions)

- **HTTPS first, then HTTP:** an address typed **without a scheme** is tried over HTTPS first; if the server has no TLS at all, the client falls back to HTTP and says so. A server that has ever been reached over HTTPS is **never** silently downgraded afterwards (HSTS-style memory per server). An explicit `https://` or `http://` is always honored exactly (and `https://` never falls back).
- **Trust self-signed certificates on first use (TOFU, like SSH):** an unknown/self-signed certificate shows its fingerprint and can be trusted for that server. A **changed** certificate for a trusted server is refused with a clear warning.
- **Lock indicator + warning:** the status bar shows whether the connection is encrypted; connecting without TLS shows a one-time (per server) warning.

### Design

**Address parsing (`tls-trust.ts`, pure, unit-tested):**
- `parseServerAddress(raw)` → `{ scheme: "https" | "http" | null, host, port | undefined }` using the WHATWG `URL` parser (prefix `http://` internally when no scheme is present so `URL` accepts it). `wss://` → `https`, `ws://` → `http`. Bracketed IPv6 supported. Paths/queries are rejected with a validation message (Reson8 is served at the root). Empty host → error (today it silently defaulted to `localhost`).
- Default ports: none typed → `443` for HTTPS, `80` for HTTP (exactly today's HTTP behavior).
- `identityHost` for PRD 17.12 stays **scheme-less** `host[:port]` as typed, so existing key bindings and `AUTH_ALLOWED_HOSTS` entries keep matching.

**Connection probe (main process, `ipcMain.handle("probe-server", …)`):** decides the scheme *before* Socket.io connects, because the WebSocket error the preload would otherwise get can't tell "certificate untrusted" from "this port doesn't speak TLS".
- `tls.connect({ host, port, servername (omitted for IP literals), rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] })` with a 5 s timeout → read `authorized`, `authorizationError`, and the peer certificate (DER → SHA-256 fingerprint, subject/issuer/validity/SANs for display).
- Outcomes (error codes **verified on 10/10/2026 inside Electron 34's own Node 20.19.1/BoringSSL** with `ELECTRON_RUN_AS_NODE=1`: a plain-HTTP port fails with `ERR_SSL_WRONG_VERSION_NUMBER`; a self-signed certificate connects with `authorized: false`, `authorizationError: "DEPTH_ZERO_SELF_SIGNED_CERT"`; a closed port fails with `ECONNREFUSED`):
  - `authorized` (publicly trusted, name matches) → **https**.
  - Not authorized, and the host has a **pinned** fingerprint that matches → **https (pinned)**.
  - Not authorized, **no pin** → return `untrusted` with the certificate details → the renderer shows the **trust modal**.
  - Not authorized, pinned fingerprint **differs** → return `pin-mismatch` → hard error modal (no one-click bypass; the user must remove the old trust in Settings first — that's the SSH model).
  - TLS handshake fails because the port speaks plain HTTP (`EPROTO`/"wrong version number", `ECONNRESET` right after ClientHello) → `no-tls`.
  - `ECONNREFUSED`/timeout/DNS failure → `unreachable` (no scheme fallback: the same host:port is used for both schemes, so a refused port isn't a TLS question).
- Scheme decision (pure function `decideScheme(input, probe, memory)` in `tls-trust.ts`, unit-tested exhaustively like `decideIdentity()`): explicit `https` + `no-tls` → error "this server doesn't support encrypted connections"; no scheme + `no-tls` + host **not** remembered as HTTPS → **http** (with the warning); no scheme + `no-tls` + remembered → error "this server used to be encrypted — refusing to connect without encryption"; explicit `http` → no probe at all.
- No scheme and no port: probe `:443`; on `no-tls`/`unreachable` try plain `:80` (today's behavior for a port-less address).

**Trust store (`tls-store.ts`, main process only):** `<userData>/tls-trust.json` (written atomically: temp file + rename; validated on read, falls back to empty on corruption) holding `{ pins: { "host:port": { fingerprint256, subject, notAfter, pinnedAt, certPem } }, httpsHosts: { "host:port": lastSeenIso } }`. Renderer access only through narrow IPC: `tls-list-trusted`, `tls-trust-certificate` (only for a fingerprint the **last probe** of that host returned — the renderer can't inject arbitrary pins), `tls-remove-trust`.

**Making both network stacks agree (see the audit note above):**
- **Chromium** (uploads via `fetch`, `<img>`/`<video>`, emoji, channel icons, the Viewer window — all on `session.defaultSession`): `session.defaultSession.setCertificateVerifyProc((req, cb) => …)` → if Chromium already accepts the certificate (`req.verificationResult === "net::OK"`) → `cb(-3)` (use Chromium's verdict); else if `req.hostname` has a pin whose fingerprint equals SHA-256 of `req.certificate.data` (DER computed from the PEM) → `cb(0)`; else `cb(-3)`. Never accept anything that isn't pinned.
- **Node/`ws`** (the Socket.io connection in `preload.ts` and `preload-viewer.ts`): for a pinned host, pass `ca: [pinnedCertPem]` and `checkServerIdentity: (_host, cert) => sha256(cert.raw) === pin ? undefined : new Error("certificate changed")` through `io(url, { … })` (`engine.io-client` forwards both to `ws`). The PEM is fetched from main via IPC at connect time. Publicly trusted servers use the defaults (`rejectUnauthorized: true`). **Already verified on 10/10/2026** in Electron 34's Node with the `ws` version this repo installs (8.18.3): a self-signed leaf passed as its own `ca`, plus a fingerprint-comparing `checkServerIdentity`, connects over both `wss://127.0.0.1` and `wss://localhost` (cert with `IP:127.0.0.1` and `DNS:localhost` SANs), and a mismatching fingerprint is refused (`Error: pin mismatch`). Because `checkServerIdentity` is replaced, the hostname check is replaced by the fingerprint check — that is intended (the pin is stronger than a name match).
- Note: Node's TLS uses its bundled Mozilla CA list, not the OS store. A server using a private/corporate CA is therefore handled like a self-signed one (TOFU prompt) — documented.

**`connect()` changes:** `api.connect(address: { scheme, host, port }, nickname, password)`; the preload owns `serverBaseUrl` (`${scheme}://host[:port]`) and exposes `getServerBaseUrl()` so the renderer's duplicate `serverBaseUrl` assignment is removed (single source of truth). The Viewer gets the scheme-correct base URL and the pin over IPC (never via `additionalArguments`, per the Phase 17 rule — not secret, but kept consistent).

**UI:**
- **Trust modal** (`#tls-trust-modal`): "This server's certificate isn't signed by a known authority. Only trust it if you set up this server or its owner gave you this fingerprint." — host:port, SHA-256 fingerprint (grouped `AB:CD:…`, with a copy button), subject, valid-until, SANs. Buttons **Cancel** / **Trust and connect**. Cancel aborts the connect.
- **Changed-certificate modal**: red, states the old and new fingerprints and when the old one was trusted, explains it could be an attack or a server re-install, and points to Settings → Application → Trusted certificates. Only **Close**.
- **Status bar lock** next to the latency display: 🔒 "Encrypted connection" / 🔒 with a dot "Encrypted — certificate trusted by you (self-signed)" / ⚠️ "Not encrypted — messages can be read on the network". Tooltip on hover.
- **One-time HTTP warning** after connecting over HTTP: a toast-style dismissible banner "This connection isn't encrypted …" with "Don't warn me again for this server" (`reson8-tls-http-warning-dismissed`: `string[]` of host:port in `localStorage`, every access in `try/catch`).
- **Settings → Application → "Trusted certificates"**: list of pins (host:port, fingerprint prefix, pinned date, expiry) with **Remove**. Empty state text.
- Log lines in the Server Log tab: "Connecting to chat.example.com over HTTPS…", "No encryption available — connected over HTTP".
- "Remember Me" stores the raw address as typed (now possibly with a scheme), unchanged key.

### Edge Cases

- A server switches from HTTP to HTTPS: first HTTPS connect records it; from then on it can't be downgraded. Switching back to HTTP-only requires the user to type `http://` explicitly (documented).
- A pinned self-signed certificate legitimately renewed: the changed-certificate modal appears; the user removes the trust and reconnects → new TOFU prompt. (Recommend in the README: long-lived self-signed certs, or a real CA via Caddy.)
- Reconnects (Socket.io auto-reconnect) reuse the decided scheme/options; no new probe.
- Link previews (`main.ts` `fetch`) are unrelated (third-party sites) and keep Node's default verification.

### Implementation Steps (do them in this order)

1. **Read first:** `renderer.ts` `parseServerUrl()` (~1899) and the connect button handler (~1911–1937), every use of the renderer's `serverBaseUrl` (`grep -n serverBaseUrl renderer.ts`), `preload.ts` `connect()` (~437) and `resolveMediaUrl`/`uploadTo` (uses of `serverBaseUrl`), `preload-viewer.ts` (`readArg`, the `io()` call ~262), `main.ts` around `open-screen-share-viewer` (~1100–1160) and the permission/session setup (~495–560).
2. **`apps/client/src/tls-trust.ts` (pure, no Electron imports):**
   ```ts
   export type Scheme = "https" | "http";
   export interface ServerAddress { scheme: Scheme | null; host: string; port: number | undefined } // host: no brackets
   export function parseServerAddress(raw: string): { ok: true; value: ServerAddress } | { ok: false; error: string };
   export function hostKey(host: string, port: number): string;            // "chat.example.com:443", "[::1]:9800"
   export function identityHostOf(a: ServerAddress): string;              // EXACTLY what 2.6.0 signed: host[:port] as typed, IPv6 in brackets
   export type ProbeResult =
     | { kind: "trusted"; cert: CertInfo } | { kind: "untrusted"; cert: CertInfo; reason: string }
     | { kind: "no-tls" } | { kind: "unreachable"; code: string };
   export interface CertInfo { fingerprint256: string /* hex, lowercase, no colons */; subject: string; issuer: string; validTo: string; sans: string[] }
   export type SchemeDecision =
     | { action: "connect"; scheme: "https"; pinned: boolean } | { action: "connect"; scheme: "http"; warn: true }
     | { action: "ask-trust"; cert: CertInfo } | { action: "pin-mismatch"; cert: CertInfo; pinnedFingerprint: string }
     | { action: "error"; message: string };
   export function decideScheme(input: { explicit: Scheme | null; probe: ProbeResult | null; pinnedFingerprint: string | null; httpsRemembered: boolean }): SchemeDecision;
   export function formatFingerprint(hex: string): string;                // "AB:CD:…" grouped for display
   ```
   - `parseServerAddress`: trim; empty → error "Enter a server address"; if it has no `://`, prefix `http://` only for parsing and set `scheme: null`; map `ws`→`http`, `wss`→`https`, any other scheme → error; `new URL()` in `try`; reject `username`/`password`, a path other than `/`, query or hash ("Enter only the server address, e.g. chat.example.com:9800"); `host` = `url.hostname` with surrounding `[]` removed; `port` = `url.port ? Number(url.port) : undefined`. **Careful:** `new URL("http://x:80")` drops the default port (`url.port === ""`) — a user who typed `:80` or `:443` explicitly loses it; detect it by regex on the raw input (`/:(\d+)\/?$/`) and keep it.
   - `identityHostOf` must produce the **same string 2.6.0 produced** (`port ? host:port : host`) for every input 2.6.0 accepted, or bound identities would stop matching `AUTH_ALLOWED_HOSTS`. Unit-test the equality for: `chat.example.com`, `chat.example.com:9800`, `192.168.0.10:9800`, `localhost`, and the same with `http://`/`https://` prefixes.
   - `decideScheme` table (each row is a unit test):
     | explicit | probe | pin | remembered | → decision |
     |:--|:--|:--|:--|:--|
     | http | (none) | – | – | connect http, warn |
     | https/null | trusted | – | – | connect https, pinned=false |
     | https/null | untrusted | none | – | ask-trust |
     | https/null | untrusted | = cert | – | connect https, pinned=true |
     | https/null | untrusted | ≠ cert | – | pin-mismatch |
     | https | no-tls | – | – | error "This server doesn't support encrypted connections. Type http:// to connect without encryption." |
     | null | no-tls | – | false | connect http, warn |
     | null | no-tls | – | true | error "This server was encrypted before and now isn't — refusing to connect unencrypted. If you know why, type http:// explicitly." |
     | any | unreachable | – | – | error "Couldn't reach the server (<code>)" |
3. **`apps/client/src/tls-store.ts` (main only):** JSON at `join(app.getPath("userData"), "tls-trust.json")`: `{ v: 1, pins: Record<hostKey, { fingerprint256; subject; validTo; pinnedAt; certPem }>, httpsHosts: Record<hostKey, string /*ISO*/> }`. Functions: `getPin(hostKey)`, `setPin(hostKey, entry)`, `removePin(hostKey)`, `listPins()`, `rememberHttps(hostKey)`, `isHttpsRemembered(hostKey)`, `pinsForHostname(hostname)` (for the Chromium verify proc). Write atomically (`writeFileSync(tmp, …, { mode: 0o600 }); renameSync(tmp, file)`); on read, validate shape and fall back to empty (log once). Keep an in-memory copy; read the file once at startup.
4. **Probe in `main.ts`:** `ipcMain.handle("probe-server", async (_e, host: unknown, port: unknown) => …)` — validate `host` (string, ≤ 255, no spaces/slashes) and `port` (integer 1–65535). Implementation with `tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] })`, `socket.setTimeout(5000)`. On `secureConnect`: `const c = socket.getPeerCertificate(true)`; fingerprint = `createHash("sha256").update(c.raw).digest("hex")`; SANs from `c.subjectaltname`; `certPem` = `new X509Certificate(c.raw).toString()`; result `trusted` if `socket.authorized` else `untrusted` with `socket.authorizationError`. Remember the last probe per hostKey in memory (`lastProbe.set(hostKey, { fingerprint256, certPem, at })`) — `tls-trust-certificate` only accepts that fingerprint, within 5 minutes. Errors: `ERR_SSL_WRONG_VERSION_NUMBER` / `EPROTO` / `ECONNRESET` during handshake → `no-tls`; `ECONNREFUSED`/`ENOTFOUND`/`EHOSTUNREACH`/timeout → `unreachable` with the code. Always `socket.destroy()` in every branch.
5. **Other IPC (main):** `tls-get-connect-options(hostKey)` → `{ pinnedCertPem, pinnedFingerprint } | null`; `tls-trust-certificate(hostKey, fingerprint)`; `tls-remove-trust(hostKey)`; `tls-list-trusted()`; `tls-remember-https(hostKey)`; `tls-is-https-remembered(hostKey)`. Validate every argument type.
6. **Chromium side (main, once, before the main window loads):**
   ```ts
   session.defaultSession.setCertificateVerifyProc((req, cb) => {
     if (req.errorCode === 0) return cb(-3);                        // Chromium already trusts it
     const der = pemToDer(req.certificate.data);                    // strip header/footer, base64-decode
     const fp = createHash("sha256").update(der).digest("hex");
     return cb(tlsStore.pinsForHostname(req.hostname).some((p) => p.fingerprint256 === fp) ? 0 : -3);
   });
   ```
   `-3` = "use Chromium's own verdict" (so non-pinned bad certs still fail). Never return `0` for anything not pinned.
7. **`preload.ts`:** change `connect(host, port, nickname, password)` to `connect(address: { scheme: "https" | "http"; host: string; port?: number; pinned: boolean }, nickname, password)` — the renderer has already run the decision. Build `serverUrl = \`${scheme}://${host.includes(":") ? \`[${host}]\` : host}${port ? \`:${port}\` : ""}\``; `serverBaseUrl = serverUrl`; if `pinned`, fetch `tls-get-connect-options` and add `{ ca: [pinnedCertPem], checkServerIdentity: (_h, cert) => sha256(cert.raw) === pinnedFingerprint ? undefined : new Error("certificate changed") }` to the `io()` options. `identityHost` = `identityHostOf(...)` (import the pure function — `tls-trust.ts` is CommonJS-compiled like `link-fixers.ts`). Expose `getServerBaseUrl()` and `probeServer(host, port)`, `tlsTrustCertificate`, `tlsRemoveTrust`, `tlsListTrusted`, `isHttpsRemembered`, `rememberHttps`. On the first successful **HTTPS** join (`res.success`), call `rememberHttps(hostKey)`.
8. **Viewer:** `open-screen-share-viewer` passes `serverBaseUrl` (now with the right scheme) as today; `preload-viewer.ts` gets the pin via a new `viewer-get-tls-options` IPC (resolved by main from the base URL's hostKey) and adds the same `ca`/`checkServerIdentity` to its `io()` call.
9. **Renderer connect flow** (replace the button handler body; keep Remember Me storage):
   1. `parseServerAddress(raw)` (exposed via preload as a pure helper) → on error, `log(error, "error")` and return.
   2. If `scheme === "http"` → connect http (warn after connect).
   3. Else probe: `explicit === "https"` or no port → probe `port ?? 443`; on `no-tls`/`unreachable` with `scheme === null && port === undefined` → retry the decision for plain port 80 (http, warn).
   4. `decideScheme(...)` → `connect` → `api.connect(...)`; `ask-trust` → open the trust modal (step 10) and continue on "Trust"; `pin-mismatch` → changed-certificate modal, stop; `error` → `log(message, "error")`, stop.
   5. Remove the renderer's own `serverBaseUrl = \`http://…\`` line; any renderer use of `serverBaseUrl` reads `api.getServerBaseUrl()` instead.
   6. Server Log lines as in the Design section.
10. **Modals (`index.html` + `renderer.ts`)**, built like the existing NSFW/pin-replace modals (same `.modal`/`visible` pattern, Escape/backdrop close = Cancel): `#tls-trust-modal` (host, grouped fingerprint in a `<code>` with a Copy button using the existing `copy-text-to-clipboard` IPC, subject, valid-to, SANs; buttons Cancel / Trust and connect), `#tls-changed-modal` (old/new fingerprints, pinned date; only Close). All dynamic text via `textContent`, never `innerHTML`.
11. **Status-bar lock:** a `<span id="conn-security">` next to the latency display; states `secure` / `secure-pinned` / `insecure` / hidden when disconnected; set on `connected`, cleared on `disconnected`. Use inline SVG icons (lock / lock with dot / open lock warning), `title` for the tooltip, colors from existing CSS variables.
12. **HTTP warning banner:** shown once per hostKey after an HTTP connect, unless the hostKey is in `reson8-tls-http-warning-dismissed` (JSON array in `localStorage`, every access in `try/catch`, cap 100 entries).
13. **Settings → Application → "Trusted certificates"** card: list from `tlsListTrusted()`, each row host:port, `formatFingerprint(fp).slice(0, 23) + "…"`, pinned date, valid-to, Remove (asks the existing confirm modal pattern). Empty: "No self-signed certificates trusted."
14. **Smoke test** `apps/client/scripts/tls-trust-smoke.mjs` (same structure as `link-fixers-smoke.mjs`) + `"test:tls": "tsc --build && node scripts/tls-trust-smoke.mjs"`.
15. Verification (below), `/log-progress`, commit, stop.

### Pitfalls

- The socket and the media use **different TLS stacks** (see the audit note). Test uploads + images + messages together in every TLS scenario, not just "it connected".
- `checkServerIdentity` replaces the hostname check — only use it for **pinned** hosts. Publicly trusted hosts keep Node's default (`rejectUnauthorized: true`, default name check).
- Don't put the certificate decision in the renderer's `localStorage` — pins and HTTPS memory live in main (`tls-trust.json`), so the renderer can't be tricked into pinning arbitrary certs.
- `getPeerCertificate(true).raw` is DER; Chromium's `certificate.data` is PEM — hash the **DER** on both sides.
- Keep the `identityHost` string byte-identical to 2.6.0's for unchanged inputs (unit test), or existing `AUTH_ALLOWED_HOSTS` setups break.
- Socket.io auto-reconnect reuses the same `io()` options, so pins keep applying on reconnect — don't rebuild the socket on reconnect.

### Done When

- [ ] `test:tls` passes (parse + decision tables + identityHost compatibility).
- [ ] Headless scenarios (a)–(g) pass, each checking messages **and** an upload **and** an image render.
- [ ] Remember Me still restores the field; IPv6 addresses work; nothing else in the connect form changed.

### Regression Risk

The connect path is the most sensitive code in the client. Risks: a server reachable today over `http://host` (no port → port 80) must still connect (probe `:443` → `unreachable`/`no-tls` → `:80`); identity proof host unchanged; uploads/media URLs must use the decided scheme (`resolveMediaUrl()` reads the preload's `serverBaseUrl`). Every scenario below is tested headlessly.

### Verification

- Unit tests (`npm run test:tls`, new `scripts/tls-trust-smoke.mjs`): `parseServerAddress` (schemes, IPv6, ports, paths rejected), `decideScheme` full table.
- Headless, against real local servers: (a) plain HTTP server, no scheme typed → connects over HTTP with the warning; (b) native-TLS server with a self-signed cert → TOFU modal → trust → connected, 🔒; uploads and images load (Chromium path) and messages flow (Node path); (c) restart that server with a different self-signed cert → changed-certificate modal, no connection; (d) after (b), serve the same host:port over plain HTTP → refused as "used to be encrypted"; (e) explicit `http://` still works; (f) IPv6 `[::1]:9800`; (g) the Viewer window connects and plays over TLS.
- `npx tsc --build` (client), `npm run lint`.
- **Manual (user):** connect to the real server through Caddy with a real certificate; check the lock, the Viewer, uploads and voice.

---

## PRD 18.4 — Security: Identity Log and a "Require Signed Identity" Switch

**Type:** 🔒 SECURITY
**Priority:** High
**Affected Components:** `schema.prisma` + migration (`identity_events` table, `servers.requireSignedIdentity`), `connection.handler.ts` (record events), `admin.handler.ts` (`RESET_IDENTITY_KEY` records an event; new `GET_IDENTITY_EVENTS`), `nudge.handler.ts` (server settings), `identity.config.ts` (env-over-DB resolution), new `identity-events.service.ts`, `upload-sweeper.ts` (retention prune), shared-types, `renderer.ts`/`index.html` (User Management "Identity log", Settings → Server switch).

### Current Behavior

- Key binds and refused joins are only written to the server's console log (`"Identity key bound"`, `"Join refused (identity)"`); an admin has no way to see them from the app.
- `REQUIRE_SIGNED_IDENTITY` is an env var only, read at call time; changing it needs a server restart and shell access, and nothing tells the admin when it's safe to turn on.

### Goal

- An **identity log** (ADMIN-only) in Settings → User Management: who bound a key, when, with which fingerprint, from which address and through which host name — plus resets and refused joins — so a suspicious bind of a privileged user (the TOFU window, risk 2) is noticed.
- A **"Require signed identity"** switch in Settings → Server (ADMIN-only), with the env var still taking precedence, and a readiness hint: how many recently active users are still unprotected.

### Design

**Data:**
- `IdentityEvent` (`identity_events`): `id`, `serverId`, `userId`, `nickname` (at the time), `kind` (enum `BOUND`, `RESET`, `REFUSED`), `reason` (nullable: the `IDENTITY_MESSAGES` key for refusals — the real keys in `identity.service.ts` are `verificationFailed`, `hostNotAllowed`, `otherDevice`, `protectedUpdate`, `requiresSigned`; store the key, never the message text), `fingerprint` (nullable), `address` (from `socket.data.clientAddress`, PRD 18.2), `host` (the signed host, nullable), `actorId` (for `RESET`: the admin), `createdAt`. Indexes on `(serverId, createdAt DESC)` and `(userId, createdAt DESC)`.
- `Server.requireSignedIdentity Boolean @default(false)`.

**Recording (`identity-events.service.ts`):** one `recordIdentityEvent()` helper, called at the existing log points in `connection.handler.ts` (bind, bind-on-create, refusal, race-lost refusals) and in `RESET_IDENTITY_KEY`. Fire-and-forget with error logging — a failed audit write must never fail or delay a join. **Flood control:** refusals are de-duplicated per `(userId, reason, fingerprint, address)` with a Redis `SET NX EX 600` key, so a misconfigured client reconnecting forever writes one row per 10 minutes, not thousands. **Retention:** rows older than 90 days are deleted by the existing hourly sweeper (`upload-sweeper.ts` gains a second job; keep it in its own function).

**Effective setting (`identity.config.ts`):** `requireSignedIdentity()` becomes `env set ? env value : server row value`. The server row value is cached in memory and refreshed on `UPDATE_SERVER_SETTINGS` (avoid a DB read per join). `GET_SERVER_SETTINGS` returns `requireSignedIdentity`, `requireSignedIdentityLockedByEnv: boolean`, and `unprotectedActiveUsers` (count of users with `publicKey IS NULL` and `updatedAt` in the last 30 days — `updatedAt` is bumped by every join's upsert) — the last two for ADMIN callers only.

**Wire (shared-types, additive):** `GET_IDENTITY_EVENTS({ userId?, before?, limit? }) → { success, events: IIdentityEvent[], hasMore }` (ADMIN-gated via `requirePermission(…ADMIN)`, cursor-paginated by `createdAt`, limit ≤ 100, default 50); `UPDATE_SERVER_SETTINGS` accepts `requireSignedIdentity?: boolean` (ADMIN, already the gate for this event; refused with a clear error when the env var locks it); `SERVER_SETTINGS_UPDATED` carries it.

**Client:**
- **Settings → User Management:** an "Identity log" button (visible to ADMIN only) opening a panel inside the tab: a table (time, user — nickname + short id, event with a colored badge: green "Key bound", blue "Key reset by <admin>", red "Refused: <reason in words>", fingerprint prefix, address, host), a "Show only this user" filter reachable from each user row's menu, "Load more" pagination. Privileged users (holding ADMIN or MANAGE_ROLES at render time) get a "privileged" tag so their binds stand out.
- **Settings → Server:** a switch "Require signed identity (refuse clients older than 2.6.0)" with helper text: "N users active in the last 30 days haven't connected with 2.6.0+ yet. Turn this on when that's 0 (or those users are gone)." When locked by the env var: disabled, with "Set by the server's REQUIRE_SIGNED_IDENTITY environment variable."
- Text throughout explains *why* (protecting identities), in plain words.

### Edge Cases

- A user's nickname changes: the event keeps the nickname at the time; the table also shows the current nickname when different.
- IP addresses are personal data: only ADMIN sees them; the 90-day retention is stated in the README's privacy notes.
- Old server (2.6.0) with a new client: the button simply doesn't appear (the event fails → hidden).

### Implementation Steps (do them in this order)

1. **Read first:** `connection.handler.ts` identity block (~345–465), `admin.handler.ts` `RESET_IDENTITY_KEY`, `nudge.handler.ts` `GET_SERVER_SETTINGS`/`UPDATE_SERVER_SETTINGS`, `identity.config.ts`, `upload-sweeper.ts`, the User Management rendering in `renderer.ts` (`renderAdminUsers`, ~4090) and the Server settings tab markup in `index.html`.
2. **Schema** (`schema.prisma`):
   ```prisma
   enum IdentityEventKind { BOUND RESET REFUSED }
   model IdentityEvent {
     id          String            @id @default(uuid())
     serverId    String
     userId      String
     nickname    String
     kind        IdentityEventKind
     reason      String?
     fingerprint String?
     address     String?
     host        String?
     actorId     String?
     createdAt   DateTime          @default(now())
     @@index([serverId, createdAt(sort: Desc)])
     @@index([userId, createdAt(sort: Desc)])
     @@map("identity_events")
   }
   ```
   and on `Server`: `requireSignedIdentity Boolean @default(false)`. No relation to `User` on purpose (refusals can be for ids that don't exist, and events must survive user deletion).
3. **Migration:** generate with `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <scratch> --script > prisma/migrations/<timestamp>_identity_events/migration.sql` (timestamp after `20261011120000`), then `npm run db:generate`. Verify on a throwaway DB (server `AGENTS.md` recipe).
4. **shared-types:** `IIdentityEvent { id; userId; nickname; currentNickname?: string; kind: "BOUND" | "RESET" | "REFUSED"; reason: string | null; fingerprint: string | null; address: string | null; host: string | null; actorId: string | null; actorNickname?: string | null; createdAt: string; privileged?: boolean }`; `GET_IDENTITY_EVENTS(payload: { userId?: string; before?: string; limit?: number }, ack: (res: { success: boolean; events?: IIdentityEvent[]; hasMore?: boolean; error?: string }) => void)`; add `requireSignedIdentity?: boolean` to `UPDATE_SERVER_SETTINGS` payload and to `SERVER_SETTINGS_UPDATED`; add `requireSignedIdentity?`, `requireSignedIdentityLockedByEnv?`, `unprotectedActiveUsers?` to the `GET_SERVER_SETTINGS` ack. Build shared-types.
5. **`identity-events.service.ts`:**
   - `refusalDedupeKey({ serverId, userId, reason, fingerprint, address })` → `"idev:refused:" + sha256(JSON.stringify([...]))` (pure, tested).
   - `async recordIdentityEvent(app, ev)`: for `REFUSED`, first `await app.redis.set(key, "1", "EX", 600, "NX")` — if the result isn't `"OK"`, return (deduped). Then `app.prisma.identityEvent.create(...)`. Whole body in `try/catch` → `app.log.warn`. Callers do `void recordIdentityEvent(...)` (fire-and-forget; never `await` it in the join path).
   - `async pruneIdentityEvents(app)` → `deleteMany({ where: { createdAt: { lt: now - 90 days } } })`.
6. **Recording points** (`connection.handler.ts`): the `refuse` branch (`reason: decision.reason`), the two "race lost" refusals (`reason: "otherDevice"`), "Identity key bound" (`BOUND`), "Identity key bound (new user)" (`BOUND`). Use `socket.data.clientAddress`, `proofIn?.host`, `fingerprint`, `nickname`. `RESET_IDENTITY_KEY` (`admin.handler.ts`): `RESET` with `actorId: socket.data.userId`, the target's nickname and the fingerprint that was bound before the reset (read it before clearing).
7. **Effective setting** (`identity.config.ts`): keep `requireSignedIdentity()` as the single function every caller uses. New: `let dbRequireSigned = false; export function setDbRequireSigned(v: boolean)`; `requireSignedIdentity()` returns `env !== undefined ? env === "true" : dbRequireSigned` (keep the existing env parsing exactly); `export function requireSignedLockedByEnv(): boolean`. At startup (`index.ts`, after the server row is known) load the row's value with `setDbRequireSigned(server.requireSignedIdentity)`.
8. **Settings handlers** (`nudge.handler.ts`): `GET_SERVER_SETTINGS` adds the three fields **only when the caller is ADMIN** (`isAdmin(await getUserPermissions(...))`); `unprotectedActiveUsers` = `prisma.user.count({ where: { publicKey: null, updatedAt: { gte: now - 30 days } } })`. `UPDATE_SERVER_SETTINGS` (already ADMIN-gated): if `requireSignedIdentity` is a boolean → refuse with "Set by the server's REQUIRE_SIGNED_IDENTITY environment variable" when locked; else update the row, `setDbRequireSigned(v)`, include it in the `SERVER_SETTINGS_UPDATED` broadcast. Validate the type strictly (`typeof v === "boolean"`).
9. **`GET_IDENTITY_EVENTS`** (`admin.handler.ts`): `requirePermission(…ADMIN)`; validate `limit` (int 1–100, default 50), `before` (ISO date string, `!isNaN(Date.parse())`), `userId` (string ≤ 64); query `findMany({ where: { serverId, ...(userId && { userId }), ...(before && { createdAt: { lt: new Date(before) } }) }, orderBy: { createdAt: "desc" }, take: limit + 1 })` → `hasMore = rows.length > limit`. Enrich with current nicknames and actor nicknames in **one** `user.findMany({ where: { id: { in: ids } } })`, and `privileged` = the user currently holds `role-admin` or a role with MANAGE_ROLES (one `userRole.findMany` for the page's ids).
10. **Sweeper:** in `upload-sweeper.ts`, add `pruneIdentityEvents` to the same interval in its own `try/catch` (or a sibling `startMaintenanceJobs`). Don't change the upload sweep's behavior.
11. **Client — User Management:** an "Identity log" button in the tab header, rendered only when the cached connect-time check says the user is ADMIN (reuse how the Reset-key button decides). Clicking swaps the tab body to the log panel with a "← Back to users" link. Table built with DOM APIs + `textContent`. Reason words: `verificationFailed` → "proof didn't verify", `hostNotAllowed` → "address not allowed", `otherDevice` → "key from another device", `protectedUpdate` → "old client on a protected identity", `requiresSigned` → "old client (signatures required)". Time shown as local date + HH:MM, full ISO in `title`. Each user row's context/menu (or a small "Log" button next to Reset key) opens the log filtered to that user.
12. **Client — Server tab:** the switch row (reuse the existing switch-row markup/classes used for Nudge / Screen Sharing), the helper text with `unprotectedActiveUsers`, disabled + note when locked by env. Live-updates from `SERVER_SETTINGS_UPDATED`.
13. **Tests:** `identity-events.service.test.ts` (dedupe key stability and sensitivity), `identity.config` resolution test (env true/false/unset × db true/false — save/restore `process.env` in `beforeEach/afterEach`).
14. Verification, `/log-progress`, commit, stop.

### Pitfalls

- Recording must never change the join outcome or add latency: no `await` on it in `USER_JOIN_SERVER`.
- The env var keeps its exact current semantics; only the "unset" case now reads the DB value.
- Don't send addresses or the identity log to non-ADMIN sockets — check permission **inside** the handler, not only in the UI.
- `REFUSED` events for a flood of bogus ids could still create many rows (different userIds): the 90-day prune bounds it; additionally cap at 10 refused rows per address per hour (a second Redis counter) — log-only beyond that.

### Done When

- [ ] Every bind/reset/refusal path writes exactly one row (refusals deduped), visible in the log panel with correct reason words.
- [ ] The switch takes effect on the next join without restart; env lock shown correctly.
- [ ] Non-ADMINs can't see or fetch the log.

### Regression Risk

Join path: only fire-and-forget inserts are added after decisions already made; `decideIdentity()` itself is unchanged. The settings handler gains one field. Verified with the existing identity tests plus new ones.

### Verification

- Unit tests: effective-setting resolution (env true/false/unset × DB true/false); refusal de-dupe key builder; event-row mapping.
- Migration verified on a throwaway database (older migrations applied, rows inserted, new migration applied, `prisma migrate deploy` on a fresh DB).
- Live (real server, scratch DB/Redis): a new signed user → `BOUND` row with address/host; a second key for the same id → one `REFUSED otherDevice` row even after 20 rapid retries; ADMIN reset → `RESET` row with actor; switch on → an unsigned join is refused immediately (no restart); env set → switch disabled.
- Headless UI: the log renders, paginates, filters; a non-ADMIN never sees the button and gets "Permission denied" if the event is sent anyway.

---

## PRD 18.5 — Security: Allowed Connection Names Managed in Settings (Challenge-Relay Protection)

**Type:** 🔒 SECURITY
**Priority:** Medium
**Affected Components:** `schema.prisma` + migration (`servers.authAllowedHosts`), `identity.config.ts`, `connection.handler.ts` (record observed hosts), `nudge.handler.ts` (settings), shared-types, `renderer.ts`/`index.html` (Settings → Server section), a new server script `npm run identity:clear-hosts`.

### Current Behavior

`AUTH_ALLOWED_HOSTS` (env only) makes the server refuse identity proofs signed for a host name it doesn't list — the only defense against a malicious server relaying this server's challenge (risk 3). It's off by default because a server reachable by several names must list all of them, and an admin has no easy way to know which names users actually type.

### Why not something cleverer (recorded so it isn't re-investigated)

- Checking the signed host against the socket's `Host` header doesn't work: in a relay the attacker controls their own connection to this server and can send any `Host` header.
- Real channel binding (signing TLS keying material) isn't available to the Electron client's Socket.io stack, and breaks behind TLS-terminating proxies (Cloudflare, Caddy).
- Per-server derived keys would invalidate every key already bound in 2.6.0.
So the allow-list stays the mechanism; this item makes it easy and safe to turn on.

### Design

- `Server.authAllowedHosts String[] @default([])` (Postgres `text[]`). Effective list: `AUTH_ALLOWED_HOSTS` env if set (as today), else the DB list; empty = check off (today's default).
- **Observed hosts:** after every **accepted signed** join, `HINCRBY auth:observed-hosts:<serverId> <host> 1` and `HSET auth:observed-hosts-last:<serverId> <host> <iso>` in Redis (cheap, no DB write per join). Host strings are normalized (`toLowerCase()`, trimmed) with the same function `isHostAllowed()` uses. Capped: only the 50 most-used hosts are returned.
- `GET_SERVER_SETTINGS` (ADMIN callers) returns `authAllowedHosts`, `authAllowedHostsLockedByEnv`, and `observedAuthHosts: { host, joins, lastSeen }[]`. `UPDATE_SERVER_SETTINGS` accepts `authAllowedHosts?: string[]` (ADMIN only; each entry validated with the same host-shape rules as `identity-proof.ts` — plain `host[:port]`, no scheme/path, ≤ 255 chars, ≤ 50 entries).
- **Lock-out guard:** the server refuses to save a non-empty list that doesn't include the host the requesting admin's own current session signed for ("You're connected as `x`, which isn't in the list — you'd be locked out"). Recovery if it still goes wrong: `AUTH_ALLOWED_HOSTS` env overrides the DB, and `npm run identity:clear-hosts` (plain ESM script like `uploads:prune`, prompts unless `--yes`) empties the DB list.
- **Client — Settings → Server → "Connection names (relay protection)"**: explanation in plain words ("Only accept sign-ins made for these addresses. Protects your users if they ever connect to a malicious server. List every address people use to reach this server."), the observed hosts as a checklist (host, joins, last seen), a free-text "Add name" input, Save. A status line: "Off — any name is accepted" / "On — N names". Disabled with the env note when locked by env.
- `isHostAllowed()` and the refusal path are unchanged; refusals are recorded by PRD 18.4's log with reason `hostNotAllowed`, so an admin who forgot a name sees it immediately.

### Implementation Steps (do them in this order)

1. **Read first:** `identity.service.ts` (`isHostAllowed`, the host-shape rules in `identity-proof.ts` on the client), `identity.config.ts` (`authAllowedHosts()`), the join path's `hostAllowed` computation.
2. **Normalize once:** add `export function normalizeAuthHost(h: string): string` to `identity.service.ts` (trim + lower-case; keep the port) and make `isHostAllowed()` compare normalized values on both sides (check the current implementation first — if it already lower-cases, reuse that and don't change behavior). Add `export function isValidAuthHost(h: unknown): h is string` mirroring the client's `identity-proof.ts` host validation (copy the regex/rules exactly; unit-test the same cases).
3. **Schema:** `Server.authAllowedHosts String[] @default([])` → migration (same recipe as 18.4), `db:generate`.
4. **Effective list** (`identity.config.ts`): `let dbAllowedHosts: string[] = []`, `setDbAllowedHosts()`, `authAllowedHosts()` returns the env list when `AUTH_ALLOWED_HOSTS` is set (unchanged parsing) else `dbAllowedHosts`; `authAllowedHostsLockedByEnv()`. Load at startup.
5. **Observed hosts:** after a join is **accepted with a signature** (`proofIn` present and the decision accepted), `void app.redis.multi().hincrby(\`auth:observed-hosts:${serverId}\`, h, 1).hset(\`auth:observed-hosts-last:${serverId}\`, h, new Date().toISOString()).exec().catch(() => {})` with `h = normalizeAuthHost(proofIn.host)`. Also store `socket.data.authHost = h` (new optional `SocketData` field) — the lock-out guard needs it.
6. **Settings:** `GET_SERVER_SETTINGS` (ADMIN callers only) adds `authAllowedHosts`, `authAllowedHostsLockedByEnv`, `observedAuthHosts` (read both hashes with `hgetall`, sort by joins desc, top 50). `UPDATE_SERVER_SETTINGS` accepts `authAllowedHosts?: string[]`: refuse when locked by env; validate (array, ≤ 50 entries, each `isValidAuthHost`, de-duplicate after normalizing); **lock-out guard**: if the resulting list is non-empty and doesn't contain `socket.data.authHost` (or the admin joined unsigned, `authHost` undefined) → refuse with "You're connected as `<host>`, which isn't in the list — you'd be locked out. Add it first."; on success update the row, `setDbAllowedHosts`, broadcast the effective list only to ADMIN sockets (or simply require a re-fetch — the regular `SERVER_SETTINGS_UPDATED` goes to everyone, so **don't** put the host list in it).
7. **Script** `apps/server/scripts/identity-clear-hosts.mjs` (plain ESM like `prune-orphan-uploads.mjs`, using `@prisma/client` directly): prints the current list, asks "Clear it? [y/N]" via `readline` unless `--yes`, then `UPDATE servers SET "authAllowedHosts" = '{}'`. Add `"identity:clear-hosts": "node scripts/identity-clear-hosts.mjs"`. Document in the README (including `docker compose exec server npm run identity:clear-hosts -- --yes`).
8. **Client — Server tab section:** heading "Connection names (relay protection)", the explanation text from the Design section, a status line, a checklist of observed hosts (checkbox + host + "N sign-ins, last <date>"), current list entries that aren't observed are shown too (checked), an "Add name" input + Add button (client-side validation with the same rules, error text inline), Save. On save error, show the server's message. Locked-by-env → whole section disabled with the note.
9. **Tests:** host normalization/validation (server copy matches client rules — run the same table against both), effective-list resolution, lock-out guard (pure function `checkAllowedHostsUpdate(list, currentAuthHost)` returning ok/error).
10. Verification, `/log-progress`, commit, stop.

### Pitfalls

- The list must never leak to non-ADMIN clients (it reveals internal addresses).
- Hosts include the port when the user typed one (`192.168.0.10:9800` ≠ `192.168.0.10`): show that clearly in the UI and keep both forms if both are observed.
- Don't break `AUTH_ALLOWED_HOSTS` env behavior; the env always wins.

### Done When

- [ ] Saving a list immediately enforces it on the next join; refusals appear in the identity log with `hostNotAllowed`.
- [ ] The lock-out guard and the clear script both work; env lock respected.

### Regression Risk

Off by default and unchanged when env is set. The join path only gains a fire-and-forget Redis increment after success.

### Verification

- Unit tests: effective-list resolution; lock-out guard; host validation/normalization shared with `isHostAllowed()`.
- Migration verified on a throwaway DB.
- Live: join as `localhost:9800` and `127.0.0.1:9800` → both observed; save only `localhost:9800` → a join signed for `127.0.0.1:9800` is refused (and logged); saving a list without the admin's own host is refused; `identity:clear-hosts` empties it.
- Headless UI for the section.

---

## PRD 18.6 — Security: Identity Key Encrypted at Rest + Passphrase-Protected Backup

**Type:** 🔒 SECURITY
**Priority:** Medium
**Affected Components:** `identity-key.ts` (storage), `instance-id.ts` (import), a new pure `identity-backup.ts`, `main.ts` (IPC, dialogs, relaunch), `preload.ts`, `renderer.ts`/`index.html` (Settings → About → Identity: Export/Import, the "identity locked" recovery modal).

### Current Behavior

The Ed25519 private key is a PKCS#8 PEM in `<userData>/identity-key.pem` (mode `0600`), next to `instance-id.txt`. A copy of that folder (backup, synced folder, stolen disk, another OS user with access) is a copy of the identity. If the key is lost there's no recovery except an admin "Reset key".

### Goal (user decision: "encrypt where reliable + backup")

1. Encrypt the key at rest with Electron `safeStorage` **where it's reliable**: Windows (DPAPI), macOS (Keychain), Linux **only** when a real keyring backend is in use. Otherwise keep the `0600` file (today's behavior).
2. Silent, safe migration of existing keys.
3. **Export / Import identity**: a passphrase-protected backup file that moves the identity (user id + key) to another machine or restores it after a reinstall or a lost keyring.

**Honest limits, to repeat in the docs/release notes:** OS encryption does not stop malware running *as the user* on Windows or Linux (it can ask the OS to decrypt, like Reson8 does). It does protect against copied backups/synced folders, offline disk access and other OS accounts; on macOS the Keychain also restricts other apps.

### Design

**Storage (`identity-key.ts`, main process only, after `app.whenReady()`):**
- `isEncryptionReliable()`: `safeStorage.isEncryptionAvailable()` **and**, on Linux, `safeStorage.getSelectedStorageBackend()` not in `["basic_text", "unknown"]`.
- New file `<userData>/identity-key.enc`: JSON `{ v: 1, alg: "safeStorage", data: base64(safeStorage.encryptString(pem)) }`, written atomically (temp + rename, mode `0600`).
- **Load order:** `.enc` first → decrypt → parse; else `.pem` (today's path). Dev builds keep their ephemeral key (unchanged).
- **Migration** (packaged, reliable encryption, `.pem` present, no `.enc`): encrypt → write `.enc` → **read it back and decrypt** → compare with the PEM byte-for-byte → only then delete the `.pem`. Any failure leaves the `.pem` in place and logs why (never lose a key in migration).
- **Never silently replace an encrypted key:** if `.enc` exists but can't be decrypted (keyring changed/unavailable), the identity enters a **`locked`** state instead of generating a new key (today's behavior for an unreadable PEM is to create a new key — kept only for the plain-file path). The file is left untouched.
- `getIdentityStatus(): { state: "ok" | "locked", storage: "encrypted" | "file" | "ephemeral" }` over IPC.

**Locked recovery:** on connect, if the identity is `locked`, the renderer shows a modal: "Reson8 couldn't unlock your identity key (the system keyring may have changed). Import a backup to restore it, or create a new identity — a server admin will then need to Reset your key." Buttons: **Import backup…** / **Create new identity** (moves `.enc` aside as `identity-key.enc.locked-<ts>`, generates a new key) / **Cancel**. Nothing is ever deleted.

**Backup format (`identity-backup.ts`, pure, unit-tested):**
- File `*.reson8-identity`, JSON: `{ format: "reson8-identity", v: 1, kdf: { name: "scrypt", N: 131072, r: 8, p: 1, salt: b64 }, cipher: { name: "aes-256-gcm", iv: b64, tag: b64 }, data: b64 }`; plaintext = JSON `{ instanceId, privateKeyPkcs8Der: b64, createdAt, appVersion }`. scrypt via Node `crypto.scrypt` with `maxmem` sized for N=2^17; 16-byte salt, 12-byte IV, AES-256-GCM (authenticated: a wrong passphrase or tampered file fails cleanly). Fingerprint of the contained key computed on import and shown before replacing.
- Passphrase rules: ≥ 10 characters, typed twice on export. No passphrase is ever stored.

**Export / Import UI (Settings → About → Identity, next to the fingerprint):**
- **Export identity…** → passphrase modal → main-process `dialog.showSaveDialog` (default name `reson8-identity-<short fingerprint>.reson8-identity`) → file written `0600`. Text: "Anyone with this file and its passphrase can act as you. Store it safely."
- **Import identity…** → `dialog.showOpenDialog` → passphrase → preview: "This backup's identity: fingerprint `…`, user id `…`. It replaces this install's current identity (`…`)." → **Replace and restart** → main writes `instance-id.txt` + the key (encrypted if reliable) atomically, keeps the previous files as `*.replaced-<ts>`, then `app.relaunch(); app.exit(0)` (the instance id is cached in several places, so a restart is the only clean way).
- A storage line: "Stored encrypted by the operating system" / "Stored as a protected file (no system keyring available)" / "Temporary (development build)". Export/Import disabled in dev builds (ephemeral identity) with an explanation.
- All file dialogs and file I/O happen in **main**; the renderer only passes the passphrase over IPC (validated: string, length bounds) and gets back status/fingerprints, never key material.

### Edge Cases

- Linux user on a session with no keyring: stays on the plain file; if a keyring appears later, migration runs then.
- Two Reson8 installs importing the same backup: both are the same identity (same user id + key) — allowed (that's what a backup is), and the socket-ownership logic already handles one identity on two sockets (the newer join supersedes). Documented: "don't run the same identity on two machines at once".
- Importing on an install whose current identity is bound on servers: the old identity is no longer used by this install (its files are kept as `*.replaced-*`).

### Implementation Steps (do them in this order)

1. **Read first:** `identity-key.ts` (all), `instance-id.ts` (all), how/when `main.ts` first calls `getIdentityPublic()` (must be after `app.whenReady()` — `safeStorage` is only usable after `ready`), the About panel in `index.html`, `identity-smoke.mjs`.
2. **`identity-backup.ts` (pure, Node `crypto` only):**
   ```ts
   export const BACKUP_FORMAT = "reson8-identity";
   export interface BackupPayload { instanceId: string; privateKeyPkcs8Der: string /*b64*/; createdAt: string; appVersion: string }
   export function encryptBackup(payload: BackupPayload, passphrase: string): Promise<string>;   // returns the JSON file text
   export function decryptBackup(fileText: string, passphrase: string): Promise<BackupPayload>;  // throws BackupError("wrong-passphrase" | "corrupt" | "unsupported")
   export function validatePassphrase(p: unknown): string | null;                                // error text or null
   ```
   - scrypt: `crypto.scrypt(passphrase.normalize("NFC"), salt, 32, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 })` (N·r·128 = 128 MiB → `maxmem` must exceed it). Salt 16 random bytes; IV 12; `aes-256-gcm`; tag 16; the JSON header fields (`format`, `v`, `kdf`, `cipher.name`) are passed as **AAD** (`cipher.setAAD(Buffer.from(JSON.stringify(header)))`) so they can't be swapped. A GCM auth failure → `wrong-passphrase` (it can't be told apart from tampering — the message says "Wrong passphrase or damaged file").
   - Validate `instanceId` as a UUID and the DER as an Ed25519 PKCS#8 key (`createPrivateKey({ key: der, format: "der", type: "pkcs8" }).asymmetricKeyType === "ed25519"`) after decrypting.
3. **Storage changes in `identity-key.ts`** — restructure `loadOrCreate()` into explicit states:
   ```ts
   type Storage = "encrypted" | "file" | "ephemeral";
   type Status = { state: "ok"; storage: Storage } | { state: "locked"; storage: "encrypted" };
   function isEncryptionReliable(): boolean {
     if (!safeStorage.isEncryptionAvailable()) return false;
     if (process.platform === "linux") return !["basic_text", "unknown"].includes(safeStorage.getSelectedStorageBackend());
     return true;
   }
   ```
   Files: `ENC = identity-key.enc` (JSON `{ v: 1, alg: "safeStorage", data: b64 }`), `PEM = identity-key.pem`. Order: dev → ephemeral (unchanged). `.enc` exists → decrypt (`safeStorage.decryptString(Buffer.from(data, "base64"))`) → `createPrivateKey` → ok; **any failure → state `locked`, do not create a key, do not touch files**. Else `.pem` exists → load (unchanged behavior incl. the unreadable → rename + new key path) → then `tryMigrate()`. Else → generate; write `.enc` if reliable, else `.pem` (0600).
   - `tryMigrate()`: only if reliable. Encrypt → `writeFileSync(ENC + ".tmp", json, { mode: 0o600 })` → `renameSync` → read back + decrypt → compare `export({type:"pkcs8",format:"der"})` buffers with `crypto.timingSafeEqual` → `unlinkSync(PEM)`. Any exception → delete the `.tmp`/`.enc` it created (only if it created it this run), keep `.pem`, `console.warn`.
   - While `locked`: `getIdentityPublic()` returns `null`; `signAuthChallenge()` returns `null`. Check every caller handles `null` (the preload's `buildIdentityProof()` → if null and status is locked, emit a renderer event `identity-locked` **instead of** joining unsigned, because joining unsigned to a server where the id is bound would just fail with "registered to another device" — confusing).
4. **New IPC (main):** `identity-get-status`; `identity-export(passphrase)` → validate, `dialog.showSaveDialog(mainWindow, { defaultPath: \`reson8-identity-${shortFp}.reson8-identity\`, filters: [{ name: "Reson8 identity", extensions: ["reson8-identity"] }] })` → `encryptBackup` → `writeFileSync(path, text, { mode: 0o600 })` → `{ ok: true, path }`; `identity-import-preview()` → `showOpenDialog` → read (cap 64 KB) → keep the text in a main-process variable (never send file contents to the renderer) → `{ ok: true, token }`; `identity-import-decrypt(token, passphrase)` → `decryptBackup` → `{ fingerprint, instanceId }` (kept in main); `identity-import-apply(token)` → write `instance-id.txt` and the key (encrypted if reliable) atomically, rename the previous files to `*.replaced-<ts>`, then `app.relaunch(); app.exit(0)`; `identity-create-new()` (locked recovery) → rename `.enc` to `identity-key.enc.locked-<ts>`, generate a new key, return the new status (no relaunch needed: the instance id is unchanged). Dev builds: export/import handlers return `{ ok: false, error: "Not available in development builds" }`.
5. **`instance-id.ts`:** add `export function replaceInstanceId(id: string)` (validate UUID, atomic write, keep the old file as `instance-id.txt.replaced-<ts>`). Don't change `getInstanceId()` caching semantics — the relaunch makes the new id effective.
6. **preload:** `identity.getStatus()`, `identity.export(passphrase)`, `identity.importPreview()`, `identity.importDecrypt(token, passphrase)`, `identity.importApply(token)`, `identity.createNew()`; the `identity-locked` event.
7. **Renderer UI (About → Identity):** under the fingerprint row: storage line; buttons "Export identity…" and "Import identity…" (disabled in dev with a tooltip). Passphrase modal (two `type="password"` inputs, live validation "At least 10 characters" / "Passphrases don't match", a warning paragraph). Import flow: pick file → passphrase → preview (fingerprint, user id, current id) → red "Replace and restart". Locked modal on `identity-locked` (three buttons, as in the Design section). All text via `textContent`; passphrases never logged, never stored, inputs cleared on close.
8. **Smoke test** `scripts/identity-backup-smoke.mjs` + `"test:identity-backup"`: round trip, wrong passphrase, flipped byte in `data`/`tag`/`salt`/AAD header (`v: 2`), unsupported format, passphrase validation, fingerprint equality.
9. **Packaged-like testing:** the dev switch (`isDevBuild()`) makes keys ephemeral. For headless tests add a narrowly-scoped override env var read **only** in `isDevBuild()`: `RESON8_FORCE_PERSISTENT_IDENTITY=1` (document it in the client `AGENTS.md` as test-only), and always use a throwaway `--user-data-dir`.
10. Verification, `/log-progress`, commit, stop.

### Pitfalls

- `safeStorage` before `app.whenReady()` throws / returns false — make sure no code path loads the key earlier.
- On Linux under Xvfb there's usually no keyring (`basic_text`) — tests there exercise the **file** path; the encrypted path must be tested on a desktop session (KDE/GNOME) and Windows by the user. Say so in the progress entry.
- Never delete a key file. Renames only, with timestamps.
- A wrong passphrase must not crash or hang the UI: scrypt with N=2^17 takes ~0.3–1 s; run it with the async `crypto.scrypt` (not `scryptSync`) so the main process stays responsive.

### Done When

- [ ] Existing installs keep the same fingerprint after upgrade (migration verified) and still join servers where they're bound.
- [ ] Locked state never mints a key silently; recovery modal works both ways.
- [ ] Export → import on another profile restores the same user id + fingerprint after relaunch.

### Regression Risk

Startup path of the identity key. A bug here could mint a new key and lock users out of their bound identities — which is why migration verifies before deleting and a failed decrypt locks instead of regenerating. Verified on a packaged-like setup (`app.isPackaged` forced through the existing dev/packaged switch in a throwaway `--user-data-dir`).

### Verification

- Unit tests (`npm run test:identity-backup`): round trip; wrong passphrase → clean error; tampered ciphertext/tag/salt → error; format/version checks; fingerprint matches the original key.
- Headless/packaged-like runs in a temp user-data dir: fresh install → `.enc` (or `.pem` where unreliable); existing `.pem` → migrated, same fingerprint, server still accepts the join; corrupt `.enc` → locked modal, no new key minted; export → import on a second temp profile → same fingerprint and user id after relaunch, signed join accepted by a server where the identity is bound.
- **Manual (user):** Windows and Linux (with and without a keyring) installs.

---

## PRD 18.7 — Feat: Address (IP / Range) Bans

**Type:** ✨ FEATURE (moderation)
**Priority:** Medium
**Affected Components:** `schema.prisma` + migration (`banned_addresses`, `users.lastAddress`), `moderation.handler.ts` (`BAN_USER`/`UNBAN_USER`, new `GET_BANNED_ADDRESSES`/`UNBAN_ADDRESS`), `index.ts` (connection middleware), new `address-ban.service.ts`, shared-types, `renderer.ts`/`index.html` (ban dialog options, banned-address list in User Management).

### Current Behavior

Bans are by user id (`BannedUser`). Deleting the Reson8 `userData` folder creates a new id that isn't banned (risk 5).

### Goal

When banning, a moderator can **also** ban the user's address — the exact address, or its surrounding range (**/24** for IPv4, **/64** for IPv6, the usual "one household/ISP customer" size). It's an opt-in extra because it's easy to dodge (VPN, mobile data) and can hit innocent people on shared networks (carrier-grade NAT, schools, offices) — the dialog says so.

### Design

- Requires PRD 18.2's trustworthy `socket.data.clientAddress`. If the server is behind a proxy **without** `TRUST_PROXY`, every client has the proxy's address; banning it would ban everyone. Guard: the server refuses an address ban when the target address is loopback/private **and** `TRUST_PROXY` is unset, with a message explaining to configure `TRUST_PROXY` (LAN-only servers can still ban exact private addresses when `TRUST_PROXY` is set to `false` explicitly — documented edge).
- `User.lastAddress String?` + `lastAddressAt DateTime?`, updated on every successful join (so offline users can be address-banned from User Management, as user bans already can).
- `BannedAddress` (`banned_addresses`): `id`, `serverId`, `cidr` (normalized, e.g. `203.0.113.0/24`, `2001:db8:1:2::/64`, `198.51.100.7/32`), `linkedUserId` (nullable: the user ban that created it), `nickname` (display), `createdBy`, `createdAt`, unique `(serverId, cidr)`.
- `address-ban.service.ts` (pure parts unit-tested): `toCidr(address, scope: "exact" | "range")`, `isPrivateOrLoopback()`, and a cached `net.BlockList` rebuilt on change (Node's built-in CIDR matcher; handles IPv4/IPv6; normalize `::ffff:` first).
- **Enforcement:** an `io.use()` middleware (after the role tagging) checks the address and marks `socket.data.addressBanned = true` — it doesn't refuse the handshake itself, because the user id isn't known yet at that point. `USER_JOIN_SERVER` then refuses a banned address with the existing "You are banned from this server" message, **unless** `instanceId === ADMIN_INSTANCE_ID` and the identity decision for the admin passes (with `ADMIN_KEY_FINGERPRINT` if set) — so an admin on a shared network can always get in to undo a mistaken range ban. Viewer sockets from a banned address are refused outright.
- **Wire (additive):** `BAN_USER` payload gains `addressBan?: "none" | "exact" | "range"` (default `"none"` = today's behavior); `UNBAN_USER` also removes address bans linked to that user; `GET_BANNED_ADDRESSES` / `UNBAN_ADDRESS({ id })` (BAN_USER-gated, like the existing ban events).
- **Client:** the Ban confirmation in User Management gets a small radio group "Also ban their address: No (default) / This address only / Their address range" with a one-line warning "Can block other people on the same network (shared Wi-Fi, mobile carriers)". The addresses themselves are shown masked to non-ADMIN moderators (`203.0.113.x`) and in full to ADMIN. A "Banned addresses" sub-list under the existing banned-users list with Unban.

### Implementation Steps (do them in this order)

1. **Read first:** `moderation.handler.ts` (all: `KICK_USER`, `BAN_USER`, `UNBAN_USER`, `GET_BANNED_USERS`), `index.ts` `io.use()` (role tagging), the ban UI in `renderer.ts` (search `banUser(`) and its confirm modal.
2. **Schema:** `User.lastAddress String?`, `User.lastAddressAt DateTime?`; model `BannedAddress { id String @id @default(uuid()); serverId String; cidr String; linkedUserId String?; nickname String?; createdBy String; createdAt DateTime @default(now()); @@unique([serverId, cidr]); @@map("banned_addresses") }`. Migration + `db:generate` (recipe as in 18.4).
3. **`address-ban.service.ts`:**
   ```ts
   export function normalizeIp(addr: string): string | null;              // net.isIP check; strips ::ffff:, zone ids; lower-case v6
   export function toCidr(addr: string, scope: "exact" | "range"): string | null; // v4: /32 or /24 (zero host bits); v6: /128 or /64
   export function isPrivateOrLoopback(addr: string): boolean;            // reuse the same BlockList ranges as 18.10's guard (copy into a shared server-side constant)
   export function maskAddress(addr: string): string;                     // "203.0.113.x", "2001:db8:1:2:x"
   export class AddressBanCache { load(rows: { cidr: string }[]): void; isBanned(addr: string): boolean } // wraps net.BlockList (addSubnet(network, prefix, "ipv4"|"ipv6"))
   ```
   Zeroing host bits: compute with `net.SocketAddress`-free math — for IPv4 split into 4 octets; for IPv6 expand with a small helper (or `new net.BlockList()` + store the **normalized network string** you computed). Unit-test both.
4. **Startup:** load all `banned_addresses` rows for the server into one `AddressBanCache` instance (export a module-level singleton or attach to `app` via `app.decorate("addressBans", cache)`); reload after every ban/unban write.
5. **Middleware** (`index.ts`, after role tagging and after `clientAddress` is computed — move the address computation into this middleware so it's available to both): `socket.data.addressBanned = app.addressBans.isBanned(socket.data.clientAddress)`; for `role === "viewer"` → `next(new Error("You are banned from this server"))`; for primary → `next()`.
6. **Join path:** right after the existing user-id ban check: if `socket.data.addressBanned` → allow **only** if `instanceId === process.env.ADMIN_INSTANCE_ID` **and** (after the identity decision) `decision.action === "accept" && decision.grantAdmin`; otherwise `ack({ success: false, error: "You are banned from this server" })`. Because the identity decision happens later in the function, implement it as: record `const addressBlocked = socket.data.addressBanned && instanceId !== process.env.ADMIN_INSTANCE_ID` before identity; refuse immediately if true; for the admin id, re-check after the decision that `grantAdmin` is true, else refuse. Then on success, `void prisma.user.update({ where: { id }, data: { lastAddress: socket.data.clientAddress, lastAddressAt: new Date() } })` (after the upsert).
7. **`BAN_USER`:** extend payload with `addressBan?: "none" | "exact" | "range"` (validate; default `"none"`). If not `"none"`: address = the target's live socket `clientAddress` if online (find their primary socket via the existing socket lookup used to emit `USER_BANNED`), else `user.lastAddress`; none known → ban the user but return `{ success: true, warning: "No address known for this user — only the user was banned" }`. If `isPrivateOrLoopback(address)` and `TRUST_PROXY` is not configured → refuse the **address part** with the explanation (still ban the user, return a warning). Else upsert `BannedAddress { cidr: toCidr(address, scope), linkedUserId, nickname, createdBy }`, reload the cache, and disconnect every **other** connected socket whose `clientAddress` is now banned (except the admin's) with `USER_BANNED` like the target.
8. **`UNBAN_USER`:** also `deleteMany({ where: { serverId, linkedUserId: userId } })`, reload the cache. New `GET_BANNED_ADDRESSES` (BAN_USER) → rows with `cidr` masked unless the caller is ADMIN (mask the network part's last octet/group); `UNBAN_ADDRESS({ id })` (BAN_USER).
9. **shared-types:** the payload/ack additions above (`warning?: string` on the ban ack), `IBannedAddress { id; cidr; nickname: string | null; linkedUserId: string | null; createdAt }`, `SocketData.addressBanned?: boolean`.
10. **Client:** in the ban confirm modal add three radio inputs (name `ban-address-scope`, default "none") + warning text; pass the value to `api.banUser(userId, scope)`; show `warning` as a toast. "Banned addresses" list under the banned users list with an Unban button per row, refreshed after ban/unban.
11. **Tests:** `address-ban.service.test.ts` — normalize (`::ffff:203.0.113.7` → `203.0.113.7`), `toCidr` v4/v6 exact/range, `isBanned` inside/outside ranges and for mapped addresses, `isPrivateOrLoopback` table, masking.
12. Verification, `/log-progress`, commit, stop.

### Pitfalls

- Without 18.2's trusted address this feature is dangerous — never read `x-forwarded-for` directly here; only `socket.data.clientAddress`.
- `net.BlockList.check(addr, type)` needs the right `type` (`"ipv4"`/`"ipv6"`) — pass it explicitly from `net.isIP()`.
- Disconnecting other sockets on the same address: skip sockets of the acting admin and of `ADMIN_INSTANCE_ID`.

### Done When

- [ ] Range/exact bans block new identities from that address; others unaffected; admin id can always get in; unban clears linked ranges; masked display for non-ADMIN.

### Regression Risk

User bans unchanged when `addressBan` is absent. The new middleware is a cheap in-memory check per connection.

### Verification

- Unit tests: CIDR building/normalization (IPv4, IPv6, mapped), BlockList matching, private-address guard.
- Migration on a throwaway DB.
- Live (with `TRUST_PROXY=loopback` and forged `X-Forwarded-For` from a trusted local proxy): ban user A with "range" → a fresh identity from the same /24 is refused; another /24 connects; ADMIN identity from the banned range still joins; unban removes the range; with `TRUST_PROXY` unset, an address ban of a private address is refused with the explanation.
- Headless UI for the dialog and list.

---

## PRD 18.8 — Feat: "Approve New Users" Mode

**Type:** ✨ FEATURE (moderation)
**Priority:** Medium
**Affected Components:** `schema.prisma` + migration (`servers.requireApproval`, `pending_approvals`), `connection.handler.ts` (join path), new `approval.service.ts` + `approval.handler.ts`, `nudge.handler.ts` (settings), shared-types, `preload.ts` (pending flow), `renderer.ts`/`index.html` (waiting screen, User Management "Pending approval", admin notification, Settings → Server switch).

### Goal (user decision: its own on/off switch in Settings → Server)

When **"Approve new users"** is on, a brand-new identity can't use the server until a moderator approves it. Existing users are never affected. This is the strongest answer to ban evasion in an account-less design: a banned person who reinstalls ends up in the queue, not in the server.

### Design

**Who is "new":** an identity with **no `User` row** when it joins (the same test `decideIdentity()`'s bind-on-create uses). Turning the switch on never locks out anyone who has joined before.

**Pending joins never complete.** Rather than a half-joined socket (which would mean auditing ~50 handlers for a "pending" state), the join is answered `{ success: false, pending: true, error: "Waiting for approval" }` **after** the password, ban, address-ban and identity checks pass, and **nothing** is written to `users`/presence/roles. The request is stored instead:
- `PendingApproval` (`pending_approvals`): `id`, `serverId`, `userId` (unique per server), `nickname`, `publicKey` (the key the request was signed with — **required**: an unsigned new user can't request approval, since approval must be tied to a key), `fingerprint`, `address`, `host`, `requestedAt`, `lastSeenAt`.
- The socket joins a room `pending:<userId>` and stays connected; it can call nothing else (every other handler already requires `socket.data.userId`, which isn't set — verified per handler in the implementation, and the few without that guard get one).
- **Approve** (moderator): creates the `User` row **with the requested key bound** (`publicKey`, `publicKeyBoundAt`) and default role, inside one transaction that also deletes the request; records a PRD 18.4 `BOUND` event with `actorId`; emits `APPROVAL_GRANTED` to `pending:<userId>` → the client immediately re-runs its normal join (fresh challenge), which now succeeds because the user row exists and the key matches. Binding at approval time closes the TOFU window for new users entirely.
- **Reject**: deletes the request and emits `APPROVAL_REJECTED` (client shows "Your request was declined" and disconnects). **Reject and ban**: also creates the user ban (and optional address ban, PRD 18.7).
- Limits: max **50** pending requests per server (new requests beyond that are refused with "The server isn't accepting new users right now"); max **3** pending requests per address (needs PRD 18.2); requests not seen for **7 days** are deleted by the hourly sweeper; re-joining while pending just updates `lastSeenAt`/nickname.
- **Permission:** approving/rejecting is gated by **`BAN_USER`** (moderators) or ADMIN — the same people who already manage bans in User Management. The on/off switch itself is ADMIN-only, like every other server setting.

**Wire (additive):** `USER_JOIN_SERVER` ack gains `pending?: true`; server→client `APPROVAL_GRANTED`, `APPROVAL_REJECTED`, `PENDING_APPROVALS_CHANGED` (to moderators online, in a `moderators:<serverId>` room joined at their join when they hold BAN_USER/ADMIN); client→server `GET_PENDING_APPROVALS`, `APPROVE_USER({ userId })`, `REJECT_USER({ userId, ban?: boolean, addressBan? })`; `UPDATE_SERVER_SETTINGS`/`GET_SERVER_SETTINGS`/`SERVER_SETTINGS_UPDATED` gain `requireApproval`.

**Client:**
- **Waiting screen** (replaces the connect form's area, not a modal on top of an empty app): "Waiting for approval — a moderator of <server name> needs to let you in. You can leave this open; you'll get in automatically." with the user's own fingerprint (so they can tell a moderator out-of-band which request is theirs) and a **Cancel** button. Survives reconnects (the preload re-sends the join; still pending → screen stays).
- **Moderators:** a red count badge on the Settings gear and the User Management tab; a "Pending approval (N)" section at the top of User Management: nickname, fingerprint prefix, address (masked for non-ADMIN, as in 18.7), requested time, **Approve / Reject / Reject and ban**. A sound + Server Log line when a new request arrives ("<nick> is waiting for approval").
- **Settings → Server:** switch "Approve new users before they can join" with helper text ("People who have joined before aren't affected. New people wait until a moderator approves them in User Management.").

### Edge Cases

- `ADMIN_INSTANCE_ID` joining for the first time on a fresh server with approval on: always allowed (otherwise a new server could be bricked); requires the admin identity decision to pass (with `ADMIN_KEY_FINGERPRINT` if set).
- A v2.6.0 client hitting a pending join: it gets `success: false` with the error text "Waiting for approval — try again later", shown by its existing join-failed path. It won't auto-retry; acceptable and documented.
- Switch turned off while requests are pending: nobody is approved automatically. The queue stays visible to moderators until handled; new joins are no longer queued, so a waiting client gets in the next time it re-sends its join (its own reconnect, or the user pressing Cancel and connecting again). Decided so that a settings change never approves anyone implicitly.
- The pending socket's `disconnect` touches nothing userId-keyed (no presence/ownership exists), so the `SocketOwnership` rules are unaffected.

### Implementation Steps (do them in this order)

1. **Read first:** the whole `USER_JOIN_SERVER` handler, `SocketOwnership` usage in `disconnect`, every `socket.on` in every handler file — note which ones check `socket.data.userId` (or `serverId`) before doing anything. Make a table now; it's reused in 18.18.
2. **Guard audit:** for every client→server event except `USER_JOIN_SERVER`, `REQUEST_AUTH_CHALLENGE`, `PING_LATENCY`, `VIEWER_AUTHENTICATE` (viewer path) and the new approval-flow events: if the handler doesn't already return early when `!socket.data.userId`, add `if (!socket.data.userId) return ack?.({ success: false, error: "Not joined" })` (match each ack's shape). This is what makes a pending (not joined) socket harmless. Record the table in the progress entry.
3. **(Recommended) extract the join decisions:** if `USER_JOIN_SERVER` is already long, extract a pure `decideJoinGate({ isNewUser, isAdminId, requireApproval, requireInvite, inviteValid, ... })` into `join-gate.service.ts` with tests, so 18.8 and 18.9 add rows to one table instead of nested `if`s.
4. **Schema:** `Server.requireApproval Boolean @default(false)`; model `PendingApproval { id String @id @default(uuid()); serverId String; userId String; nickname String; publicKey String; fingerprint String; address String?; host String?; inviteId String?; requestedAt DateTime @default(now()); lastSeenAt DateTime @default(now()); @@unique([serverId, userId]); @@index([serverId, requestedAt]); @@map("pending_approvals") }` (`inviteId` used by 18.9). Migration + generate.
5. **Join path insertion point:** after password, user ban, address ban (18.7) and the identity **decision** (accept), and **before** any write (`users` upsert, bind, roles, presence, rooms): `const isNewUser = !existingUser;` if `requireApproval && isNewUser && !isAdminIdAccepted` →
   - no signed proof → `ack({ success: false, error: "This server approves new users — update Reson8 to request access." })`;
   - count pending for the server ≥ 50 → refuse "The server isn't accepting new users right now"; pending from `socket.data.clientAddress` ≥ 3 (excluding this userId) → same refusal;
   - upsert `PendingApproval` (update `nickname`, `lastSeenAt`, `address`, `host`, `publicKey`/`fingerprint` **only if unchanged** — if a different key tries to take over an existing pending request, refuse with `otherDevice`);
   - `socket.join(\`pending:${instanceId}\`)`; `socket.data.pendingUserId = instanceId` (new `SocketData` field; **not** `userId`);
   - on a new request (not an update): emit `PENDING_APPROVALS_CHANGED` to `moderators:${serverId}`;
   - `ack({ success: false, pending: true, error: "Waiting for approval" })`; return.
6. **Moderators room:** on a successful join, if the user has `BAN_USER` or `ADMIN` → `socket.join(\`moderators:${serverId}\`)`. Re-evaluate on `ASSIGN_ROLE` for the target's live sockets (join/leave the room).
7. **`approval.handler.ts`** (register in `index.ts`), each gated with `requireAnyPermission(BAN_USER, ADMIN)` via the existing middleware:
   - `GET_PENDING_APPROVALS` → list (masked address unless ADMIN), sorted by `requestedAt`.
   - `APPROVE_USER({ userId })` → in one `$transaction`: re-read the request (gone → "Already handled"); `user.create({ id, username: id, nickname, password: "instance-auth", publicKey, publicKeyBoundAt: now })`; `userRole.create(role-default)`; (18.9) claim the invite use; `pendingApproval.delete`. Then: `recordIdentityEvent(BOUND, actorId)`; `io.to(\`pending:${userId}\`).emit("APPROVAL_GRANTED")`; emit `PENDING_APPROVALS_CHANGED`. If a `User` row was created meanwhile by some other path, abort with "Already a member".
   - `REJECT_USER({ userId, ban?, addressBan? })` → delete the request; if `ban`, run the same logic as `BAN_USER` (extract a shared `banUser(app, io, { serverId, userId, nickname, addressBan, actorId })` function from `moderation.handler.ts` instead of duplicating); emit `APPROVAL_REJECTED` to the pending room, then `disconnectSockets(true)` on that room; emit `PENDING_APPROVALS_CHANGED`.
8. **Settings:** `requireApproval` in `GET_SERVER_SETTINGS`/`UPDATE_SERVER_SETTINGS` (ADMIN) and `SERVER_SETTINGS_UPDATED` (a boolean is fine for everyone to see).
9. **Sweeper:** delete `PendingApproval` with `lastSeenAt < now - 7 days`.
10. **Pending socket disconnect:** nothing to clean except Socket.io's own room membership. Make sure the `disconnect` handler returns early when `!socket.data.userId` (it should already — verify) so no presence/ownership code runs.
11. **shared-types:** `USER_JOIN_SERVER` ack `pending?: true`; events listed in the Design section; `IPendingApproval { userId; nickname; fingerprint; address: string | null; host: string | null; requestedAt; lastSeenAt }`; `SocketData.pendingUserId?`.
12. **preload:** in the join ack handler, if `res.pending` → `emit("approval-pending", { serverName? })`, keep the socket **connected**, set `joinServerInFlight = false`, and listen once for `APPROVAL_GRANTED` → re-run the same join routine (fresh `REQUEST_AUTH_CHALLENGE`, then `USER_JOIN_SERVER`); `APPROVAL_REJECTED` → `emit("approval-rejected")` and disconnect. On reconnect while pending the normal connect handler re-sends the join → still pending → same event. Expose `cancelApprovalRequest()` = disconnect.
13. **Renderer:** waiting screen (a panel in the tab content area, not a modal), with the fingerprint (from `identity.getStatus()`/`getIdentityPublic`), Cancel; on rejected → message + back to the connect form. Moderators: a badge with the pending count on the gear button and on the User Management tab button (fetch count on connect if moderator, update on `PENDING_APPROVALS_CHANGED`), the "Pending approval (N)" section with three buttons per row (Reject and ban asks the 18.7 address scope in the same modal), a sound (reuse an existing alert, e.g. the one for user joined) + Server Log line.
14. **Tests:** join-gate table; limits; the approve transaction's pure parts (input validation, "already handled" path).
15. Verification, `/log-progress`, commit, stop.

### Pitfalls

- Never set `socket.data.userId` for a pending socket — that's what keeps every other handler closed to it.
- Approval must bind the **requested** key; the subsequent join is a normal signed join that matches it.
- Race: two moderators approving at once → the transaction's re-read + delete makes the second one fail cleanly.
- Don't broadcast `USER_JOINED`/presence for pending users.

### Done When

- [ ] With the switch on, new identities wait with no DB user row, no presence and no access to any event; approve/reject/reject-and-ban work live; existing users and the admin id are unaffected; switch off restores direct joins.

### Regression Risk

Join path: one new branch after all existing checks, only when the switch is on and the user row doesn't exist. With the switch off (default) the path is unchanged.

### Verification

- Unit tests: "is new user" decision; limits; approve transaction (pure parts).
- Migration on a throwaway DB.
- Live: switch on → new identity gets `pending`, no `users` row, no presence, other events refused; moderator approves → client joins automatically with its key bound; reject → declined; reject-and-ban → banned; existing user unaffected; 51st request refused; ADMIN first join allowed; switch off → new users join directly.
- Headless UI: waiting screen, moderator badge/section, live update without reopening Settings.

---

## PRD 18.9 — Feat: Invite Codes for New Users

**Type:** ✨ FEATURE (moderation)
**Priority:** Medium
**Affected Components:** `schema.prisma` + migration (`servers.requireInvite`, `invites`, `invite_uses`), `connection.handler.ts` (join path), new `invite.service.ts` + `invite.handler.ts`, shared-types, `preload.ts` (`connect()` carries the code), `renderer.ts`/`index.html` (connect form field, User Management "Invites", Settings → Server switch).

### Goal (user decision: its own on/off switch in Settings → Server)

When **"Require an invite code for new users"** is on, a brand-new identity must present a valid invite code to join. Returning users never need one.

### Design

- `Invite` (`invites`): `id`, `serverId`, `codeHash` (SHA-256 of the code, unique — codes are stored hashed like upload tokens), `codePrefix` (first 4 chars, for display), `label`, `createdBy`, `createdAt`, `expiresAt` (nullable), `maxUses` (nullable = unlimited), `uses` (int), `revokedAt` (nullable).
- `InviteUse` (`invite_uses`): `inviteId`, `userId`, `usedAt` — who came in with which invite (shown in the invite's details; useful after an abuse wave).
- **Codes:** 12 characters from a Crockford Base32 alphabet (no `I`, `L`, `O`, `U`; ~60 bits), generated with `crypto.randomInt`, displayed grouped `XXXX-XXXX-XXXX`, accepted case-insensitively and with or without dashes. Shown **once** at creation (with a copy button); afterwards only the prefix is visible.
- **Join path:** after password, bans, address bans and the identity decision, and only for a **new** user (no `User` row) while `requireInvite` is on: no code → refuse with code `INVITE_REQUIRED`; invalid/expired/revoked/exhausted → `INVITE_INVALID` (one generic message, so codes can't be probed for state). Valid → the use is **claimed atomically** (`UPDATE invites SET uses = uses + 1 WHERE codeHash = ? AND revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now()) AND (maxUses IS NULL OR uses < maxUses) RETURNING id`) in the **same transaction** as the user creation (so a failed join doesn't burn a use), and an `InviteUse` row is written.
- **Brute-force protection:** failed invite attempts are rate-limited per address (Redis counter, 10 failures / 15 min → refuse further attempts for 15 min) — with ~60-bit codes this is defense in depth.
- **Interaction with "Approve new users" (both on):** they apply **independently** — a valid invite is required to even enter the approval queue, and the invite use is consumed when the request is **approved** (the request stores the claimed invite id; rejecting returns nothing — the use is only counted on approval). (See [Open Decisions](#open-decisions-confirmed-with-the-user): "an invite skips approval" is the alternative.)
- **Permission:** creating/revoking/listing invites is gated by **`BAN_USER`** or ADMIN (the moderators); the switch is ADMIN-only.
- **Wire (additive):** `USER_JOIN_SERVER` payload gains `inviteCode?: string`; ack error codes `INVITE_REQUIRED` / `INVITE_INVALID` (a new optional `errorCode` field on the ack, keeping `error` text for old clients); `CREATE_INVITE({ label?, expiresInHours?, maxUses? }) → { code, invite }`, `GET_INVITES`, `REVOKE_INVITE({ id })`; settings gain `requireInvite`.
- **Client:**
  - Connect form: an "Invite code" input, hidden by default; revealed (and focused) when the server answers `INVITE_REQUIRED`, with the message "This server needs an invite code for new users." Remember Me does **not** store it (single-purpose).
  - User Management → "Invites" section (moderators): Create invite (label, expiry: never / 1 h / 24 h / 7 d / 30 d, max uses: unlimited / 1 / 5 / 10 / 25 / custom) → modal showing the full code once with Copy; list with prefix, label, creator, uses/max, expiry, status (active/expired/used up/revoked), Revoke; expand to see who used it.
  - Settings → Server: switch "Require an invite code for new users" with helper text.

### Edge Cases

- `ADMIN_INSTANCE_ID` first join never needs an invite (same rule as 18.8).
- Clock skew irrelevant (expiry checked in SQL with the DB clock).
- A v2.6.0 client against a server requiring invites: it shows the server's error text ("This server needs an invite code — update Reson8 to enter one"). Documented.

### Implementation Steps (do them in this order)

1. **Read first:** 18.8's join gate, `stored-file.service.ts` token hashing (copy its hashing approach), the connect form markup.
2. **Schema:** `Server.requireInvite Boolean @default(false)`; `Invite { id String @id @default(uuid()); serverId String; codeHash String @unique; codePrefix String; label String?; createdBy String; createdAt DateTime @default(now()); expiresAt DateTime?; maxUses Int?; uses Int @default(0); revokedAt DateTime?; @@index([serverId, createdAt]); @@map("invites") }`; `InviteUse { id String @id @default(uuid()); inviteId String; userId String; usedAt DateTime @default(now()); invite Invite @relation(fields: [inviteId], references: [id], onDelete: Cascade); @@index([inviteId]); @@map("invite_uses") }`. Migration + generate.
3. **`invite.service.ts` (pure parts tested):**
   ```ts
   export const INVITE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford Base32 (no I, L, O, U)
   export function generateInviteCode(): string;          // 12 chars via crypto.randomInt(32) each
   export function normalizeInviteCode(input: unknown): string | null; // upper-case, strip spaces/dashes, map O→0, I/L→1 (Crockford decoding rules), must be 12 alphabet chars
   export function formatInviteCode(code: string): string; // "XXXX-XXXX-XXXX"
   export function hashInviteCode(code: string): string;   // sha256 hex of the NORMALIZED code
   export function inviteStatus(inv, now): "active" | "expired" | "used-up" | "revoked";
   ```
4. **Claim inside the user-creation transaction:** the current join creates the user with `prisma.user.upsert` **outside** a transaction. For a new user with `requireInvite` on, wrap the user upsert + role upserts + the claim in `prisma.$transaction(async (tx) => …)`: `const claimed = await tx.$queryRaw\`UPDATE invites SET uses = uses + 1 WHERE "codeHash" = ${hash} AND "serverId" = ${serverId} AND "revokedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > now()) AND ("maxUses" IS NULL OR uses < "maxUses") RETURNING id\``; empty → throw a sentinel error → the transaction rolls back → `ack({ success: false, errorCode: "INVITE_INVALID", error: "That invite code isn't valid." })`. Then `tx.inviteUse.create`. Keep the identity bind-on-create inside the same transaction (it's part of the same upsert). **Check column names against the generated migration SQL** (Prisma quotes camelCase columns).
5. **With approval on (18.8):** validate the invite **without** claiming at request time (same WHERE as a `SELECT`), store `inviteId` on the `PendingApproval`; at approval, run the claim (by id instead of hash) inside the approval transaction; if it fails then (expired/used up meanwhile) → approval fails with "The invite used for this request is no longer valid" and the moderator can reject.
6. **Missing/invalid code responses:** no code → `errorCode: "INVITE_REQUIRED"`, `error: "This server needs an invite code for new users."`; invalid → `INVITE_INVALID`. Only for **new** users and only when `requireInvite` is on; `ADMIN_INSTANCE_ID` exempt.
7. **Rate limit:** on `INVITE_INVALID`, `INCR invite-fail:<serverId>:<address>` with `EXPIRE 900` on first increment; before validating, if the counter ≥ 10 → `errorCode: "INVITE_THROTTLED"`, "Too many attempts — try again in 15 minutes." (don't even check the code).
8. **Handlers** (`invite.handler.ts`, gated `BAN_USER` or `ADMIN`): `CREATE_INVITE({ label?, expiresInHours?, maxUses? })` — validate label ≤ 64 chars, `expiresInHours` ∈ {1, 24, 168, 720} or null, `maxUses` integer 1–1000 or null; generate, store hash + prefix, return `{ code: formatInviteCode(code), invite }` (the only time the code leaves the server). `GET_INVITES` → list with status + creator nickname + uses list (`InviteUse` with nicknames, one query). `REVOKE_INVITE({ id })` → set `revokedAt`.
9. **shared-types:** `USER_JOIN_SERVER` payload `inviteCode?: string`, ack `errorCode?: "INVITE_REQUIRED" | "INVITE_INVALID" | "INVITE_THROTTLED"`; `IInvite`; the three events; settings `requireInvite`.
10. **preload:** `connect(…, opts: { inviteCode?: string })` passes it in the join payload; on an ack with `errorCode`, include it in the `error` event (`{ code: res.errorCode, message }`).
11. **Renderer:** hidden `<input id="invite-code">` row in the connect form; on `INVITE_REQUIRED`/`INVITE_INVALID` show it, focus it, show the message under it; clear it after a successful join; never store it. Moderator UI (User Management → Invites) as in the Design section; the code reveal modal has a Copy button and the text "This code is shown only once."
12. **Tests:** generation (length, alphabet, randomness sanity), normalization (dashes, lower-case, Crockford substitutions, wrong length), hash stability, status rules, throttle counter logic (pure function deciding from a count).
13. Verification, `/log-progress`, commit, stop.

### Pitfalls

- Never store or log the plain code; never return it from `GET_INVITES`.
- A failed join must not consume a use (that's why the claim is inside the user-creation transaction).
- Generic error for every invalid state (don't tell an attacker a code exists but expired).

### Done When

- [ ] New users need a valid code; returning users don't; uses are counted exactly (race-tested); revoke/expiry/max-uses enforced; throttling works; combined with approval, the use is consumed on approval.

### Regression Risk

Same shape as 18.8: one branch for new users when the switch is on; off by default.

### Verification

- Unit tests: code generation/normalization/formatting; the "is the invite usable" rules; rate-limit counter logic.
- Migration on a throwaway DB.
- Live: switch on → new user without code refused with `INVITE_REQUIRED`; wrong code → `INVITE_INVALID`; valid single-use code → joins, second new user with the same code refused; concurrent joins racing for the last use → exactly one wins; revoked/expired refused; returning user without code joins; 11th failure from an address is throttled; with approval also on → use consumed only on approval.
- Headless UI: field reveal flow, invite creation (code shown once), list, revoke.

---

## PRD 18.10 — Fix: Link-Preview Hardening (Size Cap, Caches, Private Networks, Direct Images, On/Off Switch)

**Type:** 🐛 FIX (robustness + privacy)
**Priority:** High
**Affected Components:** `main.ts` (`fetchLinkPreviewFast()`, `fetchLinkPreviewViaHiddenWindow()`, `fetchLinkPreview()`, the cache), a new pure `apps/client/src/link-preview-guard.ts` (address checks, HTML head reader, cache), a new Electron-free `apps/client/src/link-preview-fetch.ts` (the fetch logic moved out of `main.ts` so it can be tested in plain Node), `apps/client/package.json` (`undici@^7`), `renderer.ts` (renderer cache, the on/off preference, direct-image cards), `index.html` (switch, CSS), `preload.ts` (types only).

### Current Behavior (from code reading)

- `fetchLinkPreviewFast()` **clears its 5 s timeout as soon as headers arrive**, then calls `response.text()` with no size limit and no timeout: a link to a huge or slow response (a 1 GB file, an endless stream) is read fully into the main process's memory by **every** client that renders the message.
- Any content type is read as text; for a non-HTML link (a video, a zip) metascraper finds nothing, so it returns `null` → the **hidden-window fallback then loads the same URL in a real browser window** (downloading it again).
- Both caches (main's `linkPreviewCache`, the renderer's `linkPreviewCache`) keep every entry — failures included — forever, unbounded; signed video URLs from fixers (PRD 17.9) can expire while cached.
- Concurrent requests for the same URL (several messages with it, several tabs) each start their own fetch.
- **Any host is fetched**, including `localhost`, `192.168.x.x`, `10.x`, `169.254.169.254`: anyone can post a link that makes every reader's client send a request into their own home network (router admin pages, NAS, cloud metadata endpoints).
- The hidden window uses the **default session**, sharing cookies/storage with the app itself, and nothing stops a download it triggers.
- There's no way to turn previews off. Each preview means the client contacts the linked site, revealing its IP address to whoever posted the link.

### Goal

Bounded, well-behaved preview fetching; no requests into private networks; direct image links preview as images; a per-user switch to turn previews off.

### Design

**Fetch path (`fetchLinkPreviewFast`):**
- One `AbortController` and one **overall deadline (8 s)** covering connect, headers **and** body.
- **Redirects handled manually** (`redirect: "manual"`, max 5 hops), each hop's URL re-validated (scheme http/https only, address check below). The fixer strict-host rule (17.9) is evaluated on the final hop as today.
- **Content-type gate:** `text/html` / `application/xhtml+xml` → read the HTML (below). `image/*` (and not SVG — SVG can carry scripts; it would still render in an `<img>` safely, but it's excluded to keep the rule simple) → a **direct-image preview** `{ kind: "image", image: finalUrl, domain }` **without reading the body** (abort right after headers), only if `content-length` is absent or ≤ 20 MB. Anything else → `null` and **no hidden-window fallback** (new `reason: "not-html"` so `fetchLinkPreview()` knows not to escalate).
- **HTML head reader (`readHtmlHead`, pure-ish, unit-tested with a fake stream):** read the body stream chunk by chunk, stop at the first `</head>` (case-insensitive) or at **1 MB**, whichever comes first, then cancel the stream. Decode with the charset from `content-type` or a `<meta charset>`/`http-equiv` sniff in the first 1024 bytes (`TextDecoder`, falling back to UTF-8 on unknown labels). metascraper and `extractOgTags()` run on that text (OG/Twitter tags live in `<head>`).
- **In-flight de-duplication:** a `Map<url, Promise>` so concurrent callers share one fetch.

**Private-network block (`link-preview-guard.ts`):**
- `isBlockedAddress(ip)` on a `net.BlockList`: `0.0.0.0/8`, `10/8`, `100.64/10` (CGNAT), `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.168/16`, `198.18/15`, `224/4` and above, `::/128`, `::1/128`, `fc00::/7`, `fe80::/10`, `ff00::/8`, IPv4-mapped forms normalized first.
- Literal-IP URLs and `localhost`/`*.localhost`/`*.local`/`*.internal`/single-label hosts are refused before any request.
- **DNS:** to stop a public name that resolves to a private address (including DNS-rebinding between the check and the connect), the request uses a dispatcher whose `connect.lookup` resolves the name, refuses blocked addresses, and connects to the address it checked — via `undici`'s own `fetch` + `Agent({ connect: { lookup } })` (import **both** from the `undici` package: passing a package `Agent` to Node's built-in global `fetch` mixes two undici copies and is unsupported). **Pin `undici@^7`, not the latest:** on 10/10/2026 `undici@8` requires Node ≥ 22.19, while Electron 34's main process runs Node **20.19.1** (verified with `ELECTRON_RUN_AS_NODE=1 electron -p process.versions.node`); `undici@7.30.0` requires Node ≥ 20.18.1 and is CommonJS (no `"type": "module"`, `main: index.js`), so it is safe to `import` from `main.ts` under the CommonJS gotcha. Re-check both facts with `npm view undici@7 engines type` before installing. If it can't be used, fall back to a `dns.lookup(host, { all: true })` pre-check + refusing redirects to blocked hosts, and document the remaining DNS-rebinding gap.
- **Hidden window:** runs only after the fast path validated the URL; uses a dedicated **in-memory session** (`session.fromPartition("link-preview")` — no `persist:` prefix, so nothing is written to disk and it shares no cookies with the app) with `webRequest.onBeforeRequest` cancelling requests to literal blocked IPs / local names, `will-download` cancelled, permission requests denied, `setWindowOpenHandler(() => ({ action: "deny" }))`, and audio muted.
- The connected Reson8 server's own host is **not** special-cased: a LAN server's own links (e.g. an intranet wiki) simply don't preview. Documented.

**Caches (`main.ts` + renderer):**
- Main: an LRU of **500** entries with TTLs — success **6 h**, fixer results carrying a video **30 min** (signed URLs), failures **10 min**.
- Renderer: same TTLs, **300** entries (it exists to skip the IPC round trip).

**Direct-image card (renderer `createPreviewCard`):** `kind: "image"` renders just the image (no title/description), max 420×300 like other preview media; a click opens the limited, zoom-only image viewer (`openLightbox(url, { previewOnly: true })`, the same rule PRD 18.19 applies to every preview image). Errors hide the card.

**"Show link previews" switch (Settings → Application):** `reson8-link-previews` (`"false"` = off; default on). Off → `injectLinkPreview()` returns immediately (no request is made — the privacy point) and a `body.link-previews-off` class hides cards already rendered, live. Turning it back on applies to messages rendered from then on (already-open tabs show previews again after being reopened) — stated in the helper text: "Each preview makes Reson8 contact the linked website, which can see your IP address."

**Wire:** none (client-only).

### Edge Cases

- A page whose `<head>` exceeds 1 MB (rare; some SPA shells) → parsed from the first 1 MB; if nothing found, the hidden-window fallback still applies (it's an HTML page).
- `content-length` lies → the stream cap still applies.
- Fixer requests (17.9) go through the same guarded fetch (they're public hosts).

### Implementation Steps (do them in this order)

1. **Read first:** `main.ts` link-preview section (~60–415), `link-fixers.ts`, `renderer.ts` `injectLinkPreview()`/`createPreviewCard()`/`linkPreviewCache`, the Application settings markup in `index.html`.
2. **Dependency:** `npm view undici@7 version engines type` → install `undici@^7` in `apps/client` (`npm install -w apps/client undici@^7`). Confirm `apps/client/package.json` `build.files` doesn't need changes (dependencies under `node_modules` are packed automatically; check that `electron-builder` includes `node_modules/undici` in a test build listing or `asar list`).
3. **`link-preview-guard.ts` (pure where possible):**
   ```ts
   export function isBlockedAddress(ip: string): boolean;          // BlockList with the ranges in the Design section; normalizes ::ffff:
   export function isBlockedHostname(host: string): boolean;       // localhost, *.localhost, *.local, *.internal, *.home.arpa, single-label names, IP literals that are blocked
   export function guardedLookup(hostname, options, callback): void; // dns.lookup(hostname, { all: true }) → drop blocked → none left → callback(Error("blocked address")); else callback(null, first.address, first.family) (respect options.all if set)
   export async function readHtmlHead(body: ReadableStream<Uint8Array>, contentType: string | null, maxBytes = 1_048_576): Promise<string>;
   export function sniffCharset(contentType: string | null, firstBytes: Uint8Array): string; // content-type charset → <meta charset> / http-equiv in first 1024 bytes → "utf-8"
   export class TtlLru<V> { constructor(max: number); get(k): V | undefined; set(k, v, ttlMs): void }
   ```
   `readHtmlHead`: accumulate chunks until total ≥ maxBytes or the decoded-so-far text (decode incrementally with `TextDecoder(charset, { fatal: false })` and `stream: true`) contains `</head>` (case-insensitive) → `reader.cancel()` → return text up to and including `</head>` (or everything read). `TextDecoder` throws `RangeError` on unknown labels → fall back to `utf-8`.
4. **Rewrite `fetchLinkPreviewFast(url, opts)`** using `import { fetch as uFetch, Agent } from "undici"`; one module-level `const previewAgent = new Agent({ connect: { lookup: guardedLookup, timeout: 5000 } })`:
   - `const controller = new AbortController(); const deadline = setTimeout(() => controller.abort(), 8000);` cleared in `finally` (**after** the body is read).
   - Loop up to 5 hops: validate `new URL(current)` (http/https, no credentials, `!isBlockedHostname`), `uFetch(current, { dispatcher: previewAgent, redirect: "manual", signal, headers: { "User-Agent": ua, Accept: "text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5" } })`; 3xx with `location` → `current = new URL(location, current).href`, `await res.body?.cancel()`, continue; otherwise break. Too many hops → `null`.
   - Fixer strict-host check against the **final** `current` URL (replaces `response.url`).
   - `content-type` gate (lower-case, before `;`): html/xhtml → `readHtmlHead(res.body, ct)` → existing metascraper + `extractOgTags` logic unchanged; `image/*` except `image/svg+xml` → if `content-length` header is absent or ≤ 20 MB → `{ kind: "image", image: current, domain }` after `res.body?.cancel()`; anything else → `res.body?.cancel()` → return the sentinel `NOT_HTML`.
   - Return type becomes `Promise<LinkPreviewData | null | typeof NOT_HTML>`; `fetchLinkPreview()` skips the hidden-window fallback on `NOT_HTML` (and caches `null` with the failure TTL).
5. **In-flight de-dupe:** `const inflight = new Map<string, Promise<LinkPreviewData | null>>()` in `fetchLinkPreview()`; delete the entry in `finally`.
6. **Caches:** replace `linkPreviewCache` (main) with `new TtlLru<LinkPreviewData | null>(500)`; TTL: `null` → 10 min; result with `video` from a fixer → 30 min; else 6 h. Renderer: same class duplicated as a small local implementation in `renderer.ts` (the renderer can't import modules), 300 entries, same TTLs (renderer receives `video` → 30 min).
7. **Hidden window:** before creating it, run the same URL validation + a `dns.lookup(all)` check (refuse if any address is blocked). Create with `webPreferences: { sandbox: true, contextIsolation: true, partition: "link-preview" }` (no `persist:` → in-memory). Once per process, configure that session: `ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: isBlockedRequestUrl(d.url) }))` (literal blocked IPs / local names), `ses.on("will-download", (e, item) => item.cancel())`, `ses.setPermissionRequestHandler((_wc, _p, cb) => cb(false))`, `ses.setPermissionCheckHandler(() => false)`; on the window: `webContents.setWindowOpenHandler(() => ({ action: "deny" }))`, `webContents.setAudioMuted(true)`.
8. **LinkPreviewData** (main + the renderer's duplicate interface + preload's return type): add `kind?: "page" | "image"` (absent = page, backwards compatible).
9. **Renderer:** in `createPreviewCard()`, a `kind === "image"` branch: a card containing only `<img class="lpc-image lpc-direct-image">` + domain footer; image click → `e.stopPropagation(); openLightbox(data.image, { previewOnly: true })` (see 18.19); `error` → remove the card.
10. **Switch:** `reson8-link-previews` helpers `isLinkPreviewsEnabled()`/`setLinkPreviewsEnabled()` (copy the `isNsfwBlurEnabled` pattern incl. `try/catch`), `applyLinkPreviewPreference()` toggling `body.link-previews-off`; CSS `body.link-previews-off .link-preview-card { display: none; }`; `injectLinkPreview()` returns immediately when disabled; the switch row in Application settings next to the NSFW switches, initialized where `chkNsfwBlur` is initialized (two places: ~6776 and ~9720 — check both).
11. **Smoke test** `scripts/link-preview-smoke.mjs` + `"test:link-preview"`: blocked-address table, hostnames, charset sniffing, head reader against an in-memory `ReadableStream` (stops at `</head>`, stops at cap, multi-byte char split across chunks), TtlLru (expiry with a fake clock — give the class an injectable `now()`), redirect validation helper.
12. **Live checks** (a Node harness that imports the built `dist/main` helpers is not possible because `main.ts` imports Electron — move the fetch logic into `link-preview-fetch.ts` that doesn't import Electron, so it can be tested in plain Node; `main.ts` keeps only the IPC and hidden-window parts). Run the URL list from Verification against old vs new code and save the comparison in the progress entry.
13. Verification, `/log-progress`, commit, stop.

### Pitfalls

- `redirect: "manual"` in undici returns the 3xx response with a `location` header (not an opaque redirect) — handle relative locations with `new URL(loc, base)`.
- Always cancel bodies you don't read (`res.body?.cancel()`), or sockets stay open.
- `guardedLookup` must honor the `options.all`/`family` contract of `net.connect`'s `lookup` (callback signature differs when `all: true`) — test it.
- Don't change the metascraper/OG extraction logic itself, only what feeds it.
- The fixer path (17.9) must keep working — run `test:link-fixers` and the live fixer checks.

### Done When

- [ ] Memory stays flat on a 1 GB link; non-HTML links never open the hidden window; private targets never receive a request; caches expire; previews identical to before on the comparison list (or differences explained).

### Regression Risk

All previews go through the rewritten fetch. Risks: a site that served previews before now failing (charset, head detection, redirects). Mitigation: run the existing `test:link-fixers` plus a new live check list (below) and compare against the old function's output on the same URLs.

### Verification

- Unit tests (`npm run test:link-preview`): blocked-address table (v4, v6, mapped), local-name rules, head reader (stops at `</head>`, at the cap, charset sniffing incl. ISO-8859-1), LRU/TTL behavior, redirect re-validation.
- Live comparison (old vs new output) on a fixed list: a news article, a GitHub repo, a Cloudflare-walled page (fallback still used), YouTube/X/Reddit (fixers), a direct `.png`/`.jpg`, a 1 GB test file URL (no download; memory stays flat), a `.zip`, `http://192.168.0.1/` and a public name resolving to `127.0.0.1` (both refused, no request leaves — verified with a local listener that must see nothing), a redirect chain into a private address (refused).
- Headless UI: direct-image card + viewer; switch off → no IPC call made (spy), cards hidden live.

---

## PRD 18.11 — Feat: Blur Link Previews in NSFW Channels and for Adult Content

**Type:** ✨ FEATURE
**Priority:** Medium
**Affected Components:** `main.ts` (adult-flag extraction in both fetch paths), `link-preview-guard.ts` or a new pure `link-preview-adult.ts`, `renderer.ts` (`createPreviewCard`, two preferences, NSFW class on channel tabs), `index.html` (switches, CSS).

### Current Behavior

The NSFW-channel blur (PRD 13.5/16.2) covers **attached images only**. Link-preview images and videos — including proxied posts from the 17.9 fixers — show unblurred everywhere, and sites' own adult flags are ignored (risk 6).

### Goal (user decisions)

1. Preview media in **NSFW channels** gets the same blur + "click to reveal" treatment as attachments.
2. Previews the **site itself marks as adult** are blurred **in any channel and in DMs**.
3. **Each has its own switch in Settings → Application** (both on by default).

### Design

**Adult flag (main process, both the fast path and the hidden-window path; pure detector unit-tested):** `adult: true` when any of:
- `og:restrictions:age` present with a value ≥ 18 (e.g. `18+`) — YouTube emits it for age-restricted videos;
- `<meta name="rating" …>` (case-insensitive name) with `adult`, `mature`, `RTA-5042-1996-1400-1577-RTA` (the standard RTA label), or `restricted`;
- Reddit: the vxreddit/fixer page or Reddit's own markup marking the post `over_18`/NSFW — **verify live during implementation** which signal the fixer and the original page actually expose (as 17.9 did for UAs), and only implement signals that were observed; record the findings in the progress entry.
- `LinkPreviewData.adult?: boolean` (main + renderer interfaces; client-only, not on the wire).

**Rendering (`createPreviewCard`):** the media element (image, video, play-overlay wrap, direct-image card) is wrapped in `.lpc-blur-wrap` with an overlay (eye icon + "NSFW — click to reveal" / "Marked as adult content by the site — click to reveal"). Classes decide whether the blur is active, so both switches apply **live** to already-rendered cards (same technique as `body.nsfw-blur-off`):
- the card gets `.lpc-adult` when `data.adult`;
- channel tab contents get `.tab-nsfw` from the **current** tree state (set in `openChatTab`/`switchTab` and refreshed on `CHANNEL_TREE_UPDATE`, so toggling a channel's NSFW flag updates its previews live — attachments keep their render-time behavior, unchanged);
- CSS: `.tab-nsfw .lpc-blur-wrap` and `.lpc-adult .lpc-blur-wrap` blur, except `body.lp-nsfw-blur-off .tab-nsfw .lpc-blur-wrap:not(.lpc-adult *)` / `body.lp-adult-blur-off .lpc-adult .lpc-blur-wrap` (exact selectors finalized in implementation; the rule is "blurred if any enabled reason applies").
- **Reveal** is per card and inline (click on the overlay → `.revealed`, `stopPropagation` so the card's open-URL click doesn't fire); a revealed card stays revealed until re-rendered. A blurred `<video>` doesn't load beyond `preload="metadata"` and can't be played until revealed (overlay covers controls).

**Preferences (Settings → Application, under the existing NSFW switches):**
- "Blur link previews in NSFW channels" — `reson8-lp-nsfw-blur` (`"false"` = off), default on.
- "Blur link previews marked as adult content" — `reson8-lp-adult-blur` (`"false"` = off), default on.
- Both independent from "Blur images in NSFW channels" (attachments), which is unchanged.

### Implementation Steps (do them in this order)

1. **Read first:** 18.10's new fetch module, `createPreviewCard()`, `buildAttachmentsElement()` (NSFW wrap/overlay markup and CSS ~1090–1140 in `index.html`), `openChatTab`/`switchTab`, the `CHANNEL_TREE_UPDATE` handler.
2. **Live research first:** fetch (with the fixer UAs and the normal UA) an age-restricted YouTube video and a Reddit NSFW post through the *real* pipeline; save the `<head>` of each in the scratchpad; list which signals actually appear (`og:restrictions:age`, `rating`, `over_18`, `nsfw` in vxreddit's description/title, etc.). Only implement signals you saw. Record the evidence in the progress entry.
3. **`link-preview-adult.ts` (pure):** `export function detectAdult(meta: { ogTags: Record<string, string>; metaByName: Record<string, string>; extra?: … }): boolean`. Rules: `og:restrictions:age` → parse leading integer ≥ 18; `rating` (lower-case) ∈ {"adult", "mature", "restricted", "rta-5042-1996-1400-1577-rta"}; plus the verified Reddit/fixer signal. To get `metaByName`, extend `extractOgTags()`'s sibling with an `extractNamedMeta(html, names)` regex (both attribute orders, like the OG one) — don't change `extractOgTags()`'s existing output. The hidden-window path's injected script also returns `og:restrictions:age` and `meta[name=rating i]`.
4. `LinkPreviewData.adult?: boolean` in main, preload and the renderer's interface.
5. **Card DOM:** for every media branch (direct video, embed thumbnail, static image, direct image), wrap the media element: `<div class="lpc-blur-wrap">media + <div class="lpc-blur-overlay">eye svg + <span>text</span></div></div>`. Overlay text: `data.adult` → "Marked as adult content by the site — click to reveal", else "NSFW channel — click to reveal". Overlay click: `e.stopPropagation(); wrap.classList.add("revealed");`. If `data.adult`, add `.lpc-adult` to the card.
6. **NSFW class on tabs:** `function syncTabNsfwClass(channelId)` sets `tab.contentEl.classList.toggle("tab-nsfw", !!findChannelNodeById(currentTree, channelId)?.isNsfw)`; call it when a channel tab is created and for every open channel tab after each `CHANNEL_TREE_UPDATE`.
7. **CSS** (in `index.html`, next to the existing NSFW image rules):
   ```css
   .lpc-blur-overlay { display: none; position: absolute; inset: 0; /* same look as .msg-image-nsfw-overlay */ }
   .lpc-blur-wrap { position: relative; overflow: hidden; }
   /* Blur when a reason applies AND its switch is on */
   body:not(.lp-nsfw-blur-off) .tab-nsfw .lpc-blur-wrap:not(.revealed) > :first-child,
   body:not(.lp-adult-blur-off) .lpc-adult .lpc-blur-wrap:not(.revealed) > :first-child { filter: blur(20px); transform: scale(1.05); pointer-events: none; }
   body:not(.lp-nsfw-blur-off) .tab-nsfw .lpc-blur-wrap:not(.revealed) > .lpc-blur-overlay,
   body:not(.lp-adult-blur-off) .lpc-adult .lpc-blur-wrap:not(.revealed) > .lpc-blur-overlay { display: flex; }
   ```
   `pointer-events: none` on the blurred media keeps the video's controls unusable until revealed.
8. **Preferences:** `reson8-lp-nsfw-blur`, `reson8-lp-adult-blur` with the same helper pattern; `applyLinkPreviewBlurPreferences()` toggles `body.lp-nsfw-blur-off` / `body.lp-adult-blur-off`; two switch rows in Application under the existing NSFW rows; initialize in both places the other NSFW switches are initialized.
9. **Smoke tests** in `link-preview-smoke.mjs`: `detectAdult` positive/negative cases from the saved real `<head>`s.
10. Verification, `/log-progress`, commit, stop.

### Pitfalls

- Don't reuse `.msg-image-nsfw-wrap` classes: `body.nsfw-blur-off` (attachments switch) would then also un-blur previews.
- DMs have no `.tab-nsfw`, so only the adult rule applies there — that's intended.
- `transform: scale()` on the media inside an `overflow: hidden` wrap — check it doesn't break the 18.12 reserved aspect-ratio box (do this item's screenshots again after 18.12).

### Done When

- [ ] Both blur reasons work independently and live; reveal is per card; attachments unaffected; signals implemented only where observed.

### Regression Risk

Card DOM gains a wrapper around media; existing preview CSS (`.lpc-image`, `.lpc-video`, `.lpc-media-wrap`) must keep its sizing. Click handling on the card must still open the URL when not blurred.

### Verification

- Unit tests for the adult detector (each signal, case variants, `og:restrictions:age` values, negative cases).
- Live: an age-restricted YouTube video → `adult: true`; normal video → false; Reddit NSFW post per the verified signal.
- Headless UI: preview in a normal channel (clear), NSFW channel (blurred), adult-flagged in a normal channel and a DM (blurred); each switch toggles live; toggling a channel's NSFW flag updates its open tab live; reveal works and doesn't open the link; attachments unaffected.
- **Manual (user):** look and feel of the overlay on image and video cards.

---

## PRD 18.12 — Fix: Chat Stays Put While Link Previews and Images Load

**Type:** 🐛 FIX (UX) — requested by the user during planning
**Priority:** High
**Affected Components:** `renderer.ts` (scroll/stick helpers, `renderChatMessage`/`renderDmMessage`, `stickOnImageLoad`, `injectLinkPreview` callbacks, `holdJumpTarget`, `loadOlderMessages`), `main.ts` (media dimensions in preview data), `index.html` (reserved media boxes, `overflow-anchor`).

### Reported Problem

Opening a text chat renders the text first; link previews are fetched afterwards and pop into the list, pushing content around, so the view drifts away from where it was (the bottom on open, or the position the user was reading).

### Current Behavior (from code reading — hypotheses to confirm in Step 0)

- **H1 — stale "was near bottom":** `renderChatMessage()`/`renderDmMessage()` capture `wasNearBottom` **at render time** and pass it to the preview's `onLoaded` and to `stickOnImageLoad()`. If the user scrolls up while previews are still loading (seconds later), a late preview **yanks them to the bottom**.
- **H2 — size changes after `onLoaded`:** `onLoaded` fires when the **card** is appended, but the card's `<img>`/`<video>` loads later with no reserved size (`.lpc-image` has `width: 100%; max-height: 300px`, no height/aspect), so the card grows again after the stick ran — the view ends a few hundred pixels above the bottom.
- **H3 — growth above the reading position:** when reading history (not at the bottom), a preview/image arriving in a message **above** the viewport pushes what you're reading down. Chromium's native scroll anchoring (`overflow-anchor: auto`) should compensate, but it is suppressed by the frequent programmatic `scrollTop` writes and doesn't cover every case (to confirm).
- **H4 — jumps:** `holdJumpTarget()` (PRD 17.8) re-centers only on `load` events (images), not on preview **cards being inserted**, so a jump target can drift when previews arrive.
- The fade-in animation (`lpc-fade-in`: `translateY(4px)`) is cosmetic and not a cause (transforms don't affect layout).

### Step 0 — Reproduce before fixing (the 17.8 lesson)

Headless, on the unfixed build: a channel with ~40 messages, a dozen with links; the main-process preview handler wrapped to delay each response by 300–2000 ms (random, seeded), and images served slowly. Instrument: sample `scrollTop`, `scrollHeight` and the top message in view every 50 ms; log each `stickToBottom` call with its caller. Scenarios: (a) open the tab and don't touch it; (b) open, then scroll up 600 px immediately; (c) reading in the middle of history while older pages load; (d) jump to a pinned message far back. Record which hypotheses fire. **The fix below is adjusted to what the reproduction shows**, and the progress entry records it.

### Goal

- If you're **at the bottom**, you stay exactly at the bottom while anything loads (previews, images, emoji).
- If you've **scrolled away**, what you're reading doesn't move — not even by a pixel-perfect amount you'd notice — whatever loads above or below it.
- A jump target stays where it landed until you scroll yourself.
- Less movement in the first place: previews take their final size as soon as they're inserted.

### Design

**1. One "follow the bottom" state per tab (fixes H1):** `tab.followBottom: boolean`, updated on **user-driven** scroll only (a passive `scroll` listener that ignores scrolls the code itself caused — a `tab.programmaticScroll` flag set around every programmatic write): `followBottom = isNearBottom(messagesEl)`. Initial load and "Jump to Most Recent" set it to `true`; a jump sets it to `false`. The per-call `wasNearBottom` captures are replaced by reading this state when the size change actually happens.

**2. One resize-driven keeper per tab (fixes H2, H3, H4):** a `ResizeObserver` per tab observing every `.chat-msg` (observed on insertion in the shared render paths, released automatically when elements are removed — `ResizeObserver` holds no strong reference to detached nodes, but `unobserve` is called in `removeMessageElement()` and on tab wipe for clarity). On any size change (batched per animation frame):
- `followBottom` → `stickToBottom(tab)`;
- else if a jump hold is active → re-center the jump target (this replaces `holdJumpTarget`'s `load`-only listener; same 1.5 s window and same "stop on user input" rules);
- else → **restore the reading anchor**: the anchor is the first `.msg-body` whose top is inside the viewport, recorded (element + its offset from the viewport top) on every user scroll and after every programmatic positioning; after layout, `scrollTop += anchor.getBoundingClientRect().top - recordedTop`. This is the same anchoring `loadOlderMessages()` already uses, generalized. CSS `overflow-anchor: none` on `.chat-messages` so native anchoring can't double-correct (decide in Step 0 whether native anchoring alone handles H3 — if it does, keep it and only fix H1/H2/H4; prefer the smaller change).
- `loadOlderMessages()`'s existing prepend correction stays as is (it runs synchronously before the observer fires) and then refreshes the recorded anchor.
- `jumpInProgress` keeps blocking the sentinels exactly as today.

**3. Reserve space (reduces H2 at the source):**
- Main process adds media dimensions when the page declares them: `og:image:width`/`og:image:height`, `og:video:width`/`og:video:height` (and `twitter:player:width/height`), validated as positive integers ≤ 10000 → `imageWidth/imageHeight/videoWidth/videoHeight` on `LinkPreviewData` (client-only).
- The card's media box gets `aspect-ratio: w / h` (capped by the existing `max-height: 300px` with `object-fit: cover`, as today's look) when known; when unknown, a fixed **16:9** box for video and a fixed **max-height box** for images that only shrinks once (accepted; the keeper handles it).
- Direct-image cards (18.10) and message attachments are unchanged in size rules; attachments rely on the keeper (adding stored dimensions to attachments would need a server change — out of scope, noted).

**4. Smaller cleanup:** `stickOnImageLoad()` and the `onLoaded` callbacks of `injectLinkPreview()` become unnecessary once the keeper exists; remove them only if Step 0 + verification show the keeper covers them, otherwise keep them reading `tab.followBottom`.

### Edge Cases

- Hidden tabs (`display: none`): `ResizeObserver` reports 0 sizes; ignore entries while the tab isn't active, and on `switchTab()` re-apply: `followBottom` → bottom; else restore the anchor.
- "See more"/"See less" (17.7) change a message's height on purpose: when you expand a message, the content below it moves (expected) and what you clicked stays put (the anchor is the first visible message, normally above or at the clicked one).
- Window resize: the keeper re-applies the same rule (bottom stays bottom).
- Smooth scroll in progress (`scrollIntoView({ behavior: "smooth" })` for already-loaded jump targets): the keeper doesn't fight it — anchor updates are skipped while a smooth scroll is running (until `scrollend`).

### Implementation Steps (do them in this order)

1. **Read first:** `isNearBottom`, `stickToBottom`, `stickOnImageLoad`, `renderChatMessage`, `renderDmMessage`, the prepend path (`loadOlderMessages`), `loadNewerMessages`, `jumpToMessage`, `holdJumpTarget`, `rebuildTabAtLatest`, `scrollToMostRecent`, `switchTab`, `removeMessageElement`, every place that writes `scrollTop` or calls `scrollIntoView` (`grep -n "scrollTop\s*=\|scrollIntoView\|stickToBottom(" renderer.ts`) — list them in a table with their purpose.
2. **Step 0 (reproduce)**, exactly as in the Design section. Instrumentation is injected over the DevTools protocol (`Runtime.evaluate` can replace top-level function bindings in the classic script, as 17.8 did): wrap `stickToBottom` to log `new Error().stack` lines 2–3; sample with `setInterval(…, 50)`; delay previews by wrapping `api.fetchLinkPreview` in the renderer (`const orig = api.fetchLinkPreview; api.fetchLinkPreview = (u) => new Promise(r => setTimeout(() => orig(u).then(r), delayFor(u)))` — `api` is the contextBridge object; if it's frozen, wrap `injectLinkPreview` instead). Serve slow images from a local HTTP server that sleeps per request. Save logs + screenshots; write the findings (which of H1–H4 fired, by how many px) into the progress entry **before** writing the fix.
3. **State:** add to `ChatTab`: `followBottom: boolean` (init `true`), `programmaticScroll: number` (a counter, not a boolean, so nested writes work), `anchor: { el: HTMLElement; top: number } | null`, `resizeObserver: ResizeObserver | null`, `holdTarget: { el: HTMLElement; until: number } | null`.
4. **One helper for every programmatic scroll:** `function setScroll(tab, fn: () => void)` → `tab.programmaticScroll++; try { fn(); } finally { requestAnimationFrame(() => { tab.programmaticScroll--; recordAnchor(tab); }); }`. Replace every direct write found in step 1 with `setScroll(tab, () => …)` (keep the exact same scroll math inside). `stickToBottom` becomes `setScroll(tab, () => { tab.messagesEl.scrollTop = tab.messagesEl.scrollHeight; })`.
5. **User scroll listener** (in `setupInfiniteScroll` or tab creation, `{ passive: true }`): if `tab.programmaticScroll > 0` return; `tab.followBottom = isNearBottom(tab.messagesEl)`; `recordAnchor(tab)`; any user scroll also clears `tab.holdTarget`. Also clear `holdTarget` on `wheel`/`touchstart`/`keydown`/`pointerdown` (as `holdJumpTarget` does now).
6. **`recordAnchor(tab)`**: find the first `.chat-msg .msg-body` whose `getBoundingClientRect().bottom > messagesEl.getBoundingClientRect().top` (binary search over the NodeList if it's slow — a linear scan with an early exit is fine for a few hundred messages); store `{ el, top: rect.top - containerTop }`.
7. **ResizeObserver per tab** (create in tab setup, `disconnect()` in `closeTab`): `observe()` each `.chat-msg` right after insertion — add a single `trackMessageElement(tab, el)` call in `renderChatMessage`, `renderDmMessage`, the prepend path and anywhere else a `.chat-msg` is inserted (same places that call `applyGrouping`/`regroupFrom`); `unobserve()` in `removeMessageElement()`. Callback, batched with one `requestAnimationFrame`:
   ```ts
   if (!isTabVisible(tab) || tab.programmaticScroll > 0 && !tab.followBottom) return;
   if (tab.followBottom) return stickToBottom(tab);
   if (tab.holdTarget && performance.now() < tab.holdTarget.until && tab.holdTarget.el.isConnected)
     return setScroll(tab, () => tab.holdTarget!.el.scrollIntoView({ behavior: "instant", block: "center" }));
   if (tab.anchor?.el.isConnected) {
     const delta = (tab.anchor.el.getBoundingClientRect().top - containerTop(tab)) - tab.anchor.top;
     if (Math.abs(delta) >= 1) setScroll(tab, () => { tab.messagesEl.scrollTop += delta; });
   }
   ```
8. **`holdJumpTarget(tab, el, ms)`** becomes: `tab.holdTarget = { el, until: performance.now() + ms }; tab.followBottom = false;` plus the existing re-center on image `load` can be dropped once the observer covers it (verify in Step 0's scenario (d)).
9. **Remove stale captures:** in `renderChatMessage`/`renderDmMessage`, `wasNearBottom` is replaced by `tab.followBottom` read at the moment of use; `stickOnImageLoad` and the `onLoaded` preview callback become no-ops → delete them only if verification passes without them; otherwise make them read `tab.followBottom`.
10. **Initial load / jump-to-recent / rebuild:** set `tab.followBottom = true` before rendering the latest page; `jumpToMessage` sets `false`; `loadOlderMessages`' existing anchor correction stays and is wrapped in `setScroll`, followed by `recordAnchor`.
11. **CSS:** `.chat-messages { overflow-anchor: none; }` — only if Step 0 shows native anchoring fights the manual one (decide from data, record the decision).
12. **Reserved media size (main + renderer):** in 18.10's extraction, read `og:image:width/height`, `og:video:width/height`, `twitter:player:width/height` → validated ints → `LinkPreviewData.mediaWidth/mediaHeight`. In `createPreviewCard`, set `mediaEl.style.aspectRatio = \`${w} / ${h}\`` on the media element (or the blur wrap from 18.11) when known; CSS default for `.lpc-video` without dims: `aspect-ratio: 16 / 9`. Keep `max-height: 300px; object-fit: cover` (unchanged look). For images with known dims, also set `width: 100%` so the box exists before load.
13. **switchTab:** after showing a tab: `followBottom` → `stickToBottom`; else restore `anchor` (same delta math).
14. Verification (re-run Step 0 + the 17.8 list), `/log-progress` (include Step 0 findings and before/after numbers), commit, stop.

### Pitfalls

- A `ResizeObserver` callback that changes scroll can trigger more resizes → loop warnings ("ResizeObserver loop completed with undelivered notifications"). Batch in `requestAnimationFrame` and never change element sizes inside the callback.
- `scrollIntoView({ behavior: "smooth" })` (already-loaded jump targets) runs over several frames: treat it as programmatic until `scrollend` (`setScroll` + an extra `scrollend` listener that decrements).
- Hidden tabs (`display: none`) report zero-size entries — ignore them (`isTabVisible`).
- Don't break the unread separator, date dividers, grouping, truncation measurement (17.7 measures on show) or the "Jump to Most Recent" visibility logic.

### Done When

- [ ] Step 0 metrics after the fix: (a) bottom exact, (b) never yanked, (c) ≤ 2 px drift, (d) target held; the 17.8 list passes; no ResizeObserver loop warnings in the console.

### Regression Risk

High-touch area: every message insertion path, jumps (17.8), prepends (14.2), "Jump to Most Recent" (14.3), unread separator positioning, truncation measurement. Every 17.8 scenario is re-run.

### Verification

- Step 0's instrumented scenarios re-run on the fixed build: (a) ends exactly at the bottom (`scrollHeight - scrollTop - clientHeight ≤ 1`) after all previews/images load; (b) never yanked to the bottom; (c) the top visible message's offset changes by ≤ 2 px across every load; (d) the jump target stays centered until user input.
- The 17.8 regression list: pinned jump far back, newer-page loading, live message into a detached window, own message rebuilds at the present, jump-to-recent.
- `npx tsc --build`, `npm run lint`, `npm run test:markdown`.
- **Manual (user):** open busy channels with many links on a real server; read history while previews load.

---

## PRD 18.13 — Feat: Unread Indicator and "See More" Collapse for DM Tabs

**Type:** ✨ FEATURE
**Priority:** Medium
**Affected Components:** `renderer.ts` (`refreshTabUnread()`, the `dm-received` handler, `fetchAndRenderLatestPage()` DM branch, `switchTab()`, window focus handling, `renderDmMessage()` + the DM prepend path), `index.html` (none expected — the channel tab's `.has-unread` styling is reused).

### Current Behavior

- `refreshTabUnread()` (`renderer.ts:~1845`) returns early for anything but channel tabs.
- A DM that arrives in an **open** DM tab is marked read on arrival (`api.markDmsRead(partnerId)` in the `dm-received` handler, `renderer.ts:~6266`) **even when that tab isn't focused or the window is in the background** — so an open DM tab never shows unread state and the "Unread Messages" line is wrong on the next open.
- DM history loading (`fetchAndRenderLatestPage`, `~4679`) marks unread DMs read as soon as the tab **loads** — including tabs auto-opened in the background on connect (`getUnreadDmPartners()` opens one tab per partner; only the last one ends up focused).
- DM messages are never collapsed: `renderDmMessage()` doesn't call `attachMessageTruncation()`.

### Goal (user decision: keep auto-focus for newly opened DM tabs)

- An open DM tab you're **not looking at** shows the same red dot + bold name as channel tabs (17.6).
- A DM counts as read only when its tab is **active and the window is focused**.
- A brand-new incoming DM conversation still opens **and focuses** its tab, as today; if the window isn't focused at that moment, it stays unread until you come back to the window.
- Long DMs collapse behind "See more" exactly like channel messages (15-line threshold, 4 lines shown).

### Design

- **State:** `unreadDmPartners: Set<string>` (partner ids), the DM counterpart of `unreadChannelIds`.
- **`refreshTabUnread(tabId)`** handles both kinds: DM → `show = unreadDmPartners.has(partnerId) && !(activeTabId === tabId && document.hasFocus())`. (DMs have no mute, so no mute check.)
- **One helper `markDmTabRead(tab)`**: if the tab is active and `document.hasFocus()` and the partner is in the set (or the loaded page contains unread messages) → `api.markDmsRead(partnerId)`, delete from the set, refresh. Called from: `switchTab()` to a DM tab; the window `focus` event (for the active DM tab); after the DM history page renders (instead of the unconditional call); the `dm-received` handler (instead of the unconditional call).
- **`dm-received`:** a message from the partner into an existing tab → add to the set, then `markDmTabRead(tab)` (which clears it immediately if you're looking). A new conversation → `openDmTab()` (focus, as today) and the history load path decides read/unread by focus.
- **Connect-time auto-open:** the tabs opened for `getUnreadDmPartners()` are seeded into `unreadDmPartners` before opening, so the ones that end up in the background keep their dot and their "Unread Messages" line.
- **Sound alert** logic unchanged (it already uses `wasTabActive` + window focus).
- **Truncation:** call `attachMessageTruncation(el, textEl)` in `renderDmMessage()` (after insertion, as the channel path does) and in the DM branch of the prepend path. `switchTab()`'s existing pending-measurement pass (`.chat-msg[data-truncation-pending]`) already covers hidden DM tabs; `collapseAllExpandedMessages()` already works on every tab. Remove the outdated "DMs are never truncated" comments.

### Edge Cases

- The window is focused but another app is on top (`document.hasFocus()` true) — treated as looking, same as today's sound logic.
- Closing a DM tab with unread messages: the set entry is dropped; the server still has them unread, so the next connect reopens the tab (today's behavior).
- Messages you send yourself never mark anything unread.

### Implementation Steps (do them in this order)

1. **Read first:** `refreshTabUnread`, `markChannelRead`, the `dm-received` handler, `fetchAndRenderLatestPage` (DM branch), `openDmTab`, `switchTab`, the connect-time `getUnreadDmPartners()` block, `renderDmMessage`, the DM branch of the prepend path, `attachMessageTruncation`, `closeTab`, any existing `window.addEventListener("focus"…)`.
2. **State:** `const unreadDmPartners = new Set<string>();` near `unreadChannelIds`; clear it on disconnect where `unreadChannelIds` is cleared.
3. **`refreshTabUnread(tabId)`**: keep the channel branch byte-for-byte; add: `if (tab.kind === "dm") { const partnerId = tabId.slice(3); const show = unreadDmPartners.has(partnerId) && !(activeTabId === tabId && document.hasFocus()); …same class/aria handling… }`. The DM tab element is built by `fillTabElement` like channel tabs, so `.tab-unread-dot` already exists in it — verify.
4. **`markDmTabRead(tab, opts?: { hadUnreadOnPage?: boolean })`**: `if (activeTabId !== tab.channelId || !document.hasFocus()) return; const partnerId = …; if (!unreadDmPartners.has(partnerId) && !opts?.hadUnreadOnPage) return; unreadDmPartners.delete(partnerId); refreshTabUnread(tab.channelId); api.markDmsRead(partnerId);`
5. **Call sites:**
   - `dm-received`: replace the unconditional `api.markDmsRead(partnerId)` with `unreadDmPartners.add(partnerId); refreshTabUnread(tabKey); markDmTabRead(tab);` (only for messages from the partner).
   - DM branch of `fetchAndRenderLatestPage`: replace `if (firstUnreadIndex !== -1) api.markDmsRead(partnerId)` with `if (firstUnreadIndex !== -1) { unreadDmPartners.add(partnerId); markDmTabRead(tab, { hadUnreadOnPage: true }); }`.
   - `switchTab(tabId)`: after the tab becomes active, if it's a DM tab → `markDmTabRead(tab)`; also call `refreshTabUnread` for the previously active DM tab (its dot may need to reappear only when new messages arrive — no change needed, just keep it consistent).
   - `window.addEventListener("focus", …)`: if the active tab is a DM tab → `markDmTabRead`. `window.addEventListener("blur", …)`: nothing (the dot appears only when a new message arrives while unfocused — that's handled by the `dm-received` path because `document.hasFocus()` is false then).
   - Connect-time auto-open: before `openDmTab(...)` for each partner, `unreadDmPartners.add(p.partnerId)`.
6. **Truncation:** in `renderDmMessage`, after insertion and `applyGrouping`, add the same block the channel path uses (`if (msg.content) { const textEl = el.querySelector(".msg-text"); if (textEl) attachMessageTruncation(el, textEl); }`); same in the DM prepend branch. Remove the "DMs are never truncated" comments (`grep -n "never truncat\|un-truncated" renderer.ts`).
7. **Sound alert:** untouched (`wasTabActive` + focus logic stays).
8. Verification, `/log-progress`, commit, stop.

### Pitfalls

- `document.hasFocus()` is synchronous and correct in the renderer — don't use the async `api.isWindowFocused()` here (ordering bugs).
- Don't mark read on **your own** sent messages arriving back.
- The server's read state now lags until the tab is really viewed: make sure reconnecting doesn't spam `markDmsRead` (only one call per actual view).

### Done When

- [ ] Background DM tabs show the dot and keep messages unread in the DB until viewed with the window focused; foreground behavior unchanged; long DMs collapse like channel messages, including in hidden tabs once shown.

### Regression Risk

The DM read state on the server changes *when* it's set (later, correctly) — the only visible effect elsewhere is `GET_UNREAD_DM_PARTNERS` reopening tabs for messages you truly haven't seen. Channel tab behavior unchanged (shared function, channel branch untouched).

### Verification

- Headless (two clients): B sends to A while A's DM tab is open but A is on another tab → dot appears, `readAt` stays null in the DB; A switches to it → dot clears, `readAt` set; A's window unfocused (simulated via `Emulation.setFocusEmulationEnabled` / blur) with the DM tab active → stays unread until focus; reconnect with two unread partners → both tabs open, the background one keeps its dot; a 40-line DM collapses, a 10-line one doesn't; a long DM arriving in a background DM tab collapses once shown.
- `npx tsc --build`, `npm run lint`, `npm run test:markdown`.
- **Manual (user):** day-to-day DM use.

---

## PRD 18.14 — Fix: X/Twitter Links Lose Their Video (fxtwitter Fixer)

**Type:** 🐛 FIX
**Priority:** High
**Affected Components:** `apps/client/src/link-fixers.ts` (per-fixer User-Agent), `main.ts` (`fetchLinkPreview()` passes the rule's UA), `scripts/link-fixers-smoke.mjs`.

### Reported Problem

A link to a post with a video on `x.com`/`twitter.com` doesn't show the video in the chat preview, although opening the same post through `fxtwitter.com` by hand shows the media normally. The user expected `x.com` and `twitter.com` to be rewritten to `fxtwitter.com`.

### Root Cause (confirmed live, 10/10/2026)

The host rewrite is **already correct**: `toFixerUrl()` maps `x.com`, `twitter.com` and their `www.`/`mobile.` variants to `https://fxtwitter.com/<path>` (covered by `test:link-fixers`). The problem is the **User-Agent**. Since PRD 17.9 every fixer request sends `FIXER_USER_AGENT`, which carries a `Discordbot/2.0` token (needed by vxreddit). fxtwitter treats Discordbot specially: for a video post it returns **no `og:video`, `og:image` or `twitter:player:stream` tags at all**, only `twitter:card=player` plus an `application/activity+json` link (the ActivityPub feed Discord itself follows to fetch the media). The strict fixer rule ("must deliver an image or a video") then rejects the answer and the normal flow runs on `x.com`, which gives no media.

Same video post (`x.com/NASA/status/1914234202700054566`) fetched from `fxtwitter.com` with different User-Agents:

| User-Agent | Result |
|:---|:---|
| `… Reson8Bot/1.0; Discordbot/2.0 …` (current) | 200, no media tags (ActivityPub link only) |
| `Mozilla/5.0 (compatible; Discordbot/2.0; …)` | same — no media tags |
| `Mozilla/5.0 (compatible; Reson8Bot/1.0; +https://github.com/fbarrella/reson8)` (the pre-17.9 UA) | 200, `og:video` = direct `https://video.twimg.com/…mp4`, `og:video:type` = `video/mp4`, width/height, `og:image` thumbnail |
| `TelegramBot (like TwitterBot)` | 200, `og:video` through fxtwitter's own redirector (`api.fxtwitter.com/2/go?url=…`) |
| a normal browser UA | redirected to `x.com` (as 17.9 recorded) |

The `video.twimg.com` MP4 answers `200`, `content-type: video/mp4`, `access-control-allow-origin: *`: it plays directly in the card's `<video>`.

### Design

- `FixerRule` gains an optional `userAgent`. The X rule uses the plain crawler UA (`Mozilla/5.0 (compatible; Reson8Bot/1.0; +https://github.com/fbarrella/reson8)`, without the Discordbot token); every other rule keeps `FIXER_USER_AGENT` exactly as now (vxreddit needs Discordbot). `toFixerUrl()` returns the UA in `FixerTarget`, and `main.ts` passes `fixer.userAgent` instead of the constant.
- No host change: the mapping stays exactly as the user described (both hosts → `fxtwitter.com`), and the fixer result keeps the original URL/domain and names "X" as the site (17.9 rules).
- **Re-verify every fixer's UA behavior live** while implementing (the services change over time; that is what broke this one) and record a per-fixer table in the progress entry. If another fixer also turns out to hide media from Discordbot, give it the plain UA too.
- Image-only posts (photos) are checked as well: they must still produce an `og:image` card.
- The smoke test gains: the X rule reports the plain UA, the Reddit rule reports the Discordbot UA, and every other rule keeps its current UA.
- Interaction with 18.10: the guarded fetch passes the UA through unchanged; fixer results that carry a video get the 30-minute cache TTL (the `video.twimg.com` URLs are long-lived, but fxtwitter's redirector URLs may not be).

### Implementation Steps (do them in this order)

1. **Re-verify live first** (services change): with `curl -sL -A "<UA>"` against one video post, one photo post and one text post on `fxtwitter.com`, for the two UAs (`… Reson8Bot/1.0; Discordbot/2.0 …` and the plain `… Reson8Bot/1.0 …`). Expected (10/10/2026): the plain UA returns `og:video` + `og:video:type=video/mp4` for video posts. If that has changed, stop and report before coding.
2. **`link-fixers.ts`:**
   - Add `export const PLAIN_CRAWLER_USER_AGENT = "Mozilla/5.0 (compatible; Reson8Bot/1.0; +https://github.com/fbarrella/reson8)";` — the exact string `main.ts` uses today as its default UA (copy it from `fetchLinkPreviewFast`'s default; after 18.10 it lives in the fetch module — import it from `link-fixers.ts` there so there's one definition).
   - `FixerRule.userAgent?: string`; the X rule gets `userAgent: PLAIN_CRAWLER_USER_AGENT`; `FixerTarget.userAgent: string` = `rule.userAgent ?? FIXER_USER_AGENT`.
   - Update the `FIXER_USER_AGENT` doc comment: it's the default for fixers; fxtwitter is the exception because it hides media from Discordbot (with the 10/10/2026 evidence in one line).
3. **`main.ts` / the 18.10 fetch module:** pass `fixer.userAgent` instead of `FIXER_USER_AGENT`.
4. **Re-check every other fixer** (koutube, oginstagram, vxreddit, fxtwitch, vxbsky, imgurez) with both UAs on one media post each; record a table (fixer × UA → media tags present yes/no) in the progress entry; change a rule's UA only if the evidence says so.
5. **Smoke test additions** (`link-fixers-smoke.mjs`): `toFixerUrl("https://x.com/a/status/1").userAgent === PLAIN_CRAWLER_USER_AGENT`; same for `twitter.com` and `mobile.twitter.com`; `toFixerUrl("https://www.reddit.com/r/a/comments/b/c/").userAgent === FIXER_USER_AGENT`; every other network's rule → `FIXER_USER_AGENT` (unless step 4 changed it).
6. Verification, `/log-progress`, commit, stop.

### Pitfalls

- Don't change the host mapping, the strict rules or the fallback flow — only the header.
- Don't hard-code the UA string twice.

### Done When

- [ ] A video post on x.com/twitter.com plays inline; photo and text posts still preview; Reddit still works; smoke tests pass.

### Regression Risk

Only the X rule's request header changes. Reddit, Instagram, YouTube, Twitch, Bluesky and Imgur keep their current UA unless the live re-check shows they need a change, in which case it's recorded.

### Verification

- `npm run test:link-fixers` (extended).
- Live, through the real `fetchLinkPreview()` (headless app or a small Node harness importing the built `main` helpers): a video post on `x.com`, the same on `twitter.com` and `mobile.x.com` → `video` is a direct MP4 and `videoType` is `video/mp4`; a photo post → `image`; a text-only post → title/description card; a Reddit video post still works.
- Headless UI: the card plays the video inline.
- **Manual (user):** paste the post that failed before.

---

## PRD 18.15 — Fix: Same "Category" Badge on Every Parent Channel (Text and Voice)

**Type:** 🐛 FIX (UI consistency)
**Priority:** Low
**Affected Components:** `renderer.ts` (`renderCategory()`), `index.html` (badge CSS class rename).

### Reported Problem

A text channel that becomes a parent shows a "Category" label, but a voice channel that becomes a parent doesn't. Both should show the same label.

### What the code says (to reconcile in Step 0)

Every channel with children goes through `renderCategory()` (`renderer.ts:~2060`), at the top level and nested. The badge there is built **only for voice parents**: `node.type === "VOICE" ? '<span class="category-voice-badge" …>Category</span>' : ""` (PRD 14.6, tooltip "Voice channels with sub-channels can't be joined directly"). By reading the code, a **text** parent shows no badge, which is the reverse of the report. So the first step is to look at the real thing before changing it.

### Step 0

Headless, on the current build: create a text parent and a voice parent (each with one child), at the top level and nested; take a screenshot of the tree. Record which one shows the badge and why: a text vs voice mix-up in the report, a CSS rule hiding it, or the voice badge never rendering because of something in the tree payload. Record the finding in the progress entry.

### Goal

**Every** parent channel shows the same "Category" badge, whatever type it started as, with the same look.

### Design

- Build the badge for every node rendered by `renderCategory()`. Rename the class to `.category-badge` (keep the existing styling; drop the voice-specific name).
- Tooltip by origin, since the two cases differ slightly: voice → "A voice channel with sub-channels can't be joined directly"; text → "A text channel with sub-channels opens as a category; its chat isn't shown in the tree". Confirm in Step 0 how a text parent behaves when clicked (today its label only toggles collapse) and word the tooltip to match what really happens.
- If Step 0 shows the voice badge isn't rendering at all, fix that cause too (e.g. a type-value mismatch or a CSS conflict) — that's this item's scope.
- No change to how parents behave (joining, collapsing, drag-and-drop, context menu).

### Implementation Steps (do them in this order)

1. **Step 0:** headless — create (via the real server, admin client) a text channel `T` with a child text channel and a voice channel `V` with a child, both at the root, and the same nested under another category. `Page.captureScreenshot` of the tree; also `Runtime.evaluate` → `[...document.querySelectorAll(".tree-category-label")].map(l => ({ text: l.textContent, badge: !!l.querySelector(".category-voice-badge, .category-badge") }))`. Record what each shows and whether clicking a text parent's label does anything besides collapsing. Report the result to the user in the stop message (it explains the mismatch with the report).
2. **`renderCategory()`:** replace the `voiceBadge` constant with:
   ```ts
   const badgeTitle = node.type === "VOICE"
       ? "A voice channel with sub-channels can't be joined directly"
       : "<text decided from Step 0's observed behavior>";
   const badge = `<span class="category-badge" title="${escapeHtml(badgeTitle)}">Category</span>`;
   ```
   and use `${badge}` in `label.innerHTML` (the name is already escaped; keep it so).
3. **CSS:** rename `.category-voice-badge` → `.category-badge` in `index.html` (`grep -rn category-voice-badge apps/client/src` must return nothing afterwards).
4. If Step 0 found the voice badge not rendering, fix the actual cause (document it) — e.g. a payload `type` value or CSS hiding it.
5. Verification (screenshot again), `/log-progress`, commit, stop.

### Pitfalls

- The `title` attribute is inside an HTML string: escape it.
- Don't touch drag/context-menu wiring (attached to `label`).

### Done When

- [ ] Every parent shows the same badge at every depth; behavior unchanged.

### Regression Risk

Cosmetic. `renderCategory()`'s label HTML changes; drag handlers and the context menu are attached to the label element, not the badge, so they're unaffected.

### Verification

- Headless screenshot after the fix: both parent kinds, top level and nested, show the same badge; collapse, the context menu and drag-and-drop still work on both.
- **Manual (user):** turn a voice channel into a parent on the real server.

---

## PRD 18.16 — Chore: Center the App Description in Settings → About

**Type:** 🧹 CHORE
**Priority:** Low
**Affected Components:** `index.html` (About panel markup/CSS).

### Current Behavior

In the About panel (`index.html:~5497`), the logo, name and version sit in a `text-align: center` block, but the description paragraph right below ("Self-hosted voice and text communication.", `~5503`) has only inline font/color/margin styles, so it is left-aligned, the only off-center element in that part of the tab.

### Design

- Center the description (`text-align: center`). While here, move the panel's inline styles for the header block and the description into small named classes (`.about-header`, `.about-tagline`), consistent with how the rest of `index.html` styles the settings panels.
- Check the rest of the panel in the same screenshot: the "Check for Updates" button is full width (already symmetric), and the update-status line under it (`#about-update-status`) is left-aligned text. Center it too if it looks off-center under the full-width button; leave it if it doesn't. Record the choice.
- The Identity block (PRD 17.12) and the Export/Import identity controls that PRD 18.6 adds to this tab are left-aligned *rows with labels and values*. They stay left-aligned, since that's the right layout for label/value rows.

### Implementation Steps (do them in this order)

1. Take a "before" screenshot of Settings → About (headless).
2. In `index.html` (~5497–5507): replace the header `div`'s inline style with `class="about-header"` and the `<p>`'s with `class="about-tagline"`; add CSS next to the other settings-panel styles:
   ```css
   .about-header { text-align: center; padding: 10px 0 18px; }
   .about-tagline { font-size: 12px; color: var(--text-secondary); margin-bottom: 16px; text-align: center; }
   ```
   (the values are the current inline ones, plus centering — the look must otherwise be identical; keep the `img`/`div` children's inline styles as they are, or move them into `.about-header img` / `.about-name` / `#about-version` rules with the same values).
3. "After" screenshot; decide on `#about-update-status` (center it with `text-align: center` only if it looks off-center under the full-width button, e.g. after clicking "Check for Updates" in dev, which shows a status text); record the decision.
4. `/log-progress`, commit, stop.

### Done When

- [ ] Description centered; nothing else in the panel moved (compare screenshots).

### Regression Risk

None beyond this panel.

### Verification

- Headless screenshot of the About tab (before/after).
- **Manual (user):** look at the tab.

---

## PRD 18.17 — Fix: Users Without Any Role Vanish From User Management

**Type:** 🐛 FIX
**Priority:** Medium
**Affected Components:** `schema.prisma` + migration (start using the existing `user_servers` table, with a backfill), `connection.handler.ts` (record membership on join), `admin.handler.ts` (`GET_ALL_USERS`), the approval path from PRD 18.8 (record membership on approval), `renderer.ts` (`renderAdminUsers()`: a "No roles" tag).

### Current Behavior

- `GET_ALL_USERS` (`admin.handler.ts:~106`) lists only users who hold **at least one role on this server** (`roles: { some: { role: { serverId } } }`). Remove a user's last role (typically "Member", when they aren't "Server Admin") and they disappear from User Management. While they're offline, nobody can give them a role back or ban them.
- **Related finding (pre-existing):** every join upserts the `role-default` (Member) role again (`connection.handler.ts:~468`), and the `CONNECT` permission is never checked anywhere in the server. So removing Member does **not** keep a user out: they vanish from the list while offline and get Member back automatically on their next join. This item fixes the **listing**; PRD 18.18 makes removing Member actually restrict the user (user decision).

### Goal

Every user who has ever joined this server is listed in User Management, with or without roles, so an admin can always give them a role again (or ban them).

### Design

- **Membership:** `UserServer` (`user_servers`) already exists in the schema but is never written. Upsert `(userId, serverId)` on every successful join (next to the role upsert) and when an approval creates a user (18.8). `joinedAt` keeps the first join.
- **Backfill migration:** insert a membership for every user who has a role on the server, a message in one of its channels, a channel read cursor, a ban on it, or a reaction on its messages (`INSERT … SELECT DISTINCT … ON CONFLICT DO NOTHING`). This recovers users who already lost every role before this fix. Generated with `prisma migrate diff`, backfill appended by hand, and verified on a throwaway database as `apps/server/AGENTS.md` describes.
- **`GET_ALL_USERS`:** list users with a membership on the server **or** a role on it (the role clause covers anything the backfill could miss). Each user's `roles` stays filtered to this server, so a role-less user returns `roles: []`. The ordering is unchanged.
- **Client:** `renderAdminUsers()` already builds role toggles from `allServerRoles` and handles an empty `roles` array. Add a muted "No roles" tag on such rows so the state is visible, and keep them in the same alphabetical list (no separate section). After a role change, the refreshed list keeps the row in place instead of dropping it.
- A **DM partner who never joined the server** isn't involved: DMs require a joined user.

### Implementation Steps (do them in this order)

1. **Read first:** `GET_ALL_USERS` (`admin.handler.ts` ~90–150), the role upsert in the join path, `renderAdminUsers()`.
2. **Membership write:** in the join path, right after the role upserts: `await app.prisma.userServer.upsert({ where: { userId_serverId: { userId: instanceId, serverId } }, update: {}, create: { userId: instanceId, serverId } })`. In 18.8's approve transaction: `tx.userServer.create(...)`.
3. **Backfill migration** (no schema change → create an empty migration folder `prisma/migrations/<ts>_backfill_user_servers/migration.sql` by hand) with idempotent SQL. Check real table/column names first in the existing migrations (`grep -n "CREATE TABLE" prisma/migrations/*/migration.sql`), then:
   ```sql
   INSERT INTO "user_servers" ("userId", "serverId", "joinedAt")
   SELECT DISTINCT ur."userId", r."serverId", now()
   FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
   ON CONFLICT DO NOTHING;
   -- same pattern for: messages (via channels.serverId), channel_reads (via channels), banned_users (serverId direct),
   -- reactions on channel messages (via messages → channels)
   ```
   Use the earliest known timestamp as `joinedAt` where available (`MIN(createdAt)` per user/server) — nice to have, not required.
4. **`GET_ALL_USERS`:** `where: { OR: [ { servers: { some: { serverId } } }, { roles: { some: { role: { serverId } } } } ] }` (the relation field on `User` is named `servers` in the schema — verify). Everything else unchanged. Extract the row mapping into a pure `mapAdminUser(u, bannedIds)` and unit-test it with `roles: []`.
5. **Client:** in `renderAdminUsers()`, when `userRoleIds.size === 0` add `<span class="admin-tag admin-tag-muted">No roles</span>` next to the nickname (create the CSS using existing muted tag styles — check for an existing tag class first, e.g. the 🔒 identity marker's styling).
6. Verification, `/log-progress`, commit, stop.

### Pitfalls

- `prisma migrate deploy` runs the backfill in production on upgrade: it must be idempotent and fast (DISTINCT + ON CONFLICT; no per-row loops).
- Don't change who can call `GET_ALL_USERS`.

### Done When

- [ ] Role-less users (including ones who lost their roles before this fix) are listed with the tag and can be given roles/banned.

### Regression Risk

The list query and one extra upsert per join. Permission gating of `GET_ALL_USERS` is unchanged. Banned users who never had a role still appear (they did before only if they held a role). That's intended: they now show up with their ban status.

### Verification

- Migration on a throwaway database: users with roles, a user with messages but no roles, a banned user without roles → all get memberships; running it twice changes nothing.
- Unit test for the user-list mapping with an empty role list (pure part extracted).
- Live: remove a user's Member role while they're offline → they stay listed with "No roles"; give Member back → the badge disappears; ban/unban works on the row.
- Headless UI: the row, the tag, the toggles.

---

## PRD 18.18 — Feat: Removing the "Member" Role Actually Restricts the User

**Type:** ✨ FEATURE (moderation) — user decision taken after reviewing 18.17
**Priority:** Medium
**Affected Components:** `connection.handler.ts` (stop re-granting Member on every join; per-socket access state; room membership), new `access.service.ts`, `permissions.middleware.ts` (a cheap access guard), the handlers that serve channel/DM content and voice (`message.handler.ts`, `dm.handler.ts`, `reaction.handler.ts`, `voice.handler.ts`, `upload.handler.ts`, `nudge.handler.ts`, `profile.handler.ts` where relevant), `admin.handler.ts` (`ASSIGN_ROLE` applies the change live), every server emit that carries message content, shared-types, `preload.ts`, `renderer.ts`/`index.html` (an access banner, disabled actions).

### Current Behavior

- There are two fixed roles: **Member** (`role-default`, `CONNECT | SPEAK | SEND_MESSAGES`) and **Server Admin** (`role-admin`, all bits; `ADMIN` bypasses every check). There's no UI to create roles or edit their permissions.
- Only `SEND_MESSAGES` is enforced (sending a channel message, `message.handler.ts:~171`). `CONNECT` and `SPEAK` are never checked.
- Every join re-adds Member (`connection.handler.ts:~468`), so removing it lasts only until the user's next connect.
- Channel message events (new, edited, deleted, reactions, pins) are broadcast to the whole `server:<id>` room, i.e. to everyone connected.

### Goal (user decision)

A user **without the Member role** (and not a Server Admin) is **not banned**: they can still connect. But they **cannot open or interact with text channels, cannot send DMs, and cannot join voice channels**. In other words, they can't really use the server until a moderator gives the role back. Giving it back restores everything immediately, with no reconnect needed.

### Design

**The rule:** "has access" = the user's aggregated permissions include **`CONNECT`** (or `ADMIN`). `CONNECT` is the existing flag meaning "may use this server"; Member grants it, Server Admin bypasses. Defined once in `access.service.ts` (`hasServerAccess(perms)`), unit-tested.

**Stop re-granting Member:** the join path adds `role-default` **only when the user row is created** (first join; for 18.8, at approval). Existing users already hold Member (the old upsert guaranteed it), so nobody loses access when this ships. `role-admin` for `ADMIN_INSTANCE_ID` keeps its current per-join grant (`decision.grantAdmin`).

**Per-socket access state:** computed at join (`socket.data.hasAccess`) and recomputed for every socket of a user when their roles change (`ASSIGN_ROLE`, plus any future role edit), so handlers don't hit the database on every call for this check. Admin-only actions keep using `requirePermission()` (DB-backed), unchanged.

**What a user without access can still do:** stay connected; see the channel tree, who is online and who is in which voice channel; open the Settings modal (their own local settings, About); see profile cards; receive server settings. That's what lets them see they're restricted and wait for a moderator.

**What is refused (server-side, `"You don't have access to this server's channels"`):**
- Text channels: `FETCH_MESSAGES` (opening a channel), `SEND_MESSAGE` (still also requires `SEND_MESSAGES`, as today), `EDIT_MESSAGE`, `DELETE_MESSAGE` (their own old messages), `TOGGLE_REACTION`, `PIN_MESSAGE`/`UNPIN_MESSAGE`, `MARK_CHANNEL_READ`.
- DMs: `SEND_DIRECT_MESSAGE` (also requires `SEND_MESSAGES`), `FETCH_DIRECT_MESSAGES`, `MARK_DMS_READ`, `GET_UNREAD_DM_PARTNERS`, DM reactions/deletes. **Sending a DM *to* a user without access** is refused too ("This user can't receive messages right now"). Otherwise their DMs would pile up unread and unreachable.
- Voice: `USER_JOIN_CHANNEL` for voice channels and every step of the voice handshake (`CREATE_WEBRTC_TRANSPORT`, `PRODUCE`, …), screen sharing, `WATCH_SCREEN_SHARE` / `REQUEST_VIEWER_TICKET`.
- Uploads (`REQUEST_UPLOAD_TOKEN`), custom emoji submissions, `NUDGE_USER`.
- The exact list is produced during implementation by auditing **every** `socket.on(...)` handler and classifying it as "allowed without access" or "refused". The table goes into the progress entry. Any handler that doesn't fit either bucket is raised with the user.

**No more content leaking through broadcasts:** a user who can't fetch history must not receive live messages either. Members join a second room, `members:<serverId>`, at join, and leave or rejoin it when their access changes. Every emit that carries message content (`MESSAGE_RECEIVED`, `MESSAGE_EDITED`, `MESSAGE_DELETED`, `REACTION_UPDATED`, `CHANNEL_PIN_UPDATED`, and any other content event found in the same audit) moves from `server:<id>` to `members:<id>`. Structural events (tree, presence, avatars, settings, emoji list) stay on `server:<id>`.

**Live effect when Member is removed** (`ASSIGN_ROLE` remove → recompute → access lost):
- The user is taken out of voice the same way a kick from a channel does it (mediasoup session closed, presence updated, everyone sees them leave), but without the "kicked" message or sound. Any Viewer window they have is closed (tickets revoked, viewer sockets disconnected).
- Their sockets leave `members:<id>` and get `ACCESS_CHANGED { hasAccess: false }`.
- **Client:** a persistent banner above the tabs: "You don't have access to this server's channels and voice right now. A moderator can give it back in User Management." Open channel and DM tabs close (`closeTab(…, { reason: "access" })`, which keeps kept tabs remembered). Clicking a text or voice channel shows the banner's message in a toast instead of opening or joining. The DM, Nudge and upload buttons are disabled with that tooltip. The profile card's "Message" button is disabled.
- **When Member is given back:** `ACCESS_CHANGED { hasAccess: true }` → the server re-adds them to `members:<id>`; the client removes the banner, re-enables the actions and restores kept tabs (the 17.5 restore path). Voice isn't rejoined automatically.
- The join ack also carries `hasAccess`, so a restricted user who connects sees the banner straight away.

**Safety rules:**
- A Server Admin never loses access (ADMIN bypass). The existing "can't remove your own Server Admin role" guard stays.
- Moderators (BAN_USER) without Member? Not possible with the fixed roles. If custom roles ever arrive, the rule (`CONNECT` or `ADMIN`) still holds.
- User Management (18.17) shows a "No access" tag on users without access, which is clearer than "No roles" alone, so moderators understand the effect.

**Wire (shared-types, additive):** `USER_JOIN_SERVER` ack `hasAccess?: boolean`; server→client `ACCESS_CHANGED { hasAccess: boolean }`. A v2.6.0 client never gets them and simply sees its requests refused with the error text.

### Edge Cases

- A restricted user still owns their old messages in the DB. Others keep seeing them, and the restricted user can't edit or delete them until access returns.
- Pending approval (18.8) and access are separate: a pending user isn't joined at all; an approved user gets Member at approval.
- Reconnect while restricted: the join succeeds and returns `hasAccess: false`. Kept tabs aren't restored.
- The DM partner list and Online Users modal still list restricted users (presence is structural). Their DM button is disabled for others, with "This user can't receive messages right now".

### Implementation Steps (do them in this order)

1. **Read first:** all handler files (you will touch most of them), `permissions.middleware.ts`, `permissions.service.ts`, `moderation.handler.ts` `KICK_USER` (the voice teardown you will extract), `viewer-ticket.service.ts` (`revokeViewerTickets`), the client's channel click handler (`renderer.ts` ~2570–2660), DM buttons (Online Users modal, profile card), upload/nudge buttons.
2. **Classification table first** (in the progress entry, and as code): `apps/server/src/services/access.service.ts`:
   ```ts
   import { PermissionFlags } from "@reson8/shared-types";
   export function hasServerAccess(perms: bigint): boolean {
       return (perms & BigInt(PermissionFlags.ADMIN)) !== 0n || (perms & BigInt(PermissionFlags.CONNECT)) !== 0n;
   }
   /** Every client→server event, classified. A test fails if an event is missing. */
   export const EVENT_ACCESS: Record<keyof ClientToServerEvents, "open" | "member"> = { … };
   ```
   "open" (allowed without access): `USER_JOIN_SERVER`, `REQUEST_AUTH_CHALLENGE`, `USER_LEAVE_SERVER`, `PING_LATENCY`, `GET_ONLINE_USERS`, `GET_USER_PROFILE`, `SET_AVATAR`, `GET_SERVER_SETTINGS`, `GET_APPROVED_EMOJIS` (rendering others' names in the tree doesn't need it, but harmless), `USER_LEAVE_CHANNEL`, `SET_VOICE_STATE`, plus the moderator/admin events that already have their own permission checks (`GET_ALL_USERS`, `ASSIGN_ROLE`, `BAN_USER`, … — "open" here just means "no extra access check"; their own `requirePermission` stays), `VIEWER_AUTHENTICATE` (viewer path; its ticket can only be issued to members, see below), 18.8/18.9 events. "member": everything in the Design section's refused list. Decide every remaining event explicitly; if unsure, ask.
   Test: `Object.keys(EVENT_ACCESS)` equals the `ClientToServerEvents` keys (keep a hand-written list in the test that you update when adding events — TypeScript's `Record<keyof …>` already forces completeness at compile time, which is the real guarantee).
3. **Socket state:** `SocketData.hasAccess?: boolean`. At join (after roles are settled): `socket.data.hasAccess = hasServerAccess(await getUserPermissions(prisma, userId, serverId))`; join `members:${serverId}` when true. Add `hasAccess` to the join ack.
4. **Guard helper** (`permissions.middleware.ts`): `export function requireAccess(socket, ack?)`: returns `true` if `socket.data.hasAccess`, else calls `ack?.({ success: false, error: NO_ACCESS_MESSAGE })` and returns `false`. Add `if (!requireAccess(socket, ack)) return;` at the top of every "member" handler (after the existing "not joined" guard). For voice, put it in `USER_JOIN_CHANNEL` (when the channel is VOICE) **and** in `GET_ROUTER_CAPABILITIES`, `CREATE_WEBRTC_TRANSPORT`, `PRODUCE` (defense in depth). For `SEND_DIRECT_MESSAGE`, also check the **recipient**: look up their live sockets' `hasAccess`, or (offline) compute `hasServerAccess(getUserPermissions(recipient))` → refuse "This user can't receive messages right now".
5. **Stop re-granting Member:** in the join path, change the `rolesToAssign` loop so `role-default` is only created when the user row was just created (`!existingUser`); keep `role-admin`'s upsert when `decision.grantAdmin`. Note in a comment why (18.18).
6. **Re-target content broadcasts:** change `io.to(\`server:${…}\`)` → `io.to(\`members:${…}\`)` for `MESSAGE_RECEIVED` (`message.handler.ts:~251`), `MESSAGE_DELETED` (~450), `CHANNEL_PIN_UPDATED` (message.handler ~456, channel.handler ~503, ~542), `MESSAGE_EDITED` (~544), `REACTION_UPDATED` (`reaction.handler.ts:~90`). Re-grep afterwards: `grep -rn 'server:\${' apps/server/src/handlers` and classify each remaining emit as structural (keep) or content (move). `CHANNEL_TREE_UPDATE` carries `hasUnread` per channel computed per user? — check; if it's per-socket it's fine, if broadcast, it carries no content.
7. **Extract voice teardown:** move the body of `KICK_USER` that removes a user from voice into `export async function removeFromVoice(io, app, mediasoup, { userId, serverId, reason: "kick" | "access" })` (same file or `voice-session.service.ts`); `KICK_USER` calls it with `"kick"` (emits `USER_KICKED`/`CHANNEL_USER_KICKED` exactly as now); `"access"` skips those two emits but does everything else (producers closed, presence updated, `PRESENCE_UPDATE` broadcast).
8. **Live access change** — `applyAccessChange(io, app, mediasoup, userId, serverId)` called after `ASSIGN_ROLE` succeeds (both add and remove): recompute; for every live primary socket of the user (`io.in(\`server:${serverId}\`).fetchSockets()` filtered by `data.userId`, or the existing user→socket lookup): if `hasAccess` changed → update `socket.data.hasAccess`, `socket.join`/`socket.leave(\`members:${serverId}\`)`, emit `ACCESS_CHANGED { hasAccess }`; on loss also `removeFromVoice(..., "access")`, `revokeViewerTickets(app.redis, userId)` and disconnect the user's viewer sockets. Also re-evaluate `moderators:` room membership (18.8).
9. **`REQUEST_VIEWER_TICKET`** requires access ("member"), so a restricted user can't open a Viewer.
10. **shared-types:** `SocketData.hasAccess?`, ack `hasAccess?`, `ACCESS_CHANGED`. Build.
11. **preload:** forward `ACCESS_CHANGED` as `access-changed`; include `hasAccess` in the `connected` event payload.
12. **Renderer:**
    - `let hasServerAccess = true;` set from `connected` (`payload.hasAccess !== false` — an older server doesn't send it, treat as true) and `access-changed`.
    - `applyAccessState()`: toggle `body.no-access`; show/hide `#access-banner` (above the tab bar; text from the Design section; `role="status"`); on loss: close every channel and DM tab with `closeTab(id, { reason: "access" })` — add `"access"` to the reason union with the same bookkeeping as `"disconnect"` (keeps kept tabs remembered) — and leave voice locally if the server didn't already (`api.leaveVoice` path used by the Leave button, without its sound).
    - On regain: remove banner/class; restore kept tabs through the same function the connect path uses (17.5's restore); no auto voice join.
    - Guards: in the channel click handler, the DM-open paths (`openDmTab` callers in Online Users modal and profile card), upload/attachment buttons, emoji submission, nudge → if `!hasServerAccess` show a toast with the banner text and return. CSS `body.no-access` greys out the composer/attachment/DM/nudge buttons (`opacity`, `pointer-events: none`) as a visual hint; the guards are the real check.
    - Others' view: the DM button for a restricted user — the server refuses with the message; show it as a toast (no extra client state needed).
    - User Management: "No access" tag when the user's roles (from `GET_ALL_USERS`) give no CONNECT and no ADMIN — compute client-side from `allServerRoles` permissions (string bigints → `BigInt()`).
13. **Tests:** `access.service.test.ts` (`hasServerAccess` table: 0n, CONNECT, ADMIN, SPEAK only); the join role rule (pure helper `rolesToGrant({ isNewUser, grantAdmin })`); `EVENT_ACCESS` completeness.
14. **End-to-end script** (scratchpad, socket.io-client in Node, three identities, real server on scratch DB/Redis db 7 — server `AGENTS.md` recipe): the matrix in Verification, with an ack timeout on every emit.
15. Verification, `/log-progress` (include the full event classification table), commit, stop.

### Pitfalls

- Moving an emit to `members:` without having joined members to that room = everyone stops receiving messages. Join the room in the **same** place `server:` is joined, before any other code can emit.
- Viewer sockets never join `server:`/`members:` (keep it so).
- Don't use the cached `hasAccess` for admin/moderation checks — those keep `requirePermission()`.
- `ASSIGN_ROLE` on an offline user: just DB; the next join computes access.

### Done When

- [ ] The three-user matrix passes; no member misses any content event; restricted users receive none and can't call member events; Member removal sticks across reconnects; restoration is live.

### Regression Risk

**High-touch:** it adds a guard to most handlers and re-targets the content broadcasts. The biggest risk is a member missing live messages because an emit was moved to the wrong room, or a handler refusing a member. Mitigation: the handler/emit audit table, plus an end-to-end test with three users (an admin, a member, a user without access) that sends one of each content event and checks exactly who receives it.

### Verification

- Unit tests: `hasServerAccess()`; the join role rule (Member only on create); the handler classification (a test that fails if a new `socket.on` handler isn't classified, e.g. by checking a declared allow/deny table against the registered event names).
- Live, three users on a scratch server: remove Member from C while C is in voice and has a channel and a DM open → C leaves voice, tabs close, banner shows. C's direct emits are refused (fetch, send, DM, react, voice join, upload token, nudge). C receives no message events while A and B keep chatting, editing and reacting. B can't DM C. C reconnects → still restricted (Member not re-added). Give Member back → C gets the live state back without reconnecting and receives the next message. A (Server Admin) without Member keeps full access.
- Headless UI: banner, disabled actions, toasts, tag in User Management.
- **Manual (user):** the flow on the real server.

---

## PRD 18.19 — Fix: Link-Preview Videos Can't Go Fullscreen or Seek; Preview Images Open in the Image Viewer

**Type:** 🐛 FIX
**Priority:** High
**Affected Components:** `main.ts` (permission handler, a media-proxy protocol), a new pure `apps/client/src/media-proxy.ts` (range/header normalization), `renderer.ts` (`createPreviewCard()`), `index.html` (CSP `media-src`).

### Reported Problem

1. A video in a link preview can't be switched to fullscreen.
2. Sometimes, mostly with YouTube videos, the progress bar doesn't work: you can't jump forward or back.
3. Requested with it: an **image** in a link preview should open in the same limited image viewer used for previewing image attachments (`openLightbox(url, { previewOnly: true })`, zoom only).

### Root Causes (confirmed by reading the code and live, 10/10/2026)

**Fullscreen:** `main.ts:~500` registers `session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(["media", "audioCapture", "microphone"].includes(permission)))`. In Electron, an HTML element going fullscreen (the video controls' fullscreen button, i.e. `requestFullscreen()`) is a **permission request named `"fullscreen"`**. It isn't in the list, so it is always refused. (This may also be why the Viewer window's comment at `main.ts:~1160` found that the Fullscreen API "never settles" there. That's left as it is, since the Viewer's own native-fullscreen workaround works.)

**Seeking (YouTube):** PRD 17.9's YouTube fixer (koutube) returns an `og:video` on an Invidious server (`https://iv.igerman.cc/latest_version?id=…&itag=18`). It redirects twice and serves the MP4. To the first request a `<video>` makes (`Range: bytes=0-`), that server answers **`200`** with a `Content-Range` header but **no `Accept-Ranges` and no `Content-Length`**. A later range request (`bytes=1000000-1000099`) gets a correct `206`. Chromium decides whether a video can seek from the first response: a `200` to a range request means "this server doesn't support ranges", so the progress bar can't seek. X/Twitter videos (`video.twimg.com`) answer that first request with `206` + `Accept-Ranges: bytes`, which is why they seek fine. Any other host that does the same as Invidious has the same problem.

**Images:** the static-image branch of `createPreviewCard()` has no click handler of its own. A click falls through to the card's handler, which opens the link in the browser.

### Design

**Fullscreen:**
- Allow `"fullscreen"` in the permission handler, **only for the app's own windows** (the main window's and the Viewer's `webContents`, compared by id; never the hidden link-preview window from 18.10, whose separate session denies everything anyway). The existing microphone grants are unchanged.
- **Step 0:** check on Linux (X11 and Wayland/XWayland, as the Viewer comment warns) and Windows that the video controls' fullscreen button now works. Handle `enter-html-full-screen`/`leave-html-full-screen` only if the window needs help (e.g. to hide the minimize-to-tray behavior while fullscreen).
- **Fallback, only if Step 0 shows HTML fullscreen still fails on some platform:** hide the native button (`controlsList="nofullscreen"`) and add a small "Fullscreen" button on the card that plays the video in the existing video lightbox (`videoLightboxModal`, `renderer.ts:~3950`) at full window size, with the same position and playing state.

**Seeking — a narrow media proxy in the main process:**
- Register a privileged custom scheme `reson8-media:` (`protocol.registerSchemesAsPrivileged([{ scheme: "reson8-media", privileges: { stream: true, supportFetchAPI: true, standard: true, secure: true } }])` before `ready`; `protocol.handle("reson8-media", …)` after).
- The main process only proxies video URLs **it returned itself** in a link preview. When a preview has a video, main stores `id → upstream URL` (random 128-bit id, LRU 200 entries, same TTL as the preview cache) and gives the renderer `reson8-media://v/<id>` instead of the upstream URL. The renderer can't make it fetch anything else, and an unknown id gets a `404`.
- The handler forwards the request's `Range` header upstream (through 18.10's guarded fetch: same private-network block, manual redirects). It normalizes the answer in a pure, unit-tested function (`normalizeRangeResponse()`):
  - upstream `206` → pass through;
  - upstream `200` **with** a `Content-Range` for the requested range → answer `206` with that range, `Content-Length` taken from it, `Accept-Ranges: bytes`;
  - upstream `200` **without** range information → pass through as `200` (that host really can't seek; nothing to fix);
  - other statuses pass through; the body is always streamed, never buffered.
- **Use the proxy only when it's needed:** a fast check when the preview is built (`HEAD`, or a `Range: bytes=0-0` GET) tells whether the host answers ranges correctly. Correct hosts (e.g. `video.twimg.com`) keep the direct URL, so most videos don't go through the main process at all. Each host's result is cached.
- CSP: add `reson8-media:` to `media-src` in `index.html`.
- **Step 0:** first confirm, in the real app, that a koutube video can't seek with the direct URL and can through the proxy (headless: set `currentTime` and check `seekable.length > 0` / `seeked` fires). If Chromium turns out to recover by itself in some case, record it.

**Preview images open in the limited image viewer:**
- The static-image branch of `createPreviewCard()` and 18.10's direct-image card call `openLightbox(data.image, { previewOnly: true })` on click, with `stopPropagation` so the card doesn't also open the link. The card's text area (title, description, domain) still opens the link in the browser, as today.
- The embed-video thumbnail with the play overlay (a YouTube embed with no direct video) still opens the link in the browser: it represents a video, not an image.
- With 18.11: on a blurred card, the first click reveals it (18.11's rule), and the next click opens the viewer.
- 18.10's direct-image card is changed to use the limited viewer too (consistency; its text said `openLightbox(url, meta)` before this item).

### Implementation Steps (do them in this order)

1. **Read first:** `main.ts` permission handler (~500), protocol/session setup order (what runs before `app.whenReady()`), `createPreviewCard()`, `openLightbox()` signature, `index.html` CSP line, the video lightbox (`videoLightboxModal`).
2. **Step 0:** headless — a message with a YouTube link (koutube) and one with an X video link. Evaluate in the renderer: for each `.lpc-video`, `v.seekable.length`, `v.seekable.end(0)`, `v.duration`; try `v.currentTime = v.duration / 2` and wait for `seeked` (2 s timeout); try `await v.requestFullscreen().then(() => "ok", e => e.name + ": " + e.message)`. Record results before changing anything (expected: YouTube not seekable; fullscreen rejected with a permission error for both).
3. **Fullscreen:** in the permission request handler: `if (permission === "fullscreen") return callback(isAppWebContents(webContents));` where `isAppWebContents(wc)` = `wc.id === mainWindow?.webContents.id || viewerWindowIds.has(wc.id)` (track Viewer window ids where they're created — the same map that holds `viewerTickets` can serve). Also add a `setPermissionCheckHandler` only if Step 0 shows Chromium checks `fullscreen` there too (don't add one otherwise — a check handler changes defaults for every permission). Re-run Step 0's fullscreen test on X11 and Wayland/XWayland (headless covers X only — ask the user to check Wayland and Windows).
4. **Media proxy — pure part** `media-proxy.ts`:
   ```ts
   export interface UpstreamHead { status: number; headers: Record<string, string> } // lower-case keys
   /** Decides the status/headers to give Chromium for a ranged request. */
   export function normalizeRangeResponse(requestRange: string | null, up: UpstreamHead): { status: number; headers: Record<string, string> };
   export function parseContentRange(v: string | undefined): { start: number; end: number; total: number | null } | null;
   ```
   Rules: `up.status === 206` → pass through (ensure `accept-ranges: bytes`). `up.status === 200 && requestRange && parseContentRange(up.headers["content-range"])` → `206` with `content-range` as given, `content-length = end - start + 1`, `accept-ranges: bytes`. `200` without range info → pass through. Copy only safe headers: `content-type`, `content-length`, `content-range`, `accept-ranges`, `cache-control`, `last-modified`, `etag`; drop `set-cookie` and everything else.
5. **Registration:** before `app.whenReady()` (top level of `main.ts`, next to other pre-ready calls): `protocol.registerSchemesAsPrivileged([{ scheme: "reson8-media", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }])`. After ready: `protocol.handle("reson8-media", handler)` — on **`session.defaultSession`'s protocol** (the main window uses the default session; `protocol.handle` on the module registers on the default session).
6. **Id store** (main): `TtlLru<string /*upstream url*/>(200)` from 18.10; `registerProxiedVideo(url): string` → `crypto.randomBytes(16).toString("hex")`; TTL = the preview's cache TTL.
7. **Handler:** parse `reson8-media://v/<id>`; unknown id → `new Response(null, { status: 404 })`. Else fetch upstream with 18.10's guarded `uFetch` (same agent, manual redirects with re-validation, **no** overall 8 s deadline — a video stream is long-lived; use a 15 s *connect/headers* timeout instead), forwarding the request's `Range` header (validate it against `/^bytes=\d*-\d*$/`), UA = the plain crawler UA. Build the response with `normalizeRangeResponse()` and stream `upstream.body` straight into `new Response(body, { status, headers })`. Abort upstream when the request's `signal` aborts (`request.signal.addEventListener("abort", …)`).
8. **Deciding when to proxy** (in the preview fetch, only for `video` URLs with `videoType` `video/*`): `probeRangeSupport(url)` — GET with `Range: bytes=0-0` through the guarded fetch, read headers, cancel body: `206` → direct (no proxy); `200` with `content-range` → proxy; anything else → direct (nothing to gain). Cache per **host** for 6 h (TtlLru). If proxying, replace `video` with `reson8-media://v/<id>` before returning the preview to the renderer (the cached preview keeps the upstream URL; the id is minted per IPC answer, so an expired id is re-minted on the next render).
9. **CSP:** `media-src 'self' blob: http: https: reson8-media:` in `index.html` (and the Viewer's HTML only if it shows previews — it doesn't; leave it).
10. **Preview images → limited viewer** (`createPreviewCard()`): static-image branch → `img.addEventListener("click", (e) => { e.stopPropagation(); openLightbox(data.image!, { previewOnly: true }); })`; `img.style.cursor = "zoom-in"`. Same for 18.10's direct-image card. With 18.11's wrap: the overlay's click handler (reveal) already stops propagation; once revealed, the image's own handler opens the viewer. Check `openLightbox`'s signature (`openLightbox(url, meta?)` with `previewOnly` in `meta`) and match it exactly.
11. **Smoke test** `scripts/media-proxy-smoke.mjs` + `"test:media-proxy"`: `normalizeRangeResponse` table, `parseContentRange` (valid, `*/total`, garbage), header allow-list.
12. Verification (Step 0 again + the list), `/log-progress` (include Step 0 before/after values), commit, stop.

### Pitfalls

- `registerSchemesAsPrivileged` **must** run before `ready`, exactly once.
- Never proxy an arbitrary renderer-supplied URL — only ids minted by main.
- Don't buffer the video in memory: pass the `ReadableStream` through.
- `protocol.handle` responses need correct `content-type` or Chromium won't play the file — copy it from upstream.
- Electron's `will-navigate` guard and the hidden preview window are unaffected; make sure the hidden window's session (18.10, `partition: "link-preview"`) does **not** get the fullscreen grant.

### Done When

- [ ] YouTube preview videos seek; X videos still play directly (no proxy); fullscreen works from the video controls in the main window; preview images open the zoom-only viewer and don't open the browser; unknown proxy ids 404.

### Regression Risk

The permission handler is shared with mic access: only one permission name is added, restricted to the app's own `webContents`. The media proxy only touches videos from previews on hosts that need it. Attachments and the Viewer's WebRTC media are unaffected. Card click areas change: the image no longer opens the link (by request).

### Verification

- Unit tests (`npm run test:media-proxy`): `normalizeRangeResponse()` table (206 pass-through, 200+Content-Range → 206, 200 without range info → 200, error statuses); the id store (unknown id → 404, LRU eviction, TTL).
- Headless: koutube video via the proxy → `seekable` covers the whole duration and seeking to 50% plays from there; X video direct → seekable (no proxy); the fullscreen button → `document.fullscreenElement` is the video, then Escape leaves; a proxy request for an unknown id → 404; an upstream redirect into a private address → refused (18.10 rules).
- Headless UI: clicking a preview image opens the zoom-only viewer and doesn't open the browser; clicking the card text still does.
- **Manual (user):** YouTube and X previews on Linux and Windows: fullscreen, seeking, image viewer.

---

## Cross-Cutting Dependencies & Recommended Implementation Order

```
18.1 ESLint                       (first: every later item is linted as written)
18.2 server TLS + TRUST_PROXY ──► 18.3 client TLS (needs a TLS server to test against)
18.2 TRUST_PROXY ──► 18.4 identity log (trustworthy addresses) ──► 18.5 allowed hosts (refusals show up in the log)
18.6 key at rest + backup         (independent; client only)
18.2 TRUST_PROXY ──► 18.7 address bans ──► 18.8 approve new users (reject-and-ban reuses 18.7) ──► 18.9 invites (interacts with 18.8)
18.10 preview hardening ──► 18.11 preview blur (card structure + adult flag from the new fetch path) ──► 18.12 scroll stability (card sizes final)
18.13 DM unread + truncation      (independent; after 18.12 because both touch renderDmMessage)
18.10 preview hardening ──► 18.14 X/Twitter fixer UA (the fixer request goes through the new guarded fetch)
18.15 category badge, 18.16 About centering   (independent, cosmetic)
18.8 approval ──► 18.17 role-less users (approval must also record membership) ──► 18.18 Member removal restricts (builds on 18.17's listing and tag)
18.10 guarded fetch + 18.11 card blur + 18.12 card sizing ──► 18.19 preview video fullscreen/seek + image viewer
```

Recommended order is the numbering: **18.1 → 18.2 → … → 18.19**. 18.14–18.19 were added after the first draft. They're small and independent enough to be pulled forward if you'd rather have the visible fixes first (18.14 then only needs 18.10's fetch rewrite in mind, and 18.17 needs a line added to 18.8's approval transaction when 18.8 lands). Each item ends with `/log-progress`, a local commit, and a stop for the user's go-ahead. Items 18.4, 18.5, 18.7, 18.8 and 18.9 all touch the `USER_JOIN_SERVER` path in `connection.handler.ts`; doing them strictly in order keeps that function readable — if it grows past readability, extract the join checks into a pure `decideJoin()`-style helper (like `decideIdentity()`) as part of 18.8, with tests.

**Shared-types touchpoints (all additive):** `SocketData.clientAddress`; `IIdentityEvent`, `GET_IDENTITY_EVENTS`; server settings `requireSignedIdentity` (+ `…LockedByEnv`, `unprotectedActiveUsers`), `authAllowedHosts` (+ `…LockedByEnv`, `observedAuthHosts`), `requireApproval`, `requireInvite`; `BAN_USER.addressBan`, `GET_BANNED_ADDRESSES`, `UNBAN_ADDRESS`; `USER_JOIN_SERVER` payload `inviteCode`, ack `pending` + `errorCode`; `APPROVAL_GRANTED`, `APPROVAL_REJECTED`, `PENDING_APPROVALS_CHANGED`, `GET_PENDING_APPROVALS`, `APPROVE_USER`, `REJECT_USER`; `CREATE_INVITE`, `GET_INVITES`, `REVOKE_INVITE`; `USER_JOIN_SERVER` ack `hasAccess`, `ACCESS_CHANGED` (18.18).

**Server rooms:** 18.18 adds `members:<serverId>`; content events move there from `server:<serverId>`. 18.8 adds `pending:<userId>` and `moderators:<serverId>`.

**New client scheme:** `reson8-media:` (18.19), added to the CSP `media-src`.

**Migrations (one per item that needs one, each verified on a throwaway DB):** 18.4 (`identity_events`, `servers.requireSignedIdentity`), 18.5 (`servers.authAllowedHosts`), 18.7 (`banned_addresses`, `users.lastAddress`/`lastAddressAt`), 18.8 (`servers.requireApproval`, `pending_approvals`), 18.9 (`servers.requireInvite`, `invites`, `invite_uses`), 18.17 (no schema change: `user_servers` already exists; a data backfill of memberships). All additive with defaults; only 18.17 has a backfill.

**New server env vars (all optional, added to `.env.example`, `docker-compose.yml` passthrough and the README):** `TLS_CERT_FILE`, `TLS_KEY_FILE`, `TRUST_PROXY`. New compose override: `docker-compose.caddy.yml` (+ `RESON8_DOMAIN`). New server scripts: `npm run identity:clear-hosts`.

**New client test scripts:** `test:tls`, `test:identity-backup`, `test:link-preview` (+ adult-detector cases).

---

## Compatibility Summary

(For the release notes.)

- **v2.7.0 client → v2.6.0 server:** works. HTTPS-first falls back to HTTP for a plain server (with the warning); the new admin sections don't appear (their events fail → hidden).
- **v2.6.0 client → v2.7.0 server:** works with default settings. It can't connect if the admin serves **only** HTTPS (native TLS, or Caddy with port 9800 closed), and it can't get in as a **new** user when approval or invites are on (it shows the server's error text). Returning v2.6.0 users are unaffected by approval/invites. Recommendation: update clients first (the auto-updater does), then enable TLS-only / approval / invites / required signatures.
- **Behavior change for moderation:** removing a user's Member role now really restricts them (18.18), and the server no longer re-adds Member on every join. A v2.6.0 client without access gets its requests refused with an error text and no banner.
- **Behavior change for every server behind a proxy:** forwarded-address headers are ignored until `TRUST_PROXY` is set (logs show the proxy's address until then). The Caddy override sets it.

---

## Open Decisions Confirmed With the User

1. **Address without a scheme:** HTTPS first, fall back to HTTP with a warning; never downgrade a server once seen over HTTPS; explicit schemes honored. *(10/10/2026)*
2. **TLS pieces:** all four — Caddy reverse-proxy setup, native TLS in the server, trust-on-first-use for self-signed certificates, lock icon + one-time warning. *(10/10/2026)*
3. **Identity admin tools:** all three — identity log in User Management, a "Require signed identity" switch in Settings → Server, allowed hosts managed in Settings → Server with observed-host suggestions. *(10/10/2026)*
4. **Key storage:** encrypt with `safeStorage` where reliable + passphrase-protected Export/Import identity. *(10/10/2026)*
5. **Ban evasion:** all three — address/range bans, "Approve new users" mode, invite codes. *(10/10/2026)*
6. **Approval and invites each get their own on/off switch** in Settings → Server. *(10/10/2026)*
7. **NSFW previews:** blur preview media in NSFW channels **and** honor sites' adult flags everywhere. *(10/10/2026)*
8. **Each of those two blurs gets its own switch** in Settings → Application. *(10/10/2026)*
9. **Preview extras:** block private/LAN addresses, show direct image links inline, a "Show link previews" switch. *(10/10/2026)*
10. **New item from the user:** stop the chat from moving while previews load (PRD 18.12). *(10/10/2026)*
11. **DM tabs:** keep auto-focusing a newly opened DM tab; the unread dot applies to DM tabs in the background. *(10/10/2026)*
12. **Four items added after the first draft:** the X/Twitter fixer (18.14), the same Category badge for voice parents (18.15), centering the About description (18.16), keeping role-less users in User Management (18.17). *(10/10/2026)*

13. **Removing Member restricts the user** (18.18): no text channels, DMs or voice until it's given back; not a ban. *(10/10/2026)*
14. **Preview videos:** fix fullscreen and seeking; preview images open in the limited (zoom-only) image viewer (18.19). *(10/10/2026)*

Pending your confirmation:

- **18.15:** the code shows the badge on *voice* parents only, the reverse of the report. The item makes every parent show it, which is right either way, and its Step 0 screenshots both kinds first.
- **18.18 defaults:** "access" = the `CONNECT` permission (Member grants it, Server Admin bypasses). Users without access also can't **read** their existing DMs or channel history, and others can't DM them. They also stop receiving live message events (a new `members` room). They still see the channel tree, who's online and profile cards. Voice isn't rejoined automatically when access returns.
- **18.19 defaults:** fullscreen is allowed only for the app's own windows. The media proxy is used only for hosts that answer range requests incorrectly, and only for video URLs that main itself returned. Clicking a preview image opens the zoom-only viewer, and the card's text still opens the link.

Reasonable defaults assumed (say so if you'd rather change any):

- **ESLint:** `typescript-eslint` *recommended* (not type-checked) + `eslint-config-prettier`; `any` and unused vars are warnings; the gate is **0 errors**; no repo-wide reformat.
- **Approval + invites both on:** they apply **independently** (an invite is needed to enter the queue, and is consumed on approval). The alternative would be "a valid invite skips approval".
- **Who handles approvals and invites:** holders of **BAN_USER** (moderators) and ADMIN; the on/off switches are ADMIN-only like all server settings.
- **Approval binds the requested key** at approval time (no TOFU window for approved users); unsigned new clients can't request approval.
- **Address bans:** "range" = /24 (IPv4) or /64 (IPv6); refused for private/proxy addresses unless `TRUST_PROXY` is configured; ADMIN_INSTANCE_ID can always get in; full addresses visible to ADMIN only, masked for other moderators.
- **Identity log retention:** 90 days; refusals de-duplicated per 10 minutes.
- **Invite codes:** 12 Crockford-Base32 characters, stored hashed, shown once; failed attempts throttled per address.
- **Native TLS:** no built-in HTTP→HTTPS redirect (Socket.io clients don't follow redirects; the client's HTTPS-first logic handles it).
- **Trusted certificate changed:** no one-click override; remove the old trust in Settings first (SSH model).
- **Identity backup:** scrypt (N=2^17) + AES-256-GCM, passphrase ≥ 10 chars; import restarts the app; disabled in dev builds.
- **Link previews:** 1 MB head cap, 8 s deadline, direct images ≤ 20 MB (no SVG), caches 6 h / 30 min (fixer video) / 10 min (failures); the server's own LAN host isn't exempt from the private-network block.
- **"Show link previews" off** stops all requests; turning it back on affects messages rendered afterwards.
- **Attachments keep their current NSFW blur behavior** (render-time); only previews follow live channel-flag changes.

---

## Pre-Existing Issues Noticed During the Audit

Fixed in this phase (inside an item's scope):

- **Spoofable client address** — forwarded headers trusted from anyone (fixed in 18.2).
- **`https://` typed in the connect box silently connected over plain HTTP**; IPv6 addresses couldn't be entered; an empty address defaulted to `localhost` (fixed in 18.3).
- **Link-preview body read had no timeout** (the 5 s timer was cleared at headers) and non-HTML links were downloaded twice (fixed in 18.10).
- **The hidden preview window shared the app's session** (cookies/storage) and could start downloads (fixed in 18.10).
- **Previews could yank you to the bottom** seconds after you scrolled up (stale `wasNearBottom`, 18.12, pending Step 0 confirmation).
- **Background DM tabs marked read on load / on arrival** (fixed in 18.13).
- **fxtwitter hides media from the `Discordbot` User-Agent** that PRD 17.9 added for every fixer (fixed in 18.14).
- **Role-less users invisible in User Management;** `user_servers` existed but was never written (fixed in 18.17).
- **Removing a role never revoked anything:** the join re-added Member every time, `CONNECT`/`SPEAK` were never checked, and channel message events went to everyone connected (fixed in 18.18; `SPEAK` stays unenforced, since only the fixed roles exist).
- **The permission handler refused HTML fullscreen** for preview videos, and **range-broken video hosts couldn't seek** (fixed in 18.19).

Not fixed (out of scope, for a future phase):

- **"Remember Me" stores the server password in plain `localStorage`.** Could move to `safeStorage` like the identity key.
- **Attachments have no stored dimensions,** so their space can't be reserved before they load (18.12 compensates with the scroll keeper instead).
- **Attachment NSFW blur is decided at render time** — toggling a channel's NSFW flag doesn't re-blur already-rendered attachments (previews follow live after 18.11).
- **Link previews still reveal the reader's IP to the linked site** when enabled (inherent to client-side previews; 18.10 adds the off switch). A server-side preview proxy would fix it for everyone but makes the server fetch arbitrary URLs — a bigger design question.
- **Bans and approvals are per identity and per address only** — a determined evader with a VPN and a fresh install still gets as far as the approval queue / invite gate (by design).

---

## Mapping to `nextsteps.txt`

| `nextsteps.txt` item | PRD |
|:---|:---|
| 1. No transport encryption by default | 18.2 (server, proxy, `TRUST_PROXY`), 18.3 (client) |
| 2. Trust-on-first-use window for identity keys | 18.4 (identity log, "Require signed identity" switch); also closed for new users by 18.8 (approval binds the key) |
| 3. Challenge relay by a malicious server | 18.5 |
| 4. Local malware can copy the identity key | 18.6 |
| 5. Ban evasion with a fresh install | 18.7 (address bans), 18.8 (approval), 18.9 (invites) |
| 6. Link previews ignore NSFW context | 18.11 |
| 7. Link-preview fetching has no size cap and the cache never expires | 18.10 |
| 8. DM tabs have no unread indicator, and DMs are never truncated | 18.13 |
| 9. `npm run lint` is broken | 18.1 |
| *(not in `nextsteps.txt` — requested by the user during planning)* chat moves while link previews load | 18.12 |
| *(added by the user after the first draft)* X/Twitter fixer shows no video | 18.14 |
| *(added by the user after the first draft)* no "Category" label on voice parents | 18.15 |
| *(added by the user after the first draft)* About-tab description off-center | 18.16 |
| *(added by the user after the first draft)* role-less users vanish from User Management | 18.17 |
| *(added by the user after the first draft)* removing Member should restrict channels, DMs and voice | 18.18 |
| *(added by the user after the first draft)* preview videos: no fullscreen, no seeking; preview images in the image viewer | 18.19 |
