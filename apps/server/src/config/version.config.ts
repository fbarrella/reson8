/**
 * Server Version Config — Reson8
 *
 * Reads the running server build's own version from package.json once at
 * import time. Exposed via GET_SERVER_SETTINGS so clients can warn on a
 * client/server version mismatch (Phase 12 sub-phase item 11) — this is
 * the actual deployed server's version, not anything admin-configurable.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

export const SERVER_VERSION: string = JSON.parse(
    readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8"),
).version;
