/**
 * Smoke test for src/identity-proof.ts (PRD 17.12) — run after building the
 * client AND the server (`tsc --build` in both):
 *   node scripts/identity-smoke.mjs
 * Signs with the CLIENT's code and verifies with the SERVER's verifier, so the
 * two sides are proven to agree on the message format and key encoding.
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { generateKeyPairSync, createPrivateKey } from "node:crypto";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const client = require(resolve(here, "../dist/identity-proof.js"));
const server = await import(pathToFileURL(resolve(here, "../../server/dist/services/identity.service.js")).href);

let failures = 0;
const check = (name, ok, detail = "") => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${detail}`}`);
};

const { privateKey } = generateKeyPairSync("ed25519");
const spki = client.publicKeyBase64(privateKey);
const nonce = server.newNonce();
const host = "127.0.0.1:9871";

// ── Client signs, server verifies ──
const sig = client.signChallenge(privateKey, nonce, host);
check("client signature verifies with the server's verifier", server.verifyAuthSignature(spki, sig, server.authMessage(nonce, host)));
check("same message format on both sides", client.authMessage(nonce, host) === server.authMessage(nonce, host));
check("same fingerprint on both sides", client.fingerprintOf(spki) === server.keyFingerprint(spki), `${client.fingerprintOf(spki)} vs ${server.keyFingerprint(spki)}`);
check("signature for another host does not verify", !server.verifyAuthSignature(spki, sig, server.authMessage(nonce, "evil.example")));
check("signature for another nonce does not verify", !server.verifyAuthSignature(spki, sig, server.authMessage(server.newNonce(), host)));

// ── The signer refuses anything that isn't a server challenge ──
for (const [label, n, h] of [
    ["arbitrary text as nonce", "please sign this", host],
    ["too-short nonce", "abc", host],
    ["nonce with a newline", nonce.slice(0, 42) + "\n", host],
    ["host with a newline (message injection)", nonce, "a\nreson8-auth-v1"],
    ["host with a space", nonce, "a b"],
    ["empty host", nonce, ""],
    ["non-string nonce", 42, host],
]) {
    check(`refuses: ${label}`, client.signChallenge(privateKey, n, h) === null);
}

// ── PEM round trip (what identity-key.ts writes and reads) ──
const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const reloaded = createPrivateKey(pem);
check("PEM round trip keeps the same public key", client.publicKeyBase64(reloaded) === spki);
check("a reloaded key's signatures still verify", server.verifyAuthSignature(spki, client.signChallenge(reloaded, nonce, host), server.authMessage(nonce, host)));

console.log(failures === 0 ? "\nAll identity checks passed." : `\n${failures} identity check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
