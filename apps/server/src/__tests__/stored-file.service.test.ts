import { describe, it, expect } from "vitest";
import type { Redis } from "ioredis";
import {
    assertAllClaimed,
    extractBearerToken,
    generateUploadToken,
    hashUploadToken,
    issueUploadToken,
    localUploadBasename,
    normalizeUploadUrl,
    orderClaimed,
    parseClaimRequest,
    resolveUploadTokenOwner,
    UploadClaimError,
    uploadTokenKey,
} from "../services/stored-file.service.js";
import { UPLOAD_TOKEN_REDIS_PREFIX, UPLOAD_TOKEN_TTL_SEC } from "../config/upload.config.js";

describe("normalizeUploadUrl", () => {
    it("reduces an absolute local-disk URL to its host-independent path", () => {
        expect(normalizeUploadUrl("http://10.0.0.5:9800/uploads/abc-pic.png")).toBe("/uploads/abc-pic.png");
        expect(normalizeUploadUrl("https://chat.example.com/uploads/abc-pic.png")).toBe("/uploads/abc-pic.png");
    });

    it("keeps an already-canonical path and trims whitespace", () => {
        expect(normalizeUploadUrl("/uploads/abc-pic.png")).toBe("/uploads/abc-pic.png");
        expect(normalizeUploadUrl("  /uploads/abc-pic.png \n")).toBe("/uploads/abc-pic.png");
    });

    it("leaves Cloudinary and other external URLs untouched", () => {
        const cloud = "https://res.cloudinary.com/demo/image/upload/v1/reson8/pic.png";
        expect(normalizeUploadUrl(cloud)).toBe(cloud);
        expect(normalizeUploadUrl("https://evil.example/tracker.png")).toBe("https://evil.example/tracker.png");
    });

    it("does not treat non-http schemes or garbage as uploads", () => {
        expect(normalizeUploadUrl("javascript://x/uploads/a.png")).toBe("javascript://x/uploads/a.png");
        expect(normalizeUploadUrl("not a url")).toBe("not a url");
    });
});

describe("localUploadBasename", () => {
    it("extracts the file name for local uploads in either form", () => {
        expect(localUploadBasename("/uploads/a-b.png")).toBe("a-b.png");
        expect(localUploadBasename("http://h:1/uploads/a-b.png")).toBe("a-b.png");
    });

    it("is null for Cloudinary/external URLs", () => {
        expect(localUploadBasename("https://res.cloudinary.com/demo/image/upload/x.png")).toBeNull();
    });

    it("never yields a directory-traversal segment", () => {
        expect(localUploadBasename("/uploads/../etc/passwd")).toBe("passwd");
        expect(localUploadBasename("/uploads/..")).toBeNull();
    });
});

describe("upload tokens", () => {
    it("generates distinct URL-safe tokens", () => {
        const a = generateUploadToken();
        const b = generateUploadToken();
        expect(a).not.toBe(b);
        expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it("stores only a hash — the Redis key never contains the token", () => {
        const token = generateUploadToken();
        const key = uploadTokenKey(token);
        expect(key.startsWith(UPLOAD_TOKEN_REDIS_PREFIX)).toBe(true);
        expect(key).not.toContain(token);
        expect(key).toBe(UPLOAD_TOKEN_REDIS_PREFIX + hashUploadToken(token));
        expect(hashUploadToken(token)).toMatch(/^[0-9a-f]{64}$/);
    });

    it("extracts a bearer token and rejects malformed headers", () => {
        const token = generateUploadToken();
        expect(extractBearerToken(`Bearer ${token}`)).toBe(token);
        expect(extractBearerToken(`bearer   ${token}`)).toBe(token);
        expect(extractBearerToken(undefined)).toBeNull();
        expect(extractBearerToken("Basic abc")).toBeNull();
        expect(extractBearerToken("Bearer short")).toBeNull();
        expect(extractBearerToken(`Bearer ${token} extra`)).toBeNull();
    });

    it("round-trips through a (fake) Redis with the configured TTL, and unknown tokens resolve to null", async () => {
        const store = new Map<string, { value: string; ttl: number }>();
        const redis = {
            set: async (key: string, value: string, _ex: string, ttl: number) => {
                store.set(key, { value, ttl });
                return "OK";
            },
            get: async (key: string) => store.get(key)?.value ?? null,
        } as unknown as Redis;

        const { token, expiresInSec } = await issueUploadToken(redis, "user-1");
        expect(expiresInSec).toBe(UPLOAD_TOKEN_TTL_SEC);
        expect(store.get(uploadTokenKey(token))?.ttl).toBe(UPLOAD_TOKEN_TTL_SEC);
        expect(await resolveUploadTokenOwner(redis, token)).toBe("user-1");
        expect(await resolveUploadTokenOwner(redis, generateUploadToken())).toBeNull();
    });
});

describe("parseClaimRequest", () => {
    it("prefers ids over a legacy URL", () => {
        expect(parseClaimRequest(["a"], "http://h/uploads/x.png", 1)).toEqual({ ids: ["a"], urls: [] });
    });

    it("falls back to the legacy URL when there are no ids", () => {
        expect(parseClaimRequest(undefined, "http://h/uploads/x.png", 1)).toEqual({ ids: [], urls: ["http://h/uploads/x.png"] });
        expect(parseClaimRequest([], "/uploads/x.png", 1)).toEqual({ ids: [], urls: ["/uploads/x.png"] });
    });

    it("returns an empty request for a text-only message", () => {
        expect(parseClaimRequest(undefined, undefined, 1)).toEqual({ ids: [], urls: [] });
        expect(parseClaimRequest([], "   ", 1)).toEqual({ ids: [], urls: [] });
    });

    it("de-duplicates ids and enforces the maximum", () => {
        expect(parseClaimRequest(["a", "a"], undefined, 1)).toEqual({ ids: ["a"], urls: [] });
        expect(parseClaimRequest(["a", "b"], undefined, 1)).toEqual({ error: "Only one attachment is allowed" });
        expect(parseClaimRequest(["a", "b", "c"], undefined, 2)).toEqual({ error: "At most 2 attachments are allowed" });
    });

    it("rejects malformed input", () => {
        expect(parseClaimRequest("a", undefined, 1)).toEqual({ error: "Invalid attachment" });
        expect(parseClaimRequest([1], undefined, 1)).toEqual({ error: "Invalid attachment" });
        expect(parseClaimRequest([""], undefined, 1)).toEqual({ error: "Invalid attachment" });
        expect(parseClaimRequest(undefined, "x".repeat(3000), 1)).toEqual({ error: "Invalid attachment" });
    });
});

describe("claim result helpers", () => {
    const rows = [
        { id: "b", url: "/uploads/b", publicId: null },
        { id: "a", url: "/uploads/a", publicId: "pa" },
    ];

    it("restores request order", () => {
        expect(orderClaimed(rows, ["a", "b"], "id").map((r) => r.id)).toEqual(["a", "b"]);
        expect(orderClaimed(rows, ["/uploads/b", "/uploads/a"], "url").map((r) => r.id)).toEqual(["b", "a"]);
    });

    it("throws UploadClaimError unless every requested file was claimed", () => {
        expect(() => assertAllClaimed(2, 2)).not.toThrow();
        expect(() => assertAllClaimed(2, 1)).toThrow(UploadClaimError);
        expect(() => assertAllClaimed(1, 0)).toThrow(/no longer available/);
    });
});
