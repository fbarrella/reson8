/** Typing signals (PRD 20 W2) — validation and the per-socket throttle, pure for tests. */
export const TYPING_MIN_INTERVAL_MS = 2500;

export type TypingTarget = { kind: "channel"; channelId: string } | { kind: "dm"; partnerId: string };

export function parseTypingPayload(p: unknown): TypingTarget | null {
    if (!p || typeof p !== "object") return null;
    const o = p as Record<string, unknown>;
    const ok = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
    if (ok(o.channelId) && o.dmPartnerId === undefined) return { kind: "channel", channelId: o.channelId };
    if (ok(o.dmPartnerId) && o.channelId === undefined) return { kind: "dm", partnerId: o.dmPartnerId };
    return null;
}

/** True when this signal may be relayed; `last` is the socket's previous relay time for the same target key. */
export function shouldRelayTyping(last: number | undefined, now: number): boolean {
    return last === undefined || now - last >= TYPING_MIN_INTERVAL_MS;
}
