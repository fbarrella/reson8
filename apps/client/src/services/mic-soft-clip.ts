/**
 * Mic soft clipper (PRD 17.4) — a PURE module (no DOM/Web Audio objects), so
 * its math is exercised in plain Node by `scripts/soft-clip-smoke.mjs`.
 *
 * Above 100% mic volume a voice easily exceeds digital full scale, and the
 * Opus encoder would receive hard-clipped samples (harsh distortion). A
 * WaveShaperNode after the volume stage bends peaks smoothly instead.
 *
 * The catch: a WaveShaperNode clamps its INPUT to [-1, 1] before applying the
 * curve, so a ×3 signal would already be hard-clipped before the curve sees
 * it. So the gain is folded into the curve: the volume GainNode applies
 * `volume / MIC_VOLUME_MAX_GAIN` (keeping the shaper's input inside [-1, 1]),
 * and the curve maps x → softClip(MIC_VOLUME_MAX_GAIN · x). At or below 100%
 * the shaper is bypassed (curve = null, a pass-through by spec) and the gain
 * is the plain volume, so the signal is exactly what it was before.
 */

/** Highest mic volume (300%), as a linear gain. */
export const MIC_VOLUME_MAX_GAIN = 3;

/** Below this level (of full scale) the clipper is exactly linear. */
export const SOFT_CLIP_KNEE = 0.8;

/**
 * What the curve approaches instead of 1.0 (≈ -0.09 dBFS). The WaveShaper's
 * 2x oversampling filter overshoots a sharply bent waveform slightly — measured
 * at +0.02% above a 1.0 ceiling in Chromium — so the ceiling leaves that
 * headroom, as a limiter normally does.
 */
export const SOFT_CLIP_CEILING = 0.99;

/** Odd sample count, so x = 0 is a curve point (no DC offset from interpolation). */
export const SOFT_CLIP_CURVE_POINTS = 4097;

/**
 * Identity up to the knee, then a tanh-shaped approach to ±SOFT_CLIP_CEILING.
 * Continuous with slope 1 at the knee (tanh'(0) = 1), so there's no audible
 * corner, and it never exceeds the ceiling.
 */
export function softClip(y: number): number {
    const magnitude = Math.abs(y);
    if (magnitude <= SOFT_CLIP_KNEE) return y;
    const headroom = SOFT_CLIP_CEILING - SOFT_CLIP_KNEE;
    return Math.sign(y) * (SOFT_CLIP_KNEE + headroom * Math.tanh((magnitude - SOFT_CLIP_KNEE) / headroom));
}

/** The WaveShaper curve: x ∈ [-1, 1] stands for a signal of x · MIC_VOLUME_MAX_GAIN. */
export function buildSoftClipCurve(points = SOFT_CLIP_CURVE_POINTS): Float32Array<ArrayBuffer> {
    const curve = new Float32Array(points);
    for (let i = 0; i < points; i++) {
        const x = (i / (points - 1)) * 2 - 1;
        curve[i] = softClip(x * MIC_VOLUME_MAX_GAIN);
    }
    return curve;
}

/**
 * How to configure the two nodes for a volume (linear, 0–3): the volume
 * GainNode's gain, and whether the shaper is engaged.
 */
export function micVolumeStages(volume: number): { gain: number; clip: boolean } {
    const v = Math.max(0, Math.min(MIC_VOLUME_MAX_GAIN, Number.isFinite(volume) ? volume : 1));
    return v > 1 ? { gain: v / MIC_VOLUME_MAX_GAIN, clip: true } : { gain: v, clip: false };
}
