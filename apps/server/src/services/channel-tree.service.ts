/**
 * Channel Tree Service — transforms flat Channel rows into a nested tree.
 *
 * Algorithm: O(n) single-pass, map-based (no recursion).
 *   1. Build a Map<id, node> from the flat array.
 *   2. Iterate: parentId === null → root; otherwise → parent.children.push(node).
 *   3. Sort each children array by `position`.
 *
 * This is intentionally allocation-light and cache-friendly for
 * high-concurrency scenarios where the tree is rebuilt on every mutation.
 */

import type { IChannel, IChannelTreeNode } from "@reson8/shared-types";

/**
 * Converts a flat array of channel records into a nested tree structure.
 *
 * @param channels - Flat array of channel records (e.g. from Prisma).
 * @returns Root-level nodes with nested `children` arrays, sorted by `position`.
 *
 * @example
 * ```ts
 * const flat = await prisma.channel.findMany({ where: { serverId } });
 * const tree = buildChannelTree(flat);
 * io.to(serverId).emit("CHANNEL_TREE_UPDATE", { serverId, tree });
 * ```
 */
export function buildChannelTree(channels: IChannel[]): IChannelTreeNode[] {
    if (channels.length === 0) return [];

    // Step 1: Create a map of all nodes with empty children arrays
    const nodeMap = new Map<string, IChannelTreeNode>();

    for (const channel of channels) {
        nodeMap.set(channel.id, {
            ...channel,
            children: [],
            occupants: [], // populated separately from Redis presence
        });
    }

    // Step 2: Link children to parents, collect root nodes
    const roots: IChannelTreeNode[] = [];

    for (const channel of channels) {
        const node = nodeMap.get(channel.id)!;

        if (channel.parentId === null) {
            roots.push(node);
        } else {
            const parent = nodeMap.get(channel.parentId);
            if (parent) {
                parent.children.push(node);
            } else {
                // Orphan — parent doesn't exist, treat as root
                roots.push(node);
            }
        }
    }

    // Step 3: Sort children by position (and roots too)
    const sortByPosition = (a: IChannelTreeNode, b: IChannelTreeNode): number =>
        a.position - b.position;

    roots.sort(sortByPosition);

    for (const node of nodeMap.values()) {
        if (node.children.length > 1) {
            node.children.sort(sortByPosition);
        }
    }

    return roots;
}
