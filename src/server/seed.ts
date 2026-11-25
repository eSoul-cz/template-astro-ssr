import { closeDatabase } from './Database.ts';
import { migrateDatabaseOrExit, seedDatabase } from './prepare.ts';
import { loadSettingsOrExit } from './Settings.ts';

/**
 * `pnpm seed`: validates the settings, applies pending migrations, runs the seeds that never ran, exits. Seeding is a
 * deliberate act of a developer, never part of the start: `pnpm dev` runs it locally, and a deployed container is
 * seeded by hand (`docker compose exec -u app app node src/server/seed.ts`).
 */
loadSettingsOrExit();
const db = migrateDatabaseOrExit();
try {
    const ran = seedDatabase(db);
    console.log(ran.length === 0 ? 'No seed to run' : `${ran.length} seed(s) ran`);
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
} finally {
    closeDatabase();
}
