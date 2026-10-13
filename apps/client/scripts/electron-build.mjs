/**
 * npm run build / build:win|linux|mac — electron-builder with the update-channel
 * arguments a prerelease version needs (PRD 19 R0, see update-channel.mjs).
 * Extra arguments (e.g. --win) are passed through unchanged.
 */

import { spawnSync } from "node:child_process";
import { updateChannelArgs } from "./update-channel.mjs";

const args = [...process.argv.slice(2), ...updateChannelArgs()];
console.log(`[electron-build] electron-builder ${args.join(" ")}`);
const res = spawnSync("npx", ["electron-builder", ...args], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(res.status ?? 1);
