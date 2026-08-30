/**
 * Permissions Middleware — guards Socket.io event handlers.
 *
 * Provides a `requirePermission` helper that resolves the socket user's
 * effective permissions and checks the required flag.  If the check fails,
 * returns `false` (callers should ack with an error and `return`).
 */

import type { FastifyInstance } from "fastify";
import type { Socket } from "socket.io";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
} from "@reson8/shared-types";
import { getUserPermissions, hasPermission, hasAnyPermission } from "../services/permissions.service.js";

type TypedSocket = Socket<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>;

/**
 * Checks whether the socket's user has the required permission.
 *
 * @returns `true` if allowed, `false` if denied.
 *          On denial the socket receives an ERROR event.
 */
export async function requirePermission(
    app: FastifyInstance,
    socket: TypedSocket,
    permission: bigint,
): Promise<boolean> {
    const userId = socket.data.userId;
    const serverId = socket.data.serverId;

    if (!userId || !serverId) {
        socket.emit("ERROR", {
            code: "NOT_AUTHENTICATED",
            message: "You must join a server before performing this action.",
        });
        return false;
    }

    const userPerms = await getUserPermissions(
        app.prisma as any,
        userId,
        serverId,
    );

    if (!hasPermission(userPerms, permission)) {
        socket.emit("ERROR", {
            code: "PERMISSION_DENIED",
            message: "You do not have permission to perform this action.",
        });
        // debug, not warn — most calls here are routine capability probes
        // (e.g. checking MANAGE_ROLES/MANAGE_EMOJIS to decide whether to
        // show admin UI) that fire on every join for every non-admin user,
        // not actual misuse. At warn level these drowned out real signal in
        // server logs during connection-issue investigations.
        app.log.debug(
            { userId, serverId, requiredPermission: permission.toString() },
            "Permission denied",
        );
        return false;
    }

    return true;
}

/**
 * Like `requirePermission`, but passes if the socket's user holds *any* of
 * the given permissions — for actions shared by more than one role (e.g.
 * GET_ALL_USERS, needed by both MANAGE_ROLES and BAN_USER holders since the
 * User Management tab serves both, PRD 13.17).
 */
export async function requireAnyPermission(
    app: FastifyInstance,
    socket: TypedSocket,
    ...permissions: bigint[]
): Promise<boolean> {
    const userId = socket.data.userId;
    const serverId = socket.data.serverId;

    if (!userId || !serverId) {
        socket.emit("ERROR", {
            code: "NOT_AUTHENTICATED",
            message: "You must join a server before performing this action.",
        });
        return false;
    }

    const userPerms = await getUserPermissions(
        app.prisma as any,
        userId,
        serverId,
    );

    if (!hasAnyPermission(userPerms, ...permissions)) {
        socket.emit("ERROR", {
            code: "PERMISSION_DENIED",
            message: "You do not have permission to perform this action.",
        });
        app.log.debug(
            { userId, serverId, requiredPermissions: permissions.map((p) => p.toString()) },
            "Permission denied",
        );
        return false;
    }

    return true;
}
