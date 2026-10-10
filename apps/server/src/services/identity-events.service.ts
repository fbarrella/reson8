/**
 * The identity log (PRD 18.4): who bound a key, when, from where, and which
 * joins were refused for identity reasons — so an admin can notice a
 * suspicious bind of a privileged user (the trust-on-first-use window).
 *
 * Two rules shape everything here:
 *   1. Recording must NEVER change a join's outcome or add latency. Callers
 *      `void recordIdentityEvent(...)`; it swallows its own errors.
 *   2. A client that reconnects in a loop must not fill the table, so
 *      refusals are de-duplicated and capped per address.
 *
 * The pure parts (dedupe key, query validation, row mapping) are unit-tested.
 */

import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { IIdentityEvent } from "@reson8/shared-types";
import { PermissionFlags } from "@reson8/shared-types";

export type IdentityEventKind = "BOUND" | "RESET" | "REFUSED";

export interface IdentityEventInput {
    serverId: string;
    userId: string;
    nickname: string;
    kind: IdentityEventKind;
    reason?: string | null;
    fingerprint?: string | null;
    address?: string | null;
    host?: string | null;
    actorId?: string | null;
}

export const IDENTITY_EVENT_RETENTION_DAYS = 90;
/** The same refusal (user, reason, key, address) is written at most once per this long. */
export const REFUSAL_DEDUPE_SECONDS = 10 * 60;
/** Refusals written per address per hour, whatever the user id — bounds a flood of bogus ids. */
export const REFUSALS_PER_ADDRESS_PER_HOUR = 10;

const PAGE_DEFAULT = 50;
const PAGE_MAX = 100;
/** Stored text is bounded; a client controls its nickname and the host it claims. */
const FIELD_MAX = 255;

/** Redis key for "this exact refusal was recorded recently". Pure. */
export function refusalDedupeKey(e: {
    serverId: string;
    userId: string;
    reason?: string | null;
    fingerprint?: string | null;
    address?: string | null;
}): string {
    const digest = createHash("sha256")
        .update(JSON.stringify([e.serverId, e.userId, e.reason ?? "", e.fingerprint ?? "", e.address ?? ""]))
        .digest("hex")
        .slice(0, 32);
    return `idev:refused:${digest}`;
}

function bounded(value: string | null | undefined): string | null {
    if (typeof value !== "string" || value.length === 0) return null;
    return value.length > FIELD_MAX ? value.slice(0, FIELD_MAX) : value;
}

/**
 * Writes one event. Never throws, never blocks the caller: call it as
 * `void recordIdentityEvent(app, …)`.
 */
export async function recordIdentityEvent(app: FastifyInstance, ev: IdentityEventInput): Promise<void> {
    try {
        if (ev.kind === "REFUSED") {
            const first = await app.redis.set(refusalDedupeKey(ev), "1", "EX", REFUSAL_DEDUPE_SECONDS, "NX");
            if (first !== "OK") return; // the same refusal was just recorded

            if (ev.address) {
                const counterKey = `idev:refused-addr:${ev.serverId}:${ev.address}`;
                const count = await app.redis.incr(counterKey);
                if (count === 1) await app.redis.expire(counterKey, 3600);
                if (count > REFUSALS_PER_ADDRESS_PER_HOUR) return; // flood: console log only
            }
        }
        await app.prisma.identityEvent.create({
            data: {
                serverId: ev.serverId,
                userId: String(ev.userId).slice(0, 128),
                nickname: bounded(ev.nickname) ?? "",
                kind: ev.kind,
                reason: bounded(ev.reason),
                fingerprint: bounded(ev.fingerprint),
                address: bounded(ev.address),
                host: bounded(ev.host),
                actorId: bounded(ev.actorId),
            },
        });
    } catch (err) {
        app.log.warn({ err, kind: ev.kind }, "Couldn't record an identity event");
    }
}

/** Deletes events past the retention window. Returns how many were removed. */
export async function pruneIdentityEvents(prisma: PrismaClient, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - IDENTITY_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await prisma.identityEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return count;
}

// ── Query validation (pure) ─────────────────────────────────────────────────

export interface IdentityEventsQuery {
    userId: string | undefined;
    before: Date | undefined;
    limit: number;
}

export function parseIdentityEventsQuery(
    payload: unknown,
): { ok: true; value: IdentityEventsQuery } | { ok: false; error: string } {
    const p = (payload ?? {}) as Record<string, unknown>;

    let limit = PAGE_DEFAULT;
    if (p.limit !== undefined) {
        if (typeof p.limit !== "number" || !Number.isInteger(p.limit) || p.limit < 1 || p.limit > PAGE_MAX) {
            return { ok: false, error: `limit must be a whole number between 1 and ${PAGE_MAX}` };
        }
        limit = p.limit;
    }

    let userId: string | undefined;
    if (p.userId !== undefined) {
        if (typeof p.userId !== "string" || p.userId.length === 0 || p.userId.length > 128) {
            return { ok: false, error: "Invalid user" };
        }
        userId = p.userId;
    }

    let before: Date | undefined;
    if (p.before !== undefined) {
        const t = typeof p.before === "string" ? Date.parse(p.before) : NaN;
        if (Number.isNaN(t)) return { ok: false, error: "Invalid cursor" };
        before = new Date(t);
    }
    return { ok: true, value: { userId, before, limit } };
}

