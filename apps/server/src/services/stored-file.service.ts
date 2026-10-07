/**
 * Stored-File Ledger Service (PRD 16.8).
 *
 * The server records every file it stores in the `stored_files` table, and
 * everything that wants to *use* a file (a message attachment, a custom
 * emoji, a channel icon) must CLAIM it here first. A claim is atomic,
 * one-shot, owner-checked and kind-checked, and the URL/public_id that get
 * persisted — and later deleted — always come from this ledger, never from a
 * client-supplied value. That closes the hole where a modified client could
 * reference someone else's file (or any Cloudinary asset) from its own row
 * and then delete that row to get the file destroyed.
 *
 * Also hosts the upload-token helpers: the HTTP upload routes have no
 * identity of their own, so a socket-issued bearer token attributes each
 * upload to a user.
 */

import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import type { Prisma, PrismaClient, StoredFileKind } from "@prisma/client";
import type { Redis } from "ioredis";
import {
    FILE_RELEASE_CONCURRENCY,
    UPLOAD_SWEEP_BATCH_SIZE,
    UPLOAD_TOKEN_REDIS_PREFIX,
    UPLOAD_TOKEN_TTL_SEC,
} from "../config/upload.config.js";
import { deleteAttachment } from "./storage.service.js";

// ── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Canonical form of an upload URL: the host-independent "/uploads/<file>"
 * path for local-disk storage. Older clients stored the ABSOLUTE URL they
 * built from their own server address ("http://host:9800/uploads/x.png"), so
 * any http(s) URL whose path is under /uploads/ is reduced to that path.
 * Anything else (a Cloudinary URL, an arbitrary external URL) is returned
 * trimmed but otherwise unchanged — it can then only match a ledger row that
 * has exactly that URL.
 */
export function normalizeUploadUrl(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.startsWith("/uploads/")) return trimmed;
    try {
        const u = new URL(trimmed);
        if ((u.protocol === "http:" || u.protocol === "https:") && u.pathname.startsWith("/uploads/")) {
            return u.pathname;
        }
    } catch {
        /* not an absolute URL — fall through */
    }
    return trimmed;
}

/** The file name of a local-disk upload URL, or null when it isn't one. */
export function localUploadBasename(url: string): string | null {
    const normalized = normalizeUploadUrl(url);
    if (!normalized.startsWith("/uploads/")) return null;
    const base = path.posix.basename(normalized);
    return base && base !== "." && base !== ".." ? base : null;
}

export function generateUploadToken(): string {
    return randomBytes(32).toString("base64url");
}

export function hashUploadToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

export function uploadTokenKey(token: string): string {
    return `${UPLOAD_TOKEN_REDIS_PREFIX}${hashUploadToken(token)}`;
}

/** Pulls the token out of an `Authorization: Bearer <token>` header, or null if malformed. */
export function extractBearerToken(header: string | undefined): string | null {
    if (!header) return null;
    const match = /^Bearer\s+([A-Za-z0-9_-]{20,128})$/i.exec(header.trim());
    return match ? match[1] : null;
}

/**
 * Validates the client's "use these uploads" input. `ids` (v2.5.0+) wins over
 * the legacy single URL. Returns exactly one of `ids` / `urls` (never a mix),
 * or an `error` string safe to send back in an ack.
 */
export function parseClaimRequest(
    ids: unknown,
    legacyUrl: unknown,
    max: number,
): { ids: string[]; urls: string[] } | { error: string } {
    if (ids !== undefined && ids !== null) {
        if (!Array.isArray(ids) || !ids.every((i) => typeof i === "string" && i.length > 0 && i.length <= 64)) {
            return { error: "Invalid attachment" };
        }
        const unique = [...new Set(ids as string[])];
        if (unique.length > max) {
            return { error: max === 1 ? "Only one attachment is allowed" : `At most ${max} attachments are allowed` };
        }
        if (unique.length > 0) return { ids: unique, urls: [] };
    }
    if (typeof legacyUrl === "string" && legacyUrl.trim().length > 0) {
        if (legacyUrl.length > 2048) return { error: "Invalid attachment" };
        return { ids: [], urls: [legacyUrl] };
    }
    return { ids: [], urls: [] };
}

export class UploadClaimError extends Error {
    constructor() {
        super("Attachment is no longer available. Please re-attach it.");
        this.name = "UploadClaimError";
    }
}

export interface ClaimedFile {
    id: string;
    url: string;
    publicId: string | null;
}

/** Puts claimed rows back in the order they were requested (RETURNING is unordered). */
export function orderClaimed(rows: ClaimedFile[], requested: string[], key: "id" | "url"): ClaimedFile[] {
    const byKey = new Map(rows.map((r) => [r[key], r]));
    return requested.map((k) => byKey.get(k)).filter((r): r is ClaimedFile => r !== undefined);
}

