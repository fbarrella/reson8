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

- `src/main.ts` — Electron main process: window creation, system tray, global-shortcut PTT registration, mic permission auto-grant, native right-click context menu, link-preview fetching via IPC (a fast `fetch()`+metascraper+OG-tag path first, falling back to a genuinely hidden `BrowserWindow` navigation — `fetchLinkPreviewViaHiddenWindow()` — only when that path is blocked or finds nothing, e.g. sites behind Cloudflare-style bot management), `is-window-focused` IPC handler.
- `src/preload.ts` — the entire `contextBridge` surface (`reson8Api`, 60+ methods) exposed to the renderer. Any new capability the renderer needs from Node/Electron/Socket.io goes through here.
- `src/renderer/renderer.ts` — the UI itself: vanilla TypeScript + DOM, no framework. Channel tree rendering, tabbed chat (cursor-paginated, `IntersectionObserver`-driven infinite scroll-up), settings modal, emoji picker, sound alerts, all client-side state.
- `src/renderer/index.html` — markup + all CSS (no separate stylesheet or CSS framework).
- `src/services/voice.service.ts` — mediasoup-client engine: transport/producer/consumer lifecycle, the 6-step handshake client side, device selection. Owns the send-side mic processing graph (`micSourceNode → [noiseCancelNode] → gateGainNode → volumeGainNode → destination → produce()`) — noise gate (GainNode envelope, not `track.enabled`), mic volume, AI noise cancelling (DeepFilterNet3 via WASM, loaded through an indirect dynamic `import()` — see Conventions below, adjustable suppression strength via `setSuppressionLevel()`), and an optional self-hear monitor (taps post-volume straight to local playback) all extend this one graph rather than each building their own.
- `src/markdown.ts` — chat Markdown renderer: a *pure* module (no Electron/DOM imports) on `markdown-it`, imported by `preload.ts` and exposed to the renderer as `renderMarkdown`/`markdownToPlainText`/`setCustomEmojis`. See the root `CLAUDE.md`'s "Chat messages" paragraph; verify changes with `npm run test:markdown` (`scripts/markdown-smoke.mjs`, includes XSS vectors).
- `src/window-state.ts` — persists/restores the main window's bounds + maximized state (`userData/window-state.json`), validated against the displays that currently exist; every failure falls back to defaults.
- `src/instance-id.ts` — persistent UUID generation/storage (fresh per launch in dev, persisted in packaged builds).
- `assets/` — tray icon, sound-alert `.mp3` files, app icons, and `deepfilternet/` (the vendored noise-cancelling WASM + ONNX model, ~24MB, fetched via a relative path from `index.html` exactly like the sound alerts — deliberately vendored rather than left on the package's default third-party CDN). `fonts/noto-color-emoji/` holds the vendored COLRv1 emoji font (see the root `CLAUDE.md`'s "Emoji rendering" — don't swap in the SVG-format build, and keep the stripped `unicode-range`s). Anything added here must also be added to `build.files` in `package.json` or it won't exist in packaged builds (bit this project once — see root CLAUDE.md's Electron gotchas).

## Conventions worth knowing

- Message text is only ever rendered through `setMessageBody()` in `renderer.ts` (Markdown → allow-list sanitizer → `innerHTML`); the chat input is a `<textarea>` auto-sized by `autosizeChatInput()` (it adds the border back — `scrollHeight` excludes it — or a scrollbar sliver appears).
- The image viewer (`openLightbox(url, meta?)`) lays the image out at natural size and zooms/pans with `transform` only; its toolbar actions use the validated IPC in `main.ts` (`open-external-url`, `copy-text-to-clipboard`, `copy-png-to-clipboard`, `fetch-image-bytes`). The reaction hover card is one shared `#reaction-card` (`showReactionCard`/`hideReactionCard`), re-hidden whenever a reaction bar is rebuilt.
- The own-voice speaking halo is gated on `isLocalMicTransmitting()` (not muted, not deafened, PTT held in PTT mode) — the local analyser taps before mute takes effect, so level alone is not "being heard".
- To test renderer behavior against the real built app without a UI harness: launch `electron . --remote-debugging-port=<p>` (add `--inspect=<q>` for the main process) and drive it over the DevTools protocol; trusted mouse events via `Input.dispatchMouseEvent`. (Don't `pkill -f` a pattern that also appears in your own command line.)
- The main/preload/renderer boundary is a real security boundary in Electron — new features that need Node or IPC access get a `preload.ts` method, not direct access from the renderer.
- Audio elements: always `document.createElement("audio")` appended to `document.body`, never a detached `new Audio()` — see root CLAUDE.md.
- Anything persisted client-side uses `localStorage` with a `reson8-*` key prefix (grep for `reson8-` in `renderer.ts` to see the existing key namespace before adding a new one).
- Before adding an npm dependency consumed from `main.ts`/`preload.ts`/`voice.service.ts` (all CommonJS-compiled, per this workspace's tsconfig), check whether the package ships a real CJS build (`npm view <pkg> exports` — look for an actual `"require"` condition, and check there's no top-level `"type": "module"` silently overriding it). A `deepfilternet3-noise-filter`-style ESM-only package will crash the whole preload script at startup ("`ReferenceError: exports is not defined`") if statically imported — and a plain `await import(...)` isn't a safe workaround either, since this project's CommonJS module target rewrites dynamic `import()` back into a deferred `require()`, hitting the same crash lazily instead of at startup. The actual fix, only needed for genuinely ESM-only packages: `new Function("specifier", "return import(specifier)")` — invisible to TypeScript's static analysis, so it can't rewrite it — see `voice.service.ts`'s `dynamicImport` for the full pattern and reasoning. Prefer picking a dependency with a real CJS build (like `markdown-it`) over reaching for this trick when there's a choice.
- The `voice.service.ts` mic processing graph and preview mode (`startMicPreview()`/`getCurrentLevel()`) share the same `audioContext`/`analyser`/`gateGainNode`/`volumeGainNode` fields via a common `buildProcessingChain()` helper — preview mode builds the identical noise-gate/mic-volume/noise-cancelling chain a real call does, not just a bare analyser tap, so the mic meter, noise gate, and self-hear monitor all behave identically whether previewing or in a call. Sharing these fields is safe only because `joinVoiceChannel()` constructs a brand-new `VoiceService` per session, so a live call's graph and a pre-join preview never coexist on the same instance.
