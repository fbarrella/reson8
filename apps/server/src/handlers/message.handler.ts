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
import { deleteAttachment } from "../services/storage.service.js";

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
                const { channelId, content, attachmentUrl, attachmentPublicId } = payload;

                if ((!content || content.trim().length === 0) && !attachmentUrl) {
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
                        content: content?.trim() ?? "",
                        attachmentUrl: attachmentUrl ?? null,
                        attachmentPublicId: attachmentPublicId ?? null,
                    },
                });

                const messageDto: IMessage = {
                    id: message.id,
                    channelId: message.channelId,
                    userId: message.userId,
                    nickname: socket.data.nickname,
                    content: message.content,
                    attachmentUrl: message.attachmentUrl,
                    createdAt: message.createdAt.toISOString(),
                    editedAt: null,
                };

                // Advance the sender's own read cursor so their own message
                // never shows up as "unread" for them on reconnect
                await app.prisma.channelRead.upsert({
                    where: { userId_channelId: { userId: socket.data.userId, channelId } },
                    update: { lastReadAt: message.createdAt },
                    create: { userId: socket.data.userId, channelId, lastReadAt: message.createdAt },
                });

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
                        reactions: { select: { emoji: true, userId: true }, orderBy: { createdAt: "asc" } },
                    },
                });

                // Convert to DTOs in chronological order
                const dtos: IMessage[] = messages
                    .reverse()
                    .map((m) => {
                        // Aggregate reactions by emoji
                        const rMap = new Map<string, string[]>();
                        for (const r of m.reactions) {
                            let list = rMap.get(r.emoji);
                            if (!list) { list = []; rMap.set(r.emoji, list); }
                            list.push(r.userId);
                        }
                        const reactions = Array.from(rMap.entries()).map(([emoji, userIds]) => ({
                            emoji, count: userIds.length, userIds,
                        }));

                        return {
                            id: m.id,
                            channelId: m.channelId,
                            userId: m.userId,
                            nickname: m.user.nickname,
                            content: m.content,
                            attachmentUrl: m.attachmentUrl,
                            createdAt: m.createdAt.toISOString(),
                            editedAt: m.editedAt?.toISOString() ?? null,
                            reactions,
                        };
                    });

                ack({ success: true, messages: dtos });
            } catch (err) {
                app.log.error({ err }, "Error in FETCH_MESSAGES");
                ack({ success: false, error: "Failed to fetch messages" });
            }
        });

        // ── MARK_CHANNEL_READ ─────────────────────────────────────────────────
        socket.on("MARK_CHANNEL_READ", async (payload, ack) => {
            try {
                const { channelId } = payload;
                const userId = socket.data.userId;

                await app.prisma.channelRead.upsert({
                    where: { userId_channelId: { userId, channelId } },
                    update: { lastReadAt: new Date() },
                    create: { userId, channelId, lastReadAt: new Date() },
                });

                ack({ success: true });
            } catch (err) {
                app.log.error({ err }, "Error in MARK_CHANNEL_READ");
                ack({ success: false });
            }
        });

        // ── DELETE_MESSAGE ──────────────────────────────────────────────────
        socket.on("DELETE_MESSAGE", async (payload, ack) => {
            try {
                const { messageId } = payload;

                const message = await app.prisma.message.findUnique({
                    where: { id: messageId },
                });
                if (!message) {
                    ack({ success: false, error: "Message not found" });
                    return;
                }
                if (message.userId !== socket.data.userId) {
                    ack({ success: false, error: "You can only delete your own messages" });
                    return;
                }

                if (message.attachmentUrl) {
                    await deleteAttachment(message.attachmentUrl, message.attachmentPublicId);
                }

                await app.prisma.message.delete({ where: { id: messageId } });

                ack({ success: true });

                io.to(`server:${socket.data.serverId}`).emit("MESSAGE_DELETED", {
                    channelId: message.channelId,
                    messageId,
                });

                app.log.info(
                    { socketId: socket.id, messageId },
                    "Message deleted",
                );
            } catch (err) {
                app.log.error({ err }, "Error in DELETE_MESSAGE");
                ack({ success: false, error: "Failed to delete message" });
            }
        });

        // ── EDIT_MESSAGE ─────────────────────────────────────────────────────
        socket.on("EDIT_MESSAGE", async (payload, ack) => {
            try {
                const { messageId, content } = payload;
                const trimmed = content?.trim() ?? "";
                if (!trimmed) {
                    ack({ success: false, error: "Message content cannot be empty" });
                    return;
                }

                const message = await app.prisma.message.findUnique({
                    where: { id: messageId },
                });
                if (!message) {
                    ack({ success: false, error: "Message not found" });
                    return;
                }
                if (message.userId !== socket.data.userId) {
                    ack({ success: false, error: "You can only edit your own messages" });
                    return;
                }
                if (message.attachmentUrl) {
                    ack({ success: false, error: "Image messages cannot be edited" });
                    return;
                }

                const ageMs = Date.now() - message.createdAt.getTime();
                if (ageMs > 2 * 60 * 1000) {
                    ack({ success: false, error: "Edit window has expired" });
                    return;
                }

                const updated = await app.prisma.message.update({
                    where: { id: messageId },
                    data: { content: trimmed, editedAt: new Date() },
                });

                const messageDto: IMessage = {
                    id: updated.id,
                    channelId: updated.channelId,
                    userId: updated.userId,
                    nickname: socket.data.nickname,
                    content: updated.content,
                    attachmentUrl: updated.attachmentUrl,
                    createdAt: updated.createdAt.toISOString(),
                    editedAt: updated.editedAt?.toISOString() ?? null,
                };

                ack({ success: true });

                io.to(`server:${socket.data.serverId}`).emit("MESSAGE_EDITED", messageDto);

                app.log.info(
                    { socketId: socket.id, messageId },
                    "Message edited",
                );
            } catch (err) {
                app.log.error({ err }, "Error in EDIT_MESSAGE");
                ack({ success: false, error: "Failed to edit message" });
            }
        });
    });
}
