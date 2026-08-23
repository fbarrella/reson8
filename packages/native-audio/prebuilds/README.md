# prebuilds/

Compiled `.node` binaries for each supported target go here, named per the
`napi.binaryName` convention in `../package.json`:

- `native-audio.win32-x64-msvc.node`
- `native-audio.linux-x64-gnu.node`
- `native-audio.darwin-x64.node`
- `native-audio.darwin-arm64.node`

These are **committed to the repo**, not gitignored (see PRD 12.1 in
`app-planning/Reson8_Phase12_PRD.md` for why: no CI, one maintainer, and
`npm install` shouldn't require a Rust toolchain). They're produced by
running `npm run build` in this package (needs `cargo` + `@napi-rs/cli`) or,
for a full release, by PRD 12.5's `npm run release:all` at the repo root.

This directory is currently empty — no Rust toolchain has been available to
build a binary yet. `require('@reson8/native-audio')` will throw until at
least one of these exists for the host platform.
