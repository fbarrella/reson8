import { describe, expect, it } from "vitest";
import { PermissionFlags } from "@reson8/shared-types";
import { buildServerSummary, type SummaryMemberRow } from "../services/server-summary.js";
import { aggregatePermissions } from "../services/permissions.service.js";

const MEMBER = BigInt(PermissionFlags.CONNECT) | BigInt(PermissionFlags.SPEAK);
const ADMIN = BigInt(PermissionFlags.ADMIN);
const FEATURES = {
    nudge: true,
    screenShare: false,
    requireApproval: true,
    requireInvite: false,
    requireSignedIdentity: false,
};

const row = (id: string, nickname: string, perms: bigint): SummaryMemberRow => ({
    id,
    nickname,
    avatarUrl: null,
    perms,
});

const build = (
    members: SummaryMemberRow[],
    opts: { banned?: string[]; online?: string[] } = {},
) =>
    buildServerSummary({
        name: "Test",
        members,
        bannedIds: new Set(opts.banned ?? []),
        onlineIds: new Set(opts.online ?? []),
        features: FEATURES,
    });

describe("buildServerSummary", () => {
    it("counts members with access and passes name and features through", () => {
        const s = build([row("a", "Ann", MEMBER), row("b", "Bob", MEMBER)]);
        expect(s.name).toBe("Test");
        expect(s.memberCount).toBe(2);
        expect(s.features).toEqual(FEATURES);
        expect(s.iconUrl).toBeUndefined();
    });

    it("excludes a banned member from the total and from online", () => {
        const s = build([row("a", "Ann", MEMBER), row("b", "Bob", MEMBER)], {
            banned: ["b"],
            online: ["a", "b"],
        });
        expect(s.memberCount).toBe(1);
        expect(s.onlineCount).toBe(1);
    });

    it("excludes a restricted member (no CONNECT/ADMIN) from the total and from online", () => {
        const s = build([row("a", "Ann", MEMBER), row("r", "Rex", 0n)], { online: ["a", "r"] });
        expect(s.memberCount).toBe(1);
        expect(s.onlineCount).toBe(1);
    });

    it("lists an online admin and an offline admin, and not plain members", () => {
        const s = build([row("a", "Ann", ADMIN), row("b", "Bob", ADMIN), row("c", "Cy", MEMBER)], {
            online: ["a", "c"],
        });
        expect(s.admins).toEqual([
            { userId: "a", nickname: "Ann", isOnline: true, avatarUrl: null },
            { userId: "b", nickname: "Bob", isOnline: false, avatarUrl: null },
        ]);
    });

    it("ignores an online id that is not a member", () => {
        const s = build([row("a", "Ann", MEMBER)], { online: ["a", "ghost"] });
        expect(s.onlineCount).toBe(1);
    });

    it("sorts admins case-insensitively", () => {
        const s = build([row("1", "zed", ADMIN), row("2", "Bea", ADMIN), row("3", "amy", ADMIN)]);
        expect(s.admins.map((a) => a.nickname)).toEqual(["amy", "Bea", "zed"]);
    });

    it("carries an icon url when one is given, including null", () => {
        const s = buildServerSummary({
            name: "T",
            members: [],
            bannedIds: new Set(),
            onlineIds: new Set(),
            features: FEATURES,
            iconUrl: null,
        });
        expect(s.iconUrl).toBeNull();
    });

    it("counts nobody for an empty server", () => {
        const s = build([]);
        expect([s.memberCount, s.onlineCount, s.admins.length]).toEqual([0, 0, 0]);
    });
});

describe("aggregatePermissions", () => {
    it("ORs only the roles of the given server", () => {
        const roles = [
            { serverId: "s1", permissions: BigInt(PermissionFlags.CONNECT) },
            { serverId: "s1", permissions: BigInt(PermissionFlags.SPEAK) },
            { serverId: "s2", permissions: ADMIN },
        ];
        expect(aggregatePermissions(roles, "s1")).toBe(
            BigInt(PermissionFlags.CONNECT) | BigInt(PermissionFlags.SPEAK),
        );
        expect(aggregatePermissions(roles, "s2")).toBe(ADMIN);
        expect(aggregatePermissions(roles, "none")).toBe(0n);
    });
});
