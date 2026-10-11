/**
 * Encrypted connections (PRD 18.3) — the PURE half: how a typed server
 * address is parsed, and which scheme to connect with given what a probe of
 * the server found. No Electron/DOM/network imports, so it is unit-tested in
 * plain Node (`scripts/tls-trust-smoke.mjs`) and imported by `preload.ts`.
 *
 * The decision rules mirror what an SSH client does with host keys:
 *   - a server with a certificate a public authority vouches for just works;
 *   - an unknown/self-signed certificate is shown to the user once and, if
 *     trusted, PINNED by its fingerprint;
 *   - a pinned server presenting a different certificate is refused;
 *   - a server that has ever been reached over HTTPS is never silently
 *     downgraded to plain HTTP afterwards.
 */

export type Scheme = "https" | "http";

export interface ServerAddress {
    /** `null` = the user typed no scheme (HTTPS is tried first). */
    scheme: Scheme | null;
    /** Lower-cased, IPv6 without brackets. */
    host: string;
    port: number | undefined;
}

export type ParsedAddress = { ok: true; value: ServerAddress } | { ok: false; error: string };

const SCHEME_MAP: Record<string, Scheme> = { http: "http", https: "https", ws: "http", wss: "https" };

/**
 * Parses what the user typed into the server box. Accepts `host`, `host:port`,
 * `[::1]:9800` and an optional `http://`, `https://`, `ws://` or `wss://`
 * prefix (and a trailing slash). Anything with a path, query, fragment or
 * credentials is refused with a message — Reson8 is served at the root.
 */
export function parseServerAddress(raw: string): ParsedAddress {
    const text = (raw ?? "").trim();
    if (!text) return { ok: false, error: "Enter a server address" };
    if (/\s/.test(text)) return { ok: false, error: "A server address can't contain spaces" };

    let scheme: Scheme | null = null;
    let rest = text;
    const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text);
    if (schemeMatch) {
        const mapped = SCHEME_MAP[schemeMatch[1].toLowerCase()];
        if (!mapped) {
            return { ok: false, error: `Unsupported address scheme "${schemeMatch[1]}://" — use http:// or https://` };
        }
        scheme = mapped;
        rest = text.slice(schemeMatch[0].length);
    }
    if (!rest) return { ok: false, error: "Enter a server address" };

    // `URL` drops a port equal to the scheme's default (":80" on http) and
    // throws on an out-of-range one, but the user typed it on purpose and
    // deserves a specific message — so read and validate it from the text.
    const authority = rest.split(/[/?#]/, 1)[0];
    const portMatch = /:(\d+)$/.exec(authority);
    let port: number | undefined;
    if (portMatch) {
        port = Number(portMatch[1]);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            return { ok: false, error: "The port must be a number between 1 and 65535" };
        }
    } else if (/:$/.test(authority)) {
        return { ok: false, error: "The port is missing after the colon" };
    }

    let url: URL;
    try {
        url = new URL(`http://${rest}`);
    } catch {
        return { ok: false, error: "That doesn't look like a valid server address" };
    }
    if (url.username || url.password) {
        return { ok: false, error: "Don't put a username or password in the server address" };
    }
    if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
        return { ok: false, error: "Enter only the server address, e.g. chat.example.com:9800" };
    }

    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!host) return { ok: false, error: "Enter a server address" };
    return { ok: true, value: { scheme, host, port } };
}

/** `host:port` key (IPv6 bracketed) used for pins and the HTTPS memory. */
export function hostKey(host: string, port: number): string {
    return `${host.includes(":") ? `[${host}]` : host}:${port}`;
}

/**
 * The host string the identity proof is signed for and `AUTH_ALLOWED_HOSTS`
 * lists (PRD 17.12): the address as typed, WITHOUT scheme, with the port only
 * when one was typed — exactly what 2.6.0 produced, so bound identities and
 * allow-lists keep matching. (IPv6 is bracketed, as in a URL.)
 */
export function identityHostOf(address: Pick<ServerAddress, "host" | "port">): string {
    const host = address.host.includes(":") ? `[${address.host}]` : address.host;
    return address.port ? `${host}:${address.port}` : host;
}

// ── Probe results and the decision ──────────────────────────────────────────

export interface CertInfo {
    /** SHA-256 of the DER certificate: lower-case hex, no separators. */
    fingerprint256: string;
    subject: string;
    issuer: string;
    /** ISO date. */
    validTo: string;
    sans: string[];
}

export type ProbeResult =
    /** A public authority vouches for the certificate and the name matches. */
    | { kind: "trusted"; cert: CertInfo }
    /** Reachable over TLS but the certificate isn't publicly trusted. */
    | { kind: "untrusted"; cert: CertInfo; reason: string }
    /** The port answered but doesn't speak TLS (a plain HTTP server). */
    | { kind: "no-tls" }
    /** Nothing answered (refused, DNS failure, timeout). */
    | { kind: "unreachable"; code: string };

export type SchemeDecision =
    | { action: "connect"; scheme: "https"; pinned: boolean }
    | { action: "connect"; scheme: "http"; warn: true }
    | { action: "ask-trust"; cert: CertInfo }
    | { action: "pin-mismatch"; cert: CertInfo; pinnedFingerprint: string }
    | { action: "error"; message: string };

export interface SchemeDecisionInput {
    /** What the user typed (`null` = no scheme). */
    explicit: Scheme | null;
    /** `null` only when `explicit === "http"` (no probe is made). */
    probe: ProbeResult | null;
    /** The pinned fingerprint for this host:port, or null. */
    pinnedFingerprint: string | null;
    /** This host:port was reached over HTTPS before. */
    httpsRemembered: boolean;
}

export function decideScheme(input: SchemeDecisionInput): SchemeDecision {
    const { explicit, probe, pinnedFingerprint, httpsRemembered } = input;

    // An explicit http:// is always honored, and needs no probe.
    if (explicit === "http") return { action: "connect", scheme: "http", warn: true };
    if (!probe) return { action: "error", message: "Couldn't check the server's encryption" };

    switch (probe.kind) {
        case "trusted":
            return { action: "connect", scheme: "https", pinned: false };

        case "untrusted":
            if (pinnedFingerprint === null) return { action: "ask-trust", cert: probe.cert };
            if (pinnedFingerprint === probe.cert.fingerprint256) {
                return { action: "connect", scheme: "https", pinned: true };
            }
            return { action: "pin-mismatch", cert: probe.cert, pinnedFingerprint };

        case "no-tls":
            if (explicit === "https") {
                return {
                    action: "error",
                    message:
                        "This server doesn't support encrypted connections. Type http:// to connect without encryption.",
                };
            }
            if (httpsRemembered) {
                return {
                    action: "error",
                    message:
                        "This server was encrypted before and now isn't — refusing to connect unencrypted. " +
                        "If you know why, type http:// explicitly.",
                };
            }
            return { action: "connect", scheme: "http", warn: true };

        case "unreachable":
            return { action: "error", message: `Couldn't reach the server (${probe.code})` };
    }
}

/** `AB:CD:EF…` for display and comparison by eye. */
export function formatFingerprint(hex: string): string {
    return hex
        .replace(/[^0-9a-f]/gi, "")
        .toUpperCase()
        .replace(/(.{2})(?=.)/g, "$1:");
}

/** True for a plausible SHA-256 hex fingerprint (what the store and IPC accept). */
export function isFingerprint(value: unknown): value is string {
    return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
