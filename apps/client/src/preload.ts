/**
 * Reson8 Client — Preload Script
 *
 * Exposes a safe `reson8Api` bridge to the renderer via contextBridge.
 * Uses callback registration for events (contextIsolation separates windows).
 * Integrates VoiceService for WebRTC audio.
 */

import { contextBridge, ipcRenderer } from "electron";
import { io, Socket } from "socket.io-client";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    IMessage,
    IDirectMessage,
    ICustomEmoji,
    IPinnedMessage,
} from "@reson8/shared-types";
import { VoiceService, VoiceSignaling } from "./services/voice.service";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: TypedSocket | null = null;
let instanceId: string = "";
let voiceService: VoiceService | null = null;

// ── Screen share audio pipeline state (PRD 12.7) ────────────────────────
// Owned here, not inside VoiceService, because assembling a MediaStreamTrack
// from native-audio PCM frames requires ipcRenderer — VoiceService is kept
// free of direct Electron/IPC coupling (it takes a `VoiceSignaling`
// interface via constructor injection instead), and this preload script is
// the layer that already owns that coupling for everything else.
let screenAudioGenerator: MediaStreamTrackGenerator<AudioData> | null = null;
let screenAudioWriter: WritableStreamDefaultWriter<AudioData> | null = null;
/** Running sample count, used to derive monotonically increasing AudioData
 *  timestamps from the sample rate rather than wall-clock time — avoids
 *  drift/gaps if IPC delivery is jittery. */
let screenAudioSamplesWritten = 0;
let serverBaseUrl: string = "";
let joinServerInFlight = false;
let latencyMs: number = -1;
/**
 * Best current estimate of (server clock) - (this machine's clock), in ms.
 * Derived from each PING_LATENCY round trip (NTP-style: offset ≈ serverTime
 * - (localSendTime + rtt / 2)) and refreshed every ~3s alongside latency.
 * Used to correct the voice session timer against clock skew between the
 * client and server hosts — see PRD 11.2.
 */
let clockOffsetMs: number = 0;

/**
 * The voice channel the user is meant to be in — set on every successful
 * join, cleared on an explicit leave/disconnect. Used to auto-rejoin voice
 * after a Socket.io reconnect or a WebRTC-level connection failure, since
 * neither the server nor mediasoup transports survive either event (PRD
 * 11.1) and nothing previously re-established voice automatically.
 */
let lastVoiceChannelId: string | null = null;
let voiceRejoinInFlight = false;

