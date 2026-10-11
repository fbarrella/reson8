/**
 * Reson8 Client — Electron Main Process
 *
 * Creates the BrowserWindow and loads the renderer.
 * This is the entry point for the Electron desktop client.
 */

import { app, BrowserWindow, session, ipcMain, globalShortcut, Menu, Tray, nativeImage, shell, desktopCapturer, dialog, net, clipboard } from "electron";
import path from "node:path";
import { createHash, createPrivateKey, randomBytes } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { getInstanceId, hasExistingInstanceId, replaceInstanceId } from "./instance-id.js";
import { autoUpdater, NsisUpdater } from "electron-updater";
import { startCapture, resolvePidForWindowSourceId, listAudioProducingApps, platformSupportsCapture } from "@reson8/native-audio";
import type { CaptureHandle } from "@reson8/native-audio";
import MarkdownIt from "markdown-it";
import { loadWindowState, trackWindowState } from "./window-state.js";
import { displayDomain, toFixerUrl } from "./link-fixers.js";
import {
    createNewIdentityAfterLock,
    exportIdentityPkcs8Der,
    getIdentityPublic,
    getIdentityStatus,
    isEphemeralIdentity,
    replaceIdentityKey,
    signAuthChallenge,
} from "./identity-key.js";
import {
    BackupError,
    MAX_BACKUP_FILE_BYTES,
    decryptBackup,
    encryptBackup,
    validatePassphrase,
    type BackupPayload,
} from "./identity-backup.js";
import { fingerprintOf, publicKeyBase64 } from "./identity-proof.js";
import { TlsTrustStore } from "./tls-store.js";
import { probeServer } from "./tls-probe.js";
import { hostKey, isFingerprint, type CertInfo } from "./tls-trust.js";

// ── Single-instance lock (PRD 13.18) ────────────────────────────────────
// Requested as early as possible, before any other startup work. Opening
// the app again while one instance is already running should just focus
// the existing window rather than spawning a second, fully-independent
// instance (its own server connection, tray icon, global shortcuts, etc.
// all competing with the first). If this process didn't get the lock, an
// instance is already running elsewhere; quit immediately — calling
// app.quit() this early prevents app.whenReady() from ever resolving, so
// none of the window/tray/IPC setup further down actually runs.
// ── Windows: native window occlusion tracking (PRD 15.7, hypothesis H2) ──
// Chromium's CalculateNativeWinOcclusion can wrongly decide a window that was
// just restored from the tray/minimized state is still occluded and stop
// painting it — the window comes forward but looks frozen until it is
// minimized and restored again. Disabling the feature is the well-known
// workaround. Must be set before the app is ready; merged with any existing
// `disable-features` value rather than replacing it.
if (process.platform === "win32") {
    const existing = app.commandLine.getSwitchValue("disable-features");
    const features = new Set(existing ? existing.split(",") : []);
    features.add("CalculateNativeWinOcclusion");
    app.commandLine.appendSwitch("disable-features", [...features].join(","));
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        showMainWindow("second-instance");
    });
}

// ── Link Preview ─────────────────────────────────────────────────────────
// The plain-HTTP half (bounded fetch, private-network guard, direct images)
// lives in link-preview-fetch.ts / link-preview-guard.ts (PRD 18.10) so it can
// be tested without Electron; this file keeps the IPC, the caches and the
// hidden-window fallback.
import dns from "node:dns";
import nodeNet from "node:net";
import {
    NOT_HTML,
    fetchLinkPreviewFast,
    isValidImageUrl,
    sanitizeText,
    type LinkPreviewData,
} from "./link-preview-fetch";
import { detectAdult } from "./link-preview-adult";
import {
    PREVIEW_TTL_MS,
    TtlLru,
    checkPreviewUrl,
    isBlockedAddress,
    isBlockedHostname,
} from "./link-preview-guard";

/** URL → preview (null = attempted but failed). Bounded, and entries expire (PRD 18.10). */
const linkPreviewCache = new TtlLru<LinkPreviewData | null>(500);
/** Concurrent requests for the same link share one fetch. */
const linkPreviewInflight = new Map<string, Promise<LinkPreviewData | null>>();

interface ReleaseNotes {
    name: string;
    /** Rendered HTML, not raw markdown — the "What's New" modal used to
     *  display GitHub's raw markdown body verbatim (literal "#"/"**"/"-"
     *  syntax visible to the user); rendered here, in the main process,
     *  since markdown-it is an ordinary CommonJS package the main process
     *  can just require() directly, unlike the renderer (a plain <script>-
     *  loaded page with no module bundler to resolve a bare import into). */
    bodyHtml: string;
    htmlUrl: string;
}

const markdownRenderer = new MarkdownIt({
    html: false, // never pass through raw HTML from the release notes source
    linkify: true, // auto-link bare URLs (release notes often have them)
    breaks: true,
});

// A plain rendered <a href> without target="_blank" would navigate the
// main window itself away to that URL on click — the existing
// setWindowOpenHandler below only intercepts new-window-style navigation
// (target="_blank"/window.open()), not a same-window link click. Force
// every rendered link through that path instead, same as chat's own
// linkifyContent() already does for message links.
const defaultLinkOpenRenderer = markdownRenderer.renderer.rules.link_open ?? (
    (tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options)
);
markdownRenderer.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx].attrSet("target", "_blank");
    tokens[idx].attrSet("rel", "noopener noreferrer");
    return defaultLinkOpenRenderer(tokens, idx, options, env, self);
};

/**
 * Fetches the published GitHub release notes for a given app version (PRD
 * 11.4). Returns null on any failure (offline, rate-limited, no matching
 * tag) — the renderer treats that as "try again next launch" rather than
 * marking the version as seen, so the notification is never silently lost.
 */
async function fetchReleaseNotes(version: string): Promise<ReleaseNotes | null> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(
            `https://api.github.com/repos/fbarrella/reson8/releases/tags/v${version}`,
            {
                signal: controller.signal,
                headers: {
                    Accept: "application/vnd.github+json",
                    "User-Agent": "Mozilla/5.0 (compatible; Reson8Client/1.0; +https://github.com/fbarrella/reson8)",
                },
            },
        );
        clearTimeout(timeout);

        if (!response.ok) return null;

        const data = await response.json();
        const rawBody = typeof data.body === "string" ? data.body : "";
        return {
            name: typeof data.name === "string" && data.name ? data.name : `v${version}`,
            bodyHtml: rawBody.trim() ? markdownRenderer.render(rawBody) : "",
            htmlUrl:
                typeof data.html_url === "string"
                    ? data.html_url
                    : `https://github.com/fbarrella/reson8/releases/tag/v${version}`,
        };
    } catch {
        return null;
    }
}

/** Partition for the hidden preview window: no `persist:` prefix, so it is in memory only and shares no cookies with the app (PRD 18.10). */
const PREVIEW_PARTITION = "link-preview";
let previewSessionConfigured = false;
/** Per-host DNS verdicts for the window's own requests (true = a private address was found). */
const previewHostVerdicts = new TtlLru<boolean>(200);

async function hostResolvesToPrivate(host: string): Promise<boolean> {
    const known = previewHostVerdicts.get(host);
    if (known !== undefined) return known;
    let verdict: boolean;
    try {
        const addresses = await dns.promises.lookup(host, { all: true });
        verdict = addresses.some((a) => isBlockedAddress(a.address));
    } catch {
        verdict = false; // unresolvable: Chromium will fail the request itself
    }
    previewHostVerdicts.set(host, verdict, 60_000);
    return verdict;
}

