<div align="center">

# <img src="./logo_512x512.png" width="36" align="absmiddle" alt="Reson8 Logo"> Reson8

**Self-hosted voice & text communication — your server, your rules.**

A high-performance desktop communication platform inspired by TeamSpeak 3,
built with modern technology for low-latency voice, hierarchical channel trees,
and private server ownership.

[![Version](https://img.shields.io/badge/version-1.4.0-blue.svg)](#)
[![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
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
- **Mic Sensitivity (Noise Gate)** — Configurable decibel threshold to selectively filter out background noise.
- **Voice Session Timers** — Live elapsed timers indicating how long a voice conversation has been active.
- **Per-User Volume & Local Mute** — Right-click anyone in a voice channel to adjust their volume (0–200%) or mute them locally — just for you, with no effect on what anyone else hears.
- **Self Mute/Deafen Indicators** — Small icons next to a participant's name show when they've muted their mic or deafened themselves, so silence never looks like being ignored.
- **Mute/Deafen That Work Together** — Deafening yourself automatically mutes your mic too, and un-deafening restores exactly the mute state you had before. Push-to-talk is fully blocked while deafened.
- **Audio Settings Tab** — Independent volume sliders for Nudge alerts, Sound Alerts, and a master Global Voice Chat Volume that layers on top of each participant's individual volume.
- **Automatic Voice Reconnection** — A brief network hiccup or WebRTC connection drop no longer permanently ejects you from a voice channel — Reson8 detects it and silently rejoins.

### 🌳 Channels & Presence
- **Channel Tree** — Hierarchical channel structure with categories, voice rooms, and text channels — just like TeamSpeak.
- **Channel Management** — Create, rename, and delete channels on the fly. Changes propagate to all clients in real-time.
- **Drag & Drop Reordering** — Reorder channels within a category by dragging them into place.
- **NSFW Channels** — Mark text channels as NSFW; members see a confirmation prompt before entering.
- **Real-Time Presence** — See who's online and in which channel, instantly updated across all connected clients.

### 💬 Text & Messaging
- **Tabbed Text Chat** — Per-channel text messaging with rich formatting, file attachments, and message history.
- **Edit & Delete Messages** — Fix a typo within 2 minutes of sending, or remove a message (and its attachment) entirely.
- **Unread Channel Indicators** — Text channels with unseen activity show a highlighted dot until you open them.
- **Instant Upload Feedback** — Attachments show a live thumbnail and progress spinner the moment you pick them, with a one-click retry if the upload fails.
- **Direct Messages** — Private 1-on-1 messaging with unread indicators, read receipts, and automatic tab management.
- **Persistent DMs (Offline Access)** — DM conversations remain accessible even when the other user is offline.
- **Emoji Picker & Reactions** — Insert any of 550+ curated emojis into chat, or react directly to messages with persistent, tallied emoji pills.
- **Custom Emoji** — Upload your own emoji with a built-in crop tool; new uploads are queued for admin approval before becoming usable server-wide.
- **Link Previews** — URLs in chat auto-expand with title, description, and image. YouTube/video embeds supported.
- **Pinned Messages** — Admins can pin one message per text channel; a bar above the chat shows a preview and jumps you straight to it (loading older history if needed), with a click.

### 🛡️ Administration & Security
- **Role-Based Permissions** — Bitwise permission system with admin role management. Fine-grained access control.
- **Server Password Protection** — Optional `SERVER_PRIVATE_PASSWORD` env var with client-side password input.
- **Kick & Ban** — Admin right-click to kick users from voice channels. Ban button in the Users modal blacklists by instance ID with persistent unban support.

### 🖥️ Desktop Experience
- **Auto-Updates** — Checks for new releases on launch and installs them with one click; a "Check for Updates" button in the About tab lets you trigger it anytime.
- **"What's New" Modal** — The first time you open Reson8 after an update, a one-time modal summarizes what changed, sourced live from the GitHub release notes.
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

## 🖥️ Client UI

The client features a **three-pane TeamSpeak-style layout**:

```
┌──────────────────────────────────────────────────┐
│ 🎧 Reson8  [host] [nick] [🔑] [Connect]         │
├──────────────┬───────────────────────────────────┤
│              │ Server Log │ 💬 Chat │ ✉ DM       │
│  ▾ General   ├───────────────────────────────────┤
│    🔊 Lobby  │  [12:30:01] Connected to server   │
│     🟢 You   │  [12:30:05] Joined voice: Lobby   │
│     🟢 Alpha │  [12:30:12] Alpha joined Lobby    │
│    💬 Chat   │                                   │
│  ▾ Gaming    │                                   │
│    🔊 Game 1 │      📎 [Emoji] [Send]            │
│    🔊 Game 2 │                                   │
│              │                                   │
├──────────────┤                                   │
│ 🟢 Lobby     │                                   │
│ [🔇][🔕][📞]│ 🟢 Connected as You    [⚙][👥]   │
└──────────────┴───────────────────────────────────┘
```

- **Left Pane** — Collapsible channel tree with live occupant indicators and active speaker halos
- **Right Pane** — Tabbed content: Server log, text chat per channel, DM conversations
- **Bottom Left** — Voice controls (mute, deafen, leave) with channel name
- **Status Bar** — Connection status, nickname, settings gear, and users button with online indicator

---

## 📁 Project Structure

```
reson8/
├── apps/
│   ├── client/                 # Electron desktop client
│   │   ├── src/
│   │   │   ├── main.ts         # Electron main process (tray, PTT, link preview)
│   │   │   ├── preload.ts      # contextBridge API (60+ methods)
│   │   │   ├── renderer/       # UI (HTML + TypeScript)
│   │   │   └── services/
│   │   │       └── voice.service.ts  # mediasoup-client engine
│   │   └── scripts/
│   └── server/                 # Node.js signaling + SFU server
│       ├── src/
│       │   ├── index.ts        # Server entry point
│       │   ├── handlers/       # Socket.io event handlers
│       │   │   ├── connection.handler.ts   # Join/leave/disconnect + ban check
│       │   │   ├── voice.handler.ts        # WebRTC/mediasoup signaling
│       │   │   ├── channel.handler.ts      # Channel CRUD
│       │   │   ├── message.handler.ts      # Text messages
│       │   │   ├── dm.handler.ts           # Direct messages + online users
│       │   │   ├── admin.handler.ts        # Role management
│       │   │   └── moderation.handler.ts   # Kick & ban
│       │   ├── services/       # mediasoup, presence, permissions
│       │   ├── config/         # mediasoup configuration
│       │   └── plugins/        # Prisma, Redis Fastify plugins
│       ├── prisma/
│       │   ├── schema.prisma   # Database schema (8 models)
│       │   └── seed.ts         # Default server + channels + roles
│       ├── Dockerfile
│       └── entrypoint.sh
├── packages/
│   └── shared-types/           # Shared DTOs, enums, Socket.io event types
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

---

## 🤝 Contributing

This is currently a private project. If you'd like to contribute, please reach out to the author directly.

---

<div align="center">

Made with ❤️ by **Felipe B. Netto**

*Because your voice deserves its own server.*

</div>
