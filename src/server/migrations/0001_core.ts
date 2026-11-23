import type { Migration } from '../Migrator.ts';

export default {
    id: 1,
    name: 'core',
    up(db) {
        // AUTOINCREMENT: an admin id is never reused, so a page still showing a removed admin can't act on a newer one.
        db.exec(`
            CREATE TABLE admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                last_login_at INTEGER
            )
        `);
        // The cookie holds a random token; only its HMAC is stored, so a copy of the database holds no usable session.
        db.exec(`
            CREATE TABLE sessions (
                id INTEGER PRIMARY KEY,
                token_hash TEXT NOT NULL UNIQUE,
                admin_id INTEGER NOT NULL REFERENCES admins (id) ON DELETE CASCADE,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            )
        `);
        db.exec('CREATE INDEX sessions_admin_id ON sessions (admin_id)');
        db.exec('CREATE TABLE site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    },
} satisfies Migration;
