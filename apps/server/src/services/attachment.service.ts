/**
 * Attachment Service (PRD 16.10) — message/DM images live in the
 * `attachments` table, one row per image in display order. Pure where
 * possible, like reaction.service.ts / message-text.ts.
 *
 * The deprecated `attachmentUrl` / `attachmentPublicId` columns on
 * Message/DirectMessage are no longer written or read, except as a fallback
 * for a row the backfill somehow missed.
 */

import type { PrismaClient } from "@prisma/client";
import type { IAttachment } from "@reson8/shared-types";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@reson8/shared-types";
import { parseClaimRequest, releaseStoredFiles } from "./stored-file.service.js";

/** Prisma `include` fragment that loads a message's images in display order. */
export const attachmentInclude = {
    select: { url: true, position: true },
    orderBy: { position: "asc" as const },
};

export interface AttachmentRow {
    url: string;
    position: number;
}

/**
 * Validates the client's "attach these" input (PRD 16.8/16.10): ids (v2.5.0+)
 * or one legacy URL (older clients), at most MAX_ATTACHMENTS_PER_MESSAGE,
 * de-duplicated with order preserved. Returns what claimUploads() takes, or an
 * `error` string that is safe to send back in an ack.
 */
export function normalizeAttachmentInput(payload: {
    attachmentIds?: unknown;
    attachmentUrl?: unknown;
}): { ids: string[]; urls: string[] } | { error: string } {
    return parseClaimRequest(payload.attachmentIds, payload.attachmentUrl, MAX_ATTACHMENTS_PER_MESSAGE);
}

/** Rows -> wire DTOs, in `position` order. Never exposes `publicId`. */
export function toAttachmentDtos(rows: readonly AttachmentRow[]): IAttachment[] {
    return [...rows].sort((a, b) => a.position - b.position).map((r) => ({ url: r.url }));
}

/**
 * The two wire fields every message DTO carries: `attachments` (the real
 * list) and the deprecated `attachmentUrl`, ALWAYS the first image's URL (or
 * null) so a pre-v2.5.0 client still shows a message's first image. A row the
 * backfill missed falls back to its legacy column.
 */
export function attachmentFields(
    rows: readonly AttachmentRow[],
    legacyUrl?: string | null,
): { attachments: IAttachment[]; attachmentUrl: string | null } {
    const attachments = toAttachmentDtos(rows);
    if (attachments.length === 0 && legacyUrl) attachments.push({ url: legacyUrl });
    return { attachments, attachmentUrl: attachments[0]?.url ?? null };
}

/** Every file URL a message holds, de-duplicated — the set to release when it's deleted. */
export function attachmentUrlsToRelease(rows: readonly { url: string }[], legacyUrl?: string | null): string[] {
    const urls = new Set(rows.map((r) => r.url));
    if (legacyUrl) urls.add(legacyUrl);
    return [...urls];
}

/**
 * Releases a deleted message's files via the upload ledger (PRD 16.8): the
 * ledger's own url/public_id, and only when nothing else still references the
 * file. Call it AFTER the message row is gone. Never throws.
 */
export function releaseAttachmentFiles(prisma: PrismaClient, urls: readonly string[]) {
    return releaseStoredFiles(prisma, urls);
}
