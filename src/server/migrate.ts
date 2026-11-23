import { closeDatabase } from './Database.ts';
import { prepareDatabaseOrExit } from './prepare.ts';
import { loadSettingsOrExit } from './Settings.ts';

/** `pnpm migrate`: validates the settings, runs migrations and seeds, exits. The server does the same when it starts. */
loadSettingsOrExit();
prepareDatabaseOrExit();
closeDatabase();
console.log('Database is up to date');
