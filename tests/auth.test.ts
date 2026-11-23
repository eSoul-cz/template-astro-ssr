import { describe, expect, it } from 'vitest';
import { AuthError, createAdmin, login, resetAdminPassword, type LoginContext } from '../src/server/Auth.ts';
import { LoginThrottle } from '../src/server/LoginThrottle.ts';
import { runMigrations } from '../src/server/Migrator.ts';
import { migrations } from '../src/server/migrations/index.ts';
import { createSession, findAdminBySession, revokeSession } from '../src/server/Sessions.ts';
import { cheapCost, memoryDatabase } from './helpers.ts';

const secret = 'test-secret-test-secret-test-secret';
const password = 'correct horse battery staple';

const setup = (maxAttempts = 3, now: () => number = Date.now) => {
    const db = memoryDatabase();
    runMigrations(db, migrations, () => undefined);
    const throttle = new LoginThrottle(secret, maxAttempts, 60_000, now);
    const context: LoginContext = { db, throttle, sessionSecret: secret, sessionTtlMs: 3_600_000 };
    return { db, throttle, context };
};
const attempt = (context: LoginContext, email: string, pass: string, clientAddress = '203.0.113.7') =>
    login(context, { email, password: pass, clientAddress });

describe('admin accounts', () => {
    it('creates an admin with a normalised e-mail and a hashed password', async () => {
        const { db } = setup();
        await createAdmin(db, '  Admin@Example.COM ', password, cheapCost);
        const row = db.prepare('SELECT email, password_hash FROM admins').get() as { email: string; password_hash: string };
        expect(row.email).toBe('admin@example.com');
        expect(row.password_hash).toMatch(/^scrypt\$/);
        expect(row.password_hash).not.toContain(password);
    });

    it('refuses a bad e-mail, a short password and a duplicate', async () => {
        const { db } = setup();
        await expect(createAdmin(db, 'nobody', password, cheapCost)).rejects.toThrow(AuthError);
        await expect(createAdmin(db, 'a@example.com', 'too short', cheapCost)).rejects.toThrow(/at least 12/);
        await createAdmin(db, 'a@example.com', password, cheapCost);
        await expect(createAdmin(db, 'A@EXAMPLE.com', password, cheapCost)).rejects.toThrow(/already exists/);
    });

    it('seeds no account: a fresh database has none', () => {
        const { db } = setup();
        expect(db.prepare('SELECT COUNT(*) AS count FROM admins').get()).toEqual({ count: 0 });
    });
});

describe('login and sessions', () => {
    it('signs in with the right password and returns a session the cookie token resolves to', async () => {
        const { db, context } = setup();
        await createAdmin(db, 'admin@example.com', password, cheapCost);
        const result = await attempt(context, 'ADMIN@example.com', password);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(findAdminBySession(db, secret, result.session.token)).toEqual({ id: result.admin.id, email: 'admin@example.com' });
        // Only a hash of the token is stored.
        expect(JSON.stringify(db.prepare('SELECT * FROM sessions').all())).not.toContain(result.session.token);
    });

    it('answers a wrong password and an unknown e-mail the same way', async () => {
        const { db, context } = setup();
        await createAdmin(db, 'admin@example.com', password, cheapCost);
        expect(await attempt(context, 'admin@example.com', 'wrong password!!')).toEqual({ ok: false, reason: 'invalid' });
        expect(await attempt(context, 'nobody@example.com', password)).toEqual({ ok: false, reason: 'invalid' });
    });

    it('ends a session on revoke, on expiry and when the password is reset', async () => {
        const { db, context } = setup();
        const id = await createAdmin(db, 'admin@example.com', password, cheapCost);
        const now = Date.now();
        const first = createSession(db, secret, id, 1000, now);
        expect(findAdminBySession(db, secret, first.token, now + 999)).toBeDefined();
        expect(findAdminBySession(db, secret, first.token, now + 1000)).toBeUndefined();

        const second = createSession(db, secret, id, 60_000);
        revokeSession(db, secret, second.token);
        expect(findAdminBySession(db, secret, second.token)).toBeUndefined();

        const third = await attempt(context, 'admin@example.com', password);
        if (!third.ok) throw new Error('login failed');
        await resetAdminPassword(db, 'admin@example.com', 'a brand new password', cheapCost);
        expect(findAdminBySession(db, secret, third.session.token)).toBeUndefined();
        expect((await attempt(context, 'admin@example.com', password)).ok).toBe(false);
        expect((await attempt(context, 'admin@example.com', 'a brand new password')).ok).toBe(true);
    });
});

describe('login throttle', () => {
    it('refuses attempts above the limit per client and account, and says when to retry', async () => {
        let now = 1_000_000;
        const { db, context } = setup(3, () => now);
        await createAdmin(db, 'admin@example.com', password, cheapCost);
        for (let i = 0; i < 3; i++) expect(await attempt(context, 'admin@example.com', 'wrong password!!')).toEqual({ ok: false, reason: 'invalid' });
        // Even the right password is refused while the window is used up.
        expect(await attempt(context, 'admin@example.com', password)).toEqual({ ok: false, reason: 'throttled', retryAfterSeconds: 60 });
        now += 30_000;
        expect(await attempt(context, 'admin@example.com', password)).toMatchObject({ ok: false, reason: 'throttled', retryAfterSeconds: 30 });
        now += 30_000;
        expect((await attempt(context, 'admin@example.com', password)).ok).toBe(true);
    });

    it('counts per client and per account, not globally', async () => {
        const { db, context } = setup(2);
        await createAdmin(db, 'admin@example.com', password, cheapCost);
        for (let i = 0; i < 2; i++) await attempt(context, 'admin@example.com', 'wrong password!!', '198.51.100.1');
        expect(await attempt(context, 'admin@example.com', 'wrong password!!', '198.51.100.1')).toMatchObject({ reason: 'throttled' });
        expect((await attempt(context, 'admin@example.com', password, '198.51.100.2')).ok).toBe(true);
        expect(await attempt(context, 'other@example.com', 'wrong password!!', '198.51.100.1')).toEqual({ ok: false, reason: 'invalid' });
    });

    it('a successful login clears the failures of the pair', async () => {
        const { db, context } = setup(2);
        await createAdmin(db, 'admin@example.com', password, cheapCost);
        await attempt(context, 'admin@example.com', 'wrong password!!');
        expect((await attempt(context, 'admin@example.com', password)).ok).toBe(true);
        await attempt(context, 'admin@example.com', 'wrong password!!');
        expect((await attempt(context, 'admin@example.com', password)).ok).toBe(true);
    });
});
