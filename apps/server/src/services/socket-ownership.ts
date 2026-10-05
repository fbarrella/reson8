/**
 * Socket Ownership Registry (PRD 15.1).
 *
 * Presence, mediasoup sessions and the deferred-leave timer are all keyed by
 * `userId`, but a user can briefly have TWO live primary sockets: the new one
 * they just reconnected with, and the old half-open one the server hasn't
 * timed out yet (up to pingInterval + pingTimeout). Without knowing which
 * socket currently "owns" a userId, the old socket's eventual `disconnect`
 * destroys state that belongs to the new one.
 *
 * Pure (no Socket.io/Fastify imports) so it can be unit tested directly.
 */
export class SocketOwnership {
    private readonly owners = new Map<string, string>();

    /** Registers `socketId` as the owner of `userId`. Returns the previous
     *  owner's socket id when a *different* socket was displaced, else null. */
    claim(userId: string, socketId: string): string | null {
        const previous = this.owners.get(userId) ?? null;
        this.owners.set(userId, socketId);
        return previous !== null && previous !== socketId ? previous : null;
    }

    /** True when `socketId` is the current owner of `userId`. */
    isOwner(userId: string, socketId: string): boolean {
        return this.owners.get(userId) === socketId;
    }

    /** True when some socket currently owns `userId`. */
    hasOwner(userId: string): boolean {
        return this.owners.has(userId);
    }

    /** Clears ownership, but only if `socketId` is still the owner — a stale
     *  socket releasing late must not evict its replacement. */
    release(userId: string, socketId: string): boolean {
        if (!this.isOwner(userId, socketId)) return false;
        this.owners.delete(userId);
        return true;
    }
}
