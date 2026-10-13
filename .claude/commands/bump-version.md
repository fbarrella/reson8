---
description: Bump the app version across every file that references it, and generate release notes for the new version
argument-hint: [new-version]
---

Bump Reson8's version number to a new release version, update every file
that references it, and generate a release-notes file — mirroring exactly
what was done for the v1.3.0 release. Prereleases (`X.Y.Z-beta.N`) are
supported since PRD 19 R0; their extra rules are marked **(beta)** below.

Steps:

1. **Determine the new version.**
   - If `$ARGUMENTS` contains a version (e.g. `1.4.0` or `3.0.0-beta.2`),
     use it. Otherwise, ask the user what the new version should be before
     doing anything else.
   - Accepted forms: a plain semver `X.Y.Z`, or a beta prerelease
     `X.Y.Z-beta.N` with N ≥ 1 (no leading `v`). Anything else: stop and ask.
   - Read the root `package.json`'s current `"version"` first, so you can
     flag anything that looks like an accidental downgrade or a skipped
     minor/major before proceeding.
   - **(beta) Branch guard.** Run `git branch --show-current`. On
     `ui-overhaul-beta` (the Phase 19 beta branch):
     - only `3.0.0-beta.N` is accepted, and N must be exactly the current
       beta's N + 1 — or 1 when the current version is `2.7.0`. A skipped or
       repeated N: stop and ask.
     - a plain `X.Y.Z` is refused: "Stable versions are cut on `main` by the
       owner."
     On any other branch, a `-beta.N` version: stop and ask (betas belong on
     the beta branch).

2. **Update the version number in these files:**
   - `package.json` (root) — `"version"` field
   - `apps/client/package.json` — `"version"` field
   - `apps/server/package.json` — `"version"` field (the server reports it to
     clients for the version-mismatch warning)
   - `README.md` — the `![Version](...shields.io/badge/version-...)` badge.
     **(beta)** shields.io static badges use `-` as a field separator, so a
     `-` inside the version must be doubled: `version-3.0.0--beta.1-blue`.
     Check the URL renders (`curl -s <badge-url> | grep -o '3.0.0-beta.1'`).
   - `AGENTS.md` (root) — the "Current version: X" sentence near the top, in the
     `## Project` section. **(beta)** Write it as "Current version:
     3.0.0-beta.N (beta, branch `ui-overhaul-beta`; stable is 2.7.0 on
     `main`)". **Do not** touch other version mentions elsewhere in that file
     (e.g. "Project history" text describing what version a past phase
     shipped at) — those are frozen historical facts, not live pointers, and
     rewriting them would corrupt the history.
   - **Do not** bump `packages/shared-types/package.json` — it's versioned
     independently (currently on its own 0.x scheme) and isn't part of the
     app release version.

3. **Catch-all sweep:** grep the repo (excluding `node_modules`, `dist`,
   `release`, `.git`) for the *old* version string to catch anything not
   listed above — new files sometimes appear between releases. Cross-check
   each hit: package-lock.json will have many unrelated third-party
   dependency versions that happen to coincidentally match — leave those
   alone, only touch entries for `reson8` / `@reson8/client` /
   `@reson8/server`. Files under `app-planning/` referencing an old version
   as history (progress.txt entries, past PRDs, past release notes) are
   also historical record, not live pointers — leave them alone too.

4. **Regenerate `package-lock.json`** by running
   `npm install --package-lock-only` from the repo root — never hand-edit
   the lockfile directly. This only updates the workspace packages' own
   version fields and leaves third-party dependency versions untouched.

5. **Verify nothing broke:** `npx tsc --noEmit` in `apps/client` and in
   `apps/server`; `npm run test:version` in `apps/client`. **(beta)** Also
   confirm the packaging scripts will build on the beta channel:
   `node -e 'import("./apps/client/scripts/update-channel.mjs").then(m=>console.log(m.updateChannelArgs()))'`
   must print `[ '-c.publish.channel=beta' ]`.

