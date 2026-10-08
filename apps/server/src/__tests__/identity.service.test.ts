import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import {
    authMessage,
    decideIdentity,
    importEd25519PublicKey,
    isHostAllowed,
    isNonceFresh,
    keyFingerprint,
    newNonce,
    NONCE_TTL_MS,
    parseIdentityProof,
    verifyAuthSignature,
    type IdentityDecisionInput,
} from "../services/identity.service.js";

function makeKey() {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    return { spki, sign: (msg: string) => sign(null, Buffer.from(msg, "utf8"), privateKey).toString("base64") };
}

describe("nonce + message", () => {
    it("nonces are 43-char base64url and unique", () => {
        const a = newNonce();
        const b = newNonce();
        expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(a).not.toBe(b);
    });
    it("message is domain-separated and binds nonce + host", () => {
        expect(authMessage("N", "chat.example.com:9800")).toBe("reson8-auth-v1\nN\nchat.example.com:9800");
    });
    it("freshness window", () => {
        expect(isNonceFresh(1000, 1000 + NONCE_TTL_MS)).toBe(true);
        expect(isNonceFresh(1000, 1001 + NONCE_TTL_MS)).toBe(false);
        expect(isNonceFresh(undefined, 1000)).toBe(false);
        expect(isNonceFresh(2000, 1000)).toBe(false); // from the future
    });
});

describe("signatures", () => {
    const k = makeKey();
    const msg = authMessage(newNonce(), "127.0.0.1:9871");

    it("verifies a real Ed25519 signature", () => {
        expect(verifyAuthSignature(k.spki, k.sign(msg), msg)).toBe(true);
    });
    it("refuses a tampered message (other nonce/host)", () => {
        expect(verifyAuthSignature(k.spki, k.sign(msg), msg.replace("127.0.0.1", "10.0.0.1"))).toBe(false);
    });
    it("refuses a signature by another key", () => {
        const other = makeKey();
        expect(verifyAuthSignature(k.spki, other.sign(msg), msg)).toBe(false);
    });
    it("refuses non-Ed25519 keys and garbage", () => {
        const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
        const ec = publicKey.export({ format: "der", type: "spki" }).toString("base64");
        expect(importEd25519PublicKey(ec)).toBeNull();
        expect(verifyAuthSignature(ec, k.sign(msg), msg)).toBe(false);
        expect(verifyAuthSignature("AAAA", k.sign(msg), msg)).toBe(false);
        expect(verifyAuthSignature(k.spki, "AAAA", msg)).toBe(false);
    });
    it("fingerprint is SSH-style and stable", () => {
        const fp = keyFingerprint(k.spki);
        expect(fp).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
        expect(keyFingerprint(k.spki)).toBe(fp);
        expect(keyFingerprint(makeKey().spki)).not.toBe(fp);
    });
});

describe("parseIdentityProof", () => {
    const k = makeKey();
    const good = { publicKey: k.spki, signature: k.sign("x"), host: "127.0.0.1:9871" };
    it("absent = legacy", () => {
        expect(parseIdentityProof(undefined)).toEqual({ ok: true, value: undefined });
        expect(parseIdentityProof(null)).toEqual({ ok: true, value: undefined });
    });
    it("accepts a well-formed proof", () => {
        expect(parseIdentityProof(good)).toEqual({ ok: true, value: good });
    });
    it("refuses malformed fields", () => {
        expect(parseIdentityProof({ ...good, publicKey: 42 }).ok).toBe(false);
        expect(parseIdentityProof({ ...good, publicKey: "not base64!" }).ok).toBe(false);
        expect(parseIdentityProof({ ...good, signature: "x".repeat(300) }).ok).toBe(false);
        expect(parseIdentityProof({ ...good, host: "" }).ok).toBe(false);
        expect(parseIdentityProof({ ...good, host: "has space" }).ok).toBe(false);
        expect(parseIdentityProof({ ...good, host: "h".repeat(256) }).ok).toBe(false);
        expect(parseIdentityProof("string").ok).toBe(false);
        expect(parseIdentityProof([good]).ok).toBe(false);
    });
});

describe("isHostAllowed", () => {
    it("empty list allows any host", () => {
        expect(isHostAllowed("anything", [])).toBe(true);
    });
    it("checks the list case-insensitively", () => {
        expect(isHostAllowed("Chat.Example.com", ["chat.example.com"])).toBe(true);
        expect(isHostAllowed("evil.example", ["chat.example.com"])).toBe(false);
    });
});

