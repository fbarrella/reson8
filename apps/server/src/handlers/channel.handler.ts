/**
 * Channel Handler — Socket.io events for channel CRUD.
 *
 * Handles: CREATE_CHANNEL, DELETE_CHANNEL, UPDATE_CHANNEL.
 * After each mutation, rebuilds the channel tree and broadcasts to all server members.
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
    ChannelType,
} from "@reson8/shared-types";
import { PermissionFlags } from "@reson8/shared-types";
import { buildChannelTree } from "../services/channel-tree.service.js";
import { requirePermission } from "../middleware/permissions.middleware.js";

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
 * Helper: rebuild the channel tree from DB and broadcast to all server members.
 */
async function broadcastTreeUpdate(
    app: FastifyInstance,
    io: TypedIO,
    serverId: string,
): Promise<void> {
    const channels = await app.prisma.channel.findMany({
        where: { serverId },
        orderBy: { position: "asc" },
    });

    const tree = buildChannelTree(
        channels.map((ch) => ({
            id: ch.id,
            serverId: ch.serverId,
            name: ch.name,
            type: ch.type as ChannelType,
            parentId: ch.parentId,
            position: ch.position,
            maxUsers: ch.maxUsers,
            isNsfw: ch.isNsfw,
            createdAt: ch.createdAt.toISOString(),
        })),
    );

    io.to(`server:${serverId}`).emit("CHANNEL_TREE_UPDATE", {
        serverId,
        tree,
    });
}

/**
 * Registers channel CRUD handlers on each socket connection.
 */