/** Throws unless every requested file was actually claimed. */
export function assertAllClaimed(requested: number, claimed: number): void {
    if (claimed !== requested) throw new UploadClaimError();
}

// ── Upload tokens ───────────────────────────────────────────────────────────

/** Issues a token mapped to `userId` in Redis (hashed key, short TTL). */
export async function issueUploadToken(redis: Redis, userId: string): Promise<{ token: string; expiresInSec: number }> {
    const token = generateUploadToken();
    await redis.set(uploadTokenKey(token), userId, "EX", UPLOAD_TOKEN_TTL_SEC);
    return { token, expiresInSec: UPLOAD_TOKEN_TTL_SEC };
}

/** The userId a token was issued to, or null if it's unknown or expired. */
export async function resolveUploadTokenOwner(redis: Redis, token: string): Promise<string | null> {
    return redis.get(uploadTokenKey(token));
}

// ── Ledger operations ───────────────────────────────────────────────────────

export async function recordStoredFile(
    prisma: PrismaClient,
    file: { url: string; publicId?: string | null; kind: StoredFileKind; ownerId: string | null },
): Promise<{ id: string }> {
    const row = await prisma.storedFile.create({
        data: { url: file.url, publicId: file.publicId ?? null, kind: file.kind, ownerId: file.ownerId },
        select: { id: true },
    });
    return row;
}

/**
 * Claims uploaded files for use, atomically. Pass `ids` (v2.5.0+ clients) or
 * `urls` (legacy clients, normalized here), never a mix — whichever is
 * non-empty wins, ids first.
 *
 * A single `UPDATE … WHERE claimedAt IS NULL … RETURNING` is a compare-and-set:
 * two concurrent claims of the same file can't both succeed, and there is no
 * read-then-write window. A file is claimable only when it is unclaimed, of
 * the right `kind`, and owned by `userId` (or ownerless — a pre-v2.5.0 upload).
 * Run it on the SAME transaction client as the write that uses the file, so a
 * failed write rolls the claim back; throws `UploadClaimError` (rolling that
 * transaction back) when any file can't be claimed.
 */
export async function claimUploads(
    tx: Prisma.TransactionClient,
    input: { ids?: string[]; urls?: string[]; kind: StoredFileKind; userId: string },
): Promise<ClaimedFile[]> {
    const ids = [...new Set(input.ids ?? [])];
    if (ids.length > 0) {
        const rows = await tx.$queryRaw<ClaimedFile[]>`
            UPDATE "stored_files" SET "claimedAt" = now()
            WHERE "id" = ANY(${ids})
              AND "kind" = ${input.kind}::"StoredFileKind"
              AND "claimedAt" IS NULL
              AND ("ownerId" = ${input.userId} OR "ownerId" IS NULL)
            RETURNING "id", "url", "publicId"`;
        assertAllClaimed(ids.length, rows.length);
        return orderClaimed(rows, ids, "id");
    }

    const urls = [...new Set((input.urls ?? []).map(normalizeUploadUrl))];
    if (urls.length === 0) return [];
    const rows = await tx.$queryRaw<ClaimedFile[]>`
        UPDATE "stored_files" SET "claimedAt" = now()
        WHERE "url" = ANY(${urls})
          AND "kind" = ${input.kind}::"StoredFileKind"
          AND "claimedAt" IS NULL
          AND ("ownerId" = ${input.userId} OR "ownerId" IS NULL)
        RETURNING "id", "url", "publicId"`;
    assertAllClaimed(urls.length, rows.length);
    return orderClaimed(rows, urls, "url");
}

/** How many message/DM/emoji/icon rows still reference this file (local files match by name, so relative and legacy absolute forms both count). */
export async function countFileReferences(prisma: PrismaClient, url: string): Promise<number> {
    const base = localUploadBasename(url);
    const cond: Prisma.StringFilter = base ? { endsWith: `/uploads/${base}` } : { equals: url };
    // `attachments` is the source of truth since PRD 16.10; the deprecated
    // message/DM columns still hold pre-migration values, so they count too.
    const [attachments, messages, dms, emojis, icons] = await Promise.all([
        prisma.attachment.count({ where: { url: cond } }),
        prisma.message.count({ where: { attachmentUrl: cond } }),
        prisma.directMessage.count({ where: { attachmentUrl: cond } }),
        prisma.customEmoji.count({ where: { imageUrl: cond } }),
        prisma.channel.count({ where: { iconUrl: cond } }),
    ]);
    return attachments + messages + dms + emojis + icons;
}

/**
 * Releases a file the app no longer needs: call it AFTER removing the row
 * that referenced it (DB first, so a failed delete never loses a file).
 * Physically deletes only when
 *   1. the file is in the ledger — a URL the server never stored is never
 *      touched, so a forged reference can't make us delete anything; and
 *   2. nothing else still references it (the same file can be shared by
 *      several rows, e.g. from before the ledger existed).
 * The delete always uses the LEDGER's url/public_id, never a caller's.
 */
