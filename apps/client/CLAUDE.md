# CLAUDE.md — apps/client

Guidance specific to the Reson8 Electron client. See the repo-root `CLAUDE.md` first for architecture and cross-cutting conventions (shared-types-first workflow, progress.txt logging requirement, etc).

## Commands

```bash
npm run dev             # tsc --build && copy-html.mjs && electron .
npm run typecheck        # tsc --noEmit (verification step)
npm run build:linux       # electron-builder --linux (also :win, :mac)
```

`npm run dev` is the full loop — it rebuilds TS, copies `renderer/index.html` into `dist/`, and launches Electron. There's no watch mode; re-run after changes.

## Structure

- `src/main.ts` — Electron main process: window creation, system tray, global-shortcut PTT registration, mic permission auto-grant, native right-click context menu, link-preview fetching (metascraper) via IPC, `is-window-focused` IPC handler.
- `src/preload.ts` — the entire `contextBridge` surface (`reson8Api`, 60+ methods) exposed to the renderer. Any new capability the renderer needs from Node/Electron/Socket.io goes through here.
- `src/renderer/renderer.ts` — the UI itself: vanilla TypeScript + DOM, no framework. Channel tree rendering, tabbed chat, settings modal, emoji picker, sound alerts, all client-side state.
- `src/renderer/index.html` — markup + all CSS (no separate stylesheet or CSS framework).
- `src/services/voice.service.ts` — mediasoup-client engine: transport/producer/consumer lifecycle, the 6-step handshake client side, noise-gate (AnalyserNode-based), device selection.
- `src/instance-id.ts` — persistent UUID generation/storage (fresh per launch in dev, persisted in packaged builds).
- `assets/` — tray icon, sound-alert `.mp3` files, app icons. Anything added here must also be added to `build.files` in `package.json` or it won't exist in packaged builds (bit this project once — see root CLAUDE.md's Electron gotchas).

## Conventions worth knowing

- The main/preload/renderer boundary is a real security boundary in Electron — new features that need Node or IPC access get a `preload.ts` method, not direct access from the renderer.
- Audio elements: always `document.createElement("audio")` appended to `document.body`, never a detached `new Audio()` — see root CLAUDE.md.
- Anything persisted client-side uses `localStorage` with a `reson8-*` key prefix (grep for `reson8-` in `renderer.ts` to see the existing key namespace before adding a new one).
