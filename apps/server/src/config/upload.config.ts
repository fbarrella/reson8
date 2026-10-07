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

/** An upload nobody attached to anything is swept away after this long (PRD 16.9). */
export const UNCLAIMED_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

/** How often the sweeper looks for expired unclaimed uploads. */
export const UPLOAD_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Delay before the first sweep after boot, so startup isn't competing with it. */
export const UPLOAD_SWEEP_FIRST_RUN_DELAY_MS = 60 * 1000;

/** Rows handled per sweeper batch. */
export const UPLOAD_SWEEP_BATCH_SIZE = 500;

/** How many files are released at once when a channel (and all its images) is deleted. */
export const FILE_RELEASE_CONCURRENCY = 20;
