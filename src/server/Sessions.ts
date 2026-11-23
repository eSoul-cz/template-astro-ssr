import { createHmac, randomBytes } from 'node:crypto';
import type { Database } from './Database.ts';

export interface Admin {
    readonly id: number;
    readonly email: string;
}

export interface NewSession {
    /** The value of the cookie. Only its HMAC is stored. */
    readonly token: string;
    readonly expiresAt: number;
}

const hashToken = (secret: string, token: string) => createHmac('sha256', secret).update(token).digest('base64url');

/** Starts a session of `ttlMs` for the admin and drops the expired ones. A new token on every login. */
export function createSession(db: Database, secret: string, adminId: number, ttlMs: number, now = Date.now()): NewSession {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now + ttlMs;
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    db.prepare('INSERT INTO sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
        hashToken(secret, token),
        adminId,
        now,
        expiresAt,
    );
    return { token, expiresAt };
}

/** The admin a cookie value belongs to, or `undefined` for an unknown or expired session. */
export function findAdminBySession(db: Database, secret: string, token: string, now = Date.now()): Admin | undefined {
    const row = db
        .prepare(
            `SELECT admins.id, admins.email FROM sessions JOIN admins ON admins.id = sessions.admin_id
             WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
        )
        .get(hashToken(secret, token), now) as Admin | undefined;
    return row && { id: row.id, email: row.email };
}

export function revokeSession(db: Database, secret: string, token: string): void {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(secret, token));
}

/** Ends every session of the admin: after a password reset, and when an admin is deactivated. */
export function revokeAdminSessions(db: Database, adminId: number): void {
    db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(adminId);
}
