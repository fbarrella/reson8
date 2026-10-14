/**
 * Choosing *which* GitHub release to update to — the PURE half.
 *
 * Why this exists: electron-updater's GitHub provider does not pick the newest
 * *version*. It walks GitHub's `releases.atom` feed in the order GitHub returns
 * it — newest release *object* first, by `created_at`, NOT newest version — and
 * takes the first entry that matches the channel. A stable release published
 * after a beta therefore shadows that beta in the feed, and beta testers are
 * never offered it (electron-builder #9894 / #7273; the fix only landed in
 * electron-updater 7.0.0-alpha, which is ESM-only and needs Node >= 22, so it
 * can't run on Electron 34's Node 20).
 *
 * So `main.ts` reads the same feed itself, picks the newest release by SEMVER
 * that the current mode allows (stable-only, or stable + pre-release), and
 * points electron-updater at that exact tag with a generic provider
 * (`applyUpdateProvider()`), keeping electron-updater's own download, checksum
 * and install path.
 *
 * No Electron/DOM imports, so it is smoke-tested in plain Node
 * (`scripts/update-release-smoke.mjs`) and imported by `main.ts`.
 */

export interface ParsedVersion {
    major: number;
    minor: number;
    patch: number;
    /** Dot-separated identifiers after `-`, e.g. `["beta", "3"]`; empty for a stable. */
    prerelease: string[];
}

// A leading `v` is allowed (GitHub tags are `v1.2.3`); build metadata (+…) is ignored.
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parses a semver string (with or without a leading `v`), or null. */
export function parseVersion(text: string): ParsedVersion | null {
    const m = VERSION_RE.exec((text ?? "").trim());
    if (!m) return null;
    return {
        major: Number(m[1]),
        minor: Number(m[2]),
        patch: Number(m[3]),
        prerelease: m[4] ? m[4].split(".") : [],
    };
}

/**
 * semver §11 precedence for the dot-separated identifiers: a version WITH a
 * prerelease sorts below the same core without one; otherwise compare
 * identifier by identifier — numeric ones numerically, numeric below
 * alphanumeric, alphanumeric ASCII-lexically, and a shorter run that is a
 * prefix of a longer one is lower.
 */
function comparePrerelease(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) {
        if (a.length === b.length) return 0;
        return a.length === 0 ? 1 : -1;
    }
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const x = a[i];
        const y = b[i];
        const xn = /^\d+$/.test(x);
        const yn = /^\d+$/.test(y);
        if (xn && yn) {
            const d = Number(x) - Number(y);
            if (d !== 0) return d < 0 ? -1 : 1;
        } else if (xn !== yn) {
            return xn ? -1 : 1; // numeric identifiers sort below alphanumeric
        } else if (x !== y) {
            return x < y ? -1 : 1;
        }
    }
    if (a.length === b.length) return 0;
    return a.length < b.length ? -1 : 1;
}

export function compareParsedVersions(a: ParsedVersion, b: ParsedVersion): number {
    if (a.major !== b.major) return a.major < b.major ? -1 : 1;
    if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
    if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
    return comparePrerelease(a.prerelease, b.prerelease);
}

/** Compares two semver strings (`-1` / `0` / `1`); throws on an invalid input. */
export function compareVersions(a: string, b: string): number {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    if (!pa || !pb) throw new Error(`Not a semver version: ${!pa ? a : b}`);
    return compareParsedVersions(pa, pb);
}

/**
 * Release tags from GitHub's `releases.atom` feed. Only `<link>` elements are
 * matched (a release's notes body is HTML-escaped, so a literal `href="` can't
 * appear inside it), and drafts never appear in the feed.
 */
export function extractReleaseTags(feedXml: string): string[] {
    const re = /<link\b[^>]*href="[^"]*\/releases\/tag\/([^"/?#]+)"/g;
    const tags: string[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(feedXml)) !== null) {
        if (!seen.has(m[1])) {
            seen.add(m[1]);
            tags.push(m[1]);
        }
    }
    return tags;
}

export interface UpdateTarget {
    /** The GitHub tag to update from, e.g. `v3.0.0-beta.3`. */
    tag: string;
    /** The normalized version, e.g. `3.0.0-beta.3`. */
    version: string;
    /** The channel-file id: the prerelease identifier (`beta`), else `latest`. */
    channel: string;
}

/**
 * The newest release by semver among those the mode allows: stable-only when
 * `allowPrerelease` is false, stable and pre-release when true. Returns null
 * when nothing qualifies.
 */
export function selectUpdateTarget(tags: string[], opts: { allowPrerelease: boolean }): UpdateTarget | null {
    let bestTag: string | null = null;
    let bestVersion: ParsedVersion | null = null;
    for (const tag of tags) {
        const parsed = parseVersion(tag);
        if (!parsed) continue;
        if (!opts.allowPrerelease && parsed.prerelease.length > 0) continue;
        if (bestVersion === null || compareParsedVersions(parsed, bestVersion) > 0) {
            bestTag = tag;
            bestVersion = parsed;
        }
    }
    if (bestTag === null || bestVersion === null) return null;
    const suffix = bestVersion.prerelease.length > 0 ? `-${bestVersion.prerelease.join(".")}` : "";
    return {
        tag: bestTag,
        version: `${bestVersion.major}.${bestVersion.minor}.${bestVersion.patch}${suffix}`,
        channel: bestVersion.prerelease[0] ?? "latest",
    };
}
