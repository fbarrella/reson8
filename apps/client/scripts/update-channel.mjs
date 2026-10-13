/**
 * Update-channel arguments for electron-builder (PRD 19 R0).
 *
 * electron-builder 25 does NOT derive the update channel from the app version
 * for the GitHub provider (app-builder-lib's PublishManager only applies it to
 * generic/S3): a "3.0.0-beta.1" build would write latest.yml /
 * latest-linux.yml / latest-mac.yml. A prerelease build is therefore given
 * `-c.publish.channel=<id>` so it writes beta.yml / beta-linux.yml /
 * beta-mac.yml — exactly the files a beta app asks for first (electron-updater's
 * GitHubProvider). Only those are uploaded to the GitHub pre-release, so a
 * stable 2.7.x client can never pick a beta up from a release whose
 * "pre-release" box was forgotten: it finds no latest.yml there.
 *
 * Every packaging path uses this: scripts/electron-build.mjs (build:*),
 * scripts/test-build.mjs (test-build:*) and the root scripts/release-all.mjs.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Mirrors parseVersion() in src/app-version.ts (kept dependency-free so it runs before tsc).
const VERSION_SHAPE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** The client's own version, from apps/client/package.json. */
export function clientVersion() {
    return JSON.parse(readFileSync(resolve(here, "../package.json"), "utf8")).version;
}

/** "beta" for "3.0.0-beta.2", null for a release. Throws on a malformed version. */
export function prereleaseChannelOf(version) {
    const m = VERSION_SHAPE.exec(version);
    if (!m) throw new Error(`apps/client/package.json has a malformed version: "${version}"`);
    return m[4] === undefined ? null : m[4].split(".")[0];
}

/** Extra electron-builder CLI arguments for this version ([] for a stable release). */
export function updateChannelArgs(version = clientVersion()) {
    const channel = prereleaseChannelOf(version);
    if (channel === null) return [];
    if (!/^[a-z]+$/.test(channel)) {
        throw new Error(`Unsupported prerelease channel "${channel}" — electron-updater only follows alpha/beta`);
    }
    return [`-c.publish.channel=${channel}`];
}
