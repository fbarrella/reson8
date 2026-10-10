import { describe, expect, it } from "vitest";
import {
    AddressBanCache,
    cidrContains,
    isPrivateOrLoopback,
    maskAddress,
    maskCidr,
    normalizeIp,
    parseCidr,
    toCidr,
} from "../services/address-ban.service.js";

describe("normalizeIp", () => {
    it("maps IPv4-mapped IPv6 to IPv4", () => {
        expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    });
    it("passes IPv4 and IPv6 through, lower-cased", () => {
        expect(normalizeIp("203.0.113.7")).toBe("203.0.113.7");
        expect(normalizeIp("2001:DB8::1")).toBe("2001:db8::1");
    });
    it("drops zone ids", () => {
        expect(normalizeIp("fe80::1%eth0")).toBe("fe80::1");
    });
    it.each(["", "nope", "999.1.1.1", "1.2.3", 5, null, undefined])("rejects %j", (v) => {
        expect(normalizeIp(v as never)).toBeNull();
    });
});

describe("toCidr", () => {
    it("IPv4 exact is /32 and range is the /24", () => {
        expect(toCidr("203.0.113.7", "exact")).toBe("203.0.113.7/32");
        expect(toCidr("203.0.113.7", "range")).toBe("203.0.113.0/24");
        expect(toCidr("203.0.113.0", "range")).toBe("203.0.113.0/24");
        expect(toCidr("10.20.30.255", "range")).toBe("10.20.30.0/24");
    });

    it("IPv4-mapped input is treated as IPv4", () => {
        expect(toCidr("::ffff:203.0.113.7", "range")).toBe("203.0.113.0/24");
    });

    it("IPv6 exact is the /128 in canonical un-compressed form", () => {
        expect(toCidr("2001:db8::1", "exact")).toBe("2001:db8:0:0:0:0:0:1/128");
        expect(toCidr("2001:0DB8:0000:0000:0000:0000:0000:0001", "exact")).toBe("2001:db8:0:0:0:0:0:1/128");
    });

    it("IPv6 range is the /64 with the host half zeroed", () => {
        expect(toCidr("2001:db8:1:2:aaaa:bbbb:cccc:dddd", "range")).toBe("2001:db8:1:2:0:0:0:0/64");
        expect(toCidr("2001:db8:1:2::5", "range")).toBe("2001:db8:1:2:0:0:0:0/64");
    });

    it("the same network always yields the same string (the unique key)", () => {
        expect(toCidr("2001:db8::1", "range")).toBe(toCidr("2001:db8:0:0:ffff::9", "range"));
        expect(toCidr("::1", "exact")).toBe("0:0:0:0:0:0:0:1/128");
    });

    it("handles :: at the start, the end, and an embedded IPv4 tail", () => {
        expect(toCidr("::", "exact")).toBe("0:0:0:0:0:0:0:0/128");
        expect(toCidr("fe80::", "range")).toBe("fe80:0:0:0:0:0:0:0/64");
        expect(toCidr("64:ff9b::192.0.2.33", "exact")).toBe("64:ff9b:0:0:0:0:c000:221/128");
    });

    it("returns null for non-addresses", () => {
        expect(toCidr("not-an-ip", "exact")).toBeNull();
        expect(toCidr("", "range")).toBeNull();
    });
});

describe("parseCidr", () => {
    it("accepts what toCidr produces", () => {
        for (const addr of ["203.0.113.7", "2001:db8::1"]) {
            for (const scope of ["exact", "range"] as const) {
                expect(parseCidr(toCidr(addr, scope)!)).not.toBeNull();
            }
        }
    });
    it.each(["203.0.113.0", "203.0.113.0/33", "2001:db8::/129", "abc/24", "/24", "203.0.113.0/", "1.2.3.4/24/1"])(
        "rejects %j",
        (v) => {
            expect(parseCidr(v)).toBeNull();
        },
    );
});

