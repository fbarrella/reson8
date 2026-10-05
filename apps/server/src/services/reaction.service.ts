/**
 * Reaction aggregation (PRD 15.11).
 *
 * Reactions are stored one row per (message, user, emoji). Clients want them
 * grouped per emoji, with who reacted. This used to be copy-pasted in three
 * places (the reaction handler, channel history, DM history); it lives here
 * once now, with the reactor nicknames the hover card needs.
 */

import type { FastifyInstance } from "fastify";
import type { IReactionSummary } from "@reson8/shared-types";

export interface ReactionRow {
    emoji: string;
    userId: string;
}

/** Shown for a reactor whose User row no longer exists. */
export const UNKNOWN_REACTOR_NICKNAME = "Unknown";

/**
 * Pure: groups reaction rows by emoji. Emoji appear in order of their first
 * reaction and reactors in the order the rows were given (callers pass them
 * `createdAt asc`), so the "who reacted" order is chronological.
 */
export function aggregateReactionRows(
    rows: ReactionRow[],
    nicknameById: ReadonlyMap<string, string>,
): IReactionSummary[] {
    const byEmoji = new Map<string, string[]>();
    for (const row of rows) {
        let userIds = byEmoji.get(row.emoji);
        if (!userIds) {
            userIds = [];
            byEmoji.set(row.emoji, userIds);
        }
        userIds.push(row.userId);
    }

    return Array.from(byEmoji.entries()).map(([emoji, userIds]) => ({
        emoji,
        count: userIds.length,
        userIds,
        users: userIds.map((userId) => ({
            userId,
            nickname: nicknameById.get(userId) ?? UNKNOWN_REACTOR_NICKNAME,
        })),
    }));
}

/** One query for every distinct reactor across a whole batch of messages. */
export async function loadReactorNicknames(
    prisma: FastifyInstance["prisma"],
    userIds: Iterable<string>,
): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const users = await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, nickname: true },
    });
    return new Map(users.map((u) => [u.id, u.nickname]));
}

/** Loads and aggregates the current reactions on one message (channel or DM). */
export async function aggregateReactionsForMessage(
    prisma: FastifyInstance["prisma"],
    messageId: string,
    isDm: boolean,
): Promise<IReactionSummary[]> {
    const rows = await prisma.reaction.findMany({
        where: isDm ? { dmId: messageId } : { messageId },
        select: { emoji: true, userId: true },
        orderBy: { createdAt: "asc" },
    });
    const nicknames = await loadReactorNicknames(prisma, rows.map((r) => r.userId));
    return aggregateReactionRows(rows, nicknames);
}
