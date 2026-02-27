/**
 * Prisma Seed — Creates a default Reson8 server with starter channels.
 *
 * Idempotent: uses upsert so re-running is safe.
 * Run via: npx prisma db seed
 */

import { PrismaClient, ChannelType } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_SERVER_ID = "00000000-0000-0000-0000-000000000001";

async function main(): Promise<void> {
    console.log("🌱 Seeding database...");

    // ── Default Server ────────────────────────────────────────────────────
    const server = await prisma.server.upsert({
        where: { id: DEFAULT_SERVER_ID },
        update: {},
        create: {
            id: DEFAULT_SERVER_ID,
            name: "Reson8 Server",
            address: "localhost:9800",
            maxClients: 32,
        },
    });
    console.log(`  ✅ Server: ${server.name}`);

    // ── Channels ──────────────────────────────────────────────────────────
    // Category: General
    const general = await prisma.channel.upsert({
        where: { id: "chan-general" },
        update: {},
        create: {
            id: "chan-general",
            serverId: DEFAULT_SERVER_ID,
            name: "General",
            type: ChannelType.VOICE, // Categories are voice type with children
            parentId: null,
            position: 0,
        },
    });

    await prisma.channel.upsert({
        where: { id: "chan-lobby" },
        update: {},
        create: {
            id: "chan-lobby",
            serverId: DEFAULT_SERVER_ID,
            name: "Lobby",
            type: ChannelType.VOICE,
            parentId: general.id,
            position: 0,
        },
    });

    await prisma.channel.upsert({
        where: { id: "chan-chat" },
        update: {},
        create: {
            id: "chan-chat",
            serverId: DEFAULT_SERVER_ID,
            name: "Chat",
            type: ChannelType.TEXT,
            parentId: general.id,
            position: 1,
        },
    });

    // Category: Gaming
    const gaming = await prisma.channel.upsert({
        where: { id: "chan-gaming" },
        update: {},
        create: {
            id: "chan-gaming",
            serverId: DEFAULT_SERVER_ID,
            name: "Gaming",
            type: ChannelType.VOICE,
            parentId: null,
            position: 1,
        },
    });

    await prisma.channel.upsert({
        where: { id: "chan-game-room-1" },
        update: {},
        create: {
            id: "chan-game-room-1",
            serverId: DEFAULT_SERVER_ID,
            name: "Game Room 1",
            type: ChannelType.VOICE,
            parentId: gaming.id,
            position: 0,
        },
    });

    await prisma.channel.upsert({
        where: { id: "chan-game-room-2" },
        update: {},
        create: {
            id: "chan-game-room-2",
            serverId: DEFAULT_SERVER_ID,
            name: "Game Room 2",
            type: ChannelType.VOICE,
            parentId: gaming.id,
            position: 1,
        },
    });

    console.log("  ✅ Channels: General (Lobby, Chat), Gaming (Game Room 1, Game Room 2)");

    // ── Default Role ──────────────────────────────────────────────────────
    await prisma.role.upsert({
        where: { id: "role-default" },
        update: {},
        create: {
            id: "role-default",
            serverId: DEFAULT_SERVER_ID,
            name: "Member",
            permissions: BigInt(0b111), // CONNECT | SPEAK | SEND_MESSAGES
            powerLevel: 0,
            color: "#888888",
        },
    });

    await prisma.role.upsert({
        where: { id: "role-admin" },
        update: {},
        create: {
            id: "role-admin",
            serverId: DEFAULT_SERVER_ID,
            name: "Server Admin",
            permissions: BigInt(0b111111111), // All permissions
            powerLevel: 100,
            color: "#FF5733",
        },
    });

    console.log("  ✅ Roles: Member, Server Admin");
    console.log("🌱 Seeding complete!");
}

main()
    .catch((e) => {
        console.error("❌ Seed failed:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
