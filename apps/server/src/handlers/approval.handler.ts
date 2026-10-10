/**
 * Moderator side of "Approve new users" (PRD 18.8): the queue, approve, and
 * reject (optionally with a ban). The waiting side — queueing a new identity
 * at sign-in — is in connection.handler.ts, next to the identity decision it
 * depends on.
 *
 * Who may decide: holders of BAN_USER (the people who already run User
 * Management) and ADMINs (hasPermission's ADMIN bypass). Turning the whole
 * mode on or off is ADMIN-only, like every server-wide setting.
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
} from "@reson8/shared-types";
import { PermissionFlags } from "@reson8/shared-types";
import { requirePermission } from "../middleware/permissions.middleware.js";
import { getUserPermissions, hasPermission, isAdmin } from "../services/permissions.service.js";
import { executeBan } from "../services/ban.service.js";
import { normalizeIp } from "../services/address-ban.service.js";
import { recordIdentityEvent } from "../services/identity-events.service.js";
import { moderatorsRoom, pendingRoom, toPendingDto } from "../services/approval.service.js";

type TypedIO = SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const BAN_USER = BigInt(PermissionFlags.BAN_USER);

/** Marks that the approval queue changed, for everyone who can act on it. */
export async function notifyPendingChanged(
    app: FastifyInstance,
    io: TypedIO,
    serverId: string,
    added = false,
): Promise<void> {
    try {
        const count = await app.prisma.pendingApproval.count({ where: { serverId } });
        io.to(moderatorsRoom(serverId)).emit("PENDING_APPROVALS_CHANGED", { count, added });
    } catch (err) {
        app.log.warn({ err }, "Couldn't announce an approval queue change");
    }
}

/**
 * Keeps a user's sockets in (or out of) the moderators room in step with
 * their permissions. Called after a join and after a role change.
 */
export async function syncModeratorRoom(
    app: FastifyInstance,
    io: TypedIO,
    userId: string,
    serverId: string,
): Promise<void> {
    const perms = await getUserPermissions(app.prisma, userId, serverId);
    const isModerator = hasPermission(perms, BAN_USER);
    for (const [, s] of io.sockets.sockets) {
        if (s.data.userId !== userId || s.data.serverId !== serverId || s.data.role !== "primary") continue;
        if (isModerator) await s.join(moderatorsRoom(serverId));
        else await s.leave(moderatorsRoom(serverId));
    }
}

