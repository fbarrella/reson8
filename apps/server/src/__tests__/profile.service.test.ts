import { describe, it, expect } from "vitest";
import { isPlausibleUserId, toUserProfile, type ProfileRow } from "../services/profile.service.js";

const role = (id: string, serverId: string, name: string, powerLevel: number, color: string | null = null) => ({
    role: { id, serverId, name, color, powerLevel },
});

const row: ProfileRow = {
    id: "user-1",
    nickname: "barrella",
    avatarUrl: "https://seccdn.libravatar.org/avatar/abc?d=wavatar",
    createdAt: new Date("2026-03-12T21:04:00.000Z"),
    roles: [
        role("role-default", "srv-1", "Member", 0),
        role("role-admin", "srv-1", "Server Admin", 100, "#ef5350"),
        role("role-other", "srv-2", "Elsewhere", 50),
        role("role-mod", "srv-1", "Moderator", 50),
        role("role-artist", "srv-1", "Artist", 50, "#ab47bc"),
    ],
};

describe("toUserProfile", () => {
    it("maps the user fields and first-login time", () => {
        const p = toUserProfile(row, "srv-1", true);
        expect(p.userId).toBe("user-1");
        expect(p.nickname).toBe("barrella");
        expect(p.avatarUrl).toBe(row.avatarUrl);
        expect(p.memberSince).toBe("2026-03-12T21:04:00.000Z");
        expect(p.isOnline).toBe(true);
    });

    it("keeps only this server's roles, highest powerLevel first, ties by name", () => {
        const p = toUserProfile(row, "srv-1", false);
        expect(p.roles.map((r) => r.name)).toEqual(["Server Admin", "Artist", "Moderator", "Member"]);
        expect(p.roles[0]).toEqual({ id: "role-admin", name: "Server Admin", color: "#ef5350", powerLevel: 100 });
    });

    it("never leaks the role's serverId", () => {
        const p = toUserProfile(row, "srv-1", false);
        expect(p.roles.every((r) => !("serverId" in r))).toBe(true);
    });

    it("handles a user with no roles and no avatar", () => {
        const p = toUserProfile({ ...row, avatarUrl: null, roles: [] }, "srv-1", false);
        expect(p.roles).toEqual([]);
        expect(p.avatarUrl).toBeNull();
    });
});

describe("isPlausibleUserId", () => {
    it("accepts non-empty strings up to 128 chars", () => {
        expect(isPlausibleUserId("3f2a8c1e-1234-4abc-9def-0123456789ab")).toBe(true);
        expect(isPlausibleUserId("x".repeat(128))).toBe(true);
    });
    it("refuses everything else", () => {
        expect(isPlausibleUserId("")).toBe(false);
        expect(isPlausibleUserId("x".repeat(129))).toBe(false);
        expect(isPlausibleUserId(42)).toBe(false);
        expect(isPlausibleUserId(undefined)).toBe(false);
        expect(isPlausibleUserId({ id: "a" })).toBe(false);
    });
});
