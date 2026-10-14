/**
 * Admin Handler — Socket.io event handlers for admin operations.
 *
 * Handles: GET_ALL_USERS, GET_ROLES, ASSIGN_ROLE, RESET_IDENTITY_KEY (PRD 17.12, ADMIN only).
 * GET_ROLES/ASSIGN_ROLE are guarded by MANAGE_ROLES (or ADMIN). GET_ALL_USERS
 * is guarded by MANAGE_ROLES *or* BAN_USER (PRD 13.17) — it backs the User
 * Management tab, which serves both role assignment and ban/unban, and a
 * BAN_USER-only holder still needs the full user list (including offline
 * users) to know who to ban.
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
} from "@reson8/shared-types";
import { requirePermission, requireAnyPermission } from "../middleware/permissions.middleware.js";
import { PermissionFlags } from "@reson8/shared-types";
import { revokeViewerTickets } from "../services/viewer-ticket.service.js";
import { getUserPermissions, isAdmin } from "../services/permissions.service.js";
import { decideRoleChange } from "../services/role-guard.js";
import { keyFingerprint } from "../services/identity.service.js";
import { syncModeratorRoom } from "./approval.handler.js";
import { adminUsersWhere, mapAdminUser } from "../services/admin-users.js";
import { applyAccessChange } from "../services/access-change.js";
import type { MediasoupService } from "../services/mediasoup.service.js";
import {
    fetchIdentityEventsPage,
    parseIdentityEventsQuery,
    recordIdentityEvent,
} from "../services/identity-events.service.js";

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
 * Registers admin/role-management event handlers.
 */
