/**
 * MediasoupService — SFU Worker pool and per-channel Router management.
 *
 * Architecture:
 *   Workers (1 per CPU core) → Routers (1 per voice channel) → Transports/Producers/Consumers
 *
 * Workers are assigned to new Routers via round-robin.
 * Routers are lazily created when the first user joins a voice channel,
 * and cleaned up when the last user leaves.
 */

import * as mediasoup from "mediasoup";
import type { types as mediasoupTypes } from "mediasoup";
import {
    NUM_WORKERS,
    WORKER_SETTINGS,
    MEDIA_CODECS,
    getTransportOptions,
} from "../config/mediasoup.config.js";

/** Per-user voice session state within a channel. */
export interface UserVoiceSession {
    sendTransport: mediasoupTypes.WebRtcTransport | null;
    recvTransport: mediasoupTypes.WebRtcTransport | null;
    producer: mediasoupTypes.Producer | null;
    consumers: Map<string, mediasoupTypes.Consumer>; // keyed by consumerId
}

export class MediasoupService {
    private workers: mediasoupTypes.Worker[] = [];
    private nextWorkerIdx = 0;

    /** channelId → Router */
    private routers = new Map<string, mediasoupTypes.Router>();

    /** channelId → Map<userId, UserVoiceSession> */
    private sessions = new Map<string, Map<string, UserVoiceSession>>();

    // ── Initialization ────────────────────────────────────────────────────

    /** Spawns the Worker pool. Must be called once at server startup. */
    async init(): Promise<void> {
        for (let i = 0; i < NUM_WORKERS; i++) {
            const worker = await mediasoup.createWorker(WORKER_SETTINGS);

            worker.on("died", (error) => {
                console.error(
                    `[mediasoup] Worker ${worker.pid} died: ${error.message}`,
                );
                process.exit(1);
            });

            this.workers.push(worker);
            console.log(
                `[mediasoup] Worker ${i + 1}/${NUM_WORKERS} spawned (PID: ${worker.pid})`,
            );
        }
    }

    /** Returns the next Worker in round-robin order. */
    private getNextWorker(): mediasoupTypes.Worker {
        const worker = this.workers[this.nextWorkerIdx];
        this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;
        return worker;
    }

    // ── Router management ─────────────────────────────────────────────────

    /** Gets or creates a Router for a voice channel. */
    async getOrCreateRouter(channelId: string): Promise<mediasoupTypes.Router> {
        let router = this.routers.get(channelId);
        if (router) return router;

        const worker = this.getNextWorker();
        router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });
        this.routers.set(channelId, router);
        this.sessions.set(channelId, new Map());

        console.log(`[mediasoup] Router created for channel ${channelId}`);
        return router;
    }

    /** Removes a Router when no users are left in the channel. */
    removeRouter(channelId: string): void {
        const router = this.routers.get(channelId);
        if (router) {
            router.close();
            this.routers.delete(channelId);
            this.sessions.delete(channelId);
            console.log(`[mediasoup] Router destroyed for channel ${channelId}`);
        }
    }

    /** Returns the Router for a channel, or undefined. */
    getRouter(channelId: string): mediasoupTypes.Router | undefined {
        return this.routers.get(channelId);
    }

    // ── Transport management ──────────────────────────────────────────────

    /** Creates a WebRtcTransport on a given Router. */
    async createWebRtcTransport(
        router: mediasoupTypes.Router,
    ): Promise<mediasoupTypes.WebRtcTransport> {
        const transport = await router.createWebRtcTransport(getTransportOptions());

        transport.on("dtlsstatechange", (state: mediasoupTypes.DtlsState) => {
            if (state === "failed" || state === "closed") {
                transport.close();
            }
        });

        return transport;
    }

    // ── Session management ────────────────────────────────────────────────

    /** Creates or retrieves a voice session for a user in a channel. */
    getOrCreateSession(channelId: string, userId: string): UserVoiceSession {
        let channelSessions = this.sessions.get(channelId);
        if (!channelSessions) {
            channelSessions = new Map();
            this.sessions.set(channelId, channelSessions);
        }

        let session = channelSessions.get(userId);
        if (!session) {
            session = {
                sendTransport: null,
                recvTransport: null,
                producer: null,
                consumers: new Map(),
            };
            channelSessions.set(userId, session);
        }

        return session;
    }

    /** Returns a user's session, or undefined. */
    getSession(channelId: string, userId: string): UserVoiceSession | undefined {
        return this.sessions.get(channelId)?.get(userId);
    }

    /**
     * Returns all active producers in a channel (excluding a specific user).
     * Used to notify a joining user of existing audio streams.
     */
    getExistingProducers(
        channelId: string,
        excludeUserId: string,
    ): Array<{ userId: string; producerId: string }> {
        const channelSessions = this.sessions.get(channelId);
        if (!channelSessions) return [];

        const producers: Array<{ userId: string; producerId: string }> = [];
        for (const [userId, session] of channelSessions) {
            if (userId !== excludeUserId && session.producer) {
                producers.push({ userId, producerId: session.producer.id });
            }
        }
        return producers;
    }

    /** Cleans up all voice resources for a user leaving a channel. */
    cleanupUserSession(channelId: string, userId: string): void {
        const session = this.sessions.get(channelId)?.get(userId);
        if (!session) return;

        for (const consumer of session.consumers.values()) {
            consumer.close();
        }
        session.consumers.clear();

        if (session.producer) {
            session.producer.close();
            session.producer = null;
        }

        if (session.sendTransport) {
            session.sendTransport.close();
            session.sendTransport = null;
        }
        if (session.recvTransport) {
            session.recvTransport.close();
            session.recvTransport = null;
        }

        this.sessions.get(channelId)?.delete(userId);

        const channelSessions = this.sessions.get(channelId);
        if (channelSessions && channelSessions.size === 0) {
            this.removeRouter(channelId);
        }

        console.log(
            `[mediasoup] Cleaned up session for user ${userId} in channel ${channelId}`,
        );
    }

    /** Closes all Workers on shutdown. */
    close(): void {
        for (const worker of this.workers) {
            worker.close();
        }
        this.workers = [];
        this.routers.clear();
        this.sessions.clear();
        console.log("[mediasoup] All workers closed");
    }
}
