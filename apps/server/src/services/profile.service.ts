/**
 * Profile Service (PRD 17.3) — pure (no Prisma/Fastify): maps a user row to
 * what the profile card shows. The query itself lives in profile.handler.ts.
 */

import type { IUserProfile } from "@reson8/shared-types";

/** The shape the handler loads: the user plus their role links. */
export interface ProfileRow {
    id: string;
    nickname: string;
    avatarUrl: string | null;
    createdAt: Date;
    roles: { role: { id: string; serverId: string; name: string; color: string | null; powerLevel: number } }[];
}

/**
 * The card's data. Only roles of `serverId` are shown (a user row can hold
 * roles of other servers in a multi-server database), highest powerLevel
 * first, then by name so the order is stable.
 */
export function toUserProfile(row: ProfileRow, serverId: string, isOnline: boolean): IUserProfile {
    const roles = row.roles
        .map((r) => r.role)
        .filter((role) => role.serverId === serverId)
        .sort((a, b) => b.powerLevel - a.powerLevel || a.name.localeCompare(b.name))
        .map(({ id, name, color, powerLevel }) => ({ id, name, color, powerLevel }));
    return {
        userId: row.id,
        nickname: row.nickname,
        avatarUrl: row.avatarUrl,
        memberSince: row.createdAt.toISOString(),
        roles,
        isOnline,
    };
}

/** A user id worth querying: a non-empty string of sane length (ids are UUIDs, but legacy ones may not be). */
export function isPlausibleUserId(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= 128;
}
