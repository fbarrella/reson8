/**
 * Identity configuration (PRD 17.12). Read from the environment at call time
 * (not at import), so tests and a restarted process always see current values.
 */

/**
 * `REQUIRE_SIGNED_IDENTITY=true` refuses every unsigned (pre-2.6.0) join.
 * Default off for a gradual rollout: an identity that has bound a key is
 * protected at once either way; this closes the door for the rest once
 * everyone has updated.
 */
export function requireSignedIdentity(): boolean {
    return process.env.REQUIRE_SIGNED_IDENTITY?.trim().toLowerCase() === "true";
}

/**
 * `ADMIN_KEY_FINGERPRINT` (as shown in the admin's Settings → About, e.g.
 * "SHA256:3q2+…"): when set, the ADMIN_INSTANCE_ID identity can only be bound
 * by — and only gets the admin role with — the key with that fingerprint.
 */
export function adminKeyFingerprint(): string | null {
    const value = process.env.ADMIN_KEY_FINGERPRINT?.trim();
    return value ? value : null;
}

/**
 * `AUTH_ALLOWED_HOSTS` (comma-separated `host[:port]`, as clients type them):
 * when set, a signature is only accepted if it was made for one of these
 * hosts. That stops a malicious server from relaying this server's challenge
 * to its own users. Leave unset if the server is reached under names you can't
 * list (every name it's reached by must be listed).
 */
export function authAllowedHosts(): string[] {
    return (process.env.AUTH_ALLOWED_HOSTS ?? "")
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean);
}

/** How long a viewer ticket lives (refreshed on every use). */
export const VIEWER_TICKET_TTL_SEC = 10 * 60;
