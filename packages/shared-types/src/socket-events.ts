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
    IPinnedMessage,
    IRole,
    IUser,
    IUserPresence,
    ITransportOptions,
    IConsumerInfo,
    ICustomEmoji,
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

    /** Admin reorders all channels sharing a parent in one atomic batch. */
    REORDER_CHANNELS: (
        payload: { parentId: string | null; orderedChannelIds: string[] },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /** Client sends a text message to their current channel. */
    SEND_MESSAGE: (
        payload: { channelId: string; content: string; attachmentUrl?: string; attachmentPublicId?: string },
        ack: (response: { success: boolean; messageId?: string; error?: string }) => void,
    ) => void;

    /**
     * Client requests paginated message history for a channel. Passing
     * `aroundMessageId` instead of `before` fetches a window of messages
     * centered on that message (used to jump to a pinned message that isn't
     * within the currently-loaded page) — `before` is ignored when it's set.
     * The channel's current pinned message (if any) is included in the ack
     * only on the initial load (`before`/`aroundMessageId` both unset), to
     * avoid re-querying it on every "load more" scroll.
     */
    FETCH_MESSAGES: (
        payload: { channelId: string; before?: string; limit?: number; aroundMessageId?: string },
        ack: (response: { success: boolean; messages?: IMessage[]; pinnedMessage?: IPinnedMessage | null; error?: string }) => void,
    ) => void;

    /** Client marks a text channel as read up to now (clears the unread indicator). */
    MARK_CHANNEL_READ: (
        payload: { channelId: string },
        ack: (response: { success: boolean }) => void,
    ) => void;

    /** Client deletes their own channel message (hard delete — including its attachment, if any). */
    DELETE_MESSAGE: (
        payload: { messageId: string },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /** Client edits their own text-only channel message, within a 2-minute window of sending. */
    EDIT_MESSAGE: (
        payload: { messageId: string; content: string },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    // ── Direct Messaging ─────────────────────────────────────────────────

    /** Client sends a direct message to another user. */
    SEND_DIRECT_MESSAGE: (
        payload: { recipientId: string; content: string; attachmentUrl?: string; attachmentPublicId?: string },
        ack: (response: { success: boolean; messageId?: string; error?: string }) => void,
    ) => void;

    /** Client requests paginated DM history with another user. */
    FETCH_DIRECT_MESSAGES: (
        payload: { partnerId: string; before?: string; limit?: number },
        ack: (response: { success: boolean; messages?: IDirectMessage[]; error?: string }) => void,
    ) => void;

    /** Client deletes their own direct message (hard delete — including its attachment, if any). */
    DELETE_DIRECT_MESSAGE: (
        payload: { dmId: string },
        ack: (response: { success: boolean; error?: string }) => void,
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

    /**
     * Ask the server to restart ICE on an existing transport whose
     * connection state has degraded (e.g. a brief WiFi drop or NAT rebind)
     * without tearing down its producers/consumers. The client applies the
     * returned `iceParameters` via mediasoup-client's `transport.restartIce()`.
     */
    RESTART_ICE: (
        payload: { transportId: string },
        ack: (response: { success: boolean; iceParameters?: any; error?: string }) => void,
    ) => void;

    /**
     * Start producing a track — mic audio, or (PRD 12.7/12.8) a second,
     * independent screen-share audio or video Producer on the same send
     * Transport. `appData.mediaType` distinguishes which: absent for the
     * mic, `"screen-audio"` / `"screen-video"` for a share. The server
     * threads this through to mediasoup's own Producer `appData` and uses
     * it to decide which per-session Producer slot to store the result in
     * (see `UserVoiceSession` in `mediasoup.service.ts`) and whether to
     * feed it into `AudioLevelObserver` (mic only — screen-share audio
     * shouldn't trigger the active-speaker indicator).
     */
    PRODUCE: (
        payload: {
            transportId: string;
            kind: "audio" | "video";
            rtpParameters: any;
            appData?: { mediaType?: "screen-audio" | "screen-video" };
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

    // ── Custom Emoji ─────────────────────────────────────────────────────

    /** Submits an uploaded emoji image for admin review — already-cropped
     *  for a static emoji, or a raw GIF buffer when `isAnimated` (PRD 13.13). */
    CREATE_CUSTOM_EMOJI: (
        payload: { name: string; imageUrl: string; imagePublicId?: string; isAnimated?: boolean },
        ack: (response: { success: boolean; emojiId?: string; error?: string }) => void,
    ) => void;

    /** Fetches all APPROVED custom emoji for the current server (usable by everyone). */
    GET_APPROVED_EMOJIS: (
        ack: (response: { success: boolean; emojis?: ICustomEmoji[]; error?: string }) => void,
    ) => void;

    /** Fetches all PENDING custom emoji awaiting review. Requires MANAGE_EMOJIS. */
    GET_PENDING_EMOJIS: (
        ack: (response: { success: boolean; emojis?: ICustomEmoji[]; error?: string }) => void,
    ) => void;

    /** Approves or rejects a pending custom emoji. Requires MANAGE_EMOJIS. */
    REVIEW_CUSTOM_EMOJI: (
        payload: { emojiId: string; decision: "APPROVED" | "REJECTED" },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /**
     * Lightweight ping for client-side latency measurement. The ack carries
     * the server's own current timestamp (ms since epoch) so the client can
     * also derive a client↔server clock offset (NTP-style: offset ≈
     * serverTime - (localSendTime + rtt / 2)) — used to correct the voice
     * session timer against clock skew between the two machines (PRD 11.2).
     */
    PING_LATENCY: (
        ack: (serverTime: number) => void,
    ) => void;

    /** Reports the caller's own mute/deafen state so other occupants can display it. */
    SET_VOICE_STATE: (
        payload: { isMuted: boolean; isDeafened: boolean },
        ack: (response: { success: boolean }) => void,
    ) => void;

    /**
     * Reports the caller's own screen-share state (PRD 12.12) so other
     * occupants can display the sharing badge — handled identically to
     * `SET_VOICE_STATE`. The server re-checks the server-wide screen-share
     * toggle before honoring `true` (PRD 12.14; until that toggle exists,
     * this is always honored — see the handler for the current caveat).
     *
     * `streamName`, when `isSharingScreen` is true, is the *already fully
     * resolved* display name the sharer's own client computed (custom
     * name if the user set one, else the real source name where
     * available, else the generic "your screen" fallback) — not a raw
     * user-entered string the server needs to fall back on itself.
     * Surfaced back to viewers via `WATCH_SCREEN_SHARE`'s ack so the
     * Viewer window's title bar shows the same name the sharer's own
     * "Started sharing" log did.
     */
    SET_SCREEN_SHARE_STATE: (
        payload: { isSharingScreen: boolean; streamName?: string },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    // ── Screen Share Viewing (PRD 12.13) ──────────────────────────────────
    // Emitted only by a Viewer window's own second ("viewer"-role) socket —
    // see `SocketData.role`'s doc comment for the full dual-socket design.

    /**
     * Resolves this viewer socket's `userId` from the same persisted
     * instance ID the primary connection uses, WITHOUT touching presence,
     * rooms, or anything `USER_JOIN_SERVER` would (that's the whole point —
     * this socket must stay invisible to everyone else).
     */
    VIEWER_AUTHENTICATE: (
        payload: { instanceId: string },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /**
     * Requests to watch `targetUserId`'s screen share in `channelId`. The
     * server validates the caller is currently an occupant of that channel
     * and that the target currently has an active screen-video Producer
     * there — rejects otherwise (handles the race where a share ends
     * between the badge rendering and this call). On success, bundles the
     * Router's `rtpCapabilities` directly in the ack (skipping a separate
     * `GET_ROUTER_CAPABILITIES` round trip, since the handler already has
     * to look up the Router to check the target's Producers) and also
     * scopes this socket to `channelId` so the existing
     * `CREATE_WEBRTC_TRANSPORT`/`CONNECT_TRANSPORT`/`CONSUME`/
     * `RESUME_CONSUMER` handlers work unmodified from here.
     */
    WATCH_SCREEN_SHARE: (
        payload: { targetUserId: string; channelId: string },
        ack: (response: {
            success: boolean;
            rtpCapabilities?: any;
            screenVideoProducerId?: string;
            screenAudioProducerId?: string;
            /** The sharer's own resolved stream name — see `SET_SCREEN_SHARE_STATE`'s doc comment. */
            streamName?: string;
            error?: string;
        }) => void,
    ) => void;

    /** Leave-Stream / window-close cleanup — closes this viewer socket's own recv Transport/Consumers only. */
    STOP_WATCHING_SCREEN_SHARE: (
        payload: { channelId: string },
        ack: (response: { success: boolean }) => void,
    ) => void;

    // ── Pinned Messages ──────────────────────────────────────────────────

    /**
     * Pins a message in a text channel, replacing any existing pin.
     * Requires MANAGE_CHANNELS.
     */
    PIN_MESSAGE: (
        payload: { channelId: string; messageId: string },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /** Clears a text channel's pinned message, if any. Requires MANAGE_CHANNELS. */
    UNPIN_MESSAGE: (
        payload: { channelId: string },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    // ── Nudge ────────────────────────────────────────────────────────────

    /** Nudges another online user to get their attention (30s cooldown per sender/target pair). */
    NUDGE_USER: (
        payload: { targetUserId: string },
        ack: (response: { success: boolean; error?: string }) => void,
    ) => void;

    /**
     * Fetches the current server's admin-configurable settings
     * (nudgeEnabled, screenShareEnabled) plus its display name — `name` is
     * not admin-configurable via this channel (it's set once via
     * `SERVER_NAME` at server bootstrap, see apps/server/src/index.ts),
     * bundled here since this is already the "fetch server-wide info once
     * connected" round trip the client makes.
     */
    GET_SERVER_SETTINGS: (
        ack: (response: {
            success: boolean;
            nudgeEnabled?: boolean;
            screenShareEnabled?: boolean;
            name?: string;
            /** Admin-configurable cap on a single message's content length (channel messages and DMs alike). */
            maxMessageLength?: number;
            /** The running server build's version (from apps/server/package.json), for client/server version-mismatch warnings. */
            version?: string;
            error?: string;
        }) => void,
    ) => void;

    /**
     * Updates server-wide settings. Requires ADMIN. Each field is optional so
     * a single toggle (e.g. just Nudge) can be updated without touching the
     * other — the handler only writes whichever fields are present in the
     * payload (PRD 12.14).
     */
    UPDATE_SERVER_SETTINGS: (
        payload: { nudgeEnabled?: boolean; screenShareEnabled?: boolean; maxMessageLength?: number },
        ack: (response: { success: boolean; error?: string }) => void,
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

    /** Broadcasts that a channel message was deleted by its author. */
    MESSAGE_DELETED: (payload: { channelId: string; messageId: string }) => void;

    /** Broadcasts that a channel message was edited by its author. */
    MESSAGE_EDITED: (payload: IMessage) => void;

    /** Notifies both participants that a direct message was deleted by its author. */
    DIRECT_MESSAGE_DELETED: (payload: { dmId: string }) => void;

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
    /**
     * `mediaType` absent means this is the ordinary mic Producer — clients
     * auto-consume those, as before. When present (`"screen-audio"` /
     * `"screen-video"`, PRD 12.7/12.8), clients must NOT auto-consume: a
     * screen-share's video/audio is only ever pulled by an explicit viewer
     * action (PRD 12.13's `WATCH_SCREEN_SHARE`), not by everyone in the
     * channel just because a new Producer appeared.
     */
    NEW_PRODUCER: (payload: {
        userId: string;
        nickname: string;
        producerId: string;
        mediaType?: "screen-audio" | "screen-video";
    }) => void;

    /** Notifies the channel that a producer was closed. */
    PRODUCER_CLOSED: (payload: {
        userId: string;
        producerId: string;
    }) => void;

    /** Delivered to a sharer's primary socket when a viewer opens/closes the
     *  Viewer window on their share (PRD 13.16) — sound-cue only, so the
     *  sharer has some awareness of watchers without an explicit UI. */
    VIEWER_JOINED_YOUR_STREAM: () => void;
    VIEWER_LEFT_YOUR_STREAM: () => void;

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

    /** Broadcasts a newly-approved custom emoji so every connected picker updates live. */
    CUSTOM_EMOJI_APPROVED: (payload: { serverId: string; emoji: ICustomEmoji }) => void;

    /** Delivered to the target of a NUDGE_USER call. */
    NUDGE_RECEIVED: (payload: { fromUserId: string; fromNickname: string }) => void;

    /** Broadcasts a server settings change so every connected client updates live. */
    SERVER_SETTINGS_UPDATED: (payload: { nudgeEnabled: boolean; screenShareEnabled: boolean; maxMessageLength: number }) => void;

    /**
     * Notifies a channel's occupants that their voice session was force-closed
     * by the server (e.g. the mediasoup worker hosting it crashed and had to be
     * recycled). Clients still in that channel should attempt to rejoin voice.
     */
    VOICE_SESSION_LOST: (payload: { channelId: string; reason: string }) => void;

    /**
     * Broadcasts a text channel's pin-state change to every server member,
     * so an open (or later-opened) chat tab always reflects the current
     * pin without a separate fetch. `actedByNickname` is omitted when the
     * change was an automatic unpin caused by the pinned message itself
     * being deleted, rather than an explicit admin action.
     */
    CHANNEL_PIN_UPDATED: (payload: {
        channelId: string;
        channelName: string;
        pinnedMessage: IPinnedMessage | null;
        actedByNickname?: string;
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
    /**
     * `"primary"` (default) is the normal one-socket-per-user connection —
     * everything before PRD 12.13 assumed this implicitly. `"viewer"` is a
     * second, independent socket a Viewer window (PRD 12.13) opens to
     * consume one specific screen share; it authenticates via
     * `VIEWER_AUTHENTICATE` (not `USER_JOIN_SERVER`), never joins presence
     * or the `server:{id}` room, and its disconnect only tears down its own
     * recv-only mediasoup session — never presence, never broadcasts. Set
     * once, in `index.ts`'s `io.use()` middleware, from the connection
     * query string, before any handler can run.
     */
    role: "primary" | "viewer";
    /** Set on a viewer socket while `WATCH_SCREEN_SHARE` is active — the
     *  userId of the sharer it's currently watching, so
     *  `STOP_WATCHING_SCREEN_SHARE`/disconnect cleanup can deliver
     *  `VIEWER_LEFT_YOUR_STREAM` (PRD 13.16) without needing the client to
     *  resend it. */
    watchingUserId?: string;
}
