import { describe, expect, it } from "vitest";
import { iconToRelease, parseIconChange } from "../services/server-icon.js";

describe("parseIconChange", () => {
    it("omitted means unchanged", () => {
        expect(parseIconChange(undefined)).toEqual({ kind: "unchanged" });
    });
    it("null removes the icon", () => {
        expect(parseIconChange(null)).toEqual({ kind: "remove" });
    });
    it("a non-empty id sets or replaces it", () => {
        expect(parseIconChange("abc-123")).toEqual({ kind: "set", uploadId: "abc-123" });
    });
    it("refuses everything else", () => {
        for (const bad of ["", "x".repeat(65), 5, true, {}, [], ["a"]]) {
            expect(parseIconChange(bad)).toEqual({ error: "Invalid icon" });
        }
    });
});

describe("iconToRelease", () => {
    it("releases the previous file when it was replaced or removed", () => {
        expect(iconToRelease("/uploads/a.png", "/uploads/b.png")).toBe("/uploads/a.png");
        expect(iconToRelease("/uploads/a.png", null)).toBe("/uploads/a.png");
    });
    it("releases nothing when there was no icon or it is the same file", () => {
        expect(iconToRelease(null, "/uploads/b.png")).toBeNull();
        expect(iconToRelease(null, null)).toBeNull();
        expect(iconToRelease("/uploads/a.png", "/uploads/a.png")).toBeNull();
    });
});
