export type CaptureStatus = "capturing" | "unsupported" | "permission-denied" | "error";

export interface AudioSourceTarget {
  /** OS process id whose audio output should be captured (Windows/Linux). */
  pid?: number;
  /** Best-effort process/app name, used for Linux stream-matching by name
   *  when a PID-level match isn't available (see PRD 12.3). */
  processName?: string;
}

export interface CaptureHandle {
  readonly status: CaptureStatus;
  /** Idempotent; safe to call even if status !== "capturing". */
  stop(): void;
}

/**
 * Starts capture; onFrame is called with 16-bit PCM interleaved stereo
 * buffers at 48kHz (opus-compatible) as they become available.
 *
 * Always returns a handle, even when unsupported — check
 * `handle.status` rather than expecting a rejected promise; capture
 * unavailability is an expected, common outcome (see PRD 12.2/12.3/12.4),
 * not an exceptional one.
 */
export function startCapture(
  target: AudioSourceTarget,
  onFrame: (pcm: Buffer, sampleRate: number, channels: number) => void,
): CaptureHandle;

export function platformSupportsCapture(): boolean;

/**
 * Windows only (PRD 12.2) — resolves an OS process id from an Electron
 * `desktopCapturer` window source id, formatted `"window:<HWND>:<id>"` on
 * Windows. Returns `undefined` for non-window sources, unparsable ids, or
 * on any other platform (this export doesn't exist in the compiled addon
 * outside Windows — calling code must check `process.platform` first, not
 * rely on this returning `undefined` there).
 */
export function resolvePidForWindowSourceId(sourceId: string): number | undefined;

/**
 * Linux only — lists the `application.name` of every app currently
 * producing audio (PipeWire/PulseAudio), excluding any stream whose
 * `application.process.id` is in `excludePids`. This export doesn't exist
 * in the compiled addon outside Linux; calling code must check
 * `process.platform` first, not rely on this returning `undefined`/`[]`
 * there. Exists because matching a shared *window* to its owning app by
 * name/PID (what `startCapture` tries first via `AudioSourceTarget`) isn't
 * reliable on Linux/Wayland: the portal never exposes a real per-window
 * name or PID to the requesting app, so there's nothing to match against
 * in the first place — the caller offers this list as an explicit choice
 * instead. Pass every PID from Electron's own `app.getAppMetrics()` as
 * `excludePids` so the caller's own app doesn't show up as an option to
 * "share" its own audio back at itself.
 */
export function listAudioProducingApps(excludePids: number[]): string[];
