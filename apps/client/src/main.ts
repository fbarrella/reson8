/**
 * Reson8 Client — Electron Main Process
 *
 * Creates the BrowserWindow and loads the renderer.
 * This is the entry point for the Electron desktop client.
 */

import { app, BrowserWindow, session, ipcMain } from "electron";
import path from "node:path";
import { getInstanceId } from "./instance-id.js";

let mainWindow: BrowserWindow | null = null;

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

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    // Expose instance ID to renderer/preload
    const instanceId = getInstanceId();
    ipcMain.handle("get-instance-id", () => instanceId);

    createWindow();
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
