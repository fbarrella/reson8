/**
 * The pure rules of changing the server icon (PRD 19 A2), kept apart from the
 * socket handler so they are unit-tested.
 */

export type IconChange =
    | { kind: "unchanged" }
    | { kind: "remove" }
    | { kind: "set"; uploadId: string };

/**
 * Reads `UPDATE_SERVER_SETTINGS.iconUploadId`: omitted = unchanged, `null` =
 * remove, a non-empty string (at most 64 characters, like every upload id) =
 * set or replace. Anything else is refused, and a URL is never accepted: only
 * the id of an upload the ledger knows.
 */
export function parseIconChange(value: unknown): IconChange | { error: string } {
    if (value === undefined) return { kind: "unchanged" };
    if (value === null) return { kind: "remove" };
    if (typeof value === "string" && value.length > 0 && value.length <= 64) {
        return { kind: "set", uploadId: value };
    }
    return { error: "Invalid icon" };
}

/**
 * The previous icon file to release after the new row is committed: only when
 * one was set, the icon actually changed, and it is not the same file again.
 */
export function iconToRelease(previousUrl: string | null, newUrl: string | null): string | null {
    if (!previousUrl) return null;
    return previousUrl === newUrl ? null : previousUrl;
}
