/**
 * What deleting a channel does (PRD 19 A6) — a pure planner so the three modes
 * are unit-tested before the handler runs them against the database.
 *
 *   legacy — what v2.7.0 clients get (no `children` option): the target alone is
 *            deleted and the foreign key's ON DELETE SET NULL re-parents its
 *            children, which keep their old (stale) positions.
 *   keep   — the target alone is deleted; its direct children move to the top
 *            level, appended after the existing top-level channels in their
 *            current order.
 *   delete — the target and every descendant are deleted.
 */

export interface PlannerChannel {
    id: string;
    parentId: string | null;
    position: number;
    type: "TEXT" | "VOICE";
}

export type ChannelDeleteMode = "legacy" | "keep" | "delete";

export interface ChannelDeletePlan {
    deleteIds: string[];
    reparent: { id: string; position: number }[];
    /** VOICE channels among `deleteIds` — their sessions must be torn down. */
    voiceIds: string[];
}

export function planChannelDelete(
    channels: readonly PlannerChannel[],
    targetId: string,
    mode: ChannelDeleteMode,
): ChannelDeletePlan {
    const byId = new Map(channels.map((c) => [c.id, c]));
    const childrenOf = (id: string): PlannerChannel[] =>
        channels
            .filter((c) => c.parentId === id)
            .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

    let deleteIds: string[] = [targetId];
    const reparent: { id: string; position: number }[] = [];

    if (mode === "keep") {
        const topLevel = channels.filter((c) => c.parentId === null && c.id !== targetId);
        const maxTop = topLevel.reduce((m, c) => Math.max(m, c.position), -1);
        childrenOf(targetId).forEach((child, i) => reparent.push({ id: child.id, position: maxTop + 1 + i }));
    } else if (mode === "delete") {
        // Breadth-first; the visited set guards against a cycle even though
        // moves are cycle-checked server-side.
        const visited = new Set<string>([targetId]);
        const queue: string[] = [targetId];
        deleteIds = [];
        while (queue.length > 0) {
            const id = queue.shift() as string;
            deleteIds.push(id);
            for (const child of childrenOf(id)) {
                if (visited.has(child.id)) continue;
                visited.add(child.id);
                queue.push(child.id);
            }
        }
    }

    const voiceIds = deleteIds.filter((id) => byId.get(id)?.type === "VOICE");
    return { deleteIds, reparent, voiceIds };
}

/** Parses `DELETE_CHANNEL.children`: undefined = legacy, else "keep" | "delete"; anything else is invalid. */
export function parseDeleteMode(value: unknown): ChannelDeleteMode | null {
    if (value === undefined) return "legacy";
    if (value === "keep" || value === "delete") return value;
    return null;
}
