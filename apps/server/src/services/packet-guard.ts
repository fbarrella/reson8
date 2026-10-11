/**
 * Makes every incoming event safe to hand to a handler written as
 * `(payload, ack) => …` or `(ack) => …`.
 *
 * Found by the PRD 18.8 event fuzz: a client may emit an event WITHOUT an
 * acknowledgement callback, or with the callback in the payload's place
 * (`socket.emit("GET_ALL_USERS")`). Most handlers then called `ack(...)` on
 * `undefined` inside an async function — an unhandled rejection, which
 * terminates the Node process. Any connected socket (no sign-in needed) could
 * therefore take the whole server, and everyone's voice, down with one packet.
 *
 * The fix is one place, not forty: before the listeners run, the packet is
 * normalized so that
 *   - an event whose handler takes a payload always gets one (`{}` when the
 *     sender left it out — handlers already validate payload fields), and
 *   - there is always a function in the last position (a no-op when the
 *     sender gave none), so `ack(...)` can never throw.
 *
 * Pure: no Socket.io import, unit-tested directly.
 */

/**
 * Events a socket may send BEFORE it has signed in. Everything else needs
 * `socket.data.userId` + `serverId` (set by a successful USER_JOIN_SERVER or
 * VIEWER_AUTHENTICATE) — see `requiresSignIn()`.
 *
 *   USER_JOIN_SERVER / VIEWER_AUTHENTICATE  the sign-in itself
 *   REQUEST_AUTH_CHALLENGE                  the nonce the sign-in is signed over
 *   PING_LATENCY                            touches no data (a waiting client shows its latency)
 */
export const PRE_JOIN_EVENTS: ReadonlySet<string> = new Set([
    "USER_JOIN_SERVER",
    "VIEWER_AUTHENTICATE",
    "REQUEST_AUTH_CHALLENGE",
    "PING_LATENCY",
]);

/**
 * Default-deny (PRD 18.8): a socket that has not signed in — including one
 * waiting for approval — can reach no handler beyond the sign-in itself.
 * Before this, several handlers (FETCH_MESSAGES, USER_JOIN_CHANNEL,
 * FETCH_DIRECT_MESSAGES, GET_APPROVED_EMOJIS, GET_ROUTER_CAPABILITIES …)
 * checked nothing, so any connected socket could read history or join a
 * channel's room by id.
 */
export function requiresSignIn(event: string): boolean {
    return !PRE_JOIN_EVENTS.has(event);
}

export interface HandlerShape {
    /** Largest declared parameter count among the event's listeners. */
    arity: number;
    /** The only declared parameter is the acknowledgement (`(ack) => …`). */
    ackFirst: boolean;
}

/**
 * Reads a listener's shape from its source. Compiled handlers keep their
 * parameter names, and every handler in this codebase names the callback
 * `ack`; anything unrecognized is treated as a payload handler.
 */
export function describeHandler(fn: (...args: never[]) => unknown): HandlerShape {
    const arity = fn.length;
    const ackFirst = arity === 1 && /^(?:async\s*)?(?:function\b[^(]*)?\(?\s*ack\s*\)?\s*(?:=>|\{)/.test(Function.prototype.toString.call(fn));
    return { arity, ackFirst };
}

/**
 * @param packet  `[eventName, ...args]`, mutated in place
 * @param shape   the largest-arity listener's shape for that event
 */
export function normalizePacket(packet: unknown[], shape: HandlerShape): void {
    if (packet.length === 0) return;
    const args = packet.slice(1);
    const last = args[args.length - 1];
    const hasAck = typeof last === "function";
    if (shape.ackFirst) {
        // `(ack) => …` handlers: whatever else was sent must not land in the ack's place.
        packet.length = 1;
        packet.push(hasAck ? last : () => undefined);
        return;
    }
    const payloadCount = hasAck ? args.length - 1 : args.length;
    if (shape.arity >= 2 && payloadCount === 0) packet.splice(1, 0, {});
    if (!hasAck) packet.push(() => undefined);
}
