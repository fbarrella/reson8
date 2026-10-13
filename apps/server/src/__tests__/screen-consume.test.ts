import { describe, expect, it } from "vitest";
import { screenConsumeDecision, type ScreenConsumeInput } from "../services/screen-consume.js";
import { MediasoupService } from "../services/mediasoup.service.js";
import { screenShareEnabled, setScreenShareEnabled } from "../config/screen-share.config.js";

const base: ScreenConsumeInput = {
    mediaType: "screen-video",
    enabled: true,
    role: "viewer",
    watchingUserId: "sharer",
    ownerKey: "sharer",
};

describe("screenConsumeDecision", () => {
    it("an unknown producer keeps today's behaviour (canConsume decides)", () => {
        expect(screenConsumeDecision({ ...base, mediaType: null, role: "primary", watchingUserId: undefined })).toEqual({
            allowed: true,
        });
    });

    it("a mic producer is never refused, whatever the switch and the role", () => {
        for (const enabled of [true, false]) {
            for (const role of ["primary", "viewer", undefined] as const) {
                expect(
                    screenConsumeDecision({ ...base, mediaType: "mic", enabled, role, watchingUserId: undefined }),
                ).toEqual({ allowed: true });
            }
        }
    });

    it("a screen producer with sharing switched off is refused as SCREEN_SHARE_DISABLED", () => {
        for (const mediaType of ["screen-video", "screen-audio"] as const) {
            const d = screenConsumeDecision({ ...base, mediaType, enabled: false });
            expect(d).toMatchObject({ allowed: false, errorCode: "SCREEN_SHARE_DISABLED" });
        }
    });

    it("a primary socket is refused as NOT_WATCHING even when sharing is on", () => {
        const d = screenConsumeDecision({ ...base, role: "primary" });
        expect(d).toMatchObject({ allowed: false, errorCode: "NOT_WATCHING" });
    });

    it("a viewer socket watching someone else is refused", () => {
        const d = screenConsumeDecision({ ...base, watchingUserId: "someone-else" });
        expect(d).toMatchObject({ allowed: false, errorCode: "NOT_WATCHING" });
    });

    it("a viewer that is not watching anyone is refused", () => {
        const d = screenConsumeDecision({ ...base, watchingUserId: undefined });
        expect(d).toMatchObject({ allowed: false, errorCode: "NOT_WATCHING" });
    });

    it("a viewer watching that sharer may consume both video and audio", () => {
        expect(screenConsumeDecision(base)).toEqual({ allowed: true });
        expect(screenConsumeDecision({ ...base, mediaType: "screen-audio" })).toEqual({ allowed: true });
    });
});

describe("MediasoupService.findProducer", () => {
    const producer = (id: string) => ({ id });
    function serviceWith(sessions: Record<string, Record<string, unknown>>): MediasoupService {
        const svc = new MediasoupService();
        const map = new Map<string, Map<string, unknown>>();
        const channel = new Map<string, unknown>();
        for (const [key, session] of Object.entries(sessions)) channel.set(key, session);
        map.set("c1", channel);
        (svc as unknown as { sessions: unknown }).sessions = map;
        return svc;
    }

    it("finds a mic, a screen-video and a screen-audio producer and who owns it", () => {
        const svc = serviceWith({
            alice: { producer: producer("m1"), screenVideoProducer: producer("v1"), screenAudioProducer: producer("a1") },
            bob: { producer: producer("m2"), screenVideoProducer: null, screenAudioProducer: null },
        });
        expect(svc.findProducer("c1", "m1")).toEqual({ ownerKey: "alice", mediaType: "mic" });
        expect(svc.findProducer("c1", "v1")).toEqual({ ownerKey: "alice", mediaType: "screen-video" });
        expect(svc.findProducer("c1", "a1")).toEqual({ ownerKey: "alice", mediaType: "screen-audio" });
        expect(svc.findProducer("c1", "m2")).toEqual({ ownerKey: "bob", mediaType: "mic" });
    });

    it("returns null for an unknown producer or channel", () => {
        const svc = serviceWith({ alice: { producer: producer("m1"), screenVideoProducer: null, screenAudioProducer: null } });
        expect(svc.findProducer("c1", "nope")).toBeNull();
        expect(svc.findProducer("other", "m1")).toBeNull();
    });
});

describe("screen share config", () => {
    it("defaults to enabled and follows the setter", () => {
        expect(screenShareEnabled()).toBe(true);
        setScreenShareEnabled(false);
        expect(screenShareEnabled()).toBe(false);
        setScreenShareEnabled(true);
    });
});
