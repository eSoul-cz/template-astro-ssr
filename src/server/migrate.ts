import { closeDatabase } from './Database.ts';
import { migrateDatabaseOrExit } from './prepare.ts';
import { loadSettingsOrExit } from './Settings.ts';

/** `pnpm migrate`: validates the settings, applies pending migrations, exits. The server does the same when it starts. */
loadSettingsOrExit();
migrateDatabaseOrExit();
closeDatabase();
console.log('Database is up to date');
