/**
 * Reson8 Client — the shared screen-share receive pipeline (PRD 19 C10).
 *
 * Extracted from the Viewer window's preload so the in-app stage (the main
 * window's preload) and the pop-out Viewer run exactly the same code. It owns
 * a small, independent recv-only mediasoup pipeline over its OWN Socket.io
 * connection tagged `role: "viewer"` (see `getMediasoupSessionKey` in the
 * server's `connection.handler.ts`: the tag keeps these transports from
 * colliding with the same user's primary voice session). A primary socket must
 * never call WATCH_SCREEN_SHARE / STOP_WATCHING_SCREEN_SHARE (V27) — that is
 * the reason a viewer socket exists at all.
 *
 * It creates the `<video>` itself and hands it to the caller to place (the
 * preload shares the renderer's DOM; MediaStream objects cannot cross
 * contextBridge). Audio goes through a Web Audio gain (0–200 %) fed by a muted,
 * DOM-attached `<audio>` element — the same arrangement `voice.service.ts` uses
 * (a detached or unattached element produces no sound / no flowing track).
 */

import { io, Socket } from "socket.io-client";
import { Device, types as msTypes } from "mediasoup-client";
import { createHash } from "crypto";
import type { ClientToServerEvents, ServerToClientEvents } from "@reson8/shared-types" with { "resolution-mode": "import" };

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface ScreenWatchOptions {
    serverBaseUrl: string;
    /** The pinned certificate the main connection uses, when the user trusted a self-signed one (PRD 18.3). */
    pin: { ca: string; fingerprint256: string } | null;
    /** A viewer ticket (PRD 17.12); null against a pre-2.6.0 server, which accepts the bare id. */
    ticket: string | null;
    instanceId: string;
    targetUserId: string;
    channelId: string;
    /**
     * The watch stopped AFTER it had started: the sharer stopped (`ended`) or the
     * connection was lost (`lost`). Never called for a failure of the start itself
     * (that rejects `startScreenWatch`) or after `close()`.
     */
    onEnded: (reason: string, kind: "ended" | "lost") => void;
}

export interface WatchHandle {
    videoEl: HTMLVideoElement;
    streamName: string;
    /** Height of the received video in pixels, when known (the "1080p" label). */
    qualityHeight(): number | null;
    /** 0–200. */
    setVolume(percent: number): void;
    setMuted(muted: boolean): void;
    isMuted(): boolean;
    /** Stops watching (server-side too), tears everything down and removes the media elements. */
    close(): Promise<void>;
}

const CONNECT_TIMEOUT_MS = 15000;

