/**
 * Presence Service — Redis-backed presence tracking for Reson8.
 *
 * Tracks which users are online on a server and which channel
 * they currently occupy, using Redis SETs for O(1) membership checks.
 *
 * Key schema:
 *   presence:server:{serverId}    → SET of userIds
 *   presence:channel:{channelId}  → SET of userIds
 *   presence:user:{userId}        → HASH { serverId, channelId, nickname, isMuted, isDeafened, isSharingScreen }
 */

import type { Redis } from "ioredis";

/** Prefix constants to keep key construction DRY. */
const KEY = {
    server: (id: string) => `presence:server:${id}`,
    channel: (id: string) => `presence:channel:${id}`,
    user: (id: string) => `presence:user:${id}`,
} as const;

/** TTL for user presence hashes (seconds). Safety net for zombie sessions. */
const USER_TTL = 60 * 60; // 1 hour

export class PresenceService {
    constructor(private readonly redis: Redis) { }

    // ── Server-level presence ──────────────────────────────────────────────

    /**
     * Registers a user as online on a server.
     * Uses a pipeline for atomicity.
     */
    async joinServer(
        userId: string,
        serverId: string,
        nickname: string,
    ): Promise<void> {
        const pipe = this.redis.pipeline();
        pipe.sadd(KEY.server(serverId), userId);
        pipe.hset(KEY.user(userId), { serverId, nickname, channelId: "" });
        pipe.expire(KEY.user(userId), USER_TTL);
        await pipe.exec();
    }

    /** Removes a user from a server and cleans up their presence hash. */
    async leaveServer(userId: string, serverId: string): Promise<void> {
        // First, leave any channel they're in
        const channelId = await this.redis.hget(KEY.user(userId), "channelId");
        const pipe = this.redis.pipeline();

        if (channelId) {
            pipe.srem(KEY.channel(channelId), userId);
        }

        pipe.srem(KEY.server(serverId), userId);
        pipe.del(KEY.user(userId));
        await pipe.exec();
    }

    // ── Channel-level presence ─────────────────────────────────────────────

    /** Moves a user into a channel, clearing their previous channel first. */
    async joinChannel(userId: string, channelId: string): Promise<void> {
        // Leave previous channel if any
        const prevChannelId = await this.redis.hget(KEY.user(userId), "channelId");

        const pipe = this.redis.pipeline();

        if (prevChannelId) {
            pipe.srem(KEY.channel(prevChannelId), userId);
        }

        pipe.sadd(KEY.channel(channelId), userId);
        pipe.hset(KEY.user(userId), "channelId", channelId);
        pipe.expire(KEY.user(userId), USER_TTL); // refresh TTL
        await pipe.exec();
    }

    /** Removes a user from a specific channel. */
    async leaveChannel(userId: string, channelId: string): Promise<void> {
        const pipe = this.redis.pipeline();
        pipe.srem(KEY.channel(channelId), userId);
        // Also clears isSharingScreen (PRD 12.12) — otherwise a stale "1"
        // would incorrectly show the sharing badge if this user later joins
        // a different voice channel without having cleanly stopped a share
        // (e.g. an ungraceful disconnect mid-share).
        pipe.hset(KEY.user(userId), { channelId: "", isSharingScreen: "0" });
        await pipe.exec();
    }

    // ── Queries ────────────────────────────────────────────────────────────

    /** Returns the set of userIds currently online on a server. */
    async getOnlineUsers(serverId: string): Promise<string[]> {
        return this.redis.smembers(KEY.server(serverId));
    }

    /** Returns the set of userIds currently in a channel. */
    async getChannelOccupants(channelId: string): Promise<string[]> {
        return this.redis.smembers(KEY.channel(channelId));
    }

    /** Returns the user's current presence metadata (serverId, channelId, nickname, voice state). */
    async getUserPresence(
        userId: string,
    ): Promise<{
        serverId: string;
        channelId: string;
        nickname: string;
        isMuted: boolean;
        isDeafened: boolean;
        isSharingScreen: boolean;
    } | null> {
        const data = await this.redis.hgetall(KEY.user(userId));
        if (!data.serverId) return null;
        return {
            serverId: data.serverId,
            channelId: data.channelId ?? "",
            nickname: data.nickname ?? "Unknown",
            isMuted: data.isMuted === "1",
            isDeafened: data.isDeafened === "1",
            isSharingScreen: data.isSharingScreen === "1",
        };
    }

    /** Records a user's self-reported mute/deafen state (for display to other occupants). */
    async setVoiceState(
        userId: string,
        isMuted: boolean,
        isDeafened: boolean,
    ): Promise<void> {
        const pipe = this.redis.pipeline();
        pipe.hset(KEY.user(userId), {
            isMuted: isMuted ? "1" : "0",
            isDeafened: isDeafened ? "1" : "0",
        });
        pipe.expire(KEY.user(userId), USER_TTL);
        await pipe.exec();
    }

    /** Records whether a user currently has an active screen share (PRD 12.12), for the sharing badge. */
    async setScreenShareState(
        userId: string,
        isSharingScreen: boolean,
    ): Promise<void> {
        const pipe = this.redis.pipeline();
        pipe.hset(KEY.user(userId), {
            isSharingScreen: isSharingScreen ? "1" : "0",
        });
        pipe.expire(KEY.user(userId), USER_TTL);
        await pipe.exec();
    }

    /** Refreshes the TTL of a user's presence hash (call on heartbeat). */
    async heartbeat(userId: string): Promise<void> {
        await this.redis.expire(KEY.user(userId), USER_TTL);
    }
}
