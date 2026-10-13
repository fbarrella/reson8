/**
 * Unread message counts for channels (PRD 19 A5).
 *
 * `hasUnread` (a boolean, set by connection.handler's annotateUnreadChannels)
 * keeps its meaning for older clients; `unreadCount` is the additive number
 * the new tab badges use. It counts messages by OTHER people after the read
 * cursor (a never-read channel counts from its first message) and is capped
 * at UNREAD_COUNT_CAP so the query never scans a whole history.
 */

import type { PrismaClient } from "@prisma/client";

/** The client shows "99+" for a count of 100. */
export const UNREAD_COUNT_CAP = 100;

/**
 * One query for all the given channels: per channel, the number of messages by
 * someone else newer than the user's read cursor, bounded by `LIMIT` inside a
 * lateral subquery so a huge backlog costs at most UNREAD_COUNT_CAP index
 * entries. Parameters go through the tagged template — never concatenated.
 */
export async function countUnreadByChannel(
    prisma: Pick<PrismaClient, "$queryRaw">,
    userId: string,
    channelIds: string[],
): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (channelIds.length === 0) return counts;

    const rows = await prisma.$queryRaw<{ channelId: string; n: number }[]>`
        SELECT c.id AS "channelId", cnt.n::int AS n
        FROM unnest(${channelIds}::text[]) AS c(id)
        LEFT JOIN "channel_reads" r ON r."channelId" = c.id AND r."userId" = ${userId}
        CROSS JOIN LATERAL (
            SELECT COUNT(*) AS n FROM (
                SELECT 1 FROM "messages" m
                WHERE m."channelId" = c.id
                  AND m."userId" <> ${userId}
                  AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")
                LIMIT ${UNREAD_COUNT_CAP}
            ) t
        ) cnt`;
    for (const row of rows) counts.set(row.channelId, Math.min(Number(row.n), UNREAD_COUNT_CAP));
    return counts;
}

/** Sets `unreadCount` on every node whose count is > 0 (recursively); zero counts are left out. */
export function applyUnreadCounts(
    nodes: { id: string; unreadCount?: number; children: unknown[] }[],
    counts: ReadonlyMap<string, number>,
): void {
    for (const node of nodes) {
        const n = counts.get(node.id);
        if (n !== undefined && n > 0) node.unreadCount = Math.min(n, UNREAD_COUNT_CAP);
        if (node.children.length > 0) applyUnreadCounts(node.children as typeof nodes, counts);
    }
}
