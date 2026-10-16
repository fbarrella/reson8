# Phase 21 — kickoff prompt

Paste everything below the line into a brand-new Claude Code chat opened at the repository root (`reson8/`), on the branch `ui-overhaul-beta`.

---

You are implementing **Phase 21** of Reson8, a self-hosted voice and text chat app: an Electron client (`apps/client`), a Fastify + Socket.io + mediasoup server (`apps/server`) and shared protocol types (`packages/shared-types`). The project rules from `AGENTS.md` (root and per workspace) are already loaded through `CLAUDE.md`. Follow them.

## Your source of truth

`app-planning/Reson8_Phase21_PRD.md` is the approved plan: 15 items (21.1–21.15), owner decisions D1–D10, an executor's handbook (H.1–H.5) and appendices with exact design values. It was written for an implementer who has not seen the planning conversation. Build exactly what it says.

Before writing any code, read:
1. The PRD's **Owner decisions**, the whole **Executor's handbook** (H.1–H.5) and **Order and dependencies**.
2. The full section of the item you are about to build (only that one; read the next item's section when you get to it).
3. The `AGENTS.md` paragraphs the item touches (H.2 rule 1 says which kinds).
4. For context only: the **Phase 20 summary** block near the end of `app-planning/progress.txt`. Don't read the whole file.

## How to work, item by item

1. Build the items **in the PRD's order, one at a time**: 21.1 → 21.2 → … → 21.15. Start with **21.1**.
2. For each item:
   - Read the code the item names before changing it. `renderer.ts` (~17 800 lines) and `index.html` (~11 200 lines) are huge: find things with `grep -n` by function, id or class name, then read only those ranges. Never trust a line number from the PRD.
   - Where the item says "reproduce first", do that before fixing.
   - Implement the steps exactly, keeping the names the PRD gives.
   - Verify as the item's **Verify** section and H.4 describe. The owner does the complex UI testing by hand, so when a check needs real hardware or a second machine, say so plainly instead of claiming it passed.
   - Finish with **H.5** in full: typecheck the touched workspaces, run tests and lint, append the progress entry with the `/log-progress` skill, then stage **only this item's files by path** and commit with the item's commit message.
3. **Never push. Never commit to, merge into or push `main`.**
4. After each commit, send the owner a short report:
   - what changed (files and behaviour);
   - what you verified and how;
   - what you could NOT verify;
   - exactly what they should check by hand.

   Then **stop and wait for the owner's OK** before starting the next item.
5. If the code doesn't match the PRD, or a step seems impossible or risky, follow H.2 rule 12: stop and ask, never improvise a different design. Owner decisions are final (H.2 rule 14).
6. Keep to the item's scope (H.2 rule 13). Report bugs you notice elsewhere; don't fix them in the same commit.

## Environment notes

- The machine is **Arch Linux + KDE Plasma**, so the Linux items (21.5, 21.6) can be checked for real. Native window parts (window buttons, border, corners) only show in an OS capture (`spectacle -b -a -n -o <file>`), not in CDP screenshots.
- To drive the real app: build with `cd apps/client && npx tsc --build && node scripts/copy-html.mjs`, then launch `electron . --remote-debugging-port=<port> --user-data-dir=<tmp dir>` with `ELECTRON_RUN_AS_NODE` unset, and drive it over CDP. Use Socket.io bots against the dev server for "other people". Look at every screenshot you take.
- Dev server: `docker compose -f docker-compose.dev.yml up -d`, then `npm run dev` in `apps/server`.
- Never `pkill -f` a pattern that is also in your own command line. Stop Electron by the PID listening on its debug port.
- Put temporary scripts and files in your scratchpad directory, never in the repo. Clean up test roles, channels and scratch databases afterwards.

## After the last item

21.15 bumps the version to `3.0.0-beta.5` with the `/bump-version` skill, writes `app-planning/releases/v3.0.0-beta.5.md`, and updates `README.md` and the `AGENTS.md` files (never the `CLAUDE.md` stubs). It ends with the same commit-and-report step. The owner pushes the branch.

Begin now: read the PRD sections listed above, then read the code for **21.1 (Kick)**. Reproduce the bug as its step 1 describes, and continue.
