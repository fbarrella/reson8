/**
 * Saved server passwords (PRD 19 C1) — the storage rules, Electron-free so they
 * are unit-tested in plain Node (the OS cipher is injected, like identity-store).
 *
 * `<userData>/server-passwords.json` = { [savedServerId]: base64(encrypted pw) },
 * written atomically with mode 0600. A password is only ever stored when the
 * cipher is RELIABLE (DPAPI / Keychain / a real Linux keyring): with Linux's
 * "basic_text" backend the "encryption" is a fixed key, so nothing is stored
 * and the caller is told (`{ stored: false }`) instead of pretending.
 *
 * The plaintext is returned ONLY by `get()`, which the main process exposes to
 * the preload's connect path alone — never to the renderer.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface PasswordCipher {
    /** true only when encrypting really protects the value on this machine. */
    isReliable(): boolean;
    encrypt(plain: string): string;
    decrypt(encoded: string): string;
}

export const MAX_PASSWORD_LENGTH = 256;
const ID_PATTERN = /^[0-9a-fA-F-]{8,64}$/;

/** A saved-server id is a UUID-shaped string; anything else is refused. */
export function isValidSavedServerId(id: unknown): id is string {
    return typeof id === "string" && ID_PATTERN.test(id);
}

export function isValidPassword(pw: unknown): pw is string {
    return typeof pw === "string" && pw.length <= MAX_PASSWORD_LENGTH;
}

export class SavedPasswordStore {
    private readonly file: string;

    constructor(
        private readonly opts: {
            dir: string;
            cipher: PasswordCipher;
            log?: (message: string, err?: unknown) => void;
        },
    ) {
        this.file = path.join(opts.dir, "server-passwords.json");
    }

    private read(): Record<string, string> {
        try {
            if (!existsSync(this.file)) return {};
            const parsed: unknown = JSON.parse(readFileSync(this.file, "utf-8"));
            if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
            const out: Record<string, string> = {};
            for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
                if (isValidSavedServerId(k) && typeof v === "string") out[k] = v;
            }
            return out;
        } catch (err) {
            this.opts.log?.("could not read the saved-password file", err);
            return {};
        }
    }

    private write(data: Record<string, string>): void {
        mkdirSync(this.opts.dir, { recursive: true });
        const tmp = `${this.file}.tmp`;
        writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
        renameSync(tmp, this.file);
    }

    /** Whether storing is possible at all on this machine. */
    available(): boolean {
        try {
            return this.opts.cipher.isReliable();
        } catch {
            return false;
        }
    }

    set(id: string, password: string): { stored: boolean } {
        if (!isValidSavedServerId(id) || !isValidPassword(password)) return { stored: false };
        if (!this.available()) return { stored: false };
        try {
            const data = this.read();
            data[id] = this.opts.cipher.encrypt(password);
            this.write(data);
            return { stored: true };
        } catch (err) {
            this.opts.log?.("could not store a password", err);
            return { stored: false };
        }
    }

    has(id: string): boolean {
        return isValidSavedServerId(id) && id in this.read();
    }

    /** The decrypted password, or null (unknown id, undecryptable, unreliable cipher). */
    get(id: string): string | null {
        if (!isValidSavedServerId(id) || !this.available()) return null;
        const encoded = this.read()[id];
        if (encoded === undefined) return null;
        try {
            return this.opts.cipher.decrypt(encoded);
        } catch (err) {
            this.opts.log?.("could not decrypt a saved password", err);
            return null;
        }
    }

    delete(id: string): void {
        if (!isValidSavedServerId(id)) return;
        try {
            const data = this.read();
            if (!(id in data)) return;
            delete data[id];
            this.write(data);
        } catch (err) {
            this.opts.log?.("could not delete a saved password", err);
        }
    }
}
