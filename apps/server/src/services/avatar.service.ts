/**
 * Avatar Service (PRD 17.1) — pure (no Prisma/Fastify), so it is unit-tested
 * directly.
 *
 * A client chooses its avatar by sending `{ provider, hash }`, never a URL:
 * the server builds the URL itself from one of two fixed templates. Accepting
 * a URL would let a modified client make every other client load an image
 * from a host of its choosing (an IP-logging tracking pixel), the same reason
 * the upload ledger never trusts a client-supplied file URL (PRD 16.8).
 */

import type { AvatarProvider, IAvatarSelection } from "@reson8/shared-types";

/** Lower-case SHA-256 hex, exactly — what both providers key avatars by. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

const AVATAR_URL_TEMPLATES: Record<AvatarProvider, (hash: string) => string> = {
    // Libravatar's secure CDN; d=wavatar falls back to a generated avatar
    // when the email has no picture there (verified live, 07/10/2026).
    libravatar: (hash) => `https://seccdn.libravatar.org/avatar/${hash}?d=wavatar`,
    gravatar: (hash) => `https://gravatar.com/avatar/${hash}?d=wavatar`,
};

export type AvatarSelectionParse =
    | { ok: true; value: IAvatarSelection | null }
    | { ok: false; error: string };

/**
 * Validates an avatar selection from a client. `null` is a valid "clear my
 * avatar". Extra keys are ignored; anything that isn't exactly a known
 * provider plus a lower-case SHA-256 hex hash is refused.
 */
export function parseAvatarSelection(input: unknown): AvatarSelectionParse {
    if (input === null) return { ok: true, value: null };
    if (typeof input !== "object" || input === undefined || Array.isArray(input)) {
        return { ok: false, error: "Invalid avatar selection" };
    }
    const { provider, hash } = input as { provider?: unknown; hash?: unknown };
    if (typeof provider !== "string" || !Object.prototype.hasOwnProperty.call(AVATAR_URL_TEMPLATES, provider)) {
        return { ok: false, error: "Unknown avatar provider" };
    }
    if (typeof hash !== "string" || !SHA256_HEX.test(hash)) {
        return { ok: false, error: "Invalid avatar hash" };
    }
    return { ok: true, value: { provider: provider as AvatarProvider, hash } };
}

/** The stored avatar URL for a validated selection (`null` = default avatar). */
export function buildAvatarUrl(selection: IAvatarSelection | null): string | null {
    return selection ? AVATAR_URL_TEMPLATES[selection.provider](selection.hash) : null;
}

/** Minimum time between two SET_AVATAR changes from the same user. */
export const AVATAR_UPDATE_COOLDOWN_MS = 2000;
