/**
 * Socket.io typed event maps for Reson8.
 *
 * These interfaces are used to type the Socket.io server and client
 * instances, providing compile-time safety for all real-time events.
 *
 * @see https://socket.io/docs/v4/typescript/
 */

import type {
    IBannedUser,
    IChannel,
    IChannelTreeNode,
    IMessage,
    IDirectMessage,
    IOnlineUser,
    IRole,
    IUser,
    IUserPresence,
    ITransportOptions,
    IConsumerInfo,
} from "./models.js";

// ---------------------------------------------------------------------------
// Client → Server Events
// ---------------------------------------------------------------------------

export interface ClientToServerEvents {
    /**
     * Client requests to join a server instance.
     */
    USER_JOIN_SERVER: (
        payload: { serverId?: string; nickname: string; instanceId: string; password?: string },
        ack: (response: { success: boolean; serverId?: string; error?: string }) => void,
    ) => void;

    /** Client signals they are leaving the server. */
    USER_LEAVE_SERVER: (payload: { serverId: string }) => void;

    /** Client moves into a specific voice/text channel. */
    USER_JOIN_CHANNEL: (
        payload: { channelId: string },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /** Client leaves their current channel. */
    USER_LEAVE_CHANNEL: (payload: { channelId: string }) => void;

    /** Client requests a channel to be repositioned in the tree. */
    CHANNEL_MOVED: (payload: {
        channelId: string;
        newParentId: string | null;
        newPosition: number;
    }) => void;

    /** Client requests creation of a new channel. */
    CREATE_CHANNEL: (
        payload: {
            serverId: string;
            name: string;
            type: "TEXT" | "VOICE";
            parentId?: string | null;
            isNsfw?: boolean;
        },
        ack: (response: { success: boolean; channelId?: string; error?: string }) => void,
    ) => void;

    /** Client requests deletion of a channel. */
    DELETE_CHANNEL: (
        payload: { channelId: string },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /** Client requests an update to a channel's properties. */
    UPDATE_CHANNEL: (
        payload: { channelId: string; name?: string; position?: number; isNsfw?: boolean },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /** Client sends a text message to their current channel. */
    SEND_MESSAGE: (
        payload: { channelId: string; content: string; attachmentUrl?: string },
        ack: (response: { success: boolean; messageId?: string }) => void,
    ) => void;

    /** Client requests paginated message history for a channel. */
    FETCH_MESSAGES: (
        payload: { channelId: string; before?: string; limit?: number },
        ack: (response: { success: boolean; messages?: IMessage[]; error?: string }) => void,
    ) => void;

    // ── Direct Messaging ─────────────────────────────────────────────────

    /** Client sends a direct message to another user. */
    SEND_DIRECT_MESSAGE: (
        payload: { recipientId: string; content: string; attachmentUrl?: string },
        ack: (response: { success: boolean; messageId?: string; error?: string }) => void,
    ) => void;

    /** Client requests paginated DM history with another user. */
    FETCH_DIRECT_MESSAGES: (
        payload: { partnerId: string; before?: string; limit?: number },
        ack: (response: { success: boolean; messages?: IDirectMessage[]; error?: string }) => void,
    ) => void;

    /** Client requests the list of currently online users on this server. */
    GET_ONLINE_USERS: (
        ack: (response: { success: boolean; users?: IOnlineUser[]; error?: string }) => void,
    ) => void;

    /** Client marks all DMs from a specific partner as read. */
    MARK_DMS_READ: (
        payload: { partnerId: string },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /** Client requests the list of partners who have sent unread DMs. */
    GET_UNREAD_DM_PARTNERS: (
        ack: (response: { success: boolean; partners?: { partnerId: string; partnerNickname: string; unreadCount: number }[]; error?: string }) => void,
    ) => void;

    // ── Admin / Role Management ──────────────────────────────────────────────

    /** Admin requests list of all known users on the server. */
    GET_ALL_USERS: (
        payload: { serverId: string },
        ack: (response: {
            success: boolean;
            users?: Array<IUser & { roles: IRole[] }>;
            error?: string;
        }) => void,
    ) => void;

    /** Admin requests list of all roles on the server. */
    GET_ROLES: (
        payload: { serverId: string },
        ack: (response: { success: boolean; roles?: IRole[]; error?: string }) => void,
    ) => void;

    /** Admin assigns or removes a role from a user. */
    ASSIGN_ROLE: (
        payload: { userId: string; roleId: string; action: "add" | "remove" },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    // ── Moderation ───────────────────────────────────────────────────────────

    /** Admin kicks a user from a voice channel (they can rejoin). */
    KICK_USER: (
        payload: { userId: string; channelId: string },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /** Admin bans a user from the server (blacklist by instance ID). */
    BAN_USER: (
        payload: { userId: string },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /** Admin unbans a previously banned user. */
    UNBAN_USER: (
        payload: { userId: string },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /** Admin requests the list of banned users on this server. */
    GET_BANNED_USERS: (
        ack: (response: { success: boolean; users?: IBannedUser[]; error?: string }) => void,
    ) => void;

    // ── WebRTC / Voice signaling (mediasoup) ────────────────────────────────

    /** Request the Router's RTP capabilities for a voice channel. */
    GET_ROUTER_CAPABILITIES: (
        payload: { channelId: string },
        ack: (response: {
            success: boolean;
            rtpCapabilities?: any;
            error?: string;
        }) => void,
    ) => void;

    /** Request creation of a WebRTC transport (send or recv). */
    CREATE_WEBRTC_TRANSPORT: (
        payload: { channelId: string; direction: "send" | "recv" },
        ack: (response: {
            success: boolean;
            transport?: ITransportOptions;
            iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
            error?: string;
        }) => void,
    ) => void;

    /** Provide DTLS parameters to connect a transport. */
    CONNECT_TRANSPORT: (
        payload: { transportId: string; dtlsParameters: any },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /** Start producing an audio track. */
    PRODUCE: (
        payload: {
            transportId: string;
            kind: "audio";
            rtpParameters: any;
        },
        ack: (response: {
            success: boolean;
            producerId?: string;
            error?: string;
        }) => void,
    ) => void;

    /** Request to consume another user's audio producer. */
    CONSUME: (
        payload: { producerId: string; rtpCapabilities?: any },
        ack: (response: {
            success: boolean;
            consumer?: IConsumerInfo;
            error?: string;
        }) => void,
    ) => void;

    /** Resume a paused consumer (consumers start paused). */
    RESUME_CONSUMER: (
        payload: { consumerId: string },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /** Stop producing (close producer / mute). */
    CLOSE_PRODUCER: (
        payload: { producerId: string },
    ) => void;

    /** Toggle an emoji reaction on a message (channel or DM). */
    TOGGLE_REACTION: (
        payload: { messageId: string; emoji: string; isDm: boolean },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /** Lightweight ping for client-side latency measurement. */
    PING_LATENCY: (
        ack: () => void,
    ) => void;

    /** Reports the caller's own mute/deafen state so other occupants can display it. */
    SET_VOICE_STATE: (
        payload: { isMuted: boolean; isDeafened: boolean },
        ack: (response: { success: boolean }) => void,
    ) => void;
}

// ---------------------------------------------------------------------------
// Server → Client Events
// ---------------------------------------------------------------------------

export interface ServerToClientEvents {
    /** Broadcasts that a user has joined the server. */
    USER_JOINED: (payload: {
        userId: string;
        nickname: string;
        serverId: string;
    }) => void;

    /** Broadcasts that a user has left the server. */
    USER_LEFT: (payload: { userId: string; serverId: string }) => void;

    /** Sends the full channel tree structure to the client. */
    CHANNEL_TREE_UPDATE: (payload: {
        serverId: string;
        tree: IChannelTreeNode[];
    }) => void;

    /** Notifies clients about presence changes in a channel. */
    PRESENCE_UPDATE: (payload: {
        channelId: string;
        occupants: IUserPresence[];
        sessionStartedAt?: string;
    }) => void;

    /** Delivers a new text message to channel subscribers. */
    MESSAGE_RECEIVED: (payload: IMessage) => void;

    /** Delivers a direct message to the recipient in real-time. */
    DIRECT_MESSAGE_RECEIVED: (payload: IDirectMessage) => void;

    /** Broadcasts that a new channel was created. */
    CHANNEL_CREATED: (payload: {
        serverId: string;
        channel: IChannel;
    }) => void;

    /** Broadcasts that a channel was deleted. */
    CHANNEL_DELETED: (payload: {
        serverId: string;
        channelId: string;
    }) => void;

    /** Reports an error condition to the client. */
    ERROR: (payload: { code: string; message: string }) => void;

    // ── WebRTC / Voice events ──────────────────────────────────────────────

    /** Notifies the channel that a new audio producer is available. */
    NEW_PRODUCER: (payload: {
        userId: string;
        nickname: string;
        producerId: string;
    }) => void;

    /** Notifies the channel that a producer was closed. */
    PRODUCER_CLOSED: (payload: {
        userId: string;
        producerId: string;
    }) => void;

    /**
     * Sent to a client joining a voice channel with existing producers.
     * The client should consume each one.
     */
    EXISTING_PRODUCERS: (payload: {
        channelId: string;
        producers: Array<{
            userId: string;
            nickname: string;
            producerId: string;
        }>;
    }) => void;

    /** Notifies clients about active speakers in a voice channel. */
    ACTIVE_SPEAKERS: (payload: {
        channelId: string;
        /** userIds of users currently speaking (volume above threshold). */
        speakers: string[];
    }) => void;

    // ── Moderation events ─────────────────────────────────────────────────

    /** Notifies a user that they have been kicked from a voice channel. */
    USER_KICKED: (payload: { channelId: string }) => void;

    /** Broadcasts to all channel occupants that a user was kicked. */
    CHANNEL_USER_KICKED: (payload: { channelId: string; userId: string }) => void;

    /** Notifies a user that they have been banned from the server. */
    USER_BANNED: (payload: {}) => void;

    /** Broadcasts updated reactions on a message. */
    REACTION_UPDATED: (payload: {
        messageId: string;
        isDm: boolean;
        reactions: Array<{ emoji: string; count: number; userIds: string[] }>;
    }) => void;
}

// ---------------------------------------------------------------------------
// Inter-Server Events (reserved for future clustering)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface InterServerEvents { }

// ---------------------------------------------------------------------------
// Socket Data (attached to each socket instance)
// ---------------------------------------------------------------------------

export interface SocketData {
    /** Database user ID, set after authentication. */
    userId: string;
    /** Display name for this session. */
    nickname: string;
    /** The server instance the socket is connected to. */
    serverId: string;
    /** The channel the user is currently in (if any). */
    currentChannelId: string | null;
}
