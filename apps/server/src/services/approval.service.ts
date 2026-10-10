/**
 * "Approve new users" (PRD 18.8) — the rules, kept pure so they are tested
 * as a table; the I/O lives in approval.handler.ts and the join path.
 *
 * The design in one paragraph: a pending person is NOT a half-joined user.
 * Their join is answered `pending` AFTER every other check passed, a
 * `pending_approvals` row remembers who they are (and the key they proved),
 * and nothing is written to users/presence/roles. Their socket stays
 * connected with `socket.data.pendingUserId` set and `userId`/`serverId`
 * deliberately unset — every other handler is gated on those, so it can do
 * nothing. Approval creates the user with the requested key already bound;
 * the client then simply joins again.
 */

import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { IPendingApproval } from "@reson8/shared-types";
import { maskAddress } from "./address-ban.service.js";

export const MAX_PENDING_PER_SERVER = 50;
export const MAX_PENDING_PER_ADDRESS = 3;
export const PENDING_STALE_DAYS = 7;

export const APPROVAL_MESSAGES = {
    unsigned: "This server approves new users — update Reson8 to request access.",
    closed: "The server isn't accepting new users right now.",
} as const;

export const pendingRoom = (userId: string): string => `pending:${userId}`;
export const moderatorsRoom = (serverId: string): string => `moderators:${serverId}`;

export interface ApprovalGateInput {
    requireApproval: boolean;
    /** No `users` row exists for this id yet. */
    isNewUser: boolean;
    /** The identity check accepted this join AS the designated admin (so a new server can't be bricked). */
    isDesignatedAdmin: boolean;
    /** The join carried a verified signature (approval has to bind a key). */
    hasSignedProof: boolean;
    /** A request for this id already exists (a reconnect or a refresh). */
    alreadyPending: boolean;
    pendingTotal: number;
    /** Pending requests from this address, NOT counting this id's own. */
    pendingFromAddress: number;
}

export type ApprovalGateDecision =
    | { action: "proceed" }
    | { action: "queue" }
    | { action: "refuse"; reason: keyof typeof APPROVAL_MESSAGES };

export function decideApprovalGate(i: ApprovalGateInput): ApprovalGateDecision {
    if (!i.requireApproval || !i.isNewUser || i.isDesignatedAdmin) return { action: "proceed" };
    // Approving binds the key from the request, so a request without a proof
    // would approve nobody in particular.
    if (!i.hasSignedProof) return { action: "refuse", reason: "unsigned" };
    // A person already in the queue just keeps their place (their limits were
    // checked when they got in).
    if (i.alreadyPending) return { action: "queue" };
    if (i.pendingTotal >= MAX_PENDING_PER_SERVER) return { action: "refuse", reason: "closed" };
    if (i.pendingFromAddress >= MAX_PENDING_PER_ADDRESS) return { action: "refuse", reason: "closed" };
    return { action: "queue" };
}

interface PendingRow {
    userId: string;
    nickname: string;
    fingerprint: string;
    address: string | null;
    host: string | null;
    requestedAt: Date;
    lastSeenAt: Date;
}

/** The wire form of a request. Addresses are masked for anyone but an ADMIN. */
export function toPendingDto(row: PendingRow, opts: { online: boolean; fullAddress: boolean }): IPendingApproval {
    return {
        userId: row.userId,
        nickname: row.nickname,
        fingerprint: row.fingerprint,
        address: row.address ? (opts.fullAddress ? row.address : maskAddress(row.address)) : null,
        host: row.host,
        requestedAt: row.requestedAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        online: opts.online,
    };
}

/** Deletes requests nobody has come back for. Returns how many were removed. */
export async function pruneStalePending(prisma: PrismaClient, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - PENDING_STALE_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await prisma.pendingApproval.deleteMany({ where: { lastSeenAt: { lt: cutoff } } });
    return count;
}

/** Hourly (first run 15 minutes after boot); never keeps the process alive. */
export function startApprovalPruner(app: FastifyInstance): void {
    let running = false;
    const run = async (): Promise<void> => {
        if (running) return;
        running = true;
        try {
            const removed = await pruneStalePending(app.prisma);
            if (removed > 0) app.log.info({ removed }, "Pruned stale approval requests");
        } catch (err) {
            app.log.error({ err }, "Approval request prune failed");
        } finally {
            running = false;
        }
    };
    const first = setTimeout(run, 15 * 60 * 1000);
    const timer = setInterval(run, 60 * 60 * 1000);
    first.unref();
    timer.unref();
    app.addHook("onClose", async () => {
        clearTimeout(first);
        clearInterval(timer);
    });
}
