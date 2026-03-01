/**
 * Admin Handler — Socket.io event handlers for admin operations.
 *
 * Handles: GET_ALL_USERS, GET_ROLES, ASSIGN_ROLE.
 * All events are guarded by the MANAGE_ROLES or ADMIN permission.
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
} from "@reson8/shared-types";
import { requirePermission } from "../middleware/permissions.middleware.js";
import { PermissionFlags } from "@reson8/shared-types";

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
): void {
    io.on("connection", (socket: TypedSocket) => {
        // ── GET_ALL_USERS ──────────────────────────────────────────────────
        socket.on("GET_ALL_USERS", async (payload, ack) => {
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

                // Get all users that have at least one role on this server
                const users = await app.prisma.user.findMany({
                    where: {
                        roles: {
                            some: {
                                role: { serverId },
                            },
                        },
                    },
                    include: {
                        roles: {
                            include: { role: true },
                            where: { role: { serverId } },
                        },
                    },
                    orderBy: { nickname: "asc" },
                });

                const mapped = users.map((u) => ({
                    id: u.id,
                    username: u.username,
                    nickname: u.nickname,
                    createdAt: u.createdAt.toISOString(),
                    roles: u.roles.map((ur) => ({
                        id: ur.role.id,
                        serverId: ur.role.serverId,
                        name: ur.role.name,
                        permissions: ur.role.permissions.toString(),
                        powerLevel: ur.role.powerLevel,
                        color: ur.role.color,
                        createdAt: ur.role.createdAt.toISOString(),
                    })),
                }));

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

                ack({ success: true });
            } catch (err) {
                app.log.error({ err }, "Error in ASSIGN_ROLE");
                ack({ success: false, error: "Failed to assign role" });
            }
        });
    });
}
