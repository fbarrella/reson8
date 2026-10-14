/**
 * Reson8 Client — the integrated title bar (PRD 19 R7).
 *
 * Electron-free so it can be tested in plain Node. Two things live here:
 *  - the "Use the system title bar" preference, a tiny JSON in userData. It is
 *    read by the main process BEFORE a window exists (localStorage isn't
 *    readable that early), so it can't live in the renderer;
 *  - the BrowserWindow options for each platform, shared by the main window and
 *    the Viewer so the two never drift apart.
 *
 * Integrated = the OS draws its own minimize/maximize/close INSIDE our bar
 * (`titleBarStyle: "hidden"` + `titleBarOverlay`, macOS: the traffic lights),
 * which keeps snap layouts, double-click maximize, the system menu and the
 * native `minimize` event the minimize-to-tray logic relies on.
 */

import * as fs from "fs";
import * as path from "path";

/** Height of `#titlebar` in px — the overlay buttons are drawn at exactly this height. */
export const TITLEBAR_HEIGHT = 38;
/**
 * The window buttons' background is TRANSPARENT (like Discord): the page paints the bar, and over a
 * dialog or the image viewer the buttons blend into what is under them instead of being a black block.
 * Hover/pressed states are drawn by the OS from the symbol colour.
 */
export const TITLEBAR_COLOR = "#00000000";
/** `--color-neutral-300` (the overlay takes plain colours, not CSS variables). */
export const TITLEBAR_SYMBOL_COLOR = "#cfd3e5";

const FILE_NAME = "window-chrome.json";

export interface WindowChromePrefs {
    /** true = today's OS frame instead of the integrated bar (restart to apply). */
    systemTitleBar: boolean;
}

export function readWindowChromePrefs(userDataDir: string): WindowChromePrefs {
    try {
        const parsed = JSON.parse(fs.readFileSync(path.join(userDataDir, FILE_NAME), "utf8"));
        return { systemTitleBar: parsed?.systemTitleBar === true };
    } catch {
        return { systemTitleBar: false }; // missing or unreadable: the default
    }
}

/** Atomic write (temp file + rename), so a crash can't leave half a file. */
export function writeWindowChromePrefs(userDataDir: string, prefs: WindowChromePrefs): void {
    const target = path.join(userDataDir, FILE_NAME);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ systemTitleBar: prefs.systemTitleBar === true }), "utf8");
    fs.renameSync(tmp, target);
}

/** The subset of BrowserWindow options this module decides (kept structural so it needs no Electron types). */
export interface FrameOptions {
    titleBarStyle?: "hidden";
    titleBarOverlay?: { color: string; symbolColor: string; height: number };
    trafficLightPosition?: { x: number; y: number };
}

/**
 * The frame options for `platform` (`process.platform`). Empty = the OS frame.
 * macOS: the traffic lights (about 14 px tall) are centred in the bar.
 */
export function frameOptions(platform: string, systemTitleBar: boolean): FrameOptions {
    if (systemTitleBar) return {};
    if (platform === "darwin") {
        return { titleBarStyle: "hidden", trafficLightPosition: { x: 14, y: Math.round((TITLEBAR_HEIGHT - 14) / 2) } };
    }
    return {
        titleBarStyle: "hidden",
        // One pixel shorter than the bar, so #titlebar's bottom border runs under the buttons too.
        titleBarOverlay: { color: TITLEBAR_COLOR, symbolColor: TITLEBAR_SYMBOL_COLOR, height: TITLEBAR_HEIGHT - 1 },
    };
}
