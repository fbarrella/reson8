/**
 * Unit tests for the Channel Tree Service.
 *
 * Validates the O(n) flat→nested transformation algorithm.
 */

import { describe, it, expect } from "vitest";
import { buildChannelTree } from "../services/channel-tree.service.js";
import type { IChannel } from "@reson8/shared-types";
import { ChannelType } from "@reson8/shared-types";

/** Helper to create a minimal IChannel record. */
function makeChannel(
    overrides: Partial<IChannel> & Pick<IChannel, "id" | "name">,
): IChannel {
    return {
        serverId: "server-1",
        type: ChannelType.VOICE,
        parentId: null,
        position: 0,
        maxUsers: null,
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

describe("buildChannelTree", () => {
    it("returns an empty array for an empty input", () => {
        expect(buildChannelTree([])).toEqual([]);
    });

    it("returns a single root node with no children", () => {
        const channels = [makeChannel({ id: "ch1", name: "General" })];
        const tree = buildChannelTree(channels);

        expect(tree).toHaveLength(1);
        expect(tree[0].id).toBe("ch1");
        expect(tree[0].name).toBe("General");
        expect(tree[0].children).toEqual([]);
    });

    it("correctly nests children under their parents", () => {
        const channels = [
            makeChannel({ id: "root", name: "Root", position: 0 }),
            makeChannel({
                id: "child1",
                name: "Child 1",
                parentId: "root",
                position: 0,
            }),
            makeChannel({
                id: "child2",
                name: "Child 2",
                parentId: "root",
                position: 1,
            }),
        ];

        const tree = buildChannelTree(channels);

        expect(tree).toHaveLength(1);
        expect(tree[0].children).toHaveLength(2);
        expect(tree[0].children[0].name).toBe("Child 1");
        expect(tree[0].children[1].name).toBe("Child 2");
    });

    it("handles deep nesting (3+ levels)", () => {
        const channels = [
            makeChannel({ id: "l1", name: "Level 1", position: 0 }),
            makeChannel({
                id: "l2",
                name: "Level 2",
                parentId: "l1",
                position: 0,
            }),
            makeChannel({
                id: "l3",
                name: "Level 3",
                parentId: "l2",
                position: 0,
            }),
            makeChannel({
                id: "l4",
                name: "Level 4",
                parentId: "l3",
                position: 0,
            }),
        ];

        const tree = buildChannelTree(channels);

        expect(tree).toHaveLength(1);
        expect(tree[0].children[0].children[0].children[0].name).toBe("Level 4");
    });

    it("sorts children by position", () => {
        const channels = [
            makeChannel({ id: "root", name: "Root", position: 0 }),
            makeChannel({
                id: "c",
                name: "Third",
                parentId: "root",
                position: 2,
            }),
            makeChannel({
                id: "a",
                name: "First",
                parentId: "root",
                position: 0,
            }),
            makeChannel({
                id: "b",
                name: "Second",
                parentId: "root",
                position: 1,
            }),
        ];

        const tree = buildChannelTree(channels);
        const names = tree[0].children.map((c) => c.name);

        expect(names).toEqual(["First", "Second", "Third"]);
    });

    it("sorts root-level nodes by position", () => {
        const channels = [
            makeChannel({ id: "r3", name: "Root 3", position: 2 }),
            makeChannel({ id: "r1", name: "Root 1", position: 0 }),
            makeChannel({ id: "r2", name: "Root 2", position: 1 }),
        ];

        const tree = buildChannelTree(channels);
        const names = tree.map((n) => n.name);

        expect(names).toEqual(["Root 1", "Root 2", "Root 3"]);
    });

    it("treats orphan channels (missing parent) as roots", () => {
        const channels = [
            makeChannel({ id: "ch1", name: "Normal Root", position: 0 }),
            makeChannel({
                id: "orphan",
                name: "Orphan",
                parentId: "nonexistent",
                position: 1,
            }),
        ];

        const tree = buildChannelTree(channels);

        // Both should appear as root-level nodes
        expect(tree).toHaveLength(2);
    });

    it("populates each node with an empty occupants array", () => {
        const channels = [makeChannel({ id: "ch1", name: "General" })];
        const tree = buildChannelTree(channels);

        expect(tree[0].occupants).toEqual([]);
    });
});
