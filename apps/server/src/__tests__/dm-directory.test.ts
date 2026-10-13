import { describe, expect, it } from "vitest";
import { PermissionFlags } from "@reson8/shared-types";
import {
    DM_PREVIEW_MAX_CHARS,
    buildDmDirectory,
    loadLastDmByPartner,
    truncatePreview,
    type DmDirectoryInput,
    type LastDmRow,
} from "../services/dm-directory.js";

const MEMBER = BigInt(PermissionFlags.CONNECT);
const m = (id: string, perms = MEMBER, nickname = id) => ({ id, nickname, avatarUrl: null, perms });
const last = (partner: string, over: Partial<LastDmRow> = {}): LastDmRow => ({
    partner,
    id: "dm-" + partner,
    content: "hi",
    senderId: partner,
    createdAt: new Date("2026-10-13T10:00:00.000Z"),
    ...over,
});

function build(over: Partial<DmDirectoryInput> = {}) {
    return buildDmDirectory({
        callerId: "me",
        members: [m("me"), m("a"), m("b")],
        bannedIds: new Set(),
        onlineIds: new Set(),
        lastByPartner: new Map(),
        dmIdsWithAttachments: new Set(),
        unreadByPartner: new Map(),
        ...over,
    });
}

describe("buildDmDirectory", () => {
    it("excludes the caller", () => {
        expect(build().map((e) => e.userId)).toEqual(["a", "b"]);
    });

    it("excludes banned and restricted (no CONNECT/ADMIN) users", () => {
        const entries = build({
            members: [m("me"), m("a"), m("banned"), m("restricted", 0n)],
            bannedIds: new Set(["banned"]),
        });
        expect(entries.map((e) => e.userId)).toEqual(["a"]);
    });

    it("lists a member with no DMs: no lastMessage, unreadCount 0", () => {
        const [a] = build();
        expect(a.lastMessage).toBeUndefined();
        expect(a.unreadCount).toBe(0);
    });

    it("uses the given last message and marks fromMe correctly", () => {
        const entries = build({
            lastByPartner: new Map([
                ["a", last("a", { senderId: "me", content: "from me" })],
                ["b", last("b", { senderId: "b", content: "from b" })],
            ]),
        });
        expect(entries[0].lastMessage).toMatchObject({ text: "from me", fromMe: true, hasAttachments: false });
        expect(entries[1].lastMessage).toMatchObject({ text: "from b", fromMe: false });
    });

    it("fills hasAttachments from the DM id and the time as ISO", () => {
        const entries = build({
            lastByPartner: new Map([["a", last("a")]]),
            dmIdsWithAttachments: new Set(["dm-a"]),
        });
        expect(entries[0].lastMessage?.hasAttachments).toBe(true);
        expect(entries[0].lastMessage?.at).toBe("2026-10-13T10:00:00.000Z");
    });

    it("carries online state and unread counts, defaulting to 0", () => {
        const entries = build({ onlineIds: new Set(["b"]), unreadByPartner: new Map([["a", 3]]) });
        expect(entries.map((e) => [e.userId, e.isOnline, e.unreadCount])).toEqual([
            ["a", false, 3],
            ["b", true, 0],
        ]);
    });

    it("truncates a long preview to 300 characters", () => {
        const entries = build({
            lastByPartner: new Map([["a", last("a", { content: "x".repeat(1000) })]]),
        });
        expect(entries[0].lastMessage?.text).toHaveLength(DM_PREVIEW_MAX_CHARS);
    });
});

describe("truncatePreview", () => {
    it("never splits a surrogate pair", () => {
        const text = "a".repeat(299) + "😀" + "tail";
        const cut = truncatePreview(text);
        expect(cut).toBe("a".repeat(299));
        expect(cut.length).toBeLessThanOrEqual(DM_PREVIEW_MAX_CHARS);
    });
    it("leaves short text alone", () => {
        expect(truncatePreview("hello")).toBe("hello");
    });
});

describe("loadLastDmByPartner", () => {
    it("keys rows by partner and binds the caller as a parameter", async () => {
        let strings: readonly string[] = [];
        let values: unknown[] = [];
        const prisma = {
            $queryRaw: async (s: TemplateStringsArray, ...v: unknown[]) => {
                strings = s;
                values = v;
                return [last("a"), last("b")];
            },
        };
        const map = await loadLastDmByPartner(prisma as never, "me'; --");
        expect([...map.keys()]).toEqual(["a", "b"]);
        expect(values).toContain("me'; --");
        expect(strings.join("")).not.toContain("me'; --");
    });
});
