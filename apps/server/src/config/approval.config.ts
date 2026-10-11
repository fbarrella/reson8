/**
 * "Approve new users" (PRD 18.8): whether a brand-new identity must be let in
 * by a moderator. The value an admin set in Settings → Server, mirrored in
 * memory so a join never costs a database read (the same pattern as the
 * signed-identity switch, PRD 18.4). Loaded at boot, refreshed on update.
 */

let requireApprovalValue = false;

export function setDbRequireApproval(value: boolean): void {
    requireApprovalValue = value;
}

export function requireApproval(): boolean {
    return requireApprovalValue;
}
