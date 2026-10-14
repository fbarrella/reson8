/**
 * Update preferences (PRD 20 G1): whether a STABLE build also takes beta
 * releases. A small JSON file in userData, read by the main process only.
 * Pure Node (no Electron import), so it is smoke-tested in plain Node.
 */
import * as fs from "fs";
import * as path from "path";

const FILE_NAME = "update-prefs.json";

export interface UpdatePrefs {
    /** true = a stable build also offers newer beta releases. */
    betaUpdates: boolean;
}

export function readUpdatePrefs(userDataDir: string): UpdatePrefs {
    try {
        const parsed = JSON.parse(fs.readFileSync(path.join(userDataDir, FILE_NAME), "utf8"));
        return { betaUpdates: parsed?.betaUpdates === true };
    } catch {
        return { betaUpdates: false }; // missing or unreadable: stable only
    }
}

/** Atomic write (temp file + rename), so a crash can't leave half a file. */
export function writeUpdatePrefs(userDataDir: string, prefs: UpdatePrefs): void {
    const target = path.join(userDataDir, FILE_NAME);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ betaUpdates: prefs.betaUpdates === true }), "utf8");
    fs.renameSync(tmp, target);
}
