/**
 * Message text normalization (PRD 15.10).
 *
 * Chat messages can now contain line breaks. Windows clipboards and some
 * clients produce `\r\n` (or a lone `\r`); store a single canonical `\n` so
 * every client renders and counts the same text, and so the character limit
 * counts a line break as one character regardless of the sender's OS.
 */
export function normalizeNewlines(text: string | undefined | null): string {
    return (text ?? "").replace(/\r\n?/g, "\n");
}
