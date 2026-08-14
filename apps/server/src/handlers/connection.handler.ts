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
    IChannelTreeNode,
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
 * Builds an occupant's presence DTO, resolving nickname with a database fallback
 * and carrying along their self-reported mute/deafen state.
 *
 * Fast path: Redis presence (available 99% of the time).
 * Slow path: Prisma User table (covers the race-condition window
 *            where presence was just deleted / not yet written) — voice
 *            state has no DB fallback since it's inherently ephemeral.
 */
export async function buildOccupant(
    userId: string,
    presence: PresenceService,
    prisma: FastifyInstance["prisma"],
): Promise<IUserPresence> {
    const p = await presence.getUserPresence(userId);
    if (p?.nickname) {
        return {
            userId,
            nickname: p.nickname,
            isMuted: p.isMuted,
            isDeafened: p.isDeafened,
            isAway: false,
        };
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { nickname: true },
    });
    return {
        userId,
        nickname: user?.nickname ?? "Unknown",
        isMuted: false,
        isDeafened: false,
        isAway: false,
    };
}

/** In-memory voice session start times (channelId → Date). */
export const voiceSessionStartedAt = new Map<string, Date>();

/**
 * Annotates each TEXT channel node in `tree` with `hasUnread`, comparing the
 * channel's latest message timestamp against the requesting user's
 * ChannelRead cursor (no cursor = unread only if the channel has any
 * messages at all, so brand-new channels never start "unread" for anyone).
 *
 * Only meaningful for the per-socket tree sent at join time — a single
 * broadcast tree is shared by every recipient, so this is never called for
 * broadcastTreeUpdate()-style updates triggered by other users' actions.
 */
