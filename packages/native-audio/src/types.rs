use napi_derive::napi;

/// Mirrors `CaptureStatus` in `index.d.ts`. Returned as a plain string
/// (rather than a `#[napi(string_enum)]`) to keep the FFI surface obviously
/// correct while this crate is built and iterated without a local Rust
/// toolchain available (see PRD 12.1) — the union type is enforced on the
/// TypeScript side.
pub const STATUS_CAPTURING: &str = "capturing";
pub const STATUS_UNSUPPORTED: &str = "unsupported";
pub const STATUS_PERMISSION_DENIED: &str = "permission-denied";
pub const STATUS_ERROR: &str = "error";

/// Mirrors `AudioSourceTarget` in `index.d.ts`.
#[napi(object)]
#[derive(Clone, Debug, Default)]
pub struct AudioSourceTarget {
    /// OS process id whose audio output should be captured (Windows/Linux).
    pub pid: Option<u32>,
    /// Best-effort process/app name, used for Linux stream-matching by name
    /// when a PID-level match isn't available (see PRD 12.3).
    pub process_name: Option<String>,
}

/// One batch of captured PCM handed back across the threadsafe-function
/// boundary to the JS `onFrame` callback.
pub struct PcmFrame {
    pub pcm: Vec<u8>,
    pub sample_rate: u32,
    pub channels: u8,
}
