/**
 * Permissions Service — bitwise permission utilities for Reson8.
 *
 * Roles store a `bigint` field where each bit maps to a specific
 * permission flag (see PermissionFlags in shared-types).
 *
 * A user's effective permissions are the bitwise OR of all their
 * roles' permission values.
 */

import type { PrismaClient } from "@prisma/client";
import { PermissionFlags } from "@reson8/shared-types";

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

/** Returns `true` if the permission set contains the given flag. */
export function hasPermission(userPerms: bigint, flag: bigint): boolean {
    if ((userPerms & BigInt(PermissionFlags.ADMIN)) === BigInt(PermissionFlags.ADMIN)) {
        return true; // ADMIN bypasses all checks
    }
    return (userPerms & flag) === flag;
}

/** Returns `true` if the permission set contains ANY of the given flags. */
export function hasAnyPermission(userPerms: bigint, ...flags: bigint[]): boolean {
    if ((userPerms & BigInt(PermissionFlags.ADMIN)) === BigInt(PermissionFlags.ADMIN)) {
        return true;
    }
    return flags.some((flag) => (userPerms & flag) === flag);
}

/** Returns `true` if the user has the ADMIN flag. */
export function isAdmin(userPerms: bigint): boolean {
    return (userPerms & BigInt(PermissionFlags.ADMIN)) === BigInt(PermissionFlags.ADMIN);
}

// ---------------------------------------------------------------------------
// Database helper
// ---------------------------------------------------------------------------

/**
 * Aggregates all role permissions for a user on a given server.
 *
 * Fetches every role the user holds (via UserRole join), then OR's
 * their permission bigints together into a single effective value.
 *
 * Returns `0n` if the user has no roles.
 */
export async function getUserPermissions(
    prisma: PrismaClient,
    userId: string,
    serverId: string,
): Promise<bigint> {
    const userRoles = await prisma.userRole.findMany({
        where: { userId },
        include: { role: true },
    });

    // Filter to roles belonging to this server and OR together
    let combined = 0n;
    for (const ur of userRoles) {
        if (ur.role.serverId === serverId) {
            combined |= ur.role.permissions;
        }
    }

    return combined;
}
