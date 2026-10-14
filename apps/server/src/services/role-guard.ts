/**
 * ASSIGN_ROLE safety rules (PRD 20 M1), pure so they are unit-tested.
 * The Members page makes these one click away; the server is the authority.
 */
export interface RoleChange {
    actorId: string;
    actorIsAdmin: boolean;
    targetId: string;
    action: "add" | "remove";
    /** The role being changed grants ADMIN. */
    roleGrantsAdmin: boolean;
    /** The role being changed is the Member role (role-default). */
    isMemberRole: boolean;
    /** How many users on this server hold an ADMIN-granting role right now (including the target). */
    adminHolderCount: number;
    /** The target currently holds an ADMIN-granting role other than this one. */
    targetHasOtherAdminRole: boolean;
}

export function decideRoleChange(c: RoleChange): { ok: true } | { ok: false; error: string } {
    if (c.roleGrantsAdmin && !c.actorIsAdmin) return { ok: false, error: "Only an admin can change who is an admin" };
    if (c.action === "remove" && c.targetId === c.actorId && c.roleGrantsAdmin) {
        return { ok: false, error: "You can't remove your own admin role" };
    }
    if (c.action === "remove" && c.targetId === c.actorId && c.isMemberRole) {
        return { ok: false, error: "You can't remove your own membership" };
    }
    if (c.action === "remove" && c.roleGrantsAdmin && !c.targetHasOtherAdminRole && c.adminHolderCount <= 1) {
        return { ok: false, error: "The server needs at least one admin" };
    }
    return { ok: true };
}
