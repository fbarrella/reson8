import { describe, expect, it } from "vitest";
import {
    IMAGE_UPLOAD_ERROR,
    extensionForType,
    storedImageName,
    validateImageBytes,
} from "../services/image-sniff.js";

// Minimal hand-built headers (sizes are irrelevant here: no dimension rules).
const png = (w = 8, h = 8) => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    b.write("IHDR", 12, "latin1");
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
};
const gif = () => {
    const b = Buffer.alloc(13);
    b.write("GIF89a", 0, "latin1");
    b.writeUInt16LE(8, 6);
    b.writeUInt16LE(8, 8);
    return b;
};
const jpeg = () => {
    const sof = Buffer.alloc(19);
    sof[0] = 0xff;
    sof[1] = 0xc0;
    sof.writeUInt16BE(17, 2);
    sof[4] = 8;
    sof.writeUInt16BE(8, 5);
    sof.writeUInt16BE(8, 7);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), sof]);
};
const webp = () => {
    const b = Buffer.alloc(40);
    b.write("RIFF", 0, "latin1");
    b.write("WEBP", 8, "latin1");
    b.write("VP8L", 12, "latin1");
    b[20] = 0x2f;
    b.writeUInt32LE(7 | (7 << 14), 21);
    return b;
};

describe("validateImageBytes", () => {
    it("accepts each format when its declared type matches, naming it from the bytes", () => {
        expect(validateImageBytes(png(), "image/png", "a.png")).toMatchObject({ ok: true, fileName: "a.png" });
        expect(validateImageBytes(jpeg(), "image/jpeg", "a.jpeg")).toMatchObject({ ok: true, fileName: "a.jpg" });
        expect(validateImageBytes(gif(), "image/gif", "a.GIF")).toMatchObject({ ok: true, fileName: "a.gif" });
        expect(validateImageBytes(webp(), "image/webp", "a.webp")).toMatchObject({ ok: true, fileName: "a.webp" });
    });

    it("refuses a PNG declared as GIF (and the other mismatches)", () => {
        expect(validateImageBytes(png(), "image/gif")).toEqual({ ok: false, error: IMAGE_UPLOAD_ERROR });
        expect(validateImageBytes(jpeg(), "image/png").ok).toBe(false);
        expect(validateImageBytes(gif(), "image/webp").ok).toBe(false);
    });

    it("refuses HTML bytes declared as image/png", () => {
        const html = Buffer.from("<html><script>alert(1)</script></html>");
        expect(validateImageBytes(html, "image/png", "x.html")).toEqual({ ok: false, error: IMAGE_UPLOAD_ERROR });
    });

    it("refuses an SVG whatever it is declared as", () => {
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>');
        expect(validateImageBytes(svg, "image/png").ok).toBe(false);
        expect(validateImageBytes(svg, "image/svg+xml").ok).toBe(false);
    });

    it("refuses a declared type outside the four image types", () => {
        expect(validateImageBytes(png(), "image/tiff").ok).toBe(false);
        expect(validateImageBytes(png(), "text/html").ok).toBe(false);
    });

    it("has no dimension rules (a 1x1 PNG is fine here)", () => {
        expect(validateImageBytes(png(1, 1), "image/png").ok).toBe(true);
    });

    it("stores the client's HTML name under the sniffed extension", () => {
        expect(validateImageBytes(png(), "image/png", "x.html")).toMatchObject({ ok: true, fileName: "x.png" });
    });
});

describe("storedImageName", () => {
    it("keeps dots in the base and lower-cases the extension from the bytes", () => {
        expect(storedImageName("photo.final.JPG", "jpg")).toBe("photo.final.jpg");
    });
    it("replaces a wrong extension", () => {
        expect(storedImageName("x.html", "png")).toBe("x.png");
    });
    it("gives an empty or extension-only name the base 'image'", () => {
        expect(storedImageName("", "png")).toBe("image.png");
        expect(storedImageName(".png", "png")).toBe("image.png");
        expect(storedImageName("   ", "gif")).toBe("image.gif");
    });
    it("never lets a path separator through", () => {
        expect(storedImageName("../../etc/passwd.png", "png")).not.toMatch(/[\\/]/);
    });
    it("maps jpeg to .jpg", () => {
        expect(extensionForType("jpeg")).toBe("jpg");
        expect(extensionForType("webp")).toBe("webp");
    });
});
