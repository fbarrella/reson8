/**
 * Where this install's identity key lives, and how it is protected (PRD 18.6).
 *
 * Electron-free on purpose: the OS encryption is injected as a `KeyCipher`, so
 * the migration, the locked state and the replace-on-import logic run in plain
 * Node tests (`scripts/identity-backup-smoke.mjs`) with a fake cipher. The
 * thin Electron adapter is `identity-key.ts`.
 *
 * Files in `dir`:
 *   identity-key.enc   JSON { v: 1, alg: "safeStorage", data: <b64> } — the PEM,
 *                      encrypted by the OS (DPAPI / Keychain / libsecret…)
 *   identity-key.pem   the PKCS#8 PEM in the clear, mode 0600 (where OS
 *                      encryption isn't reliable, and pre-2.7.0 installs)
 *
 * Rules that exist because losing the key means a server admin has to reset
 * the user's identity:
 *   - an encrypted key that can't be decrypted puts the store in `locked`; it
 *     NEVER mints a replacement on its own (that would silently orphan every
 *     identity bound on servers);
 *   - nothing is deleted except a plaintext PEM, and only after the encrypted
 *     copy was read back and compared; everything else is renamed aside with
 *     a timestamp.
 */

import { createPrivateKey, generateKeyPairSync, type KeyObject } from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { fingerprintOf, publicKeyBase64, signChallenge } from "./identity-proof";

export interface KeyCipher {
    /** Whether protection is real here (e.g. a Linux keyring, not "basic_text"). */
    isReliable(): boolean;
    /** Plain text → opaque base64. Throws on failure. */
    encrypt(plain: string): string;
    /** Opaque base64 → plain text. Throws when it can't be decrypted. */
    decrypt(encoded: string): string;
}

export type IdentityStorage = "encrypted" | "file" | "ephemeral";

export type IdentityStatus =
    | { state: "ok"; storage: IdentityStorage; fingerprint: string }
    | { state: "locked"; storage: "encrypted" };

export interface IdentityStoreOptions {
    dir: string;
    /** Development builds: a fresh in-memory key per launch, nothing on disk. */
    ephemeral: boolean;
    cipher: KeyCipher;
    log?: (message: string, err?: unknown) => void;
    now?: () => number;
}

const ENC_FILE = "identity-key.enc";
const PEM_FILE = "identity-key.pem";

function parsePem(pem: string): KeyObject {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error(`unexpected key type ${key.asymmetricKeyType}`);
    return key;
}

function toDer(key: KeyObject): Buffer {
    return key.export({ format: "der", type: "pkcs8" });
}

function sameKey(a: KeyObject, b: KeyObject): boolean {
    return toDer(a).equals(toDer(b));
}

export class IdentityStore {
    private loaded = false;
    private key: KeyObject | null = null;
    private storage: IdentityStorage = "file";
    private locked = false;
    private publicKeyB64 = "";
    private fingerprintText = "";

    constructor(private readonly opts: IdentityStoreOptions) {}

    // ── paths ──────────────────────────────────────────────────────────────

    private get encPath(): string {
        return join(this.opts.dir, ENC_FILE);
    }
    private get pemPath(): string {
        return join(this.opts.dir, PEM_FILE);
    }
    private log(message: string, err?: unknown): void {
        (this.opts.log ?? ((m: string, e?: unknown) => console.error(`[identity] ${m}`, e ?? "")))(message, err);
    }
    private stamp(): number {
        return (this.opts.now ?? Date.now)();
    }

    // ── public API ─────────────────────────────────────────────────────────

    status(): IdentityStatus {
        this.load();
        if (this.locked || !this.key) return { state: "locked", storage: "encrypted" };
        return { state: "ok", storage: this.storage, fingerprint: this.fingerprintText };
    }

    /** The public half, or null while the key is locked. */
    publicInfo(): { publicKey: string; fingerprint: string } | null {
        this.load();
        if (this.locked || !this.key) return null;
        return { publicKey: this.publicKeyB64, fingerprint: this.fingerprintText };
    }

    /** A signature over a server challenge, or null (locked, or a malformed nonce/host). */
    sign(nonce: unknown, host: unknown): string | null {
        this.load();
        if (this.locked || !this.key) return null;
        return signChallenge(this.key, nonce, host);
    }

    /** PKCS#8 DER for a backup. Main process only. */
    exportPkcs8Der(): Buffer | null {
        this.load();
        if (this.locked || !this.key) return null;
        return toDer(this.key);
    }

    /**
     * Makes `der` this install's key (an imported backup). The key currently on
     * disk is renamed aside, never deleted.
     */
    replaceKey(der: Buffer): void {
        this.load();
        const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
        if (key.asymmetricKeyType !== "ed25519") throw new Error("Not an Ed25519 key");
        if (!this.opts.ephemeral) {
            this.setAside(this.encPath, "replaced");
            this.setAside(this.pemPath, "replaced");
            this.persist(key);
        }
        this.locked = false;
        this.adopt(key, this.opts.ephemeral ? "ephemeral" : this.storage);
    }

