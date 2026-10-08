/**
 * Smoke test for src/services/mic-soft-clip.ts (PRD 17.4) — run after
 * `tsc --build`:  node scripts/soft-clip-smoke.mjs
 * Exercises the pure clipper math from the compiled output, including the
 * WaveShaperNode's own lookup (linear interpolation over the curve, input
 * clamped to [-1, 1]) as the Web Audio spec defines it. Exits non-zero on
 * any failure.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const sc = require(resolve(here, "../dist/services/mic-soft-clip.js"));

let failures = 0;
const check = (name, ok, detail = "") => {
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      ${detail}`}`);
};
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ── softClip ──
check("identity below the knee", [0, 0.1, -0.3, 0.5, 0.8, -0.8].every((y) => sc.softClip(y) === y));
check("continuous at the knee", close(sc.softClip(0.8 + 1e-9), 0.8, 1e-6));
check("slope ≈ 1 just above the knee (no corner)", close((sc.softClip(0.8001) - sc.softClip(0.8)) / 0.0001, 1, 1e-3));
let monotonic = true;
let prev = -Infinity;
for (let y = -3; y <= 3; y += 0.001) {
    const v = sc.softClip(y);
    if (v < prev) monotonic = false;
    prev = v;
}
check("monotonic over [-3, 3]", monotonic);
// It approaches ±SOFT_CLIP_CEILING (0.99) and must never exceed it — the
// headroom absorbs the oversampling filter's overshoot.
check("never exceeds the 0.99 ceiling", [1, 1.5, 3, 10, 1e6].every((y) => sc.softClip(y) <= sc.SOFT_CLIP_CEILING && sc.softClip(-y) >= -sc.SOFT_CLIP_CEILING));
check("symmetric", [0.9, 1.2, 2.5].every((y) => sc.softClip(-y) === -sc.softClip(y)));

// ── Curve ──
const curve = sc.buildSoftClipCurve();
const N = curve.length;
check("odd length, centre point is 0", N % 2 === 1 && curve[(N - 1) / 2] === 0, `${N} ${curve[(N - 1) / 2]}`);
check("ends ≈ softClip(±3)", close(curve[N - 1], sc.softClip(3), 1e-6) && close(curve[0], -sc.softClip(3), 1e-6));
check("no curve value exceeds the ceiling (float32)", curve.every((v) => Math.abs(v) <= sc.SOFT_CLIP_CEILING + 1e-7));

// The WaveShaper's lookup, per the Web Audio spec.
const shape = (x) => {
    const v = ((N - 1) / 2) * (Math.max(-1, Math.min(1, x)) + 1);
    const k = Math.floor(v);
    const f = v - k;
    return k >= N - 1 ? curve[N - 1] : (1 - f) * curve[k] + f * curve[k + 1];
};
const stage = (volume, input) => {
    const { gain, clip } = sc.micVolumeStages(volume);
    const g = input * gain;
    return clip ? shape(g) : g;
};

// ── Stages ──
const st = (v) => JSON.stringify(sc.micVolumeStages(v));
check("100% → plain gain, no clipper", st(1) === JSON.stringify({ gain: 1, clip: false }), st(1));
check("50% → plain gain, no clipper", st(0.5) === JSON.stringify({ gain: 0.5, clip: false }), st(0.5));
check("300% → gain 1/1 · curve", st(3) === JSON.stringify({ gain: 1, clip: true }), st(3));
check("200% → gain 2/3 · curve", close(sc.micVolumeStages(2).gain, 2 / 3) && sc.micVolumeStages(2).clip);
check("above max clamped to 300%", st(5) === st(3), st(5));
check("NaN → 100%", st(NaN) === st(1), st(NaN));

// ── End to end (gain stage + WaveShaper lookup) ──
check("≤100%: output is exactly input × volume", [0.2, 0.7, -0.4].every((x) => stage(1, x) === x && stage(0.5, x) === x * 0.5));
for (const v of [1.5, 2, 2.5, 3]) {
    // In the linear region (|x·v| ≤ 0.8) the boost is exact (to float precision).
    const xs = [0.05, 0.1, -0.15, 0.2].filter((x) => Math.abs(x * v) <= 0.8);
    check(`${v * 100}%: linear region multiplies by exactly ${v}`, xs.every((x) => close(stage(v, x), x * v, 1e-5)), xs.map((x) => `${x}→${stage(v, x)}`).join(", "));
}
check("300%: a full-scale peak stays at the ceiling", stage(3, 1) <= sc.SOFT_CLIP_CEILING + 1e-7 && stage(3, 1) > 0.95, stage(3, 1));
check("300%: a 0.5 peak (→1.5) is softly limited into (0.8, 0.99)", stage(3, 0.5) > 0.8 && stage(3, 0.5) < sc.SOFT_CLIP_CEILING, stage(3, 0.5));

console.log(failures === 0 ? "\nAll soft-clip checks passed." : `\n${failures} soft-clip check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
