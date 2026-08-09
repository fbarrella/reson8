# Product Requirements Document (PRD): Reson8

**Version:** 1.0  
**Target LLM:** Claude Opus (Context-Optimized)  
**Author:** Felipe Barrella Netto

---

## 1. Executive Summary & Vision
Project Reson8 is a high-performance, self-hosted voice and text communication platform for desktop. The goal is to replicate the "TeamSpeak 3" experience—low-latency voice, hierarchical channel trees, and private server ownership—while integrating modern persistent text channels similar to Discord. 

The system consists of a **Standalone Client** (Electron) and a **Standalone Server** (Node.js/Docker) that operates independently of the client.

---

## 2. Technical Stack (The "Velocity" Stack)
The following stack is selected to maximize code reuse and development speed for a solo senior developer using a unified TypeScript ecosystem.

| Layer | Technology | Justification |
| :--- | :--- | :--- |
| **Desktop Shell** | Electron | Required for global hotkeys (Push-to-Talk) and native system integration. |
| **Frontend** | React + Tailwind CSS | Rapid UI development with utility-first styling. |
| **State Management** | Zustand | Lightweight, high-performance state for real-time voice and UI updates. |
| **Voice Media Engine** | **mediasoup (SFU)** | A Node.js SFU that handles WebRTC media routing. Prevents P2P mesh bottlenecks for many-to-many voice. |
| **Signaling/Chat** | Socket.io + Fastify | Real-time event bus for text chat and WebRTC handshake. |
| **Database/ORM** | PostgreSQL + Prisma | Robust relational handling for complex role hierarchies and bitwise permissions. |
| **Caching/Presence** | Redis | Fast tracking of online users and channel occupancy. |
| **Containerization** | Docker | Allows users to deploy the "Server App" easily on a VPS. |

---

## 3. UI/UX Architecture (Image-Informed)
The application layout must strictly adhere to the functional structure seen in the provided reference (the @ui-reference.jpg file).

### 3.1. Main Three-Pane Layout
* **Top Toolbar:** A native-style menu bar (Connections, Bookmarks, Permissions) and a toolbar for quick actions like "Mute Microphone," "Deafen Speakers," and "Set Away".
* **Left Pane (The Tree):** A hierarchical view representing the Server, its Channels, and the sub-nodes for Users currently in those channels.
* **Right Pane (Info/Details):** Displays detailed stats based on selection (e.g., Server address, version, uptime, client count: 1/32).
* **Bottom Pane (Tabbed Log/Chat):** A consolidated text area. The primary tab acts as a "Server Log" showing system messages (e.g., "'Alpha' was added to server group 'Server Admin (6)'"), while secondary tabs handle text chat for the current channel.
* **Status Bar:** A persistent bar at the bottom showing connection status and the current nickname ("Connected as Alpha").

---

## 4. Core Functional Requirements

### 4.1. Voice Engine (The SFU Approach)
* The server must implement a **Selective Forwarding Unit (SFU)** using `mediasoup`.
* Clients upload one audio track; the server forwards that track to all other authorized participants in the channel.
* **Push-to-Talk (PTT):** Must use Electron's `globalShortcut` API to enable PTT even when the app is minimized.

### 4.2. Customizable Roles & Permissions
* **Bitwise Permissions:** Implement a `bigint` field in the PostgreSQL `Roles` table.
* **Granular Control:** Permissions should include `CONNECT`, `SPEAK`, `CREATE_CHANNEL`, `MANAGE_ROLES`, and `KICK_USER`.
* **Hierarchy:** Roles have a numeric "Power Level." A user can only kick or modify roles of users with a lower power level.

### 4.3. Client-Server Independence
* The **Server App** must be a headless Node.js process with its own database.
* The **Client App** must allow users to input a custom Server IP/Domain and Port to connect.

---

## 5. Detailed Implementation Roadmap

### Phase 1: Signaling & Presence (Foundation)
* Setup Fastify + Socket.io server.
* Implement Redis-backed presence (knowing which user is in which room).
* Create a basic Electron shell that connects to the signaling port.

### Phase 2: The Voice Bridge (mediasoup)
* Integrate `mediasoup` into the Node.js backend.
* Establish WebRTC "Producer" (Mic input) and "Consumer" (Speaker output) flows.
* *Milestone:* Two users in the same room can hear each other.

### Phase 3: Relational Logic & Hierarchy
* Define Prisma schemas for `Server`, `Channel`, `User`, and `Role`.
* Build the tree-view navigation in the Electron Left Pane.
* *Milestone:* Users can create channels and move between them visually.

### Phase 4: Permissions & Persistent Text
* Implement the bitwise permission check middleware on the server.
* Build the tabbed chat UI for the Bottom Pane.
* Implement message persistence in PostgreSQL.

### Phase 5: Desktop UX, Audio Polish & Admin
* Implement an Electron `globalShortcut` for system-wide Push-to-Talk.
* Build the Details Pane (Right side) to display server/user information and settings depending on context.
* **Role Management UI:** Add an interface for the Server Admin to assign roles to users within the new Server Settings pane.
* Add audio settings allowing users to select their input/output devices. selection).

### Phase 6: Deployment & Packaging
* Dockerize the Server App (Node + Postgres + Redis).
* Package the Client for Windows/Linux/macOS using Electron Builder.