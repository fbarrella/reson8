//! Windows capture backend — WASAPI per-process loopback (PRD 12.2).
//!
//! Implements Microsoft's "process loopback" capture, introduced in
//! Windows 10 2004 (build 19041): `ActivateAudioInterfaceAsync` with
//! `AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`, scoped to a single PID
//! (+ its process tree) rather than system-wide loopback. Modeled on
//! Microsoft's `ApplicationLoopback` C++ sample
//! (Windows-classic-samples/Samples/ApplicationLoopback) and the
//! accompanying WASAPI capture-loop pattern from `CaptureSharedTimerDriven`.
//!
//! **Compiles and links for real** — full success, confirmed 2026-08-23.
//! The path there took two real toolchain discoveries worth recording:
//!
//! 1. GNU-target Windows cross-compilation (`x86_64-pc-windows-gnu`) hits a
//!    wall regardless of build tool — `napi-build`'s linking step for that
//!    target needs a real `libnode.dll` (the shared-library form of Node's
//!    runtime, needed at *link* time to resolve N-API symbols on Windows),
//!    and the standard nodejs.org Windows distribution doesn't ship one
//!    (only a statically-linked `node.exe`) — it's specific to shared-lib
//!    Node builds like what Electron uses internally. Never resolved this
//!    path; abandoned it in favor of MSVC instead.
//! 2. **MSVC-target cross-compilation (`x86_64-pc-windows-msvc`) has no
//!    such requirement** — `napi-build` does nothing special for MSVC at
//!    all (only the GNU branch triggers the libnode search), because
//!    MSVC-built addons delay-load `node.exe`'s exports at runtime instead
//!    of needing a link-time stub. Installing `cargo-xwin`
//!    (`cargo install cargo-xwin`, then `rustup target add
//!    x86_64-pc-windows-msvc`) and running `napi build --platform --release
//!    --target x86_64-pc-windows-msvc prebuilds` from `packages/native-audio`
//!    downloads the MSVC CRT/Windows SDK automatically (no Windows license
//!    or machine needed) and produces a real, valid PE32+ DLL. This
//!    supersedes the GNU/mingw-w64 plan from an earlier PRD 12.5 draft —
//!    see `scripts/release-all.mjs`.
//!
//! Getting from "resolves at all" to "actually compiles" took four more
//! real, now-fixed mistakes, all confirmed against the real windows-0.58.0 /
//! windows-core-0.58.0 source (not guessed twice):
//!   1. `PROPVARIANT` isn't `windows::Win32::System::Com::StructuredStorage::
//!      PROPVARIANT` (that path doesn't exist in 0.58) — it's
//!      `windows_core::PROPVARIANT`, a safe wrapper with no VT_BLOB
//!      constructor; built via the raw `windows_core::imp::PROPVARIANT`
//!      union and `PROPVARIANT::from_raw`.
//!   2. The `windows` crate's `implement` feature must be enabled, and
//!      `windows-core` must be a *direct* Cargo.toml dependency (not just
//!      reachable via `windows::core`) — the `#[implement]` macro expands
//!      to absolute `windows_core::...` paths.
//!   3. `#[implement(IFoo)]` on a struct `Bar` generates an "outer"
//!      `Bar_Impl` wrapper type — confusingly distinct from the
//!      `IFoo_Impl` per-interface trait — and it's `Bar_Impl`, not `Bar`,
//!      that the trait must be implemented for.
//!   4. `WAVE_FORMAT_IEEE_FLOAT` lives in `Media::Multimedia`, not
//!      `Media::Audio`; `.cast()`/`::IID` need `windows_core::Interface`
//!      explicitly in scope (trait methods, not inherent ones).
//!
//! What's still **not** verified: actual runtime behavior. No Windows
//! machine was available to run the compiled DLL against a real target
//! process — everything here is now real, compiler-checked Rust, but the
//! *logic* (does WASAPI actually hand back the audio you'd expect for a
//! given PID?) has never been exercised, unlike `linux.rs`'s registry
//! lookup, which was.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use windows::core::Result as WinResult;
use windows::core::HRESULT;
use windows::Win32::Foundation::HWND;
use windows::Win32::Media::Audio::{
    ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
    IAudioCaptureClient, IAudioClient, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
    AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
    VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, WAVEFORMATEX,
};
// `WAVE_FORMAT_IEEE_FLOAT` lives under `Media::Multimedia`, not
// `Media::Audio` — confirmed against the real windows-0.58.0 crate source
// (a real `cargo-xwin` MSVC cross-compile, 2026-08-23) after the first
// attempt guessed `Media::Audio` and failed to compile.
use windows::Win32::Media::Multimedia::WAVE_FORMAT_IEEE_FLOAT;
// `PROPVARIANT` is `windows_core::PROPVARIANT` (a safe `#[repr(transparent)]`
// wrapper around the raw `windows_core::imp::PROPVARIANT` union), not
// `windows::Win32::System::Com::StructuredStorage::PROPVARIANT` — that path
// doesn't exist in 0.58; the compiler's own "did you mean CAPROPVARIANT"
// suggestion was a red herring. `windows_core` also needs to be a direct
// Cargo.toml dependency (not just reachable via `windows::core`) for the
// `#[windows::core::implement(...)]` macro below to resolve its generated
// `windows_core::...` paths.
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::System::Variant::VT_BLOB;
use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
use windows_core::PROPVARIANT;
// Needed for `.cast::<IAudioClient>()` and `IAudioClient::IID` below —
// both are trait methods/consts on `Interface`, not inherent ones.
use windows_core::Interface;

