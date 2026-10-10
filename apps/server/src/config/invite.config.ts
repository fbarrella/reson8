/**
 * "Require an invite code for new users" (PRD 18.9): the value an admin set
 * in Settings → Server, mirrored in memory so a join never costs a database
 * read (same pattern as the approval and signed-identity switches).
 */

let requireInviteValue = false;

export function setDbRequireInvite(value: boolean): void {
    requireInviteValue = value;
}

export function requireInvite(): boolean {
    return requireInviteValue;
}
