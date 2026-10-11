/**
 * The plain-HTTP half of link previews (PRD 18.10) — ELECTRON-FREE, so it is
 * exercised in plain Node by `scripts/link-preview-smoke.mjs`; `main.ts` keeps
 * only the IPC, the cache orchestration and the hidden-window fallback.
 *
 * What changed from the PRD 14.8/17.9 version:
 *   - one overall deadline covers connect, headers AND the body (the old
 *     timer was cleared as soon as headers arrived);
 *   - redirects are followed by hand, every hop re-validated;
 *   - requests go through an `undici` Agent whose DNS lookup refuses private
 *     addresses, so a public name can't be pointed at the reader's own network;
 *   - only the HTML head is read (to `</head>`, at most 1 MB); an `image/*`
 *     response becomes a direct-image preview without reading the body; any
 *     other content type is "not HTML" and must not escalate to the hidden
 *     browser window.
 */

import { Agent, fetch as undiciFetch } from "undici";
import metascraperModule from "metascraper";
import metascraperTitle from "metascraper-title";
import metascraperDescription from "metascraper-description";
import metascraperImage from "metascraper-image";
import metascraperUrl from "metascraper-url";
import metascraperVideo from "metascraper-video";
import { PLAIN_CRAWLER_USER_AGENT, decodeHtmlEntities } from "./link-fixers";
import { detectAdult, extractNamedMeta } from "./link-preview-adult";
import { checkPreviewUrl, guardedLookup, nextRedirectUrl, readHtmlHead } from "./link-preview-guard";
import { routeFromProbe } from "./media-proxy";

const metascraper = metascraperModule([
    metascraperTitle(),
    metascraperDescription(),
    metascraperImage(),
    metascraperUrl(),
    metascraperVideo(),
]);

export interface LinkPreviewData {
    /** Absent = a normal page card; "image" = the link IS an image (PRD 18.10). */
    kind?: "page" | "image";
    title?: string;
    description?: string;
    image?: string;
    video?: string;
    videoType?: string;
    url?: string;
    domain?: string;
    siteName?: string;
    /** The site itself marks this as adult content (PRD 18.11). Client-only, not on the wire. */
    adult?: boolean;
    /** The media's declared size (PRD 18.12), so the card can reserve its box before it loads. */
    mediaWidth?: number;
    mediaHeight?: number;
}

/** A declared pixel size: a positive whole number, at most 10 000. */
export function parseDimension(raw: string | undefined): number | undefined {
    if (!raw || !/^\s*\d{1,5}\s*$/.test(raw)) return undefined;
    const n = parseInt(raw, 10);
    return n > 0 && n <= 10000 ? n : undefined;
}

/** The declared size of the media the card will show (the video when there is one, else the image). */
export function mediaSizeFromTags(
    ogTags: Record<string, string>,
    hasVideo: boolean,
): { mediaWidth?: number; mediaHeight?: number } {
    const pairs = hasVideo
        ? [
              ["og:video:width", "og:video:height"],
              ["twitter:player:width", "twitter:player:height"],
          ]
        : [["og:image:width", "og:image:height"]];
    for (const [w, h] of pairs) {
        const width = parseDimension(ogTags[w]);
        const height = parseDimension(ogTags[h]);
        if (width && height) return { mediaWidth: width, mediaHeight: height };
    }
    return {};
}

/** The link answered, but not with HTML or an image — never worth a browser window. */
export const NOT_HTML = Symbol("not-html");

export const FETCH_DEADLINE_MS = 8000;
export const MAX_REDIRECTS = 5;
const MAX_HEAD_BYTES = 1_048_576;
const MAX_DIRECT_IMAGE_BYTES = 20 * 1024 * 1024;

const DEFAULT_UA = PLAIN_CRAWLER_USER_AGENT;

const previewAgent = new Agent({ connect: { lookup: guardedLookup as never, timeout: 5000 } });
/** Tests only: reaches loopback servers (the guard refuses them in production). */
const permissiveAgent = new Agent({ connect: { timeout: 5000 } });

export function sanitizeText(text: string | undefined | null): string | undefined {
    if (!text) return undefined;
    return text.replace(/<[^>]*>/g, "").trim() || undefined;
}

export function isValidImageUrl(url: string | undefined | null): boolean {
    if (!url) return false;
    return url.startsWith("http://") || url.startsWith("https://");
}

