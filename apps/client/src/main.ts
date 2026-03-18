/**
 * Reson8 Client — Electron Main Process
 *
 * Creates the BrowserWindow and loads the renderer.
 * This is the entry point for the Electron desktop client.
 */

import { app, BrowserWindow, session, ipcMain, globalShortcut, Menu, Tray, nativeImage, shell } from "electron";
import path from "node:path";
import { getInstanceId } from "./instance-id.js";

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
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });

    mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

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

// ── App lifecycle ────────────────────────────────────────────────────────

app.whenReady().then(() => {
    // Disable the default application menu in production builds
    if (process.env.NODE_ENV !== "development") {
        Menu.setApplicationMenu(null);
    }

    // Expose instance ID to renderer/preload
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

    // ── Tray preferences IPC ─────────────────────────────────────────────
    ipcMain.on("set-tray-prefs", (_event, prefs: { minimizeToTray: boolean; closeToTray: boolean }) => {
        minimizeToTray = prefs.minimizeToTray;
        closeToTray = prefs.closeToTray;
    });

    ipcMain.handle("get-tray-prefs", () => ({
        minimizeToTray,
        closeToTray,
    }));

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
