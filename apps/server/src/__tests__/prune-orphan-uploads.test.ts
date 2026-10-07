import { describe, it, expect } from "vitest";
import { extractUploadBasename, findOrphanFiles, formatBytes } from "../../scripts/prune-orphan-uploads.mjs";

describe("extractUploadBasename", () => {
    it("reads the file name from every URL form the database can hold", () => {
        expect(extractUploadBasename("/uploads/abc-pic.png")).toBe("abc-pic.png");
        expect(extractUploadBasename("http://10.0.0.5:9800/uploads/abc-pic.png")).toBe("abc-pic.png");
        expect(extractUploadBasename("https://chat.example.com/uploads/abc-pic.png?x=1")).toBe("abc-pic.png");
    });

    it("returns null for Cloudinary and non-upload URLs", () => {
        expect(extractUploadBasename("https://res.cloudinary.com/demo/image/upload/v1/reson8/x.png")).toBeNull();
        expect(extractUploadBasename("https://example.com/other/x.png")).toBeNull();
        expect(extractUploadBasename(null)).toBeNull();
        expect(extractUploadBasename(42)).toBeNull();
    });
});

describe("findOrphanFiles", () => {
    const DAY = 24 * 3600 * 1000;
    const now = 1_000_000_000_000;
    const file = (name: string, ageMs: number, size = 10) => ({ name, size, mtimeMs: now - ageMs });
    const run = (files: ReturnType<typeof file>[], referenced: string[], minAgeMs = DAY) =>
        findOrphanFiles({ files, referenced: new Set(referenced), minAgeMs, now }).map((f) => f.name);

    it("keeps referenced files and lists unreferenced old ones", () => {
        expect(run([file("used.png", 5 * DAY), file("orphan.png", 5 * DAY)], ["used.png"])).toEqual(["orphan.png"]);
    });

    it("never lists a file modified within the minimum age (an in-flight upload)", () => {
        expect(run([file("fresh.png", DAY / 2), file("old.png", 2 * DAY)], [])).toEqual(["old.png"]);
    });

    it("treats a file exactly at the minimum age as old enough", () => {
        expect(run([file("edge.png", DAY)], [])).toEqual(["edge.png"]);
    });

    it("ignores dotfiles such as .gitkeep", () => {
        expect(run([file(".gitkeep", 9 * DAY), file("orphan.png", 9 * DAY)], [])).toEqual(["orphan.png"]);
    });

    it("with a zero minimum age everything unreferenced is listed", () => {
        expect(run([file("fresh.png", 0)], [], 0)).toEqual(["fresh.png"]);
    });
});

describe("formatBytes", () => {
    it("formats sizes", () => {
        expect(formatBytes(512)).toBe("512 B");
        expect(formatBytes(2048)).toBe("2.0 KB");
        expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    });
});
