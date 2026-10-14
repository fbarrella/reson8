/**
 * Reson8 Client — Screen Share Viewer Preload Script (PRD 12.13, 19 C10)
 *
 * Runs in the Viewer window created by `main.ts`'s `open-screen-share-viewer`
 * IPC handler. The receive pipeline itself lives in `screen-watch.ts`, shared
 * with the main window's in-app stage; this file only wires it to the window:
 * the status the renderer shows, volume/mute, fullscreen, always-on-top and
 * "Return to Reson8".
 *
 * Initial params are read from `process.argv` (`additionalArguments` is the
 * only way to hand data to a new window's preload script) rather than IPC,
 * since there's no renderer-side request that could ask for them first. The
 * ticket is NOT among them (it would sit on the command line) — it is fetched
 * over IPC.
 */

import { contextBridge, ipcRenderer } from "electron";
import { startScreenWatch, WatchHandle } from "./screen-watch";

type ViewerStatus = "connecting" | "watching" | "ended" | "error";

function readArg(name: string): string {
    const prefix = `--${name}=`;
    const arg = process.argv.find((a) => a.startsWith(prefix));
    return arg ? decodeURIComponent(arg.slice(prefix.length)) : "";
}

const targetUserId = readArg("viewer-target-user-id");
const channelId = readArg("viewer-channel-id");
const nickname = readArg("viewer-nickname");
const serverBaseUrl = readArg("viewer-server-base-url");
const roomName = readArg("viewer-room-name");

let handle: WatchHandle | null = null;
let streamName = "";

const statusListeners: Array<(status: ViewerStatus, message?: string) => void> = [];
// `start()` runs immediately, before `viewer.html`'s own script has parsed
// and called `onStatus()` — on a fast (e.g. localhost) connection, the
// "connecting" → "watching"/"error" transition can complete before anyone is
// listening. Tracking the last status and replaying it to each new
// subscriber below closes that race instead of silently dropping it.
let lastStatus: { status: ViewerStatus; message?: string } = { status: "connecting" };
function setStatus(status: ViewerStatus, message?: string): void {
    lastStatus = { status, message };
    for (const cb of statusListeners) {
        try {
            cb(status, message);
        } catch (err) {
            console.error("[viewer] Error in status listener:", err);
        }
    }
}

function attachVideoToDom(video: HTMLVideoElement): void {
    const place = (): void => {
        const container = document.getElementById("video-container");
        if (container && !container.contains(video)) container.appendChild(video);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", place);
    else place();
}

async function start(): Promise<void> {
    if (!targetUserId || !channelId || !serverBaseUrl) {
        setStatus("error", "Missing viewer window parameters");
        return;
    }
    setStatus("connecting");

    const instanceId: string = await ipcRenderer.invoke("get-instance-id");
    // Kept by the main process for this window only (PRD 17.12) — never on
    // the command line. Null against a pre-2.6.0 server.
    const ticket: string | null = await ipcRenderer.invoke("viewer-get-ticket");
    // The same pinned certificate the main window's connection uses (PRD 18.3),
    // when the user trusted a self-signed one for this server.
    const pin: { ca: string; fingerprint256: string } | null = await ipcRenderer.invoke("viewer-get-tls-options");

    try {
        handle = await startScreenWatch({
            serverBaseUrl,
            pin,
            ticket,
            instanceId,
            targetUserId,
            channelId,
            onEnded: (reason, kind) => setStatus(kind === "ended" ? "ended" : "error", reason),
        });
        streamName = handle.streamName;
        attachVideoToDom(handle.videoEl);
        setStatus("watching");
    } catch (err: any) {
        setStatus("error", err?.message ?? "Failed to start watching");
    }
}

window.addEventListener("beforeunload", () => {
    void handle?.close();
});

contextBridge.exposeInMainWorld("reson8ViewerApi", {
    info: { nickname, targetUserId, channelId, roomName },

    // A function, not a plain property like `info` above — `streamName`
    // is only known once the watch has started (well after this object is
    // exposed), and contextBridge snapshots plain data properties at expose
    // time, so a later mutation would never reach the renderer's view.
    getStreamName(): string {
        return streamName;
    },

    onStatus(cb: (status: ViewerStatus, message?: string) => void): void {
        statusListeners.push(cb);
        cb(lastStatus.status, lastStatus.message);
    },

    /** 0–200 (PRD 19 C10: the stream can be boosted). */
    setVolume(percent: number): void {
        handle?.setVolume(percent);
    },

    toggleMute(): boolean {
        const next = !(handle?.isMuted() ?? false);
        handle?.setMuted(next);
        return next;
    },

    isMuted(): boolean {
        return handle?.isMuted() ?? false;
    },

    // Goes through the main process (`viewer-toggle-fullscreen`) rather
    // than the HTML5 Fullscreen API — confirmed that API's promise can
    // simply never settle on some Linux window managers, see the doc
    // comment on that IPC handler in `main.ts`.
    toggleFullscreen(): Promise<boolean> {
        return ipcRenderer.invoke("viewer-toggle-fullscreen");
    },

    /** Keeps this window above others (PRD 19 C10). Resolves with the state now in force. */
    setAlwaysOnTop(flag: boolean): Promise<boolean> {
        return ipcRenderer.invoke("viewer-set-always-on-top", !!flag);
    },

    /** How this window's frame is drawn (PRD 19 R7): the integrated bar, or the OS frame. */
    getWindowChrome(): Promise<{ integrated: boolean; platform: string; maximized: boolean; fullscreen: boolean }> {
        return ipcRenderer.invoke("window-chrome-get");
    },

    /** Maximized/fullscreen changes of this window (the bar hides in fullscreen). */
    onWindowChromeState(cb: (state: { maximized: boolean; fullscreen: boolean }) => void): void {
        ipcRenderer.on("window-chrome-state", (_event, state) => cb(state));
    },

    /** Closes this window and brings the main window forward; the stream returns to the stage. */
    returnToMain(): void {
        void ipcRenderer.invoke("viewer-return");
    },
});

void start();