/** One-time hardening of the preview window's session (PRD 18.10). */
function configurePreviewSession(): Electron.Session {
    const ses = session.fromPartition(PREVIEW_PARTITION);
    if (previewSessionConfigured) return ses;
    previewSessionConfigured = true;

    // Every request the page makes (redirects and subresources included) is
    // checked: literal private addresses and local names are cancelled, and a
    // name that resolves to a private address is cancelled too.
    ses.webRequest.onBeforeRequest(async (details, callback) => {
        let url: URL;
        try {
            url = new URL(details.url);
        } catch {
            callback({ cancel: false });
            return;
        }
        if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "ws:" && url.protocol !== "wss:") {
            callback({ cancel: false }); // data:, blob: — nothing leaves the machine
            return;
        }
        if (isBlockedHostname(url.hostname)) {
            callback({ cancel: true });
            return;
        }
        const literal = url.hostname.startsWith("[") || /^[\d.]+$/.test(url.hostname);
        if (!literal && (await hostResolvesToPrivate(url.hostname))) {
            callback({ cancel: true });
            return;
        }
        callback({ cancel: false });
    });
    ses.on("will-download", (event, item) => {
        event.preventDefault();
        item.cancel();
    });
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    return ses;
}

/** Real Chromium renderer instances currently fetching a fallback preview
 *  (PRD 14.8) — capped since each is a genuinely expensive full renderer
 *  process, and must never become an unbounded resource sink if several
 *  blocked links get pasted around the same time. */
const MAX_HIDDEN_WINDOW_FALLBACKS = 2;
let activeHiddenWindowFallbacks = 0;

/**
 * Fallback for sites whose plain `fetch()` gets blocked outright by
 * IP-reputation/TLS-fingerprint bot management (confirmed live against a
 * real Cloudflare-walled URL: a bot User-Agent, and even a full realistic
 * browser User-Agent, both got a 403 — this isn't a header/plugin gap,
 * it's the network layer itself being fingerprinted, which a bare HTTP
 * client can't replicate). A genuine hidden Electron `BrowserWindow` gets
 * past this "for free" — real TLS/JA3 fingerprint, real JS execution, and
 * (confirmed via the same live test) it does not expose `navigator.webdriver`
 * the way a CDP-automated browser normally would. Needs no new dependency
 * since Electron already ships a full Chromium.
 */
async function fetchLinkPreviewViaHiddenWindow(url: string): Promise<LinkPreviewData | null> {
    if (activeHiddenWindowFallbacks >= MAX_HIDDEN_WINDOW_FALLBACKS) return null;
    // Same rules as the fast path (PRD 18.10): never navigate a real browser
    // window into a private network, by address or by what a name resolves to.
    const check = checkPreviewUrl(url);
    if (!check.ok) return null;
    if (!nodeNet.isIP(check.url.hostname.replace(/^\[|\]$/g, "")) && (await hostResolvesToPrivate(check.url.hostname))) {
        return null;
    }
    activeHiddenWindowFallbacks++;

    let win: BrowserWindow | null = null;
    try {
        configurePreviewSession();
        win = new BrowserWindow({
            show: false,
            webPreferences: {
                sandbox: true,
                contextIsolation: true,
                partition: PREVIEW_PARTITION,
            },
        });
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        win.webContents.setAudioMuted(true);

        const run = async (): Promise<LinkPreviewData | null> => {
            await win!.loadURL(url);

            // A short settle delay — some bot-management challenges resolve
            // client-side just after the initial navigation completes, even
            // though none actually appeared in the live test this fallback
            // is based on.
            await new Promise((resolve) => setTimeout(resolve, 3000));

            const extracted: {
                title?: string;
                ogTitle?: string;
                ogDescription?: string;
                ogImage?: string;
                ogSiteName?: string;
                ogUrl?: string;
                ageRestriction?: string;
                rating?: string;
            } = await win!.webContents.executeJavaScript(`(() => {
                const getMeta = (selector) => document.querySelector(selector)?.getAttribute("content") || undefined;
                return {
                    title: document.title || undefined,
                    ogTitle: getMeta('meta[property="og:title"]') || getMeta('meta[name="twitter:title"]'),
                    ogDescription: getMeta('meta[property="og:description"]') || getMeta('meta[name="twitter:description"]'),
                    ogImage: getMeta('meta[property="og:image"]') || getMeta('meta[name="twitter:image"]') || getMeta('meta[name="twitter:image:src"]'),
                    ogSiteName: getMeta('meta[property="og:site_name"]'),
                    ogUrl: getMeta('meta[property="og:url"]'),
                    ageRestriction: getMeta('meta[property="og:restrictions:age"]'),
                    rating: getMeta('meta[name="rating" i]'),
                };
            })()`);

            const title = sanitizeText(extracted?.ogTitle || extracted?.title);
            const rawDesc = sanitizeText(extracted?.ogDescription);
            const image = isValidImageUrl(extracted?.ogImage) ? extracted!.ogImage : undefined;
            const description = rawDesc && rawDesc.length > 200 ? rawDesc.slice(0, 200) + "…" : rawDesc;
            const siteName = sanitizeText(extracted?.ogSiteName) || undefined;

            if (!title && !image) return null;

            let domain: string | undefined;
            try {
                domain = new URL(url).hostname.replace(/^www\./, "");
            } catch { /* ignore */ }

            const adult = detectAdult({
                ogTags: extracted?.ageRestriction ? { "og:restrictions:age": extracted.ageRestriction } : {},
                metaByName: extracted?.rating ? { rating: extracted.rating } : {},
            });
            return { title, description, image, url: extracted?.ogUrl || url, domain, siteName, ...(adult ? { adult: true } : {}) };
        };

        // Resolves to null on timeout rather than rejecting — either way
        // the caller just gets "no fallback preview available," and the
        // finally block below always destroys the window regardless of
        // which branch of the race actually settles first.
        const timeout = new Promise<null>((resolve) => {
            setTimeout(() => resolve(null), 15000);
        });

        return await Promise.race([run(), timeout]);
    } catch (err) {
        console.error("[link-preview] Hidden-window fallback failed:", err);
        return null;
    } finally {
        win?.destroy();
        activeHiddenWindowFallbacks--;
    }
}

/**
 * Orchestrates the two-tier link-preview fetch (PRD 14.8): the fast plain
 * HTTP path first (works for the vast majority of links), falling back to a
 * hidden real-browser navigation only when that path is blocked or finds
 * nothing — and never for a link that answered with something that isn't a
 * page (a video, an archive: PRD 18.10).
 */
