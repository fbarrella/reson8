import { describe, expect, it } from "vitest";
import { normalizeAddress, parseTrustProxy, resolveClientAddress } from "../services/client-address.js";

const trustLoopbackAndPrivate = parseTrustProxy("loopback, uniquelocal").trust;
const trustNothing = parseTrustProxy(undefined).trust;

describe("parseTrustProxy", () => {
    it("trusts nothing when unset, empty or 'false'", () => {
        for (const v of [undefined, "", "   ", "false", "FALSE"]) {
            const c = parseTrustProxy(v);
            expect(c.list).toEqual([]);
            expect(c.trust("127.0.0.1", 0)).toBe(false);
            expect(c.warning).toBeUndefined();
        }
    });

    it("refuses 'true' (it would let clients choose their own address)", () => {
        const c = parseTrustProxy("true");
        expect(c.list).toEqual([]);
        expect(c.trust("127.0.0.1", 0)).toBe(false);
        expect(c.warning).toMatch(/not supported/);
    });

    it("accepts keywords, addresses and CIDRs", () => {
        const c = parseTrustProxy("loopback, 172.16.0.0/12 , 203.0.113.9");
        expect(c.list).toEqual(["loopback", "172.16.0.0/12", "203.0.113.9"]);
        expect(c.trust("127.0.0.1", 0)).toBe(true);
        expect(c.trust("172.20.1.2", 0)).toBe(true);
        expect(c.trust("203.0.113.9", 0)).toBe(true);
        expect(c.trust("8.8.8.8", 0)).toBe(false);
    });

    it("falls back to trusting nothing (with a warning) on an invalid entry", () => {
        const c = parseTrustProxy("loopback, not-an-ip");
        expect(c.list).toEqual([]);
        expect(c.trust("127.0.0.1", 0)).toBe(false);
        expect(c.warning).toMatch(/invalid/i);
    });
});

describe("normalizeAddress", () => {
    it("turns IPv4-mapped IPv6 into IPv4", () => {
        expect(normalizeAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
        expect(normalizeAddress("::FFFF:127.0.0.1")).toBe("127.0.0.1");
    });
    it("drops IPv6 zone ids and lower-cases IPv6", () => {
        expect(normalizeAddress("fe80::1%eth0")).toBe("fe80::1");
        expect(normalizeAddress("2001:DB8::1")).toBe("2001:db8::1");
    });
    it("leaves IPv4 and non-addresses alone", () => {
        expect(normalizeAddress("203.0.113.7")).toBe("203.0.113.7");
        expect(normalizeAddress(" nonsense ")).toBe("nonsense");
    });
});

describe("resolveClientAddress", () => {
    it("ignores forged headers from an untrusted peer", () => {
        const headers = { "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": "5.6.7.8" };
        expect(resolveClientAddress("203.0.113.50", headers, trustLoopbackAndPrivate)).toBe("203.0.113.50");
        expect(resolveClientAddress("203.0.113.50", headers, trustNothing)).toBe("203.0.113.50");
    });

    it("ignores headers from everyone when nothing is trusted, even loopback", () => {
        expect(resolveClientAddress("127.0.0.1", { "x-forwarded-for": "9.9.9.9" }, trustNothing)).toBe("127.0.0.1");
    });

    it("honors X-Forwarded-For from a trusted proxy", () => {
        expect(
            resolveClientAddress("127.0.0.1", { "x-forwarded-for": "203.0.113.9" }, trustLoopbackAndPrivate),
        ).toBe("203.0.113.9");
    });

    it("walks the chain from the right and stops at the first untrusted hop", () => {
        // client 1.1.1.1 → proxy 10.0.0.2 → proxy 10.0.0.3 → us (peer 10.0.0.4)
        expect(
            resolveClientAddress("10.0.0.4", { "x-forwarded-for": "1.1.1.1, 10.0.0.2, 10.0.0.3" }, trustLoopbackAndPrivate),
        ).toBe("1.1.1.1");
        // a client-supplied leftmost value cannot hide behind an untrusted hop
        expect(
            resolveClientAddress("10.0.0.4", { "x-forwarded-for": "6.6.6.6, 203.0.113.9" }, trustLoopbackAndPrivate),
        ).toBe("203.0.113.9");
    });

    it("honors CF-Connecting-IP only from a trusted peer", () => {
        expect(resolveClientAddress("172.18.0.2", { "cf-connecting-ip": "198.51.100.4" }, trustLoopbackAndPrivate)).toBe(
            "198.51.100.4",
        );
        expect(resolveClientAddress("198.51.100.99", { "cf-connecting-ip": "198.51.100.4" }, trustLoopbackAndPrivate)).toBe(
            "198.51.100.99",
        );
    });

    it("never lets a non-IP header value become the address", () => {
        expect(resolveClientAddress("127.0.0.1", { "x-forwarded-for": "<script>" }, trustLoopbackAndPrivate)).toBe("127.0.0.1");
        expect(resolveClientAddress("127.0.0.1", { "cf-connecting-ip": "evil" }, trustLoopbackAndPrivate)).toBe("127.0.0.1");
    });

    it("normalizes IPv4-mapped peers and trusts them by their IPv4 form", () => {
        expect(resolveClientAddress("::ffff:203.0.113.7", {}, trustNothing)).toBe("203.0.113.7");
        expect(
            resolveClientAddress("::ffff:127.0.0.1", { "x-forwarded-for": "198.51.100.8" }, trustLoopbackAndPrivate),
        ).toBe("198.51.100.8");
    });

    it("handles IPv6 clients behind a trusted proxy", () => {
        expect(
            resolveClientAddress("127.0.0.1", { "x-forwarded-for": "2001:db8::7" }, trustLoopbackAndPrivate),
        ).toBe("2001:db8::7");
    });

    it("returns 'unknown' when the socket has no address", () => {
        expect(resolveClientAddress(undefined, {}, trustLoopbackAndPrivate)).toBe("unknown");
    });
});
