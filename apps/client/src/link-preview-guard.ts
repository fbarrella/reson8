/**
 * Safety rules for link previews (PRD 18.10) — PURE (Node only, no Electron),
 * tested in plain Node by `scripts/link-preview-smoke.mjs`.
 *
 * Every preview makes THIS computer contact an address a stranger chose by
 * posting a link. The rules here keep that from reaching into the reader's own
 * network (router admin pages, a NAS, cloud metadata endpoints), from reading
 * unbounded bodies, and from growing caches forever.
 */

import dns from "node:dns";
import net from "node:net";

// ── Addresses ───────────────────────────────────────────────────────────────

const blocked = new net.BlockList();
for (const [network, prefix] of [
    ["0.0.0.0", 8], // "this network"
    ["10.0.0.0", 8],
    ["100.64.0.0", 10], // carrier-grade NAT
    ["127.0.0.0", 8], // loopback
    ["169.254.0.0", 16], // link-local, incl. cloud metadata (169.254.169.254)
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15], // benchmarking
    ["224.0.0.0", 3], // multicast (224/4) and reserved (240/4)
] as const) {
    blocked.addSubnet(network, prefix, "ipv4");
}
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
blocked.addSubnet("fc00::", 7, "ipv6"); // unique local
blocked.addSubnet("fe80::", 10, "ipv6"); // link-local
blocked.addSubnet("ff00::", 8, "ipv6"); // multicast

