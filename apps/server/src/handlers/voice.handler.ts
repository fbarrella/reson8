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
} from "@reson8/shared-types";
import type { MediasoupService } from "../services/mediasoup.service.js";

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

                // Store transport in user session
                const session = mediasoup.getOrCreateSession(
                    channelId,
                    socket.data.userId,
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

                const session = mediasoup.getSession(channelId, socket.data.userId);
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
                const { transportId, kind, rtpParameters } = payload;
                const channelId = socket.data.currentChannelId;
                if (!channelId) {
                    ack({ success: false, error: "Not in a channel" });
                    return;
                }

                const session = mediasoup.getSession(channelId, socket.data.userId);
                if (!session?.sendTransport || session.sendTransport.id !== transportId) {
                    ack({ success: false, error: "Send transport not found" });
                    return;
                }

                const producer = await session.sendTransport.produce({
                    kind,
                    rtpParameters,
                });

                session.producer = producer;

                // Handle producer close
                producer.on("transportclose", () => {
                    session.producer = null;
                });

                // Notify other users in the channel about the new producer
                socket.to(`channel:${channelId}`).emit("NEW_PRODUCER", {
                    userId: socket.data.userId,
                    nickname: socket.data.nickname,
                    producerId: producer.id,
                });

                ack({ success: true, producerId: producer.id });

                app.log.info(
                    { socketId: socket.id, channelId, producerId: producer.id },
                    "User started producing audio",
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
                const session = mediasoup.getSession(channelId, socket.data.userId);
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

                const session = mediasoup.getSession(channelId, socket.data.userId);
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
        socket.on("CLOSE_PRODUCER", (payload) => {
            try {
                const { producerId } = payload;
                const channelId = socket.data.currentChannelId;
                if (!channelId) return;

                const session = mediasoup.getSession(channelId, socket.data.userId);
                if (session?.producer?.id === producerId) {
                    session.producer.close();
                    session.producer = null;

                    // Notify other users
                    socket.to(`channel:${channelId}`).emit("PRODUCER_CLOSED", {
                        userId: socket.data.userId,
                        producerId,
                    });

                    app.log.info(
                        { socketId: socket.id, producerId },
                        "Producer closed (muted)",
                    );
                }
            } catch (err) {
                app.log.error({ err }, "Error in CLOSE_PRODUCER");
            }
        });
    });
}
