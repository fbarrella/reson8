/**
 * Reson8 Client — Electron Main Process
 *
 * Creates the BrowserWindow and loads the renderer.
 * This is the entry point for the Electron desktop client.
 */

import { app, BrowserWindow, session, ipcMain, globalShortcut, Menu, Tray, nativeImage, shell, desktopCapturer, dialog } from "electron";
import path from "node:path";
import { getInstanceId, hasExistingInstanceId } from "./instance-id.js";
import { autoUpdater } from "electron-updater";
import { startCapture, resolvePidForWindowSourceId, listAudioProducingApps, platformSupportsCapture } from "@reson8/native-audio";
import type { CaptureHandle } from "@reson8/native-audio";

// ── Single-instance lock (PRD 13.18) ────────────────────────────────────
// Requested as early as possible, before any other startup work. Opening
// the app again while one instance is already running should just focus
// the existing window rather than spawning a second, fully-independent
// instance (its own server connection, tray icon, global shortcuts, etc.
// all competing with the first). If this process didn't get the lock, an
// instance is already running elsewhere; quit immediately — calling
// app.quit() this early prevents app.whenReady() from ever resolving, so
// none of the window/tray/IPC setup further down actually runs.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (!mainWindow.isVisible()) mainWindow.show();
        mainWindow.focus();
    });
}

// ── Link Preview (metascraper) ───────────────────────────────────────────
// @ts-ignore — metascraper packages lack type declarations
import metascraperModule from "metascraper";
// @ts-ignore
import metascraperTitle from "metascraper-title";
// @ts-ignore
import metascraperDescription from "metascraper-description";
// @ts-ignore
import metascraperImage from "metascraper-image";
// @ts-ignore
import metascraperUrl from "metascraper-url";
// @ts-ignore
import metascraperVideo from "metascraper-video";

const metascraper = metascraperModule([
    metascraperTitle(),
    metascraperDescription(),
    metascraperImage(),
    metascraperUrl(),
    metascraperVideo(),
]);

interface LinkPreviewData {
    title?: string;
    description?: string;
    image?: string;
    video?: string;
    videoType?: string;
    url?: string;
    domain?: string;
    siteName?: string;
}

// In-memory cache: URL → metadata (null = attempted but failed)
const linkPreviewCache = new Map<string, LinkPreviewData | null>();

function sanitizeText(text: string | undefined | null): string | undefined {
    if (!text) return undefined;
    // Strip HTML tags
    return text.replace(/<[^>]*>/g, "").trim() || undefined;
}

function isValidImageUrl(url: string | undefined | null): boolean {
    if (!url) return false;
    return url.startsWith("http://") || url.startsWith("https://");
}

/** Extract OpenGraph meta tags from HTML as a fallback when metascraper returns incomplete data. */
function extractOgTags(html: string): Record<string, string> {
    const tags: Record<string, string> = {};
    const regex = /<meta\s+(?:property|name)=["'](og:[^"']+|twitter:[^"']+)["']\s+content=["']([^"']*)["']\s*\/?>/gi;
    const reverseRegex = /<meta\s+content=["']([^"']*)["']\s+(?:property|name)=["'](og:[^"']+|twitter:[^"']+)["']\s*\/?>/gi;

    let match;
    while ((match = regex.exec(html)) !== null) {
        tags[match[1].toLowerCase()] = match[2];
    }
    while ((match = reverseRegex.exec(html)) !== null) {
        tags[match[2].toLowerCase()] = match[1];
    }
    return tags;
}

interface ReleaseNotes {
    name: string;
    body: string;
    htmlUrl: string;
}

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
        return {
            name: typeof data.name === "string" && data.name ? data.name : `v${version}`,
            body: typeof data.body === "string" ? data.body : "",
            htmlUrl:
                typeof data.html_url === "string"
                    ? data.html_url
                    : `https://github.com/fbarrella/reson8/releases/tag/v${version}`,
        };
    } catch {
        return null;
    }
}

async function fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
    // Check cache first
    if (linkPreviewCache.has(url)) {
        return linkPreviewCache.get(url) ?? null;
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                // Bot-like UA so embed-focused sites (fxtwitter, etc.) serve OG tags
                "User-Agent": "Mozilla/5.0 (compatible; Reson8Bot/1.0; +https://github.com/fbarrella/reson8)",
            },
        });
        clearTimeout(timeout);

        if (!response.ok) {
            linkPreviewCache.set(url, null);
            return null;
        }

        const html = await response.text();
        const metadata = await metascraper({ html, url });

        let title = sanitizeText(metadata.title);
        let rawDesc = sanitizeText(metadata.description);
        let image = isValidImageUrl(metadata.image) ? metadata.image : undefined;
        let video = isValidImageUrl(metadata.video) ? metadata.video : undefined;
        let videoType: string | undefined;
        let siteName: string | undefined;

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
        videoType = ogTags["og:video:type"] || undefined;
        siteName = sanitizeText(ogTags["og:site_name"]) || undefined;

        const description = rawDesc && rawDesc.length > 200 ? rawDesc.slice(0, 200) + "…" : rawDesc;

        let domain: string | undefined;
        try {
            domain = new URL(url).hostname.replace(/^www\./, "");
        } catch { /* ignore */ }

        const result: LinkPreviewData = { title, description, image, video, videoType, url: metadata.url || url, domain, siteName };

        // Cache if we got at least a title or image
        if (title || image) {
            linkPreviewCache.set(url, result);
            return result;
        }

        linkPreviewCache.set(url, null);
        return null;
    } catch {
        linkPreviewCache.set(url, null);
        return null;
    }
}

let mainWindow: BrowserWindow | null = null;
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

function createWindow(): void {
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

    mainWindow = new BrowserWindow({
        width: 1024,
        height: 768,
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
    (mainWindow as any).on("minimize", () => {
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
                mainWindow?.show();
                mainWindow?.focus();
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
        mainWindow?.show();
        mainWindow?.focus();
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
            args: { targetUserId: string; nickname: string; channelId: string; serverBaseUrl: string },
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
