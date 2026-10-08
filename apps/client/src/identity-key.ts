/**
 * This install's identity key (PRD 17.12) — MAIN PROCESS ONLY. The private
 * key never leaves this process: the preload asks for a signature over a
 * server challenge via IPC, and gets only the signature back.
 *
 * Packaged builds keep an Ed25519 key in `<userData>/identity-key.pem`
 * (PKCS#8, file mode 0600), next to `instance-id.txt`. OS-keychain
 * encryption (`safeStorage`) was rejected on purpose: on Linux without a
 * keyring it silently falls back to plain text, and if the keyring later
 * becomes unavailable decryption fails and the identity is lost for good.
 * Dev builds use an ephemeral key per launch, matching the fresh instance id
 * dev mode already uses (see instance-id.ts).
 */

import { app } from "electron";
import { createPrivateKey, generateKeyPairSync, type KeyObject } from "crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { fingerprintOf, publicKeyBase64, signChallenge } from "./identity-proof";

interface Identity {
    privateKey: KeyObject;
    publicKey: string;
    fingerprint: string;
}

let identity: Identity | null = null;

function keyFile(): string {
    return join(app.getPath("userData"), "identity-key.pem");
}

function isDevBuild(): boolean {
    return process.env.NODE_ENV === "development" || !app.isPackaged;
}

function loadOrCreate(): Identity {
    if (identity) return identity;

    let privateKey: KeyObject | null = null;
    if (!isDevBuild() && existsSync(keyFile())) {
        try {
            const loaded = createPrivateKey(readFileSync(keyFile(), "utf8"));
            if (loaded.asymmetricKeyType !== "ed25519") throw new Error(`unexpected key type ${loaded.asymmetricKeyType}`);
            privateKey = loaded;
        } catch (err) {
            // Keep the unreadable file for inspection instead of overwriting it.
            // The new key won't match what servers have bound: a server admin
            // can "Reset key" in User Management (PRD 17.12).
            console.error("[identity] identity key unreadable, creating a new one:", err);
            try {
                renameSync(keyFile(), `${keyFile()}.unreadable-${Date.now()}`);
            } catch { /* best effort */ }
        }
    }

    if (!privateKey) {
        privateKey = generateKeyPairSync("ed25519").privateKey;
        if (!isDevBuild()) {
            const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
            writeFileSync(keyFile(), pem, { encoding: "utf8", mode: 0o600 });
        }
    }

    const publicKey = publicKeyBase64(privateKey);
    identity = { privateKey, publicKey, fingerprint: fingerprintOf(publicKey) };
    return identity;
}

/** The public half and its fingerprint (shown in Settings → About). */
export function getIdentityPublic(): { publicKey: string; fingerprint: string } {
    const { publicKey, fingerprint } = loadOrCreate();
    return { publicKey, fingerprint };
}

/** A signature over a server challenge, or null when the nonce/host is malformed. */
export function signAuthChallenge(nonce: unknown, host: unknown): string | null {
    return signChallenge(loadOrCreate().privateKey, nonce, host);
}