describe("isPrivateOrLoopback", () => {
    it.each(["127.0.0.1", "10.1.2.3", "172.16.0.5", "172.31.255.255", "192.168.0.10", "169.254.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1"])(
        "%s is private/loopback",
        (a) => {
            expect(isPrivateOrLoopback(a)).toBe(true);
        },
    );
    it.each(["8.8.8.8", "203.0.113.7", "172.15.0.1", "172.32.0.1", "100.63.255.255", "100.128.0.1", "2001:db8::1", "2606:4700::1"])(
        "%s is public",
        (a) => {
            expect(isPrivateOrLoopback(a)).toBe(false);
        },
    );
    it("is false for garbage rather than throwing", () => {
        expect(isPrivateOrLoopback("hello")).toBe(false);
    });
});

describe("masking", () => {
    it("hides the last IPv4 octet", () => {
        expect(maskAddress("203.0.113.7")).toBe("203.0.113.x");
        expect(maskAddress("::ffff:203.0.113.7")).toBe("203.0.113.x");
    });
    it("hides the interface half of an IPv6 address", () => {
        expect(maskAddress("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2:x");
    });
    it("masks a stored CIDR the same way", () => {
        expect(maskCidr("203.0.113.0/24")).toBe("203.0.113.x");
        expect(maskCidr("2001:db8:1:2:0:0:0:0/64")).toBe("2001:db8:1:2:x");
        expect(maskCidr("garbage")).toBe("unknown");
    });
    it("never echoes something that isn't an address", () => {
        expect(maskAddress("<script>")).toBe("unknown");
    });
});

describe("cidrContains", () => {
    it("matches inside and not outside", () => {
        expect(cidrContains("203.0.113.0/24", "203.0.113.200")).toBe(true);
        expect(cidrContains("203.0.113.0/24", "203.0.114.1")).toBe(false);
        expect(cidrContains("203.0.113.7/32", "203.0.113.7")).toBe(true);
        expect(cidrContains("203.0.113.7/32", "203.0.113.8")).toBe(false);
        expect(cidrContains("2001:db8:1:2:0:0:0:0/64", "2001:db8:1:2:9::1")).toBe(true);
        expect(cidrContains("2001:db8:1:2:0:0:0:0/64", "2001:db8:1:3::1")).toBe(false);
    });
    it("is false for IPv4 vs IPv6 and for garbage", () => {
        expect(cidrContains("203.0.113.0/24", "2001:db8::1")).toBe(false);
        expect(cidrContains("nope", "203.0.113.1")).toBe(false);
        expect(cidrContains("203.0.113.0/24", "nope")).toBe(false);
    });
});

describe("AddressBanCache", () => {
    const cache = new AddressBanCache();
    cache.load([
        { cidr: "203.0.113.0/24" },
        { cidr: "198.51.100.7/32" },
        { cidr: "2001:db8:1:2:0:0:0:0/64" },
        { cidr: "this-is-not-a-cidr" },
    ]);

    it("bans every address in a range and only that exact one for /32", () => {
        expect(cache.isBanned("203.0.113.1")).toBe(true);
        expect(cache.isBanned("203.0.113.254")).toBe(true);
        expect(cache.isBanned("203.0.114.1")).toBe(false);
        expect(cache.isBanned("198.51.100.7")).toBe(true);
        expect(cache.isBanned("198.51.100.8")).toBe(false);
    });

    it("matches IPv6 ranges and IPv4-mapped forms of banned IPv4", () => {
        expect(cache.isBanned("2001:db8:1:2:dead:beef::1")).toBe(true);
        expect(cache.isBanned("2001:db8:1:3::1")).toBe(false);
        expect(cache.isBanned("::ffff:203.0.113.99")).toBe(true);
    });

    it("ignores malformed rows without banning anything extra", () => {
        expect(cache.size).toBe(3);
        expect(cache.isBanned("8.8.8.8")).toBe(false);
    });

    it("is false for missing/unknown addresses and for an empty cache", () => {
        expect(cache.isBanned(undefined)).toBe(false);
        expect(cache.isBanned("unknown")).toBe(false);
        expect(new AddressBanCache().isBanned("203.0.113.1")).toBe(false);
    });

    it("reload replaces the previous set", () => {
        const c = new AddressBanCache();
        c.load([{ cidr: "203.0.113.0/24" }]);
        expect(c.isBanned("203.0.113.1")).toBe(true);
        c.load([]);
        expect(c.isBanned("203.0.113.1")).toBe(false);
    });
});
