//! Linux capture backend — PipeWire → PulseAudio → ALSA cascade (PRD 12.3).
//!
//! **Compiles, links, and loads for real** (verified 2026-08-23 with `cargo
//! build --release` + system libpipewire-0.3 1.6.8 / libpulse 17.0 dev
//! headers, then `require()`d from Node directly). This module went through
//! two real rounds of `cargo check` iteration against actual compiler
//! errors before that — see the pipewire_backend doc comment for what
//! changed and why. Runtime-exercised beyond just loading: calling
//! `startCapture` with a bogus PID drove the real PipeWire registry
//! lookup (mainloop run/sync/done round-trip) to completion and correctly
//! returned `"unsupported"` when no matching node was found, without
//! hanging or crashing — the part of this file that was hardest to get
//! right sight-unseen. What's **not** verified: the actual audio-capture
//! path once a real target node IS found (phase 2 of `pipewire_backend`,
//! and all of `pulse_backend`'s reroute-and-record flow) — that needs a
//! real target application actually producing audio to test against, not
//! attempted here. Treat the registry/session-lifecycle code as
//! meaningfully de-risked; treat the capture-callback and PulseAudio
//! reroute code as still best-effort.
//!
//! **Detection order** (PRD 12.3): PipeWire, then PulseAudio, then ALSA
//! (which can't do per-app capture at all, so it's always "unsupported").
//!
//! **A real behavioral difference from the Windows backend worth flagging
//! prominently, not just in a code comment:** WASAPI process-loopback and
//! PipeWire's `capture.sink` stream flag are both non-invasive taps — nothing
//! about the target app's own audio routing changes. Plain PulseAudio (no
//! PipeWire underneath) has **no per-app monitor** to tap in the same way,
//! so isolating one app's audio there requires temporarily rerouting it
//! through a virtual null-sink for the duration of the share (see
//! `pulse_backend` below) — a brief audio blip is plausible when a share
//! starts/stops on Pulse-only systems, and an unclean process exit could in
//! principle leave that rerouting in place. Worth a real Known-Risks entry,
//! not just a comment buried in this file.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crate::types::{AudioSourceTarget, PcmFrame, STATUS_CAPTURING, STATUS_ERROR, STATUS_UNSUPPORTED};
use crate::FrameCallback;

const CAPTURE_SAMPLE_RATE: u32 = 48_000;
const CAPTURE_CHANNELS: u8 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LinuxAudioServer {
    PipeWire,
    PulseAudio,
    Alsa,
}

fn xdg_runtime_dir() -> Option<String> {
    std::env::var("XDG_RUNTIME_DIR").ok()
}

/// Lightweight presence check (socket existence), not a real connection
/// attempt — cheap and synchronous, good enough to pick a backend. A false
/// positive (socket present but server unresponsive) surfaces later as a
/// connect failure inside that backend's `start_capture`, which is an
/// acceptable trade-off for keeping detection itself fast and side-effect
/// free.
fn pipewire_socket_present() -> bool {
    xdg_runtime_dir()
        .map(|dir| Path::new(&dir).join("pipewire-0").exists())
        .unwrap_or(false)
}

fn pulseaudio_socket_present() -> bool {
    let default_socket = xdg_runtime_dir()
        .map(|dir| Path::new(&dir).join("pulse").join("native").exists())
        .unwrap_or(false);
    // `PULSE_SERVER` can point at a TCP address or a non-default socket
    // path; treat it as "configured" without trying to parse/connect here.
    default_socket || std::env::var("PULSE_SERVER").is_ok()
}

fn detect_audio_server() -> LinuxAudioServer {
    if pipewire_socket_present() {
        LinuxAudioServer::PipeWire
    } else if pulseaudio_socket_present() {
        LinuxAudioServer::PulseAudio
    } else {
        LinuxAudioServer::Alsa
    }
}

pub fn supports_capture() -> bool {
    !matches!(detect_audio_server(), LinuxAudioServer::Alsa)
}

pub fn start_capture(
    target: AudioSourceTarget,
    on_frame: FrameCallback,
) -> napi::Result<(String, Box<dyn FnOnce() + Send>)> {
    match detect_audio_server() {
        LinuxAudioServer::PipeWire => pipewire_backend::start_capture(target, on_frame),
        LinuxAudioServer::PulseAudio => pulse_backend::start_capture(target, on_frame),
        LinuxAudioServer::Alsa => Ok((STATUS_UNSUPPORTED.to_string(), Box::new(|| {}))),
    }
}

