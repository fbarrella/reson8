/**
 * Nudge Handler — attention-grabbing pings between online users, plus the
 * server-wide setting that gates the feature.
 *
 * Handles: NUDGE_USER, GET_SERVER_SETTINGS, UPDATE_SERVER_SETTINGS.
 *
 * The 30-second cooldown is tracked in memory, keyed per (sender, target)
 * pair — nudging one person doesn't throttle nudging someone else. This is
 * an intentionally ephemeral rate limit (resets on server restart); the
 * alternative (persisting it) would cost a DB/Redis round trip for a
 * purely advisory, low-stakes limit.
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
} from "@reson8/shared-types";
import { PermissionFlags } from "@reson8/shared-types";
import { requirePermission } from "../middleware/permissions.middleware.js";
import { getUserPermissions, isAdmin } from "../services/permissions.service.js";
import {
    authAllowedHosts,
    authAllowedHostsLockedByEnv,
    requireSignedIdentity as isSignedIdentityRequired,
    requireSignedLockedByEnv,
    setDbAllowedHosts,
    setDbRequireSigned,
} from "../config/identity.config.js";
import { requireApproval, setDbRequireApproval } from "../config/approval.config.js";
import { requireInvite, setDbRequireInvite } from "../config/invite.config.js";
import {
    checkAllowedHostsUpdate,
    listObservedAuthHosts,
    parseAllowedHostsInput,
} from "../services/auth-hosts.service.js";
import { countUnprotectedActiveUsers } from "../services/identity-events.service.js";
import { PresenceService } from "../services/presence.service.js";
import {
    DEFAULT_MAX_MESSAGE_LENGTH,
    MIN_MAX_MESSAGE_LENGTH,
    MAX_MAX_MESSAGE_LENGTH,
} from "../config/message.config.js";
import { SERVER_VERSION } from "../config/version.config.js";

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

const NUDGE_COOLDOWN_MS = 30 * 1000;

/** In-memory per-(sender, target) cooldown tracker: "senderId:targetId" → last nudge timestamp. */
const lastNudgeAt = new Map<string, number>();