async function fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
    const cached = linkPreviewCache.get(url);
    if (cached !== undefined) return cached;

    const running = linkPreviewInflight.get(url);
    if (running) return running;

    const job = (async (): Promise<LinkPreviewData | null> => {
        // Never request something on the reader's own network (PRD 18.10).
        if (!checkPreviewUrl(url).ok) {
            linkPreviewCache.set(url, null, PREVIEW_TTL_MS.failure);
            return null;
        }

        // Social-media "fixers" first (PRD 17.9): for YouTube, X, Instagram,
        // Reddit, Twitch, Bluesky and Imgur links, ask the matching fixer service,
        // which usually returns a DIRECT video the card can play inline. If it
        // doesn't deliver, the normal flow below runs on the ORIGINAL url,
        // exactly as for every other link.
        let result: LinkPreviewData | null = null;
        let notHtml = false;
        const fixer = toFixerUrl(url);
        if (fixer) {
            const fixed = await fetchLinkPreviewFast(fixer.fixerUrl, {
                userAgent: fixer.userAgent,
                strict: { expectedHost: fixer.fixerHost },
            });
            if (fixed && fixed !== NOT_HTML) {
                // Clicking the card opens the real post, and the card names the
                // real site — never the proxy (fixers stuff og:site_name with
                // their own branding and stats).
                result = { ...fixed, url, domain: displayDomain(url), siteName: fixer.network };
            }
        }

        if (!result) {
            const fast = await fetchLinkPreviewFast(url);
            if (fast === NOT_HTML) notHtml = true;
            else result = fast;
        }
        if (!result && !notHtml) result = await fetchLinkPreviewViaHiddenWindow(url);

        // A fixer's direct video URL is signed and expires: cache it briefly.
        const ttl = !result
            ? PREVIEW_TTL_MS.failure
            : fixer && result.video
              ? PREVIEW_TTL_MS.video
              : PREVIEW_TTL_MS.success;
        linkPreviewCache.set(url, result, ttl);
        return result;
    })();

    linkPreviewInflight.set(url, job);
    try {
        return await job;
    } finally {
        linkPreviewInflight.delete(url);
    }
}

let mainWindow: BrowserWindow | null = null;
/** webContents id of a Viewer window → its viewer ticket (PRD 17.12). */
const viewerTickets = new Map<number, string>();
let pttKey: string | null = null;

// Set by `setDisplayMediaRequestHandler` (Linux/Wayland screen-share
// bypass) right before it grants a source, since that's the only place a
// real, non-empty `DesktopCapturerSource.name` (and its screen-vs-window
// type) for the picked source is ever available — `getDisplayMedia()`'s
// resulting MediaStreamTrack.label comes back empty for portal-based
// captures, so the renderer can't read either off the stream itself. Read
// once via `get-last-screen-share-source` right after `getDisplayMedia()`
// resolves.
let lastScreenShareSource: { name: string; sourceType: "screen" | "window" } | null = null;

/**
 * Same screen-vs-window heuristic PRD 12.11/12.14's audio-share gating
 * already relies on for the Selection Modal path — `display_id` (non-empty
 * only for real monitors, per Electron's own `DesktopCapturerSource` docs)
 * checked ahead of the `id` prefix, since the prefix alone isn't reliable
 * on Linux/Wayland where every source comes back through the
 * xdg-desktop-portal picker rather than X11/Win32 enumeration.
 */
function classifySourceType(source: Electron.DesktopCapturerSource): "screen" | "window" {
    return source.display_id || source.id.toLowerCase().startsWith("screen:") ? "screen" : "window";
}

// ── System Tray State ────────────────────────────────────────────────────
let tray: Tray | null = null;
let isQuitting = false;
let minimizeToTray = false;
let closeToTray = false;
/** Set once the renderer has been asked to gracefully disconnect its
 *  socket before quitting (see the window "close" and app "before-quit"
 *  handlers below) — guards against re-triggering it on the follow-up
 *  close/quit call that actually lets the window/app finish closing. */
let hasSentQuitDisconnect = false;

/**
 * `desktopCapturer.getSources()`, raced against a timeout. On Linux/Wayland
 * a broken portal backend (e.g. xdg-desktop-portal-kde stopped) can leave
 * this promise hanging forever — neither resolving nor rejecting — so every
 * caller (the Selection Modal's source list, and the `getDisplayMedia()`
 * handler below) needs this race, not just a try/catch.
 */
function getDesktopSourcesWithTimeout(
    options: Electron.SourcesOptions,
): Promise<Electron.DesktopCapturerSource[]> {
    return Promise.race([
        desktopCapturer.getSources(options),
        new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error("Timed out waiting for screen/window sources")), 20_000);
        }),
    ]);
}

/**
 * Single code path for bringing the main window to the front (PRD 15.7) —
 * used by a second app launch, the tray icon click and the tray "Restore"
 * item, which used to be three divergent implementations (the tray ones only
 * called `show()`, never `restore()`).
 *
 * Also logs the window's state before and after: the freeze this guards
 * against could not be reproduced from the code alone, so if it ever recurs
 * the console output shows what state the window and renderer were in.
 */
function showMainWindow(source: string): void {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return;

    const snapshot = () =>
        `minimized=${win.isMinimized()} visible=${win.isVisible()} focused=${win.isFocused()} ` +
        `maximized=${win.isMaximized()} loading=${win.webContents.isLoading()} ` +
        `crashed=${win.webContents.isCrashed()}`;
    console.log(`[main] showMainWindow(${source}) before: ${snapshot()}`);

    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.moveTop();
    win.focus();

    console.log(`[main] showMainWindow(${source}) after: ${snapshot()}`);
}

// ── Encrypted connections (PRD 18.3) ─────────────────────────────────────
// Certificates the user chose to trust (pinned by SHA-256) and the servers
// reached over HTTPS live HERE, in the main process — the renderer can only
// ask, through the narrow IPC below, so it can't be tricked into pinning an
// arbitrary certificate or into downgrading a server.

let tlsStore: TlsTrustStore | null = null;
function getTlsStore(): TlsTrustStore {
    tlsStore ??= new TlsTrustStore(path.join(app.getPath("userData"), "tls-trust.json"));
    return tlsStore;
}

/** The certificate each host:port presented the last time it was probed. Only
 *  a certificate seen here, moments ago, can be pinned. */
const lastProbes = new Map<string, { cert: CertInfo; certPem: string; at: number }>();
const PIN_WINDOW_MS = 5 * 60 * 1000;

/** webContents id of a Viewer window → the server it watches (for its TLS options). */
const viewerServers = new Map<number, { host: string; port: number }>();

function validHostPort(host: unknown, port: unknown): host is string {
    return (
        typeof host === "string" &&
        host.length > 0 &&
        host.length <= 255 &&
        /^[A-Za-z0-9._:-]+$/.test(host) &&
        typeof port === "number" &&
        Number.isInteger(port) &&
        port >= 1 &&
        port <= 65535
    );
}

/** DER bytes of a PEM certificate (Chromium hands us PEM in `certificate.data`). */
function pemToDer(pem: string): Buffer {
    return Buffer.from(pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, ""), "base64");
}

/**
 * Chromium's side of a pin: the main window's uploads, images, emoji and the
 * Viewer window go through the default session. A certificate is accepted
 * here ONLY when its SHA-256 equals a pin the user created for that hostname
 * (and it hasn't expired); everything else falls through to Chromium's own
 * verdict (-3), so a bad certificate that isn't pinned still fails.
 */
function installCertificateVerifier(): void {
    session.defaultSession.setCertificateVerifyProc((request, callback) => {
        try {
            const pins = getTlsStore().pinsForHostname(request.hostname);
            if (pins.length > 0 && request.certificate.validExpiry * 1000 > Date.now()) {
                const fp = createHash("sha256").update(pemToDer(request.certificate.data)).digest("hex");
                if (pins.some((p) => p.fingerprint256 === fp)) return callback(0);
            }
        } catch (err) {
            console.error("[tls] certificate check failed:", err);
        }
        callback(-3);
    });
}

