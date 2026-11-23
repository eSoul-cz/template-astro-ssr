import type { Database } from './Database.ts';
import type { LoginThrottle } from './LoginThrottle.ts';
import { hashPassword, verifyPassword, type PasswordCost } from './Password.ts';
import { createSession, revokeAdminSessions, type Admin, type NewSession } from './Sessions.ts';

export class AuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AuthError';
    }
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const minPasswordLength = 12;
export const maxPasswordLength = 200;

/** `undefined` when the password is acceptable, otherwise what is wrong with it. */
export function passwordProblem(password: string): string | undefined {
    if (password.length < minPasswordLength) return `The password must have at least ${minPasswordLength} characters.`;
    if (password.length > maxPasswordLength) return `The password must have at most ${maxPasswordLength} characters.`;
    return undefined;
}

/** Creates an admin account. The only way in: `pnpm admin:create` (no seed, no default account). Returns the new id. */
export async function createAdmin(db: Database, email: string, password: string, cost?: PasswordCost): Promise<number> {
    const address = normalizeEmail(email);
    if (!emailPattern.test(address)) throw new AuthError('The e-mail address is not valid.');
    const problem = passwordProblem(password);
    if (problem) throw new AuthError(problem);
    if (db.prepare('SELECT 1 FROM admins WHERE email = ?').get(address)) throw new AuthError(`An admin with the e-mail ${address} already exists.`);
    const result = db
        .prepare('INSERT INTO admins (email, password_hash, created_at) VALUES (?, ?, ?)')
        .run(address, await hashPassword(password, cost), Date.now());
    return Number(result.lastInsertRowid);
}

/** Sets a new password and ends every session of the admin. */
export async function resetAdminPassword(db: Database, email: string, password: string, cost?: PasswordCost): Promise<void> {
    const problem = passwordProblem(password);
    if (problem) throw new AuthError(problem);
    const admin = db.prepare('SELECT id FROM admins WHERE email = ?').get(normalizeEmail(email)) as { id: number } | undefined;
    if (!admin) throw new AuthError(`No admin with the e-mail ${normalizeEmail(email)}.`);
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(await hashPassword(password, cost), admin.id);
    revokeAdminSessions(db, admin.id);
}

export interface LoginContext {
    readonly db: Database;
    readonly throttle: LoginThrottle;
    readonly sessionSecret: string;
    readonly sessionTtlMs: number;
}

export type LoginResult =
    | { readonly ok: true; readonly admin: Admin; readonly session: NewSession }
    | { readonly ok: false; readonly reason: 'invalid' }
    | { readonly ok: false; readonly reason: 'throttled'; readonly retryAfterSeconds: number };

// A hash that no password matches: an unknown e-mail costs the same time as a wrong password, so the response time does
// not reveal which accounts exist.
let unknownAccountHash: Promise<string> | undefined;

/** Checks the credentials. A wrong password and an unknown e-mail give the same result. */
export async function login(context: LoginContext, input: { email: string; password: string; clientAddress: string }): Promise<LoginResult> {
    const { db, throttle } = context;
    const email = normalizeEmail(input.email);
    const attempt = throttle.attempt(input.clientAddress, email);
    if (!attempt.allowed) return { ok: false, reason: 'throttled', retryAfterSeconds: attempt.retryAfterSeconds };

    const row = db.prepare('SELECT id, email, password_hash FROM admins WHERE email = ?').get(email) as
        { id: number; email: string; password_hash: string } | undefined;
    unknownAccountHash ??= hashPassword(crypto.randomUUID());
    const valid = await verifyPassword(input.password, row?.password_hash ?? (await unknownAccountHash));
    if (!row || !valid) return { ok: false, reason: 'invalid' };

    throttle.succeeded(input.clientAddress, email);
    db.prepare('UPDATE admins SET last_login_at = ? WHERE id = ?').run(Date.now(), row.id);
    const session = createSession(db, context.sessionSecret, row.id, context.sessionTtlMs);
    return { ok: true, admin: { id: row.id, email: row.email }, session };
}
