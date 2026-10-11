/**
 * Adult-content detection for link previews (PRD 18.11) — PURE, tested in
 * plain Node by `scripts/link-preview-smoke.mjs`.
 *
 * Only signals a site actually publishes are used:
 *   - `og:restrictions:age` ≥ 18 (YouTube emits it for age-restricted videos);
 *   - the standard `<meta name="rating">` labels: adult, mature, restricted,
 *     and the RTA label (RTA-5042-1996-1400-1577-RTA).
 * A site-specific signal (e.g. Reddit's over_18) is deliberately NOT guessed:
 * it is added only once seen in a real response.
 */

const ADULT_RATINGS = new Set(["adult", "mature", "restricted", "rta-5042-1996-1400-1577-rta"]);

export interface AdultMeta {
    /** Lower-cased OpenGraph/Twitter tags (`extractOgTags()`). */
    ogTags: Record<string, string>;
    /** Lower-cased `<meta name=…>` values (`extractNamedMeta()`). */
    metaByName: Record<string, string>;
}

export function detectAdult(meta: AdultMeta): boolean {
    const age = meta.ogTags["og:restrictions:age"];
    if (typeof age === "string") {
        const n = parseInt(age.trim(), 10);
        if (Number.isFinite(n) && n >= 18) return true;
    }
    const rating = meta.metaByName["rating"];
    if (typeof rating === "string") {
        // A label may list several values ("adult, mature").
        for (const part of rating.toLowerCase().split(/[,;]/)) {
            if (ADULT_RATINGS.has(part.trim())) return true;
        }
    }
    return false;
}

/**
 * `<meta name="…" content="…">` values for the given names, both attribute
 * orders, names matched case-insensitively. Separate from `extractOgTags()`
 * so that function's output is untouched.
 */
export function extractNamedMeta(html: string, names: readonly string[]): Record<string, string> {
    const wanted = new Set(names.map((n) => n.toLowerCase()));
    const out: Record<string, string> = {};
    const forward = /<meta\s+name=["']([^"']+)["']\s+content=["']([^"']*)["']\s*\/?>/gi;
    const reverse = /<meta\s+content=["']([^"']*)["']\s+name=["']([^"']+)["']\s*\/?>/gi;
    let m: RegExpExecArray | null;
    while ((m = forward.exec(html)) !== null) {
        const key = m[1].toLowerCase();
        if (wanted.has(key)) out[key] = m[2];
    }
    while ((m = reverse.exec(html)) !== null) {
        const key = m[2].toLowerCase();
        if (wanted.has(key)) out[key] = m[1];
    }
    return out;
}
