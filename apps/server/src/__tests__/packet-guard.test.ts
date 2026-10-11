import { describe, expect, it } from "vitest";
import { describeHandler, normalizePacket, requiresSignIn } from "../services/packet-guard.js";

const noop = () => undefined;
const payloadAck = { arity: 2, ackFirst: false };
const ackOnly = { arity: 1, ackFirst: true };
const payloadOnly = { arity: 1, ackFirst: false };

describe("normalizePacket", () => {
    it("leaves a well-formed (payload, ack) packet alone", () => {
        const payload = { a: 1 };
        const p: unknown[] = ["EVENT", payload, noop];
        normalizePacket(p, payloadAck);
        expect(p).toEqual(["EVENT", payload, noop]);
        expect(p[2]).toBe(noop);
    });

    it("adds a no-op ack when the sender gave none", () => {
        const p: unknown[] = ["EVENT", { a: 1 }];
        normalizePacket(p, payloadAck);
        expect(p).toHaveLength(3);
        expect(() => (p[2] as () => void)()).not.toThrow();
    });

    it("puts a payload back in front of a lone callback for a (payload, ack) handler", () => {
        const p: unknown[] = ["EVENT", noop];
        normalizePacket(p, payloadAck);
        expect(p).toEqual(["EVENT", {}, noop]);
    });

    it("builds both for a bare emit", () => {
        const p: unknown[] = ["EVENT"];
        normalizePacket(p, payloadAck);
        expect(p[1]).toEqual({});
        expect(typeof p[2]).toBe("function");
    });

    it("keeps a lone callback in place for an (ack) handler", () => {
        const p: unknown[] = ["EVENT", noop];
        normalizePacket(p, ackOnly);
        expect(p).toEqual(["EVENT", noop]);
    });

    it("drops a stray payload in front of an (ack) handler's callback", () => {
        const p: unknown[] = ["EVENT", { x: 1 }, noop];
        normalizePacket(p, ackOnly);
        expect(p).toEqual(["EVENT", noop]);
    });

    it("gives an (ack) handler a no-op when nothing callable was sent", () => {
        const p: unknown[] = ["EVENT", { x: 1 }];
        normalizePacket(p, ackOnly);
        expect(p).toHaveLength(2);
        expect(typeof p[1]).toBe("function");
    });

    it("never drops the payload of a payload-only handler", () => {
        const p: unknown[] = ["EVENT", { x: 1 }];
        normalizePacket(p, payloadOnly);
        expect(p[1]).toEqual({ x: 1 });
        expect(typeof p[2]).toBe("function");
    });

    it("does not invent a payload when one was sent", () => {
        const p: unknown[] = ["EVENT", "text", noop];
        normalizePacket(p, payloadAck);
        expect(p).toEqual(["EVENT", "text", noop]);
    });

    it("ignores an empty packet", () => {
        const p: unknown[] = [];
        normalizePacket(p, payloadAck);
        expect(p).toEqual([]);
    });
});

describe("describeHandler", () => {
    it("recognizes (payload, ack), (ack) and (payload)", () => {
        expect(describeHandler(async (_payload: unknown, _ack: unknown) => undefined)).toEqual({ arity: 2, ackFirst: false });
        expect(describeHandler(async (ack: unknown) => void ack)).toEqual({ arity: 1, ackFirst: true });
        expect(describeHandler((ack: unknown) => void ack)).toEqual({ arity: 1, ackFirst: true });
        expect(describeHandler(async (payload: unknown) => void payload)).toEqual({ arity: 1, ackFirst: false });
        expect(describeHandler(() => undefined)).toEqual({ arity: 0, ackFirst: false });
    });
});

describe("requiresSignIn", () => {
    it.each(["USER_JOIN_SERVER", "VIEWER_AUTHENTICATE", "REQUEST_AUTH_CHALLENGE", "PING_LATENCY"])(
        "%s may be sent before signing in",
        (e) => expect(requiresSignIn(e)).toBe(false),
    );
    it.each(["FETCH_MESSAGES", "USER_JOIN_CHANNEL", "FETCH_DIRECT_MESSAGES", "SEND_MESSAGE", "GET_APPROVED_EMOJIS", "ANYTHING_ELSE"])(
        "%s needs a signed-in socket",
        (e) => expect(requiresSignIn(e)).toBe(true),
    );
});
