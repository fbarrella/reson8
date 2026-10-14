import { describe, expect, it } from "vitest";
import { decideRoleChange, type RoleChange } from "../services/role-guard.js";

const base: RoleChange = {
    actorId: "actor",
    actorIsAdmin: true,
    targetId: "target",
    action: "add",
    roleGrantsAdmin: false,
    isMemberRole: false,
    adminHolderCount: 2,
    targetHasOtherAdminRole: false,
};

describe("decideRoleChange", () => {
    it("refuses a non-admin granting an admin role", () => {
        const r = decideRoleChange({ ...base, actorIsAdmin: false, roleGrantsAdmin: true });
        expect(r).toEqual({ ok: false, error: "Only an admin can change who is an admin" });
    });

    it("refuses a non-admin removing an admin role too", () => {
        const r = decideRoleChange({ ...base, actorIsAdmin: false, roleGrantsAdmin: true, action: "remove" });
        expect(r.ok).toBe(false);
    });

    it("refuses an admin removing their own admin role", () => {
        const r = decideRoleChange({ ...base, targetId: "actor", action: "remove", roleGrantsAdmin: true });
        expect(r).toEqual({ ok: false, error: "You can't remove your own admin role" });
    });

    it("refuses removing your own Member role", () => {
        const r = decideRoleChange({ ...base, targetId: "actor", action: "remove", isMemberRole: true });
        expect(r).toEqual({ ok: false, error: "You can't remove your own membership" });
    });

    it("refuses removing the last admin", () => {
        const r = decideRoleChange({ ...base, action: "remove", roleGrantsAdmin: true, adminHolderCount: 1 });
        expect(r).toEqual({ ok: false, error: "The server needs at least one admin" });
    });

    it("allows removing an admin when another admin exists", () => {
        expect(decideRoleChange({ ...base, action: "remove", roleGrantsAdmin: true, adminHolderCount: 2 })).toEqual({ ok: true });
    });

    it("allows removing an admin role from a target who holds a second admin role", () => {
        const r = decideRoleChange({
            ...base,
            action: "remove",
            roleGrantsAdmin: true,
            adminHolderCount: 1,
            targetHasOtherAdminRole: true,
        });
        expect(r).toEqual({ ok: true });
    });

    it("lets a MANAGE_ROLES-only holder change a non-admin role", () => {
        expect(decideRoleChange({ ...base, actorIsAdmin: false, action: "add" })).toEqual({ ok: true });
        expect(decideRoleChange({ ...base, actorIsAdmin: false, action: "remove" })).toEqual({ ok: true });
    });

    it("lets a non-admin remove somebody else's Member role", () => {
        expect(decideRoleChange({ ...base, actorIsAdmin: false, action: "remove", isMemberRole: true })).toEqual({ ok: true });
    });
});
