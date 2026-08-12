/**
 * Emoji Handler — custom server emoji upload + admin approval queue.
 *
 * Handles: CREATE_CUSTOM_EMOJI, GET_APPROVED_EMOJIS, GET_PENDING_EMOJIS,
 *          REVIEW_CUSTOM_EMOJI.
 *
 * Any user may upload; the emoji sits PENDING until an admin (MANAGE_EMOJIS)
 * approves it, at which point it's broadcast to every connected client so
 * pickers update live. Rejecting deletes the row and its stored image
 * outright — there is no persisted "rejected" state to review later.
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
    ICustomEmoji,
} from "@reson8/shared-types";
import { PermissionFlags } from "@reson8/shared-types";
import { requirePermission } from "../middleware/permissions.middleware.js";
import { deleteAttachment } from "../services/storage.service.js";

type TypedIO = SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>;

type TypedSocket = Socket<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>;

const NAME_PATTERN = /^[a-zA-Z0-9_]{2,32}$/;

function toDto(emoji: {
    id: string;
    serverId: string;
    name: string;
    imageUrl: string;
    uploadedBy: string;
    status: string;
    createdAt: Date;
}): ICustomEmoji {
    return {
        id: emoji.id,
        serverId: emoji.serverId,
        name: emoji.name,
        imageUrl: emoji.imageUrl,
        uploadedBy: emoji.uploadedBy,
        status: emoji.status as "PENDING" | "APPROVED",
        createdAt: emoji.createdAt.toISOString(),
    };
}

export function registerEmojiHandlers(
    io: TypedIO,
    app: FastifyInstance,
): void {
    io.on("connection", (socket: TypedSocket) => {
        // ── CREATE_CUSTOM_EMOJI ──────────────────────────────────────────────
        socket.on("CREATE_CUSTOM_EMOJI", async (payload, ack) => {
            try {
                const { name, imageUrl, imagePublicId } = payload;
                const serverId = socket.data.serverId;

                if (!NAME_PATTERN.test(name)) {
                    ack({ success: false, error: "Name must be 2-32 letters, numbers, or underscores" });
                    return;
                }
                if (!imageUrl) {
                    ack({ success: false, error: "Missing image" });
                    return;
                }

                const existing = await app.prisma.customEmoji.findUnique({
                    where: { serverId_name: { serverId, name } },
                });
                if (existing) {
                    ack({ success: false, error: `An emoji named "${name}" already exists` });
                    return;
                }

                const emoji = await app.prisma.customEmoji.create({
                    data: {
                        serverId,
                        name,
                        imageUrl,
                        imagePublicId: imagePublicId ?? null,
                        uploadedBy: socket.data.userId,
                    },
                });

                ack({ success: true, emojiId: emoji.id });

                app.log.info(
                    { socketId: socket.id, emojiId: emoji.id, name },
                    "Custom emoji submitted for review",
                );
            } catch (err) {
                app.log.error({ err }, "Error in CREATE_CUSTOM_EMOJI");
                ack({ success: false, error: "Failed to submit emoji" });
            }
        });

        // ── GET_APPROVED_EMOJIS ──────────────────────────────────────────────
        socket.on("GET_APPROVED_EMOJIS", async (ack) => {
            try {
                const emojis = await app.prisma.customEmoji.findMany({
                    where: { serverId: socket.data.serverId, status: "APPROVED" },
                    orderBy: { name: "asc" },
                });
                ack({ success: true, emojis: emojis.map(toDto) });
            } catch (err) {
                app.log.error({ err }, "Error in GET_APPROVED_EMOJIS");
                ack({ success: false, error: "Failed to fetch emojis" });
            }
        });

        // ── GET_PENDING_EMOJIS ────────────────────────────────────────────────
        socket.on("GET_PENDING_EMOJIS", async (ack) => {
            try {
                const allowed = await requirePermission(
                    app, socket, BigInt(PermissionFlags.MANAGE_EMOJIS),
                );
                if (!allowed) {
                    ack({ success: false, error: "Permission denied" });
                    return;
                }

                const pending = await app.prisma.customEmoji.findMany({
                    where: { serverId: socket.data.serverId, status: "PENDING" },
                    orderBy: { createdAt: "asc" },
                });

                const emojis: ICustomEmoji[] = await Promise.all(
                    pending.map(async (emoji) => {
                        const uploader = await app.prisma.user.findUnique({
                            where: { id: emoji.uploadedBy },
                            select: { nickname: true },
                        });
                        return { ...toDto(emoji), uploadedByNickname: uploader?.nickname ?? "Unknown" };
                    }),
                );

                ack({ success: true, emojis });
            } catch (err) {
                app.log.error({ err }, "Error in GET_PENDING_EMOJIS");
                ack({ success: false, error: "Failed to fetch pending emojis" });
            }
        });

        // ── REVIEW_CUSTOM_EMOJI ──────────────────────────────────────────────
        socket.on("REVIEW_CUSTOM_EMOJI", async (payload, ack) => {
            try {
                const allowed = await requirePermission(
                    app, socket, BigInt(PermissionFlags.MANAGE_EMOJIS),
                );
                if (!allowed) {
                    ack({ success: false, error: "Permission denied" });
                    return;
                }

                const { emojiId, decision } = payload;
                const emoji = await app.prisma.customEmoji.findUnique({ where: { id: emojiId } });
                if (!emoji) {
                    ack({ success: false, error: "Emoji not found" });
                    return;
                }
                if (emoji.status !== "PENDING") {
                    ack({ success: false, error: "Emoji has already been reviewed" });
                    return;
                }

                if (decision === "APPROVED") {
                    const updated = await app.prisma.customEmoji.update({
                        where: { id: emojiId },
                        data: {
                            status: "APPROVED",
                            reviewedAt: new Date(),
                            reviewedBy: socket.data.userId,
                        },
                    });

                    ack({ success: true });

                    io.to(`server:${socket.data.serverId}`).emit("CUSTOM_EMOJI_APPROVED", {
                        serverId: socket.data.serverId,
                        emoji: toDto(updated),
                    });
                } else {
                    await deleteAttachment(emoji.imageUrl, emoji.imagePublicId);
                    await app.prisma.customEmoji.delete({ where: { id: emojiId } });
                    ack({ success: true });
                }

                app.log.info(
                    { socketId: socket.id, emojiId, decision },
                    "Custom emoji reviewed",
                );
            } catch (err) {
                app.log.error({ err }, "Error in REVIEW_CUSTOM_EMOJI");
                ack({ success: false, error: "Failed to review emoji" });
            }
        });
    });
}
