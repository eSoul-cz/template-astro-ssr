import { transaction, type Database } from './Database.ts';

/**
 * Data the application needs on first start (texts, default settings). A seed runs **once per database**, in id order, in
 * a transaction together with its row in `seeds`, and never again, even when the data is edited or deleted later. A
 * changed starting value is a new seed that replaces the old one only where it is still unedited. Add one as
 * `seeds/<id>_<name>.ts` and register it in `seeds/index.ts`.
 *
 * Seeds never create accounts: the first admin is created with `pnpm admin:create` (see README).
 */
export interface Seed {
    /** `0001_name`: four digits, a lowercase name. The ids define the order. */
    readonly id: string;
    run(db: Database): void;
}

export class SeedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SeedError';
    }
}

const idPattern = /^\d{4}_[a-z0-9_]+$/;

/** Returns the ids of the seeds that ran now. A failing seed rolls back and stops the start. */
export function runSeeds(db: Database, registered: readonly Seed[], log: (message: string) => void = console.log): string[] {
    const seeds = [...registered].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const [index, seed] of seeds.entries()) {
        if (!idPattern.test(seed.id)) throw new SeedError(`Seed id "${seed.id}" does not look like 0001_name.`);
        if (index > 0 && seeds[index - 1]!.id === seed.id) throw new SeedError(`Two seeds share the id ${seed.id}.`);
    }

    db.exec('CREATE TABLE IF NOT EXISTS seeds (id TEXT PRIMARY KEY, ran_at INTEGER NOT NULL)');
    const ran: string[] = [];
    for (const seed of seeds) {
        try {
            const executed = transaction(db, () => {
                if (db.prepare('SELECT 1 FROM seeds WHERE id = ?').get(seed.id)) return false;
                seed.run(db);
                db.prepare('INSERT INTO seeds (id, ran_at) VALUES (?, ?)').run(seed.id, Date.now());
                return true;
            });
            if (executed) {
                log(`Seed ${seed.id} ran`);
                ran.push(seed.id);
            }
        } catch (error) {
            throw new SeedError(`Seed ${seed.id} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return ran;
}
