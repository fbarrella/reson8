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
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface IServer {
    id: string;
    name: string;
    address: string;
    maxClients: number;
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
    createdAt: string;
}
