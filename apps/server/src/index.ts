/**
 * Reson8 Signaling Server — Entry Point
 *
 * Bootstraps Fastify, Socket.io, Prisma, and Redis.
 * This is the main process for the self-hosted server app.
 */

import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { Server as SocketIOServer } from "socket.io";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
} from "@reson8/shared-types";
import { prismaPlugin } from "./plugins/prisma.js";
import { redisPlugin } from "./plugins/redis.js";
import { registerConnectionHandlers } from "./handlers/connection.handler.js";
import { registerVoiceHandlers } from "./handlers/voice.handler.js";
import { registerChannelHandlers } from "./handlers/channel.handler.js";
import { registerMessageHandlers } from "./handlers/message.handler.js";
import { MediasoupService } from "./services/mediasoup.service.js";

const PORT = parseInt(process.env.PORT ?? "9800", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

async function main(): Promise<void> {
    // ── Fastify ────────────────────────────────────────────────────────────
    const app = Fastify({
        logger: {
            level: "info",
            transport: {
                target: "pino-pretty",
                options: { colorize: true },
            },
        },
    });

    // CORS — allow any origin in dev; lock down in production
    await app.register(cors, { origin: true });

    // ── Plugins (Prisma + Redis) ───────────────────────────────────────────
    await app.register(prismaPlugin);
    await app.register(redisPlugin);

    // ── mediasoup SFU ──────────────────────────────────────────────────────
    const mediasoupService = new MediasoupService();
    await mediasoupService.init();
    app.log.info("🎙️ mediasoup Workers initialized");

    // ── Health-check route ─────────────────────────────────────────────────
    app.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));

    // ── Socket.io ──────────────────────────────────────────────────────────
    const io = new SocketIOServer<
        ClientToServerEvents,
        ServerToClientEvents,
        InterServerEvents,
        SocketData
    >(app.server, {
        cors: { origin: "*" },
        pingInterval: 10_000,
        pingTimeout: 5_000,
    });

    // Register socket event handlers
    registerConnectionHandlers(io, app, mediasoupService);
    registerVoiceHandlers(io, app, mediasoupService);
    registerChannelHandlers(io, app);
    registerMessageHandlers(io, app);

    // ── Start ──────────────────────────────────────────────────────────────
    try {
        await app.listen({ port: PORT, host: HOST });
        app.log.info(`🎧 Reson8 server listening on ${HOST}:${PORT}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }

    // Graceful shutdown
    const shutdown = async (): Promise<void> => {
        app.log.info("Shutting down...");
        mediasoupService.close();
        io.close();
        await app.close();
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main();