export function registerNudgeHandlers(
    io: TypedIO,
    app: FastifyInstance,
): void {
    const presence = new PresenceService(app.redis);

    io.on("connection", (socket: TypedSocket) => {
        // ── GET_SERVER_SETTINGS ─────────────────────────────────────────────
        socket.on("GET_SERVER_SETTINGS", async (ack) => {
            try {
                const server = await app.prisma.server.findUnique({
                    where: { id: socket.data.serverId },
                    select: {
                        name: true,
                        nudgeEnabled: true,
                        screenShareEnabled: true,
                        maxMessageLength: true,
                    },
                });
                // Identity-policy details are for ADMINs only (PRD 18.4). Checked
                // quietly: this is a plain read every user makes, so it must not
                // emit a PERMISSION_DENIED error the way requirePermission does.
                let adminOnly: {
                    requireSignedIdentity?: boolean;
                    requireSignedIdentityLockedByEnv?: boolean;
                    unprotectedActiveUsers?: number;
                    authAllowedHosts?: string[];
                    authAllowedHostsLockedByEnv?: boolean;
                    observedAuthHosts?: Awaited<ReturnType<typeof listObservedAuthHosts>>;
                    requireApproval?: boolean;
                    requireInvite?: boolean;
                } = {};
                const { userId, serverId } = socket.data;
                if (userId && serverId) {
                    const perms = await getUserPermissions(app.prisma, userId, serverId);
                    if (isAdmin(perms)) {
                        adminOnly = {
                            requireSignedIdentity: isSignedIdentityRequired(),
                            requireSignedIdentityLockedByEnv: requireSignedLockedByEnv(),
                            unprotectedActiveUsers: await countUnprotectedActiveUsers(app.prisma),
                            requireApproval: requireApproval(),
                            requireInvite: requireInvite(),
                            authAllowedHosts: authAllowedHosts(),
                            authAllowedHostsLockedByEnv: authAllowedHostsLockedByEnv(),
                            observedAuthHosts: await listObservedAuthHosts(app.redis, serverId),
                        };
                    }
                }

                ack({
                    success: true,
                    nudgeEnabled: server?.nudgeEnabled ?? true,
                    screenShareEnabled: server?.screenShareEnabled ?? true,
                    name: server?.name,
                    maxMessageLength: server?.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH,
                    version: SERVER_VERSION,
                    ...adminOnly,
                });
            } catch (err) {
                app.log.error({ err }, "Error in GET_SERVER_SETTINGS");
                ack({ success: false });
            }
        });

        // ── UPDATE_SERVER_SETTINGS ──────────────────────────────────────────
        // Each field in the payload is optional (PRD 12.14) — a toggle only
        // sends the one setting it changed, so `data` below is built from
        // whichever fields are actually present rather than always writing
        // both (which would silently reset the other to whatever the caller
        // happened to have loaded, on a stale client).
        socket.on("UPDATE_SERVER_SETTINGS", async (payload, ack) => {
            try {
                const allowed = await requirePermission(
                    app, socket, BigInt(PermissionFlags.ADMIN),
                );
                if (!allowed) {
                    ack({ success: false, error: "Permission denied" });
                    return;
                }

                const {
                    nudgeEnabled,
                    screenShareEnabled,
                    maxMessageLength,
                    requireSignedIdentity,
                    authAllowedHosts: allowedHostsInput,
                    requireApproval: requireApprovalInput,
                    requireInvite: requireInviteInput,
                } = payload;
                const data: {
                    nudgeEnabled?: boolean;
                    screenShareEnabled?: boolean;
                    maxMessageLength?: number;
                    requireSignedIdentity?: boolean;
                    authAllowedHosts?: string[];
                    requireApproval?: boolean;
                    requireInvite?: boolean;
                } = {};
                if (requireInviteInput !== undefined) {
                    if (typeof requireInviteInput !== "boolean") {
                        ack({ success: false, error: "Invalid value" });
                        return;
                    }
                    data.requireInvite = requireInviteInput;
                }
                if (requireApprovalInput !== undefined) {
                    if (typeof requireApprovalInput !== "boolean") {
                        ack({ success: false, error: "Invalid value" });
                        return;
                    }
                    data.requireApproval = requireApprovalInput;
                }
                if (allowedHostsInput !== undefined) {
                    if (authAllowedHostsLockedByEnv()) {
                        ack({
                            success: false,
                            error: "Set by the server's AUTH_ALLOWED_HOSTS environment variable",
                        });
                        return;
                    }
                    const parsed = parseAllowedHostsInput(allowedHostsInput);
                    if (!parsed.ok) {
                        ack({ success: false, error: parsed.error });
                        return;
                    }
                    // Never let an admin save a list that excludes the name their own
                    // session was signed for — they'd be refused on the next reconnect.
                    const guard = checkAllowedHostsUpdate(parsed.hosts, socket.data.authHost);
                    if (!guard.ok) {
                        ack({ success: false, error: guard.error });
                        return;
                    }
                    data.authAllowedHosts = parsed.hosts;
                }
                if (nudgeEnabled !== undefined) data.nudgeEnabled = nudgeEnabled;
                if (screenShareEnabled !== undefined) data.screenShareEnabled = screenShareEnabled;
                if (requireSignedIdentity !== undefined) {
                    if (typeof requireSignedIdentity !== "boolean") {
                        ack({ success: false, error: "Invalid value" });
                        return;
                    }
                    if (requireSignedLockedByEnv()) {
                        // The environment decides; saving a value that can't take effect would mislead.
                        ack({
                            success: false,
                            error: "Set by the server's REQUIRE_SIGNED_IDENTITY environment variable",
                        });
                        return;
                    }
                    data.requireSignedIdentity = requireSignedIdentity;
                }
                if (maxMessageLength !== undefined) {
                    // Bounded, not just "must be a positive integer" — an
                    // admin fat-fingering an astronomically large value
                    // would silently defeat the whole point of this setting.
                    if (
                        !Number.isInteger(maxMessageLength) ||
                        maxMessageLength < MIN_MAX_MESSAGE_LENGTH ||
                        maxMessageLength > MAX_MAX_MESSAGE_LENGTH
                    ) {
                        ack({
                            success: false,
                            error: `Message length limit must be between ${MIN_MAX_MESSAGE_LENGTH} and ${MAX_MAX_MESSAGE_LENGTH}`,
                        });
                        return;
                    }
                    data.maxMessageLength = maxMessageLength;
                }

                const updated = await app.prisma.server.update({
                    where: { id: socket.data.serverId },
                    data,
                    select: {
                        nudgeEnabled: true,
                        screenShareEnabled: true,
                        maxMessageLength: true,
                        requireSignedIdentity: true,
                        authAllowedHosts: true,
                        requireApproval: true,
                        requireInvite: true,
                    },
                });
                setDbRequireApproval(updated.requireApproval); // PRD 18.8: applies to the next join
                setDbRequireInvite(updated.requireInvite); // PRD 18.9
                // Both take effect on the very next join, no restart (PRD 18.4/18.5).
                setDbRequireSigned(updated.requireSignedIdentity);
                setDbAllowedHosts(updated.authAllowedHosts);

                ack({ success: true });

                io.to(`server:${socket.data.serverId}`).emit("SERVER_SETTINGS_UPDATED", {
                    nudgeEnabled: updated.nudgeEnabled,
                    screenShareEnabled: updated.screenShareEnabled,
                    maxMessageLength: updated.maxMessageLength,
                });

                app.log.info(
                    { socketId: socket.id, ...data },
                    "Server settings updated",
                );
            } catch (err) {
                app.log.error({ err }, "Error in UPDATE_SERVER_SETTINGS");
                ack({ success: false, error: "Failed to update settings" });
            }
        });

        // ── NUDGE_USER ───────────────────────────────────────────────────────
        socket.on("NUDGE_USER", async (payload, ack) => {
            try {
                const { targetUserId } = payload;
                const senderId = socket.data.userId;
                const serverId = socket.data.serverId;

                if (targetUserId === senderId) {
                    ack({ success: false, error: "You cannot nudge yourself" });
                    return;
                }

                const server = await app.prisma.server.findUnique({
                    where: { id: serverId },
                    select: { nudgeEnabled: true },
                });
                if (!server?.nudgeEnabled) {
                    ack({ success: false, error: "Nudging is disabled on this server" });
                    return;
                }

                const onlineIds = await presence.getOnlineUsers(serverId);
                if (!onlineIds.includes(targetUserId)) {
                    ack({ success: false, error: "That user is not online" });
                    return;
                }

                const cooldownKey = `${senderId}:${targetUserId}`;
                const last = lastNudgeAt.get(cooldownKey);
                const now = Date.now();
                if (last && now - last < NUDGE_COOLDOWN_MS) {
                    const remainingSec = Math.ceil((NUDGE_COOLDOWN_MS - (now - last)) / 1000);
                    ack({ success: false, error: `Wait ${remainingSec}s before nudging this user again` });
                    return;
                }
                lastNudgeAt.set(cooldownKey, now);

                for (const [, s] of io.sockets.sockets) {
                    if (s.data.userId === targetUserId && s.data.serverId === serverId) {
                        s.emit("NUDGE_RECEIVED", {
                            fromUserId: senderId,
                            fromNickname: socket.data.nickname,
                        });
                    }
                }

                ack({ success: true });

                app.log.info(
                    { socketId: socket.id, targetUserId },
                    "User nudged",
                );
            } catch (err) {
                app.log.error({ err }, "Error in NUDGE_USER");
                ack({ success: false, error: "Failed to nudge user" });
            }
        });
    });
}
