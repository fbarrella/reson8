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
import { DeepFilterNet3Core } from "deepfilternet3-noise-filter";

// ── Noise cancelling (PRD 13.1) — shared module-level engine ────────────────
// One DeepFilterNet3Core instance for the whole app session, not per join:
// `initialize()` fetches + WebAssembly.compile()s the vendored ~24MB WASM +
// ONNX model (apps/client/assets/deepfilternet/, NOT the package's default
// third-party CDN — see PRD 13.1's asset-sourcing decision) exactly once and
// caches the compiled module/bytes internally; every subsequent join reuses
// that cache via createAudioWorkletNode(), which only spins up a fresh node
// bound to that join's own AudioContext. `cdnUrl` is relative to
// dist/renderer/index.html, mirroring the existing sound-alert asset path
// convention (`../../assets/...`) already used elsewhere in this codebase.
const noiseCancelCore = new DeepFilterNet3Core({
    sampleRate: 48000,
    noiseReductionLevel: 100,
    assetConfig: { cdnUrl: "../../assets/deepfilternet" },
});
let noiseCancelInitPromise: Promise<void> | null = null;
function ensureNoiseCancelInitialized(): Promise<void> {
    if (!noiseCancelInitPromise) {
        noiseCancelInitPromise = noiseCancelCore.initialize().catch((err) => {
            noiseCancelInitPromise = null; // allow a retry on the next enable attempt
            throw err;
        });
    }
    return noiseCancelInitPromise;
}

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
     * Asks the server to restart ICE on an existing transport whose
     * connection has degraded, returning fresh `iceParameters` to apply
     * locally via mediasoup-client's `transport.restartIce()`.
     */
    restartIce(
        transportId: string,
    ): Promise<{ success: boolean; iceParameters?: any; error?: string }>;

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
    private iceRestartInFlight = new Set<string>(); // transport IDs

    // ── Per-remote-user local volume/mute (client-local only, PRD 4.1/4.2) ──
    private playbackAudioContext: AudioContext | null = null;
    private remoteGainNodes = new Map<string, GainNode>(); // keyed by consumerId
    private remoteMediaSources = new Map<string, MediaStreamAudioSourceNode>(); // keyed by consumerId
    private consumerIdToUserId = new Map<string, string>();
    private remoteUserOverrides = new Map<string, { volumePercent: number; muted: boolean }>(); // keyed by userId
    /** Master attenuator (0-1) applied on top of every per-user gain (PRD 10.2). */
    private globalVoiceVolume = 1.0;

    // ── Send-side mic processing graph ─────────────────────────────────────
    // Built once per join in startProducing() — `localStream`'s raw track is
    // never produced directly. Every effect that needs to touch the outgoing
    // mic signal taps or extends this same chain instead of building its own
    // AudioContext:
    //   micSourceNode → [noiseCancelNode] → gateGainNode → volumeGainNode → micDestinationNode → produce()
    // `analyser` taps strictly *after* `noiseCancelNode` (or after
    // `micSourceNode` directly if noise cancelling isn't wired in) so gate
    // decisions and the settings meter read the denoised signal per PRD
    // 13.1, while still being pre-gate/pre-volume so they reflect true input
    // level rather than the already-gated/scaled output.
    private audioContext: AudioContext | null = null;
    private micSourceNode: MediaStreamAudioSourceNode | null = null;
    private analyser: AnalyserNode | null = null;
    private gateGainNode: GainNode | null = null;
    private volumeGainNode: GainNode | null = null;
    private micDestinationNode: MediaStreamAudioDestinationNode | null = null;
    /** Mic input volume as a linear gain multiplier (0.0–2.0, 100% = 1.0) —
     *  kept even without a live graph so a volume set before joining a
     *  channel is applied the instant the graph is built (PRD 13.3). */
    private micVolume: number = 1.0;

    // ── Noise cancelling (PRD 13.1) ──────────────────────────────────────────
    private noiseCancelNode: AudioWorkletNode | null = null;
    /** Kept even without a live graph, mirroring `sensitivityEnabled`, so a
     *  setting persisted from a previous session can be honored the moment
     *  a graph is next built. */
    private noiseCancelEnabled: boolean = false;

    // ── Mic sensitivity / noise gate ──────────────────────────────────────
    private _previewStream: MediaStream | null = null;
    private silenceCheckInterval: number | null = null;
    private sensitivityThreshold: number = -40; // dB
    private sensitivityEnabled: boolean = false;
    private _isManuallyMuted: boolean = false;
    /** Attack/hold/release envelope constants (PRD 13.2) — chosen to feel
     *  instant on open while surviving natural mid-sentence pauses without
     *  cutting: fast attack, a hold window before release even starts, then
     *  a short fade rather than an instant cut. */
    private static readonly GATE_ATTACK_SEC = 0.015;
    private static readonly GATE_HOLD_SEC = 0.35;
    private static readonly GATE_RELEASE_SEC = 0.2;
    private gateState: "open" | "closed" = "open";
    /** audioContext.currentTime when the signal first dropped below
     *  threshold since the gate was last open; null while above threshold. */
    private gateBelowThresholdSince: number | null = null;
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
            this.handleTransportConnectionStateChange(state, this.sendTransport!);
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
            this.handleTransportConnectionStateChange(state, this.recvTransport!);
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
     * "disconnected" triggers an immediate ICE restart attempt — mediasoup
     * can usually recover a transient drop (brief WiFi hiccup, NAT rebind)
     * in place, with no audible interruption and no producer/consumer
     * teardown. A grace timer runs in parallel as a fallback: if the state
     * hasn't recovered by the time it fires (restart failed, or signaling
     * itself is down), it's treated as a real failure. "failed" is terminal
     * immediately. Only reports once per join — the caller is expected to
     * tear the whole session down in response.
     */
    private handleTransportConnectionStateChange(state: string, transport: msTypes.Transport): void {
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
            void this.attemptIceRestart(transport);
            if (this.iceGraceTimer !== null) return; // already waiting
            this.iceGraceTimer = setTimeout(() => {
                this.iceGraceTimer = null;
                this.reportConnectionLost();
            }, 6000);
        }
    }

    /**
     * Asks the server to restart ICE on `transport` and applies the fresh
     * parameters locally. Best-effort: if signaling is also down (e.g. the
     * Socket.io connection itself dropped), this simply fails silently and
     * the grace timer in `handleTransportConnectionStateChange` falls back
     * to the full rejoin path once it expires.
     */
    private async attemptIceRestart(transport: msTypes.Transport): Promise<void> {
        if (transport.closed || this.iceRestartInFlight.has(transport.id)) return;
        this.iceRestartInFlight.add(transport.id);
        try {
            const res = await this.signaling.restartIce(transport.id);
            if (res.success && res.iceParameters && !transport.closed) {
                await transport.restartIce({ iceParameters: res.iceParameters });
            }
        } catch (err) {
            console.error("[voice] ICE restart failed:", err);
        } finally {
            this.iceRestartInFlight.delete(transport.id);
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

        const processedTrack = await this.buildMicProcessingGraph();
        this.producer = await this.sendTransport.produce({ track: processedTrack });

        // If the noise gate setting was already on before this join, start
        // its envelope loop now that the graph it needs exists.
        if (this.sensitivityEnabled) {
            this.startGateLoop();
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
        gainNode.gain.value = this.computeGainForUser(userId);
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

    private applyOverrideForUser(userId: string): void {
        for (const [consumerId, uid] of this.consumerIdToUserId) {
            if (uid !== userId) continue;
            const gain = this.remoteGainNodes.get(consumerId);
            if (gain) {
                gain.gain.value = this.computeGainForUser(userId);
            }
        }
    }

    /** Computes the actual GainNode value for a remote participant, factoring
     *  in their per-user override, the master volume attenuator, and local
     *  deafen. Deafen wins outright — 0 regardless of any other setting —
     *  since it must silence everyone, including participants consumed
     *  *after* deafen was toggled on (PRD 10.4 follow-up). */
    private computeGainForUser(userId: string): number {
        if (this._isDeafened) return 0;
        const override = this.remoteUserOverrides.get(userId);
        return override
            ? (override.muted ? 0 : (override.volumePercent / 100) * this.globalVoiceVolume)
            : this.globalVoiceVolume;
    }

    /** Set the master voice-chat volume attenuator (0-100%, PRD 10.2). Applied
     *  live to every currently-consumed participant, on top of their own
     *  per-user volume/mute override. */
    setGlobalVoiceVolume(percent: number): void {
        this.globalVoiceVolume = Math.max(0, Math.min(100, percent)) / 100;
        for (const [consumerId, userId] of this.consumerIdToUserId) {
            const gain = this.remoteGainNodes.get(consumerId);
            if (!gain) continue;
            gain.gain.value = this.computeGainForUser(userId);
        }
    }

    /** Set a remote participant's local playback volume (0–200%, 100% = default). Client-local only. */
    setLocalUserVolume(userId: string, percent: number): void {
        const clamped = Math.max(0, Math.min(200, percent));
        const existing = this.remoteUserOverrides.get(userId) ?? { volumePercent: 100, muted: false };
        existing.volumePercent = clamped;
        this.remoteUserOverrides.set(userId, existing);
        this.applyOverrideForUser(userId);
    }

    /** Mute/unmute a remote participant locally, preserving their configured volume. Client-local only. */
    setLocalUserMute(userId: string, muted: boolean): void {
        const existing = this.remoteUserOverrides.get(userId) ?? { volumePercent: 100, muted: false };
        existing.muted = muted;
        this.remoteUserOverrides.set(userId, existing);
        this.applyOverrideForUser(userId);
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
            this._isDeafened = true;
        } else {
            this._isDeafened = false;
            if (this._deafenAutoMuted && this.producer) {
                this.producer.resume();
                this._isManuallyMuted = false;
            }
            this._deafenAutoMuted = false;
        }
        // Re-derive every currently-consumed participant's GainNode from
        // computeGainForUser(), which itself checks `_isDeafened` first —
        // this also fixes a participant who is *consumed after* deafen was
        // toggled on: consumeProducer() calls the same helper, so a newly
        // joined speaker starts silenced too, rather than only whoever was
        // already in the channel at toggle time (the original bug here).
        for (const [consumerId, userId] of this.consumerIdToUserId) {
            const gain = this.remoteGainNodes.get(consumerId);
            if (gain) gain.gain.value = this.computeGainForUser(userId);
        }
        return { isMuted: this.producer?.paused ?? false, isDeafened: this._isDeafened };
    }

    // ── Send-side mic processing graph (PRD 13.2/13.3/13.1) ─────────────────

    /**
     * Builds the always-on send-side Web Audio graph for the current
     * `localStream` and returns the track to actually produce. Runs once per
     * join, from `startProducing()` — the noise gate's GainNode lives here
     * unconditionally (defaulting to fully open) so enabling/disabling the
     * gate mid-call never needs to tear down or re-produce; it only starts
     * or stops the envelope loop below. Constructed at a fixed 48kHz — the
     * noise-cancelling model (PRD 13.1) assumes 48kHz frames; Web Audio
     * resamples the actual mic hardware's rate into the context transparently,
     * so this is safe regardless of the input device's native rate.
     *
     * If noise cancelling is already enabled when this runs, the
     * AudioWorkletNode is wired in as the very first stage; if not, it's
     * inserted later (dynamically, mid-call, no teardown) by
     * `setNoiseCancelEnabled()` if the user turns it on during this session.
     */
    private async buildMicProcessingGraph(): Promise<MediaStreamTrack> {
        this.teardownMicProcessingGraph();
        if (!this.localStream) throw new Error("No local stream to build mic graph from");

        this.audioContext = new AudioContext({ sampleRate: 48000 });
        this.micSourceNode = this.audioContext.createMediaStreamSource(this.localStream);

        let tapSource: AudioNode = this.micSourceNode;
        if (this.noiseCancelEnabled) {
            try {
                this.noiseCancelNode = await this.createNoiseCancelNode();
                this.micSourceNode.connect(this.noiseCancelNode);
                tapSource = this.noiseCancelNode;
            } catch (err) {
                console.error("[voice] Noise cancelling failed to initialize, continuing without it:", err);
                this.noiseCancelNode = null;
                this.onError?.("Noise cancelling couldn't start — continuing without it.");
            }
        }

        // Post-noise-cancel (or pre-gate, if noise cancelling isn't wired
        // in) tap — always reflects the true input level, whether or not
        // the gate is currently enabled.
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 2048;
        tapSource.connect(this.analyser);

        this.gateGainNode = this.audioContext.createGain();
        this.gateGainNode.gain.value = 1.0;
        tapSource.connect(this.gateGainNode);

        this.volumeGainNode = this.audioContext.createGain();
        this.volumeGainNode.gain.value = this.micVolume;
        this.gateGainNode.connect(this.volumeGainNode);

        this.micDestinationNode = this.audioContext.createMediaStreamDestination();
        this.volumeGainNode.connect(this.micDestinationNode);

        return this.micDestinationNode.stream.getAudioTracks()[0];
    }

    /** Tears down the send-side graph entirely — only ever on full cleanup or
     *  before rebuilding it, never on a mere gate/noise-cancel toggle. */
    private teardownMicProcessingGraph(): void {
        this.stopGateLoop(false);
        if (this.noiseCancelNode) {
            this.noiseCancelNode.disconnect();
            this.noiseCancelNode = null;
        }
        if (this.gateGainNode) {
            this.gateGainNode.disconnect();
            this.gateGainNode = null;
        }
        if (this.volumeGainNode) {
            this.volumeGainNode.disconnect();
            this.volumeGainNode = null;
        }
        if (this.micDestinationNode) {
            this.micDestinationNode.disconnect();
            this.micDestinationNode = null;
        }
        if (this.micSourceNode) {
            this.micSourceNode.disconnect();
            this.micSourceNode = null;
        }
        if (this.audioContext) {
            this.audioContext.close().catch(() => {});
            this.audioContext = null;
        }
        this.analyser = null;
    }

    // ── Mic Sensitivity / Noise Gate ────────────────────────────────────────

    /**
     * Starts the noise-gate envelope loop against the already-built
     * processing graph. Every 50ms, compares the pre-gate RMS level to the
     * threshold and drives `gateGainNode.gain` through a real attack/hold/
     * release ramp instead of an instant on/off — a natural mid-sentence
     * dip below threshold is absorbed by the hold window rather than
     * cutting audio immediately (the original source of the choppiness).
     */
    private startGateLoop(): void {
        if (this.silenceCheckInterval !== null) return; // already running
        this.gateBelowThresholdSince = null;
        this.gateState = "open";

        this.silenceCheckInterval = window.setInterval(() => {
            if (!this.analyser || !this.gateGainNode || !this.audioContext) return;

            const dB = this.readAnalyserLevel();
            const now = this.audioContext.currentTime;

            if (dB > this.sensitivityThreshold) {
                this.gateBelowThresholdSince = null;
                if (this.gateState !== "open") {
                    this.gateGainNode.gain.cancelScheduledValues(now);
                    this.gateGainNode.gain.setValueAtTime(this.gateGainNode.gain.value, now);
                    this.gateGainNode.gain.linearRampToValueAtTime(1.0, now + VoiceService.GATE_ATTACK_SEC);
                    this.gateState = "open";
                }
            } else if (this.gateState !== "closed") {
                if (this.gateBelowThresholdSince === null) {
                    this.gateBelowThresholdSince = now;
                } else if (now - this.gateBelowThresholdSince >= VoiceService.GATE_HOLD_SEC) {
                    this.gateGainNode.gain.cancelScheduledValues(now);
                    this.gateGainNode.gain.setValueAtTime(this.gateGainNode.gain.value, now);
                    this.gateGainNode.gain.linearRampToValueAtTime(0.0, now + VoiceService.GATE_RELEASE_SEC);
                    this.gateState = "closed";
                }
            }
        }, 50) as unknown as number;
    }

    /** Stops the envelope loop. `forceOpen` ramps the gate back to fully
     *  open — used when the gate feature itself is disabled, so the mic
     *  isn't left stuck at whatever gain the loop last set. */
    private stopGateLoop(forceOpen: boolean): void {
        if (this.silenceCheckInterval !== null) {
            clearInterval(this.silenceCheckInterval);
            this.silenceCheckInterval = null;
        }
        this.gateBelowThresholdSince = null;
        this.gateState = "open";
        if (forceOpen && this.gateGainNode && this.audioContext) {
            const now = this.audioContext.currentTime;
            this.gateGainNode.gain.cancelScheduledValues(now);
            this.gateGainNode.gain.setValueAtTime(this.gateGainNode.gain.value, now);
            this.gateGainNode.gain.linearRampToValueAtTime(1.0, now + VoiceService.GATE_ATTACK_SEC);
        }
    }

    private readAnalyserLevel(): number {
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

    /** Enable noise gate with the given dB threshold. */
    enableSensitivity(threshold: number): void {
        this.sensitivityEnabled = true;
        this.sensitivityThreshold = threshold;
        // If a call is already active, the graph exists — start the loop
        // immediately. If not, startProducing() checks `sensitivityEnabled`
        // once the graph is built on join.
        if (this.gateGainNode) {
            this.startGateLoop();
        }
    }

    /** Disable the noise gate — stops gating without touching the rest of
     *  the send-side graph (mic volume / noise cancelling keep working). */
    disableSensitivity(): void {
        this.sensitivityEnabled = false;
        this.stopGateLoop(true);
    }

    /** Update the noise gate threshold (while enabled). */
    setThreshold(threshold: number): void {
        this.sensitivityThreshold = threshold;
    }

    /** Returns the current mic input level in dB (for meter visualization). */
    getCurrentLevel(): number {
        return this.readAnalyserLevel();
    }

    // ── Mic Volume (PRD 13.3) ────────────────────────────────────────────────

    /** Set mic input volume (0–200%, 100% = unprocessed input level). Applies
     *  live to the send-side graph; safe to call before joining a channel —
     *  the value is applied the moment the graph is built. */
    setMicVolume(percent: number): void {
        const clamped = Math.max(0, Math.min(200, percent));
        this.micVolume = clamped / 100;
        if (this.volumeGainNode) {
            this.volumeGainNode.gain.value = this.micVolume;
        }
    }

    // ── Noise Cancelling (PRD 13.1) ──────────────────────────────────────────

    /** Waits for the shared engine to be ready, then spins up a fresh
     *  AudioWorkletNode bound to this join's own AudioContext. The WASM
     *  fetch + compile only actually happens the first time this is called
     *  across the whole app session (cached on `noiseCancelCore` after). */
    private async createNoiseCancelNode(): Promise<AudioWorkletNode> {
        await ensureNoiseCancelInitialized();
        if (!this.audioContext) throw new Error("No audio context to attach noise cancelling to");
        return noiseCancelCore.createAudioWorkletNode(this.audioContext);
    }

    /**
     * Enable/disable AI noise cancelling. Mirrors `enableSensitivity()`'s
     * "safe to call before a graph exists" contract, but is async: the very
     * first enable *this session* fetches + compiles the vendored WASM
     * engine (a few hundred ms), and the very first enable *this join* has
     * to splice the AudioWorkletNode into an already-running graph (a brief
     * reconnect). Every toggle after that — for the rest of this join — is
     * instant: it only sends a passthrough/bypass message to the
     * already-created node, never tearing down or rebuilding the graph or
     * the mediasoup connection, per the feature's own requirement.
     */
    async setNoiseCancelEnabled(enabled: boolean): Promise<void> {
        this.noiseCancelEnabled = enabled;

        // No live graph yet (not in a call) — startProducing() will honor
        // the flag itself once it next builds one.
        if (!this.micSourceNode || !this.audioContext || !this.gateGainNode || !this.analyser) {
            return;
        }

        if (this.noiseCancelNode) {
            // Already spliced into the graph — just flip its mode. The
            // worklet's own message handler is the (unexported) internal
            // API of the vendored package — this mirrors its literal source.
            this.noiseCancelNode.port.postMessage({ type: "SET_BYPASS", value: !enabled });
            return;
        }

        if (!enabled) return; // never created, nothing to disable

        try {
            const node = await this.createNoiseCancelNode();
            // A disable or a full cleanup() could have raced this await.
            if (!this.noiseCancelEnabled || !this.micSourceNode || !this.audioContext || !this.gateGainNode || !this.analyser) {
                node.disconnect();
                return;
            }
            this.micSourceNode.disconnect(this.analyser);
            this.micSourceNode.disconnect(this.gateGainNode);
            this.micSourceNode.connect(node);
            node.connect(this.analyser);
            node.connect(this.gateGainNode);
            this.noiseCancelNode = node;
        } catch (err) {
            console.error("[voice] Failed to enable noise cancelling:", err);
            this.noiseCancelEnabled = false;
            this.onError?.("Couldn't enable noise cancelling.");
        }
    }

    // ── Preview mode (meter without voice channel) ────────────────────────

    /**
     * Start a preview mic capture for meter visualization only.
     * Used when the noise gate is enabled outside a voice channel so
     * the user can calibrate the threshold before joining.
     */
    async startPreview(): Promise<void> {
        // Don't start preview if already in a voice channel (the mic
        // processing graph built in startProducing() already owns the meter)
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
        // If localStream exists, the mic processing graph owns the AudioContext
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

        // Clean up the send-side mic processing graph (noise gate, and its
        // future mic-volume/noise-cancelling extensions)
        this.teardownMicProcessingGraph();

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
