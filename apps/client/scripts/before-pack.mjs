/**
 * electron-builder `beforePack` hook.
 *
 * `@reson8/native-audio` and `@reson8/shared-types` are npm workspace
 * packages — `node_modules/@reson8/*` are symlinks whose real target
 * (`packages/native-audio`, `packages/shared-types`) sits outside
 * `apps/client/`. electron-builder's asar packager computes, for every
 * packaged file, a path relative to `apps/client/` to check it against the
 * `asarUnpack` glob; when a file's *real* disk path is both outside
 * `apps/client/` and contains no literal `node_modules` path segment (true
 * for anything reached through these symlinks), that computation throws
 * ("X must be under apps/client/") — regardless of where a `files` entry's
 * `to` says the file should end up in the packaged archive, since the check
 * always uses the file's original on-disk location, not its destination.
 *
 * Staging real copies here, under `apps/client/.release-vendor/`, sidesteps
 * that: the copies' real path is genuinely under `apps/client/`, so the
 * check never needs its `node_modules`-searching fallback. `package.json`'s
 * `build.files` then maps this staging dir to the right `node_modules/...`
 * destination inside the packaged app.
 *
 * That alone isn't enough, though: electron-builder *also* runs its own
 * automatic production-dependency walk (independent of `build.files`,
 * triggered by anything listed under `dependencies`) that resolves these
 * same symlinks itself and hits the identical crash. Since these two
 * packages are private, unpublished workspace packages already shipped
 * correctly via the staging above, `package.json` deliberately lists them
 * under `devDependencies` instead of `dependencies` — not because they're
 * dev-only (they're required at runtime), but so that automatic walk skips
 * them and only ever sees the two packages it can actually handle.
 */

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const VENDOR_DIR = resolve(__dirname, "../.release-vendor");

function stagePackage(pkgDirName, files) {
    const src = resolve(REPO_ROOT, "packages", pkgDirName);
    const dest = resolve(VENDOR_DIR, pkgDirName);
    rmSync(dest, { recursive: true, force: true });
    for (const rel of files) {
        const from = resolve(src, rel);
        const to = resolve(dest, rel);
        mkdirSync(dirname(to), { recursive: true });
        cpSync(from, to, { recursive: true });
    }
}

export default async function beforePack() {
    stagePackage("native-audio", ["index.js", "index.d.ts", "package.json"]);
    cpSync(
        resolve(REPO_ROOT, "packages/native-audio/prebuilds"),
        resolve(VENDOR_DIR, "native-audio/prebuilds"),
        { recursive: true, filter: (path) => !path.endsWith(".md") },
    );

    stagePackage("shared-types", ["package.json"]);
    cpSync(
        resolve(REPO_ROOT, "packages/shared-types/dist"),
        resolve(VENDOR_DIR, "shared-types/dist"),
        { recursive: true },
    );

    console.log("[before-pack] staged @reson8/native-audio and @reson8/shared-types under .release-vendor/");
}
