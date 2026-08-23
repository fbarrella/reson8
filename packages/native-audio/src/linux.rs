//! Linux capture backend.
//!
//! Stub for PRD 12.1 — always reports `unsupported`. The real
//! PipeWire → PulseAudio → ALSA detection cascade and per-application
//! (PID/name-matched) loopback capture lands in PRD 12.3.

use crate::types::{AudioSourceTarget, STATUS_UNSUPPORTED};
use crate::FrameCallback;

pub fn supports_capture() -> bool {
    false
}

pub fn start_capture(
    _target: AudioSourceTarget,
    _on_frame: FrameCallback,
) -> napi::Result<(String, Box<dyn FnOnce() + Send>)> {
    Ok((STATUS_UNSUPPORTED.to_string(), Box::new(|| {})))
}
