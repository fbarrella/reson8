<div align="center">

# <img src="./logo_512x512.png" width="36" align="center" alt="Reson8 Logo"> Reson8

**Self-hosted voice & text communication — your server, your rules.**

A high-performance desktop communication platform inspired by TeamSpeak 3,
built with modern technology for low-latency voice, hierarchical channel trees,
and private server ownership.

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

🔊 **Crystal-Clear Voice** — Low-latency SFU-based audio via mediasoup. No peer-to-peer bottlenecks, even in large groups.

🌳 **Channel Tree** — Hierarchical channel structure with categories, voice rooms, and text channels — just like TeamSpeak.

👥 **Real-Time Presence** — See who's online and in which channel, instantly updated across all connected clients.

🎛️ **Full Voice Controls** — Mute, deafen, and leave voice with a single click. Tooltips for every action.

➕ **Channel Management** — Create, rename, and delete channels on the fly. Changes propagate to all clients in real-time.

🐳 **One-Command Server** — Spin up the entire stack with `docker compose up`. Postgres, Redis, and the Reson8 server, all containerized.

🔒 **Self-Hosted** — Your data stays on your hardware. No third-party servers, no telemetry, no compromises.

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
| **Database** | PostgreSQL + Prisma | Channels, users, roles, messages |
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
│ 🎧 Reson8  [host] [port] [nick] [Connect]       │
├──────────────┬───────────────────────────────────┤
│              │                                   │
│  ▾ General   │  Server Log                       │
│    🔊 Lobby  │  [12:30:01] Connected to server   │
│      └ You   │  [12:30:05] Joined voice: Lobby   │
│    💬 Chat   │  [12:30:12] Alpha joined Lobby    │
│  ▾ Gaming    │                                   │
│    🔊 Game 1 │                                   │
│    🔊 Game 2 │                                   │
│              │                                   │
├──────────────┤                                   │
│ 🟢 Lobby     │                                   │
│ [Mute][Deaf] │ Connected as You                  │
└──────────────┴───────────────────────────────────┘
```

- **Left Pane** — Collapsible channel tree with live occupant indicators
- **Right Pane** — Server event log
- **Bottom Left** — Voice controls (mute, deafen, leave)
- **Status Bar** — Connection status and nickname

---

## 📁 Project Structure

```
reson8/
├── apps/
│   ├── client/                 # Electron desktop client
│   │   ├── src/
│   │   │   ├── main.ts         # Electron main process
│   │   │   ├── preload.ts      # contextBridge API
│   │   │   ├── renderer/       # UI (HTML + TypeScript)
│   │   │   └── services/
│   │   │       └── voice.service.ts  # mediasoup-client engine
│   │   └── scripts/
│   └── server/                 # Node.js signaling + SFU server
│       ├── src/
│       │   ├── index.ts        # Server entry point
│       │   ├── handlers/       # Socket.io event handlers
│       │   ├── services/       # mediasoup, presence, channel-tree
│       │   ├── config/         # mediasoup configuration
│       │   └── plugins/        # Prisma, Redis Fastify plugins
│       ├── prisma/
│       │   ├── schema.prisma   # Database schema
│       │   └── seed.ts         # Default server + channels
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
| 4 | **Permissions & Text Chat** — Bitwise roles, tabbed chat, message persistence | 🔜 Next |
| 5 | **Desktop UX & Audio** — Push-to-Talk, details pane, audio device selection | ⬜ Planned |
| 6 | **Deployment & Packaging** — Electron Builder for Win/Linux/macOS | ⬜ Planned |

---

## 🤝 Contributing

This is currently a private project. If you'd like to contribute, please reach out to the author directly.

---

<div align="center">

Made with ❤️ by **Felipe B. Netto**

*Because your voice deserves its own server.*

</div>
