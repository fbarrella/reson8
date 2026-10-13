# Handoff: Reson8 desktop client — UI overhaul (Nocturne)

## Overview
This package is a redesign of the Reson8 Electron client (`apps/client`, currently **v2.7.0**). It does two things:
- **Restyles** the whole app on the Nocturne design system.
- **Adds or changes behaviour** across the shell, channel tree, tabs, DMs, voice rooms, server settings and updates.

All of it was worked out in an interactive HTML study, which is included here.

Treat this as the input for the repo's next phase PRD (Phase 19). Following repo convention:
- Every item you implement gets a `progress.txt` entry via `/log-progress`.
- The release goes through `/bump-version`.

## About the design files
The files in `design/` are **design references built in HTML**. They show the intended look and behaviour; they are not production code.
- **Do not port their markup or their state code.** The mockup is a single React-like component full of fake data.
- **Recreate the designs inside the existing client:** vanilla TypeScript + DOM in `src/renderer/renderer.ts`, with markup and CSS in `src/renderer/index.html`. Follow the conventions in `apps/client/AGENTS.md`: `textContent` for dynamic text, `localStorage` keys prefixed `reson8-*` and wrapped in try/catch, targeted DOM updates over `renderTree()`, the `requireServerAccess()` guards, and the rule that new Node/IPC capabilities go through `preload.ts`.
- **To view the study:** open `design/Reson8 UI Study.dc.html` in a browser (it loads `support.js` and the `_ds/` stylesheet next to it). Each frame has an id (`6b`, `13b`…); the specs below cite those ids.
- **Ignore the mockup's version numbers.** It says 0.9.3 → 0.9.4. Use the real ones (2.7.0 → next).

## Fidelity
**High fidelity.** Colors, type, spacing, radii, states and copy are final. Reproduce them, with two exceptions:
- **Icons:** Phosphor, not the emoji and inline SVGs the client uses today.
- **Data:** the mockup's sample data (names, counts, release-note text) is placeholder.

## Documents in this package
| File | What it holds |
| --- | --- |
| `SPEC.md` | The final behaviour rules, area by area: what to build. This is the source of truth; where an early study frame disagrees with a later one, SPEC.md records the final decision. |
| `CODE_MAP.md` | Each area mapped to the repo: the existing functions, DOM ids and events it touches, whether it's **Exists / Modify / New**, and which items need **server + shared-types** work. |
| `PENDING_FEATURES.md` | **What the study defines that the app doesn't do yet** (behaviour and server work only), plus the recommended phase order (P1–P5). Start here. |
| `screenshots/` | One PNG per study frame (`6a.png`, `13b.png`…), 1440×932. |
| `TEST_STATES.md` | Every study frame as a state the real app must reach. Use it as the manual and headless (CDP) verification checklist. |
| `design/` | The study, the mockup component, the Nocturne stylesheet and the logo. |

## Build order
Follow the phases in `PENDING_FEATURES.md`:
- **P1:** server and shared-types groundwork.
- **P2:** behaviour changes in the current UI.
- **P3:** the Nocturne foundation (tokens, fonts, icons, menu builder).
- **P4:** new surfaces, built directly in Nocturne.
- **P5:** restyle the remaining screens.

`CODE_MAP.md` lists the exact functions and element ids each item touches.

## Design tokens (Nocturne)
Copy them from `design/_ds/nocturne-*/styles.css` (`:root`). Key values:
- **Ground / surface / text:** `--color-bg #161826`, `--color-surface #232532`, `--color-text #e9e9ed`, `--color-divider` = text at 16% opacity.
- **Accent:** `--color-accent #9184d9`.
- **Accent ramp, 100→900:** `#f5f4ff #e7e5fe #d2cefd #b5abfc #968ae0 #796cbf #5d5294 #423a6a #2b2741`.
- **Neutral ramp, 100→900:** `#f3f5fe #e4e7f5 #cfd3e5 #b2b6ca #9397ab #75798c #595d6c #3f424d #292b31`.
- **Status colors** (used in the study, not in the token sheet):
  - Online / speaking green: `oklch(0.78 0.14 150)`.
  - Danger red: text `oklch(0.8 0.12 22)`, border `oklch(0.55 0.14 22)`, LIVE dot `oklch(0.65 0.2 22)`.
  - Warning amber: text `oklch(0.86 0.08 80)` on an 8% tint of `oklch(0.82 0.1 80)`.
