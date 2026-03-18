/**
 * Reson8 Client — Electron Main Process
 *
 * Creates the BrowserWindow and loads the renderer.
 * This is the entry point for the Electron desktop client.
 */

import { app, BrowserWindow, session, ipcMain, globalShortcut, Menu, Tray, nativeImage } from "electron";
import path from "node:path";
import { getInstanceId } from "./instance-id.js";

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
