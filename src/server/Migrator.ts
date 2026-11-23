import { transaction, type Database } from './Database.ts';

/**
 * A numbered, forward-only schema change. Add one as `migrations/<id>_<name>.ts` and register it in
 * `migrations/index.ts` (the only place). A migration from a parallel branch takes an id above everything merged.
 */
export interface Migration {
    readonly id: number;
    readonly name: string;
    up(db: Database): void;
}

export class MigrationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MigrationError';
    }
}

/**
 * Runs every registered migration that was not applied yet, in id order, each in a transaction together with its row in
 * `migrations`. Refuses to start (before running anything) when a registered migration has an id below the latest
 * applied one but never ran: it would be skipped silently, so it has to be renumbered. Returns the ids that ran.
 */
export function runMigrations(db: Database, registered: readonly Migration[], log: (message: string) => void = console.log): number[] {
    const migrations = [...registered].sort((a, b) => a.id - b.id);
    for (const [index, migration] of migrations.entries()) {
        if (!Number.isInteger(migration.id) || migration.id < 1) {
            throw new MigrationError(`Migration "${migration.name}" has an invalid id ${migration.id}: use a positive integer.`);
        }
        if (index > 0 && migrations[index - 1]!.id === migration.id) {
            throw new MigrationError(`Migrations "${migrations[index - 1]!.name}" and "${migration.name}" share the id ${migration.id}.`);
        }
    }

    db.exec('CREATE TABLE IF NOT EXISTS migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
    const applied = new Set((db.prepare('SELECT id FROM migrations').all() as { id: number }[]).map((row) => row.id));
    const latest = Math.max(0, ...applied);

    const skipped = migrations.filter((migration) => migration.id < latest && !applied.has(migration.id));
    if (skipped.length > 0) {
        throw new MigrationError(
            `Migrations ${skipped.map((migration) => `${migration.id} (${migration.name})`).join(', ')} have ids below the latest applied one (${latest}) and would never run. Renumber them above ${latest}.`,
        );
    }

    const ran: number[] = [];
    for (const migration of migrations) {
        if (applied.has(migration.id)) continue;
        try {
            transaction(db, () => {
                migration.up(db);
                db.prepare('INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)').run(migration.id, migration.name, Date.now());
            });
        } catch (error) {
            throw new MigrationError(
                `Migration ${migration.id} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        log(`Migration ${migration.id} (${migration.name}) applied`);
        ran.push(migration.id);
    }
    return ran;
}
