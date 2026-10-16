import { describe, it, expect } from "vitest";
import { buildOccupant } from "../handlers/connection.handler.js";

const base = { serverId: "s1", channelId: "c1", nickname: "Ana", isMuted: false, isDeafened: false, isSharingScreen: false, screenShareName: "" };
const prismaWith = (user: { nickname: string; avatarUrl: string | null } | null) =>
    ({ user: { findUnique: async () => user } }) as never;

describe("buildOccupant avatarUrl (PRD 21.9)", () => {
    it("carries the avatar kept in presence", async () => {
        const presence = { getUserPresence: async () => ({ ...base, avatarUrl: "https://seccdn.libravatar.org/avatar/abc" }) } as never;
        expect((await buildOccupant("u1", presence, prismaWith(null))).avatarUrl).toBe("https://seccdn.libravatar.org/avatar/abc");
    });

    it("keeps null (no avatar) as null", async () => {
        const presence = { getUserPresence: async () => ({ ...base, avatarUrl: null }) } as never;
        expect((await buildOccupant("u1", presence, prismaWith(null))).avatarUrl).toBeNull();
    });

    it("leaves the field absent for a presence written before avatars were kept there", async () => {
        const presence = { getUserPresence: async () => ({ ...base, avatarUrl: undefined }) } as never;
        const occ = await buildOccupant("u1", presence, prismaWith(null));
        expect("avatarUrl" in occ).toBe(false);
    });

    it("falls back to the database row when presence is gone", async () => {
        const presence = { getUserPresence: async () => null } as never;
        const occ = await buildOccupant("u1", presence, prismaWith({ nickname: "Ana", avatarUrl: "https://x/y" }));
        expect(occ.avatarUrl).toBe("https://x/y");
        expect(occ.nickname).toBe("Ana");
    });
});
