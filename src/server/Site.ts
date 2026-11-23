import type { Database } from './Database.ts';

/** The site name, seeded by `seeds/0001_site_name.ts` and editable by whatever the project builds on `site_settings`. */
export function getSiteName(db: Database): string {
    const row = db.prepare('SELECT value FROM site_settings WHERE key = ?').get('site_name') as { value: string } | undefined;
    return row?.value ?? 'Site';
}
