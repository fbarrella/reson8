import { describe, expect, it } from "vitest";
import {
    MAX_ALLOWED_HOSTS,
    checkAllowedHostsUpdate,
    listObservedAuthHosts,
    normalizeAuthHost,
    observeAuthHost,
    parseAllowedHostsInput,
} from "../services/auth-hosts.service.js";
import { serversWithLists, wantsYes } from "../../scripts/identity-clear-hosts.mjs";
import {
    authAllowedHosts,
    authAllowedHostsLockedByEnv,
    setDbAllowedHosts,
} from "../config/identity.config.js";
import { isHostAllowed } from "../services/identity.service.js";

describe("normalizeAuthHost", () => {
    it("trims and lower-cases", () => {
        expect(normalizeAuthHost("  Chat.Example.COM:9800 ")).toBe("chat.example.com:9800");
    });
});

describe("parseAllowedHostsInput", () => {
    it("accepts host, host:port, IPv4 and bracketed IPv6", () => {
        const r = parseAllowedHostsInput(["chat.example.com", "192.168.0.10:9800", "[::1]:9800", "localhost"]);
        expect(r).toEqual({ ok: true, hosts: ["chat.example.com", "192.168.0.10:9800", "[::1]:9800", "localhost"] });
    });

    it("normalizes and de-duplicates, keeping order", () => {
        expect(parseAllowedHostsInput(["A.com", "b.com", "a.com ", "B.COM"])).toEqual({ ok: true, hosts: ["a.com", "b.com"] });
    });

    it("accepts an empty list (the check off)", () => {
        expect(parseAllowedHostsInput([])).toEqual({ ok: true, hosts: [] });
    });

    it.each(["", "   ", "http://x.com", "x.com/path", "x.com?q=1", "user@x.com", "a,b", "a b", "x".repeat(256), "x.com#f"])(
        "rejects %j",
        (bad) => {
            expect(parseAllowedHostsInput([bad]).ok).toBe(false);
        },
    );

    it("rejects non-arrays and non-string entries", () => {
        for (const bad of [undefined, null, "a.com", { 0: "a.com" }, [1], [null], [["a.com"]]]) {
            expect(parseAllowedHostsInput(bad).ok).toBe(false);
        }
    });

    it("caps the list", () => {
        const many = Array.from({ length: MAX_ALLOWED_HOSTS + 1 }, (_, i) => `h${i}.example.com`);
        expect(parseAllowedHostsInput(many).ok).toBe(false);
        expect(parseAllowedHostsInput(many.slice(0, MAX_ALLOWED_HOSTS)).ok).toBe(true);
    });

    it("shows what was rejected, bounded", () => {
        const r = parseAllowedHostsInput(["<script>".repeat(30)]);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.length).toBeLessThan(140);
    });
});

describe("checkAllowedHostsUpdate (the lock-out guard)", () => {
    it("lets an empty list through — that turns the check off", () => {
        expect(checkAllowedHostsUpdate([], "chat.example.com").ok).toBe(true);
    });

    it("accepts a list that contains the admin's own name", () => {
        expect(checkAllowedHostsUpdate(["a.com", "chat.example.com"], "chat.example.com").ok).toBe(true);
        expect(checkAllowedHostsUpdate(["chat.example.com"], "Chat.Example.com").ok).toBe(true);
    });

    it("refuses a list that would lock the admin out, and names the host", () => {
        const r = checkAllowedHostsUpdate(["a.com"], "chat.example.com");
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toContain("chat.example.com");
    });

    it("lets an admin without a signed session through (unsigned joins skip the host check)", () => {
        expect(checkAllowedHostsUpdate(["a.com"], undefined).ok).toBe(true);
    });

    it("distinguishes a name from the same name with a port", () => {
        expect(checkAllowedHostsUpdate(["chat.example.com"], "chat.example.com:9800").ok).toBe(false);
    });
});

