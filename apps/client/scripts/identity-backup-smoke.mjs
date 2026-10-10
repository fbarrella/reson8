/**
 * Smoke test for src/identity-backup.ts and src/identity-store.ts (PRD 18.6) —
 * run after `tsc --build`:   node scripts/identity-backup-smoke.mjs
 * Exits non-zero on any failure. No Electron: the OS encryption is a fake
 * cipher that can be told to be unreliable, to throw, or to belong to a
 * different "keyring".
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { generateKeyPairSync, randomUUID, verify, createPublicKey } from "node:crypto";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const dist = (f) => require(resolve(here, "../dist", f));
const backup = dist("identity-backup.js");
const { IdentityStore } = dist("identity-store.js");
const { fingerprintOf, publicKeyBase64 } = dist("identity-proof.js");

let failures = 0;
const check = (name, ok, detail = "") => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${detail}`}`);
};
const rejects = async (fn) => {
    try {
        await fn();
        return { threw: false };
    } catch (e) {
        return { threw: true, code: e.code, message: e.message };
    }
};

const newKey = () => generateKeyPairSync("ed25519").privateKey;
const fp = (key) => fingerprintOf(publicKeyBase64(key));
const pkcs8 = (key) => key.export({ format: "der", type: "pkcs8" });
const NONCE = "A".repeat(43);

// ── backup file ─────────────────────────────────────────────────────────────
const key = newKey();
const instanceId = randomUUID();
const payload = {
    instanceId,
    privateKeyPkcs8Der: pkcs8(key).toString("base64"),
    createdAt: "2026-10-10T12:00:00.000Z",
    appVersion: "2.7.0",
};
const PASS = "correct horse battery";

const file = await backup.encryptBackup(payload, PASS);
const parsed = JSON.parse(file);
check("backup is JSON with the documented header", parsed.format === "reson8-identity" && parsed.v === 1 && parsed.kdf.name === "scrypt" && parsed.cipher.name === "aes-256-gcm");
check("the file doesn't contain the key or the id in the clear", !file.includes(payload.privateKeyPkcs8Der) && !file.includes(instanceId));

const restored = await backup.decryptBackup(file, PASS);
check("round trip restores the instance id and the key", restored.instanceId === instanceId && restored.privateKeyPkcs8Der === payload.privateKeyPkcs8Der);
check("the restored key has the same fingerprint", fp(require("node:crypto").createPrivateKey({ key: Buffer.from(restored.privateKeyPkcs8Der, "base64"), format: "der", type: "pkcs8" })) === fp(key));
check("two backups of the same data differ (random salt and IV)", (await backup.encryptBackup(payload, PASS)) !== file);

let r = await rejects(() => backup.decryptBackup(file, "not the passphrase"));
check("a wrong passphrase → wrong-passphrase", r.threw && r.code === "wrong-passphrase", JSON.stringify(r));
check("…with a message that doesn't blame only the passphrase", /damaged/.test(r.message));

const tamper = (mutate) => JSON.stringify(mutate(JSON.parse(file)));
const flip = (b64) => { const b = Buffer.from(b64, "base64"); b[0] ^= 0xff; return b.toString("base64"); };
r = await rejects(() => backup.decryptBackup(tamper((f) => ({ ...f, data: flip(f.data) })), PASS));
check("a flipped ciphertext byte is detected", r.threw && r.code === "wrong-passphrase", JSON.stringify(r));
r = await rejects(() => backup.decryptBackup(tamper((f) => ({ ...f, cipher: { ...f.cipher, tag: flip(f.cipher.tag) } })), PASS));
check("a flipped tag byte is detected", r.threw && r.code === "wrong-passphrase", JSON.stringify(r));
r = await rejects(() => backup.decryptBackup(tamper((f) => ({ ...f, kdf: { ...f.kdf, salt: flip(f.kdf.salt) } })), PASS));
check("a changed salt is detected", r.threw && r.code === "wrong-passphrase", JSON.stringify(r));
r = await rejects(() => backup.decryptBackup(tamper((f) => ({ ...f, cipher: { ...f.cipher, iv: flip(f.cipher.iv) } })), PASS));
check("a changed IV is detected", r.threw && r.code === "wrong-passphrase", JSON.stringify(r));
r = await rejects(() => backup.decryptBackup(tamper((f) => ({ ...f, v: 2 })), PASS));
check("a newer format version → unsupported", r.threw && r.code === "unsupported", JSON.stringify(r));
r = await rejects(() => backup.decryptBackup(tamper((f) => ({ ...f, kdf: { ...f.kdf, N: 2 ** 24 } })), PASS));
check("a file asking for a huge scrypt cost is refused before any work", r.threw && r.code === "unsupported", JSON.stringify(r));
r = await rejects(() => backup.decryptBackup(tamper((f) => ({ ...f, kdf: { ...f.kdf, N: 1024 } })), PASS));
check("…and so is a weakened one", r.threw && r.code === "unsupported", JSON.stringify(r));
r = await rejects(() => backup.decryptBackup(tamper((f) => ({ ...f, format: "something-else" })), PASS));
check("another file type → corrupt", r.threw && r.code === "corrupt", JSON.stringify(r));
r = await rejects(() => backup.decryptBackup("not json at all", PASS));
check("non-JSON → corrupt", r.threw && r.code === "corrupt", JSON.stringify(r));
r = await rejects(() => backup.decryptBackup("x".repeat(backup.MAX_BACKUP_FILE_BYTES + 1), PASS));
check("an oversized file is refused", r.threw && r.code === "corrupt", JSON.stringify(r));
r = await rejects(() => backup.decryptBackup(file, ""));
check("an empty passphrase is refused without hashing", r.threw && r.code === "wrong-passphrase", JSON.stringify(r));

check("passphrase rules: too short", backup.validatePassphrase("short") !== null);
check("passphrase rules: 10 characters is enough", backup.validatePassphrase("tencharsxx") === null);
check("passphrase rules: not a string", backup.validatePassphrase(undefined) !== null && backup.validatePassphrase(12345678901) !== null);
check("passphrase rules: absurdly long", backup.validatePassphrase("x".repeat(300)) !== null);

const edKey = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
r = await rejects(() => backup.encryptBackup({ ...payload, privateKeyPkcs8Der: pkcs8(edKey).toString("base64") }, PASS));
check("a backup of a non-Ed25519 key is never written", r.threw);
r = await rejects(() => backup.encryptBackup({ ...payload, instanceId: "not-a-uuid" }, PASS));
check("a backup with a bad instance id is never written", r.threw);
r = await rejects(() => backup.encryptBackup(payload, "short"));
check("a weak passphrase is refused when exporting", r.threw);

// NFC: the same passphrase typed in decomposed form (e.g. from another OS) still works.
const composed = "café-passphrase!"; // é
const decomposed = "café-passphrase!"; // e + combining acute
const nfcFile = await backup.encryptBackup(payload, composed);
check("passphrases are NFC-normalized", (await backup.decryptBackup(nfcFile, decomposed)).instanceId === instanceId);

// ── the store ───────────────────────────────────────────────────────────────
function makeCipher(secret, { reliable = true, failEncrypt = false, corruptDecrypt = false } = {}) {
    return {
        _reliable: reliable,
        isReliable() { return this._reliable; },
        encrypt(plain) {
            if (failEncrypt) throw new Error("encrypt failed");
            return Buffer.from(`${secret}|${plain}`).toString("base64");
        },
        decrypt(b64) {
            const text = Buffer.from(b64, "base64").toString();
            if (!text.startsWith(`${secret}|`)) throw new Error("cannot decrypt (different keyring)");
            const plain = text.slice(secret.length + 1);
            if (corruptDecrypt) return plain.replace(/[A-Za-z]/, (c) => (c === "A" ? "B" : "A"));
            return plain;
        },
    };
}
const logs = [];
let clock = 1_000;
const mkStore = (dir, cipher, ephemeral = false) =>
    new IdentityStore({ dir, ephemeral, cipher, log: (m) => logs.push(m), now: () => ++clock });
const tmp = () => mkdtempSync(join(tmpdir(), "reson8-idstore-"));
const files = (dir) => readdirSync(dir).sort();
const writePem = (dir, k) => writeFileSync(join(dir, "identity-key.pem"), k.export({ format: "pem", type: "pkcs8" }).toString(), { mode: 0o600 });

{
    const dir = tmp();
    const s = mkStore(dir, makeCipher("A"));
    const st = s.status();
    check("fresh install + reliable OS encryption → identity-key.enc only", files(dir).join() === "identity-key.enc" && st.state === "ok" && st.storage === "encrypted", JSON.stringify([files(dir), st]));
    check("the .enc file does not contain the PEM in the clear", !readFileSync(join(dir, "identity-key.enc"), "utf8").includes("PRIVATE KEY"));
    const pub = s.publicInfo();
    const sig = s.sign(NONCE, "chat.example.com");
    check("it signs a challenge that verifies with the public key", sig && verify(null, Buffer.from(`reson8-auth-v1\n${NONCE}\nchat.example.com`), createPublicKey({ key: Buffer.from(pub.publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(sig, "base64")));
    check("it refuses a malformed nonce or host", s.sign("nope", "h") === null && s.sign(NONCE, "bad host") === null);
    const again = mkStore(dir, makeCipher("A")).status();
    check("a new process reads the same identity back", again.state === "ok" && again.fingerprint === st.fingerprint);
    rmSync(dir, { recursive: true, force: true });
}

{
    const dir = tmp();
    const s = mkStore(dir, makeCipher("A", { reliable: false }));
    const st = s.status();
    check("fresh install without reliable encryption → a 0600 PEM", files(dir).join() === "identity-key.pem" && st.storage === "file");
    if (process.platform !== "win32") check("the PEM file mode is 0600", (statSync(join(dir, "identity-key.pem")).mode & 0o777) === 0o600);
    rmSync(dir, { recursive: true, force: true });
}

{
    const dir = tmp();
    const k = newKey();
    writePem(dir, k);
    const st = mkStore(dir, makeCipher("A")).status();
    check("migration: an existing PEM moves to .enc, keeping the SAME key", st.state === "ok" && st.storage === "encrypted" && st.fingerprint === fp(k));
    check("migration: the plaintext PEM is gone afterwards", files(dir).join() === "identity-key.enc", files(dir).join());
    rmSync(dir, { recursive: true, force: true });
}

{
    const dir = tmp();
    const k = newKey();
    writePem(dir, k);
    const st = mkStore(dir, makeCipher("A", { failEncrypt: true })).status();
    check("a failing encrypt keeps the PEM and the same identity", st.state === "ok" && st.storage === "file" && st.fingerprint === fp(k) && files(dir).join() === "identity-key.pem", JSON.stringify([st, files(dir)]));
    rmSync(dir, { recursive: true, force: true });
}

{
    const dir = tmp();
    const k = newKey();
    writePem(dir, k);
    const st = mkStore(dir, makeCipher("A", { corruptDecrypt: true })).status();
    check("a migration whose read-back doesn't match keeps the PEM and removes only its own .enc", st.state === "ok" && st.storage === "file" && st.fingerprint === fp(k) && files(dir).join() === "identity-key.pem", JSON.stringify([st, files(dir)]));
    rmSync(dir, { recursive: true, force: true });
}

{
    const dir = tmp();
    const original = mkStore(dir, makeCipher("A")).status();
    const encBefore = readFileSync(join(dir, "identity-key.enc"));
    const listBefore = files(dir).join();
    const locked = mkStore(dir, makeCipher("B")); // a different keyring
    check("an .enc this OS can't decrypt → locked", locked.status().state === "locked");
    check("locked: no public key, no signature, no export", locked.publicInfo() === null && locked.sign(NONCE, "h") === null && locked.exportPkcs8Der() === null);
    check("locked: NOTHING was created, replaced or deleted", files(dir).join() === listBefore && readFileSync(join(dir, "identity-key.enc")).equals(encBefore));
    const noKeyring = mkStore(dir, makeCipher("A", { reliable: false }));
    check("locked also when the keyring is unavailable right now", noKeyring.status().state === "locked");
    check("the original identity is intact when the keyring comes back", mkStore(dir, makeCipher("A")).status().fingerprint === original.fingerprint);

    const recovered = locked.createNewAfterLock();
    check("'create new identity' starts a different one", recovered.state === "ok" && recovered.fingerprint !== original.fingerprint);
    check("…and keeps the locked file aside (never deleted)", files(dir).some((f) => /^identity-key\.enc\.locked-\d+$/.test(f)), files(dir).join());
    check("…and the new identity persists", mkStore(dir, makeCipher("B")).status().fingerprint === recovered.fingerprint);
    rmSync(dir, { recursive: true, force: true });
}

{
    const dir = tmp();
    const old = mkStore(dir, makeCipher("A", { reliable: false })).status();
    const imported = newKey();
    const s = mkStore(dir, makeCipher("A", { reliable: false }));
    s.replaceKey(pkcs8(imported));
    check("replaceKey makes the imported key current", s.status().fingerprint === fp(imported) && s.status().fingerprint !== old.fingerprint);
    check("replaceKey keeps the previous key file aside", files(dir).some((f) => /^identity-key\.pem\.replaced-\d+$/.test(f)), files(dir).join());
    check("the imported key persists", mkStore(dir, makeCipher("A", { reliable: false })).status().fingerprint === fp(imported));
    check("exportPkcs8Der returns the current key", s.exportPkcs8Der().equals(pkcs8(imported)));
    rmSync(dir, { recursive: true, force: true });
}

{
    const dir = tmp();
    mkStore(dir, makeCipher("A"));
    mkStore(dir, makeCipher("A")).status();
    const lockedStore = mkStore(dir, makeCipher("B"));
    check("(setup) the store starts locked", lockedStore.status().state === "locked");
    const imported = newKey();
    lockedStore.replaceKey(pkcs8(imported));
    check("importing a backup recovers a locked identity", lockedStore.status().state === "ok" && lockedStore.status().fingerprint === fp(imported));
    check("…and it is stored encrypted for the CURRENT keyring", mkStore(dir, makeCipher("B")).status().fingerprint === fp(imported));
    rmSync(dir, { recursive: true, force: true });
}

{
    const dir = tmp();
    writeFileSync(join(dir, "identity-key.pem"), "this is not a key");
    const st = mkStore(dir, makeCipher("A", { reliable: false })).status();
    check("an unreadable PEM is kept aside and a new identity is created", st.state === "ok" && files(dir).some((f) => /^identity-key\.pem\.unreadable-\d+$/.test(f)) && existsSync(join(dir, "identity-key.pem")), files(dir).join());
    rmSync(dir, { recursive: true, force: true });
}

{
    const dir = tmp();
    const a = mkStore(dir, makeCipher("A"), true).status();
    const b = mkStore(dir, makeCipher("A"), true).status();
    check("ephemeral (dev) stores write nothing and differ per launch", files(dir).length === 0 && a.storage === "ephemeral" && a.fingerprint !== b.fingerprint);
    rmSync(dir, { recursive: true, force: true });
}

{
    // An interrupted migration: the encrypted copy exists AND the plaintext is still there.
    const dir = tmp();
    const k = newKey();
    writePem(dir, k);
    mkStore(dir, makeCipher("A", { reliable: false })); // not used: only to prove PEM stays
    const enc = mkStore(dir, makeCipher("A")); // migrates and deletes the PEM
    enc.status();
    writePem(dir, k); // resurrect the same plaintext, as if the delete hadn't happened
    const st = mkStore(dir, makeCipher("A")).status();
    check("a leftover plaintext copy of the SAME key is removed once .enc works", st.state === "ok" && files(dir).join() === "identity-key.enc", files(dir).join());
    writePem(dir, newKey()); // a DIFFERENT key next to a working .enc
    mkStore(dir, makeCipher("A")).status();
    check("a DIFFERENT plaintext key is left alone", files(dir).includes("identity-key.pem"));
    rmSync(dir, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
