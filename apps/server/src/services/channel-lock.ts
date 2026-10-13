/**
 * A per-key async mutex (PRD 19 A4): `withChannelLock(key, fn)` runs `fn` only
 * after every earlier call on the same key has settled, so a check-then-act
 * sequence on one voice channel cannot interleave with another one. Calls on
 * different keys run concurrently. A rejected call does not break the chain,
 * and a key's entry is removed once its chain has drained.
 */

const tails = new Map<string, Promise<void>>();

export function withChannelLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(fn);
    // The stored tail never rejects, so the next caller always runs.
    const tail = run.then(
        () => undefined,
        () => undefined,
    );
    tails.set(key, tail);
    void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
}

/** How many keys currently hold a lock chain (for tests). */
export function channelLockCount(): number {
    return tails.size;
}
