//! Windows capture backend.
//!
//! Stub for PRD 12.1 — always reports `unsupported`. The real WASAPI
//! per-process loopback implementation (Process Loopback API via
//! `ActivateAudioInterfaceAsync`, gated on Windows build 19041+) lands in
//! PRD 12.2.

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