use crate::types::{AudioSourceTarget, PcmFrame, STATUS_CAPTURING, STATUS_ERROR, STATUS_UNSUPPORTED};
use crate::FrameCallback;

/// Process Loopback capture requires Windows 10 2004 (build 19041)+.
const MIN_SUPPORTED_BUILD: u32 = 19_041;

const CAPTURE_SAMPLE_RATE: u32 = 48_000;
const CAPTURE_CHANNELS: u16 = 2;
const CAPTURE_BITS_PER_SAMPLE: u16 = 32; // process-loopback delivers f32

pub fn supports_capture() -> bool {
    windows_build_number() >= MIN_SUPPORTED_BUILD
}

pub fn start_capture(
    target: AudioSourceTarget,
    on_frame: FrameCallback,
) -> napi::Result<(String, Box<dyn FnOnce() + Send>)> {
    if !supports_capture() {
        // Older Windows: no fallback to full-system loopback — see PRD
        // 12.2's business rules. A caller must not silently get more audio
        // than the "this app window only" contract promises.
        return Ok((STATUS_UNSUPPORTED.to_string(), Box::new(|| {})));
    }

    let Some(pid) = target.pid else {
        return Ok((STATUS_UNSUPPORTED.to_string(), Box::new(|| {})));
    };

    let stop_flag = Arc::new(AtomicBool::new(false));
    let thread_stop_flag = Arc::clone(&stop_flag);
    let (ready_tx, ready_rx) = mpsc::channel::<String>();
    let thread_ready_tx = ready_tx.clone();

    let join_handle = thread::Builder::new()
        .name("native-audio-win-capture".into())
        .spawn(move || {
            if let Err(err) = run_capture_loop(pid, &thread_stop_flag, &on_frame, &thread_ready_tx) {
                // If the loop failed before ever reporting "capturing", this
                // is what unblocks the caller below; if it failed after,
                // this send has no receiver left and is harmlessly dropped.
                let _ = thread_ready_tx.send(format!("{STATUS_ERROR}: {err:?}"));
            }
        })
        .map_err(|e| napi::Error::from_reason(format!("failed to spawn capture thread: {e}")))?;

    // Block briefly so the `CaptureHandle` returned to JS reflects whether
    // activation actually succeeded, rather than optimistically claiming
    // "capturing" before WASAPI has even responded.
    let status = match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(s) if s == STATUS_CAPTURING => STATUS_CAPTURING.to_string(),
        Ok(s) => s,
        Err(_) => STATUS_ERROR.to_string(),
    };

    let stop_fn: Box<dyn FnOnce() + Send> = Box::new(move || {
        stop_flag.store(true, Ordering::SeqCst);
        let _ = join_handle.join();
    });

    Ok((status, stop_fn))
}

