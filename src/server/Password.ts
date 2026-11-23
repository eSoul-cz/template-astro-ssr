import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

/** scrypt with a random salt per password (OWASP: N = 2^16, r = 8, p = 2). The parameters are stored in the hash. */
export interface PasswordCost {
    readonly N: number;
    readonly r: number;
    readonly p: number;
}

export const defaultCost: PasswordCost = { N: 2 ** 16, r: 8, p: 2 };

const keyLength = 64;

const scryptAsync = promisify<string, Buffer, number, ScryptOptions, Buffer>(scrypt);

// maxmem: Node's default (32 MiB) is below what N = 2^16 needs (64 MiB).
const derive = (password: string, salt: Buffer, cost: PasswordCost) =>
    scryptAsync(password.normalize('NFKC'), salt, keyLength, { N: cost.N, r: cost.r, p: cost.p, maxmem: 256 * 1024 * 1024 });

/** `scrypt$N=65536,r=8,p=2$<salt>$<key>` (base64url). */
export async function hashPassword(password: string, cost: PasswordCost = defaultCost): Promise<string> {
    const salt = randomBytes(16);
    const key = await derive(password, salt, cost);
    return `scrypt$N=${cost.N},r=${cost.r},p=${cost.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/** `false` for a wrong password and for a stored hash that cannot be read. Compares in constant time. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const [scheme, params, salt, key] = stored.split('$');
    if (scheme !== 'scrypt' || !params || !salt || !key) return false;
    const match = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(params);
    if (!match) return false;
    const expected = Buffer.from(key, 'base64url');
    try {
        const actual = await derive(password, Buffer.from(salt, 'base64url'), { N: Number(match[1]), r: Number(match[2]), p: Number(match[3]) });
        return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
        return false;
    }
}
