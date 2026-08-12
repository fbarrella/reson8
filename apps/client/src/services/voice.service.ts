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

    // ── Per-remote-user local volume/mute (client-local only, PRD 4.1/4.2) ──
    private playbackAudioContext: AudioContext | null = null;
    private remoteGainNodes = new Map<string, GainNode>(); // keyed by consumerId
    private remoteMediaSources = new Map<string, MediaElementAudioSourceNode>(); // keyed by consumerId
    private consumerIdToUserId = new Map<string, string>();
    private remoteUserOverrides = new Map<string, { volumePercent: number; muted: boolean }>(); // keyed by userId

    // ── Mic sensitivity / noise gate ──────────────────────────────────────
    private analyser: AnalyserNode | null = null;
    private audioContext: AudioContext | null = null;
    private _analysisTrack: MediaStreamTrack | null = null;
    private _previewStream: MediaStream | null = null;
    private silenceCheckInterval: number | null = null;
    private sensitivityThreshold: number = -40; // dB
    private sensitivityEnabled: boolean = false;
    private _isManuallyMuted: boolean = false;

    /** Producers that arrived before recv transport was ready. */
    private pendingProducers: { producerId: string; userId: string }[] = [];

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
            for (const { producerId, userId } of this.pendingProducers) {
                try {
                    await this.consumeProducer(producerId, userId);
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

        // If sensitivity was already enabled, reconnect analyser to the new stream
        if (this.sensitivityEnabled && this.localStream) {
            this.hookAnalyser();
        }
    }

    // ── Consume remote audio ──────────────────────────────────────────────

    /**
     * Queue a producer for consumption. If recv transport is ready, consume
     * immediately. Otherwise, defer until after the handshake completes.
     */
    queueConsumeProducer(producerId: string, userId: string): void {
        if (this.recvTransport && this.device) {
            this.consumeProducer(producerId, userId).catch((err) => {
                console.error("[voice] Failed to consume producer:", err);
            });
        } else {
            this.pendingProducers.push({ producerId, userId });
        }
    }

    /** Consume a remote user's audio producer. */
    async consumeProducer(producerId: string, userId: string): Promise<void> {
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
        this.consumerIdToUserId.set(consumer.id, userId);

        // Create an <audio> element, append to DOM, and play
        const audio = document.createElement("audio") as HTMLAudioElement;
        audio.srcObject = new MediaStream([consumer.track]);
        audio.autoplay = true;
        audio.volume = 1.0;
        document.body.appendChild(audio);
        audio.play().catch(() => { });

        this.audioElements.set(consumer.id, audio);

        // Route playback through a per-participant GainNode so local volume/mute
        // (client-local only — never sent to the server, see PRD 4.1/4.2) can go
        // above 100% and be toggled independently of the element's own volume.
        const ctx = this.getPlaybackAudioContext();
        const source = ctx.createMediaElementSource(audio);
        const gainNode = ctx.createGain();
        const override = this.remoteUserOverrides.get(userId);
        gainNode.gain.value = override
            ? (override.muted ? 0 : override.volumePercent / 100)
            : 1.0;
        source.connect(gainNode).connect(ctx.destination);
        this.remoteMediaSources.set(consumer.id, source);
        this.remoteGainNodes.set(consumer.id, gainNode);

        // Resume on server (consumers start paused)
        await this.signaling.resumeConsumer(consumer.id);
    }

    /** Remove a consumer when a remote producer closes. */
    removeConsumer(producerId: string): void {
        for (const [consumerId, consumer] of this.consumers) {
            if (consumer.producerId === producerId) {
                consumer.close();
                this.consumers.delete(consumerId);
                this.consumerIdToUserId.delete(consumerId);

                const source = this.remoteMediaSources.get(consumerId);
                if (source) {
                    source.disconnect();
                    this.remoteMediaSources.delete(consumerId);
                }
                const gain = this.remoteGainNodes.get(consumerId);
                if (gain) {
                    gain.disconnect();
                    this.remoteGainNodes.delete(consumerId);
                }

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

    // ── Per-remote-user local volume/mute ───────────────────────────────────

    private getPlaybackAudioContext(): AudioContext {
        if (!this.playbackAudioContext) {
            this.playbackAudioContext = new AudioContext();
        }
        return this.playbackAudioContext;
    }

    private applyOverrideForUser(userId: string, override: { volumePercent: number; muted: boolean }): void {
        for (const [consumerId, uid] of this.consumerIdToUserId) {
            if (uid !== userId) continue;
            const gain = this.remoteGainNodes.get(consumerId);
            if (gain) {
                gain.gain.value = override.muted ? 0 : override.volumePercent / 100;
            }
        }
    }

    /** Set a remote participant's local playback volume (0–200%, 100% = default). Client-local only. */
    setLocalUserVolume(userId: string, percent: number): void {
        const clamped = Math.max(0, Math.min(200, percent));
        const existing = this.remoteUserOverrides.get(userId) ?? { volumePercent: 100, muted: false };
        existing.volumePercent = clamped;
        this.remoteUserOverrides.set(userId, existing);
        this.applyOverrideForUser(userId, existing);
    }

    /** Mute/unmute a remote participant locally, preserving their configured volume. Client-local only. */
    setLocalUserMute(userId: string, muted: boolean): void {
        const existing = this.remoteUserOverrides.get(userId) ?? { volumePercent: 100, muted: false };
        existing.muted = muted;
        this.remoteUserOverrides.set(userId, existing);
        this.applyOverrideForUser(userId, existing);
    }

    getLocalUserVolume(userId: string): number {
        return this.remoteUserOverrides.get(userId)?.volumePercent ?? 100;
    }

    getLocalUserMute(userId: string): boolean {
        return this.remoteUserOverrides.get(userId)?.muted ?? false;
    }

    // ── Mute / Unmute ─────────────────────────────────────────────────────

    /** Toggle mic mute (pauses/resumes the producer). */
    toggleMute(): boolean {
        if (!this.producer) return false;

        if (this.producer.paused) {
            this.producer.resume();
            this._isManuallyMuted = false;
        } else {
            this.producer.pause();
            this._isManuallyMuted = true;
        }
        return this.producer.paused;
    }

    /** Explicitly set the mute state (used by PTT mode). */
    setMuted(muted: boolean): void {
        if (!this.producer) return;
        this._isManuallyMuted = muted;
        if (muted && !this.producer.paused) {
            this.producer.pause();
        } else if (!muted && this.producer.paused) {
            this.producer.resume();
        }
    }

    /** Toggle deafen (mutes/unmutes all audio elements). */
    toggleDeafen(): boolean {
        this._isDeafened = !this._isDeafened;
        for (const audio of this.audioElements.values()) {
            audio.muted = this._isDeafened;
        }
        return this._isDeafened;
    }

    // ── Mic Sensitivity / Noise Gate ────────────────────────────────────────

    /** Hook the AnalyserNode to the current localStream. */
    private hookAnalyser(): void {
        // Stop preview mode if it was running
        this.stopPreview();

        // Tear down any previous analyser
        if (this.silenceCheckInterval !== null) {
            clearInterval(this.silenceCheckInterval);
            this.silenceCheckInterval = null;
        }
        if (this._analysisTrack) {
            this._analysisTrack.stop();
            this._analysisTrack = null;
        }
        if (this.audioContext) {
            this.audioContext.close().catch(() => {});
            this.audioContext = null;
            this.analyser = null;
        }

        if (!this.localStream) return;

        // Clone the track for analysis so the AnalyserNode always reads
        // the raw mic signal, even when the original track is disabled
        // by the noise gate (track.enabled = false sends silence).
        const originalTrack = this.localStream.getAudioTracks()[0];
        if (!originalTrack) return;
        this._analysisTrack = originalTrack.clone();
        const analysisStream = new MediaStream([this._analysisTrack]);

        this.audioContext = new AudioContext();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;

        const source = this.audioContext.createMediaStreamSource(analysisStream);
        source.connect(this.analyser);

        const bufferLength = this.analyser.fftSize;
        const dataArray = new Float32Array(bufferLength);

        this.silenceCheckInterval = window.setInterval(() => {
            if (!this.analyser || !this.producer) return;

            this.analyser.getFloatTimeDomainData(dataArray);

            // Compute RMS → dB
            let sumSquares = 0;
            for (let i = 0; i < bufferLength; i++) {
                sumSquares += dataArray[i] * dataArray[i];
            }
            const rms = Math.sqrt(sumSquares / bufferLength);
            const dB = rms > 0 ? 20 * Math.log10(rms) : -Infinity;

            // Don't override manual mute
            if (this._isManuallyMuted) return;

            const track = this.localStream?.getAudioTracks()[0];
            if (!track) return;

            if (dB > this.sensitivityThreshold) {
                if (!track.enabled) track.enabled = true;
            } else {
                if (track.enabled) track.enabled = false;
            }
        }, 50) as unknown as number;
    }

    /** Enable noise gate with the given dB threshold. */
    enableSensitivity(threshold: number): void {
        this.sensitivityEnabled = true;
        this.sensitivityThreshold = threshold;
        if (this.localStream) {
            this.hookAnalyser();
        }
    }

    /** Disable the noise gate. */
    disableSensitivity(): void {
        this.sensitivityEnabled = false;
        if (this.silenceCheckInterval !== null) {
            clearInterval(this.silenceCheckInterval);
            this.silenceCheckInterval = null;
        }
        if (this._analysisTrack) {
            this._analysisTrack.stop();
            this._analysisTrack = null;
        }
        if (this.audioContext) {
            this.audioContext.close().catch(() => {});
            this.audioContext = null;
            this.analyser = null;
        }
        // Re-enable track if not manually muted
        if (!this._isManuallyMuted) {
            const track = this.localStream?.getAudioTracks()[0];
            if (track) track.enabled = true;
        }
    }

    /** Update the noise gate threshold (while enabled). */
    setThreshold(threshold: number): void {
        this.sensitivityThreshold = threshold;
    }

    /** Returns the current mic input level in dB (for meter visualization). */
    getCurrentLevel(): number {
        if (!this.analyser) return -Infinity;
        const bufferLength = this.analyser.fftSize;
        const dataArray = new Float32Array(bufferLength);
        this.analyser.getFloatTimeDomainData(dataArray);
        let sumSquares = 0;
        for (let i = 0; i < bufferLength; i++) {
            sumSquares += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sumSquares / bufferLength);
        return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    }

    // ── Preview mode (meter without voice channel) ────────────────────────

    /**
     * Start a preview mic capture for meter visualization only.
     * Used when the noise gate is enabled outside a voice channel so
     * the user can calibrate the threshold before joining.
     */
    async startPreview(): Promise<void> {
        // Don't start preview if already in a voice channel (hookAnalyser handles that)
        if (this.localStream) return;
        // Don't start if preview already running
        if (this._previewStream) return;

        const audioConstraints: MediaTrackConstraints = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        };
        if (this._audioDeviceId) {
            audioConstraints.deviceId = { exact: this._audioDeviceId };
        }

        this._previewStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
        });

        // Set up analyser from preview stream
        const track = this._previewStream.getAudioTracks()[0];
        if (!track) { this.stopPreview(); return; }

        this.audioContext = new AudioContext();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;

        const source = this.audioContext.createMediaStreamSource(this._previewStream);
        source.connect(this.analyser);
    }

    /** Stop the preview mic capture. */
    stopPreview(): void {
        if (this._previewStream) {
            for (const track of this._previewStream.getTracks()) {
                track.stop();
            }
            this._previewStream = null;
        }
        // Only tear down AudioContext if we're in preview mode (no localStream)
        // If localStream exists, hookAnalyser owns the AudioContext
        if (!this.localStream) {
            if (this.audioContext) {
                this.audioContext.close().catch(() => {});
                this.audioContext = null;
                this.analyser = null;
            }
        }
    }

    // ── Cleanup ───────────────────────────────────────────────────────────

    /** Leave voice — clean up all resources. */
    cleanup(): void {
        // Clean up preview if running
        this.stopPreview();

        // Clean up sensitivity / noise gate
        if (this.silenceCheckInterval !== null) {
            clearInterval(this.silenceCheckInterval);
            this.silenceCheckInterval = null;
        }
        if (this._analysisTrack) {
            this._analysisTrack.stop();
            this._analysisTrack = null;
        }
        if (this.audioContext) {
            this.audioContext.close().catch(() => {});
            this.audioContext = null;
            this.analyser = null;
        }

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

        for (const source of this.remoteMediaSources.values()) {
            source.disconnect();
        }
        this.remoteMediaSources.clear();
        for (const gain of this.remoteGainNodes.values()) {
            gain.disconnect();
        }
        this.remoteGainNodes.clear();
        this.consumerIdToUserId.clear();
        if (this.playbackAudioContext) {
            this.playbackAudioContext.close().catch(() => {});
            this.playbackAudioContext = null;
        }

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
        this._isManuallyMuted = false;
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
