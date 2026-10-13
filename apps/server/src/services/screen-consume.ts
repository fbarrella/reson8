/**
 * Who may consume which producer (PRD 19 A9) — the pure decision behind the
 * CONSUME handler, so every row of the rule is unit-tested.
 *
 * Mic audio is never refused here: voice must work whatever the sharing switch
 * says. A SCREEN producer (video or audio) may be consumed only while sharing
 * is enabled, and only by a Viewer socket that is watching that very sharer
 * (set by WATCH_SCREEN_SHARE after its own checks).
 */

export type ProducerMediaType = "mic" | "screen-video" | "screen-audio";

export interface ScreenConsumeInput {
    /** null = the producer is unknown to the channel's sessions. */
    mediaType: ProducerMediaType | null;
    enabled: boolean;
    role: "primary" | "viewer" | undefined;
    watchingUserId: string | undefined;
    /** The session key that owns the producer (the sharer's userId). */
    ownerKey: string | null;
}

export type ScreenConsumeDecision =
    | { allowed: true }
    | { allowed: false; errorCode: "SCREEN_SHARE_DISABLED" | "NOT_WATCHING"; error: string };

export function screenConsumeDecision(input: ScreenConsumeInput): ScreenConsumeDecision {
    // Unknown producer: today's behaviour — router.canConsume decides and fails.
    if (input.mediaType === null || input.mediaType === "mic") return { allowed: true };

    if (!input.enabled) {
        return {
            allowed: false,
            errorCode: "SCREEN_SHARE_DISABLED",
            error: "Screen sharing is disabled on this server",
        };
    }
    const watching =
        input.role === "viewer" && input.ownerKey !== null && input.watchingUserId === input.ownerKey;
    if (!watching) {
        return {
            allowed: false,
            errorCode: "NOT_WATCHING",
            error: "Screen shares can only be received through the viewer",
        };
    }
    return { allowed: true };
}
