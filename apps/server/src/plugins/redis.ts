/**
 * Redis Plugin — decorates the Fastify instance with an ioredis client singleton.
 *
 * Usage: `app.redis.get("key")`
 */

import fp from "fastify-plugin";
import { Redis } from "ioredis";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
    interface FastifyInstance {
        redis: Redis;
    }
}

export const redisPlugin = fp(async (app: FastifyInstance) => {
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    const redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => Math.min(times * 200, 2000),
    });

    redis.on("connect", () => {
        app.log.info("🔴 Redis connected");
    });

    redis.on("error", (err: Error) => {
        app.log.error({ err }, "Redis connection error");
    });

    app.decorate("redis", redis);

    app.addHook("onClose", async () => {
        redis.disconnect();
        app.log.info("🔴 Redis disconnected");
    });
});
