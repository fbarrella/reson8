/**
 * Applies a change in a user's access to the server's channels, DMs and voice
 * (PRD 18.18) to everything that is live: their sockets' cached state, the
 * `members:<serverId>` room that content events are broadcast to, their voice
 * session and any Viewer window.
 */

import type { Server as SocketIOServer } from "socket.io";
import type { FastifyInstance } from "fastify";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
} from "@reson8/shared-types";
import { PresenceService } from "./presence.service.js";
import type { MediasoupService } from "./mediasoup.service.js";
import { getUserPermissions } from "./permissions.service.js";
import { hasServerAccess } from "./access.service.js";
import { revokeViewerTickets } from "./viewer-ticket.service.js";
import { broadcastChannelOccupants, removeSocketFromChannel } from "./voice-session.service.js";

type TypedIO = SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export const membersRoom = (serverId: string): string => `members:${serverId}`;

/**
 * Recomputes `userId`'s access and, if it differs from what their live sockets
 * hold, updates them. Safe to call after any role change; a user who is not
 * connected simply has nothing to update (the next join computes it).
 */
export async function applyAccessChange(
    io: TypedIO,
    app: FastifyInstance,
    mediasoup: MediasoupService,
    userId: string,
    serverId: string,
): Promise<{ hasAccess: boolean; changedSockets: number }> {
    const perms = await getUserPermissions(app.prisma, userId, serverId);
    const hasAccess = hasServerAccess(perms);
    const presence = new PresenceService(app.redis);

    let changedSockets = 0;
    const affectedChannels = new Set<string>();

    for (const [, s] of io.sockets.sockets) {
        if (s.data.userId !== userId || s.data.serverId !== serverId) continue;

        if (s.data.role === "viewer") {
            // A Viewer window exists only for a member; without access it goes away.
            if (!hasAccess) s.disconnect(true);
            continue;
        }

        const previous = s.data.hasAccess === true;
        if (previous === hasAccess) continue;
        changedSockets++;
        s.data.hasAccess = hasAccess;

        if (hasAccess) {
            await s.join(membersRoom(serverId));
        } else {
            await s.leave(membersRoom(serverId));
            // Out of voice, quietly: no "kicked" message or sound.
            const channelId = s.data.currentChannelId;
            if (channelId) {
                await removeSocketFromChannel({ mediasoup, presence }, s, channelId);
                affectedChannels.add(channelId);
            }
        }
        s.emit("ACCESS_CHANGED", { hasAccess });
    }

    if (!hasAccess) {
        await revokeViewerTickets(app.redis, userId).catch(() => {});
        for (const channelId of affectedChannels) {
            await broadcastChannelOccupants(io, app, presence, serverId, channelId).catch(() => {});
        }
    }
    return { hasAccess, changedSockets };
}
