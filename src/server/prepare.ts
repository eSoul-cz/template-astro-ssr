import { getDatabase, type Database } from './Database.ts';
import { runMigrations } from './Migrator.ts';
import { migrations } from './migrations/index.ts';
import { seeds } from './seeds/index.ts';
import { runSeeds } from './Seeds.ts';

/** Opens the database and applies every pending migration (forward-only). It never seeds. */
export function migrateDatabase(): Database {
    const db = getDatabase();
    runMigrations(db, migrations);
    return db;
}

/**
 * For the production start: a failing migration does not block the deployment. It is logged loudly and the server starts
 * anyway, so whoever monitors the deployment reads it and decides (fix forward or roll back). Returns whether it worked.
 */
export function migrateDatabaseOrLog(migrate: () => unknown = migrateDatabase, log: (message: string) => void = console.error): boolean {
    try {
        migrate();
        return true;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        log(`MIGRATION FAILED: ${reason}\nThe server starts anyway and the schema may be behind the code.`);
        return false;
    }
}

/** For scripts: a failure (a migration, the database file) is printed and exits non-zero. */
export function migrateDatabaseOrExit(): Database {
    try {
        return migrateDatabase();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

/** Runs the seeds that never ran. Only by hand (`pnpm seed`); the production start never calls it. */
export function seedDatabase(db: Database): string[] {
    return runSeeds(db, seeds);
}
