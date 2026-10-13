import { describe, expect, it } from "vitest";
import {
    SERVER_ICON_ERROR,
    isServerIconFileName,
    sniffImage,
    validateServerIcon,
} from "../services/image-sniff.js";

// ── Minimal hand-built headers ──────────────────────────────────────────────

function png(w: number, h: number): Buffer {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    b.write("IHDR", 12, "latin1");
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
}

function gif(w: number, h: number, version = "GIF89a"): Buffer {
    const b = Buffer.alloc(13);
    b.write(version, 0, "latin1");
    b.writeUInt16LE(w, 6);
    b.writeUInt16LE(h, 8);
    return b;
}

function webpHeader(chunk: string, size: number): Buffer {
    const b = Buffer.alloc(40);
    b.write("RIFF", 0, "latin1");
    b.writeUInt32LE(size, 4);
    b.write("WEBP", 8, "latin1");
    b.write(chunk, 12, "latin1");
    return b;
}
function webpLossy(w: number, h: number): Buffer {
    const b = webpHeader("VP8 ", 30);
    b[23] = 0x9d;
    b[24] = 0x01;
    b[25] = 0x2a;
    b.writeUInt16LE(w, 26);
    b.writeUInt16LE(h, 28);
    return b;
}
function webpLossless(w: number, h: number): Buffer {
    const b = webpHeader("VP8L", 20);
    b[20] = 0x2f;
    b.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 21);
    return b;
}
function webpExtended(w: number, h: number): Buffer {
    const b = webpHeader("VP8X", 20);
    b.writeUIntLE(w - 1, 24, 3);
    b.writeUIntLE(h - 1, 27, 3);
    return b;
}

/** SOI, optional APP1 segment, then SOF0 with the size. */
function jpeg(w: number, h: number, withApp1 = false): Buffer {
    const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
    if (withApp1) {
        const exif = Buffer.alloc(20, 0x41);
        const head = Buffer.from([0xff, 0xe1, 0x00, exif.length + 2]);
        parts.push(head, exif);
    }
    const sof = Buffer.alloc(19);
    sof[0] = 0xff;
    sof[1] = 0xc0;
    sof.writeUInt16BE(17, 2);
    sof[4] = 8;
    sof.writeUInt16BE(h, 5);
    sof.writeUInt16BE(w, 7);
    parts.push(sof);
    return Buffer.concat(parts);
}

describe("sniffImage", () => {
    it.each([
        ["png", png(512, 512), 512, 512],
        ["png small", png(100, 100), 100, 100],
        ["gif", gif(512, 300), 512, 300],
        ["gif87a", gif(64, 64, "GIF87a"), 64, 64],
        ["webp lossy", webpLossy(512, 400), 512, 400],
        ["webp lossless", webpLossless(1000, 800), 1000, 800],
        ["webp extended", webpExtended(2048, 1024), 2048, 1024],
        ["jpeg", jpeg(640, 480), 640, 480],
        ["jpeg after APP1", jpeg(300, 700, true), 300, 700],
    ])("reads %s", (_name, buf, w, h) => {
        const got = sniffImage(buf);
        expect(got).not.toBeNull();
        expect([got!.width, got!.height]).toEqual([w, h]);
    });

    it("reports the type for each format", () => {
        expect(sniffImage(png(300, 300))!.type).toBe("png");
        expect(sniffImage(gif(300, 300))!.type).toBe("gif");
        expect(sniffImage(webpLossy(300, 300))!.type).toBe("webp");
        expect(sniffImage(jpeg(300, 300))!.type).toBe("jpeg");
    });

    it("returns null for a truncated header", () => {
        expect(sniffImage(png(512, 512).subarray(0, 20))).toBeNull();
        expect(sniffImage(gif(512, 512).subarray(0, 8))).toBeNull();
        expect(sniffImage(webpLossy(512, 512).subarray(0, 24))).toBeNull();
        expect(sniffImage(jpeg(512, 512).subarray(0, 8))).toBeNull();
        expect(sniffImage(Buffer.alloc(0))).toBeNull();
    });

    it("returns null for random bytes", () => {
        const noise = Buffer.from(Array.from({ length: 200 }, (_, i) => (i * 73 + 41) % 251));
        expect(sniffImage(noise)).toBeNull();
    });

    it("never accepts SVG, however it starts", () => {
        expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"/>'))).toBeNull();
        expect(sniffImage(Buffer.from('<?xml version="1.0"?><svg width="512" height="512"></svg>'))).toBeNull();
    });

    it("rejects HTML saved with an image name", () => {
        expect(sniffImage(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
    });

    it("returns null for a JPEG with no frame header before the scan", () => {
        // SOI, then SOS straight away.
        expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x00, 0x00]))).toBeNull();
    });

    it("gives up on a JPEG that is only segments (64-segment bound)", () => {
        const seg = Buffer.from([0xff, 0xe1, 0x00, 0x02]);
        const buf = Buffer.concat([Buffer.from([0xff, 0xd8]), ...Array.from({ length: 100 }, () => seg), jpeg(512, 512).subarray(2)]);
        expect(sniffImage(buf)).toBeNull();
    });

    it("returns null for zero-sized images", () => {
        expect(sniffImage(png(0, 512))).toBeNull();
        expect(sniffImage(gif(512, 0))).toBeNull();
    });
});

