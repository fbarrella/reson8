/**
 * The DM directory (PRD 19 A7): every member the caller could message, with
 * the latest DM between them and how many are unread. The assembly is pure so
 * its rules are unit-tested; the loaders (SQL) live in `loadLastDmByPartner`.
 *
 * Only DM pairs that INCLUDE the caller are ever read, so no one else's
 * messages can leak through here.
 */

import type { IDmDirectoryEntry } from "@reson8/shared-types";
import type { PrismaClient } from "@prisma/client";
import { hasServerAccess } from "./access.service.js";
import type { SummaryMemberRow } from "./server-summary.js";

/** Longest `lastMessage.text` sent (raw message text; the client renders it plain). */
export const DM_PREVIEW_MAX_CHARS = 300;

export interface LastDmRow {
    /** The other person in the pair. */
    partner: string;
    id: string;
    content: string;
    senderId: string;
    createdAt: Date;
}

export interface DmDirectoryInput {
    callerId: string;
    members: SummaryMemberRow[];
    bannedIds: ReadonlySet<string>;
    onlineIds: ReadonlySet<string>;
    lastByPartner: ReadonlyMap<string, LastDmRow>;
    /** Ids of DMs (among the last messages) that carry attachments. */
    dmIdsWithAttachments: ReadonlySet<string>;
    unreadByPartner: ReadonlyMap<string, number>;
}

/** Cuts to `max` UTF-16 units without leaving half of a surrogate pair. */
export function truncatePreview(text: string, max = DM_PREVIEW_MAX_CHARS): string {
    if (text.length <= max) return text;
    let end = max;
    const last = text.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end--; // a high surrogate would be cut from its pair
    return text.slice(0, end);
}

/**
 * Members with access, not banned, excluding the caller. Not sorted: the
 * client orders the list because it re-sorts live as messages arrive.
 */
export function buildDmDirectory(input: DmDirectoryInput): IDmDirectoryEntry[] {
    const entries: IDmDirectoryEntry[] = [];
    for (const m of input.members) {
        if (m.id === input.callerId) continue;
        if (!hasServerAccess(m.perms) || input.bannedIds.has(m.id)) continue;

        const entry: IDmDirectoryEntry = {
            userId: m.id,
            nickname: m.nickname,
            avatarUrl: m.avatarUrl,
            isOnline: input.onlineIds.has(m.id),
            unreadCount: input.unreadByPartner.get(m.id) ?? 0,
        };
        const last = input.lastByPartner.get(m.id);
        if (last) {
            entry.lastMessage = {
                text: truncatePreview(last.content),
                hasAttachments: input.dmIdsWithAttachments.has(last.id),
                at: last.createdAt.toISOString(),
                fromMe: last.senderId === input.callerId,
            };
        }
        entries.push(entry);
    }
    return entries;
}

/**
 * The newest DM per conversation partner, in one query over the pairs that
 * include `userId` (tagged template: parameters are bound, never concatenated).
 */
export async function loadLastDmByPartner(
    prisma: Pick<PrismaClient, "$queryRaw">,
    userId: string,
): Promise<Map<string, LastDmRow>> {
    const rows = await prisma.$queryRaw<LastDmRow[]>`
        SELECT DISTINCT ON (partner) partner, id, content, "senderId", "createdAt"
        FROM (
            SELECT CASE WHEN "senderId" = ${userId} THEN "receiverId" ELSE "senderId" END AS partner,
                   id, content, "senderId", "createdAt"
            FROM "direct_messages"
            WHERE "senderId" = ${userId} OR "receiverId" = ${userId}
        ) d
        ORDER BY partner, "createdAt" DESC`;
    return new Map(rows.map((r) => [r.partner, r]));
}
