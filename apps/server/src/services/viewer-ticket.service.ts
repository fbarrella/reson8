/**
 * Viewer tickets (PRD 17.12) — how the screen-share Viewer window proves who
 * it belongs to without presenting a bare user id.
 *
 * The user's primary socket (already authenticated) asks for a ticket; the
 * Viewer window's own socket presents it in VIEWER_AUTHENTICATE, and the
 * server takes the user id FROM THE TICKET. Same pattern as upload tokens
 * (PRD 16.8): only a SHA-256 of the ticket is stored. A ticket survives the
 * viewer's own reconnects (its TTL is refreshed on each use) and is revoked
 * when the user's primary session ends or their identity key is reset.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Redis } from "ioredis";
import { VIEWER_TICKET_TTL_SEC } from "../config/identity.config.js";

const TICKET_PREFIX = "viewer-ticket:";
const USER_SET_PREFIX = "viewer-tickets:user:";

const hashTicket = (ticket: string): string => createHash("sha256").update(ticket).digest("hex");

export interface ViewerTicketOwner {
    userId: string;
    serverId: string;
}

export async function issueViewerTicket(redis: Redis, owner: ViewerTicketOwner): Promise<string> {
    const ticket = randomBytes(32).toString("base64url");
    const hash = hashTicket(ticket);
    await redis
        .multi()
        .set(TICKET_PREFIX + hash, JSON.stringify(owner), "EX", VIEWER_TICKET_TTL_SEC)
        .sadd(USER_SET_PREFIX + owner.userId, hash)
        .expire(USER_SET_PREFIX + owner.userId, VIEWER_TICKET_TTL_SEC)
        .exec();
    return ticket;
}

/** The ticket's owner (refreshing its TTL), or null when unknown, expired or malformed. */
export async function resolveViewerTicket(redis: Redis, ticket: unknown): Promise<ViewerTicketOwner | null> {
    if (typeof ticket !== "string" || ticket.length < 20 || ticket.length > 100) return null;
    const key = TICKET_PREFIX + hashTicket(ticket);
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
        const owner = JSON.parse(raw) as ViewerTicketOwner;
        if (typeof owner.userId !== "string" || typeof owner.serverId !== "string") return null;
        await redis.expire(key, VIEWER_TICKET_TTL_SEC);
        await redis.expire(USER_SET_PREFIX + owner.userId, VIEWER_TICKET_TTL_SEC);
        return owner;
    } catch {
        return null;
    }
}

/** Revokes every ticket of a user (session ended, or identity key reset). */
export async function revokeViewerTickets(redis: Redis, userId: string): Promise<void> {
    const setKey = USER_SET_PREFIX + userId;
    const hashes = await redis.smembers(setKey);
    const keys = hashes.map((h) => TICKET_PREFIX + h);
    await redis.del(setKey, ...keys);
}