- **Type:** Inter. Headings weight 500 (never bolder). UI text is 13–14px; meta text 11–12.5px; section labels are 11px, weight 600, letter-spacing 0.08em, uppercase, `--color-neutral-500`.
- **Radius:** `--radius-sm 4px`, `--radius-md 8px`, `--radius-lg 14px`.
- **Spacing:** `--space-1…8` = 2.8, 5.6, 8.4, 11.2, 16.8, 22.4px. The system is dense on purpose.
- **Shadows:**
  - `--shadow-sm 0 0 0 1px #3f424d`
  - `--shadow-md 0 0 0 1px #595d6c, 0 6px 18px rgba(0,0,0,.55)`
  - `--shadow-lg 0 0 0 1px #9397ab, 0 16px 40px rgba(0,0,0,.65)`

### Mapping the current variables
The old variables in `index.html` map to the new tokens as follows. Keep the old names as aliases during the migration, then delete them.

| Old | New |
| --- | --- |
| `--bg-primary #1a1a2e` | `--color-bg` |
| `--bg-secondary #16213e` | `--color-surface` |
| `--bg-tertiary #0f3460` | `--color-accent-900` |
| `--bg-input #0d1b2a` | `color-mix(in srgb, var(--color-bg) 60%, transparent)` |
| `--text-primary` | `--color-text` |
| `--text-secondary` | `--color-neutral-400` |
| `--text-muted` | `--color-neutral-500` |
| `--accent #4fc3f7` | `--color-accent` |
| `--accent-hover` | `--color-accent-400` |
| `--accent-dim` | `--color-accent-800` |
| `--border` | `--color-divider` |
| `--success` | green above |
| `--danger` | red above |
| `--warning` | amber above |
| `--radius 6px` | `--radius-md` |
| `--voice-icon` / `--text-icon` | `--color-neutral-400` (icons are no longer colour-coded by type) |
| `--pin-*` | keep the pinned bar's amber family, but retint it from the amber above |

### Visual rules
- **Primary buttons are outlined:** 1px accent border on a transparent fill, never a solid fill. Secondary and ghost buttons use neutral tints.
- **Hover and pressed states** come from the accent ramp. Keyboard focus is `:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px }`.
- **No pure black or white**, and no large accent floods. The accent appears as lines, rings, small badges and soft glows.
- **Menus:**
  - **Surface and padding:** `--color-surface`, `--shadow-lg`, 5px padding.
  - **Items:** 32px tall with a 15px icon. Hover is `--color-accent-900` with `--color-accent-200` text.
  - **Labels and dividers:** optional 10.5px uppercase section labels; 1px `--color-divider` separators.
  - **Danger items** sit last, in red.
- **Dialogs:** use the `.dialog` look. 18–20px title, 13px `--color-neutral-400` subtitle, actions right-aligned (Cancel = secondary). A destructive confirm is a secondary button with red text and a red border.
- **Count badges** (unread): 16–18px tall pill, `--color-accent-800` fill, `--color-accent-200` text, 10.5–11px weight 600.

## Assets
- `design/assets/reson8-logo.png`: the app mark. The repo already has `src/renderer/logo.png` and `assets/icon.*`, so use those.
- **Phosphor icons:** vendor the web font or SVG sprite into `apps/client/assets/`. Then:
  - add the folder to `build.files` in `package.json`;
  - check the CSP `font-src`/`img-src` in `index.html`.
  - Don't load the font from a CDN; the repo vendors everything (see the DeepFilterNet and Noto precedent).
- **Inter:** vendor it the same way if it isn't already bundled.
- **Placeholders:** the uploaded server icon and the stream "screens" in the study are placeholder gradients.

## Files
- `design/Reson8 UI Study.dc.html`: the study, with all frames grouped by turn (newest at the top).
- `design/Reson8 App.dc.html`: the mockup component every frame renders. Read its logic class for edge-case behaviour (overflow math, delete-category branches, update states).
- `design/support.js`: the runtime needed to open the `.dc.html` files.
- `design/_ds/nocturne-…/styles.css`: Nocturne tokens and components.
