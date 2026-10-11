/**
 * Who may use the server's channels, DMs and voice (PRD 18.18) — pure, so the
 * rules are unit-tested.
 *
 * A user without the Member role (and not a Server Admin) is NOT banned: they
 * stay connected and can see the tree and who is online. They just can't open
 * channels, send or read DMs, or join voice until a moderator gives the role
 * back. "Has access" is exactly "the aggregated permissions include CONNECT, or
 * ADMIN" — CONNECT has always been the flag meaning "may use this server".
 */

import { PermissionFlags } from "@reson8/shared-types";
import type { ClientToServerEvents } from "@reson8/shared-types";

export const NO_ACCESS_MESSAGE = "You don't have access to this server's channels";
export const RECIPIENT_NO_ACCESS_MESSAGE = "This user can't receive messages right now";

export function hasServerAccess(perms: bigint): boolean {
    return (
        (perms & BigInt(PermissionFlags.ADMIN)) !== 0n || (perms & BigInt(PermissionFlags.CONNECT)) !== 0n
    );
}

/**
 * The roles a join grants (PRD 18.18). Member is given ONLY when the user row is
 * created: re-granting it on every join made removing it last until the next
 * connect. Existing users already hold it (the old per-join upsert guaranteed
 * that), so nobody loses access when this ships. The designated admin keeps
 * their per-join grant.
 */
export function rolesToGrant(opts: { isNewUser: boolean; grantAdmin: boolean }): string[] {
    const roles: string[] = [];
    if (opts.isNewUser) roles.push("role-default");
    if (opts.grantAdmin) roles.push("role-admin");
    return roles;
}

/**
 * Every client→server event, classified. `Record<keyof ClientToServerEvents, …>`
 * makes the compiler refuse a new event that isn't classified here — that is
 * the real guarantee that a new handler can't silently skip the access rule.
 *
 *   "open"   — allowed without access (sign-in, the tree/presence/profile
 *              reads, the user's own settings, and moderator/admin events that
 *              carry their own permission checks);
 *   "member" — refused without access: text channels, DMs, voice, uploads,
 *              custom emoji submission, nudges, screen sharing.
 */
export const EVENT_ACCESS: Record<keyof ClientToServerEvents, "open" | "member"> = {
    // Sign-in, session and identity
    USER_JOIN_SERVER: "open",
    REQUEST_AUTH_CHALLENGE: "open",
    USER_LEAVE_SERVER: "open",
    PING_LATENCY: "open",
    VIEWER_AUTHENTICATE: "open", // its ticket can only be issued to a member
    RESET_IDENTITY_KEY: "open", // ADMIN
    GET_IDENTITY_EVENTS: "open", // ADMIN

    // Reading the structure and who is around
    GET_ONLINE_USERS: "open",
    GET_USER_PROFILE: "open",
    GET_SERVER_SETTINGS: "open",
    GET_APPROVED_EMOJIS: "open",
    SET_AVATAR: "open",
    USER_LEAVE_CHANNEL: "open",
    SET_VOICE_STATE: "open",
    STOP_WATCHING_SCREEN_SHARE: "open",
    CLOSE_PRODUCER: "open",
    DISCARD_UPLOAD: "open", // cleanup of the user's own unclaimed upload

    // Channel management (MANAGE_CHANNELS / ADMIN checked by the handler)
    CHANNEL_MOVED: "open",
    CREATE_CHANNEL: "open",
    DELETE_CHANNEL: "open",
    UPDATE_CHANNEL: "open",
    REORDER_CHANNELS: "open",

    // Moderation and administration (their own permission checks stay)
    GET_ALL_USERS: "open",
    GET_ROLES: "open",
    ASSIGN_ROLE: "open",
    KICK_USER: "open",
    BAN_USER: "open",
    UNBAN_USER: "open",
    GET_BANNED_USERS: "open",
    GET_BANNED_ADDRESSES: "open",
    UNBAN_ADDRESS: "open",
    CREATE_INVITE: "open",
    GET_INVITES: "open",
    REVOKE_INVITE: "open",
    GET_PENDING_APPROVALS: "open",
    APPROVE_USER: "open",
    REJECT_USER: "open",
    GET_PENDING_EMOJIS: "open",
    REVIEW_CUSTOM_EMOJI: "open",
    UPDATE_SERVER_SETTINGS: "open",

    // Text channels
    USER_JOIN_CHANNEL: "member",
    SEND_MESSAGE: "member",
    FETCH_MESSAGES: "member",
    MARK_CHANNEL_READ: "member",
    DELETE_MESSAGE: "member",
    EDIT_MESSAGE: "member",
    TOGGLE_REACTION: "member",
    PIN_MESSAGE: "member",
    UNPIN_MESSAGE: "member",

    // Direct messages
    SEND_DIRECT_MESSAGE: "member",
    FETCH_DIRECT_MESSAGES: "member",
    DELETE_DIRECT_MESSAGE: "member",
    MARK_DMS_READ: "member",
    GET_UNREAD_DM_PARTNERS: "member",

    // Voice and screen sharing
    GET_ROUTER_CAPABILITIES: "member",
    CREATE_WEBRTC_TRANSPORT: "member",
    CONNECT_TRANSPORT: "member",
    RESTART_ICE: "member",
    PRODUCE: "member",
    CONSUME: "member",
    RESUME_CONSUMER: "member",
    SET_SCREEN_SHARE_STATE: "member",
    WATCH_SCREEN_SHARE: "member",
    REQUEST_VIEWER_TICKET: "member",

    // Everything else a restricted user must not do
    REQUEST_UPLOAD_TOKEN: "member",
    CREATE_CUSTOM_EMOJI: "member",
    NUDGE_USER: "member",
};

/** Whether `event` is refused to a user without access. Unknown events are treated as "member" (safe default). */
export function requiresAccess(event: string): boolean {
    const known = (EVENT_ACCESS as Record<string, "open" | "member">)[event];
    return known === undefined ? true : known === "member";
}
