/**
 * Upload Handler — Socket.io events for the upload pipeline (PRD 16.8).
 *
 * Handles: REQUEST_UPLOAD_TOKEN. The HTTP upload routes have no notion of who
 * is calling, while the socket is the one place the server knows a client's
 * identity — so a token minted here is what attributes an upload to a user.
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
} from "@reson8/shared-types";
import { discardUnclaimedUpload, issueUploadToken } from "../services/stored-file.service.js";

type TypedIO = SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export function registerUploadHandlers(io: TypedIO, app: FastifyInstance): void {
    io.on("connection", (socket: TypedSocket) => {
        socket.on("REQUEST_UPLOAD_TOKEN", async (ack) => {
            try {
                // Viewer sockets never upload, and a primary socket has no
                // userId until it has joined a server.
                if (socket.data.role === "viewer" || !socket.data.userId) {
                    ack({ success: false, error: "Not connected to a server" });
                    return;
                }
                const { token, expiresInSec } = await issueUploadToken(app.redis, socket.data.userId);
                ack({ success: true, token, expiresInSec });
            } catch (err) {
                app.log.error({ err }, "Error in REQUEST_UPLOAD_TOKEN");
                ack({ success: false, error: "Failed to issue upload token" });
            }
        });

        // Throw away an upload the user abandoned before it was attached to
        // anything (PRD 16.9). Only their own unclaimed uploads qualify.
        socket.on("DISCARD_UPLOAD", async (payload, ack) => {
            try {
                const uploadId = payload?.uploadId;
                if (socket.data.role === "viewer" || !socket.data.userId) {
                    ack({ success: false, error: "Not connected to a server" });
                    return;
                }
                if (typeof uploadId !== "string" || uploadId.length === 0 || uploadId.length > 64) {
                    ack({ success: false, error: "Invalid upload" });
                    return;
                }
                const discarded = await discardUnclaimedUpload(app.prisma, uploadId, socket.data.userId);
                ack(discarded ? { success: true } : { success: false, error: "Nothing to discard" });
            } catch (err) {
                app.log.error({ err }, "Error in DISCARD_UPLOAD");
                ack({ success: false, error: "Failed to discard upload" });
            }
        });
    });
}
