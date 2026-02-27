/**
 * Reson8 Client — Renderer Script
 *
 * Handles the UI logic for connection, event logging, and voice controls.
 * Communicates with the main process via the `reson8Api` bridge
 * exposed by the preload script.
 */

// Type declaration for the preload-exposed API
// (No `export {}` — this file is loaded as a <script> tag, not a module)
interface Window {
    reson8Api: {
        connect(host: string, port?: number): void;
        disconnect(): void;
        on(event: string, callback: (...args: any[]) => void): void;
        off(event: string): void;
        joinServer(
            serverId: string,
            nickname: string,
        ): Promise<{ success: boolean; error?: string }>;
        joinChannel(
            channelId: string,
        ): Promise<{ success: boolean; error?: string }>;
        joinVoiceChannel(
            channelId: string,
        ): Promise<{ success: boolean; error?: string }>;
        leaveVoiceChannel(): Promise<void>;
        toggleMute(): boolean;
        toggleDeafen(): boolean;
        isInVoice(): boolean;
        isMuted(): boolean;
    };
}

// ── DOM Elements ──────────────────────────────────────────────────────────
const hostInput = document.getElementById("serverHost") as HTMLInputElement;
const portInput = document.getElementById("serverPort") as HTMLInputElement;
const nicknameInput = document.getElementById("nickname") as HTMLInputElement;
const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement;
const disconnectBtn = document.getElementById("disconnectBtn") as HTMLButtonElement;
const logArea = document.getElementById("logArea") as HTMLDivElement;
const statusText = document.getElementById("statusText") as HTMLSpanElement;

// Voice controls
const joinVoiceBtn = document.getElementById("joinVoiceBtn") as HTMLButtonElement;
const muteBtn = document.getElementById("muteBtn") as HTMLButtonElement;
const deafenBtn = document.getElementById("deafenBtn") as HTMLButtonElement;
const voiceStatus = document.getElementById("voiceStatus") as HTMLSpanElement;

// Voice state
let inVoice = false;
let isMuted = false;
let isDeafened = false;

// ── Logging Utility ──────────────────────────────────────────────────────

function log(
    message: string,
    type: "info" | "success" | "error" | "event" = "info",
): void {
    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;

    const now = new Date();
    const ts = now.toLocaleTimeString("en-US", { hour12: false });

    entry.innerHTML = `<span class="timestamp">&lt;${ts}&gt;</span> ${message}`;
    logArea.appendChild(entry);
    logArea.scrollTop = logArea.scrollHeight;
}

// ── Connect / Disconnect ─────────────────────────────────────────────────

connectBtn.addEventListener("click", () => {
    const host = hostInput.value.trim() || "localhost";
    const port = parseInt(portInput.value, 10) || 9800;

    log(`Trying to resolve hostname <b>${host}</b>...`);
    log(`Trying to connect to server on <b>${host}:${port}</b>...`);

    window.reson8Api.connect(host, port);
});

disconnectBtn.addEventListener("click", () => {
    window.reson8Api.disconnect();
    log("Disconnected from server.", "info");

    statusText.textContent = "Disconnected";
    statusText.className = "disconnected";
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    joinVoiceBtn.disabled = true;
    muteBtn.disabled = true;
    deafenBtn.disabled = true;
    updateVoiceUI(false);
});

// ── Voice Controls ───────────────────────────────────────────────────────

joinVoiceBtn.addEventListener("click", async () => {
    if (inVoice) {
        // Leave voice
        await window.reson8Api.leaveVoiceChannel();
        updateVoiceUI(false);
        log("Left voice channel.", "info");
    } else {
        // Join voice — use "default" channel for Phase 2 testing
        log("Joining voice channel...", "info");
        const result = await window.reson8Api.joinVoiceChannel("default-voice");
        if (result.success) {
            updateVoiceUI(true);
            log("🔊 Joined voice channel! Mic is active.", "success");
        } else {
            log(`Failed to join voice: ${result.error}`, "error");
        }
    }
});

muteBtn.addEventListener("click", () => {
    isMuted = window.reson8Api.toggleMute();
    muteBtn.textContent = isMuted ? "🔊" : "🔇";
    muteBtn.classList.toggle("active", isMuted);
    muteBtn.title = isMuted ? "Unmute" : "Mute";
    log(isMuted ? "Microphone muted." : "Microphone unmuted.", "info");
});

