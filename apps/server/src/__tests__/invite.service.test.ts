import { describe, expect, it } from "vitest";
import {
    INVITE_ALPHABET,
    INVITE_CODE_LENGTH,
    INVITE_FAIL_LIMIT,
    claimInviteUse,
    findUsableInviteId,
    formatInviteCode,
    generateInviteCode,
    hashInviteCode,
    inviteStatus,
    isInviteThrottled,
    normalizeInviteCode,
    parseCreateInvite,
} from "../services/invite.service.js";

describe("generateInviteCode", () => {
    it("is 12 characters from the Crockford alphabet", () => {
        for (let i = 0; i < 200; i++) {
            const c = generateInviteCode();
            expect(c).toHaveLength(INVITE_CODE_LENGTH);
            for (const ch of c) expect(INVITE_ALPHABET).toContain(ch);
        }
    });
    it("never uses the confusable letters I, L, O, U", () => {
        expect(INVITE_ALPHABET).not.toMatch(/[ILOU]/);
        expect(INVITE_ALPHABET).toHaveLength(32);
    });
    it("does not repeat (sanity check on the randomness)", () => {
        const seen = new Set<string>();
        for (let i = 0; i < 500; i++) seen.add(generateInviteCode());
        expect(seen.size).toBe(500);
    });
    it("uses the whole alphabet over many draws", () => {
        const seen = new Set<string>();
        for (let i = 0; i < 400; i++) for (const ch of generateInviteCode()) seen.add(ch);
        expect(seen.size).toBe(32);
    });
});

describe("normalizeInviteCode", () => {
    it("accepts dashes, spaces and lower case", () => {
        expect(normalizeInviteCode("abcd-efgh-jkmn")).toBe("ABCDEFGHJKMN");
        expect(normalizeInviteCode("  ABCD EFGH JKMN ")).toBe("ABCDEFGHJKMN");
        expect(normalizeInviteCode("ABCDEFGHJKMN")).toBe("ABCDEFGHJKMN");
    });
    it("applies Crockford's substitutions (O→0, I/L→1)", () => {
        expect(normalizeInviteCode("OOOO-IIII-LLLL")).toBe("000011111111");
    });
    it("rejects the wrong length, other characters and non-strings", () => {
        expect(normalizeInviteCode("ABCD")).toBeNull();
        expect(normalizeInviteCode("ABCDEFGHJKMNP")).toBeNull();
        expect(normalizeInviteCode("ABCD-EFGH-JKM!")).toBeNull();
        expect(normalizeInviteCode("ABCD-EFGH-UUUU")).toBeNull(); // U is not in the alphabet
        expect(normalizeInviteCode(12345 as never)).toBeNull();
        expect(normalizeInviteCode(null)).toBeNull();
        expect(normalizeInviteCode("A".repeat(10_000))).toBeNull();
    });
    it("round-trips a generated code through its display form", () => {
        for (let i = 0; i < 50; i++) {
            const c = generateInviteCode();
            expect(normalizeInviteCode(formatInviteCode(c))).toBe(c);
        }
    });
});

describe("formatInviteCode / hashInviteCode", () => {
    it("groups as XXXX-XXXX-XXXX", () => {
        expect(formatInviteCode("ABCDEFGHJKMN")).toBe("ABCD-EFGH-JKMN");
    });
    it("hashes the normalized code stably, with every spelling alike", () => {
        const a = hashInviteCode(normalizeInviteCode("abcd-efgh-jkmn")!);
        const b = hashInviteCode(normalizeInviteCode("ABCDEFGHJKMN")!);
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{64}$/);
        expect(hashInviteCode("ABCDEFGHJKMP")).not.toBe(a);
    });
});

describe("inviteStatus", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const base = { revokedAt: null, expiresAt: null, maxUses: null, uses: 0 };
    it("is active with no limits", () => expect(inviteStatus(base, now)).toBe("active"));
    it("is revoked first, whatever else is true", () => {
        expect(inviteStatus({ ...base, revokedAt: now, uses: 9, maxUses: 1 }, now)).toBe("revoked");
    });
    it("expires exactly at its time", () => {
        expect(inviteStatus({ ...base, expiresAt: new Date("2026-10-10T12:00:00Z") }, now)).toBe("expired");
        expect(inviteStatus({ ...base, expiresAt: new Date("2026-10-10T12:00:01Z") }, now)).toBe("active");
    });
    it("is used up at maxUses", () => {
        expect(inviteStatus({ ...base, maxUses: 3, uses: 2 }, now)).toBe("active");
        expect(inviteStatus({ ...base, maxUses: 3, uses: 3 }, now)).toBe("used-up");
    });
});

describe("isInviteThrottled", () => {
    it("blocks at the limit and not before", () => {
        expect(isInviteThrottled(INVITE_FAIL_LIMIT - 1)).toBe(false);
        expect(isInviteThrottled(INVITE_FAIL_LIMIT)).toBe(true);
        expect(isInviteThrottled(0)).toBe(false);
    });
});

describe("parseCreateInvite", () => {
    it("accepts an empty payload as 'never expires, unlimited'", () => {
        expect(parseCreateInvite({})).toEqual({ ok: true, value: { label: null, expiresInHours: null, maxUses: null } });
        expect(parseCreateInvite(undefined)).toEqual({ ok: true, value: { label: null, expiresInHours: null, maxUses: null } });
    });
    it("accepts the offered expiries and a whole-number max", () => {
        const r = parseCreateInvite({ label: "  friends ", expiresInHours: 24, maxUses: 5 });
        expect(r).toEqual({ ok: true, value: { label: "friends", expiresInHours: 24, maxUses: 5 } });
    });
    it.each([
        [{ expiresInHours: 5 }],
        [{ expiresInHours: "24" }],
        [{ maxUses: 0 }],
        [{ maxUses: 1.5 }],
        [{ maxUses: 1001 }],
        [{ maxUses: "3" }],
        [{ label: 5 }],
        [{ label: "x".repeat(65) }],
    ])("rejects %j", (payload) => {
        expect(parseCreateInvite(payload).ok).toBe(false);
    });
    it("treats a blank label as none", () => {
        expect(parseCreateInvite({ label: "   " })).toEqual({ ok: true, value: { label: null, expiresInHours: null, maxUses: null } });
    });
});

describe("claim helpers (against a fake database)", () => {
    it("findUsableInviteId returns the id of the first row, or null", async () => {
        const found = await findUsableInviteId({ $queryRaw: async () => [{ id: "i1" }] as never }, "s", "h");
        expect(found).toBe("i1");
        const none = await findUsableInviteId({ $queryRaw: async () => [] as never }, "s", "h");
        expect(none).toBeNull();
    });
    it("claimInviteUse is true only when exactly one row was updated", async () => {
        expect(await claimInviteUse({ $queryRaw: async () => [{ id: "i1" }] as never }, "s", "i1")).toBe(true);
        expect(await claimInviteUse({ $queryRaw: async () => [] as never }, "s", "i1")).toBe(false);
    });
});
