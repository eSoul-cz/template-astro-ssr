import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/server/Migrator.ts';
import { migrations } from '../src/server/migrations/index.ts';
import { runSeeds, SeedError, type Seed } from '../src/server/Seeds.ts';
import { seeds } from '../src/server/seeds/index.ts';
import { getSiteName } from '../src/server/Site.ts';
import { memoryDatabase } from './helpers.ts';

const quiet = () => undefined;
const withNotes = () => {
    const db = memoryDatabase();
    db.exec('CREATE TABLE notes (text TEXT)');
    return db;
};
const note = (id: string, text: string): Seed => ({ id, run: (db) => void db.prepare('INSERT INTO notes (text) VALUES (?)').run(text) });
const texts = (db: ReturnType<typeof memoryDatabase>) =>
    (db.prepare('SELECT text FROM notes ORDER BY rowid').all() as { text: string }[]).map((row) => row.text);

describe('runSeeds', () => {
    it('runs seeds in id order, once', () => {
        const db = withNotes();
        const all = [note('0002_second', 'b'), note('0001_first', 'a')];
        expect(runSeeds(db, all, quiet)).toEqual(['0001_first', '0002_second']);
        expect(texts(db)).toEqual(['a', 'b']);
        expect(runSeeds(db, all, quiet)).toEqual([]);
        expect(texts(db)).toEqual(['a', 'b']);
    });

    it('never runs a seed again, even when its data was edited or deleted later', () => {
        const db = withNotes();
        const all = [note('0001_first', 'a')];
        runSeeds(db, all, quiet);
        db.exec("UPDATE notes SET text = 'edited by the client'");
        runSeeds(db, all, quiet);
        expect(texts(db)).toEqual(['edited by the client']);
        db.exec('DELETE FROM notes');
        runSeeds(db, all, quiet);
        expect(texts(db)).toEqual([]);
    });

    it('rolls a failing seed back together with its marker, keeps the earlier ones, and runs it again once fixed', () => {
        const db = withNotes();
        const failing: Seed = {
            id: '0002_broken',
            run: (database) => {
                database.prepare('INSERT INTO notes (text) VALUES (?)').run('half written');
                throw new Error('boom');
            },
        };
        expect(() => runSeeds(db, [note('0001_first', 'a'), failing, note('0003_third', 'c')], quiet)).toThrow(SeedError);
        expect(texts(db)).toEqual(['a']);
        expect((db.prepare('SELECT id FROM seeds ORDER BY id').all() as { id: string }[]).map((row) => row.id)).toEqual(['0001_first']);

        expect(runSeeds(db, [note('0001_first', 'a'), note('0002_broken', 'b'), note('0003_third', 'c')], quiet)).toEqual([
            '0002_broken',
            '0003_third',
        ]);
        expect(texts(db)).toEqual(['a', 'b', 'c']);
    });

    it('rejects ids that are not 0001_name and duplicate ids', () => {
        expect(() => runSeeds(withNotes(), [note('first', 'a')], quiet)).toThrow(/does not look like/);
        expect(() => runSeeds(withNotes(), [note('0001_a', 'a'), note('0001_a', 'b')], quiet)).toThrow(/share the id/);
    });

    it('seeds the site name of the template after the migrations', () => {
        const db = memoryDatabase();
        runMigrations(db, migrations, quiet);
        expect(runSeeds(db, seeds, quiet)).toEqual(['0001_site_name']);
        expect(getSiteName(db)).toBe('Example');
        db.prepare("UPDATE site_settings SET value = 'Client' WHERE key = 'site_name'").run();
        runSeeds(db, seeds, quiet);
        expect(getSiteName(db)).toBe('Client');
    });
});
