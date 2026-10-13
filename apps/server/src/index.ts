/**
 * Reson8 Signaling Server — Entry Point
 *
 * Bootstraps Fastify, Socket.io, Prisma, and Redis.
 * This is the main process for the self-hosted server app.
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import type { Server as HttpsServer } from "node:https";
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
import { registerEmojiHandlers } from "./handlers/emoji.handler.js";
import { registerNudgeHandlers } from "./handlers/nudge.handler.js";
import { registerUploadHandlers } from "./handlers/upload.handler.js";
import { registerProfileHandlers } from "./handlers/profile.handler.js";
import { registerApprovalHandlers } from "./handlers/approval.handler.js";
import { describeHandler, normalizePacket, requiresSignIn } from "./services/packet-guard.js";
import { NO_ACCESS_MESSAGE, requiresAccess } from "./services/access.service.js";
import { registerUploadRoute } from "./routes/upload.route.js";
import { MediasoupService } from "./services/mediasoup.service.js";
import { startUploadSweeper } from "./services/upload-sweeper.js";
import { startIdentityEventPruner } from "./services/identity-events.service.js";
import { setDbAllowedHosts, setDbRequireSigned } from "./config/identity.config.js";
import { setDbRequireApproval } from "./config/approval.config.js";
import { setDbRequireInvite } from "./config/invite.config.js";
import { registerInviteHandlers } from "./handlers/invite.handler.js";
import { startApprovalPruner } from "./services/approval.service.js";
import { getTrustProxy, resolveClientAddress } from "./services/client-address.js";
import { addressBans, reloadAddressBans } from "./services/address-ban.service.js";
import { loadTlsMaterial, readTlsEnv, watchTlsFiles } from "./config/tls.config.js";
import { isServerIconFileName } from "./services/image-sniff.js";

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
    // Which proxies' forwarded-address headers we believe (PRD 18.2) and
    // whether we terminate TLS ourselves. Both are decided before anything
    // listens; a half-configured TLS pair stops the boot instead of silently
    // serving plain HTTP.
    const trustProxy = getTrustProxy();
    const tlsFiles = readTlsEnv();
    const tlsMaterial = tlsFiles ? loadTlsMaterial(tlsFiles) : null;

    const fastifyOptions = {
        logger: {
            level: "info" as const,
            transport: {
                target: "pino-pretty",
                options: { colorize: true },
            },
        },
        trustProxy: trustProxy.list.length > 0 ? trustProxy.list : false,
    };
    // Fastify's generics change with `https`; the rest of the code only uses
    // the base FastifyInstance interface.
    const app = (
        tlsMaterial
            ? Fastify({ ...fastifyOptions, https: { key: tlsMaterial.key, cert: tlsMaterial.cert, minVersion: "TLSv1.2" } })
            : Fastify(fastifyOptions)
    ) as unknown as FastifyInstance;

    app.log.info(
        tlsMaterial
            ? `🔒 TLS: native (${tlsMaterial.summary})`
            : "🔓 TLS: off — put a reverse proxy in front (see the README) or set TLS_CERT_FILE/TLS_KEY_FILE",
    );
    app.log.info(`Trust proxy: ${trustProxy.description}`);
    if (trustProxy.warning) app.log.warn(trustProxy.warning);

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
        // The plugin applies its own Cache-Control AFTER setHeaders runs, so it
        // is switched off and set here instead: a server icon never changes
        // under its name (a new upload gets a new uuid) and is cached for good
        // (PRD 19 A2); every other file keeps the plugin's former default.
        cacheControl: false,
        setHeaders(res, filePath) {
            res.setHeader(
                "Cache-Control",
                isServerIconFileName(path.basename(filePath))
                    ? "public, max-age=31536000, immutable"
                    : "public, max-age=0",
            );
        },
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
    // The admin-set "require signed identity" value (PRD 18.4); the env var still wins.
    setDbRequireSigned(server.requireSignedIdentity);
    setDbAllowedHosts(server.authAllowedHosts);
    await reloadAddressBans(app.prisma, server.id);
    setDbRequireApproval(server.requireApproval);
    setDbRequireInvite(server.requireInvite);

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
        // Matches Socket.io's own defaults — the previous 10s/5s pair was
        // aggressive enough to trip a full disconnect (and the resulting
        // mediasoup teardown) on ordinary jitter like a brief GC pause or a
        // laptop sleep/wake, well before the underlying connection actually
        // died (see PRD 11.1).
        pingInterval: 25_000,
        pingTimeout: 20_000,
    });

    // Tags every socket with its role (PRD 12.13) before any `connection`
    // handler can run — a Viewer window's client connects with
    // `?role=viewer` in the query string; everything else (including a
    // plain reconnect with no query at all) defaults to "primary". This
    // MUST run as `io.use()` middleware, not inside a `connection` handler,
    // since Socket.io guarantees middleware completes before any
    // `io.on("connection", ...)` listener fires, and several of those
    // listeners (registered below) branch on `socket.data.role`.
    io.use((socket, next) => {
        socket.data.role = socket.handshake.query.role === "viewer" ? "viewer" : "primary";
        // The one place the client address is decided (PRD 18.2).
        socket.data.clientAddress = resolveClientAddress(
            socket.handshake.address,
            socket.handshake.headers,
            trustProxy.trust,
        );
        // Banned addresses (PRD 18.7). A Viewer window authenticates with a
        // ticket, never through USER_JOIN_SERVER, so it is refused right here.
        // A primary socket is only MARKED: the join decides, because the
        // designated admin must always be able to get in to undo a mistaken
        // range ban — and who is joining isn't known until then.
        socket.data.addressBanned = addressBans.isBanned(socket.data.clientAddress);
        if (socket.data.role === "viewer" && socket.data.addressBanned) {
            next(new Error("You are banned from this server"));
            return;
        }
        next();
    });

    // The gate every incoming event passes (PRD 18.8, services/packet-guard.ts):
    //   1. default-deny — a socket that has not signed in (this includes one
    //      waiting for approval) reaches nothing but the sign-in itself;
    //   2. every handler gets a payload (when it takes one) and an ack
    //      function whatever the sender emitted — a packet without a
    //      callback used to crash the whole process.
    io.on("connection", (socket) => {
        socket.use((packet, next) => {
            const event = packet[0];
            if (typeof event !== "string") return; // not an event of ours: drop it
            const listeners = (
                socket as unknown as { listeners(e: string): ((...a: never[]) => unknown)[] }
            ).listeners(event);
            const shapes = listeners.map(describeHandler);
            const shape = shapes.reduce(
                (best, s) => (s.arity > best.arity ? s : best),
                { arity: 0, ackFirst: false },
            );
            normalizePacket(packet, shape);
            if (requiresSignIn(event) && !(socket.data.userId && socket.data.serverId)) {
                const ack = packet[packet.length - 1];
                if (typeof ack === "function") (ack as (r: unknown) => void)({ success: false, error: "Not signed in" });
                return; // dropped: never reaches a handler
            }
            // Access to channels, DMs and voice (PRD 18.18): a signed-in user who
            // holds neither CONNECT nor ADMIN can't reach any "member" event. One
            // central check (services/access.service.ts classifies every event),
            // so no handler can forget it.
            if (requiresAccess(event) && !socket.data.hasAccess) {
                const ack = packet[packet.length - 1];
                if (typeof ack === "function") (ack as (r: unknown) => void)({ success: false, error: NO_ACCESS_MESSAGE });
                return;
            }
            next();
        });
    });

    // Register socket event handlers
    registerConnectionHandlers(io, app, mediasoupService);
    registerVoiceHandlers(io, app, mediasoupService);
    registerChannelHandlers(io, app);
    registerMessageHandlers(io, app);
    registerAdminHandlers(io, app, mediasoupService);
    registerDMHandlers(io, app);
    registerModerationHandlers(io, app, mediasoupService);
    registerReactionHandlers(io, app);
    registerEmojiHandlers(io, app);
    registerNudgeHandlers(io, app);
    registerUploadHandlers(io, app);
    registerProfileHandlers(io, app);
    registerApprovalHandlers(io, app);
    registerInviteHandlers(io, app);
    startUploadSweeper(app);
    startIdentityEventPruner(app);
    startApprovalPruner(app);

    // ── Start ──────────────────────────────────────────────────────────────
    try {
        await app.listen({ port: PORT, host: HOST });
        app.log.info(`🎧 Reson8 server listening on ${HOST}:${PORT}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }

    // Pick up renewed certificates without a restart (certbot/acme.sh).
    const stopTlsWatch = tlsFiles
        ? watchTlsFiles(
              tlsFiles,
              (material) => {
                  (app.server as unknown as HttpsServer).setSecureContext({ key: material.key, cert: material.cert });
                  app.log.info(`🔒 TLS certificate reloaded (${material.summary})`);
              },
              (err) => app.log.error({ err }, "TLS certificate reload failed — keeping the previous certificate"),
          )
        : null;

    // Graceful shutdown
    const shutdown = async (): Promise<void> => {
        app.log.info("Shutting down...");
        stopTlsWatch?.();
        mediasoupService.close();
        io.close();
        await app.close();
        process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

main().catch((err) => {
    // Pino isn't up yet for configuration errors (e.g. a half-set TLS pair).
    console.error("Reson8 server failed to start:", err instanceof Error ? err.message : err);
    process.exit(1);
});
