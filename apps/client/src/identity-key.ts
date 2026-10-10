/**
 * This install's identity key (PRD 17.12, protected at rest by PRD 18.6) —
 * MAIN PROCESS ONLY. The private key never leaves this process: the preload
 * asks for a signature over a server challenge via IPC and gets only the
 * signature back; a backup is built here and written by a main-process dialog.
 *
 * The storage rules (OS-encrypted file where that is reliable, a 0600 PEM
 * otherwise, a `locked` state instead of ever replacing a key that can't be
 * decrypted) live in `identity-store.ts`; this file only supplies Electron's
 * `safeStorage` and the userData folder.
 *
 * `safeStorage` is reliable on Windows (DPAPI) and macOS (Keychain). On Linux
 * it is trusted only when a real keyring backend was selected — with
 * "basic_text" the "encryption" is a fixed key anyone can read, so the file
 * stays a plain 0600 PEM instead of pretending.
 *
 * Honest limit: this does not stop malware running AS the user on Windows or
 * Linux (it can ask the OS to decrypt, like Reson8 does). It protects copied
 * backups and synced folders, offline disk access and other OS accounts.
 *
 * Dev builds use an ephemeral key per launch, matching the fresh instance id
 * dev mode already uses. `RESON8_FORCE_PERSISTENT_IDENTITY=1` is a TEST-ONLY
 * switch that makes an unpackaged build behave like a packaged one (always
 * together with a throwaway `--user-data-dir`).
 */

import { app, safeStorage } from "electron";
import { IdentityStore, type IdentityStatus, type KeyCipher } from "./identity-store";

function isDevBuild(): boolean {
    if (process.env.RESON8_FORCE_PERSISTENT_IDENTITY === "1") return false;
    return process.env.NODE_ENV === "development" || !app.isPackaged;
}

const cipher: KeyCipher = {
    isReliable(): boolean {
        // safeStorage can't be used before the app is ready.
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

let store: IdentityStore | null = null;

function getStore(): IdentityStore {
    store ??= new IdentityStore({
        dir: app.getPath("userData"),
        ephemeral: isDevBuild(),
        cipher,
        log: (message, err) => console.error(`[identity] ${message}`, err ?? ""),
    });
    return store;
}

/** Whether this is a development build (no persistent identity, so no backup/restore). */
export function isEphemeralIdentity(): boolean {
    return isDevBuild();
}

export function getIdentityStatus(): IdentityStatus {
    return getStore().status();
}

/** The public half and its fingerprint (shown in Settings → About); null while locked. */
export function getIdentityPublic(): { publicKey: string; fingerprint: string } | null {
    return getStore().publicInfo();
}

/** A signature over a server challenge, or null when the nonce/host is malformed or the key is locked. */
export function signAuthChallenge(nonce: unknown, host: unknown): string | null {
    return getStore().sign(nonce, host);
}

export function exportIdentityPkcs8Der(): Buffer | null {
    return getStore().exportPkcs8Der();
}

export function replaceIdentityKey(der: Buffer): void {
    getStore().replaceKey(der);
}

export function createNewIdentityAfterLock(): IdentityStatus {
    return getStore().createNewAfterLock();
}
