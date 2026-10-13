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

/**
 * In-memory voice session start times (channelId → Date): set when the first
 * occupant joins a voice room, deleted when its occupant set is empty. Kept in
 * memory on purpose (PRD 19 decision D5): after a server restart a still-
 * occupied room is re-seeded with "now" at the next join, so its timer
 * restarts. `connection.handler.ts` re-exports it — there is ONE map.
 */
export const voiceSessionStartedAt = new Map<string, Date>();

/**
 * The PRESENCE_UPDATE payload for a channel. Clears the session start when the
 * room is empty (PRD 19 A3). It reads the occupant set from Redis presence, so
 * a room is only ever cleared once the ownership-checked paths have actually
 * removed its last occupant — never call it from a raw disconnect path.
 */
export async function presencePayload(
    app: Pick<FastifyInstance, "prisma">,
    presence: Pick<PresenceService, "getChannelOccupants" | "getUserPresence">,
    channelId: string,
): Promise<{ channelId: string; occupants: IUserPresence[]; sessionStartedAt?: string }> {
    const occupantIds = await presence.getChannelOccupants(channelId);
    if (occupantIds.length === 0) voiceSessionStartedAt.delete(channelId);
    const occupants = await Promise.all(
        occupantIds.map((uid) => buildOccupant(uid, presence as PresenceService, app.prisma)),
    );
    const startedAt = voiceSessionStartedAt.get(channelId);
    return startedAt
        ? { channelId, occupants, sessionStartedAt: startedAt.toISOString() }
        : { channelId, occupants };
}

/**
 * Fills `occupants` on every node of a channel tree from Redis presence
 * (PRD 19 P12), recursively. Shared by the join-time tree and every tree
 * broadcast: a tree built from the database alone has `occupants: []`, which
 * made every voice room look empty on every client after any channel change.
 * An occupied voice room with no running session start gets one now
 * (approximate; covers a server restart).
 */
export async function hydrateOccupants(
    nodes: {
        id: string;
        type: string;
        occupants: IUserPresence[];
        children: unknown[];
    }[],
    presence: Pick<PresenceService, "getChannelOccupants" | "getUserPresence">,
    prisma: FastifyInstance["prisma"],
): Promise<void> {
    for (const node of nodes) {
        const occupantIds = await presence.getChannelOccupants(node.id);
        if (occupantIds.length > 0) {
            node.occupants = await Promise.all(
                occupantIds.map((uid) => buildOccupant(uid, presence as PresenceService, prisma)),
            );
            if (node.type === "VOICE" && !voiceSessionStartedAt.has(node.id)) {
                voiceSessionStartedAt.set(node.id, new Date());
            }
        }
        if (node.children.length > 0) {
            await hydrateOccupants(node.children as typeof nodes, presence, prisma);
        }
    }
}

/**
 * Sets `sessionStartedAt` on every voice node whose room has a running
 * session (recursively). `requireOccupants` is for trees that carry occupants
 * (the join-time tree): a stale map entry for an empty room is then ignored.
 * Broadcast trees carry no occupants, so they rely on the map alone.
 */
export function annotateSessionStarts(
    nodes: { id: string; type: string; occupants: unknown[]; sessionStartedAt?: string; children: unknown[] }[],
    requireOccupants = false,
): void {
    for (const node of nodes) {
        if (node.type === "VOICE" && (!requireOccupants || node.occupants.length > 0)) {
            const startedAt = voiceSessionStartedAt.get(node.id);
            if (startedAt) node.sessionStartedAt = startedAt.toISOString();
        }
        if (node.children.length > 0) annotateSessionStarts(node.children as typeof nodes, requireOccupants);
    }
}

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
    io.to(`server:${serverId}`).emit("PRESENCE_UPDATE", await presencePayload(app, presence, channelId));
}
