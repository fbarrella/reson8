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
