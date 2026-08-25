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
    IPinnedMessage,
} from "@reson8/shared-types";
import { PermissionFlags } from "@reson8/shared-types";
import { requirePermission } from "../middleware/permissions.middleware.js";
import { deleteAttachment } from "../services/storage.service.js";
import { DEFAULT_MAX_MESSAGE_LENGTH } from "../config/message.config.js";

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

const messageInclude = {
    user: { select: { nickname: true } },
    reactions: { select: { emoji: true, userId: true }, orderBy: { createdAt: "asc" as const } },
};

type MessageWithRelations = {
    id: string;
    channelId: string;
    userId: string;
    content: string;
    attachmentUrl: string | null;
    createdAt: Date;
    editedAt: Date | null;
    user: { nickname: string };
    reactions: { emoji: string; userId: string }[];
};

/** Maps a Prisma message row (with user + reactions included) to the wire DTO. */
function toMessageDto(m: MessageWithRelations): IMessage {
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
}

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

                // Server-configurable resource-exhaustion guard (Phase 12
                // sub-phase item 4) — checked against the trimmed content,
                // matching the empty-check above and what actually gets
                // persisted.
                const server = await app.prisma.server.findUnique({
                    where: { id: socket.data.serverId },
                    select: { maxMessageLength: true },
                });
                const maxLength = server?.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH;
                if (content && content.trim().length > maxLength) {
                    ack({ success: false, error: `Message exceeds the ${maxLength}-character limit` });
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
                const { channelId, before, limit = 50, aroundMessageId } = payload;
                const take = Math.min(limit, 100); // cap at 100

                let dtos: IMessage[];

                if (aroundMessageId) {
                    // Jump-to-message: fetch a window centered on a specific
                    // message rather than the most recent page — used when
                    // clicking the pinned-message bar for a pin outside the
                    // currently-loaded history (PRD 11.5).
                    const target = await app.prisma.message.findUnique({
                        where: { id: aroundMessageId },
                    });
                    if (!target || target.channelId !== channelId) {
                        ack({ success: false, error: "Message not found" });
                        return;
                    }

                    const halfBefore = Math.floor((take - 1) / 2);
                    const halfAfter = take - 1 - halfBefore;

                    const [beforeMsgs, targetMsg, afterMsgs] = await Promise.all([
                        app.prisma.message.findMany({
                            where: { channelId, createdAt: { lt: target.createdAt } },
                            orderBy: { createdAt: "desc" },
                            take: halfBefore,
                            include: messageInclude,
                        }),
                        app.prisma.message.findUniqueOrThrow({
                            where: { id: aroundMessageId },
                            include: messageInclude,
                        }),
                        app.prisma.message.findMany({
                            where: { channelId, createdAt: { gt: target.createdAt } },
                            orderBy: { createdAt: "asc" },
                            take: halfAfter,
                            include: messageInclude,
                        }),
                    ]);

                    dtos = [...beforeMsgs.reverse(), targetMsg, ...afterMsgs].map(toMessageDto);
                } else {
                    const where: any = { channelId };
                    if (before) {
                        where.createdAt = { lt: new Date(before) };
                    }

                    const messages = await app.prisma.message.findMany({
                        where,
                        orderBy: { createdAt: "desc" },
                        take,
                        include: messageInclude,
                    });

                    dtos = messages.reverse().map(toMessageDto);
                }

                // Only resolve the channel's current pin on the initial load
                // (not on "load more"/jump-to-message calls) to avoid an
                // extra query on every scroll-triggered page fetch.
                let pinnedMessage: IPinnedMessage | null = null;
                if (!before && !aroundMessageId) {
                    const channel = await app.prisma.channel.findUnique({
                        where: { id: channelId },
                        select: {
                            pinnedMessage: {
                                select: {
                                    id: true,
                                    content: true,
                                    createdAt: true,
                                    user: { select: { nickname: true } },
                                },
                            },
                        },
                    });
                    if (channel?.pinnedMessage) {
                        pinnedMessage = {
                            id: channel.pinnedMessage.id,
                            content: channel.pinnedMessage.content,
                            authorNickname: channel.pinnedMessage.user.nickname,
                            createdAt: channel.pinnedMessage.createdAt.toISOString(),
                        };
                    }
                }

                ack({ success: true, messages: dtos, pinnedMessage });
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

                // Was this the channel's pinned message? Check before
                // deleting — the FK's onDelete: SetNull clears it at the DB
                // level automatically, but connected clients still need to
                // be told so their pin bar disappears in real time (PRD 11.5).
                const channel = await app.prisma.channel.findUnique({
                    where: { id: message.channelId },
                    select: { name: true, pinnedMessageId: true },
                });
                const wasPinned = channel?.pinnedMessageId === messageId;

                await app.prisma.message.delete({ where: { id: messageId } });

                ack({ success: true });

                io.to(`server:${socket.data.serverId}`).emit("MESSAGE_DELETED", {
                    channelId: message.channelId,
                    messageId,
                });

                if (wasPinned && channel) {
                    io.to(`server:${socket.data.serverId}`).emit("CHANNEL_PIN_UPDATED", {
                        channelId: message.channelId,
                        channelName: channel.name,
                        pinnedMessage: null,
                        // No actedByNickname — this was an automatic
                        // unpin, not an explicit pin/unpin action.
                    });
                }

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

                // Same resource-exhaustion guard as SEND_MESSAGE — an edit
                // is just as capable of growing a message unboundedly.
                const server = await app.prisma.server.findUnique({
                    where: { id: socket.data.serverId },
                    select: { maxMessageLength: true },
                });
                const maxLength = server?.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH;
                if (trimmed.length > maxLength) {
                    ack({ success: false, error: `Message exceeds the ${maxLength}-character limit` });
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
