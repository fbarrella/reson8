/**
 * App version parsing and comparison (PRD 19 R0).
 *
 * A PURE module — no Electron/DOM imports — so it can be exercised in plain
 * Node (see `scripts/app-version-smoke.mjs`). `main.ts` uses it to decide
 * whether this build follows the beta update line, and `preload.ts` exposes
 * `compareVersions` to the renderer for the client/server version-mismatch
 * warning (the old renderer comparer split on "." and produced NaN for
 * "3.0.0-beta.1").
 *
 * Precedence follows Semantic Versioning 2.0.0 §11: major/minor/patch
 * numerically; a version without a prerelease part ranks above the same
 * version with one (3.0.0 > 3.0.0-beta.9); prerelease identifiers compare
 * left to right, numeric ones numerically (beta.10 > beta.9), a numeric one
 * below an alphanumeric one, and a longer list wins when every earlier
 * identifier is equal. Build metadata ("+…") is not accepted.
 */

export interface ParsedVersion {
    major: number;
    minor: number;
    patch: number;
    /** Prerelease identifiers, numeric ones as numbers: "beta.2" → ["beta", 2]. Empty for a release. */
    pre: (string | number)[];
}

const VERSION_SHAPE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** Strict `X.Y.Z` or `X.Y.Z-pre.release` (a leading "v" is allowed); anything else → null. */
export function parseVersion(v: string): ParsedVersion | null {
    if (typeof v !== "string") return null;
    const m = VERSION_SHAPE.exec(v.trim());
    if (!m) return null;
    const pre = m[4] === undefined ? [] : m[4].split(".").map((id) => (/^\d+$/.test(id) ? Number(id) : id));
    return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre };
}

function compareIdentifiers(a: string | number, b: string | number): number {
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (typeof a === "number") return -1; // numeric < alphanumeric
    if (typeof b === "number") return 1;
    return a < b ? -1 : a > b ? 1 : 0;
}

/** <0 when a < b, 0 when equal, >0 when a > b — or null if either side is unparseable. */
export function compareVersions(a: string, b: string): number | null {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    if (!pa || !pb) return null;
    for (const key of ["major", "minor", "patch"] as const) {
        if (pa[key] !== pb[key]) return pa[key] - pb[key];
    }
    if (pa.pre.length === 0 || pb.pre.length === 0) {
        // A release ranks above any prerelease of the same version.
        return pb.pre.length - pa.pre.length;
    }
    const n = Math.min(pa.pre.length, pb.pre.length);
    for (let i = 0; i < n; i++) {
        const diff = compareIdentifiers(pa.pre[i], pb.pre[i]);
        if (diff !== 0) return diff;
    }
    return pa.pre.length - pb.pre.length;
}

/** True for a parseable version with a prerelease part ("3.0.0-beta.1"). */
export function isPrerelease(v: string): boolean {
    const parsed = parseVersion(v);
    return parsed !== null && parsed.pre.length > 0;
}

/** The prerelease line a version belongs to ("beta" for "3.0.0-beta.2"), or null for a release. */
export function prereleaseChannel(v: string): string | null {
    const parsed = parseVersion(v);
    if (!parsed || parsed.pre.length === 0) return null;
    return String(parsed.pre[0]);
}
