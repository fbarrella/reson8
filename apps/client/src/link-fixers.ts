/**
 * Social-media link "fixers" (PRD 17.9).
 *
 * A PURE module (no Electron imports) so it can be exercised in plain Node
 * (`scripts/link-fixers-smoke.mjs`). `main.ts` uses it before the normal
 * link-preview flow.
 *
 * Fixer services (FxTwitter and its cousins) re-serve a post's page with
 * embed-friendly metadata, usually including a DIRECT video URL, which the
 * preview card can then play inline. Only the hosts below are rewritten;
 * matching is on the exact parsed hostname, never a substring, so a
 * look-alike such as `notyoutube.com` or `youtube.com.evil.net` never matches.
 */

export interface FixerTarget {
    /** The URL to ask the fixer service for. */
    fixerUrl: string;
    /** The fixer's host — a response that redirected away from it doesn't count. */
    fixerHost: string;
    /** The real network's name, shown as the card's site name instead of the
     *  fixer's own og:site_name (which fixers fill with stats and branding). */
    network: string;
}

interface FixerRule {
    network: string;
    hosts: readonly string[];
    fixerHost: string;
    /** Rewrites the path when a plain host swap isn't enough. */
    path?: (pathname: string) => string;
}

const RULES: readonly FixerRule[] = [
    // Verified 07/10/2026: /watch?v=, /<id> (youtu.be form) and /shorts/<id> all work.
    { network: "YouTube", hosts: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"], fixerHost: "koutube.com" },
    {
        network: "X",
        hosts: ["twitter.com", "www.twitter.com", "mobile.twitter.com", "x.com", "www.x.com", "mobile.x.com"],
        fixerHost: "fxtwitter.com",
    },
    { network: "Instagram", hosts: ["instagram.com", "www.instagram.com"], fixerHost: "oginstagram.com" },
    {
        network: "Reddit",
        hosts: ["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com", "m.reddit.com"],
        fixerHost: "vxreddit.com",
    },
    { network: "Twitch", hosts: ["twitch.tv", "www.twitch.tv", "m.twitch.tv"], fixerHost: "fxtwitch.seria.moe" },
    // clips.twitch.tv/<slug> → /clip/<slug> (verified 07/10/2026).
    { network: "Twitch", hosts: ["clips.twitch.tv"], fixerHost: "fxtwitch.seria.moe", path: (p) => `/clip${p}` },
    { network: "Bluesky", hosts: ["bsky.app", "www.bsky.app"], fixerHost: "vxbsky.app" },
    // Not i.imgur.com: those are direct images already.
    { network: "Imgur", hosts: ["imgur.com", "www.imgur.com", "m.imgur.com"], fixerHost: "imgurez.com" },
];

/**
 * The fixer URL for a link on a supported network, or null (any other link
 * keeps the normal preview flow). The path and query are kept, the fragment is
 * dropped, and only plain http(s) links without credentials qualify.
 */
export function toFixerUrl(original: string): FixerTarget | null {
    let url: URL;
    try {
        url = new URL(original);
    } catch {
        return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;

    const host = url.hostname.toLowerCase();
    const rule = RULES.find((r) => r.hosts.includes(host));
    if (!rule) return null;

    const pathname = rule.path ? rule.path(url.pathname) : url.pathname;
    if (pathname === "/" && !url.search) return null; // a bare homepage has nothing to fix
    return { fixerUrl: `https://${rule.fixerHost}${pathname}${url.search}`, fixerHost: rule.fixerHost, network: rule.network };
}

/**
 * The User-Agent for fixer requests. The services only serve embed metadata
 * to recognized link-preview crawlers: verified 07/10/2026 that vxreddit
 * redirected our plain `Reson8Bot` UA to reddit.com, and served metadata once
 * the UA also carried the `Discordbot/2.0` token (fxtwitter accepted both; a
 * normal browser UA makes fxtwitter redirect to x.com). Used for fixer hosts
 * only — every other request keeps the existing UA.
 */
export const FIXER_USER_AGENT =
    "Mozilla/5.0 (compatible; Reson8Bot/1.0; Discordbot/2.0; +https://github.com/fbarrella/reson8)";

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00A0" };

/**
 * Decodes HTML character references in a meta-tag value — `&amp;`,
 * `&#39;`, `&#x1F441;` — which a regex-extracted og: value still contains.
 * Unknown named references and invalid code points are left as they are.
 */
export function decodeHtmlEntities(text: string): string {
    return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, (match, ref: string) => {
        if (ref[0] === "#") {
            const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
            return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
                ? String.fromCodePoint(code)
                : match;
        }
        return NAMED_ENTITIES[ref.toLowerCase()] ?? match;
    });
}

/** The display domain of a link ("www." dropped), or undefined. */
export function displayDomain(original: string): string | undefined {
    try {
        return new URL(original).hostname.replace(/^www\./, "");
    } catch {
        return undefined;
    }
}