// ── Page building ───────────────────────────────────────────────────────────

interface EventRow {
    id: string;
    userId: string;
    nickname: string;
    kind: "BOUND" | "RESET" | "REFUSED";
    reason: string | null;
    fingerprint: string | null;
    address: string | null;
    host: string | null;
    actorId: string | null;
    createdAt: Date;
}

/**
 * Turns the fetched rows (limit + 1 of them) into a page: trims the extra row
 * into `hasMore` and decorates each event with current nicknames and whether
 * the user is privileged. Pure — the lookups are passed in.
 */
export function buildEventsPage(
    rows: EventRow[],
    limit: number,
    lookups: { nicknames: Map<string, string>; privilegedIds: Set<string> },
): { events: IIdentityEvent[]; hasMore: boolean } {
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit).map((r): IIdentityEvent => {
        const current = lookups.nicknames.get(r.userId);
        const actor = r.actorId ? lookups.nicknames.get(r.actorId) : undefined;
        return {
            id: r.id,
            userId: r.userId,
            nickname: r.nickname,
            ...(current && current !== r.nickname ? { currentNickname: current } : {}),
            kind: r.kind,
            reason: r.reason,
            fingerprint: r.fingerprint,
            address: r.address,
            host: r.host,
            actorId: r.actorId,
            ...(r.actorId ? { actorNickname: actor ?? null } : {}),
            createdAt: r.createdAt.toISOString(),
            privileged: lookups.privilegedIds.has(r.userId),
        };
    });
    return { events, hasMore };
}

/** Reads one page from the database (two small lookup queries for the whole page). */
export async function fetchIdentityEventsPage(
    prisma: PrismaClient,
    serverId: string,
    query: IdentityEventsQuery,
): Promise<{ events: IIdentityEvent[]; hasMore: boolean }> {
    const rows = await prisma.identityEvent.findMany({
        where: {
            serverId,
            ...(query.userId ? { userId: query.userId } : {}),
            ...(query.before ? { createdAt: { lt: query.before } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: query.limit + 1,
    });

    const ids = new Set<string>();
    for (const r of rows.slice(0, query.limit)) {
        ids.add(r.userId);
        if (r.actorId) ids.add(r.actorId);
    }

    const [users, roleRows] = await Promise.all([
        prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, nickname: true } }),
        prisma.userRole.findMany({
            where: { userId: { in: [...ids] }, role: { serverId } },
            select: { userId: true, role: { select: { permissions: true } } },
        }),
    ]);

    const privilegeMask = BigInt(PermissionFlags.ADMIN) | BigInt(PermissionFlags.MANAGE_ROLES);
    const privilegedIds = new Set<string>();
    for (const r of roleRows) if ((r.role.permissions & privilegeMask) !== 0n) privilegedIds.add(r.userId);

    return buildEventsPage(rows, query.limit, {
        nicknames: new Map(users.map((u) => [u.id, u.nickname])),
        privilegedIds,
    });
}

// ── Readiness for "require signed identity" ─────────────────────────────────

/**
 * Users active in the last 30 days that still have no bound key — i.e. people
 * who haven't connected with 2.6.0+ yet, and who would be locked out the
 * moment unsigned joins are refused. `updatedAt` is bumped by every join.
 */
export async function countUnprotectedActiveUsers(prisma: PrismaClient, now = new Date()): Promise<number> {
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return prisma.user.count({ where: { publicKey: null, updatedAt: { gte: since } } });
}

// ── Retention ───────────────────────────────────────────────────────────────

/** Prunes the log hourly (first run 10 minutes after boot). Never keeps the process alive. */
export function startIdentityEventPruner(app: FastifyInstance): void {
    let running = false;
    const run = async (): Promise<void> => {
        if (running) return;
        running = true;
        try {
            const removed = await pruneIdentityEvents(app.prisma);
            if (removed > 0) app.log.info({ removed }, "Pruned old identity events");
        } catch (err) {
            app.log.error({ err }, "Identity event prune failed");
        } finally {
            running = false;
        }
    };
    const first = setTimeout(run, 10 * 60 * 1000);
    const timer = setInterval(run, 60 * 60 * 1000);
    first.unref();
    timer.unref();
    app.addHook("onClose", async () => {
        clearTimeout(first);
        clearInterval(timer);
    });
}
