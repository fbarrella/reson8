/**
 * Profile Handler — a user's own profile data (PRD 17.1).
 *
 * Handles: SET_AVATAR. The avatar is also refreshed on every USER_JOIN_SERVER
 * (connection.handler.ts); this event covers a change made while connected.
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

type TypedIO = SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/** userId → time of the last accepted SET_AVATAR (in memory, like the nudge cooldown). */
const lastAvatarUpdateAt = new Map<string, number>();

export function registerProfileHandlers(io: TypedIO, app: FastifyInstance): void {
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
    });
}