/// `GetVersionEx`-family APIs lie about the build number unless the calling
/// process carries an application manifest declaring Windows 10/11
/// compatibility — this app doesn't necessarily have one. `RtlGetVersion`
/// in ntdll.dll is the standard manifest-independent workaround (same
/// approach used by e.g. the `os_info` crate), so it's declared by hand
/// here rather than assuming a particular `windows`-crate feature exposes
/// it.
fn windows_build_number() -> u32 {
    #[repr(C)]
    struct OsVersionInfoW {
        dw_os_version_info_size: u32,
        dw_major_version: u32,
        dw_minor_version: u32,
        dw_build_number: u32,
        dw_platform_id: u32,
        sz_csd_version: [u16; 128],
    }

    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(lp_version_information: *mut OsVersionInfoW) -> i32;
    }

    let mut info: OsVersionInfoW = unsafe { std::mem::zeroed() };
    info.dw_os_version_info_size = std::mem::size_of::<OsVersionInfoW>() as u32;
    let status = unsafe { RtlGetVersion(&mut info) };
    if status == 0 {
        info.dw_build_number
    } else {
        0
    }
}

/// Implements `IActivateAudioInterfaceCompletionHandler`. WASAPI's process-
/// loopback activation is inherently async (`ActivateAudioInterfaceAsync`),
/// even though the capture thread wants to block until it resolves — this
/// hands the result across an `mpsc` channel back to the blocking caller.
#[windows::core::implement(IActivateAudioInterfaceCompletionHandler)]
struct ActivationCompletionHandler {
    sender: std::sync::Mutex<Option<mpsc::Sender<WinResult<IAudioClient>>>>,
}

// The `#[implement]` macro on `ActivationCompletionHandler` above generates
// an "outer" `ActivationCompletionHandler_Impl` wrapper type (vtable +
// refcounting) — confirmed against windows-core-0.58.0's own docs — and
// it's that generated type the per-interface `_Impl` trait must target,
// not the plain struct itself. Confusingly, both windows-rs's own
// `_Impl`-suffix convention and this macro's generated-type naming use the
// same suffix for two different things.
impl IActivateAudioInterfaceCompletionHandler_Impl for ActivationCompletionHandler_Impl {
    fn ActivateCompleted(
        &self,
        operation: Option<&IActivateAudioInterfaceAsyncOperation>,
    ) -> WinResult<()> {
        let result = activation_result_from_operation(operation);
        if let Some(sender) = self.sender.lock().unwrap().take() {
            let _ = sender.send(result);
        }
        Ok(())
    }
}

fn activation_result_from_operation(
    operation: Option<&IActivateAudioInterfaceAsyncOperation>,
) -> WinResult<IAudioClient> {
    let operation = operation.ok_or_else(|| windows::core::Error::from(HRESULT(-1)))?;
    let mut activate_hr = HRESULT(0);
    let mut interface: Option<windows::core::IUnknown> = None;
    unsafe { operation.GetActivateResult(&mut activate_hr, &mut interface)? };
    activate_hr.ok()?;
    interface
        .ok_or_else(|| windows::core::Error::from(HRESULT(-1)))?
        .cast::<IAudioClient>()
}

