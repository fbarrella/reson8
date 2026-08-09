# Product Requirements Document (PRD): Reson8 - Phase 7 & Evolutions

**Version:** 2.0  
**Target:** Phase 7 Evolutions  

## 1. Executive Summary & Vision
Reacting to the successful completion of the first 6 development phases, Project Reson8 has a functioning Desktop MVP acting as a self-hosted voice and text communication platform utilizing Electron, mediasoup, PostgreSQL, and Fastify + Socket.io. 

This document outlines the next stage of evolution (Phase 7 and beyond), focusing on critical bug fixes, enhanced networking for self-hosted instances, quality of life features, privacy enhancements via Direct Messaging, and rich media support.

---

## 2. Planned Evolutions

### 2.1. Critical Bug Fix: Dual Channel Connection
- **Problem**: Users are occasionally able to "join" two voice channels simultaneously when rapidly clicking through channels. This violates the core rule of one active voice connection per user.
- **Requirement**: Investigate the race conditions during rapid channel switching. Implement a strict state-lock or debouncing mechanism on the client and server to ensure any existing WebRTC transport/session is fully terminated and cleaned up *before* a new connection is established. It must be strictly impossible to stream or receive audio from two different channels concurrently.

### 2.2. Advanced Server Connection Flow (Public/Private Announce IPs)
- **Problem**: When a server host exposes their internal server publicly via `MEDIASOUP_ANNOUNCED_IP`, they cannot connect to the server from *inside* their own network using that public IP due to hairpin NAT restrictions or network topography limits, effectively isolating the host from their own server.
- **Requirement**: 
  - Allow multiple "listen" or "announced" IPs.
  - Introduce a new environment variable: `MEDIASOUP_PRIVATE_ANNOUNCED_IP` for the internal network IP.
  - The server should be aware of both entrypoints (if `MEDIASOUP_ANNOUNCED_IP` is the public one and the private one is filled, utilize both. If only the public is provided, behave as currently).
  - The Client WebRTC connection logic must be updated to handle ICE candidate fallback. It should first attempt to connect using the public URL/IP candidate; if there is no response or connection fails, it must automatically fallback and try the private ICE candidate.

### 2.3. Push-To-Talk (PTT) Mode Toggle
- **Problem**: PTT is currently linked intrinsically to whether a shortcut is defined. The user must actively manually mute their mic via the main UI to stop sending audio when not holding the key, which creates a disjointed and unusual UX.
- **Requirement**: Extract the core "Mute" setting from PTT. Add a specific "Push to Talk Mode" toggle in the Voice & Shortcuts settings. When enabled, the microphone is placed in a muted state by default and only logically "unmutes" (starts transmitting) *while* the designated shortcut is pressed. The standard "Mute" UI button should remain independent for users not using PTT, allowing users to universally mute themselves.

### 2.4. Explicit Save Action for Voice Devices
- **Problem**: When changing input (mic) and output (playback) devices in the Settings modal, there is no confirm/save button, creating ambiguity about whether the changes took effect immediately or require additional action.
- **Requirement**: Add a dedicated "Save" button to the "Voice & Shortcuts" settings panel. The selected microphone and speaker devices should only be written to local storage and actively applied to the audio streams/devices once the user clicks "Save".

### 2.5. Server Information Persistence
- **Problem**: Users must manually re-type the Server IP/URL and their Username upon every launch of the Reson8 client.
- **Requirement**: Add a "Remember me" or "Save Server Information" checkbox on the connection screen. If checked, the client will persistently store the Server URL and Username (and optionally the password, see section 2.6) in local storage or a secure store, automatically loading and populating these fields on subsequent launches. Users can opt not to save this data.

### 2.6. Private Server Access (Password Field)
- **Problem**: Servers are currently accessible to anyone who simply knows the address.
- **Requirement**: 
  - Introduce a `SERVER_PRIVATE_PASSWORD` environment variable for the backend.
  - If configured, the server will reject any signaling/connection attempts that do not provide the correct password during the handshake.
  - On the Client Side, add an optional "Server Password" input field to the connection screen.
  - Integration with 2.5: If the user opts to save server information, the inputted password should also be saved and reloaded upon application launch.

### 2.7. Direct Messaging (Whisper / Private Chat)
- **Problem**: Privacy is limited as all text communication relies on public/server-wide text channels.
- **Requirement**: 
  - Implement 1-to-1 direct communication between users remotely connected to the same server, independent of standard channels.
  - Introduce a UI button (e.g., "Online Users") that opens a window/modal listing currently logged-in users.
  - Add a "DM User" button next to names within this list. Clicking it closes the list and triggers a dedicated Private Chat window/layout.
  - Private chats must support communication history and store it within the server's database seamlessly. Users can close the private chat panel and continue using the app.

