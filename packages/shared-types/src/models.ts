/**
 * Shared DTO interfaces and enums for the Reson8 platform.
 *
 * These mirror the Prisma schema but are runtime-safe and
 * serializable for transport over the wire.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Channel type discriminator. */
export enum ChannelType {
    TEXT = "TEXT",
    VOICE = "VOICE",
}

/**
 * Bitwise permission flags.
 *
 * Each permission is a single bit in a bigint field.
 * Combine with bitwise OR: `CONNECT | SPEAK`
 * Check with bitwise AND: `(perms & SPEAK) === SPEAK`
 */
export enum PermissionFlags {
    CONNECT = 1 << 0,  // 1
    SPEAK = 1 << 1,  // 2
    SEND_MESSAGES = 1 << 2,  // 4
    CREATE_CHANNEL = 1 << 3,  // 8
    MANAGE_CHANNELS = 1 << 4,// 16
    MANAGE_ROLES = 1 << 5,  // 32
    KICK_USER = 1 << 6,  // 64
    BAN_USER = 1 << 7,  // 128
    ADMIN = 1 << 8,  // 256 — bypasses all checks
    MANAGE_EMOJIS = 1 << 9,  // 512 — approve/reject custom emoji uploads
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface IServer {
    id: string;
    name: string;
    address: string;
    maxClients: number;
    nudgeEnabled: boolean;
    screenShareEnabled: boolean;
    createdAt: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

/** Flat channel record as stored in the database. */
export interface IChannel {
    id: string;
    serverId: string;
    name: string;
    type: ChannelType;
    parentId: string | null;
    position: number;
    maxUsers: number | null; // null = unlimited
    isNsfw: boolean; // text channels only
    createdAt: string;
    /** The channel's single pinned message (text channels only), or null/undefined if none. */
    pinnedMessage?: IPinnedMessage | null;
    /** Custom tree icon (PRD 14.7, text channels only) — mutually exclusive
     *  with `iconUrl`; falls back to the default 💬 icon when both are null. */
    iconEmoji?: string | null;
    /** Custom uploaded tree icon URL (PRD 14.7, text channels only) —
     *  mutually exclusive with `iconEmoji`. */
    iconUrl?: string | null;
}

/** A cropped preview of a text channel's pinned message. */
export interface IPinnedMessage {
    id: string;
    content: string;
    authorNickname: string;
    createdAt: string;
}

/**
 * Recursive tree node used by the client to render
 * the hierarchical channel view (Left Pane "Tree").
 */
export interface IChannelTreeNode extends IChannel {
    children: IChannelTreeNode[];
    /** Users currently in this channel (populated from Redis presence). */
    occupants: IUserPresence[];
    /**
     * Whether the requesting user has unread messages in this (text) channel.
     * Only meaningfully computed on the per-socket tree sent at join time —
     * omitted (or stale) on tree broadcasts triggered by unrelated channel
     * admin actions, since a single broadcast tree is shared by every
     * recipient and can't carry a different value per user.
     */
    hasUnread?: boolean;
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export interface IUser {
    id: string;
    username: string;
    nickname: string;
    createdAt: string;
    /** Server-built avatar URL (PRD 17.1); null/absent = the client's default avatar. */
    avatarUrl?: string | null;
}

// ---------------------------------------------------------------------------
// Avatar (PRD 17.1)
// ---------------------------------------------------------------------------

export type AvatarProvider = "libravatar" | "gravatar";

/**
 * What a client sends to choose its avatar — never a URL. The server builds
 * the URL itself from a fixed template, so a client can't make everyone load
 * an image from a host of its choosing. `hash` is the lower-case SHA-256 hex
 * of the trimmed, lower-cased email; the email itself never leaves the client.
 */
export interface IAvatarSelection {
    provider: AvatarProvider;
    hash: string;
}

/** What the user profile card shows (PRD 17.3). */
export interface IUserProfile {
    userId: string;
    nickname: string;
    avatarUrl: string | null;
    /** ISO time of the user's first login: User.createdAt, written once when the row is created. */
    memberSince: string;
    /** This server's roles, highest powerLevel first. */
    roles: { id: string; name: string; color: string | null; powerLevel: number }[];
    isOnline: boolean;
}

/**
 * Member-visible facts about the server (PRD 19 A1) — what About and the
 * server header show. Counts are per userId (= per install), not per person.
 */
export interface IServerSummary {
    name: string;
    /** user_servers members whose permissions include CONNECT or ADMIN, minus banned users. */
    memberCount: number;
    /** Distinct userIds present on the server right now, limited to the members counted above. */
    onlineCount: number;
    /** Members whose aggregated permissions include ADMIN, sorted by nickname (case-insensitive). */
    admins: { userId: string; nickname: string; isOnline: boolean; avatarUrl: string | null }[];
    features: {
        nudge: boolean;
        screenShare: boolean;
        requireApproval: boolean;
        requireInvite: boolean;
        requireSignedIdentity: boolean;
    };
    /** Filled in by PRD 19 A2; server-relative for local disk — resolve with resolveMediaUrl(). */
    iconUrl?: string | null;
}

/**
 * One row of the identity log (PRD 18.4) — a key being bound, an admin
 * resetting it, or a join refused for identity reasons. ADMIN-only.
 */
export interface IIdentityEvent {
    id: string;
    userId: string;
    /** Nickname at the time of the event. */
    nickname: string;
    /** The user's nickname now, only when it differs from `nickname`. */
    currentNickname?: string;
    kind: "BOUND" | "RESET" | "REFUSED";
    /** For REFUSED: the identity-refusal key (e.g. "otherDevice"), never message text. */
    reason: string | null;
    /** `SHA256:…` fingerprint of the key involved, when there was one. */
    fingerprint: string | null;
    /** Client address (resolved with TRUST_PROXY rules). */
    address: string | null;
    /** The host the proof was signed for. */
    host: string | null;
    /** For RESET: the admin who did it. */
    actorId: string | null;
    actorNickname?: string | null;
    /** ISO time. */
    createdAt: string;
    /** The user currently holds ADMIN or MANAGE_ROLES — their binds deserve a second look. */
    privileged?: boolean;
}

/** Why a join was refused in a way the client reacts to (PRD 18.9). */
export type JoinErrorCode = "INVITE_REQUIRED" | "INVITE_INVALID" | "INVITE_THROTTLED";

/** An invite code as a moderator sees it (PRD 18.9). The code itself is never included after creation. */
export interface IInvite {
    id: string;
    /** First four characters of the code, to tell invites apart. */
    codePrefix: string;
    label: string | null;
    createdBy: string;
    createdByNickname: string | null;
    createdAt: string;
    expiresAt: string | null;
    maxUses: number | null;
    uses: number;
    status: "active" | "expired" | "used-up" | "revoked";
    /** Who came in with it, newest first. */
    usedBy: { userId: string; nickname: string | null; usedAt: string }[];
}

/** A new identity waiting for a moderator's approval (PRD 18.8). `address` is masked for non-ADMIN moderators. */
export interface IPendingApproval {
    userId: string;
    nickname: string;
    /** `SHA256:…` of the key the request was signed with — what the person can read out to a moderator. */
    fingerprint: string;
    address: string | null;
    host: string | null;
    requestedAt: string;
    lastSeenAt: string;
    /** Whether they are connected and waiting right now. */
    online: boolean;
}

/**
 * A banned address or range (PRD 18.7). `cidr` is the canonical network
 * (`203.0.113.0/24`) for an ADMIN and a masked form (`203.0.113.x`) for any
 * other moderator.
 */
export interface IBannedAddress {
    id: string;
    cidr: string;
    nickname: string | null;
    /** The user ban this was created with; unbanning that user lifts it too. */
    linkedUserId: string | null;
    createdAt: string;
}

/** A host name seen in an accepted signed join (PRD 18.5) — a suggestion for the allowed-names list. */
export interface IObservedAuthHost {
    host: string;
    joins: number;
    /** ISO time of the last accepted join under this name. */
    lastSeen: string | null;
}

/** Lightweight presence record for channel occupants. */
export interface IUserPresence {
    userId: string;
    nickname: string;
    isMuted: boolean;
    isDeafened: boolean;
    isAway: boolean;
    /** Whether this user currently has an active screen share (PRD 12.12). */
    isSharingScreen: boolean;
}

// ---------------------------------------------------------------------------
// Role
// ---------------------------------------------------------------------------

export interface IRole {
    id: string;
    serverId: string;
    name: string;
    /** Bitwise permission value — stored as string to survive JSON serialization of bigint. */
    permissions: string;
    /** Numeric hierarchy level. Higher = more powerful. */
    powerLevel: number;
    color: string | null;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

/**
 * One emoji's reactions on a message. `userIds` and `count` are the original
 * fields; `users` (PRD 15.11) adds each reactor's current nickname, in the
 * same order as `userIds`, so a client can name who reacted — including
 * people who are offline. Optional so a client talking to a not-yet-updated
 * server (the app already warns on version mismatch) keeps working.
 */
export interface IReactionSummary {
    emoji: string;
    count: number;
    userIds: string[];
    users?: Array<{ userId: string; nickname: string }>;
}

/** One image on a message (PRD 16.10). The URL is server-relative for local-disk files ("/uploads/x.png") — resolve it against the server address. */
export interface IAttachment {
    url: string;
}

/** Most images one message can carry (PRD 16.10) — enforced by the server, mirrored by the client composer. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/**
 * Snapshot of the message a reply points at (PRD 16.11). `deleted: true`
 * means the original no longer exists (it was deleted after the reply was
 * sent); the other fields are then absent. `content` is already truncated
 * server-side and is raw message text — render it with the plain-text
 * Markdown path, never as HTML.
 */
export interface IReplyPreview {
    id: string;
    deleted: boolean;
    userId?: string;
    nickname?: string;
    content?: string;
    /** The original has at least one image (it may have no text). */
    hasAttachments?: boolean;
}

export interface IMessage {
    id: string;
    channelId: string;
    userId: string;
    nickname: string;
    /** The author's CURRENT avatar URL (PRD 17.2); null = default avatar, absent = pre-v2.6.0 server. */
    avatarUrl?: string | null;
    content: string;
    /** Set when this message is a reply (PRD 16.11). Only the message directly answered — snippets never nest. */
    replyTo?: IReplyPreview | null;
    /** The message's images, in order (PRD 16.10). */
    attachments?: IAttachment[];
    /** @deprecated Always `attachments[0]?.url ?? null`; kept so pre-v2.5.0 clients still show a message's first image. */
    attachmentUrl?: string | null;
    createdAt: string;
    editedAt?: string | null;
    reactions?: IReactionSummary[];
}

// ---------------------------------------------------------------------------
// Direct Message
// ---------------------------------------------------------------------------

export interface IDirectMessage {
    id: string;
    senderId: string;
    senderNickname: string;
    /** The sender's CURRENT avatar URL (PRD 17.2); null = default avatar, absent = pre-v2.6.0 server. */
    senderAvatarUrl?: string | null;
    receiverId: string;
    content: string;
    /** Set when this DM is a reply (PRD 16.11). Only the message directly answered. */
    replyTo?: IReplyPreview | null;
    /** The message's images, in order (PRD 16.10). */
    attachments?: IAttachment[];
    /** @deprecated Always `attachments[0]?.url ?? null`; kept so pre-v2.5.0 clients still show a message's first image. */
    attachmentUrl?: string | null;
    createdAt: string;
    readAt?: string | null;
    reactions?: IReactionSummary[];
}

/** Lightweight user record for the DM user list (includes offline DM partners). */
export interface IOnlineUser {
    userId: string;
    nickname: string;
    isOnline: boolean;
}

/** Banned user record for the moderation panel. */
export interface IBannedUser {
    userId: string;
    nickname: string;
    bannedAt: string;
}

// ---------------------------------------------------------------------------
// CustomEmoji
// ---------------------------------------------------------------------------

/** Server-uploaded custom emoji, referenced in chat as :name:. */
export interface ICustomEmoji {
    id: string;
    serverId: string;
    name: string;
    imageUrl: string;
    uploadedBy: string;
    /** Resolved only where useful to display (e.g. the pending-review queue). */
    uploadedByNickname?: string;
    status: "PENDING" | "APPROVED";
    createdAt: string;
    /** True for an animated-GIF emoji (PRD 13.13) — uploaded via the
     *  crop-free path, rendered identically to a static emoji since GIFs
     *  animate natively in an `<img>`. */
    isAnimated: boolean;
}

// ---------------------------------------------------------------------------
// WebRTC / mediasoup DTOs
// ---------------------------------------------------------------------------

/** Parameters sent to the client after creating a WebRtcTransport. */
export interface ITransportOptions {
    id: string;
    iceParameters: any;
    iceCandidates: any[];
    dtlsParameters: any;
}

/** Consumer info sent to the client to consume a remote producer. */
export interface IConsumerInfo {
    id: string;
    producerId: string;
    kind: "audio" | "video";
    rtpParameters: any;
}
