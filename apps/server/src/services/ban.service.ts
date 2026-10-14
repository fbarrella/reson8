/**
 * The ban itself, shared by BAN_USER and by "Reject and ban" in the approval
 * queue (PRD 18.8): the user ban, disconnecting the user, and the optional
 * address/range ban (PRD 18.7). One implementation, so the two entry points
 * can never drift apart.
 *
 * The user ban always succeeds; anything that stops the ADDRESS part comes
 * back as a `warning`.
 */

import type { Server as SocketIOServer } from "socket.io";
import type { FastifyInstance } from "fastify";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
} from "@reson8/shared-types";
import { getTrustProxy, trustProxyExplicitlyOff } from "./client-address.js";
import {
    addressBans,
    cidrContains,
    isPrivateOrLoopback,
    normalizeIp,
    reloadAddressBans,
    toCidr,
    type BanScope,
} from "./address-ban.service.js";

type BanIO = SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export interface ExecuteBanInput {
    app: FastifyInstance;
    io: BanIO;
    serverId: string;
    /** The moderator doing it. */
    actor: { userId: string; nickname?: string; socketId?: string; address?: string };
    userId: string;
    nickname: string | null;
    /** Where to look when the user has no live socket (users.lastAddress, or a pending request's address). */
    fallbackAddress?: string | null;
    scope: BanScope | "none";
}

export interface ExecuteBanResult {
    warning?: string;
    addressBanned?: string;
}

/** Whether a socket belongs to `userId` on `serverId` — joined, or still waiting for approval. */
function isUsersSocket(s: { data: SocketData }, userId: string, serverId: string): boolean {
    return (s.data.userId === userId && s.data.serverId === serverId) || s.data.pendingUserId === userId;
}

export async function executeBan(input: ExecuteBanInput): Promise<ExecuteBanResult> {
    const { app, io, serverId, actor, userId, nickname, fallbackAddress, scope } = input;

    // The address to ban, read BEFORE the sockets are disconnected: the live
    // connection's if they're online, else the one they last joined from.
    let targetAddress: string | undefined;
    for (const [, s] of io.sockets.sockets) {
        if (isUsersSocket(s, userId, serverId) && s.data.clientAddress) {
            targetAddress = s.data.clientAddress;
            break;
        }
    }
    targetAddress ??= fallbackAddress ?? undefined;

    await app.prisma.bannedUser.upsert({
        where: { serverId_userId: { serverId, userId } },
        update: {},
        create: { serverId, userId, nickname: nickname ?? "Unknown", bannedByNickname: actor.nickname ?? null },
    });

    for (const [, s] of io.sockets.sockets) {
        if (isUsersSocket(s, userId, serverId)) {
            s.emit("USER_BANNED", {});
            s.disconnect(true);
        }
    }

    if (scope === "none") return {};

    const ip = normalizeIp(targetAddress);
    const cidr = ip ? toCidr(ip, scope) : null;
    if (!ip || !cidr) {
        return { warning: "No address is known for this user — only the user was banned." };
    }
    if (isPrivateOrLoopback(ip) && scope === "range") {
        return { warning: "A range of private-network addresses can't be banned — only the user was banned." };
    }
    if (isPrivateOrLoopback(ip) && !getTrustProxy().list.length && !trustProxyExplicitlyOff()) {
        // Behind a proxy that isn't trusted, EVERY client has the proxy's
        // address: banning it would ban everyone.
        return {
            warning:
                "This user's address is a private/loopback one, which usually means a reverse proxy sits in front " +
                "of the server. Set TRUST_PROXY (or TRUST_PROXY=false if there is none) first — only the user was banned.",
        };
    }
    if (actor.address && cidrContains(cidr, actor.address)) {
        return { warning: "That network includes your own address — only the user was banned." };
    }

    await app.prisma.bannedAddress.upsert({
        where: { serverId_cidr: { serverId, cidr } },
        update: { linkedUserId: userId, nickname },
        create: { serverId, cidr, linkedUserId: userId, nickname, createdBy: actor.userId },
    });
    await reloadAddressBans(app.prisma, serverId);

    // Everyone else already connected from that network goes too, except the
    // moderator and the designated admin.
    for (const [, s] of io.sockets.sockets) {
        if (
            s.id !== actor.socketId &&
            (s.data.userId || s.data.pendingUserId) &&
            s.data.userId !== process.env.ADMIN_INSTANCE_ID &&
            addressBans.isBanned(s.data.clientAddress)
        ) {
            s.emit("USER_BANNED", {});
            s.disconnect(true);
        }
    }
    return { addressBanned: cidr };
}
