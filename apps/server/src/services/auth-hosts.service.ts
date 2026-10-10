/**
 * Challenge-relay protection, managed from Settings (PRD 18.5).
 *
 * The signed identity proof includes the host the client connected to. A
 * server that lists its own names (`authAllowedHosts`) refuses a proof made
 * for any other host — which is what stops a malicious server from relaying
 * THIS server's challenge to its own visitors. The list used to be an
 * environment variable only; an admin had no way to learn which names people
 * actually type, so it stayed off. This module supplies:
 *   - validation of what an admin types,
 *   - the names actually seen in accepted signed joins (suggestions),
 *   - a guard so an admin can't save a list that locks themselves out.
 *
 * The pure parts are unit-tested; the Redis part is a thin wrapper.
 */

import type { Redis } from "ioredis";
import type { IObservedAuthHost } from "@reson8/shared-types";

export const MAX_ALLOWED_HOSTS = 50;
export const MAX_OBSERVED_HOSTS = 50;
/** Distinct hosts remembered per server — bounds what a client can make us store. */
const MAX_TRACKED_HOSTS = 200;
const OBSERVED_TTL_SEC = 90 * 24 * 60 * 60;

/** What a host entry may look like: host or host:port, IPv6 bracketed. Lower-case. */
const HOST_ENTRY = /^[a-z0-9._\-[\]:]{1,255}$/;

/** The canonical form compared against proofs (the join path lower-cases the same way). */
export function normalizeAuthHost(host: string): string {
    return host.trim().toLowerCase();
}

export function parseAllowedHostsInput(
    input: unknown,
): { ok: true; hosts: string[] } | { ok: false; error: string } {
    if (!Array.isArray(input)) return { ok: false, error: "Invalid list of names" };
    if (input.length > MAX_ALLOWED_HOSTS) {
        return { ok: false, error: `At most ${MAX_ALLOWED_HOSTS} names can be listed` };
    }
    const hosts: string[] = [];
    for (const raw of input) {
        if (typeof raw !== "string") return { ok: false, error: "Invalid list of names" };
        const host = normalizeAuthHost(raw);
        if (!HOST_ENTRY.test(host)) {
            return { ok: false, error: `"${raw.slice(0, 60)}" isn't a valid name — use host or host:port` };
        }
        if (!hosts.includes(host)) hosts.push(host);
    }
    return { ok: true, hosts };
}

/**
 * The lock-out guard. A non-empty list must contain the name the admin's own
 * session was signed for, otherwise their next reconnect would be refused
 * and they could not undo it from the UI. An empty list (turning the check
 * off) is always fine, and so is an admin who connected without a signed
 * proof — unsigned joins aren't subject to the host check at all.
 */
export function checkAllowedHostsUpdate(
    list: readonly string[],
    currentAuthHost: string | undefined,
): { ok: true } | { ok: false; error: string } {
    if (list.length === 0 || currentAuthHost === undefined) return { ok: true };
    if (list.includes(normalizeAuthHost(currentAuthHost))) return { ok: true };
    return {
        ok: false,
        error:
            `You're connected as "${currentAuthHost}", which isn't in the list — saving it would lock you out. ` +
            "Add that name first.",
    };
}

// ── Observed names (Redis) ──────────────────────────────────────────────────

const countsKey = (serverId: string): string => `auth:observed-hosts:${serverId}`;
const lastKey = (serverId: string): string => `auth:observed-hosts-last:${serverId}`;

/** Remembers a host seen in an ACCEPTED signed join. Never throws. */
export async function observeAuthHost(redis: Redis, serverId: string, host: string): Promise<void> {
    try {
        const h = normalizeAuthHost(host);
        if (!h) return;
        const known = await redis.hexists(countsKey(serverId), h);
        if (!known && (await redis.hlen(countsKey(serverId))) >= MAX_TRACKED_HOSTS) return;
        await redis
            .multi()
            .hincrby(countsKey(serverId), h, 1)
            .hset(lastKey(serverId), h, new Date().toISOString())
            .expire(countsKey(serverId), OBSERVED_TTL_SEC)
            .expire(lastKey(serverId), OBSERVED_TTL_SEC)
            .exec();
    } catch {
        // Suggestions are a convenience; never let them affect a join.
    }
}

/** The most used names first. */
export async function listObservedAuthHosts(redis: Redis, serverId: string): Promise<IObservedAuthHost[]> {
    const [counts, lasts] = await Promise.all([
        redis.hgetall(countsKey(serverId)),
        redis.hgetall(lastKey(serverId)),
    ]);
    return Object.entries(counts)
        .map(([host, n]) => ({ host, joins: Number(n) || 0, lastSeen: lasts[host] ?? null }))
        .sort((a, b) => b.joins - a.joins || a.host.localeCompare(b.host))
        .slice(0, MAX_OBSERVED_HOSTS);
}
