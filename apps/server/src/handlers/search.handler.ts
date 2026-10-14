/**
 * Search Handler (PRD 20 Q1) — full-text search over channel messages and DMs.
 * Handles: SEARCH_MESSAGES. The query only ever travels as a bound parameter.
 */
import type { Server as SocketIOServer, Socket } from "socket.io";
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import type {
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData,
    ISearchResult,
} from "@reson8/shared-types";
import { SEARCH_PAGE_SIZE, parseSearchPayload, shouldAllowSearch } from "../services/search.service.js";

type TypedIO = SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

interface Row {
    id: string;
    channelId: string | null;
    partnerId: string | null;
    authorId: string;
    authorNickname: string;
    createdAt: Date;
    snippet: string;
}

const HEADLINE = "MaxWords=24,MinWords=8,StartSel=<<,StopSel=>>";

export function registerSearchHandlers(io: TypedIO, app: FastifyInstance): void {
    io.on("connection", (socket: TypedSocket) => {
        let lastSearch: number | undefined;
        socket.on("SEARCH_MESSAGES", async (payload, ack) => {
            try {
                if (socket.data.role === "viewer" || !socket.data.userId || !socket.data.serverId) {
                    ack({ success: false, error: "Not signed in" });
                    return;
                }
                const req = parseSearchPayload(payload);
                if (!req) {
                    ack({ success: false, error: "Type at least 2 characters to search" });
                    return;
                }
                const now = Date.now();
                if (!shouldAllowSearch(lastSearch, now)) {
                    ack({ success: false, error: "Searching too fast — try again in a second" });
                    return;
                }
                lastSearch = now;

                const me = socket.data.userId;
                const serverId = socket.data.serverId;
                const limit = SEARCH_PAGE_SIZE + 1; // one extra row says whether there is another page
                const tsQuery = Prisma.sql`plainto_tsquery('simple', ${req.query})`;
                const beforeSql = req.before ? Prisma.sql`AND m."createdAt" < ${req.before}` : Prisma.empty;
                let rows: Row[];

                if (req.dmPartnerId) {
                    const partner = req.dmPartnerId;
                    const dmBefore = req.before ? Prisma.sql`AND m."createdAt" < ${req.before}` : Prisma.empty;
                    rows = await app.prisma.$queryRaw<Row[]>(Prisma.sql`
                        SELECT m.id, NULL::text AS "channelId", ${partner}::text AS "partnerId",
                               m."senderId" AS "authorId", u.nickname AS "authorNickname", m."createdAt",
                               ts_headline('simple', m.content, ${tsQuery}, ${HEADLINE}) AS snippet
                        FROM direct_messages m
                        JOIN users u ON u.id = m."senderId"
                        WHERE ((m."senderId" = ${me} AND m."receiverId" = ${partner})
                            OR (m."senderId" = ${partner} AND m."receiverId" = ${me}))
                          AND to_tsvector('simple', m.content) @@ ${tsQuery}
                          ${dmBefore}
                        ORDER BY m."createdAt" DESC, m.id DESC
                        LIMIT ${limit}`);
                } else {
                    const scope = req.channelId ? Prisma.sql`AND m."channelId" = ${req.channelId}` : Prisma.empty;
                    rows = await app.prisma.$queryRaw<Row[]>(Prisma.sql`
                        SELECT m.id, m."channelId", NULL::text AS "partnerId",
                               m."userId" AS "authorId", u.nickname AS "authorNickname", m."createdAt",
                               ts_headline('simple', m.content, ${tsQuery}, ${HEADLINE}) AS snippet
                        FROM messages m
                        JOIN channels c ON c.id = m."channelId"
                        JOIN users u ON u.id = m."userId"
                        WHERE c."serverId" = ${serverId}
                          AND c.type = 'TEXT'
                          ${scope}
                          AND to_tsvector('simple', m.content) @@ ${tsQuery}
                          ${beforeSql}
                        ORDER BY m."createdAt" DESC, m.id DESC
                        LIMIT ${limit}`);
                }

                const hasMore = rows.length > SEARCH_PAGE_SIZE;
                const results: ISearchResult[] = rows.slice(0, SEARCH_PAGE_SIZE).map((r) => ({
                    id: r.id,
                    ...(r.channelId ? { channelId: r.channelId } : {}),
                    ...(r.partnerId ? { dmPartnerId: r.partnerId } : {}),
                    authorId: r.authorId,
                    authorNickname: r.authorNickname,
                    createdAt: r.createdAt.toISOString(),
                    snippet: r.snippet,
                }));
                ack({ success: true, results, hasMore });
            } catch (err) {
                app.log.error({ err }, "Error in SEARCH_MESSAGES");
                ack({ success: false, error: "Search failed" });
            }
        });
    });
}