### 2.8. Rich Media Support (Image Sharing)
- **Problem**: Text chats are currently strictly textual. The platform requires essential media sharing mechanisms.
- **Requirement**: 
  - Support image uploads within standard server text channels and private messaging windows.
  - Provide dual storage capabilities on the Server:
     1. Local self-hosted file storage (to preserve absolute data ownership for private deployments), OR
     2. Cloudinary CDN integration.
  - The storage mode is determined dynamically based on the presence of Cloudinary environment variables.
  - Client interface: Users can upload an image by clicking an attachment icon to browse device folders, or optimally by pasting an image from their clipboard directly into the chat input.

### 2.9. Active Speaker Visual Indicator
- **Problem**: The UI lacks visual markers identifying *who* in the channel is actively transmitting audio, making group conversations difficult to navigate.
- **Requirement**: 
  - Enhance the green user-status dot in the Channel Tree.
  - When the client's WebRTC implementation detects an active inbound audio stream originating from a specific peer, render a colored 'halo' or ring-animation around their avatar indicator.
  - If multiple users are speaking concurrently, all corresponding status nodes must highlight simultaneously.
  - Strict calibration: Ensure voice activity detection (VAD) limits are correctly handled to strictly prevent false positives (e.g., highlighting continuous background noise).

### 2.10. System Tray Minimization
- **Problem**: Minimizing the Electron application merely pushes it off-screen but keeps the taskbar icon visibly active. 
- **Requirement**: 
  - Add a configuration option via Settings: "Minimize to System Tray". When enabled, minimizing hides the app fully from the taskbar, placing a corresponding icon solely in the OS system tray.
  - Add another interconnected option: "Close button minimizes to tray". If checked, actuating the window's standard 'X' close button will intercept the quit event and minimize the application into the tray instead.
  - Introduce a right-click Context Menu appended to the tray icon with basic options to "Restore" the app block and an explicit "Quit" button to forcefully and securely terminate the process.

### 2.11. Rich Previews (Link Previews)
- **Problem**: Users share links without any contextual preview, forcing peers to click blind links to see their content.
- **Requirement**: 
  - Enhance the chat interface to detect URLs and fetch metadata (title, description, image, etc.) using the `metascraper` library.
  - Fetching should be executed via IPC, delegating the request to the Electron Main Process which will use Electron's native `net` module for improved performance and bypassing CORS issues.
  - Implement robust HTML sanitization before rendering the fetched metadata in the DOM to prevent XSS attacks.
  - Add visual "Rich Preview" cards attached to messages.

### 2.12. Emoji Selector
- **Problem**: Text chats are not expressive enough, and users currently must rely on OS-level keyboards to insert emojis.
- **Requirement**: 
  - Implement a dedicated Emoji Selector component within the text chat interface.
  - Allow users to click the button to browse and insert emojis directly into the current chat input field.

### 2.13. Right-Click Context Menu
- **Problem**: Right-clicking inside the Electron application does nothing. Users accustomed to standard desktop workflows expect a context menu with common text-editing actions such as Copy, Paste, Cut, and Select All. Without it, users must rely solely on keyboard shortcuts, which is unintuitive and reduces accessibility.
- **Requirement**: 
  - Implement a native or custom right-click context menu within the Electron renderer process.
  - The context menu must include at minimum: **Cut**, **Copy**, **Paste**, and **Select All** actions.
  - Actions should operate on the currently focused text input or selected text within the application.
  - The context menu should appear at the cursor position and dismiss on click-away or action selection.
  - Ensure the menu is styled consistently with the existing Reson8 dark theme and does not break any existing UI interactions.

### 2.14. Persistent DM Conversations (Offline Access)
- **Problem**: Direct message conversations are currently only accessible when both users are online. Once a user goes offline, their DM chat disappears from the "Online Users" list, making asynchronous messaging impossible. Users cannot read history or send messages to offline peers, even if they have an existing conversation.
- **Requirement**: 
  - **First contact rule**: To initiate a brand-new DM conversation, both users must still be online (preserving the current behavior for starting new chats).
  - **Persistent access**: Once at least one message has been exchanged between two users, their DM conversation must remain accessible in the "Online Users" modal regardless of the other user's online/offline status.
  - The "Online Users" modal should be restructured to show two sections or a unified list that includes both currently online users and offline users with whom the current user has an existing DM history.
  - **Status indicators**: The status dot next to each user must accurately reflect their current connection state — green for online, gray for offline. An offline user's DM chat entry must clearly convey that the user is not currently connected, while still allowing the chat to be opened.
  - **Message delivery**: Messages sent to an offline user should be persisted in the database. When the recipient comes back online and opens the conversation, they should see all messages sent while they were away (leveraging the existing DM history fetch mechanism).
  - The existing unread message indicators and read receipt logic should continue to function correctly for messages sent to offline users.

---

## 3. Development Cadence & Documentation
Throughout Phase 7 and any future evolutions, development context MUST be strictly maintained to ensure continuity across different AI task executions and development sessions.

### 3.1. Progress Log Maintenance
- **Requirement**: The `progress.txt` file located in the `app-planning` directory MUST be updated religiously after every significant code implementation, bug fix, or feature completion.
- **Protocol**: 
  - Log the completed item, the key files created/modified, and a brief description of the technical implementation or problem solved.
  - This file serves as the definitive source of truth for the project's current state and active architecture.