fn f32_to_i16le_bytes(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for &s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        let i16_sample = (clamped * i16::MAX as f32) as i16;
        out.extend_from_slice(&i16_sample.to_le_bytes());
    }
    out
}

// ═══════════════════════════════════════════════════════════════════════
// PipeWire backend
// ═══════════════════════════════════════════════════════════════════════

mod pipewire_backend {
    use super::*;
    use pipewire as pw;
    use std::cell::Cell;
    use std::rc::Rc;

    /// Verified against the `pipewire` crate's own `examples/roundtrip.rs`
    /// (registry + sync/done pattern) and `examples/audio-capture.rs`
    /// (stream setup + POD format negotiation) for pipewire = "0.10.1" —
    /// the exact version this resolved to when first built with a real
    /// Rust toolchain (2026-08-23), against system PipeWire 1.6.8. The
    /// `TARGET_OBJECT`/`STREAM_CAPTURE_SINK` keys require this crate's
    /// `v0_3_44` feature (or higher) to be enabled in `Cargo.toml` — they
    /// don't exist at all without it, which was the first compile error
    /// this hit. Re-check both examples if `pipewire` gets bumped again;
    /// this crate's API has changed release to release (e.g. `MainLoop` →
    /// `MainLoopRc`/`MainLoopBox`, `Context` → `ContextRc`).
    pub fn start_capture(
        target: AudioSourceTarget,
        on_frame: FrameCallback,
    ) -> napi::Result<(String, Box<dyn FnOnce() + Send>)> {
        let stop_flag = Arc::new(AtomicBool::new(false));
        let thread_stop_flag = Arc::clone(&stop_flag);
        let (ready_tx, ready_rx) = mpsc::channel::<String>();

        // PipeWire's mainloop/stream/registry types are not `Send`, so the
        // whole session — registry lookup for the target's node, then the
        // long-running capture stream — happens on one dedicated thread,
        // sequentially, rather than being constructed here and handed off.
        // `run_session` (below) is responsible for turning `stop_flag` into
        // an actual `mainloop.quit()` call from inside the mainloop's own
        // thread — a plain `AtomicBool` can't interrupt `MainLoop::run()`
        // by itself, since that blocks until something *inside* the loop
        // tells it to stop. It does so via a `pipewire::channel`, wired up
        // entirely inside `run_session` since only code running on the
        // mainloop thread can attach a receiver to that loop.
        let join_handle = thread::Builder::new()
            .name("native-audio-pw-capture".into())
            .spawn(move || {
                if let Err(err) = run_session(target, thread_stop_flag, &on_frame, &ready_tx) {
                    let _ = ready_tx.send(format!("{STATUS_ERROR}: {err}"));
                }
            })
            .map_err(|e| napi::Error::from_reason(format!("failed to spawn PipeWire capture thread: {e}")))?;

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

    fn run_session(
        target: AudioSourceTarget,
        stop_flag: Arc<AtomicBool>,
        on_frame: &FrameCallback,
        ready_tx: &mpsc::Sender<String>,
    ) -> Result<(), String> {
        pw::init();

        let mainloop = pw::main_loop::MainLoopRc::new(None).map_err(|e| e.to_string())?;
        let context = pw::context::ContextRc::new(&mainloop, None).map_err(|e| e.to_string())?;
        let core = context.connect_rc(None).map_err(|e| e.to_string())?;
        let registry = core.get_registry().map_err(|e| e.to_string())?;

        // ── Phase 1: find the target's output-audio node id ────────────
        // Mirrors `examples/roundtrip.rs`'s sync/done pattern exactly:
        // `mainloop.run()` blocks until the `done` callback (fired once
        // the registry enumeration catches up to our `sync()` barrier)
        // calls `.quit()` — no manual `iterate()` polling needed.
        let found_node_id: Rc<Cell<Option<u32>>> = Rc::new(Cell::new(None));
        let done = Rc::new(Cell::new(false));

        let found_node_id_cb = Rc::clone(&found_node_id);
        let target_pid = target.pid;
        let target_name = target.process_name.clone();
        let _registry_listener = registry
            .add_listener_local()
            .global(move |global| {
                let Some(props) = global.props else { return };
                if props.get("media.class") != Some("Stream/Output/Audio") {
                    return;
                }
                let pid_matches = target_pid
                    .zip(props.get("application.process.id"))
                    .is_some_and(|(pid, p)| p == pid.to_string());
                let name_matches = target_name
                    .as_deref()
                    .zip(props.get("application.name"))
                    .is_some_and(|(name, n)| n.eq_ignore_ascii_case(name));
                if pid_matches || name_matches {
                    found_node_id_cb.set(Some(global.id));
                }
            })
            .register();

        let done_cb = Rc::clone(&done);
        let mainloop_for_sync = mainloop.clone();
        let pending = core.sync(0).map_err(|e| e.to_string())?;
        let _core_listener = core
            .add_listener_local()
            .done(move |id, seq| {
                if id == pw::core::PW_ID_CORE && seq == pending {
                    done_cb.set(true);
                    mainloop_for_sync.quit();
                }
            })
            .register();

        while !done.get() {
            mainloop.run();
        }

        let Some(node_id) = found_node_id.get() else {
            let _ = ready_tx.send(STATUS_UNSUPPORTED.to_string());
            return Ok(());
        };

        // ── Phase 2: capture stream targeting that node's monitor ──────
        // Mirrors `pw-record --target-object <id> --capture-sink`.
        let props = pw::properties::properties! {
            *pw::keys::MEDIA_TYPE => "Audio",
            *pw::keys::MEDIA_CATEGORY => "Capture",
            *pw::keys::MEDIA_ROLE => "Screen",
            *pw::keys::TARGET_OBJECT => node_id.to_string(),
            *pw::keys::STREAM_CAPTURE_SINK => "true",
        };
        let stream = pw::stream::StreamBox::new(&core, "reson8-screen-share-audio", props)
            .map_err(|e| e.to_string())?;

        let on_frame_cb = on_frame.clone();
        let _stream_listener = stream
            .add_local_listener::<()>()
            .process(move |stream, _| {
                let Some(mut buffer) = stream.dequeue_buffer() else { return };
                let datas = buffer.datas_mut();
                let Some(data) = datas.get_mut(0) else { return };
                let byte_len = data.chunk().size() as usize;
                let Some(samples) = data.data() else { return };
                let valid = &samples[..byte_len.min(samples.len())];
                // Safe f32 reconstruction from raw bytes (no alignment
                // assumptions on the underlying buffer, unlike casting the
                // pointer directly to `*const f32`).
                let floats: Vec<f32> = valid
                    .chunks_exact(4)
                    .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                    .collect();
                let pcm = f32_to_i16le_bytes(&floats);
                on_frame_cb.call(
                    PcmFrame { pcm, sample_rate: CAPTURE_SAMPLE_RATE, channels: CAPTURE_CHANNELS },
                    napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking,
                );
            })
            .register()
            .map_err(|e| e.to_string())?;

        let mut audio_info = pw::spa::param::audio::AudioInfoRaw::new();
        audio_info.set_format(pw::spa::param::audio::AudioFormat::F32LE);
        audio_info.set_rate(CAPTURE_SAMPLE_RATE);
        audio_info.set_channels(CAPTURE_CHANNELS as u32);
        let obj = pw::spa::pod::Object {
            type_: pw::spa::utils::SpaTypes::ObjectParamFormat.as_raw(),
            id: pw::spa::param::ParamType::EnumFormat.as_raw(),
            properties: audio_info.into(),
        };
        let pod_bytes: Vec<u8> = pw::spa::pod::serialize::PodSerializer::serialize(
            std::io::Cursor::new(Vec::new()),
            &pw::spa::pod::Value::Object(obj),
        )
        .map_err(|e| format!("{e:?}"))?
        .0
        .into_inner();
        let mut params = [pw::spa::pod::Pod::from_bytes(&pod_bytes).ok_or("failed to build format POD")?];

        stream
            .connect(
                pw::spa::utils::Direction::Input,
                None,
                pw::stream::StreamFlags::AUTOCONNECT | pw::stream::StreamFlags::MAP_BUFFERS,
                &mut params,
            )
            .map_err(|e| e.to_string())?;

        // ── Stop-signal bridge ──────────────────────────────────────────
        // Bridges the plain `AtomicBool` stop signal (set from whatever
        // thread called `CaptureHandle.stop()`) into the mainloop's own
        // channel mechanism, since the mainloop can only be told to quit
        // from something attached to its own loop.
        let mainloop_weak = mainloop.downgrade();
        let (terminate_tx, terminate_rx) = pw::channel::channel::<()>();
        let _terminate_receiver = terminate_rx.attach(mainloop.loop_(), move |()| {
            if let Some(ml) = mainloop_weak.upgrade() {
                ml.quit();
            }
        });

        let poll_stop_flag = Arc::clone(&stop_flag);
        let timer_terminate_tx = terminate_tx.clone();
        let stop_poll_timer = mainloop.loop_().add_timer(move |_| {
            if poll_stop_flag.load(Ordering::SeqCst) {
                let _ = timer_terminate_tx.send(());
            }
        });
        stop_poll_timer.update_timer(Some(Duration::from_millis(100)), Some(Duration::from_millis(100)));

        let _ = ready_tx.send(STATUS_CAPTURING.to_string());
        mainloop.run();
        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════
// PulseAudio backend
// ═══════════════════════════════════════════════════════════════════════

mod pulse_backend {
    use super::*;
    use libpulse_binding as pulse;
    use libpulse_simple_binding as psimple;
    use std::cell::RefCell;
    use std::rc::Rc;

    const NULL_SINK_NAME: &str = "reson8_share_capture";

    struct RerouteState {
        sink_input_index: u32,
        original_sink_index: u32,
        null_sink_module_index: u32,
        loopback_module_index: u32,
    }

    /// Plain PulseAudio has no per-application monitor to tap directly
    /// (see this file's module doc comment) — this backend temporarily:
    ///   1. loads a `module-null-sink` virtual device,
    ///   2. moves the target's `sink-input` onto it,
    ///   3. loads a `module-loopback` from that null-sink back to the
    ///      user's original sink, so they keep hearing their own app, and
    ///   4. records from the null-sink's monitor via the blocking Simple API.
    /// `stop()` must reverse steps 1-3 (move the sink-input back, unload
    /// both modules) — see `undo_reroute`. If the process is killed
    /// uncleanly mid-share, that reroute can be left in place; this is a
    /// real product caveat, not just an implementation detail (see the
    /// module doc comment above).
    pub fn start_capture(
        target: AudioSourceTarget,
        on_frame: FrameCallback,
    ) -> napi::Result<(String, Box<dyn FnOnce() + Send>)> {
        let Some(reroute) = find_and_reroute_sink_input(&target) else {
            return Ok((STATUS_UNSUPPORTED.to_string(), Box::new(|| {})));
        };

        let stop_flag = Arc::new(AtomicBool::new(false));
        let thread_stop_flag = Arc::clone(&stop_flag);
        let (ready_tx, ready_rx) = mpsc::channel::<String>();

        let monitor_source = format!("{NULL_SINK_NAME}.monitor");
        let join_handle = thread::Builder::new()
            .name("native-audio-pulse-capture".into())
            .spawn(move || {
                if let Err(err) = run_record_loop(&monitor_source, &thread_stop_flag, &on_frame, &ready_tx) {
                    let _ = ready_tx.send(format!("{STATUS_ERROR}: {err}"));
                }
            })
            .map_err(|e| napi::Error::from_reason(format!("failed to spawn Pulse capture thread: {e}")))?;

        let status = match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(s) if s == STATUS_CAPTURING => STATUS_CAPTURING.to_string(),
            Ok(s) => s,
            Err(_) => STATUS_ERROR.to_string(),
        };

        let stop_fn: Box<dyn FnOnce() + Send> = Box::new(move || {
            stop_flag.store(true, Ordering::SeqCst);
            let _ = join_handle.join();
            undo_reroute(&reroute);
        });

        Ok((status, stop_fn))
    }

    /// Introspection is entirely callback-driven in `libpulse-binding`'s
    /// standard (non-threaded) mainloop, so this spins that mainloop
    /// manually via `iterate()` until each step's callback fires — the
    /// conventional pattern for small one-shot Pulse client tools, per
    /// `libpulse-binding`'s own examples. Everything here runs on the
    /// calling thread and is synchronous by the time it returns.
    fn find_and_reroute_sink_input(target: &AudioSourceTarget) -> Option<RerouteState> {
        use pulse::context::{Context, FlagSet as ContextFlagSet};
        use pulse::mainloop::standard::{IterateResult, Mainloop};

        let mut mainloop = Mainloop::new()?;
        let mut context = Context::new(&mainloop, "reson8-native-audio")?;
        context.connect(None, ContextFlagSet::NOFLAGS, None).ok()?;

        loop {
            match mainloop.iterate(true) {
                IterateResult::Quit(_) | IterateResult::Err(_) => return None,
                IterateResult::Success(_) => {}
            }
            match context.get_state() {
                pulse::context::State::Ready => break,
                pulse::context::State::Failed | pulse::context::State::Terminated => return None,
                _ => {}
            }
        }

        // Step 1: find the sink-input matching the target PID (preferred)
        // or process name (fallback — see PRD 12.3 on why: sandboxed/Flatpak
        // apps often report a wrapper PID that doesn't match what Electron
        // sees).
        let matched: Rc<RefCell<Option<(u32, u32)>>> = Rc::new(RefCell::new(None)); // (sink_input_index, sink_index)
        let list_done = Rc::new(RefCell::new(false));
        let matched_cb = Rc::clone(&matched);
        let list_done_cb = Rc::clone(&list_done);
        let target_pid = target.pid;
        let target_name = target.process_name.clone();
        let mut introspector = context.introspect();
        let _op = introspector.get_sink_input_info_list(move |result| match result {
            pulse::callbacks::ListResult::Item(info) => {
                let pid_matches = target_pid
                    .zip(info.proplist.get_str("application.process.id"))
                    .is_some_and(|(pid, p)| p == pid.to_string());
                let name_matches = target_name
                    .as_deref()
                    .zip(info.proplist.get_str("application.name"))
                    .is_some_and(|(name, n)| n.eq_ignore_ascii_case(name));
                if pid_matches || name_matches {
                    *matched_cb.borrow_mut() = Some((info.index, info.sink));
                }
            }
            pulse::callbacks::ListResult::End | pulse::callbacks::ListResult::Error => {
                *list_done_cb.borrow_mut() = true;
            }
        });

        while !*list_done.borrow() {
            if matches!(mainloop.iterate(true), IterateResult::Quit(_) | IterateResult::Err(_)) {
                return None;
            }
        }

        let (sink_input_index, original_sink_index) = (*matched.borrow())?;

        // Step 2: load the null sink.
        let module_index = Rc::new(RefCell::new(None::<u32>));
        let module_done = Rc::new(RefCell::new(false));
        let module_index_cb = Rc::clone(&module_index);
        let module_done_cb = Rc::clone(&module_done);
        introspector.load_module(
            "module-null-sink",
            &format!("sink_name={NULL_SINK_NAME} sink_properties=device.description=Reson8Share"),
            move |idx| {
                *module_index_cb.borrow_mut() = Some(idx);
                *module_done_cb.borrow_mut() = true;
            },
        );
        while !*module_done.borrow() {
            if matches!(mainloop.iterate(true), IterateResult::Quit(_) | IterateResult::Err(_)) {
                return None;
            }
        }
        let null_sink_module_index = (*module_index.borrow())?;

        // Step 3: move the target sink-input onto the null sink.
        // `move_sink_input_by_name`'s callback param is
        // `Option<Box<dyn FnMut(bool)>>` (unlike `load_module`'s bare
        // `FnMut`) — confirmed against libpulse-binding 2.30.1's source.
        let move_done = Rc::new(RefCell::new(false));
        let move_ok = Rc::new(RefCell::new(false));
        let move_done_cb = Rc::clone(&move_done);
        let move_ok_cb = Rc::clone(&move_ok);
        introspector.move_sink_input_by_name(
            sink_input_index,
            NULL_SINK_NAME,
            Some(Box::new(move |ok| {
                *move_ok_cb.borrow_mut() = ok;
                *move_done_cb.borrow_mut() = true;
            })),
        );
        while !*move_done.borrow() {
            if matches!(mainloop.iterate(true), IterateResult::Quit(_) | IterateResult::Err(_)) {
                return None;
            }
        }
        if !*move_ok.borrow() {
            return None;
        }

        // Step 4: loop the null sink's monitor back to the original sink
        // so the user still hears their own app locally.
        let loopback_index = Rc::new(RefCell::new(None::<u32>));
        let loopback_done = Rc::new(RefCell::new(false));
        let loopback_index_cb = Rc::clone(&loopback_index);
        let loopback_done_cb = Rc::clone(&loopback_done);
        introspector.load_module(
            "module-loopback",
            &format!("source={NULL_SINK_NAME}.monitor sink={original_sink_index}"),
            move |idx| {
                *loopback_index_cb.borrow_mut() = Some(idx);
                *loopback_done_cb.borrow_mut() = true;
            },
        );
        while !*loopback_done.borrow() {
            if matches!(mainloop.iterate(true), IterateResult::Quit(_) | IterateResult::Err(_)) {
                return None;
            }
        }
        let loopback_module_index = (*loopback_index.borrow())?;

        Some(RerouteState {
            sink_input_index,
            original_sink_index,
            null_sink_module_index,
            loopback_module_index,
        })
    }

    fn undo_reroute(state: &RerouteState) {
        use pulse::context::{Context, FlagSet as ContextFlagSet};
        use pulse::mainloop::standard::{IterateResult, Mainloop};

        let Some(mut mainloop) = Mainloop::new() else { return };
        let Some(mut context) = Context::new(&mainloop, "reson8-native-audio-cleanup") else { return };
        if context.connect(None, ContextFlagSet::NOFLAGS, None).is_err() {
            return;
        }
        loop {
            match mainloop.iterate(true) {
                IterateResult::Quit(_) | IterateResult::Err(_) => return,
                IterateResult::Success(_) => {}
            }
            if context.get_state() == pulse::context::State::Ready {
                break;
            }
        }

        let mut introspector = context.introspect();
        // Best-effort: move the app's sink-input back to wherever it was,
        // then unload both modules. Each is fire-and-forget with a short
        // spin — this is cleanup on the way out, not worth the complexity
        // of fully synchronizing three more callback round-trips.
        introspector.move_sink_input_by_index(
            state.sink_input_index,
            state.original_sink_index,
            Some(Box::new(|_| {})),
        );
        introspector.unload_module(state.loopback_module_index, |_| {});
        introspector.unload_module(state.null_sink_module_index, |_| {});
        for _ in 0..20 {
            if matches!(mainloop.iterate(true), IterateResult::Quit(_) | IterateResult::Err(_)) {
                break;
            }
        }
    }

    fn run_record_loop(
        monitor_source: &str,
        stop_flag: &AtomicBool,
        on_frame: &FrameCallback,
        ready_tx: &mpsc::Sender<String>,
    ) -> Result<(), String> {
        use psimple::Simple;
        use pulse::def::BufferAttr;
        use pulse::sample::{Format, Spec};
        use pulse::stream::Direction;

        let spec = Spec {
            format: Format::S16le,
            rate: CAPTURE_SAMPLE_RATE,
            channels: CAPTURE_CHANNELS,
        };
        // ~20ms chunks (matches the batching note in PRD 12.7) — also
        // keeps each blocking `read()` short enough that the stop-flag
        // check below responds promptly.
        let frame_bytes = (CAPTURE_SAMPLE_RATE / 50) as usize * CAPTURE_CHANNELS as usize * 2;
        let attr = BufferAttr { maxlength: u32::MAX, fragsize: frame_bytes as u32, ..Default::default() };

        let simple = Simple::new(
            None,
            "Reson8",
            Direction::Record,
            Some(monitor_source),
            "screen-share-capture",
            &spec,
            None,
            Some(&attr),
        )
        // `PAErr` has an inherent `to_string(&self) -> Option<String>`
        // that shadows `ToString::to_string`, so `.to_string()` here
        // resolves to that (confirmed via libpulse-binding 2.30.1's
        // source) rather than the `Display`-based `String` one might
        // expect — `format!("{e}")` routes through `Display` instead.
        .map_err(|e| format!("{e}"))?;

        let _ = ready_tx.send(STATUS_CAPTURING.to_string());

        let mut buf = vec![0u8; frame_bytes];
        while !stop_flag.load(Ordering::SeqCst) {
            simple.read(&mut buf).map_err(|e| format!("{e}"))?;
            on_frame.call(
                PcmFrame { pcm: buf.clone(), sample_rate: CAPTURE_SAMPLE_RATE, channels: CAPTURE_CHANNELS },
                napi::threadsafe_function::ThreadsafeFunctionCallMode::NonBlocking,
            );
        }
        Ok(())
    }
}
