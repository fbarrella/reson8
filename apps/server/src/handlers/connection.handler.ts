/**
 * Connection Handler — Socket.io event routing for Reson8.
 *
 * Handles: USER_JOIN_SERVER, USER_LEAVE_SERVER,
 *          USER_JOIN_CHANNEL, USER_LEAVE_CHANNEL, disconnect.
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
    IUserPresence,
    IChannelTreeNode,
} from "@reson8/shared-types";
import { PresenceService } from "../services/presence.service.js";
import { buildChannelTree } from "../services/channel-tree.service.js";
import type { MediasoupService } from "../services/mediasoup.service.js";
import { SocketOwnership } from "../services/socket-ownership.js";
import { buildAvatarUrl, parseAvatarSelection } from "../services/avatar.service.js";
import {
    authMessage,
    decideIdentity,
    IDENTITY_MESSAGES,
    isHostAllowed,
    isNonceFresh,
    keyFingerprint,
    newNonce,
    parseIdentityProof,
    verifyAuthSignature,
} from "../services/identity.service.js";
import { adminKeyFingerprint, authAllowedHosts, requireSignedIdentity } from "../config/identity.config.js";
import { recordIdentityEvent } from "../services/identity-events.service.js";
import { normalizeAuthHost, observeAuthHost } from "../services/auth-hosts.service.js";
import { normalizeIp } from "../services/address-ban.service.js";
import { requireApproval } from "../config/approval.config.js";
import { APPROVAL_MESSAGES, decideApprovalGate, pendingRoom } from "../services/approval.service.js";
import { notifyPendingChanged, syncModeratorRoom } from "./approval.handler.js";
import { requireInvite } from "../config/invite.config.js";
import { getUserPermissions } from "../services/permissions.service.js";
import { hasServerAccess, rolesToGrant } from "../services/access.service.js";
import { membersRoom } from "../services/access-change.js";
import { annotateSessionStarts, voiceSessionStartedAt } from "../services/voice-session.service.js";
import { applyUnreadCounts, countUnreadByChannel } from "../services/unread.service.js";
import {
    INVITE_FAIL_WINDOW_SECONDS,
    INVITE_MESSAGES,
    claimInviteUse,
    findUsableInviteId,
    hashInviteCode,
    isInviteThrottled,
    normalizeInviteCode,
} from "../services/invite.service.js";

/** Thrown inside the user-creation transaction to roll the whole join back. */
class InviteUnusableError extends Error {}
import { issueViewerTicket, resolveViewerTicket, revokeViewerTickets } from "../services/viewer-ticket.service.js";

type TypedIO = SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>;

type TypedSocket = Socket<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>;

/**
 * Builds an occupant's presence DTO, resolving nickname with a database fallback
 * and carrying along their self-reported mute/deafen state.
 *
 * Fast path: Redis presence (available 99% of the time).
 * Slow path: Prisma User table (covers the race-condition window
 *            where presence was just deleted / not yet written) — voice
 *            state has no DB fallback since it's inherently ephemeral.
 */
export async function buildOccupant(
    userId: string,
    presence: PresenceService,
    prisma: FastifyInstance["prisma"],
): Promise<IUserPresence> {
    const p = await presence.getUserPresence(userId);
    if (p?.nickname) {
        return {
            userId,
            nickname: p.nickname,
            isMuted: p.isMuted,
            isDeafened: p.isDeafened,
            isAway: false,
            isSharingScreen: p.isSharingScreen,
        };
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { nickname: true },
    });
    return {
        userId,
        nickname: user?.nickname ?? "Unknown",
        isMuted: false,
        isDeafened: false,
        isAway: false,
        isSharingScreen: false,
    };
}

/** In-memory voice session start times (channelId → Date) — defined in voice-session.service.ts (PRD 19 A3), re-exported for existing imports. */
export { voiceSessionStartedAt };

/**
 * Resolves the key `MediasoupService`'s per-channel session map should use
 * for this socket (PRD 12.13). `UserVoiceSession`s are keyed by plain
 * `userId` for the normal one-socket-per-user case — but a Viewer window's
 * second socket authenticates as the SAME `userId` as that user's primary
 * connection, so reusing `socket.data.userId` directly there would make the
 * viewer's recv-only session silently overwrite (or read/mutate) the
 * primary connection's real `sendTransport`/`recvTransport`/producers —
 * exactly the collision PRD 12.13's "Robustness" design exists to prevent.
 * A viewer socket instead gets its own key scoped to `socket.id`, which is
 * already guaranteed unique per connection.
 */
export function getMediasoupSessionKey(socket: TypedSocket): string {
    return socket.data.role === "viewer" ? `viewer:${socket.id}` : socket.data.userId;
}

/**
 * Annotates each TEXT channel node in `tree` with `hasUnread`, comparing the
 * channel's latest message timestamp against the requesting user's
 * ChannelRead cursor (no cursor = unread only if the channel has any
 * messages at all, so brand-new channels never start "unread" for anyone).
 *
 * Only meaningful for the per-socket tree sent at join time — a single
 * broadcast tree is shared by every recipient, so this is never called for
 * broadcastTreeUpdate()-style updates triggered by other users' actions.
 */
async function annotateUnreadChannels(
    tree: IChannelTreeNode[],
    channelDtos: { id: string; type: string }[],
    userId: string,
    app: FastifyInstance,
): Promise<void> {
    const textChannelIds = channelDtos
        .filter((c) => c.type === "TEXT")
        .map((c) => c.id);
    if (textChannelIds.length === 0) return;

    const [latestMessages, readCursors] = await Promise.all([
        app.prisma.message.groupBy({
            by: ["channelId"],
            where: { channelId: { in: textChannelIds }, userId: { not: userId } },
            _max: { createdAt: true },
        }),
        app.prisma.channelRead.findMany({
            where: { userId, channelId: { in: textChannelIds } },
        }),
    ]);

    const latestMap = new Map<string, Date>();
    for (const row of latestMessages) {
        if (row._max.createdAt) latestMap.set(row.channelId, row._max.createdAt);
    }
    const lastReadMap = new Map(readCursors.map((r) => [r.channelId, r.lastReadAt]));

    const unreadIds: string[] = [];
    function walk(nodes: IChannelTreeNode[]): void {
        for (const node of nodes) {
            const latest = latestMap.get(node.id);
            if (latest) {
                const lastRead = lastReadMap.get(node.id);
                node.hasUnread = !lastRead || latest > lastRead;
                if (node.hasUnread) unreadIds.push(node.id);
            }
            if (node.children.length > 0) walk(node.children);
        }
    }
    walk(tree);

    // PRD 19 A5: the capped number behind the boolean, for the channels that
    // have one. `hasUnread` itself is unchanged (older clients read it).
    applyUnreadCounts(tree, await countUnreadByChannel(app.prisma, userId, unreadIds));
}