6. **Generate `app-planning/releases/v<version>.md`**, following the exact
   format of the existing files in that folder (read the two most recent
   ones first to match style, tone, and emoji usage):
   - `# 🎧 Reson8 v<version> Release Notes` — **(beta)** append ` (Beta)`.
   - A 1–2 sentence intro paragraph summarizing the release's overall theme.
     **(beta)** Under it, this box, verbatim:
     ```
     > [!WARNING]
     > This is a beta. Install it only if you want to test the new interface.
     > Beta builds update to newer betas automatically; stable builds never see
     > them. To go back to stable, install 2.7.x from the Releases page.
     ```
     From beta.2 on, end the intro with one line linking the earlier beta
     notes, e.g. "Earlier in this beta: [beta.1](v3.0.0-beta.1.md)."
   - `## ✨ New Features & Improvements` — bullet list: **Bold Feature
     Name** — one-sentence description, one relevant emoji per bullet
   - `## 🐛 Bug Fixes` — same bullet style (omit this section entirely if
     there were no fixes in this release)
   - `## 📦 Installation` — the standard platform/file table. Use the file
     names electron-builder actually produced (look in
     `apps/client/release/` when a build exists) rather than guessing:
     historically `Reson8-<version>-Setup.exe` (Windows),
     `Reson8-<version>.AppImage` (Linux), `Reson8-<version>-mac.zip` (macOS).
   - Source the actual content from `app-planning/progress.txt`'s entries
     since the previous release (read backwards from the end of the file
     until you reach the previous release's date) and/or the active phase
     PRD in `app-planning/` if one exists. **(beta)** "Previous release"
     means the previous **beta** (for beta.1: the v2.7.0 release) — each
     beta's notes list only what changed since the last beta; the final
     stable notes, written later on `main`, collect everything. **Do not
     invent or embellish features that weren't actually built** — every
     bullet must trace back to a real progress.txt entry.

7. **Report a summary** of every file changed and the path to the new
   release notes file. Do not run `git commit` or `git push` — leave that
   to the user. **(beta)** Also hand the owner the publishing checklist
   below, and say plainly that nothing has been built, pushed or published.

## Publishing a prerelease (beta) — done by the owner; Claude only prepares and checks

Why it matters: a stable 2.7.x app asks GitHub for `/releases/latest`, which
never resolves to a release marked **pre-release**; a beta app scans every
release and reads `beta*.yml`. Betas are built on the `beta` update channel
(`apps/client/scripts/update-channel.mjs` adds `-c.publish.channel=beta` for
any prerelease version — electron-builder does not do this by itself for
GitHub), so they write `beta.yml` / `beta-linux.yml` / `beta-mac.yml` and
**no** `latest*.yml`. That gives two independent guards: the pre-release
flag, and the absence of `latest*.yml` on beta releases.

1. Build with the normal scripts — `npm run release:all`, or
   `npm run build:win|linux|mac` in `apps/client`. All of them go through
   `update-channel.mjs`.
2. In `apps/client/release/`, confirm `beta.yml` (Windows),
   `beta-linux.yml`, `beta-mac.yml` exist for each platform built, and that
   their `version:` is the new beta. If any `latest*.yml` appears, **stop**:
   the build did not use the beta channel; never upload it.
3. Create the GitHub release: tag **`v<version>`** (e.g. `v3.0.0-beta.1`),
   target branch **`ui-overhaul-beta`**, **"Set as a pre-release" checked**,
   **"Set as the latest release" unchecked**; body = the release-notes file.
4. Upload the installers, their `.blockmap` files and the `beta*.yml` files.
5. Check stable users are untouched:
   `gh release view v<version> -R fbarrella/reson8 --json isPrerelease`
   → `true`, and `curl -sI https://github.com/fbarrella/reson8/releases/latest`
   still redirects to the newest **stable** tag.
6. Check betas update: an installed previous beta → Settings › About →
   Check for updates offers the new version.
