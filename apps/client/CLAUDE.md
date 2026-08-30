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
- `src/services/voice.service.ts` — mediasoup-client engine: transport/producer/consumer lifecycle, the 6-step handshake client side, device selection. Owns the send-side mic processing graph (`micSourceNode → [noiseCancelNode] → gateGainNode → volumeGainNode → destination → produce()`) — noise gate (GainNode envelope, not `track.enabled`), mic volume, and AI noise cancelling (DeepFilterNet3 via WASM, loaded through an indirect dynamic `import()` — see Conventions below) all extend this one graph rather than each building their own.
- `src/instance-id.ts` — persistent UUID generation/storage (fresh per launch in dev, persisted in packaged builds).
- `assets/` — tray icon, sound-alert `.mp3` files, app icons, and `deepfilternet/` (the vendored noise-cancelling WASM + ONNX model, ~24MB, fetched via a relative path from `index.html` exactly like the sound alerts — deliberately vendored rather than left on the package's default third-party CDN). Anything added here must also be added to `build.files` in `package.json` or it won't exist in packaged builds (bit this project once — see root CLAUDE.md's Electron gotchas).

## Conventions worth knowing

- The main/preload/renderer boundary is a real security boundary in Electron — new features that need Node or IPC access get a `preload.ts` method, not direct access from the renderer.
- Audio elements: always `document.createElement("audio")` appended to `document.body`, never a detached `new Audio()` — see root CLAUDE.md.
- Anything persisted client-side uses `localStorage` with a `reson8-*` key prefix (grep for `reson8-` in `renderer.ts` to see the existing key namespace before adding a new one).
- Before adding an npm dependency consumed from `main.ts`/`preload.ts`/`voice.service.ts` (all CommonJS-compiled, per this workspace's tsconfig), check whether the package ships a real CJS build (`npm view <pkg> exports` — look for an actual `"require"` condition, and check there's no top-level `"type": "module"` silently overriding it). A `deepfilternet3-noise-filter`-style ESM-only package will crash the whole preload script at startup ("`ReferenceError: exports is not defined`") if statically imported — and a plain `await import(...)` isn't a safe workaround either, since this project's CommonJS module target rewrites dynamic `import()` back into a deferred `require()`, hitting the same crash lazily instead of at startup. The actual fix, only needed for genuinely ESM-only packages: `new Function("specifier", "return import(specifier)")` — invisible to TypeScript's static analysis, so it can't rewrite it — see `voice.service.ts`'s `dynamicImport` for the full pattern and reasoning. Prefer picking a dependency with a real CJS build (like `markdown-it`) over reaching for this trick when there's a choice.
- The `voice.service.ts` mic processing graph and preview mode (`startMicPreview()`/`getCurrentLevel()`) share the same `audioContext`/`analyser` fields — safe only because `joinVoiceChannel()` constructs a brand-new `VoiceService` per session, so a live call's graph and a pre-join preview never coexist on the same instance.
