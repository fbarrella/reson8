/**
 * Smoke test for src/app-version.ts (PRD 19 R0) — run after `tsc --build`:
 *   node scripts/app-version-smoke.mjs
 * The client has no unit-test runner, so this exercises the pure module
 * directly from the compiled output. Exits non-zero on any failure.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const v = require(resolve(here, "../dist/app-version.js"));

let failures = 0;
const check = (name, ok, detail = "") => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${detail}`}`);
};
const sign = (n) => (n === null ? null : Math.sign(n));

// ── Ordering: each version is strictly lower than the next ──
const ascending = [
    "2.6.0",
    "2.7.0",
    "3.0.0-alpha",
    "3.0.0-alpha.1",
    "3.0.0-beta",
    "3.0.0-beta.1",
    "3.0.0-beta.2",
    "3.0.0-beta.9",
    "3.0.0-beta.10",
    "3.0.0-beta.10.1",
    "3.0.0",
    "3.0.1",
    "3.1.0",
    "10.0.0",
];
for (let i = 0; i + 1 < ascending.length; i++) {
    const [a, b] = [ascending[i], ascending[i + 1]];
    check(`${a} < ${b}`, sign(v.compareVersions(a, b)) === -1, String(v.compareVersions(a, b)));
    check(`${b} > ${a}`, sign(v.compareVersions(b, a)) === 1, String(v.compareVersions(b, a)));
}
check("numeric identifier < alphanumeric (1.0.0-1 < 1.0.0-alpha)", sign(v.compareVersions("1.0.0-1", "1.0.0-alpha")) === -1);

// ── Equality ──
check("2.7.0 == 2.7.0", v.compareVersions("2.7.0", "2.7.0") === 0);
check("v3.0.0 == 3.0.0", v.compareVersions("v3.0.0", "3.0.0") === 0);
check("3.0.0-beta.1 == 3.0.0-beta.1", v.compareVersions("3.0.0-beta.1", "3.0.0-beta.1") === 0);

// ── Unparseable → null ──
for (const [a, b] of [["3.0", "3.0.0"], ["x", "2.7.0"], ["2.7.0", ""], ["1.2.3+build", "1.2.3"], ["01.2.3x", "1.2.3"], ["3.0.0-", "3.0.0"]]) {
    check(`compareVersions(${JSON.stringify(a)}, ${JSON.stringify(b)}) === null`, v.compareVersions(a, b) === null, String(v.compareVersions(a, b)));
}

// ── Prerelease helpers ──
check("isPrerelease(3.0.0-beta.1)", v.isPrerelease("3.0.0-beta.1") === true);
check("!isPrerelease(2.7.0)", v.isPrerelease("2.7.0") === false);
check("!isPrerelease(garbage)", v.isPrerelease("not-a-version") === false);
check("prereleaseChannel(3.0.0-beta.3) === beta", v.prereleaseChannel("3.0.0-beta.3") === "beta");
check("prereleaseChannel(2.7.0) === null", v.prereleaseChannel("2.7.0") === null);
check("parseVersion(3.0.0-beta.2).pre", JSON.stringify(v.parseVersion("3.0.0-beta.2")?.pre) === '["beta",2]');

console.log(failures === 0 ? "\nAll app-version checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