/** Extract OpenGraph meta tags from HTML as a fallback when metascraper returns incomplete data. */
export function extractOgTags(html: string): Record<string, string> {
    const tags: Record<string, string> = {};
    const regex = /<meta\s+(?:property|name)=["'](og:[^"']+|twitter:[^"']+)["']\s+content=["']([^"']*)["']\s*\/?>/gi;
    const reverseRegex = /<meta\s+content=["']([^"']*)["']\s+(?:property|name)=["'](og:[^"']+|twitter:[^"']+)["']\s*\/?>/gi;

    // Values are decoded (PRD 17.9): a regex-extracted attribute still holds
    // HTML character references (`&amp;`, `&#x1F441;`), which the card would
    // otherwise show literally.
    let match;
    while ((match = regex.exec(html)) !== null) {
        tags[match[1].toLowerCase()] = decodeHtmlEntities(match[2]);
    }
    while ((match = reverseRegex.exec(html)) !== null) {
        tags[match[2].toLowerCase()] = decodeHtmlEntities(match[1]);
    }
    return tags;
}

function domainOf(url: string): string | undefined {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return undefined;
    }
}

export interface RawFetchOptions {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    /** How long to wait for the response HEADERS (the body then streams without a deadline). */
    headersTimeoutMs?: number;
    /** Test-only: allow loopback/private targets. */
    allowPrivate?: boolean;
}

/**
 * One guarded request for something that must STREAM (a video): the same
 * private-network rules and manual, re-validated redirects as the preview
 * fetch, but only the response headers are under a deadline. Returns null when
 * a hop is refused, a redirect loop/limit is hit or the request fails. The
 * caller owns the body (read it or cancel it).
 */
export async function guardedFetchRaw(
    url: string,
    opts: RawFetchOptions = {},
): Promise<{ res: Awaited<ReturnType<typeof undiciFetch>>; url: string } | null> {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), opts.headersTimeoutMs ?? 15000);
    try {
        const dispatcher = opts.allowPrivate ? permissiveAgent : previewAgent;
        let current = url;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            if (!opts.allowPrivate && !checkPreviewUrl(current).ok) return null;
            const res = await undiciFetch(current, {
                dispatcher,
                redirect: "manual",
                signal: controller.signal,
                headers: { "User-Agent": PLAIN_CRAWLER_USER_AGENT, ...(opts.headers ?? {}) },
            });
            if (res.status >= 300 && res.status < 400) {
                const location = res.headers.get("location");
                await res.body?.cancel().catch(() => undefined);
                if (!location || hop === MAX_REDIRECTS) return null;
                const next = opts.allowPrivate ? new URL(location, current).href : nextRedirectUrl(current, location);
                if (!next) return null;
                current = next;
                continue;
            }
            return { res, url: current };
        }
        return null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer); // the body is NOT under this deadline
        opts.signal?.removeEventListener("abort", onAbort);
    }
}

/**
 * Asks a host how it answers the request a `<video>` makes FIRST (`Range:
 * bytes=0-`, open-ended from zero) and says whether the media proxy would
 * help. Only the headers are read; the body is cancelled at once. NOT
 * `bytes=0-0`: the Invidious hosts behind the YouTube fixer answer that with a
 * proper 206 and only misbehave for the open-ended request (verified
 * 10/10/2026), so a tiny probe would wrongly call them fine.
 */
export async function probeRangeRoute(url: string, opts: { allowPrivate?: boolean } = {}): Promise<"direct" | "proxy"> {
    const got = await guardedFetchRaw(url, {
        headers: { Range: "bytes=0-" },
        headersTimeoutMs: 8000,
        allowPrivate: opts.allowPrivate,
    });
    if (!got) return "direct";
    const headers: Record<string, string> = {};
    got.res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
    await got.res.body?.cancel().catch(() => undefined);
    return routeFromProbe({ status: got.res.status, headers });
}

export interface FastFetchOptions {
    userAgent?: string;
    /** A link-fixer request (PRD 17.9): the FINAL host must match and media is mandatory. */
    strict?: { expectedHost: string };
    /** Test-only: allow loopback/private targets and a custom deadline. */
    allowPrivate?: boolean;
    deadlineMs?: number;
}

/**
 * Fast preview path. Resolves to the preview, `null` (nothing usable — the
 * caller may escalate to the hidden window) or `NOT_HTML` (it answered, with
 * something that is neither — don't escalate). Never throws.
 */
