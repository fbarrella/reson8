/**
 * Connection Handler — Socket.io event routing for Reson8.
 *
 * Handles: USER_JOIN_SERVER, USER_LEAVE_SERVER,
 *          USER_JOIN_CHANNEL, USER_LEAVE_CHANNEL, disconnect.
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
    IUserPresence,
} from "@reson8/shared-types";
import { PresenceService } from "../services/presence.service.js";
import { buildChannelTree } from "../services/channel-tree.service.js";
import type { MediasoupService } from "../services/mediasoup.service.js";

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
 * Registers all Socket.io connection event handlers.
 */
export function registerConnectionHandlers(
    io: TypedIO,
    app: FastifyInstance,
    mediasoup: MediasoupService,
): void {
    const presence = new PresenceService(app.redis);

    io.on("connection", (socket: TypedSocket) => {
        app.log.info({ socketId: socket.id }, "Client connected");

        // ── USER_JOIN_SERVER ────────────────────────────────────────────────
        socket.on("USER_JOIN_SERVER", async (payload, ack) => {
            try {
                const { serverId, nickname } = payload;

                // Store metadata on the socket for later reference
                socket.data.serverId = serverId;
                socket.data.nickname = nickname;
                // In Phase 3+, userId will come from auth. For now, use socket.id.
                socket.data.userId = socket.id;
                socket.data.currentChannelId = null;

                // Join the Socket.io room for this server
                await socket.join(`server:${serverId}`);

                // Register presence in Redis
                await presence.joinServer(socket.id, serverId, nickname);

                // Notify all other clients in the server
                socket.to(`server:${serverId}`).emit("USER_JOINED", {
                    userId: socket.id,
                    nickname,
                    serverId,
                });

                // Send the full channel tree to the newly connected client
                const channels = await app.prisma.channel.findMany({
                    where: { serverId },
                    orderBy: { position: "asc" },
                });

                // Map Prisma rows to IChannel DTOs
                const channelDtos = channels.map((ch: {
                    id: string;
                    serverId: string;
                    name: string;
                    type: string;
                    parentId: string | null;
                    position: number;
                    maxUsers: number | null;
                    createdAt: Date;
                }) => ({
                    id: ch.id,
                    serverId: ch.serverId,
                    name: ch.name,
                    type: ch.type as import("@reson8/shared-types").ChannelType,
                    parentId: ch.parentId,
                    position: ch.position,
                    maxUsers: ch.maxUsers,
                    createdAt: ch.createdAt.toISOString(),
                }));

                const tree = buildChannelTree(channelDtos);

                socket.emit("CHANNEL_TREE_UPDATE", { serverId, tree });

                ack({ success: true });
                app.log.info(
                    { socketId: socket.id, nickname, serverId },
                    "User joined server",
                );
            } catch (err) {
                app.log.error({ err }, "Error in USER_JOIN_SERVER");
                ack({ success: false, error: "Failed to join server" });
            }
        });

        // ── USER_LEAVE_SERVER ───────────────────────────────────────────────
        socket.on("USER_LEAVE_SERVER", async (payload) => {
            try {
                const { serverId } = payload;

                await presence.leaveServer(socket.id, serverId);
                await socket.leave(`server:${serverId}`);

                socket.to(`server:${serverId}`).emit("USER_LEFT", {
                    userId: socket.id,
                    serverId,
                });

                app.log.info({ socketId: socket.id, serverId }, "User left server");
            } catch (err) {
                app.log.error({ err }, "Error in USER_LEAVE_SERVER");
            }
        });

        // ── USER_JOIN_CHANNEL ───────────────────────────────────────────────
        socket.on("USER_JOIN_CHANNEL", async (payload, ack) => {
            try {
                const { channelId } = payload;

                // Leave previous channel room if any
                if (socket.data.currentChannelId) {
                    await socket.leave(`channel:${socket.data.currentChannelId}`);
                }

                // Join new channel
                socket.data.currentChannelId = channelId;
                await socket.join(`channel:${channelId}`);
                await presence.joinChannel(socket.id, channelId);

                // Get current occupants and broadcast presence update
                const occupantIds = await presence.getChannelOccupants(channelId);
                const occupants: IUserPresence[] = await Promise.all(
                    occupantIds.map(async (uid) => {
                        const p = await presence.getUserPresence(uid);
                        return {
                            userId: uid,
                            nickname: p?.nickname ?? "Unknown",
                            isMuted: false,
                            isDeafened: false,
                            isAway: false,
                        };
                    }),
                );

                io.to(`server:${socket.data.serverId}`).emit("PRESENCE_UPDATE", {
                    channelId,
                    occupants,
                });

                ack({ success: true });

                // Notify joining user of existing voice producers in this channel
                const existingProducers = mediasoup.getExistingProducers(
                    channelId,
                    socket.data.userId,
                );
                if (existingProducers.length > 0) {
                    // Look up nicknames for each producer
                    const producersWithNicknames = existingProducers.map((p) => {
                        const userSession = mediasoup.getSession(channelId, p.userId);
                        return {
                            userId: p.userId,
                            nickname: p.userId, // fallback — userId is socketId
                            producerId: p.producerId,
                        };
                    });
                    socket.emit("EXISTING_PRODUCERS", {
                        channelId,
                        producers: producersWithNicknames,
                    });
                }

                app.log.info(
                    { socketId: socket.id, channelId },
                    "User joined channel",
                );
            } catch (err) {
                app.log.error({ err }, "Error in USER_JOIN_CHANNEL");
                ack({ success: false, error: "Failed to join channel" });
            }
        });

        // ── USER_LEAVE_CHANNEL ──────────────────────────────────────────────
        socket.on("USER_LEAVE_CHANNEL", async (payload) => {
            try {
                const { channelId } = payload;

                await socket.leave(`channel:${channelId}`);
                await presence.leaveChannel(socket.id, channelId);

                // Clean up mediasoup voice session
                const producerId = mediasoup.getSession(channelId, socket.data.userId)?.producer?.id;
                if (producerId) {
                    socket.to(`channel:${channelId}`).emit("PRODUCER_CLOSED", {
                        userId: socket.data.userId,
                        producerId,
                    });
                }
                mediasoup.cleanupUserSession(channelId, socket.data.userId);

                socket.data.currentChannelId = null;

                // Broadcast updated occupants
                const occupantIds = await presence.getChannelOccupants(channelId);
                const occupants: IUserPresence[] = await Promise.all(
                    occupantIds.map(async (uid) => {
                        const p = await presence.getUserPresence(uid);
                        return {
                            userId: uid,
                            nickname: p?.nickname ?? "Unknown",
                            isMuted: false,
                            isDeafened: false,
                            isAway: false,
                        };
                    }),
                );

                io.to(`server:${socket.data.serverId}`).emit("PRESENCE_UPDATE", {
                    channelId,
                    occupants,
                });

                app.log.info({ socketId: socket.id, channelId }, "User left channel");
            } catch (err) {
                app.log.error({ err }, "Error in USER_LEAVE_CHANNEL");
            }
        });

        // ── DISCONNECT ──────────────────────────────────────────────────────
        socket.on("disconnect", async (reason) => {
            try {
                const { serverId, currentChannelId, nickname } = socket.data;

                if (serverId) {
                    // Clean up channel presence
                    if (currentChannelId) {
                        // Clean up mediasoup voice session
                        const producerId = mediasoup.getSession(currentChannelId, socket.id)?.producer?.id;
                        if (producerId) {
                            socket.to(`channel:${currentChannelId}`).emit("PRODUCER_CLOSED", {
                                userId: socket.id,
                                producerId,
                            });
                        }
                        mediasoup.cleanupUserSession(currentChannelId, socket.id);

                        await presence.leaveChannel(socket.id, currentChannelId);

                        // Broadcast updated occupants for the channel they were in
                        const occupantIds =
                            await presence.getChannelOccupants(currentChannelId);
                        const occupants: IUserPresence[] = await Promise.all(
                            occupantIds.map(async (uid) => {
                                const p = await presence.getUserPresence(uid);
                                return {
                                    userId: uid,
                                    nickname: p?.nickname ?? "Unknown",
                                    isMuted: false,
                                    isDeafened: false,
                                    isAway: false,
                                };
                            }),
                        );

                        io.to(`server:${serverId}`).emit("PRESENCE_UPDATE", {
                            channelId: currentChannelId,
                            occupants,
                        });
                    }

                    // Clean up server presence
                    await presence.leaveServer(socket.id, serverId);

                    io.to(`server:${serverId}`).emit("USER_LEFT", {
                        userId: socket.id,
                        serverId,
                    });
                }

                app.log.info(
                    { socketId: socket.id, nickname, reason },
                    "Client disconnected",
                );
            } catch (err) {
                app.log.error({ err }, "Error during disconnect cleanup");
            }
        });
    });
}
