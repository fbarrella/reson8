/**
 * Invite codes — the moderator side (PRD 18.9): create, list, revoke.
 * The join-time check lives in connection.handler.ts, next to the identity
 * decision it depends on.
 *
 * Who may manage invites: holders of BAN_USER (the people who already run
 * User Management) and ADMINs (hasPermission's ADMIN bypass). Turning the
 * requirement on or off is ADMIN-only (UPDATE_SERVER_SETTINGS).
 *
 * The plain code is returned ONCE, by CREATE_INVITE; only its hash and a
 * four-character prefix are stored, and neither GET_INVITES nor any log line
 * ever carries it.
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
    IInvite,
} from "@reson8/shared-types";
import { PermissionFlags } from "@reson8/shared-types";
import { requirePermission } from "../middleware/permissions.middleware.js";
import {
    formatInviteCode,
    generateInviteCode,
    hashInviteCode,
    inviteStatus,
    parseCreateInvite,
} from "../services/invite.service.js";

type TypedIO = SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const BAN_USER = BigInt(PermissionFlags.BAN_USER);

/** A server never needs more live rows than this; a runaway script is stopped here. */
const MAX_INVITES_PER_SERVER = 500;
const LIST_LIMIT = 200;
const USES_PER_INVITE_SHOWN = 50;

interface InviteRow {
    id: string;
    codePrefix: string;
    label: string | null;
    createdBy: string;
    createdAt: Date;
    expiresAt: Date | null;
    maxUses: number | null;
    uses: number;
    revokedAt: Date | null;
}

function toDto(
    row: InviteRow,
    names: Map<string, string>,
    usedBy: { userId: string; usedAt: Date }[],
    now: Date,
): IInvite {
    return {
        id: row.id,
        codePrefix: row.codePrefix,
        label: row.label,
        createdBy: row.createdBy,
        createdByNickname: names.get(row.createdBy) ?? null,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        maxUses: row.maxUses,
        uses: row.uses,
        status: inviteStatus(row, now),
        usedBy: usedBy.map((u) => ({
            userId: u.userId,
            nickname: names.get(u.userId) ?? null,
            usedAt: u.usedAt.toISOString(),
        })),
    };
}

export function registerInviteHandlers(io: TypedIO, app: FastifyInstance): void {
    io.on("connection", (socket: TypedSocket) => {
        // ── CREATE_INVITE ──────────────────────────────────────────────────
        socket.on("CREATE_INVITE", async (payload, ack) => {
            if (typeof ack !== "function") return;
            if (!(await requirePermission(app, socket, BAN_USER))) {
                ack({ success: false, error: "Permission denied" });
                return;
            }
            try {
                const parsed = parseCreateInvite(payload);
                if (!parsed.ok) {
                    ack({ success: false, error: parsed.error });
                    return;
                }
                const { label, expiresInHours, maxUses } = parsed.value;
                const serverId = socket.data.serverId;

                const existing = await app.prisma.invite.count({ where: { serverId } });
                if (existing >= MAX_INVITES_PER_SERVER) {
                    ack({ success: false, error: "There are too many invites — revoke some you no longer need" });
                    return;
                }

                const expiresAt = expiresInHours ? new Date(Date.now() + expiresInHours * 3_600_000) : null;
                let created: InviteRow | null = null;
                let code = "";
                // A collision on a 60-bit code is not going to happen; retry anyway
                // rather than surface a unique-constraint error.
                for (let attempt = 0; attempt < 3 && !created; attempt++) {
                    code = generateInviteCode();
                    try {
                        created = await app.prisma.invite.create({
                            data: {
                                serverId,
                                codeHash: hashInviteCode(code),
                                codePrefix: code.slice(0, 4),
                                label,
                                createdBy: socket.data.userId,
                                expiresAt,
                                maxUses,
                            },
                        });
                    } catch (err) {
                        if ((err as { code?: string }).code !== "P2002") throw err;
                    }
                }
                if (!created) {
                    ack({ success: false, error: "Couldn't create an invite — try again" });
                    return;
                }

                const names = new Map([[socket.data.userId, socket.data.nickname ?? ""]]);
                ack({
                    success: true,
                    code: formatInviteCode(code),
                    invite: toDto(created, names, [], new Date()),
                });
                // The id and prefix only — never the code.
                app.log.info(
                    { adminId: socket.data.userId, inviteId: created.id, prefix: created.codePrefix, maxUses, expiresInHours },
                    "Invite created",
                );
            } catch (err) {
                app.log.error({ err }, "Error in CREATE_INVITE");
                ack({ success: false, error: "Failed to create the invite" });
            }
        });

        // ── GET_INVITES ────────────────────────────────────────────────────
        socket.on("GET_INVITES", async (ack) => {
            if (typeof ack !== "function") return;
            if (!(await requirePermission(app, socket, BAN_USER))) {
                ack({ success: false, error: "Permission denied" });
                return;
            }
            try {
                const serverId = socket.data.serverId;
                const rows = await app.prisma.invite.findMany({
                    where: { serverId },
                    orderBy: { createdAt: "desc" },
                    take: LIST_LIMIT,
                });
                const uses = rows.length
                    ? await app.prisma.inviteUse.findMany({
                          where: { inviteId: { in: rows.map((r) => r.id) } },
                          orderBy: { usedAt: "desc" },
                      })
                    : [];
                const userIds = [...new Set([...rows.map((r) => r.createdBy), ...uses.map((u) => u.userId)])];
                const users = userIds.length
                    ? await app.prisma.user.findMany({
                          where: { id: { in: userIds } },
                          select: { id: true, nickname: true },
                      })
                    : [];
                const names = new Map(users.map((u) => [u.id, u.nickname]));
                const byInvite = new Map<string, { userId: string; usedAt: Date }[]>();
                for (const u of uses) {
                    const list = byInvite.get(u.inviteId) ?? [];
                    if (list.length < USES_PER_INVITE_SHOWN) list.push({ userId: u.userId, usedAt: u.usedAt });
                    byInvite.set(u.inviteId, list);
                }
                const now = new Date();
                ack({
                    success: true,
                    invites: rows.map((r) => toDto(r, names, byInvite.get(r.id) ?? [], now)),
                });
            } catch (err) {
                app.log.error({ err }, "Error in GET_INVITES");
                ack({ success: false, error: "Failed to load invites" });
            }
        });

        // ── REVOKE_INVITE ──────────────────────────────────────────────────
        socket.on("REVOKE_INVITE", async (payload, ack) => {
            if (typeof ack !== "function") return;
            if (!(await requirePermission(app, socket, BAN_USER))) {
                ack({ success: false, error: "Permission denied" });
                return;
            }
            try {
                const id = payload?.id;
                if (typeof id !== "string" || id.length === 0 || id.length > 128) {
                    ack({ success: false, error: "Invalid invite" });
                    return;
                }
                // Scoped by server, and only a not-yet-revoked row changes — so the
                // answer is honest and a second click is harmless.
                const result = await app.prisma.invite.updateMany({
                    where: { id, serverId: socket.data.serverId, revokedAt: null },
                    data: { revokedAt: new Date() },
                });
                if (result.count === 0) {
                    ack({ success: false, error: "That invite was already revoked, or doesn't exist" });
                    return;
                }
                ack({ success: true });
                app.log.info({ adminId: socket.data.userId, inviteId: id }, "Invite revoked");
            } catch (err) {
                app.log.error({ err }, "Error in REVOKE_INVITE");
                ack({ success: false, error: "Failed to revoke the invite" });
            }
        });
    });
}
