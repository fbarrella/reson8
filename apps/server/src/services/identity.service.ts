/**
 * Identity (PRD 17.12) — proof that a client owns the user id it joins as.
 *
 * Before 2.6.0 a user WAS whatever `instanceId` a socket presented, and every
 * id is broadcast to every client, so anyone could join as anyone (the admin
 * included). Now each install has an Ed25519 key pair; on every connection
 * the server issues a fresh single-use nonce, the client signs
 * "reson8-auth-v1\n<nonce>\n<host>", and the server checks it against the key
 * BOUND to that id (trust on first use: the first valid signed join binds it).
 * Nothing that crosses the wire is reusable elsewhere.
 *
 * Everything here is pure except Node's crypto (no Prisma/Redis), so the whole
 * decision table is unit-tested. The handler (connection.handler.ts) feeds it.
 */

import { createHash, createPublicKey, randomBytes, verify, type KeyObject } from "node:crypto";

export const AUTH_MESSAGE_PREFIX = "reson8-auth-v1";
/** How long a challenge nonce stays valid. */
export const NONCE_TTL_MS = 60_000;

/** 32 random bytes, base64url (43 chars). */
export function newNonce(): string {
    return randomBytes(32).toString("base64url");
}

/** The exact message a client signs — domain-separated and bound to the nonce and host. */
export function authMessage(nonce: string, host: string): string {
    return `${AUTH_MESSAGE_PREFIX}\n${nonce}\n${host}`;
}

export interface IdentityProof {
    publicKey: string;
    signature: string;
    host: string;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const PRINTABLE_HOST = /^[\x21-\x7e]{1,255}$/;

/**
 * Validates the shape of a join's `identity` field. `undefined` = a legacy
 * (pre-2.6.0) client; anything present but malformed is refused.
 */
export function parseIdentityProof(input: unknown): { ok: true; value: IdentityProof | undefined } | { ok: false } {
    if (input === undefined || input === null) return { ok: true, value: undefined };
    if (typeof input !== "object" || Array.isArray(input)) return { ok: false };
    const { publicKey, signature, host } = input as Record<string, unknown>;
    if (typeof publicKey !== "string" || publicKey.length > 200 || !BASE64.test(publicKey)) return { ok: false };
    if (typeof signature !== "string" || signature.length > 200 || !BASE64.test(signature)) return { ok: false };
    if (typeof host !== "string" || !PRINTABLE_HOST.test(host)) return { ok: false };
    return { ok: true, value: { publicKey, signature, host } };
}

/** An Ed25519 public key from base64 SPKI DER — null for anything else (other key types included). */
export function importEd25519PublicKey(spkiBase64: string): KeyObject | null {
    try {
        const key = createPublicKey({ key: Buffer.from(spkiBase64, "base64"), format: "der", type: "spki" });
        return key.asymmetricKeyType === "ed25519" ? key : null;
    } catch {
        return null;
    }
}

/** True only for a valid Ed25519 signature over exactly `message` by `spkiBase64`. */
export function verifyAuthSignature(spkiBase64: string, signatureBase64: string, message: string): boolean {
    const key = importEd25519PublicKey(spkiBase64);
    if (!key) return false;
    try {
        return verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureBase64, "base64"));
    } catch {
        return false;
    }
}

/** SSH-style fingerprint: "SHA256:" + unpadded base64 of SHA-256 over the SPKI DER. */
export function keyFingerprint(spkiBase64: string): string {
    const digest = createHash("sha256").update(Buffer.from(spkiBase64, "base64")).digest("base64");
    return `SHA256:${digest.replace(/=+$/, "")}`;
}

/** Whether a challenge is still usable. */
export function isNonceFresh(issuedAt: number | undefined, now: number): boolean {
    return issuedAt !== undefined && now - issuedAt >= 0 && now - issuedAt <= NONCE_TTL_MS;
}

/** The host the client signed, checked against AUTH_ALLOWED_HOSTS (empty list = any host). */
export function isHostAllowed(host: string, allowed: readonly string[]): boolean {
    return allowed.length === 0 || allowed.includes(host.toLowerCase());
}

export const IDENTITY_MESSAGES = {
    verificationFailed: "Identity verification failed — please reconnect.",
    hostNotAllowed: "This server doesn't accept connections addressed to that host.",
    otherDevice: "This identity is registered to another device. Ask a server admin to reset it.",
    protectedUpdate: "This identity is protected — update Reson8 to connect.",
    requiresSigned: "This server requires Reson8 2.6.0 or newer.",
} as const;

export type IdentityDecision =
    | { action: "accept"; bind: boolean; grantAdmin: boolean }
    | { action: "refuse"; reason: keyof typeof IDENTITY_MESSAGES };

export interface IdentityDecisionInput {
    /** The verified proof, or null for a legacy (unsigned) join. */
    proof: { publicKey: string; fingerprint: string; signatureValid: boolean; hostAllowed: boolean } | null;
    /** The key currently bound to this id, if any. */
    boundKey: string | null;
    /** REQUIRE_SIGNED_IDENTITY=true. */
    requireSigned: boolean;
    /** This id is ADMIN_INSTANCE_ID. */
    isAdminId: boolean;
    /** ADMIN_KEY_FINGERPRINT, if set. */
    adminFingerprint: string | null;
}

/**
 * The join decision (PRD 17.12 table). Runs BEFORE any state is written.
 *
 * | signed?                | bound?        | outcome                                    |
 * | yes, valid, same key   | yes           | accept                                     |
 * | yes, valid, other key  | yes           | refuse: registered to another device       |
 * | yes, valid             | no            | accept + BIND (unless the admin fingerprint |
 * |                        |               | is set and doesn't match → refuse)          |
 * | yes, invalid / host    | —             | refuse                                     |
 * | no (legacy)            | yes           | refuse: protected, update                  |
 * | no (legacy)            | no            | accept, unless REQUIRE_SIGNED_IDENTITY, or |
 * |                        |               | it's the admin id with a fingerprint set   |
 *
 * `grantAdmin`: the ADMIN_INSTANCE_ID role is only auto-assigned when the
 * admin fingerprint is unset, or the verified key matches it.
 */
export function decideIdentity(input: IdentityDecisionInput): IdentityDecision {
    const { proof, boundKey, requireSigned, isAdminId, adminFingerprint } = input;

    if (proof) {
        if (!proof.signatureValid) return { action: "refuse", reason: "verificationFailed" };
        if (!proof.hostAllowed) return { action: "refuse", reason: "hostNotAllowed" };
        const adminKeyOk = !adminFingerprint || proof.fingerprint === adminFingerprint;
        if (boundKey !== null) {
            if (boundKey !== proof.publicKey) return { action: "refuse", reason: "otherDevice" };
            return { action: "accept", bind: false, grantAdmin: isAdminId && adminKeyOk };
        }
        // Unbound: the first valid signed join binds — but never a foreign key onto a fingerprint-protected admin id.
        if (isAdminId && !adminKeyOk) return { action: "refuse", reason: "otherDevice" };
        return { action: "accept", bind: true, grantAdmin: isAdminId };
    }

    // Legacy (unsigned) join.
    if (boundKey !== null) return { action: "refuse", reason: "protectedUpdate" };
    if (isAdminId && adminFingerprint) return { action: "refuse", reason: "protectedUpdate" };
    if (requireSigned) return { action: "refuse", reason: "requiresSigned" };
    return { action: "accept", bind: false, grantAdmin: isAdminId };
}
