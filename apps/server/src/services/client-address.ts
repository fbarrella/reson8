/**
 * The client's network address, with forwarded-address headers honored ONLY
 * from proxies the admin listed in `TRUST_PROXY` (PRD 18.2).
 *
 * Before this, `connection.handler.ts` took `cf-connecting-ip` and
 * `x-forwarded-for` from ANY client, so the address was whatever the client
 * claimed. That was harmless while it only fed logs, but address bans (18.7),
 * the identity log (18.4) and the pending-approval limits (18.8) all key on it.
 *
 * Pure: no Fastify/Socket.io imports, so it is unit-tested directly.
 */

import net from "node:net";
import proxyaddr from "@fastify/proxy-addr";

/** `(address, hopIndex) => is this hop a proxy we trust?` — the proxy-addr contract. */
export type TrustFn = (addr: string, hopIndex: number) => boolean;

export interface TrustProxyConfig {
    trust: TrustFn;
    /** The entries to hand to Fastify's own `trustProxy` option; empty = trust nothing. */
    list: string[];
    /** One line for the startup log. */
    description: string;
    /** Set when the env value was refused or unusable (logged as a warning). */
    warning?: string;
}

const trustNone: TrustFn = () => false;

/**
 * Parses `TRUST_PROXY`:
 *   - unset / "" / "false"  → trust nothing (the default);
 *   - "true"                → REFUSED: trusting every hop makes the address
 *                             client-controlled again, so nothing is trusted;
 *   - otherwise a comma list of IPs, CIDRs or the proxy-addr keywords
 *     `loopback`, `linklocal`, `uniquelocal` (Docker networks are `uniquelocal`).
 */
export function parseTrustProxy(raw: string | undefined): TrustProxyConfig {
    const value = (raw ?? "").trim();
    const off = (warning?: string): TrustProxyConfig => ({
        trust: trustNone,
        list: [],
        description: "off — forwarded-address headers are ignored",
        ...(warning ? { warning } : {}),
    });

    if (!value || value.toLowerCase() === "false") return off();
    if (value.toLowerCase() === "true") {
        return off(
            'TRUST_PROXY=true is not supported (it would trust every hop, so clients could choose their own address). ' +
                'List your proxy addresses instead, e.g. "loopback, uniquelocal". Trusting nothing.',
        );
    }

    const list = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    try {
        return { trust: proxyaddr.compile(list), list, description: `trusting ${list.join(", ")}` };
    } catch (err) {
        return off(`TRUST_PROXY is invalid (${(err as Error).message}). Trusting nothing.`);
    }
}

/**
 * One canonical text form: IPv4-mapped IPv6 (`::ffff:1.2.3.4`) becomes plain
 * IPv4, an IPv6 zone id (`fe80::1%eth0`) is dropped, IPv6 is lower-cased.
 * Anything that isn't an IP address is returned trimmed and unchanged.
 */
export function normalizeAddress(addr: string): string {
    let a = addr.trim();
    const zone = a.indexOf("%");
    if (zone !== -1) a = a.slice(0, zone);
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(a);
    if (mapped) a = mapped[1];
    return net.isIPv6(a) ? a.toLowerCase() : a;
}

type HeaderBag = Record<string, string | string[] | undefined>;

function singleHeader(headers: HeaderBag, name: string): string | undefined {
    const v = headers[name];
    return typeof v === "string" ? v : undefined;
}

/**
 * The address to attribute a connection to.
 *   1. The peer is not a trusted proxy → the peer itself; headers are ignored.
 *   2. The peer is trusted and sent a valid `CF-Connecting-IP` → that.
 *   3. Otherwise walk `X-Forwarded-For` from the right, stopping at the first
 *      hop that isn't trusted (proxy-addr's rule).
 * The result is always a valid IP when the peer was one; garbage in a header
 * can never become the address.
 */
export function resolveClientAddress(
    remoteAddress: string | undefined,
    headers: HeaderBag,
    trust: TrustFn,
): string {
    if (!remoteAddress) return "unknown";
    const peer = normalizeAddress(remoteAddress);
    if (!trust(remoteAddress, 0) && !trust(peer, 0)) return peer;

    const cf = singleHeader(headers, "cf-connecting-ip")?.trim();
    if (cf && net.isIP(cf)) return normalizeAddress(cf);

    const resolved = proxyaddr({ socket: { remoteAddress }, headers } as never, trust);
    return resolved && net.isIP(normalizeAddress(resolved)) ? normalizeAddress(resolved) : peer;
}

// ── Process-wide configuration ──────────────────────────────────────────────
// Read once (the env doesn't change at runtime); tests can reset it.

let cached: TrustProxyConfig | null = null;

export function getTrustProxy(): TrustProxyConfig {
    cached ??= parseTrustProxy(process.env.TRUST_PROXY);
    return cached;
}

/** Test hook: forget the memoized configuration. */
export function resetTrustProxyCache(): void {
    cached = null;
}
