import { getDatabase, type Database } from './Database.ts';
import { runMigrations } from './Migrator.ts';
import { migrations } from './migrations/index.ts';
import { seeds } from './seeds/index.ts';
import { runSeeds } from './Seeds.ts';

/** Opens the database and brings it up to date: every pending migration, then every seed that never ran. */
export function prepareDatabase(): Database {
    const db = getDatabase();
    runMigrations(db, migrations);
    runSeeds(db, seeds);
    return db;
}

/** For scripts: a failure (a migration, a seed, the database file) is printed and exits non-zero. */
export function prepareDatabaseOrExit(): Database {
    try {
        return prepareDatabase();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}
