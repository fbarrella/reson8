# Reson8 — Phase 20 PRD (Finishing the Nocturne UI)

**Created:** 14/10/2026 · **Revised:** 14/10/2026 (implementation guide rewrite)
**Author:** Felipe B. Netto (assisted by AI)
**Status:** Ready to execute. Items marked **Needs Dn** wait for the owner's answer to that decision (see [Open Decisions](#open-decisions)).
**Source:** what Phase 19 (the "Nocturne" UI overhaul) deliberately did not build — study frames in `app-planning/design_handoff_reson8_ui_overhaul/screenshots/` that show new behaviour rather than a restyle — plus the verification Phase 19 could not do and two housekeeping items. Phase 19's rationale: `app-planning/archive/Reson8_Phase19_PRD.md` and the Phase 19 block of `progress.txt`.
**Branch:** `ui-overhaul-beta`. **Never commit to, merge into or push `main`.** Commit locally only; never push unless the owner says so.

> **Who this is written for.** An implementer (human or AI) who has NOT seen Phase 19 being built. Every item says which files and functions to touch, what to write, in what order, what must not change, and how to prove it works. Follow it literally. Where this document gives code, it is the reference implementation: keep its names and behaviour; adapt only what a `grep` shows has a different name in the current source (line numbers drift — **always search by the function or id name, never trust a line number**).

---

## Table of Contents

