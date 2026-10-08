/**
 * History pagination (PRD 17.8) — pure (no Prisma), shared by FETCH_MESSAGES
 * and FETCH_DIRECT_MESSAGES.
 *
 * Four ways to fetch a page:
 *   - latest:  the newest `take` messages (initial load, "jump to most recent");
 *   - before:  `take` messages older than a cursor (scrolling up);
 *   - after:   `take` messages newer than a cursor (scrolling down after a
 *              jump — new in 17.8);
 *   - around:  a window centred on one message (pinned bar / reply snippet).
 * Cursors are ISO `createdAt` timestamps, as the existing `before` always was.
 *
 * Every query fetches ONE extra row per direction so the server can say for
 * sure whether more history exists (`hasMoreBefore` / `hasMoreAfter`) instead
 * of the client guessing from "the page was full".
 */

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

export type HistoryQuery =
    | { kind: "latest"; take: number }
    | { kind: "before"; take: number; cursor: Date }
    | { kind: "after"; take: number; cursor: Date }
    | { kind: "around"; take: number; messageId: string };

export type HistoryQueryParse = { ok: true; query: HistoryQuery } | { ok: false; error: string };

function parseCursor(value: unknown): Date | null {
    if (typeof value !== "string" || value.length === 0 || value.length > 40) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/** Validates the paging fields of a fetch payload. `before`, `after` and `aroundMessageId` are mutually exclusive. */
export function parseHistoryQuery(payload: {
    before?: unknown;
    after?: unknown;
    aroundMessageId?: unknown;
    limit?: unknown;
}): HistoryQueryParse {
    const rawLimit = Number(payload.limit ?? DEFAULT_PAGE_LIMIT);
    const take = Math.max(1, Math.min(MAX_PAGE_LIMIT, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : DEFAULT_PAGE_LIMIT));

    const given = [payload.before, payload.after, payload.aroundMessageId].filter((v) => v !== undefined && v !== null);
    if (given.length > 1) return { ok: false, error: "Use only one of before, after or aroundMessageId" };

    if (payload.aroundMessageId !== undefined && payload.aroundMessageId !== null) {
        const id = payload.aroundMessageId;
        if (typeof id !== "string" || id.length === 0 || id.length > 128) return { ok: false, error: "Message not found" };
        return { ok: true, query: { kind: "around", take, messageId: id } };
    }
    if (payload.before !== undefined && payload.before !== null) {
        const cursor = parseCursor(payload.before);
        return cursor ? { ok: true, query: { kind: "before", take, cursor } } : { ok: false, error: "Invalid cursor" };
    }
    if (payload.after !== undefined && payload.after !== null) {
        const cursor = parseCursor(payload.after);
        return cursor ? { ok: true, query: { kind: "after", take, cursor } } : { ok: false, error: "Invalid cursor" };
    }
    return { ok: true, query: { kind: "latest", take } };
}

/** How many messages of a centred window go before / after the target (the target itself is the +1). */
export function windowHalves(take: number): { before: number; after: number } {
    const before = Math.floor((take - 1) / 2);
    return { before, after: take - 1 - before };
}

/**
 * Trims rows fetched with ONE extra row (`limit + 1`) back to `limit`, and
 * reports whether that extra row existed, i.e. whether more history lies
 * beyond. Rows must be ordered moving AWAY from the cursor (desc for
 * before/latest, asc for after), so the extra row is the last one.
 */
export function trimExtra<T>(rows: T[], limit: number): { rows: T[]; hasMore: boolean } {
    return rows.length > limit ? { rows: rows.slice(0, limit), hasMore: true } : { rows, hasMore: false };
}
