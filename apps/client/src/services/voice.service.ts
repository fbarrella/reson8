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
        kind: "audio" | "video",
        rtpParameters: any,
        appData?: { mediaType?: "screen-audio" | "screen-video" },
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

    /**
     * Fire-and-forget — tells the server to close this Producer *now*,
     * rather than leaving viewers to find out only when the whole
     * Transport eventually closes (full voice disconnect). Confirmed live
     * this was the actual cause of viewers waiting a long time (in
     * practice, until the sharer fully left voice) to learn a screen
     * share had ended: closing a mediasoup-client Producer locally
     * (`producer.close()`) does NOT itself notify the server — the
     * server-side Producer stayed open indefinitely until something else
     * (a full disconnect) closed the Transport it belonged to.
     */
    closeProducer(producerId: string): void;
}

export class VoiceService {
    private device: Device | null = null;
    private sendTransport: msTypes.Transport | null = null;
    private recvTransport: msTypes.Transport | null = null;
    private producer: msTypes.Producer | null = null;
    private screenAudioProducer: msTypes.Producer | null = null;
    private screenVideoProducer: msTypes.Producer | null = null;
    private screenVideoStream: MediaStream | null = null;
    private consumers = new Map<string, msTypes.Consumer>();
    private audioElements = new Map<string, HTMLAudioElement>();
    private signaling: VoiceSignaling;
    private channelId: string | null = null;
    private localStream: MediaStream | null = null;
    private _isDeafened = false;

    /**
     * Fired at most once per join when a transport's WebRTC connection is
     * confirmed lost (ICE failed, or stuck "disconnected" past a grace
     * period) — independent of the Socket.io signaling channel, which may
     * still be perfectly healthy. The caller (preload.ts) is expected to
     * tear down and rejoin the voice channel in response (PRD 11.1).
     */
    onConnectionLost: (() => void) | null = null;
    /** Fired when a non-fatal voice error should be surfaced to the UI. */
    onError: ((message: string) => void) | null = null;
    private iceGraceTimer: ReturnType<typeof setTimeout> | null = null;
    private connectionLossReported = false;

    // ── Per-remote-user local volume/mute (client-local only, PRD 4.1/4.2) ──
    private playbackAudioContext: AudioContext | null = null;
    private remoteGainNodes = new Map<string, GainNode>(); // keyed by consumerId
    private remoteMediaSources = new Map<string, MediaStreamAudioSourceNode>(); // keyed by consumerId
    private consumerIdToUserId = new Map<string, string>();
    private remoteUserOverrides = new Map<string, { volumePercent: number; muted: boolean }>(); // keyed by userId
    /** Master attenuator (0-1) applied on top of every per-user gain (PRD 10.2). */
    private globalVoiceVolume = 1.0;

    // ── Mic sensitivity / noise gate ──────────────────────────────────────
    private analyser: AnalyserNode | null = null;
    private audioContext: AudioContext | null = null;
    private _analysisTrack: MediaStreamTrack | null = null;
    private _previewStream: MediaStream | null = null;
    private silenceCheckInterval: number | null = null;
    private sensitivityThreshold: number = -40; // dB
    private sensitivityEnabled: boolean = false;
    private _isManuallyMuted: boolean = false;
    /** True only when deafening had to pause the producer itself (i.e. the
     *  mic wasn't already paused going in) — so undeafening knows whether to
     *  resume it, rather than clobbering a mute that predates the deafen. */
    private _deafenAutoMuted: boolean = false;

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