async function uploadTo(
    endpoint: string,
    fileBuffer: ArrayBuffer,
    fileName: string,
    mimeType: string,
): Promise<{ url: string; publicId?: string }> {
    if (!serverBaseUrl) {
        throw new Error("Not connected to a server");
    }

    const formData = new FormData();
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append("file", blob, fileName);

    const response = await fetch(`${serverBaseUrl}${endpoint}`, {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        const errBody = await response.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(errBody.error || `Upload failed (${response.status})`);
    }

    const result = await response.json();

    // If the URL is relative (local storage), prepend the server base URL
    if (result.url && result.url.startsWith("/")) {
        result.url = `${serverBaseUrl}${result.url}`;
    }

    return result;
}

// Eagerly fetch instance ID so it's available before any connection
ipcRenderer.invoke("get-instance-id").then((id: string) => {
    instanceId = id;
});

// ── Callback registry ────────────────────────────────────────────────────

type Callback = (...args: any[]) => void;
const listeners: Record<string, Callback[]> = {};

function emit(event: string, data: any): void {
    const cbs = listeners[event];
    if (cbs) {
        for (const cb of cbs) {
            try {
                cb(data);
            } catch (err) {
                console.error(`[reson8] Error in listener for "${event}":`, err);
            }
        }
    }
}

/**
 * Creates a VoiceSignaling adapter that wraps Socket.io events
 * into Promise-based calls for the VoiceService.
 */
function createSignaling(): VoiceSignaling {
    return {
        getRouterCapabilities(channelId) {
            return new Promise((resolve) => {
                socket!.emit("GET_ROUTER_CAPABILITIES", { channelId }, resolve);
            });
        },
        createTransport(channelId, direction) {
            return new Promise((resolve) => {
                socket!.emit(
                    "CREATE_WEBRTC_TRANSPORT",
                    { channelId, direction },
                    resolve,
                );
            });
        },
        connectTransport(transportId, dtlsParameters) {
            return new Promise((resolve) => {
                socket!.emit(
                    "CONNECT_TRANSPORT",
                    { transportId, dtlsParameters },
                    resolve,
                );
            });
        },
        produce(transportId, kind, rtpParameters, appData) {
            return new Promise((resolve) => {
                socket!.emit(
                    "PRODUCE",
                    { transportId, kind, rtpParameters, appData },
                    resolve,
                );
            });
        },
        consume(producerId, rtpCapabilities) {
            return new Promise((resolve) => {
                socket!.emit("CONSUME", { producerId, rtpCapabilities }, resolve);
            });
        },
        resumeConsumer(consumerId) {
            return new Promise((resolve) => {
                socket!.emit("RESUME_CONSUMER", { consumerId }, resolve);
            });
        },
        restartIce(transportId) {
            return new Promise((resolve) => {
                socket!.emit("RESTART_ICE", { transportId }, resolve);
            });
        },
        closeProducer(producerId) {
            socket?.emit("CLOSE_PRODUCER", { producerId });
        },
    };
}

/** Measures round-trip latency and derives the client↔server clock offset
 *  from a single PING_LATENCY round trip (PRD 11.2). */
function measureLatencyAndClockOffset(): void {
    if (!socket?.connected) return;
    const localSendTime = Date.now();
    socket.emit("PING_LATENCY", (serverTime: number) => {
        const localReceiveTime = Date.now();
        const rtt = localReceiveTime - localSendTime;
        latencyMs = rtt;
        clockOffsetMs = serverTime - (localSendTime + rtt / 2);
    });
}

/** Wires a freshly-constructed VoiceService's failure callbacks. */
function wireVoiceServiceCallbacks(vs: VoiceService): void {
    vs.onConnectionLost = () => {
        emit("voice-connection-lost", null);
        if (lastVoiceChannelId) {
            attemptVoiceRejoin(lastVoiceChannelId);
        }
    };
    vs.onError = (message: string) => {
        emit("voice-error", { message });
    };
}

/**
 * Rejoins a voice channel after it was lost — either because the Socket.io
 * connection dropped and reconnected, or because a WebRTC transport reported
 * an unrecovered connection failure while signaling stayed up. Retries the
 * full join handshake a few times before giving up, since the very first
 * attempt can race a server that's still finishing its own cleanup of the
 * old session.
 */
async function attemptVoiceRejoin(channelId: string): Promise<void> {
    if (voiceRejoinInFlight) return;
    if (!socket?.connected) return; // the "connect" handler will retry once reconnected
    voiceRejoinInFlight = true;
    emit("voice-reconnecting", { channelId });

    const MAX_ATTEMPTS = 3;
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            voiceService?.cleanup();
            voiceService = new VoiceService(createSignaling());
            wireVoiceServiceCallbacks(voiceService);

            const joinRes = await new Promise<{ success: boolean; error?: string }>((resolve) => {
                socket!.emit("USER_JOIN_CHANNEL", { channelId }, resolve);
            });
            if (!joinRes.success) throw new Error(joinRes.error ?? "Failed to rejoin channel");

            await voiceService.joinVoiceChannel(channelId);

            lastVoiceChannelId = channelId;
            emit("voice-reconnected", { channelId });
            voiceRejoinInFlight = false;
            return;
        } catch (err: any) {
            lastError = err?.message ?? "Unknown error";
            if (attempt < MAX_ATTEMPTS) {
                await new Promise((resolve) => setTimeout(resolve, 1500));
            }
        }
    }

    voiceRejoinInFlight = false;
    lastVoiceChannelId = null;
    voiceService?.cleanup();
    emit("voice-rejoin-failed", { channelId, error: lastError });
}

