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
    const publicIp = process.env.MEDIASOUP_ANNOUNCED_IP || "127.0.0.1";
    const privateIp = process.env.MEDIASOUP_PRIVATE_ANNOUNCED_IP;

    const listenInfos: mediasoupTypes.TransportListenInfo[] = [
        {
            protocol: "udp" as const,
            ip: "0.0.0.0",
            announcedAddress: publicIp,
        },
        {
            protocol: "tcp" as const,
            ip: "0.0.0.0",
            announcedAddress: publicIp,
        },
    ];

    if (privateIp) {
        listenInfos.push({
            protocol: "udp" as const,
            ip: "0.0.0.0",
            announcedAddress: privateIp,
        });
        listenInfos.push({
            protocol: "tcp" as const,
            ip: "0.0.0.0",
            announcedAddress: privateIp,
        });
    }

    return {
        listenInfos,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
    };
}
