/**
 * Window state persistence (PRD 15.6) — remembers the main window's size,
 * position and maximized state between sessions.
 *
 * Hand-rolled instead of `electron-window-state` (unmaintained, and this
 * project has been burned by dependency surprises before — see CLAUDE.md's
 * ESM/CJS notes). Every failure path falls back to the defaults, so a
 * missing or corrupt state file can never prevent the app from launching.
 *
 * Wayland note: compositors don't let an app choose its own window position,
 * so x/y are effectively ignored there; size and maximized state still apply.
 */

import { app, screen } from "electron";
import type { BrowserWindow, Rectangle } from "electron";
import fs from "node:fs";
import path from "node:path";

export interface WindowState {
    /** Omitted when no safe position is known — Electron then centers the window. */
    x?: number;
    y?: number;
    width: number;
    height: number;
    isMaximized: boolean;
}

/** Smallest part of the saved rectangle that must still be on a display for
 *  the saved position to be trusted (enough to grab the title bar). */
const MIN_VISIBLE_WIDTH = 100;
const MIN_VISIBLE_HEIGHT = 50;
const SAVE_DEBOUNCE_MS = 500;

function stateFilePath(): string {
    return path.join(app.getPath("userData"), "window-state.json");
}

function overlap(a: Rectangle, b: Rectangle): { w: number; h: number } {
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return { w: Math.max(0, w), h: Math.max(0, h) };
}

/**
 * Pure: turns whatever was read from disk into a state that is safe to apply
 * on the CURRENT set of displays. Exported separately from the I/O so it is
 * easy to reason about (monitor unplugged, resolution changed, junk values).
 */
export function sanitizeWindowState(
    raw: unknown,
    workAreas: Rectangle[],
    defaults: { width: number; height: number; minWidth: number; minHeight: number },
): WindowState {
    const fallback: WindowState = {
        width: defaults.width,
        height: defaults.height,
        isMaximized: false,
    };
    if (!raw || typeof raw !== "object" || workAreas.length === 0) return fallback;

    const r = raw as Record<string, unknown>;
    const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    if (!isNum(r.width) || !isNum(r.height)) return fallback;

    const isMaximized = r.isMaximized === true;
    let width = Math.round(r.width);
    let height = Math.round(r.height);

    // Is the saved position still meaningfully on some display?
    let hostArea: Rectangle | undefined;
    let hasPosition = false;
    if (isNum(r.x) && isNum(r.y)) {
        const saved: Rectangle = { x: Math.round(r.x), y: Math.round(r.y), width, height };
        hostArea = workAreas.find((area) => {
            const o = overlap(saved, area);
            return o.w >= MIN_VISIBLE_WIDTH && o.h >= MIN_VISIBLE_HEIGHT;
        });
        hasPosition = hostArea !== undefined;
    }

    // Size is clamped to the display it will land on (the saved one, or the
    // first/primary one when the position is dropped), and never below the
    // window's own minimum.
    const target = hostArea ?? workAreas[0];
    width = Math.max(defaults.minWidth, Math.min(width, target.width));
    height = Math.max(defaults.minHeight, Math.min(height, target.height));

    const result: WindowState = { width, height, isMaximized };
    if (hasPosition) {
        const x = Math.round(r.x as number);
        const y = Math.round(r.y as number);
        // Keep the whole window inside its display where it fits.
        result.x = Math.min(Math.max(x, target.x), target.x + target.width - width);
        result.y = Math.min(Math.max(y, target.y), target.y + target.height - height);
    }
    return result;
}

/** Reads and validates the saved state; any problem yields the defaults. */
export function loadWindowState(defaults: {
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
}): WindowState {
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(stateFilePath(), "utf8"));
    } catch {
        raw = undefined; // first launch, unreadable, or corrupt JSON
    }
    // `screen` may only be used after the app is ready — createWindow() runs from whenReady().
    const workAreas = screen.getAllDisplays().map((d) => d.workArea);
    // Put the primary display first so it is the fallback target.
    const primary = screen.getPrimaryDisplay().workArea;
    workAreas.sort((a, b) => Number(b.x === primary.x && b.y === primary.y) - Number(a.x === primary.x && a.y === primary.y));
    return sanitizeWindowState(raw, workAreas, defaults);
}

function writeState(win: BrowserWindow): void {
    // Bounds of a minimized/hidden/fullscreen window aren't the size the user
    // chose — keep whatever was saved last.
    if (win.isDestroyed() || win.isMinimized() || !win.isVisible() || win.isFullScreen()) return;
    try {
        // getNormalBounds() = the un-maximized rectangle, so maximizing never
        // overwrites the size the user returns to when un-maximizing.
        const b = win.getNormalBounds();
        const state: WindowState = {
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
            isMaximized: win.isMaximized(),
        };
        const file = stateFilePath();
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(state));
        fs.renameSync(tmp, file); // atomic: a crash never leaves half a file
    } catch (err) {
        console.error("[window-state] Failed to save window state:", err);
    }
}

/** Starts persisting `win`'s state (debounced on resize/move, flushed on close). */
export function trackWindowState(win: BrowserWindow): void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSave = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            writeState(win);
        }, SAVE_DEBOUNCE_MS);
    };

    win.on("resize", scheduleSave);
    win.on("move", scheduleSave);
    win.on("maximize", scheduleSave);
    win.on("unmaximize", scheduleSave);
    win.on("close", () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        writeState(win);
    });
}
