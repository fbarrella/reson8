//! `@reson8/native-audio` — NAPI-RS bindings for per-application loopback
//! audio capture. See `app-planning/Reson8_Phase12_PRD.md` (PRD 12.1) for
//! the design; per-OS capture logic lives in `windows.rs` / `linux.rs` /
//! `macos.rs` and is filled in by PRD 12.2 / 12.3 / 12.4 respectively.
//!
//! Not yet compiled locally — this repo has no Rust toolchain installed at
//! the time this scaffold was written. Treat this file as a best-effort,
//! idiomatic napi-rs skeleton to be corrected against real `cargo build`
//! output once a toolchain is available, not as verified-working code.

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction};
use napi_derive::napi;

mod types;

// Each backend is only *parsed* on its own OS, not just conditionally
// used — `windows.rs` calls into the `windows` crate, which isn't even a
// dependency on non-Windows targets (see Cargo.toml's target-gated
// `[target.'cfg(target_os = "windows")'.dependencies]`), so `mod windows;`
// itself must be behind `cfg(target_os = "windows")` or a Linux/macOS build
// fails to resolve those crate paths at all.
#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;

pub use types::AudioSourceTarget;
use types::PcmFrame;

/// Threadsafe handle to the JS `onFrame` callback, called from whatever
/// OS-level capture thread each platform backend spins up.
pub(crate) type FrameCallback = ThreadsafeFunction<PcmFrame, ErrorStrategy::Fatal>;

#[cfg(target_os = "windows")]
use windows as platform;
#[cfg(target_os = "linux")]
use linux as platform;
#[cfg(target_os = "macos")]
use macos as platform;

#[napi]
pub fn platform_supports_capture() -> bool {
    platform::supports_capture()
}

#[napi]
pub struct CaptureHandle {
    status: String,
    stop_fn: Option<Box<dyn FnOnce() + Send>>,
}

#[napi]
impl CaptureHandle {
    #[napi(getter)]
    pub fn status(&self) -> String {
        self.status.clone()
    }

    #[napi]
    pub fn stop(&mut self) {
        if let Some(stop_fn) = self.stop_fn.take() {
            stop_fn();
        }
    }
}

#[napi(
    ts_args_type = "target: AudioSourceTarget, onFrame: (pcm: Buffer, sampleRate: number, channels: number) => void",
    ts_return_type = "CaptureHandle"
)]
pub fn start_capture(target: AudioSourceTarget, on_frame: JsFunction) -> Result<CaptureHandle> {
    let tsfn: FrameCallback = on_frame.create_threadsafe_function(0, |ctx| {
        let frame: PcmFrame = ctx.value;
        Ok(vec![
            ctx.env.create_buffer_with_data(frame.pcm)?.into_raw().into_unknown(),
            ctx.env.create_uint32(frame.sample_rate)?.into_unknown(),
            ctx.env.create_uint32(frame.channels as u32)?.into_unknown(),
        ])
    })?;
    // `tsfn` is handed to the platform backend, which calls
    // `tsfn.call(frame, ThreadsafeFunctionCallMode::NonBlocking)` once per
    // captured frame from its own capture thread — not exercised here.
    // Every current backend is a PRD-12.1 stub that never calls it at all,
    // which is correct: no frames should ever be delivered on an
    // unsupported platform/target.
    let (status, stop_fn) = platform::start_capture(target, tsfn)?;
    Ok(CaptureHandle { status, stop_fn: Some(stop_fn) })
}
