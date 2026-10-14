/**
 * Smoke test for src/update-channel.ts — run after `tsc --build`:
 *   node scripts/update-channel-smoke.mjs
 * Exits non-zero on any failure.
 *
 * Covers the pure rules only. The `allowDowngrade = false` side of the story
 * lives in main.ts (electron-updater's channel setter forces it true); nothing
 * here can exercise that without loading electron-updater itself.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { isPrerelease, effectiveBetaOptIn, resolveUpdateChannel } = require(resolve(here, "../dist/update-channel.js"));

let failures = 0;
const check = (name, ok, detail = "") => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${detail}`}`);
};

// ── isPrerelease ──
for (const v of ["3.0.0-beta.3", "2.8.0-beta.1", "3.0.0-rc.1", "3.0.0-alpha.2", "3.0.0-next.0"]) {
    check(`isPrerelease(${v}) is true`, isPrerelease(v) === true);
}
for (const v of ["2.7.0", "1.0.0", "10.20.30"]) {
    check(`isPrerelease(${v}) is false`, isPrerelease(v) === false);
}
check("isPrerelease(empty) is false", isPrerelease("") === false);

// ── effectiveBetaOptIn: an explicit user choice always wins ──
check("stored 'true' on a stable build opts in", effectiveBetaOptIn("true", "2.7.0") === true);
check("stored 'false' on a beta build opts out", effectiveBetaOptIn("false", "3.0.0-beta.3") === false);
check("stored 'true' on a beta build stays on", effectiveBetaOptIn("true", "3.0.0-beta.3") === true);
check("stored 'false' on a stable build stays off", effectiveBetaOptIn("false", "2.7.0") === false);

// ── effectiveBetaOptIn: no stored choice → the build's own nature decides ──
check("no stored choice on a stable build defaults off", effectiveBetaOptIn(null, "2.7.0") === false);
check("no stored choice on a beta build defaults on", effectiveBetaOptIn(null, "3.0.0-beta.3") === true);

// ── resolveUpdateChannel: the channel/allowPrerelease pair ──
const off = resolveUpdateChannel(false);
check("off → latest channel", off.channel === "latest", JSON.stringify(off));
check("off → allowPrerelease false", off.allowPrerelease === false, JSON.stringify(off));
const on = resolveUpdateChannel(true);
check("on → beta channel", on.channel === "beta", JSON.stringify(on));
check("on → allowPrerelease true", on.allowPrerelease === true, JSON.stringify(on));

console.log(failures === 0 ? "\nAll update-channel checks passed." : `\n${failures} update-channel check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