export function registerChannelHandlers(
    io: TypedIO,
    app: FastifyInstance,
): void {
    io.on("connection", (socket: TypedSocket) => {
        // ── CREATE_CHANNEL ──────────────────────────────────────────────────
        socket.on("CREATE_CHANNEL", async (payload, ack) => {
            try {
                const { serverId, name, type, parentId, isNsfw } = payload;

                // Permission check: CREATE_CHANNEL
                const allowed = await requirePermission(
                    app, socket, BigInt(PermissionFlags.CREATE_CHANNEL),
                );
                if (!allowed) {
                    ack({ success: false, error: "Permission denied" });
                    return;
                }

                if (!name || name.trim().length === 0) {
                    ack({ success: false, error: "Channel name is required" });
                    return;
                }

                const channel = await app.prisma.channel.create({
                    data: {
                        serverId,
                        name: name.trim(),
                        type: type as any,
                        parentId: parentId ?? null,
                        position: await getNextPosition(app, serverId, parentId ?? null),
                        isNsfw: type === "TEXT" ? (isNsfw ?? false) : false,
                    },
                });

                ack({ success: true, channelId: channel.id });

                // Broadcast the updated tree to all server members
                await broadcastTreeUpdate(app, io, serverId);

                app.log.info(
                    { socketId: socket.id, channelId: channel.id, name: channel.name },
                    "Channel created",
                );
            } catch (err) {
                app.log.error({ err }, "Error in CREATE_CHANNEL");
                ack({ success: false, error: "Failed to create channel" });
            }
        });

        // ── DELETE_CHANNEL ──────────────────────────────────────────────────
        socket.on("DELETE_CHANNEL", async (payload, ack) => {
            try {
                const { channelId } = payload;

                // Permission check: MANAGE_CHANNELS
                const allowed = await requirePermission(
                    app, socket, BigInt(PermissionFlags.MANAGE_CHANNELS),
                );
                if (!allowed) {
                    ack({ success: false, error: "Permission denied" });
                    return;
                }

                const channel = await app.prisma.channel.findUnique({
                    where: { id: channelId },
                });

                if (!channel) {
                    ack({ success: false, error: "Channel not found" });
                    return;
                }

                // Cascade: Prisma schema has onDelete: Cascade for messages,
                // and onDelete: SetNull for children
                await app.prisma.channel.delete({
                    where: { id: channelId },
                });

                ack({ success: true });

                // Broadcast updated tree
                await broadcastTreeUpdate(app, io, channel.serverId);

                // Notify about deletion
                io.to(`server:${channel.serverId}`).emit("CHANNEL_DELETED", {
                    serverId: channel.serverId,
                    channelId,
                });

                app.log.info(
                    { socketId: socket.id, channelId, name: channel.name },
                    "Channel deleted",
                );
            } catch (err) {
                app.log.error({ err }, "Error in DELETE_CHANNEL");
                ack({ success: false, error: "Failed to delete channel" });
            }
        });

        // ── UPDATE_CHANNEL ──────────────────────────────────────────────────
        socket.on("UPDATE_CHANNEL", async (payload, ack) => {
            try {
                const { channelId, name, position, isNsfw } = payload;

                // Permission check: MANAGE_CHANNELS
                const allowed = await requirePermission(
                    app, socket, BigInt(PermissionFlags.MANAGE_CHANNELS),
                );
                if (!allowed) {
                    ack({ success: false, error: "Permission denied" });
                    return;
                }

                if (name !== undefined && name.trim().length === 0) {
                    ack({ success: false, error: "Channel name is required" });
                    return;
                }

                const data: Record<string, unknown> = {};
                if (name !== undefined) data.name = name.trim();
                if (position !== undefined) data.position = position;

                // isNsfw only makes sense on text channels — look up type when
                // it's part of this update so a stray value on a voice channel
                // is silently ignored rather than stored.
                if (isNsfw !== undefined) {
                    const existing = await app.prisma.channel.findUnique({
                        where: { id: channelId },
                        select: { type: true },
                    });
                    if (existing?.type === "TEXT") {
                        data.isNsfw = isNsfw;
                    }
                }

                if (Object.keys(data).length === 0) {
                    ack({ success: false, error: "No changes provided" });
                    return;
                }

                const channel = await app.prisma.channel.update({
                    where: { id: channelId },
                    data,
                });

                ack({ success: true });

                await broadcastTreeUpdate(app, io, channel.serverId);

                app.log.info(
                    { socketId: socket.id, channelId, changes: data },
                    "Channel updated",
                );
            } catch (err) {
                app.log.error({ err }, "Error in UPDATE_CHANNEL");
                ack({ success: false, error: "Failed to update channel" });
            }
        });

        // ── REORDER_CHANNELS ────────────────────────────────────────────────
        socket.on("REORDER_CHANNELS", async (payload, ack) => {
            try {
                const { parentId, orderedChannelIds } = payload;

                const allowed = await requirePermission(
                    app, socket, BigInt(PermissionFlags.MANAGE_CHANNELS),
                );
                if (!allowed) {
                    ack({ success: false, error: "Permission denied" });
                    return;
                }

                const serverId = socket.data.serverId;
                if (!serverId) {
                    ack({ success: false, error: "Not connected to a server" });
                    return;
                }

                // Validate the provided ID set is exactly the current siblings
                // under parentId on this server — rejects stale/foreign IDs
                // rather than silently reassigning positions for a partial set.
                const siblings = await app.prisma.channel.findMany({
                    where: { serverId, parentId },
                    select: { id: true },
                });
                const siblingIds = new Set(siblings.map((s) => s.id));
                const isValidSet =
                    orderedChannelIds.length === siblingIds.size &&
                    orderedChannelIds.every((id) => siblingIds.has(id));

                if (!isValidSet) {
                    ack({ success: false, error: "Channel set does not match current siblings" });
                    return;
                }

                await app.prisma.$transaction(
                    orderedChannelIds.map((id, index) =>
                        app.prisma.channel.update({
                            where: { id },
                            data: { position: index },
                        }),
                    ),
                );

                ack({ success: true });

                await broadcastTreeUpdate(app, io, serverId);

                app.log.info(
                    { socketId: socket.id, parentId, count: orderedChannelIds.length },
                    "Channels reordered",
                );
            } catch (err) {
                app.log.error({ err }, "Error in REORDER_CHANNELS");
                ack({ success: false, error: "Failed to reorder channels" });
            }
        });

        // ── PIN_MESSAGE ─────────────────────────────────────────────────────
        socket.on("PIN_MESSAGE", async (payload, ack) => {
            try {
                const { channelId, messageId } = payload;

                const allowed = await requirePermission(
                    app, socket, BigInt(PermissionFlags.MANAGE_CHANNELS),
                );
                if (!allowed) {
                    ack({ success: false, error: "Permission denied" });
                    return;
                }

                const channel = await app.prisma.channel.findUnique({ where: { id: channelId } });
                if (!channel) {
                    ack({ success: false, error: "Channel not found" });
                    return;
                }
                if (channel.type !== "TEXT") {
                    ack({ success: false, error: "Only text channels can have a pinned message" });
                    return;
                }

                const message = await app.prisma.message.findUnique({
                    where: { id: messageId },
                    include: { user: { select: { nickname: true } } },
                });
                if (!message || message.channelId !== channelId) {
                    ack({ success: false, error: "Message not found in this channel" });
                    return;
                }

                await app.prisma.channel.update({
                    where: { id: channelId },
                    data: { pinnedMessageId: messageId },
                });

                ack({ success: true });

                io.to(`server:${channel.serverId}`).emit("CHANNEL_PIN_UPDATED", {
                    channelId,
                    channelName: channel.name,
                    pinnedMessage: {
                        id: message.id,
                        content: message.content,
                        authorNickname: message.user.nickname,
                        createdAt: message.createdAt.toISOString(),
                    },
                    actedByNickname: socket.data.nickname,
                });

                app.log.info({ socketId: socket.id, channelId, messageId }, "Message pinned");
            } catch (err) {
                app.log.error({ err }, "Error in PIN_MESSAGE");
                ack({ success: false, error: "Failed to pin message" });
            }
        });

        // ── UNPIN_MESSAGE ───────────────────────────────────────────────────
        socket.on("UNPIN_MESSAGE", async (payload, ack) => {
            try {
                const { channelId } = payload;

                const allowed = await requirePermission(
                    app, socket, BigInt(PermissionFlags.MANAGE_CHANNELS),
                );
                if (!allowed) {
                    ack({ success: false, error: "Permission denied" });
                    return;
                }

                const channel = await app.prisma.channel.update({
                    where: { id: channelId },
                    data: { pinnedMessageId: null },
                });

                ack({ success: true });

                io.to(`server:${channel.serverId}`).emit("CHANNEL_PIN_UPDATED", {
                    channelId,
                    channelName: channel.name,
                    pinnedMessage: null,
                    actedByNickname: socket.data.nickname,
                });

                app.log.info({ socketId: socket.id, channelId }, "Message unpinned");
            } catch (err) {
                app.log.error({ err }, "Error in UNPIN_MESSAGE");
                ack({ success: false, error: "Failed to unpin message" });
            }
        });
    });
}

/**
 * Gets the next position value for a new channel at the given parent level.
 */
async function getNextPosition(
    app: FastifyInstance,
    serverId: string,
    parentId: string | null,
): Promise<number> {
    const max = await app.prisma.channel.aggregate({
        where: { serverId, parentId },
        _max: { position: true },
    });
    return (max._max.position ?? -1) + 1;
}
