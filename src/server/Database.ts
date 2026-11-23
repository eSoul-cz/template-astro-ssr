import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getSettings } from './Settings.ts';

export type Database = DatabaseSync;

/** Opens (and creates) the SQLite file: WAL, foreign keys on, a busy timeout instead of immediate `SQLITE_BUSY`. */
export function openDatabase(file: string): Database {
    mkdirSync(dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA synchronous = NORMAL');
    return db;
}

/** Runs `work` in one transaction: committed when it returns, rolled back when it throws. */
export function transaction<T>(db: Database, work: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
        const result = work();
        db.exec('COMMIT');
        return result;
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}

// Astro bundles `src/server/` into the server build, while `start.ts` imports the same files natively: two copies of
// this module. The one connection of the process is therefore kept on `globalThis`, so both copies share it and
// `start.ts` can close it on SIGTERM.
const slot = Symbol.for('esoul.app.database');
const holder = globalThis as { [slot]?: Database };

/** The connection of this process, opened on first use at `DATA_DIR/app.db`. */
export function getDatabase(): Database {
    return (holder[slot] ??= openDatabase(getSettings().databasePath));
}

export function closeDatabase(): void {
    holder[slot]?.close();
    holder[slot] = undefined;
}
