/**
 * Socket.io typed event maps for Reson8.
 *
 * These interfaces are used to type the Socket.io server and client
 * instances, providing compile-time safety for all real-time events.
 *
 * @see https://socket.io/docs/v4/typescript/
 */

import type { IChannelTreeNode, IMessage, IUserPresence } from "./models.js";

// ---------------------------------------------------------------------------
// Client → Server Events
// ---------------------------------------------------------------------------

export interface ClientToServerEvents {
    /**
     * Client requests to join a server instance.
     * Payload: the server ID and the user's chosen nickname.
     */
    USER_JOIN_SERVER: (
        payload: { serverId: string; nickname: string },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /**
     * Client signals they are leaving the server.
     */
    USER_LEAVE_SERVER: (payload: { serverId: string }) => void;

    /**
     * Client moves into a specific voice/text channel.
     */
    USER_JOIN_CHANNEL: (
        payload: { channelId: string },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /**
     * Client leaves their current channel.
     */
    USER_LEAVE_CHANNEL: (payload: { channelId: string }) => void;

    /**
     * Client requests a channel to be repositioned in the tree.
     * `newParentId` of null means move to root level.
     */
    CHANNEL_MOVED: (payload: {
        channelId: string;
        newParentId: string | null;
        newPosition: number;
    }) => void;

    /**
     * Client sends a text message to their current channel.
     */
    SEND_MESSAGE: (
        payload: { channelId: string; content: string },
        ack: (response: { success: boolean; messageId?: string }) => void,
    ) => void;
}

// ---------------------------------------------------------------------------
// Server → Client Events
// ---------------------------------------------------------------------------

export interface ServerToClientEvents {
    /**
     * Broadcasts that a user has joined the server.
     */
    USER_JOINED: (payload: {
        userId: string;
        nickname: string;
        serverId: string;
    }) => void;

    /**
     * Broadcasts that a user has left the server.
     */
    USER_LEFT: (payload: { userId: string; serverId: string }) => void;

    /**
     * Sends the full channel tree structure to the client.
     * Emitted on initial join and whenever the tree changes.
     */
    CHANNEL_TREE_UPDATE: (payload: {
        serverId: string;
        tree: IChannelTreeNode[];
    }) => void;

    /**
     * Notifies clients about presence changes in a channel
     * (user joined/left a channel).
     */
    PRESENCE_UPDATE: (payload: {
        channelId: string;
        occupants: IUserPresence[];
    }) => void;

    /**
     * Delivers a new text message to channel subscribers.
     */
    MESSAGE_RECEIVED: (payload: IMessage) => void;

    /**
     * Reports an error condition to the client.
     */
    ERROR: (payload: { code: string; message: string }) => void;
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
