import { describe, it, expect } from "vitest";
import type { IReplyPreview } from "@reson8/shared-types";
import {
    REPLY_PREVIEW_MAX_CHARS,
    dmInPair,
    isChannelReplyAllowed,
    isDmReplyAllowed,
    parseReplyToId,
    replyPreviewFor,
    toReplyPreview,
    truncateForPreview,
} from "../services/reply.service.js";

describe("truncateForPreview", () => {
    it("leaves short text alone", () => {
        expect(truncateForPreview("hello world")).toBe("hello world");
        expect(truncateForPreview("")).toBe("");
    });

    it("collapses newlines and runs of whitespace into single spaces (one line for the snippet)", () => {
        expect(truncateForPreview("line one\n\nline   two\t\tline three")).toBe("line one line two line three");
    });

    it("trims leading and trailing whitespace", () => {
        expect(truncateForPreview("  \n hi \n ")).toBe("hi");
    });

    it("keeps exactly the maximum length untouched and cuts one over with an ellipsis", () => {
        const exact = "a".repeat(REPLY_PREVIEW_MAX_CHARS);
        expect(truncateForPreview(exact)).toBe(exact);
        const over = truncateForPreview("a".repeat(REPLY_PREVIEW_MAX_CHARS + 1));
        expect(over).toBe("a".repeat(REPLY_PREVIEW_MAX_CHARS) + "…");
    });

    it("never splits an emoji (cuts by code point, not UTF-16 unit)", () => {
        const out = truncateForPreview("😀".repeat(REPLY_PREVIEW_MAX_CHARS + 5));
        expect(Array.from(out)).toHaveLength(REPLY_PREVIEW_MAX_CHARS + 1); // 200 emoji + the ellipsis
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)).toBe(false); // no lone surrogate
    });

    it("does not leave whitespace before the ellipsis", () => {
        const out = truncateForPreview("a".repeat(REPLY_PREVIEW_MAX_CHARS - 1) + " " + "b".repeat(50));
        expect(out.endsWith(" …")).toBe(false);
        expect(out.endsWith("…")).toBe(true);
    });
});

describe("toReplyPreview", () => {
    it("describes an existing original, with truncated one-line content", () => {
        expect(
            toReplyPreview("m1", { id: "m1", userId: "u1", nickname: "Alice", content: "a\nb", hasAttachments: true }),
        ).toEqual({ id: "m1", deleted: false, userId: "u1", nickname: "Alice", content: "a b", hasAttachments: true });
    });

    it("marks a missing original as deleted and carries none of its details", () => {
        expect(toReplyPreview("gone", undefined)).toEqual({ id: "gone", deleted: true });
    });
});

describe("replyPreviewFor", () => {
    const previews = new Map<string, IReplyPreview>([["m1", { id: "m1", deleted: false, nickname: "Alice", content: "hi" }]]);

    it("is null for a message that isn't a reply", () => {
        expect(replyPreviewFor(null, previews)).toBeNull();
        expect(replyPreviewFor(undefined, previews)).toBeNull();
    });

    it("returns the loaded preview", () => {
        expect(replyPreviewFor("m1", previews)?.nickname).toBe("Alice");
    });

    it("falls back to deleted when the id was never loaded, so a reply never loses the fact that it is one", () => {
        expect(replyPreviewFor("unknown", previews)).toEqual({ id: "unknown", deleted: true });
    });
});

describe("parseReplyToId", () => {
    it("treats absence as 'not a reply'", () => {
        expect(parseReplyToId(undefined)).toEqual({ replyToId: null });
        expect(parseReplyToId(null)).toEqual({ replyToId: null });
    });

    it("accepts a normal id", () => {
        expect(parseReplyToId("3f6c0a52-0b6a-4f0e-9f9e-0d7f1d2c8a11")).toEqual({ replyToId: "3f6c0a52-0b6a-4f0e-9f9e-0d7f1d2c8a11" });
    });

    it("rejects malformed values", () => {
        for (const bad of ["", "x".repeat(65), 42, {}, [], true]) {
            expect(parseReplyToId(bad)).toEqual({ error: "Invalid reply target" });
        }
    });
});

describe("isChannelReplyAllowed", () => {
    it("allows a target in the same channel", () => {
        expect(isChannelReplyAllowed({ channelId: "c1" }, "c1")).toBe(true);
    });

    it("refuses a target in another channel (it would leak that channel's text)", () => {
        expect(isChannelReplyAllowed({ channelId: "c2" }, "c1")).toBe(false);
    });

    it("allows a target that no longer exists (deleted while the user was typing)", () => {
        expect(isChannelReplyAllowed(null, "c1")).toBe(true);
    });
});

describe("DM reply rules", () => {
    it("dmInPair accepts the pair in either direction and nobody else", () => {
        expect(dmInPair({ senderId: "a", receiverId: "b" }, "a", "b")).toBe(true);
        expect(dmInPair({ senderId: "b", receiverId: "a" }, "a", "b")).toBe(true);
        expect(dmInPair({ senderId: "a", receiverId: "c" }, "a", "b")).toBe(false);
        expect(dmInPair({ senderId: "c", receiverId: "b" }, "a", "b")).toBe(false);
        expect(dmInPair({ senderId: "c", receiverId: "d" }, "a", "b")).toBe(false);
    });

    it("isDmReplyAllowed: in-pair and deleted targets are fine, someone else's DM is not", () => {
        expect(isDmReplyAllowed({ senderId: "a", receiverId: "b" }, "a", "b")).toBe(true);
        expect(isDmReplyAllowed(null, "a", "b")).toBe(true);
        expect(isDmReplyAllowed({ senderId: "x", receiverId: "y" }, "a", "b")).toBe(false);
    });
});
