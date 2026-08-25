# prebuilds/

Compiled `.node` binaries for each supported target go here, named per the
`napi.name` convention in `../package.json` (note: the config key is
`napi.name`, not `napi.binaryName` — an earlier draft of this file used the
wrong key, which silently made every build fall back to `index.*.node`).

- `native-audio.win32-x64-msvc.node` — cross-compiled from Linux via
  `cargo-xwin` (`cargo install cargo-xwin`), confirmed working end-to-end
  2026-08-23: downloads the MSVC CRT/Windows SDK automatically, no Windows
  license or machine needed. This is what PRD 12.5's release script
  actually produces, and also what a native Windows build with Visual
  Studio Build Tools produces.
- `native-audio.win32-x64-gnu.node` — only reachable by cross-compiling via
  mingw-w64, which needs a real `libnode.dll` that's genuinely hard to
  obtain (see `../src/windows.rs`'s module doc comment) — never got this
  path working. Kept as a fallback name in `index.js` in case someone
  solves it later, not the expected path.
- `native-audio.linux-x64-gnu.node` — native `cargo build` on Linux,
  confirmed working end-to-end 2026-08-23 (compiled, linked, loaded, and
  had its PipeWire registry-lookup code actually exercised at runtime).
- `native-audio.darwin-x64.node`, `native-audio.darwin-arm64.node` — not
  yet attempted; no macOS machine available.

`index.js` tries `win32-x64-msvc` before `win32-x64-gnu` on Windows — either
one present is enough, both may coexist.

These are **committed to the repo**, not gitignored (see PRD 12.1 in
`app-planning/Reson8_Phase12_PRD.md` for why: no CI, one maintainer, and
`npm install` shouldn't require a Rust toolchain). They're produced by
running `npm run build -- --target <triple>` in this package, or for a full
release, by PRD 12.5's `npm run release:all` at the repo root.
