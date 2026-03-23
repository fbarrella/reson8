/**
 * Reson8 Signaling Server — Entry Point
 *
 * Bootstraps Fastify, Socket.io, Prisma, and Redis.
 * This is the main process for the self-hosted server app.
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
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
import { registerAdminHandlers } from "./handlers/admin.handler.js";
import { registerDMHandlers } from "./handlers/dm.handler.js";
import { registerModerationHandlers } from "./handlers/moderation.handler.js";
import { registerReactionHandlers } from "./handlers/reaction.handler.js";
import { registerUploadRoute } from "./routes/upload.route.js";
import { MediasoupService } from "./services/mediasoup.service.js";

// Augment Fastify with the resolved server ID
declare module "fastify" {
    interface FastifyInstance {
        serverId: string;
    }
}

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

    // ── Plugins (Prisma + Redis + Multipart + Static) ──────────────────────
    await app.register(prismaPlugin);
    await app.register(redisPlugin);
    await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
    await app.register(fastifyStatic, {
        root: path.resolve(process.cwd(), "uploads"),
        prefix: "/uploads/",
        decorateReply: false,
    });

    // ── Server Bootstrap ──────────────────────────────────────────────────
    // Auto-create (or reuse) the server record in the database.
    const serverName = process.env.SERVER_NAME ?? "Reson8 Server";
    const serverAddress = process.env.SERVER_ADDRESS ?? `localhost:${PORT}`;
    const maxClients = parseInt(process.env.MAX_CLIENTS ?? "32", 10);

    let server = await app.prisma.server.findFirst();
    if (!server) {
        server = await app.prisma.server.create({
            data: {
                id: randomUUID(),
                name: serverName,
                address: serverAddress,
                maxClients,
            },
        });
        app.log.info(`🆕 Created server record: ${server.name} (${server.id})`);
    } else {
        app.log.info(`✅ Using existing server record: ${server.name} (${server.id})`);
    }

    app.decorate("serverId", server.id);

    // ── mediasoup SFU ──────────────────────────────────────────────────────
    const mediasoupService = new MediasoupService();
    await mediasoupService.init();
    app.log.info("🎙️ mediasoup Workers initialized");

    // ── Health-check route ─────────────────────────────────────────────────
    app.get("/health", async () => ({ status: "ok", uptime: process.uptime() }));

    // ── Upload route ──────────────────────────────────────────────────────
    await registerUploadRoute(app);

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
    registerAdminHandlers(io, app);
    registerDMHandlers(io, app);
    registerModerationHandlers(io, app, mediasoupService);
    registerReactionHandlers(io, app);

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
