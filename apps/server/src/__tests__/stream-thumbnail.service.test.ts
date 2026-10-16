import { describe, expect, it } from "vitest";
import {
    MAX_THUMBNAIL_BYTES,
    THUMBNAIL_MIN_INTERVAL_MS,
    ThumbnailStore,
    clearChannelThumbnails,
    clearStreamThumbnail,
    streamThumbnails,
    toBuffer,
    validateThumbnail,
} from "../services/stream-thumbnail.service.js";

// Minimal hand-built headers, like image-sniff.test.ts.
function jpeg(w: number, h: number, padTo = 0): Buffer {
    const sof = Buffer.alloc(19);
    sof[0] = 0xff;
    sof[1] = 0xc0;
    sof.writeUInt16BE(17, 2);
    sof[4] = 8;
    sof.writeUInt16BE(h, 5);
    sof.writeUInt16BE(w, 7);
    const head = Buffer.concat([Buffer.from([0xff, 0xd8]), sof]);
    return padTo > head.length ? Buffer.concat([head, Buffer.alloc(padTo - head.length)]) : head;
}
function webpLossy(w: number, h: number): Buffer {
    const b = Buffer.alloc(40);
    b.write("RIFF", 0, "latin1");
    b.writeUInt32LE(30, 4);
    b.write("WEBP", 8, "latin1");
    b.write("VP8 ", 12, "latin1");
    b[23] = 0x9d;
    b[24] = 0x01;
    b[25] = 0x2a;
    b.writeUInt16LE(w, 26);
    b.writeUInt16LE(h, 28);
    return b;
}
function png(w: number, h: number): Buffer {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    b.write("IHDR", 12, "latin1");
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
}

describe("validateThumbnail", () => {
    it("accepts a JPEG and a WebP of a sane size", () => {
        expect(validateThumbnail(jpeg(480, 270))).toMatchObject({ ok: true, mime: "image/jpeg", width: 480, height: 270 });
        expect(validateThumbnail(webpLossy(480, 270))).toMatchObject({ ok: true, mime: "image/webp" });
    });

    it("refuses a PNG, whatever the client calls it", () => {
        expect(validateThumbnail(png(480, 270))).toMatchObject({ ok: false });
    });

    it("refuses wrong magic bytes and an empty buffer", () => {
        expect(validateThumbnail(Buffer.from("<svg onload=alert(1)>"))).toMatchObject({ ok: false });
        expect(validateThumbnail(Buffer.alloc(0))).toMatchObject({ ok: false });
    });

    it("refuses more than 128 KB, accepts exactly 128 KB", () => {
        expect(validateThumbnail(jpeg(480, 270, MAX_THUMBNAIL_BYTES + 1))).toMatchObject({ ok: false });
        expect(validateThumbnail(jpeg(480, 270, MAX_THUMBNAIL_BYTES))).toMatchObject({ ok: true });
    });

    it("refuses a side beyond 960 px and a zero side", () => {
        expect(validateThumbnail(jpeg(961, 270))).toMatchObject({ ok: false });
        expect(validateThumbnail(jpeg(270, 961))).toMatchObject({ ok: false });
        expect(validateThumbnail(jpeg(960, 960))).toMatchObject({ ok: true });
        expect(validateThumbnail(jpeg(0, 100))).toMatchObject({ ok: false });
    });
});

describe("toBuffer", () => {
    it("takes Buffers, ArrayBuffers and typed arrays, nothing else", () => {
        expect(toBuffer(Buffer.from([1, 2]))?.length).toBe(2);
        expect(toBuffer(new Uint8Array([1, 2, 3]))?.length).toBe(3);
        expect(toBuffer(new Uint8Array([1, 2, 3]).buffer)?.length).toBe(3);
        expect(toBuffer("abc")).toBeNull();
        expect(toBuffer({ length: 3 })).toBeNull();
        expect(toBuffer(null)).toBeNull();
    });
});

describe("ThumbnailStore", () => {
    const img = jpeg(100, 100);

    it("keeps the newest per sharer and lists by channel", () => {
        const s = new ThumbnailStore();
        s.set("c1", "u1", "image/jpeg", img);
        s.set("c1", "u2", "image/jpeg", img);
        s.set("c2", "u1", "image/jpeg", img);
        s.set("c1", "u1", "image/webp", img); // replaces
        expect(s.listForChannel("c1").map((t) => t.userId).sort()).toEqual(["u1", "u2"]);
        expect(s.get("c1", "u1")?.mime).toBe("image/webp");
        expect(s.listForChannel("nowhere")).toEqual([]);
    });

    it("clear / clearChannel / clearUser", () => {
        const s = new ThumbnailStore();
        s.set("c1", "u1", "image/jpeg", img);
        s.set("c1", "u2", "image/jpeg", img);
        s.set("c2", "u1", "image/jpeg", img);
        expect(s.clear("c1", "u1")).toBe(true);
        expect(s.clear("c1", "u1")).toBe(false);
        expect(s.clearUser("u1")).toEqual(["c2"]);
        expect(s.clearChannel("c1")).toEqual(["u2"]);
        expect(s.size).toBe(0);
    });

    it("throttles per socket: one per 20 s, independent sockets, forgetSocket resets", () => {
        const s = new ThumbnailStore();
        expect(s.canAccept("a", 1_000)).toBe(true);
        expect(s.canAccept("a", 1_000 + THUMBNAIL_MIN_INTERVAL_MS - 1)).toBe(false);
        expect(s.canAccept("b", 1_500)).toBe(true);
        expect(s.canAccept("a", 1_000 + THUMBNAIL_MIN_INTERVAL_MS)).toBe(true);
        s.forgetSocket("a");
        expect(s.canAccept("a", 1_000 + THUMBNAIL_MIN_INTERVAL_MS + 1)).toBe(true);
    });
});

describe("clearStreamThumbnail", () => {
    const rooms: { room: string; event: string; payload: unknown }[] = [];
    const io = {
        to: (room: string) => ({ emit: (event: "STREAM_THUMBNAIL_CLEARED", payload: { channelId: string; userId: string }) => rooms.push({ room, event, payload }) }),
    };

    it("tells the room only when there was something, and only that room", () => {
        rooms.length = 0;
        streamThumbnails.set("room1", "sharer", "image/jpeg", jpeg(10, 10));
        clearStreamThumbnail(io, "room1", "sharer");
        clearStreamThumbnail(io, "room1", "sharer"); // already gone: silent
        expect(rooms).toEqual([{ room: "channel:room1", event: "STREAM_THUMBNAIL_CLEARED", payload: { channelId: "room1", userId: "sharer" } }]);
    });

    it("a deleted room clears every sharer of it", () => {
        rooms.length = 0;
        streamThumbnails.set("room2", "a", "image/jpeg", jpeg(10, 10));
        streamThumbnails.set("room2", "b", "image/jpeg", jpeg(10, 10));
        streamThumbnails.set("room3", "c", "image/jpeg", jpeg(10, 10));
        clearChannelThumbnails(io, "room2");
        expect(rooms.map((r) => (r.payload as { userId: string }).userId).sort()).toEqual(["a", "b"]);
        expect(streamThumbnails.get("room3", "c")).toBeDefined();
        streamThumbnails.clearChannel("room3");
    });
});
