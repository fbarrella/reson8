import { describe, expect, it } from "vitest";
import { PermissionFlags } from "@reson8/shared-types";
import { EVENT_ACCESS, hasServerAccess, requiresAccess, rolesToGrant } from "../services/access.service.js";

const F = (n: number | bigint) => BigInt(n);

describe("hasServerAccess", () => {
    it("is false with no permissions at all (the Member role removed)", () => {
        expect(hasServerAccess(0n)).toBe(false);
    });
    it("is true with CONNECT", () => {
        expect(hasServerAccess(F(PermissionFlags.CONNECT))).toBe(true);
    });
    it("is true with ADMIN even without CONNECT", () => {
        expect(hasServerAccess(F(PermissionFlags.ADMIN))).toBe(true);
    });
    it("is false with SPEAK / SEND_MESSAGES alone (access is CONNECT)", () => {
        expect(hasServerAccess(F(PermissionFlags.SPEAK))).toBe(false);
        expect(hasServerAccess(F(PermissionFlags.SEND_MESSAGES))).toBe(false);
    });
    it("is true for the default Member role bits", () => {
        const member = F(PermissionFlags.CONNECT) | F(PermissionFlags.SPEAK) | F(PermissionFlags.SEND_MESSAGES);
        expect(hasServerAccess(member)).toBe(true);
    });
    it("is false for moderation bits without CONNECT/ADMIN", () => {
        expect(hasServerAccess(F(PermissionFlags.BAN_USER) | F(PermissionFlags.KICK_USER))).toBe(false);
    });
});

describe("rolesToGrant", () => {
    it("gives Member only to a brand-new user", () => {
        expect(rolesToGrant({ isNewUser: true, grantAdmin: false })).toEqual(["role-default"]);
        expect(rolesToGrant({ isNewUser: false, grantAdmin: false })).toEqual([]);
    });
    it("keeps the designated admin's per-join grant, without re-adding Member", () => {
        expect(rolesToGrant({ isNewUser: false, grantAdmin: true })).toEqual(["role-admin"]);
        expect(rolesToGrant({ isNewUser: true, grantAdmin: true })).toEqual(["role-default", "role-admin"]);
    });
});

describe("EVENT_ACCESS", () => {
    it("classifies the events the PRD names as refused", () => {
        for (const e of [
            "FETCH_MESSAGES", "SEND_MESSAGE", "EDIT_MESSAGE", "DELETE_MESSAGE", "TOGGLE_REACTION", "PIN_MESSAGE",
            "SEND_DIRECT_MESSAGE", "FETCH_DIRECT_MESSAGES", "MARK_DMS_READ", "GET_UNREAD_DM_PARTNERS",
            "USER_JOIN_CHANNEL", "GET_ROUTER_CAPABILITIES", "CREATE_WEBRTC_TRANSPORT", "PRODUCE", "CONSUME",
            "WATCH_SCREEN_SHARE", "REQUEST_VIEWER_TICKET", "REQUEST_UPLOAD_TOKEN", "NUDGE_USER",
        ]) {
            expect(requiresAccess(e), e).toBe(true);
        }
    });
    it("leaves the tree, presence, profile and own-settings reads open", () => {
        for (const e of ["GET_ONLINE_USERS", "GET_USER_PROFILE", "GET_SERVER_SETTINGS", "PING_LATENCY", "SET_AVATAR", "USER_LEAVE_SERVER"]) {
            expect(requiresAccess(e), e).toBe(false);
        }
    });
    it("leaves moderator/admin events to their own permission checks", () => {
        for (const e of ["ASSIGN_ROLE", "GET_ALL_USERS", "BAN_USER", "KICK_USER", "CREATE_INVITE", "APPROVE_USER"]) {
            expect(requiresAccess(e), e).toBe(false);
        }
    });
    it("treats an unknown event as needing access (safe default)", () => {
        expect(requiresAccess("SOMETHING_NEW")).toBe(true);
    });
    it("has only the two known classes", () => {
        for (const v of Object.values(EVENT_ACCESS)) expect(["open", "member"]).toContain(v);
    });
});

describe("handler classification", () => {
    it("every event a handler registers is classified in EVENT_ACCESS", async () => {
        const { readdirSync, readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const dir = join(__dirname, "..", "handlers");
        const registered = new Set<string>();
        for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
            const text = readFileSync(join(dir, f), "utf8");
            for (const m of text.matchAll(/socket\.on\(\s*["']([A-Z][A-Z0-9_]+)["']/g)) registered.add(m[1]);
        }
        expect(registered.size).toBeGreaterThan(40);
        const missing = [...registered].filter((e) => !(e in EVENT_ACCESS));
        expect(missing).toEqual([]);
    });
});
