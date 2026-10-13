import { describe, expect, it } from "vitest";
import { channelLockCount, withChannelLock } from "../services/channel-lock.js";
import { SCREEN_SHARE_LIMIT_MESSAGE, screenShareSlotAvailable } from "../services/screen-share-limit.js";

const tick = () => new Promise<void>((r) => setTimeout(r, 5));

describe("withChannelLock", () => {
    it("runs two calls on the same key in order", async () => {
        const log: string[] = [];
        const first = withChannelLock("c1", async () => {
            log.push("first:start");
            await tick();
            log.push("first:end");
        });
        const second = withChannelLock("c1", async () => {
            log.push("second:start");
        });
        await Promise.all([first, second]);
        expect(log).toEqual(["first:start", "first:end", "second:start"]);
    });

    it("runs calls on different keys concurrently", async () => {
        const log: string[] = [];
        const a = withChannelLock("a", async () => {
            log.push("a:start");
            await tick();
            log.push("a:end");
        });
        const b = withChannelLock("b", async () => {
            log.push("b:start");
            await tick();
            log.push("b:end");
        });
        await Promise.all([a, b]);
        expect(log.slice(0, 2).sort()).toEqual(["a:start", "b:start"]);
    });

    it("a rejected call neither blocks the next one nor swallows its own error", async () => {
        const failing = withChannelLock("c2", async () => {
            throw new Error("boom");
        });
        const next = withChannelLock("c2", async () => "ok");
        await expect(failing).rejects.toThrow("boom");
        await expect(next).resolves.toBe("ok");
    });

    it("returns the callback's value", async () => {
        await expect(withChannelLock("c3", async () => 42)).resolves.toBe(42);
    });

    it("leaves nothing behind once the chains have drained", async () => {
        await Promise.all([
            withChannelLock("d1", () => tick()),
            withChannelLock("d1", () => tick()),
            withChannelLock("d2", () => tick()),
        ]);
        await tick();
        expect(channelLockCount()).toBe(0);
    });

    it("serialises a check-then-act so two last-slot requests cannot both win", async () => {
        let taken = 4;
        const MAX = 5;
        const request = () =>
            withChannelLock("room", async () => {
                const ok = taken < MAX;
                await tick(); // the produce() round trip
                if (ok) taken++;
                return ok;
            });
        const results = await Promise.all([request(), request(), request()]);
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(taken).toBe(5);
    });
});

describe("screenShareSlotAvailable", () => {
    it("allows up to the cap and refuses at it", () => {
        expect(screenShareSlotAvailable(0)).toBe(true);
        expect(screenShareSlotAvailable(4)).toBe(true);
        expect(screenShareSlotAvailable(5)).toBe(false);
        expect(screenShareSlotAvailable(9)).toBe(false);
    });
    it("honours an explicit cap", () => {
        expect(screenShareSlotAvailable(1, 2)).toBe(true);
        expect(screenShareSlotAvailable(2, 2)).toBe(false);
    });
    it("has the user-facing message the PRD specifies", () => {
        expect(SCREEN_SHARE_LIMIT_MESSAGE).toBe(
            "All 5 stream slots are in use. You can share when someone stops.",
        );
    });
});
