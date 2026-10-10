/**
 * Invite codes (PRD 18.9) — the rules, kept pure so they are tested directly;
 * the I/O (database claim, Redis throttle) sits next to the join path and in
 * invite.handler.ts.
 *
 * A code is 12 characters of Crockford Base32 (no I, L, O, U — nothing that
 * reads as another character), ~60 bits from `crypto.randomInt`. It is shown
 * once, at creation; only its SHA-256 and a four-character prefix are stored,
 * exactly like upload tokens.
 */

import { createHash, randomInt } from "node:crypto";

export const INVITE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const INVITE_CODE_LENGTH = 12;

/** How long an address is blocked after too many wrong codes, and how many it gets. */
export const INVITE_FAIL_LIMIT = 10;
export const INVITE_FAIL_WINDOW_SECONDS = 15 * 60;

export const INVITE_MESSAGES = {
    required: "This server needs an invite code for new users.",
    invalid: "That invite code isn't valid.",
    throttled: "Too many attempts — try again in 15 minutes.",
    staleOnApproval: "The invite used for this request is no longer valid.",
} as const;

/** The expiry choices the UI offers (hours); `null` = never. */
export const INVITE_EXPIRY_HOURS = [1, 24, 168, 720] as const;
export const INVITE_MAX_USES = 1000;
export const INVITE_LABEL_MAX = 64;

export function generateInviteCode(): string {
    let out = "";
    for (let i = 0; i < INVITE_CODE_LENGTH; i++) out += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)];
    return out;
}

/**
 * The canonical form of whatever a person typed, or null when it can't be a
 * code. Upper-cases, drops spaces/dashes, and applies Crockford's decoding
 * rules (O→0, I and L→1) so a misread character still works.
 */
export function normalizeInviteCode(input: unknown): string | null {
    if (typeof input !== "string" || input.length > 64) return null;
    const cleaned = input
        .toUpperCase()
        .replace(/[\s-]/g, "")
        .replace(/O/g, "0")
        .replace(/[IL]/g, "1");
    if (cleaned.length !== INVITE_CODE_LENGTH) return null;
    for (const ch of cleaned) if (!INVITE_ALPHABET.includes(ch)) return null;
    return cleaned;
}

/** `XXXX-XXXX-XXXX`, for display and copying. */
export function formatInviteCode(code: string): string {
    return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

/** SHA-256 hex of the NORMALIZED code (so every accepted spelling hashes alike). */
export function hashInviteCode(code: string): string {
    return createHash("sha256").update(code, "utf8").digest("hex");
}

export type InviteStatus = "active" | "expired" | "used-up" | "revoked";

export function inviteStatus(
    inv: { revokedAt: Date | null; expiresAt: Date | null; maxUses: number | null; uses: number },
    now: Date,
): InviteStatus {
    if (inv.revokedAt) return "revoked";
    if (inv.expiresAt && inv.expiresAt.getTime() <= now.getTime()) return "expired";
    if (inv.maxUses !== null && inv.uses >= inv.maxUses) return "used-up";
    return "active";
}

/** Whether an address that has already failed `failures` times may try again. */
export function isInviteThrottled(failures: number): boolean {
    return failures >= INVITE_FAIL_LIMIT;
}

export interface CreateInviteInput {
    label: string | null;
    expiresInHours: number | null;
    maxUses: number | null;
}

/** Validates a CREATE_INVITE payload (untrusted). */
export function parseCreateInvite(payload: unknown): { ok: true; value: CreateInviteInput } | { ok: false; error: string } {
    const p = (payload ?? {}) as Record<string, unknown>;
    let label: string | null = null;
    if (p.label !== undefined && p.label !== null) {
        if (typeof p.label !== "string") return { ok: false, error: "Invalid label" };
        const trimmed = p.label.trim();
        if (trimmed.length > INVITE_LABEL_MAX) return { ok: false, error: `Use at most ${INVITE_LABEL_MAX} characters for the label` };
        label = trimmed.length > 0 ? trimmed : null;
    }
    let expiresInHours: number | null = null;
    if (p.expiresInHours !== undefined && p.expiresInHours !== null) {
        if (typeof p.expiresInHours !== "number" || !(INVITE_EXPIRY_HOURS as readonly number[]).includes(p.expiresInHours)) {
            return { ok: false, error: "Invalid expiry" };
        }
        expiresInHours = p.expiresInHours;
    }
    let maxUses: number | null = null;
    if (p.maxUses !== undefined && p.maxUses !== null) {
        if (typeof p.maxUses !== "number" || !Number.isInteger(p.maxUses) || p.maxUses < 1 || p.maxUses > INVITE_MAX_USES) {
            return { ok: false, error: `Max uses must be a whole number from 1 to ${INVITE_MAX_USES}` };
        }
        maxUses = p.maxUses;
    }
    return { ok: true, value: { label, expiresInHours, maxUses } };
}

/** Narrow database surface the claim needs (a PrismaClient or a transaction). */
export interface InviteDb {
    $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

/**
 * Looks an invite up WITHOUT consuming it. Expiry is judged by the database
 * clock, so a skewed server clock can't extend a code's life.
 */
export async function findUsableInviteId(db: InviteDb, serverId: string, codeHash: string): Promise<string | null> {
    const rows = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM invites
        WHERE "codeHash" = ${codeHash} AND "serverId" = ${serverId}
          AND "revokedAt" IS NULL
          AND ("expiresAt" IS NULL OR "expiresAt" > now())
          AND ("maxUses" IS NULL OR uses < "maxUses")`;
    return rows[0]?.id ?? null;
}

/**
 * Consumes one use, atomically: the row only updates while the invite is
 * still usable, so two joins racing for the last use cannot both win.
 * Run it on the SAME transaction that creates the user, so a failed join
 * never costs a use.
 */
export async function claimInviteUse(db: InviteDb, serverId: string, inviteId: string): Promise<boolean> {
    const rows = await db.$queryRaw<{ id: string }[]>`
        UPDATE invites SET uses = uses + 1
        WHERE id = ${inviteId} AND "serverId" = ${serverId}
          AND "revokedAt" IS NULL
          AND ("expiresAt" IS NULL OR "expiresAt" > now())
          AND ("maxUses" IS NULL OR uses < "maxUses")
        RETURNING id`;
    return rows.length === 1;
}
