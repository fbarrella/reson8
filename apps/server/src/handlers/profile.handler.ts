/**
 * Profile Handler — user profile data (PRD 17.1, 17.3).
 *
 * Handles: SET_AVATAR (the avatar is also refreshed on every USER_JOIN_SERVER,
 * connection.handler.ts; this event covers a change made while connected) and
 * GET_USER_PROFILE (the profile card).
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
} from "@reson8/shared-types";
import { AVATAR_UPDATE_COOLDOWN_MS, buildAvatarUrl, parseAvatarSelection } from "../services/avatar.service.js";
import { PresenceService } from "../services/presence.service.js";
import { isPlausibleUserId, toUserProfile } from "../services/profile.service.js";

type TypedIO = SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/** userId → time of the last accepted SET_AVATAR (in memory, like the nudge cooldown). */
const lastAvatarUpdateAt = new Map<string, number>();

export function registerProfileHandlers(io: TypedIO, app: FastifyInstance): void {
    const presence = new PresenceService(app.redis);

    io.on("connection", (socket: TypedSocket) => {
        socket.on("SET_AVATAR", async (payload, ack) => {
            try {
                // Viewer sockets never change profile data, and a primary
                // socket has no identity until it has joined a server.
                const { userId, serverId } = socket.data;
                if (socket.data.role === "viewer" || !userId || !serverId) {
                    ack({ success: false, error: "Not connected to a server" });
                    return;
                }

                const parsed = parseAvatarSelection(payload?.avatar);
                if (!parsed.ok) {
                    ack({ success: false, error: parsed.error });
                    return;
                }

                const now = Date.now();
                const last = lastAvatarUpdateAt.get(userId);
                if (last !== undefined && now - last < AVATAR_UPDATE_COOLDOWN_MS) {
                    ack({ success: false, error: "You're changing your avatar too quickly — try again in a moment" });
                    return;
                }
                lastAvatarUpdateAt.set(userId, now);

                const avatarUrl = buildAvatarUrl(parsed.value);
                const before = await app.prisma.user.findUnique({ where: { id: userId }, select: { avatarUrl: true } });
                if (!before) {
                    ack({ success: false, error: "User not found" });
                    return;
                }

                if (before.avatarUrl !== avatarUrl) {
                    await app.prisma.user.update({ where: { id: userId }, data: { avatarUrl } });
                    io.to(`server:${serverId}`).emit("USER_AVATAR_UPDATED", { userId, avatarUrl });
                }
                ack({ success: true, avatarUrl });
            } catch (err) {
                app.log.error({ err }, "Error in SET_AVATAR");
                ack({ success: false, error: "Failed to update avatar" });
            }
        });

        // The profile card (PRD 17.3). No permission flag: everything on it is
        // already visible to members (roles shape what people can do; online
        // status is in the Online Users list). Presence comes from Redis.
        socket.on("GET_USER_PROFILE", async (payload, ack) => {
            try {
                const { serverId } = socket.data;
                if (socket.data.role === "viewer" || !socket.data.userId || !serverId) {
                    ack({ success: false, error: "Not connected to a server" });
                    return;
                }
                const userId = payload?.userId;
                if (!isPlausibleUserId(userId)) {
                    ack({ success: false, error: "User not found" });
                    return;
                }

                const [row, onlineIds] = await Promise.all([
                    app.prisma.user.findUnique({
                        where: { id: userId },
                        select: {
                            id: true,
                            nickname: true,
                            avatarUrl: true,
                            createdAt: true,
                            roles: {
                                where: { role: { serverId } },
                                select: {
                                    role: {
                                        select: { id: true, serverId: true, name: true, color: true, powerLevel: true },
                                    },
                                },
                            },
                        },
                    }),
                    presence.getOnlineUsers(serverId),
                ]);
                if (!row) {
                    ack({ success: false, error: "User not found" });
                    return;
                }
                ack({ success: true, profile: toUserProfile(row, serverId, onlineIds.includes(userId)) });
            } catch (err) {
                app.log.error({ err }, "Error in GET_USER_PROFILE");
                ack({ success: false, error: "Failed to load profile" });
            }
        });
    });
}
