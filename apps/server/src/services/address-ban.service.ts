/**
 * Address and range bans (PRD 18.7).
 *
 * Bans are per identity, and a fresh install is a fresh identity, so a
 * moderator may OPTIONALLY also ban the address — or its surrounding range —
 * the user connected from. Always opt-in: a VPN or mobile data dodges it, and
 * a shared network (a school, an office, a carrier's NAT) can put innocent
 * people behind the same address.
 *
 * The addresses compared here come ONLY from `socket.data.clientAddress`
 * (PRD 18.2), i.e. forwarded headers count only from a proxy the admin
 * listed in TRUST_PROXY.
 *
 * Pure: no Fastify/Socket.io/Prisma, so it is unit-tested directly (the one
 * database helper takes the client as a parameter).
 */

import net from "node:net";
import { normalizeAddress } from "./client-address.js";

export type BanScope = "exact" | "range";

/** IPv4 range bans cover a /24, IPv6 a /64 — one household or one customer's subnet. */
const IPV4_RANGE_PREFIX = 24;
const IPV6_RANGE_PREFIX = 64;

/** A normalized IP address, or null when `addr` isn't one. */
export function normalizeIp(addr: unknown): string | null {
    if (typeof addr !== "string") return null;
    const a = normalizeAddress(addr);
    return net.isIP(a) ? a : null;
}

/** Eight 16-bit groups of an IPv6 address (handles `::` and an embedded IPv4 tail). */
function expandIpv6(addr: string): number[] | null {
    let a = addr;
    // An embedded IPv4 tail ("::ffff:1.2.3.4", "64:ff9b::192.0.2.1") becomes two hextets.
    const v4 = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
    if (v4) {
        const o = v4[2].split(".").map(Number);
        if (o.some((n) => n > 255)) return null;
        a = `${v4[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
    }
    const halves = a.split("::");
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(":") : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const missing = 8 - head.length - tail.length;
    if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
    const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((h) => parseInt(h, 16));
    return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * The canonical CIDR for `addr` at `scope`, or null when `addr` isn't an IP.
 *   IPv4  exact `203.0.113.7/32`            range `203.0.113.0/24`
 *   IPv6  exact `2001:db8:0:0:0:0:0:1/128`  range `2001:db8:1:2:0:0:0:0/64`
 * IPv6 is written as eight un-compressed lower-case hextets so the same
 * network always yields the same string (the table's unique key).
 */
export function toCidr(addr: string, scope: BanScope): string | null {
    const ip = normalizeIp(addr);
    if (!ip) return null;
    if (net.isIPv4(ip)) {
        const o = ip.split(".").map(Number);
        return scope === "exact" ? `${ip}/32` : `${o[0]}.${o[1]}.${o[2]}.0/${IPV4_RANGE_PREFIX}`;
    }
    const g = expandIpv6(ip);
    if (!g) return null;
    if (scope === "exact") return `${g.map((x) => x.toString(16)).join(":")}/128`;
    return `${[...g.slice(0, 4), 0, 0, 0, 0].map((x) => x.toString(16)).join(":")}/${IPV6_RANGE_PREFIX}`;
}

/** Splits a stored CIDR. Null for anything that isn't one of ours. */
export function parseCidr(cidr: string): { network: string; prefix: number; family: "ipv4" | "ipv6" } | null {
    const m = /^([^/]+)\/(\d{1,3})$/.exec(cidr);
    if (!m) return null;
    const prefix = Number(m[2]);
    if (net.isIPv4(m[1])) return prefix <= 32 ? { network: m[1], prefix, family: "ipv4" } : null;
    if (net.isIPv6(m[1])) return prefix <= 128 ? { network: m[1], prefix, family: "ipv6" } : null;
    return null;
}

// ── Private / loopback addresses ────────────────────────────────────────────

const privateRanges = new net.BlockList();
for (const [network, prefix] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10], // carrier-grade NAT
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.168.0.0", 16],
] as const) {
    privateRanges.addSubnet(network, prefix, "ipv4");
}
privateRanges.addAddress("::", "ipv6");
privateRanges.addAddress("::1", "ipv6");
privateRanges.addSubnet("fc00::", 7, "ipv6");
privateRanges.addSubnet("fe80::", 10, "ipv6");

/**
 * Loopback, LAN, link-local and carrier-NAT addresses. Behind a proxy that
 * isn't trusted, EVERY client looks like one of these — banning it would ban
 * everyone, which is why such a ban is refused unless TRUST_PROXY says
 * otherwise (see the moderation handler).
 */
export function isPrivateOrLoopback(addr: string): boolean {
    const ip = normalizeIp(addr);
    if (!ip) return false;
    return privateRanges.check(ip, net.isIPv4(ip) ? "ipv4" : "ipv6");
}

/** What a non-admin moderator sees instead of the full address. */
export function maskAddress(addr: string): string {
    const ip = normalizeIp(addr);
    if (!ip) return "unknown";
    if (net.isIPv4(ip)) return `${ip.split(".").slice(0, 3).join(".")}.x`;
    const g = expandIpv6(ip);
    return g ? `${g.slice(0, 4).map((x) => x.toString(16)).join(":")}:x` : "unknown";
}

/** A stored CIDR with the host part hidden (`203.0.113.0/24` → `203.0.113.x`). */
export function maskCidr(cidr: string): string {
    const parsed = parseCidr(cidr);
    return parsed ? maskAddress(parsed.network) : "unknown";
}

/** Whether `addr` falls inside `cidr`. */
export function cidrContains(cidr: string, addr: string): boolean {
    const parsed = parseCidr(cidr);
    const ip = normalizeIp(addr);
    if (!parsed || !ip) return false;
    const list = new net.BlockList();
    list.addSubnet(parsed.network, parsed.prefix, parsed.family);
    return list.check(ip, net.isIPv4(ip) ? "ipv4" : "ipv6");
}

// ── The matcher ─────────────────────────────────────────────────────────────

/** All banned networks of the server, as one matcher consulted on every connection. */
export class AddressBanCache {
    private list = new net.BlockList();
    private count = 0;

    load(rows: readonly { cidr: string }[]): void {
        const list = new net.BlockList();
        let count = 0;
        for (const { cidr } of rows) {
            const p = parseCidr(cidr);
            if (!p) continue; // a malformed row can never ban anyone by accident
            list.addSubnet(p.network, p.prefix, p.family);
            count++;
        }
        this.list = list;
        this.count = count;
    }

    isBanned(addr: string | undefined): boolean {
        if (this.count === 0 || !addr) return false;
        const ip = normalizeIp(addr);
        if (!ip) return false;
        return this.list.check(ip, net.isIPv4(ip) ? "ipv4" : "ipv6");
    }

    get size(): number {
        return this.count;
    }
}

/** The process-wide instance (one server per process). */
export const addressBans = new AddressBanCache();

/** Re-reads the server's banned networks into `addressBans`. Call after every change. */
export async function reloadAddressBans(
    prisma: { bannedAddress: { findMany(args: { where: { serverId: string }; select: { cidr: true } }): Promise<{ cidr: string }[]> } },
    serverId: string,
): Promise<void> {
    addressBans.load(await prisma.bannedAddress.findMany({ where: { serverId }, select: { cidr: true } }));
}
