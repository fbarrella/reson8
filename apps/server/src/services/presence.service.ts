/**
 * Presence Service — Redis-backed presence tracking for Reson8.
 *
 * Tracks which users are online on a server and which channel
 * they currently occupy, using Redis SETs for O(1) membership checks.
 *
 * Key schema:
 *   presence:server:{serverId}    → SET of userIds
 *   presence:channel:{channelId}  → SET of userIds
 *   presence:user:{userId}        → HASH { serverId, channelId, nickname }
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
        pipe.hset(KEY.user(userId), "channelId", "");
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

    /** Returns the user's current presence metadata (serverId, channelId, nickname). */
    async getUserPresence(
        userId: string,
    ): Promise<{ serverId: string; channelId: string; nickname: string } | null> {
        const data = await this.redis.hgetall(KEY.user(userId));
        if (!data.serverId) return null;
        return {
            serverId: data.serverId,
            channelId: data.channelId ?? "",
            nickname: data.nickname ?? "Unknown",
        };
    }

    /** Refreshes the TTL of a user's presence hash (call on heartbeat). */
    async heartbeat(userId: string): Promise<void> {
        await this.redis.expire(KEY.user(userId), USER_TTL);
    }
}
