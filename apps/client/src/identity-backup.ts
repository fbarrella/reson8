/**
 * Passphrase-protected identity backup (PRD 18.6) — PURE (Node `crypto` only),
 * tested in plain Node by `scripts/identity-backup-smoke.mjs`.
 *
 * A backup carries the two things that make this install "you": the instance
 * id and the Ed25519 private key bound to it on servers. It is how an
 * identity moves to another computer, or comes back after a reinstall or a
 * lost system keyring.
 *
 * File format (JSON, `*.reson8-identity`):
 *   { format: "reson8-identity", v: 1,
 *     kdf:    { name: "scrypt", N: 131072, r: 8, p: 1, salt: <b64> },
 *     cipher: { name: "aes-256-gcm", iv: <b64>, tag: <b64> },
 *     data:   <b64 ciphertext of the JSON payload> }
 *
 * The header fields are bound into the GCM tag as additional authenticated
 * data, so a file whose parameters were edited fails to decrypt instead of
 * being read with weaker settings. A wrong passphrase and a tampered file are
 * indistinguishable (both fail the tag) — the message says so.
 */

import { createPrivateKey, createCipheriv, createDecipheriv, randomBytes, scrypt } from "crypto";

export const BACKUP_FORMAT = "reson8-identity";
export const BACKUP_VERSION = 1;

/** scrypt cost: 128 MiB of memory, ~0.3–1 s — deliberate, it is the brute-force brake. */
const KDF = { name: "scrypt", N: 131072, r: 8, p: 1 } as const;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export const MIN_PASSPHRASE_LENGTH = 10;
const MAX_PASSPHRASE_LENGTH = 256;
/** A backup is a few hundred bytes; anything bigger is not one. */
export const MAX_BACKUP_FILE_BYTES = 64 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BackupPayload {
    instanceId: string;
    /** Base64 PKCS#8 DER of the Ed25519 private key. */
    privateKeyPkcs8Der: string;
    createdAt: string;
    appVersion: string;
}

export type BackupErrorCode = "wrong-passphrase" | "corrupt" | "unsupported";

export class BackupError extends Error {
    constructor(
        readonly code: BackupErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "BackupError";
    }
}

/** Error text for a passphrase that must not be used, or null when it is acceptable. */
export function validatePassphrase(passphrase: unknown): string | null {
    if (typeof passphrase !== "string") return "Enter a passphrase";
    if (passphrase.normalize("NFC").length < MIN_PASSPHRASE_LENGTH) {
        return `Use at least ${MIN_PASSPHRASE_LENGTH} characters`;
    }
    if (passphrase.length > MAX_PASSPHRASE_LENGTH) return `Use at most ${MAX_PASSPHRASE_LENGTH} characters`;
    return null;
}

function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        // NFC so the same passphrase typed on another OS/keyboard derives the same key.
        scrypt(
            passphrase.normalize("NFC"),
            salt,
            KEY_LENGTH,
            { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: SCRYPT_MAXMEM },
            (err, key) => (err ? reject(err) : resolve(key)),
        );
    });
}

/** The authenticated header, in a FIXED key order so both sides stringify it identically. */
function additionalData(salt: string, iv: string): Buffer {
    return Buffer.from(
        JSON.stringify({
            format: BACKUP_FORMAT,
            v: BACKUP_VERSION,
            kdf: { name: KDF.name, N: KDF.N, r: KDF.r, p: KDF.p, salt },
            cipher: { name: "aes-256-gcm", iv },
        }),
        "utf8",
    );
}

function checkPayload(value: unknown): BackupPayload {
    if (!value || typeof value !== "object") throw new BackupError("corrupt", "The backup is damaged");
    const p = value as Record<string, unknown>;
    if (
        typeof p.instanceId !== "string" ||
        !UUID.test(p.instanceId) ||
        typeof p.privateKeyPkcs8Der !== "string" ||
        typeof p.createdAt !== "string" ||
        typeof p.appVersion !== "string"
    ) {
        throw new BackupError("corrupt", "The backup is damaged");
    }
    try {
        const key = createPrivateKey({
            key: Buffer.from(p.privateKeyPkcs8Der, "base64"),
            format: "der",
            type: "pkcs8",
        });
        if (key.asymmetricKeyType !== "ed25519") throw new Error("not ed25519");
    } catch {
        throw new BackupError("corrupt", "The backup doesn't contain a valid identity key");
    }
    return {
        instanceId: p.instanceId.toLowerCase(),
        privateKeyPkcs8Der: p.privateKeyPkcs8Der,
        createdAt: p.createdAt,
        appVersion: p.appVersion,
    };
}

