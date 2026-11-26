import type { Migration } from '../Migrator.ts';
import core from './0001_core.ts';
import redirects from './0002_redirects.ts';

/** The one place where migrations are registered. Ids are unique and only ever grow. */
export const migrations: readonly Migration[] = [core, redirects];
