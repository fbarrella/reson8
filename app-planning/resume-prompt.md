# Resume prompt — Phase 12 screen-share testing wrap-up

Paste this into a new session to pick up where we left off.

---

We're on branch `screen-sharing`, all 14 items of PRD 12 (`app-planning/Reson8_Phase12_PRD.md`) are implemented. Last commit (`4f37df4`, "fixed viewer window controls and hardened screen-share source detection") shipped four real fixes found during live testing on my CachyOS/KDE Plasma (Wayland) machine:

- Fullscreen button in the Viewer window now goes through `BrowserWindow.setFullScreen()` via a new `viewer-toggle-fullscreen` IPC call instead of the HTML5 Fullscreen API, whose promise was confirmed to never settle on this system.
- Added a real "Exit Stream" button to the Viewer window (previously only the native window X button worked).
- `desktopCapturer.getSources()` now races a 20s timeout and always resolves to `{success, sources?, error?}` instead of ever hanging/rejecting, so the Selection Modal shows a clear error instead of hanging on "Loading sources…" forever.
- Screen/window source-type detection now also checks `display_id`, not just the `id` prefix — the prefix alone is unreliable under the Wayland portal picker and was leaving the audio-share checkbox enabled for full-monitor shares.

We also root-caused (but didn't "fix" — it's not app-fixable) the black-video and intermittent-failure reports: a synthetic video stream pushed through the *real* mediasoup/VP9-SVC pipeline (real router, real transports, a real Viewer window) rendered perfectly end-to-end, proving the pipeline itself is correct. The real screen-share failures trace to KWin's own log: `atomic commit failed: Dispositivo ou recurso está ocupado` (DRM/KMS "device busy"), correlated with rapid repeated ScreenCast portal session creation on this NVIDIA Optimus (Intel Iris Xe + RTX 3060 Mobile, driver 610.57.04) hybrid-GPU laptop under Wayland. This is a known category of NVIDIA+KWin+PipeWire Wayland screencasting issue, not a Reson8 bug — see the conversation history on this branch for the full investigation (journal excerpts, timestamps, the "rejecting" correlation with the 5th rapid attempt in ~80s).

## What to do

1. Retest screen sharing from a clean state — restart `plasma-xdg-desktop-portal-kde`/`xdg-desktop-portal` first if needed (`systemctl --user restart plasma-xdg-desktop-portal-kde xdg-desktop-portal`), and space out attempts rather than retrying rapidly, to avoid re-triggering the KWin/DRM issue.
2. Specifically verify the four fixes from `4f37df4` actually work end-to-end now: Fullscreen toggling the Viewer window, Exit Stream cleanly closing it, and the audio-share checkbox correctly disabled for a full-monitor share / enabled only for a specific window.
3. Also verify actual screen video renders (not black) when captured for real, now that the pipeline itself is proven correct — if it's still black on a clean attempt, that's a genuine new data point (not yet observed) worth digging into further; if it's fine, the earlier black-video reports were downstream of the same DRM contention.
4. If something's still off, keep iterating as normal — implement, verify, report, stop for me to confirm before moving on, same pattern as the rest of this phase.
5. **Once I explicitly confirm the tests pass**, and not before: run `/log-progress` to append the Phase 12 entry to `app-planning/progress.txt`, then run `/bump-version` to cut the release. Don't run either of these on your own initiative — wait for my go-ahead.