fn activate_process_loopback_client(pid: u32) -> WinResult<IAudioClient> {
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()? };

    let mut activation_params = AUDIOCLIENT_ACTIVATION_PARAMS::default();
    activation_params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    activation_params.Anonymous.ProcessLoopbackParams = AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
        TargetProcessId: pid,
        ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
    };

    // The Process Loopback activation parameters are passed as a VT_BLOB
    // PROPVARIANT pointing at `activation_params`. `windows_core::PROPVARIANT`
    // is a safe `#[repr(transparent)]` wrapper with no VT_BLOB constructor
    // built in (only common VTs like VT_UNKNOWN get a `From` impl) — build
    // the raw `windows_core::imp::PROPVARIANT` union by hand (field layout
    // confirmed against windows-core-0.58.0's actual source) and wrap it via
    // the crate's own documented escape hatch, `PROPVARIANT::from_raw`.
    let mut raw_prop: windows_core::imp::PROPVARIANT = unsafe { std::mem::zeroed() };
    unsafe {
        let inner = &mut raw_prop.Anonymous.Anonymous;
        inner.vt = VT_BLOB.0; // imp::VARENUM is a plain u16, unlike the public windows::...::VARENUM(u16) newtype VT_BLOB is defined as
        inner.Anonymous.blob = windows_core::imp::BLOB {
            cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
            pBlobData: &mut activation_params as *mut _ as *mut u8,
        };
    }
    let prop = unsafe { PROPVARIANT::from_raw(raw_prop) };

    let (tx, rx) = mpsc::channel();
    let handler: IActivateAudioInterfaceCompletionHandler =
        ActivationCompletionHandler { sender: std::sync::Mutex::new(Some(tx)) }.into();

    // `ActivateAudioInterfaceAsync` takes the PROPVARIANT as a raw pointer
    // (`Option<*const PROPVARIANT>`), not a reference — confirmed against
    // the real function signature in windows-0.58.0's generated bindings.
    let _operation: IActivateAudioInterfaceAsyncOperation = unsafe {
        ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&prop as *const PROPVARIANT),
            &handler,
        )?
    };

    // `activation_params` and `prop` must outlive this synchronous call —
    // they do, since both are still in scope here — but do NOT need to
    // outlive the async completion itself; the OS copies what it needs
    // during `ActivateAudioInterfaceAsync` per Microsoft's documented
    // contract for this API.
    //
    // `prop` must never actually be *dropped*, though — confirmed as the
    // real cause of a live STATUS_HEAP_CORRUPTION (0xC0000374) crash on
    // Windows, the first time this code ever ran on real hardware.
    // `windows_core::PROPVARIANT`'s `Drop` impl unconditionally calls
    // `PropVariantClear`, which — because `vt` here is `VT_BLOB` — frees
    // `blob.pBlobData` via `CoTaskMemFree`. That pointer is
    // `&mut activation_params` above: a plain stack local, never allocated
    // via `CoTaskMemAlloc` as `VT_BLOB`'s ownership contract requires.
    // Freeing it corrupts the process heap, which ntdll's heap manager
    // then flags as corruption later, on some unrelated allocation — not
    // at the moment of the bad free itself, which is why the crash's
    // timing only loosely correlated with when audio capture started.
    // `activation_params`'s real backing memory is already cleaned up by
    // the normal stack unwind when this function returns; `prop` never
    // owned anything that legitimately needs `PropVariantClear`, so
    // `forget` it instead of letting it drop.
    std::mem::forget(prop);

    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| windows::core::Error::from(HRESULT(-1)))?
}

