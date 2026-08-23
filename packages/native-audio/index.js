// Platform-detecting loader for the compiled native-audio addon.
//
// This is hand-authored for PRD 12.1's scaffold. Once a Rust toolchain and
// `@napi-rs/cli` are available, running `npm run build` in this package
// (see package.json) generates the canonical version of this file via
// `napi build --platform` — replace this by-hand version with that output
// the first time it's actually run, rather than hand-maintaining it further.

"use strict";

const { join } = require("node:path");

const { platform, arch } = process;

function requirePrebuild(fileName) {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(join(__dirname, "prebuilds", fileName));
}

function requireFirstAvailable(fileNames) {
  let lastError = null;
  for (const fileName of fileNames) {
    try {
      return requirePrebuild(fileName);
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  return null;
}

let nativeBinding = null;
let loadError = null;

switch (platform) {
  case "win32":
    if (arch === "x64") {
      try {
        // Two possible ABIs, tried in the order PRD 12.5's release
        // pipeline actually produces them: `msvc` is what cross-compiling
        // from the Linux dev machine via `cargo-xwin` produces (confirmed
        // working 2026-08-23 — it downloads the MSVC CRT/SDK automatically,
        // no Windows license/machine needed) and is also what a native
        // Windows build with Visual Studio Build Tools produces; `gnu`
        // would need a real `libnode.dll` to cross-compile from Linux
        // (see src/windows.rs's module doc comment), which was never
        // resolved, so it's the unlikely fallback here, not the primary.
        nativeBinding = requireFirstAvailable([
          "native-audio.win32-x64-msvc.node",
          "native-audio.win32-x64-gnu.node",
        ]);
      } catch (err) {
        loadError = err;
      }
    }
    break;
  case "darwin":
    if (arch === "x64") {
      try {
        nativeBinding = requirePrebuild("native-audio.darwin-x64.node");
      } catch (err) {
        loadError = err;
      }
    } else if (arch === "arm64") {
      try {
        nativeBinding = requirePrebuild("native-audio.darwin-arm64.node");
      } catch (err) {
        loadError = err;
      }
    }
    break;
  case "linux":
    if (arch === "x64") {
      try {
        nativeBinding = requirePrebuild("native-audio.linux-x64-gnu.node");
      } catch (err) {
        loadError = err;
      }
    }
    break;
  default:
    break;
}

if (!nativeBinding) {
  throw (
    loadError ||
    new Error(
      `@reson8/native-audio has no prebuilt binary for ${platform}-${arch}. ` +
        "Run this package's `npm run build` (requires a Rust toolchain) or " +
        "PRD 12.5's release script to produce one.",
    )
  );
}

module.exports.platformSupportsCapture = nativeBinding.platformSupportsCapture;
module.exports.startCapture = nativeBinding.startCapture;
// Windows-only export (PRD 12.2) — undefined on other platforms, since the
// Rust module doesn't compile this binding outside `cfg(target_os = "windows")`.
module.exports.resolvePidForWindowSourceId = nativeBinding.resolvePidForWindowSourceId;