export function registerApprovalHandlers(io: TypedIO, app: FastifyInstance): void {
    io.on("connection", (socket: TypedSocket) => {
        // ── GET_PENDING_APPROVALS ──────────────────────────────────────────
        socket.on("GET_PENDING_APPROVALS", async (ack) => {
            if (typeof ack !== "function") return;
            if (!(await requirePermission(app, socket, BAN_USER))) {
                ack({ success: false, error: "Permission denied" });
                return;
            }
            try {
                const serverId = socket.data.serverId;
                const perms = await getUserPermissions(app.prisma, socket.data.userId, serverId);
                const fullAddress = isAdmin(perms);
                const rows = await app.prisma.pendingApproval.findMany({
                    where: { serverId },
                    orderBy: { requestedAt: "asc" },
                });
                ack({
                    success: true,
                    requests: rows.map((r) =>
                        toPendingDto(r, {
                            online: (io.sockets.adapter.rooms.get(pendingRoom(r.userId))?.size ?? 0) > 0,
                            fullAddress,
                        }),
                    ),
                });
            } catch (err) {
                app.log.error({ err }, "Error in GET_PENDING_APPROVALS");
                ack({ success: false, error: "Failed to load the approval queue" });
            }
        });

        // ── APPROVE_USER ───────────────────────────────────────────────────
        socket.on("APPROVE_USER", async (payload, ack) => {
            if (typeof ack !== "function") return;
            if (!(await requirePermission(app, socket, BAN_USER))) {
                ack({ success: false, error: "Permission denied" });
                return;
            }
            try {
                const userId = payload?.userId;
                if (typeof userId !== "string" || userId.length === 0 || userId.length > 128) {
                    ack({ success: false, error: "Invalid user" });
                    return;
                }
                const serverId = socket.data.serverId;
                const request = await app.prisma.pendingApproval.findUnique({
                    where: { serverId_userId: { serverId, userId } },
                });
                if (!request) {
                    ack({ success: false, error: "That request was already handled" });
                    return;
                }

                // One transaction: the user (with the requested key ALREADY bound, so
                // no one can slip in between approval and first join), their default
                // role, and removal of the request. Two moderators approving at the
                // same time: the second finds the user and fails cleanly.
                const lastAddress = normalizeIp(request.address);
                let alreadyMember = false;
                await app.prisma.$transaction(async (tx) => {
                    const existing = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
                    if (existing) {
                        alreadyMember = true;
                        await tx.pendingApproval.deleteMany({ where: { id: request.id } });
                        return;
                    }
                    await tx.user.create({
                        data: {
                            id: userId,
                            username: userId,
                            nickname: request.nickname,
                            password: "instance-auth", // identity is the bound key, not a password
                            publicKey: request.publicKey,
                            publicKeyBoundAt: new Date(),
                            ...(lastAddress ? { lastAddress, lastAddressAt: new Date() } : {}),
                        },
                    });
                    await tx.userRole.create({ data: { userId, roleId: "role-default" } });
                    await tx.pendingApproval.delete({ where: { id: request.id } });
                });
                if (alreadyMember) {
                    ack({ success: false, error: "That person is already a member" });
                    return;
                }

                // The identity log (PRD 18.4) shows who let whom in.
                void recordIdentityEvent(app, {
                    serverId,
                    userId,
                    nickname: request.nickname,
                    kind: "BOUND",
                    fingerprint: request.fingerprint,
                    address: request.address,
                    host: request.host,
                    actorId: socket.data.userId,
                });

                io.to(pendingRoom(userId)).emit("APPROVAL_GRANTED", {});
                void notifyPendingChanged(app, io, serverId);
                ack({ success: true });
                app.log.info({ adminId: socket.data.userId, approvedUserId: userId, serverId }, "New user approved");
            } catch (err) {
                app.log.error({ err }, "Error in APPROVE_USER");
                ack({ success: false, error: "Failed to approve this person" });
            }
        });

        // ── REJECT_USER ────────────────────────────────────────────────────
        socket.on("REJECT_USER", async (payload, ack) => {
            if (typeof ack !== "function") return;
            if (!(await requirePermission(app, socket, BAN_USER))) {
                ack({ success: false, error: "Permission denied" });
                return;
            }
            try {
                const userId = payload?.userId;
                if (typeof userId !== "string" || userId.length === 0 || userId.length > 128) {
                    ack({ success: false, error: "Invalid user" });
                    return;
                }
                const scope = payload.addressBan ?? "none";
                if (scope !== "none" && scope !== "exact" && scope !== "range") {
                    ack({ success: false, error: "Invalid address ban option" });
                    return;
                }
                const serverId = socket.data.serverId;
                const request = await app.prisma.pendingApproval.findUnique({
                    where: { serverId_userId: { serverId, userId } },
                });
                if (!request) {
                    ack({ success: false, error: "That request was already handled" });
                    return;
                }

                await app.prisma.pendingApproval.deleteMany({ where: { id: request.id } });

                let warning: string | undefined;
                if (payload.ban === true) {
                    // Same ban (and optional address ban) as BAN_USER; it also
                    // disconnects the waiting socket with USER_BANNED.
                    const result = await executeBan({
                        app,
                        io,
                        serverId,
                        actor: {
                            userId: socket.data.userId,
                            socketId: socket.id,
                            address: socket.data.clientAddress,
                        },
                        userId,
                        nickname: request.nickname,
                        fallbackAddress: request.address,
                        scope,
                    });
                    warning = result.warning;
                } else {
                    io.to(pendingRoom(userId)).emit("APPROVAL_REJECTED", {});
                    io.in(pendingRoom(userId)).disconnectSockets(true);
                }

                void notifyPendingChanged(app, io, serverId);
                ack({ success: true, ...(warning ? { warning } : {}) });
                app.log.info(
                    { adminId: socket.data.userId, rejectedUserId: userId, serverId, banned: payload.ban === true },
                    "New user declined",
                );
            } catch (err) {
                app.log.error({ err }, "Error in REJECT_USER");
                ack({ success: false, error: "Failed to decline this person" });
            }
        });
    });
}
