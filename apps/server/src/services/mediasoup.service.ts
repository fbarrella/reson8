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

import { EventEmitter } from "node:events";
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

/** Callback for audio level volume events. */
export type AudioLevelCallback = (volumes: Array<{ producerId: string; volume: number }>) => void;

/** Callback for silence events (no speakers detected). */
export type SilenceCallback = () => void;

/**
 * Emits `workerDied` with the channelIds that were hosted on the crashed
 * worker's Routers (all now unrecoverable — clients must rejoin voice).
 */
export class MediasoupService extends EventEmitter {
    private workers: mediasoupTypes.Worker[] = [];
    private nextWorkerIdx = 0;

    /** channelId → Router */
    private routers = new Map<string, mediasoupTypes.Router>();

    /** channelId → Map<userId, UserVoiceSession> */
    private sessions = new Map<string, Map<string, UserVoiceSession>>();

    /** channelId → AudioLevelObserver */
    private audioLevelObservers = new Map<string, mediasoupTypes.AudioLevelObserver>();

    /** Worker → set of channelIds whose Router lives on that Worker. */
    private workerChannels = new Map<mediasoupTypes.Worker, Set<string>>();

    /** channelId → the Worker hosting its Router (reverse of workerChannels). */
    private channelWorker = new Map<string, mediasoupTypes.Worker>();

    // ── Initialization ────────────────────────────────────────────────────

    /** Spawns the Worker pool. Must be called once at server startup. */
    async init(): Promise<void> {
        for (let i = 0; i < NUM_WORKERS; i++) {
            await this.spawnWorker();
        }
    }

    /** Spawns a single Worker and wires its crash-recovery handler. */
    private async spawnWorker(): Promise<mediasoupTypes.Worker> {
        const worker = await mediasoup.createWorker(WORKER_SETTINGS);
        this.workerChannels.set(worker, new Set());

        worker.on("died", (error) => {
            console.error(`[mediasoup] Worker ${worker.pid} died: ${error.message}`);
            this.handleWorkerDeath(worker).catch((respawnErr) => {
                console.error("[mediasoup] Failed to recover from worker death:", respawnErr);
            });
        });

        this.workers.push(worker);
        console.log(`[mediasoup] Worker spawned (PID: ${worker.pid})`);
        return worker;
    }

