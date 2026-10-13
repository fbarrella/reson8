import { describe, expect, it } from "vitest";
import { requiresSignIn } from "../services/packet-guard.js";
import { restoreJoinState, snapshotJoinState } from "../services/join-state.js";

describe("join state rollback", () => {
    it("a socket that never signed in is default-deny again after a failed join", () => {
        const data: Record<string, unknown> = {};
        const snap = snapshotJoinState(data);
        // The join got as far as setting these…
        data.serverId = "s1";
        data.nickname = "Mallory";
        data.userId = "u1";
        data.currentChannelId = null;
        data.hasAccess = true;
        // …then a database call threw.
        restoreJoinState(data, snap);
        expect(data.userId).toBeUndefined();
        expect(data.serverId).toBeUndefined();
        expect("hasAccess" in data).toBe(false);
        // The packet gate's own condition (userId && serverId) is false again.
        expect(!!(data.userId && data.serverId)).toBe(false);
        expect(requiresSignIn("GET_SERVER_SUMMARY")).toBe(true);
    });

    it("a failed re-join leaves an already signed-in socket exactly as it was", () => {
        const data: Record<string, unknown> = {
            userId: "u1",
            serverId: "s1",
            nickname: "Alice",
            currentChannelId: "c1",
            hasAccess: true,
        };
        const snap = snapshotJoinState(data);
        data.userId = "u2";
        data.nickname = "Bob";
        data.currentChannelId = null;
        data.hasAccess = false;
        restoreJoinState(data, snap);
        expect(data).toEqual({ userId: "u1", serverId: "s1", nickname: "Alice", currentChannelId: "c1", hasAccess: true });
    });

    it("does not touch fields a join does not own", () => {
        const data: Record<string, unknown> = { role: "primary", authHost: "h" };
        const snap = snapshotJoinState(data);
        data.userId = "u1";
        restoreJoinState(data, snap);
        expect(data).toEqual({ role: "primary", authHost: "h" });
    });
});