/** Eight 16-bit groups of an IPv6 address, or null. */
function ipv6Groups(addr: string): number[] | null {
    let a = addr;
    const tail = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
    if (tail) {
        const o = tail[2].split(".").map(Number);
        if (o.some((n) => n > 255)) return null;
        a = `${tail[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
    }
    const halves = a.split("::");
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(":") : [];
    const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const missing = 8 - head.length - rest.length;
    if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
    const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest].map((h) => parseInt(h, 16));
    return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** The IPv4 address embedded in a mapped/translated IPv6 one, or null. */
function embeddedIpv4(g: number[]): string | null {
    const v4 = (hi: number, lo: number): string => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (deprecated IPv4-compatible)
    if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || (g[5] === 0 && (g[6] !== 0 || g[7] > 1)))) {
        return v4(g[6], g[7]);
    }
    // 64:ff9b::/96 (NAT64) — the translator would reach that IPv4 address
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4(g[6], g[7]);
    // 2002::/16 (6to4) — the IPv4 address is in groups 1–2
    if (g[0] === 0x2002) return v4(g[1], g[2]);
    return null;
}

/** Whether a request to this address would reach a private / local / reserved network. */
export function isBlockedAddress(ip: string): boolean {
    let a = ip.trim();
    const zone = a.indexOf("%");
    if (zone !== -1) a = a.slice(0, zone);
    if (net.isIPv4(a)) return blocked.check(a, "ipv4");
    if (net.isIPv6(a)) {
        const g = ipv6Groups(a.toLowerCase());
        if (!g) return true; // an IPv6 address we can't read is not one to trust
        const inner = embeddedIpv4(g);
        if (inner) return isBlockedAddress(inner);
        return blocked.check(a, "ipv6");
    }
    return true; // not an IP at all: refuse rather than guess
}

/**
 * Hostnames that are local or internal by name. IP literals are judged by
 * `isBlockedAddress`; anything else is let through to DNS (and the guarded
 * lookup) unless it is clearly not a public name.
 */
export function isBlockedHostname(host: string): boolean {
    let h = host.trim().toLowerCase();
    if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
    h = h.replace(/\.+$/, "");
    if (!h) return true;
    if (net.isIP(h)) return isBlockedAddress(h);
    if (h === "localhost" || h.endsWith(".localhost")) return true;
    if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa") || h.endsWith(".lan")) return true;
    if (!h.includes(".")) return true; // a single-label name only resolves inside someone's network
    return false;
}

export type PreviewUrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Scheme, credentials and host rules for any URL a preview may request. */
export function checkPreviewUrl(raw: string): PreviewUrlCheck {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return { ok: false, reason: "not a URL" };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "not http(s)" };
    if (url.username || url.password) return { ok: false, reason: "has credentials" };
    if (isBlockedHostname(url.hostname)) return { ok: false, reason: "local or private address" };
    return { ok: true, url };
}

/**
 * Next hop of a redirect: resolved against the current URL and re-validated.
 * Returns null when the target isn't allowed (a redirect into a private
 * address must not be followed).
 */
export function nextRedirectUrl(current: string, location: string): string | null {
    let target: URL;
    try {
        target = new URL(location, current);
    } catch {
        return null;
    }
    const check = checkPreviewUrl(target.href);
    return check.ok ? check.url.href : null;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;

/**
 * `net.connect`'s `lookup` option: resolves the name, drops every private
 * address, and hands back only what is left — so the address that was CHECKED
 * is the address that is CONNECTED to (no check-then-resolve-again gap for DNS
 * rebinding). Honors the `all: true` form `net` uses with happy-eyeballs.
 */
export function guardedLookup(
    hostname: string,
    options: dns.LookupOptions | number | undefined,
    callback: LookupCallback,
): void {
    const opts: dns.LookupOptions = typeof options === "number" ? { family: options } : { ...(options ?? {}) };
    dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
        if (err) {
            callback(err);
            return;
        }
        const allowed = (addresses as dns.LookupAddress[]).filter((a) => !isBlockedAddress(a.address));
        if (allowed.length === 0) {
            const e: NodeJS.ErrnoException = new Error(`Blocked address for ${hostname}`);
            e.code = "ERR_BLOCKED_ADDRESS";
            callback(e);
            return;
        }
        if (opts.all) callback(null, allowed);
        else callback(null, allowed[0].address, allowed[0].family);
    });
}

// ── HTML head reading ───────────────────────────────────────────────────────

/** Decoder label from `Content-Type`, else a `<meta charset>` / http-equiv sniff of the first bytes, else utf-8. */
export function sniffCharset(contentType: string | null | undefined, firstBytes: Uint8Array): string {
    const fromHeader = /charset\s*=\s*["']?([\w:.-]+)/i.exec(contentType ?? "");
    if (fromHeader) return fromHeader[1].toLowerCase();
    const head = Buffer.from(firstBytes.subarray(0, 1024)).toString("latin1");
    const meta =
        /<meta[^>]+charset\s*=\s*["']?\s*([\w:.-]+)/i.exec(head) ??
        /<meta[^>]+http-equiv\s*=\s*["']?content-type["']?[^>]*charset\s*=\s*([\w:.-]+)/i.exec(head);
    return meta ? meta[1].toLowerCase() : "utf-8";
}

function makeDecoder(label: string): TextDecoder {
    try {
        return new TextDecoder(label, { fatal: false });
    } catch {
        return new TextDecoder("utf-8", { fatal: false }); // unknown label
    }
}

/**
 * Reads an HTML document only as far as its `</head>` (case-insensitive) or
 * `maxBytes`, whichever comes first, then cancels the stream — OpenGraph and
 * Twitter tags live in the head, and a link to a huge page must not be read
 * whole into memory. Decodes incrementally, so a multi-byte character split
 * across two chunks survives.
 */
export async function readHtmlHead(
    body: ReadableStream<Uint8Array>,
    contentType: string | null | undefined,
    maxBytes = 1_048_576,
): Promise<string> {
    const reader = body.getReader();
    let decoder: TextDecoder | null = null;
    const pending: Uint8Array[] = [];
    let pendingBytes = 0;
    let total = 0;
    let text = "";

    const feed = (chunk: Uint8Array, final: boolean): void => {
        text += decoder!.decode(chunk, { stream: !final });
    };
    const decide = (): void => {
        const joined = Buffer.concat(pending.map((c) => Buffer.from(c)));
        decoder = makeDecoder(sniffCharset(contentType, joined));
    };

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value || value.length === 0) continue;
            total += value.length;
            if (!decoder) {
                pending.push(value);
                pendingBytes += value.length;
                if (pendingBytes >= 1024) {
                    decide();
                    for (const c of pending) feed(c, false);
                    pending.length = 0;
                }
            } else {
                feed(value, false);
            }
            const end = text.toLowerCase().indexOf("</head>");
            if (end !== -1) return text.slice(0, end + "</head>".length);
            if (total >= maxBytes) break;
        }
        if (!decoder) {
            decide();
            for (const c of pending) feed(c, false);
        }
        text += decoder!.decode(); // flush
        const end = text.toLowerCase().indexOf("</head>");
        return end !== -1 ? text.slice(0, end + "</head>".length) : text;
    } finally {
        // Never leave the socket open on a body we stopped reading.
        reader.cancel().catch(() => undefined);
    }
}

// ── Cache ───────────────────────────────────────────────────────────────────

/** A bounded least-recently-used map whose entries also expire. `undefined` means "not cached". */
export class TtlLru<V> {
    private readonly entries = new Map<string, { value: V; expiresAt: number }>();

    constructor(
        private readonly max: number,
        private readonly now: () => number = Date.now,
    ) {}

    get(key: string): V | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= this.now()) {
            this.entries.delete(key);
            return undefined;
        }
        // Refresh recency: re-insert at the end.
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value;
    }

    set(key: string, value: V, ttlMs: number): void {
        this.entries.delete(key);
        this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
        while (this.entries.size > this.max) {
            const oldest = this.entries.keys().next().value as string;
            this.entries.delete(oldest);
        }
    }

    get size(): number {
        return this.entries.size;
    }
}

/** How long a preview result stays cached. */
export const PREVIEW_TTL_MS = {
    success: 6 * 60 * 60 * 1000,
    /** A fixer's direct video URL is signed and expires. */
    video: 30 * 60 * 1000,
    failure: 10 * 60 * 1000,
} as const;
