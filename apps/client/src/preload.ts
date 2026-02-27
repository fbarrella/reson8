/**
 * Reson8 Client — Preload Script
 *
 * Exposes a safe `reson8Api` bridge to the renderer via contextBridge.
 * Uses callback registration for events (contextIsolation separates windows).
 * Integrates VoiceService for WebRTC audio.
 */

import { contextBridge } from "electron";
import { io, Socket } from "socket.io-client";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
} from "@reson8/shared-types";
import { VoiceService, VoiceSignaling } from "./services/voice.service";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: TypedSocket | null = null;
let voiceService: VoiceService | null = null;

// Default server ID — matches the seed
const DEFAULT_SERVER_ID = "00000000-0000-0000-0000-000000000001";

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

const api = {
    // ── Connection ──────────────────────────────────────────────────────────

    connect(host: string, port: number, nickname: string): void {
        if (socket?.connected) {
            socket.disconnect();
        }

        socket = io(`http://${host}:${port}`, {
            transports: ["websocket"],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
        }) as TypedSocket;

        // Initialize voice service with signaling adapter
        voiceService = new VoiceService(createSignaling());

        socket.on("connect", () => {
            // Auto-join the default server
            socket!.emit(
                "USER_JOIN_SERVER",
                { serverId: DEFAULT_SERVER_ID, nickname },
                (res) => {
                    if (res.success) {
                        emit("connected", { serverId: DEFAULT_SERVER_ID });
                    } else {
                        emit("error", {
                            code: "JOIN_FAILED",
                            message: res.error ?? "Failed to join server",
                        });
                    }
                },
            );
        });

        socket.on("disconnect", (reason) => {
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
        socket.on("CHANNEL_DELETED", (payload) => emit("channel-deleted", payload));
        socket.on("ERROR", (payload) => emit("error", payload));

        // Voice-specific events
        socket.on("NEW_PRODUCER", (payload) => {
            emit("new-producer", payload);
            voiceService?.queueConsumeProducer(payload.producerId);
        });

        socket.on("PRODUCER_CLOSED", (payload) => {
            emit("producer-closed", payload);
            voiceService?.removeConsumer(payload.producerId);
        });

        socket.on("EXISTING_PRODUCERS", (payload) => {
            for (const p of payload.producers) {
                voiceService?.queueConsumeProducer(p.producerId);
            }
        });
    },

    disconnect(): void {
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
            if (!voiceService || !socket?.connected) {
                return { success: false, error: "Not connected" };
            }

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
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    },

    leaveVoiceChannel(): void {
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
        }
    },

    toggleMute(): boolean {
        return voiceService?.toggleMute() ?? false;
    },

    toggleDeafen(): boolean {
        return voiceService?.toggleDeafen() ?? false;
    },

    // ── Channel CRUD ────────────────────────────────────────────────────────

    createChannel(
        serverId: string,
        name: string,
        type: "TEXT" | "VOICE",
        parentId?: string | null,
    ): Promise<{ success: boolean; channelId?: string; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit(
                "CREATE_CHANNEL",
                { serverId, name, type, parentId: parentId ?? null },
                resolve,
            );
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
};

contextBridge.exposeInMainWorld("reson8Api", api);
