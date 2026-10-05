import { describe, it, expect } from "vitest";
import { aggregateReactionRows, UNKNOWN_REACTOR_NICKNAME } from "../services/reaction.service.js";

const names = new Map([
    ["u1", "Alice"],
    ["u2", "Bob"],
    ["u3", "Carol"],
]);

describe("aggregateReactionRows", () => {
    it("returns an empty list when there are no reactions", () => {
        expect(aggregateReactionRows([], names)).toEqual([]);
    });

    it("keeps the original userIds/count fields byte-identical to the old aggregation", () => {
        const out = aggregateReactionRows(
            [
                { emoji: "👍", userId: "u1" },
                { emoji: "❤️", userId: "u2" },
                { emoji: "👍", userId: "u2" },
            ],
            names,
        );
        expect(out.map(({ emoji, count, userIds }) => ({ emoji, count, userIds }))).toEqual([
            { emoji: "👍", count: 2, userIds: ["u1", "u2"] },
            { emoji: "❤️", count: 1, userIds: ["u2"] },
        ]);
    });

    it("orders emoji by first reaction and reactors chronologically", () => {
        const out = aggregateReactionRows(
            [
                { emoji: ":b:", userId: "u3" },
                { emoji: ":a:", userId: "u1" },
                { emoji: ":b:", userId: "u1" },
            ],
            names,
        );
        expect(out.map((r) => r.emoji)).toEqual([":b:", ":a:"]);
        expect(out[0].userIds).toEqual(["u3", "u1"]);
    });

    it("attaches nicknames aligned with userIds", () => {
        const [r] = aggregateReactionRows(
            [
                { emoji: ":a:", userId: "u2" },
                { emoji: ":a:", userId: "u1" },
            ],
            names,
        );
        expect(r.users).toEqual([
            { userId: "u2", nickname: "Bob" },
            { userId: "u1", nickname: "Alice" },
        ]);
    });

    it("falls back to a placeholder for a reactor with no User row", () => {
        const [r] = aggregateReactionRows([{ emoji: ":a:", userId: "ghost" }], names);
        expect(r.users).toEqual([{ userId: "ghost", nickname: UNKNOWN_REACTOR_NICKNAME }]);
    });
});
