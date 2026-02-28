/**
 * Instance Identity — persistent UUID for each Reson8 client.
 *
 * On first launch a random UUID is generated and written to
 * `<userData>/instance-id.txt`. Subsequent launches read the
 * same file, giving this Electron instance a stable identity
 * without requiring user registration or login.
 */

import { app } from "electron";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const ID_FILE = join(app.getPath("userData"), "instance-id.txt");

/**
 * Returns (or creates) the persistent instance ID for this client.
 * In development mode, generates a fresh random UUID every time to allow
 * easily testing with multiple local clients.
 */
export function getInstanceId(): string {
    const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

    if (isDev) {
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
