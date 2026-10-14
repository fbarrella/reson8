/**
 * Smoke test for src/update-release.ts — run after `tsc --build`:
 *   node scripts/update-release-smoke.mjs
 * Exits non-zero on any failure.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const {
    parseVersion,
    compareVersions,
    extractReleaseTags,
    selectUpdateTarget,
} = require(resolve(here, "../dist/update-release.js"));

let failures = 0;
const check = (name, ok, detail = "") => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${detail}`}`);
};
const gt = (a, b) => compareVersions(a, b) > 0;
const lt = (a, b) => compareVersions(a, b) < 0;
const eq = (a, b) => compareVersions(a, b) === 0;

// ── parseVersion ──
check("parses a plain version", JSON.stringify(parseVersion("2.8.0")) === JSON.stringify({ major: 2, minor: 8, patch: 0, prerelease: [] }));
check("strips the leading v", parseVersion("v2.8.0")?.major === 2);
check("parses a prerelease", JSON.stringify(parseVersion("v3.0.0-beta.3")?.prerelease) === JSON.stringify(["beta", "3"]));
check("ignores build metadata", JSON.stringify(parseVersion("3.0.0-rc.1+meta")?.prerelease) === JSON.stringify(["rc", "1"]));
for (const bad of ["not-a-version", "1.2", "1.2.3.4", "", "v"]) {
    check(`rejects ${JSON.stringify(bad)}`, parseVersion(bad) === null);
}

// ── compareVersions (semver precedence) ──
check("3.0.0-beta.3 > 2.8.0", gt("3.0.0-beta.3", "2.8.0"));
check("3.0.0 > 3.0.0-beta.3", gt("3.0.0", "3.0.0-beta.3"));
check("3.0.0-beta.10 > 3.0.0-beta.3 (numeric, not lexical)", gt("3.0.0-beta.10", "3.0.0-beta.3"));
check("3.0.0-beta.3 > 3.0.0-beta.2", gt("3.0.0-beta.3", "3.0.0-beta.2"));
check("3.0.0-alpha.1 < 3.0.0-beta.1", lt("3.0.0-alpha.1", "3.0.0-beta.1"));
check("3.0.0-beta < 3.0.0-beta.1 (shorter prefix is lower)", lt("3.0.0-beta", "3.0.0-beta.1"));
check("v-prefix is ignored", eq("v2.8.0", "2.8.0"));
check("2.10.0 > 2.9.0", gt("2.10.0", "2.9.0"));

// ── extractReleaseTags ──
// Includes a release-notes body with an escaped link that must NOT be picked up.
const feed = `<?xml version="1.0"?>
<feed>
  <link rel="self" href="https://github.com/fbarrella/reson8/releases.atom"/>
  <entry>
    <link rel="alternate" type="text/html" href="https://github.com/fbarrella/reson8/releases/tag/v2.8.0"/>
    <content type="html">&lt;p&gt;go back to &lt;a href=&quot;https://github.com/fbarrella/reson8/releases/tag/v9.9.9&quot;&gt;stable&lt;/a&gt;&lt;/p&gt;</content>
  </entry>
  <entry>
    <link rel="alternate" type="text/html" href="https://github.com/fbarrella/reson8/releases/tag/v3.0.0-beta.3"/>
  </entry>
  <entry>
    <link rel="alternate" type="text/html" href="https://github.com/fbarrella/reson8/releases/tag/v2.7.0"/>
  </entry>
  <entry>
    <title>docs</title>
  </entry>
</feed>`;
check(
    "extractReleaseTags reads <link> hrefs only",
    JSON.stringify(extractReleaseTags(feed)) === JSON.stringify(["v2.8.0", "v3.0.0-beta.3", "v2.7.0"]),
    JSON.stringify(extractReleaseTags(feed)),
);

// ── selectUpdateTarget ──
const tags = ["v2.8.0", "v3.0.0-beta.3", "v2.7.0", "v2.6.0"];
const on = selectUpdateTarget(tags, { allowPrerelease: true });
check("beta on → newest beta", on?.tag === "v3.0.0-beta.3" && on?.channel === "beta" && on?.version === "3.0.0-beta.3", JSON.stringify(on));
const off = selectUpdateTarget(tags, { allowPrerelease: false });
check("beta off → newest stable", off?.tag === "v2.8.0" && off?.channel === "latest" && off?.version === "2.8.0", JSON.stringify(off));
const withStable = selectUpdateTarget(["v3.0.0", "v3.0.0-beta.3"], { allowPrerelease: true });
check("beta on, a newer stable wins → latest channel", withStable?.tag === "v3.0.0" && withStable?.channel === "latest", JSON.stringify(withStable));
const betas = selectUpdateTarget(["v3.0.0-beta.3", "v3.0.0-beta.10"], { allowPrerelease: true });
check("newest beta by semver (beta.10 > beta.3)", betas?.tag === "v3.0.0-beta.10", JSON.stringify(betas));
check("non-semver tags are skipped", selectUpdateTarget(["docs", "v2.8.0", "nightly"], { allowPrerelease: true })?.tag === "v2.8.0");
check("the shadowing case resolves to the beta", selectUpdateTarget(extractReleaseTags(feed), { allowPrerelease: true })?.tag === "v3.0.0-beta.3");
check("nothing qualifies → null", selectUpdateTarget(["docs", "nightly"], { allowPrerelease: true }) === null);
check("empty feed → null", selectUpdateTarget([], { allowPrerelease: true }) === null);
check("beta off, only betas present → null", selectUpdateTarget(["v3.0.0-beta.3"], { allowPrerelease: false }) === null);

console.log(failures === 0 ? "\nAll update-release checks passed." : `\n${failures} update-release check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
