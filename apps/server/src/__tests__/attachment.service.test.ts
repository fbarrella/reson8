import { describe, it, expect } from "vitest";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@reson8/shared-types";
import {
    attachmentFields,
    attachmentUrlsToRelease,
    normalizeAttachmentInput,
    toAttachmentDtos,
} from "../services/attachment.service.js";

describe("normalizeAttachmentInput", () => {
    it("accepts a list of ids and keeps their order", () => {
        expect(normalizeAttachmentInput({ attachmentIds: ["c", "a", "b"] })).toEqual({ ids: ["c", "a", "b"], urls: [] });
    });

    it("de-duplicates ids, first occurrence wins", () => {
        expect(normalizeAttachmentInput({ attachmentIds: ["a", "b", "a"] })).toEqual({ ids: ["a", "b"], urls: [] });
    });

    it("accepts a legacy single URL (a pre-v2.5.0 client)", () => {
        expect(normalizeAttachmentInput({ attachmentUrl: "http://h:9800/uploads/x.png" })).toEqual({
            ids: [],
            urls: ["http://h:9800/uploads/x.png"],
        });
    });

    it("prefers ids over the legacy URL when a v2.5.0 client sends both", () => {
        expect(normalizeAttachmentInput({ attachmentIds: ["a"], attachmentUrl: "http://h:9800/uploads/x.png" })).toEqual({
            ids: ["a"],
            urls: [],
        });
    });

    it("returns an empty request when there is no attachment", () => {
        expect(normalizeAttachmentInput({})).toEqual({ ids: [], urls: [] });
        expect(normalizeAttachmentInput({ attachmentIds: [] })).toEqual({ ids: [], urls: [] });
    });

    it(`allows exactly ${MAX_ATTACHMENTS_PER_MESSAGE} and rejects one more`, () => {
        const ten = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE }, (_, i) => `id${i}`);
        expect(normalizeAttachmentInput({ attachmentIds: ten })).toEqual({ ids: ten, urls: [] });
        expect(normalizeAttachmentInput({ attachmentIds: [...ten, "extra"] })).toEqual({
            error: `At most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments are allowed`,
        });
    });

    it("rejects malformed input", () => {
        expect(normalizeAttachmentInput({ attachmentIds: "a" })).toEqual({ error: "Invalid attachment" });
        expect(normalizeAttachmentInput({ attachmentIds: [1, 2] })).toEqual({ error: "Invalid attachment" });
        expect(normalizeAttachmentInput({ attachmentIds: ["ok", ""] })).toEqual({ error: "Invalid attachment" });
    });
});

describe("toAttachmentDtos", () => {
    it("orders by position and exposes only the url", () => {
        const rows = [
            { url: "/uploads/b.png", position: 1, publicId: "secret" },
            { url: "/uploads/a.png", position: 0 },
            { url: "/uploads/c.png", position: 2 },
        ];
        const dtos = toAttachmentDtos(rows);
        expect(dtos).toEqual([{ url: "/uploads/a.png" }, { url: "/uploads/b.png" }, { url: "/uploads/c.png" }]);
        expect(JSON.stringify(dtos)).not.toContain("secret");
    });

    it("does not mutate its input", () => {
        const rows = [{ url: "b", position: 1 }, { url: "a", position: 0 }];
        toAttachmentDtos(rows);
        expect(rows.map((r) => r.url)).toEqual(["b", "a"]);
    });
});

describe("attachmentFields", () => {
    it("sets the deprecated attachmentUrl to the FIRST image (what a v2.4.0 client shows)", () => {
        const f = attachmentFields([{ url: "/uploads/b.png", position: 1 }, { url: "/uploads/a.png", position: 0 }]);
        expect(f.attachmentUrl).toBe("/uploads/a.png");
        expect(f.attachments).toHaveLength(2);
    });

    it("is empty and null for a text-only message", () => {
        expect(attachmentFields([])).toEqual({ attachments: [], attachmentUrl: null });
    });

    it("falls back to the deprecated column for a row the backfill missed", () => {
        expect(attachmentFields([], "http://old:9800/uploads/legacy.png")).toEqual({
            attachments: [{ url: "http://old:9800/uploads/legacy.png" }],
            attachmentUrl: "http://old:9800/uploads/legacy.png",
        });
    });

    it("does not let the legacy column shadow real attachments", () => {
        expect(attachmentFields([{ url: "/uploads/new.png", position: 0 }], "http://old:9800/uploads/legacy.png").attachments).toEqual([
            { url: "/uploads/new.png" },
        ]);
    });
});

describe("attachmentUrlsToRelease", () => {
    it("collects every attachment plus the legacy column, de-duplicated", () => {
        expect(attachmentUrlsToRelease([{ url: "/uploads/a.png" }, { url: "/uploads/b.png" }, { url: "/uploads/a.png" }], "/uploads/c.png").sort()).toEqual([
            "/uploads/a.png",
            "/uploads/b.png",
            "/uploads/c.png",
        ]);
        expect(attachmentUrlsToRelease([], null)).toEqual([]);
    });
});
