/**
 * Upload security configuration (PRD 16.8).
 */

/**
 * Whether `/api/upload*` still accepts requests WITHOUT a bearer token
 * (clients older than v2.5.0 don't send one). Such uploads are recorded as
 * ownerless and are claimable once, by URL. Flip to `false` in a later
 * release, once pre-v2.5.0 clients are gone, to require a token everywhere.
 */
export const ALLOW_TOKENLESS_UPLOADS = true;

/** How long an upload token (issued over the socket) stays valid. */
export const UPLOAD_TOKEN_TTL_SEC = 10 * 60;

/** Redis key prefix for upload tokens — the key holds the SHA-256 of the token, never the token. */
export const UPLOAD_TOKEN_REDIS_PREFIX = "upload-token:";