    /**
     * Recovers from a single Worker crash without taking the whole process
     * down: every Router/session hosted on it is unrecoverable and is torn
     * down, a replacement Worker is spawned to keep the pool size stable, and
     * a `workerDied` event is emitted so callers can notify only the
     * specific channels that were affected (see PRD 11.1 — a crash used to
     * call process.exit(1), dropping every voice user on the server for a
     * single worker's failure).
     */
    private async handleWorkerDeath(deadWorker: mediasoupTypes.Worker): Promise<void> {
        const affectedChannels = Array.from(this.workerChannels.get(deadWorker) ?? []);
        this.workerChannels.delete(deadWorker);
        this.workers = this.workers.filter((w) => w !== deadWorker);
        if (this.nextWorkerIdx >= this.workers.length) this.nextWorkerIdx = 0;

        for (const channelId of affectedChannels) {
            // The Router (and everything on it) died with the Worker — no
            // close() calls needed/possible, just drop our references.
            this.routers.delete(channelId);
            this.audioLevelObservers.delete(channelId);
            this.sessions.delete(channelId);
            this.channelWorker.delete(channelId);
        }

        if (this.workers.length < NUM_WORKERS) {
            await this.spawnWorker();
        }

        if (affectedChannels.length > 0) {
            this.emit("workerDied", { channelIds: affectedChannels });
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
        this.workerChannels.get(worker)?.add(channelId);
        this.channelWorker.set(channelId, worker);

        console.log(`[mediasoup] Router created for channel ${channelId}`);
        return router;
    }

    /** Removes a Router when no users are left in the channel. */
    removeRouter(channelId: string): void {
        // Clean up audio level observer first
        const observer = this.audioLevelObservers.get(channelId);
        if (observer) {
            observer.close();
            this.audioLevelObservers.delete(channelId);
        }

        const router = this.routers.get(channelId);
        if (router) {
            router.close();
            this.routers.delete(channelId);
            this.sessions.delete(channelId);
            const worker = this.channelWorker.get(channelId);
            if (worker) {
                this.workerChannels.get(worker)?.delete(channelId);
                this.channelWorker.delete(channelId);
            }
            console.log(`[mediasoup] Router destroyed for channel ${channelId}`);
        }
    }

    /** Returns the Router for a channel, or undefined. */
    getRouter(channelId: string): mediasoupTypes.Router | undefined {
        return this.routers.get(channelId);
    }

    // ── AudioLevelObserver management ─────────────────────────────────────

    /**
     * Gets or creates an AudioLevelObserver for a channel.
     * The observer monitors RTP audio levels and emits events when
     * speakers are detected or silence resumes.
     */
    async getOrCreateAudioLevelObserver(
        channelId: string,
        onVolumes: AudioLevelCallback,
        onSilence: SilenceCallback,
    ): Promise<mediasoupTypes.AudioLevelObserver> {
        let observer = this.audioLevelObservers.get(channelId);
        if (observer) return observer;

        const router = this.routers.get(channelId);
        if (!router) throw new Error(`No router for channel ${channelId}`);

        observer = await router.createAudioLevelObserver({
            maxEntries: 10,
            threshold: -50,
            interval: 300,
        });

        observer.on("volumes", (volumes: Array<{ producer: mediasoupTypes.Producer; volume: number }>) => {
            const mapped = volumes.map((v) => ({
                producerId: v.producer.id,
                volume: v.volume,
            }));
            onVolumes(mapped);
        });

        observer.on("silence", () => {
            onSilence();
        });

        this.audioLevelObservers.set(channelId, observer);
        console.log(`[mediasoup] AudioLevelObserver created for channel ${channelId}`);
        return observer;
    }

    /** Adds a producer to the channel's AudioLevelObserver. */
    async addProducerToObserver(channelId: string, producer: mediasoupTypes.Producer): Promise<void> {
        const observer = this.audioLevelObservers.get(channelId);
        if (observer) {
            await observer.addProducer({ producerId: producer.id });
        }
    }

    // ── Transport management ──────────────────────────────────────────────

    /** Creates a WebRtcTransport on a given Router. */
    async createWebRtcTransport(
        router: mediasoupTypes.Router,
    ): Promise<mediasoupTypes.WebRtcTransport> {
        const transport = await router.createWebRtcTransport(await getTransportOptions());

        transport.on("dtlsstatechange", (state: mediasoupTypes.DtlsState) => {
            if (state === "failed" || state === "closed") {
                transport.close();
            }
        });

        // mediasoup's ICE state has no "failed" value (unlike DTLS) — a dead
        // connection just sits at "disconnected" indefinitely, since ICE can
        // also recover from a transient "disconnected" on its own. Give it a
        // grace period before treating it as gone; this cascades into the
        // producer/consumer "transportclose" cleanup already in place (see
        // PRD 11.1 — previously nothing ever noticed a pure ICE-level drop).
        transport.on("icestatechange", (iceState: mediasoupTypes.IceState) => {
            if (iceState !== "disconnected") return;
            setTimeout(() => {
                if (!transport.closed && transport.iceState === "disconnected") {
                    transport.close();
                }
            }, 10_000);
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

    // ── Producer-to-User mapping ──────────────────────────────────────────

    /** Finds the userId that owns a given producer in a channel. */
    getUserIdByProducerId(channelId: string, producerId: string): string | undefined {
        const channelSessions = this.sessions.get(channelId);
        if (!channelSessions) return undefined;
        for (const [userId, session] of channelSessions) {
            if (session.producer?.id === producerId) return userId;
        }
        return undefined;
    }

    /** Closes all Workers on shutdown. */
    close(): void {
        for (const observer of this.audioLevelObservers.values()) {
            observer.close();
        }
        this.audioLevelObservers.clear();

        for (const worker of this.workers) {
            worker.close();
        }
        this.workers = [];
        this.routers.clear();
        this.sessions.clear();
        console.log("[mediasoup] All workers closed");
    }
}
