/**
 * Prisma Plugin — decorates the Fastify instance with a PrismaClient singleton.
 *
 * Usage: `app.prisma.user.findMany()`
 */

import fp from "fastify-plugin";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
    interface FastifyInstance {
        prisma: PrismaClient;
    }
}

export const prismaPlugin = fp(async (app: FastifyInstance) => {
    const prisma = new PrismaClient({
        log:
            process.env.NODE_ENV === "development"
                ? ["query", "info", "warn", "error"]
                : ["error"],
    });

    await prisma.$connect();
    app.log.info("📦 Prisma connected to database");

    app.decorate("prisma", prisma);

    app.addHook("onClose", async () => {
        await prisma.$disconnect();
        app.log.info("📦 Prisma disconnected");
    });
});
