import { describe, expect, it } from 'vitest';
import { defaultCost, hashPassword, verifyPassword } from '../src/server/Password.ts';
import { cheapCost } from './helpers.ts';

describe('passwords', () => {
    it('hashes with scrypt and the default cost, and verifies', { timeout: 30_000 }, async () => {
        const hash = await hashPassword('correct horse battery staple');
        expect(hash).toMatch(/^scrypt\$N=65536,r=8,p=2\$[\w-]+\$[\w-]+$/);
        expect(defaultCost.N).toBe(65536);
        expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
        expect(await verifyPassword('correct horse battery stapl', hash)).toBe(false);
    });

    it('uses a different salt for every password', async () => {
        const [first, second] = await Promise.all([hashPassword('same password', cheapCost), hashPassword('same password', cheapCost)]);
        expect(first).not.toBe(second);
        expect(await verifyPassword('same password', first)).toBe(true);
        expect(await verifyPassword('same password', second)).toBe(true);
    });

    it('verifies against the cost stored in the hash', async () => {
        const hash = await hashPassword('another password', { N: 2048, r: 8, p: 1 });
        expect(hash).toContain('N=2048,r=8,p=1');
        expect(await verifyPassword('another password', hash)).toBe(true);
    });

    it('normalises Unicode, so the same text typed differently matches', async () => {
        const hash = await hashPassword('caf\u00e9 password', cheapCost);
        expect(await verifyPassword('cafe\u0301 password', hash)).toBe(true);
    });

    it('says no to a hash it cannot read', async () => {
        for (const stored of ['', 'plain', 'scrypt$N=1,r=1,p=1$a$b', 'argon2$x$y$z', 'scrypt$bad$salt$key']) {
            expect(await verifyPassword('anything', stored)).toBe(false);
        }
    });
});