export async function startScreenWatch(opts: ScreenWatchOptions): Promise<WatchHandle> {
    const videoEl = document.createElement("video");
    videoEl.autoplay = true;
    videoEl.muted = true; // sound goes through the gain graph below
    videoEl.style.width = "100%";
    videoEl.style.height = "100%";
    videoEl.style.objectFit = "contain";
    videoEl.style.background = "#000";

    let socket: TypedSocket | null = null;
    let device: Device | null = null;
    let recvTransport: msTypes.Transport | null = null;
    const consumers = new Map<string, msTypes.Consumer>();
    let videoProducerId: string | null = null;
    let audioProducerId: string | null = null;
    let streamName = "";
    let closed = false;
    let started = false;

    let audioEl: HTMLAudioElement | null = null;
    let audioCtx: AudioContext | null = null;
    let audioSource: MediaStreamAudioSourceNode | null = null;
    let gainNode: GainNode | null = null;
    let volumePct = 100;
    let muted = false;

    const applyGain = (): void => {
        if (gainNode) gainNode.gain.value = muted ? 0 : Math.max(0, Math.min(200, volumePct)) / 100;
    };

    const emitSocket = <T>(event: string, payload: unknown): Promise<T> =>
        new Promise((resolve) => (socket as any).emit(event, payload, resolve));

    const tearDownMedia = (): void => {
        for (const consumer of consumers.values()) consumer.close();
        consumers.clear();
        recvTransport?.close();
        recvTransport = null;
        device = null;
        audioSource?.disconnect();
        audioSource = null;
        if (audioEl) {
            audioEl.pause();
            audioEl.srcObject = null;
            audioEl.remove();
            audioEl = null;
        }
    };

    async function consumeProducer(producerId: string): Promise<MediaStreamTrack> {
        if (!recvTransport || !device) throw new Error("Recv transport not ready");
        const res = await emitSocket<{
            success: boolean;
            consumer?: { id: string; producerId: string; kind: string; rtpParameters: any };
            error?: string;
        }>("CONSUME", { producerId, rtpCapabilities: device.rtpCapabilities });
        if (!res.success || !res.consumer) throw new Error(res.error ?? "Failed to consume");
        const { id, kind, rtpParameters } = res.consumer;
        const consumer = await recvTransport.consume({ id, producerId, kind: kind as msTypes.MediaKind, rtpParameters });
        consumers.set(consumer.id, consumer);
        await emitSocket("RESUME_CONSUMER", { consumerId: consumer.id });
        return consumer.track;
    }

    /** Authenticates, asks to watch, builds the transport and consumes. Safe to run again after a reconnect. */
    async function establish(): Promise<void> {
        tearDownMedia();
        const authPayload = opts.ticket ? { ticket: opts.ticket } : { instanceId: opts.instanceId };
        const auth = await emitSocket<{ success: boolean; error?: string }>("VIEWER_AUTHENTICATE", authPayload);
        if (!auth.success) throw new Error(auth.error ?? "Failed to authenticate");

        const watch = await emitSocket<{
            success: boolean;
            rtpCapabilities?: any;
            screenVideoProducerId?: string;
            screenAudioProducerId?: string;
            streamName?: string;
            error?: string;
        }>("WATCH_SCREEN_SHARE", { targetUserId: opts.targetUserId, channelId: opts.channelId });
        if (!watch.success || !watch.rtpCapabilities || !watch.screenVideoProducerId) {
            throw new Error(watch.error ?? "This user is not currently sharing their screen");
        }
        videoProducerId = watch.screenVideoProducerId;
        audioProducerId = watch.screenAudioProducerId ?? null;
        streamName = watch.streamName ?? "";

        device = new Device();
        await device.load({ routerRtpCapabilities: watch.rtpCapabilities });

        const created = await emitSocket<{
            success: boolean;
            transport?: { id: string; iceParameters: any; iceCandidates: any[]; dtlsParameters: any };
            iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
            error?: string;
        }>("CREATE_WEBRTC_TRANSPORT", { channelId: opts.channelId, direction: "recv" });
        if (!created.success || !created.transport) throw new Error(created.error ?? "Failed to create transport");
        const tp = created.transport;
        recvTransport = device.createRecvTransport({
            id: tp.id,
            iceParameters: tp.iceParameters,
            iceCandidates: tp.iceCandidates,
            dtlsParameters: tp.dtlsParameters,
            ...(created.iceServers ? { iceServers: created.iceServers } : {}),
        });
        recvTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
            try {
                const res = await emitSocket<{ success: boolean; error?: string }>("CONNECT_TRANSPORT", {
                    transportId: tp.id,
                    dtlsParameters,
                });
                if (!res.success) throw new Error(res.error);
                callback();
            } catch (err) {
                errback(err as Error);
            }
        });
        recvTransport.on("connectionstatechange", (state) => {
            if ((state === "failed" || state === "closed") && started && !closed) {
                opts.onEnded("Connection lost", "lost");
            }
        });

        const videoTrack = await consumeProducer(watch.screenVideoProducerId);
        videoEl.srcObject = new MediaStream([videoTrack]);
        videoEl.play().catch(() => {});

        if (watch.screenAudioProducerId) {
            const audioTrack = await consumeProducer(watch.screenAudioProducerId);
            const stream = new MediaStream([audioTrack]);
            audioEl = document.createElement("audio");
            audioEl.srcObject = stream;
            audioEl.autoplay = true;
            audioEl.muted = true; // keeps the track flowing; audible output is the gain graph only
            document.body.appendChild(audioEl);
            audioEl.play().catch(() => {});
            if (!audioCtx) audioCtx = new AudioContext();
            if (audioCtx.state === "suspended") void audioCtx.resume();
            if (!gainNode) {
                gainNode = audioCtx.createGain();
                gainNode.connect(audioCtx.destination);
            }
            audioSource = audioCtx.createMediaStreamSource(stream);
            audioSource.connect(gainNode);
            applyGain();
        }
    }

    // ── connect ────────────────────────────────────────────────────────────

    const pin = opts.pin;
    socket = io(opts.serverBaseUrl, {
        query: { role: "viewer" },
        transports: ["websocket"],
        ...(pin
            ? {
                  ca: [pin.ca],
                  checkServerIdentity: (_hostname: string, cert: { raw?: Buffer }): Error | undefined => {
                      const actual = cert.raw ? createHash("sha256").update(cert.raw).digest("hex") : "";
                      return actual === pin.fingerprint256 ? undefined : new Error("The server's certificate changed");
                  },
              }
            : {}),
    }) as TypedSocket;

    const cleanup = async (stopOnServer: boolean): Promise<void> => {
        if (stopOnServer && socket?.connected) {
            await new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, 1500);
                socket!.emit("STOP_WATCHING_SCREEN_SHARE", { channelId: opts.channelId }, () => {
                    clearTimeout(timer);
                    resolve();
                });
            });
        }
        tearDownMedia();
        videoEl.srcObject = null;
        videoEl.remove();
        if (gainNode) {
            gainNode.disconnect();
            gainNode = null;
        }
        if (audioCtx) {
            void audioCtx.close().catch(() => {});
            audioCtx = null;
        }
        if (socket) {
            socket.removeAllListeners();
            socket.disconnect();
            socket = null;
        }
    };

    try {
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Connection timed out")), CONNECT_TIMEOUT_MS);
            socket!.once("connect", () => {
                clearTimeout(timer);
                resolve();
            });
            socket!.once("connect_error", (err: Error) => {
                clearTimeout(timer);
                reject(new Error(err?.message ?? "Connection failed"));
            });
        });
        await establish();
    } catch (err) {
        closed = true;
        await cleanup(false);
        throw err instanceof Error ? err : new Error("Failed to start watching");
    }
    started = true;

    // Reconnects re-establish the watch on the same elements.
    socket!.io.on("reconnect", () => {
        if (closed) return;
        void establish().catch((err: Error) => {
            if (!closed) opts.onEnded(err?.message ?? "Connection lost", "lost");
        });
    });
    // Server emits this to the consuming socket when the underlying producer
    // closes (PRD 12.13) — the sharer stopped or disconnected.
    socket!.on("PRODUCER_CLOSED", (payload) => {
        if (closed) return;
        if (payload.producerId === videoProducerId || payload.producerId === audioProducerId) {
            opts.onEnded("The screen share has ended", "ended");
        }
    });

    return {
        videoEl,
        get streamName() {
            return streamName;
        },
        qualityHeight(): number | null {
            const track = (videoEl.srcObject as MediaStream | null)?.getVideoTracks()[0];
            const h = track?.getSettings().height ?? videoEl.videoHeight;
            return h && h > 0 ? h : null;
        },
        setVolume(percent: number): void {
            volumePct = Math.max(0, Math.min(200, percent));
            applyGain();
        },
        setMuted(value: boolean): void {
            muted = value;
            applyGain();
        },
        isMuted(): boolean {
            return muted;
        },
        async close(): Promise<void> {
            if (closed) return;
            closed = true;
            await cleanup(true);
        },
    };
}
