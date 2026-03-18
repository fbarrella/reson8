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
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
    IDirectMessage,
} from "@reson8/shared-types";
import { PresenceService } from "../services/presence.service.js";

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
                const { recipientId, content, attachmentUrl } = payload;

                if ((!content || content.trim().length === 0) && !attachmentUrl) {
                    ack({ success: false, error: "Message content is empty" });
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

                // Persist DM
                const dm = await app.prisma.directMessage.create({
                    data: {
                        senderId: socket.data.userId,
                        receiverId: recipientId,
                        content: content?.trim() ?? "",
                        attachmentUrl: attachmentUrl ?? null,
                    },
                });

                const dmDto: IDirectMessage = {
                    id: dm.id,
                    senderId: dm.senderId,
                    senderNickname: socket.data.nickname,
                    receiverId: dm.receiverId,
                    content: dm.content,
                    attachmentUrl: dm.attachmentUrl,
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
                app.log.error({ err }, "Error in SEND_DIRECT_MESSAGE");
                ack({ success: false, error: "Failed to send direct message" });
            }
        });

        // ── FETCH_DIRECT_MESSAGES ──────────────────────────────────────────
        socket.on("FETCH_DIRECT_MESSAGES", async (payload, ack) => {
            try {
                const { partnerId, before, limit = 50 } = payload;
                const take = Math.min(limit, 100); // cap at 100
                const userId = socket.data.userId;

                const where: any = {
                    OR: [
                        { senderId: userId, receiverId: partnerId },
                        { senderId: partnerId, receiverId: userId },
                    ],
                };

                if (before) {
                    where.createdAt = { lt: new Date(before) };
                }

                const messages = await app.prisma.directMessage.findMany({
                    where,
                    orderBy: { createdAt: "desc" },
                    take,
                    include: {
                        sender: { select: { nickname: true } },
                    },
                });

                // Convert to DTOs in chronological order
                const dtos: IDirectMessage[] = messages
                    .reverse()
                    .map((m) => ({
                        id: m.id,
                        senderId: m.senderId,
                        senderNickname: m.sender.nickname,
                        receiverId: m.receiverId,
                        content: m.content,
                        attachmentUrl: m.attachmentUrl,
                        createdAt: m.createdAt.toISOString(),
                        readAt: m.readAt?.toISOString() ?? null,
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
    });
}
