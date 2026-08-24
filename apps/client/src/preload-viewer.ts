/**
 * Reson8 Client — Screen Share Viewer Preload Script (PRD 12.13)
 *
 * Runs in the Viewer window created by `main.ts`'s `open-screen-share-viewer`
 * IPC handler. Deliberately does NOT reuse `VoiceService` — that class bundles
 * mic capture, producing, and noise-gate concerns this window never needs.
 * Instead this owns a small, independent recv-only mediasoup pipeline over
 * its own Socket.io connection (tagged `role: "viewer"` — see
 * `getMediasoupSessionKey` in the server's `connection.handler.ts` for why
 * that tag exists: it keeps this window's transports from colliding with the
 * same user's primary voice-channel session).
 *
 * Initial params are read from `process.argv` (`additionalArguments` is the
 * only way to hand data to a new window's preload script) rather than IPC,
 * since there's no renderer-side request that could ask for them first.
 */

import { contextBridge, ipcRenderer } from "electron";
import { io, Socket } from "socket.io-client";
import { Device, types as msTypes } from "mediasoup-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@reson8/shared-types";

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type ViewerStatus = "connecting" | "watching" | "ended" | "error";

function readArg(name: string): string {
    const prefix = `--${name}=`;
    const arg = process.argv.find((a) => a.startsWith(prefix));
    return arg ? decodeURIComponent(arg.slice(prefix.length)) : "";
}

const targetUserId = readArg("viewer-target-user-id");
const channelId = readArg("viewer-channel-id");
const nickname = readArg("viewer-nickname");
const serverBaseUrl = readArg("viewer-server-base-url");

let socket: TypedSocket | null = null;
let device: Device | null = null;
let recvTransport: msTypes.Transport | null = null;
const consumers = new Map<string, msTypes.Consumer>();
let screenVideoProducerId: string | null = null;
let screenAudioProducerId: string | null = null;

const statusListeners: Array<(status: ViewerStatus, message?: string) => void> = [];
// `start()` runs immediately, before `viewer.html`'s own script has parsed
// and called `onStatus()` — on a fast (e.g. localhost) connection, the
// "connecting" → "watching"/"error" transition can complete before anyone is
// listening. Tracking the last status and replaying it to each new
// subscriber below closes that race instead of silently dropping it.
let lastStatus: { status: ViewerStatus; message?: string } = { status: "connecting" };
function setStatus(status: ViewerStatus, message?: string): void {
    lastStatus = { status, message };
    for (const cb of statusListeners) {
        try {
            cb(status, message);
        } catch (err) {
            console.error("[viewer] Error in status listener:", err);
        }
    }
}

// The video element lives here (preload shares the renderer's DOM — see root
// CLAUDE.md's Electron gotchas) rather than being passed across
// contextBridge, which cannot carry MediaStream/track objects.
const videoEl = document.createElement("video");
videoEl.autoplay = true;
videoEl.style.width = "100%";
videoEl.style.height = "100%";
videoEl.style.objectFit = "contain";
videoEl.style.background = "#000";

function attachVideoToDom(): void {
    const container = document.getElementById("video-container");
    if (container && !container.contains(videoEl)) {
        container.appendChild(videoEl);
    }
}
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attachVideoToDom);
} else {
    attachVideoToDom();
}

// Individual typed signaling wrappers — one per event this window calls,
// mirroring `preload.ts`'s `createSignaling()` rather than a single generic
// helper, since a generic keyed off `ClientToServerEvents` can't reliably
// tell ack-taking events apart from fire-and-forget ones at the type level.
function viewerAuthenticate(instanceId: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => socket!.emit("VIEWER_AUTHENTICATE", { instanceId }, resolve));
}

function watchScreenShare(): Promise<{
    success: boolean;
    rtpCapabilities?: any;
    screenVideoProducerId?: string;
    screenAudioProducerId?: string;
    error?: string;
}> {
    return new Promise((resolve) =>
        socket!.emit("WATCH_SCREEN_SHARE", { targetUserId, channelId }, resolve),
    );
}

function createWebRtcTransport(): Promise<{
    success: boolean;
    transport?: { id: string; iceParameters: any; iceCandidates: any[]; dtlsParameters: any };
    iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
    error?: string;
}> {
    return new Promise((resolve) =>
        socket!.emit("CREATE_WEBRTC_TRANSPORT", { channelId, direction: "recv" }, resolve),
    );
}

function connectTransport(
    transportId: string,
    dtlsParameters: any,
): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) =>
        socket!.emit("CONNECT_TRANSPORT", { transportId, dtlsParameters }, resolve),
    );
}

function consume(
    producerId: string,
    rtpCapabilities: any,
): Promise<{
    success: boolean;
    consumer?: { id: string; producerId: string; kind: string; rtpParameters: any };
    error?: string;
}> {
    return new Promise((resolve) => socket!.emit("CONSUME", { producerId, rtpCapabilities }, resolve));
}

function resumeConsumer(consumerId: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => socket!.emit("RESUME_CONSUMER", { consumerId }, resolve));
}

