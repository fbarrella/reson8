#!/usr/bin/env node
/**
 * scripts/release-all.mjs — PRD 12.5: one command builds everything
 * buildable from the current host and packages the client for every
 * platform reachable from that host. See
 * app-planning/Reson8_Phase12_PRD.md (PRD 12.5) for the full design.
 *
 * Explicit limitation (by design, not a bug to fix later): this cannot
 * make a Linux-only machine produce macOS artifacts — Apple's toolchain
 * and codesigning can't be cross-compiled from Linux. To cut a full
 * 3-platform release, run this once per host OS you have access to; the
 * summary table at the end reports exactly what this run did and didn't
 * produce, with a reason for every gap.
 *
 * Usage:
 *   npm run release:all            # build + package everything reachable
 *   npm run release:all -- --dry-run   # print the plan without running it
 *
 * NOT RUN END-TO-END while writing this — no Rust toolchain, no
 * mingw-w64, and no verified electron-builder/Wine setup were available in
 * this environment. The orchestration logic below (host detection, plan
 * construction, summary reporting) was sanity-checked with `node --check`
 * and an actual `--dry-run` pass; the individual `cargo`/`napi
 * build`/`electron-builder` invocations match each tool's documented CLI
 * but haven't been run for real.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const NATIVE_AUDIO_DIR = join(REPO_ROOT, "packages", "native-audio");
const CLIENT_DIR = join(REPO_ROOT, "apps", "client");

const DRY_RUN = process.argv.includes("--dry-run");

/** @type {Array<{ label: string, status: "ok" | "failed" | "skipped", detail: string }>} */
const results = [];

function log(message) {
  console.log(`[release-all] ${message}`);
}

function commandExists(cmd) {
  const probe = spawnSync(cmd, ["--version"]);
  return !probe.error;
}

