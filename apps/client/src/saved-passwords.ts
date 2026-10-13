/**
 * Saved server passwords (PRD 19 C1) — MAIN PROCESS ONLY. The Electron adapter
 * around `saved-passwords-store.ts`: it supplies `safeStorage` and the userData
 * folder, with the same "reliable backend" rule as the identity key (PRD 18.6).
 *
 * The plaintext never goes back to the renderer: `main.ts` hands it only to the
 * preload's connect path through an IPC that checks the sender is the main
 * window.
 */

import { app, safeStorage } from "electron";
import { SavedPasswordStore, type PasswordCipher } from "./saved-passwords-store";

const cipher: PasswordCipher = {
    isReliable(): boolean {
        if (!app.isReady()) return false;
        try {
            if (!safeStorage.isEncryptionAvailable()) return false;
            if (process.platform === "linux") {
                const backend = safeStorage.getSelectedStorageBackend();
                return backend !== "basic_text" && backend !== "unknown";
            }
            return true;
        } catch {
            return false;
        }
    },
    encrypt: (plain) => safeStorage.encryptString(plain).toString("base64"),
    decrypt: (encoded) => safeStorage.decryptString(Buffer.from(encoded, "base64")),
};

let store: SavedPasswordStore | null = null;

export function getSavedPasswords(): SavedPasswordStore {
    store ??= new SavedPasswordStore({
        dir: app.getPath("userData"),
        cipher,
        log: (message, err) => console.error(`[saved-passwords] ${message}`, err ?? ""),
    });
    return store;
}
