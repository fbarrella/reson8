/**
 * Smoke test for src/saved-passwords-store.ts (PRD 19 C1) — run after
 * `tsc --build`:   node scripts/saved-passwords-smoke.mjs
 * Exits non-zero on any failure. No Electron: the OS cipher is a fake that can
 * be unreliable or throw.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { SavedPasswordStore, isValidSavedServerId, isValidPassword, MAX_PASSWORD_LENGTH } = require(
    resolve(here, "../dist/saved-passwords-store.js"),
);

let failures = 0;
const check = (name, ok, detail = "") => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${detail}`}`);
};

const fakeCipher = (state = {}) => ({
    isReliable: () => state.reliable !== false,
    encrypt: (p) => {
        if (state.throwEncrypt) throw new Error("boom");
        return Buffer.from(`enc:${p}`).toString("base64");
    },
    decrypt: (e) => {
        if (state.throwDecrypt) throw new Error("wrong keyring");
        const s = Buffer.from(e, "base64").toString("utf-8");
        if (!s.startsWith("enc:")) throw new Error("not ours");
        return s.slice(4);
    },
});

const dir = mkdtempSync(join(tmpdir(), "reson8-pw-"));
const file = join(dir, "server-passwords.json");
const mk = (state) => new SavedPasswordStore({ dir, cipher: fakeCipher(state) });
const id1 = randomUUID();
const id2 = randomUUID();

try {
    // validation
    check("uuid ids are valid", isValidSavedServerId(id1));
    check("garbage ids are refused", !isValidSavedServerId("../../etc/passwd") && !isValidSavedServerId("") && !isValidSavedServerId(5));
    check("password length bound", isValidPassword("x".repeat(MAX_PASSWORD_LENGTH)) && !isValidPassword("x".repeat(MAX_PASSWORD_LENGTH + 1)) && !isValidPassword(7));

    // store / get / has / delete
    const s = mk();
    check("set stores", s.set(id1, "hunter2").stored === true);
    check("has", s.has(id1) && !s.has(id2));
    check("get returns the plaintext (main-process only)", s.get(id1) === "hunter2");
    const onDisk = readFileSync(file, "utf-8");
    check("the file never contains the plaintext", !onDisk.includes("hunter2"), onDisk);
    if (process.platform !== "win32") check("the file is 0600", (statSync(file).mode & 0o777) === 0o600);
    check("a second entry does not disturb the first", s.set(id2, "other").stored && s.get(id1) === "hunter2" && s.get(id2) === "other");
    s.delete(id1);
    check("delete removes only that entry", !s.has(id1) && s.has(id2));
    check("deleting an unknown id is a no-op", (s.delete(randomUUID()), true));

    // refusals
    check("set refuses a bad id", mk().set("nope", "x").stored === false);
    check("set refuses an over-long password", mk().set(id1, "x".repeat(MAX_PASSWORD_LENGTH + 1)).stored === false);
    const unreliable = mk({ reliable: false });
    check("unreliable cipher: nothing stored", unreliable.set(id1, "x").stored === false && unreliable.available() === false);
    check("unreliable cipher: get returns null even for a stored id", unreliable.get(id2) === null);
    check("encrypt failure is reported, not thrown", mk({ throwEncrypt: true }).set(id1, "x").stored === false);
    check("decrypt failure gives null (another keyring)", mk({ throwDecrypt: true }).get(id2) === null);

    // robustness
    writeFileSync(file, "{ not json");
    check("a corrupt file reads as empty and is replaced on the next set", mk().has(id2) === false && mk().set(id1, "again").stored === true && mk().get(id1) === "again");
    writeFileSync(file, JSON.stringify({ "../evil": "x", [id1]: 42, [id2]: Buffer.from("enc:ok").toString("base64") }));
    const sanitized = mk();
    check("foreign keys and non-string values are ignored", !sanitized.has("../evil") && !sanitized.has(id1) && sanitized.get(id2) === "ok");
    check("no leftover temp file", !existsSync(`${file}.tmp`));
} finally {
    rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log("\nall passed");
