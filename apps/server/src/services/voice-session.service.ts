/**
 * Taking a user out of a voice channel from the server side — shared by the
 * moderator's KICK_USER and by losing server access (PRD 18.18), so both tear
 * the session down exactly the same way. What differs is only what is told to
 * the user: a kick announces itself (`USER_KICKED` + the channel's
 * `CHANNEL_USER_KICKED`), losing access does not.
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
import type { PresenceService } from "./presence.service.js";
import type { MediasoupService } from "./mediasoup.service.js";
import { buildOccupant } from "../handlers/connection.handler.js";

type TypedIO = SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

/**
 * Closes this socket's voice session in `channelId`, removes it from the
 * channel's presence and room, and clears `currentChannelId`. Does not tell
 * the user anything and does not broadcast occupants (see
 * `broadcastChannelOccupants`).
 */
export async function removeSocketFromChannel(
    deps: { mediasoup: MediasoupService; presence: PresenceService },
    socket: TypedSocket,
    channelId: string,
): Promise<void> {
    const userId = socket.data.userId;
    const producerId = deps.mediasoup.getSession(channelId, userId)?.producer?.id;
    if (producerId) {
        socket.to(`channel:${channelId}`).emit("PRODUCER_CLOSED", { userId, producerId });
    }
    deps.mediasoup.cleanupUserSession(channelId, userId);

    // Leave channel presence + room
    await deps.presence.leaveChannel(userId, channelId);
    await socket.leave(`channel:${channelId}`);
    socket.data.currentChannelId = null;
}

/** Tells everyone in the server who is in `channelId` now. */
export async function broadcastChannelOccupants(
    io: TypedIO,
    app: FastifyInstance,
    presence: PresenceService,
    serverId: string,
    channelId: string,
): Promise<void> {
    const occupantIds = await presence.getChannelOccupants(channelId);
    const occupants: IUserPresence[] = await Promise.all(
        occupantIds.map((uid) => buildOccupant(uid, presence, app.prisma)),
    );
    io.to(`server:${serverId}`).emit("PRESENCE_UPDATE", { channelId, occupants });
}