fn run_capture_loop(
    pid: u32,
    stop_flag: &AtomicBool,
    on_frame: &FrameCallback,
    ready_tx: &mpsc::Sender<String>,
) -> WinResult<()> {
    let client = activate_process_loopback_client(pid)?;

    let wave_format = WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_IEEE_FLOAT as u16,
        nChannels: CAPTURE_CHANNELS,
        nSamplesPerSec: CAPTURE_SAMPLE_RATE,
        wBitsPerSample: CAPTURE_BITS_PER_SAMPLE,
        nBlockAlign: CAPTURE_CHANNELS * (CAPTURE_BITS_PER_SAMPLE / 8),
        nAvgBytesPerSec: CAPTURE_SAMPLE_RATE * CAPTURE_CHANNELS as u32 * (CAPTURE_BITS_PER_SAMPLE as u32 / 8),
        cbSize: 0,
    };

    // 200ms buffer, matching Microsoft's ApplicationLoopback sample.
    const REFTIMES_PER_SEC: i64 = 10_000_000;
    let buffer_duration = REFTIMES_PER_SEC / 5;

    unsafe {
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            buffer_duration,
            0,
            &wave_format,
            None,
        )?;
    }

    let capture_client: IAudioCaptureClient = unsafe { client.GetService()? };
    unsafe { client.Start()? };

    let _ = ready_tx.send(STATUS_CAPTURING.to_string());

    while !stop_flag.load(Ordering::SeqCst) {
        let packet_size = unsafe { capture_client.GetNextPacketSize()? };
        if packet_size == 0 {
            thread::sleep(Duration::from_millis(10));
            continue;
        }

        let mut data_ptr: *mut u8 = std::ptr::null_mut();
        let mut frames_available: u32 = 0;
        let mut flags: u32 = 0;
        unsafe {
            capture_client.GetBuffer(&mut data_ptr, &mut frames_available, &mut flags, None, None)?;
        }

        if !data_ptr.is_null() && frames_available > 0 {
            let sample_count = frames_available as usize * CAPTURE_CHANNELS as usize;
            // SAFETY: `data_ptr`/`frames_available` are only valid for the
            // duration of this GetBuffer/ReleaseBuffer pair, which is
            // exactly this block's scope.
            let floats: &[f32] =
                unsafe { std::slice::from_raw_parts(data_ptr as *const f32, sample_count) };
            let pcm = f32_to_i16le_bytes(floats);

            on_frame.call(
                PcmFrame { pcm, sample_rate: CAPTURE_SAMPLE_RATE, channels: CAPTURE_CHANNELS as u8 },
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        }

        unsafe { capture_client.ReleaseBuffer(frames_available)? };
    }

    unsafe { client.Stop()? };
    Ok(())
}

/// WASAPI process-loopback delivers 32-bit float samples; this module's
/// public contract (`index.d.ts`) promises 16-bit PCM, so downconvert here
/// rather than pushing the format decision up to every consumer.
fn f32_to_i16le_bytes(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for &s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        let i16_sample = (clamped * i16::MAX as f32) as i16;
        out.extend_from_slice(&i16_sample.to_le_bytes());
    }
    out
}

/// Resolves an OS process id from an Electron `desktopCapturer` window
/// source id, formatted `"window:<HWND>:<id>"` on Windows (PRD 12.2's PID
/// resolution rule — parse the HWND out of `source.id` rather than
/// title-matching, which is fragile with duplicate window titles). Not
/// meaningful for `"screen:..."` sources, which have no associated window.
///
/// Windows-only: this function does not exist in the compiled addon on
/// Linux/macOS at all (see `mod windows` being `cfg`-gated in `lib.rs`) —
/// callers branch on `process.platform` before ever calling it (PRD 12.7).
#[napi_derive::napi]
pub fn resolve_pid_for_window_source_id(source_id: String) -> Option<u32> {
    let hwnd_part = source_id.strip_prefix("window:")?.split(':').next()?;
    let hwnd_value: isize = hwnd_part.parse().ok()?;
    let hwnd = HWND(hwnd_value as *mut core::ffi::c_void);

    let mut pid: u32 = 0;
    let thread_id = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if thread_id == 0 || pid == 0 {
        None
    } else {
        Some(pid)
    }
}
