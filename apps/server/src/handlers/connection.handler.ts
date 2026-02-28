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
                const { serverId, nickname, instanceId } = payload;

                // Use the persistent instance ID as userId
                socket.data.serverId = serverId;
                socket.data.nickname = nickname;
                socket.data.userId = instanceId;
                socket.data.currentChannelId = null;

                // Auto-create (upsert) User record for this instance
                await app.prisma.user.upsert({
                    where: { id: instanceId },
                    update: { nickname },
                    create: {
                        id: instanceId,
                        username: instanceId,
                        nickname,
                        password: "instance-auth", // no real auth — instance-based
                    },
                });

                // Assign the default Member role
                const rolesToAssign = ["role-default"];

                // Check if this instance is the designated server admin
                if (
                    process.env.ADMIN_INSTANCE_ID &&
                    instanceId === process.env.ADMIN_INSTANCE_ID
                ) {
                    rolesToAssign.push("role-admin");
                }

                for (const roleId of rolesToAssign) {
                    await app.prisma.userRole.upsert({
                        where: {
                            userId_roleId: {
                                userId: instanceId,
                                roleId: roleId,
                            },
                        },
                        update: {},
                        create: {
                            userId: instanceId,
                            roleId: roleId,
                        },
                    });
                }

                // Join the Socket.io room for this server
                await socket.join(`server:${serverId}`);

                // Register presence in Redis
                await presence.joinServer(instanceId, serverId, nickname);

                // Notify all other clients in the server
                socket.to(`server:${serverId}`).emit("USER_JOINED", {
                    userId: instanceId,
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
                    { socketId: socket.id, nickname, serverId, instanceId },
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

                await presence.leaveServer(socket.data.userId, serverId);
                await socket.leave(`server:${serverId}`);

                socket.to(`server:${serverId}`).emit("USER_LEFT", {
                    userId: socket.data.userId,
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
                const userId = socket.data.userId;

                // Leave previous channel room if any
                if (socket.data.currentChannelId) {
                    await socket.leave(`channel:${socket.data.currentChannelId}`);
                }

                // Join new channel
                socket.data.currentChannelId = channelId;
                await socket.join(`channel:${channelId}`);
                await presence.joinChannel(userId, channelId);

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
                    userId,
                );
                if (existingProducers.length > 0) {
                    // Look up nicknames for each producer
                    const producersWithNicknames = existingProducers.map((p) => {
                        const userSession = mediasoup.getSession(channelId, p.userId);
                        return {
                            userId: p.userId,
                            nickname: p.userId, // fallback — userId is instanceId
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
                const userId = socket.data.userId;

                await socket.leave(`channel:${channelId}`);
                await presence.leaveChannel(userId, channelId);

                // Clean up mediasoup voice session
                const producerId = mediasoup.getSession(channelId, userId)?.producer?.id;
                if (producerId) {
                    socket.to(`channel:${channelId}`).emit("PRODUCER_CLOSED", {
                        userId,
                        producerId,
                    });
                }
                mediasoup.cleanupUserSession(channelId, userId);

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
                const { serverId, currentChannelId, nickname, userId } = socket.data;

                if (serverId) {
                    // Clean up channel presence
                    if (currentChannelId) {
                        // Clean up mediasoup voice session
                        const producerId = mediasoup.getSession(currentChannelId, userId)?.producer?.id;
                        if (producerId) {
                            socket.to(`channel:${currentChannelId}`).emit("PRODUCER_CLOSED", {
                                userId,
                                producerId,
                            });
                        }
                        mediasoup.cleanupUserSession(currentChannelId, userId);

                        await presence.leaveChannel(userId, currentChannelId);

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
                    await presence.leaveServer(userId, serverId);

                    io.to(`server:${serverId}`).emit("USER_LEFT", {
                        userId,
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
