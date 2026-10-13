/**
 * The room-wide screen share cap (PRD 19 A4) — the pure decision, kept apart
 * from the voice handler so it is unit-tested.
 */

import { MAX_SCREEN_SHARES_PER_ROOM } from "@reson8/shared-types";

export const SCREEN_SHARE_LIMIT_CODE = "SCREEN_SHARE_LIMIT" as const;
export const SCREEN_SHARE_LIMIT_MESSAGE =
    "All 5 stream slots are in use. You can share when someone stops.";

/**
 * Whether one more share fits: `otherLiveShares` is the number of live screen
 * producers in the room EXCLUDING the requester's own, so a user who already
 * shares never counts against themselves.
 */
export function screenShareSlotAvailable(
    otherLiveShares: number,
    max: number = MAX_SCREEN_SHARES_PER_ROOM,
): boolean {
    return otherLiveShares < max;
}