async function annotateUnreadChannels(
    tree: IChannelTreeNode[],
    channelDtos: { id: string; type: string }[],
    userId: string,
    app: FastifyInstance,
): Promise<void> {
    const textChannelIds = channelDtos
        .filter((c) => c.type === "TEXT")
        .map((c) => c.id);
    if (textChannelIds.length === 0) return;

    const [latestMessages, readCursors] = await Promise.all([
        app.prisma.message.groupBy({
            by: ["channelId"],
            where: { channelId: { in: textChannelIds }, userId: { not: userId } },
            _max: { createdAt: true },
        }),
        app.prisma.channelRead.findMany({
            where: { userId, channelId: { in: textChannelIds } },
        }),
    ]);

    const latestMap = new Map<string, Date>();
    for (const row of latestMessages) {
        if (row._max.createdAt) latestMap.set(row.channelId, row._max.createdAt);
    }
    const lastReadMap = new Map(readCursors.map((r) => [r.channelId, r.lastReadAt]));

    function walk(nodes: IChannelTreeNode[]): void {
        for (const node of nodes) {
            const latest = latestMap.get(node.id);
            if (latest) {
                const lastRead = lastReadMap.get(node.id);
                node.hasUnread = !lastRead || latest > lastRead;
            }
            if (node.children.length > 0) walk(node.children);
        }
    }
    walk(tree);
}

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

        // ── PING_LATENCY — instant ack for client-side RTT + clock-offset
        // measurement (the server timestamp lets the client correct for
        // clock skew, see PRD 11.2) ────────────────────────────────────────
        socket.on("PING_LATENCY", (ack) => { ack(Date.now()); });

        // ── USER_JOIN_SERVER ────────────────────────────────────────────────
        socket.on("USER_JOIN_SERVER", async (payload, ack) => {
            try {
                const { nickname, instanceId, password } = payload;

                // Password check (if SERVER_PRIVATE_PASSWORD is set)
                const serverPassword = process.env.SERVER_PRIVATE_PASSWORD;
                if (serverPassword && password !== serverPassword) {
                    ack({ success: false, error: "Invalid server password" });
                    return;
                }

                // Use provided serverId or fall back to the bootstrapped one
                const serverId = payload.serverId || app.serverId;

                // Ban check — reject blacklisted instance IDs
                const banned = await app.prisma.bannedUser.findUnique({
                    where: { serverId_userId: { serverId, userId: instanceId } },
                });
                if (banned) {
                    ack({ success: false, error: "You are banned from this server" });
                    return;
                }

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
                    isNsfw: boolean;
                    createdAt: Date;
                }) => ({
                    id: ch.id,
                    serverId: ch.serverId,
                    name: ch.name,
                    type: ch.type as import("@reson8/shared-types").ChannelType,
                    parentId: ch.parentId,
                    position: ch.position,
                    maxUsers: ch.maxUsers,
                    isNsfw: ch.isNsfw,
                    createdAt: ch.createdAt.toISOString(),
                }));

                const tree = buildChannelTree(channelDtos);

                // Hydrate occupants from Redis presence so joining
                // clients see who is already in voice channels
                async function hydrateOccupants(
                    nodes: typeof tree,
                ): Promise<void> {
                    for (const node of nodes) {
                        const occupantIds =
                            await presence.getChannelOccupants(node.id);
                        if (occupantIds.length > 0) {
                            node.occupants = await Promise.all(
                                occupantIds.map((uid) => buildOccupant(uid, presence, app.prisma)),
                            );
                            // Bootstrap voice session start time for occupied voice channels
                            // (approximate — covers server-restart recovery)
                            const chMeta = channelDtos.find((c: { id: string }) => c.id === node.id);
                            if (chMeta && (chMeta.type as string) === "VOICE" && !voiceSessionStartedAt.has(node.id)) {
                                voiceSessionStartedAt.set(node.id, new Date());
                            }
                        }
                        if (node.children.length > 0) {
                            await hydrateOccupants(node.children);
                        }
                    }
                }
                await hydrateOccupants(tree);
                await annotateUnreadChannels(tree, channelDtos, instanceId, app);

                socket.emit("CHANNEL_TREE_UPDATE", { serverId, tree });

                ack({ success: true, serverId });
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

                // Full cleanup of previous channel if any
                if (socket.data.currentChannelId) {
                    const prevChannelId = socket.data.currentChannelId;

                    // Clean up mediasoup voice session in old channel
                    const producerId = mediasoup.getSession(prevChannelId, userId)?.producer?.id;
                    if (producerId) {
                        socket.to(`channel:${prevChannelId}`).emit("PRODUCER_CLOSED", {
                            userId,
                            producerId,
                        });
                    }
                    mediasoup.cleanupUserSession(prevChannelId, userId);

                    // Leave old channel presence + room
                    await presence.leaveChannel(userId, prevChannelId);
                    await socket.leave(`channel:${prevChannelId}`);

                    // Broadcast updated occupants for the old channel
                    const oldOccupantIds = await presence.getChannelOccupants(prevChannelId);
                    if (oldOccupantIds.length === 0) {
                        voiceSessionStartedAt.delete(prevChannelId);
                    }
                    const oldOccupants: IUserPresence[] = await Promise.all(
                        oldOccupantIds.map((uid) => buildOccupant(uid, presence, app.prisma)),
                    );
                    io.to(`server:${socket.data.serverId}`).emit("PRESENCE_UPDATE", {
                        channelId: prevChannelId,
                        occupants: oldOccupants,
                        sessionStartedAt: voiceSessionStartedAt.get(prevChannelId)?.toISOString(),
                    });
                }

                // Join new channel
                socket.data.currentChannelId = channelId;
                await socket.join(`channel:${channelId}`);
                await presence.joinChannel(userId, channelId);

                // Get current occupants and broadcast presence update
                const occupantIds = await presence.getChannelOccupants(channelId);

                // Start a new voice session if this is the first occupant in a voice channel
                if (occupantIds.length === 1) {
                    const ch = await app.prisma.channel.findUnique({
                        where: { id: channelId },
                        select: { type: true },
                    });
                    if (ch && ch.type === "VOICE") {
                        voiceSessionStartedAt.set(channelId, new Date());
                    }
                }

                const occupants: IUserPresence[] = await Promise.all(
                    occupantIds.map((uid) => buildOccupant(uid, presence, app.prisma)),
                );

                io.to(`server:${socket.data.serverId}`).emit("PRESENCE_UPDATE", {
                    channelId,
                    occupants,
                    sessionStartedAt: voiceSessionStartedAt.get(channelId)?.toISOString(),
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
                if (occupantIds.length === 0) {
                    voiceSessionStartedAt.delete(channelId);
                }
                const occupants: IUserPresence[] = await Promise.all(
                    occupantIds.map((uid) => buildOccupant(uid, presence, app.prisma)),
                );

                io.to(`server:${socket.data.serverId}`).emit("PRESENCE_UPDATE", {
                    channelId,
                    occupants,
                    sessionStartedAt: voiceSessionStartedAt.get(channelId)?.toISOString(),
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
                        if (occupantIds.length === 0) {
                            voiceSessionStartedAt.delete(currentChannelId);
                        }
                        const occupants: IUserPresence[] = await Promise.all(
                            occupantIds.map((uid) => buildOccupant(uid, presence, app.prisma)),
                        );

                        io.to(`server:${serverId}`).emit("PRESENCE_UPDATE", {
                            channelId: currentChannelId,
                            occupants,
                            sessionStartedAt: voiceSessionStartedAt.get(currentChannelId)?.toISOString(),
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
