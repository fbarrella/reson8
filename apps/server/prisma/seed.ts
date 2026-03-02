/**
 * Prisma Seed — Creates default channels and roles for the Reson8 server.
 *
 * Only runs when SEED_DEFAULT_TEMPLATE=true (set in .env or docker-compose).
 * The server record itself is auto-created by index.ts on startup,
 * so this script only seeds template content (channels, roles).
 *
 * Idempotent: uses upsert so re-running is safe.
 * Run via: npx prisma db seed
 */

import "dotenv/config";
import { PrismaClient, ChannelType } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
    // ── Check opt-in flag ────────────────────────────────────────────────
    if (process.env.SEED_DEFAULT_TEMPLATE !== "true") {
        console.log("⏭️  SEED_DEFAULT_TEMPLATE is not 'true' — skipping seed.");
        return;
    }

    console.log("🌱 Seeding default template...");

    // ── Resolve the server ID from the existing record ──────────────────
    const server = await prisma.server.findFirst();
    if (!server) {
        console.log("⚠️  No server record found. Start the server first to auto-create it.");
        return;
    }

    const serverId = server.id;
    console.log(`  📡 Using server: ${server.name} (${serverId})`);

    // ── Channels ──────────────────────────────────────────────────────────
    // Category: General
    const general = await prisma.channel.upsert({
        where: { id: "chan-general" },
        update: {},
        create: {
            id: "chan-general",
            serverId,
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
            serverId,
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
            serverId,
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
            serverId,
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
            serverId,
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
            serverId,
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
            serverId,
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
            serverId,
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