export async function encryptBackup(payload: BackupPayload, passphrase: string): Promise<string> {
    const problem = validatePassphrase(passphrase);
    if (problem) throw new BackupError("corrupt", problem);
    checkPayload(payload); // never write a backup that couldn't be restored

    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const key = await deriveKey(passphrase, salt);
    const saltB64 = salt.toString("base64");
    const ivB64 = iv.toString("base64");

    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH });
    cipher.setAAD(additionalData(saltB64, ivB64));
    const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);

    return JSON.stringify(
        {
            format: BACKUP_FORMAT,
            v: BACKUP_VERSION,
            kdf: { name: KDF.name, N: KDF.N, r: KDF.r, p: KDF.p, salt: saltB64 },
            cipher: { name: "aes-256-gcm", iv: ivB64, tag: cipher.getAuthTag().toString("base64") },
            data: data.toString("base64"),
        },
        null,
        2,
    );
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

export async function decryptBackup(fileText: string, passphrase: string): Promise<BackupPayload> {
    if (typeof fileText !== "string" || fileText.length > MAX_BACKUP_FILE_BYTES) {
        throw new BackupError("corrupt", "That doesn't look like a Reson8 identity backup");
    }
    // Untrusted input: everything is `unknown` and checked field by field.
    let file: Record<string, unknown> | null;
    try {
        file = asRecord(JSON.parse(fileText));
    } catch {
        throw new BackupError("corrupt", "That doesn't look like a Reson8 identity backup");
    }
    if (!file || file.format !== BACKUP_FORMAT) {
        throw new BackupError("corrupt", "That doesn't look like a Reson8 identity backup");
    }
    if (file.v !== BACKUP_VERSION) {
        throw new BackupError("unsupported", "This backup was made by a newer version of Reson8");
    }
    // The cost parameters come from an untrusted file: accept only ours, or a
    // crafted file could make us allocate gigabytes or burn minutes of CPU.
    const kdf = asRecord(file.kdf);
    const cipherInfo = asRecord(file.cipher);
    if (
        !kdf ||
        kdf.name !== KDF.name ||
        kdf.N !== KDF.N ||
        kdf.r !== KDF.r ||
        kdf.p !== KDF.p ||
        !cipherInfo ||
        cipherInfo.name !== "aes-256-gcm" ||
        typeof kdf.salt !== "string" ||
        typeof cipherInfo.iv !== "string" ||
        typeof cipherInfo.tag !== "string" ||
        typeof file.data !== "string"
    ) {
        throw new BackupError("unsupported", "This backup uses settings this version doesn't support");
    }
    const saltB64: string = kdf.salt;
    const ivB64: string = cipherInfo.iv;
    const dataB64: string = file.data;

    const salt = Buffer.from(saltB64, "base64");
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(cipherInfo.tag as string, "base64");
    if (salt.length !== SALT_LENGTH || iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
        throw new BackupError("corrupt", "The backup is damaged");
    }
    if (typeof passphrase !== "string" || passphrase.length === 0 || passphrase.length > MAX_PASSPHRASE_LENGTH) {
        throw new BackupError("wrong-passphrase", "Wrong passphrase or damaged file");
    }

    const key = await deriveKey(passphrase, salt);
    let plaintext: string;
    try {
        const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH });
        decipher.setAAD(additionalData(saltB64, ivB64));
        decipher.setAuthTag(tag);
        plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
    } catch {
        throw new BackupError("wrong-passphrase", "Wrong passphrase or damaged file");
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(plaintext);
    } catch {
        throw new BackupError("corrupt", "The backup is damaged");
    }
    return checkPayload(parsed);
}
