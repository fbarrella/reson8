/**
 * Copies static assets (HTML, CSS) from src/ to dist/ that tsc doesn't handle.
 */

import { cpSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const src = resolve(__dirname, "../src/renderer");
const dest = resolve(__dirname, "../dist/renderer");

mkdirSync(dest, { recursive: true });
cpSync(src, dest, {
    recursive: true,
    filter: (source) => !source.endsWith(".ts"),
});

console.log("✅ Static assets copied to dist/renderer");
