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
import { buildChannelTree } from "../services/channel-tree.service.js";

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
                const { serverId, name, type, parentId } = payload;

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
                const { channelId, name, position } = payload;

                const data: Record<string, unknown> = {};
                if (name !== undefined) data.name = name.trim();
                if (position !== undefined) data.position = position;

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
