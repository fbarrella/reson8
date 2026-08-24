/**
 * mediasoup Configuration — Reson8
 *
 * Defines Worker, Router, and WebRtcTransport settings.
 * Opus for voice channels; VP9 (with SVC) for screen sharing (PRD 12.8).
 */

import type { types as mediasoupTypes } from "mediasoup";
import os from "node:os";
import dns from "node:dns/promises";
import net from "node:net";

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
 * - Opus at 48kHz, stereo, with DTX for bandwidth savings (voice + screen-
 *   share audio — both are plain Opus Producers, just tagged apart via
 *   `appData.mediaType`, see PRD 12.7/12.12).
 * - VP9 for screen-share video (PRD 12.8), with `profile-id: 2` enabling
 *   SVC (Scalable Video Coding): one encode, multiple spatial/temporal
 *   layers, so each viewer's Consumer can independently request a lower
 *   layer via `setPreferredLayers()` (PRD 12.13) without the sharer
 *   re-encoding. VP9 over AV1 for now — mediasoup/libwebrtc's VP9 SVC
 *   support is mature; AV1 SVC is newer and less consistently available
 *   across Electron's bundled Chromium versions.
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
    {
        kind: "video" as const,
        mimeType: "video/VP9",
        clockRate: 90000,
        parameters: {
            "profile-id": 2,
        },
    },
];

/**
 * Resolves a hostname or IP string to an IPv4 address.
 * If the input is already an IP address (v4 or v6), returns it unchanged.
 * If it's a domain name, resolves it via DNS lookup.
 * This is called on every transport creation so dynamic IPs stay fresh.
 */
async function resolveToIp(address: string): Promise<string> {
    if (net.isIP(address)) return address;

    const { address: resolved } = await dns.lookup(address, { family: 4 });
    console.log(`[mediasoup] Resolved "${address}" → ${resolved}`);
    return resolved;
}

/**
 * WebRtcTransport options factory (async — resolves DNS on each call).
 * Uses MEDIASOUP_ANNOUNCED_IP for the public/primary IP and optionally
 * MEDIASOUP_PRIVATE_ANNOUNCED_IP for a LAN/private IP to solve hairpin NAT.
 * When both are set, ICE candidates are generated for both IPs and WebRTC
 * connectivity checks automatically select whichever is reachable.
 *
 * Domain names are automatically resolved to IP addresses so that ICE
 * candidates always contain IPs (required by most WebRTC implementations).
 * Resolution happens on each transport creation to support dynamic IPs (DDNS).
 */
export async function getTransportOptions(): Promise<mediasoupTypes.WebRtcTransportOptions> {
    const rawAddress = process.env.MEDIASOUP_ANNOUNCED_IP || "127.0.0.1";
    const rawPrivateAddress = process.env.MEDIASOUP_PRIVATE_ANNOUNCED_IP;

    const announcedAddress = await resolveToIp(rawAddress);

    const listenInfos: mediasoupTypes.TransportListenInfo[] = [
        { protocol: "udp" as const, ip: "0.0.0.0", announcedAddress },
        { protocol: "tcp" as const, ip: "0.0.0.0", announcedAddress },
    ];

    // Add private/LAN ICE candidates for hairpin NAT scenarios
    if (rawPrivateAddress) {
        const privateAnnouncedAddress = await resolveToIp(rawPrivateAddress);
        listenInfos.push(
            { protocol: "udp" as const, ip: "0.0.0.0", announcedAddress: privateAnnouncedAddress },
            { protocol: "tcp" as const, ip: "0.0.0.0", announcedAddress: privateAnnouncedAddress },
        );
    }

    return {
        listenInfos,
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
    };
}
