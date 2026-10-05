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
import { aggregateReactionsForMessage } from "../services/reaction.service.js";

type TypedIO = SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>;

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
                const reactions = await aggregateReactionsForMessage(app.prisma, messageId, isDm);
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
