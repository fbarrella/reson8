/**
 * The User Management list (PRD 18.17), kept pure so it is unit-tested.
 *
 * Who is listed: everyone with a membership on the server OR a role on it.
 * A user whose last role was removed is still a member, so they stay in the
 * list with `roles: []` — an admin must always be able to give a role back,
 * or ban them.
 */

export interface AdminUserRow {
    id: string;
    username: string;
    nickname: string;
    createdAt: Date;
    publicKey: string | null;
    roles: {
        role: {
            id: string;
            serverId: string;
            name: string;
            permissions: bigint;
            powerLevel: number;
            color: string | null;
            createdAt: Date;
        };
    }[];
}

/** The Prisma `where` for the list, for one server. */
export function adminUsersWhere(serverId: string): {
    OR: ({ servers: { some: { serverId: string } } } | { roles: { some: { role: { serverId: string } } } })[];
} {
    return {
        OR: [{ servers: { some: { serverId } } }, { roles: { some: { role: { serverId } } } }],
    };
}

export function mapAdminUser(u: AdminUserRow, bannedIds: ReadonlySet<string>) {
    return {
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        createdAt: u.createdAt.toISOString(),
        isBanned: bannedIds.has(u.id),
        // Whether a key is bound (PRD 17.12) — never the key itself.
        hasIdentityKey: u.publicKey !== null,
        roles: u.roles.map((ur) => ({
            id: ur.role.id,
            serverId: ur.role.serverId,
            name: ur.role.name,
            permissions: ur.role.permissions.toString(),
            powerLevel: ur.role.powerLevel,
            color: ur.role.color,
            createdAt: ur.role.createdAt.toISOString(),
        })),
    };
}
