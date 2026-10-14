/**
 * Smoke test for src/server-health.ts (PRD 20 W1) — run after `tsc --build`:
 *   node scripts/server-health-smoke.mjs
 * Exits non-zero on any failure.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { healthProbeUrl } = require(resolve(here, "../dist", "server-health.js"));

let failures = 0;
const check = (name, actual, expected) => {
    const ok = actual === expected;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      expected ${expected}, got ${actual}`}`);
};

const none = () => false;
check("plain host:port, nothing known -> http", healthProbeUrl("127.0.0.1:9800", none), "http://127.0.0.1:9800/health");
check(
    "host remembered over https -> https on 443",
    healthProbeUrl("chat.example.com", (k) => k === "chat.example.com:443"),
    "https://chat.example.com/health",
);
check("explicit https with a port", healthProbeUrl("https://x.y:8443", none), "https://x.y:8443/health");
check("explicit http, default port dropped", healthProbeUrl("http://x.y", none), "http://x.y/health");
check("IPv6 with a port", healthProbeUrl("[::1]:9800", none), "http://[::1]:9800/health");
check("a bare host with no scheme and nothing known -> http on 80", healthProbeUrl("example.org", none), "http://example.org/health");
check("an address with a space is refused", healthProbeUrl("bad address with space", none), null);
check("an empty address is refused", healthProbeUrl("", none), null);

if (failures > 0) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log("\nAll server-health checks passed");
