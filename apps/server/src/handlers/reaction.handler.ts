/**
 * Reson8 — Reaction Handler
 *
 * Handles TOGGLE_REACTION events for both channel messages and DMs.
 * Broadcasts REACTION_UPDATED after any change.
 */

import { Server as SocketIOServer } from "socket.io";
import type { FastifyInstance } from "fastify";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
} from "@reson8/shared-types";

type TypedIO = SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>;

/**
 * Aggregate reactions for a given message (channel or DM) into
 * a compact array of { emoji, count, userIds }.
 */
async function aggregateReactions(
    prisma: FastifyInstance["prisma"],
    messageId: string,
    isDm: boolean,
): Promise<Array<{ emoji: string; count: number; userIds: string[] }>> {
    const where = isDm ? { dmId: messageId } : { messageId };
    const rows = await prisma.reaction.findMany({
        where,
        select: { emoji: true, userId: true },
        orderBy: { createdAt: "asc" },
    });

    // Group by emoji
    const map = new Map<string, string[]>();
    for (const row of rows) {
        let list = map.get(row.emoji);
        if (!list) {
            list = [];
            map.set(row.emoji, list);
        }
        list.push(row.userId);
    }

    return Array.from(map.entries()).map(([emoji, userIds]) => ({
        emoji,
        count: userIds.length,
        userIds,
    }));
}

export function registerReactionHandlers(
    io: TypedIO,
    app: FastifyInstance,
): void {
    io.on("connection", (socket) => {
        socket.on("TOGGLE_REACTION", async (payload, ack) => {
            const { messageId, emoji, isDm } = payload;
            const userId = socket.data.userId;

            if (!messageId || !emoji) {
                ack({ success: false, error: "Missing messageId or emoji" });
                return;
            }

            try {
                if (isDm) {
                    // Verify the DM exists
                    const dm = await app.prisma.directMessage.findUnique({
                        where: { id: messageId },
                    });
                    if (!dm) {
                        ack({ success: false, error: "Message not found" });
                        return;
                    }

                    // Toggle: check if already reacted
                    const existing = await app.prisma.reaction.findUnique({
                        where: { dmId_userId_emoji: { dmId: messageId, userId, emoji } },
                    });

                    if (existing) {
                        await app.prisma.reaction.delete({ where: { id: existing.id } });
                    } else {
                        await app.prisma.reaction.create({
                            data: { dmId: messageId, userId, emoji },
                        });
                    }
                } else {
                    // Verify the message exists
                    const msg = await app.prisma.message.findUnique({
                        where: { id: messageId },
                    });
                    if (!msg) {
                        ack({ success: false, error: "Message not found" });
                        return;
                    }

                    // Toggle: check if already reacted
                    const existing = await app.prisma.reaction.findUnique({
                        where: {
                            messageId_userId_emoji: { messageId, userId, emoji },
                        },
                    });

                    if (existing) {
                        await app.prisma.reaction.delete({ where: { id: existing.id } });
                    } else {
                        await app.prisma.reaction.create({
                            data: { messageId, userId, emoji },
                        });
                    }
                }

                // Aggregate and broadcast
                const reactions = await aggregateReactions(app.prisma, messageId, isDm);
                io.to(`server:${socket.data.serverId}`).emit("REACTION_UPDATED", {
                    messageId,
                    isDm,
                    reactions,
                });

                ack({ success: true });
            } catch (err: any) {
                app.log.error({ err }, "TOGGLE_REACTION error");
                ack({ success: false, error: "Internal error" });
            }
        });
    });
}
