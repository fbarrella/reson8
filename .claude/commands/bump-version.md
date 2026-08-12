---
description: Bump the app version across every file that references it, and generate release notes for the new version
argument-hint: [new-version]
---

Bump Reson8's version number to a new release version, update every file
that references it, and generate a release-notes file — mirroring exactly
what was done for the v1.3.0 release.

Steps:

1. **Determine the new version.**
   - If `$ARGUMENTS` contains a version (e.g. `1.4.0`), use it.
   - Otherwise, ask the user what the new version should be before doing
     anything else.
   - Expect a plain semver `X.Y.Z` (no leading `v`).
   - Read the root `package.json`'s current `"version"` first, so you can
     flag anything that looks like an accidental downgrade or a skipped
     minor/major before proceeding.

2. **Update the version number in these files:**
   - `package.json` (root) — `"version"` field
   - `apps/client/package.json` — `"version"` field
   - `apps/server/package.json` — `"version"` field
   - `README.md` — the `![Version](...shields.io/badge/version-...)` badge
   - `CLAUDE.md` — the "Current version: X" sentence near the top, in the
     `## Project` section. **Do not** touch other version mentions
     elsewhere in that file (e.g. "Project history" text describing what
     version a past phase shipped at) — those are frozen historical facts,
     not live pointers, and rewriting them would corrupt the history.
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
   `apps/server`.

6. **Generate `app-planning/releases/v<version>.md`**, following the exact
   format of the existing files in that folder (read the two most recent
   ones first to match style, tone, and emoji usage):
   - `# 🎧 Reson8 v<version> Release Notes`
   - A 1–2 sentence intro paragraph summarizing the release's overall theme
   - `## ✨ New Features & Improvements` — bullet list: **Bold Feature
     Name** — one-sentence description, one relevant emoji per bullet
   - `## 🐛 Bug Fixes` — same bullet style (omit this section entirely if
     there were no fixes in this release)
   - `## 📦 Installation` — the standard platform/file table:
     `Reson8-<version>-Setup.exe` (Windows), `Reson8-<version>.AppImage`
     (Linux), `Reson8-<version>-mac.zip` (macOS)
   - Source the actual content from `app-planning/progress.txt`'s entries
     since the previous release (read backwards from the end of the file
     until you reach the previous release's date) and/or the active phase
     PRD in `app-planning/` if one exists. **Do not invent or embellish
     features that weren't actually built** — every bullet must trace back
     to a real progress.txt entry.

7. **Report a summary** of every file changed and the path to the new
   release notes file. Do not run `git commit` or `git push` — leave that
   to the user.
