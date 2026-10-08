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
    IReplyPreview,
} from "@reson8/shared-types";
import { PermissionFlags } from "@reson8/shared-types";
import { requirePermission } from "../middleware/permissions.middleware.js";
import { claimUploads, UploadClaimError } from "../services/stored-file.service.js";
import {
    isChannelReplyAllowed,
    loadReplyPreviews,
    parseReplyToId,
    replyPreviewFor,
} from "../services/reply.service.js";
import {
    attachmentFields,
    attachmentInclude,
    attachmentUrlsToRelease,
    normalizeAttachmentInput,
    releaseAttachmentFiles,
    type AttachmentRow,
} from "../services/attachment.service.js";
import { DEFAULT_MAX_MESSAGE_LENGTH } from "../config/message.config.js";
import { normalizeNewlines } from "../services/message-text.js";
import { aggregateReactionRows, loadReactorNicknames } from "../services/reaction.service.js";

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
    user: { select: { nickname: true, avatarUrl: true } },
    reactions: { select: { emoji: true, userId: true }, orderBy: { createdAt: "asc" as const } },
    attachments: attachmentInclude,
};

type MessageWithRelations = {
    id: string;
    channelId: string;
    userId: string;
    content: string;
    replyToId: string | null;
    /** Deprecated column — only a fallback for a row the backfill missed (PRD 16.10). */
    attachmentUrl: string | null;
    attachments: AttachmentRow[];
    createdAt: Date;
    editedAt: Date | null;
    user: { nickname: string; avatarUrl: string | null };
    reactions: { emoji: string; userId: string }[];
};

/** Maps a Prisma message row (with user + reactions included) to the wire DTO.
 *  `reactorNicknames` is the batch-loaded nickname lookup (PRD 15.11) and
 *  `replyPreviews` the batch-loaded reply-snippet lookup (PRD 16.11). */
function toMessageDto(
    m: MessageWithRelations,
    reactorNicknames: ReadonlyMap<string, string>,
    replyPreviews: ReadonlyMap<string, IReplyPreview>,
): IMessage {
    return {
        id: m.id,
        channelId: m.channelId,
        userId: m.userId,
        nickname: m.user.nickname,
        avatarUrl: m.user.avatarUrl,
        content: m.content,
        replyTo: replyPreviewFor(m.replyToId, replyPreviews),
        ...attachmentFields(m.attachments, m.attachmentUrl),
        createdAt: m.createdAt.toISOString(),
        editedAt: m.editedAt?.toISOString() ?? null,
        reactions: aggregateReactionRows(m.reactions, reactorNicknames),
    };
}

