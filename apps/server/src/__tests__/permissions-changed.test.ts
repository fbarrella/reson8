import { describe, expect, it } from "vitest";
import { PermissionFlags } from "@reson8/shared-types";
import { sendPermissionsChanged } from "../services/access-change.js";

interface FakeSocket {
    data: { userId: string; serverId: string; role?: "viewer" };
    emitted: { event: string; payload: unknown }[];
    emit: (event: string, payload: unknown) => void;
}

function fakeSocket(userId: string, serverId = "s1", role?: "viewer"): FakeSocket {
    const s: FakeSocket = {
        data: { userId, serverId, role },
        emitted: [],
        emit(event, payload) {
            s.emitted.push({ event, payload });
        },
    };
    return s;
}

function fakeIo(sockets: FakeSocket[]) {
    return { sockets: { sockets: new Map(sockets.map((s, i) => [String(i), s])) } } as never;
}

describe("sendPermissionsChanged", () => {
    const perms = BigInt(PermissionFlags.CONNECT) | BigInt(PermissionFlags.KICK_USER);

    it("tells every primary socket of the user, with the aggregate as a decimal string", () => {
        const a = fakeSocket("u1");
        const b = fakeSocket("u1");
        const told = sendPermissionsChanged(fakeIo([a, b]), "u1", "s1", perms);
        expect(told).toBe(2);
        expect(a.emitted).toEqual([{ event: "PERMISSIONS_CHANGED", payload: { permissions: "65" } }]);
        expect(b.emitted).toHaveLength(1);
    });

    it("skips viewer sockets, other users and other servers", () => {
        const viewer = fakeSocket("u1", "s1", "viewer");
        const other = fakeSocket("u2");
        const elsewhere = fakeSocket("u1", "s2");
        const mine = fakeSocket("u1");
        const told = sendPermissionsChanged(fakeIo([viewer, other, elsewhere, mine]), "u1", "s1", perms);
        expect(told).toBe(1);
        expect(viewer.emitted).toHaveLength(0);
        expect(other.emitted).toHaveLength(0);
        expect(elsewhere.emitted).toHaveLength(0);
        expect(mine.emitted).toHaveLength(1);
    });

    it("sends 0 as the string \"0\" when every role is gone", () => {
        const a = fakeSocket("u1");
        sendPermissionsChanged(fakeIo([a]), "u1", "s1", 0n);
        expect(a.emitted[0].payload).toEqual({ permissions: "0" });
    });

    it("does nothing for a user who is not connected", () => {
        expect(sendPermissionsChanged(fakeIo([]), "u1", "s1", perms)).toBe(0);
    });
});
