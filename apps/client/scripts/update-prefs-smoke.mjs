/**
 * Smoke test for src/update-prefs.ts (PRD 20 G1) — run after `tsc --build`:
 *   node scripts/update-prefs-smoke.mjs
 * Exits non-zero on any failure. No Electron.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const up = require(resolve(here, "../dist/update-prefs.js"));

let failures = 0;
const check = (name, ok) => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
};

const dir = mkdtempSync(join(tmpdir(), "r8-update-prefs-"));
try {
    check("missing file -> false", up.readUpdatePrefs(dir).betaUpdates === false);
    up.writeUpdatePrefs(dir, { betaUpdates: true });
    check("write true -> read true", up.readUpdatePrefs(dir).betaUpdates === true);
    check("no temp file left behind", readdirSync(dir).every((f) => !f.endsWith(".tmp")));
    up.writeUpdatePrefs(dir, { betaUpdates: false });
    check("write false -> read false", up.readUpdatePrefs(dir).betaUpdates === false);
    writeFileSync(join(dir, "update-prefs.json"), "{not json");
    check("corrupt JSON -> false", up.readUpdatePrefs(dir).betaUpdates === false);
    writeFileSync(join(dir, "update-prefs.json"), JSON.stringify({ betaUpdates: "yes" }));
    check("non-boolean -> false", up.readUpdatePrefs(dir).betaUpdates === false);
} finally {
    rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log("\nAll update-prefs checks passed.");
