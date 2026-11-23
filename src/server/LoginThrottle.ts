import { createHmac } from 'node:crypto';

export type ThrottleResult = { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

interface Window {
    count: number;
    resetAt: number;
}

/** Above this many tracked pairs, expired windows are dropped before a new one is added, so memory stays bounded. */
const pruneAbove = 10_000;

/**
 * Limits password attempts per client address + account (e-mail): `maxAttempts` per `windowMs`. In memory, so it is per
 * process (the stack runs one container) and a restart resets it. Each attempt counts before the slow password check, so
 * parallel requests cannot slip extra guesses past the limit; a successful login clears the pair. Keys are HMACs, so a
 * long e-mail cannot fill the memory and nothing readable is kept.
 */
export class LoginThrottle {
    readonly #windows = new Map<string, Window>();
    readonly #secret: string;
    readonly #maxAttempts: number;
    readonly #windowMs: number;
    readonly #now: () => number;

    constructor(secret: string, maxAttempts: number, windowMs: number, now: () => number = Date.now) {
        this.#secret = secret;
        this.#maxAttempts = maxAttempts;
        this.#windowMs = windowMs;
        this.#now = now;
    }

    /** Counts an attempt, or refuses it when the limit is used up. Call before verifying the password. */
    attempt(clientAddress: string, email: string): ThrottleResult {
        const now = this.#now();
        const key = this.#key(clientAddress, email);
        let window = this.#windows.get(key);
        if (!window || window.resetAt <= now) {
            if (this.#windows.size >= pruneAbove) this.#prune(now);
            window = { count: 0, resetAt: now + this.#windowMs };
            this.#windows.set(key, window);
        }
        if (window.count >= this.#maxAttempts) return { allowed: false, retryAfterSeconds: Math.ceil((window.resetAt - now) / 1000) };
        window.count += 1;
        return { allowed: true };
    }

    /** The password was right: forget the failures of this pair. */
    succeeded(clientAddress: string, email: string): void {
        this.#windows.delete(this.#key(clientAddress, email));
    }

    #key(clientAddress: string, email: string): string {
        return createHmac('sha256', this.#secret).update(`${clientAddress}|${email.trim().toLowerCase()}`).digest('base64url');
    }

    #prune(now: number): void {
        for (const [key, window] of this.#windows) if (window.resetAt <= now) this.#windows.delete(key);
    }
}
