import type { Migration } from '../Migrator.ts';

export default {
    id: 2,
    name: 'redirects',
    up(db) {
        // No rows: a project adds the redirects of its old site as its own migration (see the README, "Redirects").
        // `from_path` is the canonical form (see `normalizePath`); a path ending in `*` is a prefix rule. A 301 has a
        // target, a 410 has none. `hits` and `last_hit_at` are best effort.
        db.exec(`
            CREATE TABLE redirects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_path TEXT NOT NULL UNIQUE,
                to_path TEXT,
                status INTEGER NOT NULL CHECK (status IN (301, 410)),
                hits INTEGER NOT NULL DEFAULT 0,
                last_hit_at INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                CHECK ((status = 301 AND to_path IS NOT NULL) OR (status = 410 AND to_path IS NULL))
            )
        `);
    },
} satisfies Migration;