1. [Open Decisions](#open-decisions)
2. [Executor's Handbook](#executors-handbook) — read this first, every item depends on it
3. **P1 — Verify what Phase 19 built** — [V1](#v1--streams-picture-and-sound) · [V2](#v2--the-integrated-title-bar-on-macos-and-linux) · [V3](#v3--connect-flows-that-need-a-real-setup) · [V4](#v4--the-test_states-pass)
4. **P2 — Voice** — [U0 Shared tokens and the menu "above" placement](#u0--shared-groundwork-for-p2p5) · [U1 Voice dock](#u1--voice-dock-restyle) · [U2 Voice room header and call bar](#u2--voice-room-header-and-call-controls) · [U3 Title-bar pill](#u3--title-bar-pill-server--nickname)
5. **P3 — Server settings** — [M1 Members](#m1--members-search-filters-and-rows) · [M2 Bans](#m2--bans-a-list-of-banned-people) · [M3 Emoji](#m3--emoji-approve-all-and-the-library) · [M4 Nav counts](#m4--counts-in-the-server-settings-nav)
6. **P4 — Welcome and chat** — [W1 Saved-server latency](#w1--saved-server-latency-and-offline) · [W2 Typing indicator](#w2--typing-indicator)
7. **P5 — Dialogs** — [S1 Share picker tabs](#s1--share-picker-screens--windows-tabs) · [S2 Linux picker flow](#s2--the-linux-system-picker-flow) · [S3 Icon in Create channel](#s3--channel-icon-in-create-channel)
8. **P6 — Settings** — [G1 Beta updates](#g1--get-beta-updates) · [G2 Play sound alerts](#g2--play-sound-alerts-wording)
9. **P7 — Decision-gated features** — [L1 Live stream previews](#l1--live-previews-on-also-live-cards) · [Q1 Message search](#q1--message-search)
10. **P8 — Housekeeping** — [H1 Minimize-to-tray](#h1--minimize-to-tray-dead-will-minimize-handler) · [H2 TypeScript module resolution](#h2--typescript-moduleresolution-migration)
11. [Order and Releases](#order-and-releases)
12. [Appendix A — Design values](#appendix-a--design-values-copied-from-the-mockup)

---

## Open Decisions

The owner answers these; the implementer never decides them. An item marked **Needs Dn** is skipped until the answer is written into this table (edit the "Answer" column and commit).

| # | Decision | Blocks | Options | Answer |
|---|---|---|---|---|
| D1 | Live previews on the "Also live" cards | L1 | (a) build after the owner measures the cost on real machines (3 and 5 sharers: CPU % and inbound kbit/s, previews on vs. static cards); (b) keep static cards. | b -> keep static cards and update it every 10 minutes |
| D2 | Message search | Q1 | (a) server-side search per channel/DM with Postgres full-text; (b) not now. | a |
| D3 | "Get beta updates" in a stable build | G1 | (a) build it as G1 describes; (b) betas stay install-by-hand only. | a |
| D4 | Typing indicator | W2 | (a) build it, with a "Show others when I'm typing" switch (default on); (a′) build it without the switch; (b) not now. | a |
| D5 | "Last seen" in Members | M1 step 9 | (a) add `users.lastSeenAt` (written when the user's session finally ends); (b) show only "Online" / "Offline". M1 is built either way; only step 9 depends on this. | a |

---

## Executor's Handbook

### H.1 Where things are

| What | Where |
|---|---|
| Renderer (all UI logic, one classic script, no imports) | `apps/client/src/renderer/renderer.ts` (~16 000 lines) |
| Renderer markup **and all CSS** | `apps/client/src/renderer/index.html` (CSS in the `<style>` block at the top; markup below) |
| The renderer's view of the preload API | `interface Reson8Api` in `renderer.ts` (search `interface Reson8Api`). **Every new preload method must be added there too**, or the renderer won't typecheck. |
| Preload (socket, IPC bridge) | `apps/client/src/preload.ts` — the `api` object exposed as `reson8Api` |
| Main process | `apps/client/src/main.ts` |
| Wire protocol (source of truth) | `packages/shared-types/src/socket-events.ts` (`ClientToServerEvents`, `ServerToClientEvents`), DTOs in `packages/shared-types/src/models.ts` |
| Server handlers / services / tests | `apps/server/src/handlers/*.handler.ts`, `apps/server/src/services/*.ts`, `apps/server/src/__tests__/*.test.ts` (vitest, pure logic only) |
| Per-event access class | `EVENT_ACCESS` in `apps/server/src/services/access.service.ts` — TypeScript refuses an unclassified event |
| DB schema / migrations | `apps/server/prisma/schema.prisma`, `apps/server/prisma/migrations/<timestamp>_<name>/migration.sql` |
| The design | `app-planning/design_handoff_reson8_ui_overhaul/screenshots/<frame>.png` (look at it) and `design/Reson8 App.dc.html` (the mockup source; exact values are copied into [Appendix A](#appendix-a--design-values-copied-from-the-mockup)) |

### H.2 Rules that apply to every item (violating any of these fails review)

1. **Shared-types first.** Wire changes go into `packages/shared-types` first, then `npx tsc --build` in `packages/shared-types`, then the server, then `preload.ts`, then `renderer.ts`. Every new field is **optional** (`?`) so a 3.0.0-beta.3 / 2.7.0 peer keeps working. Every new client→server event gets an `EVENT_ACCESS` entry.
2. **No colour literal outside `:root`** (PRD 19 R6). Any colour the design uses that isn't a token yet is added as a token in the single `:root` block of `index.html` (U0 adds the ones P2–P5 need). In the renderer, colours are only ever `var(--…)`.
3. **Icons are Phosphor** (`<i class="ph ph-name" aria-hidden="true"></i>`; filled: `ph-fill`, bold: `ph-bold`). No emoji, no new inline SVG.
4. **User-supplied text uses `textContent`.** `innerHTML` only for fixed markup you wrote. `showToast()` takes HTML — pass user strings through `escapeHtml()`.
5. **One implementation per concern.** Menus: `openMenu(items, x, y, opts)` (search `function openMenu`). Icon cropping: `IconCropper`. Settings pages: a `.settings-tab-btn[data-settings-tab=X]` + `.settings-panel[data-settings-panel=X]`. Stream watching: `api.stage` / `screen-watch.ts`. Update text: `updateState`. Never write a second version of any of these.
6. **`localStorage`**: keys start with `reson8-`; every read/write inside `try/catch` with a safe default.
7. **Don't break ids the code queries.** Before renaming or deleting any element id/class, `grep -n "<id-or-class>" apps/client/src/renderer/renderer.ts` and fix every hit in the same commit.
8. **Declaration order in `renderer.ts` matters.** It is one classic script that runs top to bottom; a function that runs **during startup** and touches a `let`/`const` declared further down crashes the whole UI with `ReferenceError: Cannot access … before initialization`. Every item below says where to put its new state; when in doubt, declare new `let`/`const` state **above the first function that reads it**, and check by launching the app and reading the DevTools console (no red errors).
9. **Server security rules** (from the root and `apps/server` `AGENTS.md`): a user id only ever comes from `socket.data.userId`; never trust a client file URL (files go through the stored-file ledger, deleted with `releaseStoredFile()` after the row); permission checks via `requirePermission()` / `isAdmin()`.

### H.3 Commands

```bash
# after editing packages/shared-types:
cd packages/shared-types && npx tsc --build
# typecheck each workspace you touched:
cd apps/server && npx tsc --noEmit && npm run test
cd apps/client && npx tsc --noEmit
# lint (from the repo root, must exit 0; warnings are fine):
npm run lint
# rebuild the client for a running test instance:
cd apps/client && npx tsc --build && node scripts/copy-html.mjs
# a new migration (generated, never `migrate dev` against the dev DB):
cd apps/server && npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <scratch-db-url> --script > prisma/migrations/<ts>_<name>/migration.sql
npx prisma generate
```
Migration folders are named `YYYYMMDDHHMMSS_snake_name`; use a timestamp later than the newest existing folder (currently `20261018120000_add_server_icon`).

### H.4 Driving the real app (required for every UI item)

Follow `apps/client/AGENTS.md` › "Driving the real app headlessly". On the owner's Windows machine:

- The Bash tool's environment exports `ELECTRON_RUN_AS_NODE=1`; **remove it** for Electron or it starts as Node: launch with `env -u ELECTRON_RUN_AS_NODE` (or delete it from the spawn env).
- Launch: `node_modules/electron/dist/electron.exe . --user-data-dir=<temp dir> --remote-debugging-port=<port>` from `apps/client`. Use a fresh `--user-data-dir` per profile.
- Two dev servers usually run: `127.0.0.1:9800` (no password) and `127.0.0.1:9801` (password protected). **They share one database**, so anything "per server" needs a third server on its own database (see W1/M-items: `DATABASE_URL=<…>/reson8_x PORT=9802 SERVER_PRIVATE_PASSWORD= npx tsx src/index.ts`, after `prisma migrate deploy` and `tsx prisma/seed.ts` on that database). Drop the scratch database afterwards.
- A dev build mints a **new instance id per launch**. To test admin-only UI, grant the current id an admin role with a temporary script in `apps/server` that you **delete before committing**, and remove the role afterwards.
- The renderer's top-level functions and `let`/`const` state are reachable from CDP `Runtime.evaluate` (e.g. `openClientSettings("voice")`, `isInVoice`, `currentTree`). Wrap multi-statement evaluations in an IIFE.
- `api` is a frozen contextBridge object: you cannot stub its methods from CDP.
- Take `Page.captureScreenshot` of every state the item lists and **look at it next to the frame PNG**.

### H.5 Finishing an item (every item, no exceptions)

1. Typecheck every workspace touched, server tests, `npm run lint` (exit 0).
2. Drive it in the real client; screenshots compared with the frame.
3. Append a `progress.txt` entry with `/log-progress` (`.claude/commands/log-progress.md`): `--- Entry: DD/MM/YYYY ---`, Feature/Fix, Problem, Solution, Key Files Modified, Verification, Next Step.
4. One local commit per item: `git add` only the files you changed (never `apps/server/q-*.mjs` or other temp scripts, never `*.tsbuildinfo`), message `feat|fix|refactor: <summary> (PRD 20 <id>)`, ending with the co-author line the session asks for.

---

## P1 — Verify what Phase 19 built

These are owner checks on real hardware; nothing to code. Any failure becomes a new fix item appended to this PRD (`V1-F1`, …) with the same structure as the items below.

### V1 — Streams: picture and sound
**Already verified (14/10/2026, Windows, one machine, 6 instances):** the stage shows the picture; LIVE, volume, Pop out and Fullscreen controls; Pop out → Viewer opens with Always on top on; Return and closing the Viewer bring the stream back; the placeholder is visible; Focus swap, Grid double-click, the 5-share cap.
**Owner checks on two real machines (A shares, B watches):**
1. B hears A's shared app sound on the stage; the stream volume slider goes 0–200 % and is audible at 200 %.
2. B pops out → picture and sound continue in the Viewer within ~2 s; Bring it back → back on the stage. A hears exactly one "viewer left / viewer joined" pair (or none), not a stream of them.
3. Grid with 2+ sharers: every cell plays; sound only from the focused one.
4. Fullscreen on the stage and in the Viewer: Windows, then Linux Wayland.
5. Server log during 2–3: never two consumers of the same producer for B at the same time (`grep -i consum` the server output).

### V2 — The integrated title bar on macOS and Linux
Windows is verified. **Check:** macOS (traffic lights centred vertically in the 38 px bar, the logo not under them, fullscreen and back); Linux X11 and Wayland (controls drawn at the right, drag, double-click maximize; if Wayland misbehaves, Settings › Window › "Use the system title bar" + restart must give the OS frame back); Windows 11 snap layouts when hovering maximize; the Viewer's bar on all three.

### V3 — Connect flows that need a real setup
1. A server with a self-signed certificate (`TLS_CERT_FILE`/`TLS_KEY_FILE`): the trust dialog shows the fingerprint; trusting connects; replacing the certificate shows the "certificate changed" dialog with no one-click override.
2. "Approve new people" on: a new identity sees "Waiting for approval"; approving lets it in without reconnecting by hand.
3. Password server (verified headless; re-check by hand): the Password required dialog, a wrong password ("That password wasn't accepted."), Remember password.

### V4 — The `TEST_STATES.md` pass
Done on 14/10/2026 (`design_handoff_reson8_ui_overhaul/TEST_STATES.md`, every line checked with notes). The owner reviews the notes, re-checks anything marked by hand, then `/bump-version 3.0.0-beta.3`.

---

## P2 — Voice

### U0 — Shared groundwork for P2–P5

Do this first, as its own commit. Several items below rely on it.

**1. Add these tokens** to the `:root` block in `apps/client/src/renderer/index.html`, directly after the line `--color-warning: oklch(0.82 0.1 80);`:

```css
      /* PRD 20 U0 — values from the mockup (Appendix A) that had no token yet. */
      --color-voice: oklch(0.78 0.14 155);          /* "Voice connected" signal, speaking green */
      --color-voice-text: oklch(0.8 0.13 155);       /* the "Voice connected" label */
      --color-voice-tint: color-mix(in srgb, oklch(0.78 0.14 155) 7%, var(--color-surface)); /* dock card top */
      --color-danger: oklch(0.7 0.15 22);            /* a muted mic/headset icon */
      --color-danger-line: oklch(0.5 0.12 22);       /* its border */
      --color-danger-fill: color-mix(in srgb, oklch(0.6 0.16 22) 16%, transparent); /* its fill */
      --color-danger-hover: color-mix(in srgb, oklch(0.6 0.16 22) 14%, transparent); /* Leave hover */
      --color-warning-line: oklch(0.5 0.09 80);      /* the NO ACCESS tag's ring */
```
Note: `.server-pill-dot.failed` already uses `var(--color-danger, var(--color-live))`; defining `--color-danger` makes that dot this red. That is intended.

**2. Add an "above" placement to `openMenu`.** In `renderer.ts`, function `openMenu`:
- Change the `opts` parameter type to `opts: { anchor?: HTMLElement; returnFocusTo?: HTMLElement; placement?: "below" | "above" } = {}`.
- In the positioning block (after `const rect = menu.getBoundingClientRect();`), replace `let top = y;` with:
```ts
    // "above": y is the anchor's top edge; the menu's bottom sits 6 px above it.
    let top = opts.placement === "above" ? y - rect.height - 6 : y;
```
- Leave the flip/clamp lines that follow unchanged (they still keep the menu on screen).

**3. Add the segmented-control styles** (used by M1 and S1) after the `.section-label` rule in the CSS:
```css
    /* Segmented control (Nocturne .seg) — PRD 20 U0. A .seg-opt.active is the chosen one. */
    .seg {
      display: inline-flex;
      overflow: hidden;
      border: 1px solid var(--color-divider);
      border-radius: var(--radius-md);
    }

    .seg-opt {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px;
      border: none;
      background: transparent;
      color: var(--color-neutral-300);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }

    .seg-opt + .seg-opt {
      border-left: 1px solid var(--color-divider);
    }

    .seg-opt:hover:not(.active) {
      background: color-mix(in srgb, var(--color-text) 7%, transparent);
    }

    .seg-opt.active {
      color: var(--color-accent);
      box-shadow: inset 0 0 0 1px var(--color-accent);
    }

    .seg-opt .seg-count {
      font-size: 11.5px;
      color: var(--color-neutral-500);
    }
```
**Verify:** typecheck, lint, open any menu (right-click a channel) — unchanged. Commit `refactor: Nocturne status tokens, menu "above" placement, segmented control (PRD 20 U0)`.

---

### U1 — Voice dock restyle

**Frames:** `1a.png`, `11a.png` (bottom-left of the sidebar).
**Today:** `#voice-panel` in `index.html` holds the two banners, then `.voice-info` (a pulsing dot, `#voice-channel-name` "Voice: {room}", `#voice-session-timer`, `#btn-expand-voice`) and `#voice-controls` (a 2×2 grid: `#btn-mute`, `#btn-deafen`, `#btn-share-screen`, `#btn-leave-voice`, inline SVG icons). `updateVoiceUI()` fills it; the 1 s interval under "Voice Session Timer — tick every second" writes the panel timer; the 3 s interval under "Latency Display" writes `#status-latency`.
**Target (Appendix A §A1):** one card (radius 14 px, green-tinted top, `--shadow-sm`): a filled green signal icon, **"Voice connected"** (13 px, 600, `--color-voice-text`), under it **"{room} / {category} · {n}ms"** (11.5 px, `--color-neutral-500`), the expand button top-right (28×28 ghost, `ph-arrow-square-out`). Below, one row: **mic split button** (main + 20 px caret), **headset split button**, **Share screen**, **Leave** (red outline). The caret opens a device menu.

**Decisions already made:**
- The dock no longer shows the room timer (the tree row shows the same room timer, PRD 19 A3). `#voice-session-timer` is removed.
- The device menu switches the device **immediately** (no Save), and stays in sync with Settings › Voice/Sound, which keep their own Save button.
- When the room has no parent category the sub line is "{room} · {n}ms".

**Steps:**

1. **Markup.** In `index.html`, inside `#voice-panel`, keep `#screen-share-alert-banner` and `#self-hear-banner` exactly as they are. Replace everything from `<div class="voice-info">` to the closing `</div>` of `#voice-controls` with:
```html
        <div class="voice-dock-card">
          <div class="voice-dock-head">
            <i class="ph-fill ph-cell-signal-full voice-dock-signal" aria-hidden="true"></i>
            <div class="voice-dock-text">
              <div class="voice-dock-title">Voice connected</div>
              <div class="voice-dock-sub"><span id="voice-channel-name"></span><span id="voice-dock-latency"></span></div>
            </div>
            <button type="button" class="btn btn-ghost btn-icon voice-expand-btn" id="btn-expand-voice" title="Expand voice room" aria-label="Expand voice room"><i class="ph ph-arrow-square-out" aria-hidden="true"></i></button>
          </div>
          <div id="voice-controls">
            <div class="split-btn">
              <button type="button" class="voice-btn split-main" id="btn-mute" title="Mute"><i class="ph ph-microphone" aria-hidden="true"></i></button>
              <button type="button" class="voice-btn split-caret" id="btn-input-devices" title="Input device" aria-label="Input device" aria-haspopup="menu"><i class="ph-bold ph-caret-down" aria-hidden="true"></i></button>
            </div>
            <div class="split-btn">
              <button type="button" class="voice-btn split-main" id="btn-deafen" title="Deafen"><i class="ph ph-headphones" aria-hidden="true"></i></button>
              <button type="button" class="voice-btn split-caret" id="btn-output-devices" title="Output device" aria-label="Output device" aria-haspopup="menu"><i class="ph-bold ph-caret-down" aria-hidden="true"></i></button>
            </div>
            <button type="button" class="voice-btn" id="btn-share-screen" title="Share Screen"><i class="ph ph-screencast icon-share-start" aria-hidden="true"></i><i class="ph ph-screencast icon-share-stop" aria-hidden="true"></i><span class="share-full-count" aria-hidden="true">5/5</span></button>
            <button type="button" class="voice-btn leave" id="btn-leave-voice" title="Leave Voice"><i class="ph ph-phone-x" aria-hidden="true"></i></button>
          </div>
        </div>
```
   (Both share icons are `ph-screencast`: the existing `.active` CSS swaps them and the `.active` fill shows the sharing state. Keep both elements — CSS references `.icon-share-start/.icon-share-stop`.)

2. **CSS.** In `index.html`:
   - Delete the rules `#voice-panel .voice-info`, `#voice-panel .voice-info .dot`, `#voice-panel.reconnecting .voice-info .dot` and the old `#voice-controls` grid rule. **Keep the `.session-timer` rule** — the channel tree's room timer (`renderTree`, `class="session-timer" data-session-channel=…`) uses it.
   - Change `#voice-panel` to `padding: 0 10px 10px; border-top: none;` (keep `display:none` / `.visible{display:flex}` and `gap: 6px`).
   - Replace the `.voice-btn` / `.voice-btn:hover` / `.voice-btn.active` rules with:
```css
    .voice-dock-card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 10px 12px;
      border-radius: var(--radius-lg);
      background: linear-gradient(180deg, var(--color-voice-tint), var(--color-surface));
      box-shadow: var(--shadow-sm);
    }

    .voice-dock-head {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .voice-dock-signal {
      font-size: 16px;
      color: var(--color-voice);
    }

    #voice-panel.reconnecting .voice-dock-signal {
      color: var(--color-warning);
      animation: pulse 0.8s infinite;
    }

    .voice-dock-text {
      flex: 1;
      min-width: 0;
    }

    .voice-dock-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--color-voice-text);
    }

    .voice-dock-sub {
      font-size: 11.5px;
      color: var(--color-neutral-500);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #voice-controls {
      display: flex;
      gap: 6px;
    }

    .split-btn {
      position: relative;
      display: flex;
      flex: 1.4;
    }

    .voice-btn {
      flex: 1;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 0;
      border: 1px solid var(--color-divider);
      border-radius: var(--radius-md);
      background: transparent;
      color: var(--color-neutral-300);
      font-size: 16px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }

    .voice-btn:hover {
      color: var(--color-accent-300);
    }

    .split-btn .split-main {
      border-radius: var(--radius-md) 0 0 var(--radius-md);
    }

    .split-btn .split-caret {
      flex: none;
      width: 20px;
      font-size: 10px;
      color: var(--color-neutral-400);
      border-left-color: transparent;
      border-radius: 0 var(--radius-md) var(--radius-md) 0;
      box-shadow: inset 1px 0 0 var(--color-divider);
    }

    .split-btn .split-caret:hover,
    .split-btn .split-caret.menu-open {
      color: var(--color-neutral-100);
      background: var(--color-accent-900);
    }

    /* Muted / deafened: the main part AND its caret go red (the design ties the border to the state). */
    .split-btn:has(.split-main.active) .voice-btn {
      border-color: var(--color-danger-line);
    }

    .split-btn .split-main.active {
      background: var(--color-danger-fill);
      color: var(--color-danger);
    }

    #btn-share-screen.active {
      background: var(--color-accent-900);
      border-color: var(--color-accent-600);
      color: var(--color-accent-300);
    }

    .voice-btn.leave {
      border-color: var(--color-danger-line);
      color: var(--color-danger-text);
    }

    .voice-btn.leave:hover {
      background: var(--color-danger-hover);
    }
```
   - Keep the existing `#btn-share-screen .icon-share-*`, `.share-full`, `.share-full-count` rules.
   - In the `.voice-expand-btn` rule (under "Voice room tab (PRD 19 C9)"), add `color: var(--color-neutral-400);`.

3. **Renderer — element refs.** At the top of `renderer.ts`, next to `const voiceChannelName = …`, add:
```ts
const voiceDockLatency = document.getElementById("voice-dock-latency") as HTMLSpanElement;
const btnInputDevices = document.getElementById("btn-input-devices") as HTMLButtonElement;
const btnOutputDevices = document.getElementById("btn-output-devices") as HTMLButtonElement;
```

4. **Renderer — the sub line.** Add, right above `function updateVoiceUI`:
```ts
/** "{room} / {category}" for the voice dock (PRD 20 U1); "" when not in voice. */
function voiceRoomLabel(): string {
    const node = isInVoice && currentChannelId ? findChannelNodeById(currentTree, currentChannelId) : null;
    if (!node) return "";
    const parent = node.parentId ? findChannelNodeById(currentTree, node.parentId) : null;
    return parent ? `${node.name} / ${parent.name}` : node.name;
}

function renderVoiceDockSub(): void {
    const label = voiceRoomLabel();
    const reconnecting = voicePanel.classList.contains("reconnecting");
    voiceChannelName.textContent = reconnecting ? `${label} (reconnecting…)` : label;
}
```
   - In `updateVoiceUI`, replace the block `if (channelName) { voiceChannelName.textContent = \`Voice: ${channelName}\`; }` with `renderVoiceDockSub();`. Keep the `channelName` parameter (callers pass it; it is now unused — rename it to `_channelName` so lint stays quiet).
   - In the `api.on("voice-reconnecting", …)` handler, replace `voiceChannelName.textContent += " (reconnecting…)";` with `renderVoiceDockSub();` (it runs after `voicePanel.classList.add("reconnecting")`). In `api.on("voice-reconnected", …)` add `renderVoiceDockSub();` after `voicePanel.classList.remove("reconnecting");`.
   - The other places that clear `voiceChannelName.textContent = ""` stay as they are.

5. **Renderer — icons follow the state.** In `updateVoiceUI`, inside `if (isInVoice) {`, after the four `btnMute`/`btnDeafen` lines add:
```ts
        btnMute.querySelector("i")!.className = `ph ${isMuted ? "ph-microphone-slash" : "ph-microphone"}`;
        btnDeafen.querySelector("i")!.className = `ph ${isDeafened ? "ph-speaker-slash" : "ph-headphones"}`;
```

6. **Renderer — latency in the dock.** In the 3 s latency interval (search `Latency Display — poll every 3 seconds`):
   - In the `ms < 0` branch also set `voiceDockLatency.textContent = "";`.
   - After `statusLatency.className = …` add:
```ts
    voiceDockLatency.textContent = isInVoice ? ` · ${ms}ms` : "";
    if (isInVoice) renderVoiceDockSub(); // picks up a renamed room or category within 3 s
```

7. **Renderer — remove the dock timer.** Delete the two blocks that write `document.getElementById("voice-session-timer")` (one in the 1 s interval: the `// Update the voice panel timer` block; one in the `disconnected` handler: `const panelTimer = …; if (panelTimer) …`). `grep -n "voice-session-timer" renderer.ts` must then return nothing.

8. **Renderer — one place to apply a device.** Under `// ── Audio Device Selection`, add after `function updateSaveBtnVisibility`:
```ts
/**
 * Applies and remembers an audio device (PRD 20 U1). Used by Settings' Save and by
 * the voice dock / call bar device menus, so the two can never disagree.
 * deviceId "" = the system default.
 */
function applyAudioDevice(kind: "input" | "output", deviceId: string, label: string): void {
    if (kind === "input") {
        api.setAudioInputDevice(deviceId || null);
        try {
            localStorage.setItem("reson8-audio-input", deviceId);
        } catch {
            /* not remembered */
        }
        savedInputDevice = deviceId;
        log(`Microphone set to: ${label}`, "info");
    } else {
        try {
            localStorage.setItem("reson8-audio-output", deviceId);
        } catch {
            /* not remembered */
        }
        savedOutputDevice = deviceId;
        for (const el of document.querySelectorAll("audio")) {
            (el as any).setSinkId?.(deviceId).catch(() => {});
        }
        log(`Speaker set to: ${label}`, "info");
    }
    // Settings may be open on Voice/Sound: keep its selects showing the truth.
    if (adminModal.classList.contains("visible")) void populateAudioDevices();
}
```
   Then rewrite the body of `btnSaveDevices.addEventListener("click", …)` to call it:
```ts
btnSaveDevices.addEventListener("click", () => {
    if (pendingInputDevice !== null && pendingInputDevice !== savedInputDevice) {
        applyAudioDevice("input", pendingInputDevice, audioInputSelect.selectedOptions[0]?.textContent ?? "System Default");
    }
    if (pendingOutputDevice !== null && pendingOutputDevice !== savedOutputDevice) {
        applyAudioDevice("output", pendingOutputDevice, audioOutputSelect.selectedOptions[0]?.textContent ?? "System Default");
    }
    pendingInputDevice = null;
    pendingOutputDevice = null;
    btnSaveDevices.style.display = "none";
});
```
   (`populateAudioDevices()` resets the pending values itself, so calling it from `applyAudioDevice` is safe.)

9. **Renderer — the device menu.** Add after `applyAudioDevice`:
```ts
/** The caret menu of the mic / headset split buttons (PRD 20 U1, frames 1a/11a). */
async function openAudioDeviceMenu(kind: "input" | "output", anchor: HTMLElement): Promise<void> {
    const { inputs, outputs } = await api.enumerateAudioDevices();
    const list = kind === "input" ? inputs : outputs;
    const current = kind === "input" ? savedInputDevice : savedOutputDevice;
    const icon = kind === "input" ? "ph-microphone" : "ph-speaker-high";
    const items: MenuItem[] = [{ heading: kind === "input" ? "Input device" : "Output device" }];
    items.push({ label: "System default", icon, checked: current === "", onClick: () => applyAudioDevice(kind, "", "System default") });
    for (const d of list) {
        const label = d.label || "Unnamed device";
        items.push({ label, icon, checked: d.deviceId === current, onClick: () => applyAudioDevice(kind, d.deviceId, label) });
    }
    items.push({ divider: true });
    items.push({ label: "Voice & audio settings…", icon: "ph-gear-six", onClick: () => openClientSettings(kind === "input" ? "voice" : "sound") });
    const r = anchor.getBoundingClientRect();
    openMenu(items, r.left, r.top, { anchor, placement: "above" });
}

btnInputDevices.addEventListener("click", (e) => {
    e.stopPropagation();
    void openAudioDeviceMenu("input", btnInputDevices);
});
btnOutputDevices.addEventListener("click", (e) => {
    e.stopPropagation();
    void openAudioDeviceMenu("output", btnOutputDevices);
});
```
   Check `api.enumerateAudioDevices()` in `interface Reson8Api` returns `{ inputs: { deviceId: string; label: string }[]; outputs: … }` (it is what `populateAudioDevices` uses).

**Pitfalls:**
- `btnMute`, `btnDeafen`, `btnShareScreen`, `btnLeaveVoice` keep their ids, so their existing listeners and keyboard shortcuts keep working. Do not add new listeners to them.
- Self-hear forces mute+deafen; that path calls `updateVoiceUI()`, so icons follow. Check it (Settings › Voice › Hear yourself while in voice).

**Verify (CDP, in a voice room):**
1. Screenshot the dock next to `1a.png`: card, green signal, "Voice connected", "{room} / {category} · {n}ms", 4 controls in one row.
2. `btnMute.click()` → mic icon becomes `ph-microphone-slash`, the split button turns red; again → back. Same for deafen (`ph-speaker-slash`).
3. Click `#btn-input-devices` → a menu **above** the button: heading "Input device", "System default" ticked (fresh profile), the devices, divider, "Voice & audio settings…". Pick a device → `localStorage["reson8-audio-input"]` equals its id, the tick moves next time, and Settings › Voice shows it selected.
4. "Voice & audio settings…" from the output menu opens Settings on **Sound**.
5. Rename the room's parent category → the dock line updates within 3 s.
6. `grep -n "voice-session-timer" apps/client/src/renderer/*.{ts,html}` → nothing.

**Done when:** all six pass, typecheck + lint clean, logged, committed `feat: voice dock card with device split buttons (PRD 20 U1)`.

---

### U2 — Voice room header and call controls

**Frames:** `11a.png` (header + call bar), `11b.png`, `1m.png` (call bar behind the dialog).
**Depends on:** U0, U1.
**Today:** `createVoiceTab()` builds `.voice-room-header` as one line: name, count, sharing text, the Focus|Grid toggle, the Mosaic|Featured toggle. There is no call bar in the tab.
**Target (Appendix A §A2):**
- Header (padding 22px 24px 0): left — a kicker "{CATEGORY} · VOICE ROOM" (section-label style) and the room name at 28 px weight 500; right — pills: **Encrypted / Not encrypted** (lock icon), **people** `{n} / {cap}` (`ph-users`), **sharing** `{n} / 5 sharing` (`ph-screencast`, accent; only while someone shares), the **Focus | Grid** toggle (only with 2+ sharers, as today), the **Mosaic | Featured** toggle. Toggle buttons get icons: Focus `ph-square-half`, Grid `ph-grid-four`, Mosaic `ph-squares-four`, Featured `ph-square-split-horizontal`.
- A call bar centred under the tiles: **mic split** (54×52 + 30×52 caret, radius 26 px), **headset split**, **Share screen** (pill, label "Share screen" / "Stop sharing" / "Share screen · 5/5"), **Leave** (red pill, `ph-phone-x`).

**Decision already made:** the call bar **calls the dock's own code paths** (`toggleMuteAndNotify`, `toggleDeafenAndNotify`, `btnShareScreen.click()`, `leaveVoiceAndNotify`, `openAudioDeviceMenu`). It never has its own state.

**Steps:**

1. **Header markup.** In `createVoiceTab()`, replace the `voice-room-header` part of the `contentEl.innerHTML` string (from `` `<div class="voice-room-header">` `` up to and including the closing `` `</div></div>` `` of the layout toggle) with:
```ts
        `<div class="voice-room-header">` +
        `<div class="voice-room-title"><div class="section-label voice-room-kicker"></div><h2 class="voice-room-name"></h2></div>` +
        `<div class="voice-room-pills">` +
        `<span class="room-pill voice-room-security"><i class="ph ph-lock-simple" aria-hidden="true"></i><span class="voice-room-security-text"></span></span>` +
        `<span class="room-pill"><i class="ph ph-users" aria-hidden="true"></i><span class="voice-room-count"></span></span>` +
        `<span class="room-pill accent voice-room-sharing-pill"><i class="ph ph-screencast" aria-hidden="true"></i><span class="voice-room-sharing"></span></span>` +
        `<div class="voice-layout-toggle voice-stream-layout-toggle" role="group" aria-label="Stream layout">` +
        `<button type="button" data-stream-layout="focus" title="One stream large, the rest as previews"><i class="ph ph-square-half" aria-hidden="true"></i>Focus</button>` +
        `<button type="button" data-stream-layout="grid" title="Every stream at the same size"><i class="ph ph-grid-four" aria-hidden="true"></i>Grid</button>` +
        `</div>` +
        `<div class="voice-layout-toggle" role="group" aria-label="Layout">` +
        `<button type="button" data-layout="mosaic"><i class="ph ph-squares-four" aria-hidden="true"></i>Mosaic</button>` +
        `<button type="button" data-layout="featured"><i class="ph ph-square-split-horizontal" aria-hidden="true"></i>Featured</button>` +
        `</div></div></div>` +
```
   The class names `voice-room-name`, `voice-room-count`, `voice-room-sharing`, `voice-stream-layout-toggle`, `data-layout`, `data-stream-layout` are queried elsewhere — they are kept on purpose.

2. **Call bar markup.** In the same string, after `` `<div class="voice-room-stage"><div class="voice-grid"></div></div>` `` and before the final `` `</div>` `` of `.voice-room`, insert:
```ts
        `<div class="voice-callbar">` +
        `<div class="split-btn callbar-split"><button type="button" class="voice-btn split-main" data-call="mute" title="Mute"><i class="ph ph-microphone" aria-hidden="true"></i></button>` +
        `<button type="button" class="voice-btn split-caret" data-call="input" title="Input device" aria-label="Input device" aria-haspopup="menu"><i class="ph-bold ph-caret-down" aria-hidden="true"></i></button></div>` +
        `<div class="split-btn callbar-split"><button type="button" class="voice-btn split-main" data-call="deafen" title="Deafen"><i class="ph ph-headphones" aria-hidden="true"></i></button>` +
        `<button type="button" class="voice-btn split-caret" data-call="output" title="Output device" aria-label="Output device" aria-haspopup="menu"><i class="ph-bold ph-caret-down" aria-hidden="true"></i></button></div>` +
        `<button type="button" class="voice-btn callbar-pill" data-call="share"><i class="ph ph-screencast" aria-hidden="true"></i><span class="callbar-share-label">Share screen</span></button>` +
        `<button type="button" class="voice-btn callbar-pill leave" data-call="leave"><i class="ph ph-phone-x" aria-hidden="true"></i>Leave</button>` +
        `</div>` +
```

3. **Wire the call bar.** At the end of `createVoiceTab()`, before `return vt;`:
```ts
    // The call bar runs the dock's own code paths (PRD 20 U2) — it has no state of its own.
    const call = (name: string): HTMLButtonElement => contentEl.querySelector(`[data-call="${name}"]`) as HTMLButtonElement;
    call("mute").addEventListener("click", () => toggleMuteAndNotify());
    call("deafen").addEventListener("click", () => toggleDeafenAndNotify());
    call("share").addEventListener("click", () => btnShareScreen.click());
    call("leave").addEventListener("click", () => leaveVoiceAndNotify());
    call("input").addEventListener("click", (e) => {
        e.stopPropagation();
        void openAudioDeviceMenu("input", call("input"));
    });
    call("output").addEventListener("click", (e) => {
        e.stopPropagation();
        void openAudioDeviceMenu("output", call("output"));
    });
```
   Confirm the four function names exist (`grep -n "^function toggleMuteAndNotify\|^function toggleDeafenAndNotify\|^function leaveVoiceAndNotify" renderer.ts`). Do NOT read the dock buttons' state from the call bar or vice versa.

4. **Mirror the state onto the call bar.** Add this function after `updateShareScreenButton`:
```ts
/** Copies the dock's mute/deafen/share state onto the room tab's call bar (PRD 20 U2). */
function renderCallBar(): void {
    if (!voiceTab) return;
    const root = voiceTab.contentEl;
    const mute = root.querySelector('[data-call="mute"]') as HTMLButtonElement | null;
    const deafen = root.querySelector('[data-call="deafen"]') as HTMLButtonElement | null;
    const share = root.querySelector('[data-call="share"]') as HTMLButtonElement | null;
    if (!mute || !deafen || !share) return;
    mute.classList.toggle("active", isMuted);
    mute.title = isMuted ? "Unmute" : "Mute";
    mute.querySelector("i")!.className = `ph ${isMuted ? "ph-microphone-slash" : "ph-microphone"}`;
    deafen.classList.toggle("active", isDeafened);
    deafen.title = isDeafened ? "Undeafen" : "Deafen";
    deafen.querySelector("i")!.className = `ph ${isDeafened ? "ph-speaker-slash" : "ph-headphones"}`;
    share.classList.toggle("active", isSharingScreen);
    share.classList.toggle("share-full", btnShareScreen.classList.contains("share-full"));
    share.disabled = btnShareScreen.disabled;
    share.title = btnShareScreen.title;
    (share.querySelector(".callbar-share-label") as HTMLElement).textContent = isSharingScreen
        ? "Stop sharing"
        : btnShareScreen.classList.contains("share-full")
          ? `Share screen · ${MAX_SCREEN_SHARES_PER_ROOM}/${MAX_SCREEN_SHARES_PER_ROOM}`
          : "Share screen";
}
```
   Call it: (a) at the **end** of `updateShareScreenButton()` — both the macOS early-return branch and the normal path (put `renderCallBar();` before the macOS `return;` and as the last line); (b) at the end of the `if (isInVoice) {` block in `updateVoiceUI` (after `updateShareScreenButton()` it is already covered, so (a) is enough — verify by reading); (c) at the end of `renderVoiceRoom()`.

5. **Header content.** In `renderVoiceRoom()`, replace the two lines `vt.nameEl.textContent = node.name;` and the `vt.countEl.textContent = …` line with:
```ts
    vt.nameEl.textContent = node.name;
    const parent = node.parentId ? findChannelNodeById(currentTree, node.parentId) : null;
    (vt.contentEl.querySelector(".voice-room-kicker") as HTMLElement).textContent = parent ? `${parent.name} · Voice room` : "Voice room";
    const count = node.occupants.length;
    vt.countEl.textContent = node.maxUsers ? `${count} / ${node.maxUsers}` : String(count);
    const secure = currentConnection?.scheme === "https";
    const sec = vt.contentEl.querySelector(".voice-room-security") as HTMLElement;
    sec.classList.toggle("insecure", !secure);
    (sec.querySelector("i") as HTMLElement).className = `ph ${secure ? "ph-lock-simple" : "ph-lock-simple-open"}`;
    (sec.querySelector(".voice-room-security-text") as HTMLElement).textContent = secure ? "Encrypted" : "Not encrypted";
    sec.title = secure ? "Encrypted connection" : "This connection is not encrypted";
```
   In `renderSharingHeader()` add after the `label.textContent = …` line:
```ts
    (voiceTab.contentEl.querySelector(".voice-room-sharing-pill") as HTMLElement).style.display = sharers.length > 0 ? "" : "none";
```
   In `renderVoiceRoom()` the existing `vt.btnMosaic.title = sharing ? "Mosaic is only available…" : "";` — change the `""` to `"Everyone, sized to fit"`, and add `vt.btnFeatured.title = sharing ? "Featured is used while someone is sharing" : "Five people, the rest in a list";`.

6. **CSS.** Replace the `.voice-room-header`, `.voice-room-name`, `.voice-room-count`, `.voice-layout-toggle`, `.voice-layout-toggle button`, `.voice-layout-toggle button.active` rules and `.voice-room-sharing` rule with (keep the `.voice-stream-layout-toggle` show/hide rules and the `button:disabled` rule):
```css
    .voice-room-header {
      display: flex;
      align-items: flex-end;
      gap: 16px;
      padding: 22px 24px 0;
      flex-shrink: 0;
    }

    .voice-room-title {
      flex: 1;
      min-width: 0;
    }

    .voice-room-name {
      margin: 4px 0 0;
      font-size: 28px;
      font-weight: 500;
      color: var(--color-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .voice-room-pills {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .room-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      border-radius: 6px;
      background: var(--color-neutral-800);
      color: var(--color-neutral-100);
      font-size: 11px;
      letter-spacing: 0.02em;
    }

    .room-pill.accent {
      background: var(--color-accent-800);
      color: var(--color-accent-100);
    }

    .room-pill.insecure {
      color: var(--color-warning-text);
    }

    .voice-room-count,
    .voice-room-sharing {
      font-size: inherit;
      color: inherit;
    }

    .voice-layout-toggle {
      display: flex;
      gap: 2px;
      padding: 2px;
      border-radius: var(--radius-md);
      box-shadow: inset 0 0 0 1px var(--color-divider);
    }

    .voice-layout-toggle button {
      display: flex;
      align-items: center;
      gap: 5px;
      height: 22px;
      padding: 0 8px;
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--color-neutral-400);
      font: 500 12px var(--font);
      cursor: pointer;
    }

    .voice-layout-toggle button:hover:not(:disabled) {
      color: var(--color-neutral-100);
    }

    .voice-layout-toggle button.active {
      background: var(--color-accent-900);
      color: var(--color-accent-200);
    }

    .voice-callbar {
      display: flex;
      justify-content: center;
      gap: 10px;
      padding: 12px 0 18px;
      flex-shrink: 0;
    }

    .voice-callbar .callbar-split {
      flex: none;
    }

    .voice-callbar .split-main {
      width: 54px;
      height: 52px;
      font-size: 21px;
      border-radius: 26px 0 0 26px;
    }

    .voice-callbar .split-caret {
      width: 30px;
      height: 52px;
      font-size: 12px;
      border-radius: 0 26px 26px 0;
    }

    .voice-callbar .callbar-pill {
      flex: none;
      display: flex;
      align-items: center;
      gap: 8px;
      height: 52px;
      padding: 0 18px;
      border-radius: 26px;
      font: 500 14px var(--font);
    }

    .voice-callbar .callbar-pill i {
      font-size: 19px;
    }

    .voice-callbar .callbar-pill.leave {
      padding: 0 22px;
      border-color: var(--color-danger-border);
    }

    .voice-callbar .callbar-pill.active {
      background: var(--color-accent-900);
      border-color: var(--color-accent-600);
      color: var(--color-accent-300);
    }

    .voice-callbar .callbar-pill.share-full {
      opacity: 0.55;
    }
```
   The tiles area (`.voice-room-stage`) is `flex: 1` and the call bar is `flex-shrink: 0`, so the tiles fit the remaining height; `layoutVoiceTiles` already re-runs on its `ResizeObserver`.

**Pitfalls:**
- The `.voice-room-header` used `border-bottom` before; the design has none — removed on purpose.
- `renderVoiceRoom()` runs on every presence update; everything above is a targeted text/class update (no rebuild). Don't call `createVoiceTab()` again.
- Long room names must truncate with an ellipsis, never push the pills off-screen (check with a 60-character name at 1024 px width).

**Verify (CDP, room with 16 people — 15 bots via `USER_JOIN_CHANNEL`):**
1. Screenshot next to `11a.png`: kicker, 28 px name, Encrypted/Not encrypted (dev servers are http → "Not encrypted", amber), "16" or "16 / {cap}", Mosaic active, call bar centred at the bottom, all 16 tiles visible without scrolling.
2. Click the call bar's mic → dock mic turns red too; click the dock's mic → call bar follows. Same for headset. Keyboard mute shortcut (if set) updates both.
3. Make a bot share (`SET_SCREEN_SHARE_STATE { isSharingScreen: true }`) → sharing pill "1 / 5 sharing" appears, Mosaic disabled with its tooltip; stop → pill gone.
4. With 5 real sharers (4 extra instances), the call bar's share reads "Share screen · 5/5" and is dimmed; clicking shows the toast.
5. Call bar Leave → you leave voice and the tab closes.
6. Resize to 1024×680: header pills don't overflow; the name truncates.

**Done when:** all pass; logged; committed `feat: voice room header pills and call bar (PRD 20 U2)`.

---

### U3 — Title-bar pill: "server · nickname"

**Frame:** `1a.png` — `● farewell-ts.reson8.com.br · 👤 PoPaDiNhAs ▾`.
**Today:** `renderServerPill()` writes one text: the server name (or address) when connected, the connect-flow text otherwise.
**Target:** connected → green dot, **the server address** (`displayAddress(host, port)` of `currentConnection`), a `·`, a `ph-user` icon and **your nickname** (`--color-neutral-300`), then the caret. Not connected → unchanged ("Not connected", "Connecting…", "Connection failed"…). The pill stays centred on the window; when space is short **the address truncates first**, the nickname truncates only beyond 140 px.

**Steps:**
1. **Markup** (`index.html`, `#server-pill`): replace its content with
```html
      <span class="server-pill-dot" id="server-pill-dot"></span>
      <span id="server-pill-text">Not connected</span>
      <span class="server-pill-user" id="server-pill-user" hidden><span class="server-pill-sep" aria-hidden="true">·</span><i class="ph ph-user" aria-hidden="true"></i><span id="server-pill-nick"></span></span>
      <i class="ph ph-caret-down server-pill-caret" aria-hidden="true"></i>
```
2. **CSS:** in `.server-pill` change `max-width` to `min(460px, calc(100vw - 420px))`; add `#server-pill-text { min-width: 0; flex-shrink: 1; }` (it already has the ellipsis rule) and:
```css
    .server-pill-user {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
      color: var(--color-neutral-300);
    }

    .server-pill-user[hidden] {
      display: none;
    }

    .server-pill-sep {
      color: var(--color-neutral-600);
    }

    .server-pill-user i,
    .server-pill-caret {
      color: var(--color-neutral-500);
    }

    #server-pill-nick {
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
```
3. **State:** add near the other connection state (`let connectedServerName`): `let connectedNickname = "";`. In `api.on("connected", …)` set `connectedNickname = nicknameInput.value.trim() || "User";` **before** `renderServerPill()`. In the `disconnected` handler set `connectedNickname = "";` before its `renderServerPill()`. Also replace `` statusText.textContent = `Connected as ${nicknameInput.value.trim() || "User"}`; `` with `` statusText.textContent = `Connected as ${connectedNickname}`; ``.
4. **`renderServerPill()`:** replace the existing `const flow = …` line **and** the `text.textContent = …` statement after it with the block below (it declares `flow` itself — there must be exactly one `const flow` in the function; keep `const saved = …` and the two `dot.classList.toggle` lines):
```ts
    const flow = isConnected ? null : connectPillText();
    if (isConnected) {
        text.textContent = currentConnection
            ? displayAddress(currentConnection.host, currentConnection.port)
            : connectedServerName || saved?.name || "Connected";
    } else {
        text.textContent = flow?.text ?? "Not connected";
    }
    const user = document.getElementById("server-pill-user");
    const nick = document.getElementById("server-pill-nick");
    if (user && nick) {
        user.hidden = !isConnected;
        nick.textContent = isConnected ? connectedNickname : "";
    }
    const pill = document.getElementById("server-pill");
    if (pill) pill.title = isConnected ? `${connectedServerName ?? ""} — ${text.textContent} as ${connectedNickname}`.replace(/^ — /, "") : "";
```
   (Keep the `const flow` that already exists — don't declare it twice; keep the two `dot.classList.toggle` lines.)

**Verify:** connected → screenshot matches `1a.png`'s pill; a 60-char nickname shows "…" at 140 px; at 1024 px width the address truncates and the nickname stays; disconnect → "Not connected", no nickname; the switcher menu still opens under the pill. Commit `feat: title-bar pill shows address and nickname (PRD 20 U3)`.

---

## P3 — Server settings

### M1 — Members: search, filters and rows

**Frame:** `5a.png`. **Today:** `renderAdminUsers(users)` builds one `.admin-user-row` per user with every role as a clickable `.role-badge`, Ban/Unban, Reset key (two-click arm) and an identity-log icon button; `openSettingsPanel()` fetches `getAllUsers` + `getRoles` + `getBannedUsers` + `getPendingEmojis` and calls it. An `#identity-log-bar` with a "Identity log" button sits above the list.
**Target (Appendix A §A3):** a search field ("Search by name or ID") and a segmented filter **All {n} | Admins {n} | No key {n} | No access {n}**; one card listing members; each row: 32 px avatar with an online dot, name (+ "(you)", a lock when a key is bound, a **NO ACCESS** amber tag, a **BANNED** tag), a monospace second line "{short id} · {Online · room | Online | Last seen … | Offline}", two pills **Member** and **Admin**, and a ⋮ button opening a menu. Under the card: the legend line and the two-paragraph Member/Admin help box.

**Decisions already made:**
- Search and filters are client-side over the one `GET_ALL_USERS` list. Filters: **All**; **Admins** = aggregated permissions include ADMIN (bit 8); **No key** = `hasIdentityKey !== true`; **No access** = no role grants CONNECT (bit 0) or ADMIN.
- **Member pill** toggles role id `role-default`, **Admin pill** toggles role id `role-admin` (fixed ids from `prisma/seed.ts`). A pill whose role isn't in `allServerRoles` is not drawn.
- Pills are interactive only for MANAGE_ROLES holders (`isAdminUser`); for others they are drawn read-only (no hover, `cursor: default`).
- Every **other** role (not Member/Admin) is toggled from the ⋮ menu under a heading "Other roles" (each with a tick when held).
- ⋮ menu: **Reset key…** (iAmAdmin, key bound, not you) → a second menu at the same spot with one danger item "Reset {name}'s key — disconnects them" (this replaces the old 4-second arming); **View identity log** (iAmAdmin) → `showIdentityLog({ id, nickname })`; "Other roles" group (isAdminUser); divider; **Ban…** (canBanUsers, not you, not banned) → `openBanDialog({ id, nickname })`, or **Unban** (banned) → the existing unban code.
- Online status: one `api.getOnlineUsers()` call per refresh (`isOnline`); the room is the voice channel in `currentTree` whose `occupants` contain the user.
- Server-side guards (step 8) are added because the pills make admin changes one click away.

**Steps:**

1. **Markup.** Replace the content of `<div class="settings-panel" data-settings-panel="roles">` (keep the title and subtitle) with:
```html
        <div class="members-toolbar">
          <div class="members-search">
            <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
            <input type="text" class="input" id="members-search" placeholder="Search by name or ID" autocomplete="off" spellcheck="false" aria-label="Search members">
          </div>
          <div class="seg" id="members-filters" role="radiogroup" aria-label="Filter members">
            <button type="button" class="seg-opt active" data-filter="all" role="radio" aria-checked="true">All<span class="seg-count"></span></button>
            <button type="button" class="seg-opt" data-filter="admins" role="radio" aria-checked="false">Admins<span class="seg-count"></span></button>
            <button type="button" class="seg-opt" data-filter="nokey" role="radio" aria-checked="false">No key<span class="seg-count"></span></button>
            <button type="button" class="seg-opt" data-filter="noaccess" role="radio" aria-checked="false">No access<span class="seg-count"></span></button>
          </div>
        </div>
        <div id="admin-user-list" class="members-list">
          <div class="admin-empty">Loading users...</div>
        </div>
        <div class="members-legend"><span><i class="ph-fill ph-lock-simple" aria-hidden="true"></i>Key bound — signs in with a verified identity</span><span>Same name twice? The ID tells accounts apart.</span></div>
        <div class="members-help">
          <div><i class="ph ph-user" aria-hidden="true"></i><span><b>Member</b> — can open text channels, send DMs, join voice and interact. Click to remove it: the person can still connect, but sees the server read-only.</span></div>
          <div><i class="ph ph-shield-star" aria-hidden="true"></i><span><b>Admin</b> — opens these settings and does sensitive operations: bans, key resets, emoji approval. Admins can remove other admins.</span></div>
        </div>
```
   This removes `#identity-log-bar` and `#btn-identity-log`. Then `grep -n "identityLogBar\|btn-identity-log\b\|identity-log-bar" apps/client/src/renderer/renderer.ts` and delete every hit (the `const`, the `style.display` lines in `renderAdminUsers`, and the button's listener). Keep `identityLogAllowed` and the nav-tab show/hide lines.

2. **CSS** (add near the old `.admin-user-row` rules; leave `.admin-user-row` in place — the emoji page and identity log still use it until M3):
```css
    .members-toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }

    .members-search {
      position: relative;
      flex: 1;
    }

    .members-search i {
      position: absolute;
      left: 11px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--color-neutral-500);
    }

    .members-search .input {
      padding-left: 32px;
    }

    .members-list {
      display: flex;
      flex-direction: column;
      border-radius: var(--radius-lg);
      background: color-mix(in srgb, var(--color-bg) 35%, transparent);
      box-shadow: var(--shadow-sm);
    }

    .member-row {
      position: relative;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 9px 12px 9px 14px;
    }

    .member-row + .member-row {
      background: linear-gradient(to right, transparent, var(--color-divider) 48px, var(--color-divider) calc(100% - 48px), transparent) no-repeat top / 100% 1px;
    }

    .member-avatar {
      position: relative;
      flex: none;
    }

    .member-dot {
      position: absolute;
      right: -1px;
      bottom: -1px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--color-neutral-700);
      box-shadow: 0 0 0 2px var(--color-surface);
    }

    .member-dot.online {
      background: var(--color-success);
    }

    .member-main {
      flex: 1;
      min-width: 0;
    }

    .member-name {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 500;
      color: var(--color-neutral-100);
    }

    .member-row.no-access .member-name {
      color: var(--color-neutral-400);
    }

    .member-you {
      font-size: 12px;
      font-weight: 400;
      color: var(--color-neutral-500);
    }

    .member-lock {
      font-size: 12px;
      color: var(--color-neutral-400);
    }

    .member-tag {
      padding: 1px 6px;
      border-radius: var(--radius-sm);
      font-size: 10.5px;
      font-weight: 600;
      letter-spacing: 0.04em;
    }

    .member-tag.no-access {
      color: var(--color-warning);
      box-shadow: inset 0 0 0 1px var(--color-warning-line);
    }

    .member-tag.banned {
      color: var(--color-danger-text);
      box-shadow: inset 0 0 0 1px var(--color-danger-line);
    }

    .member-sub {
      font: 11.5px ui-monospace, Menlo, monospace;
      color: var(--color-neutral-500);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .member-sub span {
      font-family: var(--font);
      font-size: 12px;
    }

    .member-pills {
      display: flex;
      gap: 6px;
    }

    .member-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 24px;
      padding: 0 9px;
      border: none;
      border-radius: 12px;
      background: transparent;
      color: var(--color-neutral-600);
      box-shadow: inset 0 0 0 1px var(--color-neutral-800);
      font: 500 12px var(--font);
      cursor: pointer;
    }

    .member-pill i {
      font-size: 13px;
    }

    .member-pill.on {
      background: color-mix(in srgb, var(--color-text) 7%, transparent);
      color: var(--color-neutral-200);
      box-shadow: inset 0 0 0 1px var(--color-neutral-600);
    }

    .member-pill.admin.on {
      background: var(--color-accent-900);
      color: var(--color-accent-200);
      box-shadow: inset 0 0 0 1px var(--color-accent-600);
    }

    .member-pill:hover:not(:disabled) {
      filter: brightness(1.15);
    }

    .member-pill:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .member-pill.readonly {
      cursor: default;
      opacity: 1;
    }

    .member-menu-btn {
      width: 30px;
      height: 30px;
      color: var(--color-neutral-400);
    }

    .members-legend {
      display: flex;
      gap: 16px;
      margin-top: 10px;
      font-size: 12px;
      color: var(--color-neutral-500);
    }

    .members-legend i {
      margin-right: 5px;
    }

    .members-help {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 10px;
      padding: 12px 14px;
      border-radius: var(--radius-lg);
      background: color-mix(in srgb, var(--color-text) 3%, transparent);
      font-size: 12.5px;
      line-height: 1.5;
      color: var(--color-neutral-400);
    }

    .members-help div {
      display: flex;
      gap: 8px;
    }

    .members-help i {
      margin-top: 3px;
      color: var(--color-neutral-300);
    }

    .members-help b {
      font-weight: 500;
      color: var(--color-neutral-200);
    }
```

3. **Renderer — state and helpers.** Replace the whole `function renderAdminUsers(users: any[]): void { … }` with the code below (keep it in the same place). It keeps the old function name so `openSettingsPanel()` still calls it.
```ts
// ── Members page (PRD 20 M1) ─────────────────────────────────────────────────

const ROLE_MEMBER_ID = "role-default"; // prisma/seed.ts
const ROLE_ADMIN_ID = "role-admin"; // prisma/seed.ts
const PERM_CONNECT = 1n << 0n;
const PERM_ADMIN = 1n << 8n;

type MembersFilter = "all" | "admins" | "nokey" | "noaccess";
let membersCache: any[] = [];
let membersOnline = new Set<string>();
let membersFilter: MembersFilter = "all";
const membersSearch = document.getElementById("members-search") as HTMLInputElement;

/** The OR of a user's role permissions on this server (strings from the server). */
function memberPerms(user: any): bigint {
    let p = 0n;
    for (const r of user.roles ?? []) {
        try {
            p |= BigInt(r.permissions);
        } catch {
            /* malformed: ignore */
        }
    }
    return p;
}

function memberIsAdmin(user: any): boolean {
    return (memberPerms(user) & PERM_ADMIN) !== 0n;
}

function memberHasAccess(user: any): boolean {
    const p = memberPerms(user);
    return (p & PERM_CONNECT) !== 0n || (p & PERM_ADMIN) !== 0n;
}

function memberHasRole(user: any, roleId: string): boolean {
    return (user.roles ?? []).some((r: any) => r.id === roleId);
}

/** The voice channel a user is in right now, from the live tree. */
function memberVoiceRoom(userId: string): string | null {
    let found: string | null = null;
    const walk = (nodes: TreeNode[]): void => {
        for (const n of nodes) {
            if (found) return;
            if (n.type === "VOICE" && n.occupants.some((o) => o.userId === userId)) found = n.name;
            walk(n.children);
        }
    };
    walk(currentTree);
    return found;
}

function memberMatchesFilter(user: any, filter: MembersFilter): boolean {
    if (filter === "admins") return memberIsAdmin(user);
    if (filter === "nokey") return user.hasIdentityKey !== true;
    if (filter === "noaccess") return !memberHasAccess(user);
    return true;
}

/** Fetches the list and who is online, then draws (PRD 20 M1). */
async function refreshMembersPanel(): Promise<void> {
    if (!isConnected) return;
    const [usersRes, onlineRes] = await Promise.all([api.getAllUsers(currentServerId), api.getOnlineUsers()]);
    if (!usersRes.success) {
        adminUserList.innerHTML = '<div class="admin-empty">You don\'t have permission to manage users.</div>';
        return;
    }
    if (onlineRes.success && onlineRes.users) membersOnline = new Set(onlineRes.users.filter((u) => u.isOnline).map((u) => u.userId));
    renderAdminUsers(usersRes.users ?? []);
}

function renderAdminUsers(users: any[]): void {
    membersCache = users;
    const myId = api.getInstanceId();
    const iAmAdmin = memberIsAdmin(users.find((u) => u.id === myId) ?? {});

    // The identity log is ADMIN-only on the server too (PRD 18.4); its nav item follows.
    identityLogAllowed = iAmAdmin;
    const logTab = document.getElementById("settings-tab-identitylog");
    if (logTab) logTab.style.display = iAmAdmin ? "" : "none";

    // Filter counts always describe the whole list.
    const counts: Record<MembersFilter, number> = {
        all: users.length,
        admins: users.filter((u) => memberIsAdmin(u)).length,
        nokey: users.filter((u) => u.hasIdentityKey !== true).length,
        noaccess: users.filter((u) => !memberHasAccess(u)).length,
    };
    document.querySelectorAll<HTMLButtonElement>("#members-filters .seg-opt").forEach((b) => {
        const f = b.dataset.filter as MembersFilter;
        (b.querySelector(".seg-count") as HTMLElement).textContent = String(counts[f]);
        b.classList.toggle("active", f === membersFilter);
        b.setAttribute("aria-checked", String(f === membersFilter));
    });
    updateSettingsNavCount("roles", users.length); // M4

    const q = membersSearch.value.trim().toLowerCase();
    const rows = users.filter(
        (u) => memberMatchesFilter(u, membersFilter) && (!q || String(u.nickname).toLowerCase().includes(q) || String(u.id).toLowerCase().includes(q)),
    );

    adminUserList.textContent = "";
    if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.className = "admin-empty";
        empty.textContent = users.length === 0 ? "No users found." : q ? `No members match "${membersSearch.value.trim()}".` : "Nobody matches this filter.";
        adminUserList.appendChild(empty);
        return;
    }
    const adminCount = counts.admins;
    for (const user of rows) adminUserList.appendChild(buildMemberRow(user, { myId, iAmAdmin, adminCount }));
}

function buildMemberRow(user: any, ctx: { myId: string; iAmAdmin: boolean; adminCount: number }): HTMLElement {
    const you = user.id === ctx.myId;
    const access = memberHasAccess(user);
    const row = document.createElement("div");
    row.className = "member-row" + (access ? "" : " no-access");

    // Avatar with the online dot
    const avWrap = document.createElement("span");
    avWrap.className = "member-avatar";
    avWrap.appendChild(createAvatarElement(user.id, user.nickname, 32));
    const online = membersOnline.has(user.id) || you;
    const dot = document.createElement("span");
    dot.className = "member-dot" + (online ? " online" : "");
    avWrap.appendChild(dot);
    row.appendChild(avWrap);

    // Name line
    const main = document.createElement("div");
    main.className = "member-main";
    const name = document.createElement("div");
    name.className = "member-name";
    name.append(document.createTextNode(user.nickname));
    if (!access) name.append(memberTag("NO ACCESS", "no-access", "Their roles don't include Member (or Admin): they can't use channels, DMs or voice"));
    if (user.isBanned) name.append(memberTag("BANNED", "banned", "Banned from this server"));
    if (you) {
        const y = document.createElement("span");
        y.className = "member-you";
        y.textContent = "(you)";
        name.append(y);
    }
    if (user.hasIdentityKey) {
        const lock = document.createElement("i");
        lock.className = "ph-fill ph-lock-simple member-lock";
        lock.title = "Signed identity — key bound";
        name.append(lock);
    }

    // Second line: short id · status
    const sub = document.createElement("div");
    sub.className = "member-sub";
    const room = memberVoiceRoom(user.id);
    let status: string;
    if (you) status = room ? `Online · ${room}` : "Online · this device";
    else if (online) status = room ? `Online · ${room}` : "Online";
    else if (user.lastSeenAt) status = `Last seen ${relativeTime(Date.parse(user.lastSeenAt))}`; // D5 (a)
    else status = "Offline";
    sub.textContent = String(user.id).slice(0, 13);
    const st = document.createElement("span");
    st.textContent = ` · ${status}`;
    sub.appendChild(st);
    sub.title = user.id;
    main.append(name, sub);
    row.appendChild(main);

    // Member / Admin pills
    const pills = document.createElement("div");
    pills.className = "member-pills";
    const lastAdmin = memberIsAdmin(user) && ctx.adminCount <= 1;
    const memberPill = buildRolePill(user, ROLE_MEMBER_ID, "Member", false, you ? "You can't remove your own membership" : null);
    const adminPill = buildRolePill(
        user,
        ROLE_ADMIN_ID,
        "Admin",
        true,
        you ? "You can't remove your own admin role" : lastAdmin ? "The server needs at least one admin" : null,
    );
    if (memberPill) pills.appendChild(memberPill);
    if (adminPill) pills.appendChild(adminPill);
    row.appendChild(pills);

    // ⋮ menu
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "btn btn-icon btn-ghost member-menu-btn";
    menuBtn.title = "Actions";
    menuBtn.setAttribute("aria-label", `Actions for ${user.nickname}`);
    menuBtn.setAttribute("aria-haspopup", "menu");
    menuBtn.innerHTML = '<i class="ph ph-dots-three-vertical" aria-hidden="true"></i>';
    menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const r = menuBtn.getBoundingClientRect();
        openMemberMenu(user, ctx, r.right - 220, r.bottom + 4, menuBtn);
    });
    row.appendChild(menuBtn);
    return row;
}

function memberTag(text: string, kind: string, title: string): HTMLElement {
    const t = document.createElement("span");
    t.className = `member-tag ${kind}`;
    t.textContent = text;
    t.title = title;
    return t;
}

/** One Member/Admin pill; null when the server has no such role. `blockRemoveWhy` stops a removal (not a grant). */
function buildRolePill(user: any, roleId: string, label: string, isAdminPill: boolean, blockRemoveWhy: string | null): HTMLButtonElement | null {
    if (!allServerRoles.some((r) => r.id === roleId)) return null;
    const on = memberHasRole(user, roleId);
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "member-pill" + (isAdminPill ? " admin" : "") + (on ? " on" : "");
    const icon = isAdminPill ? (on ? "ph-shield-star" : "ph-shield") : on ? "ph-user" : "ph-user-minus";
    pill.innerHTML = `<i class="ph ${icon}" aria-hidden="true"></i>`;
    pill.append(document.createTextNode(label));
    if (!isAdminUser) {
        pill.classList.add("readonly");
        pill.title = on ? `Has ${label}` : `No ${label} role`;
        pill.tabIndex = -1;
        return pill;
    }
    if (on && blockRemoveWhy) {
        pill.disabled = true;
        pill.title = blockRemoveWhy;
        return pill;
    }
    pill.title = on ? `Click to remove ${label}` : `Click to grant ${label}`;
    pill.addEventListener("click", async () => {
        pill.disabled = true;
        const res = await api.assignRole(user.id, roleId, on ? "remove" : "add");
        if (!res.success) {
            log(`Failed to ${on ? "remove" : "add"} ${label}: ${res.error}`, "error");
            if (res.error && /permission|denied/i.test(res.error)) SoundAlert.play("insufficient_perms.mp3");
        }
        await refreshMembersPanel();
    });
    return pill;
}

function openMemberMenu(user: any, ctx: { myId: string; iAmAdmin: boolean }, x: number, y: number, anchor: HTMLElement): void {
    const you = user.id === ctx.myId;
    const items: MenuItem[] = [];
    if (ctx.iAmAdmin && user.hasIdentityKey && !you) {
        items.push({
            label: "Reset key…",
            icon: "ph-key",
            onClick: () =>
                // A second menu at the same spot is the confirmation (it disconnects them).
                openMenu(
                    [
                        {
                            label: `Reset ${user.nickname}'s key — disconnects them`,
                            icon: "ph-key",
                            danger: true,
                            onClick: async () => {
                                const res = await api.resetIdentityKey(user.id);
                                if (res.success) log(`Identity key of ${escapeHtml(user.nickname)} reset — their next connection binds a new key`, "success");
                                else log(`Failed to reset identity key: ${escapeHtml(res.error ?? "unknown error")}`, "error");
                                await refreshMembersPanel();
                            },
                        },
                    ],
                    x,
                    y,
                    { anchor },
                ),
        });
    }
    if (ctx.iAmAdmin) {
        items.push({ label: "View identity log", icon: "ph-fingerprint", onClick: () => showIdentityLog({ id: user.id, nickname: user.nickname }) });
    }
    const others = isAdminUser ? allServerRoles.filter((r) => r.id !== ROLE_MEMBER_ID && r.id !== ROLE_ADMIN_ID) : [];
    if (others.length > 0) {
        items.push({ divider: true }, { heading: "Other roles" });
        for (const role of others) {
            const has = memberHasRole(user, role.id);
            items.push({
                label: role.name,
                checked: has,
                onClick: async () => {
                    const res = await api.assignRole(user.id, role.id, has ? "remove" : "add");
                    if (!res.success) log(`Failed to change role: ${res.error}`, "error");
                    await refreshMembersPanel();
                },
            });
        }
    }
    if (canBanUsers && !you) {
        items.push({ divider: true });
        if (user.isBanned) {
            items.push({
                label: "Unban",
                icon: "ph-arrow-counter-clockwise",
                onClick: async () => {
                    const res = await api.unbanUser(user.id);
                    if (res.success) {
                        log(`Unbanned ${escapeHtml(user.nickname)}`, "success");
                        SoundAlert.play("user_unbanned_from_server.mp3");
                    } else {
                        log(`Failed to unban: ${res.error}`, "error");
                        if (res.error && /permission|denied/i.test(res.error)) SoundAlert.play("insufficient_perms.mp3");
                    }
                    await refreshMembersPanel();
                },
            });
        } else {
            items.push({ label: "Ban…", icon: "ph-prohibit", danger: true, onClick: () => openBanDialog({ id: user.id, nickname: user.nickname }) });
        }
    }
    if (items.length === 0) items.push({ label: "No actions available", disabled: true, onClick: () => {} });
    openMenu(items, x, y, { anchor });
}

membersSearch.addEventListener("input", () => renderAdminUsers(membersCache));
document.querySelectorAll<HTMLButtonElement>("#members-filters .seg-opt").forEach((b) => {
    b.addEventListener("click", () => {
        membersFilter = (b.dataset.filter as MembersFilter) ?? "all";
        renderAdminUsers(membersCache);
    });
});
```
   Notes for this code:
   - `createAvatarElement(userId, nickname, size)` exists (search `function createAvatarElement`; confirm the parameter order and fix the call if it differs).
   - `relativeTime(ms)` exists (saved servers use it).
   - `updateSettingsNavCount` is added in M4; if M4 isn't done yet, add M4 step 2's function first.
   - `api.getOnlineUsers()` users are `{ userId, nickname, isOnline }`.

4. **Where the list refreshes.** In `openSettingsPanel()`, where it does `renderAdminUsers(usersRes.users ?? [])`, also fetch online users: change the `Promise.all` to add `api.getOnlineUsers()` as a fifth element and before `renderAdminUsers` set `membersOnline` exactly as in `refreshMembersPanel`. Search the file for every other caller of `openSettingsPanel()` that exists only to refresh the members list (`grep -n "openSettingsPanel(); // refresh\|openSettingsPanel(); //"`) — in the ban dialog's success path, replace with `void refreshMembersPanel();` when the Members page is the active panel.
5. **Reset the search** when Settings opens: in `openSettingsPanel()` add `membersSearch.value = ""; membersFilter = "all";` next to `hideIdentityLog()`.
6. **Live online dots** while the page is open: in the existing `api.on("user-joined"…)` and `api.on("user-left"…)` handlers (search `"user-joined"` / `"user-left"`), add: `if (adminModal.classList.contains("visible") && document.querySelector('.settings-panel[data-settings-panel="roles"].active')) void refreshMembersPanel();`.
7. **Delete the old row CSS only if unused:** `.role-badge`, `.btn-ban`, `.btn-unban`, `.btn-reset-key`, `.user-key-badge`, `.user-no-access-badge`, `.user-banned-badge` — grep `renderer.ts` and `index.html` markup for each class; delete a rule only when nothing else uses it.

8. **Server guard for the two roles** (shared by any client, so it lives on the server):
   - New file `apps/server/src/services/role-guard.ts`:
```ts
/**
 * ASSIGN_ROLE safety rules (PRD 20 M1), pure so they are unit-tested.
 * The Members page makes these one click away; the server is the authority.
 */
export interface RoleChange {
    actorId: string;
    actorIsAdmin: boolean;
    targetId: string;
    action: "add" | "remove";
    /** The role being changed grants ADMIN. */
    roleGrantsAdmin: boolean;
    /** The role being changed is the Member role (role-default). */
    isMemberRole: boolean;
    /** How many users on this server hold an ADMIN-granting role right now (including the target). */
    adminHolderCount: number;
    /** The target currently holds an ADMIN-granting role other than this one. */
    targetHasOtherAdminRole: boolean;
}

export function decideRoleChange(c: RoleChange): { ok: true } | { ok: false; error: string } {
    if (c.roleGrantsAdmin && !c.actorIsAdmin) return { ok: false, error: "Only an admin can change who is an admin" };
    if (c.action === "remove" && c.targetId === c.actorId && c.roleGrantsAdmin) {
        return { ok: false, error: "You can't remove your own admin role" };
    }
    if (c.action === "remove" && c.targetId === c.actorId && c.isMemberRole) {
        return { ok: false, error: "You can't remove your own membership" };
    }
    if (c.action === "remove" && c.roleGrantsAdmin && !c.targetHasOtherAdminRole && c.adminHolderCount <= 1) {
        return { ok: false, error: "The server needs at least one admin" };
    }
    return { ok: true };
}
```
   - In `admin.handler.ts` › `ASSIGN_ROLE`, after the permission check and `const { userId, roleId, action } = payload;`, load what the rule needs and refuse early:
```ts
                const serverId = socket.data.serverId;
                const role = await app.prisma.role.findFirst({ where: { id: roleId, serverId } });
                if (!role) {
                    ack({ success: false, error: "Role not found" });
                    return;
                }
                const adminBit = BigInt(PermissionFlags.ADMIN);
                const roleGrantsAdmin = (role.permissions & adminBit) !== 0n;
                const actorPerms = await getUserPermissions(app.prisma, socket.data.userId, serverId);
                const adminHolders = await app.prisma.userRole.findMany({
                    where: { role: { serverId } },
                    include: { role: { select: { id: true, permissions: true } } },
                });
                const holders = adminHolders.filter((ur) => (ur.role.permissions & adminBit) !== 0n);
                const decision = decideRoleChange({
                    actorId: socket.data.userId,
                    actorIsAdmin: isAdmin(actorPerms),
                    targetId: userId,
                    action,
                    roleGrantsAdmin,
                    isMemberRole: roleId === "role-default",
                    adminHolderCount: new Set(holders.map((h) => h.userId)).size,
                    targetHasOtherAdminRole: holders.some((h) => h.userId === userId && h.role.id !== roleId),
                });
                if (!decision.ok) {
                    ack({ success: false, error: decision.error });
                    return;
                }
```
     Import `getUserPermissions`, `isAdmin` from `../services/permissions.service.js` (check the exact export names with grep) and `decideRoleChange` from `../services/role-guard.js`. Note this also fixes a cross-server hole: the role must belong to the caller's server.
   - New test `apps/server/src/__tests__/role-guard.test.ts` covering: non-admin granting an admin role → refused; admin removing own admin → refused; removing own Member → refused; removing the last admin → refused; removing an admin when another admin exists → ok; target with a second admin role → ok; a non-admin role change by a MANAGE_ROLES holder → ok.

9. **(D5 = a only) Last seen.**
   - `schema.prisma`, model `User`: add `lastSeenAt DateTime?` (with a `///` comment: "When the user's last session on this server ended (PRD 20 M1). Day precision is what the UI shows.").
   - Migration `apps/server/prisma/migrations/<ts>_add_user_last_seen/migration.sql`: `ALTER TABLE "users" ADD COLUMN "lastSeenAt" TIMESTAMP(3);` then `npx prisma generate`.
   - `connection.handler.ts` › `finalizeDisconnect(userId, …)`: after `await presence.leaveServer(userId, serverId);` add
     `void app.prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }).catch(() => {});` (fire-and-forget; `finalizeDisconnect` only runs for the socket that owns the user, after the grace period — do not add it anywhere else).
   - `admin-users.ts`: add `lastSeenAt: Date | null` to `AdminUserRow` and `lastSeenAt: u.lastSeenAt ? u.lastSeenAt.toISOString() : null` to `mapAdminUser`'s result; update `__tests__/admin-users.test.ts` fixtures.
   - `socket-events.ts` › `GET_ALL_USERS` user type: add `lastSeenAt?: string | null`.

**Verify:**
1. Server: `npm run test` (role-guard tests pass), `npx tsc --noEmit`.
2. Client with ~20 members (bots), screenshot next to `5a.png`.
3. Search "bea" → only matching rows; search a 6-char id fragment → that row; "No members match" for nonsense.
4. Each filter's count matches its rows; "No access" lists a user after removing their Member pill; giving it back clears the tag and that user can open a channel again **without reconnecting** (PRD 18.18 path).
5. Your own Admin pill and Member pill are disabled with their tooltips. As the only admin, try to remove your own admin via CDP `api.assignRole(myId, "role-admin", "remove")` → refused by the server with "You can't remove your own admin role".
6. A MANAGE_ROLES-only holder (role without ADMIN): Admin pill click → server refuses "Only an admin can change who is an admin" (log shows it).
7. ⋮ → Reset key… → confirm item → the user is disconnected and the lock disappears after they reconnect unsigned. View identity log opens the log filtered to that user. Ban… opens the ban dialog; Unban appears on a banned row.
8. Online dot and "Online · {room}" for a bot in voice; Offline for an absent user (D5 b) or "Last seen just now" after a bot disconnects and the grace period passes (D5 a).

**Done when:** all pass; logged; committed `feat: Members search, filters, role pills and role guard (PRD 20 M1)`.

---

### M2 — Bans: a list of banned people

**Today:** the Bans page shows only `#banned-addresses-section` and a note pointing at Members.
**Target (mockup "BANS" section, Appendix A §A4):** a card of banned people — prohibit icon (`--color-danger`), name, the linked address chip (monospace, masked for non-admins), a meta line "Banned by {name} · {relative time}", and **Unban** (secondary button). Empty: a dashed box "Nobody is banned. Ban someone from the ⋮ menu in Members." Address bans stay below under their existing title.

**Steps:**
1. **Schema + migration:** model `BannedUser` add `bannedByNickname String?`; migration `<ts>_add_banned_by/migration.sql`: `ALTER TABLE "banned_users" ADD COLUMN "bannedByNickname" TEXT;`; `npx prisma generate`.
2. **Write it:** `ban.service.ts` › `ExecuteBanInput.actor` gains `nickname?: string`; in the `bannedUser.upsert` `create` add `bannedByNickname: actor.nickname ?? null`. In `moderation.handler.ts` and `approval.handler.ts`, where `actor: { … }` is built, add `nickname: socket.data.nickname`.
3. **Shared-types:** `IBannedUser` add `bannedByNickname?: string | null;` and `address?: string | null;` (doc: "the address ban made together with this user ban, masked for non-admins").
4. **Read it:** `moderation.handler.ts` › `GET_BANNED_USERS`: after loading `banned`, load linked address bans and the caller's admin flag, then map:
```ts
                const perms = await getUserPermissions(app.prisma, socket.data.userId, serverId);
                const full = isAdmin(perms);
                const linked = await app.prisma.bannedAddress.findMany({
                    where: { serverId, linkedUserId: { in: banned.map((b) => b.userId) } },
                    select: { linkedUserId: true, cidr: true },
                });
                const addressOf = new Map(linked.map((l) => [l.linkedUserId, full ? l.cidr : maskCidr(l.cidr)]));
                const users = banned.map((b) => ({
                    userId: b.userId,
                    nickname: b.nickname,
                    bannedAt: b.bannedAt.toISOString(),
                    bannedByNickname: b.bannedByNickname ?? null,
                    address: addressOf.get(b.userId) ?? null,
                }));
```
   (`maskCidr`, `getUserPermissions`, `isAdmin` are already imported in this file for `GET_BANNED_ADDRESSES` — verify.)
5. **Client types:** in `interface Reson8Api`, extend `getBannedUsers()`'s user type with `bannedByNickname?: string | null; address?: string | null`.
6. **Markup:** in the Bans panel, replace the `<p class="settings-note bans-note">…</p>` with:
```html
        <section class="settings-section">
          <div class="section-label">Banned people</div>
          <div id="banned-users-list" class="members-list"></div>
        </section>
```
7. **Renderer:** add `async function renderBannedUsers(): Promise<void>` next to `renderBannedAddresses()`: call `api.getBannedUsers()`; on failure or for non-BAN_USER callers leave the list empty and return; if 0 → one `.bans-empty` div with the empty text; else one `.member-row` per user: `<i class="ph ph-prohibit ban-row-icon">`, a `.member-main` with `.member-name` (nickname + an optional `.ban-address` chip with `textContent = address`) and `.member-sub` (`Banned${bannedByNickname ? ` by ${bannedByNickname}` : ""} · ${relativeTime(Date.parse(bannedAt))}` — set on a `<span>` so it's not monospace), and a `btn btn-secondary` "Unban" whose click runs the same unban code as M1's menu, then `void renderBannedUsers(); void renderBannedAddresses(); void refreshMembersPanel();`. Call `renderBannedUsers()` from `openSettingsPanel()` right after `renderBannedAddresses()`, and after a successful ban (in the ban dialog's success path).
8. **CSS:**
```css
    .ban-row-icon {
      font-size: 18px;
      color: var(--color-danger);
    }

    .ban-address {
      padding: 0 6px;
      border-radius: var(--radius-sm);
      font: 11.5px/18px ui-monospace, Menlo, monospace;
      color: var(--color-neutral-300);
      background: color-mix(in srgb, var(--color-text) 6%, transparent);
    }

    .bans-empty {
      padding: 16px;
      border: 1px dashed var(--color-neutral-700);
      border-radius: var(--radius-lg);
      font-size: 13px;
      color: var(--color-neutral-500);
    }
```
**Verify:** ban a bot with "also ban the address (exact)" → the row shows its name, the address (full as ADMIN; `x.x.x.x`-masked as a BAN_USER-only moderator), "Banned by {you} · just now"; Unban → row gone, the address ban gone too, the Members row loses BANNED; a ban made before this change shows "Banned · …" without a name; empty state when nobody is banned. Server tests + typecheck. Commit `feat: banned people list with who banned and the linked address (PRD 20 M2)`.

---

### M3 — Emoji: Approve all and the library

**Frame:** `5e.png`. **Today:** `renderPendingEmojis()` lists pending emoji with Approve/Reject buttons; there is no way to remove an approved emoji.
**Target (Appendix A §A5):** "REQUESTS · {n}" header with **Approve all** (ghost button, right); request rows (40 px image, `:name:` monospace, "Requested by {name}", **Reject** ghost + **Approve** primary with `ph-check`); empty state "All caught up — no emoji waiting for review."; "ON THIS SERVER · {n}" + a grid (`repeat(auto-fill, minmax(120px, 1fr))`) of approved emoji cards (36 px image, `:name:`, **Remove** ghost button).

**Server (shared-types first):**
1. `socket-events.ts` › `ClientToServerEvents`: 
```ts
    /** Removes an APPROVED custom emoji (MANAGE_EMOJIS) (PRD 20 M3). Messages that used it show `:name:` as text. */
    DELETE_CUSTOM_EMOJI: (
        payload: { emojiId: string },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;
```
   `ServerToClientEvents`: `CUSTOM_EMOJI_REMOVED: (payload: { serverId: string; emojiId: string }) => void;`
2. `access.service.ts` › `EVENT_ACCESS`: `DELETE_CUSTOM_EMOJI: "open", // MANAGE_EMOJIS (PRD 20 M3)` next to `REVIEW_CUSTOM_EMOJI`.
3. `emoji.handler.ts`: add the handler (after `REVIEW_CUSTOM_EMOJI`):
```ts
        // ── DELETE_CUSTOM_EMOJI (PRD 20 M3) ──────────────────────────────────
        socket.on("DELETE_CUSTOM_EMOJI", async (payload, ack) => {
            try {
                const allowed = await requirePermission(app, socket, BigInt(PermissionFlags.MANAGE_EMOJIS));
                if (!allowed) {
                    ack({ success: false, error: "Permission denied" });
                    return;
                }
                const emojiId = payload?.emojiId;
                if (typeof emojiId !== "string" || emojiId.length === 0 || emojiId.length > 64) {
                    ack({ success: false, error: "Invalid emoji" });
                    return;
                }
                const serverId = socket.data.serverId;
                const emoji = await app.prisma.customEmoji.findUnique({ where: { id: emojiId } });
                if (!emoji || emoji.serverId !== serverId || emoji.status !== "APPROVED") {
                    ack({ success: false, error: "Emoji not found" });
                    return;
                }
                // Row first, then release its file via the ledger (never a URL from the client).
                await app.prisma.customEmoji.delete({ where: { id: emojiId } });
                ack({ success: true });
                io.to(`server:${serverId}`).emit("CUSTOM_EMOJI_REMOVED", { serverId, emojiId });
                releaseStoredFile(app.prisma, emoji.imageUrl).catch((err) =>
                    app.log.warn({ err, emojiId }, "Failed to release a removed emoji's file"),
                );
                app.log.info({ socketId: socket.id, emojiId, name: emoji.name }, "Custom emoji removed");
            } catch (err) {
                app.log.error({ err }, "Error in DELETE_CUSTOM_EMOJI");
                ack({ success: false, error: "Failed to remove emoji" });
            }
        });
```
   Update the file's header comment ("Handles: …") to list it. (Note: `releaseStoredFile` already checks references, so a file still used elsewhere is kept.)
4. No vitest is required for a thin handler; the access-classification test picks the new event up automatically — run `npm run test` to confirm it passes.

**Client:**
5. `preload.ts`: next to `reviewCustomEmoji`, add `deleteCustomEmoji(emojiId: string): Promise<{ success: boolean; error?: string }>` (same shape: emit `DELETE_CUSTOM_EMOJI` with `{ emojiId }`, resolve with the ack; "Not connected" when there is no socket). Next to the `CUSTOM_EMOJI_APPROVED` listener: `socket.on("CUSTOM_EMOJI_REMOVED", (payload) => emit("custom-emoji-removed", payload));`. Add the method to `interface Reson8Api` in `renderer.ts`.
6. `renderer.ts`, next to `api.on("custom-emoji-approved", …)`:
```ts
api.on("custom-emoji-removed", (data: { serverId: string; emojiId: string }) => {
    const before = customEmojis.length;
    customEmojis = customEmojis.filter((e) => e.id !== data.emojiId);
    if (customEmojis.length !== before) api.setCustomEmojis(customEmojis);
    if (emojiPicker.classList.contains("visible")) renderEmojiGrid(emojiSearch.value);
    renderEmojiLibrary(); // M3: the settings page, if open
});
```
   (Check `customEmojis` is a `let`; it is reassigned elsewhere — `grep -n "customEmojis =" renderer.ts`.) In the `custom-emoji-approved` handler add `renderEmojiLibrary();` as the last line.
7. **Markup** — replace the Emoji panel's list with:
```html
        <section class="settings-section">
          <div class="emoji-section-head"><div class="section-label" id="emoji-requests-label">Requests</div><button type="button" class="btn btn-ghost" id="btn-emoji-approve-all" style="display:none;">Approve all</button></div>
          <div id="emoji-pending-list" class="members-list"></div>
        </section>
        <section class="settings-section">
          <div class="section-label" id="emoji-library-label">On this server</div>
          <div id="emoji-library" class="emoji-library"></div>
        </section>
```
   Update the page subtitle to "Review custom emoji before members can use them." (frame 5e).
8. **Rewrite `renderPendingEmojis(emojis)`** to build `.member-row`s (`<img class="emoji-req-img" src=… alt="">` set via `.src`/`.alt` properties, never `innerHTML` with the name; name line `:name:` in a `.emoji-code` span via `textContent`; sub "Requested by {uploadedByNickname ?? "Unknown"}"; buttons `btn btn-ghost` "Reject" and `btn btn-primary` with `<i class="ph ph-check"></i>` + "Approve"). Keep the existing approve/reject code paths. It also sets `#emoji-requests-label` text to `Requests · ${n}`, shows `#btn-emoji-approve-all` only when n > 1, renders the empty state "All caught up — no emoji waiting for review." in a `.bans-empty` box when n = 0, keeps `pendingEmojiQueue = emojis` (new module `let`), and calls `updateSettingsNavCount("emojis", n)` (M4). After every approve/reject, remove the row, decrement and re-run the label/count code.
9. **Approve all:**
```ts
let pendingEmojiQueue: CustomEmoji[] = [];
document.getElementById("btn-emoji-approve-all")!.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    let approved = 0;
    for (const emoji of [...pendingEmojiQueue]) {
        const res = await api.reviewCustomEmoji(emoji.id, "APPROVED");
        if (!res.success) {
            showToast(`Approved ${approved}; stopped at :${escapeHtml(emoji.name)}: — ${escapeHtml(res.error ?? "refused")}`);
            break;
        }
        approved++;
    }
    btn.disabled = false;
    const res = await api.getPendingEmojis();
    renderPendingEmojis(res.emojis ?? []);
});
```
10. **Library:**
```ts
/** "On this server": every approved emoji with Remove (PRD 20 M3). Two clicks: Remove → Confirm (4 s). */
function renderEmojiLibrary(): void {
    const grid = document.getElementById("emoji-library");
    const label = document.getElementById("emoji-library-label");
    if (!grid || !label) return;
    label.textContent = `On this server · ${customEmojis.length}`;
    grid.textContent = "";
    if (customEmojis.length === 0) {
        const empty = document.createElement("div");
        empty.className = "bans-empty";
        empty.textContent = "No custom emoji yet.";
        grid.appendChild(empty);
        return;
    }
    for (const emoji of [...customEmojis].sort((a, b) => a.name.localeCompare(b.name))) {
        const card = document.createElement("div");
        card.className = "emoji-lib-card";
        const img = document.createElement("img");
        img.src = emoji.imageUrl;
        img.alt = "";
        const code = document.createElement("span");
        code.className = "emoji-code";
        code.textContent = `:${emoji.name}:`;
        code.title = `:${emoji.name}:`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn btn-ghost emoji-lib-remove";
        remove.textContent = "Remove";
        let armedUntil = 0;
        remove.addEventListener("click", async () => {
            if (Date.now() > armedUntil) {
                armedUntil = Date.now() + 4000;
                remove.textContent = "Confirm";
                remove.classList.add("armed");
                setTimeout(() => {
                    if (Date.now() >= armedUntil) {
                        remove.textContent = "Remove";
                        remove.classList.remove("armed");
                    }
                }, 4000);
                return;
            }
            remove.disabled = true;
            const res = await api.deleteCustomEmoji(emoji.id);
            if (!res.success) {
                remove.disabled = false;
                log(`Failed to remove :${escapeHtml(emoji.name)}:: ${escapeHtml(res.error ?? "unknown error")}`, "error");
            }
            // Success: the CUSTOM_EMOJI_REMOVED broadcast re-renders the grid.
        });
        card.append(img, code);
        if (canManageEmojis) card.appendChild(remove);
        grid.appendChild(card);
    }
}
```
    Call `renderEmojiLibrary()` from `openSettingsPanel()` where `renderPendingEmojis` is called.
11. **CSS:**
```css
    .emoji-section-head {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 12px;
    }

    .emoji-req-img {
      width: 40px;
      height: 40px;
      flex: none;
      object-fit: contain;
      border-radius: var(--radius-md);
      background: var(--color-neutral-900);
    }

    .emoji-code {
      font: 500 14px ui-monospace, Menlo, monospace;
    }

    .emoji-library {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 8px;
    }

    .emoji-lib-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 12px 8px 10px;
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--color-bg) 35%, transparent);
      box-shadow: var(--shadow-sm);
    }

    .emoji-lib-card img {
      width: 36px;
      height: 36px;
      object-fit: contain;
    }

    .emoji-lib-card .emoji-code {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      font-weight: 400;
      color: var(--color-neutral-300);
    }

    .emoji-lib-remove {
      height: 24px;
      padding: 0 8px;
      font-size: 12px;
      color: var(--color-neutral-500);
    }

    .emoji-lib-remove.armed {
      color: var(--color-danger-text);
    }
```
**Verify:** submit 3 emoji as a member; as admin the page shows "Requests · 3" + Approve all → all three approved, appear in "On this server · 3", and in a second client's picker live. Remove → Confirm → gone from the grid and from the second client's picker without reload; a message that used it renders `:name:` as text. A member (no MANAGE_EMOJIS) calling `api.deleteCustomEmoji(id)` over CDP gets "Permission denied". Screenshot next to `5e.png`. Commit `feat: emoji approve-all and the server library with remove (PRD 20 M3)`.

---

### M4 — Counts in the server settings nav

**Frames:** `5a`–`5f` (Members 22, Emoji 6 in the left nav).
**Steps:**
1. CSS: `.settings-tab-btn .count-pill { margin-left: auto; }` (the button is a flex row; check `.settings-tab-btn` has `display: flex` — add `display:flex; align-items:center; gap:…` only if missing).
2. Renderer, near `applySettingsTabVisibility`:
```ts
/** A count pill on a settings nav item (PRD 20 M4); 0 hides it unless `showZero`. */
function updateSettingsNavCount(tab: "roles" | "emojis", n: number, showZero = tab === "roles"): void {
    const btn = document.querySelector(`.settings-tab-btn[data-settings-tab="${tab}"]`);
    if (!btn) return;
    let pill = btn.querySelector<HTMLElement>(".nav-count");
    if (!pill) {
        pill = document.createElement("span");
        pill.className = "count-pill nav-count";
        btn.appendChild(pill);
    }
    pill.textContent = n > 99 ? "99+" : String(n);
    pill.style.display = n > 0 || showZero ? "" : "none";
}
```
3. Called by M1 (`renderAdminUsers`) and M3 (`renderPendingEmojis`). The Joining & invites item keeps its existing `#pending-badge-tab`. On disconnect, call `updateSettingsNavCount("roles", 0, false)` and `updateSettingsNavCount("emojis", 0)` in the `disconnected` handler.
**Verify:** screenshot of the server nav next to `5a.png`: Members {n}, Emoji {n} (only when > 0). Commit `feat: member and emoji counts in the server settings nav (PRD 20 M4)`.

---

## P4 — Welcome and chat

### W1 — Saved-server latency and "Offline"

**Frame:** `2b.png` — each saved row shows "Last connected …" and, under it, "18 ms" (green) or "Offline".
**Today:** `renderSavedServers()` draws `.saved-row-meta` with "as {nickname}" and "Last connected …". The server has `GET /health` → `{ status: "ok", uptime }` (`apps/server/src/index.ts`).

**Decisions already made:**
- The probe runs in the **main process** through `session.defaultSession.fetch`, so the pinned-certificate verifier (`setCertificateVerifyProc`) applies: a pinned self-signed server probes fine, a changed certificate fails (→ Offline).
- Scheme: the address's explicit scheme; otherwise **https if this host:port was ever reached over HTTPS or has a pin**, else http (the same memory `decideScheme` uses). Ports: explicit, else 443 for https / 80 for http.
- Only while the welcome screen shows (not connected, no connect in progress); every saved row; at most one probe per address per 60 s (main-side cache); 3 s timeout; nothing but a `GET /health` — no identity, no nickname, no cookies.
- Thresholds/colours match the status bar: ≤ 80 ms `--color-success`, ≤ 150 ms `--color-warning-text`, else `--color-danger-text`; "Offline" in `--color-neutral-500`.

**Steps:**
1. **Pure helper** `apps/client/src/server-health.ts` (Electron-free, so it can be smoke-tested):
```ts
/**
 * Saved-server latency probe (PRD 20 W1) — the pure half: which URL to ask.
 * The main process does the request through the default session.
 */
import { parseServerAddress, hostKey } from "./tls-trust";

export function healthProbeUrl(
    address: string,
    knowsHttps: (hostKey: string) => boolean,
): string | null {
    const parsed = parseServerAddress(address);
    if (!parsed.ok) return null;
    const { scheme, host, port } = parsed.value;
    const httpsKey = hostKey(host, port ?? 443);
    const useHttps = scheme === "https" || (scheme === null && knowsHttps(httpsKey));
    const finalScheme = useHttps ? "https" : "http";
    const h = host.includes(":") ? `[${host}]` : host;
    const p = port ?? (useHttps ? 443 : 80);
    const defaultPort = useHttps ? 443 : 80;
    return `${finalScheme}://${h}${p === defaultPort ? "" : `:${p}`}/health`;
}
```
2. **Smoke test** `apps/client/scripts/server-health-smoke.mjs` (copy the structure of `scripts/tls-trust-smoke.mjs`): `127.0.0.1:9800` + knows nothing → `http://127.0.0.1:9800/health`; `chat.example.com` + knows `chat.example.com:443` → `https://chat.example.com/health`; `https://x.y:8443` → `https://x.y:8443/health`; `http://x.y` → `http://x.y/health`; `[::1]:9800` → `http://[::1]:9800/health`; `bad address with space` → `null`. Add `"test:server-health": "tsc --build && node scripts/server-health-smoke.mjs"` to `apps/client/package.json` scripts.
3. **Main** (`main.ts`, near the other `ipcMain.handle` calls for TLS):
```ts
    // ── Saved-server latency (PRD 20 W1) ─────────────────────────────────
    const healthCache = new Map<string, { at: number; ms: number | null }>();
    ipcMain.handle("probe-server-latency", async (_event, address: unknown) => {
        if (typeof address !== "string" || address.length === 0 || address.length > 300) return { ms: null };
        const cached = healthCache.get(address);
        if (cached && Date.now() - cached.at < 60_000) return { ms: cached.ms };
        const store = getTlsStore();
        const url = healthProbeUrl(address, (key) => store.isHttpsRemembered(key) || store.getPin(key) !== null);
        let ms: number | null = null;
        if (url) {
            const started = performance.now();
            try {
                const res = await session.defaultSession.fetch(url, {
                    signal: AbortSignal.timeout(3000),
                    cache: "no-store",
                    redirect: "error",
                    credentials: "omit",
                });
                const body = res.ok ? await res.json().catch(() => null) : null;
                if (body && body.status === "ok") ms = Math.max(1, Math.round(performance.now() - started));
            } catch {
                ms = null;
            }
        }
        healthCache.set(address, { at: Date.now(), ms });
        if (healthCache.size > 100) healthCache.delete(healthCache.keys().next().value!);
        return { ms };
    });
```
   Import `healthProbeUrl` from `./server-health`. If `redirect: "error"` is rejected by Electron's `session.fetch` typings, use `"manual"` and treat any 3xx as offline.
4. **Preload:** `probeServerLatency(address: string): Promise<{ ms: number | null }>` → `ipcRenderer.invoke("probe-server-latency", address)`. Add to `interface Reson8Api`.
5. **Renderer — row markup.** In `renderSavedServers()`, change the meta block to:
```ts
        const meta = document.createElement("div");
        meta.className = "saved-row-meta";
        const metaWhen = document.createElement("div");
        metaWhen.textContent = `as ${entry.nickname} · Last connected ${relativeTime(entry.lastConnected)}`;
        const metaPing = document.createElement("div");
        metaPing.className = "saved-row-ping";
        metaPing.dataset.address = entry.address;
        const known = savedLatency.get(entry.address);
        paintSavedPing(metaPing, known);
        meta.append(metaWhen, metaPing);
```
6. **Renderer — probing.** Put this block **directly above `function renderSavedServers`** — `initSavedServers()` runs at startup and calls `renderSavedServers()`, which reads `savedLatency`; declaring it lower crashes the app on launch (Handbook rule 8):
```ts
/** Last probe result per saved address (PRD 20 W1): number = ms, null = offline, undefined = not yet. */
const savedLatency = new Map<string, number | null>();
let savedProbeTimer: ReturnType<typeof setInterval> | null = null;

function paintSavedPing(el: HTMLElement, value: number | null | undefined): void {
    el.classList.remove("good", "warn", "bad", "offline");
    if (value === undefined) {
        el.textContent = "";
        return;
    }
    if (value === null) {
        el.textContent = "Offline";
        el.classList.add("offline");
        return;
    }
    el.textContent = `${value} ms`;
    el.classList.add(value <= 80 ? "good" : value <= 150 ? "warn" : "bad");
}

function probeSavedServers(): void {
    if (isConnected || connectInProgress) return;
    for (const entry of savedServers) {
        void api.probeServerLatency(entry.address).then(({ ms }) => {
            savedLatency.set(entry.address, ms);
            document.querySelectorAll<HTMLElement>(".saved-row-ping").forEach((el) => {
                if (el.dataset.address === entry.address) paintSavedPing(el, ms);
            });
        });
    }
}

/** Probes now and every 60 s while the welcome screen is up; stops once connected. */
function startSavedServerProbes(): void {
    probeSavedServers();
    if (savedProbeTimer === null) savedProbeTimer = setInterval(probeSavedServers, 60_000);
}

function stopSavedServerProbes(): void {
    if (savedProbeTimer !== null) clearInterval(savedProbeTimer);
    savedProbeTimer = null;
}
```
   Call `startSavedServerProbes()` at startup after the first `renderSavedServers()` and in the `disconnected` handler; call `stopSavedServerProbes()` in the `connected` handler. (`probeSavedServers` itself also refuses while connecting.) Compare `el.dataset.address === entry.address` instead of building a CSS selector from the address (addresses contain `:` and `[`).
7. **CSS:**
```css
    .saved-row-ping {
      font-size: 11.5px;
      font-variant-numeric: tabular-nums;
    }

    .saved-row-ping.good { color: var(--color-success); }
    .saved-row-ping.warn { color: var(--color-warning-text); }
    .saved-row-ping.bad { color: var(--color-danger-text); }
    .saved-row-ping.offline { color: var(--color-neutral-500); }
```
   Check the `.saved-row-meta` container query still wraps under the name below 560 px.

**Verify:** `npm run test:server-health`; with 9800 running and a saved `127.0.0.1:9999` (nothing listening): rows show "{n} ms" (green) and "Offline" within ~3 s; stop the 9800 server → "Offline" within 60 s; connect → no more `/health` requests in the server log; disconnect → probing resumes. Screenshot next to `2b.png`. Commit `feat: latency or Offline on saved servers (PRD 20 W1)`.

---

### W2 — Typing indicator

**Needs D4.** **Frame:** `1a.png` ("Kdshy is typing…" under the composer).
**Target:** under the input bar, an 18 px line (11.5 px, `--color-neutral-500`, padding `4px 10px 0`): "{name} is typing…", "{a} and {b} are typing…", "Several people are typing…" (3+). Only for the **active** tab. An entry expires 5 s after the last signal, or at once when that person's message arrives in that conversation.

**Server (shared-types first):**
1. `socket-events.ts`:
   - `ClientToServerEvents`: 
```ts
    /** "I'm typing" in a text channel or a DM (PRD 20 W2). Fire-and-forget; the server throttles. */
    TYPING: (payload: { channelId?: string; dmPartnerId?: string }) => void;
```
   - `ServerToClientEvents`: 
```ts
    /** Someone is typing (PRD 20 W2). `channelId` for a channel; absent = a DM from `userId`. */
    USER_TYPING: (payload: { userId: string; nickname: string; channelId?: string }) => void;
```
2. `EVENT_ACCESS`: `TYPING: "member",` under "Text channels".
3. Pure service `apps/server/src/services/typing.service.ts`:
```ts
/** Typing signals (PRD 20 W2) — validation and the per-socket throttle, pure for tests. */
export const TYPING_MIN_INTERVAL_MS = 2500;

export type TypingTarget = { kind: "channel"; channelId: string } | { kind: "dm"; partnerId: string };

export function parseTypingPayload(p: unknown): TypingTarget | null {
    if (!p || typeof p !== "object") return null;
    const o = p as Record<string, unknown>;
    const ok = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
    if (ok(o.channelId) && o.dmPartnerId === undefined) return { kind: "channel", channelId: o.channelId };
    if (ok(o.dmPartnerId) && o.channelId === undefined) return { kind: "dm", partnerId: o.dmPartnerId };
    return null;
}

/** True when this signal may be relayed; `last` is the socket's previous relay time for the same target key. */
export function shouldRelayTyping(last: number | undefined, now: number): boolean {
    return last === undefined || now - last >= TYPING_MIN_INTERVAL_MS;
}
```
   Test `__tests__/typing.service.test.ts`: both ids → null; neither → null; 65-char id → null; non-object → null; throttle: undefined → true, 1000 ms → false, 2500 ms → true.
4. Handler `apps/server/src/handlers/typing.handler.ts` (register it in `index.ts` next to the others: `registerTypingHandlers(io, app);`):
```ts
/**
 * Typing Handler (PRD 20 W2) — relays "is typing" signals. Never stored.
 * Handles: TYPING.
 */
import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from "@reson8/shared-types";
import { parseTypingPayload, shouldRelayTyping } from "../services/typing.service.js";
import { membersRoom } from "../services/access-change.js";

type TypedIO = SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function registerTypingHandlers(io: TypedIO, app: FastifyInstance): void {
    io.on("connection", (socket: TypedSocket) => {
        const lastRelay = new Map<string, number>();
        socket.on("TYPING", async (payload) => {
            try {
                if (socket.data.role === "viewer") return;
                const target = parseTypingPayload(payload);
                if (!target) return;
                const key = target.kind === "channel" ? `c:${target.channelId}` : `d:${target.partnerId}`;
                const now = Date.now();
                if (!shouldRelayTyping(lastRelay.get(key), now)) return;
                lastRelay.set(key, now);
                if (lastRelay.size > 50) lastRelay.delete(lastRelay.keys().next().value!);
                const serverId = socket.data.serverId;
                const from = { userId: socket.data.userId, nickname: socket.data.nickname };
                if (target.kind === "channel") {
                    const ch = await app.prisma.channel.findUnique({ where: { id: target.channelId }, select: { serverId: true, type: true } });
                    if (!ch || ch.serverId !== serverId || ch.type !== "TEXT") return;
                    socket.to(membersRoom(serverId)).emit("USER_TYPING", { ...from, channelId: target.channelId });
                } else {
                    if (target.partnerId === socket.data.userId) return;
                    for (const [, s] of io.sockets.sockets) {
                        if (s.data.userId === target.partnerId && s.data.serverId === serverId && s.data.role !== "viewer") {
                            s.emit("USER_TYPING", from);
                        }
                    }
                }
            } catch (err) {
                app.log.warn({ err }, "Error in TYPING");
            }
        });
    });
}
```
   Check the `channel.type` enum value spelling (`"TEXT"`) in `schema.prisma`. The packet guard already refuses this before sign-in and without access.

**Client:**
5. Preload: `sendTyping(target: { channelId?: string; dmPartnerId?: string }): void` → `socket?.connected && socket.emit("TYPING", target)`; listener `socket.on("USER_TYPING", (p) => emit("user-typing", p));`. Add to `interface Reson8Api`.
6. Markup: after `#chat-input-bar` inside `#chat-composer` add `<div id="typing-indicator" aria-live="polite"></div>`; CSS `#typing-indicator { height: 18px; padding: 4px 10px 0; font-size: 11.5px; color: var(--color-neutral-500); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`.
7. Renderer. `switchTab()` (which calls `renderTypingIndicator()`) can run during startup, so put the **state lines** (`TYPING_PREF_KEY`, `typingIndicator`, `typingByTab`, `lastTypingSent`) near the top of the file, next to the emoji-autocomplete element refs (search the comment that says `switchTab()` calls into it during startup); the functions, the `api.on` listener and the interval can go anywhere:
```ts
// ── Typing indicator (PRD 20 W2) ─────────────────────────────────────────────
const TYPING_PREF_KEY = "reson8-send-typing"; // D4 (a): "Show others when I'm typing"
const typingIndicator = document.getElementById("typing-indicator") as HTMLDivElement;
/** tab id (channel id or "dm:<userId>") → userId → { nickname, expires } */
const typingByTab = new Map<string, Map<string, { nickname: string; expires: number }>>();
let lastTypingSent = { key: "", at: 0 };

function sendTypingEnabled(): boolean {
    try {
        return localStorage.getItem(TYPING_PREF_KEY) !== "false";
    } catch {
        return true;
    }
}

function maybeSendTyping(): void {
    if (!sendTypingEnabled() || !chatInput.value.trim()) return;
    const tab = activeTabId;
    if (tab === "server-log" || tab === VOICE_TAB_ID) return;
    const target = tab.startsWith("dm:") ? { dmPartnerId: tab.slice(3) } : chatTabs.has(tab) ? { channelId: tab } : null;
    if (!target) return;
    const now = Date.now();
    if (lastTypingSent.key === tab && now - lastTypingSent.at < 3000) return;
    lastTypingSent = { key: tab, at: now };
    api.sendTyping(target);
}

function renderTypingIndicator(): void {
    const now = Date.now();
    const entries = typingByTab.get(activeTabId);
    const names: string[] = [];
    if (entries) {
        for (const [userId, e] of entries) {
            if (e.expires <= now) entries.delete(userId);
            else names.push(e.nickname);
        }
    }
    typingIndicator.textContent =
        names.length === 0 ? "" : names.length === 1 ? `${names[0]} is typing…` : names.length === 2 ? `${names[0]} and ${names[1]} are typing…` : "Several people are typing…";
}

function clearTyping(tabId: string, userId: string): void {
    typingByTab.get(tabId)?.delete(userId);
    if (tabId === activeTabId) renderTypingIndicator();
}

api.on("user-typing", (p: { userId: string; nickname: string; channelId?: string }) => {
    if (p.userId === api.getInstanceId()) return;
    const tabId = p.channelId ?? `dm:${p.userId}`;
    let entries = typingByTab.get(tabId);
    if (!entries) typingByTab.set(tabId, (entries = new Map()));
    entries.set(p.userId, { nickname: p.nickname, expires: Date.now() + 5000 });
    if (tabId === activeTabId) renderTypingIndicator();
});

setInterval(() => {
    if (typingByTab.size > 0) renderTypingIndicator();
}, 1000);
```
   Wire-up: in the `chatInput` `"input"` listener add `maybeSendTyping();` (keep `autosizeChatInput`); in `sendChatMessage()` after a successful send set `lastTypingSent = { key: "", at: 0 };`; in `switchTab()` call `renderTypingIndicator();`; in `api.on("message", (msg) => …)` call `clearTyping(msg.channelId, msg.userId)` (check the ChatMessage field names: `channelId`, `userId`/`authorId`); in `api.on("dm-received", …)` call `clearTyping(\`dm:${msg.senderId}\`, msg.senderId)`; on disconnect `typingByTab.clear(); renderTypingIndicator();`.
8. **(D4 a only)** In Privacy & safety, a toggle row "Show others when I'm typing" / "People in the same channel or DM see “{you} is typing…”." with `#chk-send-typing` bound to `reson8-send-typing` (default on). Use the existing `.toggle-row` + `.toggle-switch` markup of that page.

**Verify:** two clients in one channel: A types → B sees "A is typing…" within 1 s, gone 5 s after A stops or as soon as A's message arrives; three typers → "Several people are typing…"; DM works and only the partner sees it; a restricted user (no Member) sends nothing (server drops it); with the switch off nothing is sent (server log / B sees nothing); holding a key for 20 s sends ≤ 7 signals. Server tests. Commit `feat: typing indicator (PRD 20 W2)`.

---

## P5 — Dialogs

### S1 — Share picker: Screens | Windows tabs

**Frame:** `1k.png`. **Today:** `openScreenShareModal()` renders two labelled groups (`renderSourceShareGroup("Screens"…)`, `("Application Windows"…)`) into `#source-share-groups`; the Share Audio row is a plain checkbox; there's no "Others will see" line.
**Target (Appendix A §A6):** 740 px dialog; title + "Everyone in {room} will be able to watch." + × button; a segmented control **Screens {n} | Windows {n}** (`ph-monitor`, `ph-app-window`); ONE 3-column grid of cards (16:10 thumbnail, bottom row: app icon or Phosphor icon, name, sub-line = process name, "Screen" or "Window"; the selected card has a 2 px accent ring and a check badge); the Share audio card (speaker icon, "Share audio", sub-line, a switch); "Stream name · optional"; footer: "Others will see: {name}" left, Cancel / Start sharing right.

**Steps:**
1. **Markup:** replace `#screen-share-modal`'s inner `.modal-content` with:
```html
    <div class="modal-content dialog share-picker">
      <div class="share-picker-head">
        <div><h3 class="dialog-title">Share your screen</h3><p class="dialog-subtitle" id="screen-share-sub">Everyone in your voice room will be able to watch.</p></div>
        <button type="button" class="btn btn-ghost btn-icon" id="btn-screen-share-close" aria-label="Close"><i class="ph ph-x" aria-hidden="true"></i></button>
      </div>
      <div class="seg" id="source-share-tabs" role="tablist">
        <button type="button" class="seg-opt active" data-source-tab="screen" role="tab"><i class="ph ph-monitor" aria-hidden="true"></i>Screens<span class="seg-count"></span></button>
        <button type="button" class="seg-opt" data-source-tab="window" role="tab"><i class="ph ph-app-window" aria-hidden="true"></i>Windows<span class="seg-count"></span></button>
      </div>
      <div class="source-share-grid" id="source-share-groups"><div class="source-share-empty" id="source-share-status">Loading sources…</div></div>
      <label class="share-audio-card" for="source-share-audio-checkbox">
        <i class="ph ph-speaker-high" aria-hidden="true"></i>
        <span class="share-audio-text"><span class="share-audio-title">Share audio</span><span class="share-audio-sub" id="source-share-audio-desc">Pick a window to share its sound</span></span>
        <span class="toggle-switch"><input type="checkbox" id="source-share-audio-checkbox" disabled><span class="toggle-slider"></span></span>
      </label>
      <label for="source-share-name-input">Stream name <span class="optional">· optional</span></label>
      <input type="text" class="input" id="source-share-name-input" placeholder="Leave blank to use the source's own name" maxlength="64">
      <div class="share-picker-foot">
        <span id="source-share-preview">Choose a screen or window</span>
        <button class="btn btn-secondary" id="btn-screen-share-cancel">Cancel</button>
        <button class="btn btn-primary" id="btn-screen-share-start" disabled><i class="ph ph-screencast" aria-hidden="true"></i> Start sharing</button>
      </div>
    </div>
```
   (All ids the code queries are kept: `screen-share-sub`, `source-share-groups`, `source-share-status`, `source-share-audio-checkbox`, `source-share-audio-desc`, `source-share-name-input`, `btn-screen-share-cancel`, `btn-screen-share-start`. If `.toggle-switch` is a `<label>` elsewhere, a `<span>` here is fine because the outer `<label for>` handles clicks — check that clicking the card toggles exactly once.)
2. **Renderer state:** `let shareSources: DesktopSource[] = []; let shareTab: "screen" | "window" = "screen"; let shareProcessNames: Record<string, string> = {};`
3. **Replace `renderSourceShareGroup`** with `renderSourceGrid()`:
```ts
/** The picker's single grid for the chosen tab (PRD 20 S1). */
function renderSourceGrid(): void {
    sourceShareGroups.textContent = "";
    const list = shareSources.filter((s) => s.sourceType === shareTab);
    if (list.length === 0) {
        const empty = document.createElement("div");
        empty.className = "source-share-empty";
        empty.textContent = shareTab === "screen" ? "No screens available." : "No windows available.";
        sourceShareGroups.appendChild(empty);
        return;
    }
    for (const source of list) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "source-share-card" + (selectedShareSource?.id === source.id ? " selected" : "");
        const thumb = document.createElement("img");
        thumb.className = "source-share-card-thumb";
        thumb.src = source.thumbnail;
        thumb.alt = "";
        const foot = document.createElement("div");
        foot.className = "source-share-card-foot";
        if (source.appIcon) {
            const icon = document.createElement("img");
            icon.className = "source-share-card-icon";
            icon.src = source.appIcon;
            icon.alt = "";
            foot.appendChild(icon);
        } else {
            const icon = document.createElement("i");
            icon.className = `ph ${source.sourceType === "screen" ? "ph-monitor" : "ph-app-window"} source-share-card-ph`;
            icon.setAttribute("aria-hidden", "true");
            foot.appendChild(icon);
        }
        const text = document.createElement("div");
        text.className = "source-share-card-text";
        const name = document.createElement("div");
        name.className = "source-share-card-name";
        name.textContent = source.name;
        const sub = document.createElement("div");
        sub.className = "source-share-card-sub";
        sub.textContent = shareProcessNames[source.id] ?? (source.sourceType === "screen" ? "Screen" : "Window");
        text.append(name, sub);
        foot.appendChild(text);
        const check = document.createElement("span");
        check.className = "source-share-check";
        check.innerHTML = '<i class="ph-bold ph-check" aria-hidden="true"></i>';
        card.append(thumb, foot, check);
        card.addEventListener("click", () => selectShareSource(source, card));
        sourceShareGroups.appendChild(card);
    }
}

function setShareTab(tab: "screen" | "window"): void {
    shareTab = tab;
    document.querySelectorAll<HTMLButtonElement>("#source-share-tabs .seg-opt").forEach((b) => b.classList.toggle("active", b.dataset.sourceTab === tab));
    renderSourceGrid();
}

document.querySelectorAll<HTMLButtonElement>("#source-share-tabs .seg-opt").forEach((b) =>
    b.addEventListener("click", () => setShareTab(b.dataset.sourceTab === "window" ? "window" : "screen")),
);
```
4. **`openScreenShareModal()`:** after the sources arrive, replace the "screens/windows group" block with:
```ts
    shareSources = sourcesRes.sources;
    shareProcessNames = {};
    const screens = shareSources.filter((s) => s.sourceType === "screen").length;
    const windows = shareSources.length - screens;
    const counts = document.querySelectorAll<HTMLElement>("#source-share-tabs .seg-count");
    counts[0].textContent = String(screens);
    counts[1].textContent = String(windows);
    if (screens + windows === 0) { /* keep the existing "No screens or windows available" block */ }
    setShareTab(screens > 0 ? "screen" : "window");
    // Process names arrive later (Windows only); the cards fill in when they do.
    void api.getWindowProcessNames(shareSources.filter((s) => s.sourceType === "window").map((s) => s.id)).then((names) => {
        shareProcessNames = names;
        if (screenShareModal.classList.contains("visible")) renderSourceGrid();
    });
    updateSharePreview();
```
   Keep the loading and error branches as they are (they now render into the grid container).
5. **`selectShareSource`:** replace the `querySelectorAll(".source-share-card.selected")` loop with the same loop (it still works) and add `updateSharePreview();`.
6. **Copy:** in `updateShareAudioCheckboxState`, the success desc becomes `` `Only sound from ${source.name}` ``; the no-source desc (in `openScreenShareModal`) becomes "Pick a window to share its sound"; the screen case "Not available when sharing an entire screen — pick a window instead".
7. **Preview line:**
```ts
function updateSharePreview(): void {
    const el = document.getElementById("source-share-preview")!;
    const name = sourceShareNameInput.value.trim() || selectedShareSource?.name || "";
    el.textContent = selectedShareSource ? `Others will see: ${name}` : "Choose a screen or window";
    sourceShareNameInput.placeholder = selectedShareSource ? `Leave blank to use “${selectedShareSource.name}”` : "Leave blank to use the source's own name";
}
sourceShareNameInput.addEventListener("input", updateSharePreview);
document.getElementById("btn-screen-share-close")!.addEventListener("click", () => closeScreenShareModal());
```
8. **Process names (main, Windows only):**
```ts
    // PRD 20 S1: "dota2.exe" under a window card. One tasklist call for all of them.
    ipcMain.handle("get-window-process-names", async (_event, ids: unknown): Promise<Record<string, string>> => {
        if (process.platform !== "win32" || typeof resolvePidForWindowSourceId !== "function") return {};
        if (!Array.isArray(ids) || ids.length > 100) return {};
        const pidOf = new Map<string, number>();
        for (const id of ids) {
            if (typeof id !== "string" || id.length > 100) continue;
            const pid = resolvePidForWindowSourceId(id);
            if (typeof pid === "number") pidOf.set(id, pid);
        }
        if (pidOf.size === 0) return {};
        const csv = await new Promise<string>((resolve) =>
            execFile("tasklist", ["/FO", "CSV", "/NH"], { timeout: 3000, windowsHide: true }, (err, out) => resolve(err ? "" : out)),
        );
        const nameOfPid = new Map<number, string>();
        for (const line of csv.split(/\r?\n/)) {
            const m = /^"([^"]+)","(\d+)"/.exec(line);
            if (m) nameOfPid.set(Number(m[2]), m[1]);
        }
        const out: Record<string, string> = {};
        for (const [id, pid] of pidOf) {
            const name = nameOfPid.get(pid);
            if (name) out[id] = name;
        }
        return out;
    });
```
   Import `execFile` from `"child_process"` (check it isn't already imported). Check `resolvePidForWindowSourceId`'s return type in `@reson8/native-audio` (sync number vs Promise) — the existing handler returns it directly; if it is a Promise, `await` it.
   Preload: `getWindowProcessNames(ids: string[]): Promise<Record<string, string>>` → `ipcRenderer.invoke("get-window-process-names", ids)`; add to `interface Reson8Api`.
9. **CSS:** replace the old `.source-share-*` group/title/grid/card rules with:
```css
    .share-picker {
      width: min(740px, calc(100vw - 32px));
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .share-picker-head {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    .share-picker-head > div {
      flex: 1;
    }

    #source-share-tabs {
      align-self: flex-start;
    }

    .source-share-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      max-height: 46vh;
      overflow-y: auto;
      padding: 2px;
    }

    .source-share-card {
      position: relative;
      display: flex;
      flex-direction: column;
      padding: 0;
      border: none;
      border-radius: var(--radius-md);
      overflow: hidden;
      background: var(--color-bg);
      box-shadow: var(--shadow-sm);
      color: inherit;
      text-align: left;
      cursor: pointer;
    }

    .source-share-card:hover {
      box-shadow: 0 0 0 1px var(--color-accent-600);
    }

    .source-share-card.selected {
      box-shadow: 0 0 0 2px var(--color-accent), 0 0 20px color-mix(in srgb, var(--color-accent) 25%, transparent);
    }

    .source-share-card-thumb {
      width: 100%;
      aspect-ratio: 16 / 10;
      object-fit: cover;
      background: var(--color-neutral-900);
    }

    .source-share-card-foot {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
    }

    .source-share-card-icon {
      width: 16px;
      height: 16px;
    }

    .source-share-card-ph {
      font-size: 15px;
      color: var(--color-neutral-400);
    }

    .source-share-card.selected .source-share-card-ph {
      color: var(--color-accent);
    }

    .source-share-card-text {
      flex: 1;
      min-width: 0;
    }

    .source-share-card-name {
      font-size: 12.5px;
      color: var(--color-neutral-100);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .source-share-card-sub {
      font-size: 11px;
      color: var(--color-neutral-500);
    }

    .source-share-check {
      display: none;
      position: absolute;
      top: 8px;
      right: 8px;
      width: 22px;
      height: 22px;
      place-items: center;
      border-radius: 50%;
      background: var(--color-accent-800);
      color: var(--color-accent-100);
      box-shadow: 0 0 0 1px var(--color-accent), 0 0 12px var(--color-accent);
      font-size: 12px;
    }

    .source-share-card.selected .source-share-check {
      display: grid;
    }

    .share-audio-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-sm);
      cursor: pointer;
    }

    .share-audio-card:has(input:disabled) {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .share-audio-card > i {
      font-size: 18px;
      color: var(--color-neutral-400);
    }

    .share-audio-text {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .share-audio-title {
      font-size: 13.5px;
      font-weight: 500;
    }

    .share-audio-sub {
      font-size: 12px;
      color: var(--color-neutral-500);
    }

    .share-picker-foot {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    #source-share-preview {
      flex: 1;
      min-width: 0;
      font-size: 12.5px;
      color: var(--color-neutral-500);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
```
**Verify (Windows, in voice):** open the picker → screenshot next to `1k.png`; counts match; Windows tab shows process names (e.g. `Code.exe`) within ~1 s; select a window → ring + check, "Only sound from …", "Others will see: …" updates with the name field; switch tabs and back → the selection is kept; Start sharing works with and without audio; × and Cancel close it. Commit `feat: share picker with Screens/Windows tabs and process names (PRD 20 S1)`.

---

### S2 — The Linux system-picker flow

**Frames:** `1l.png`, `1m.png`. Runs only when `api.isLinuxWayland` (the desktop portal chooses the source).
**Today:** `startScreenShareViaSystemPicker()` calls the portal, sets `isSharingScreen = true` **before** asking for a name, then `promptForStreamName()` (Skip = start with the default name), then a native dialog for app audio.
**Target:**
- While the portal dialog is open: a card at the bottom centre — `ph-arrow-square-up-right` (accent), "Waiting for your system's screen picker", "On Linux, the desktop (KDE Plasma, GNOME…) asks what to share. Reson8 never sees your screen until you choose.", **Cancel**.
- Then "Name your stream" (440 px): subtitle "Everyone in {room} will be able to watch.", × button; a source row (64×40 striped thumbnail, "Chosen in the system picker", the source name, **Change** ghost button with `ph-arrows-clockwise`); "Stream name · optional"; footer "Others will see: {name}", **Cancel**, **Start sharing**.

**Decisions already made:**
- Reson8 cannot close the OS portal dialog. **Cancel on the waiting card** marks the attempt cancelled: if the portal later returns a capture, it is stopped immediately (`api.stopScreenShare()`) and nothing is announced.
- In the name dialog, **Cancel and ×** stop the capture (no share); **Start sharing** starts with the typed name or the source name; **Change** stops the capture and re-opens the portal.
- `isSharingScreen` becomes true only after Start sharing.

**Steps:**
1. **Markup** — add after `#stream-name-modal`:
```html
  <div id="portal-wait-card" role="status" aria-live="polite">
    <i class="ph ph-arrow-square-up-right" aria-hidden="true"></i>
    <div><div class="portal-wait-title">Waiting for your system's screen picker</div><div class="portal-wait-sub">On Linux, the desktop (KDE Plasma, GNOME…) asks what to share. Reson8 never sees your screen until you choose.</div></div>
    <button type="button" class="btn btn-secondary" id="btn-portal-wait-cancel">Cancel</button>
  </div>
```
   Replace `#stream-name-modal`'s `.modal-content` with:
```html
    <div class="modal-content dialog stream-name-dialog">
      <div class="share-picker-head">
        <div><h3 class="dialog-title">Name your stream</h3><p class="dialog-subtitle" id="stream-name-sub">Everyone in your voice room will be able to watch.</p></div>
        <button type="button" class="btn btn-ghost btn-icon" id="btn-stream-name-close" aria-label="Close"><i class="ph ph-x" aria-hidden="true"></i></button>
      </div>
      <div class="stream-source-row">
        <span class="stream-source-thumb" aria-hidden="true"></span>
        <div class="stream-source-text"><div class="stream-source-kicker">Chosen in the system picker</div><div class="stream-source-name" id="stream-name-source"></div></div>
        <button type="button" class="btn btn-ghost" id="btn-stream-name-change"><i class="ph ph-arrows-clockwise" aria-hidden="true"></i> Change</button>
      </div>
      <label for="stream-name-input">Stream name <span class="optional">· optional</span></label>
      <input type="text" class="input" id="stream-name-input" placeholder="Leave blank to use the default" maxlength="64">
      <div class="share-picker-foot">
        <span id="stream-name-preview"></span>
        <button class="btn btn-secondary" id="btn-stream-name-cancel">Cancel</button>
        <button class="btn btn-primary" id="btn-stream-name-confirm"><i class="ph ph-screencast" aria-hidden="true"></i> Start sharing</button>
      </div>
    </div>
```
   `#btn-stream-name-skip` is gone: `grep -n "btnStreamNameSkip\|btn-stream-name-skip" renderer.ts` and replace those references with `btnStreamNameCancel` / `btn-stream-name-cancel` (rename the const).
2. **CSS:**
```css
    #portal-wait-card {
      display: none;
      position: fixed;
      left: 50%;
      bottom: 64px;
      transform: translateX(-50%);
      z-index: 120;
      align-items: center;
      gap: 12px;
      max-width: min(720px, calc(100vw - 32px));
      padding: 10px 12px 10px 14px;
      border-radius: var(--radius-md);
      background: var(--color-surface);
      box-shadow: var(--shadow-md);
      font-size: 13px;
    }

    #portal-wait-card.visible {
      display: flex;
    }

    #portal-wait-card > i {
      font-size: 18px;
      color: var(--color-accent);
    }

    .portal-wait-title {
      font-weight: 500;
    }

    .portal-wait-sub {
      font-size: 12px;
      color: var(--color-neutral-500);
    }

    .stream-name-dialog {
      width: min(440px, calc(100vw - 32px));
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .stream-source-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: var(--radius-md);
      box-shadow: var(--shadow-sm);
    }

    .stream-source-thumb {
      width: 64px;
      height: 40px;
      flex: none;
      border-radius: var(--radius-sm);
      background: repeating-linear-gradient(135deg, var(--color-neutral-900) 0 8px, color-mix(in srgb, var(--color-neutral-900) 55%, var(--color-bg)) 8px 16px);
      box-shadow: 0 0 0 1px var(--color-accent-700);
    }

    .stream-source-text {
      flex: 1;
      min-width: 0;
    }

    .stream-source-kicker {
      font-size: 11px;
      color: var(--color-neutral-500);
    }

    .stream-source-name {
      font-size: 13.5px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    #stream-name-preview {
      flex: 1;
      min-width: 0;
      font-size: 12.5px;
      color: var(--color-neutral-500);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
```
3. **`promptForStreamName(sourceName)`** — rewrite to return a choice:
```ts
type StreamNameChoice = { action: "start"; name: string } | { action: "change" } | { action: "cancel" };

function promptForStreamName(sourceName: string): Promise<StreamNameChoice> {
    return new Promise((resolve) => {
        const roomName = currentChannelId ? findChannelNodeById(currentTree, currentChannelId)?.name : null;
        (document.getElementById("stream-name-sub") as HTMLElement).textContent = roomName
            ? `Everyone in ${roomName} will be able to watch.`
            : "Everyone in your voice room will be able to watch.";
        (document.getElementById("stream-name-source") as HTMLElement).textContent = sourceName || "Your screen";
        const preview = document.getElementById("stream-name-preview") as HTMLElement;
        const paint = (): void => {
            preview.textContent = `Others will see: ${streamNameInput.value.trim() || sourceName || "your screen"}`;
        };
        streamNameInput.value = "";
        streamNameInput.placeholder = sourceName ? `Leave blank to use “${sourceName}”` : "Leave blank to use the default";
        paint();
        streamNameModal.classList.add("visible");
        streamNameInput.focus();
        const btnChange = document.getElementById("btn-stream-name-change") as HTMLButtonElement;
        const btnClose = document.getElementById("btn-stream-name-close") as HTMLButtonElement;
        const finish = (choice: StreamNameChoice): void => {
            streamNameModal.classList.remove("visible");
            btnStreamNameConfirm.removeEventListener("click", onStart);
            btnStreamNameCancel.removeEventListener("click", onCancel);
            btnClose.removeEventListener("click", onCancel);
            btnChange.removeEventListener("click", onChange);
            streamNameModal.removeEventListener("click", onBackdrop);
            streamNameInput.removeEventListener("input", paint);
            streamNameInput.removeEventListener("keydown", onKey);
            resolve(choice);
        };
        const onStart = (): void => finish({ action: "start", name: streamNameInput.value.trim() });
        const onCancel = (): void => finish({ action: "cancel" });
        const onChange = (): void => finish({ action: "change" });
        const onBackdrop = (e: MouseEvent): void => {
            if (e.target === streamNameModal) onCancel();
        };
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Enter") onStart();
            else if (e.key === "Escape") onCancel();
        };
        btnStreamNameConfirm.addEventListener("click", onStart);
        btnStreamNameCancel.addEventListener("click", onCancel);
        btnClose.addEventListener("click", onCancel);
        btnChange.addEventListener("click", onChange);
        streamNameModal.addEventListener("click", onBackdrop);
        streamNameInput.addEventListener("input", paint);
        streamNameInput.addEventListener("keydown", onKey);
    });
}
```
4. **`startScreenShareViaSystemPicker()`** — rewrite:
```ts
let portalAttempt = 0;

async function startScreenShareViaSystemPicker(): Promise<void> {
    const attempt = ++portalAttempt;
    const card = document.getElementById("portal-wait-card") as HTMLElement;
    card.classList.add("visible");
    const videoRes = await api.startScreenShareViaSystemPicker();
    card.classList.remove("visible");
    if (attempt !== portalAttempt) {
        // Cancelled while the portal was open: drop whatever it returned.
        if (videoRes.success) await api.stopScreenShare();
        return;
    }
    if (!videoRes.success) {
        if (videoRes.errorCode === "SCREEN_SHARE_LIMIT") {
            showToast(SCREEN_SHARE_LIMIT_TOAST);
            return;
        }
        log(`Failed to start screen share: ${videoRes.error}`, "error");
        return;
    }

    const choice = await promptForStreamName(videoRes.label ?? "");
    if (choice.action !== "start") {
        await api.stopScreenShare();
        if (choice.action === "change") await startScreenShareViaSystemPicker();
        return;
    }

    isSharingScreen = true;
    updateShareScreenButton();
    const resolvedName = choice.name || videoRes.label || "your screen";
    api.setScreenShareState(true, resolvedName);
    log(`Started sharing "${resolvedName}"`, "success");

    if (videoRes.sourceType === "window" && (await api.platformSupportsAudioCapture())) {
        const chosenApp = await api.pickAudioAppToShare();
        if (chosenApp) {
            const audioRes = await api.startAppAudioCapture(undefined, chosenApp);
            if (!audioRes.success) log(`Screen video is sharing, but audio couldn't start: ${audioRes.error}`, "error");
        }
    }
}

document.getElementById("btn-portal-wait-cancel")!.addEventListener("click", () => {
    portalAttempt++; // the pending attempt is now stale
    (document.getElementById("portal-wait-card") as HTMLElement).classList.remove("visible");
});
```
   Keep the existing doc comment above the function (update its text: Skip → Cancel). Check `api.startScreenShareViaSystemPicker` resolves even when the user closes the portal (it returns `success: false`) — the card hides either way.

**Verify:** Windows can't run this path; the **owner verifies on Linux Wayland**: card while the portal is open; Cancel on the card then picking in the portal → nothing is shared (other clients see no LIVE); name dialog shows the source; Change re-opens the portal; Cancel/×/Escape → nothing shared; Start → LIVE with the typed or default name. The implementer checks the markup by forcing it over CDP (`promptForStreamName("LG Electronics LG FHD (DP-1)")` and `document.getElementById("portal-wait-card").classList.add("visible")`) and screenshots next to `1l.png`/`1m.png`. Commit `feat: Linux portal waiting card and source row in Name your stream (PRD 20 S2)`.

---

### S3 — Channel icon in Create channel

**Frame:** `1g.png`. **Today:** `#create-channel-modal` has Type, Channel name, Parent, NSFW; icons are set later from the channel menu (`showChannelIconModal(channelId)`, which **applies immediately** via `api.updateChannel`).
**Target:** for **text** channels, a 38×38 dashed square button left of the name field (`ph-hash` until chosen; then the chosen emoji or a 24 px preview of the image), and under the row "Click the icon to choose an emoji or upload a custom image." (11.5 px, neutral-500). Voice channels: no button, no hint.

**Decisions already made:** the chooser is the existing `#channel-icon-modal` in a **draft mode**: it returns the choice to the create dialog instead of applying it. After `CREATE_CHANNEL` succeeds, an emoji is applied with `updateChannel(id, { iconEmoji })`; an image is uploaded **then** applied (so a failed create uploads nothing); a failed apply discards the upload (`discardUpload`). The create dialog stays the source of truth for the form.

**Steps:**
1. **Markup:** wrap the name input:
```html
      <label for="new-channel-name">Channel name</label>
      <div class="new-channel-name-row">
        <button type="button" class="new-channel-icon-btn" id="new-channel-icon-btn" title="Channel icon — pick an emoji or upload an image" aria-label="Channel icon"><i class="ph ph-hash" aria-hidden="true"></i></button>
        <input type="text" class="input" id="new-channel-name" placeholder="e.g. Music Room">
      </div>
      <div class="new-channel-icon-hint" id="new-channel-icon-hint">Click the icon to choose an emoji or upload a custom image.</div>
```
2. **CSS:**
```css
    .new-channel-name-row {
      display: flex;
      gap: 8px;
    }

    .new-channel-icon-btn {
      width: 38px;
      height: 38px;
      flex: none;
      display: grid;
      place-items: center;
      padding: 0;
      border: 1px dashed var(--color-neutral-700);
      border-radius: var(--radius-md);
      background: transparent;
      color: var(--color-neutral-400);
      font-size: 17px;
      cursor: pointer;
      overflow: hidden;
    }

    .new-channel-icon-btn:hover {
      border-color: var(--color-accent);
      color: var(--color-accent-300);
    }

    .new-channel-icon-btn img {
      width: 24px;
      height: 24px;
      object-fit: cover;
      border-radius: var(--radius-sm);
    }

    .new-channel-icon-hint {
      margin-top: 5px;
      font-size: 11.5px;
      color: var(--color-neutral-500);
    }
```
3. **Renderer — draft state** (next to `showChannelIconModal`):
```ts
/** Where the channel-icon chooser sends its result (PRD 20 S3). */
let channelIconDraftMode = false;
type ChannelIconDraft = { emoji: string } | { blob: Blob; url: string } | null;
let createChannelIconDraft: ChannelIconDraft = null;
const newChannelIconBtn = document.getElementById("new-channel-icon-btn") as HTMLButtonElement;
const newChannelIconHint = document.getElementById("new-channel-icon-hint") as HTMLElement;

function setCreateChannelIconDraft(draft: ChannelIconDraft): void {
    if (createChannelIconDraft && "url" in createChannelIconDraft) URL.revokeObjectURL(createChannelIconDraft.url);
    createChannelIconDraft = draft;
    newChannelIconBtn.textContent = "";
    if (!draft) {
        newChannelIconBtn.innerHTML = '<i class="ph ph-hash" aria-hidden="true"></i>';
    } else if ("emoji" in draft) {
        newChannelIconBtn.textContent = draft.emoji;
    } else {
        const img = document.createElement("img");
        img.src = draft.url;
        img.alt = "";
        newChannelIconBtn.appendChild(img);
    }
}

function paintCreateChannelIconRow(): void {
    const text = newChannelType.value === "TEXT";
    newChannelIconBtn.style.display = text ? "" : "none";
    newChannelIconHint.style.display = text ? "" : "none";
    if (!text) setCreateChannelIconDraft(null);
}

newChannelIconBtn.addEventListener("click", () => {
    channelIconDraftMode = true;
    pendingChannelIconId = null;
    channelIconStepSelect.style.display = "block";
    channelIconStepEmoji.style.display = "none";
    channelIconStepCrop.style.display = "none";
    channelIconModal.classList.add("visible");
});
```
4. **Make the chooser honour draft mode** (edit the existing functions):
   - `closeChannelIconModal()`: add `channelIconDraftMode = false;`.
   - `selectChannelIconEmoji(emoji)`: at the very top:
```ts
    if (channelIconDraftMode) {
        setCreateChannelIconDraft({ emoji });
        closeChannelIconModal();
        return;
    }
```
   - `btnChannelIconReset` click: at the top `if (channelIconDraftMode) { setCreateChannelIconDraft(null); closeChannelIconModal(); return; }`.
   - `btnChannelIconUploadConfirm` click: replace the first line `if (!pendingChannelIconId) return;` with:
```ts
    if (channelIconDraftMode) {
        if (!channelCropper.isReady()) return;
        const blob = await channelCropper.toBlob(128, "image/png");
        if (blob) setCreateChannelIconDraft({ blob, url: URL.createObjectURL(blob) });
        closeChannelIconModal();
        return;
    }
    if (!pendingChannelIconId) return;
```
5. **Create flow:** in the `btnCreateChannel` click handler (opens the dialog) add `setCreateChannelIconDraft(null); paintCreateChannelIconRow();`. In `newChannelType`'s `change` listener add `paintCreateChannelIconRow();`. In `btnModalCreate`'s click handler, after `if (result.success) {`:
```ts
        const draft = createChannelIconDraft;
        if (draft && result.channelId && type === "TEXT") void applyNewChannelIcon(result.channelId, draft);
        setCreateChannelIconDraft(null);
```
   and add:
```ts
/** Applies the icon chosen in Create channel to the new channel (PRD 20 S3). */
async function applyNewChannelIcon(channelId: string, draft: NonNullable<ChannelIconDraft>): Promise<void> {
    if ("emoji" in draft) {
        const res = await api.updateChannel(channelId, { iconEmoji: draft.emoji });
        if (!res.success) log(`Channel created, but its icon couldn't be set: ${res.error}`, "error");
        return;
    }
    try {
        const upload = await api.uploadChannelIcon(await draft.blob.arrayBuffer(), "channel-icon.png", "image/png");
        let applied = false;
        try {
            const res = await api.updateChannel(channelId, { iconUploadId: upload.uploadId, iconUrl: upload.url, iconPublicId: upload.publicId ?? null });
            applied = res.success;
            if (!res.success) log(`Channel created, but its icon couldn't be set: ${res.error}`, "error");
        } finally {
            if (!applied) discardUpload(upload.uploadId);
        }
    } catch (err: any) {
        log(`Channel created, but the icon upload failed: ${err?.message ?? err}`, "error");
    }
}
```
   (The `setCreateChannelIconDraft(null)` after reading the draft would revoke the object URL; the Blob itself stays valid — that's why `applyNewChannelIcon` takes the Blob, not the URL.)
6. **Stacking:** `#channel-icon-modal` comes later in the DOM than `#create-channel-modal` with the same `z-index: 100`, so it already opens on top. Confirm with `document.elementFromPoint` at the centre of the screen after opening it from Create channel.

**Verify:** Create channel (Text) → icon button + hint; voice → hidden; pick an emoji → shown in the button; create → the tree row shows that emoji; pick an image → crop → the button shows a 24 px preview → create → the tree shows the image; cancel Create after choosing an image → no upload in the server log; switch Text→Voice→Text → the draft is cleared; the channel menu's "Set icon…" still applies immediately (draft mode off). Screenshot next to `1g.png`. Commit `feat: choose a channel icon while creating a channel (PRD 20 S3)`.

---

## P6 — Settings

### G1 — Get beta updates

**Needs D3.** **Frame:** `4g.png` (a card under Updates: "Get beta updates" + a `BETA` tag, "Get new features early. Beta builds can be less stable; switch back any time and the next stable release replaces it.", a switch).

**How electron-updater 6.8.9 behaves (read from `node_modules/electron-updater/out/`, verified 14/10/2026):**
- `autoUpdater.allowPrerelease = true` on a **stable** build (no channel set): the GitHub provider takes the **newest release in the feed**, prerelease or not; for a prerelease tag it reads that tag's channel file (`beta.yml`), falling back to `latest.yml`. It installs only when that version is **newer** (`allowDowngrade` stays false).
- Setting `autoUpdater.channel` sets `allowDowngrade = true` — **never set it**. Nothing in G1 needs it.
- `allowPrerelease = false` on a **beta** build (channel `beta` baked into `app-update.yml`): the provider asks `/releases/latest` and then looks for `beta.yml` in a stable release → 404 → **error**. So on a beta build the switch must stay ON.

**Decisions already made:**
- Stable builds: the switch sets `autoUpdater.allowPrerelease` (default off), live and persisted.
- Beta builds: the switch is shown **on and disabled**, with the note "You're on a beta build. It moves to the next stable release automatically when one is out."
- Turning it off on a stable build after a beta was installed is not possible (the build is then a beta); the note covers it.

**Steps:**
1. Pure module `apps/client/src/update-prefs.ts` — copy the structure of `window-chrome.ts`'s prefs part: file `update-prefs.json` in userData, `{ betaUpdates: boolean }`, `readUpdatePrefs(dir)` (default false on any error), `writeUpdatePrefs(dir, prefs)` (temp file + rename). Smoke test `scripts/update-prefs-smoke.mjs` (missing file → false; write true → read true; corrupt JSON → false) and the `test:update-prefs` script.
2. `main.ts`: replace `autoUpdater.allowPrerelease = isPrerelease(app.getVersion());` with
```ts
const runningBeta = isPrerelease(app.getVersion());
// PRD 20 G1: a stable build may opt in to betas (newest release in the feed, only if newer).
// NEVER set autoUpdater.channel: its setter also turns on allowDowngrade.
autoUpdater.allowPrerelease = runningBeta || readUpdatePrefs(app.getPath("userData")).betaUpdates;
autoUpdater.allowDowngrade = false;
```
   (Make sure `app.getPath("userData")` is valid at this point — it is, `app` paths exist before `ready`; if a test shows otherwise, move the two lines into the `ready` handler before the first update check.)
   IPC: `ipcMain.handle("update-prefs-get", () => ({ betaUpdates: autoUpdater.allowPrerelease, runningBeta }))` and `ipcMain.handle("update-prefs-set-beta", (_e, on: unknown) => { if (runningBeta) return { betaUpdates: true }; const v = on === true; writeUpdatePrefs(app.getPath("userData"), { betaUpdates: v }); autoUpdater.allowPrerelease = v; autoUpdater.allowDowngrade = false; return { betaUpdates: v }; })`.
3. Preload `updatePrefs: { get(), setBeta(on) }`; `interface Reson8Api`.
4. Markup in the About panel, after the Updates row card: a `.settings-card` with a `.toggle-row`: title "Get beta updates" + `<span class="tag">BETA</span>`, desc as in the frame, `#chk-beta-updates`, and a `.toggle-row-note` `#beta-updates-note` (hidden unless running a beta). Renderer: on Settings open, `api.updatePrefs.get()` → set `checked`, `disabled = runningBeta`, show the note; on change → `setBeta(checked)`, then call the existing "Check for updates" action so the row reflects it.
5. Update the root `AGENTS.md` "Beta releases" bullet: a stable build with "Get beta updates" on sets `allowPrerelease` (never `channel`).

**Verify:** `npm run test:update-prefs`; dev build (a beta version): switch on + disabled + note. Owner test before shipping: a **packaged stable** build (temporarily version `3.0.0`, `-c.publish.channel` absent) with the switch on against the real GitHub feed offers the newest beta; with it off offers nothing newer than stable; never offers a downgrade. Commit `feat: Get beta updates switch for stable builds (PRD 20 G1)`.

---

### G2 — "Play sound alerts" wording

**Frame:** `4b.png`. **Today:** "Mute sound alerts" (`#chk-mute-alerts`, checked = silent, stored as `reson8-mute-alerts`), and `SoundAlert.play()` silences **everything**, nudges included.
**Target:** "Play sound alerts" (checked = sounds on), desc "Connect, disconnect, join, leave and private-message sounds."; the Alert volume row dims when off; the Nudge volume note "When someone nudges you. Plays even with alerts off." — and nudges really do play with alerts off.

**Steps:**
1. Markup: rename the id to `chk-play-alerts`, title "Play sound alerts", desc as above. Under the Nudge volume slider add `<div class="sensitivity-labels"><span>When someone nudges you. Plays even with alerts off.</span></div>`.
2. Renderer: rename `chkMuteAlerts` → `chkPlayAlerts` (`getElementById("chk-play-alerts")`), and:
```ts
chkPlayAlerts.checked = !soundAlertsMuted;
document.getElementById("audio-alert-volume-wrap")!.classList.toggle("is-off", soundAlertsMuted);
chkPlayAlerts.addEventListener("change", () => {
    soundAlertsMuted = !chkPlayAlerts.checked;
    try {
        localStorage.setItem("reson8-mute-alerts", String(soundAlertsMuted)); // the stored meaning is unchanged
    } catch {
        /* not remembered */
    }
    document.getElementById("audio-alert-volume-wrap")!.classList.toggle("is-off", soundAlertsMuted);
});
```
3. `SoundAlert.play`: `if (soundAlertsMuted && filename !== "nudge.mp3") return;`
4. CSS: `#audio-alert-volume-wrap.is-off { opacity: 0.5; }`
5. `grep -n "chkMuteAlerts\|chk-mute-alerts" apps/client/src` → nothing left.
**Verify:** an existing profile with alerts muted opens with the switch **off**; toggling on plays the connect sound on the next connect; a nudge plays with alerts off. Commit `fix: Play sound alerts switch; nudges play with alerts off (PRD 20 G2)`.

---

## P7 — Decision-gated features

### L1 — Live previews on "Also live" cards

**Needs D1.** **Today:** in Focus, "Also live · {n}" (`renderStageSide()`) shows static cards; each stream watch is one `startScreenWatch()` (a viewer socket of its own); screen video is VP9 `L1T3` (one spatial, three temporal layers — `voice.service.ts`).
**Plan (build only after D1 = a):**
1. Shared-types: `SET_CONSUMER_LAYERS: (payload: { consumerId: string; temporalLayer: 0 | 1 | 2 }, ack: (r: { success: boolean; error?: string }) => void) => void;` `EVENT_ACCESS`: `"member"`.
2. Server (`voice.handler.ts`): find the session with `mediasoup.getSession(socket.data.currentChannelId, getMediasoupSessionKey(socket))`, the consumer with `session.consumers.get(consumerId)`; refuse unless it exists, `consumer.kind === "video"`, and the socket is a viewer socket; validate `temporalLayer ∈ {0,1,2}`; `await consumer.setPreferredLayers({ spatialLayer: 0, temporalLayer })`.
3. `screen-watch.ts`: `WatchHandle.setTemporalLayer(n)` emitting `SET_CONSUMER_LAYERS` for its video consumer over its own socket (ignore the ack's failure: an older server just keeps full rate).
4. `preload.ts` `api.stage.watch(…, { preview: true })`: starts muted at temporal layer 0 into a card's container; `api.stage.setTemporalLayer(userId, n)`.
5. Renderer: each "Also live" card gets a `.voice-stream-card-video` container and a preview watch; clicking a card raises it to layer 2 + unmutes and lowers the old main to layer 0 + mutes, swapping containers **without closing either watch**; previews stop when the voice tab is hidden (`activeTabId !== VOICE_TAB_ID`) and restart when it's shown.
6. Verify with 5 sharers on two machines: CPU and inbound kbit/s within what the owner accepted in D1; the swap is under 1 s with no black frame longer than a keyframe interval.

### Q1 — Message search

**Needs D2.** **Frame:** `1i.png` (a "Search" field with a `Ctrl F` hint at the right of the tab bar; a 370 px results column: "{n} results · Newest first", scope **All channels | #{current}**, results grouped by channel with author, date, a two-line snippet with the match highlighted).
**Plan (build only after D2 = a):**
1. Migration (raw SQL, hand-written): `CREATE INDEX "messages_content_fts" ON "messages" USING GIN (to_tsvector('simple', "content"));` and the same on `"direct_messages"`. (`simple` config: no language stemming, works for Portuguese and English alike.) Check the real table names with `@@map` in `schema.prisma`.
2. Shared-types: `SEARCH_MESSAGES: (payload: { query: string; channelId?: string; dmPartnerId?: string; before?: string }, ack: (r: { success: boolean; results?: { id: string; channelId?: string; dmPartnerId?: string; authorId: string; authorNickname: string; createdAt: string; snippet: string }[]; hasMore?: boolean; error?: string }) => void) => void;` — `"member"`. No ids = every text channel of the server. Query 2–100 characters.
3. Server: a pure `search.service.ts` (query normalisation → `plainto_tsquery('simple', $1)`, page size 25, `before` cursor on `createdAt`), `$queryRaw` with parameters only (never string interpolation), snippet via `ts_headline('simple', content, query, 'MaxWords=24,MinWords=8,StartSel=<<,StopSel=>>')`; the client turns `<<`/`>>` into `<mark>` by splitting text — never `innerHTML` of server text. DMs: only conversations the caller is part of. Rate limit: 1 search per second per socket.
4. Client: the tab-bar field (Ctrl+F focuses it), results panel, "All channels | #current" scope, click → `jumpToMessage(tabId, messageId)` (opens the tab first if needed).

---

## P8 — Housekeeping

### H1 — Minimize-to-tray: dead `will-minimize` handler

**Finding (14/10/2026):** Electron 34 has **no** `will-minimize` event (`electron.d.ts` lists only `minimize`). The handler registered with `(mainWindow as any).on("will-minimize", …)` never runs on any platform, so with "Minimize to system tray" on, every minimize goes through the `minimize` handler: the window is minimized **and then** hidden (the state PRD 15.7 wanted to avoid). Restoring works because every "show" path goes through `showMainWindow()`, which restores before showing, and the Windows re-launch freeze was fixed separately (`CalculateNativeWinOcclusion` disabled).
**Steps:**
1. Delete the `will-minimize` handler and replace the comment above the `minimize` handler with an accurate one: Electron has no cancellable minimize; with minimize-to-tray on, the window is minimized then hidden, and `showMainWindow()` (the only show path) restores it before showing.
2. In the `minimize` handler, keep `hide()` and the single `window-minimized` send (it was sent twice only in the dead path).
3. Check every path that shows the window uses `showMainWindow()`: `grep -n "\.show()\|\.restore()" apps/client/src/main.ts` — tray click, tray "Restore", `second-instance`, the nudge/notification paths. Route any direct `show()` through `showMainWindow(<source>)`.
**Verify (Windows, by hand, 10 times each):** minimize-to-tray on → minimize → tray click restores a painted, focused window; same with tray menu Restore, with launching the app again, and after 10 minutes hidden. Commit `fix: remove the dead will-minimize handler; one show path (PRD 20 H1)`.

### H2 — TypeScript `moduleResolution` migration

**Context:** the editor's TypeScript 6 flags `"moduleResolution": "Node"` (node10) in `apps/client/tsconfig.json`; the project builds with TypeScript 5.9.3. The client's only imports of `@reson8/shared-types` are `import type` (in `preload.ts` and `screen-watch.ts`), and shared-types is `"type": "module"` with an `exports` map that has `types` + `import` only.
**Steps (can be done now; TS 5.9 supports Node16):**
1. Build the client once and copy `apps/client/dist` aside (`dist-before`).
2. In `apps/client/tsconfig.json` set `"module": "Node16"` and `"moduleResolution": "Node16"`.
3. `npx tsc --noEmit -p apps/client`. Expected errors: the two `import type … from "@reson8/shared-types"` (a CommonJS file importing an ES module's types). Fix each with an import attribute: `import type { … } from "@reson8/shared-types" with { "resolution-mode": "import" };`. Fix any other error the same way or with a `.js`-free relative path (relative imports in CommonJS files need no extension).
4. Rebuild and diff `dist` against `dist-before` (`git diff --no-index`): the JavaScript must be identical except possibly `import()` calls that Node16 now keeps as real `import()` (in CommonJS output, TypeScript ≥ 4.7 preserves dynamic `import()` under `module: Node16`). If any `import()` changed, run the app and check noise cancelling (the `dynamicImport` escape hatch) still loads, in dev and in `npm run test-build:win`.
5. Update `apps/client/AGENTS.md`'s ESM gotcha bullet if `import()` behaviour changed.
**Verify:** typecheck, lint, `npm run test:*` in the client, the app starts, voice works with noise cancelling on, a packaged test build starts. Commit `chore: client tsconfig on Node16 module resolution (PRD 20 H2)`.

---

## Order and Releases

1. **P1** (V1–V4) — V4 done; the owner's V1–V3 → `/bump-version 3.0.0-beta.3`.
2. **U0 → U1 → U2 → U3**, then **H1** → **`3.0.0-beta.4`**.
3. **M4 (its helper) → M1 → M2 → M3**, **W1**, **S1 → S2 → S3**, **G2** → **`3.0.0-beta.5`**.
4. Decision-gated items (**W2**, **G1**, **L1**, **Q1**), each in its own beta once decided.
5. **H2** at any quiet point (it changes no behaviour).

Every beta: the full suites, a smoke run against a 2.7.0 server and the previous beta's server (new optional fields must not break either), then `/bump-version`. Merging to `main` and the stable `3.0.0` are the owner's call.

---

## Appendix A — Design values copied from the mockup

Source: `design_handoff_reson8_ui_overhaul/design/Reson8 App.dc.html` (the template at the top, the logic class at the bottom). Colours are given as the tokens to use (U0 adds the missing ones).

**§A1 Voice dock:** card `radius-lg`, padding `10px 12px`, gap 10, background `linear-gradient(180deg, --color-voice-tint, --color-surface)`, `--shadow-sm`. Signal `ph-fill ph-cell-signal-full` 16 px `--color-voice`. Title 13/600 `--color-voice-text`. Sub 11.5 px neutral-500 "Sala Precisa / Gaming · 18ms". Expand 28×28 ghost `ph-arrow-square-out` neutral-400. Buttons row gap 6: mic/headset wrappers `flex: 1.4`, main 32 px tall, caret 20×32 (`ph-bold ph-caret-down` 10 px, inset 1 px divider line on its left), share `flex:1` `ph-screencast`, leave `flex:1` `ph-phone-x` border `oklch(0.5 0.12 22)` text `oklch(0.74 0.14 22)` hover fill 14 %. Button state: off → transparent, neutral-300, divider border; on (muted) → fill `oklch(0.6 0.16 22)` 16 %, text `oklch(0.7 0.15 22)`, border `oklch(0.5 0.12 22)`. Share on → accent-900 fill, accent-300 text, accent-600 border. Device menu: 280 px, surface, `--shadow-md`, padding 5, heading 10.5/600 uppercase, rows 34 px min, selected row tinted accent 10 % with a `ph-bold ph-check`, divider, "Voice & audio settings…" `ph-gear-six`.

**§A2 Voice room:** content padding `22px 24px`; kicker 11/600 0.08em uppercase neutral-500 "Gaming · Voice room"; name 28 px (margin-top 4). Pills: `.tag` (11 px, padding 3px 10px, radius 6 px) neutral-800/neutral-100; accent version accent-800/accent-100; icons `ph-lock-simple`, `ph-users`, `ph-screencast`. Toggles: 2 px padding box with inset 1 px divider ring, buttons 22 px tall, padding 0 8 px, 500 12 px, active accent-900/accent-200, else neutral-400; disabled opacity 0.4 not-allowed. Tooltips: Mosaic "Everyone, sized to fit" / disabled "Mosaic is only available when no one is sharing a screen"; Featured "Five people, the rest in a list (two while someone shares)" / while sharing "Featured is used while someone is sharing"; Focus "One stream large, the rest as live previews"; Grid "Every stream at the same size". Call bar: gap 10, centred; mic 54×52 radius `26px 0 0 26px` 21 px icon, caret 30×52 radius `0 26px 26px 0` 12 px; share 52 px tall, padding 0 18, radius 26, 500 14 px, icon 19 px; Leave padding 0 22, border `oklch(0.55 0.14 22)`, text `oklch(0.76 0.14 22)`.

**§A3 Members:** search input with `ph-magnifying-glass` at left 11 px, padding-left 32. `.seg` filters: active text accent + inset 1 px accent ring; count 11.5 px neutral-500. List card radius-lg, background `bg 35 %`, `--shadow-sm`; rows padding `9px 12px 9px 14px`, gap 12, separated by a 1 px divider line fading at both ends (48 px). Avatar 32 px with a 10 px dot (green online / neutral-700) ringed 2 px surface. Name 14/500 neutral-100 (no access: neutral-400). NO ACCESS tag 10.5/600 0.04em, `oklch(0.82 0.1 80)` with inset ring `oklch(0.5 0.09 80)`. "(you)" 12/400 neutral-500. Lock `ph-fill ph-lock-simple` 12 px neutral-400. Sub line 11.5 px monospace neutral-500 + " · {status}" in the body font 12 px. Pills 24 px, padding 0 9, radius 12, 500 12 px, icon 13 px: Member on → text 7 % fill, neutral-200, ring neutral-600; Admin on → accent-900, accent-200, ring accent-600; off → transparent, neutral-600, ring neutral-800; disabled opacity 0.55; icons Member `ph-user`/`ph-user-minus`, Admin `ph-shield-star`/`ph-shield`. ⋮ 30×30 `ph-dots-three-vertical`. Menu items: Reset key `ph-key`, View identity log `ph-fingerprint`, Ban… `ph-prohibit` (red). Legend 12 px neutral-500; help box text 3 % fill, 12.5/1.5 neutral-400.

**§A4 Bans:** same list card; row padding `10px 12px 10px 16px`; `ph-prohibit` 18 px `oklch(0.72 0.12 22)`; name 14/500; address chip 11.5/18 monospace neutral-300 on text 6 %; meta 12 px neutral-500; Unban `btn-secondary` 30 px. Empty: 16 px padding, 1 px dashed neutral-700, radius-lg, 13 px neutral-500 "Nobody is banned. Ban someone from the ⋮ menu in Members."

**§A5 Emoji:** section label "Requests · {n}" + ghost "Approve all" (28 px, 12.5 px); rows padding `10px 12px 10px 14px`, gap 14; image box 40×40 radius-md; code 500 14 px monospace; "Requested by {name} · {when}" 12 px neutral-500; Reject ghost 30 px; Approve primary 30 px with `ph-check`. Empty: dashed box "All caught up — no emoji waiting for review." Library: label "On this server · {n}"; grid `repeat(auto-fill, minmax(120px, 1fr))` gap 8; card padding `12px 8px 10px`, radius-md, bg 35 %, shadow-sm; image 36×36; code 12 px monospace neutral-300; Remove ghost 24 px, 12 px, neutral-500.

**§A6 Share picker:** dialog 740 px, padding 20, gap 16; title 18 px; sub 12.5 px neutral-500; × 30×30; `.seg` tabs `ph-monitor` Screens / `ph-app-window` Windows with counts; grid 3 columns gap 12; card radius-md, bg `--color-bg`, ring shadow-sm / hover 1 px accent-600 / selected `0 0 0 2px accent, 0 0 20px accent 25 %`; thumbnail 16:10; foot padding `8px 10px` gap 8, icon 15 px, name 12.5 px neutral-100, sub 11 px neutral-500; check badge 22 px accent-800 bg, accent-100, ring + glow. Audio card padding `10px 12px`, shadow-sm, `ph-speaker-high` 18 px, title 13.5/500, sub 12 px; disabled opacity 0.45. Copy: "Pick a window to share its sound" / "Not available when sharing an entire screen — pick a window instead" / "Only sound from {name}"; placeholder "Leave blank to use “{name}”"; preview "Others will see: {name}" / "Choose a screen or window".
