/**
 * Message Handler — Socket.io events for text chat.
 *
 * Handles: SEND_MESSAGE, FETCH_MESSAGES.
 * Messages are persisted in PostgreSQL and broadcast in real-time
 * to all clients in the same channel room.
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
    IMessage,
} from "@reson8/shared-types";
import { PermissionFlags } from "@reson8/shared-types";
import { requirePermission } from "../middleware/permissions.middleware.js";

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

/**
 * Registers message-related handlers on each socket connection.
 */
export function registerMessageHandlers(
    io: TypedIO,
    app: FastifyInstance,
): void {
    io.on("connection", (socket: TypedSocket) => {
        // ── SEND_MESSAGE ───────────────────────────────────────────────────
        socket.on("SEND_MESSAGE", async (payload, ack) => {
            try {
                const { channelId, content } = payload;

                if (!content || content.trim().length === 0) {
                    ack({ success: false });
                    return;
                }

                // Permission check
                const allowed = await requirePermission(
                    app,
                    socket,
                    BigInt(PermissionFlags.SEND_MESSAGES),
                );
                if (!allowed) {
                    ack({ success: false });
                    return;
                }

                // Verify channel exists
                const channel = await app.prisma.channel.findUnique({
                    where: { id: channelId },
                });
                if (!channel) {
                    ack({ success: false });
                    return;
                }

                // Persist message
                const message = await app.prisma.message.create({
                    data: {
                        channelId,
                        userId: socket.data.userId,
                        content: content.trim(),
                    },
                });

                const messageDto: IMessage = {
                    id: message.id,
                    channelId: message.channelId,
                    userId: message.userId,
                    nickname: socket.data.nickname,
                    content: message.content,
                    createdAt: message.createdAt.toISOString(),
                };

                // Broadcast to all clients in the server
                // (they may have the channel's tab open)
                io.to(`server:${socket.data.serverId}`).emit(
                    "MESSAGE_RECEIVED",
                    messageDto,
                );

                ack({ success: true, messageId: message.id });

                app.log.info(
                    { socketId: socket.id, channelId, messageId: message.id },
                    "Message sent",
                );
            } catch (err) {
                app.log.error({ err }, "Error in SEND_MESSAGE");
                ack({ success: false });
            }
        });

        // ── FETCH_MESSAGES ─────────────────────────────────────────────────
        socket.on("FETCH_MESSAGES", async (payload, ack) => {
            try {
                const { channelId, before, limit = 50 } = payload;
                const take = Math.min(limit, 100); // cap at 100

                const where: any = { channelId };
                if (before) {
                    where.createdAt = { lt: new Date(before) };
                }

                const messages = await app.prisma.message.findMany({
                    where,
                    orderBy: { createdAt: "desc" },
                    take,
                    include: {
                        user: { select: { nickname: true } },
                    },
                });

                // Convert to DTOs in chronological order
                const dtos: IMessage[] = messages
                    .reverse()
                    .map((m) => ({
                        id: m.id,
                        channelId: m.channelId,
                        userId: m.userId,
                        nickname: m.user.nickname,
                        content: m.content,
                        createdAt: m.createdAt.toISOString(),
                    }));

                ack({ success: true, messages: dtos });
            } catch (err) {
                app.log.error({ err }, "Error in FETCH_MESSAGES");
                ack({ success: false, error: "Failed to fetch messages" });
            }
        });
    });
}
