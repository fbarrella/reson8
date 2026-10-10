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
import { buildOccupant } from "./connection.handler.js";
import { getUserPermissions, isAdmin } from "../services/permissions.service.js";
import { executeBan } from "../services/ban.service.js";
import { maskCidr, reloadAddressBans } from "../services/address-ban.service.js";

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
                    occupantIds.map((uid) => buildOccupant(uid, presence, app.prisma)),
                );

                // Notify all remaining channel occupants that a user was kicked
                // (so they can suppress the presence-based leave sound)
                io.to(`channel:${channelId}`).emit("CHANNEL_USER_KICKED", {
                    channelId,
                    userId,
                });

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
                if (typeof userId !== "string" || userId.length === 0 || userId.length > 128) {
                    ack({ success: false, error: "Invalid user" });
                    return;
                }

                // PRD 18.7: an optional address/range ban alongside the user ban.
                let scope: "none" | "exact" | "range" = "none";
                if (payload.addressBan !== undefined) {
                    if (payload.addressBan !== "none" && payload.addressBan !== "exact" && payload.addressBan !== "range") {
                        ack({ success: false, error: "Invalid address ban option" });
                        return;
                    }
                    scope = payload.addressBan;
                }

                // Prevent self-ban
                if (userId === socket.data.userId) {
                    ack({ success: false, error: "Cannot ban yourself" });
                    return;
                }

                // Resolve nickname for the ban record
                const userRecord = await app.prisma.user.findUnique({
                    where: { id: userId },
                    select: { nickname: true, lastAddress: true },
                });

                // The ban, the disconnect and the optional address part live in
                // ban.service.ts (shared with "Reject and ban", PRD 18.8).
                const { warning, addressBanned } = await executeBan({
                    app,
                    io,
                    serverId,
                    actor: {
                        userId: socket.data.userId,
                        socketId: socket.id,
                        address: socket.data.clientAddress,
                    },
                    userId,
                    nickname: userRecord?.nickname ?? null,
                    fallbackAddress: userRecord?.lastAddress,
                    scope,
                });

                ack({ success: true, ...(warning ? { warning } : {}), ...(addressBanned ? { addressBanned } : {}) });
                app.log.info(
                    { adminId: socket.data.userId, bannedUserId: userId, serverId, addressBanned, warning },
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
                // Lifting a user's ban lifts the address ban made together with it (PRD 18.7).
                const lifted = await app.prisma.bannedAddress.deleteMany({
                    where: { serverId, linkedUserId: userId },
                });
                if (lifted.count > 0) await reloadAddressBans(app.prisma, serverId);

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

        // ── GET_BANNED_ADDRESSES (PRD 18.7) ──────────────────────────────
        // Addresses are personal data: only an ADMIN sees them in full.
        socket.on("GET_BANNED_ADDRESSES", async (ack) => {
            if (typeof ack !== "function") return;
            try {
                const allowed = await requirePermission(app, socket, BigInt(PermissionFlags.BAN_USER));
                if (!allowed) {
                    ack({ success: false, error: "Permission denied" });
                    return;
                }
                const serverId = socket.data.serverId;
                const perms = await getUserPermissions(app.prisma, socket.data.userId, serverId);
                const full = isAdmin(perms);
                const rows = await app.prisma.bannedAddress.findMany({
                    where: { serverId },
                    orderBy: { createdAt: "desc" },
                });
                ack({
                    success: true,
                    addresses: rows.map((r) => ({
                        id: r.id,
                        cidr: full ? r.cidr : maskCidr(r.cidr),
                        nickname: r.nickname,
                        linkedUserId: r.linkedUserId,
                        createdAt: r.createdAt.toISOString(),
                    })),
                });
            } catch (err) {
                app.log.error({ err }, "Error in GET_BANNED_ADDRESSES");
                ack({ success: false, error: "Failed to fetch banned addresses" });
            }
        });

        // ── UNBAN_ADDRESS (PRD 18.7) ─────────────────────────────────────
        socket.on("UNBAN_ADDRESS", async (payload, ack) => {
            if (typeof ack !== "function") return;
            try {
                const allowed = await requirePermission(app, socket, BigInt(PermissionFlags.BAN_USER));
                if (!allowed) {
                    ack({ success: false, error: "Permission denied" });
                    return;
                }
                const id = payload?.id;
                if (typeof id !== "string" || id.length === 0 || id.length > 64) {
                    ack({ success: false, error: "Invalid address ban" });
                    return;
                }
                const serverId = socket.data.serverId;
                const result = await app.prisma.bannedAddress.deleteMany({ where: { id, serverId } });
                if (result.count === 0) {
                    ack({ success: false, error: "That address ban no longer exists" });
                    return;
                }
                await reloadAddressBans(app.prisma, serverId);
                ack({ success: true });
                app.log.info({ adminId: socket.data.userId, addressBanId: id, serverId }, "Address ban lifted");
            } catch (err) {
                app.log.error({ err }, "Error in UNBAN_ADDRESS");
                ack({ success: false, error: "Failed to lift the address ban" });
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
