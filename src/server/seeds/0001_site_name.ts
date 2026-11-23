import type { Seed } from '../Seeds.ts';

/** An example: the starting site name, shown on the home page and in the admin. Replace it with the project's own. */
export default {
    id: '0001_site_name',
    run(db) {
        db.prepare('INSERT INTO site_settings (key, value) VALUES (?, ?)').run('site_name', 'Example');
    },
} satisfies Seed;
