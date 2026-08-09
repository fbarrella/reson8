---
description: Append a progress.txt entry for the work just completed, in this project's established format
argument-hint: [feature/fix name]
---

Append a new entry to `app-planning/progress.txt` documenting the work just completed in this session, following the exact format already used throughout that file (~1700 lines of precedent — read a few recent entries first if unsure).

Format:

```
--- Entry: DD/MM/YYYY ---

Feature/Fix: <name>

  Problem: <what was broken or missing, 1-3 sentences>

  Solution: <what was implemented/changed, with enough technical detail that
  a future session can understand the approach without re-reading the diff>

  <Optional subsections as needed, matching existing entries' style —
  e.g. "Server Changes:", "Client Changes:", "Shared Types Changes:",
  "Database Changes:", "Edge Cases Handled:", "localStorage Keys:">

  Key Files Modified:
    path/to/file.ts
    path/to/other/file.ts (NEW) — for newly created files

  Verification:
    <how it was checked — typically `npx tsc --noEmit` per affected
    workspace (shared-types/server/client), and/or `npm run test`>

  Next Step: <what comes after this, or omit if this was standalone>
```

Steps:
1. Determine today's date and what was actually changed this session — check `git status`/`git diff` if needed to be precise about which files were touched.
2. If the user passed a name via $ARGUMENTS, use it as the Feature/Fix name; otherwise infer a concise one from the work done.
3. Read the last ~50 lines of `app-planning/progress.txt` to match current formatting conventions exactly (indentation, section headers used, phrasing style).
4. Append the new entry at the end of the file — do not rewrite or reformat existing content.
5. Do not fabricate verification steps that weren't actually run — only report what was genuinely checked.
