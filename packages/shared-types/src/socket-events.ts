/**
 * Socket.io typed event maps for Reson8.
 *
 * These interfaces are used to type the Socket.io server and client
 * instances, providing compile-time safety for all real-time events.
 *
 * @see https://socket.io/docs/v4/typescript/
 */

import type {
    IChannel,
    IChannelTreeNode,
    IMessage,
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
        payload: { serverId?: string; nickname: string; instanceId: string },
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
        payload: { channelId: string; name?: string; position?: number },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /** Client sends a text message to their current channel. */
    SEND_MESSAGE: (
        payload: { channelId: string; content: string },
        ack: (response: { success: boolean; messageId?: string }) => void,
    ) => void;

    /** Client requests paginated message history for a channel. */
    FETCH_MESSAGES: (
        payload: { channelId: string; before?: string; limit?: number },
        ack: (response: { success: boolean; messages?: IMessage[]; error?: string }) => void,
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
    }) => void;

    /** Delivers a new text message to channel subscribers. */
    MESSAGE_RECEIVED: (payload: IMessage) => void;

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