export function registerAdminHandlers(
    io: TypedIO,
    app: FastifyInstance,
    mediasoup: MediasoupService,
): void {
    io.on("connection", (socket: TypedSocket) => {
        // ── RESET_IDENTITY_KEY (PRD 17.12) ─────────────────────────────────
        // ADMIN only. Forgets the user's bound key so the next device that
        // connects as them binds a new one (reinstall, new computer, or an
        // impostor bound it first), and disconnects whoever is connected as
        // them right now so an impostor loses the session immediately.
        socket.on("RESET_IDENTITY_KEY", async (payload, ack) => {
            const allowed = await requirePermission(app, socket, BigInt(PermissionFlags.ADMIN));
            if (!allowed) {
                ack({ success: false, error: "Permission denied" });
                return;
            }
            try {
                const userId = payload?.userId;
                if (typeof userId !== "string" || userId.length === 0 || userId.length > 128) {
                    ack({ success: false, error: "User not found" });
                    return;
                }
                // Read what is about to be forgotten, for the identity log (PRD 18.4).
                const before = await app.prisma.user.findUnique({
                    where: { id: userId },
                    select: { nickname: true, publicKey: true },
                });
                const result = await app.prisma.user.updateMany({
                    where: { id: userId },
                    data: { publicKey: null, publicKeyBoundAt: null },
                });
                if (result.count === 0) {
                    ack({ success: false, error: "User not found" });
                    return;
                }
                void recordIdentityEvent(app, {
                    serverId: socket.data.serverId,
                    userId,
                    nickname: before?.nickname ?? "",
                    kind: "RESET",
                    fingerprint: before?.publicKey ? keyFingerprint(before.publicKey) : null,
                    address: socket.data.clientAddress ?? null,
                    actorId: socket.data.userId,
                });
                await revokeViewerTickets(app.redis, userId);
                let disconnected = 0;
                for (const [, s] of io.sockets.sockets) {
                    if (s.data.userId === userId && s.id !== socket.id) {
                        s.disconnect(true);
                        disconnected++;
                    }
                }
                app.log.warn(
                    { userId, byUserId: socket.data.userId, disconnectedSockets: disconnected },
                    "Identity key reset",
                );
                ack({ success: true });
            } catch (err) {
                app.log.error({ err }, "Error in RESET_IDENTITY_KEY");
                ack({ success: false, error: "Failed to reset the identity key" });
            }
        });

        // ── GET_IDENTITY_EVENTS (PRD 18.4) ─────────────────────────────────
        // ADMIN only: the log carries client addresses, so the permission is
        // checked here, not just hidden in the UI.
        socket.on("GET_IDENTITY_EVENTS", async (payload, ack) => {
            if (typeof ack !== "function") return;
            const allowed = await requirePermission(app, socket, BigInt(PermissionFlags.ADMIN));
            if (!allowed) {
                ack({ success: false, error: "Permission denied" });
                return;
            }
            const query = parseIdentityEventsQuery(payload);
            if (!query.ok) {
                ack({ success: false, error: query.error });
                return;
            }
            try {
                const page = await fetchIdentityEventsPage(app.prisma, socket.data.serverId, query.value);
                ack({ success: true, ...page });
            } catch (err) {
                app.log.error({ err }, "Error in GET_IDENTITY_EVENTS");
                ack({ success: false, error: "Failed to load the identity log" });
            }
        });

        // ── GET_ALL_USERS ──────────────────────────────────────────────────
        socket.on("GET_ALL_USERS", async (payload, ack) => {
            const allowed = await requireAnyPermission(
                app,
                socket,
                BigInt(PermissionFlags.MANAGE_ROLES),
                BigInt(PermissionFlags.BAN_USER),
            );
            if (!allowed) {
                ack({ success: false, error: "Permission denied" });
                return;
            }

            try {
                const { serverId } = payload;

                // Everyone who is a member of this server, with or without roles
                // (PRD 18.17): a user whose last role was removed must stay
                // listed, or nobody could give them one back or ban them.
                const [users, bannedUsers] = await Promise.all([
                    app.prisma.user.findMany({
                        where: adminUsersWhere(serverId),
                        include: {
                            roles: {
                                include: { role: true },
                                where: { role: { serverId } },
                            },
                        },
                        orderBy: { nickname: "asc" },
                    }),
                    app.prisma.bannedUser.findMany({
                        where: { serverId },
                        select: { userId: true },
                    }),
                ]);
                const bannedIds = new Set(bannedUsers.map((b) => b.userId));

                const mapped = users.map((u) => mapAdminUser(u, bannedIds));

                ack({ success: true, users: mapped });
            } catch (err) {
                app.log.error({ err }, "Error in GET_ALL_USERS");
                ack({ success: false, error: "Failed to fetch users" });
            }
        });

        // ── GET_ROLES ──────────────────────────────────────────────────────
        socket.on("GET_ROLES", async (payload, ack) => {
            const allowed = await requirePermission(
                app,
                socket,
                BigInt(PermissionFlags.MANAGE_ROLES),
            );
            if (!allowed) {
                ack({ success: false, error: "Permission denied" });
                return;
            }

            try {
                const { serverId } = payload;

                const roles = await app.prisma.role.findMany({
                    where: { serverId },
                    orderBy: { powerLevel: "desc" },
                });

                const mapped = roles.map((r) => ({
                    id: r.id,
                    serverId: r.serverId,
                    name: r.name,
                    permissions: r.permissions.toString(),
                    powerLevel: r.powerLevel,
                    color: r.color,
                    createdAt: r.createdAt.toISOString(),
                }));

                ack({ success: true, roles: mapped });
            } catch (err) {
                app.log.error({ err }, "Error in GET_ROLES");
                ack({ success: false, error: "Failed to fetch roles" });
            }
        });

        // ── ASSIGN_ROLE ────────────────────────────────────────────────────
        socket.on("ASSIGN_ROLE", async (payload, ack) => {
            const allowed = await requirePermission(
                app,
                socket,
                BigInt(PermissionFlags.MANAGE_ROLES),
            );
            if (!allowed) {
                ack({ success: false, error: "Permission denied" });
                return;
            }

            try {
                const { userId, roleId, action } = payload;

                // Safety rules (PRD 20 M1): the role must belong to THIS server, and an
                // admin change needs an admin; nobody removes their own admin/Member
                // role; the server keeps at least one admin.
                const serverId = socket.data.serverId;
                const role = await app.prisma.role.findFirst({ where: { id: roleId, serverId } });
                if (!role) {
                    ack({ success: false, error: "Role not found" });
                    return;
                }
                const adminBit = BigInt(PermissionFlags.ADMIN);
                const roleGrantsAdmin = (role.permissions & adminBit) !== 0n;
                const actorPerms = await getUserPermissions(app.prisma, socket.data.userId, serverId);
                const adminHolders = await app.prisma.userRole.findMany({
                    where: { role: { serverId } },
                    include: { role: { select: { id: true, permissions: true } } },
                });
                const holders = adminHolders.filter((ur) => (ur.role.permissions & adminBit) !== 0n);
                const decision = decideRoleChange({
                    actorId: socket.data.userId,
                    actorIsAdmin: isAdmin(actorPerms),
                    targetId: userId,
                    action,
                    roleGrantsAdmin,
                    isMemberRole: roleId === "role-default",
                    adminHolderCount: new Set(holders.map((h) => h.userId)).size,
                    targetHasOtherAdminRole: holders.some((h) => h.userId === userId && h.role.id !== roleId),
                });
                if (!decision.ok) {
                    ack({ success: false, error: decision.error });
                    return;
                }

                if (action === "add") {
                    await app.prisma.userRole.upsert({
                        where: {
                            userId_roleId: { userId, roleId },
                        },
                        update: {},
                        create: { userId, roleId },
                    });
                    app.log.info(
                        { userId, roleId },
                        "Role assigned to user",
                    );
                } else {
                    await app.prisma.userRole.deleteMany({
                        where: { userId, roleId },
                    });
                    app.log.info(
                        { userId, roleId },
                        "Role removed from user",
                    );
                }

                // Gaining or losing BAN_USER changes who hears about the approval queue (PRD 18.8).
                await syncModeratorRoom(app, io, userId, socket.data.serverId).catch(() => {});

                // Gaining or losing Member changes what they can use RIGHT NOW (PRD 18.18):
                // their sockets, the content room and any voice session follow.
                await applyAccessChange(io, app, mediasoup, userId, socket.data.serverId).catch((err) => {
                    app.log.error({ err }, "Failed to apply an access change");
                });

                ack({ success: true });
            } catch (err) {
                app.log.error({ err }, "Error in ASSIGN_ROLE");
                ack({ success: false, error: "Failed to assign role" });
            }
        });
    });
}
