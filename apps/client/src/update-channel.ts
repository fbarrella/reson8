/**
 * Beta update channel — the PURE half of the opt-in beta-update flow.
 *
 * Reson8 ships two update channels on GitHub: stable releases (metadata in
 * `latest.yml` / `latest-linux.yml` / `latest-mac.yml`, published as a normal
 * release) and pre-releases (the same metadata in `beta.yml` /
 * `beta-linux.yml` / `beta-mac.yml`, published as a GitHub *pre-release*). The
 * stable path is the default; betas are strictly opt-in through
 * Settings → About's "Register for beta tests" switch.
 *
 * This module is Electron-free so it can be unit-tested in plain Node
 * (`scripts/update-channel-smoke.mjs`), imported by `main.ts` (which applies
 * the result to `electron-updater`) and re-exported by `preload.ts` (so the
 * renderer — a plain <script> that can't import modules — can compute the
 * switch's default state without duplicating the rules).
 *
 * NOTE: `allowDowngrade` is deliberately NOT part of the resolution. It is a
 * side effect of electron-updater's `channel` setter (it forces it to `true`),
 * so `main.ts` must set `autoUpdater.allowDowngrade = false` right after
 * applying `channel`, or a beta tester on a stable version newer than the
 * latest beta would be offered a downgrade.
 */

export type UpdateChannel = "latest" | "beta";

export interface UpdateChannelResolution {
    /** What to assign to `autoUpdater.channel`. */
    channel: UpdateChannel;
    /** What to assign to `autoUpdater.allowPrerelease`. */
    allowPrerelease: boolean;
}

/** True for a pre-release version such as `3.0.0-beta.3`. */
export function isPrerelease(version: string): boolean {
    return typeof version === "string" && version.includes("-");
}

/**
 * The effective opt-in state. An explicit user choice (the `reson8-beta-updates`
 * localStorage value) always wins. With no stored choice, a pre-release build
 * defaults ON — whoever installed a beta wants betas — and a stable build
 * defaults OFF, since beta updates are meant to be opt-in.
 *
 * The computed default is never stored, so a later upgrade from a beta build to
 * a stable one falls back to the stable default instead of staying on beta.
 */
export function effectiveBetaOptIn(stored: string | null, currentVersion: string): boolean {
    if (stored === "true") return true;
    if (stored === "false") return false;
    return isPrerelease(currentVersion);
}

/**
 * The `electron-updater` channel/`allowPrerelease` pair for a check. Main must
 * set the channel EXPLICITLY in both directions: on a pre-release build the
 * baked-in `app-update.yml` says `channel: beta`, so leaving it alone while
 * beta updates are off would try to fetch a `beta*.yml` from a stable tag and
 * fail instead of doing a clean stable check.
 */
export function resolveUpdateChannel(betaOptIn: boolean): UpdateChannelResolution {
    return betaOptIn
        ? { channel: "beta", allowPrerelease: true }
        : { channel: "latest", allowPrerelease: false };
}
