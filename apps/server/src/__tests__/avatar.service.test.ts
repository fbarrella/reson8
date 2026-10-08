import { describe, it, expect } from "vitest";
import { buildAvatarUrl, parseAvatarSelection } from "../services/avatar.service.js";

// sha256("test@example.com") — the hash used in the PRD's live probe.
const HASH = "973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b";

describe("parseAvatarSelection", () => {
    it("accepts both providers with a lower-case SHA-256 hex hash", () => {
        expect(parseAvatarSelection({ provider: "libravatar", hash: HASH })).toEqual({
            ok: true,
            value: { provider: "libravatar", hash: HASH },
        });
        expect(parseAvatarSelection({ provider: "gravatar", hash: HASH })).toEqual({
            ok: true,
            value: { provider: "gravatar", hash: HASH },
        });
    });

    it("accepts null as 'clear my avatar'", () => {
        expect(parseAvatarSelection(null)).toEqual({ ok: true, value: null });
    });

    it("drops extra keys instead of passing them through", () => {
        const result = parseAvatarSelection({ provider: "gravatar", hash: HASH, url: "https://evil.example/x.png" });
        expect(result).toEqual({ ok: true, value: { provider: "gravatar", hash: HASH } });
    });

    it("refuses unknown providers, including inherited object keys", () => {
        expect(parseAvatarSelection({ provider: "evil", hash: HASH }).ok).toBe(false);
        expect(parseAvatarSelection({ provider: "toString", hash: HASH }).ok).toBe(false);
        expect(parseAvatarSelection({ provider: "__proto__", hash: HASH }).ok).toBe(false);
        expect(parseAvatarSelection({ hash: HASH }).ok).toBe(false);
    });

    it("refuses anything that isn't exactly 64 lower-case hex characters", () => {
        expect(parseAvatarSelection({ provider: "libravatar", hash: HASH.toUpperCase() }).ok).toBe(false);
        expect(parseAvatarSelection({ provider: "libravatar", hash: HASH.slice(1) }).ok).toBe(false);
        expect(parseAvatarSelection({ provider: "libravatar", hash: `${HASH}0` }).ok).toBe(false);
        expect(parseAvatarSelection({ provider: "libravatar", hash: "https://evil.example/x.png" }).ok).toBe(false);
        expect(parseAvatarSelection({ provider: "libravatar", hash: `${HASH.slice(0, 60)}?s=1` }).ok).toBe(false);
        expect(parseAvatarSelection({ provider: "libravatar", hash: 42 }).ok).toBe(false);
    });

    it("refuses non-object input", () => {
        expect(parseAvatarSelection(undefined).ok).toBe(false);
        expect(parseAvatarSelection("libravatar").ok).toBe(false);
        expect(parseAvatarSelection([HASH]).ok).toBe(false);
    });
});

describe("buildAvatarUrl", () => {
    it("builds each provider's fixed URL", () => {
        expect(buildAvatarUrl({ provider: "libravatar", hash: HASH })).toBe(
            `https://seccdn.libravatar.org/avatar/${HASH}?d=wavatar`,
        );
        expect(buildAvatarUrl({ provider: "gravatar", hash: HASH })).toBe(`https://gravatar.com/avatar/${HASH}?d=wavatar`);
    });

    it("maps null to null (default avatar)", () => {
        expect(buildAvatarUrl(null)).toBeNull();
    });
});