function rustupTargetInstalled(triple) {
  const probe = spawnSync("rustup", ["target", "list", "--installed"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) return false;
  return probe.stdout.split("\n").some((line) => line.trim() === triple);
}

function skip(label, reason) {
  log(`${label}: SKIPPED — ${reason}`);
  results.push({ label, status: "skipped", detail: reason });
}

function runStep(label, cmd, args, opts = {}) {
  log(`${label}: ${cmd} ${args.join(" ")}`);
  if (DRY_RUN) {
    results.push({ label, status: "ok", detail: "dry-run (not executed)" });
    return true;
  }
  const res = spawnSync(cmd, args, { stdio: "inherit", cwd: opts.cwd ?? REPO_ROOT });
  if (res.error || res.status !== 0) {
    const detail = res.error ? res.error.message : `exit code ${res.status}`;
    log(`${label}: FAILED — ${detail}`);
    results.push({ label, status: "failed", detail });
    return false;
  }
  results.push({ label, status: "ok", detail: "" });
  return true;
}

// ── Plan: which native-audio targets are reachable from this host ───────

const nativeAudioTargets = [];
const hasCargo = commandExists("cargo");

if (!hasCargo) {
  skip("native-audio (all targets)", "no Rust toolchain (`cargo`) found on PATH — install one to build native-audio at all");
} else if (process.platform === "linux") {
  nativeAudioTargets.push({ triple: "x86_64-unknown-linux-gnu", label: "native-audio: linux-x64-gnu (native)" });
  if (commandExists("x86_64-w64-mingw32-gcc")) {
    nativeAudioTargets.push({
      triple: "x86_64-pc-windows-gnu",
      label: "native-audio: win32-x64-gnu (cross-compiled via mingw-w64)",
    });
  } else {
    skip(
      "native-audio: win32-x64-gnu (cross-compiled via mingw-w64)",
      "mingw-w64 not found on PATH — install it (e.g. `apt install mingw-w64`, `pacman -S mingw-w64-gcc`, `dnf install mingw64-gcc`) to cross-compile the Windows native-audio binary from Linux",
    );
  }
} else if (process.platform === "darwin") {
  const hostTriple = process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  const otherTriple = process.arch === "arm64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin";
  nativeAudioTargets.push({ triple: hostTriple, label: `native-audio: ${hostTriple} (native)` });
  if (rustupTargetInstalled(otherTriple)) {
    nativeAudioTargets.push({ triple: otherTriple, label: `native-audio: ${otherTriple} (cross, same-OS)` });
  } else {
    skip(
      `native-audio: ${otherTriple}`,
      `rustup target "${otherTriple}" not installed — run \`rustup target add ${otherTriple}\` to also build for the other Mac architecture in one pass`,
    );
  }
} else if (process.platform === "win32") {
  nativeAudioTargets.push({ triple: "x86_64-pc-windows-msvc", label: "native-audio: win32-x64-msvc (native)" });
} else {
  skip("native-audio (all targets)", `unrecognized host platform "${process.platform}"`);
}

for (const { triple, label } of nativeAudioTargets) {
  runStep(label, "npx", ["napi", "build", "--platform", "--release", "--target", triple, "--output-dir", "prebuilds"], {
    cwd: NATIVE_AUDIO_DIR,
  });
}

// ── Client build (tsc + copy static assets) ──────────────────────────────

runStep("apps/client: tsc --build", "npx", ["tsc", "--build"], { cwd: CLIENT_DIR });
runStep("apps/client: copy-html.mjs", "node", ["scripts/copy-html.mjs"], { cwd: CLIENT_DIR });

// ── Plan: which electron-builder targets are reachable from this host ───

const electronBuilderTargets = [];

if (process.platform === "linux") {
  electronBuilderTargets.push({ flag: "--linux", label: "electron-builder: linux (native)" });
  electronBuilderTargets.push({ flag: "--win", label: "electron-builder: win (cross via bundled Wine)" });
  skip(
    "electron-builder: mac",
    "macOS artifacts require running this script on macOS hardware — Apple's toolchain/codesigning cannot be cross-compiled from Linux",
  );
} else if (process.platform === "darwin") {
  electronBuilderTargets.push({ flag: "--mac", label: "electron-builder: mac (native)" });
  electronBuilderTargets.push({ flag: "--linux", label: "electron-builder: linux (cross)" });
  electronBuilderTargets.push({ flag: "--win", label: "electron-builder: win (cross via bundled Wine)" });
} else if (process.platform === "win32") {
  electronBuilderTargets.push({ flag: "--win", label: "electron-builder: win (native)" });
  skip("electron-builder: mac", "macOS artifacts require running this script on macOS hardware");
  skip(
    "electron-builder: linux",
    "not attempted from a Windows host — electron-builder's Linux cross-build story from Windows is far less reliable than from Linux/macOS; run this script from one of those for a Linux artifact",
  );
} else {
  skip("electron-builder (all targets)", `unrecognized host platform "${process.platform}"`);
}

for (const { flag, label } of electronBuilderTargets) {
  runStep(label, "npx", ["electron-builder", flag], { cwd: CLIENT_DIR });
}

// ── Summary ────────────────────────────────────────────────────────────

const STATUS_LABEL = { ok: "OK", failed: "FAILED", skipped: "SKIPPED" };
const widest = Math.max(...results.map((r) => r.label.length), "Step".length);

console.log("\n" + "=".repeat(widest + 22));
console.log(`${"Step".padEnd(widest)}  ${"Status".padEnd(8)}  Detail`);
console.log("-".repeat(widest + 22));
for (const r of results) {
  console.log(`${r.label.padEnd(widest)}  ${STATUS_LABEL[r.status].padEnd(8)}  ${r.detail}`);
}
console.log("=".repeat(widest + 22) + "\n");

const anyFailed = results.some((r) => r.status === "failed");
if (anyFailed) {
  log("one or more attempted steps failed — see FAILED rows above.");
  process.exitCode = 1;
} else {
  log("done. See SKIPPED rows above for anything this host couldn't produce.");
}
