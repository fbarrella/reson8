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
import { getUserPermissions, hasPermission } from "../services/permissions.service.js";

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
        app.log.warn(
            { userId, serverId, requiredPermission: permission.toString() },
            "Permission denied",
        );
        return false;
    }

    return true;
}
