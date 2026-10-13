import { beforeEach, describe, expect, it } from "vitest";
import {
    annotateSessionStarts,
    hydrateOccupants,
    presencePayload,
    voiceSessionStartedAt,
} from "../services/voice-session.service.js";
import { voiceSessionStartedAt as reExported } from "../handlers/connection.handler.js";

const START = new Date("2026-10-13T12:00:00.000Z");

/** A presence double: occupants are served from a queue, one answer per call. */
function fakePresence(answers: string[][]) {
    let i = 0;
    return {
        getChannelOccupants: async () => answers[Math.min(i++, answers.length - 1)],
        getUserPresence: async (userId: string) => ({
            serverId: "s1",
            channelId: "c1",
            nickname: `nick-${userId}`,
            isMuted: false,
            isDeafened: false,
            isSharingScreen: false,
        }),
    };
}
const app = { prisma: { user: { findUnique: async () => null } } } as never;

beforeEach(() => voiceSessionStartedAt.clear());

describe("voiceSessionStartedAt", () => {
    it("is one map, shared with connection.handler's re-export", () => {
        expect(reExported).toBe(voiceSessionStartedAt);
    });
});

describe("presencePayload", () => {
    it("clears the session start when the room is empty and omits the field", async () => {
        voiceSessionStartedAt.set("c1", START);
        const payload = await presencePayload(app, fakePresence([[]]) as never, "c1");
        expect(payload).toEqual({ channelId: "c1", occupants: [] });
        expect("sessionStartedAt" in payload).toBe(false);
        expect(voiceSessionStartedAt.has("c1")).toBe(false);
    });

    it("keeps the session start while the room is occupied", async () => {
        voiceSessionStartedAt.set("c1", START);
        const payload = await presencePayload(app, fakePresence([["a"]]) as never, "c1");
        expect(payload.sessionStartedAt).toBe(START.toISOString());
        expect(payload.occupants.map((o) => o.userId)).toEqual(["a"]);
        expect(voiceSessionStartedAt.get("c1")).toBe(START);
    });

    it("a kick that leaves someone behind keeps the timer; the last one out clears it", async () => {
        voiceSessionStartedAt.set("c1", START);
        const presence = fakePresence([["b"], []]);
        const afterFirst = await presencePayload(app, presence as never, "c1");
        expect(afterFirst.sessionStartedAt).toBe(START.toISOString());
        const afterLast = await presencePayload(app, presence as never, "c1");
        expect(afterLast.sessionStartedAt).toBeUndefined();
        expect(voiceSessionStartedAt.has("c1")).toBe(false);
    });

    it("does not invent a start time for a room that never had one", async () => {
        const payload = await presencePayload(app, fakePresence([["a"]]) as never, "c9");
        expect(payload.sessionStartedAt).toBeUndefined();
    });
});

describe("annotateSessionStarts", () => {
    const node = (id: string, type: string, occupants: number, children: unknown[] = []) => ({
        id,
        type,
        occupants: Array.from({ length: occupants }, () => ({})),
        children,
        sessionStartedAt: undefined as string | undefined,
    });

    it("sets the start on voice nodes with a running session, recursively", () => {
        voiceSessionStartedAt.set("v1", START);
        voiceSessionStartedAt.set("v2", START);
        const inner = node("v2", "VOICE", 1);
        const tree = [node("cat", "TEXT", 0, [inner]), node("v1", "VOICE", 2), node("v3", "VOICE", 0)];
        annotateSessionStarts(tree);
        expect(tree[1].sessionStartedAt).toBe(START.toISOString());
        expect(inner.sessionStartedAt).toBe(START.toISOString());
        expect(tree[2].sessionStartedAt).toBeUndefined();
        expect(tree[0].sessionStartedAt).toBeUndefined();
    });

    it("never annotates a text channel even if an id collides", () => {
        voiceSessionStartedAt.set("t1", START);
        const tree = [node("t1", "TEXT", 0)];
        annotateSessionStarts(tree);
        expect(tree[0].sessionStartedAt).toBeUndefined();
    });

    it("with requireOccupants ignores a stale entry for an empty room", () => {
        voiceSessionStartedAt.set("v1", START);
        const tree = [node("v1", "VOICE", 0)];
        annotateSessionStarts(tree, true);
        expect(tree[0].sessionStartedAt).toBeUndefined();
        annotateSessionStarts(tree, false);
        expect(tree[0].sessionStartedAt).toBe(START.toISOString());
    });
});

describe("hydrateOccupants (PRD 19 P12)", () => {
    const tnode = (id: string, type: string, children: unknown[] = []) => ({
        id,
        type,
        occupants: [] as { userId: string }[],
        children,
    });
    const presenceFor = (byChannel: Record<string, string[]>) => ({
        getChannelOccupants: async (id: string) => byChannel[id] ?? [],
        getUserPresence: async (userId: string) => ({
            serverId: "s1",
            channelId: "x",
            nickname: `nick-${userId}`,
            isMuted: false,
            isDeafened: false,
            isSharingScreen: false,
        }),
    });

    it("fills occupants recursively and seeds a start time for an occupied voice room", async () => {
        const inner = tnode("v2", "VOICE");
        const tree = [tnode("cat", "TEXT", [inner]), tnode("v1", "VOICE"), tnode("empty", "VOICE")];
        await hydrateOccupants(tree as never, presenceFor({ v1: ["a", "b"], v2: ["c"] }) as never, app);
        expect(tree[1].occupants.map((o) => o.userId)).toEqual(["a", "b"]);
        expect(inner.occupants.map((o) => o.userId)).toEqual(["c"]);
        expect(tree[2].occupants).toEqual([]);
        expect(voiceSessionStartedAt.has("v1")).toBe(true);
        expect(voiceSessionStartedAt.has("v2")).toBe(true);
        expect(voiceSessionStartedAt.has("empty")).toBe(false);
    });

    it("keeps an existing session start and never seeds one for a text channel", async () => {
        voiceSessionStartedAt.set("v1", START);
        const tree = [tnode("v1", "VOICE"), tnode("t1", "TEXT")];
        await hydrateOccupants(tree as never, presenceFor({ v1: ["a"], t1: ["z"] }) as never, app);
        expect(voiceSessionStartedAt.get("v1")).toBe(START);
        expect(voiceSessionStartedAt.has("t1")).toBe(false);
    });
});
