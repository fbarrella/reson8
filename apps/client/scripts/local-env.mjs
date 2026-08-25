#!/usr/bin/env node
/**
 * apps/client/scripts/local-env.mjs
 *
 * Loads apps/client/.env.local (gitignored, never committed) into
 * process.env — used to supply code-signing secrets (CSC_LINK,
 * CSC_KEY_PASSWORD, and later the Apple notarization vars) to
 * electron-builder without ever writing them into a committed file or a
 * shell profile. A real, already-exported environment variable always
 * wins over the file, matching standard dotenv semantics.
 *
 * Silent no-op if .env.local doesn't exist — building unsigned (today's
 * default behavior) still works exactly as before.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_LOCAL_PATH = join(__dirname, "..", ".env.local");

export function loadLocalEnv() {
    if (!existsSync(ENV_LOCAL_PATH)) return false;

    const lines = readFileSync(ENV_LOCAL_PATH, "utf-8").split("\n");
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        const eq = line.indexOf("=");
        if (eq === -1) continue;

        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
    return true;
}
