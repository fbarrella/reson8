import { afterEach, describe, expect, it } from "vitest";
import {
    IDENTITY_EVENT_RETENTION_DAYS,
    REFUSALS_PER_ADDRESS_PER_HOUR,
    buildEventsPage,
    countUnprotectedActiveUsers,
    parseIdentityEventsQuery,
    pruneIdentityEvents,
    recordIdentityEvent,
    refusalDedupeKey,
} from "../services/identity-events.service.js";
import {
    requireSignedIdentity,
    requireSignedLockedByEnv,
    resolveRequireSigned,
    setDbRequireSigned,
} from "../config/identity.config.js";

describe("refusalDedupeKey", () => {
    const base = { serverId: "s", userId: "u", reason: "otherDevice", fingerprint: "SHA256:abc", address: "203.0.113.5" };

    it("is stable for the same refusal", () => {
        expect(refusalDedupeKey(base)).toBe(refusalDedupeKey({ ...base }));
        expect(refusalDedupeKey(base)).toMatch(/^idev:refused:[0-9a-f]{32}$/);
    });

    it("changes with every field that makes a refusal 'different'", () => {
        const k = refusalDedupeKey(base);
        for (const change of [
            { serverId: "s2" },
            { userId: "u2" },
            { reason: "hostNotAllowed" },
            { fingerprint: "SHA256:def" },
            { address: "203.0.113.6" },
        ]) {
            expect(refusalDedupeKey({ ...base, ...change })).not.toBe(k);
        }
    });

    it("treats a missing optional field like null", () => {
        expect(refusalDedupeKey({ serverId: "s", userId: "u" })).toBe(
            refusalDedupeKey({ serverId: "s", userId: "u", reason: null, fingerprint: null, address: null }),
        );
    });

    it("can't be confused by values that merely concatenate the same way", () => {
        expect(refusalDedupeKey({ serverId: "ab", userId: "c" })).not.toBe(refusalDedupeKey({ serverId: "a", userId: "bc" }));
    });
});

describe("parseIdentityEventsQuery", () => {
    it("defaults to 50 with no filters", () => {
        expect(parseIdentityEventsQuery(undefined)).toEqual({
            ok: true,
            value: { userId: undefined, before: undefined, limit: 50 },
        });
        expect(parseIdentityEventsQuery({})).toMatchObject({ ok: true, value: { limit: 50 } });
    });

    it("accepts a user filter, a cursor and a limit", () => {
        const r = parseIdentityEventsQuery({ userId: "abc", before: "2026-10-10T12:00:00.000Z", limit: 20 });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.value.userId).toBe("abc");
            expect(r.value.before?.toISOString()).toBe("2026-10-10T12:00:00.000Z");
            expect(r.value.limit).toBe(20);
        }
    });

    it.each([0, 101, 1.5, -1, "5", null, NaN])("rejects limit %s", (limit) => {
        expect(parseIdentityEventsQuery({ limit }).ok).toBe(false);
    });

    it("accepts the bounds 1 and 100", () => {
        expect(parseIdentityEventsQuery({ limit: 1 }).ok).toBe(true);
        expect(parseIdentityEventsQuery({ limit: 100 }).ok).toBe(true);
    });

    it("rejects a bad user id or cursor", () => {
        expect(parseIdentityEventsQuery({ userId: "" }).ok).toBe(false);
        expect(parseIdentityEventsQuery({ userId: "x".repeat(129) }).ok).toBe(false);
        expect(parseIdentityEventsQuery({ userId: 5 }).ok).toBe(false);
        expect(parseIdentityEventsQuery({ before: "not a date" }).ok).toBe(false);
        expect(parseIdentityEventsQuery({ before: 12345 }).ok).toBe(false);
    });
});

