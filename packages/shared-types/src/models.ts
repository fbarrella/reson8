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

export interface IMessage {
    id: string;
    channelId: string;
    userId: string;
    nickname: string;
    content: string;
    attachmentUrl?: string | null;
    createdAt: string;
    editedAt?: string | null;
    reactions?: Array<{ emoji: string; count: number; userIds: string[] }>;
}

// ---------------------------------------------------------------------------
// Direct Message
// ---------------------------------------------------------------------------

export interface IDirectMessage {
    id: string;
    senderId: string;
    senderNickname: string;
    receiverId: string;
    content: string;
    attachmentUrl?: string | null;
    createdAt: string;
    readAt?: string | null;
    reactions?: Array<{ emoji: string; count: number; userIds: string[] }>;
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