/**
 * Registers all Socket.io connection event handlers.
 */
export function registerConnectionHandlers(
    io: TypedIO,
    app: FastifyInstance,
    mediasoup: MediasoupService,
): void {
    const presence = new PresenceService(app.redis);

    // ── Disconnect grace period ─────────────────────────────────────────────
    // A weak connection's Socket.io session can drop (ping timeout, transport
    // close) and reconnect again within seconds, well before the user
    // actually meant to leave. Without a grace period, every one of those
    // blips immediately wiped this user's presence and broadcast USER_LEFT/
    // PRESENCE_UPDATE to the whole server — which the client then undid
    // moments later by reconnecting and rejoining, so everyone else saw the
    // occupant list flicker and heard the leave+join sound pair for a
    // connection issue that was never really a "leave" at all. Deferring the
    // broadcast (not the mediasoup cleanup — that transport is dead either
    // way) and cancelling it if the same instanceId reconnects in time fixes
    // that without touching the reconnect/rejoin logic itself.
    const DISCONNECT_GRACE_MS = 10_000;
    const pendingDisconnects = new Map<string, ReturnType<typeof setTimeout>>();

    // ── Socket ownership (PRD 15.1) ─────────────────────────────────────────
    // Presence/mediasoup/grace-timer state is keyed by userId, but a user who
    // reconnects has two live primary sockets until the server's ping timeout
    // finally reaps the old half-open one. Tracking which socket OWNS a userId
    // lets the old socket's late `disconnect` be recognized as stale instead
    // of tearing down the live socket's voice session and presence (which is
    // what made reconnected users vanish from the online list and drop voice
    // a second time ~12s later).
    const ownership = new SocketOwnership();

    /** Retires a displaced socket: runs its userId-keyed cleanup exactly once,
     *  deterministically, BEFORE the new socket's voice handshake can race it,
     *  then drops its connection. */
    async function supersedeSocket(oldSocketId: string, userId: string): Promise<void> {
        const old = io.sockets.sockets.get(oldSocketId);
        if (!old) return; // already gone — its disconnect handler ran earlier
        old.data.superseded = true;

        const { serverId, currentChannelId } = old.data;
        if (currentChannelId) {
            const producerId = mediasoup.getSession(currentChannelId, userId)?.producer?.id;
            if (producerId) {
                old.to(`channel:${currentChannelId}`).emit("PRODUCER_CLOSED", { userId, producerId });
            }
            mediasoup.cleanupUserSession(currentChannelId, userId);
            await presence.leaveChannel(userId, currentChannelId);

            const occupantIds = await presence.getChannelOccupants(currentChannelId);
            if (occupantIds.length === 0) {
                voiceSessionStartedAt.delete(currentChannelId);
            }
            const occupants: IUserPresence[] = await Promise.all(
                occupantIds.map((uid) => buildOccupant(uid, presence, app.prisma)),
            );
            io.to(`server:${serverId}`).emit("PRESENCE_UPDATE", {
                channelId: currentChannelId,
                occupants,
                sessionStartedAt: voiceSessionStartedAt.get(currentChannelId)?.toISOString(),
            });
        }

        app.log.info({ socketId: oldSocketId, userId }, "Superseding stale socket");
        old.disconnect(true);
    }

    /** Actually removes presence and broadcasts the leave — run once the
     *  grace period has elapsed with no reconnect. */
    async function finalizeDisconnect(
        userId: string,
        serverId: string,
        currentChannelId: string | null,
    ): Promise<void> {
        if (currentChannelId) {
            await presence.leaveChannel(userId, currentChannelId);

            const occupantIds = await presence.getChannelOccupants(currentChannelId);
            if (occupantIds.length === 0) {
                voiceSessionStartedAt.delete(currentChannelId);
            }
            const occupants: IUserPresence[] = await Promise.all(
                occupantIds.map((uid) => buildOccupant(uid, presence, app.prisma)),
            );

            io.to(`server:${serverId}`).emit("PRESENCE_UPDATE", {
                channelId: currentChannelId,
                occupants,
                sessionStartedAt: voiceSessionStartedAt.get(currentChannelId)?.toISOString(),
            });
        }

        await presence.leaveServer(userId, serverId);
        // The session is over: its Viewer windows' tickets go with it (PRD 17.12).
        await revokeViewerTickets(app.redis, userId).catch(() => {});

        io.to(`server:${serverId}`).emit("USER_LEFT", { userId, serverId });
    }

    io.on("connection", (socket: TypedSocket) => {
        // Diagnostics (PRD 15.2): lets a later log be classified without
        // guesswork — connection lifetime, transport, and the client's
        // address (an IP change between sockets = roaming network).
        const connectedAt = Date.now();
        // Resolved once in index.ts's io.use() with TRUST_PROXY rules (PRD 18.2):
        // forwarded headers from an untrusted peer are ignored.
        const clientAddress = socket.data.clientAddress ?? socket.handshake.address;
        app.log.info({ socketId: socket.id, address: clientAddress }, "Client connected");

        // ── PING_LATENCY — instant ack for client-side RTT + clock-offset
        // measurement (the server timestamp lets the client correct for
        // clock skew, see PRD 11.2). Also doubles as a presence heartbeat:
        // it already fires every ~3s for any connected client, which is far
        // more often than needed to keep the Redis presence hash's 1-hour
        // TTL refreshed — piggybacking here avoids a second periodic event
        // just for that. Without this, a session outliving the TTL (3+
        // hours) has its presence hash expire mid-session, which is what
        // caused nicknames to fall back to "Unknown" in the Online Users
        // modal. Fire-and-forget: never block the latency ack on it. ──────
        socket.on("PING_LATENCY", (ack) => {
            ack(Date.now());
            if (socket.data.userId) {
                presence.heartbeat(socket.data.userId).catch(() => {});
            }
        });

        // ── REQUEST_AUTH_CHALLENGE (PRD 17.12) ────────────────────────────
        // A fresh nonce for this socket's next join. Single use and short-
        // lived; a new request replaces any previous one.
        socket.on("REQUEST_AUTH_CHALLENGE", (ack) => {
            if (typeof ack !== "function") return;
            const nonce = newNonce();
            socket.data.authNonce = nonce;
            socket.data.authNonceIssuedAt = Date.now();
            ack({ nonce });
        });

        // ── REQUEST_VIEWER_TICKET (PRD 17.12) ─────────────────────────────
        // Only the authenticated primary socket that owns its user id may ask.
        socket.on("REQUEST_VIEWER_TICKET", async (ack) => {
            if (typeof ack !== "function") return;
            try {
                const { userId, serverId } = socket.data;
                if (socket.data.role === "viewer" || !userId || !serverId || !ownership.isOwner(userId, socket.id)) {
                    ack({ success: false, error: "Not connected to a server" });
                    return;
                }
                ack({ success: true, ticket: await issueViewerTicket(app.redis, { userId, serverId }) });
            } catch (err) {
                app.log.error({ err }, "Error in REQUEST_VIEWER_TICKET");
                ack({ success: false, error: "Failed to issue a viewer ticket" });
            }
        });

        // ── USER_JOIN_SERVER ────────────────────────────────────────────────
        socket.on("USER_JOIN_SERVER", async (payload, ack) => {
            try {
                const { nickname, instanceId, password } = payload;
                if (typeof instanceId !== "string" || instanceId.length === 0 || instanceId.length > 128) {
                    ack({ success: false, error: "Invalid identity" });
                    return;
                }

                // Password check (if SERVER_PRIVATE_PASSWORD is set)
                const serverPassword = process.env.SERVER_PRIVATE_PASSWORD;
                if (serverPassword && password !== serverPassword) {
                    ack({ success: false, error: "Invalid server password" });
                    return;
                }

                // Use provided serverId or fall back to the bootstrapped one
                const serverId = payload.serverId || app.serverId;

                // Ban check — reject blacklisted instance IDs
                const banned = await app.prisma.bannedUser.findUnique({
                    where: { serverId_userId: { serverId, userId: instanceId } },
                });
                if (banned) {
                    ack({ success: false, error: "You are banned from this server" });
                    return;
                }

                // ── Identity (PRD 17.12) ──────────────────────────────────
                // Decided BEFORE anything is written. The challenge is single
                // use whatever the outcome.
                const nonce = socket.data.authNonce;
                const nonceIssuedAt = socket.data.authNonceIssuedAt;
                socket.data.authNonce = undefined;
                socket.data.authNonceIssuedAt = undefined;

                const parsedProof = parseIdentityProof(payload.identity);
                if (!parsedProof.ok) {
                    void recordIdentityEvent(app, {
                        serverId,
                        userId: instanceId,
                        nickname: String(nickname ?? ""),
                        kind: "REFUSED",
                        reason: "verificationFailed",
                        address: clientAddress,
                    });
                    ack({ success: false, error: IDENTITY_MESSAGES.verificationFailed });
                    return;
                }
                const proofIn = parsedProof.value;
                const existingUser = await app.prisma.user.findUnique({
                    where: { id: instanceId },
                    select: { publicKey: true },
                });
                const fingerprint = proofIn ? keyFingerprint(proofIn.publicKey) : null;
                const proof = proofIn
                    ? {
                          publicKey: proofIn.publicKey,
                          fingerprint: fingerprint!,
                          // The nonce comes from THIS socket, never from the payload.
                          signatureValid:
                              !!nonce &&
                              isNonceFresh(nonceIssuedAt, Date.now()) &&
                              verifyAuthSignature(proofIn.publicKey, proofIn.signature, authMessage(nonce, proofIn.host)),
                          hostAllowed: isHostAllowed(proofIn.host, authAllowedHosts()),
                      }
                    : null;
                const isAdminId = !!process.env.ADMIN_INSTANCE_ID && instanceId === process.env.ADMIN_INSTANCE_ID;
                const decision = decideIdentity({
                    proof,
                    boundKey: existingUser?.publicKey ?? null,
                    requireSigned: requireSignedIdentity(),
                    isAdminId,
                    adminFingerprint: adminKeyFingerprint(),
                });
                const identityLog = { userId: instanceId, fingerprint, address: clientAddress, host: proofIn?.host };
                // The identity log (PRD 18.4): fire-and-forget, never delays or changes a join.
                const logIdentityEvent = (kind: "BOUND" | "REFUSED", reason?: string): void => {
                    void recordIdentityEvent(app, {
                        serverId,
                        userId: instanceId,
                        nickname: String(nickname ?? ""),
                        kind,
                        reason,
                        fingerprint,
                        address: clientAddress,
                        host: proofIn?.host ?? null,
                    });
                };
                if (decision.action === "refuse") {
                    logIdentityEvent("REFUSED", decision.reason);
                    app.log.warn({ ...identityLog, reason: decision.reason }, "Join refused (identity)");
                    ack({ success: false, error: IDENTITY_MESSAGES[decision.reason] });
                    return;
                }
                // Banned address (PRD 18.7). Decided here, after the identity decision,
                // because the designated admin must always be able to get in to undo a
                // mistaken range ban: that exemption applies only when the identity
                // check itself accepted them AS the admin (right id AND, with
                // ADMIN_KEY_FINGERPRINT set, the right key).
                if (socket.data.addressBanned && !(isAdminId && decision.action === "accept" && decision.grantAdmin)) {
                    app.log.warn({ userId: instanceId, address: clientAddress }, "Join refused (banned address)");
                    ack({ success: false, error: "You are banned from this server" });
                    return;
                }

                // ── Invite gate (PRD 18.9) ─────────────────────────────────────
                // A NEW identity needs a valid invite code while the switch is on.
                // Here the code is only CHECKED; the use is consumed in the same
                // transaction that creates the user (or, with approval on, when a
                // moderator approves) — so a failed join never costs a use. A
                // person already waiting for approval got in with a valid code
                // once and keeps their place without presenting it again. Every
                // invalid state gets one message, so codes can't be probed.
                let invitedBy: string | null = null;
                if (requireInvite() && !existingUser && !(isAdminId && decision.action === "accept" && decision.grantAdmin)) {
                    const alreadyQueued =
                        requireApproval() &&
                        !!(await app.prisma.pendingApproval.findUnique({
                            where: { serverId_userId: { serverId, userId: instanceId } },
                            select: { id: true },
                        }));
                    if (!alreadyQueued) {
                        const failKey = `invite-fail:${serverId}:${clientAddress}`;
                        const failures = Number((await app.redis.get(failKey)) ?? 0);
                        if (isInviteThrottled(failures)) {
                            app.log.warn({ userId: instanceId, address: clientAddress }, "Join refused (invite throttled)");
                            ack({ success: false, error: INVITE_MESSAGES.throttled, errorCode: "INVITE_THROTTLED" });
                            return;
                        }
                        const rawCode = typeof payload.inviteCode === "string" ? payload.inviteCode.trim() : "";
                        if (rawCode.length === 0) {
                            ack({ success: false, error: INVITE_MESSAGES.required, errorCode: "INVITE_REQUIRED" });
                            return;
                        }
                        const normalized = normalizeInviteCode(rawCode);
                        const found = normalized
                            ? await findUsableInviteId(app.prisma, serverId, hashInviteCode(normalized))
                            : null;
                        if (!found) {
                            const count = await app.redis.incr(failKey);
                            if (count === 1) await app.redis.expire(failKey, INVITE_FAIL_WINDOW_SECONDS);
                            app.log.warn({ userId: instanceId, address: clientAddress }, "Join refused (invalid invite code)");
                            ack({ success: false, error: INVITE_MESSAGES.invalid, errorCode: "INVITE_INVALID" });
                            return;
                        }
                        invitedBy = found;
                    }
                }

                // ── Approval gate (PRD 18.8) ───────────────────────────────────
                // When the server approves new users, a brand-new identity waits for
                // a moderator. Decided here — after every other check passed and
                // BEFORE anything is written — because the person is NOT a half-joined
                // user: no `users` row, no presence, no roles. Their socket stays
                // connected with `pendingUserId` set and `userId`/`serverId` unset, and
                // every other handler is gated on those, so it can do nothing.
                if (
                    requireApproval() &&
                    !existingUser &&
                    !(isAdminId && decision.action === "accept" && decision.grantAdmin)
                ) {
                    const requestKey = { serverId_userId: { serverId, userId: instanceId } };
                    const existingRequest = await app.prisma.pendingApproval.findUnique({
                        where: requestKey,
                        select: { publicKey: true },
                    });
                    const [pendingTotal, pendingFromAddress] = await Promise.all([
                        app.prisma.pendingApproval.count({ where: { serverId } }),
                        app.prisma.pendingApproval.count({
                            where: { serverId, address: clientAddress, NOT: { userId: instanceId } },
                        }),
                    ]);
                    const gate = decideApprovalGate({
                        requireApproval: true,
                        isNewUser: true,
                        isDesignatedAdmin: false,
                        hasSignedProof: !!proofIn,
                        alreadyPending: !!existingRequest,
                        pendingTotal,
                        pendingFromAddress,
                    });
                    if (gate.action === "refuse") {
                        app.log.warn({ userId: instanceId, address: clientAddress, reason: gate.reason }, "Join refused (approval)");
                        ack({ success: false, error: APPROVAL_MESSAGES[gate.reason] });
                        return;
                    }
                    if (gate.action === "queue" && proofIn) {
                        // Someone else already asked as this id, with another key: the
                        // approval would bind the first key, so a second one is refused.
                        if (existingRequest && existingRequest.publicKey !== proofIn.publicKey) {
                            logIdentityEvent("REFUSED", "otherDevice");
                            ack({ success: false, error: IDENTITY_MESSAGES.otherDevice });
                            return;
                        }
                        await app.prisma.pendingApproval.upsert({
                            where: requestKey,
                            update: {
                                nickname: String(nickname ?? "").slice(0, 64),
                                address: clientAddress,
                                host: proofIn.host,
                                lastSeenAt: new Date(),
                            },
                            create: {
                                inviteId: invitedBy,
                                serverId,
                                userId: instanceId,
                                nickname: String(nickname ?? "").slice(0, 64),
                                publicKey: proofIn.publicKey,
                                fingerprint: fingerprint ?? keyFingerprint(proofIn.publicKey),
                                address: clientAddress,
                                host: proofIn.host,
                            },
                        });
                        await socket.join(pendingRoom(instanceId));
                        socket.data.pendingUserId = instanceId;
                        if (!existingRequest) {
                            app.log.info({ userId: instanceId, address: clientAddress }, "New user is waiting for approval");
                            void notifyPendingChanged(app, io, serverId, true);
                        }
                        ack({ success: false, pending: true, error: "Waiting for approval" });
                        return;
                    }
                }

                // Which name this signed join was addressed to (PRD 18.5): remembered so
                // an admin can pick the names people really use, and so the allowed-names
                // guard knows what THIS admin's own session was signed for.
                if (proofIn) {
                    socket.data.authHost = normalizeAuthHost(proofIn.host);
                    void observeAuthHost(app.redis, serverId, proofIn.host);
                }
                if (decision.bind && existingUser && proofIn) {
                    // Atomic compare-and-set: only binds if nothing is bound yet,
                    // so two racing first joins can't both win.
                    const bound = await app.prisma.user.updateMany({
                        where: { id: instanceId, publicKey: null },
                        data: { publicKey: proofIn.publicKey, publicKeyBoundAt: new Date() },
                    });
                    if (bound.count === 0) {
                        const now = await app.prisma.user.findUnique({ where: { id: instanceId }, select: { publicKey: true } });
                        if (now?.publicKey !== proofIn.publicKey) {
                            logIdentityEvent("REFUSED", "otherDevice");
                            app.log.warn({ ...identityLog, reason: "otherDevice" }, "Join refused (identity bind race lost)");
                            ack({ success: false, error: IDENTITY_MESSAGES.otherDevice });
                            return;
                        }
                    }
                    logIdentityEvent("BOUND");
                    app.log.info(identityLog, "Identity key bound");
                }

                // No longer waiting (PRD 18.8): this socket may have been pending until just now.
                if (socket.data.pendingUserId) {
                    void socket.leave(pendingRoom(socket.data.pendingUserId));
                    socket.data.pendingUserId = undefined;
                }

                // Use the persistent instance ID as userId
                socket.data.serverId = serverId;
                socket.data.nickname = nickname;
                socket.data.userId = instanceId;
                socket.data.currentChannelId = null;

                // Avatar refresh (PRD 17.1): an absent field (a pre-v2.6.0
                // client) leaves the stored avatar alone, null clears it, and
                // an invalid selection is ignored — it never fails the join.
                let avatarData: { avatarUrl: string | null } | Record<string, never> = {};
                let avatarChanged = false;
                if (payload.avatar !== undefined) {
                    const parsed = parseAvatarSelection(payload.avatar);
                    if (parsed.ok) {
                        const avatarUrl = buildAvatarUrl(parsed.value);
                        avatarData = { avatarUrl };
                        // A change made while offline must reach clients that
                        // are already online and cached the old one.
                        const existing = await app.prisma.user.findUnique({
                            where: { id: instanceId },
                            select: { avatarUrl: true },
                        });
                        avatarChanged = (existing?.avatarUrl ?? null) !== avatarUrl;
                    } else {
                        app.log.warn({ userId: instanceId, error: parsed.error }, "Ignoring invalid avatar on join");
                    }
                }

                // Auto-create (upsert) User record for this instance
                // A brand-new user binds their key as the row is created (PRD 17.12).
                const bindOnCreate =
                    decision.bind && !existingUser && proofIn
                        ? { publicKey: proofIn.publicKey, publicKeyBoundAt: new Date() }
                        : {};
                // Where they joined from, for an offline "also ban their address" (PRD 18.7).
                const lastAddressData = normalizeIp(clientAddress)
                    ? { lastAddress: normalizeIp(clientAddress), lastAddressAt: new Date() }
                    : {};
                const upsertUser = (db: Pick<typeof app.prisma, "user">) =>
                    db.user.upsert({
                        where: { id: instanceId },
                        update: { nickname, ...avatarData, ...lastAddressData },
                        create: {
                            id: instanceId,
                            username: instanceId,
                            nickname,
                            password: "instance-auth", // identity is the bound key (PRD 17.12), not a password
                            ...avatarData,
                            ...lastAddressData,
                            ...bindOnCreate,
                        },
                        select: { publicKey: true },
                    });
                let userRow: { publicKey: string | null };
                if (invitedBy) {
                    // A new user coming in with an invite (PRD 18.9): the user and the
                    // consumed use are ONE transaction, so a failed join costs nothing
                    // and two joins racing for the last use cannot both win.
                    const inviteId = invitedBy;
                    try {
                        userRow = await app.prisma.$transaction(async (tx) => {
                            const row = await upsertUser(tx);
                            // Lost the key race: no use is consumed; handled right below.
                            if (decision.bind && proofIn && row.publicKey !== proofIn.publicKey) return row;
                            if (!(await claimInviteUse(tx, serverId, inviteId))) throw new InviteUnusableError();
                            await tx.inviteUse.create({ data: { inviteId, userId: instanceId } });
                            return row;
                        });
                    } catch (err) {
                        if (err instanceof InviteUnusableError) {
                            // Used up / revoked / expired between the check and now.
                            ack({ success: false, error: INVITE_MESSAGES.invalid, errorCode: "INVITE_INVALID" });
                            return;
                        }
                        throw err;
                    }
                } else {
                    userRow = await upsertUser(app.prisma);
                }
                if (decision.bind && !existingUser && proofIn) {
                    if (userRow.publicKey !== proofIn.publicKey) {
                        // Another first join created the row with its own key in between.
                        logIdentityEvent("REFUSED", "otherDevice");
                        app.log.warn({ ...identityLog, reason: "otherDevice" }, "Join refused (identity create race lost)");
                        ack({ success: false, error: IDENTITY_MESSAGES.otherDevice });
                        return;
                    }
                    logIdentityEvent("BOUND");
                    app.log.info(identityLog, "Identity key bound (new user)");
                }

                // The Member role is given when the user is CREATED, not on every
                // join (PRD 18.18): re-granting it each time made removing it last
                // only until the next connect. Existing users already hold it (the
                // old per-join upsert guaranteed that), so nobody loses access when
                // this ships. The designated server admin (ADMIN_INSTANCE_ID) keeps
                // their per-join grant — only with the right key when
                // ADMIN_KEY_FINGERPRINT is set (PRD 17.12).
                const rolesToAssign = rolesToGrant({ isNewUser: !existingUser, grantAdmin: decision.grantAdmin });

                for (const roleId of rolesToAssign) {
                    await app.prisma.userRole.upsert({
                        where: {
                            userId_roleId: {
                                userId: instanceId,
                                roleId: roleId,
                            },
                        },
                        update: {},
                        create: {
                            userId: instanceId,
                            roleId: roleId,
                        },
                    });
                }

                // Membership (PRD 18.17): User Management lists members, not just
                // role holders, so a user whose last role is removed stays listed.
                // `joinedAt` keeps the first join (the update branch is empty).
                await app.prisma.userServer.upsert({
                    where: { userId_serverId: { userId: instanceId, serverId } },
                    update: {},
                    create: { userId: instanceId, serverId },
                });

                // Cancel any pending deferred-leave from a recent disconnect —
                // this instance reconnected within the grace period, so it
                // never really left (see the `disconnect` handler below).
                const pendingDisconnect = pendingDisconnects.get(instanceId);
                if (pendingDisconnect) {
                    clearTimeout(pendingDisconnect);
                    pendingDisconnects.delete(instanceId);
                }

                // Take ownership of this userId; if an older socket for the
                // same user is still around (a zombie from a dropped
                // connection), retire it now (PRD 15.1).
                const displacedSocketId = ownership.claim(instanceId, socket.id);
                if (displacedSocketId) {
                    await supersedeSocket(displacedSocketId, instanceId);
                }

                // Access to channels, DMs and voice (PRD 18.18): computed once here
                // and kept current by applyAccessChange() when roles change.
                socket.data.hasAccess = hasServerAccess(await getUserPermissions(app.prisma, instanceId, serverId));

                // Join the Socket.io room for this server
                await socket.join(`server:${serverId}`);
                // Content events (messages, edits, reactions, pins) go to this room
                // only — a user without access must not receive them live either.
                if (socket.data.hasAccess) await socket.join(membersRoom(serverId));
                // Moderators (BAN_USER/ADMIN) are told when the approval queue changes (PRD 18.8).
                await syncModeratorRoom(app, io, instanceId, serverId).catch(() => {});

                // Register presence in Redis
                await presence.joinServer(instanceId, serverId, nickname);

                // Notify all other clients in the server (a changed avatar first,
                // so their cache is current before the join is announced)
                if (avatarChanged && "avatarUrl" in avatarData) {
                    socket.to(`server:${serverId}`).emit("USER_AVATAR_UPDATED", {
                        userId: instanceId,
                        avatarUrl: avatarData.avatarUrl,
                    });
                }
                socket.to(`server:${serverId}`).emit("USER_JOINED", {
                    userId: instanceId,
                    nickname,
                    serverId,
                });

                // Send the full channel tree to the newly connected client
                const channels = await app.prisma.channel.findMany({
                    where: { serverId },
                    orderBy: { position: "asc" },
                });

                // Map Prisma rows to IChannel DTOs
                const channelDtos = channels.map((ch: {
                    id: string;
                    serverId: string;
                    name: string;
                    type: string;
                    parentId: string | null;
                    position: number;
                    maxUsers: number | null;
                    isNsfw: boolean;
                    createdAt: Date;
                    iconEmoji: string | null;
                    iconUrl: string | null;
                }) => ({
                    id: ch.id,
                    serverId: ch.serverId,
                    name: ch.name,
                    type: ch.type as import("@reson8/shared-types").ChannelType,
                    parentId: ch.parentId,
                    position: ch.position,
                    maxUsers: ch.maxUsers,
                    isNsfw: ch.isNsfw,
                    createdAt: ch.createdAt.toISOString(),
                    iconEmoji: ch.iconEmoji,
                    iconUrl: ch.iconUrl,
                }));

                const tree = buildChannelTree(channelDtos);

                // Hydrate occupants from Redis presence so joining
                // clients see who is already in voice channels
                async function hydrateOccupants(
                    nodes: typeof tree,
                ): Promise<void> {
                    for (const node of nodes) {
                        const occupantIds =
                            await presence.getChannelOccupants(node.id);
                        if (occupantIds.length > 0) {
                            node.occupants = await Promise.all(
                                occupantIds.map((uid) => buildOccupant(uid, presence, app.prisma)),
                            );
                            // Bootstrap voice session start time for occupied voice channels
                            // (approximate — covers server-restart recovery)
                            const chMeta = channelDtos.find((c: { id: string }) => c.id === node.id);
                            if (chMeta && (chMeta.type as string) === "VOICE" && !voiceSessionStartedAt.has(node.id)) {
                                voiceSessionStartedAt.set(node.id, new Date());
                            }
                        }
                        if (node.children.length > 0) {
                            await hydrateOccupants(node.children);
                        }
                    }
                }
                await hydrateOccupants(tree);
                // PRD 19 A3: occupied voice rooms carry their session start so a
                // client that connects mid-session shows the running timer at once.
                annotateSessionStarts(tree, true);
                await annotateUnreadChannels(tree, channelDtos, instanceId, app);

                socket.emit("CHANNEL_TREE_UPDATE", { serverId, tree });

                ack({ success: true, serverId, hasAccess: socket.data.hasAccess });
                app.log.info(
                    { socketId: socket.id, nickname, serverId, instanceId },
                    "User joined server",
                );
            } catch (err) {
                app.log.error({ err }, "Error in USER_JOIN_SERVER");
                ack({ success: false, error: "Failed to join server" });
            }
        });

        // ── VIEWER_AUTHENTICATE (PRD 12.13) ─────────────────────────────────
        // The Viewer window's equivalent of USER_JOIN_SERVER — deliberately
        // much narrower. No ban check, no room join, no presence write, no
        // channel tree, no USER_JOINED broadcast: a viewer socket is not a
        // "user joining the server" in any of the senses those exist for,
        // it's a second connection an *already-present* user opened solely
        // to pull one video/audio stream. Skipping all of that is the point
        // (see `SocketData.role`'s doc comment) — a banned/kicked user
        // can't get here anyway, since `WATCH_SCREEN_SHARE` (voice.handler.ts)
        // separately requires the caller to currently be a channel occupant.
        socket.on("VIEWER_AUTHENTICATE", async (payload, ack) => {
            try {
                // PRD 17.12: the user id comes from a ticket the user's own
                // authenticated primary socket requested — never from the
                // payload. (Before, any id was accepted here, without the
                // password or ban checks.)
                let userId: string | null = null;
                let serverId = app.serverId;
                if (payload?.ticket !== undefined) {
                    const owner = await resolveViewerTicket(app.redis, payload.ticket);
                    if (owner) {
                        userId = owner.userId;
                        serverId = owner.serverId;
                    }
                } else if (typeof payload?.instanceId === "string" && payload.instanceId.length <= 128) {
                    // Legacy (pre-2.6.0) viewer: only for an identity with no
                    // bound key, only while unsigned joins are allowed, and
                    // only while that user really has a live primary session.
                    const legacyId = payload.instanceId;
                    const row = await app.prisma.user.findUnique({ where: { id: legacyId }, select: { publicKey: true } });
                    if (row && row.publicKey === null && !requireSignedIdentity() && ownership.hasOwner(legacyId)) {
                        userId = legacyId;
                    }
                }
                if (!userId) {
                    ack({ success: false, error: "Viewer session expired — close and reopen the viewer." });
                    return;
                }
                socket.data.serverId = serverId;
                socket.data.userId = userId;
                socket.data.nickname = "";
                socket.data.currentChannelId = null;
                // The ticket/session this socket authenticated with belongs to a
                // member; losing access disconnects the viewer (PRD 18.18).
                socket.data.hasAccess = true;
                ack({ success: true });
                app.log.info(
                    { socketId: socket.id, role: "viewer", userId, viaTicket: payload?.ticket !== undefined },
                    "Viewer socket authenticated",
                );
            } catch (err) {
                app.log.error({ err }, "Error in VIEWER_AUTHENTICATE");
                ack({ success: false, error: "Failed to authenticate" });
            }
        });

        // ── USER_LEAVE_SERVER ───────────────────────────────────────────────
        socket.on("USER_LEAVE_SERVER", async (payload) => {
            try {
                const { serverId } = payload;

                await presence.leaveServer(socket.data.userId, serverId);
                await socket.leave(`server:${serverId}`);

                socket.to(`server:${serverId}`).emit("USER_LEFT", {
                    userId: socket.data.userId,
                    serverId,
                });

                app.log.info({ socketId: socket.id, serverId }, "User left server");
            } catch (err) {
                app.log.error({ err }, "Error in USER_LEAVE_SERVER");
            }
        });

        // ── USER_JOIN_CHANNEL ───────────────────────────────────────────────
        socket.on("USER_JOIN_CHANNEL", async (payload, ack) => {
            try {
                const { channelId } = payload;
                const userId = socket.data.userId;

                // Full cleanup of previous channel if any
                if (socket.data.currentChannelId) {
                    const prevChannelId = socket.data.currentChannelId;

                    // Clean up mediasoup voice session in old channel
                    const producerId = mediasoup.getSession(prevChannelId, userId)?.producer?.id;
                    if (producerId) {
                        socket.to(`channel:${prevChannelId}`).emit("PRODUCER_CLOSED", {
                            userId,
                            producerId,
                        });
                    }
                    mediasoup.cleanupUserSession(prevChannelId, userId);

                    // Leave old channel presence + room
                    await presence.leaveChannel(userId, prevChannelId);
                    await socket.leave(`channel:${prevChannelId}`);

                    // Broadcast updated occupants for the old channel
                    const oldOccupantIds = await presence.getChannelOccupants(prevChannelId);
                    if (oldOccupantIds.length === 0) {
                        voiceSessionStartedAt.delete(prevChannelId);
                    }
                    const oldOccupants: IUserPresence[] = await Promise.all(
                        oldOccupantIds.map((uid) => buildOccupant(uid, presence, app.prisma)),
                    );
                    io.to(`server:${socket.data.serverId}`).emit("PRESENCE_UPDATE", {
                        channelId: prevChannelId,
                        occupants: oldOccupants,
                        sessionStartedAt: voiceSessionStartedAt.get(prevChannelId)?.toISOString(),
                    });
                }

                // Join new channel
                socket.data.currentChannelId = channelId;
                await socket.join(`channel:${channelId}`);
                await presence.joinChannel(userId, channelId);

                // Get current occupants and broadcast presence update
                const occupantIds = await presence.getChannelOccupants(channelId);

                // Start a new voice session if this is the first occupant in a voice channel
                if (occupantIds.length === 1) {
                    const ch = await app.prisma.channel.findUnique({
                        where: { id: channelId },
                        select: { type: true },
                    });
                    if (ch && ch.type === "VOICE") {
                        voiceSessionStartedAt.set(channelId, new Date());
                    }
                }

                const occupants: IUserPresence[] = await Promise.all(
                    occupantIds.map((uid) => buildOccupant(uid, presence, app.prisma)),
                );

                io.to(`server:${socket.data.serverId}`).emit("PRESENCE_UPDATE", {
                    channelId,
                    occupants,
                    sessionStartedAt: voiceSessionStartedAt.get(channelId)?.toISOString(),
                });

                ack({ success: true });

                // Notify joining user of existing voice producers in this channel
                const existingProducers = mediasoup.getExistingProducers(
                    channelId,
                    userId,
                );
                if (existingProducers.length > 0) {
                    // Look up nicknames for each producer
                    const producersWithNicknames = existingProducers.map((p) => {
                        const userSession = mediasoup.getSession(channelId, p.userId);
                        return {
                            userId: p.userId,
                            nickname: p.userId, // fallback — userId is instanceId
                            producerId: p.producerId,
                        };
                    });
                    socket.emit("EXISTING_PRODUCERS", {
                        channelId,
                        producers: producersWithNicknames,
                    });
                }

                app.log.info(
                    { socketId: socket.id, channelId },
                    "User joined channel",
                );
            } catch (err) {
                app.log.error({ err }, "Error in USER_JOIN_CHANNEL");
                ack({ success: false, error: "Failed to join channel" });
            }
        });

        // ── USER_LEAVE_CHANNEL ──────────────────────────────────────────────
        socket.on("USER_LEAVE_CHANNEL", async (payload) => {
            try {
                const { channelId } = payload;
                const userId = socket.data.userId;

                await socket.leave(`channel:${channelId}`);
                await presence.leaveChannel(userId, channelId);

                // Clean up mediasoup voice session
                const producerId = mediasoup.getSession(channelId, userId)?.producer?.id;
                if (producerId) {
                    socket.to(`channel:${channelId}`).emit("PRODUCER_CLOSED", {
                        userId,
                        producerId,
                    });
                }
                mediasoup.cleanupUserSession(channelId, userId);

                socket.data.currentChannelId = null;

                // Broadcast updated occupants
                const occupantIds = await presence.getChannelOccupants(channelId);
                if (occupantIds.length === 0) {
                    voiceSessionStartedAt.delete(channelId);
                }
                const occupants: IUserPresence[] = await Promise.all(
                    occupantIds.map((uid) => buildOccupant(uid, presence, app.prisma)),
                );

                io.to(`server:${socket.data.serverId}`).emit("PRESENCE_UPDATE", {
                    channelId,
                    occupants,
                    sessionStartedAt: voiceSessionStartedAt.get(channelId)?.toISOString(),
                });

                app.log.info({ socketId: socket.id, channelId }, "User left channel");
            } catch (err) {
                app.log.error({ err }, "Error in USER_LEAVE_CHANNEL");
            }
        });

        // ── DISCONNECT ──────────────────────────────────────────────────────
        socket.on("disconnect", async (reason) => {
            try {
                // Viewer sockets (PRD 12.13) get an entirely separate,
                // minimal cleanup path — only their own recv-only mediasoup
                // session, keyed by `socket.id` (see `getMediasoupSessionKey`).
                // They never touched presence, rooms, or `USER_JOINED`/
                // `USER_LEFT` broadcasts in the first place, so none of that
                // runs here — doing so would incorrectly affect this same
                // user's separate primary connection, if they have one.
                if (socket.data.role === "viewer") {
                    if (socket.data.currentChannelId) {
                        mediasoup.cleanupUserSession(
                            socket.data.currentChannelId,
                            getMediasoupSessionKey(socket),
                        );
                    }
                    // Sound-cue only (PRD 13.16) — the Viewer window's own
                    // native close button (or a crash) never fires
                    // STOP_WATCHING_SCREEN_SHARE, so this is the only place
                    // that path gets a VIEWER_LEFT_YOUR_STREAM at all.
                    if (socket.data.watchingUserId) {
                        for (const [, s] of io.sockets.sockets) {
                            if (s.data.userId === socket.data.watchingUserId && s.data.serverId === socket.data.serverId && s.data.role === "primary") {
                                s.emit("VIEWER_LEFT_YOUR_STREAM");
                            }
                        }
                    }
                    app.log.info(
                        { socketId: socket.id, role: "viewer", reason },
                        "Viewer socket disconnected",
                    );
                    return;
                }

                const { serverId, currentChannelId, nickname, userId } = socket.data;

                // A superseded/stale socket (PRD 15.1) no longer owns this
                // userId's mediasoup session, presence or grace timer — they
                // belong to the newer socket. Touching them here is exactly
                // what used to kill the live session and mark the user
                // offline, so do nothing userId-keyed.
                if (serverId && userId && !ownership.isOwner(userId, socket.id)) {
                    app.log.info(
                        {
                            socketId: socket.id,
                            nickname,
                            reason,
                            superseded: socket.data.superseded === true,
                            transport: socket.conn?.transport?.name,
                            connectedForMs: Date.now() - connectedAt,
                        },
                        "Stale socket disconnected (superseded)",
                    );
                    return;
                }
                if (serverId && userId) ownership.release(userId, socket.id);

                if (serverId) {
                    // Clean up the mediasoup voice session immediately — this
                    // transport is tied to the now-dead socket either way,
                    // and the client rebuilds a fresh one on rejoin.
                    if (currentChannelId) {
                        const producerId = mediasoup.getSession(currentChannelId, userId)?.producer?.id;
                        if (producerId) {
                            socket.to(`channel:${currentChannelId}`).emit("PRODUCER_CLOSED", {
                                userId,
                                producerId,
                            });
                        }
                        mediasoup.cleanupUserSession(currentChannelId, userId);
                    }

                    // Cancel any earlier pending deferred-leave for this user
                    // regardless of which path we take below — it's about to
                    // be superseded either way.
                    const existing = pendingDisconnects.get(userId);
                    if (existing) clearTimeout(existing);

                    if (reason === "client namespace disconnect") {
                        // The client explicitly called socket.disconnect()
                        // itself (app quit — see main.ts's "before-quit" — or
                        // preload.ts's connect() tearing down a stale socket
                        // before opening a new one). Unlike an ordinary
                        // dropped transport, this is unambiguous: the client
                        // isn't coming back on this socket, so there's no
                        // "might just be a network blip" case to protect
                        // against here — finalize immediately instead of
                        // making every deliberate quit wait out the same
                        // grace period meant for accidental drops.
                        pendingDisconnects.delete(userId);
                        finalizeDisconnect(userId, serverId, currentChannelId).catch((err) => {
                            app.log.error({ err }, "Error during immediate disconnect cleanup");
                        });
                    } else {
                        // Defer presence removal + the USER_LEFT/PRESENCE_UPDATE
                        // broadcast (see the grace-period comment above) — a
                        // reconnect within DISCONNECT_GRACE_MS cancels this via
                        // USER_JOIN_SERVER, so a brief drop never appears as a
                        // leave to anyone else.
                        const timer = setTimeout(() => {
                            pendingDisconnects.delete(userId);
                            // Defense in depth (PRD 15.1): never finalize a
                            // user who has since reconnected on a new socket.
                            if (ownership.hasOwner(userId)) return;
                            finalizeDisconnect(userId, serverId, currentChannelId).catch((err) => {
                                app.log.error({ err }, "Error during deferred disconnect cleanup");
                            });
                        }, DISCONNECT_GRACE_MS);
                        pendingDisconnects.set(userId, timer);
                    }
                }

                app.log.info(
                    {
                        socketId: socket.id,
                        nickname,
                        reason,
                        superseded: false,
                        transport: socket.conn?.transport?.name,
                        connectedForMs: Date.now() - connectedAt,
                    },
                    reason === "client namespace disconnect"
                        ? "Client disconnected (finalized immediately)"
                        : "Client disconnected (grace period started)",
                );
            } catch (err) {
                app.log.error({ err }, "Error during disconnect cleanup");
            }
        });
    });
}
