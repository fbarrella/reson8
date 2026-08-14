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
        produce(transportId, kind, rtpParameters) {
            return new Promise((resolve) => {
                socket!.emit(
                    "PRODUCE",
                    { transportId, kind, rtpParameters },
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
    // ── Identity ─────────────────────────────────────────────────────────────

    getInstanceId(): string {
        return instanceId;
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
            reconnectionAttempts: 5,
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
            voiceService?.queueConsumeProducer(payload.producerId, payload.userId);
        });

        socket.on("PRODUCER_CLOSED", (payload) => {
            emit("producer-closed", payload);
            voiceService?.removeConsumer(payload.producerId);
        });

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
    ): Promise<{ success: boolean; messageId?: string }> {
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

    // ── Auto-Updater (PRD 10.1) ─────────────────────────────────────────────

    async checkForUpdates(): Promise<{ status: "available" | "not-available" | "error" }> {
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

    /** Fetches the GitHub release notes for a given app version (PRD 11.4). */
    async fetchReleaseNotes(version: string): Promise<{ name: string; body: string; htmlUrl: string } | null> {
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
    ): Promise<{ success: boolean; emojiId?: string; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("CREATE_CUSTOM_EMOJI", { name, imageUrl, imagePublicId }, resolve);
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

    getServerSettings(): Promise<{ success: boolean; nudgeEnabled?: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("GET_SERVER_SETTINGS", resolve);
        });
    },

    updateServerSettings(nudgeEnabled: boolean): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("UPDATE_SERVER_SETTINGS", { nudgeEnabled }, resolve);
        });
    },
};

contextBridge.exposeInMainWorld("reson8Api", api);

// ── PTT IPC from main process ─────────────────────────────────────────────
ipcRenderer.on("ptt-pressed", () => emit("ptt-pressed", null));
ipcRenderer.on("ptt-released", () => emit("ptt-released", null));

// ── Auto-Updater IPC from main process (PRD 10.1) ──────────────────────────
ipcRenderer.on("update-available", (_event, data: { version: string }) => emit("update-available", data));
ipcRenderer.on("download-progress", (_event, data: { percent: number }) => emit("download-progress", data));
ipcRenderer.on("update-downloaded", () => emit("update-downloaded", null));
ipcRenderer.on("update-error", (_event, data: { message: string }) => emit("update-error", data));