function createWindow(): void {
    installCertificateVerifier();

    // Grant mic/camera permission requests automatically
    session.defaultSession.setPermissionRequestHandler(
        (_webContents, permission, callback) => {
            const allowed = ["media", "audioCapture", "microphone"];
            callback(allowed.includes(permission));
        },
    );

    // Required for `getDisplayMedia()` in the renderer (Linux/Wayland
    // screen-share bypass) — with no handler registered at all, Electron
    // rejects `getDisplayMedia()` immediately with "Not supported"
    // (confirmed against this exact Electron version). Calling
    // `desktopCapturer.getSources()` from *inside* this handler — rather
    // than the renderer separately calling `getSources()` then
    // `getUserMedia({chromeMediaSourceId})`, as an earlier version of this
    // did — is what actually fixes the Wayland double-picker/black-feed bug
    // that approach had: `getDisplayMedia()`'s single request/callback
    // cycle correlates the picked source to the resulting stream itself,
    // instead of two independent renderer→main round trips that each
    // separately negotiated the xdg-desktop-portal ScreenCast session.
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
        try {
            const sources = await getDesktopSourcesWithTimeout({ types: ["screen", "window"] });
            const source = sources[0];
            lastScreenShareSource = source ? { name: source.name, sourceType: classifySourceType(source) } : null;
            callback(source ? { video: source } : {});
        } catch {
            lastScreenShareSource = null;
            callback({});
        }
    });

    const savedWindowState = loadWindowState({
        width: 1024,
        height: 768,
        minWidth: 800,
        minHeight: 600,
    });

    mainWindow = new BrowserWindow({
        // x/y are omitted when no safe saved position exists, so Electron
        // centers the window as before (PRD 15.6).
        x: savedWindowState.x,
        y: savedWindowState.y,
        width: savedWindowState.width,
        height: savedWindowState.height,
        minWidth: 800,
        minHeight: 600,
        title: "Reson8",
        icon: path.join(__dirname, "..", "assets", "icon.png"),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    if (savedWindowState.isMaximized) mainWindow.maximize();
    trackWindowState(mainWindow);

    mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

    // Packaged-only: check for updates shortly after the window finishes
    // loading, so it doesn't compete with initial app load. Silent on
    // failure/no-update — the found-update modal only appears when there's
    // actually something to offer (PRD 10.1).
    if (app.isPackaged) {
        mainWindow.webContents.once("did-finish-load", () => {
            setTimeout(() => {
                checkForUpdatesWithRetry();
            }, 3000);
        });
    }

    // ── Open external links in system browser ────────────────────────────
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("http://") || url.startsWith("https://")) {
            shell.openExternal(url);
        }
        return { action: "deny" };
    });

    // The main window must never navigate away from the app's own page
    // (PRD 16.10) — a dropped file or a stray link would otherwise replace the
    // whole UI with the file/page. This is defense in depth: the renderer also
    // swallows file drops, and legitimate external links already go through
    // setWindowOpenHandler above. (Not emitted for reloads or loadFile().)
    mainWindow.webContents.on("will-navigate", (event, url) => {
        if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
    });

    // ── Right-click context menu ─────────────────────────────────────────
    mainWindow.webContents.on("context-menu", (_event, params) => {
        const menu = Menu.buildFromTemplate([
            { label: "Cut",        role: "cut",       enabled: params.editFlags.canCut },
            { label: "Copy",       role: "copy",      enabled: params.editFlags.canCopy },
            { label: "Paste",      role: "paste",     enabled: params.editFlags.canPaste },
            { type: "separator" },
            { label: "Select All", role: "selectAll", enabled: params.editFlags.canSelectAll },
        ]);
        menu.popup();
    });

    // Open DevTools in development
    if (process.env.NODE_ENV === "development") {
        mainWindow.webContents.openDevTools();
    }

    // ── Close-to-tray interception ───────────────────────────────────────
    mainWindow.on("close", (event) => {
        if (closeToTray && !isQuitting) {
            event.preventDefault();
            mainWindow?.hide();
            return;
        }

        // Actually closing (the common "click the X button" quit path,
        // with close-to-tray off) — this window is destroyed before the
        // app-level "before-quit" handler below ever runs (that one only
        // catches Cmd+Q/Alt+F4, where the window is still alive when it
        // fires), so this is the interception point that matters for a
        // normal close. Same reasoning as "before-quit"'s own comment: ask
        // the renderer to gracefully disconnect its socket first, so the
        // server can finalize presence immediately instead of waiting out
        // the reconnect-grace period on every ordinary quit.
        if (!hasSentQuitDisconnect && mainWindow && !mainWindow.isDestroyed()) {
            hasSentQuitDisconnect = true;
            event.preventDefault();
            mainWindow.webContents.send("app-quitting");
            setTimeout(() => {
                isQuitting = true;
                mainWindow?.close();
            }, 250);
        }
    });

    // ── Minimize-to-tray interception ────────────────────────────────────
    // Windows/macOS: intercept `will-minimize` and hide instead, so the
    // window never enters the minimized state at all (PRD 15.7, hypothesis
    // H1). Calling `hide()` from inside the post-hoc `minimize` event — what
    // this used to do — left a window that was both minimized AND hidden,
    // which `restore()`/`show()` then had to untangle.
    (mainWindow as any).on("will-minimize", (event: Electron.Event) => {
        if (!minimizeToTray) return;
        event.preventDefault();
        mainWindow?.hide();
        // The `minimize` event below won't fire for a prevented minimize.
        mainWindow?.webContents.send("window-minimized");
    });

    (mainWindow as any).on("minimize", () => {
        // Fallback for platforms that don't emit `will-minimize` (Linux).
        if (minimizeToTray) {
            mainWindow?.hide();
        }
        // Fires for a plain OS minimize too, not just minimize-to-tray —
        // renderer.ts uses this to re-collapse expanded long chat messages
        // (Phase 12 sub-phase item 5's "reset on minimize" requirement).
        mainWindow?.webContents.send("window-minimized");
    });

    // Explicitly clear any taskbar/dock attention flash on focus, rather
    // than relying on per-platform implicit behavior (PRD 4.14 — Nudge).
    mainWindow.on("focus", () => {
        mainWindow?.flashFrame(false);
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

// ── System Tray Setup ────────────────────────────────────────────────────

function createTray(): void {
    const iconPath = path.join(__dirname, "..", "assets", "tray-icon.png");
    const trayIcon = nativeImage.createFromPath(iconPath);

    tray = new Tray(trayIcon);
    tray.setToolTip("Reson8");

    const contextMenu = Menu.buildFromTemplate([
        {
            label: "Restore",
            click: () => {
                showMainWindow("tray-restore");
            },
        },
        { type: "separator" },
        {
            label: "Quit",
            click: () => {
                isQuitting = true;
                app.quit();
            },
        },
    ]);
    tray.setContextMenu(contextMenu);

    // Single-click on tray icon restores the window
    tray.on("click", () => {
        showMainWindow("tray-click");
    });
}

// ── PTT shortcut management ──────────────────────────────────────────────

function registerPttShortcut(key: string): void {
    // Unregister any previous PTT shortcut
    unregisterPttShortcut();

    pttKey = key;

    try {
        globalShortcut.register(key, () => {
            mainWindow?.webContents.send("ptt-pressed");
        });
    } catch (err) {
        console.error("[main] Failed to register PTT shortcut:", err);
    }
}

function unregisterPttShortcut(): void {
    if (pttKey) {
        try {
            globalShortcut.unregister(pttKey);
        } catch { /* ignore */ }
        pttKey = null;
    }
}

// ── Auto-Updater (PRD 10.1) ──────────────────────────────────────────────
// Metadata check and download are separate steps: nothing downloads until
// the user (or the modal's "Update Now") explicitly asks for it.
autoUpdater.autoDownload = false;

// Installers aren't Authenticode-signed (no code-signing certificate). On
// Windows, NsisUpdater otherwise runs a PowerShell Authenticode check of
// the downloaded update against the publisher name baked into the
// currently-installed app's own app-update.yml, and rejects a legitimate
// unsigned update with "not signed by the application owner" — replacing
// the verifier with one that always passes disables that check entirely.
if (process.platform === "win32") {
    (autoUpdater as NsisUpdater).verifyUpdateCodeSignature = async () => null;
}

// True only while a download is in flight — distinguishes a download-phase
// 'error' (surfaced immediately, no retry) from a check-phase 'error'
// (already retried and reported by checkForUpdatesWithRetry() below, so it
// must NOT also be forwarded to the renderer here or every retry attempt
// would spam an error event).
let isDownloadingUpdate = false;

/** Active native-audio capture session for a screen share, if any (PRD 12.7). */
let screenAudioCapture: CaptureHandle | null = null;

/** Single metadata-fetch attempt, resolved/rejected by whichever of
 *  update-available / update-not-available / error fires first. */
function checkForUpdatesOnce(): Promise<"available" | "not-available"> {
    return new Promise((resolve, reject) => {
        const onAvailable = () => { cleanup(); resolve("available"); };
        const onNotAvailable = () => { cleanup(); resolve("not-available"); };
        const onError = (err: Error) => { cleanup(); reject(err); };
        function cleanup() {
            autoUpdater.removeListener("update-available", onAvailable);
            autoUpdater.removeListener("update-not-available", onNotAvailable);
            autoUpdater.removeListener("error", onError);
        }
        autoUpdater.once("update-available", onAvailable);
        autoUpdater.once("update-not-available", onNotAvailable);
        autoUpdater.once("error", onError);
        autoUpdater.checkForUpdates().catch(onError);
    });
}

/**
 * Metadata-only update check: 1 attempt, then up to 3 retries 20s apart —
 * shared by the automatic startup check and the manual "Check for Updates"
 * button, per PRD 10.1. On exhausted retries, `message` carries the last
 * attempt's error (e.g. a 404 fetching latest.yml from a release missing
 * its electron-builder metadata) so the UI can show why, not just that.
 */
async function checkForUpdatesWithRetry(): Promise<{ status: "available" | "not-available" | "error"; message?: string }> {
    const maxAttempts = 4; // 1 initial + 3 retries
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const status = await checkForUpdatesOnce();
            return { status };
        } catch (err) {
            lastError = err as Error;
            console.error(`[main] Update check attempt ${attempt}/${maxAttempts} failed:`, err);
            if (attempt < maxAttempts) {
                await new Promise((resolve) => setTimeout(resolve, 20_000));
            }
        }
    }
    return { status: "error", message: lastError?.message };
}