async function createRecvTransport(): Promise<void> {
    if (!device) throw new Error("Device not loaded");

    const res = await createWebRtcTransport();
    if (!res.success || !res.transport) {
        throw new Error(res.error ?? "Failed to create transport");
    }

    const tp = res.transport;
    recvTransport = device.createRecvTransport({
        id: tp.id,
        iceParameters: tp.iceParameters,
        iceCandidates: tp.iceCandidates,
        dtlsParameters: tp.dtlsParameters,
        ...(res.iceServers ? { iceServers: res.iceServers } : {}),
    });

    recvTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
        try {
            const connectRes = await connectTransport(tp.id, dtlsParameters);
            if (!connectRes.success) throw new Error(connectRes.error);
            callback();
        } catch (err) {
            errback(err as Error);
        }
    });

    recvTransport.on("connectionstatechange", (state) => {
        if (state === "failed" || state === "closed") {
            setStatus("error", "Connection lost");
        }
    });
}

async function consumeProducer(producerId: string): Promise<MediaStreamTrack> {
    if (!recvTransport || !device) throw new Error("Recv transport not ready");

    const res = await consume(producerId, device.rtpCapabilities);
    if (!res.success || !res.consumer) {
        throw new Error(res.error ?? "Failed to consume");
    }

    const { id, kind, rtpParameters } = res.consumer;
    const consumer = await recvTransport.consume({
        id,
        producerId,
        kind: kind as msTypes.MediaKind,
        rtpParameters,
    });
    consumers.set(consumer.id, consumer);

    await resumeConsumer(consumer.id);
    return consumer.track;
}

async function authenticateAndWatch(instanceId: string): Promise<void> {
    setStatus("connecting");

    const authRes = await viewerAuthenticate(instanceId);
    if (!authRes.success) {
        throw new Error(authRes.error ?? "Failed to authenticate");
    }

    const watchRes = await watchScreenShare();
    if (!watchRes.success || !watchRes.rtpCapabilities || !watchRes.screenVideoProducerId) {
        throw new Error(watchRes.error ?? "This user is not currently sharing their screen");
    }

    screenVideoProducerId = watchRes.screenVideoProducerId;
    screenAudioProducerId = watchRes.screenAudioProducerId ?? null;

    device = new Device();
    await device.load({ routerRtpCapabilities: watchRes.rtpCapabilities });

    await createRecvTransport();

    const tracks: MediaStreamTrack[] = [await consumeProducer(watchRes.screenVideoProducerId)];
    if (watchRes.screenAudioProducerId) {
        tracks.push(await consumeProducer(watchRes.screenAudioProducerId));
    }

    videoEl.srcObject = new MediaStream(tracks);
    videoEl.play().catch(() => { });
    setStatus("watching");
}

function cleanup(): void {
    for (const consumer of consumers.values()) {
        consumer.close();
    }
    consumers.clear();
    recvTransport?.close();
    recvTransport = null;

    if (socket) {
        if (channelId) {
            socket.emit("STOP_WATCHING_SCREEN_SHARE", { channelId }, () => { });
        }
        socket.disconnect();
        socket = null;
    }
}

async function start(): Promise<void> {
    if (!targetUserId || !channelId || !serverBaseUrl) {
        setStatus("error", "Missing viewer window parameters");
        return;
    }

    const instanceId: string = await ipcRenderer.invoke("get-instance-id");

    socket = io(serverBaseUrl, {
        query: { instanceId, role: "viewer" },
        transports: ["websocket"],
    }) as TypedSocket;

    socket.on("connect", async () => {
        try {
            await authenticateAndWatch(instanceId);
        } catch (err: any) {
            setStatus("error", err?.message ?? "Failed to start watching");
        }
    });

    socket.on("connect_error", (err: Error) => {
        setStatus("error", err?.message ?? "Connection failed");
    });

    // Server emits this to the consuming socket when the underlying producer
    // closes (PRD 12.13) — e.g. the sharer stops sharing or disconnects.
    socket.on("PRODUCER_CLOSED", (payload) => {
        if (payload.producerId === screenVideoProducerId || payload.producerId === screenAudioProducerId) {
            setStatus("ended", "The screen share has ended");
        }
    });
}

window.addEventListener("beforeunload", cleanup);

contextBridge.exposeInMainWorld("reson8ViewerApi", {
    info: { nickname, targetUserId, channelId },

    onStatus(cb: (status: ViewerStatus, message?: string) => void): void {
        statusListeners.push(cb);
        cb(lastStatus.status, lastStatus.message);
    },

    setVolume(percent: number): void {
        videoEl.volume = Math.max(0, Math.min(1, percent / 100));
    },

    toggleMute(): boolean {
        videoEl.muted = !videoEl.muted;
        return videoEl.muted;
    },

    isMuted(): boolean {
        return videoEl.muted;
    },

    toggleFullscreen(): void {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => { });
        } else {
            videoEl.requestFullscreen().catch(() => { });
        }
    },
});

start();
