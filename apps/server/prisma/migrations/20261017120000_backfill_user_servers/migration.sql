-- PRD 18.17: user_servers existed but was never written. User Management lists
-- members from it, so every user who has ever been part of a server needs a row.
-- Idempotent (ON CONFLICT DO NOTHING) and set-based (no per-row loops), so it is
-- safe to run on upgrade and to run twice. joinedAt = the earliest sign of the
-- user on that server that we can still see.

INSERT INTO "user_servers" ("userId", "serverId", "joinedAt")
SELECT x."userId", x."serverId", MIN(x."seen")
FROM (
    -- holds (or held) a role on the server
    SELECT ur."userId", r."serverId", u."createdAt" AS "seen"
    FROM "user_roles" ur
    JOIN "roles" r ON r."id" = ur."roleId"
    JOIN "users" u ON u."id" = ur."userId"
    UNION ALL
    -- wrote a message in one of its channels
    SELECT m."userId", c."serverId", m."createdAt"
    FROM "messages" m
    JOIN "channels" c ON c."id" = m."channelId"
    JOIN "users" u ON u."id" = m."userId"
    UNION ALL
    -- has a read cursor in one of its channels
    SELECT cr."userId", c."serverId", cr."lastReadAt"
    FROM "channel_reads" cr
    JOIN "channels" c ON c."id" = cr."channelId"
    JOIN "users" u ON u."id" = cr."userId"
    UNION ALL
    -- was banned from it
    SELECT b."userId", b."serverId", b."bannedAt"
    FROM "banned_users" b
    JOIN "users" u ON u."id" = b."userId"
    JOIN "servers" s ON s."id" = b."serverId"
    UNION ALL
    -- reacted to one of its messages
    SELECT rx."userId", c."serverId", rx."createdAt"
    FROM "reactions" rx
    JOIN "messages" m ON m."id" = rx."messageId"
    JOIN "channels" c ON c."id" = m."channelId"
    JOIN "users" u ON u."id" = rx."userId"
) x
GROUP BY x."userId", x."serverId"
ON CONFLICT DO NOTHING;
