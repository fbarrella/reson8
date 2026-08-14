/**
 * Reson8 Client — Electron Main Process
 *
 * Creates the BrowserWindow and loads the renderer.
 * This is the entry point for the Electron desktop client.
 */

import { app, BrowserWindow, session, ipcMain, globalShortcut, Menu, Tray, nativeImage, shell } from "electron";
import path from "node:path";
import { getInstanceId, hasExistingInstanceId } from "./instance-id.js";
import { autoUpdater } from "electron-updater";

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

// ── System Tray State ────────────────────────────────────────────────────
let tray: Tray | null = null;
let isQuitting = false;
let minimizeToTray = false;
let closeToTray = false;

function createWindow(): void {
    // Grant mic/camera permission requests automatically
    session.defaultSession.setPermissionRequestHandler(
        (_webContents, permission, callback) => {
            const allowed = ["media", "audioCapture", "microphone"];
            callback(allowed.includes(permission));
        },
    );

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
        }
    });

    // ── Minimize-to-tray interception ────────────────────────────────────
    (mainWindow as any).on("minimize", () => {
        if (minimizeToTray) {
            mainWindow?.hide();
        }
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

    createTray();
    createWindow();
});

// Ensure native quit signals (Cmd+Q, Alt+F4) bypass close-to-tray
app.on("before-quit", () => {
    isQuitting = true;
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
