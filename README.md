<div align="center">

# <img src="./logo_512x512.png" width="36" align="absmiddle" alt="Reson8 Logo"> Reson8

**Self-hosted voice & text communication — your server, your rules.**

A high-performance desktop communication platform inspired by TeamSpeak 3,
built with modern technology for low-latency voice, hierarchical channel trees,
and private server ownership.

[![Version](https://img.shields.io/badge/version-2.2.1-blue.svg)](#)
[![Electron](https://img.shields.io/badge/Electron-34-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![mediasoup](https://img.shields.io/badge/mediasoup-SFU-orange?logo=webrtc&logoColor=white)](https://mediasoup.org/)
[![Socket.io](https://img.shields.io/badge/Socket.io-4-010101?logo=socket.io&logoColor=white)](https://socket.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-Private-lightgrey)](#)
[![Made with ❤️](https://img.shields.io/badge/Made%20with-❤️-red)](#)

</div>

---

## ✨ Features

### 🔊 Voice & Audio
- **Crystal-Clear Voice** — Low-latency SFU-based audio via mediasoup. No peer-to-peer bottlenecks, even in large groups.
- **Push-to-Talk** — Configurable global hotkey with voice-activity fallback. Toggle freely from the settings panel.
- **Active Speaker Indicator** — Animated green halo highlights users who are currently speaking in the channel tree.
- **Audio Device Selection** — Choose microphone and speaker devices from settings. Save and apply with a dedicated button.
- **AI Noise Cancelling** — Real-time AI denoising (DeepFilterNet3, running fully self-hosted via WebAssembly) suppresses keyboard clicks, fan noise, and other background sound, toggleable from Voice & Shortcuts.
- **Mic Sensitivity (Noise Gate)** — Configurable decibel threshold to selectively filter out background noise, with a smooth attack/hold/release fade rather than an abrupt cutoff.
- **Microphone Volume** — Scale your own outgoing mic signal from 0–200%, independent of your OS's input level.
- **Live Microphone Meter** — Always-visible input level meter in Voice & Shortcuts, reflecting every change to mic volume, noise cancelling, or the noise gate in real time.
- **Voice Session Timers** — Live elapsed timers indicating how long a voice conversation has been active.
- **Per-User Volume & Local Mute** — Right-click anyone in a voice channel to adjust their volume (0–200%) or mute them locally — just for you, with no effect on what anyone else hears.
- **Self Mute/Deafen Indicators** — Small icons next to a participant's name show when they've muted their mic or deafened themselves, so silence never looks like being ignored.
- **Mute/Deafen That Work Together** — Deafening yourself automatically mutes your mic too, and un-deafening restores exactly the mute state you had before. Push-to-talk is fully blocked while deafened.
- **Audio Settings Tab** — Independent volume sliders for Nudge alerts, Sound Alerts, and a master Global Voice Chat Volume that layers on top of each participant's individual volume.
- **Automatic Voice Reconnection** — A brief network hiccup or WebRTC connection drop no longer permanently ejects you from a voice channel — Reson8 detects it and silently rejoins.

### 🎥 Screen Sharing
- **Share Your Screen or a Window** — Share a full screen or a specific application window with everyone in your voice channel. Anyone can open a dedicated pop-out Viewer window to watch, without leaving their own channel view.
- **Native Per-App Audio Capture (Windows & Linux)** — Optionally include an application's own audio in your share, scoped to just that app rather than your whole desktop, powered by a native Rust capture module. Not available on macOS yet.
- **Custom Stream Names** — Give your share a friendly display name instead of the raw window or app title.
- **Sharer-Awareness Indicators** — A red banner, a full-width "Stop Sharing" button, and a 🔴 in the window title make it unmistakable when you're live.
- **Server-Wide Toggle** — Admins can enable or disable screen sharing for the whole server from Settings, mirroring the Nudge toggle.
- **Screen-Share Sound Alerts** — Hear when someone starts or stops sharing, and (if you're the sharer) when a viewer opens or closes the Viewer window on your stream.

### 🌳 Channels & Presence
- **Channel Tree** — Hierarchical channel structure with categories, voice rooms, and text channels — just like TeamSpeak.
- **Channel Management** — Create, rename, and delete channels on the fly. Changes propagate to all clients in real-time.
- **Drag & Drop Reordering** — Reorder channels within a category by dragging them into place.
- **NSFW Channels** — Mark text channels as NSFW; members see a confirmation prompt before entering, and images posted there render blurred with a "click to reveal" overlay until opened in the full-screen viewer.
- **Real-Time Presence** — See who's online and in which channel, instantly updated across all connected clients — including promptly reflecting when someone quits the app, rather than showing them as online for a lingering delay.

### 💬 Text & Messaging
- **Tabbed Text Chat** — Per-channel text messaging with rich formatting, file attachments, and message history.
- **Edit & Delete Messages** — Fix a typo within 2 minutes of sending, or remove a message (and its attachment) entirely.
- **Unread Channel Indicators** — Text channels with unseen activity show a highlighted dot until you open them.
- **Instant Upload Feedback** — Attachments show a live thumbnail and progress spinner the moment you pick them, with a one-click retry if the upload fails.
- **Direct Messages** — Private 1-on-1 messaging with unread indicators, read receipts, and automatic tab management.
- **Persistent DMs (Offline Access)** — DM conversations remain accessible even when the other user is offline.
- **Date Sectioning** — Messages are grouped under `--- Month Day ---` dividers as you scroll through history, with the year added once a message predates the current one.
- **Emoji Picker & Reactions** — Insert any of 550+ curated emojis into chat, or react directly to messages with persistent, tallied emoji pills. A message containing nothing but a single emoji renders at roughly 4x size.
- **Custom Emoji** — Upload your own emoji with a built-in crop tool, or upload an animated GIF via a dedicated crop-free path to preserve the animation; new uploads are queued for admin approval before becoming usable server-wide.
- **Link Previews** — URLs in chat auto-expand with title, description, and image. YouTube/video embeds supported.
- **Pinned Messages** — Admins can pin one message per text channel; a bar above the chat shows a preview and jumps you straight to it (loading older history if needed), with a click.
- **Message Length Limit** — A safe default cap on message length protects the server against oversized messages, with an admin override in Settings → Server.
- **Long Message Truncation** — Long messages collapse behind a pill-shaped "See more" button, positioned directly above the message's reactions. Expanded messages always reset — minimizing the app, switching channels, or relaunching all re-collapse them.

### 🛡️ Administration & Security
- **Role-Based Permissions** — Bitwise permission system with admin role management. Fine-grained access control.
- **Server Password Protection** — Optional `SERVER_PRIVATE_PASSWORD` env var with client-side password input.
- **Kick & Ban** — Admin right-click to kick users from voice channels. Ban/Unban lives in the Settings → User Management tab, which lists every server user (online or not), so offline troublemakers can be banned too — persisted by instance ID.

### 🖥️ Desktop Experience
- **Auto-Updates** — Checks for new releases on launch and installs them with one click; a "Check for Updates" button in the About tab lets you trigger it anytime.
- **Single Instance** — Opening Reson8 while it's already running focuses the existing window instead of launching a redundant second instance.
- **"What's New" Modal** — The first time you open Reson8 after an update, a one-time modal renders the GitHub release notes as formatted text, sourced live rather than showing raw markdown.
- **Server Name in Title Bar** — The window title shows "Reson8 - [Server Name]" once connected.
- **Client/Server Version Mismatch Warning** — Warns with both version numbers if your client and the server you're connected to are running different versions, with a link to the latest release when the server is ahead.
- **System Tray** — Minimize-to-tray and close-to-tray options with a tray context menu (Restore / Quit).
- **Remember Me** — Save server URL, nickname, and password across sessions with a single checkbox.
- **Sound Alerts & Connectivity** — Audible notifications for key events and a real-time latency ping display.
- **Nudge** — Get a user's attention with a sound, toast, and taskbar/dock flash. Admin-toggleable server-wide, with a per-target cooldown to prevent spam.
- **Always-Accessible Settings** — Tweak audio devices and application preferences even when disconnected.
- **Self-Hosted** — Your data stays on your hardware. No third-party servers, no telemetry, no compromises.
- **One-Command Server** — Spin up the entire stack with `docker compose up`. Postgres, Redis, and the Reson8 server, all containerized.

---

## 🏗️ Architecture

```
┌─────────────────┐         WebSocket          ┌─────────────────────┐
│   Electron App  │ ◄──── Socket.io ────────►  │   Reson8 Server     │
│   (Client)      │                            │   (Fastify)         │
│                 │         WebRTC (SFU)        │                     │
│  mediasoup-     │ ◄──── Audio Streams ────►  │  mediasoup Workers  │
│  client         │                            │                     │
└─────────────────┘                            ├─────────────────────┤
                                               │  PostgreSQL │ Redis │
                                               └─────────────────────┘
```

| Layer | Technology | Purpose |
|:---|:---|:---|
| **Desktop Shell** | Electron | Native desktop app with system integration |
| **Voice Engine** | mediasoup (SFU) | WebRTC audio routing — scalable many-to-many |
| **Signaling** | Socket.io + Fastify | Real-time events & WebRTC handshake |
| **Database** | PostgreSQL + Prisma | Channels, users, roles, messages, bans |
| **Presence** | Redis | Fast online/channel tracking |
| **Containerization** | Docker Compose | One-command server deployment |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 20
- **Docker** & **Docker Compose** (for databases, or full-stack deployment)

### 1. Clone & Install

```bash
git clone https://github.com/your-username/reson8.git
cd reson8
npm install
```

### 2. Start the Databases

```bash
docker compose -f docker-compose.dev.yml up -d
```

### 3. Set Up the Database

```bash
cd apps/server
cp .env.example .env      # or create .env with the variables below
npx prisma migrate dev
npx prisma db seed
```

<details>
<summary>📋 Required <code>.env</code> variables</summary>

```env
DATABASE_URL=postgresql://reson8:reson8@localhost:5432/reson8?schema=public
REDIS_URL=redis://localhost:6379
PORT=9800
HOST=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=127.0.0.1
SERVER_NAME="Reson8 Server"
SEED_DEFAULT_TEMPLATE=true

# Optional
ADMIN_INSTANCE_ID=<your-instance-id>            # Grants admin role on connect
SERVER_PRIVATE_PASSWORD=<server-password>        # Password-protects the server
MEDIASOUP_PRIVATE_ANNOUNCED_IP=<lan-ip>          # For LAN/WAN dual-announce
```

</details>

### 4. Build & Run

```bash
# Terminal 1 — Server
cd apps/server && npm run dev

# Terminal 2 — Client
cd apps/client && npx tsc --build && node scripts/copy-html.mjs && npx electron .
```

### 🐳 Full-Stack Docker (Alternative)

Deploy everything with a single command:

```bash
docker compose up --build
```

For VPS deployments, set your public IP so WebRTC can route:

```bash
MEDIASOUP_ANNOUNCED_IP=<your-public-ip> docker compose up --build
```

#### Deploying behind Cloudflare Tunnels (or strict NATs)
Because Cloudflare Tunnels only proxy TCP, WebRTC voice (UDP) requires a **TURN server relay**. Reson8 includes an optional `coturn` configuration for this exact scenario:

1. Uncomment `TURN_URL`, `TURN_USERNAME`, and `TURN_CREDENTIAL` in your `.env`
2. Run with the optional TURN override file:

```bash
docker compose -f docker-compose.yml -f docker-compose.turn.yml up --build
```

---

## 📦 Releasing

The client checks GitHub Releases for updates via `electron-updater`. Building installers is **not** the same as publishing an update:

```bash
cd apps/client
npm run build:win      # or build:linux, build:mac
```

Each of these also generates `latest.yml` / `latest-linux.yml` / `latest-mac.yml` in `apps/client/release/`, alongside the installer. **All of these files — the installer(s) *and* the matching `latest*.yml` — must be uploaded together as assets on the GitHub release.** Uploading only the installer (e.g. a manual drag-and-drop onto a GitHub release) leaves out the metadata `electron-updater` actually reads to detect a new version, and the auto-updater will silently fail to find the update on every platform, with no visible error until a user tries "Check for Updates" and gets a generic failure message.

### Code Signing

Installers are currently built and shipped **unsigned** — there's no code-signing certificate in the release pipeline. Practically, this means:

- Windows SmartScreen and antivirus tools may flag the installer as coming from an "Unknown Publisher"; users need to click through the warning ("More info" → "Run anyway").
- `apps/client/src/main.ts` overrides `NsisUpdater`'s `verifyUpdateCodeSignature` (Windows only) with a verifier that always passes — electron-updater otherwise checks a downloaded update's Authenticode publisher against the publisher name baked into the installed app's own `app-update.yml` and rejects any unsigned (or differently-signed) update as "not signed by the application owner."
- macOS builds are unsigned/un-notarized too, so Gatekeeper will block first launch until the user right-clicks the app and chooses "Open."

If a proper code-signing certificate is obtained in the future, `electron-builder` will pick up `CSC_LINK`/`CSC_KEY_PASSWORD` env vars automatically for Windows/macOS signing — at that point, the `verifyUpdateCodeSignature` override in `main.ts` should be removed again so updates are actually verified.

---

## 🖥️ Client UI

Reson8 uses a **three-pane TeamSpeak-style layout**: a collapsible channel tree on the left, tabbed content (server log, per-channel chat, DMs) on the right, and voice controls anchored at the bottom.

<p align="center">
  <img src="docs/screenshots/main-ui.png" alt="Reson8 main window — channel tree with voice occupants and a text chat conversation" width="720">
</p>

- **Left Pane** — Collapsible channel tree with live occupant indicators, active speaker halos, and LIVE badges for anyone screen sharing
- **Right Pane** — Tabbed content: Server log, text chat per channel, DM conversations
- **Bottom Left** — Voice controls (mute, deafen, share screen, leave) with channel name and session timer
- **Status Bar** — Connection status, nickname, settings gear, and users button with online indicator

### Screen Sharing in Action

<p align="center">
  <img src="docs/screenshots/sharing-active.png" alt="Actively sharing a screen — sharer-awareness banner, Stop Sharing button, and LIVE badge" width="440">
  &nbsp;&nbsp;
  <img src="docs/screenshots/viewer-window.png" alt="The pop-out Viewer window watching a live screen share, with volume and fullscreen controls" width="440">
</p>

### Per-User Local Volume & Mute

<p align="center">
  <img src="docs/screenshots/local-volume-menu.png" alt="Right-click context menu for adjusting a participant's local volume or muting them locally" width="260">
</p>

---

## 📁 Project Structure

```
reson8/
├── apps/
│   ├── client/                 # Electron desktop client
│   │   ├── src/
│   │   │   ├── main.ts              # Electron main process (tray, PTT, link preview, desktopCapturer)
│   │   │   ├── preload.ts           # contextBridge API for the main window (60+ methods)
│   │   │   ├── preload-viewer.ts    # Scoped contextBridge API for the screen-share Viewer window
│   │   │   ├── renderer/            # Main window UI (HTML + TypeScript)
│   │   │   │   ├── index.html / renderer.ts    # Main window
│   │   │   │   └── viewer.html / viewer.ts     # Screen-share Viewer window (own socket + recv transport)
│   │   │   └── services/
│   │   │       └── voice.service.ts  # mediasoup-client engine (mic + screen video/audio producers)
│   │   └── scripts/
│   └── server/                 # Node.js signaling + SFU server
│       ├── src/
│       │   ├── index.ts        # Server entry point
│       │   ├── handlers/       # Socket.io event handlers
│       │   │   ├── connection.handler.ts   # Join/leave/disconnect + ban check
│       │   │   ├── voice.handler.ts        # WebRTC/mediasoup signaling (mic + screen share)
│       │   │   ├── channel.handler.ts      # Channel CRUD
│       │   │   ├── message.handler.ts      # Text messages
│       │   │   ├── dm.handler.ts           # Direct messages + online users
│       │   │   ├── admin.handler.ts        # Role management
│       │   │   ├── nudge.handler.ts        # Nudge + server-wide settings (screen share toggle, etc.)
│       │   │   └── moderation.handler.ts   # Kick & ban
│       │   ├── services/       # mediasoup, presence, permissions
│       │   ├── config/         # mediasoup, message-length, and version configuration
│       │   └── plugins/        # Prisma, Redis Fastify plugins
│       ├── prisma/
│       │   ├── schema.prisma   # Database schema
│       │   └── seed.ts         # Default server + channels + roles
│       ├── Dockerfile
│       └── entrypoint.sh
├── packages/
│   ├── shared-types/            # Shared DTOs, enums, Socket.io event types
│   └── native-audio/             # Rust/NAPI-RS module — per-process loopback audio capture (Windows/Linux)
├── docker-compose.yml          # Production (server + Postgres + Redis)
├── docker-compose.dev.yml      # Development (Postgres + Redis only)
└── package.json                # Workspace root
```

---

## 🗺️ Roadmap

| Phase | Description | Status |
|:---:|:---|:---:|
| 1 | **Signaling & Presence** — Socket.io server, Redis presence, Electron shell | ✅ Done |
| 2 | **Voice Bridge** — mediasoup SFU, WebRTC audio, mute/deafen | ✅ Done |
| 3 | **Relational Logic & Hierarchy** — Channel tree UI, CRUD, Docker | ✅ Done |
| 4 | **Permissions & Text Chat** — Bitwise roles, tabbed chat, message persistence | ✅ Done |
| 5 | **Desktop UX & Audio** — Push-to-Talk, audio device selection, system tray | ✅ Done |
| 6 | **Deployment & Packaging** — Docker Compose, Cloudflare Tunnels, TURN relay | ✅ Done |
| 7 | **Evolutions** — DMs, link previews, emoji picker, active speaker, moderation, password protection, remember me | ✅ Done |
| 8 | **Improvements** — Sound alerts, noise gate, session timers, emoji reactions, latency display | ✅ Done |
| 9 | **Next Steps** — Per-user voice controls, mute/deafen status icons, channel rename/reorder/NSFW, custom emoji uploads, message edit/delete, unread indicators, nudge | ✅ Done |
| 10 | **Auto-Updater & Audio Settings** — electron-updater, Audio settings tab, mute/deafen accumulation, timer/unread/AppImage-icon fixes | ✅ Done |
| 11 | **Client Fixes & Pinned Messages** — Voice disconnect resilience, session timer fix, emoji picker fix, post-update "what's new" modal, pinned messages in text channels | ✅ Done |
| 12 | **Screen Sharing** — Native per-app audio capture (Rust/NAPI-RS), VP9 SVC video pipeline, source selection modal, dedicated Viewer window, LIVE badges, server-wide toggle — plus a follow-up pass fixing per-user local volume/mute, deafen for late joiners, stale presence nicknames, and adding message-length limits, message truncation, and a client/server version-mismatch warning | ✅ Done |
| 13 | **Voice Quality & Polish** — AI noise cancelling (DeepFilterNet3/WASM), a real noise-gate fade envelope, a mic volume slider, and an always-visible mic level meter; NSFW image blurring, chat date sectioning, animated custom emoji, bigger solo-emoji messages, and screen-share sound alerts; Ban moved to a renamed "User Management" tab (now works for offline users) and a single-instance app lock; a markdown-rendering "What's New" modal; plus fixes for a presence bug that left quit users showing online and a handful of smaller UI issues | ✅ Done |

---

## 🤝 Contributing

This is currently a private project. If you'd like to contribute, please reach out to the author directly.

---

<div align="center">

Made with ❤️ by **Felipe B. Netto**

*Because your voice deserves its own server.*

</div>
