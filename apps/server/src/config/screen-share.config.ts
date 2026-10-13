/**
 * The server-wide screen share switch (`servers.screenShareEnabled`), mirrored
 * in memory (PRD 19 A9) so PRODUCE and CONSUME can enforce it without a
 * database read per call — the same pattern as approval.config.ts. Loaded at
 * boot, refreshed by UPDATE_SERVER_SETTINGS.
 *
 * WATCH_SCREEN_SHARE and SET_SCREEN_SHARE_STATE keep their own database reads
 * (they predate this file and always saw the freshest value); the two never
 * disagree for longer than the update that changes them.
 */

let screenShareEnabledValue = true;

export function setScreenShareEnabled(value: boolean): void {
    screenShareEnabledValue = value;
}

export function screenShareEnabled(): boolean {
    return screenShareEnabledValue;
}
