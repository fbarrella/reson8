/**
 * Unit tests for the Permissions Service.
 *
 * Validates bitwise permission checking, ADMIN bypass, and
 * combined role permissions.
 */

import { describe, it, expect } from "vitest";
import { hasPermission, hasAnyPermission, isAdmin } from "../services/permissions.service.js";
import { PermissionFlags } from "@reson8/shared-types";

describe("hasPermission", () => {
    it("returns true when the exact flag is present", () => {
        const perms = BigInt(PermissionFlags.CONNECT | PermissionFlags.SPEAK);
        expect(hasPermission(perms, BigInt(PermissionFlags.CONNECT))).toBe(true);
        expect(hasPermission(perms, BigInt(PermissionFlags.SPEAK))).toBe(true);
    });

    it("returns false when the flag is missing", () => {
        const perms = BigInt(PermissionFlags.CONNECT);
        expect(hasPermission(perms, BigInt(PermissionFlags.SPEAK))).toBe(false);
    });

    it("returns false for zero permissions", () => {
        expect(hasPermission(0n, BigInt(PermissionFlags.CONNECT))).toBe(false);
        expect(hasPermission(0n, BigInt(PermissionFlags.SPEAK))).toBe(false);
    });

    it("ADMIN flag bypasses all permission checks", () => {
        const perms = BigInt(PermissionFlags.ADMIN); // Only ADMIN, no other flags
        expect(hasPermission(perms, BigInt(PermissionFlags.CONNECT))).toBe(true);
        expect(hasPermission(perms, BigInt(PermissionFlags.SPEAK))).toBe(true);
        expect(hasPermission(perms, BigInt(PermissionFlags.KICK_USER))).toBe(true);
        expect(hasPermission(perms, BigInt(PermissionFlags.MANAGE_ROLES))).toBe(true);
    });

    it("works with combined permissions (OR'd flags)", () => {
        const perms = BigInt(
            PermissionFlags.CONNECT |
            PermissionFlags.SPEAK |
            PermissionFlags.SEND_MESSAGES |
            PermissionFlags.CREATE_CHANNEL,
        );
        expect(hasPermission(perms, BigInt(PermissionFlags.CREATE_CHANNEL))).toBe(true);
        expect(hasPermission(perms, BigInt(PermissionFlags.MANAGE_CHANNELS))).toBe(false);
    });
});

describe("hasAnyPermission", () => {
    it("returns true when at least one flag matches", () => {
        const perms = BigInt(PermissionFlags.SPEAK);
        expect(
            hasAnyPermission(
                perms,
                BigInt(PermissionFlags.CONNECT),
                BigInt(PermissionFlags.SPEAK),
            ),
        ).toBe(true);
    });

    it("returns false when no flags match", () => {
        const perms = BigInt(PermissionFlags.CONNECT);
        expect(
            hasAnyPermission(
                perms,
                BigInt(PermissionFlags.SPEAK),
                BigInt(PermissionFlags.KICK_USER),
            ),
        ).toBe(false);
    });

    it("ADMIN bypasses all checks", () => {
        const perms = BigInt(PermissionFlags.ADMIN);
        expect(
            hasAnyPermission(
                perms,
                BigInt(PermissionFlags.KICK_USER),
                BigInt(PermissionFlags.BAN_USER),
            ),
        ).toBe(true);
    });
});

describe("isAdmin", () => {
    it("returns true when ADMIN flag is set", () => {
        const perms = BigInt(PermissionFlags.ADMIN | PermissionFlags.CONNECT);
        expect(isAdmin(perms)).toBe(true);
    });

    it("returns false when ADMIN flag is not set", () => {
        const perms = BigInt(
            PermissionFlags.CONNECT |
            PermissionFlags.SPEAK |
            PermissionFlags.MANAGE_ROLES,
        );
        expect(isAdmin(perms)).toBe(false);
    });

    it("returns false for zero permissions", () => {
        expect(isAdmin(0n)).toBe(false);
    });
});