const api = {
    // A static fact known at preload-load-time (PRD 12.11 needs it to tell
    // macOS's audio-capture warning apart from the generic "unsupported"
    // one) — a plain property, not a method, since it never changes and an
    // async round-trip would be pointless for it.
    platform: process.platform,

    // Linux/Wayland sessions route `desktopCapturer.getSources()` itself
    // through the xdg-desktop-portal ScreenCast picker (KDE/GNOME show
    // their own OS-level dialog before we ever get data back) — our own
    // Selection Modal would just be a second, redundant picker stacked on
    // top of that one. `XDG_SESSION_TYPE`/`WAYLAND_DISPLAY` are the
    // standard way to detect this; X11 sessions (where `getSources()`
    // silently enumerates with no OS dialog) keep the existing modal.
    isLinuxWayland:
        process.platform === "linux" &&
        (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY),

    // ── Identity ─────────────────────────────────────────────────────────────

    getInstanceId(): string {
        return instanceId;
    },

    async isExistingInstall(): Promise<boolean> {
        return ipcRenderer.invoke("is-existing-install");
    },

    // ── Connection ──────────────────────────────────────────────────────────

    async connect(host: string, port: number | undefined, nickname: string, password?: string): Promise<void> {
        if (socket?.connected) {
            socket.disconnect();
        }

        // Ensure we have instance ID (should already be fetched eagerly)
        if (!instanceId) {
            instanceId = await ipcRenderer.invoke("get-instance-id");
        }

        const serverUrl = port ? `http://${host}:${port}` : `http://${host}`;
        serverBaseUrl = serverUrl;
        socket = io(serverUrl, {
            transports: ["websocket"],
            reconnection: true,
            // Unlimited attempts (delay backs off up to Socket.io's 5s
            // default cap) — a weak connection that's still recovering
            // after the old 5-attempt/~17s ceiling would otherwise strand
            // the user in a disconnected state requiring a manual
            // reconnect, even though the server-side grace period
            // (connection.handler.ts) is happy to keep waiting far longer.
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
        }) as TypedSocket;

        // Initialize voice service with signaling adapter
        voiceService = new VoiceService(createSignaling());
        wireVoiceServiceCallbacks(voiceService);

        // Latency measurement — started after connect, cleared on disconnect
        let latencyInterval: ReturnType<typeof setInterval> | null = null;

        socket.on("connect", () => {
            // Guard against duplicate emissions from Socket.io auto-reconnect
            if (joinServerInFlight) return;
            joinServerInFlight = true;

            // Join the server — let the server decide the serverId
            socket!.emit(
                "USER_JOIN_SERVER",
                { nickname, instanceId, password },
                (res) => {
                    joinServerInFlight = false;
                    if (res.success && res.serverId) {
                        emit("connected", { serverId: res.serverId, instanceId });

                        // If we were in a voice channel before this connect
                        // (i.e. this is a reconnect, not the first-ever
                        // connect — lastVoiceChannelId is only set after a
                        // real join), silently rejoin it. The server already
                        // tore down our old mediasoup session on disconnect,
                        // so this is a fresh join, not a resume (PRD 11.1).
                        if (lastVoiceChannelId) {
                            attemptVoiceRejoin(lastVoiceChannelId);
                        }

                        // Start latency + clock-offset measurement interval
                        if (latencyInterval) clearInterval(latencyInterval);
                        latencyInterval = setInterval(() => {
                            if (!socket?.connected) return;
                            measureLatencyAndClockOffset();
                        }, 3000);
                        // Measure immediately on connect
                        measureLatencyAndClockOffset();
                    } else {
                        emit("error", {
                            code: "JOIN_FAILED",
                            message: res.error ?? "Failed to join server",
                        });
                        // Tear down the transport-level socket so a
                        // subsequent connect() doesn't fire a spurious
                        // "Disconnected" event for a session that never
                        // logically connected.
                        socket?.removeAllListeners();
                        socket?.disconnect();
                        socket = null;
                    }
                },
            );
        });

        socket.on("disconnect", (reason) => {
            latencyMs = -1;
            clockOffsetMs = 0;
            if (latencyInterval) {
                clearInterval(latencyInterval);
                latencyInterval = null;
            }
            voiceService?.cleanup();
            emit("disconnected", { reason });
        });

        socket.on("connect_error", (err) => {
            emit("error", { code: "CONNECT_ERROR", message: err.message });
        });

        // Channel & presence events
        socket.on("USER_JOINED", (payload) => emit("user-joined", payload));
        socket.on("USER_LEFT", (payload) => emit("user-left", payload));
        socket.on("CHANNEL_TREE_UPDATE", (payload) => emit("channel-tree", payload));
        socket.on("PRESENCE_UPDATE", (payload) => emit("presence", payload));
        socket.on("MESSAGE_RECEIVED", (payload) => emit("message", payload));
        socket.on("DIRECT_MESSAGE_RECEIVED", (payload) => emit("dm-received", payload));
        socket.on("MESSAGE_DELETED", (payload) => emit("message-deleted", payload));
        socket.on("DIRECT_MESSAGE_DELETED", (payload) => emit("dm-deleted", payload));
        socket.on("MESSAGE_EDITED", (payload) => emit("message-edited", payload));
        socket.on("CHANNEL_DELETED", (payload) => emit("channel-deleted", payload));
        socket.on("ERROR", (payload) => emit("error", payload));
        socket.on("ACTIVE_SPEAKERS", (payload) => emit("active-speakers", payload));
        socket.on("USER_KICKED", (payload) => emit("user-kicked", payload));
        socket.on("CHANNEL_USER_KICKED", (payload) => emit("channel-user-kicked", payload));
        socket.on("USER_BANNED", () => emit("user-banned", null));
        socket.on("REACTION_UPDATED", (payload) => emit("reaction-updated", payload));
        socket.on("CUSTOM_EMOJI_APPROVED", (payload) => emit("custom-emoji-approved", payload));
        socket.on("NUDGE_RECEIVED", (payload) => emit("nudge-received", payload));
        socket.on("SERVER_SETTINGS_UPDATED", (payload) => emit("server-settings-updated", payload));
        socket.on("CHANNEL_PIN_UPDATED", (payload) => emit("channel-pin-updated", payload));

        // Voice-specific events
        socket.on("NEW_PRODUCER", (payload) => {
            emit("new-producer", payload);
            // Only the mic Producer (no `mediaType`) auto-consumes. A
            // screen-share's video/audio (PRD 12.7/12.8) must NOT be pulled
            // by every channel member automatically — only by an explicit
            // viewer action (PRD 12.13's WATCH_SCREEN_SHARE).
            if (!payload.mediaType) {
                voiceService?.queueConsumeProducer(payload.producerId, payload.userId);
            }
        });

        socket.on("PRODUCER_CLOSED", (payload) => {
            emit("producer-closed", payload);
            voiceService?.removeConsumer(payload.producerId);
        });

        // Sound-cue only (PRD 13.16) — a viewer opened/closed the Viewer
        // window on this client's own screen share.
        socket.on("VIEWER_JOINED_YOUR_STREAM", () => emit("viewer-joined-your-stream", null));
        socket.on("VIEWER_LEFT_YOUR_STREAM", () => emit("viewer-left-your-stream", null));

        socket.on("EXISTING_PRODUCERS", (payload) => {
            for (const p of payload.producers) {
                voiceService?.queueConsumeProducer(p.producerId, p.userId);
            }
        });

        // Server-initiated voice-session loss (e.g. the mediasoup worker
        // hosting this channel crashed and was recycled) — rejoin exactly
        // like any other voice failure (PRD 11.1).
        socket.on("VOICE_SESSION_LOST", (payload) => {
            if (payload.channelId !== lastVoiceChannelId) return;
            attemptVoiceRejoin(payload.channelId);
        });
    },

    disconnect(): void {
        joinServerInFlight = false;
        lastVoiceChannelId = null;
        voiceRejoinInFlight = false;
        voiceService?.cleanup();
        voiceService = null;
        socket?.disconnect();
        socket = null;
    },

    on(event: string, callback: Callback): void {
        if (!listeners[event]) {
            listeners[event] = [];
        }
        listeners[event].push(callback);
    },

    // ── Voice ───────────────────────────────────────────────────────────────

    async joinVoiceChannel(
        channelId: string,
    ): Promise<{ success: boolean; error?: string }> {
        try {
            if (!socket?.connected) {
                return { success: false, error: "Not connected" };
            }

            // Clean up any existing voice session before starting a new one
            voiceService?.cleanup();
            voiceService = new VoiceService(createSignaling());
            wireVoiceServiceCallbacks(voiceService);

            // First, join the channel via Socket.io so the server sets currentChannelId
            const joinRes = await new Promise<{ success: boolean; error?: string }>(
                (resolve) => {
                    socket!.emit("USER_JOIN_CHANNEL", { channelId }, resolve);
                },
            );
            if (!joinRes.success) {
                return { success: false, error: joinRes.error ?? "Failed to join channel" };
            }

            // Now do the mediasoup voice handshake
            await voiceService.joinVoiceChannel(channelId);
            lastVoiceChannelId = channelId;
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    },

    leaveVoiceChannel(): void {
        lastVoiceChannelId = null;
        if (socket?.connected) {
            // Notify server we're leaving the channel
            const channelId = voiceService?.currentChannelId;
            if (channelId) {
                socket.emit("USER_LEAVE_CHANNEL", { channelId });
            }
        }
        // `voiceService.cleanup()` below closes the screen-audio mediasoup
        // Producer, but not the native capture session or the
        // MediaStreamTrackGenerator feeding it — those aren't owned by
        // VoiceService at all (PRD 12.7), so they need their own teardown
        // here rather than being implicitly covered by it.
        if (screenAudioGenerator) {
            void api.stopAppAudioCapture();
        }
        voiceService?.cleanup();
        // Reinitialize voice service for next join
        if (socket?.connected) {
            voiceService = new VoiceService(createSignaling());
            wireVoiceServiceCallbacks(voiceService);
        }
    },

    toggleMute(): boolean {
        return voiceService?.toggleMute() ?? false;
    },

    toggleDeafen(): { isMuted: boolean; isDeafened: boolean } {
        return voiceService?.toggleDeafen() ?? { isMuted: false, isDeafened: false };
    },

    setMuted(muted: boolean): void {
        voiceService?.setMuted(muted);
    },

    setVoiceState(isMuted: boolean, isDeafened: boolean): void {
        socket?.emit("SET_VOICE_STATE", { isMuted, isDeafened }, () => { });
    },

    /**
     * Tells other occupants whether this user currently has an active
     * screen share (PRD 12.12). `streamName`, when sharing, should be the
     * caller's own already-resolved display name (custom name if set,
     * else the real source name, else the generic fallback) — see
     * `SET_SCREEN_SHARE_STATE`'s doc comment in socket-events.ts.
     */
    setScreenShareState(isSharingScreen: boolean, streamName?: string): void {
        socket?.emit("SET_SCREEN_SHARE_STATE", { isSharingScreen, streamName }, () => { });
    },

    setLocalUserVolume(userId: string, percent: number): void {
        voiceService?.setLocalUserVolume(userId, percent);
    },

    setLocalUserMute(userId: string, muted: boolean): void {
        voiceService?.setLocalUserMute(userId, muted);
    },

    getLocalUserVolume(userId: string): number {
        return voiceService?.getLocalUserVolume(userId) ?? 100;
    },

    getLocalUserMute(userId: string): boolean {
        return voiceService?.getLocalUserMute(userId) ?? false;
    },

    setGlobalVoiceVolume(percent: number): void {
        voiceService?.setGlobalVoiceVolume(percent);
    },

    setMicVolume(percent: number): void {
        voiceService?.setMicVolume(percent);
    },

    async setNoiseCancelEnabled(enabled: boolean): Promise<void> {
        await voiceService?.setNoiseCancelEnabled(enabled);
    },

    // ── Audio Settings ──────────────────────────────────────────────────────

    async enumerateAudioDevices(): Promise<{ inputs: { deviceId: string; label: string }[]; outputs: { deviceId: string; label: string }[] }> {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices
            .filter((d) => d.kind === "audioinput")
            .map((d) => ({ deviceId: d.deviceId, label: d.label || `Mic ${d.deviceId.slice(0, 8)}` }));
        const outputs = devices
            .filter((d) => d.kind === "audiooutput")
            .map((d) => ({ deviceId: d.deviceId, label: d.label || `Speaker ${d.deviceId.slice(0, 8)}` }));
        return { inputs, outputs };
    },

    setAudioInputDevice(deviceId: string | null): void {
        voiceService?.setAudioDeviceId(deviceId);
    },

    // ── Channel CRUD ────────────────────────────────────────────────────────

    createChannel(
        serverId: string,
        name: string,
        type: "TEXT" | "VOICE",
        parentId?: string | null,
        isNsfw?: boolean,
    ): Promise<{ success: boolean; channelId?: string; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit(
                "CREATE_CHANNEL",
                { serverId, name, type, parentId: parentId ?? null, isNsfw },
                resolve,
            );
        });
    },

    updateChannel(
        channelId: string,
        changes: { name?: string; position?: number; isNsfw?: boolean },
    ): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("UPDATE_CHANNEL", { channelId, ...changes }, resolve);
        });
    },

    reorderChannels(
        parentId: string | null,
        orderedChannelIds: string[],
    ): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("REORDER_CHANNELS", { parentId, orderedChannelIds }, resolve);
        });
    },

    deleteChannel(
        channelId: string,
    ): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("DELETE_CHANNEL", { channelId }, resolve);
        });
    },

    // ── Text Chat ────────────────────────────────────────────────────────

    sendMessage(
        channelId: string,
        content: string,
        attachmentUrl?: string,
        attachmentPublicId?: string,
    ): Promise<{ success: boolean; messageId?: string; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false });
                return;
            }
            socket.emit("SEND_MESSAGE", { channelId, content, attachmentUrl, attachmentPublicId }, resolve);
        });
    },

    deleteMessage(messageId: string): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("DELETE_MESSAGE", { messageId }, resolve);
        });
    },

    editMessage(messageId: string, content: string): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("EDIT_MESSAGE", { messageId, content }, resolve);
        });
    },

    fetchMessages(
        channelId: string,
        before?: string,
        limit?: number,
        aroundMessageId?: string,
    ): Promise<{ success: boolean; messages?: IMessage[]; pinnedMessage?: IPinnedMessage | null; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit(
                "FETCH_MESSAGES",
                { channelId, before, limit, aroundMessageId },
                resolve,
            );
        });
    },

    // ── Pinned Messages ─────────────────────────────────────────────────

    pinMessage(channelId: string, messageId: string): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("PIN_MESSAGE", { channelId, messageId }, resolve);
        });
    },

    unpinMessage(channelId: string): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("UNPIN_MESSAGE", { channelId }, resolve);
        });
    },

    markChannelRead(channelId: string): Promise<{ success: boolean }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false });
                return;
            }
            socket.emit("MARK_CHANNEL_READ", { channelId }, resolve);
        });
    },

    // ── Admin / Role Management ──────────────────────────────────────────

    getAllUsers(
        serverId: string,
    ): Promise<{ success: boolean; users?: any[]; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("GET_ALL_USERS", { serverId }, resolve);
        });
    },

    getRoles(
        serverId: string,
    ): Promise<{ success: boolean; roles?: any[]; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("GET_ROLES", { serverId }, resolve);
        });
    },

    assignRole(
        userId: string,
        roleId: string,
        action: "add" | "remove",
    ): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("ASSIGN_ROLE", { userId, roleId, action }, resolve);
        });
    },

    // ── Direct Messaging ────────────────────────────────────────────────

    sendDirectMessage(
        recipientId: string,
        content: string,
        attachmentUrl?: string,
        attachmentPublicId?: string,
    ): Promise<{ success: boolean; messageId?: string; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("SEND_DIRECT_MESSAGE", { recipientId, content, attachmentUrl, attachmentPublicId }, resolve);
        });
    },

    deleteDirectMessage(dmId: string): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("DELETE_DIRECT_MESSAGE", { dmId }, resolve);
        });
    },

    fetchDirectMessages(
        partnerId: string,
        before?: string,
        limit?: number,
    ): Promise<{ success: boolean; messages?: IDirectMessage[]; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit(
                "FETCH_DIRECT_MESSAGES",
                { partnerId, before, limit },
                resolve,
            );
        });
    },

    getOnlineUsers(): Promise<{ success: boolean; users?: { userId: string; nickname: string; isOnline: boolean }[]; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("GET_ONLINE_USERS", resolve);
        });
    },

    markDmsRead(partnerId: string): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("MARK_DMS_READ", { partnerId }, resolve);
        });
    },

    getUnreadDmPartners(): Promise<{ success: boolean; partners?: { partnerId: string; partnerNickname: string; unreadCount: number }[]; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("GET_UNREAD_DM_PARTNERS", resolve);
        });
    },

    // ── Moderation ───────────────────────────────────────────────────────

    kickUser(userId: string, channelId: string): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("KICK_USER", { userId, channelId }, resolve);
        });
    },

    banUser(userId: string): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("BAN_USER", { userId }, resolve);
        });
    },

    unbanUser(userId: string): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("UNBAN_USER", { userId }, resolve);
        });
    },

    getBannedUsers(): Promise<{ success: boolean; users?: { userId: string; nickname: string; bannedAt: string }[]; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("GET_BANNED_USERS", resolve);
        });
    },

    // ── File Upload ──────────────────────────────────────────────────────

    async uploadFile(
        fileBuffer: ArrayBuffer,
        fileName: string,
        mimeType: string,
    ): Promise<{ url: string; publicId?: string }> {
        return uploadTo("/api/upload", fileBuffer, fileName, mimeType);
    },

    async uploadEmojiFile(
        fileBuffer: ArrayBuffer,
        fileName: string,
        mimeType: string,
    ): Promise<{ url: string; publicId?: string }> {
        return uploadTo("/api/upload/emoji", fileBuffer, fileName, mimeType);
    },

    async uploadAnimatedEmojiFile(
        fileBuffer: ArrayBuffer,
        fileName: string,
        mimeType: string,
    ): Promise<{ url: string; publicId?: string }> {
        return uploadTo("/api/upload/emoji-animated", fileBuffer, fileName, mimeType);
    },

    // ── Image Download ───────────────────────────────────────────────────

    downloadImage(url: string): void {
        ipcRenderer.invoke("download-image", url);
    },

    // ── Link Preview ─────────────────────────────────────────────────────

    async fetchLinkPreview(url: string): Promise<{ title?: string; description?: string; image?: string; url?: string; domain?: string } | null> {
        return ipcRenderer.invoke("fetch-link-preview", url);
    },

    // ── System Tray Preferences ──────────────────────────────────────────

    setTrayPrefs(prefs: { minimizeToTray: boolean; closeToTray: boolean }): void {
        ipcRenderer.send("set-tray-prefs", prefs);
    },

    async getTrayPrefs(): Promise<{ minimizeToTray: boolean; closeToTray: boolean }> {
        return ipcRenderer.invoke("get-tray-prefs");
    },

    async isWindowFocused(): Promise<boolean> {
        return ipcRenderer.invoke("is-window-focused");
    },

    flashWindow(): void {
        ipcRenderer.send("flash-window");
    },

    // ── Screen Share source discovery (PRD 12.6) ─────────────────────────

    async getDesktopSources(): Promise<{
        success: boolean;
        sources?: Array<{
            id: string;
            name: string;
            thumbnail: string;
            appIcon: string | null;
            sourceType: "screen" | "window";
        }>;
        error?: string;
    }> {
        return ipcRenderer.invoke("get-desktop-sources");
    },

    // ── Screen Share audio pipeline (PRD 12.7) ────────────────────────────

    /**
     * Machine-wide check (PRD 12.11), not per-target — meant to be called
     * once when the Selection Modal opens, not per source selection.
     */
    async platformSupportsAudioCapture(): Promise<boolean> {
        return ipcRenderer.invoke("platform-supports-audio-capture");
    },

    /** Windows-only — resolves `undefined` on other platforms (see PRD 12.2). */
    async resolvePidForWindowSourceId(sourceId: string): Promise<number | undefined> {
        return ipcRenderer.invoke("resolve-pid-for-window-source-id", sourceId);
    },

    /**
     * Starts native per-application loopback capture for the given target
     * and, on success, produces it as a second mediasoup audio Producer on
     * the current voice channel's send Transport (alongside, not mixed
     * with, the mic Producer). Requires an active voice connection — the
     * caller (PRD 12.9's Share Screen button) only reaches this while
     * already connected, so `voiceService` being unset here is treated as a
     * caller error, not a recoverable state.
     */
    async startAppAudioCapture(
        pid: number | undefined,
        processName: string | undefined,
    ): Promise<{ success: boolean; error?: string }> {
        if (!voiceService) {
            return { success: false, error: "Not connected to voice" };
        }

        const result: { status: string } = await ipcRenderer.invoke("start-app-audio-capture", {
            pid,
            processName,
        });
        if (result.status !== "capturing") {
            return { success: false, error: `Audio capture unavailable (${result.status})` };
        }

        screenAudioGenerator = new MediaStreamTrackGenerator({ kind: "audio" });
        screenAudioWriter = screenAudioGenerator.writable.getWriter();
        screenAudioSamplesWritten = 0;

        try {
            await voiceService.produceScreenAudio(screenAudioGenerator);
            return { success: true };
        } catch (err: any) {
            // Native capture started but the mediasoup side failed — don't
            // leave the capture (and, on the PulseAudio backend, its system
            // audio reroute) running with nothing consuming its frames. Reuse
            // the same teardown as a normal stop, rather than a shorter
            // hand-rolled version, so this path doesn't skip the writer
            // `.close()` call that path does.
            await api.stopAppAudioCapture();
            return { success: false, error: err?.message ?? "Failed to produce screen audio" };
        }
    },

    async stopAppAudioCapture(): Promise<void> {
        await ipcRenderer.invoke("stop-app-audio-capture");
        voiceService?.closeScreenAudioProducer();
        if (screenAudioWriter) {
            screenAudioWriter.close().catch(() => {});
            screenAudioWriter = null;
        }
        screenAudioGenerator = null;
    },

    /**
     * Stops an active screen share entirely — video (PRD 12.8) and, if it
     * was enabled, audio (PRD 12.7). Safe to call even if only video (or
     * neither) was active: `stopAppAudioCapture`'s IPC/producer teardown is
     * a no-op when there's nothing capturing.
     */
    async stopScreenShare(): Promise<void> {
        voiceService?.stopScreenVideoProducing();
        await api.stopAppAudioCapture();
    },

    /** Starts capturing and producing the chosen source as SVC video (PRD 12.8/12.10). */
    async startScreenShareVideo(chromeMediaSourceId: string): Promise<{ success: boolean; error?: string }> {
        if (!voiceService) {
            return { success: false, error: "Not connected to voice" };
        }
        try {
            await voiceService.startScreenVideoProducing(chromeMediaSourceId);
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err?.message ?? "Failed to start screen video" };
        }
    },

    /** Linux/Wayland bypass path — see `voiceService.startScreenVideoProducingViaSystemPicker`. */
    async startScreenShareViaSystemPicker(): Promise<{
        success: boolean;
        label?: string;
        sourceType?: "screen" | "window";
        error?: string;
    }> {
        if (!voiceService) {
            return { success: false, error: "Not connected to voice" };
        }
        try {
            const { label } = await voiceService.startScreenVideoProducingViaSystemPicker();
            // The real picked-source name (and screen-vs-window type)
            // main.ts's `setDisplayMediaRequestHandler` saw — preferred
            // over `label` (the MediaStreamTrack's own `.label`, which
            // comes back empty for portal-based captures).
            const source: { name: string; sourceType: "screen" | "window" } | null = await ipcRenderer.invoke(
                "get-last-screen-share-source",
            );
            return { success: true, label: source?.name || label, sourceType: source?.sourceType };
        } catch (err: any) {
            return { success: false, error: err?.message ?? "Failed to start screen video" };
        }
    },

    /**
     * Linux/Wayland bypass path — native prompt letting the user pick which
     * currently-audio-producing app (if any) to also share, since the
     * picked video source carries no name/PID to auto-match against on
     * this platform. Resolves the exact app name to pass straight to
     * `startAppAudioCapture`, or `null` if there's nothing to offer (no app
     * producing audio right now) or the user chose "Video Only".
     */
    async pickAudioAppToShare(): Promise<string | null> {
        return ipcRenderer.invoke("pick-audio-app-to-share");
    },

    // ── Screen Share Viewer window (PRD 12.13) ───────────────────────────

    /**
     * Opens a Viewer window watching `targetUserId`'s screen share in
     * `channelId`. `serverBaseUrl` is included here (from this connection's
     * own in-scope state) rather than asked of the renderer, since the
     * renderer has no other way to know it — it's set once, during
     * `connect()`, and never exposed as its own getter.
     */
    async openScreenShareViewer(
        targetUserId: string,
        nickname: string,
        channelId: string,
    ): Promise<{ success: boolean; error?: string }> {
        if (!serverBaseUrl) {
            return { success: false, error: "Not connected to a server" };
        }
        return ipcRenderer.invoke("open-screen-share-viewer", {
            targetUserId,
            nickname,
            channelId,
            serverBaseUrl,
        });
    },

    // ── Auto-Updater (PRD 10.1) ─────────────────────────────────────────────

    async checkForUpdates(): Promise<{ status: "available" | "not-available" | "error"; message?: string }> {
        return ipcRenderer.invoke("check-for-updates");
    },

    async downloadUpdate(): Promise<void> {
        return ipcRenderer.invoke("download-update");
    },

    quitAndInstall(): void {
        ipcRenderer.invoke("quit-and-install");
    },

    async getAppVersion(): Promise<string> {
        return ipcRenderer.invoke("get-app-version");
    },

    /** Fetches the GitHub release notes for a given app version (PRD 11.4).
     *  `bodyHtml` is already-rendered HTML, not raw markdown (rendered
     *  main-process-side — see main.ts's ReleaseNotes doc comment). */
    async fetchReleaseNotes(version: string): Promise<{ name: string; bodyHtml: string; htmlUrl: string } | null> {
        return ipcRenderer.invoke("fetch-release-notes", version);
    },

    // ── Mic Sensitivity / Noise Gate ──────────────────────────────────────

    setMicSensitivity(enabled: boolean, threshold: number): void {
        if (enabled) {
            voiceService?.enableSensitivity(threshold);
        } else {
            voiceService?.disableSensitivity();
        }
    },

    setMicThreshold(threshold: number): void {
        voiceService?.setThreshold(threshold);
    },

    async startMicPreview(): Promise<void> {
        // Lazily create VoiceService if not yet connected
        if (!voiceService) {
            const dummySignaling: VoiceSignaling = {
                getRouterCapabilities: () => Promise.resolve({ success: false }),
                createTransport: () => Promise.resolve({ success: false }),
                connectTransport: () => Promise.resolve({ success: false }),
                produce: () => Promise.resolve({ success: false }),
                consume: () => Promise.resolve({ success: false }),
                resumeConsumer: () => Promise.resolve({ success: false }),
                restartIce: () => Promise.resolve({ success: false }),
                closeProducer: () => {},
            };
            voiceService = new VoiceService(dummySignaling);
        }
        await voiceService.startPreview();
    },

    stopMicPreview(): void {
        voiceService?.stopPreview();
    },

    getMicLevel(): number {
        return voiceService?.getCurrentLevel() ?? -Infinity;
    },

    getLatency(): number {
        return latencyMs;
    },

    /** Best current estimate of (server clock) - (this machine's clock), in
     *  ms — see PRD 11.2. 0 until the first PING_LATENCY round trip resolves. */
    getClockOffset(): number {
        return clockOffsetMs;
    },

    toggleReaction(
        messageId: string,
        emoji: string,
        isDm: boolean,
    ): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("TOGGLE_REACTION", { messageId, emoji, isDm }, resolve);
        });
    },

    // ── Custom Emoji ──────────────────────────────────────────────────────

    createCustomEmoji(
        name: string,
        imageUrl: string,
        imagePublicId?: string,
        isAnimated?: boolean,
    ): Promise<{ success: boolean; emojiId?: string; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("CREATE_CUSTOM_EMOJI", { name, imageUrl, imagePublicId, isAnimated }, resolve);
        });
    },

    getApprovedEmojis(): Promise<{ success: boolean; emojis?: ICustomEmoji[]; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("GET_APPROVED_EMOJIS", resolve);
        });
    },

    getPendingEmojis(): Promise<{ success: boolean; emojis?: ICustomEmoji[]; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("GET_PENDING_EMOJIS", resolve);
        });
    },

    reviewCustomEmoji(
        emojiId: string,
        decision: "APPROVED" | "REJECTED",
    ): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("REVIEW_CUSTOM_EMOJI", { emojiId, decision }, resolve);
        });
    },

    // ── Nudge ─────────────────────────────────────────────────────────────

    nudgeUser(targetUserId: string): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("NUDGE_USER", { targetUserId }, resolve);
        });
    },

    getServerSettings(): Promise<{
        success: boolean;
        nudgeEnabled?: boolean;
        screenShareEnabled?: boolean;
        name?: string;
        maxMessageLength?: number;
        version?: string;
        error?: string;
    }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("GET_SERVER_SETTINGS", resolve);
        });
    },

    updateServerSettings(
        settings: { nudgeEnabled?: boolean; screenShareEnabled?: boolean; maxMessageLength?: number },
    ): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("UPDATE_SERVER_SETTINGS", settings, resolve);
        });
    },
};