/** Maps a whole fetched page, resolving every reactor's nickname in ONE query and every reply snippet in ONE more. */
async function toMessageDtos(
    prisma: FastifyInstance["prisma"],
    messages: MessageWithRelations[],
): Promise<IMessage[]> {
    const [nicknames, replyPreviews] = await Promise.all([
        loadReactorNicknames(
            prisma,
            messages.flatMap((m) => m.reactions.map((r) => r.userId)),
        ),
        loadReplyPreviews(prisma, "message", messages.map((m) => m.replyToId)),
    ]);
    return messages.map((m) => toMessageDto(m, nicknames, replyPreviews));
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
                const { channelId } = payload;
                const content = normalizeNewlines(payload.content);

                // Attachments are referenced by upload-ledger id (PRD 16.8), up
                // to MAX_ATTACHMENTS_PER_MESSAGE (PRD 16.10); a legacy client's
                // single URL is accepted too. The client's `attachmentPublicId`
                // is deliberately never read: the real public_id comes from the
                // server's own upload record.
                const claim = normalizeAttachmentInput(payload);
                if ("error" in claim) {
                    ack({ success: false, error: claim.error });
                    return;
                }
                const hasAttachment = claim.ids.length + claim.urls.length > 0;

                const reply = parseReplyToId(payload.replyToId);
                if ("error" in reply) {
                    ack({ success: false, error: reply.error });
                    return;
                }
                const { replyToId } = reply;

                if ((!content || content.trim().length === 0) && !hasAttachment) {
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

                // A reply may only point into THIS channel, or at a message that
                // has since been deleted (PRD 16.11) — never at another channel's
                // message, whose text would then leak into the snippet.
                if (replyToId) {
                    const target = await app.prisma.message.findUnique({
                        where: { id: replyToId },
                        select: { channelId: true },
                    });
                    if (!isChannelReplyAllowed(target, channelId)) {
                        ack({ success: false, error: "Invalid reply target" });
                        return;
                    }
                }

                // Persist message. Claiming the upload and creating the row
                // share one transaction: a failed claim (someone else's file,
                // already used, swept…) aborts the send, and a failed create
                // rolls the claim back.
                const message = await app.prisma.$transaction(async (tx) => {
                    const files = await claimUploads(tx, {
                        ids: claim.ids,
                        urls: claim.urls,
                        kind: "MESSAGE_ATTACHMENT",
                        userId: socket.data.userId,
                    });
                    return tx.message.create({
                        data: {
                            channelId,
                            userId: socket.data.userId,
                            content: content?.trim() ?? "",
                            replyToId,
                            // The ledger's url/public_id, in the order the client listed them.
                            attachments: {
                                create: files.map((f, position) => ({ url: f.url, publicId: f.publicId, position })),
                            },
                        },
                        include: { attachments: attachmentInclude, user: { select: { avatarUrl: true } } },
                    });
                });

                const replyPreviews = await loadReplyPreviews(app.prisma, "message", [replyToId]);
                const messageDto: IMessage = {
                    id: message.id,
                    channelId: message.channelId,
                    userId: message.userId,
                    nickname: socket.data.nickname,
                    avatarUrl: message.user.avatarUrl,
                    content: message.content,
                    replyTo: replyPreviewFor(replyToId, replyPreviews),
                    ...attachmentFields(message.attachments),
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
                if (err instanceof UploadClaimError) {
                    ack({ success: false, error: err.message });
                    return;
                }
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

                    dtos = await toMessageDtos(app.prisma, [...beforeMsgs.reverse(), targetMsg, ...afterMsgs]);
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

                    dtos = await toMessageDtos(app.prisma, messages.reverse());
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
                    include: { attachments: attachmentInclude },
                });
                if (!message) {
                    ack({ success: false, error: "Message not found" });
                    return;
                }
                if (message.userId !== socket.data.userId) {
                    ack({ success: false, error: "You can only delete your own messages" });
                    return;
                }
                // Read before the row (and its attachment rows) go.
                const filesToRelease = attachmentUrlsToRelease(message.attachments, message.attachmentUrl);

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

                // The row is gone — now release ALL its files (DB first, so a
                // failed delete never loses a file). Uses the upload ledger's
                // own url/public_id and only deletes when nothing else still
                // references each one (PRD 16.8/16.10).
                if (filesToRelease.length > 0) {
                    releaseAttachmentFiles(app.prisma, filesToRelease).catch((err) =>
                        app.log.warn({ err, messageId }, "Failed to release deleted message's files"),
                    );
                }

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
                const { messageId } = payload;
                const trimmed = normalizeNewlines(payload.content).trim();
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
                    include: { attachments: { select: { id: true }, take: 1 } },
                });
                if (!message) {
                    ack({ success: false, error: "Message not found" });
                    return;
                }
                if (message.userId !== socket.data.userId) {
                    ack({ success: false, error: "You can only edit your own messages" });
                    return;
                }
                if (message.attachments.length > 0 || message.attachmentUrl) {
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
                    include: { user: { select: { avatarUrl: true } } },
                });

                // An edited reply is still a reply — keep its snippet in the broadcast.
                const replyPreviews = await loadReplyPreviews(app.prisma, "message", [updated.replyToId]);
                const messageDto: IMessage = {
                    id: updated.id,
                    channelId: updated.channelId,
                    userId: updated.userId,
                    nickname: socket.data.nickname,
                    avatarUrl: updated.user.avatarUrl,
                    content: updated.content,
                    replyTo: replyPreviewFor(updated.replyToId, replyPreviews),
                    // Image messages can't be edited (checked above), so an edited message has none.
                    ...attachmentFields([]),
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
