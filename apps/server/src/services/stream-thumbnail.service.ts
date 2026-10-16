/**
 * Stream thumbnails (PRD 21.12) — the sharer's own app takes a small frame of its capture and sends it
 * here; the server checks the bytes, keeps the newest one per sharer IN MEMORY (never stored, never in the
 * upload ledger) and relays it to the voice room only. Pure rules and an in-memory store, so they are
 * tested without sockets.
 */

import { sniffImage } from "./image-sniff.js";

/** The largest thumbnail accepted, in bytes. */
export const MAX_THUMBNAIL_BYTES = 128 * 1024;
/** The largest side accepted, in pixels. */
export const MAX_THUMBNAIL_SIDE = 960;
/** At most one accepted thumbnail per socket per this many ms (the client sends at +2 s, then every 120 s). */
export const THUMBNAIL_MIN_INTERVAL_MS = 20_000;

export type ThumbnailMime = "image/jpeg" | "image/webp";

export type ThumbnailCheck = { ok: true; mime: ThumbnailMime; width: number; height: number } | { ok: false; error: string };

/** Decides from the bytes themselves (never a declared type): a real JPEG or WebP, small, and a sane size. */
export function validateThumbnail(buf: Buffer): ThumbnailCheck {
    if (buf.length === 0) return { ok: false, error: "Empty image" };
    if (buf.length > MAX_THUMBNAIL_BYTES) return { ok: false, error: "Thumbnail is too large" };
    const sniffed = sniffImage(buf);
    if (!sniffed || (sniffed.type !== "jpeg" && sniffed.type !== "webp")) {
        return { ok: false, error: "Thumbnail must be a JPEG or WebP image" };
    }
    const { width, height } = sniffed;
    if (width < 1 || height < 1 || width > MAX_THUMBNAIL_SIDE || height > MAX_THUMBNAIL_SIDE) {
        return { ok: false, error: "Thumbnail dimensions are out of range" };
    }
    return { ok: true, mime: sniffed.type === "jpeg" ? "image/jpeg" : "image/webp", width, height };
}

/** Turns what Socket.io delivered (a Buffer in Node, but never trust it) into a Buffer, or null. */
export function toBuffer(value: unknown): Buffer | null {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    return null;
}

export interface StoredThumbnail {
    channelId: string;
    userId: string;
    mime: ThumbnailMime;
    image: Buffer;
    takenAt: Date;
}

const keyOf = (channelId: string, userId: string) => `${channelId}:${userId}`;

export class ThumbnailStore {
    private readonly items = new Map<string, StoredThumbnail>();
    private readonly lastAccepted = new Map<string, number>();

    set(channelId: string, userId: string, mime: ThumbnailMime, image: Buffer, takenAt = new Date()): StoredThumbnail {
        const item: StoredThumbnail = { channelId, userId, mime, image, takenAt };
        this.items.set(keyOf(channelId, userId), item);
        return item;
    }

    get(channelId: string, userId: string): StoredThumbnail | undefined {
        return this.items.get(keyOf(channelId, userId));
    }

    listForChannel(channelId: string): StoredThumbnail[] {
        return [...this.items.values()].filter((t) => t.channelId === channelId);
    }

    /** Removes one sharer's thumbnail; true when there was one. */
    clear(channelId: string, userId: string): boolean {
        return this.items.delete(keyOf(channelId, userId));
    }

    /** Removes everything of a channel (it was deleted); returns the userIds that had one. */
    clearChannel(channelId: string): string[] {
        const gone: string[] = [];
        for (const [key, t] of this.items) {
            if (t.channelId === channelId) {
                this.items.delete(key);
                gone.push(t.userId);
            }
        }
        return gone;
    }

    /** Removes a user's thumbnails wherever they are; returns the channel ids. */
    clearUser(userId: string): string[] {
        const gone: string[] = [];
        for (const [key, t] of this.items) {
            if (t.userId === userId) {
                this.items.delete(key);
                gone.push(t.channelId);
            }
        }
        return gone;
    }

    /**
     * The per-socket throttle: true (and recorded) when this socket may send one now. Old entries are
     * dropped here so the map can't grow with every socket that ever shared.
     */
    canAccept(socketId: string, now: number): boolean {
        for (const [id, at] of this.lastAccepted) {
            if (now - at > 10 * THUMBNAIL_MIN_INTERVAL_MS) this.lastAccepted.delete(id);
        }
        const last = this.lastAccepted.get(socketId);
        if (last !== undefined && now - last < THUMBNAIL_MIN_INTERVAL_MS) return false;
        this.lastAccepted.set(socketId, now);
        return true;
    }

    /** Lets a socket send again at once (its share restarted). */
    forgetSocket(socketId: string): void {
        this.lastAccepted.delete(socketId);
    }

    get size(): number {
        return this.items.size;
    }
}

/** The one store of this process. */
export const streamThumbnails = new ThumbnailStore();

/** What clearStreamThumbnail needs from Socket.io: a way to address a room. */
export interface RoomEmitter {
    to(room: string): { emit(event: "STREAM_THUMBNAIL_CLEARED", payload: { channelId: string; userId: string }): unknown };
}

/**
 * A thumbnail must disappear the moment its share does (PRD 21.12): every path that ends a share — the flag
 * turning off, the screen producer closing, leaving/kick/access loss/disconnect, a deleted room — calls this.
 * Tells the room only when there was something to clear.
 */
export function clearStreamThumbnail(io: RoomEmitter, channelId: string, userId: string): void {
    if (streamThumbnails.clear(channelId, userId)) {
        io.to(`channel:${channelId}`).emit("STREAM_THUMBNAIL_CLEARED", { channelId, userId });
    }
}

/** A deleted room: forget everything of it and tell whoever is still listening. */
export function clearChannelThumbnails(io: RoomEmitter, channelId: string): void {
    for (const userId of streamThumbnails.clearChannel(channelId)) {
        io.to(`channel:${channelId}`).emit("STREAM_THUMBNAIL_CLEARED", { channelId, userId });
    }
}
