/**
 * Smoke test for src/tls-trust.ts, src/tls-store.ts and src/tls-probe.ts
 * (PRD 18.3) — run after `tsc --build`:
 *   node scripts/tls-trust-smoke.mjs
 * Exits non-zero on any failure. The probe cases talk to real local servers;
 * the HTTPS ones need `openssl` and are skipped (reported) without it.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { X509Certificate } from "node:crypto";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const dist = (f) => require(resolve(here, "../dist", f));
const trust = dist("tls-trust.js");
const { TlsTrustStore } = dist("tls-store.js");
const { probeServer } = dist("tls-probe.js");

let failures = 0;
const check = (name, ok, detail = "") => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${detail}`}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── parseServerAddress ──────────────────────────────────────────────────────
const parse = (s) => trust.parseServerAddress(s);
const ok = (input, scheme, host, port) => {
    const r = parse(input);
    check(`parse ${JSON.stringify(input)}`, r.ok && r.value.scheme === scheme && r.value.host === host && r.value.port === port, JSON.stringify(r));
};
const bad = (input, re) => {
    const r = parse(input);
    check(`reject ${JSON.stringify(input)}`, !r.ok && re.test(r.error), JSON.stringify(r));
};
ok("chat.example.com", null, "chat.example.com", undefined);
ok("  Chat.Example.com  ", null, "chat.example.com", undefined);
ok("chat.example.com:9800", null, "chat.example.com", 9800);
ok("192.168.0.10:9800", null, "192.168.0.10", 9800);
ok("localhost", null, "localhost", undefined);
ok("http://chat.example.com", "http", "chat.example.com", undefined);
ok("https://chat.example.com/", "https", "chat.example.com", undefined);
ok("https://chat.example.com:8443", "https", "chat.example.com", 8443);
ok("ws://chat.example.com:9800", "http", "chat.example.com", 9800);
ok("wss://chat.example.com", "https", "chat.example.com", undefined);
ok("HTTPS://chat.example.com", "https", "chat.example.com", undefined);
ok("[::1]:9800", null, "::1", 9800);
ok("https://[2001:db8::1]", "https", "2001:db8::1", undefined);
ok("example.com:80", null, "example.com", 80); // an explicit default port is kept
ok("http://example.com:80", "http", "example.com", 80);
ok("https://example.com:443", "https", "example.com", 443);
bad("", /Enter a server address/);
bad("   ", /Enter a server address/);
bad("http://", /Enter a server address/);
bad("ftp://example.com", /Unsupported/);
bad("example.com/chat", /only the server address/);
bad("example.com?x=1", /only the server address/);
bad("example.com#top", /only the server address/);
bad("user:pass@example.com", /username or password/);
bad("exa mple.com", /spaces/);
bad("example.com:0", /between 1 and 65535/);
bad("example.com:70000", /between 1 and 65535/);
bad("example.com:", /port is missing/);

// ── identityHostOf must match what 2.6.0 signed ─────────────────────────────
function oldIdentityHost(raw) {
    let url = raw.trim().replace(/^https?:\/\//, "").replace(/^wss?:\/\//, "").replace(/\/+$/, "");
    const parts = url.split(":");
    const host = parts[0] || "localhost";
    const port = parts[1] ? parseInt(parts[1], 10) : undefined;
    return port ? `${host}:${port}` : host;
}
for (const input of [
    "chat.example.com", "chat.example.com:9800", "192.168.0.10:9800", "localhost", "localhost:9800",
    "http://chat.example.com", "https://chat.example.com:9800/", "http://192.168.1.5:9800", "wss://chat.example.com",
]) {
    const r = parse(input);
    const now = r.ok ? trust.identityHostOf(r.value) : "(parse failed)";
    check(`identity host for ${JSON.stringify(input)} equals 2.6.0's`, now === oldIdentityHost(input).toLowerCase(), `new=${now} old=${oldIdentityHost(input)}`);
}
check("identity host brackets IPv6", trust.identityHostOf({ host: "::1", port: 9800 }) === "[::1]:9800");

// ── hostKey / fingerprints ──────────────────────────────────────────────────
check("hostKey", trust.hostKey("chat.example.com", 443) === "chat.example.com:443");
check("hostKey IPv6", trust.hostKey("::1", 9800) === "[::1]:9800");
const FP = "ab".repeat(32);
check("formatFingerprint", trust.formatFingerprint(FP).startsWith("AB:AB:AB:") && trust.formatFingerprint(FP).length === 95);
check("isFingerprint accepts 64 hex", trust.isFingerprint(FP));
check("isFingerprint rejects others", !trust.isFingerprint("AB:CD") && !trust.isFingerprint(FP.toUpperCase()) && !trust.isFingerprint(5));

// ── decideScheme: the whole table ───────────────────────────────────────────
const cert = { fingerprint256: FP, subject: "CN=x", issuer: "CN=x", validTo: "2030-01-01T00:00:00.000Z", sans: [] };
const OTHER = "cd".repeat(32);
const d = (explicit, probe, pinnedFingerprint = null, httpsRemembered = false) =>
    trust.decideScheme({ explicit, probe, pinnedFingerprint, httpsRemembered });
const row = (name, got, expected) => check(name, same(got, expected), JSON.stringify(got));

row("explicit http → http + warn, no probe needed", d("http", null), { action: "connect", scheme: "http", warn: true });
row("explicit http ignores a trusted probe", d("http", { kind: "trusted", cert }), { action: "connect", scheme: "http", warn: true });
row("no scheme + trusted → https", d(null, { kind: "trusted", cert }), { action: "connect", scheme: "https", pinned: false });
row("explicit https + trusted → https", d("https", { kind: "trusted", cert }), { action: "connect", scheme: "https", pinned: false });
row("untrusted, no pin → ask", d(null, { kind: "untrusted", cert, reason: "SELF_SIGNED" }), { action: "ask-trust", cert });
row("untrusted, matching pin → https pinned", d("https", { kind: "untrusted", cert, reason: "SELF_SIGNED" }, FP), { action: "connect", scheme: "https", pinned: true });
row("untrusted, different pin → mismatch", d(null, { kind: "untrusted", cert, reason: "SELF_SIGNED" }, OTHER), { action: "pin-mismatch", cert, pinnedFingerprint: OTHER });
check("explicit https + no-tls → error", d("https", { kind: "no-tls" }).action === "error" && /doesn't support encrypted/.test(d("https", { kind: "no-tls" }).message));
row("no scheme + no-tls, not remembered → http + warn", d(null, { kind: "no-tls" }), { action: "connect", scheme: "http", warn: true });
check("no scheme + no-tls, remembered → refuse (no downgrade)", d(null, { kind: "no-tls" }, null, true).action === "error" && /refusing/.test(d(null, { kind: "no-tls" }, null, true).message));
check("unreachable → error with the code", d(null, { kind: "unreachable", code: "ECONNREFUSED" }).message.includes("ECONNREFUSED"));
check("null probe without explicit http → error", d(null, null).action === "error");
// A remembered host with a pin whose certificate is now publicly trusted is just https (pin not required).
row("remembered + trusted → https", d(null, { kind: "trusted", cert }, OTHER, true), { action: "connect", scheme: "https", pinned: false });

// ── the store ───────────────────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), "reson8-tls-smoke-"));
const PEM = "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n";
const pin = { fingerprint256: FP, subject: "CN=x", validTo: "2030-01-01T00:00:00.000Z", pinnedAt: "2026-10-10T00:00:00.000Z", certPem: PEM };
const file = join(dir, "tls-trust.json");
let store = new TlsTrustStore(file);
check("store starts empty", store.listPins().length === 0 && !store.isHttpsRemembered("a:443"));
store.setPin("chat.lan:9800", pin);
store.setPin("[::1]:9800", { ...pin, fingerprint256: OTHER });
store.rememberHttps("chat.example.com:443");
store = new TlsTrustStore(file); // a fresh instance reads what was persisted
check("pins persist", store.getPin("chat.lan:9800")?.fingerprint256 === FP);
check("https memory persists", store.isHttpsRemembered("chat.example.com:443") && !store.isHttpsRemembered("other:443"));
check("listPins omits the PEM", store.listPins().every((p) => !("certPem" in p)) && store.listPins().length === 2);
check("pinsForHostname matches any port", store.pinsForHostname("CHAT.LAN").length === 1 && store.pinsForHostname("::1").length === 1);
check("pinsForHostname misses unknown hosts", store.pinsForHostname("evil.lan").length === 0);
check("removePin", store.removePin("chat.lan:9800") === true && store.removePin("chat.lan:9800") === false && store.getPin("chat.lan:9800") === null);
let threw = false;
try { store.setPin("x:1", { ...pin, fingerprint256: "nope" }); } catch { threw = true; }
check("setPin rejects an invalid entry", threw);
writeFileSync(file, "{ this is not json");
const corrupt = new TlsTrustStore(file);
check("a corrupt file starts empty instead of throwing", corrupt.listPins().length === 0);
writeFileSync(file, JSON.stringify({ v: 1, pins: { "a:1": { fingerprint256: "bad" }, "b:2": pin }, httpsHosts: { "c:3": 5, "d:4": "2026-01-01T00:00:00Z" } }));
const partial = new TlsTrustStore(file);
check("invalid entries are dropped, valid ones kept", partial.getPin("a:1") === null && partial.getPin("b:2") !== null && partial.isHttpsRemembered("d:4") && !partial.isHttpsRemembered("c:3"));

// ── the probe, against real servers ─────────────────────────────────────────
const listen = (server) => new Promise((res) => server.listen(0, "127.0.0.1", () => res(server.address().port)));
const plain = http.createServer((_q, r) => r.end("hi"));
const plainPort = await listen(plain);
const silent = net.createServer(() => { /* accept and say nothing */ });
const silentPort = await listen(silent);