describe("validateServerIcon", () => {
    it("accepts a matching, large-enough image and names it from the sniffed type", () => {
        const r = validateServerIcon(png(512, 512), "image/png");
        expect(r).toEqual({ ok: true, fileName: "server-icon.png", type: "png" });
        expect(validateServerIcon(jpeg(512, 512), "image/jpeg")).toMatchObject({ ok: true, fileName: "server-icon.jpg" });
        expect(validateServerIcon(webpLossless(512, 512), "image/webp")).toMatchObject({ ok: true, fileName: "server-icon.webp" });
        expect(validateServerIcon(gif(512, 512), "image/gif")).toMatchObject({ ok: true, fileName: "server-icon.gif" });
    });

    it("refuses a PNG declared as JPEG (declared type must equal the bytes)", () => {
        expect(validateServerIcon(png(512, 512), "image/jpeg")).toEqual({ ok: false, error: SERVER_ICON_ERROR });
    });

    it("refuses images under 256 or over 4096 on either side", () => {
        expect(validateServerIcon(png(100, 100), "image/png").ok).toBe(false);
        expect(validateServerIcon(png(255, 512), "image/png").ok).toBe(false);
        expect(validateServerIcon(png(512, 255), "image/png").ok).toBe(false);
        expect(validateServerIcon(png(256, 256), "image/png").ok).toBe(true);
        expect(validateServerIcon(png(4096, 4096), "image/png").ok).toBe(true);
        expect(validateServerIcon(png(4097, 512), "image/png").ok).toBe(false);
    });

    it("refuses SVG and non-images even when declared as an allowed type", () => {
        expect(validateServerIcon(Buffer.from("<svg/>"), "image/png").ok).toBe(false);
        expect(validateServerIcon(Buffer.from("not an image"), "image/jpeg").ok).toBe(false);
    });
});

describe("isServerIconFileName", () => {
    const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e";
    it("matches only <uuid>-server-icon.<image ext>", () => {
        expect(isServerIconFileName(`${uuid}-server-icon.png`)).toBe(true);
        expect(isServerIconFileName(`${uuid}-server-icon.jpg`)).toBe(true);
        expect(isServerIconFileName(`${uuid}-server-icon.webp`)).toBe(true);
        expect(isServerIconFileName(`${uuid}-photo.png`)).toBe(false);
        expect(isServerIconFileName(`server-icon.png`)).toBe(false);
        expect(isServerIconFileName(`${uuid}-server-icon.svg`)).toBe(false);
        expect(isServerIconFileName(`${uuid}-server-icon.png.html`)).toBe(false);
    });
});
