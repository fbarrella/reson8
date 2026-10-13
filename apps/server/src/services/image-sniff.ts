/**
 * Image sniffing by real bytes (PRD 19 A2) — pure, no dependency.
 *
 * The upload routes used to trust the MIME type the client declared and the
 * extension of the client's file name, so a crafted request could store
 * anything under the public /uploads/ path. A route that calls
 * `validateServerIcon()` instead decides from the file's own header: format,
 * and the pixel size read from it. Nothing here decodes pixels. SVG is never
 * accepted (it can carry script and is served from the server's origin).
 */

export type SniffedImageType = "png" | "jpeg" | "gif" | "webp";
export type SniffedImage = { type: SniffedImageType; width: number; height: number };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_JPEG_SEGMENTS = 64;

function sniffPng(buf: Buffer): SniffedImage | null {
    // signature(8) + chunk length(4) + "IHDR"(4) + width(4) + height(4)
    if (buf.length < 24) return null;
    if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
    if (buf.toString("latin1", 12, 16) !== "IHDR") return null;
    return { type: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function sniffGif(buf: Buffer): SniffedImage | null {
    if (buf.length < 10) return null;
    const magic = buf.toString("latin1", 0, 6);
    if (magic !== "GIF87a" && magic !== "GIF89a") return null;
    return { type: "gif", width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function sniffWebp(buf: Buffer): SniffedImage | null {
    // "RIFF" size "WEBP" then the first chunk's fourcc at 12.
    if (buf.length < 16) return null;
    if (buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WEBP") return null;
    const chunk = buf.toString("latin1", 12, 16);

    if (chunk === "VP8 ") {
        // 3-byte frame tag at 20, start code 9d 01 2a at 23, then two 14-bit sizes.
        if (buf.length < 30) return null;
        if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
        return { type: "webp", width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === "VP8L") {
        // Signature byte 0x2f at 20, then 14 + 14 bits (each minus one) from 21.
        if (buf.length < 25 || buf[20] !== 0x2f) return null;
        const bits = buf.readUInt32LE(21);
        return { type: "webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
        // Canvas size: two 24-bit little-endian values (each minus one) at 24 and 27.
        if (buf.length < 30) return null;
        return { type: "webp", width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    }
    return null;
}

/** True for the SOFn markers that carry the frame size (everything but DHT C4, JPG C8, DAC CC). */
function isSofMarker(m: number): boolean {
    return (
        (m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)
    );
}

function sniffJpeg(buf: Buffer): SniffedImage | null {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
    let pos = 2;
    for (let segments = 0; segments < MAX_JPEG_SEGMENTS; segments++) {
        // Find the next marker: 0xFF, skipping any run of fill 0xFF bytes.
        while (pos < buf.length && buf[pos] !== 0xff) pos++;
        while (pos < buf.length && buf[pos] === 0xff) pos++;
        if (pos >= buf.length) return null;
        const marker = buf[pos];
        pos++;

        // Markers with no length: TEM, RSTn, SOI. EOI or SOS before a SOF means no frame header.
        if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (marker === 0xd9 || marker === 0xda) return null;
        if (marker === 0x00) continue; // a stuffed byte, not a marker

        if (pos + 2 > buf.length) return null;
        const length = buf.readUInt16BE(pos);
        if (length < 2) return null;
        if (isSofMarker(marker)) {
            // length(2) precision(1) height(2) width(2)
            if (pos + 7 > buf.length) return null;
            return { type: "jpeg", height: buf.readUInt16BE(pos + 3), width: buf.readUInt16BE(pos + 5) };
        }
        pos += length;
    }
    return null;
}

/**
 * Identifies a PNG, JPEG, GIF or WebP from its header and returns the pixel
 * size it declares. Anything truncated, unrecognised, zero-sized or not one of
 * those four (SVG included) is null.
 */
export function sniffImage(buf: Buffer): SniffedImage | null {
    const found = sniffPng(buf) ?? sniffGif(buf) ?? sniffWebp(buf) ?? sniffJpeg(buf);
    if (!found || found.width <= 0 || found.height <= 0) return null;
    return found;
}

// ── Server icon rules ───────────────────────────────────────────────────────

export const SERVER_ICON_MIN_SIDE = 256;
export const SERVER_ICON_MAX_SIDE = 4096;
export const SERVER_ICON_ERROR =
    "The icon must be a PNG, JPEG, GIF or WebP image of at least 256×256 pixels.";

const MIME_FOR_TYPE: Record<SniffedImageType, string> = {
    png: "image/png",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
};
const EXTENSION_FOR_TYPE: Record<SniffedImageType, string> = {
    png: "png",
    jpeg: "jpg",
    gif: "gif",
    webp: "webp",
};

/**
 * Decides whether a file may become the server icon. The bytes must sniff as
 * an allowed image whose type equals the declared MIME type and whose sides
 * are each within 256–4096. The stored name is built from the SNIFFED type,
 * never from the client's file name.
 */
export function validateServerIcon(
    buf: Buffer,
    declaredMime: string,
): { ok: true; fileName: string; type: SniffedImageType } | { ok: false; error: string } {
    const sniffed = sniffImage(buf);
    if (!sniffed) return { ok: false, error: SERVER_ICON_ERROR };
    if (MIME_FOR_TYPE[sniffed.type] !== declaredMime) return { ok: false, error: SERVER_ICON_ERROR };
    const { width, height } = sniffed;
    if (
        width < SERVER_ICON_MIN_SIDE ||
        height < SERVER_ICON_MIN_SIDE ||
        width > SERVER_ICON_MAX_SIDE ||
        height > SERVER_ICON_MAX_SIDE
    ) {
        return { ok: false, error: SERVER_ICON_ERROR };
    }
    return { ok: true, fileName: `server-icon.${EXTENSION_FOR_TYPE[sniffed.type]}`, type: sniffed.type };
}

/**
 * True for a locally stored server-icon file (`<uuid>-server-icon.<ext>`).
 * Such a file never changes under its name (a new upload gets a new uuid), so
 * it can be cached forever.
 */
export function isServerIconFileName(name: string): boolean {
    return /^[0-9a-f-]{36}-server-icon\.(png|jpg|jpeg|gif|webp)$/.test(name);
}
