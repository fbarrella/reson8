/**
 * Voice Handler — WebRTC signaling for mediasoup.
 *
 * Handles the 6-step handshake between client and server:
 * 1. GET_ROUTER_CAPABILITIES
 * 2. CREATE_WEBRTC_TRANSPORT (send + recv)
 * 3. CONNECT_TRANSPORT
 * 4. PRODUCE
 * 5. CONSUME
 * 6. RESUME_CONSUMER
 *
 * Also handles CLOSE_PRODUCER for mute.
 */

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
    IUserPresence,
} from "@reson8/shared-types";
import type { MediasoupService } from "../services/mediasoup.service.js";
import { PresenceService } from "../services/presence.service.js";
import { buildOccupant, voiceSessionStartedAt, getMediasoupSessionKey } from "./connection.handler.js";

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

/**
 * Registers WebRTC voice signaling handlers on each socket connection.
 */
export function registerVoiceHandlers(
    io: TypedIO,
    app: FastifyInstance,
    mediasoup: MediasoupService,
): void {
    const presence = new PresenceService(app.redis);

    // A crashed mediasoup Worker no longer takes the whole server down (see
    // MediasoupService.handleWorkerDeath) — instead it reports exactly which
    // channels were hosted on it, so only those occupants are told to
    // rejoin voice, everyone else is unaffected.
    mediasoup.on("workerDied", ({ channelIds }: { channelIds: string[] }) => {
        for (const channelId of channelIds) {
            io.to(`channel:${channelId}`).emit("VOICE_SESSION_LOST", {
                channelId,
                reason: "server-worker-restart",
            });
        }
        app.log.warn({ channelIds }, "mediasoup worker died — notified affected channels");
    });

    io.on("connection", (socket: TypedSocket) => {
        // ── 1. GET_ROUTER_CAPABILITIES ──────────────────────────────────────
        socket.on("GET_ROUTER_CAPABILITIES", async (payload, ack) => {
            try {
                const { channelId } = payload;
                const router = await mediasoup.getOrCreateRouter(channelId);

                ack({
                    success: true,
                    rtpCapabilities: router.rtpCapabilities,
                });

                app.log.info(
                    { socketId: socket.id, channelId },
                    "Sent router capabilities",
                );
            } catch (err) {
                app.log.error({ err }, "Error in GET_ROUTER_CAPABILITIES");
                ack({ success: false, error: "Failed to get router capabilities" });
            }
        });

        // ── 2. CREATE_WEBRTC_TRANSPORT ──────────────────────────────────────
        socket.on("CREATE_WEBRTC_TRANSPORT", async (payload, ack) => {
            try {
                const { channelId, direction } = payload;
                const router = await mediasoup.getOrCreateRouter(channelId);
                const transport = await mediasoup.createWebRtcTransport(router);

                // Store transport in user session — keyed by the resolved
                // session key (PRD 12.13), not raw `socket.data.userId`, so
                // a Viewer window's recv-only transport gets its own slot
                // instead of colliding with this same user's primary
                // connection (see `getMediasoupSessionKey`'s doc comment).
                const session = mediasoup.getOrCreateSession(
                    channelId,
                    getMediasoupSessionKey(socket),
                );
                if (direction === "send") {
                    session.sendTransport = transport;
                } else {
                    session.recvTransport = transport;
                }

                // Build ICE servers list (optional — only when TURN is configured)
                let iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> | undefined;
                if (process.env.TURN_URL) {
                    iceServers = [
                        { urls: process.env.TURN_URL },
                    ];
                    if (process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
                        iceServers[0].username = process.env.TURN_USERNAME;
                        iceServers[0].credential = process.env.TURN_CREDENTIAL;
                    }
                }

                ack({
                    success: true,
                    transport: {
                        id: transport.id,
                        iceParameters: transport.iceParameters,
                        iceCandidates: transport.iceCandidates,
                        dtlsParameters: transport.dtlsParameters,
                    },
                    ...(iceServers ? { iceServers } : {}),
                });

                app.log.info(
                    { socketId: socket.id, channelId, direction, transportId: transport.id },
                    "WebRTC transport created",
                );
            } catch (err) {
                app.log.error({ err }, "Error in CREATE_WEBRTC_TRANSPORT");
                ack({ success: false, error: "Failed to create transport" });
            }
        });

        // ── 3. CONNECT_TRANSPORT ────────────────────────────────────────────
        socket.on("CONNECT_TRANSPORT", async (payload, ack) => {
            try {
                const { transportId, dtlsParameters } = payload;
                const channelId = socket.data.currentChannelId;
                if (!channelId) {
                    ack({ success: false, error: "Not in a channel" });
                    return;
                }

                const session = mediasoup.getSession(channelId, getMediasoupSessionKey(socket));
                if (!session) {
                    ack({ success: false, error: "No voice session" });
                    return;
                }

                // Find which transport matches the ID
                const transport =
                    session.sendTransport?.id === transportId
                        ? session.sendTransport
                        : session.recvTransport?.id === transportId
                            ? session.recvTransport
                            : null;

                if (!transport) {
                    ack({ success: false, error: "Transport not found" });
                    return;
                }

                await transport.connect({ dtlsParameters });
                ack({ success: true });

                app.log.info(
                    { socketId: socket.id, transportId },
                    "Transport connected",
                );
            } catch (err) {
                app.log.error({ err }, "Error in CONNECT_TRANSPORT");
                ack({ success: false, error: "Failed to connect transport" });
            }
        });

        // ── 4. PRODUCE ──────────────────────────────────────────────────────
        socket.on("PRODUCE", async (payload, ack) => {
            try {
                const { transportId, kind, rtpParameters, appData } = payload;
                const mediaType = appData?.mediaType; // undefined = mic (PRD 12.7/12.8)
                const channelId = socket.data.currentChannelId;
                if (!channelId) {
                    ack({ success: false, error: "Not in a channel" });
                    return;
                }

                const session = mediasoup.getSession(channelId, getMediasoupSessionKey(socket));
                if (!session?.sendTransport || session.sendTransport.id !== transportId) {
                    ack({ success: false, error: "Send transport not found" });
                    return;
                }

                const producer = await session.sendTransport.produce({
                    kind,
                    rtpParameters,
                    appData,
                });

                // Mic, screen-video, and screen-audio are three independent
                // Producers that can all be active at once — each gets its
                // own session slot, not a single shared `producer` field
                // that the second/third `PRODUCE` call would silently
                // overwrite (PRD 12.8).
                let sessionField: "producer" | "screenVideoProducer" | "screenAudioProducer";
                if (mediaType === "screen-video") sessionField = "screenVideoProducer";
                else if (mediaType === "screen-audio") sessionField = "screenAudioProducer";
                else sessionField = "producer";
                session[sessionField] = producer;

                // Handle producer close — this fires for any transport-level
                // close, not just the explicit CLOSE_PRODUCER/leave/kick
                // paths (e.g. an unrecovered ICE drop closing the transport,
                // see mediasoup.service.ts's icestatechange handling), so
                // peers must be notified here too or they're left holding a
                // consumer for audio that no longer exists (PRD 11.1).
                producer.on("transportclose", () => {
                    if (session[sessionField] === producer) session[sessionField] = null;
                    socket.to(`channel:${channelId}`).emit("PRODUCER_CLOSED", {
                        userId: socket.data.userId,
                        producerId: producer.id,
                    });
                });

                // AudioLevelObserver drives the active-speaker indicator —
                // mic only. Screen-share audio (someone's video/music) must
                // never trigger "speaking", and video obviously never can.
                if (mediaType === undefined && kind === "audio") {
                    try {
                        await mediasoup.getOrCreateAudioLevelObserver(
                            channelId,
                            (volumes) => {
                                // Map producerIds to userIds
                                const speakers: string[] = [];
                                for (const v of volumes) {
                                    const uid = mediasoup.getUserIdByProducerId(channelId, v.producerId);
                                    if (uid) speakers.push(uid);
                                }
                                io.to(`channel:${channelId}`).emit("ACTIVE_SPEAKERS", {
                                    channelId,
                                    speakers,
                                });
                            },
                            () => {
                                // Silence — no speakers
                                io.to(`channel:${channelId}`).emit("ACTIVE_SPEAKERS", {
                                    channelId,
                                    speakers: [],
                                });
                            },
                        );
                        await mediasoup.addProducerToObserver(channelId, producer);
                    } catch (observerErr) {
                        app.log.warn({ err: observerErr }, "Failed to setup AudioLevelObserver");
                    }
                }

                // Notify other users in the channel about the new producer.
                // `mediaType` tells clients whether to auto-consume (mic) or
                // leave it for an explicit viewer action (screen share).
                socket.to(`channel:${channelId}`).emit("NEW_PRODUCER", {
                    userId: socket.data.userId,
                    nickname: socket.data.nickname,
                    producerId: producer.id,
                    mediaType,
                });

                ack({ success: true, producerId: producer.id });

                app.log.info(
                    { socketId: socket.id, channelId, producerId: producer.id, kind, mediaType },
                    "User started producing",
                );
            } catch (err) {
                app.log.error({ err }, "Error in PRODUCE");
                ack({ success: false, error: "Failed to produce" });
            }
        });

        // ── 5. CONSUME ──────────────────────────────────────────────────────
        socket.on("CONSUME", async (payload, ack) => {
            try {
                const { producerId, rtpCapabilities } = payload;
                const channelId = socket.data.currentChannelId;
                if (!channelId) {
                    ack({ success: false, error: "Not in a channel" });
                    return;
                }

                const router = mediasoup.getRouter(channelId);
                const session = mediasoup.getSession(channelId, getMediasoupSessionKey(socket));
                if (!router || !session?.recvTransport) {
                    ack({ success: false, error: "Recv transport not ready" });
                    return;
                }

                // Check if we can consume this producer
                if (
                    !router.canConsume({
                        producerId,
                        rtpCapabilities: rtpCapabilities || router.rtpCapabilities,
                    })
                ) {
                    ack({ success: false, error: "Cannot consume producer" });
                    return;
                }

                const consumer = await session.recvTransport.consume({
                    producerId,
                    rtpCapabilities: rtpCapabilities || router.rtpCapabilities,
                    paused: true, // Start paused, client will resume after setup
                });

                session.consumers.set(consumer.id, consumer);

                // Clean up when consumer closes
                consumer.on("transportclose", () => {
                    session.consumers.delete(consumer.id);
                });
                consumer.on("producerclose", () => {
                    session.consumers.delete(consumer.id);
                    // Notify the client that the producer they were consuming is gone
                    socket.emit("PRODUCER_CLOSED", {
                        userId: "", // We don't know who the producer belonged to here
                        producerId,
                    });
                });

                ack({
                    success: true,
                    consumer: {
                        id: consumer.id,
                        producerId: consumer.producerId,
                        kind: consumer.kind,
                        rtpParameters: consumer.rtpParameters,
                    },
                });

                app.log.info(
                    { socketId: socket.id, consumerId: consumer.id, producerId },
                    "User consuming producer",
                );
            } catch (err) {
                app.log.error({ err }, "Error in CONSUME");
                ack({ success: false, error: "Failed to consume" });
            }
        });

        // ── 6. RESUME_CONSUMER ──────────────────────────────────────────────
        socket.on("RESUME_CONSUMER", async (payload, ack) => {
            try {
                const { consumerId } = payload;
                const channelId = socket.data.currentChannelId;
                if (!channelId) {
                    ack({ success: false, error: "Not in a channel" });
                    return;
                }

                const session = mediasoup.getSession(channelId, getMediasoupSessionKey(socket));
                const consumer = session?.consumers.get(consumerId);
                if (!consumer) {
                    ack({ success: false, error: "Consumer not found" });
                    return;
                }

                await consumer.resume();
                ack({ success: true });

                app.log.info(
                    { socketId: socket.id, consumerId },
                    "Consumer resumed",
                );
            } catch (err) {
                app.log.error({ err }, "Error in RESUME_CONSUMER");
                ack({ success: false, error: "Failed to resume consumer" });
            }
        });

        // ── CLOSE_PRODUCER ──────────────────────────────────────────────────
        // Checks all three of a session's independent Producer slots (mic,
        // screen-video, screen-audio — see PRODUCE's own `sessionField`
        // logic above), not just mic. This used to only ever match the mic
        // producer, so a client closing its screen-video/screen-audio
        // Producer here silently no-opped — the server-side Producer
        // stayed open until the whole Transport eventually closed (full
        // voice disconnect), leaving viewers to find out a share had ended
        // far later than the sharer actually stopped it.
        socket.on("CLOSE_PRODUCER", (payload) => {
            try {
                const { producerId } = payload;
                const channelId = socket.data.currentChannelId;
                if (!channelId) return;

                const session = mediasoup.getSession(channelId, getMediasoupSessionKey(socket));
                if (!session) return;

                let sessionField: "producer" | "screenVideoProducer" | "screenAudioProducer" | null = null;
                if (session.producer?.id === producerId) sessionField = "producer";
                else if (session.screenVideoProducer?.id === producerId) sessionField = "screenVideoProducer";
                else if (session.screenAudioProducer?.id === producerId) sessionField = "screenAudioProducer";
                if (!sessionField) return;

                session[sessionField]!.close();
                session[sessionField] = null;

                // Notify other users
                socket.to(`channel:${channelId}`).emit("PRODUCER_CLOSED", {
                    userId: socket.data.userId,
                    producerId,
                });

                app.log.info({ socketId: socket.id, producerId, sessionField }, "Producer closed");
            } catch (err) {
                app.log.error({ err }, "Error in CLOSE_PRODUCER");
            }
        });

        // ── SET_VOICE_STATE ───────────────────────────────────────────────
        socket.on("SET_VOICE_STATE", async (payload, ack) => {
            try {
                const { isMuted, isDeafened } = payload;
                const userId = socket.data.userId;
                const channelId = socket.data.currentChannelId;

                await presence.setVoiceState(userId, isMuted, isDeafened);

                if (channelId) {
                    const occupantIds = await presence.getChannelOccupants(channelId);
                    const occupants: IUserPresence[] = await Promise.all(
                        occupantIds.map((uid) => buildOccupant(uid, presence, app.prisma)),
                    );

                    io.to(`server:${socket.data.serverId}`).emit("PRESENCE_UPDATE", {
                        channelId,
                        occupants,
                        sessionStartedAt: voiceSessionStartedAt.get(channelId)?.toISOString(),
                    });
                }

                ack({ success: true });
            } catch (err) {
                app.log.error({ err }, "Error in SET_VOICE_STATE");
                ack({ success: false });
            }
        });

        // ── SET_SCREEN_SHARE_STATE (PRD 12.12) ──────────────────────────────
        socket.on("SET_SCREEN_SHARE_STATE", async (payload, ack) => {
            try {
                let { isSharingScreen, streamName } = payload;
                const userId = socket.data.userId;
                const channelId = socket.data.currentChannelId;

                // Defense in depth (never trust client-only gating) — same
                // pattern as nudge.handler.ts checking `nudgeEnabled`
                // server-side even though the client already hides/disables
                // the button when disabled (PRD 12.14). This call is
                // fire-and-forget from the client (`preload.ts`'s
                // `setScreenShareState` ignores its ack), so there's nothing
                // useful to reject with an error — coercing to `false`
                // instead just means the presence flag (and therefore the
                // sharing badge) never turns on, and `WATCH_SCREEN_SHARE`
                // below independently refuses to let anyone actually consume
                // the stream either way.
                if (isSharingScreen) {
                    const server = await app.prisma.server.findUnique({
                        where: { id: socket.data.serverId },
                        select: { screenShareEnabled: true },
                    });
                    if (!server?.screenShareEnabled) {
                        isSharingScreen = false;
                    }
                }

                await presence.setScreenShareState(userId, isSharingScreen, streamName);

                if (channelId) {
                    const occupantIds = await presence.getChannelOccupants(channelId);
                    const occupants: IUserPresence[] = await Promise.all(
                        occupantIds.map((uid) => buildOccupant(uid, presence, app.prisma)),
                    );

                    io.to(`server:${socket.data.serverId}`).emit("PRESENCE_UPDATE", {
                        channelId,
                        occupants,
                        sessionStartedAt: voiceSessionStartedAt.get(channelId)?.toISOString(),
                    });
                }

                ack({ success: true });
            } catch (err) {
                app.log.error({ err }, "Error in SET_SCREEN_SHARE_STATE");
                ack({ success: false, error: "Failed to update screen share state" });
            }
        });

        // ── WATCH_SCREEN_SHARE (PRD 12.13) ──────────────────────────────────
        // Called only from a Viewer window's own "viewer"-role socket, after
        // VIEWER_AUTHENTICATE. Deliberately does not require
        // `socket.data.role === "viewer"` — a primary socket calling this
        // would just open a second, redundant recv-only session under its
        // real userId, which is wasteful but not unsafe, so it isn't worth
        // guarding against.
        socket.on("WATCH_SCREEN_SHARE", async (payload, ack) => {
            try {
                const { targetUserId, channelId } = payload;

                // Defense in depth (PRD 12.14) — even if a producer somehow
                // exists (e.g. a modified client bypassed its disabled Share
                // Screen button), nobody can actually consume it once the
                // server-wide toggle is off. This is the real enforcement
                // point: `SET_SCREEN_SHARE_STATE` above only gates the
                // presence flag/badge, not producing itself.
                const server = await app.prisma.server.findUnique({
                    where: { id: socket.data.serverId },
                    select: { screenShareEnabled: true },
                });
                if (!server?.screenShareEnabled) {
                    ack({ success: false, error: "Screen sharing is disabled on this server" });
                    return;
                }

                // Caller must currently be an occupant of this channel —
                // this is the actual access control for screen sharing
                // (anyone in the room can watch); it's also what keeps a
                // banned/kicked user from reaching this via a fresh viewer
                // socket, since VIEWER_AUTHENTICATE itself has no ban check.
                const occupantIds = await presence.getChannelOccupants(channelId);
                if (!occupantIds.includes(socket.data.userId)) {
                    ack({ success: false, error: "You must be in this channel to watch a share" });
                    return;
                }

                // Target must currently be sharing in this same channel —
                // handles the race where a share ends between the badge
                // rendering and this call.
                const targetSession = mediasoup.getSession(channelId, targetUserId);
                if (!targetSession?.screenVideoProducer) {
                    ack({ success: false, error: "This user is not currently sharing their screen" });
                    return;
                }

                const router = mediasoup.getRouter(channelId);
                if (!router) {
                    ack({ success: false, error: "No active voice session in this channel" });
                    return;
                }

                // Scopes this socket to the channel so the existing
                // CREATE_WEBRTC_TRANSPORT/CONNECT_TRANSPORT/CONSUME/
                // RESUME_CONSUMER handlers' `socket.data.currentChannelId`
                // checks pass — without going through USER_JOIN_CHANNEL,
                // which would touch presence/rooms/broadcasts this viewer
                // socket must stay invisible to.
                socket.data.currentChannelId = channelId;

                const targetPresence = await presence.getUserPresence(targetUserId);

                ack({
                    success: true,
                    rtpCapabilities: router.rtpCapabilities,
                    screenVideoProducerId: targetSession.screenVideoProducer.id,
                    screenAudioProducerId: targetSession.screenAudioProducer?.id,
                    streamName: targetPresence?.screenShareName || undefined,
                });

                app.log.info(
                    { socketId: socket.id, role: "viewer", targetUserId, channelId },
                    "Viewer started watching screen share",
                );
            } catch (err) {
                app.log.error({ err }, "Error in WATCH_SCREEN_SHARE");
                ack({ success: false, error: "Failed to start watching screen share" });
            }
        });

        // ── STOP_WATCHING_SCREEN_SHARE (PRD 12.13) ──────────────────────────
        // "Leave Stream" / window-close cleanup — closes only this viewer
        // socket's own recv-only session, keyed by `socket.id`. The primary
        // `disconnect` handler's `role === "viewer"` branch in
        // connection.handler.ts does the same thing if the window is closed
        // without this ever firing (e.g. a crash), so this isn't the only
        // path to correct cleanup, just the clean one.
        socket.on("STOP_WATCHING_SCREEN_SHARE", (payload, ack) => {
            try {
                const { channelId } = payload;
                mediasoup.cleanupUserSession(channelId, getMediasoupSessionKey(socket));
                socket.data.currentChannelId = null;
                ack({ success: true });
            } catch (err) {
                app.log.error({ err }, "Error in STOP_WATCHING_SCREEN_SHARE");
                ack({ success: false });
            }
        });
    });
}