        this.sendTransport.on("connectionstatechange", (state) => {
            this.handleTransportConnectionStateChange(state);
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
            // `appData` was previously dropped here — every `produce()` call
            // (mic, screen-audio, screen-video) funnels through this single
            // handler, and `appData.mediaType` is how the server (PRD 12.8)
            // tells them apart, so it has to be forwarded, not just
            // `kind`/`rtpParameters`.
            async ({ kind, rtpParameters, appData }, callback, errback) => {
                try {
                    const prodRes = await this.signaling.produce(
                        tp.id,
                        kind as "audio" | "video",
                        rtpParameters,
                        appData as { mediaType?: "screen-audio" | "screen-video" } | undefined,
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

        this.recvTransport.on("connectionstatechange", (state) => {
            this.handleTransportConnectionStateChange(state);
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

    /**
     * Handles WebRTC-level connection-state changes on either transport.
     * "disconnected" gets a grace period (ICE frequently self-recovers from
     * it, e.g. a brief NAT rebind) before being treated as a real failure;
     * "failed" is terminal immediately. Only reports once per join — the
     * caller is expected to tear the whole session down in response.
     */
    private handleTransportConnectionStateChange(state: string): void {
        if (state === "connected" || state === "completed") {
            if (this.iceGraceTimer !== null) {
                clearTimeout(this.iceGraceTimer);
                this.iceGraceTimer = null;
            }
            return;
        }

        if (state === "failed") {
            if (this.iceGraceTimer !== null) {
                clearTimeout(this.iceGraceTimer);
                this.iceGraceTimer = null;
            }
            this.reportConnectionLost();
            return;
        }

        if (state === "disconnected") {
            if (this.iceGraceTimer !== null) return; // already waiting
            this.iceGraceTimer = setTimeout(() => {
                this.iceGraceTimer = null;
                this.reportConnectionLost();
            }, 4000);
        }
    }

    private reportConnectionLost(): void {
        if (this.connectionLossReported) return;
        this.connectionLossReported = true;
        this.onConnectionLost?.();
    }

    private _audioDeviceId: string | null = null;

    /** Set the preferred audio input device ID. */
    setAudioDeviceId(deviceId: string | null): void {
        this._audioDeviceId = deviceId;
    }

    // ── Screen share audio (PRD 12.7) ───────────────────────────────────────

    /**
     * Produces a screen-share audio track on the same send Transport already
     * open for the mic — a second, independent mediasoup Producer, not a mix
     * of the two. The track itself is assembled by the caller (preload.ts)
     * from native-audio PCM frames via a `MediaStreamTrackGenerator`; this
     * method only owns the mediasoup side, mirroring `startProducing()`.
     * `appData.mediaType` lets the server (PRD 12.8) and other clients
     * (PRD 12.12's sharing badge) tell this apart from the mic Producer and
     * from the screen-video Producer.
     */
    async produceScreenAudio(track: MediaStreamTrack): Promise<void> {
        if (!this.sendTransport) throw new Error("Send transport not ready");
        this.screenAudioProducer = await this.sendTransport.produce({
            track,
            appData: { mediaType: "screen-audio" },
        });
    }

    /** Stops and closes the screen-share audio Producer, if one is active. */
    closeScreenAudioProducer(): void {
        if (this.screenAudioProducer) {
            this.signaling.closeProducer(this.screenAudioProducer.id);
            this.screenAudioProducer.close();
            this.screenAudioProducer = null;
        }
    }

    // ── Screen share video (PRD 12.8) ───────────────────────────────────────

    /**
     * Captures the chosen screen/window via Electron's `chromeMediaSource`
     * `getUserMedia` constraint and produces it with SVC (Scalable Video
     * Coding) temporal layering (`L1T3`: one spatial layer, three temporal),
     * so a viewer's Consumer can independently drop to a lower framerate via
     * `setPreferredLayers()` (PRD 12.13) without the sharer re-encoding.
     * Unlike the audio pipeline (PRD 12.7), capture and produce are bundled
     * in one method here, mirroring `startProducing()` — `getUserMedia`
     * needs no IPC/native-module frame assembly, so there's no reason to
     * split them across preload.ts and this class the way the
     * native-audio-fed path had to.
     *
     * Originally `L3T3_KEY` (3 spatial + 3 temporal layers, K-SVC), matching
     * PRD 12.8's intent of also letting viewers drop to a lower
     * *resolution*. Confirmed live that this silently produced a black feed
     * for every real (non-synthetic) screen capture, on every platform, not
     * just Wayland: Chromium's VP9 encoder rejects multi-spatial-layer
     * K-SVC specifically for screen-content-flagged tracks —
     * `libvpx_vp9_encoder.cc: "Flexible mode is required for screenshare
     * with several spatial layers"`, then `simulcast_encoder_adapter.cc:
     * InitEncode failed with WEBRTC_VIDEO_CODEC_ERR_PARAMETER`, then
     * `video_stream_encoder.cc: Failed to initialize the encoder... Error:
     * -4` — meaning the Producer's track was never actually encoded, hence
     * black on every viewer. A synthetic (canvas-sourced) test track isn't
     * flagged as screen content, so it never hit this and looked fine,
     * masking the bug. `L1T3` sidesteps it entirely by only ever using one
     * spatial layer. Revisit multi-resolution SVC only with a scalability
     * mode Chromium's screen-content path actually accepts (a flexible-mode
     * one, not K-SVC), verified against a *real* screen capture before
     * trusting it again.
     */
    async startScreenVideoProducing(chromeMediaSourceId: string): Promise<void> {
        if (!this.sendTransport) throw new Error("Send transport not ready");

        this.screenVideoStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: "desktop",
                    chromeMediaSourceId,
                },
            },
            // Electron's desktop-capture constraint format predates the
            // standard MediaTrackConstraints shape TypeScript's DOM lib
            // types — this cast is the well-known workaround for it, not a
            // real type mismatch.
        } as unknown as MediaStreamConstraints);

        await this.produceScreenVideoStream();
    }

    /**
     * Linux/Wayland-only path (renderer.ts's `isLinuxWayland` bypass):
     * `getDisplayMedia()` — not `desktopCapturer.getSources()` +
     * `getUserMedia({chromeMediaSourceId})` — because on Wayland only
     * `getDisplayMedia()` is a single round trip through the xdg-desktop-
     * portal ScreenCast picker (Electron hands off to Chromium's native
     * portal integration for it directly when no
     * `session.setDisplayMediaRequestHandler` is registered, which this app
     * doesn't do). The two-step `getSources()`/`getUserMedia()` API was
     * never designed around the portal's session-based consent model, and
     * confirmed live: it shows the OS picker a *second* time inside
     * `getUserMedia` even after `getSources()` already showed it once, with
     * the stream it eventually resolves not reliably wired to what was
     * actually granted (observed as a black feed on the viewer side) — and
     * `getSources()`'s placeholder source has no real name yet at that
     * point, which is also why that path logged `Started sharing ""`.
     * `track.label` here is the real post-grant label instead.
     */
    async startScreenVideoProducingViaSystemPicker(): Promise<{ label: string }> {
        if (!this.sendTransport) throw new Error("Send transport not ready");

        this.screenVideoStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
        });

        await this.produceScreenVideoStream();
        return { label: this.screenVideoStream.getVideoTracks()[0]?.label || "your screen" };
    }

    private async produceScreenVideoStream(): Promise<void> {
        if (!this.sendTransport || !this.screenVideoStream) throw new Error("Send transport not ready");

        const track = this.screenVideoStream.getVideoTracks()[0];
        this.screenVideoProducer = await this.sendTransport.produce({
            track,
            encodings: [{ scalabilityMode: "L1T3", maxBitrate: 2_500_000 }],
            codecOptions: { videoGoogleStartBitrate: 1000 },
            appData: { mediaType: "screen-video" },
        });
    }

    /** Stops screen-share video capture and closes its Producer. */
    stopScreenVideoProducing(): void {
        if (this.screenVideoProducer) {
            this.signaling.closeProducer(this.screenVideoProducer.id);
            this.screenVideoProducer.close();
            this.screenVideoProducer = null;
        }
        if (this.screenVideoStream) {
            for (const track of this.screenVideoStream.getTracks()) track.stop();
            this.screenVideoStream = null;
        }
    }

    /** Request mic access and start producing audio. */
    async startProducing(): Promise<void> {
        if (!this.sendTransport) throw new Error("Send transport not ready");

        const audioConstraints: MediaTrackConstraints = {
            echoCancellation: true,
            noiseSuppression: true,
            // Deliberately false (Phase 12 sub-phase item 7) — Chromium's
            // AGC implementation has a documented history of driving the
            // OS-level input volume itself as a side effect on Windows,
            // not just adjusting gain purely in software the way the W3C
            // spec describes it. Investigated after a report of Windows
            // mic input volume changing unexpectedly with no other code
            // anywhere in this app (main.ts, preload.ts, native-audio)
            // touching system/input volume at all — this constraint was
            // the only plausible mechanism found. Reson8 already has its
            // own client-side noise gate/threshold (see the mic
            // sensitivity settings), which covers most of what AGC would
            // otherwise be doing, so disabling it costs little.
            autoGainControl: false,
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
    queueConsumeProducer(producerId: string, userId: string, attempt: number = 1): void {
        const MAX_ATTEMPTS = 3;
        if (this.recvTransport && this.device) {
            this.consumeProducer(producerId, userId).catch((err) => {
                console.error(`[voice] Failed to consume producer (attempt ${attempt}):`, err);
                if (attempt < MAX_ATTEMPTS) {
                    setTimeout(() => {
                        this.queueConsumeProducer(producerId, userId, attempt + 1);
                    }, 1000);
                } else {
                    this.onError?.("Couldn't receive audio from a participant. They may need to rejoin.");
                }
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

        // Create an <audio> element, append to DOM, and play. This keeps the
        // MediaStreamTrack actively flowing/decoded (see root CLAUDE.md's
        // "detached audio element" gotcha) but is muted — actual audible
        // output is routed exclusively through the GainNode graph below, via
        // an independent createMediaStreamSource() tap on the same stream.
        //
        // Originally this used createMediaElementSource(audio) instead, on
        // the assumption that capturing an element for a Web Audio graph
        // redirects its native output there. That redirection turned out to
        // be unreliable in this Electron/Chromium build for srcObject/live-
        // MediaStream elements: with the element unmuted, the GainNode's
        // value had zero audible effect (confirmed live via logging — gain
        // reliably reached 0 while the remote participant stayed fully
        // audible); muting the element then produced total silence from
        // both participants, proving the graph was never the real output
        // path — the element's own native playback was. createMediaStreamSource
        // taps the stream directly, decoupled from the element entirely, so
        // the GainNode is unambiguously the sole audible route.
        const stream = new MediaStream([consumer.track]);
        const audio = document.createElement("audio") as HTMLAudioElement;
        audio.srcObject = stream;
        audio.autoplay = true;
        audio.volume = 1.0;
        audio.muted = true;
        document.body.appendChild(audio);
        audio.play().catch(() => { });

        this.audioElements.set(consumer.id, audio);

        // Route playback through a per-participant GainNode so local volume/mute
        // (client-local only — never sent to the server, see PRD 4.1/4.2) can go
        // above 100% and be toggled independently of the element's own volume.
        const ctx = this.getPlaybackAudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const gainNode = ctx.createGain();
        const override = this.remoteUserOverrides.get(userId);
        gainNode.gain.value = override
            ? (override.muted ? 0 : (override.volumePercent / 100) * this.globalVoiceVolume)
            : this.globalVoiceVolume;
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
                gain.gain.value = override.muted ? 0 : (override.volumePercent / 100) * this.globalVoiceVolume;
            }
        }
    }

    /** Set the master voice-chat volume attenuator (0-100%, PRD 10.2). Applied
     *  live to every currently-consumed participant, on top of their own
     *  per-user volume/mute override. */
    setGlobalVoiceVolume(percent: number): void {
        this.globalVoiceVolume = Math.max(0, Math.min(100, percent)) / 100;
        for (const [consumerId, userId] of this.consumerIdToUserId) {
            const gain = this.remoteGainNodes.get(consumerId);
            if (!gain) continue;
            const override = this.remoteUserOverrides.get(userId);
            gain.gain.value = override
                ? (override.muted ? 0 : (override.volumePercent / 100) * this.globalVoiceVolume)
                : this.globalVoiceVolume;
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

    /**
     * Toggle deafen (mutes/unmutes all audio elements). Deafening also
     * auto-mutes the mic if it wasn't already paused, and undeafening
     * restores exactly that prior mute state — see PRD 10.4. Returns the
     * resulting combined state so the caller can send a single
     * SET_VOICE_STATE update reflecting both flags at once.
     */
    toggleDeafen(): { isMuted: boolean; isDeafened: boolean } {
        if (!this._isDeafened) {
            const wasPaused = this.producer?.paused ?? false;
            this._deafenAutoMuted = !wasPaused;
            if (this._deafenAutoMuted && this.producer) {
                this.producer.pause();
                this._isManuallyMuted = true;
            }
            for (const audio of this.audioElements.values()) {
                audio.muted = true;
            }
            this._isDeafened = true;
        } else {
            for (const audio of this.audioElements.values()) {
                audio.muted = false;
            }
            this._isDeafened = false;
            if (this._deafenAutoMuted && this.producer) {
                this.producer.resume();
                this._isManuallyMuted = false;
            }
            this._deafenAutoMuted = false;
        }
        return { isMuted: this.producer?.paused ?? false, isDeafened: this._isDeafened };
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
            // Deliberately false (Phase 12 sub-phase item 7) — Chromium's
            // AGC implementation has a documented history of driving the
            // OS-level input volume itself as a side effect on Windows,
            // not just adjusting gain purely in software the way the W3C
            // spec describes it. Investigated after a report of Windows
            // mic input volume changing unexpectedly with no other code
            // anywhere in this app (main.ts, preload.ts, native-audio)
            // touching system/input volume at all — this constraint was
            // the only plausible mechanism found. Reson8 already has its
            // own client-side noise gate/threshold (see the mic
            // sensitivity settings), which covers most of what AGC would
            // otherwise be doing, so disabling it costs little.
            autoGainControl: false,
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
        if (this.iceGraceTimer !== null) {
            clearTimeout(this.iceGraceTimer);
            this.iceGraceTimer = null;
        }
        this.connectionLossReported = false;

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

        this.closeScreenAudioProducer();
        this.stopScreenVideoProducing();

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
        this._deafenAutoMuted = false;
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
