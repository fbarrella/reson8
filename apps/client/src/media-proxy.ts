/**
 * The pure half of the link-preview video proxy (PRD 18.19) — no Electron, no
 * network, tested in plain Node by `scripts/media-proxy-smoke.mjs`.
 *
 * Why a proxy exists at all: Chromium decides whether a `<video>` can seek
 * from the FIRST response to its `Range: bytes=0-` request. Some hosts (the
 * Invidious servers behind the YouTube fixer) answer that first request with
 * `200` + a `Content-Range` header and no `Accept-Ranges`; Chromium reads the
 * `200` as "this server ignores ranges" and the progress bar can't seek. The
 * main process re-serves such a video with the answer normalized to what it
 * really is: a ranged `206`.
 */

export interface UpstreamHead {
    status: number;
    /** Lower-case header names. */
    headers: Record<string, string>;
}

export interface ContentRange {
    start: number;
    end: number;
    total: number | null;
}

/** Only these upstream headers are passed on; everything else (set-cookie, …) is dropped. */
export const SAFE_RESPONSE_HEADERS = [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "cache-control",
    "last-modified",
    "etag",
] as const;

/** `bytes=0-`, `bytes=100-199`, `bytes=-500` — nothing else is forwarded upstream. */
export function isValidRangeHeader(value: string | null | undefined): value is string {
    return typeof value === "string" && value.length <= 64 && /^bytes=\d*-\d*$/.test(value) && value !== "bytes=-";
}

/** Parses `bytes 0-1023/2048` (or `/*`). Null for anything else, including `*\/total`. */
export function parseContentRange(value: string | undefined): ContentRange | null {
    if (typeof value !== "string") return null;
    const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim());
    if (!m) return null;
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
    return { start, end, total: m[3] === "*" ? null : Number(m[3]) };
}

function pickSafe(headers: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const name of SAFE_RESPONSE_HEADERS) {
        const v = headers[name];
        if (typeof v === "string") out[name] = v;
    }
    return out;
}

/**
 * Decides the status/headers Chromium gets for a request that carried
 * `requestRange` (null when the request had no Range header).
 *   upstream 206                                  → pass through (ensure Accept-Ranges)
 *   upstream 200 + Content-Range for a ranged req → 206 with that range, length from it
 *   upstream 200 without range information        → pass through: that host really can't seek
 *   anything else                                 → pass through
 */
export function normalizeRangeResponse(
    requestRange: string | null,
    up: UpstreamHead,
): { status: number; headers: Record<string, string> } {
    const headers = pickSafe(up.headers);

    if (up.status === 206) {
        headers["accept-ranges"] = "bytes";
        return { status: 206, headers };
    }

    if (up.status === 200 && requestRange) {
        const range = parseContentRange(up.headers["content-range"]);
        if (range) {
            headers["content-range"] = up.headers["content-range"];
            headers["content-length"] = String(range.end - range.start + 1);
            headers["accept-ranges"] = "bytes";
            return { status: 206, headers };
        }
    }

    return { status: up.status, headers };
}

/**
 * What the probe (`Range: bytes=0-0`) says about a host: "proxy" only when the
 * proxy would actually fix something — a `200` that carries range information.
 * A correct `206`, or a host that can't range at all, is left on the direct URL.
 */
export function routeFromProbe(up: UpstreamHead): "direct" | "proxy" {
    if (up.status === 200 && parseContentRange(up.headers["content-range"])) return "proxy";
    return "direct";
}
