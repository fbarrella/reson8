/**
 * Rolling back a failed USER_JOIN_SERVER (PRD 19 P11).
 *
 * The join writes `socket.data.userId/serverId/...` BEFORE its last fallible
 * steps (the user upsert, role grants, membership, presence). When one of them
 * threw, the ack said `{ success: false }` but the packet gate still saw a
 * signed-in socket (it only looks at `userId` + `serverId`). A failed join
 * must leave the socket exactly as it was — default-deny if it never signed in.
 */

import type { SocketData } from "@reson8/shared-types";

const JOIN_FIELDS = ["userId", "serverId", "nickname", "currentChannelId", "hasAccess"] as const;

export type JoinStateSnapshot = Partial<Pick<SocketData, (typeof JOIN_FIELDS)[number]>>;

/** Remembers the fields a join overwrites. */
export function snapshotJoinState(data: Partial<SocketData>): JoinStateSnapshot {
    const snap: JoinStateSnapshot = {};
    for (const key of JOIN_FIELDS) (snap as Record<string, unknown>)[key] = data[key];
    return snap;
}

/** Puts the snapshot back (an absent value is restored as absent, not as a string). */
export function restoreJoinState(data: Partial<SocketData>, snap: JoinStateSnapshot): void {
    for (const key of JOIN_FIELDS) {
        if (snap[key] === undefined) delete data[key];
        else (data as Record<string, unknown>)[key] = snap[key];
    }
}