let r = await probeServer("127.0.0.1", plainPort, 3000);
check("probe: a plain HTTP server → no-tls", r.result.kind === "no-tls", JSON.stringify(r.result));
r = await probeServer("127.0.0.1", silentPort, 600);
check("probe: a TCP server that never answers → no-tls (after the timeout)", r.result.kind === "no-tls", JSON.stringify(r.result));
const closed = net.createServer();
const closedPort = await listen(closed);
await new Promise((res) => closed.close(res));
r = await probeServer("127.0.0.1", closedPort, 3000);
check("probe: a closed port → unreachable ECONNREFUSED", r.result.kind === "unreachable" && r.result.code === "ECONNREFUSED", JSON.stringify(r.result));

if (spawnSync("openssl", ["version"]).status === 0) {
    execFileSync("openssl", [
        "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-days", "30", "-nodes",
        "-subj", "/CN=reson8-smoke", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
        "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"),
    ], { stdio: "ignore" });
    const secure = https.createServer({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, (_q, s) => s.end("ok"));
    const securePort = await listen(secure);
    r = await probeServer("127.0.0.1", securePort, 3000);
    const expectedFp = new X509Certificate(readFileSync(join(dir, "c.pem"))).fingerprint256.replace(/:/g, "").toLowerCase();
    check("probe: a self-signed HTTPS server → untrusted", r.result.kind === "untrusted", JSON.stringify(r.result));
    check("probe: fingerprint equals the certificate's own SHA-256", r.result.cert?.fingerprint256 === expectedFp, `${r.result.cert?.fingerprint256} vs ${expectedFp}`);
    check("probe: subject, SANs and expiry are described", r.result.cert?.subject.includes("reson8-smoke") && r.result.cert.sans.some((s) => s.includes("127.0.0.1")) && !Number.isNaN(Date.parse(r.result.cert.validTo)), JSON.stringify(r.result.cert));
    check("probe: the PEM is returned for pinning", typeof r.certPem === "string" && r.certPem.startsWith("-----BEGIN CERTIFICATE-----"));
    secure.close();
} else {
    console.log("SKIP  probe against a self-signed HTTPS server (openssl not installed)");
}

plain.close();
silent.close();
rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
