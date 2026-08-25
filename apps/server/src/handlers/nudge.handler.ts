/**
 * Nudge Handler — attention-grabbing pings between online users, plus the
 * server-wide setting that gates the feature.
 *
 * Handles: NUDGE_USER, GET_SERVER_SETTINGS, UPDATE_SERVER_SETTINGS.
 *
 * The 30-second cooldown is tracked in memory, keyed per (sender, target)
 * pair — nudging one person doesn't throttle nudging someone else. This is
 * an intentionally ephemeral rate limit (resets on server restart); the
 * alternative (persisting it) would cost a DB/Redis round trip for a
 * purely advisory, low-stakes limit.
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
} from "@reson8/shared-types";
import { PermissionFlags } from "@reson8/shared-types";
import { requirePermission } from "../middleware/permissions.middleware.js";
import { PresenceService } from "../services/presence.service.js";
import {
    DEFAULT_MAX_MESSAGE_LENGTH,
    MIN_MAX_MESSAGE_LENGTH,
    MAX_MAX_MESSAGE_LENGTH,
} from "../config/message.config.js";
import { SERVER_VERSION } from "../config/version.config.js";

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

const NUDGE_COOLDOWN_MS = 30 * 1000;

/** In-memory per-(sender, target) cooldown tracker: "senderId:targetId" → last nudge timestamp. */
const lastNudgeAt = new Map<string, number>();

export function registerNudgeHandlers(
    io: TypedIO,
    app: FastifyInstance,
): void {
    const presence = new PresenceService(app.redis);

    io.on("connection", (socket: TypedSocket) => {
        // ── GET_SERVER_SETTINGS ─────────────────────────────────────────────
        socket.on("GET_SERVER_SETTINGS", async (ack) => {
            try {
                const server = await app.prisma.server.findUnique({
                    where: { id: socket.data.serverId },
                    select: {
                        name: true,
                        nudgeEnabled: true,
                        screenShareEnabled: true,
                        maxMessageLength: true,
                    },
                });
                ack({
                    success: true,
                    nudgeEnabled: server?.nudgeEnabled ?? true,
                    screenShareEnabled: server?.screenShareEnabled ?? true,
                    name: server?.name,
                    maxMessageLength: server?.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH,
                    version: SERVER_VERSION,
                });
            } catch (err) {
                app.log.error({ err }, "Error in GET_SERVER_SETTINGS");
                ack({ success: false });
            }
        });

        // ── UPDATE_SERVER_SETTINGS ──────────────────────────────────────────
        // Each field in the payload is optional (PRD 12.14) — a toggle only
        // sends the one setting it changed, so `data` below is built from
        // whichever fields are actually present rather than always writing
        // both (which would silently reset the other to whatever the caller
        // happened to have loaded, on a stale client).
        socket.on("UPDATE_SERVER_SETTINGS", async (payload, ack) => {
            try {
                const allowed = await requirePermission(
                    app, socket, BigInt(PermissionFlags.ADMIN),
                );
                if (!allowed) {
                    ack({ success: false, error: "Permission denied" });
                    return;
                }

                const { nudgeEnabled, screenShareEnabled, maxMessageLength } = payload;
                const data: { nudgeEnabled?: boolean; screenShareEnabled?: boolean; maxMessageLength?: number } = {};
                if (nudgeEnabled !== undefined) data.nudgeEnabled = nudgeEnabled;
                if (screenShareEnabled !== undefined) data.screenShareEnabled = screenShareEnabled;
                if (maxMessageLength !== undefined) {
                    // Bounded, not just "must be a positive integer" — an
                    // admin fat-fingering an astronomically large value
                    // would silently defeat the whole point of this setting.
                    if (
                        !Number.isInteger(maxMessageLength) ||
                        maxMessageLength < MIN_MAX_MESSAGE_LENGTH ||
                        maxMessageLength > MAX_MAX_MESSAGE_LENGTH
                    ) {
                        ack({
                            success: false,
                            error: `Message length limit must be between ${MIN_MAX_MESSAGE_LENGTH} and ${MAX_MAX_MESSAGE_LENGTH}`,
                        });
                        return;
                    }
                    data.maxMessageLength = maxMessageLength;
                }

                const updated = await app.prisma.server.update({
                    where: { id: socket.data.serverId },
                    data,
                    select: { nudgeEnabled: true, screenShareEnabled: true, maxMessageLength: true },
                });

                ack({ success: true });

                io.to(`server:${socket.data.serverId}`).emit("SERVER_SETTINGS_UPDATED", {
                    nudgeEnabled: updated.nudgeEnabled,
                    screenShareEnabled: updated.screenShareEnabled,
                    maxMessageLength: updated.maxMessageLength,
                });

                app.log.info(
                    { socketId: socket.id, ...data },
                    "Server settings updated",
                );
            } catch (err) {
                app.log.error({ err }, "Error in UPDATE_SERVER_SETTINGS");
                ack({ success: false, error: "Failed to update settings" });
            }
        });

        // ── NUDGE_USER ───────────────────────────────────────────────────────
        socket.on("NUDGE_USER", async (payload, ack) => {
            try {
                const { targetUserId } = payload;
                const senderId = socket.data.userId;
                const serverId = socket.data.serverId;

                if (targetUserId === senderId) {
                    ack({ success: false, error: "You cannot nudge yourself" });
                    return;
                }

                const server = await app.prisma.server.findUnique({
                    where: { id: serverId },
                    select: { nudgeEnabled: true },
                });
                if (!server?.nudgeEnabled) {
                    ack({ success: false, error: "Nudging is disabled on this server" });
                    return;
                }

                const onlineIds = await presence.getOnlineUsers(serverId);
                if (!onlineIds.includes(targetUserId)) {
                    ack({ success: false, error: "That user is not online" });
                    return;
                }

                const cooldownKey = `${senderId}:${targetUserId}`;
                const last = lastNudgeAt.get(cooldownKey);
                const now = Date.now();
                if (last && now - last < NUDGE_COOLDOWN_MS) {
                    const remainingSec = Math.ceil((NUDGE_COOLDOWN_MS - (now - last)) / 1000);
                    ack({ success: false, error: `Wait ${remainingSec}s before nudging this user again` });
                    return;
                }
                lastNudgeAt.set(cooldownKey, now);

                for (const [, s] of io.sockets.sockets) {
                    if (s.data.userId === targetUserId && s.data.serverId === serverId) {
                        s.emit("NUDGE_RECEIVED", {
                            fromUserId: senderId,
                            fromNickname: socket.data.nickname,
                        });
                    }
                }

                ack({ success: true });

                app.log.info(
                    { socketId: socket.id, targetUserId },
                    "User nudged",
                );
            } catch (err) {
                app.log.error({ err }, "Error in NUDGE_USER");
                ack({ success: false, error: "Failed to nudge user" });
            }
        });
    });
}
