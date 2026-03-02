/**
 * VoiceService — Client-side mediasoup voice engine.
 *
 * Orchestrates the WebRTC handshake:
 *   1. Load Device with Router capabilities
 *   2. Create send/recv transports
 *   3. Produce mic audio
 *   4. Consume remote producers
 *
 * Used by the preload script to expose voice capabilities to the renderer.
 */

import { Device, types as msTypes } from "mediasoup-client";

/** Signaling callbacks — the preload wires these to the Socket.io connection. */
export interface VoiceSignaling {
    getRouterCapabilities(
        channelId: string,
    ): Promise<{ success: boolean; rtpCapabilities?: any; error?: string }>;

    createTransport(
        channelId: string,
        direction: "send" | "recv",
    ): Promise<{
        success: boolean;
        transport?: {
            id: string;
            iceParameters: any;
            iceCandidates: any[];
            dtlsParameters: any;
        };
        iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
        error?: string;
    }>;

    connectTransport(
        transportId: string,
        dtlsParameters: any,
    ): Promise<{ success: boolean; error?: string }>;

    produce(
        transportId: string,
        kind: "audio",
        rtpParameters: any,
    ): Promise<{ success: boolean; producerId?: string; error?: string }>;

    consume(
        producerId: string,
        rtpCapabilities: any,
    ): Promise<{
        success: boolean;
        consumer?: {
            id: string;
            producerId: string;
            kind: string;
            rtpParameters: any;
        };
        error?: string;
    }>;

    resumeConsumer(
        consumerId: string,
    ): Promise<{ success: boolean; error?: string }>;
}

export class VoiceService {
    private device: Device | null = null;
    private sendTransport: msTypes.Transport | null = null;
    private recvTransport: msTypes.Transport | null = null;
    private producer: msTypes.Producer | null = null;
    private consumers = new Map<string, msTypes.Consumer>();
    private audioElements = new Map<string, HTMLAudioElement>();
    private signaling: VoiceSignaling;
    private channelId: string | null = null;
    private localStream: MediaStream | null = null;
    private _isDeafened = false;

    /** Producers that arrived before recv transport was ready. */
    private pendingProducers: string[] = [];

    constructor(signaling: VoiceSignaling) {
        this.signaling = signaling;
    }

    // ── Join voice channel ────────────────────────────────────────────────

    /**
     * Full voice join orchestration.
     * Performs the complete WebRTC handshake and starts producing audio.
     */
    async joinVoiceChannel(channelId: string): Promise<void> {
        this.channelId = channelId;

        // 1. Get Router capabilities and load Device
        const capRes = await this.signaling.getRouterCapabilities(channelId);
        if (!capRes.success || !capRes.rtpCapabilities) {
            throw new Error(capRes.error ?? "Failed to get router capabilities");
        }

        this.device = new Device();
        await this.device.load({
            routerRtpCapabilities: capRes.rtpCapabilities,
        });

        // 2. Create send transport
        await this.createSendTransport(channelId);

        // 3. Create receive transport
        await this.createRecvTransport(channelId);

        // 4. Get mic and start producing
        await this.startProducing();

        // 5. Consume any producers that arrived before recv transport was ready
        if (this.pendingProducers.length > 0) {
            for (const producerId of this.pendingProducers) {
                try {
                    await this.consumeProducer(producerId);
                } catch (err) {
                    console.error("[voice] Failed to consume pending producer:", err);
                }
            }
            this.pendingProducers = [];
        }
    }

    // ── Transport creation ────────────────────────────────────────────────

    private async createSendTransport(channelId: string): Promise<void> {
        if (!this.device) throw new Error("Device not loaded");

        const res = await this.signaling.createTransport(channelId, "send");
        if (!res.success || !res.transport) {
            throw new Error(res.error ?? "Failed to create send transport");
        }

        const tp = res.transport;
        this.sendTransport = this.device.createSendTransport({
            id: tp.id,
            iceParameters: tp.iceParameters,
            iceCandidates: tp.iceCandidates,
            dtlsParameters: tp.dtlsParameters,
            ...(res.iceServers ? { iceServers: res.iceServers } : {}),
        });

        this.sendTransport.on(
            "connect",
            async ({ dtlsParameters }, callback, errback) => {
                try {
                    const connectRes = await this.signaling.connectTransport(
                        tp.id,
                        dtlsParameters,
                    );
                    if (!connectRes.success) throw new Error(connectRes.error);
                    callback();
                } catch (err) {
                    errback(err as Error);
                }
            },
        );

        this.sendTransport.on(
            "produce",
            async ({ kind, rtpParameters }, callback, errback) => {
                try {
                    const prodRes = await this.signaling.produce(
                        tp.id,
                        kind as "audio",
                        rtpParameters,
                    );
                    if (!prodRes.success || !prodRes.producerId) {
                        throw new Error(prodRes.error);
                    }
                    callback({ id: prodRes.producerId });
                } catch (err) {
                    errback(err as Error);
                }
            },
        );
    }

