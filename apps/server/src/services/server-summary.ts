/**
 * The member-visible server summary (PRD 19 A1) — pure, so the counting rules
 * are unit-tested. The handler loads the rows; this decides who counts.
 *
 * Counts are per userId, and a userId is one install (see "Identity" in the
 * root AGENTS.md), so one person on two PCs is two users — the server cannot
 * tell them apart.
 */

import type { IServerSummary } from "@reson8/shared-types";
import { PermissionFlags } from "@reson8/shared-types";
import { hasServerAccess } from "./access.service.js";

export interface SummaryMemberRow {
    id: string;
    nickname: string;
    avatarUrl: string | null;
    /** Aggregated permissions for THIS server only (see aggregatePermissions()). */
    perms: bigint;
}

export interface ServerSummaryInput {
    name: string;
    members: SummaryMemberRow[];
    bannedIds: ReadonlySet<string>;
    onlineIds: ReadonlySet<string>;
    features: IServerSummary["features"];
    iconUrl?: string | null;
}

export function buildServerSummary(input: ServerSummaryInput): IServerSummary {
    // A member counts only with access and only when not banned. A restricted
    // user (Member role removed) is neither counted nor listed as online.
    const counted = input.members.filter(
        (m) => hasServerAccess(m.perms) && !input.bannedIds.has(m.id),
    );

    const adminBit = BigInt(PermissionFlags.ADMIN);
    const admins = counted
        .filter((m) => (m.perms & adminBit) === adminBit)
        .map((m) => ({
            userId: m.id,
            nickname: m.nickname,
            isOnline: input.onlineIds.has(m.id),
            avatarUrl: m.avatarUrl,
        }))
        .sort(
            (a, b) =>
                a.nickname.toLowerCase().localeCompare(b.nickname.toLowerCase()) ||
                a.userId.localeCompare(b.userId),
        );

    // online ∩ counted members — an online id that isn't a counted member is ignored.
    const onlineCount = counted.filter((m) => input.onlineIds.has(m.id)).length;

    const summary: IServerSummary = {
        name: input.name,
        memberCount: counted.length,
        onlineCount,
        admins,
        features: input.features,
    };
    if (input.iconUrl !== undefined) summary.iconUrl = input.iconUrl;
    return summary;
}
