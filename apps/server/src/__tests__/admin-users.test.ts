import { describe, expect, it } from "vitest";
import { adminUsersWhere, mapAdminUser, type AdminUserRow } from "../services/admin-users.js";

const role = {
    id: "role-default",
    serverId: "s1",
    name: "Member",
    permissions: 7n,
    powerLevel: 10,
    color: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
};

const base: AdminUserRow = {
    id: "u1",
    username: "u1",
    nickname: "Ann",
    createdAt: new Date("2026-02-02T00:00:00Z"),
    publicKey: null,
    roles: [],
};

describe("mapAdminUser", () => {
    it("keeps a user with no roles (roles: [])", () => {
        const m = mapAdminUser(base, new Set());
        expect(m.roles).toEqual([]);
        expect(m.id).toBe("u1");
    });

    it("maps roles, serializing the bigint permissions", () => {
        const m = mapAdminUser({ ...base, roles: [{ role }] }, new Set());
        expect(m.roles).toHaveLength(1);
        expect(m.roles[0].permissions).toBe("7");
        expect(m.roles[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
    });

    it("flags banned users, including a banned user with no roles", () => {
        expect(mapAdminUser(base, new Set(["u1"])).isBanned).toBe(true);
        expect(mapAdminUser(base, new Set(["other"])).isBanned).toBe(false);
    });

    it("serializes lastSeenAt, null when never recorded", () => {
        const at = new Date("2026-03-03T10:00:00Z");
        expect(mapAdminUser({ ...base, lastSeenAt: at }, new Set()).lastSeenAt).toBe("2026-03-03T10:00:00.000Z");
        expect(mapAdminUser(base, new Set()).lastSeenAt).toBeNull();
    });

    it("reports only WHETHER a key is bound, never the key", () => {
        const m = mapAdminUser({ ...base, publicKey: "SECRETKEYMATERIAL" }, new Set());
        expect(m.hasIdentityKey).toBe(true);
        expect(JSON.stringify(m)).not.toContain("SECRETKEYMATERIAL");
        expect(mapAdminUser(base, new Set()).hasIdentityKey).toBe(false);
    });
});

describe("adminUsersWhere", () => {
    it("matches a membership OR a role on the server", () => {
        const w = adminUsersWhere("s1");
        expect(w.OR).toHaveLength(2);
        expect(w.OR[0]).toEqual({ servers: { some: { serverId: "s1" } } });
        expect(w.OR[1]).toEqual({ roles: { some: { role: { serverId: "s1" } } } });
    });
});