    private async createRecvTransport(channelId: string): Promise<void> {
        if (!this.device) throw new Error("Device not loaded");

        const res = await this.signaling.createTransport(channelId, "recv");
        if (!res.success || !res.transport) {
            throw new Error(res.error ?? "Failed to create recv transport");
        }

        const tp = res.transport;
        this.recvTransport = this.device.createRecvTransport({
            id: tp.id,
            iceParameters: tp.iceParameters,
            iceCandidates: tp.iceCandidates,
            dtlsParameters: tp.dtlsParameters,
            ...(res.iceServers ? { iceServers: res.iceServers } : {}),
        });

        this.recvTransport.on(
            "connect",
            async ({ dtlsParameters }, callback, errback) => {
                try {
                    const connectRes = await this.signaling.connectTransport(
                        tp.id,
                        dtlsParameters,
                    );
                    if (!connectRes.success) throw new Error(connectRes.error);
                    callback();
                } catch (err) {
                    errback(err as Error);
                }
            },
        );
    }

    private _audioDeviceId: string | null = null;

    /** Set the preferred audio input device ID. */
    setAudioDeviceId(deviceId: string | null): void {
        this._audioDeviceId = deviceId;
    }

    /** Request mic access and start producing audio. */
    async startProducing(): Promise<void> {
        if (!this.sendTransport) throw new Error("Send transport not ready");

        const audioConstraints: MediaTrackConstraints = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        };

        if (this._audioDeviceId) {
            audioConstraints.deviceId = { exact: this._audioDeviceId };
        }

        this.localStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
        });

        const track = this.localStream.getAudioTracks()[0];
        this.producer = await this.sendTransport.produce({ track });
    }

    // ── Consume remote audio ──────────────────────────────────────────────

    /**
     * Queue a producer for consumption. If recv transport is ready, consume
     * immediately. Otherwise, defer until after the handshake completes.
     */
    queueConsumeProducer(producerId: string): void {
        if (this.recvTransport && this.device) {
            this.consumeProducer(producerId).catch((err) => {
                console.error("[voice] Failed to consume producer:", err);
            });
        } else {
            this.pendingProducers.push(producerId);
        }
    }

    /** Consume a remote user's audio producer. */
    async consumeProducer(producerId: string): Promise<void> {
        if (!this.recvTransport) throw new Error("Recv transport not ready");
        if (!this.device) throw new Error("Device not loaded");

        const res = await this.signaling.consume(producerId, this.device.rtpCapabilities);
        if (!res.success || !res.consumer) {
            throw new Error(res.error ?? "Failed to consume");
        }

        const { id, kind, rtpParameters } = res.consumer;
        const consumer = await this.recvTransport.consume({
            id,
            producerId,
            kind: kind as msTypes.MediaKind,
            rtpParameters,
        });

        this.consumers.set(consumer.id, consumer);

        // Create an <audio> element, append to DOM, and play
        const audio = document.createElement("audio") as HTMLAudioElement;
        audio.srcObject = new MediaStream([consumer.track]);
        audio.autoplay = true;
        audio.volume = 1.0;
        document.body.appendChild(audio);
        audio.play().catch(() => { });

        this.audioElements.set(consumer.id, audio);

        // Resume on server (consumers start paused)
        await this.signaling.resumeConsumer(consumer.id);
    }

    /** Remove a consumer when a remote producer closes. */
    removeConsumer(producerId: string): void {
        for (const [consumerId, consumer] of this.consumers) {
            if (consumer.producerId === producerId) {
                consumer.close();
                this.consumers.delete(consumerId);

                const audio = this.audioElements.get(consumerId);
                if (audio) {
                    audio.pause();
                    audio.srcObject = null;
                    audio.remove();
                    this.audioElements.delete(consumerId);
                }
                break;
            }
        }
    }

    // ── Mute / Unmute ─────────────────────────────────────────────────────

    /** Toggle mic mute (pauses/resumes the producer). */
    toggleMute(): boolean {
        if (!this.producer) return false;

        if (this.producer.paused) {
            this.producer.resume();
        } else {
            this.producer.pause();
        }
        return this.producer.paused;
    }

    /** Toggle deafen (mutes/unmutes all audio elements). */
    toggleDeafen(): boolean {
        this._isDeafened = !this._isDeafened;
        for (const audio of this.audioElements.values()) {
            audio.muted = this._isDeafened;
        }
        return this._isDeafened;
    }

    // ── Cleanup ───────────────────────────────────────────────────────────

    /** Leave voice — clean up all resources. */
    cleanup(): void {
        if (this.localStream) {
            for (const track of this.localStream.getTracks()) {
                track.stop();
            }
            this.localStream = null;
        }

        if (this.producer) {
            this.producer.close();
            this.producer = null;
        }

        for (const consumer of this.consumers.values()) {
            consumer.close();
        }
        this.consumers.clear();

        for (const audio of this.audioElements.values()) {
            audio.pause();
            audio.srcObject = null;
            audio.remove();
        }
        this.audioElements.clear();

        if (this.sendTransport) {
            this.sendTransport.close();
            this.sendTransport = null;
        }
        if (this.recvTransport) {
            this.recvTransport.close();
            this.recvTransport = null;
        }

        this.device = null;
        this.channelId = null;
        this._isDeafened = false;
        this.pendingProducers = [];
    }

    get isInVoice(): boolean {
        return this.channelId !== null;
    }

    get currentChannelId(): string | null {
        return this.channelId;
    }

    get isMuted(): boolean {
        return this.producer?.paused ?? false;
    }
}
