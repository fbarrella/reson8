//! macOS capture backend.
//!
//! Permanently unsupported by design (PRD 12.4) — macOS has no documented,
//! app-installable path to per-process loopback capture (see the PRD's
//! Known Risks). This module still needs to exist and compile so
//! `require('@reson8/native-audio')` loads cleanly on macOS; it never
//! attempts capture, never prompts for permissions.
//!
//! Unchanged since the PRD 12.1 scaffold — PRD 12.4's requirements
//! (`platformSupportsCapture` always `false`, `startCapture` always
//! `unsupported`, no capture/permission attempt) are exactly what the
//! stub already did. Nothing else needed here; this file also has zero
//! external dependencies, unlike `windows.rs`/`linux.rs`, so it carries
//! none of their FFI/build-toolchain risk.

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
