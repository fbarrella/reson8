/**
 * Typing Handler (PRD 20 W2) — relays "is typing" signals. Never stored.
 * Handles: TYPING.
 */
import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData } from "@reson8/shared-types";
import { parseTypingPayload, shouldRelayTyping } from "../services/typing.service.js";
import { membersRoom } from "../services/access-change.js";

type TypedIO = SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function registerTypingHandlers(io: TypedIO, app: FastifyInstance): void {
    io.on("connection", (socket: TypedSocket) => {
        const lastRelay = new Map<string, number>();
        socket.on("TYPING", async (payload) => {
            try {
                if (socket.data.role === "viewer") return;
                const target = parseTypingPayload(payload);
                if (!target) return;
                const key = target.kind === "channel" ? `c:${target.channelId}` : `d:${target.partnerId}`;
                const now = Date.now();
                if (!shouldRelayTyping(lastRelay.get(key), now)) return;
                lastRelay.set(key, now);
                if (lastRelay.size > 50) lastRelay.delete(lastRelay.keys().next().value!);
                const serverId = socket.data.serverId;
                const from = { userId: socket.data.userId, nickname: socket.data.nickname };
                if (target.kind === "channel") {
                    const ch = await app.prisma.channel.findUnique({
                        where: { id: target.channelId },
                        select: { serverId: true, type: true },
                    });
                    if (!ch || ch.serverId !== serverId || ch.type !== "TEXT") return;
                    socket.to(membersRoom(serverId)).emit("USER_TYPING", { ...from, channelId: target.channelId });
                } else {
                    if (target.partnerId === socket.data.userId) return;
                    for (const [, s] of io.sockets.sockets) {
                        if (s.data.userId === target.partnerId && s.data.serverId === serverId && s.data.role !== "viewer") {
                            s.emit("USER_TYPING", from);
                        }
                    }
                }
            } catch (err) {
                app.log.warn({ err }, "Error in TYPING");
            }
        });
    });
}