function setupAutoUpdater(): void {
    autoUpdater.on("update-available", (info) => {
        mainWindow?.webContents.send("update-available", { version: info.version });
    });

    autoUpdater.on("download-progress", (progress) => {
        mainWindow?.webContents.send("download-progress", { percent: progress.percent });
    });

    autoUpdater.on("update-downloaded", () => {
        isDownloadingUpdate = false;
        mainWindow?.webContents.send("update-downloaded");
    });

    autoUpdater.on("error", (err: Error) => {
        if (isDownloadingUpdate) {
            isDownloadingUpdate = false;
            mainWindow?.webContents.send("update-error", { message: err.message });
        }
    });
}

setupAutoUpdater();

// ── App lifecycle ────────────────────────────────────────────────────────

app.setName("Reson8");

app.whenReady().then(() => {
    // Disable the default application menu in production builds
    if (process.env.NODE_ENV !== "development") {
        Menu.setApplicationMenu(null);
    }

    // Expose instance ID to renderer/preload
    // Must run before getInstanceId(), which creates the ID file as a side effect.
    const isExistingInstall = hasExistingInstanceId();
    ipcMain.handle("is-existing-install", () => isExistingInstall);

    const instanceId = getInstanceId();
    ipcMain.handle("get-instance-id", () => instanceId);

    // Identity (PRD 17.12): the private key never leaves this process. The
    // preload gets the public half, and signatures over server challenges
    // only — identity-key.ts refuses anything that isn't a well-formed
    // nonce + host, so a compromised renderer can't get arbitrary data signed.
    ipcMain.handle("identity-get-public", () => getIdentityPublic()); // null while the key is locked
    ipcMain.handle("identity-sign-challenge", (_event, nonce: unknown, host: unknown) => signAuthChallenge(nonce, host));

    // ── Identity backup / restore (PRD 18.6) ─────────────────────────────
    // Everything that touches key material or files happens HERE. The renderer
    // only passes passphrases in and gets fingerprints/status back.
    const BACKUP_FILTERS = [{ name: "Reson8 identity", extensions: ["reson8-identity"] }];
    const IMPORT_WINDOW_MS = 10 * 60 * 1000;
    let pendingImport: { token: string; text: string; at: number; payload?: BackupPayload } | null = null;
    const DEV_ONLY = { ok: false, error: "Identity backup isn't available in development builds (they use a temporary identity)" };

    ipcMain.handle("identity-get-status", () => ({ ...getIdentityStatus(), canBackup: !isEphemeralIdentity() }));

    ipcMain.handle("identity-export", async (event, passphrase: unknown) => {
        if (isEphemeralIdentity()) return DEV_ONLY;
        const problem = validatePassphrase(passphrase);
        if (problem) return { ok: false, error: problem };
        const der = exportIdentityPkcs8Der();
        const pub = getIdentityPublic();
        if (!der || !pub) {
            return { ok: false, error: "Your identity key is locked — import a backup or create a new identity first" };
        }
        const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
        const shortFp = pub.fingerprint.replace(/[^A-Za-z0-9]/g, "").slice(6, 14).toLowerCase();
        const options = {
            title: "Export identity",
            defaultPath: path.join(app.getPath("documents"), `reson8-identity-${shortFp}.reson8-identity`),
            filters: BACKUP_FILTERS,
        };
        const chosen = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
        if (chosen.canceled || !chosen.filePath) return { ok: false, canceled: true };
        try {
            const text = await encryptBackup(
                {
                    instanceId: getInstanceId(),
                    privateKeyPkcs8Der: der.toString("base64"),
                    createdAt: new Date().toISOString(),
                    appVersion: app.getVersion(),
                },
                passphrase as string,
            );
            writeFileSync(chosen.filePath, text, { encoding: "utf8", mode: 0o600 });
            return { ok: true, path: chosen.filePath };
        } catch (err) {
            console.error("[identity] export failed:", err);
            return { ok: false, error: "Couldn't write the backup file" };
        }
    });

    ipcMain.handle("identity-import-pick", async (event) => {
        if (isEphemeralIdentity()) return DEV_ONLY;
        const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
        const options = { title: "Import identity", properties: ["openFile" as const], filters: BACKUP_FILTERS };
        const chosen = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
        if (chosen.canceled || !chosen.filePaths[0]) return { ok: false, canceled: true };
        try {
            const file = chosen.filePaths[0];
            if (statSync(file).size > MAX_BACKUP_FILE_BYTES) {
                return { ok: false, error: "That file is too large to be an identity backup" };
            }
            // The contents stay in this process; the renderer gets an opaque token.
            pendingImport = { token: randomBytes(16).toString("hex"), text: readFileSync(file, "utf8"), at: Date.now() };
            return { ok: true, token: pendingImport.token, fileName: path.basename(file) };
        } catch {
            return { ok: false, error: "Couldn't read that file" };
        }
    });

    ipcMain.handle("identity-import-decrypt", async (_event, token: unknown, passphrase: unknown) => {
        if (isEphemeralIdentity()) return DEV_ONLY;
        if (!pendingImport || token !== pendingImport.token || Date.now() - pendingImport.at > IMPORT_WINDOW_MS) {
            return { ok: false, error: "Pick the backup file again" };
        }
        if (typeof passphrase !== "string") return { ok: false, error: "Enter the passphrase" };
        try {
            const payload = await decryptBackup(pendingImport.text, passphrase);
            pendingImport.payload = payload;
            const key = createPrivateKey({ key: Buffer.from(payload.privateKeyPkcs8Der, "base64"), format: "der", type: "pkcs8" });
            return {
                ok: true,
                fingerprint: fingerprintOf(publicKeyBase64(key)),
                instanceId: payload.instanceId,
                createdAt: payload.createdAt,
                currentFingerprint: getIdentityPublic()?.fingerprint ?? null,
                currentInstanceId: getInstanceId(),
            };
        } catch (err) {
            if (err instanceof BackupError) return { ok: false, error: err.message, code: err.code };
            console.error("[identity] import failed:", err);
            return { ok: false, error: "Couldn't read the backup" };
        }
    });

    ipcMain.handle("identity-import-apply", (_event, token: unknown) => {
        if (isEphemeralIdentity()) return DEV_ONLY;
        if (!pendingImport?.payload || token !== pendingImport.token) {
            return { ok: false, error: "Open the backup again and enter its passphrase" };
        }
        try {
            const { instanceId, privateKeyPkcs8Der } = pendingImport.payload;
            replaceIdentityKey(Buffer.from(privateKeyPkcs8Der, "base64"));
            replaceInstanceId(instanceId);
            pendingImport = null;
            // The instance id is cached in several places: restart is the clean way.
            // app.quit() (not exit) so the graceful-disconnect handler runs.
            app.relaunch();
            app.quit();
            return { ok: true };
        } catch (err) {
            console.error("[identity] applying the backup failed:", err);
            return { ok: false, error: "Couldn't apply the backup" };
        }
    });

    // Recovery from a locked key: starts a fresh identity (the old file is kept aside).
    ipcMain.handle("identity-create-new", () => {
        if (isEphemeralIdentity()) return DEV_ONLY;
        return { ok: true, status: createNewIdentityAfterLock() };
    });

    // ── Encrypted connections (PRD 18.3) ─────────────────────────────────
    // One round trip gives the renderer everything `decideScheme()` needs.
    // The PEM stays here; the renderer only ever sees the fingerprint data.
    ipcMain.handle("tls-probe", async (_event, host: unknown, port: unknown) => {
        if (!validHostPort(host, port)) return { error: "Invalid server address" };
        const key = hostKey(host, port as number);
        const outcome = await probeServer(host, port as number);
        const cert =
            outcome.result.kind === "trusted" || outcome.result.kind === "untrusted" ? outcome.result.cert : null;
        if (cert && outcome.certPem) lastProbes.set(key, { cert, certPem: outcome.certPem, at: Date.now() });
        const pin = getTlsStore().getPin(key);
        return {
            result: outcome.result,
            pinnedFingerprint: pin ? pin.fingerprint256 : null,
            httpsRemembered: getTlsStore().isHttpsRemembered(key),
        };
    });

    // Pins the certificate the LAST probe of this host:port showed — not one
    // the renderer names — and never overwrites an existing, different pin
    // (that's the changed-certificate case: the user must remove the old
    // trust deliberately, as with SSH host keys).
    ipcMain.handle("tls-trust-certificate", (_event, host: unknown, port: unknown, fingerprint: unknown) => {
        if (!validHostPort(host, port) || !isFingerprint(fingerprint)) return { ok: false, error: "Invalid request" };
        const key = hostKey(host, port as number);
        const seen = lastProbes.get(key);
        if (!seen || seen.cert.fingerprint256 !== fingerprint || Date.now() - seen.at > PIN_WINDOW_MS) {
            return { ok: false, error: "That certificate was not just presented by the server — try connecting again" };
        }
        const existing = getTlsStore().getPin(key);
        if (existing && existing.fingerprint256 !== fingerprint) {
            return { ok: false, error: "A different certificate is already trusted for this server — remove it in Settings first" };
        }
        try {
            getTlsStore().setPin(key, {
                fingerprint256: fingerprint,
                subject: seen.cert.subject,
                validTo: seen.cert.validTo,
                pinnedAt: new Date().toISOString(),
                certPem: seen.certPem,
            });
            return { ok: true };
        } catch (err) {
            return { ok: false, error: (err as Error).message };
        }
    });

    ipcMain.handle("tls-get-connect-options", (_event, host: unknown, port: unknown) => {
        if (!validHostPort(host, port)) return null;
        const pin = getTlsStore().getPin(hostKey(host, port as number));
        return pin ? { ca: pin.certPem, fingerprint256: pin.fingerprint256 } : null;
    });

    ipcMain.handle("tls-remember-https", (_event, host: unknown, port: unknown) => {
        if (validHostPort(host, port)) getTlsStore().rememberHttps(hostKey(host, port as number));
    });

    ipcMain.handle("tls-list-trusted", () => getTlsStore().listPins());

    ipcMain.handle("tls-remove-trust", (_event, key: unknown) => {
        return typeof key === "string" && key.length <= 300 ? getTlsStore().removePin(key) : false;
    });

    // A Viewer window's own socket needs the same pin the main window used.
    ipcMain.handle("viewer-get-tls-options", (event) => {
        const server = viewerServers.get(event.sender.id);
        if (!server) return null;
        const pin = getTlsStore().getPin(hostKey(server.host, server.port));
        return pin ? { ca: pin.certPem, fingerprint256: pin.fingerprint256 } : null;
    });

    // PTT shortcut IPC
    ipcMain.on("set-ptt-key", (_event, key: string) => {
        registerPttShortcut(key);
    });

    ipcMain.on("clear-ptt-key", () => {
        unregisterPttShortcut();
    });

    ipcMain.handle("download-image", (_event, url: string) => {
        if (mainWindow) {
            mainWindow.webContents.downloadURL(url);
        }
    });

    // ── Image viewer actions (PRD 15.9) ──────────────────────────────────
    // The renderer never gets raw Node/Electron access, so everything the
    // viewer's toolbar needs from outside the page goes through these.

    /** Only plain web URLs may be opened/fetched — never file:, javascript:,
     *  custom protocols, etc. (attachment URLs come from other users). */
    const isHttpUrl = (value: unknown): value is string => {
        if (typeof value !== "string") return false;
        try {
            const u = new URL(value);
            return u.protocol === "http:" || u.protocol === "https:";
        } catch {
            return false;
        }
    };

    ipcMain.handle("open-external-url", async (_event, url: unknown) => {
        if (!isHttpUrl(url)) return { success: false, error: "Only http(s) links can be opened" };
        await shell.openExternal(url);
        return { success: true };
    });

    ipcMain.handle("copy-text-to-clipboard", (_event, text: unknown) => {
        if (typeof text !== "string") return false;
        clipboard.writeText(text);
        return true;
    });

    /** The renderer re-encodes whatever it fetched to PNG first (see
     *  `copyLightboxImage`), so only PNG bytes are accepted here. */
    ipcMain.handle("copy-png-to-clipboard", (_event, bytes: unknown) => {
        if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) return false;
        const image = nativeImage.createFromBuffer(Buffer.from(bytes));
        if (image.isEmpty()) return false;
        clipboard.writeImage(image);
        return true;
    });

    /**
     * Fetches an image's bytes in the main process — no CORS or canvas-taint
     * problems like a renderer fetch of a cross-origin image would have.
     * Bounded: http(s) only, `image/*` responses only, 25 MB cap, 15s timeout.
     */
    const IMAGE_FETCH_MAX_BYTES = 25 * 1024 * 1024;
    ipcMain.handle("fetch-image-bytes", async (_event, url: unknown) => {
        if (!isHttpUrl(url)) return { success: false, error: "Invalid image URL" };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        try {
            const res = await net.fetch(url, { signal: controller.signal, credentials: "omit" });
            if (!res.ok) return { success: false, error: `Server responded ${res.status}` };
            const type = res.headers.get("content-type") ?? "";
            if (!type.toLowerCase().startsWith("image/")) {
                return { success: false, error: "That link is not an image" };
            }
            const declared = Number(res.headers.get("content-length") ?? 0);
            if (declared > IMAGE_FETCH_MAX_BYTES) return { success: false, error: "Image is too large to copy" };
            const buffer = Buffer.from(await res.arrayBuffer());
            if (buffer.byteLength > IMAGE_FETCH_MAX_BYTES) return { success: false, error: "Image is too large to copy" };
            return { success: true, bytes: new Uint8Array(buffer) };
        } catch (err: any) {
            return { success: false, error: err?.name === "AbortError" ? "Timed out fetching the image" : "Couldn't fetch the image" };
        } finally {
            clearTimeout(timer);
        }
    });

    ipcMain.handle("fetch-link-preview", async (_event, url: string) => {
        return fetchLinkPreview(url);
    });

    ipcMain.handle("fetch-release-notes", async (_event, version: string) => {
        return fetchReleaseNotes(version);
    });

    // ── Tray preferences IPC ─────────────────────────────────────────────
    ipcMain.on("set-tray-prefs", (_event, prefs: { minimizeToTray: boolean; closeToTray: boolean }) => {
        minimizeToTray = prefs.minimizeToTray;
        closeToTray = prefs.closeToTray;
    });

    ipcMain.handle("get-tray-prefs", () => ({
        minimizeToTray,
        closeToTray,
    }));

    ipcMain.handle("is-window-focused", () => mainWindow?.isFocused() ?? false);

    // ── Auto-Updater IPC (PRD 10.1) ──────────────────────────────────────
    ipcMain.handle("check-for-updates", async () => {
        return checkForUpdatesWithRetry();
    });

    ipcMain.handle("download-update", async () => {
        isDownloadingUpdate = true;
        try {
            await autoUpdater.downloadUpdate();
        } catch (err: any) {
            isDownloadingUpdate = false;
            mainWindow?.webContents.send("update-error", { message: err.message });
        }
    });

    ipcMain.handle("quit-and-install", () => {
        autoUpdater.quitAndInstall();
    });

    ipcMain.handle("get-app-version", () => app.getVersion());

    // Taskbar/dock attention flash for Nudge (PRD 4.14) — cleared automatically
    // by Electron once the window regains focus, so no explicit "un-flash" call
    // is needed on the renderer side.
    ipcMain.on("flash-window", () => {
        if (mainWindow && !mainWindow.isFocused()) {
            mainWindow.flashFrame(true);
        }
    });

    // ── Screen Share source discovery (PRD 12.6) ─────────────────────────
    // Re-fetched every time the Selection Modal (PRD 12.10) opens — sources
    // can appear/disappear as windows open/close, so this is deliberately
    // not cached across calls. Thumbnail size is small (240×135, 16:9)
    // since these are list-item previews, not the shared video itself.
    //
    // On Linux/Wayland this call itself drives the OS-level
    // xdg-desktop-portal ScreenCast consent flow (KDE/GNOME show their own
    // picker dialog here, before our in-app modal even has data to render —
    // see PRD 12.10). That flow can fail outright — the user cancelling the
    // OS picker, closing it, or a portal-side hiccup all surface as Chromium
    // logging "screencast_portal.cc: Failed to start the screen cast
    // session" / "ScreenCastPortal failed". The `try`/`catch` alone isn't
    // enough for that case, though: confirmed against a real broken portal
    // backend (xdg-desktop-portal-kde stopped) that `desktopCapturer
    // .getSources()`'s promise can just hang forever — neither resolving
    // nor rejecting — rather than rejecting, so nothing here would ever run
    // without a timeout race. 20s comfortably covers a real person deciding
    // in the OS dialog while still eventually recovering from a portal
    // that's never going to answer, instead of leaving the Selection Modal
    // stuck on "Loading sources…" forever with no way to know why.
    ipcMain.handle("get-desktop-sources", async () => {
        try {
            const sources = await getDesktopSourcesWithTimeout({
                types: ["screen", "window"],
                thumbnailSize: { width: 240, height: 135 },
                fetchWindowIcons: true,
            });
            return {
                success: true,
                sources: sources.map((source) => ({
                    id: source.id,
                    name: source.name,
                    thumbnail: source.thumbnail.toDataURL(),
                    appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null,
                    // Screen sharing gates the audio-share checkbox on this
                    // (PRD 12.11/12.14 — must never light up for a
                    // full-monitor share, since native-audio only captures
                    // per-process, not a desktop mix).
                    sourceType: classifySourceType(source),
                })),
            };
        } catch (err: any) {
            return { success: false, error: err?.message ?? "Failed to list screen/window sources" };
        }
    });

    // Linux/Wayland bypass only — see `lastScreenShareSource`'s declaration
    // for why this can't just be read off the MediaStreamTrack.
    ipcMain.handle("get-last-screen-share-source", () => lastScreenShareSource);

    // Linux/Wayland bypass only (PRD 12.11's audio-share business rule
    // still applies: only ever offered for an individual window, never a
    // full-monitor share). There's no in-app step on this path to surface
    // the modal's "share this window's audio too" checkbox, so this asks
    // via a native dialog instead — but NOT "share <picked source>'s audio
    // too?" the way an earlier version of this did. Confirmed live that
    // `desktopCapturer`'s window sources carry no real per-window name at
    // all under the Wayland/portal capture path (the portal doesn't
    // expose one to the requesting app, by design) — there's no title to
    // ask about or match against in the first place. Instead this lists
    // apps `listAudioProducingApps()` (Linux-only export) says are
    // *actually* producing audio right now, via PipeWire/PulseAudio
    // introspection directly — that's not privacy-gated the way window
    // capture is — and lets the user pick which one, if any, rather than
    // guessing.
    //
    // `app.getAppMetrics()`'s PIDs (every one of Reson8's own processes —
    // main, renderer, GPU, audio service, etc.) are passed through to
    // exclude this app's own audio-output stream from the list — confirmed
    // live that without this, Reson8 could "share" its own audio back at
    // itself. Excluding by PID rather than matching the name "Reson8" /
    // "Chromium" / "Electron" is deliberate: a name-based filter would
    // also hide a real, separate Chrome/Chromium browser window, since
    // Electron self-identifies with the same underlying engine name.
    ipcMain.handle("pick-audio-app-to-share", async () => {
        if (!mainWindow) return null;
        const ownPids = app.getAppMetrics().map((m) => m.pid);
        const candidates =
            typeof listAudioProducingApps === "function" ? listAudioProducingApps(ownPids) : [];
        if (candidates.length === 0) return null;

        const result = await dialog.showMessageBox(mainWindow, {
            type: "question",
            buttons: [...candidates, "Video Only"],
            defaultId: 0,
            cancelId: candidates.length,
            title: "Share App Audio?",
            message: "Which app's audio would you like to share too?",
        });
        return result.response < candidates.length ? candidates[result.response] : null;
    });

    // ── Screen Share audio capture (PRD 12.7) ────────────────────────────

    // Platform-wide check (PRD 12.11) — not per-target. native-audio's
    // `platformSupportsCapture()` already folds in every "can't capture at
    // all" case this needs to gate on (pre-19041 Windows, ALSA-only Linux,
    // macOS always), determined once for the whole machine rather than per
    // window — there's no separate per-target capability query to make.
    ipcMain.handle("platform-supports-audio-capture", () => platformSupportsCapture());

    // Windows-only export — `resolvePidForWindowSourceId` doesn't exist in
    // the compiled native-audio addon on Linux/macOS (see windows.rs), so
    // `require`d here it's simply `undefined` on those platforms.
    ipcMain.handle("resolve-pid-for-window-source-id", (_event, sourceId: string) => {
        return typeof resolvePidForWindowSourceId === "function"
            ? resolvePidForWindowSourceId(sourceId)
            : undefined;
    });

    ipcMain.handle(
        "start-app-audio-capture",
        (_event, target: { pid?: number; processName?: string }) => {
            // A leftover session from a share that ended uncleanly (renderer
            // crash, etc.) must not silently leak — always stop the previous
            // one before starting a new one.
            screenAudioCapture?.stop();

            const handle = startCapture(target, (pcm, sampleRate, channels) => {
                mainWindow?.webContents.send("app-audio-frame", { pcm, sampleRate, channels });
            });
            screenAudioCapture = handle;
            return { status: handle.status };
        },
    );

    ipcMain.handle("stop-app-audio-capture", () => {
        screenAudioCapture?.stop();
        screenAudioCapture = null;
    });

    // ── Screen Share Viewer window (PRD 12.13) ───────────────────────────
    // The confirm prompt ("Do you want to watch X's stream?") lives in the
    // main renderer, styled like #nsfw-confirm-modal — this handler only
    // runs after that's already been confirmed. Multiple Viewer windows can
    // be open at once (PRD 12.13's Decision #4), each fully independent, so
    // this is just "create one more" with no dedup/tracking against
    // existing ones.
    ipcMain.handle(
        "open-screen-share-viewer",
        (
            _event,
            args: { targetUserId: string; nickname: string; channelId: string; serverBaseUrl: string; viewerTicket?: string },
        ) => {
            const viewerWindow = new BrowserWindow({
                width: 960,
                height: 600,
                minWidth: 480,
                minHeight: 320,
                title: `Watching ${args.nickname}'s screen share`,
                webPreferences: {
                    preload: path.join(__dirname, "preload-viewer.js"),
                    contextIsolation: true,
                    nodeIntegration: false,
                    sandbox: false,
                    // The only way to hand initial data to a new window's
                    // preload script — read back via `process.argv` there.
                    additionalArguments: [
                        `--viewer-target-user-id=${args.targetUserId}`,
                        `--viewer-channel-id=${args.channelId}`,
                        `--viewer-nickname=${encodeURIComponent(args.nickname)}`,
                        `--viewer-server-base-url=${encodeURIComponent(args.serverBaseUrl)}`,
                    ],
                },
            });
            // The viewer ticket (PRD 17.12) is a credential, so it is NOT
            // passed in additionalArguments (they end up on the process's
            // command line, readable by other local users). The window's
            // preload fetches it over IPC instead.
            const contentsId = viewerWindow.webContents.id;
            if (typeof args.viewerTicket === "string") viewerTickets.set(contentsId, args.viewerTicket);
            try {
                const u = new URL(args.serverBaseUrl);
                const host = u.hostname.replace(/^\[|\]$/g, "");
                viewerServers.set(contentsId, { host, port: Number(u.port) || (u.protocol === "https:" ? 443 : 80) });
            } catch {
                /* a malformed base URL just means no pin for this window */
            }
            viewerWindow.on("closed", () => {
                viewerTickets.delete(contentsId);
                viewerServers.delete(contentsId);
            });
            viewerWindow.loadFile(path.join(__dirname, "renderer", "viewer.html"));
            return { success: true };
        },
    );

    // The Fullscreen button in the Viewer window (`preload-viewer.ts`)
    // toggles this instead of calling the HTML5 `videoEl.requestFullscreen()`
    // API directly — confirmed on this project's own dev machine (KDE
    // Plasma/Wayland via XWayland) that the web-platform Fullscreen API's
    // promise never even settles there (Chromium never gets far enough to
    // fire Electron's own `enter-html-full-screen` webContents event, so
    // handling that wouldn't have helped either). `BrowserWindow
    // .setFullScreen()` talks directly to the native windowing system
    // instead of going through Blink's fullscreen negotiation, and doubles
    // as a reasonable UX for this window anyway — the video already fills
    // nearly the whole window, so a native fullscreen window reads the same
    // as "fullscreen video" while keeping the controls bar reachable.
    // Registered once (not per-window) and resolves the target window from
    // the invoking `event.sender`, so it works for any open Viewer window.
    // A Viewer window asks for its own ticket (PRD 17.12) — only the window it
    // was issued for gets it.
    ipcMain.handle("viewer-get-ticket", (event) => viewerTickets.get(event.sender.id) ?? null);

    ipcMain.handle("viewer-toggle-fullscreen", (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return false;
        win.setFullScreen(!win.isFullScreen());
        return win.isFullScreen();
    });

    createTray();
    createWindow();
});