describe("decideIdentity", () => {
    const KEY = "KEY-A";
    const OTHER = "KEY-B";
    const base: IdentityDecisionInput = { proof: null, boundKey: null, requireSigned: false, isAdminId: false, adminFingerprint: null };
    const signed = (publicKey: string, extra: Partial<NonNullable<IdentityDecisionInput["proof"]>> = {}) => ({
        publicKey,
        fingerprint: `FP-${publicKey}`,
        signatureValid: true,
        hostAllowed: true,
        ...extra,
    });

    it("signed, same key bound → accept", () => {
        expect(decideIdentity({ ...base, proof: signed(KEY), boundKey: KEY })).toEqual({ action: "accept", bind: false, grantAdmin: false });
    });
    it("signed, other key bound → refuse (another device)", () => {
        expect(decideIdentity({ ...base, proof: signed(OTHER), boundKey: KEY })).toEqual({ action: "refuse", reason: "otherDevice" });
    });
    it("signed, unbound → accept and BIND", () => {
        expect(decideIdentity({ ...base, proof: signed(KEY) })).toEqual({ action: "accept", bind: true, grantAdmin: false });
    });
    it("signed but invalid signature → refuse, even if the key matches", () => {
        expect(decideIdentity({ ...base, proof: signed(KEY, { signatureValid: false }), boundKey: KEY })).toEqual({ action: "refuse", reason: "verificationFailed" });
    });
    it("signed for a host outside AUTH_ALLOWED_HOSTS → refuse", () => {
        expect(decideIdentity({ ...base, proof: signed(KEY, { hostAllowed: false }) })).toEqual({ action: "refuse", reason: "hostNotAllowed" });
    });
    it("legacy on a bound id → refuse (protected)", () => {
        expect(decideIdentity({ ...base, boundKey: KEY })).toEqual({ action: "refuse", reason: "protectedUpdate" });
    });
    it("legacy on an unbound id → accept (gradual rollout)", () => {
        expect(decideIdentity(base)).toEqual({ action: "accept", bind: false, grantAdmin: false });
    });
    it("legacy with REQUIRE_SIGNED_IDENTITY → refuse", () => {
        expect(decideIdentity({ ...base, requireSigned: true })).toEqual({ action: "refuse", reason: "requiresSigned" });
    });
    it("REQUIRE_SIGNED_IDENTITY doesn't affect signed joins", () => {
        expect(decideIdentity({ ...base, requireSigned: true, proof: signed(KEY) })).toEqual({ action: "accept", bind: true, grantAdmin: false });
    });

    describe("admin", () => {
        const admin = { ...base, isAdminId: true };
        it("no fingerprint set: admin binds by first use and gets the role", () => {
            expect(decideIdentity({ ...admin, proof: signed(KEY) })).toEqual({ action: "accept", bind: true, grantAdmin: true });
            expect(decideIdentity(admin)).toEqual({ action: "accept", bind: false, grantAdmin: true }); // legacy, as before
        });
        it("fingerprint set: only that key may bind the admin id", () => {
            const fp = { ...admin, adminFingerprint: `FP-${KEY}` };
            expect(decideIdentity({ ...fp, proof: signed(KEY) })).toEqual({ action: "accept", bind: true, grantAdmin: true });
            expect(decideIdentity({ ...fp, proof: signed(OTHER) })).toEqual({ action: "refuse", reason: "otherDevice" });
        });
        it("fingerprint set: a legacy (unsigned) admin join is refused", () => {
            expect(decideIdentity({ ...admin, adminFingerprint: "FP-X" })).toEqual({ action: "refuse", reason: "protectedUpdate" });
        });
        it("fingerprint set later: a bound admin key that doesn't match keeps the id but loses the auto role", () => {
            expect(decideIdentity({ ...admin, adminFingerprint: `FP-${OTHER}`, boundKey: KEY, proof: signed(KEY) })).toEqual({ action: "accept", bind: false, grantAdmin: false });
        });
        it("a non-admin id never gets the role", () => {
            expect(decideIdentity({ ...base, adminFingerprint: `FP-${KEY}`, proof: signed(KEY) })).toEqual({ action: "accept", bind: true, grantAdmin: false });
        });
    });
});