describe("buildEventsPage", () => {
    const row = (n: number, over: Record<string, unknown> = {}) => ({
        id: `e${n}`,
        userId: "u1",
        nickname: "Old Nick",
        kind: "BOUND" as const,
        reason: null,
        fingerprint: "SHA256:aaa",
        address: "203.0.113.5",
        host: "chat.example.com",
        actorId: null,
        createdAt: new Date(Date.UTC(2026, 9, 10, 12, n)),
        ...over,
    });
    const lookups = (nick: Record<string, string>, privileged: string[] = []) => ({
        nicknames: new Map(Object.entries(nick)),
        privilegedIds: new Set(privileged),
    });

    it("trims the extra row into hasMore", () => {
        const rows = [row(3), row(2), row(1)];
        const page = buildEventsPage(rows, 2, lookups({}));
        expect(page.events.map((e) => e.id)).toEqual(["e3", "e2"]);
        expect(page.hasMore).toBe(true);
        expect(buildEventsPage(rows, 3, lookups({})).hasMore).toBe(false);
    });

    it("shows the current nickname only when it differs", () => {
        expect(buildEventsPage([row(1)], 10, lookups({ u1: "New Nick" })).events[0].currentNickname).toBe("New Nick");
        expect(buildEventsPage([row(1)], 10, lookups({ u1: "Old Nick" })).events[0].currentNickname).toBeUndefined();
        expect(buildEventsPage([row(1)], 10, lookups({})).events[0].currentNickname).toBeUndefined();
    });

    it("names the admin who did a reset (or null when that user is gone)", () => {
        const reset = row(1, { kind: "RESET", actorId: "admin1" });
        expect(buildEventsPage([reset], 10, lookups({ admin1: "Alice" })).events[0].actorNickname).toBe("Alice");
        expect(buildEventsPage([reset], 10, lookups({})).events[0].actorNickname).toBeNull();
        expect(buildEventsPage([row(1)], 10, lookups({})).events[0]).not.toHaveProperty("actorNickname");
    });

    it("flags privileged users", () => {
        const page = buildEventsPage([row(1), row(2, { userId: "u2" })], 10, lookups({}, ["u2"]));
        expect(page.events.find((e) => e.userId === "u1")?.privileged).toBe(false);
        expect(page.events.find((e) => e.userId === "u2")?.privileged).toBe(true);
    });

    it("serializes the time as ISO", () => {
        expect(buildEventsPage([row(5)], 10, lookups({})).events[0].createdAt).toBe("2026-10-10T12:05:00.000Z");
    });
});

// ── recordIdentityEvent, against small fakes ────────────────────────────────

function fakeApp(opts: { createFails?: boolean } = {}) {
    const redis = new Map<string, string>();
    const counters = new Map<string, number>();
    const created: Record<string, unknown>[] = [];
    const warnings: unknown[] = [];
    const app = {
        redis: {
            async set(key: string, value: string, _ex: string, _ttl: number, nx: string) {
                if (nx === "NX" && redis.has(key)) return null;
                redis.set(key, value);
                return "OK";
            },
            async incr(key: string) {
                counters.set(key, (counters.get(key) ?? 0) + 1);
                return counters.get(key)!;
            },
            async expire() {
                return 1;
            },
        },
        prisma: {
            identityEvent: {
                async create({ data }: { data: Record<string, unknown> }) {
                    if (opts.createFails) throw new Error("db down");
                    created.push(data);
                    return data;
                },
            },
        },
        log: { warn: (...a: unknown[]) => warnings.push(a) },
    };
    return { app: app as never, created, warnings };
}

const refusal = (over: Record<string, unknown> = {}) => ({
    serverId: "s",
    userId: "u",
    nickname: "Nick",
    kind: "REFUSED" as const,
    reason: "otherDevice",
    fingerprint: "SHA256:aaa",
    address: "203.0.113.5",
    host: "chat.example.com",
    ...over,
});

describe("recordIdentityEvent", () => {
    it("writes a BOUND event with every field", async () => {
        const { app, created } = fakeApp();
        await recordIdentityEvent(app, { ...refusal({ kind: "BOUND", reason: undefined }) });
        expect(created).toHaveLength(1);
        expect(created[0]).toMatchObject({ kind: "BOUND", userId: "u", address: "203.0.113.5", host: "chat.example.com" });
    });

    it("writes the same refusal once per window", async () => {
        const { app, created } = fakeApp();
        for (let i = 0; i < 20; i++) await recordIdentityEvent(app, refusal());
        expect(created).toHaveLength(1);
    });

    it("writes refusals that differ (another user, another reason)", async () => {
        const { app, created } = fakeApp();
        await recordIdentityEvent(app, refusal());
        await recordIdentityEvent(app, refusal({ userId: "u2" }));
        await recordIdentityEvent(app, refusal({ reason: "hostNotAllowed" }));
        expect(created).toHaveLength(3);
    });

    it("caps refusals per address when the user ids keep changing", async () => {
        const { app, created } = fakeApp();
        for (let i = 0; i < REFUSALS_PER_ADDRESS_PER_HOUR + 15; i++) {
            await recordIdentityEvent(app, refusal({ userId: `bogus-${i}` }));
        }
        expect(created).toHaveLength(REFUSALS_PER_ADDRESS_PER_HOUR);
    });

    it("never throws when the database is down, and says so", async () => {
        const { app, warnings } = fakeApp({ createFails: true });
        await expect(recordIdentityEvent(app, refusal({ kind: "BOUND" }))).resolves.toBeUndefined();
        expect(warnings.length).toBe(1);
    });

    it("bounds what a client controls (nickname, host)", async () => {
        const { app, created } = fakeApp();
        await recordIdentityEvent(app, { ...refusal({ kind: "BOUND" }), nickname: "n".repeat(5000), host: "h".repeat(5000) });
        expect((created[0].nickname as string).length).toBe(255);
        expect((created[0].host as string).length).toBe(255);
    });
});

