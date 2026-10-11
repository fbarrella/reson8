/**
 * Instance Identity — persistent UUID for each Reson8 client.
 *
 * On first launch a random UUID is generated and written to
 * `<userData>/instance-id.txt`. Subsequent launches read the
 * same file, giving this Electron instance a stable identity
 * without requiring user registration or login.
 */

import { app } from "electron";
import { readFileSync, writeFileSync, existsSync, renameSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const ID_FILE = join(app.getPath("userData"), "instance-id.txt");

/**
 * Development builds get a fresh id on every call. RESON8_FORCE_PERSISTENT_IDENTITY=1
 * is a TEST-ONLY switch (same one identity-key.ts honors, always used with a
 * throwaway --user-data-dir) that makes an unpackaged build persist its id and
 * key like a packaged one.
 */
function isDevBuild(): boolean {
    if (process.env.RESON8_FORCE_PERSISTENT_IDENTITY === "1") return false;
    return process.env.NODE_ENV === "development" || !app.isPackaged;
}

/**
 * Whether this client has run before, independent of any particular
 * feature's own persisted state — the ID file is written on this client's
 * actual first-ever launch, before anything else touches userData. Must be
 * called before getInstanceId(), which creates the file as a side effect.
 */
export function hasExistingInstanceId(): boolean {
    return !isDevBuild() && existsSync(ID_FILE);
}

/**
 * Returns (or creates) the persistent instance ID for this client.
 * In development mode, generates a fresh random UUID every time to allow
 * easily testing with multiple local clients.
 */
export function getInstanceId(): string {
    if (isDevBuild()) {
        return randomUUID();
    }

    if (existsSync(ID_FILE)) {
        const stored = readFileSync(ID_FILE, "utf-8").trim();
        if (stored.length > 0) return stored;
    }

    const id = randomUUID();
    writeFileSync(ID_FILE, id, "utf-8");
    return id;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Makes `id` this install's instance id (an imported identity backup, PRD
 * 18.6). The previous file is renamed aside, never deleted. The caller must
 * restart the app: the id is cached in several places.
 */
export function replaceInstanceId(id: string): void {
    if (!UUID_PATTERN.test(id)) throw new Error("Not a valid instance id");
    if (existsSync(ID_FILE)) {
        try {
            renameSync(ID_FILE, `${ID_FILE}.replaced-${Date.now()}`);
        } catch {
            /* the write below still replaces it */
        }
    }
    writeFileSync(ID_FILE, id.toLowerCase(), "utf-8");
}
