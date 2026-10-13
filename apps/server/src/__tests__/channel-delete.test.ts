import { describe, expect, it } from "vitest";
import { parseDeleteMode, planChannelDelete, type PlannerChannel } from "../services/channel-delete.js";

const ch = (id: string, parentId: string | null, position: number, type: "TEXT" | "VOICE" = "TEXT"): PlannerChannel => ({
    id,
    parentId,
    position,
    type,
});

describe("planChannelDelete", () => {
    // top level: A(0) Cat(1) B(5);  Cat holds t1(0 text), v1(1 voice), Sub(2) → t2(0 text)
    const channels = [
        ch("A", null, 0),
        ch("Cat", null, 1),
        ch("B", null, 5),
        ch("t1", "Cat", 0, "TEXT"),
        ch("v1", "Cat", 1, "VOICE"),
        ch("Sub", "Cat", 2, "TEXT"),
        ch("t2", "Sub", 0, "TEXT"),
    ];

    it("legacy: the target only, nothing re-parented by the planner", () => {
        const plan = planChannelDelete(channels, "Cat", "legacy");
        expect(plan).toEqual({ deleteIds: ["Cat"], reparent: [], voiceIds: [] });
    });

    it("keep: the target only; children appended after the top level in their old order", () => {
        const plan = planChannelDelete(channels, "Cat", "keep");
        expect(plan.deleteIds).toEqual(["Cat"]);
        // Top level without Cat holds positions [0, 5] → children get 6, 7, 8.
        expect(plan.reparent).toEqual([
            { id: "t1", position: 6 },
            { id: "v1", position: 7 },
            { id: "Sub", position: 8 },
        ]);
    });

    it("keep uses positions [0, 1, 5] of the whole top level when the target is nested", () => {
        // Deleting Sub (nested): its child t2 goes to the top level after [0, 1, 5].
        const plan = planChannelDelete(channels, "Sub", "keep");
        expect(plan.reparent).toEqual([{ id: "t2", position: 6 }]);
    });

    it("keep with an empty top level starts at 0", () => {
        const plan = planChannelDelete([ch("Only", null, 3), ch("c", "Only", 0)], "Only", "keep");
        expect(plan.reparent).toEqual([{ id: "c", position: 0 }]);
    });

    it("keep orders children by their current position, not by id or input order", () => {
        const plan = planChannelDelete(
            [ch("P", null, 0), ch("z", "P", 0), ch("a", "P", 2), ch("m", "P", 1)],
            "P",
            "keep",
        );
        expect(plan.reparent.map((r) => r.id)).toEqual(["z", "m", "a"]);
    });

    it("delete: the target and every descendant, breadth-first", () => {
        const plan = planChannelDelete(channels, "Cat", "delete");
        expect(plan.deleteIds).toEqual(["Cat", "t1", "v1", "Sub", "t2"]);
        expect(plan.reparent).toEqual([]);
    });

    it("voiceIds lists exactly the voice channels being deleted", () => {
        expect(planChannelDelete(channels, "Cat", "delete").voiceIds).toEqual(["v1"]);
        expect(planChannelDelete(channels, "v1", "legacy").voiceIds).toEqual(["v1"]);
        expect(planChannelDelete(channels, "Cat", "keep").voiceIds).toEqual([]);
    });

    it("a target with no children behaves the same in every mode", () => {
        for (const mode of ["legacy", "keep", "delete"] as const) {
            expect(planChannelDelete(channels, "A", mode)).toEqual({ deleteIds: ["A"], reparent: [], voiceIds: [] });
        }
    });

    it("terminates on a cycle", () => {
        const cyclic = [ch("x", "y", 0), ch("y", "x", 0)];
        const plan = planChannelDelete(cyclic, "x", "delete");
        expect(plan.deleteIds.sort()).toEqual(["x", "y"]);
    });
});

describe("parseDeleteMode", () => {
    it("maps the option", () => {
        expect(parseDeleteMode(undefined)).toBe("legacy");
        expect(parseDeleteMode("keep")).toBe("keep");
        expect(parseDeleteMode("delete")).toBe("delete");
    });
    it("refuses anything else", () => {
        for (const bad of [null, "", "legacy", "all", 1, true, {}]) expect(parseDeleteMode(bad)).toBeNull();
    });
});
