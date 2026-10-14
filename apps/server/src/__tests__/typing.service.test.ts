import { describe, expect, it } from "vitest";
import { parseTypingPayload, shouldRelayTyping, TYPING_MIN_INTERVAL_MS } from "../services/typing.service.js";

describe("parseTypingPayload", () => {
    it("accepts a channel id or a DM partner id", () => {
        expect(parseTypingPayload({ channelId: "c1" })).toEqual({ kind: "channel", channelId: "c1" });
        expect(parseTypingPayload({ dmPartnerId: "u1" })).toEqual({ kind: "dm", partnerId: "u1" });
    });

    it("refuses both ids, neither, an oversized id and non-objects", () => {
        expect(parseTypingPayload({ channelId: "c1", dmPartnerId: "u1" })).toBeNull();
        expect(parseTypingPayload({})).toBeNull();
        expect(parseTypingPayload({ channelId: "x".repeat(65) })).toBeNull();
        expect(parseTypingPayload({ channelId: "" })).toBeNull();
        expect(parseTypingPayload({ channelId: 5 })).toBeNull();
        expect(parseTypingPayload(null)).toBeNull();
        expect(parseTypingPayload("typing")).toBeNull();
        expect(parseTypingPayload(undefined)).toBeNull();
    });
});

describe("shouldRelayTyping", () => {
    it("relays the first signal and then at most one per interval", () => {
        expect(shouldRelayTyping(undefined, 1000)).toBe(true);
        expect(shouldRelayTyping(1000, 2000)).toBe(false);
        expect(shouldRelayTyping(1000, 1000 + TYPING_MIN_INTERVAL_MS)).toBe(true);
    });
});
