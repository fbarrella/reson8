#!/usr/bin/env node
/**
 * apps/client/scripts/build-signed.mjs
 *
 * Thin wrapper around `electron-builder` that first loads
 * apps/client/.env.local (see local-env.mjs) so code-signing secrets
 * (CSC_LINK, CSC_KEY_PASSWORD, ...) are picked up automatically —
 * `npm run build:win` just works if a .env.local is present, and still
 * produces an unsigned build exactly as before if it isn't.
 *
 * Usage: node scripts/build-signed.mjs --win   (or --linux, --mac)
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadLocalEnv } from "./local-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = join(__dirname, "..");

const loaded = loadLocalEnv();
console.log(
    loaded
        ? "[build-signed] Loaded apps/client/.env.local"
        : "[build-signed] No apps/client/.env.local found — building unsigned (see .env.local.example)",
);

const args = process.argv.slice(2);
const res = spawnSync("npx", ["electron-builder", ...args], {
    stdio: "inherit",
    cwd: CLIENT_DIR,
    env: process.env,
});
process.exit(res.status ?? 1);
