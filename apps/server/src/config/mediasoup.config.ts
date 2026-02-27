/**
 * mediasoup Configuration — Reson8
 *
 * Defines Worker, Router, and WebRtcTransport settings.
 * Audio-only Opus codec for voice channels.
 */

import type { types as mediasoupTypes } from "mediasoup";
import os from "node:os";

/** Number of mediasoup Workers to spawn (1 per CPU core). */
export const NUM_WORKERS = Math.max(1, os.cpus().length);

/** Worker settings. */
export const WORKER_SETTINGS: mediasoupTypes.WorkerSettings = {
    logLevel: "warn",
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
};

/**
 * Media codecs supported by the Router.
 * Audio-only: Opus at 48kHz, stereo, with DTX for bandwidth savings.
 */
export const MEDIA_CODECS = [
    {
        kind: "audio" as const,
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
        parameters: {
            "usedtx": 1,
            "useinbandfec": 1,
        },
    },
];

/**
 * WebRtcTransport options factory.
 * Uses MEDIASOUP_ANNOUNCED_IP env var for NAT traversal on VPS deployments.
 */
export function getTransportOptions(): mediasoupTypes.WebRtcTransportOptions {
    const announcedAddress = process.env.MEDIASOUP_ANNOUNCED_IP || "127.0.0.1";

    return {
        listenInfos: [
            {
                protocol: "udp" as const,
                ip: "0.0.0.0",
                announcedAddress,
            },
            {
                protocol: "tcp" as const,
                ip: "0.0.0.0",
                announcedAddress,
            },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
    };
}