describe("pruneIdentityEvents / countUnprotectedActiveUsers", () => {
    it("deletes rows older than the retention window", async () => {
        let where: { createdAt: { lt: Date } } | undefined;
        const prisma = {
            identityEvent: {
                async deleteMany(arg: { where: { createdAt: { lt: Date } } }) {
                    where = arg.where;
                    return { count: 7 };
                },
            },
        };
        const now = new Date("2026-10-10T00:00:00.000Z");
        expect(await pruneIdentityEvents(prisma as never, now)).toBe(7);
        const days = (now.getTime() - where!.createdAt.lt.getTime()) / 86_400_000;
        expect(days).toBe(IDENTITY_EVENT_RETENTION_DAYS);
    });

    it("counts users without a key who were active in the last 30 days", async () => {
        let filter: { publicKey: null; updatedAt: { gte: Date } } | undefined;
        const prisma = {
            user: {
                async count(arg: { where: { publicKey: null; updatedAt: { gte: Date } } }) {
                    filter = arg.where;
                    return 4;
                },
            },
        };
        const now = new Date("2026-10-10T00:00:00.000Z");
        expect(await countUnprotectedActiveUsers(prisma as never, now)).toBe(4);
        expect(filter!.publicKey).toBeNull();
        expect((now.getTime() - filter!.updatedAt.gte.getTime()) / 86_400_000).toBe(30);
    });
});

// ── the effective "require signed identity" value ───────────────────────────

describe("resolveRequireSigned", () => {
    it("uses the stored value when the environment says nothing", () => {
        for (const env of [undefined, "", "   "]) {
            expect(resolveRequireSigned(env, true)).toBe(true);
            expect(resolveRequireSigned(env, false)).toBe(false);
        }
    });

    it("lets the environment win whatever is stored", () => {
        expect(resolveRequireSigned("true", false)).toBe(true);
        expect(resolveRequireSigned("TRUE", false)).toBe(true);
        expect(resolveRequireSigned(" true ", false)).toBe(true);
        expect(resolveRequireSigned("false", true)).toBe(false);
        expect(resolveRequireSigned("0", true)).toBe(false);
        expect(resolveRequireSigned("anything-else", true)).toBe(false);
    });
});

describe("requireSignedIdentity / requireSignedLockedByEnv (process.env)", () => {
    const saved = process.env.REQUIRE_SIGNED_IDENTITY;
    afterEach(() => {
        if (saved === undefined) delete process.env.REQUIRE_SIGNED_IDENTITY;
        else process.env.REQUIRE_SIGNED_IDENTITY = saved;
        setDbRequireSigned(false);
    });

    it("follows the stored value when the variable is unset, with no lock", () => {
        delete process.env.REQUIRE_SIGNED_IDENTITY;
        setDbRequireSigned(true);
        expect(requireSignedIdentity()).toBe(true);
        expect(requireSignedLockedByEnv()).toBe(false);
        setDbRequireSigned(false);
        expect(requireSignedIdentity()).toBe(false);
    });

    it("treats an empty variable (as docker-compose passes it) as unset", () => {
        process.env.REQUIRE_SIGNED_IDENTITY = "";
        setDbRequireSigned(true);
        expect(requireSignedIdentity()).toBe(true);
        expect(requireSignedLockedByEnv()).toBe(false);
    });

    it("locks the setting when the variable is set, including an explicit false", () => {
        process.env.REQUIRE_SIGNED_IDENTITY = "false";
        setDbRequireSigned(true);
        expect(requireSignedLockedByEnv()).toBe(true);
        expect(requireSignedIdentity()).toBe(false);
        process.env.REQUIRE_SIGNED_IDENTITY = "true";
        setDbRequireSigned(false);
        expect(requireSignedIdentity()).toBe(true);
    });
});
