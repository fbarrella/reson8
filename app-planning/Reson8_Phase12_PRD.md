# Reson8 — Phase 12 PRD

**Created:** 23/08/2026
**Author:** Felipe B. Netto (assisted by AI)
**Status:** Draft — Pending Review
**Feature:** Screen Sharing & Native Audio Capture
**Branch:** `phase-12`

---

## Table of Contents

1. [Overview & Goals](#overview--goals)
2. [Decisions Confirmed With the User](#decisions-confirmed-with-the-user)
3. [High-Level Architecture](#high-level-architecture)
4. [Epic 1 — Native Audio Module (`packages/native-audio`)](#epic-1--native-audio-module-packagesnative-audio)
   - [PRD 12.1 — Monorepo Package Scaffold](#prd-121--monorepo-package-scaffold)
   - [PRD 12.2 — Windows: WASAPI Per-Process Loopback](#prd-122--windows-wasapi-per-process-loopback)
   - [PRD 12.3 — Linux: PipeWire / PulseAudio / ALSA Capture](#prd-123--linux-pipewire--pulseaudio--alsa-capture)
   - [PRD 12.4 — macOS: Unsupported Stub](#prd-124--macos-unsupported-stub)
   - [PRD 12.5 — Unified Local Build & Release Script](#prd-125--unified-local-build--release-script)
5. [Epic 2 — Capture & Transport (Electron & mediasoup)](#epic-2--capture--transport-electron--mediasoup)
   - [PRD 12.6 — Source Discovery (`desktopCapturer`)](#prd-126--source-discovery-desktopcapturer)
   - [PRD 12.7 — Audio Pipeline: native-audio → Renderer → mediasoup](#prd-127--audio-pipeline-native-audio--renderer--mediasoup)
   - [PRD 12.8 — Video Pipeline: SVC Producer](#prd-128--video-pipeline-svc-producer)
6. [Epic 3 — UI/UX: Controls & Selection](#epic-3--uiux-controls--selection)
   - [PRD 12.9 — Voice Panel 2×2 Grid Refactor](#prd-129--voice-panel-2x2-grid-refactor)
   - [PRD 12.10 — Source Selection Modal](#prd-1210--source-selection-modal)
   - [PRD 12.11 — Share-Audio Checkbox Logic](#prd-1211--share-audio-checkbox-logic)
7. [Epic 4 — UI/UX: Visualization & Administration](#epic-4--uiux-visualization--administration)
   - [PRD 12.12 — Sharing Badge in Channel Tree](#prd-1212--sharing-badge-in-channel-tree)
   - [PRD 12.13 — Viewer Window](#prd-1213--viewer-window)
   - [PRD 12.14 — Server-Wide Admin Toggle](#prd-1214--server-wide-admin-toggle)
8. [Data Model Changes](#data-model-changes)
9. [Socket.io Event Summary](#socketio-event-summary)
10. [Cross-Cutting Dependencies & Implementation Order](#cross-cutting-dependencies--implementation-order)
11. [Explicitly Out of Scope](#explicitly-out-of-scope)
12. [Known Risks](#known-risks)

> [!IMPORTANT]
> Every item below gets its own `app-planning/progress.txt` entry via
> `/log-progress`, in the established `--- Entry: DD/MM/YYYY ---` format, as
> part of finishing that item — not optional cleanup. When every item is
> implemented and verified, run `/bump-version` and update `README.md`
> (Roadmap row, Features section, version badge) to reflect the final Phase 12
> feature set.

> [!NOTE]
> This PRD was written after reading the current voice signaling handshake
> (`voice.handler.ts`, `voice.service.ts`), the presence/occupant pipeline
> (`presence.service.ts`, `connection.handler.ts`), the Nudge feature as the
> reference implementation for a server-wide admin toggle
> (`nudge.handler.ts`, `models.ts`, `schema.prisma`), and the client's actual
> UI stack (`renderer.ts`, `index.html`) — not from the brief alone. File
> paths and line numbers reflect the code as of 23/08/2026 (post v1.4.1,
> `main`) — re-check them if the surrounding code has moved by the time an
> item is implemented.
>
> **Correction to the originating brief:** the brief described the stack as
> "Electron, React, Fastify, Prisma, and mediasoup." The client has no React
> anywhere — `apps/client/src/renderer/` is ~5,000 lines of vanilla
> TypeScript + DOM manipulation over a ~3,000-line `index.html` with inline
> CSS, no bundler, no framework (confirmed in `apps/client/CLAUDE.md` and in
> the code itself). Per your direction (see below), this PRD specs every UI
> item in that same vanilla pattern — new markup added to `index.html`, wired
> up in `renderer.ts`, consistent with how Nudge, NSFW badges, and the emoji
> picker were built.

---

## Overview & Goals

Phase 12 adds two related capabilities:

1. **Screen sharing** — any voice-channel participant can share a screen or
   application window (video, optionally with audio) to other occupants of
   that channel, viewable in a dedicated pop-out window.
2. **Native per-application audio capture** — a new Rust/NAPI-RS native
   module (`packages/native-audio`) that captures loopback audio scoped to a
   *specific process* (not full-system loopback), used to power the
   "share this app's audio" option when sharing a window.

This is the first native (non-TypeScript) code and the first Rust toolchain
dependency in the monorepo. It is also the first feature requiring a change
to the mediasoup Router's codec set (video, currently audio-only).

Both capabilities are gated by a new server-wide admin toggle
(`screenShareEnabled`), mirroring the existing Nudge toggle exactly.

---

## Decisions Confirmed With the User

These were open questions in the original brief, resolved before writing the
rest of this document — recorded here so later phases don't re-litigate them:

1. **Client UI stack:** vanilla TypeScript + DOM, extending the existing
   `index.html` / `renderer.ts` pattern. No React, no new client build
   tooling. (See the Note above.)
2. **Native build & release:** a single unified local script
   (`npm run release:all` at the repo root — see
   [PRD 12.5](#prd-125--unified-local-build--release-script)) drives both the
   Rust builds and the three electron-builder packaging targets from one
   command, with the realistic caveat that cross-compiling a *macOS*
   electron-builder artifact still requires running that script on macOS
   hardware (Apple's toolchain/codesigning cannot be cross-compiled from
   Linux — this is an electron-builder/Apple constraint, not something this
   PRD can script around). Linux and Windows builds work from a single
   Linux host.
3. **Screen-share audio transport:** the renderer-side path. `native-audio`
   hands PCM to the Electron main process, which forwards it via IPC to the
   renderer, where it's assembled into a `MediaStreamTrack` and produced
   through the *existing* `mediasoup-client` path in `voice.service.ts`. No
   `wrtc` / Node-side WebRTC dependency.
4. **Concurrency model:** multiple participants in the same voice channel
   may share screens simultaneously; any viewer may open multiple Viewer
   windows to watch multiple streams at once. No artificial one-at-a-time
   restriction.

---

## High-Level Architecture

```
Sharer's machine                                          Viewer's machine
─────────────────                                          ────────────────
desktopCapturer (main)                                     Voice Panel badge click
   │ sources+thumbnails                                       │
   ▼                                                           ▼
Selection Modal (renderer)                                 confirm() prompt
   │ chosen source + audio?                                    │
   ▼                                                           ▼
native-audio (Rust, main)         IPC              new BrowserWindow (viewer.html)
   │ PCM frames  ────────────────────────►                     │ own preload + socket
   ▼                                                           ▼
renderer: MediaStreamTrack (audio)                  mediasoup-client Device
   +
getUserMedia({video: chromeMediaSource: desktop}) (video)
   │
   ▼
voice.service.ts → mediasoup-client Producers (kind=video, SVC + kind=audio)
   │  reuses the sharer's existing send Transport from the voice handshake
   ▼
mediasoup Router (server) ── new video codec (VP9, SVC scalabilityMode)
   │
   ▼
Consumers created on-demand per viewer window via WATCH_SCREEN_SHARE
```

The sharer does **not** open a new transport for sharing — screen
video/audio are additional `Producer`s on the send `Transport` already
created during the normal voice-channel join handshake
(`GET_ROUTER_CAPABILITIES → CREATE_WEBRTC_TRANSPORT → CONNECT_TRANSPORT →
PRODUCE`). Only `PRODUCE` is called again, with a new `appData.mediaType`
tag (`"screen-video"` / `"screen-audio"`) so the server can distinguish
these producers from the regular mic producer when closing them.

The **viewer window is a second, independent renderer** with its own
lightweight Socket.io connection and its own recv-only mediasoup `Transport`
— it does not share JS state with the main window (Electron `BrowserWindow`s
are separate processes). It only ever consumes; it never joins presence,
never appears in the channel tree twice. See
[PRD 12.13](#prd-1213--viewer-window).

---

## Epic 1 — Native Audio Module (`packages/native-audio`)

### PRD 12.1 — Monorepo Package Scaffold

**Type:** ⚙️ Infrastructure
**Priority:** Highest (blocks all of Epic 1–2)
**Affected Components:** New package `packages/native-audio`, root
`package.json`, `apps/client/package.json`.

**Folder structure:**

```
packages/native-audio/
  Cargo.toml                # crate manifest, napi-rs + platform-conditional deps
  package.json               # "@reson8/native-audio", napi-rs npm wrapper
  build.rs                    # napi-build glue
  index.d.ts                   # hand-authored (or napi-generated) TS types
  index.js                      # platform-detecting loader (napi-rs convention):
                                  # picks native-audio.<platform>-<arch>.node by
                                  # process.platform/arch at require time
  src/
    lib.rs                       # #[napi] bindings — exported JS-facing API
    windows.rs                    # WASAPI PID-loopback implementation
    linux.rs                       # PipeWire → Pulse → ALSA cascade
    macos.rs                        # stub, returns Unsupported
    types.rs                         # shared enums/structs (CaptureStatus, etc.)
  prebuilds/                        # committed .node binaries per platform,
                                      # produced by PRD 12.5's release script,
                                      # NOT built from source on every install
```

**Why prebuilt binaries committed to the repo (not built on `npm install`):**
this repo has no CI and one maintainer; requiring a Rust toolchain on every
dev/build machine to run `npm install` would break the existing "clone,
`npm install`, `npm run dev`" workflow for anyone without `cargo`. Prebuilt
`.node` files checked into `packages/native-audio/prebuilds/` (regenerated
by the release script whenever native-audio changes) keep the npm-only
workflow intact for everyone who isn't actively changing the Rust code.

**JS-facing API surface (`index.d.ts`):**

```ts
export type CaptureStatus = "capturing" | "unsupported" | "permission-denied" | "error";

export interface AudioSourceTarget {
  /** OS process id whose audio output should be captured (Windows/Linux). */
  pid?: number;
  /** Best-effort process/app name, used for Linux stream-matching by name
   *  when a PID-level match isn't available (see PRD 12.3). */
  processName?: string;
}

export interface CaptureHandle {
  status: CaptureStatus;
  /** Only present when status === "capturing". */
  stop(): void;
}

/** Starts capture; onFrame is called with 16-bit PCM interleaved stereo
 *  buffers at 48kHz (opus-compatible) as they become available. */
export function startCapture(
  target: AudioSourceTarget,
  onFrame: (pcm: Buffer, sampleRate: number, channels: number) => void,
): CaptureHandle;

export function platformSupportsCapture(): boolean;
```

**Root/client wiring:**
- `packages/native-audio` is picked up automatically by the existing
  `workspaces: ["packages/*", "apps/*"]` glob in root `package.json` — no
  change needed there.
- `apps/client/package.json` dependencies: add
  `"@reson8/native-audio": "*"`.
- `apps/client/package.json` `build.files` (electron-builder) must add
  `"node_modules/@reson8/native-audio/prebuilds/**/*"` — same gotcha class
  as the tray-icon/sound-alert issue already documented in the root
  CLAUDE.md ("files referenced by the main process must be listed in
  `build.files` or they silently vanish from packaged builds").
- Because `npmRebuild: false` is already set in `apps/client/package.json`,
  electron-builder will **not** attempt to recompile native modules during
  packaging — it will simply copy whatever `.node` file is present, which is
  exactly what we want given prebuilds are committed ahead of time.

**Verification:** `node -e "console.log(require('@reson8/native-audio').platformSupportsCapture())"` from `apps/client` returns `true`/`false` correctly per host OS; `npx tsc --noEmit` clean in `apps/client` after adding the dependency and its `.d.ts`.

---

### PRD 12.2 — Windows: WASAPI Per-Process Loopback

**Type:** ✨ Feature
**Priority:** High
**Affected Components:** `packages/native-audio/src/windows.rs`.

**Business rules:**
- Capture must be scoped to a single process id, not full-system loopback —
  this is what makes "share this window's audio" meaningfully different
  from "share my whole desktop's audio."
- Requires the Windows 10 2004+ (build 19041+) **Process Loopback API**
  (`AUDIOCLIENT_ACTIVATION_PARAMS` with
  `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`,
  `PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE`) via
  `ActivateAudioInterfaceAsync`. Rust crates: `windows` (official
  `windows-rs`, already MIT/Apache-2.0, actively maintained by Microsoft) for
  the COM/WASAPI bindings.
- On Windows versions older than build 19041, `startCapture` for a
  process-scoped target must return `status: "unsupported"` — do not
  silently fall back to full-system loopback, since that would violate the
  "audio checkbox only for app windows" business rule in
  [PRD 12.11](#prd-1211--share-audio-checkbox-logic) by leaking other apps'
  audio into what the user believes is a scoped share.
- PID resolution: the renderer already knows the target window's PID from
  `desktopCapturer`'s source metadata is *not* guaranteed to include a PID
  directly (Electron's `DesktopCapturerSource` doesn't expose it). The main
  process must resolve PID via the window's HWND
  (`GetWindowThreadProcessId`) — add a small `win32-hwnd-to-pid` helper
  inside `windows.rs` itself (exposed as a second `#[napi]` function
  `resolvePidForWindowTitle` or, preferably, matched by
  `source.id` which Electron formats as `"window:<HWND>:<id>"` on Windows —
  parse the HWND out of that string rather than title-matching, which is
  fragile with duplicate window titles).

**Verification:** manual — share a specific app window with "Share Audio"
checked on a Windows VM/machine, confirm only that app's audio is heard by a
viewer, confirm other concurrently-running apps' audio is NOT captured.

---

### PRD 12.3 — Linux: PipeWire / PulseAudio / ALSA Capture

**Type:** ✨ Feature
**Priority:** High
**Affected Components:** `packages/native-audio/src/linux.rs`.

**Business rules:**
- Detect the running audio server at capture-start time, in this priority
  order, and use the first one available:
  1. **PipeWire** (via `pipewire` D-Bus/socket presence, or the `pipewire-rs`
     crate) — most current distros (Fedora, recent Ubuntu/Debian, Arch,
     CachyOS) run PipeWire even when apps think they're talking to
     PulseAudio, via `pipewire-pulse`. Per-application loopback here is
     natural: PipeWire exposes each app's *output* as its own node/stream,
     matchable by `application.process.id` (PID) or `application.name`
     metadata — capture by creating a stream node that links to the
     target's monitor.
  2. **PulseAudio** (native, no PipeWire) — use `libpulse-binding` (Rust
     crate) to enumerate sink-inputs, match by `application.process.id`
     property (Pulse exposes this per sink-input), and record from that
     sink-input's monitor source.
  3. **ALSA** (no PulseAudio/PipeWire at all — rare, but some minimal/DE-less
     setups) — ALSA has **no concept of per-application streams**; only
     full-device capture is possible. In this case, `startCapture` must
     return `status: "unsupported"` for a process-scoped target rather than
     silently capturing the whole device — same reasoning as the
     old-Windows case in 12.2. (System-wide desktop audio capture, if ever
     wanted, is out of scope per [Out of Scope](#explicitly-out-of-scope).)
- Matching by **PID** is preferred; matching by **process/app name** is the
  fallback when a compositor or sandboxed app (Flatpak) reports its stream
  under a wrapper PID that doesn't match the actual application PID visible
  to Electron. This is why `AudioSourceTarget.processName` exists alongside
  `pid` in the API — Linux is the platform that actually uses it.
- No elevated permissions should be required for any of the three backends
  in a typical desktop session (PipeWire/Pulse expose per-app streams to
  any session user by default; this is a Windows/macOS-specific concern,
  not a Linux one).

**Verification:** manual, across at least two of the three backends if
feasible (e.g., PipeWire on the dev machine — CachyOS runs PipeWire by
default — plus a PulseAudio-only VM/container if available). Confirm
`platformSupportsCapture()` and backend auto-detection both log which
backend was selected (debug log, not user-facing) for troubleshooting.

---

### PRD 12.4 — macOS: Unsupported Stub

**Type:** ✨ Feature (deliberately minimal)
**Priority:** Medium
**Affected Components:** `packages/native-audio/src/macos.rs`.

**Business rules:**
- `platformSupportsCapture()` returns `false` unconditionally on macOS.
- `startCapture()` returns `{ status: "unsupported" }` immediately — no
  attempt at capture, no permission prompts, no crash.
- This is a genuine OS limitation for v1, not a shortcut: per-application
  loopback capture on macOS requires either a virtual audio driver
  (BlackHole/Loopback-style kernel extension, which cannot be silently
  installed by an app) or `ScreenCaptureKit`'s system-audio capture
  (macOS 13+, Ventura), which captures *system-wide* audio, not
  per-process — it doesn't satisfy the "app window only" business rule in
  [PRD 12.11](#prd-1211--share-audio-checkbox-logic) without additional work
  Apple doesn't currently expose a documented path for. Flagged under
  [Known Risks](#known-risks) as a future-work candidate, not solved here.
- The macOS `.node` prebuild still needs to exist (even though it always
  returns unsupported) so `require('@reson8/native-audio')` doesn't throw on
  macOS — the module must load cleanly, just report no capability.

**Verification:** on macOS, `platformSupportsCapture()` returns `false`;
[PRD 12.11](#prd-1211--share-audio-checkbox-logic)'s UI warning appears and
the audio checkbox is permanently disabled.

---

### PRD 12.5 — Unified Local Build & Release Script

**Type:** ⚙️ Infrastructure
**Priority:** High
**Affected Components:** New `scripts/release-all.mjs` at repo root, root
`package.json` (`"release:all"` script).

**Business rule (per your direction):** one command builds everything
buildable from the current host and packages the client for every platform
reachable from that host, replacing the current fully-manual
`electron-builder` invocation-per-platform.

**Script behavior:**

```
npm run release:all
```

1. Detects host OS (`process.platform`).
2. Builds `packages/native-audio` for every target reachable from this host:
   - **On Linux:** `napi build --release --target x86_64-unknown-linux-gnu`
     (native), and `napi build --release --target x86_64-pc-windows-gnu`
     for Windows — cross-compiled directly via `cargo` with the mingw-w64
     toolchain installed locally (`apt install mingw-w64` /
     `pacman -S mingw-w64-gcc` / `dnf install mingw64-gcc`), no Docker/
     Podman or the `cross` tool needed. **Correction from an earlier draft
     of this PRD:** that draft called for the `cross` tool in a Docker/
     Podman container; implementing PRD 12.1 surfaced that this also has
     to target `x86_64-pc-windows-gnu` rather than `-msvc` (there's no
     realistic way to cross-compile an MSVC-ABI binary from Linux at all —
     that toolchain only exists on Windows), and once the target is
     `-gnu`, plain `cargo`/`napi build` with mingw-w64 on `PATH` handles it
     directly — Docker was never actually necessary. `index.js`'s loader
     tries `win32-x64-gnu` before `win32-x64-msvc`, so a native Windows
     build (which typically defaults to MSVC) still works if ever produced
     that way instead. `napi build` (rather than raw `cargo build`) is used
     throughout so `@napi-rs/cli` handles the target-triple-to-filename
     mapping (`native-audio.<platform>-<arch>-<abi>.node`) instead of this
     script re-implementing that convention by hand. Output lands directly
     in `packages/native-audio/prebuilds/` via `--output-dir`.
   - **On macOS:** `napi build --release --target <host-triple>`
     (`aarch64-apple-darwin` or `x86_64-apple-darwin`, whichever matches
     the host) — and the other Mac arch too, but *only* if
     `rustup target list --installed` already shows it installed (the
     script checks and skips with a `rustup target add ...` hint rather
     than silently installing a new target on its own).
   - **On Windows:** `napi build --release --target x86_64-pc-windows-msvc`
     natively.
3. Runs `apps/client`'s `tsc --build` + `copy-html.mjs` (same as today's
   `prebuild`).
4. Runs `electron-builder` for every platform target reachable from this
   host:
   - **From Linux:** `--linux` (native) and `--win` (electron-builder's
     Windows target build is supported cross-platform from Linux via
     bundled Wine — this already works today, unrelated to native-audio).
   - **From macOS:** `--mac`, plus `--linux`/`--win` if the maintainer wants
     to cut a full release from a Mac in one pass.
   - **From Windows:** `--win` only; Linux is deliberately not attempted
     from a Windows host — electron-builder's Linux cross-build story from
     Windows is far less reliable than from Linux/macOS.
5. Prints a **summary table** at the end: which platform artifacts were
   produced, and which were skipped with a one-line reason (e.g. `mac: SKIPPED — macOS artifacts require running this script on macOS hardware (Apple toolchain/codesigning cannot be cross-compiled)`). No silent gaps — the whole point of "one npm run" is knowing exactly what you got out of it.
6. Exits non-zero if any *attempted* platform build fails; skipped (not
   attempted) platforms don't fail the run. A missing `cargo` on `PATH`
   entirely skips the whole native-audio phase (with that reason) rather
   than attempting and failing each target individually.

Implemented as `scripts/release-all.mjs` (root) + a `"release:all"` script
in root `package.json`. Verified in this environment via `node --check` and
an actual `--dry-run` pass on the Linux dev machine — the orchestration
logic (host detection, plan construction, skip reasons, summary table, exit
code) is real, tested Node.js, unlike the unverified Rust in Epic 1. The
individual `cargo`/`napi build`/`electron-builder` subprocess invocations
themselves weren't run for real (no Rust toolchain, no mingw-w64, no
network-verified electron-builder run in this environment).

**Explicit limitation (see [Decisions Confirmed](#decisions-confirmed-with-the-user) #2):**
this script cannot make a Linux-only machine produce macOS build artifacts —
that boundary is Apple's, not this script's. To cut a full 3-platform
release, the maintainer runs `npm run release:all` once per host OS they
have access to (e.g., once on the CachyOS dev machine for Linux+Windows,
once on a Mac for macOS), same as today's release process already
effectively requires for signing reasons, just now with one command per
host instead of several manual steps.

**Verification:** run `npm run release:all` on the Linux dev machine,
confirm Linux `AppImage` + Windows `nsis` installer are both produced under
`apps/client/release/`, confirm the summary table correctly reports macOS as
skipped with the reason above.

---

## Epic 2 — Capture & Transport (Electron & mediasoup)

### PRD 12.6 — Source Discovery (`desktopCapturer`)

**Type:** ✨ Feature
**Priority:** High
**Affected Components:** `apps/client/src/main.ts` (new IPC handler),
`apps/client/src/preload.ts`.

**Business rules:**
- New main-process IPC handler `get-desktop-sources`, called from the
  renderer when the Selection Modal ([PRD 12.10](#prd-1210--source-selection-modal))
  opens. Uses Electron's `desktopCapturer.getSources({ types: ["screen",
  "window"], thumbnailSize: { width: 240, height: 135 }, fetchWindowIcons:
  true })` — thumbnail size deliberately small (240×135, 16:9) since these
  are list-item previews, not the shared video itself; keeps the IPC payload
  light or a channel with many windows open.
- Each source in the response carries: `id` (needed later to constrain
  `getUserMedia`'s `chromeMediaSourceId`), `name`, `thumbnail` (data URL),
  `appIcon` (data URL, windows only), and a `sourceType: "screen" | "window"`
  discriminator derived from the `id` prefix (`desktopCapturer` ids are
  formatted `"screen:<n>:<m>"` / `"window:<hwnd-or-id>:<n>"`).
- Re-fetched every time the modal opens (sources can appear/disappear as
  windows open/close) — not cached across modal opens.

**Preload surface addition:**
```ts
getDesktopSources(): Promise<Array<{
  id: string; name: string; thumbnail: string; appIcon: string | null;
  sourceType: "screen" | "window";
}>>;
```

**Verification:** open the Selection Modal with several app windows open,
confirm all appear with correct thumbnails and the screen/window
discriminator is correct.

---

### PRD 12.7 — Audio Pipeline: native-audio → Renderer → mediasoup

**Type:** ✨ Feature
**Priority:** High
**Affected Components:** `apps/client/src/main.ts`, `apps/client/src/preload.ts`, `apps/client/src/services/voice.service.ts`.

**Business rule:** only reachable when the selected source is a window (not
a full screen/monitor) and the platform supports capture — see
[PRD 12.11](#prd-1211--share-audio-checkbox-logic) for the full gating
logic; this item is the pipeline, not the gating decision.

**Pipeline (per [Decision #3](#decisions-confirmed-with-the-user)):**
1. Renderer resolves the target window's PID (Windows: via the `id` string
   as in [PRD 12.2](#prd-122--windows-wasapi-per-process-loopback); Linux:
   best-effort from Electron's window metadata, falling back to
   `processName` matching per [PRD 12.3](#prd-123--linux-pipewire--pulseaudio--alsa-capture)).
2. Renderer calls a new preload method `startAppAudioCapture(pid, processName)`,
   which IPCs to main.
3. Main calls `@reson8/native-audio`'s `startCapture()`, receiving PCM
   frames via the `onFrame` callback.
4. Main forwards each PCM frame to the renderer via
   `webContents.send("app-audio-frame", buffer, sampleRate, channels)`.
   *(Frequency/chunking note: frames should be batched to ~20ms chunks
   before sending, matching Opus's native frame size, to avoid flooding the
   IPC channel with tiny buffers.)*
5. Renderer feeds frames into a `MediaStreamTrackGenerator` (or, if broader
   Electron/Chromium version support is needed, an `AudioWorkletNode`
   writing into a `MediaStreamDestinationNode` from an `AudioContext`) to
   produce a real `MediaStreamTrack`.
6. That track is added to the *same* `mediasoup-client` `Device`/send
   `Transport` already open for the voice channel — `voice.service.ts`
   gains a new method `produceScreenAudio(track: MediaStreamTrack)` that
   mirrors the existing mic-`produce()` call but tags
   `appData: { mediaType: "screen-audio" }`.
7. `native-audio`'s `stop()` is called (and the IPC frame stream torn down)
   when the share ends — see [PRD 12.9](#prd-129--voice-panel-2x2-grid-refactor)'s
   stop-sharing path.

**Verification:** share a window with a distinct, continuous audio source
(e.g. a video playing in a browser window) with "Share Audio" checked;
confirm a viewer hears that audio and does not hear the sharer's
microphone-channel voice mixed into the same stream (they arrive as
separate mediasoup Producers/Consumers, so this should hold structurally —
verify it does).

---

### PRD 12.8 — Video Pipeline: SVC Producer

**Type:** ✨ Feature
**Priority:** Highest (core of the feature)
**Affected Components:** `apps/server/src/config/mediasoup.config.ts`,
`apps/server/src/handlers/voice.handler.ts`,
`apps/client/src/services/voice.service.ts`.

**Business rules:**
- The Router's `mediaCodecs` currently contains only Opus
  (`apps/server/src/config/mediasoup.config.ts`). Add a video codec entry:
  ```ts
  {
    kind: "video",
    mimeType: "video/VP9",
    clockRate: 90000,
    parameters: { "profile-id": 2 },
  }
  ```
  VP9 is chosen over AV1 for v1: mediasoup/libwebrtc's VP9 SVC support is
  mature and battle-tested; AV1 SVC support is newer and less consistently
  available across the Chromium versions bundled with different Electron
  releases. Revisit AV1 in a later phase once broader support is confirmed.
- Video capture on the sharer's side uses `navigator.mediaDevices.getUserMedia`
  with Electron's `chromeMediaSource: "desktop"` constraint (the standard
  Electron `desktopCapturer` + `getUserMedia` pairing), constrained to the
  chosen `chromeMediaSourceId` from [PRD 12.6](#prd-126--source-discovery-desktopcapturer).
- The resulting video track is produced via `mediasoup-client`'s `produce()`
  with an **SVC `encodings` array**, e.g.:
  ```ts
  transport.produce({
    track: videoTrack,
    encodings: [{ scalabilityMode: "L3T3_KEY", maxBitrate: 2_500_000 }],
    codecOptions: { videoGoogleStartBitrate: 1000 },
    appData: { mediaType: "screen-video" },
  });
  ```
  `L3T3_KEY` gives 3 spatial + 3 temporal layers with a key-frame-only base
  layer — mediasoup's `Consumer.setPreferredLayers()` lets each individual
  viewer's Consumer request a lower spatial/temporal layer without the
  sharer re-encoding, which is the entire point of using SVC here (one
  encode, many viewer-appropriate qualities/bandwidths).
- Server-side, `PRODUCE` handling in `voice.handler.ts` needs no new event —
  it already accepts arbitrary `kind`/`rtpParameters`; it only needs the
  Router to declare the video codec (done above) and `appData.mediaType` to
  be threaded through so [PRD 12.12](#prd-1212--sharing-badge-in-channel-tree)
  can tell a screen-video producer apart from a future webcam producer
  (out of scope here, but the tagging convention should anticipate it).
- Viewer-side Consumers ([PRD 12.13](#prd-1213--viewer-window)) should call
  `consumer.setPreferredLayers({ spatialLayer, temporalLayer })` based on
  the Viewer window's own size/bandwidth — start at the highest layer and
  let the existing mediasoup `AudioLevelObserver`-adjacent bandwidth
  estimation (already running for the voice SFU) inform step-downs; exact
  ABR heuristic can be simple (fixed high-quality default, manual
  quality picker deferred) for v1.

**Verification:** two clients in the same voice channel; one shares a
screen with visible motion (e.g. a video); the other watches via the Viewer
window and sees smooth video. Confirm via `chrome://webrtc-internals`
(reachable from the Electron renderer in dev) that the encoding reports
multiple spatial/temporal layers.

---

## Epic 3 — UI/UX: Controls & Selection

### PRD 12.9 — Voice Panel 2×2 Grid Refactor

**Type:** 🎨 UI Refactor
**Priority:** High
**Affected Components:** `apps/client/src/renderer/index.html` (lines
~2495–2508, `#voice-panel` / `#voice-controls` — see current markup below),
`apps/client/src/renderer/renderer.ts`.

**Current state** (`index.html:2503-2507`):
```html
<div id="voice-controls">
  <button class="voice-btn" id="btn-mute" title="Mute">🎤 Mute</button>
  <button class="voice-btn" id="btn-deafen" title="Deafen">🔊 Deafen</button>
  <button class="voice-btn leave" id="btn-leave-voice" title="Leave Voice">✕</button>
</div>
```
Three inline emoji buttons in a row.

**New layout:** `#voice-controls` becomes a `display: grid;
grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 6px;`
2×2 grid:

```
┌────────────┬────────────┐
│  🎤 Mute    │  🔊 Deafen  │
├────────────┼────────────┤
│  🖥️ Share   │  ✕ Leave    │
└────────────┴────────────┘
```
(icons shown as placeholders above — all four become inline SVGs, following
the exact pattern already used for the gear/settings icon at
`index.html:2480-2486`: `<svg viewBox="0 0 24 24" fill="none"
stroke="currentColor" stroke-width="2" ...>`, so they inherit button
text color and hover states for free, same as the settings gear does.)

**New button:** `id="btn-share-screen"`, title "Share Screen". Behavior:
- Not sharing → click opens the Selection Modal ([PRD 12.10](#prd-1210--source-selection-modal)).
- Currently sharing → button shows an active/highlighted state (reuse the
  existing `.voice-btn` active-state styling pattern already used for
  mute/deafen toggled state, if present — check `#btn-mute.active` CSS,
  apply the same class convention to `#btn-share-screen`); click stops the
  active share directly (no modal), tearing down the screen producers and
  (if applicable) `native-audio` capture.
- Disabled (grayed, tooltip "Screen sharing is disabled on this server")
  when the admin toggle from [PRD 12.14](#prd-1214--server-wide-admin-toggle)
  is off — mirrors exactly how the Nudge button set (`btn-nudge`) is
  conditionally rendered based on `serverNudgeEnabled` in `renderer.ts:3190`.
- Only enabled at all while connected to a voice channel (the button only
  exists inside `#voice-panel`, which is already only visible while
  connected — no extra guard needed beyond what's structurally already
  true).

**Verification:** visually confirm the 2×2 grid renders correctly at the
existing sidebar width, confirm all four SVG icons render (no missing
glyphs), confirm mute/deafen/leave behavior is unchanged from before the
refactor (this is a layout/icon change, not a logic change, for those
three).

---

### PRD 12.10 — Source Selection Modal

**Type:** ✨ Feature
**Priority:** High
**Affected Components:** `apps/client/src/renderer/index.html` (new modal,
follow the `#nsfw-confirm-modal` structural pattern at lines
~2615-2623 — overlay div, `.visible` class toggle, cancel/confirm buttons),
`apps/client/src/renderer/renderer.ts`.

**Business rules:**
- Triggered by `#btn-share-screen` when not currently sharing.
- Calls `api.getDesktopSources()` ([PRD 12.6](#prd-126--source-discovery-desktopcapturer))
  on open; renders a scrollable grid of source cards (thumbnail + name),
  grouped under two headers: "Screens" and "Application Windows" (derived
  from each source's `sourceType`).
- Clicking a card selects it (visually highlighted, same selected-state
  pattern as other selectable list items in this codebase — e.g. channel
  tree active-item styling); does not immediately start sharing.
- Below the grid: the "Share Audio" checkbox (behavior specified fully in
  [PRD 12.11](#prd-1211--share-audio-checkbox-logic)) and a "Start Sharing" /
  "Cancel" button pair, following the existing `.btn` / `.btn-cancel` /
  `.btn-disconnect`-style button classes already used across the app's
  modals.
- "Start Sharing" is disabled until a source is selected.
- On confirm: closes the modal, then runs the full start-sharing sequence
  (video `getUserMedia` + `produce()` from [PRD 12.8](#prd-128--video-pipeline-svc-producer),
  optionally the audio pipeline from [PRD 12.7](#prd-127--audio-pipeline-native-audio--renderer--mediasoup)
  if the checkbox was checked and enabled), then emits `SET_SCREEN_SHARE_STATE`
  ([Socket.io Event Summary](#socketio-event-summary)) so the badge appears
  for others.

**Verification:** open the modal, confirm screens and windows are correctly
grouped and thumbnails match what's actually open on the desktop; confirm
"Start Sharing" is disabled with nothing selected.

---

### PRD 12.11 — Share-Audio Checkbox Logic

**Type:** ✨ Feature (business logic, lives inside 12.10's modal)
**Priority:** High
**Affected Components:** `apps/client/src/renderer/renderer.ts` (Selection
Modal logic from 12.10).

**Business rules (exactly as specified in the brief):**
| Condition | Checkbox state |
|---|---|
| Selected source is an application window, platform supports capture | **Enabled**, unchecked by default |
| Selected source is a full screen/monitor | **Disabled**, unchecked, tooltip: "Audio sharing is only available for individual application windows" |
| Platform is macOS | **Always disabled**, regardless of source type, tooltip/inline note: "macOS does not support per-application audio capture — only video will be shared. [Learn more]" (the "Learn more" can be a plain-text explanation inline rather than a link for v1 — no external docs page exists to link to yet) |
| Platform supports capture but `native-audio` reports `unsupported` for this specific target (e.g. pre-19041 Windows, ALSA-only Linux) | Disabled, tooltip: "Audio capture isn't available for this window on your system" |

- Platform/support detection: call a new preload method
  `platformSupportsAudioCapture(): Promise<boolean>` (thin wrapper over
  `@reson8/native-audio`'s `platformSupportsCapture()`, called once at
  modal-open time, not per-selection) to short-circuit the macOS/unsupported
  cases before even hitting per-target logic.
- Re-evaluated every time the selected card changes (switching from a
  window to a screen re-disables it; switching back re-enables it if still
  supported).

**Verification:** on Linux/Windows dev machine, confirm toggling between a
window source and a screen source correctly enables/disables the checkbox
live; confirm the macOS copy path renders correctly (can be verified by
temporarily forcing the platform-check branch in dev, since macOS hardware
may not be available to the maintainer — flag this as a manual/mocked
verification if no Mac is available at implementation time).

---

## Epic 4 — UI/UX: Visualization & Administration

### PRD 12.12 — Sharing Badge in Channel Tree

**Type:** ✨ Feature
**Priority:** High
**Affected Components:** `packages/shared-types/src/models.ts`
(`IUserPresence`, line 108), `apps/server/src/services/presence.service.ts`,
`apps/server/src/handlers/connection.handler.ts` (`buildOccupant`),
`apps/server/src/handlers/voice.handler.ts` (`SET_VOICE_STATE` handler
pattern), `apps/client/src/renderer/index.html` (`.nsfw-badge` CSS, line
~1314), `apps/client/src/renderer/renderer.ts`.

**Business rules:**
- Extend `IUserPresence` with `isSharingScreen: boolean`.
- Extend the Redis presence hash (`presence:user:{userId}`, currently
  `{ serverId, channelId, nickname, isMuted, isDeafened }` per
  `presence.service.ts:10`) with an `isSharingScreen` field, following the
  exact same `setVoiceState(userId, isMuted, isDeafened)` pattern — add
  `setScreenShareState(userId, isSharingScreen, producerId?)`.
- New client→server event `SET_SCREEN_SHARE_STATE` (payload:
  `{ isSharingScreen: boolean }`), handled identically to
  `SET_VOICE_STATE` in `voice.handler.ts:394-420`: update presence, rebuild
  the occupants list via `buildOccupant`, broadcast `PRESENCE_UPDATE` to
  `server:${serverId}` with the updated `occupants` array. **No new
  broadcast event needed** — `PRESENCE_UPDATE` already carries the full
  occupant list per channel; the badge is purely a render-time concern once
  `isSharingScreen` is present on each occupant.
- Client renders a red badge next to the user's name in the channel tree
  when `occupant.isSharingScreen` is true, styled to match `.nsfw-badge`
  (`index.html:1314`) but red instead of NSFW's color, with label "LIVE" or
  a broadcast icon — small, uppercase, pill-shaped, consistent with the
  existing badge's sizing.
- Server also emits `SET_SCREEN_SHARE_STATE` defensively re-checks
  `screenShareEnabled` server-side before honoring a `true` value (never
  trust client-only gating — same defensive pattern as `nudge.handler.ts:115`
  checking `nudgeEnabled` server-side even though the client already hides
  the button when disabled).

**Verification:** start a share, confirm the badge appears for all other
occupants of that channel (not just the direct viewer) in real time via
`PRESENCE_UPDATE`; stop sharing, confirm it disappears.

---

### PRD 12.13 — Viewer Window

**Type:** ✨ Feature
**Priority:** High
**Affected Components:** `apps/client/src/main.ts` (new `BrowserWindow`
factory), new `apps/client/src/renderer/viewer.html` +
`apps/client/src/renderer/viewer.ts`, new
`apps/client/src/preload-viewer.ts` (scoped preload, separate from the main
window's `preload.ts` — the viewer window doesn't need the 60+ method main
API surface, only a handful of watch-session methods; a scoped preload
keeps the contextBridge surface minimal per Electron security best
practice, consistent with the existing "main/preload/renderer boundary is a
real security boundary" convention from `apps/client/CLAUDE.md`).

**Business rules:**
- Clicking the badge (from [PRD 12.12](#prd-1212--sharing-badge-in-channel-tree)),
  by **anyone** in the room including the streamer themself, shows a native
  `confirm()`-style prompt: "Do you want to watch [nickname]'s stream?"
  (reuse the existing modal-confirm pattern, e.g. styled like
  `#nsfw-confirm-modal`, rather than a blocking native `dialog.showMessageBox`,
  to stay consistent with the rest of the app's in-app modal UX).
- On confirm, main process opens a new `BrowserWindow`:
  ```ts
  new BrowserWindow({
    width: 960, height: 600, minWidth: 480, minHeight: 320,
    title: `Watching ${nickname}'s screen share`,
    webPreferences: {
      preload: path.join(__dirname, "preload-viewer.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  ```
  loading `viewer.html`, with the target `userId` + `channelId` passed via
  a constructor query param or `additionalArguments` (Electron's supported
  mechanism for passing initial data to a new window's preload).
- `viewer.ts` opens its **own** `socket.io-client` connection (reusing the
  same server URL + the same persisted `instanceId`, so it authenticates as
  the same user — server-side this is just a second socket for a user who
  already has a primary connection; Socket.io supports multiple sockets per
  user natively, this is not a new concept in this codebase since a Server
  Admin, for instance, is already just identified by `instanceId` not by
  socket).
- Emits new event `WATCH_SCREEN_SHARE` (payload `{ targetUserId, channelId
  }`, ack `{ success, screenVideoProducerId?, screenAudioProducerId?,
  rtpCapabilities?, error? }`). Server validates the caller is currently
  present in `channelId` (via presence, same check style as elsewhere) and
  that `targetUserId` is currently sharing in that same channel — rejects
  otherwise (handles the race where a share stops between the badge render
  and the click).
- On success, `viewer.ts` runs the **last four steps** of the existing voice
  handshake, scoped to this viewer socket and a **recv-only** transport:
  `CREATE_WEBRTC_TRANSPORT (recv) → CONNECT_TRANSPORT → CONSUME (video) →
  [CONSUME (audio) if present] → RESUME_CONSUMER` — reusing the exact
  existing events, just from a second socket/window rather than the main
  one.
- **Viewer controls** (rendered in `viewer.html`, minimal chrome around the
  `<video>` element, itself created via `document.createElement("video")`
  per the existing "no detached media elements" convention applied to
  `<audio>` — same reasoning applies to `<video>`): fullscreen toggle,
  volume slider, mute-stream toggle, "Leave Stream" button.
- "Leave Stream" and the native OS window-close ("X") button both trigger
  the same cleanup path: emit `STOP_WATCHING_SCREEN_SHARE`, close the
  viewer's Consumers/Transport, disconnect the viewer's socket, then
  `window.close()`. Wire the native close via the `BrowserWindow`'s
  `close` event in `main.ts` calling into the renderer (or, simpler: let
  `viewer.ts` listen for `beforeunload` and run the same cleanup — matches
  how `main.ts` already handles app-wide cleanup on quit).
- Multiple Viewer windows can be open at once (per
  [Decision #4](#decisions-confirmed-with-the-user)) — each is fully
  independent (own socket, own transport, own consumers). No shared state
  between them.

**Robustness: dual-socket session handling.** A Viewer window opening a
second Socket.io connection for a user who already has a primary connection
is new territory for this codebase — `presence.service.ts` and the Phase 11
reconnect fixes were both built assuming one socket per user. To avoid
reintroducing a Phase-11-class bug in a new code path, design this
explicitly rather than let it fall out of reusing existing handlers:

1. **Tag the socket's role at connection time, not by inference.** Add
   `role: "primary" | "viewer"` to `SocketData` (shared-types), set once via
   the connection query string (`io(url, { query: { instanceId, role:
   "viewer" } })`) and read in a `connection`-time middleware before any
   handler runs. Every downstream branch — disconnect cleanup, presence
   refresh, auto-rejoin-voice — checks this field instead of trying to
   infer "is this a viewer socket" from which events happened to fire.
2. **Viewer sockets authenticate through a new narrow event, not
   `USER_JOIN_SERVER`.** Reusing `USER_JOIN_SERVER` would re-run
   `hydrateOccupants()` and rewrite the user's `presence:user:{userId}`
   Redis hash, potentially clobbering the primary connection's channel
   association. Add `VIEWER_AUTHENTICATE` (payload: `instanceId`) that
   resolves `userId` the same way but touches nothing in
   `presence.service.ts` and never joins the `server:${serverId}` room —
   the viewer socket has no need for `PRESENCE_UPDATE`/`CHANNEL_TREE_UPDATE`
   traffic at all.
3. **Disconnect cleanup branches on role, checked before implementation
   starts.** `connection.handler.ts`'s `disconnect` handler currently
   assumes every disconnecting socket owns a presence entry, a mediasoup
   transport set, and channel occupancy. Audit it now and add a
   `role === "viewer"` early-exit that only closes that socket's own
   Consumers/recv Transport (already naturally scoped by `socket.id`) and
   returns — never touching Redis presence or emitting occupant broadcasts.
4. **No auto-rejoin semantics for viewer sockets.** The Phase 11 fix added
   automatic voice-channel rejoin on Socket.io reconnect for the primary
   connection — deliberately do not extend that to viewer sockets.
   Configure the viewer window's client with `reconnection: false` (or a
   small fixed retry budget) and surface "Stream disconnected" + a manual
   re-watch action in `viewer.html` instead of trying to make the two
   reconnect policies coexist.
5. **Confirm mediasoup bookkeeping is keyed by `socket.id`, not `userId`,
   before writing any 12.13 code.** If `mediasoup.service.ts` keys any
   transport/producer/consumer map by `userId`, a second socket for the
   same user collides with the primary connection's mediasoup state. This
   should already be `socket.id`-keyed given multi-tab dev testing already
   works today, but verify directly rather than assume.
6. **Add a test (or explicit manual-verification step) asserting
   isolation.** Opening and closing a viewer socket for a user with an
   active primary connection must leave that primary connection's presence
   entry, channel association, and voice state completely unchanged. If a
   live-Redis integration test isn't practical alongside the existing
   DB/Redis-free `__tests__/` suite, call this out as a required manual
   check rather than skip it silently.
7. **Log `role` on every viewer-socket log line** so a stray viewer
   connection is distinguishable from a primary-connection bug during
   triage.

**Verification:** click a badge, confirm the prompt, confirm a new OS-level
window opens with the correct title and shows live video (+ audio if the
sharer enabled it); close via the "Leave Stream" button and separately via
the OS "X" — confirm both cleanly stop the corresponding server-side
Consumers (check server logs / mediasoup stats for orphaned consumers after
each).

---

### PRD 12.14 — Server-Wide Admin Toggle

**Type:** ✨ Feature
**Priority:** High
**Affected Components:** `apps/server/prisma/schema.prisma`,
`packages/shared-types/src/models.ts`,
`packages/shared-types/src/socket-events.ts`, new
`apps/server/src/handlers/screen-share.handler.ts` (or extend
`nudge.handler.ts`'s existing `GET_SERVER_SETTINGS`/`UPDATE_SERVER_SETTINGS`
handlers, since they're already the general "server settings" pair, not
Nudge-specific in name — **recommended**, to avoid a second near-identical
settings-fetch round trip), `apps/client/src/renderer/index.html` (Settings
modal, Server tab, alongside `#chk-nudge-enabled` at line ~2739),
`apps/client/src/renderer/renderer.ts`.

**This mirrors the Nudge toggle exactly** — same mechanism, different flag:

- **Schema:** `Server.screenShareEnabled Boolean @default(true)`, same
  default-on posture as `nudgeEnabled`.
- **Shared types:** `IServer.screenShareEnabled: boolean` in `models.ts`.
  Extend the existing `GET_SERVER_SETTINGS` ack payload and
  `UPDATE_SERVER_SETTINGS` payload (both currently `{ nudgeEnabled }` only,
  `socket-events.ts:347-354`) to also carry `screenShareEnabled` — one
  combined settings object rather than a parallel second event pair, since
  they're conceptually the same "server admin settings" surface.
  `SERVER_SETTINGS_UPDATED` broadcast (`socket-events.ts:477`) gains the
  same field.
- **Server handler:** extends the existing settings handler (whichever file
  ends up owning it — recommend renaming/generalizing
  `nudge.handler.ts`'s settings portion is out of scope for this PRD; adding
  `screenShareEnabled` to the same read/write/broadcast calls is in scope
  and low-risk).
- **Client UI:** new toggle row directly below `#chk-nudge-enabled` in the
  Settings modal's Server tab, same `.toggle-row` markup pattern:
  ```html
  <div class="toggle-row">
    <div>
      <span class="toggle-row-title">🖥️ Screen Sharing</span>
      <span class="toggle-row-desc">Lets members share their screen in voice channels</span>
    </div>
    <input type="checkbox" id="chk-screen-share-enabled" checked>
  </div>
  ```
  wired exactly like `chkNudgeEnabled`'s `change` listener
  (`renderer.ts:3433-3441`): optimistic-ish update, calls
  `api.updateServerSettings(...)`, reverts the checkbox on failure.
- **Gating:** the `#btn-share-screen` button ([PRD 12.9](#prd-129--voice-panel-2x2-grid-refactor))
  and the server-side `SET_SCREEN_SHARE_STATE`/`WATCH_SCREEN_SHARE` handlers
  ([PRD 12.12](#prd-1212--sharing-badge-in-channel-tree),
  [12.13](#prd-1213--viewer-window)) both check this flag — client-side for
  UX (disabled button), server-side as the actual enforcement (never trust
  the client-side gate alone).
- **No new `PermissionFlags` bit.** Per-role granularity (e.g. "only
  moderators can screen share") was not requested in the brief and isn't
  added here — this is a single server-wide on/off switch, same shape as
  Nudge. Noted under [Explicitly Out of Scope](#explicitly-out-of-scope) as
  a natural future extension if wanted.

**Verification:** toggle off as admin, confirm the Share Screen button
becomes disabled for all connected clients live (via
`SERVER_SETTINGS_UPDATED`, same live-update path Nudge already uses,
`renderer.ts:4300-4302`); confirm a client that somehow still emits
`SET_SCREEN_SHARE_STATE` while disabled is rejected server-side.

---

## Data Model Changes

Exactly one new column, following the existing Nudge precedent:

```prisma
model Server {
  // ...existing fields...
  nudgeEnabled        Boolean  @default(true)
  screenShareEnabled  Boolean  @default(true)   // NEW — Phase 12
}
```

No new tables. Screen-share state (who's sharing, to whom) is entirely
ephemeral — tracked in Redis presence (mirroring `isMuted`/`isDeafened`) and
in mediasoup's own Producer/Consumer bookkeeping, exactly like voice
connection state already is. This matches the project's existing
convention that transient session state lives in Redis, not Postgres (see
root CLAUDE.md's "Presence" section).

---

## Socket.io Event Summary

All new events are added to `packages/shared-types/src/socket-events.ts`
first, per the project's shared-types-first convention.

| Event | Direction | Payload | Purpose |
|---|---|---|---|
| `SET_SCREEN_SHARE_STATE` | C→S | `{ isSharingScreen: boolean }` | Sharer reports share start/stop (mirrors `SET_VOICE_STATE`) |
| `WATCH_SCREEN_SHARE` | C→S | `{ targetUserId, channelId }` → ack `{ success, screenVideoProducerId?, screenAudioProducerId?, rtpCapabilities?, error? }` | Viewer window requests to consume a peer's screen producers |
| `STOP_WATCHING_SCREEN_SHARE` | C→S | `{ targetUserId, channelId }` | Viewer window cleanup (Leave Stream / window close) |
| `GET_SERVER_SETTINGS` *(extended)* | C→S | ack now also returns `screenShareEnabled` | Existing event, payload extended |
| `UPDATE_SERVER_SETTINGS` *(extended)* | C→S | payload now also accepts `screenShareEnabled` | Existing event, payload extended |
| `PRESENCE_UPDATE` *(extended)* | S→C | `occupants[]` entries now include `isSharingScreen` | Existing event, no new event needed — badge is a render concern |
| `SERVER_SETTINGS_UPDATED` *(extended)* | S→C | now also carries `screenShareEnabled` | Existing event, payload extended |

No changes needed to `GET_ROUTER_CAPABILITIES`, `CREATE_WEBRTC_TRANSPORT`,
`CONNECT_TRANSPORT`, `PRODUCE`, `CONSUME`, `RESUME_CONSUMER`, or
`CLOSE_PRODUCER` — screen video/audio reuse every one of these unchanged,
just called an extra time (sharer side) or from the Viewer window's own
socket (viewer side).

---

## Cross-Cutting Dependencies & Implementation Order

1. **PRD 12.1** (package scaffold) blocks everything else in Epic 1 and 2.
2. **PRD 12.2 / 12.3 / 12.4** (per-OS capture) can be built in parallel with
   each other once 12.1 lands, and in parallel with Epic 2/3's non-audio
   pieces (video-only sharing doesn't need native-audio at all).
3. **PRD 12.8** (Router video codec + SVC) should land before 12.9-12.13,
   since the UI has nothing real to drive without a working video Producer
   path — recommend building 12.6 → 12.8 → a minimal end-to-end video-only
   share (hardcoded/dev-triggered, no UI yet) as an integration checkpoint
   before investing in the full modal/badge/viewer UI.
4. **PRD 12.14** (admin toggle) is independent and can be built early —
   it's the lowest-risk item and unblocks testing the gating logic in
   isolation.
5. **PRD 12.5** (release script) only matters once there's a native-audio
   binary to actually ship — can be deferred until Epic 1 is functionally
   complete, but should land before any real release is cut with this
   feature in it (otherwise the manual per-platform process silently misses
   the new native binary, similar in spirit to the v1.3.0→v1.4.0
   `latest.yml` incident already documented in root CLAUDE.md).

Suggested overall order: **12.1 → 12.14 → 12.6 → 12.8 → (12.2/12.3/12.4 in
parallel) → 12.7 → 12.9 → 12.10 → 12.11 → 12.12 → 12.13 → 12.5.**

---

## Explicitly Out of Scope

- **macOS audio capture** beyond the unsupported stub — see
  [PRD 12.4](#prd-124--macos-unsupported-stub) and [Known Risks](#known-risks).
- **Recording** screen shares to disk (this PRD is live-viewing only).
- **Per-role permission granularity** for screen sharing (only the global
  admin toggle from 12.14 — no new `PermissionFlags` bit).
- **Webcam sharing** (separate from screen sharing; the `appData.mediaType`
  tagging convention in 12.8 anticipates this being addable later without
  rework, but it isn't built here).
- **Adaptive bitrate beyond SVC layer selection** — no custom quality
  picker UI in the Viewer window for v1; `setPreferredLayers` defaults to
  the highest available layer.
- **System-wide (non-scoped) desktop audio capture** on any platform — the
  entire point of the native module is *scoped* capture; if ALSA-only Linux
  or pre-2004 Windows can't do scoped capture, the answer is "unsupported,"
  not "fall back to capturing everything."
- **TURN/relay considerations for screen share specifically** — reuses
  whatever ICE/TURN configuration already exists for voice; no new network
  infrastructure introduced by this PRD.

---

## Known Risks

1. **macOS capture is a real product gap, not just a v1 shortcut.** If
   macOS users are a meaningful part of the user base, this feature will
   feel broken for them (video-only sharing, no audio, ever, without a
   future virtual-driver or ScreenCaptureKit-based rework). Worth deciding
   explicitly whether that's acceptable before shipping, rather than
   discovering it from user reports.
2. **Second socket-per-window (Viewer) is a new connection pattern** for
   this codebase — presence/reconnect logic was built assuming one socket
   per user. See "Robustness: dual-socket session handling" under
   [PRD 12.13](#prd-1213--viewer-window) for the concrete mitigation design
   (role tagging, a dedicated `VIEWER_AUTHENTICATE` path, disconnect-cleanup
   branching, no auto-rejoin for viewer sockets). This deserves explicit
   testing per item 6 there, not just code-review confidence.
3. ~~`cross`-based Windows cross-compilation from Linux requires
   Docker/Podman.~~ **Resolved during implementation:** the release script
   ([PRD 12.5](#prd-125--unified-local-build--release-script)) doesn't use
   `cross`/Docker at all — cross-compiling to `x86_64-pc-windows-gnu` works
   directly via `cargo`/`napi build` once `mingw-w64` is installed locally
   (`apt install mingw-w64` / `pacman -S mingw-w64-gcc` /
   `dnf install mingw64-gcc`). Still a new local dependency beyond what's
   needed today, just a much lighter one than Docker — `scripts/release-all.mjs`
   detects whether `mingw-w64` is on `PATH` and skips the Windows
   native-audio target with an install hint if it isn't, rather than
   failing opaquely mid-build.
4. **PID-to-window resolution on Linux is inherently fuzzier** than on
   Windows (no universal, permission-free "get PID for this window handle"
   primitive across all compositors/window managers) — the `processName`
   fallback in 12.3 is a mitigation, not a complete fix; some
   Flatpak/sandboxed apps may never resolve cleanly. Treat "audio capture
   unavailable for this window" as an expected, not exceptional, outcome
   for a nonzero slice of Linux windows.
5. **PulseAudio-only systems (no PipeWire underneath) reroute the target
   app's live audio during a share, rather than just tapping it.** Isolating
   one app's audio in plain PulseAudio has no native per-app monitor to tap
   — the PRD 12.3 implementation works around this by temporarily moving
   the app's `sink-input` onto a virtual null-sink and looping that back to
   the user's original sink so they still hear themselves. Unlike the
   Windows and PipeWire backends, which are non-invasive taps, this is a
   real (if brief) change to the user's live audio routing: a short audio
   blip is plausible when a share starts or stops, and an unclean crash
   mid-share could in principle leave the app's audio routed through the
   virtual device until the user notices and fixes it manually (e.g. via
   `pavucontrol`). Worth deciding whether `native-audio` should also sweep
   for and clean up stale `reson8_share_capture` null-sink/loopback modules
   on startup, not only on a clean `stop()`, to bound how long a crash can
   leave this in a broken state.
6. **First native (Rust) dependency in an otherwise pure-TS/npm monorepo**
   raises the contribution bar for anyone touching Epic 1 — worth being
   upfront in `README.md`/`CONTRIBUTING` (if one exists) that
   `packages/native-audio` requires a Rust toolchain to modify, even though
   it doesn't require one to just run the app (thanks to committed
   prebuilds per 12.1).
