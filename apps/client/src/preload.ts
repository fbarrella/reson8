/**
 * Reson8 Client — Preload Script
 *
 * Exposes a safe `reson8Api` bridge to the renderer via contextBridge.
 * Uses callback registration (not window events) because contextIsolation
 * means preload and renderer have separate window contexts.
 */

import { contextBridge } from "electron";
import { io, Socket } from "socket.io-client";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
} from "@reson8/shared-types";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: TypedSocket | null = null;

// ── Callback registry ────────────────────────────────────────────────────
// Renderer registers callbacks through contextBridge; preload invokes them.

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

const api = {
    /**
     * Connect to a Reson8 server.
     */
    connect(host: string, port: number = 9800): void {
        if (socket?.connected) {
            socket.disconnect();
        }

        socket = io(`http://${host}:${port}`, {
            transports: ["websocket"],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
        }) as TypedSocket;

        socket.on("connect", () => {
            emit("connected", { socketId: socket!.id });
        });

        socket.on("disconnect", (reason) => {
            emit("disconnected", { reason });
        });

        socket.on("connect_error", (err) => {
            emit("error", { code: "CONNECT_ERROR", message: err.message });
        });

        socket.on("USER_JOINED", (payload) => emit("user-joined", payload));
        socket.on("USER_LEFT", (payload) => emit("user-left", payload));
        socket.on("CHANNEL_TREE_UPDATE", (payload) => emit("channel-tree", payload));
        socket.on("PRESENCE_UPDATE", (payload) => emit("presence", payload));
        socket.on("MESSAGE_RECEIVED", (payload) => emit("message", payload));
        socket.on("ERROR", (payload) => emit("error", payload));
    },

    /** Disconnect from the current server. */
    disconnect(): void {
        socket?.disconnect();
        socket = null;
    },

    /**
     * Register a callback for a Reson8 event.
     * Events: connected, disconnected, user-joined, user-left,
     *         channel-tree, presence, message, error
     */
    on(event: string, callback: Callback): void {
        if (!listeners[event]) {
            listeners[event] = [];
        }
        listeners[event].push(callback);
    },

    /** Remove all listeners for a given event. */
    off(event: string): void {
        delete listeners[event];
    },

    /** Emit a USER_JOIN_SERVER event. */
    joinServer(
        serverId: string,
        nickname: string,
    ): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("USER_JOIN_SERVER", { serverId, nickname }, resolve);
        });
    },

    /** Emit a USER_JOIN_CHANNEL event. */
    joinChannel(
        channelId: string,
    ): Promise<{ success: boolean; error?: string }> {
        return new Promise((resolve) => {
            if (!socket?.connected) {
                resolve({ success: false, error: "Not connected" });
                return;
            }
            socket.emit("USER_JOIN_CHANNEL", { channelId }, resolve);
        });
    },
};

contextBridge.exposeInMainWorld("reson8Api", api);
