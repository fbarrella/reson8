/**
 * Reson8 Client — Screen Share Viewer renderer (PRD 12.13)
 *
 * Thin UI wiring over `reson8ViewerApi` (exposed by `preload-viewer.ts`).
 * All mediasoup/socket logic lives in the preload script — this file only
 * drives the status overlay and the transport controls.
 *
 * Wrapped in an IIFE (matching `renderer.ts`'s `(window as any).reson8Api`
 * pattern rather than a `declare global` module augmentation) so this stays
 * a plain classic script: with top-level `import`/`export`, tsc's CommonJS
 * output adds an `exports` reference that only exists under a module loader,
 * which `<script src="viewer.js">` in a bare HTML page does not provide.
 */

(function () {
    type ViewerStatus = "connecting" | "watching" | "ended" | "error";

    interface Reson8ViewerApi {
        info: { nickname: string; targetUserId: string; channelId: string; roomName: string };
        getStreamName(): string;
        onStatus(cb: (status: ViewerStatus, message?: string) => void): void;
        setVolume(percent: number): void;
        toggleMute(): boolean;
        isMuted(): boolean;
        toggleFullscreen(): Promise<boolean>;
        setAlwaysOnTop(flag: boolean): Promise<boolean>;
        returnToMain(): void;
        getWindowChrome(): Promise<{ integrated: boolean; platform: string; maximized: boolean; fullscreen: boolean }>;
        onWindowChromeState(cb: (state: { maximized: boolean; fullscreen: boolean }) => void): void;
    }

    const api = (window as any).reson8ViewerApi as Reson8ViewerApi;

    const nicknameLabel = document.getElementById("viewer-nickname-label") as HTMLSpanElement;
    const statusOverlay = document.getElementById("status-overlay") as HTMLDivElement;
    const statusTitle = document.getElementById("status-title") as HTMLDivElement;
    const statusMessage = document.getElementById("status-message") as HTMLDivElement;
    const btnMute = document.getElementById("btn-mute") as HTMLButtonElement;
    const volumeSlider = document.getElementById("volume-slider") as HTMLInputElement;
    const btnFullscreen = document.getElementById("btn-fullscreen") as HTMLButtonElement;
    const btnExitStream = document.getElementById("btn-exit-stream") as HTMLButtonElement;

    // Window title bar only — the controls-bar label next to it stays the
    // plain nickname, unchanged from before this.
    function setWindowTitle(): void {
        // Only meaningful once watching has actually started —
        // `getStreamName()` reads back what WATCH_SCREEN_SHARE's ack
        // resolved to, which happens well after this script first runs.
        // "{sharer} · {stream name} — {room}" (PRD 19 C10), degrading to what is known.
        const streamName = api.getStreamName();
        let title = api.info.nickname;
        if (streamName) title += ` · ${streamName}`;
        if (api.info.roomName) title += ` — ${api.info.roomName}`;
        document.title = title;
        const bar = document.getElementById("viewer-title");
        if (bar) bar.textContent = title; // the integrated bar shows the same string (PRD 19 R7)
    }

    // The integrated title bar (PRD 19 R7): the frame mode is decided by the main process.
    void api.getWindowChrome().then((chrome) => {
        document.body.classList.toggle("integrated-titlebar", chrome.integrated);
        document.body.classList.add(`platform-${chrome.platform}`);
        document.body.classList.toggle("window-fullscreen", chrome.fullscreen);
    });
    api.onWindowChromeState((state) => document.body.classList.toggle("window-fullscreen", state.fullscreen));

    setWindowTitle();
    nicknameLabel.textContent = api.info.nickname;

    const STATUS_TEXT: Record<ViewerStatus, string> = {
        connecting: "Connecting…",
        watching: "",
        ended: "Stream ended",
        error: "Something went wrong",
    };

    api.onStatus((status, message) => {
        statusOverlay.classList.toggle("hidden", status === "watching");
        statusOverlay.classList.toggle("error", status === "error");
        statusTitle.textContent = STATUS_TEXT[status];
        statusMessage.textContent = message ?? "";
        if (status === "watching") setWindowTitle();
    });

    btnMute.addEventListener("click", () => {
        const muted = api.toggleMute();
        btnMute.classList.toggle("muted", muted);
    });

    const volumeReadout = document.getElementById("volume-readout") as HTMLSpanElement;
    volumeSlider.addEventListener("input", () => {
        api.setVolume(Number(volumeSlider.value));
        volumeReadout.textContent = `${volumeSlider.value}%`;
    });

    // Always on top: on by default, remembered in this window's own storage.
    const btnOnTop = document.getElementById("btn-always-on-top") as HTMLButtonElement;
    const ON_TOP_KEY = "reson8-viewer-on-top";
    let onTop = true;
    try {
        onTop = localStorage.getItem(ON_TOP_KEY) !== "0";
    } catch {
        /* storage unavailable — the default stands */
    }
    const paintOnTop = (): void => {
        btnOnTop.classList.toggle("active", onTop);
        btnOnTop.setAttribute("aria-pressed", String(onTop));
    };
    paintOnTop();
    void api.setAlwaysOnTop(onTop);
    btnOnTop.addEventListener("click", async () => {
        onTop = !onTop;
        try {
            localStorage.setItem(ON_TOP_KEY, onTop ? "1" : "0");
        } catch {
            /* not remembered */
        }
        await api.setAlwaysOnTop(onTop);
        paintOnTop();
    });

    (document.getElementById("btn-return") as HTMLButtonElement).addEventListener("click", () => api.returnToMain());

    btnFullscreen.addEventListener("click", async () => {
        const isFullscreen = await api.toggleFullscreen();
        btnFullscreen.classList.toggle("active", isFullscreen);
    });

    btnExitStream.addEventListener("click", () => {
        window.close();
    });
})();
