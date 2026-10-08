/**
 * Smoke test for src/avatar.ts (PRD 17.1) — run after `tsc --build`:
 *   node scripts/avatar-smoke.mjs
 * The client has no unit-test runner, so this exercises the pure avatar
 * module directly from the compiled output. Exits non-zero on any failure.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const avatar = require(resolve(here, "../dist/avatar.js"));

let failures = 0;
const check = (name, ok, detail = "") => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${detail}`}`);
};

// sha256("test@example.com") — the value probed live against both providers.
const HASH = "973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b";

// ── Email hashing ──
check("hash of a known email", avatar.hashEmail("test@example.com") === HASH, avatar.hashEmail("test@example.com"));
check("hash normalizes case and surrounding whitespace", avatar.hashEmail("  Test@Example.COM \n") === HASH);
check("hash is 64 lower-case hex chars", /^[0-9a-f]{64}$/.test(avatar.hashEmail("a@b.co")));

// ── Email shape ──
check("plausible email accepted", avatar.isPlausibleEmail("someone@example.org"));
check("email with spaces around accepted", avatar.isPlausibleEmail("  someone@example.org  "));
for (const bad of ["", "someone", "someone@", "@example.org", "some one@example.org", "a@b"]) {
    check(`implausible email refused: ${JSON.stringify(bad)}`, !avatar.isPlausibleEmail(bad));
}

// ── URL builders (must match the server's templates) ──
check(
    "libravatar URL",
    avatar.buildAvatarUrl({ provider: "libravatar", hash: HASH }) === `https://seccdn.libravatar.org/avatar/${HASH}?d=wavatar`,
);
check(
    "gravatar URL",
    avatar.buildAvatarUrl({ provider: "gravatar", hash: HASH }) === `https://gravatar.com/avatar/${HASH}?d=wavatar`,
);
check(
    "404 fallback for the Settings preview",
    avatar.buildAvatarUrl({ provider: "libravatar", hash: HASH }, "404").endsWith("?d=404"),
);

// ── Default avatar ──
const userId = "3f2a8c1e-1234-4abc-9def-0123456789ab";
const def = avatar.defaultAvatarUrl(userId);
check("default avatar never contains the raw user id", !def.includes(userId), def);
check(
    "default avatar uses sha256(userId)",
    def === `https://seccdn.libravatar.org/gravatarproxy/${avatar.sha256Hex(userId)}?s=80&default=wavatar`,
    def,
);

// ── Size parameter ──
const sized = avatar.withAvatarSize(`https://seccdn.libravatar.org/avatar/${HASH}?d=wavatar`, 80);
check("size appended", new URL(sized).searchParams.get("s") === "80" && new URL(sized).searchParams.get("d") === "wavatar", sized);
check("size replaced, not duplicated", new URL(avatar.withAvatarSize(def, 192)).searchParams.getAll("s").join() === "192");
check("size clamped to 512", new URL(avatar.withAvatarSize(def, 4000)).searchParams.get("s") === "512");
check("non-URL input returned unchanged", avatar.withAvatarSize("not a url", 80) === "not a url");

console.log(failures === 0 ? "\nAll avatar checks passed." : `\n${failures} avatar check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
