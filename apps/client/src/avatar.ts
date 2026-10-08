/**
 * Avatars (PRD 17.1).
 *
 * A PURE module — no Electron/DOM imports — so it can be exercised in plain
 * Node (see `scripts/avatar-smoke.mjs`). `preload.ts` imports it and exposes
 * it to the renderer, which is a plain `<script>` without Node's `crypto`.
 *
 * Both Libravatar and Gravatar key an avatar by the SHA-256 hex digest of the
 * trimmed, lower-cased email. The email never leaves the client: only
 * `{ provider, hash }` is sent to the Reson8 server, which builds the stored
 * URL itself (apps/server/src/services/avatar.service.ts) — the URL builder
 * here mirrors it only for the Settings preview.
 */

import { createHash } from "crypto";

export type AvatarProvider = "libravatar" | "gravatar";

export interface AvatarSelection {
    provider: AvatarProvider;
    hash: string;
}

/** Deliberately loose: the providers are the real judge. Catches typos, not RFC 5322. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export function isPlausibleEmail(email: string): boolean {
    const normalized = normalizeEmail(email);
    return normalized.length <= 254 && EMAIL_SHAPE.test(normalized);
}

export function sha256Hex(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The provider key for an email: SHA-256 hex of the normalized address. */
export function hashEmail(email: string): string {
    return sha256Hex(normalizeEmail(email));
}

/**
 * The URL of a selection — `fallback` is the `d` parameter: "wavatar" (what the
 * server stores) or "404" (the Settings preview's "is there a real picture?").
 */
export function buildAvatarUrl(selection: AvatarSelection, fallback: "wavatar" | "404" = "wavatar"): string {
    const base =
        selection.provider === "gravatar"
            ? `https://gravatar.com/avatar/${selection.hash}`
            : `https://seccdn.libravatar.org/avatar/${selection.hash}`;
    return `${base}?d=${fallback}`;
}

/**
 * The generated avatar of a user who never set one. Keyed by SHA-256 of the
 * user id, never the raw id: the id is this install's identity and must not
 * end up in a third party's logs (PRD 17.1).
 */
export function defaultAvatarUrl(userId: string): string {
    return `https://seccdn.libravatar.org/gravatarproxy/${sha256Hex(userId)}?s=80&default=wavatar`;
}

/** Sets (or replaces) the `s` size parameter; both providers accept 1–512. */
export function withAvatarSize(url: string, px: number): string {
    try {
        const parsed = new URL(url);
        const size = Math.max(1, Math.min(512, Math.round(px)));
        parsed.searchParams.set("s", String(size));
        return parsed.toString();
    } catch {
        return url;
    }
}
