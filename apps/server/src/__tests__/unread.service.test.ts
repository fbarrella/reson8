import { describe, expect, it } from "vitest";
import { UNREAD_COUNT_CAP, applyUnreadCounts, countUnreadByChannel } from "../services/unread.service.js";

interface TestNode {
    id: string;
    children: TestNode[];
    unreadCount?: number;
}
const node = (id: string, children: TestNode[] = []): TestNode => ({ id, children });

describe("applyUnreadCounts", () => {
    it("sets counts on a nested tree and leaves zero / missing counts out", () => {
        const inner = node("inner");
        const tree = [node("a", [inner]), node("b"), node("c")];
        applyUnreadCounts(tree, new Map([["inner", 3], ["a", 0], ["b", 100]]));
        expect(inner.unreadCount).toBe(3);
        expect(tree[0].unreadCount).toBeUndefined();
        expect(tree[1].unreadCount).toBe(100);
        expect(tree[2].unreadCount).toBeUndefined();
    });

    it("never exceeds the cap even if handed a larger number", () => {
        const tree = [node("a")];
        applyUnreadCounts(tree, new Map([["a", 5000]]));
        expect(tree[0].unreadCount).toBe(UNREAD_COUNT_CAP);
    });
});

describe("countUnreadByChannel", () => {
    it("does not query for no channels", async () => {
        let called = false;
        const prisma = { $queryRaw: async () => { called = true; return []; } };
        const map = await countUnreadByChannel(prisma as never, "u1", []);
        expect(map.size).toBe(0);
        expect(called).toBe(false);
    });

    it("maps rows to a channel → count map and clamps to the cap", async () => {
        const prisma = {
            $queryRaw: async () => [
                { channelId: "a", n: 3 },
                { channelId: "b", n: 250 },
            ],
        };
        const map = await countUnreadByChannel(prisma as never, "u1", ["a", "b"]);
        expect(map.get("a")).toBe(3);
        expect(map.get("b")).toBe(UNREAD_COUNT_CAP);
    });

    it("passes the user id and channel ids as bound parameters, not into the SQL text", async () => {
        let strings: readonly string[] = [];
        let values: unknown[] = [];
        const prisma = {
            $queryRaw: async (s: TemplateStringsArray, ...v: unknown[]) => {
                strings = s;
                values = v;
                return [];
            },
        };
        await countUnreadByChannel(prisma as never, "evil'; DROP TABLE messages;--", ["x"]);
        expect(strings.join("")).not.toContain("DROP TABLE");
        expect(values).toContain("evil'; DROP TABLE messages;--");
        expect(values).toContainEqual(["x"]);
    });
});
