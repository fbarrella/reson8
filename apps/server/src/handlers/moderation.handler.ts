/**
 * Moderation Handler — Kick and Ban management for Reson8.
 *
 * Handles: KICK_USER, BAN_USER, UNBAN_USER, GET_BANNED_USERS.
 * All events require ADMIN-level permissions.
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
    IUserPresence,
} from "@reson8/shared-types";
import { PermissionFlags } from "@reson8/shared-types";
import { PresenceService } from "../services/presence.service.js";
import { requirePermission } from "../middleware/permissions.middleware.js";
import type { MediasoupService } from "../services/mediasoup.service.js";

type TypedIO = SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>;

type TypedSocket = Socket<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>;

export function registerModerationHandlers(
    io: TypedIO,
    app: FastifyInstance,
    mediasoup: MediasoupService,
): void {
    const presence = new PresenceService(app.redis);

    io.on("connection", (socket: TypedSocket) => {

        // ── KICK_USER ────────────────────────────────────────────────────
        socket.on("KICK_USER", async (payload, ack) => {
            try {
                const allowed = await requirePermission(
                    app,
                    socket,
                    BigInt(PermissionFlags.KICK_USER),
                );
                if (!allowed) {
                    ack({ success: false, error: "Permission denied" });
                    return;
                }

                const { userId, channelId } = payload;
                const serverId = socket.data.serverId;

                // Find the target user's socket(s)
                for (const [, s] of io.sockets.sockets) {
                    if (
                        s.data.userId === userId &&
                        s.data.serverId === serverId &&
                        s.data.currentChannelId === channelId
                    ) {
                        // Clean up mediasoup voice session
                        const producerId = mediasoup.getSession(channelId, userId)?.producer?.id;
                        if (producerId) {
                            s.to(`channel:${channelId}`).emit("PRODUCER_CLOSED", {
                                userId,
                                producerId,
                            });
                        }
                        mediasoup.cleanupUserSession(channelId, userId);

                        // Leave channel presence + room
                        await presence.leaveChannel(userId, channelId);
                        await s.leave(`channel:${channelId}`);
                        s.data.currentChannelId = null;

                        // Notify the kicked user
                        s.emit("USER_KICKED", { channelId });
                    }
                }

                // Broadcast updated occupants for the channel
                const occupantIds = await presence.getChannelOccupants(channelId);
                const occupants: IUserPresence[] = await Promise.all(
                    occupantIds.map(async (uid) => {
                        const p = await presence.getUserPresence(uid);
                        return {
                            userId: uid,
                            nickname: p?.nickname ?? "Unknown",
                            isMuted: false,
                            isDeafened: false,
                            isAway: false,
                        };
                    }),
                );

                io.to(`server:${serverId}`).emit("PRESENCE_UPDATE", {
                    channelId,
                    occupants,
                });

                ack({ success: true });
                app.log.info(
                    { adminId: socket.data.userId, kickedUserId: userId, channelId },
                    "User kicked from channel",
                );
            } catch (err) {
                app.log.error({ err }, "Error in KICK_USER");
                ack({ success: false, error: "Failed to kick user" });
            }
        });

        // ── BAN_USER ─────────────────────────────────────────────────────
        socket.on("BAN_USER", async (payload, ack) => {
            try {
                const allowed = await requirePermission(
                    app,
                    socket,
                    BigInt(PermissionFlags.BAN_USER),
                );
                if (!allowed) {
                    ack({ success: false, error: "Permission denied" });
                    return;
                }

                const { userId } = payload;
                const serverId = socket.data.serverId;

                // Prevent self-ban
                if (userId === socket.data.userId) {
                    ack({ success: false, error: "Cannot ban yourself" });
                    return;
                }

                // Resolve nickname for the ban record
                const userRecord = await app.prisma.user.findUnique({
                    where: { id: userId },
                    select: { nickname: true },
                });

                // Create ban record
                await app.prisma.bannedUser.upsert({
                    where: {
                        serverId_userId: { serverId, userId },
                    },
                    update: {},
                    create: {
                        serverId,
                        userId,
                        nickname: userRecord?.nickname ?? "Unknown",
                    },
                });

                // Find and disconnect the banned user's socket(s)
                for (const [, s] of io.sockets.sockets) {
                    if (s.data.userId === userId && s.data.serverId === serverId) {
                        s.emit("USER_BANNED", {});
                        s.disconnect(true);
                    }
                }

                ack({ success: true });
                app.log.info(
                    { adminId: socket.data.userId, bannedUserId: userId, serverId },
                    "User banned from server",
                );
            } catch (err) {
                app.log.error({ err }, "Error in BAN_USER");
                ack({ success: false, error: "Failed to ban user" });
            }
        });

        // ── UNBAN_USER ───────────────────────────────────────────────────
        socket.on("UNBAN_USER", async (payload, ack) => {
            try {
                const allowed = await requirePermission(
                    app,
                    socket,
                    BigInt(PermissionFlags.BAN_USER),
                );
                if (!allowed) {
                    ack({ success: false, error: "Permission denied" });
                    return;
                }

                const { userId } = payload;
                const serverId = socket.data.serverId;

                await app.prisma.bannedUser.deleteMany({
                    where: { serverId, userId },
                });

                ack({ success: true });
                app.log.info(
                    { adminId: socket.data.userId, unbannedUserId: userId, serverId },
                    "User unbanned from server",
                );
            } catch (err) {
                app.log.error({ err }, "Error in UNBAN_USER");
                ack({ success: false, error: "Failed to unban user" });
            }
        });

        // ── GET_BANNED_USERS ─────────────────────────────────────────────
        socket.on("GET_BANNED_USERS", async (ack) => {
            try {
                const allowed = await requirePermission(
                    app,
                    socket,
                    BigInt(PermissionFlags.BAN_USER),
                );
                if (!allowed) {
                    ack({ success: false, error: "Permission denied" });
                    return;
                }

                const serverId = socket.data.serverId;

                const banned = await app.prisma.bannedUser.findMany({
                    where: { serverId },
                    orderBy: { bannedAt: "desc" },
                });

                const users = banned.map((b: { userId: string; nickname: string; bannedAt: Date }) => ({
                    userId: b.userId,
                    nickname: b.nickname,
                    bannedAt: b.bannedAt.toISOString(),
                }));

                ack({ success: true, users });
            } catch (err) {
                app.log.error({ err }, "Error in GET_BANNED_USERS");
                ack({ success: false, error: "Failed to fetch banned users" });
            }
        });
    });
}