describe("observed names", () => {
    function fakeRedis() {
        const counts = new Map<string, Map<string, number>>();
        const lasts = new Map<string, Map<string, string>>();
        const hash = <T>(m: Map<string, Map<string, T>>, k: string) => m.get(k) ?? m.set(k, new Map()).get(k)!;
        const pipeline = (ops: (() => void)[]) => ({
            hincrby(k: string, f: string, n: number) { ops.push(() => hash(counts, k).set(f, (hash(counts, k).get(f) ?? 0) + n)); return this; },
            hset(k: string, f: string, v: string) { ops.push(() => hash(lasts, k).set(f, v)); return this; },
            expire() { return this; },
            async exec() { ops.forEach((o) => o()); return []; },
        });
        return {
            async hexists(k: string, f: string) { return hash(counts, k).has(f) ? 1 : 0; },
            async hlen(k: string) { return hash(counts, k).size; },
            multi() { return pipeline([]); },
            async hgetall(k: string) {
                const out: Record<string, string> = {};
                for (const [f, v] of (counts.get(k) ?? lasts.get(k) ?? new Map()).entries()) out[f] = String(v);
                return out;
            },
            _counts: counts,
            _lasts: lasts,
        };
    }

    it("counts accepted joins per normalized name and lists the most used first", async () => {
        const r = fakeRedis();
        await observeAuthHost(r as never, "s", "Chat.Example.com");
        await observeAuthHost(r as never, "s", "chat.example.com");
        await observeAuthHost(r as never, "s", "192.168.0.10:9800");
        // hgetall of the fake returns counts for the counts key and lasts for the other
        const redis = {
            hgetall: async (k: string) =>
                k.startsWith("auth:observed-hosts-last:")
                    ? Object.fromEntries(r._lasts.get(k) ?? [])
                    : Object.fromEntries([...(r._counts.get(k) ?? [])].map(([f, v]) => [f, String(v)])),
        };
        const list = await listObservedAuthHosts(redis as never, "s");
        expect(list.map((h) => [h.host, h.joins])).toEqual([
            ["chat.example.com", 2],
            ["192.168.0.10:9800", 1],
        ]);
        expect(list[0].lastSeen).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("never throws when Redis fails", async () => {
        const broken = { hexists: async () => { throw new Error("redis down"); } };
        await expect(observeAuthHost(broken as never, "s", "x.com")).resolves.toBeUndefined();
    });

    it("stops remembering NEW names past the cap (a client picks its own host string)", async () => {
        const r = fakeRedis();
        for (let i = 0; i < 205; i++) await observeAuthHost(r as never, "s", `h${i}.example.com`);
        expect(r._counts.get("auth:observed-hosts:s")!.size).toBe(200);
        await observeAuthHost(r as never, "s", "h0.example.com"); // an already-known name still counts
        expect(r._counts.get("auth:observed-hosts:s")!.get("h0.example.com")).toBe(2);
    });
});

describe("effective allowed list (environment over database)", () => {
    const saved = process.env.AUTH_ALLOWED_HOSTS;
    const restore = () => {
        if (saved === undefined) delete process.env.AUTH_ALLOWED_HOSTS;
        else process.env.AUTH_ALLOWED_HOSTS = saved;
        setDbAllowedHosts([]);
    };

    it("uses the stored list when the variable is unset or blank", () => {
        for (const env of [undefined, "", "  ,  "]) {
            if (env === undefined) delete process.env.AUTH_ALLOWED_HOSTS;
            else process.env.AUTH_ALLOWED_HOSTS = env;
            setDbAllowedHosts(["Chat.Example.com"]);
            expect(authAllowedHosts()).toEqual(["chat.example.com"]);
            expect(authAllowedHostsLockedByEnv()).toBe(false);
        }
        restore();
    });

    it("lets the environment win and lock the setting", () => {
        process.env.AUTH_ALLOWED_HOSTS = "env.example.com, B.example.com";
        setDbAllowedHosts(["db.example.com"]);
        expect(authAllowedHosts()).toEqual(["env.example.com", "b.example.com"]);
        expect(authAllowedHostsLockedByEnv()).toBe(true);
        restore();
    });

    it("an empty effective list allows every host (the check is off)", () => {
        delete process.env.AUTH_ALLOWED_HOSTS;
        setDbAllowedHosts([]);
        expect(isHostAllowed("anything.example", authAllowedHosts())).toBe(true);
        setDbAllowedHosts(["only.example.com"]);
        expect(isHostAllowed("anything.example", authAllowedHosts())).toBe(false);
        expect(isHostAllowed("Only.Example.com", authAllowedHosts())).toBe(true);
        restore();
    });
});

describe("identity-clear-hosts script helpers", () => {
    it("recognizes --yes", () => {
        expect(wantsYes(["--yes"])).toBe(true);
        expect(wantsYes(["-y"])).toBe(true);
        expect(wantsYes([])).toBe(false);
        expect(wantsYes(["--apply"])).toBe(false);
    });

    it("picks only the servers that have a list", () => {
        const servers = [
            { id: "a", authAllowedHosts: [] },
            { id: "b", authAllowedHosts: ["x.com"] },
            { id: "c", authAllowedHosts: null },
        ];
        expect(serversWithLists(servers).map((s) => s.id)).toEqual(["b"]);
    });
});
