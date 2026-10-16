/**
 * Smoke test for src/window-chrome.ts (PRD 19 R7) — run after
 * `tsc --build`:   node scripts/window-chrome-smoke.mjs
 * Exits non-zero on any failure. No Electron.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const wc = require(resolve(here, "../dist/window-chrome.js"));

let failures = 0;
const check = (name, ok, detail = "") => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${detail}`}`);
};

const dir = mkdtempSync(join(tmpdir(), "r8-chrome-"));
try {
    check("missing file -> default (integrated)", wc.readWindowChromePrefs(dir).systemTitleBar === false);
    wc.writeWindowChromePrefs(dir, { systemTitleBar: true });
    check("write true -> read true", wc.readWindowChromePrefs(dir).systemTitleBar === true);
    check("no temp file left behind", readdirSync(dir).every((f) => !f.endsWith(".tmp")));
    wc.writeWindowChromePrefs(dir, { systemTitleBar: false });
    check("write false -> read false", wc.readWindowChromePrefs(dir).systemTitleBar === false);
    writeFileSync(join(dir, "window-chrome.json"), "{not json");
    check("corrupt file -> default", wc.readWindowChromePrefs(dir).systemTitleBar === false);
    writeFileSync(join(dir, "window-chrome.json"), JSON.stringify({ systemTitleBar: "yes" }));
    check("non-boolean -> false", wc.readWindowChromePrefs(dir).systemTitleBar === false);

    const win = wc.frameOptions("win32", false);
    check("win32: hidden + overlay", win.titleBarStyle === "hidden" && win.titleBarOverlay?.height === wc.TITLEBAR_HEIGHT - 1);
    check("win32: overlay colours", win.titleBarOverlay?.color === "#00000000" && win.titleBarOverlay?.symbolColor === "#cfd3e5");
    const lin = wc.frameOptions("linux", false);
    check("linux: hidden + overlay", lin.titleBarStyle === "hidden" && !!lin.titleBarOverlay);
    check("linux: overlay colour is one alpha step above transparent (PRD 21.6)", lin.titleBarOverlay?.color === "#00000001" && lin.titleBarOverlay?.symbolColor === "#cfd3e5");
    const mac = wc.frameOptions("darwin", false);
    check("darwin: hidden + traffic lights, no overlay", mac.titleBarStyle === "hidden" && !mac.titleBarOverlay && mac.trafficLightPosition?.y === 12);
    for (const p of ["win32", "linux", "darwin"]) {
        check(`${p}: system title bar -> OS frame`, Object.keys(wc.frameOptions(p, true)).length === 0);
    }
} finally {
    rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll window-chrome checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