    /**
     * Recovery from `locked`: move the undecryptable file aside and start a
     * fresh identity. A server admin will have to reset the old binding.
     */
    createNewAfterLock(): IdentityStatus {
        this.load();
        if (!this.locked) return this.status();
        this.setAside(this.encPath, "locked");
        const key = generateKeyPairSync("ed25519").privateKey;
        this.locked = false;
        this.persist(key);
        this.adopt(key, this.storage);
        return this.status();
    }

    // ── loading ────────────────────────────────────────────────────────────

    private adopt(key: KeyObject, storage: IdentityStorage): void {
        this.key = key;
        this.storage = storage;
        this.publicKeyB64 = publicKeyBase64(key);
        this.fingerprintText = fingerprintOf(this.publicKeyB64);
    }

    private load(): void {
        if (this.loaded) return;
        this.loaded = true;

        if (this.opts.ephemeral) {
            this.adopt(generateKeyPairSync("ed25519").privateKey, "ephemeral");
            return;
        }

        // 1. An encrypted key: decrypt it or lock — never replace it.
        if (existsSync(this.encPath)) {
            try {
                const raw = JSON.parse(readFileSync(this.encPath, "utf8"));
                if (raw?.v !== 1 || raw.alg !== "safeStorage" || typeof raw.data !== "string") {
                    throw new Error("unrecognized key file");
                }
                if (!this.opts.cipher.isReliable()) throw new Error("system encryption is not available");
                const key = parsePem(this.opts.cipher.decrypt(raw.data));
                this.adopt(key, "encrypted");
                this.dropVerifiedPlaintextCopy(key);
            } catch (err) {
                this.log("the encrypted identity key can't be decrypted — locked", err);
                this.locked = true;
            }
            return;
        }

        // 2. A plain PEM (older installs, or no reliable OS encryption).
        if (existsSync(this.pemPath)) {
            let key: KeyObject | null = null;
            try {
                key = parsePem(readFileSync(this.pemPath, "utf8"));
            } catch (err) {
                // Keep the unreadable file for inspection instead of overwriting it.
                // The new key won't match what servers have bound: an admin can "Reset key".
                this.log("identity key unreadable, creating a new one", err);
                this.setAside(this.pemPath, "unreadable");
            }
            if (key) {
                this.adopt(key, "file");
                this.tryMigrate();
                return;
            }
        }

        // 3. First run (or the unreadable case above): a new key.
        const fresh = generateKeyPairSync("ed25519").privateKey;
        this.persist(fresh);
        this.adopt(fresh, this.storage);
    }

    /** Writes `key` encrypted when the OS can be trusted with it, otherwise as a 0600 PEM. */
    private persist(key: KeyObject): void {
        const pem = key.export({ format: "pem", type: "pkcs8" }).toString();
        if (this.opts.cipher.isReliable()) {
            try {
                const data = this.opts.cipher.encrypt(pem);
                this.writeAtomic(this.encPath, JSON.stringify({ v: 1, alg: "safeStorage", data }));
                this.storage = "encrypted";
                return;
            } catch (err) {
                this.log("couldn't encrypt the identity key, storing it as a protected file", err);
            }
        }
        this.writeAtomic(this.pemPath, pem);
        this.storage = "file";
    }

    /**
     * Moves an existing plaintext key into the OS-encrypted file. The plaintext
     * is deleted only after the encrypted copy was read back, decrypted and
     * compared; any failure leaves the PEM exactly where it was.
     */
    private tryMigrate(): void {
        if (!this.opts.cipher.isReliable() || !this.key) return;
        let wroteEnc = false;
        try {
            const pem = readFileSync(this.pemPath, "utf8");
            this.writeAtomic(this.encPath, JSON.stringify({ v: 1, alg: "safeStorage", data: this.opts.cipher.encrypt(pem) }));
            wroteEnc = true;
            const back = JSON.parse(readFileSync(this.encPath, "utf8"));
            if (!sameKey(parsePem(this.opts.cipher.decrypt(back.data)), this.key)) {
                throw new Error("the encrypted copy didn't match");
            }
            unlinkSync(this.pemPath); // the one deletion: a verified duplicate of the plaintext
            this.storage = "encrypted";
        } catch (err) {
            this.log("couldn't move the identity key to encrypted storage, keeping the file", err);
            if (wroteEnc) {
                try {
                    unlinkSync(this.encPath); // only the copy THIS attempt created
                } catch {
                    /* best effort */
                }
            }
        }
    }

    /** A leftover plaintext PEM next to a working encrypted key (an interrupted migration). */
    private dropVerifiedPlaintextCopy(key: KeyObject): void {
        if (!existsSync(this.pemPath)) return;
        try {
            if (sameKey(parsePem(readFileSync(this.pemPath, "utf8")), key)) unlinkSync(this.pemPath);
        } catch {
            /* an unreadable or different PEM is left alone */
        }
    }

    private setAside(path: string, label: string): void {
        if (!existsSync(path)) return;
        try {
            renameSync(path, `${path}.${label}-${this.stamp()}`);
        } catch (err) {
            this.log(`couldn't move ${path} aside`, err);
        }
    }

    private writeAtomic(path: string, text: string): void {
        mkdirSync(this.opts.dir, { recursive: true });
        const tmp = `${path}.tmp`;
        writeFileSync(tmp, text, { encoding: "utf8", mode: 0o600 });
        renameSync(tmp, path);
    }
}