export async function releaseStoredFile(
    prisma: PrismaClient,
    rawUrl: string,
): Promise<"deleted" | "untracked" | "still-referenced"> {
    const file = await prisma.storedFile.findUnique({ where: { url: normalizeUploadUrl(rawUrl) } });
    if (!file) return "untracked";
    if ((await countFileReferences(prisma, file.url)) > 0) return "still-referenced";

    await prisma.storedFile.delete({ where: { id: file.id } }).catch(() => {});
    await deleteAttachment(file.url, file.publicId);
    return "deleted";
}

// ── Cleanup (PRD 16.9) ──────────────────────────────────────────────────────

/** Runs `fn` over `items` with at most `limit` in flight at once; never rejects (failures are returned). */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = new Array(items.length);
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < items.length) {
            const i = next++;
            try {
                results[i] = { status: "fulfilled", value: await fn(items[i]) };
            } catch (reason) {
                results[i] = { status: "rejected", reason };
            }
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
    return results;
}

/**
 * Discards the caller's own UNCLAIMED upload. One atomic
 * `DELETE … WHERE claimedAt IS NULL AND ownerId = me RETURNING`: a file that
 * has been (or is concurrently being) claimed can't be discarded, and
 * someone else's — or an ownerless — upload is never touched. Returns whether
 * anything was discarded. An unclaimed file is referenced by nothing, so it
 * is deleted directly.
 */
export async function discardUnclaimedUpload(prisma: PrismaClient, uploadId: string, userId: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ url: string; publicId: string | null }[]>`
        DELETE FROM "stored_files"
        WHERE "id" = ${uploadId} AND "claimedAt" IS NULL AND "ownerId" = ${userId}
        RETURNING "url", "publicId"`;
    if (rows.length === 0) return false;
    await deleteAttachment(rows[0].url, rows[0].publicId);
    return true;
}

/**
 * Deletes unclaimed uploads created before `olderThan`, in batches, and their
 * files. The `claimedAt IS NULL` test is repeated on the OUTER delete on
 * purpose: if a claim lands between the batch being picked and the delete,
 * Postgres re-checks the outer predicate against the claimed row and skips it
 * (a sub-select alone would not be re-evaluated), so a file that has just
 * been attached is never swept. Each file is still checked against the
 * reference count before it is physically deleted, as a belt-and-braces guard.
 */
export async function sweepUnclaimedUploads(
    prisma: PrismaClient,
    opts: { olderThan: Date; batchSize?: number },
): Promise<{ swept: number }> {
    const batchSize = opts.batchSize ?? UPLOAD_SWEEP_BATCH_SIZE;
    let swept = 0;
    for (;;) {
        const rows = await prisma.$queryRaw<{ url: string; publicId: string | null }[]>`
            DELETE FROM "stored_files"
            WHERE "id" IN (
                SELECT "id" FROM "stored_files"
                WHERE "claimedAt" IS NULL AND "createdAt" < ${opts.olderThan}
                ORDER BY "createdAt" LIMIT ${batchSize}
            ) AND "claimedAt" IS NULL
            RETURNING "url", "publicId"`;
        if (rows.length === 0) break;

        await mapWithConcurrency(rows, FILE_RELEASE_CONCURRENCY, async (row) => {
            if ((await countFileReferences(prisma, row.url)) > 0) return;
            await deleteAttachment(row.url, row.publicId);
        });
        swept += rows.length;
        if (rows.length < batchSize) break;
    }
    return { swept };
}

/** The URLs of every file a channel would orphan when deleted: its messages' attachments and its own icon. */
export async function collectChannelFileUrls(prisma: PrismaClient, channelId: string): Promise<string[]> {
    const [attachments, messages, channel] = await Promise.all([
        prisma.attachment.findMany({ where: { message: { channelId } }, select: { url: true } }),
        prisma.message.findMany({
            where: { channelId, attachmentUrl: { not: null } },
            select: { attachmentUrl: true },
        }),
        prisma.channel.findUnique({ where: { id: channelId }, select: { iconUrl: true } }),
    ]);
    const urls = new Set<string>();
    for (const a of attachments) urls.add(a.url);
    for (const m of messages) if (m.attachmentUrl) urls.add(m.attachmentUrl);
    if (channel?.iconUrl) urls.add(channel.iconUrl);
    return [...urls];
}

/** Releases many files with bounded concurrency; failures are returned, never thrown. */
export async function releaseStoredFiles(prisma: PrismaClient, urls: readonly string[]) {
    return mapWithConcurrency(urls, FILE_RELEASE_CONCURRENCY, (url) => releaseStoredFile(prisma, url));
}
