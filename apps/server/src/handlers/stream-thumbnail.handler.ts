/**
 * Stream thumbnails (PRD 21.12): SET_STREAM_THUMBNAIL (the sharer sends a frame) and GET_STREAM_THUMBNAILS
 * (someone entering a room asks for the current ones). The audience is the voice room only — the same people
 * who can watch the stream — never `server:` or `members:`.
 */

import type { Server as SocketIOServer } from "socket.io";
import type { FastifyInstance } from "fastify";
import type { ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData, IStreamThumbnail } from "@reson8/shared-types";
import { PresenceService } from "../services/presence.service.js";
import { streamThumbnails, toBuffer, validateThumbnail } from "../services/stream-thumbnail.service.js";

type TypedIO = SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function registerStreamThumbnailHandlers(io: TypedIO, app: FastifyInstance): void {
    const presence = new PresenceService(app.redis);

    io.on("connection", (socket) => {
        socket.on("SET_STREAM_THUMBNAIL", async (payload, ack) => {
            try {
                const userId = socket.data.userId;
                const channelId = payload?.channelId;
                if (socket.data.role !== "primary" || !userId || typeof channelId !== "string" || socket.data.currentChannelId !== channelId) {
                    ack({ success: false, error: "Not in that room" });
                    return;
                }
                // Only the sharer: the flag lives in presence, set by SET_SCREEN_SHARE_STATE.
                const p = await presence.getUserPresence(userId);
                if (!p?.isSharingScreen || p.channelId !== channelId) {
                    ack({ success: false, error: "You are not sharing your screen" });
                    return;
                }
                const buf = toBuffer(payload.image);
                if (!buf) {
                    ack({ success: false, error: "Invalid image" });
                    return;
                }
                const check = validateThumbnail(buf);
                if (!check.ok) {
                    ack({ success: false, error: check.error });
                    return;
                }
                if (!streamThumbnails.canAccept(socket.id, Date.now())) {
                    ack({ success: false, error: "Thumbnails are limited to one every 20 seconds" });
                    return;
                }

                const item = streamThumbnails.set(channelId, userId, check.mime, buf);
                app.log.debug({ userId, channelId, bytes: buf.length, width: check.width, height: check.height }, "Stream thumbnail accepted");
                io.to(`channel:${channelId}`).emit("STREAM_THUMBNAIL_UPDATED", {
                    channelId,
                    userId,
                    mime: item.mime,
                    image: item.image,
                    takenAt: item.takenAt.toISOString(),
                });
                ack({ success: true });
            } catch (err) {
                app.log.error({ err }, "Error in SET_STREAM_THUMBNAIL");
                ack({ success: false, error: "Failed to store the thumbnail" });
            }
        });

        socket.on("GET_STREAM_THUMBNAILS", async (payload, ack) => {
            try {
                const channelId = payload?.channelId;
                if (socket.data.role !== "primary" || typeof channelId !== "string" || socket.data.currentChannelId !== channelId) {
                    ack({ success: false, error: "Not in that room" });
                    return;
                }
                const thumbnails: IStreamThumbnail[] = [];
                for (const t of streamThumbnails.listForChannel(channelId)) {
                    // A path that missed clearing must not hand out a stale frame: the sharer has to still be sharing here.
                    const p = await presence.getUserPresence(t.userId);
                    if (!p?.isSharingScreen || p.channelId !== channelId) {
                        streamThumbnails.clear(channelId, t.userId);
                        continue;
                    }
                    thumbnails.push({ channelId, userId: t.userId, mime: t.mime, image: t.image, takenAt: t.takenAt.toISOString() });
                }
                ack({ success: true, thumbnails });
            } catch (err) {
                app.log.error({ err }, "Error in GET_STREAM_THUMBNAILS");
                ack({ success: false, error: "Failed to read the thumbnails" });
            }
        });
    });
}
