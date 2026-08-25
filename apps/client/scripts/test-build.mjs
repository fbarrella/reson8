/**
 * npm run test-build:win|linux|mac — same packaging as `build:win|linux|mac`,
 * except the artifact gets a "(test build)" marker in its filename so an
 * ad hoc build cut for local testing is never mistaken for, or accidentally
 * shipped as, a real release artifact.
 *
 * Implemented as a script (rather than a shell one-liner in package.json)
 * so the `${productName}`/`${version}`/`${ext}` template passed to
 * electron-builder's `-c.artifactName` override reaches it byte-for-byte —
 * a shell would otherwise try to expand `${version}` itself before
 * electron-builder ever sees it, silently turning the name blank.
 */

import { spawnSync } from "node:child_process";

const PLATFORM_FLAGS = { win: "--win", linux: "--linux", mac: "--mac" };

const ARTIFACT_NAME = {
    win: "${productName} Setup ${version} (test build).${ext}",
    linux: "${productName}-${version}-test-build.${ext}",
    mac: "${productName}-${version}-test-build-mac.${ext}",
};

const platform = process.argv[2];
const flag = PLATFORM_FLAGS[platform];
if (!flag) {
    console.error("Usage: node scripts/test-build.mjs <win|linux|mac>");
    process.exit(1);
}

const res = spawnSync(
    "npx",
    ["electron-builder", flag, `-c.artifactName=${ARTIFACT_NAME[platform]}`],
    { stdio: "inherit" },
);
process.exit(res.status ?? 1);