// Ensure native quit signals (Cmd+Q, Alt+F4) bypass close-to-tray — these
// call app.quit() directly, so the window is still alive when this fires
// (unlike the ordinary "click the X button" path, intercepted instead in
// the window's own "close" handler above, since by the time this handler
// runs there the window is already destroyed).
app.on("before-quit", (event) => {
    isQuitting = true;
    // Don't leave a native-audio capture session running past app exit —
    // on the PulseAudio backend in particular (PRD 12.3), that session has
    // real system side effects (a rerouted null-sink) that won't clean
    // themselves up on their own.
    screenAudioCapture?.stop();
    screenAudioCapture = null;

    // Tell the renderer to gracefully disconnect its socket before the
    // process actually dies. Without this, quitting just lets the OS kill
    // the connection, which the server can only see as an ordinary dropped
    // transport — indistinguishable from a flaky network blip — so it
    // always waits out the full reconnect-grace period (10s) before
    // marking presence offline, even for a deliberate, clean quit. An
    // explicit socket.disconnect() call reports as "client namespace
    // disconnect" server-side, which the server treats as unambiguous and
    // finalizes immediately instead. Briefly delaying the actual quit
    // gives the disconnect packet a moment to actually leave the process
    // before it's torn down.
    if (!hasSentQuitDisconnect && mainWindow && !mainWindow.isDestroyed()) {
        hasSentQuitDisconnect = true;
        event.preventDefault();
        mainWindow.webContents.send("app-quitting");
        setTimeout(() => app.quit(), 250);
    }
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    if (tray) {
        tray.destroy();
        tray = null;
    }
});
