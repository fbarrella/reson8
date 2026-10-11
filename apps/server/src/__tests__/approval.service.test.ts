import { describe, expect, it } from "vitest";
import {
    MAX_PENDING_PER_ADDRESS,
    MAX_PENDING_PER_SERVER,
    PENDING_STALE_DAYS,
    decideApprovalGate,
    moderatorsRoom,
    pendingRoom,
    pruneStalePending,
    toPendingDto,
    type ApprovalGateInput,
} from "../services/approval.service.js";

const base: ApprovalGateInput = {
    requireApproval: true,
    isNewUser: true,
    isDesignatedAdmin: false,
    hasSignedProof: true,
    alreadyPending: false,
    pendingTotal: 0,
    pendingFromAddress: 0,
};
const gate = (over: Partial<ApprovalGateInput> = {}) => decideApprovalGate({ ...base, ...over });

describe("decideApprovalGate", () => {
    it("queues a brand-new signed identity when approval is required", () => {
        expect(gate()).toEqual({ action: "queue" });
    });

    it("does nothing when the switch is off", () => {
        expect(gate({ requireApproval: false })).toEqual({ action: "proceed" });
        // even for people who would otherwise be refused
        expect(gate({ requireApproval: false, hasSignedProof: false, pendingTotal: 999 })).toEqual({ action: "proceed" });
    });

    it("never affects someone who has joined before", () => {
        expect(gate({ isNewUser: false })).toEqual({ action: "proceed" });
        expect(gate({ isNewUser: false, hasSignedProof: false, pendingTotal: 999 })).toEqual({ action: "proceed" });
    });

    it("lets the designated admin straight in (a new server must not be bricked)", () => {
        expect(gate({ isDesignatedAdmin: true })).toEqual({ action: "proceed" });
        expect(gate({ isDesignatedAdmin: true, hasSignedProof: false })).toEqual({ action: "proceed" });
    });

    it("refuses a new identity that can't prove a key, with the update message", () => {
        expect(gate({ hasSignedProof: false })).toEqual({ action: "refuse", reason: "unsigned" });
    });

    it("lets a person already waiting keep their place even when the queue is full", () => {
        expect(gate({ alreadyPending: true, pendingTotal: MAX_PENDING_PER_SERVER })).toEqual({ action: "queue" });
        expect(gate({ alreadyPending: true, pendingFromAddress: MAX_PENDING_PER_ADDRESS })).toEqual({ action: "queue" });
    });

    it("closes the queue at the per-server limit", () => {
        expect(gate({ pendingTotal: MAX_PENDING_PER_SERVER - 1 })).toEqual({ action: "queue" });
        expect(gate({ pendingTotal: MAX_PENDING_PER_SERVER })).toEqual({ action: "refuse", reason: "closed" });
    });

    it("limits requests per address", () => {
        expect(gate({ pendingFromAddress: MAX_PENDING_PER_ADDRESS - 1 })).toEqual({ action: "queue" });
        expect(gate({ pendingFromAddress: MAX_PENDING_PER_ADDRESS })).toEqual({ action: "refuse", reason: "closed" });
    });

    it("checks the proof before the limits (an unsigned client is told to update, not 'closed')", () => {
        expect(gate({ hasSignedProof: false, pendingTotal: MAX_PENDING_PER_SERVER })).toEqual({
            action: "refuse",
            reason: "unsigned",
        });
    });
});

describe("rooms", () => {
    it("are namespaced so a user id can never collide with a server id", () => {
        expect(pendingRoom("abc")).toBe("pending:abc");
        expect(moderatorsRoom("srv")).toBe("moderators:srv");
        expect(pendingRoom("srv")).not.toBe(moderatorsRoom("srv"));
    });
});

describe("toPendingDto", () => {
    const row = {
        userId: "u1",
        nickname: "Newbie",
        fingerprint: "SHA256:abc",
        address: "203.0.113.7",
        host: "chat.example.com",
        requestedAt: new Date("2026-10-10T10:00:00.000Z"),
        lastSeenAt: new Date("2026-10-10T11:00:00.000Z"),
    };

    it("shows the full address to an ADMIN and a masked one to other moderators", () => {
        expect(toPendingDto(row, { online: true, fullAddress: true }).address).toBe("203.0.113.7");
        expect(toPendingDto(row, { online: true, fullAddress: false }).address).toBe("203.0.113.x");
    });

    it("keeps a missing address missing, and serializes times as ISO", () => {
        const dto = toPendingDto({ ...row, address: null }, { online: false, fullAddress: false });
        expect(dto.address).toBeNull();
        expect(dto.online).toBe(false);
        expect(dto.requestedAt).toBe("2026-10-10T10:00:00.000Z");
        expect(dto.lastSeenAt).toBe("2026-10-10T11:00:00.000Z");
    });
});

describe("pruneStalePending", () => {
    it("deletes requests not seen for the stale window", async () => {
        let cutoff: Date | undefined;
        const prisma = {
            pendingApproval: {
                async deleteMany(arg: { where: { lastSeenAt: { lt: Date } } }) {
                    cutoff = arg.where.lastSeenAt.lt;
                    return { count: 3 };
                },
            },
        };
        const now = new Date("2026-10-20T00:00:00.000Z");
        expect(await pruneStalePending(prisma as never, now)).toBe(3);
        expect((now.getTime() - cutoff!.getTime()) / 86_400_000).toBe(PENDING_STALE_DAYS);
    });
});
