/**
 * Message Length Configuration — Reson8
 *
 * Bounds for the admin-configurable `Server.maxMessageLength` field
 * (Phase 12 sub-phase item 4) and its default. Shared between
 * nudge.handler.ts (GET/UPDATE_SERVER_SETTINGS, which owns the setting)
 * and message.handler.ts / dm.handler.ts (which enforce it on
 * SEND_MESSAGE, EDIT_MESSAGE, and SEND_DIRECT_MESSAGE), so the bounds
 * can't drift between where the value is validated and where it's used.
 */

/** Used when a server row predates this column, or as the schema default for new ones. */
export const DEFAULT_MAX_MESSAGE_LENGTH = 4000;

/** Floor for UPDATE_SERVER_SETTINGS — zero/negative would make chat unusable, not just "strict". */
export const MIN_MAX_MESSAGE_LENGTH = 1;

/**
 * Ceiling for UPDATE_SERVER_SETTINGS — without this, an admin could set an
 * astronomically large value and silently defeat the whole point of the
 * setting (protecting server resources from a pathologically large
 * message).
 */
export const MAX_MAX_MESSAGE_LENGTH = 100_000;
