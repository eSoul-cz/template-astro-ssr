import type { Seed } from '../Seeds.ts';
import siteName from './0001_site_name.ts';

/** The one place where seeds are registered. Ids are unique, in run order, and a seed that ran is never edited. */
export const seeds: readonly Seed[] = [siteName];
