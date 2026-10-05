import { describe, it, expect } from "vitest";
import { SocketOwnership } from "../services/socket-ownership.js";

describe("SocketOwnership", () => {
    it("first claim displaces nobody", () => {
        const o = new SocketOwnership();
        expect(o.claim("u1", "a")).toBeNull();
        expect(o.isOwner("u1", "a")).toBe(true);
    });

    it("a second socket displaces the first and becomes owner", () => {
        const o = new SocketOwnership();
        o.claim("u1", "a");
        expect(o.claim("u1", "b")).toBe("a");
        expect(o.isOwner("u1", "a")).toBe(false);
        expect(o.isOwner("u1", "b")).toBe(true);
    });

    it("re-claiming with the same socket id displaces nobody", () => {
        const o = new SocketOwnership();
        o.claim("u1", "a");
        expect(o.claim("u1", "a")).toBeNull();
    });

    it("a stale socket releasing late does not evict its replacement", () => {
        const o = new SocketOwnership();
        o.claim("u1", "a");
        o.claim("u1", "b");
        expect(o.release("u1", "a")).toBe(false);
        expect(o.hasOwner("u1")).toBe(true);
        expect(o.isOwner("u1", "b")).toBe(true);
    });

    it("the owner releasing clears ownership", () => {
        const o = new SocketOwnership();
        o.claim("u1", "a");
        expect(o.release("u1", "a")).toBe(true);
        expect(o.hasOwner("u1")).toBe(false);
    });

    it("users are tracked independently", () => {
        const o = new SocketOwnership();
        o.claim("u1", "a");
        o.claim("u2", "b");
        expect(o.isOwner("u1", "a")).toBe(true);
        expect(o.isOwner("u2", "b")).toBe(true);
    });
});
