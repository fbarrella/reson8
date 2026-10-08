/**
 * DM Handler — Socket.io events for direct messaging.
 *
 * Handles: SEND_DIRECT_MESSAGE, FETCH_DIRECT_MESSAGES, GET_ONLINE_USERS,
 *          MARK_DMS_READ, GET_UNREAD_DM_PARTNERS.
 * Messages are persisted in PostgreSQL and delivered in real-time
 * to the recipient's socket(s).
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
    IDirectMessage,
} from "@reson8/shared-types";
import { PresenceService } from "../services/presence.service.js";
import { claimUploads, UploadClaimError } from "../services/stored-file.service.js";
import {
    dmInPair,
    isDmReplyAllowed,
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

/**
 * Registers direct-messaging handlers on each socket connection.
 */
export function registerDMHandlers(
    io: TypedIO,
    app: FastifyInstance,
): void {
    const presence = new PresenceService(app.redis);

    io.on("connection", (socket: TypedSocket) => {
        // ── SEND_DIRECT_MESSAGE ────────────────────────────────────────────
        socket.on("SEND_DIRECT_MESSAGE", async (payload, ack) => {
            try {
                const { recipientId } = payload;
                const content = normalizeNewlines(payload.content);

                // Same claim-by-ledger-id scheme as channel messages (PRD 16.8/16.10);
                // the client's `attachmentPublicId` is never read.
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
                    ack({ success: false, error: "Message content is empty" });
                    return;
                }

                // Same resource-exhaustion guard as channel messages
                // (Phase 12 sub-phase item 4) — DMs are just as capable of
                // being abused.
                const server = await app.prisma.server.findUnique({
                    where: { id: socket.data.serverId },
                    select: { maxMessageLength: true },
                });
                const maxLength = server?.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH;
                if (content && content.trim().length > maxLength) {
                    ack({ success: false, error: `Message exceeds the ${maxLength}-character limit` });
                    return;
                }

                // Prevent self-DM
                if (recipientId === socket.data.userId) {
                    ack({ success: false, error: "Cannot send a DM to yourself" });
                    return;
                }

                // Verify recipient user exists
                const recipient = await app.prisma.user.findUnique({
                    where: { id: recipientId },
                });
                if (!recipient) {
                    ack({ success: false, error: "Recipient not found" });
                    return;
                }

                // A reply may only point into THIS conversation, or at a DM that
                // has since been deleted (PRD 16.11) — never at someone else's
                // DM, whose text would then leak into the snippet.
                if (replyToId) {
                    const target = await app.prisma.directMessage.findUnique({
                        where: { id: replyToId },
                        select: { senderId: true, receiverId: true },
                    });
                    if (!isDmReplyAllowed(target, socket.data.userId, recipientId)) {
                        ack({ success: false, error: "Invalid reply target" });
                        return;
                    }
                }

                // Persist DM — claim + create share one transaction (PRD 16.8)
                const dm = await app.prisma.$transaction(async (tx) => {
                    const files = await claimUploads(tx, {
                        ids: claim.ids,
                        urls: claim.urls,
                        kind: "MESSAGE_ATTACHMENT",
                        userId: socket.data.userId,
                    });
                    return tx.directMessage.create({
                        data: {
                            senderId: socket.data.userId,
                            receiverId: recipientId,
                            content: content?.trim() ?? "",
                            replyToId,
                            attachments: {
                                create: files.map((f, position) => ({ url: f.url, publicId: f.publicId, position })),
                            },
                        },
                        include: { attachments: attachmentInclude, sender: { select: { avatarUrl: true } } },
                    });
                });

                const replyPreviews = await loadReplyPreviews(app.prisma, "dm", [replyToId]);
                const dmDto: IDirectMessage = {
                    id: dm.id,
                    senderId: dm.senderId,
                    senderNickname: socket.data.nickname,
                    senderAvatarUrl: dm.sender.avatarUrl,
                    receiverId: dm.receiverId,
                    content: dm.content,
                    replyTo: replyPreviewFor(replyToId, replyPreviews),
                    ...attachmentFields(dm.attachments),
                    createdAt: dm.createdAt.toISOString(),
                    readAt: null,
                };

                // Deliver to recipient's socket(s)
                for (const [, s] of io.sockets.sockets) {
                    if (s.data.userId === recipientId) {
                        s.emit("DIRECT_MESSAGE_RECEIVED", dmDto);
                    }
                }

                // Also deliver back to the sender (so their DM tab updates)
                socket.emit("DIRECT_MESSAGE_RECEIVED", dmDto);

                ack({ success: true, messageId: dm.id });

                app.log.info(
                    { socketId: socket.id, recipientId, messageId: dm.id },
                    "Direct message sent",
                );
            } catch (err) {
                if (err instanceof UploadClaimError) {
                    ack({ success: false, error: err.message });
                    return;
                }
                app.log.error({ err }, "Error in SEND_DIRECT_MESSAGE");
                ack({ success: false, error: "Failed to send direct message" });
            }
        });

        // ── FETCH_DIRECT_MESSAGES ──────────────────────────────────────────
        socket.on("FETCH_DIRECT_MESSAGES", async (payload, ack) => {
            try {
                const { partnerId, before, limit = 50, aroundMessageId } = payload;
                const take = Math.min(limit, 100); // cap at 100
                const userId = socket.data.userId;

                const pairWhere = {
                    OR: [
                        { senderId: userId, receiverId: partnerId },
                        { senderId: partnerId, receiverId: userId },
                    ],
                };
                const dmInclude = {
                    sender: { select: { nickname: true, avatarUrl: true } },
                    reactions: { select: { emoji: true, userId: true }, orderBy: { createdAt: "asc" as const } },
                    attachments: attachmentInclude,
                };
                type DmRow = Prisma.DirectMessageGetPayload<{ include: typeof dmInclude }>;

                let ordered: DmRow[];

                if (aroundMessageId) {
                    // Jump-to-message (PRD 16.11): a window centred on one DM
                    // instead of the latest page — used when a reply's snippet
                    // points at a DM outside the loaded history. Mirrors
                    // FETCH_MESSAGES' window, and refuses anything outside THIS
                    // conversation.
                    const target = await app.prisma.directMessage.findUnique({ where: { id: aroundMessageId } });
                    if (!target || !dmInPair(target, userId, partnerId)) {
                        ack({ success: false, error: "Message not found" });
                        return;
                    }

                    const halfBefore = Math.floor((take - 1) / 2);
                    const halfAfter = take - 1 - halfBefore;

                    const [beforeMsgs, targetMsg, afterMsgs] = await Promise.all([
                        app.prisma.directMessage.findMany({
                            where: { ...pairWhere, createdAt: { lt: target.createdAt } },
                            orderBy: { createdAt: "desc" },
                            take: halfBefore,
                            include: dmInclude,
                        }),
                        app.prisma.directMessage.findUniqueOrThrow({ where: { id: aroundMessageId }, include: dmInclude }),
                        app.prisma.directMessage.findMany({
                            where: { ...pairWhere, createdAt: { gt: target.createdAt } },
                            orderBy: { createdAt: "asc" },
                            take: halfAfter,
                            include: dmInclude,
                        }),
                    ]);
                    ordered = [...beforeMsgs.reverse(), targetMsg, ...afterMsgs];
                } else {
                    const messages = await app.prisma.directMessage.findMany({
                        where: { ...pairWhere, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
                        orderBy: { createdAt: "desc" },
                        take,
                        include: dmInclude,
                    });
                    ordered = messages.reverse();
                }

                // Convert to DTOs in chronological order — every reactor's
                // nickname (PRD 15.11) and every reply snippet (PRD 16.11) is
                // resolved in a single query each, whatever the page size.
                const [reactorNicknames, replyPreviews] = await Promise.all([
                    loadReactorNicknames(
                        app.prisma,
                        ordered.flatMap((m) => m.reactions.map((r) => r.userId)),
                    ),
                    loadReplyPreviews(app.prisma, "dm", ordered.map((m) => m.replyToId)),
                ]);
                const dtos: IDirectMessage[] = ordered.map((m) => ({
                    id: m.id,
                    senderId: m.senderId,
                    senderNickname: m.sender.nickname,
                    senderAvatarUrl: m.sender.avatarUrl,
                    receiverId: m.receiverId,
                    content: m.content,
                    replyTo: replyPreviewFor(m.replyToId, replyPreviews),
                    ...attachmentFields(m.attachments, m.attachmentUrl),
                    createdAt: m.createdAt.toISOString(),
                    readAt: m.readAt?.toISOString() ?? null,
                    reactions: aggregateReactionRows(m.reactions, reactorNicknames),
                }));

                ack({ success: true, messages: dtos });
            } catch (err) {
                app.log.error({ err }, "Error in FETCH_DIRECT_MESSAGES");
                ack({ success: false, error: "Failed to fetch direct messages" });
            }
        });

        // ── GET_ONLINE_USERS ───────────────────────────────────────────────
        // Returns all online users on this server PLUS offline users who
        // have an existing DM conversation with the requesting user.
        socket.on("GET_ONLINE_USERS", async (ack) => {
            try {
                const serverId = socket.data.serverId;
                const userId = socket.data.userId;

                // 1. Get currently online users from Redis
                const onlineIdList = await presence.getOnlineUsers(serverId);
                const onlineIds = new Set(onlineIdList);

                // 2. Get distinct DM partner userIds from the database
                const dmRows = await app.prisma.directMessage.findMany({
                    where: {
                        OR: [
                            { senderId: userId },
                            { receiverId: userId },
                        ],
                    },
                    select: { senderId: true, receiverId: true },
                    distinct: ["senderId", "receiverId"],
                });

                const partnerIdSet = new Set<string>();
                for (const dm of dmRows) {
                    if (dm.senderId !== userId) partnerIdSet.add(dm.senderId);
                    if (dm.receiverId !== userId) partnerIdSet.add(dm.receiverId);
                }

                // 3. Merge: online users (for first-contact) + offline DM partners
                for (const oid of onlineIds) {
                    if (oid !== userId) partnerIdSet.add(oid);
                }

                // 4. Resolve each user entry
                const users = await Promise.all(
                    [...partnerIdSet].map(async (uid) => {
                        const isOnline = onlineIds.has(uid);
                        if (isOnline) {
                            const p = await presence.getUserPresence(uid);
                            return {
                                userId: uid,
                                nickname: p?.nickname ?? "Unknown",
                                isOnline: true,
                            };
                        } else {
                            const dbUser = await app.prisma.user.findUnique({
                                where: { id: uid },
                                select: { nickname: true },
                            });
                            return {
                                userId: uid,
                                nickname: dbUser?.nickname ?? "Unknown",
                                isOnline: false,
                            };
                        }
                    }),
                );

                ack({ success: true, users });
            } catch (err) {
                app.log.error({ err }, "Error in GET_ONLINE_USERS");
                ack({ success: false, error: "Failed to fetch online users" });
            }
        });

        // ── MARK_DMS_READ ──────────────────────────────────────────────────
        socket.on("MARK_DMS_READ", async (payload, ack) => {
            try {
                const userId = socket.data.userId;
                const { partnerId } = payload;

                // Bulk-update all unread DMs sent by the partner TO this user
                await app.prisma.directMessage.updateMany({
                    where: {
                        senderId: partnerId,
                        receiverId: userId,
                        readAt: null,
                    },
                    data: {
                        readAt: new Date(),
                    },
                });

                ack({ success: true });
            } catch (err) {
                app.log.error({ err }, "Error in MARK_DMS_READ");
                ack({ success: false, error: "Failed to mark DMs as read" });
            }
        });

        // ── GET_UNREAD_DM_PARTNERS ─────────────────────────────────────────
        socket.on("GET_UNREAD_DM_PARTNERS", async (ack) => {
            try {
                const userId = socket.data.userId;

                // Find all unread DMs where this user is the receiver
                const unreadDms = await app.prisma.directMessage.groupBy({
                    by: ["senderId"],
                    where: {
                        receiverId: userId,
                        readAt: null,
                    },
                    _count: { id: true },
                });

                if (unreadDms.length === 0) {
                    ack({ success: true, partners: [] });
                    return;
                }

                // Resolve sender nicknames
                const partners = await Promise.all(
                    unreadDms.map(async (group) => {
                        const user = await app.prisma.user.findUnique({
                            where: { id: group.senderId },
                            select: { nickname: true },
                        });
                        return {
                            partnerId: group.senderId,
                            partnerNickname: user?.nickname ?? "Unknown",
                            unreadCount: group._count.id,
                        };
                    }),
                );

                ack({ success: true, partners });
            } catch (err) {
                app.log.error({ err }, "Error in GET_UNREAD_DM_PARTNERS");
                ack({ success: false, error: "Failed to fetch unread DM partners" });
            }
        });

        // ── DELETE_DIRECT_MESSAGE ───────────────────────────────────────────
        socket.on("DELETE_DIRECT_MESSAGE", async (payload, ack) => {
            try {
                const { dmId } = payload;

                const dm = await app.prisma.directMessage.findUnique({
                    where: { id: dmId },
                    include: { attachments: attachmentInclude },
                });
                if (!dm) {
                    ack({ success: false, error: "Message not found" });
                    return;
                }
                if (dm.senderId !== socket.data.userId) {
                    ack({ success: false, error: "You can only delete your own messages" });
                    return;
                }
                // Read before the row (and its attachment rows) go.
                const filesToRelease = attachmentUrlsToRelease(dm.attachments, dm.attachmentUrl);

                await app.prisma.directMessage.delete({ where: { id: dmId } });

                ack({ success: true });

                // Row gone — release ALL its files via the upload ledger (PRD 16.8/16.10).
                if (filesToRelease.length > 0) {
                    releaseAttachmentFiles(app.prisma, filesToRelease).catch((err) =>
                        app.log.warn({ err, dmId }, "Failed to release deleted DM's files"),
                    );
                }

                // Notify both participants' sockets (mirrors SEND_DIRECT_MESSAGE's delivery pattern)
                for (const [, s] of io.sockets.sockets) {
                    if (s.data.userId === dm.senderId || s.data.userId === dm.receiverId) {
                        s.emit("DIRECT_MESSAGE_DELETED", { dmId });
                    }
                }

                app.log.info(
                    { socketId: socket.id, dmId },
                    "Direct message deleted",
                );
            } catch (err) {
                app.log.error({ err }, "Error in DELETE_DIRECT_MESSAGE");
                ack({ success: false, error: "Failed to delete direct message" });
            }
        });
    });
}
