import { describe, it, expect } from "vitest";
import { normalizeNewlines } from "../services/message-text.js";

describe("normalizeNewlines", () => {
    it("converts CRLF to LF", () => {
        expect(normalizeNewlines("a\r\nb\r\nc")).toBe("a\nb\nc");
    });

    it("converts a lone CR to LF", () => {
        expect(normalizeNewlines("a\rb")).toBe("a\nb");
    });

    it("leaves LF and plain text untouched", () => {
        expect(normalizeNewlines("a\nb")).toBe("a\nb");
        expect(normalizeNewlines("hello")).toBe("hello");
    });

    it("does not collapse consecutive blank lines", () => {
        expect(normalizeNewlines("a\r\n\r\n\r\nb")).toBe("a\n\n\nb");
    });

    it("treats null/undefined as empty", () => {
        expect(normalizeNewlines(undefined)).toBe("");
        expect(normalizeNewlines(null)).toBe("");
    });
});
