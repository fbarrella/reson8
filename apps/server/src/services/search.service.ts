/**
 * Message search (PRD 20 Q1) — the pure half: payload validation, the page size
 * and the per-socket rate limit. The SQL lives in the handler.
 */
export const SEARCH_PAGE_SIZE = 25;
export const SEARCH_MIN_QUERY = 2;
export const SEARCH_MAX_QUERY = 100;
export const SEARCH_MIN_INTERVAL_MS = 1000;

export interface SearchRequest {
    query: string;
    channelId?: string;
    dmPartnerId?: string;
    before?: Date;
}

/** Trims and collapses whitespace; null when the query is outside 2-100 characters. */
export function normalizeSearchQuery(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const q = raw.replace(/\s+/g, " ").trim();
    return q.length >= SEARCH_MIN_QUERY && q.length <= SEARCH_MAX_QUERY ? q : null;
}

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

/** The validated request, or null for anything malformed (ids only, never both). */
export function parseSearchPayload(p: unknown): SearchRequest | null {
    if (!p || typeof p !== "object") return null;
    const o = p as Record<string, unknown>;
    const query = normalizeSearchQuery(o.query);
    if (!query) return null;
    if (o.channelId !== undefined && o.dmPartnerId !== undefined) return null;
    if (o.channelId !== undefined && !isId(o.channelId)) return null;
    if (o.dmPartnerId !== undefined && !isId(o.dmPartnerId)) return null;
    let before: Date | undefined;
    if (o.before !== undefined) {
        if (typeof o.before !== "string" || o.before.length > 40) return null;
        const d = new Date(o.before);
        if (Number.isNaN(d.getTime())) return null;
        before = d;
    }
    return {
        query,
        channelId: o.channelId as string | undefined,
        dmPartnerId: o.dmPartnerId as string | undefined,
        before,
    };
}

/** One search per second per socket. */
export function shouldAllowSearch(last: number | undefined, now: number): boolean {
    return last === undefined || now - last >= SEARCH_MIN_INTERVAL_MS;
}
