/**
 * Identity proof (PRD 17.12) — the pure half (no Electron imports), so a
 * Node smoke test can sign with it and verify with the SERVER's verifier
 * (`scripts/identity-smoke.mjs`). The key storage lives in identity-key.ts.
 *
 * The client signs exactly "reson8-auth-v1\n<nonce>\n<host>". It refuses
 * anything that isn't a server-shaped nonce and a plain host, so a
 * compromised renderer can't obtain a signature over arbitrary data.
 */

import { createHash, createPublicKey, sign, type KeyObject } from "crypto";

export const AUTH_MESSAGE_PREFIX = "reson8-auth-v1";

/** 32 random bytes, base64url — exactly what the server issues. */
export function isValidNonce(nonce: unknown): nonce is string {
    return typeof nonce === "string" && /^[A-Za-z0-9_-]{43}$/.test(nonce);
}

/** host[:port] as typed in the connect box: 1–255 printable, non-space ASCII. */
export function isValidHost(host: unknown): host is string {
    return typeof host === "string" && /^[\x21-\x7e]{1,255}$/.test(host);
}

export function authMessage(nonce: string, host: string): string {
    return `${AUTH_MESSAGE_PREFIX}\n${nonce}\n${host}`;
}

/** Base64 SPKI DER of a key's public half. */
export function publicKeyBase64(privateKey: KeyObject): string {
    return createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64");
}

/** SSH-style "SHA256:…" fingerprint — identical to the server's keyFingerprint(). */
export function fingerprintOf(spkiBase64: string): string {
    const digest = createHash("sha256").update(Buffer.from(spkiBase64, "base64")).digest("base64");
    return `SHA256:${digest.replace(/=+$/, "")}`;
}

/** The signature for a challenge, or null when the nonce/host isn't well-formed. */
export function signChallenge(privateKey: KeyObject, nonce: unknown, host: unknown): string | null {
    if (!isValidNonce(nonce) || !isValidHost(host)) return null;
    return sign(null, Buffer.from(authMessage(nonce, host), "utf8"), privateKey).toString("base64");
}
