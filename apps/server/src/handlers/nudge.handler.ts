/**
 * Nudge Handler — attention-grabbing pings between online users, plus the
 * server-wide setting that gates the feature.
 *
 * Handles: NUDGE_USER, GET_SERVER_SETTINGS, GET_SERVER_SUMMARY, UPDATE_SERVER_SETTINGS.
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
import { aggregatePermissions, getUserPermissions, isAdmin } from "../services/permissions.service.js";
import { buildServerSummary } from "../services/server-summary.js";
import { iconToRelease, parseIconChange } from "../services/server-icon.js";
import { UploadClaimError, claimUploads, releaseStoredFile } from "../services/stored-file.service.js";
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
                        iconUrl: true,
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
                    iconUrl: server?.iconUrl ?? null, // PRD 19 A2: for everyone
                    ...adminOnly,
                });
            } catch (err) {
                app.log.error({ err }, "Error in GET_SERVER_SETTINGS");
                ack({ success: false });
            }
        });

        // ── GET_SERVER_SUMMARY (PRD 19 A1) ──────────────────────────────────
        // Member-visible facts for About and the header. Open to restricted
        // users too (EVENT_ACCESS "open"); the packet guard already refused
        // sockets that haven't signed in. Only counts, admins' public profile
        // fields and the feature switches — nothing admin-only.
        socket.on("GET_SERVER_SUMMARY", async (ack) => {
            try {
                const { serverId } = socket.data;
                if (!serverId) {
                    ack({ success: false, error: "Not signed in" });
                    return;
                }
                const [server, users, banned, onlineIds] = await Promise.all([
                    app.prisma.server.findUnique({
                        where: { id: serverId },
                        select: { name: true, nudgeEnabled: true, screenShareEnabled: true, iconUrl: true },
                    }),
                    app.prisma.user.findMany({
                        where: { servers: { some: { serverId } } },
                        select: {
                            id: true,
                            nickname: true,
                            avatarUrl: true,
                            roles: {
                                select: {
                                    role: { select: { serverId: true, permissions: true } },
                                },
                            },
                        },
                    }),
                    app.prisma.bannedUser.findMany({
                        where: { serverId },
                        select: { userId: true },
                    }),
                    presence.getOnlineUsers(serverId),
                ]);
                if (!server) {
                    ack({ success: false, error: "Failed to load the server summary" });
                    return;
                }

                ack({
                    success: true,
                    summary: buildServerSummary({
                        name: server.name,
                        members: users.map((u) => ({
                            id: u.id,
                            nickname: u.nickname,
                            avatarUrl: u.avatarUrl,
                            perms: aggregatePermissions(
                                u.roles.map((r) => r.role),
                                serverId,
                            ),
                        })),
                        bannedIds: new Set(banned.map((b) => b.userId)),
                        onlineIds: new Set(onlineIds),
                        iconUrl: server.iconUrl ?? null,
                        // The values in effect — environment overrides included.
                        features: {
                            nudge: server.nudgeEnabled,
                            screenShare: server.screenShareEnabled,
                            requireApproval: requireApproval(),
                            requireInvite: requireInvite(),
                            requireSignedIdentity: isSignedIdentityRequired(),
                        },
                    }),
                });
            } catch (err) {
                app.log.error({ err }, "Error in GET_SERVER_SUMMARY");
                ack({ success: false, error: "Failed to load the server summary" });
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
                    iconUploadId: iconUploadIdInput,
                } = payload;
                const data: {
                    nudgeEnabled?: boolean;
                    screenShareEnabled?: boolean;
                    maxMessageLength?: number;
                    requireSignedIdentity?: boolean;
                    authAllowedHosts?: string[];
                    requireApproval?: boolean;
                    requireInvite?: boolean;
                    iconUrl?: string | null;
                    iconPublicId?: string | null;
                } = {};
                // PRD 19 A2: the icon is only ever the id of an upload in the
                // ledger; its url/public_id are filled in from the claimed row.
                const iconChange = parseIconChange(iconUploadIdInput);
                if ("error" in iconChange) {
                    ack({ success: false, error: iconChange.error });
                    return;
                }
                if (iconChange.kind === "remove") {
                    data.iconUrl = null;
                    data.iconPublicId = null;
                }
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

                // Claim the icon (if one is being set) and update the row in ONE
                // transaction, so a failed claim changes nothing. The previous
                // icon is read first so it can be released after the commit.
                let previousIconUrl: string | null = null;
                if (iconChange.kind !== "unchanged") {
                    const current = await app.prisma.server.findUnique({
                        where: { id: socket.data.serverId },
                        select: { iconUrl: true },
                    });
                    previousIconUrl = current?.iconUrl ?? null;
                }
                const updated = await app.prisma.$transaction(async (tx) => {
                    if (iconChange.kind === "set") {
                        const [file] = await claimUploads(tx, {
                            ids: [iconChange.uploadId],
                            kind: "SERVER_ICON",
                            userId: socket.data.userId,
                        });
                        data.iconUrl = file.url;
                        data.iconPublicId = file.publicId;
                    }
                    return tx.server.update({
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
                            iconUrl: true,
                        },
                    });
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
                    // The join gates in effect (env overrides included), so About
                    // updates live (PRD 19 A1). Read after the setters above.
                    requireApproval: requireApproval(),
                    requireInvite: requireInvite(),
                    requireSignedIdentity: isSignedIdentityRequired(),
                    iconUrl: updated.iconUrl ?? null,
                });

                // Release the replaced/removed icon only now that the new row
                // is committed (a failed update must not lose the old one).
                const toRelease = iconToRelease(previousIconUrl, updated.iconUrl ?? null);
                if (toRelease) await releaseStoredFile(app.prisma, toRelease).catch(() => {});

                app.log.info(
                    { socketId: socket.id, ...data },
                    "Server settings updated",
                );
            } catch (err) {
                if (err instanceof UploadClaimError) {
                    ack({ success: false, error: err.message });
                    return;
                }
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