export async function fetchLinkPreviewFast(
    url: string,
    opts: FastFetchOptions = {},
): Promise<LinkPreviewData | null | typeof NOT_HTML> {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), opts.deadlineMs ?? FETCH_DEADLINE_MS);
    try {
        const dispatcher = opts.allowPrivate ? permissiveAgent : previewAgent;
        let current = url;
        let response: Awaited<ReturnType<typeof undiciFetch>> | null = null;

        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            if (!opts.allowPrivate) {
                const check = checkPreviewUrl(current);
                if (!check.ok) return null;
            }
            const res = await undiciFetch(current, {
                dispatcher,
                redirect: "manual",
                signal: controller.signal,
                headers: {
                    // Bot-like UA so embed-focused sites (fxtwitter, etc.) serve OG tags
                    "User-Agent": opts.userAgent ?? DEFAULT_UA,
                    Accept: "text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5",
                },
            });
            if (res.status >= 300 && res.status < 400) {
                const location = res.headers.get("location");
                await res.body?.cancel().catch(() => undefined);
                if (!location || hop === MAX_REDIRECTS) return null;
                const next = opts.allowPrivate ? new URL(location, current).href : nextRedirectUrl(current, location);
                if (!next) return null;
                current = next;
                continue;
            }
            response = res;
            break;
        }
        if (!response) return null;

        if (!response.ok) {
            await response.body?.cancel().catch(() => undefined);
            return null;
        }
        if (opts.strict) {
            let finalHost = "";
            try {
                finalHost = new URL(current).hostname.toLowerCase();
            } catch { /* leave empty → refused */ }
            if (finalHost !== opts.strict.expectedHost) {
                await response.body?.cancel().catch(() => undefined);
                return null;
            }
        }

        const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();

        // A direct image link: show the image itself, without downloading it.
        if (contentType.startsWith("image/") && contentType !== "image/svg+xml") {
            const length = Number(response.headers.get("content-length"));
            await response.body?.cancel().catch(() => undefined);
            if (Number.isFinite(length) && length > MAX_DIRECT_IMAGE_BYTES) return null;
            if (opts.strict) return null; // a fixer must return a page that names its media
            return { kind: "image", image: current, url, domain: domainOf(url) };
        }

        const isHtml = contentType === "" || contentType === "text/html" || contentType === "application/xhtml+xml";
        if (!isHtml) {
            await response.body?.cancel().catch(() => undefined);
            return NOT_HTML;
        }
        if (!response.body) return null;

        const html = await readHtmlHead(
            response.body as unknown as ReadableStream<Uint8Array>,
            response.headers.get("content-type"),
            MAX_HEAD_BYTES,
        );
        const metadata = await metascraper({ html, url });

        let title = sanitizeText(metadata.title);
        let rawDesc = sanitizeText(metadata.description);
        let image = isValidImageUrl(metadata.image) ? metadata.image : undefined;
        let video = isValidImageUrl(metadata.video) ? metadata.video : undefined;

        // Manual OG tag fallback — extract if metascraper missed key fields
        const ogTags = extractOgTags(html);

        if (!title) {
            title = sanitizeText(ogTags["og:title"] || ogTags["twitter:title"]);
        }
        if (!rawDesc) {
            rawDesc = sanitizeText(ogTags["og:description"] || ogTags["twitter:description"]);
        }
        if (!image) {
            const ogImage = ogTags["og:image"] || ogTags["twitter:image"] || ogTags["twitter:image:src"];
            if (isValidImageUrl(ogImage)) image = ogImage;
        }
        if (!video) {
            const ogVideo = ogTags["og:video:url"] || ogTags["og:video:secure_url"] || ogTags["og:video"];
            if (isValidImageUrl(ogVideo)) video = ogVideo;
        }
        const videoType = ogTags["og:video:type"] || undefined;
        const siteName = sanitizeText(ogTags["og:site_name"]) || undefined;

        const description = rawDesc && rawDesc.length > 200 ? rawDesc.slice(0, 200) + "…" : rawDesc;

        const result: LinkPreviewData = {
            title,
            description,
            image,
            video,
            videoType,
            url: metadata.url || url,
            domain: domainOf(url),
            siteName,
            ...(detectAdult({ ogTags, metaByName: extractNamedMeta(html, ["rating"]) }) ? { adult: true } : {}),
            ...mediaSizeFromTags(ogTags, !!video),
        };

        // A fixer must deliver media — that's its whole point (PRD 17.9).
        if (opts.strict) return image || video ? result : null;
        // Only a genuine result if we got at least a title or image
        return title || image ? result : null;
    } catch {
        return null;
    } finally {
        clearTimeout(deadline);
    }
}
