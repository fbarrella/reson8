import { describe, expect, it } from "vitest";
import { normalizeSearchQuery, parseSearchPayload, shouldAllowSearch } from "../services/search.service.js";

describe("normalizeSearchQuery", () => {
    it("trims and collapses whitespace", () => {
        expect(normalizeSearchQuery("  hello   world ")).toBe("hello world");
    });
    it("enforces 2-100 characters and a string", () => {
        expect(normalizeSearchQuery("a")).toBeNull();
        expect(normalizeSearchQuery("   a  ")).toBeNull();
        expect(normalizeSearchQuery("ab")).toBe("ab");
        expect(normalizeSearchQuery("x".repeat(100))).toHaveLength(100);
        expect(normalizeSearchQuery("x".repeat(101))).toBeNull();
        expect(normalizeSearchQuery(5)).toBeNull();
        expect(normalizeSearchQuery(undefined)).toBeNull();
    });
});

describe("parseSearchPayload", () => {
    it("accepts a plain query, a channel scope, a DM scope and a cursor", () => {
        expect(parseSearchPayload({ query: "log" })).toEqual({ query: "log", channelId: undefined, dmPartnerId: undefined, before: undefined });
        expect(parseSearchPayload({ query: "log", channelId: "c1" })?.channelId).toBe("c1");
        expect(parseSearchPayload({ query: "log", dmPartnerId: "u1" })?.dmPartnerId).toBe("u1");
        const p = parseSearchPayload({ query: "log", before: "2026-10-14T10:00:00.000Z" });
        expect(p?.before?.toISOString()).toBe("2026-10-14T10:00:00.000Z");
    });
    it("refuses both scopes, bad ids, a bad cursor and non-objects", () => {
        expect(parseSearchPayload({ query: "log", channelId: "c1", dmPartnerId: "u1" })).toBeNull();
        expect(parseSearchPayload({ query: "log", channelId: "" })).toBeNull();
        expect(parseSearchPayload({ query: "log", channelId: "x".repeat(65) })).toBeNull();
        expect(parseSearchPayload({ query: "log", dmPartnerId: 5 })).toBeNull();
        expect(parseSearchPayload({ query: "log", before: "yesterday" })).toBeNull();
        expect(parseSearchPayload({ query: "log", before: 12 })).toBeNull();
        expect(parseSearchPayload({ query: "l" })).toBeNull();
        expect(parseSearchPayload(null)).toBeNull();
        expect(parseSearchPayload("log")).toBeNull();
    });
});

describe("shouldAllowSearch", () => {
    it("allows the first search and one per second", () => {
        expect(shouldAllowSearch(undefined, 5000)).toBe(true);
        expect(shouldAllowSearch(5000, 5500)).toBe(false);
        expect(shouldAllowSearch(5000, 6000)).toBe(true);
    });
});