deafenBtn.addEventListener("click", () => {
    isDeafened = window.reson8Api.toggleDeafen();
    deafenBtn.textContent = isDeafened ? "🔉" : "🔈";
    deafenBtn.classList.toggle("active", isDeafened);
    deafenBtn.title = isDeafened ? "Undeafen" : "Deafen";
    log(isDeafened ? "Audio deafened." : "Audio undeafened.", "info");
});

function updateVoiceUI(joined: boolean): void {
    inVoice = joined;
    if (joined) {
        joinVoiceBtn.textContent = "📤 Leave";
        joinVoiceBtn.title = "Leave Voice Channel";
        muteBtn.disabled = false;
        deafenBtn.disabled = false;
        voiceStatus.textContent = "🔊 In Voice";
        voiceStatus.className = "voice-status";
    } else {
        joinVoiceBtn.textContent = "🎤 Voice";
        joinVoiceBtn.title = "Join Voice Channel";
        muteBtn.disabled = true;
        deafenBtn.disabled = true;
        muteBtn.textContent = "🔇";
        muteBtn.title = "Mute";
        muteBtn.classList.remove("active");
        deafenBtn.textContent = "🔈";
        deafenBtn.title = "Deafen";
        deafenBtn.classList.remove("active");
        voiceStatus.textContent = "–";
        voiceStatus.className = "voice-status inactive";
        isMuted = false;
        isDeafened = false;
    }
}

// ── Register Reson8 Event Listeners ──────────────────────────────────────

window.reson8Api.on("connected", async (data: { socketId: string }) => {
    log(`Connected to server. Socket ID: <b>${data.socketId}</b>`, "success");

    statusText.textContent = `Connected as ${nicknameInput.value}`;
    statusText.className = "connected";
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    joinVoiceBtn.disabled = false;

    // Auto-join the default server
    const nickname = nicknameInput.value.trim() || "Alpha";
    const result = await window.reson8Api.joinServer("default", nickname);

    if (result.success) {
        log(`Joined server as <b>${nickname}</b>.`, "success");
    } else {
        log(`Failed to join server: ${result.error}`, "error");
    }
});

window.reson8Api.on("disconnected", (data: { reason: string }) => {
    log(`Disconnected: ${data.reason}`, "error");

    statusText.textContent = "Disconnected";
    statusText.className = "disconnected";
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    joinVoiceBtn.disabled = true;
    updateVoiceUI(false);
});

window.reson8Api.on(
    "user-joined",
    (data: { nickname: string; userId: string }) => {
        log(`<b>"${data.nickname}"</b> joined the server.`, "event");
    },
);

window.reson8Api.on("user-left", (data: { userId: string }) => {
    log(`User <b>${data.userId}</b> left the server.`, "event");
});

window.reson8Api.on("channel-tree", (data: { tree: any[] }) => {
    log(
        `Received channel tree update: ${data.tree.length} root channel(s).`,
        "event",
    );
});

window.reson8Api.on(
    "presence",
    (data: { channelId: string; occupants: any[] }) => {
        log(
            `Presence update for channel <b>${data.channelId}</b>: ${data.occupants.length} user(s).`,
            "event",
        );
    },
);

window.reson8Api.on("error", (data: { code: string; message: string }) => {
    log(`Server error [${data.code}]: ${data.message}`, "error");
});

// Voice events
window.reson8Api.on("voice-status", (data: { event: string; channelId?: string; userId?: string }) => {
    if (data.event === "consuming") {
        log(`🔊 Consuming audio from user <b>${data.userId}</b>.`, "event");
    }
});

window.reson8Api.on("new-producer", (data: { userId: string; nickname: string }) => {
    log(`🎤 <b>"${data.nickname}"</b> started speaking.`, "event");
});

window.reson8Api.on("producer-closed", (data: { userId: string }) => {
    log(`🔇 User <b>${data.userId}</b> stopped producing audio.`, "event");
});

// ── Initial Log ──────────────────────────────────────────────────────────
log("Reson8 Client initialized. Enter a server address and click Connect.");