contextBridge.exposeInMainWorld("reson8Api", api);

// ── PTT IPC from main process ─────────────────────────────────────────────
ipcRenderer.on("ptt-pressed", () => emit("ptt-pressed", null));
ipcRenderer.on("ptt-released", () => emit("ptt-released", null));

// Fired on any window minimize (tray or plain OS taskbar minimize) — see
// main.ts's "minimize" handler. Used to re-collapse expanded long chat
// messages (Phase 12 sub-phase item 5).
ipcRenderer.on("window-minimized", () => emit("window-minimized", null));

// Fired once from main.ts's "before-quit" handler, briefly before the app
// actually exits — gracefully disconnects the socket so the server sees an
// explicit "client namespace disconnect" instead of the connection just
// going dead, letting it skip the reconnect-grace period and mark presence
// offline immediately rather than after a several-second delay (see that
// handler's own comment for the full reasoning).
ipcRenderer.on("app-quitting", () => {
    if (socket?.connected) {
        socket.disconnect();
    }
});

// ── Screen share captured audio from main process (PRD 12.7) ───────────────
// Registered once, not per-`startAppAudioCapture` call, matching this
// file's existing convention for main→renderer push channels — a no-op
// whenever `screenAudioWriter` isn't set (i.e. no share in progress).
ipcRenderer.on(
    "app-audio-frame",
    (_event, frame: { pcm: Uint8Array; sampleRate: number; channels: number }) => {
        if (!screenAudioWriter) return;
        const { pcm, sampleRate, channels } = frame;
        const numberOfFrames = Math.floor(pcm.byteLength / 2 / channels); // 16-bit PCM
        if (numberOfFrames <= 0) return;
        const timestamp = Math.round((screenAudioSamplesWritten / sampleRate) * 1_000_000);
        try {
            const audioData = new AudioData({
                format: "s16",
                sampleRate,
                numberOfFrames,
                numberOfChannels: channels,
                timestamp,
                // IPC-deserialized data is always a regular ArrayBuffer-backed
                // view in practice, never SharedArrayBuffer-backed — this cast
                // is just working around TS 5.7's stricter generic Uint8Array
                // typing, not papering over a real runtime concern.
                data: pcm as BufferSource,
            });
            screenAudioWriter.write(audioData);
            screenAudioSamplesWritten += numberOfFrames;
        } catch (err) {
            console.error("[screen-share] Failed to write captured audio frame:", err);
        }
    },
);

// ── Auto-Updater IPC from main process (PRD 10.1) ──────────────────────────
ipcRenderer.on("update-available", (_event, data: { version: string }) => emit("update-available", data));
ipcRenderer.on("download-progress", (_event, data: { percent: number }) => emit("download-progress", data));
ipcRenderer.on("update-downloaded", () => emit("update-downloaded", null));
ipcRenderer.on("update-error", (_event, data: { message: string }) => emit("update-error", data));
