import { describe, it, expect } from "vitest";
import { MAX_PAGE_LIMIT, parseHistoryQuery, trimExtra, windowHalves } from "../services/pagination.service.js";

describe("parseHistoryQuery", () => {
    it("defaults to the latest page of 50", () => {
        expect(parseHistoryQuery({})).toEqual({ ok: true, query: { kind: "latest", take: 50 } });
    });

    it("clamps the limit to 1..100 and survives junk", () => {
        expect(parseHistoryQuery({ limit: 500 })).toMatchObject({ query: { take: MAX_PAGE_LIMIT } });
        expect(parseHistoryQuery({ limit: 0 })).toMatchObject({ query: { take: 1 } });
        expect(parseHistoryQuery({ limit: -5 })).toMatchObject({ query: { take: 1 } });
        expect(parseHistoryQuery({ limit: "abc" })).toMatchObject({ query: { take: 50 } });
        expect(parseHistoryQuery({ limit: 20.7 })).toMatchObject({ query: { take: 20 } });
    });

    it("parses before / after cursors", () => {
        const iso = "2026-10-08T01:00:00.000Z";
        const before = parseHistoryQuery({ before: iso, limit: 20 });
        const after = parseHistoryQuery({ after: iso, limit: 20 });
        expect(before).toEqual({ ok: true, query: { kind: "before", take: 20, cursor: new Date(iso) } });
        expect(after).toEqual({ ok: true, query: { kind: "after", take: 20, cursor: new Date(iso) } });
    });

    it("parses an around query", () => {
        expect(parseHistoryQuery({ aroundMessageId: "m-1", limit: 41 })).toEqual({
            ok: true,
            query: { kind: "around", take: 41, messageId: "m-1" },
        });
    });

    it("refuses combined cursors", () => {
        const iso = "2026-10-08T01:00:00.000Z";
        expect(parseHistoryQuery({ before: iso, after: iso }).ok).toBe(false);
        expect(parseHistoryQuery({ after: iso, aroundMessageId: "m" }).ok).toBe(false);
        expect(parseHistoryQuery({ before: iso, aroundMessageId: "m" }).ok).toBe(false);
    });

    it("refuses bad cursors and ids", () => {
        expect(parseHistoryQuery({ before: "not a date" }).ok).toBe(false);
        expect(parseHistoryQuery({ after: 12345 }).ok).toBe(false);
        expect(parseHistoryQuery({ after: "" }).ok).toBe(false);
        expect(parseHistoryQuery({ aroundMessageId: 42 }).ok).toBe(false);
        expect(parseHistoryQuery({ aroundMessageId: "x".repeat(200) }).ok).toBe(false);
    });

    it("treats null like absent (older clients may send null)", () => {
        expect(parseHistoryQuery({ before: null, after: null, aroundMessageId: null })).toEqual({
            ok: true,
            query: { kind: "latest", take: 50 },
        });
    });
});

describe("windowHalves", () => {
    it("splits around the target", () => {
        expect(windowHalves(41)).toEqual({ before: 20, after: 20 });
        expect(windowHalves(50)).toEqual({ before: 24, after: 25 });
        expect(windowHalves(1)).toEqual({ before: 0, after: 0 });
    });
});

describe("trimExtra", () => {
    it("reports more when the extra row came back", () => {
        expect(trimExtra([1, 2, 3, 4], 3)).toEqual({ rows: [1, 2, 3], hasMore: true });
    });
    it("reports no more when it didn't", () => {
        expect(trimExtra([1, 2, 3], 3)).toEqual({ rows: [1, 2, 3], hasMore: false });
        expect(trimExtra([1], 3)).toEqual({ rows: [1], hasMore: false });
        expect(trimExtra([], 3)).toEqual({ rows: [], hasMore: false });
    });
});
