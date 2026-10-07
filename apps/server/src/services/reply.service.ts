/**
 * Reply Service (PRD 16.11) — a reply stores only the id of the message it
 * answers (`replyToId`, a plain column with no foreign key, so deleting the
 * original doesn't erase the fact that the reply WAS a reply). Everything the
 * client shows in the snippet is resolved at read time, in one batched query
 * per page, like loadReactorNicknames. Pure where possible.
 */

import type { PrismaClient } from "@prisma/client";
import type { IReplyPreview } from "@reson8/shared-types";

/** Longest original text carried in a snippet. The client shows one line; this just bounds the payload. */
export const REPLY_PREVIEW_MAX_CHARS = 200;

/**
 * One line of text for a snippet: every run of whitespace (newlines included)
 * collapses to a single space, and anything over REPLY_PREVIEW_MAX_CHARS is
 * cut — by code point, so an emoji is never split in half — with an ellipsis.
 */
export function truncateForPreview(content: string): string {
    const flat = content.replace(/\s+/g, " ").trim();
    const chars = Array.from(flat);
    return chars.length > REPLY_PREVIEW_MAX_CHARS ? `${chars.slice(0, REPLY_PREVIEW_MAX_CHARS).join("").trimEnd()}…` : flat;
}

/** The fields of an original message a snippet needs. */
export interface ReplyTargetRow {
    id: string;
    userId: string;
    nickname: string;
    content: string;
    hasAttachments: boolean;
}

/** A snippet for `id`: the original's details, or `deleted: true` when it no longer exists. */
export function toReplyPreview(id: string, row: ReplyTargetRow | undefined): IReplyPreview {
    if (!row) return { id, deleted: true };
    return {
        id,
        deleted: false,
        userId: row.userId,
        nickname: row.nickname,
        content: truncateForPreview(row.content),
        hasAttachments: row.hasAttachments,
    };
}

/** The `replyTo` field of a message DTO, from the batch-loaded previews (null when it isn't a reply). */
export function replyPreviewFor(
    replyToId: string | null | undefined,
    previews: ReadonlyMap<string, IReplyPreview>,
): IReplyPreview | null {
    if (!replyToId) return null;
    return previews.get(replyToId) ?? { id: replyToId, deleted: true };
}

/** Validates the client's `replyToId`: absent is fine (not a reply); otherwise a short non-empty string. */
export function parseReplyToId(value: unknown): { replyToId: string | null } | { error: string } {
    if (value === undefined || value === null) return { replyToId: null };
    if (typeof value !== "string" || value.length === 0 || value.length > 64) return { error: "Invalid reply target" };
    return { replyToId: value };
}

/**
 * Whether a channel message may reply to `target`. A target in ANOTHER
 * channel is refused (it would leak that channel's text into this one's
 * snippet). A target that doesn't exist is allowed: the original was deleted
 * while the user was typing, and the reply renders as "Original message was
 * deleted", as Discord does.
 */
export function isChannelReplyAllowed(target: { channelId: string } | null, channelId: string): boolean {
    return target === null || target.channelId === channelId;
}

/** Whether a DM belongs to the conversation between `userA` and `userB`, in either direction. */
export function dmInPair(target: { senderId: string; receiverId: string }, userA: string, userB: string): boolean {
    return (
        (target.senderId === userA && target.receiverId === userB) ||
        (target.senderId === userB && target.receiverId === userA)
    );
}

/** Same rule for DMs: an existing target must belong to THIS pair of users; a deleted one is allowed. */
export function isDmReplyAllowed(
    target: { senderId: string; receiverId: string } | null,
    userA: string,
    userB: string,
): boolean {
    return target === null || dmInPair(target, userA, userB);
}

/**
 * Loads the snippet for every distinct reply target in `replyToIds` with ONE
 * query (primary-key lookup), whatever the page size. Every requested id is
 * in the result; ids with no row come back as `deleted: true`.
 */
export async function loadReplyPreviews(
    prisma: PrismaClient,
    kind: "message" | "dm",
    replyToIds: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, IReplyPreview>> {
    const ids = [...new Set(replyToIds.filter((id): id is string => !!id))];
    const previews = new Map<string, IReplyPreview>();
    if (ids.length === 0) return previews;

    let rows: ReplyTargetRow[];
    if (kind === "message") {
        const found = await prisma.message.findMany({
            where: { id: { in: ids } },
            select: {
                id: true,
                userId: true,
                content: true,
                attachmentUrl: true, // deprecated column: still counts for a row the backfill missed (PRD 16.10)
                user: { select: { nickname: true } },
                _count: { select: { attachments: true } },
            },
        });
        rows = found.map((m) => ({
            id: m.id,
            userId: m.userId,
            nickname: m.user.nickname,
            content: m.content,
            hasAttachments: m._count.attachments > 0 || !!m.attachmentUrl,
        }));
    } else {
        const found = await prisma.directMessage.findMany({
            where: { id: { in: ids } },
            select: {
                id: true,
                senderId: true,
                content: true,
                attachmentUrl: true,
                sender: { select: { nickname: true } },
                _count: { select: { attachments: true } },
            },
        });
        rows = found.map((m) => ({
            id: m.id,
            userId: m.senderId,
            nickname: m.sender.nickname,
            content: m.content,
            hasAttachments: m._count.attachments > 0 || !!m.attachmentUrl,
        }));
    }

    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) previews.set(id, toReplyPreview(id, byId.get(id)));
    return previews;
}
