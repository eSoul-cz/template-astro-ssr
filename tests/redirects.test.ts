import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transaction } from '../src/server/Database.ts';
import { runMigrations } from '../src/server/Migrator.ts';
import { migrations } from '../src/server/migrations/index.ts';
import {
    flushRedirectHits,
    listRedirects,
    recordRedirectHit,
    recordSlugChange,
    removeRedirect,
    resolveRedirect,
    saveRedirect,
} from '../src/server/Redirects.ts';
import { memoryDatabase } from './helpers.ts';

const quiet = () => undefined;
const database = () => {
    const db = memoryDatabase();
    runMigrations(db, migrations, quiet);
    return db;
};
const pairs = (db: ReturnType<typeof database>) => listRedirects(db).map((row) => [row.from, row.to, row.status]);

describe('the redirects table', () => {
    it('starts empty and enforces the status and the target', () => {
        const db = database();
        expect(listRedirects(db)).toEqual([]);
        const insert = (from: string, to: string | null, status: number) =>
            db.prepare('INSERT INTO redirects (from_path, to_path, status, created_at, updated_at) VALUES (?, ?, ?, 0, 0)').run(from, to, status);
        expect(() => insert('/a', '/b', 302)).toThrow();
        expect(() => insert('/a', null, 301)).toThrow();
        expect(() => insert('/a', '/b', 410)).toThrow();
        insert('/a', '/b', 301);
        expect(() => insert('/a', '/c', 301)).toThrow(/UNIQUE/);
    });
});

describe('saveRedirect', () => {
    it('adds and edits a redirect and answers with the fresh list', () => {
        const db = database();
        const added = saveRedirect(db, undefined, { from: '/old/', to: '/new/', status: 301 }, 10);
        expect(added).toMatchObject({ ok: true });
        const id = listRedirects(db)[0]!.id;
        expect(pairs(db)).toEqual([['/old', '/new', 301]]);
        expect(saveRedirect(db, id, { from: '/old', to: 'ignored', status: 410 }, 20)).toMatchObject({ ok: true });
        expect(pairs(db)).toEqual([['/old', null, 410]]);
        expect(db.prepare('SELECT created_at, updated_at FROM redirects').get()).toEqual({ created_at: 10, updated_at: 20 });
    });

    it('refuses external targets, a loop, a chain and a taken address, and stores nothing', () => {
        const db = database();
        saveRedirect(db, undefined, { from: '/a', to: '/b', status: 301 });
        const refused = (from: string, to: string) => saveRedirect(db, undefined, { from, to, status: 301 });
        expect(refused('/x', 'https://evil.example')).toMatchObject({ ok: false, issues: { to: 'invalid' } });
        expect(refused('/x', '//evil.example')).toMatchObject({ ok: false, issues: { to: 'invalid' } });
        expect(refused('/x', '/a')).toMatchObject({ ok: false, issues: { to: 'chain' } });
        expect(refused('/b', '/a')).toMatchObject({ ok: false, issues: { to: 'loop' } });
        expect(refused('/x', '/x')).toMatchObject({ ok: false, issues: { to: 'same' } });
        expect(refused('/a', '/c')).toMatchObject({ ok: false, issues: { from: 'taken' } });
        expect(pairs(db)).toEqual([['/a', '/b', 301]]);
    });

    it('refuses an address other rows point at and lists those rows', () => {
        const db = database();
        saveRedirect(db, undefined, { from: '/a', to: '/b', status: 301 });
        saveRedirect(db, undefined, { from: '/c', to: '/b', status: 301 });
        expect(saveRedirect(db, undefined, { from: '/b', to: '', status: 410 })).toEqual({
            ok: false,
            reason: 'invalid',
            issues: { from: 'pointedAt' },
            pointedAt: ['/a', '/c'],
        });
        expect(pairs(db)).toHaveLength(2);
    });

    it('answers notFound for an id that is gone', () => {
        expect(saveRedirect(database(), 99, { from: '/a', to: '/b', status: 301 })).toEqual({ ok: false, reason: 'notFound' });
    });
});

describe('resolveRedirect', () => {
    it('finds the exact address, then the longest prefix rule, in any spelling of the path', () => {
        const db = database();
        saveRedirect(db, undefined, { from: '/blog/*', to: '/news', status: 301 });
        saveRedirect(db, undefined, { from: '/blog/old/*', to: '', status: 410 });
        saveRedirect(db, undefined, { from: '/blog/old/keep', to: '/kept', status: 301 });
        expect(resolveRedirect(db, '/blog/old/keep/')).toEqual({ from: '/blog/old/keep', to: '/kept', status: 301 });
        expect(resolveRedirect(db, '/blog/old/x')).toEqual({ from: '/blog/old/*', to: null, status: 410 });
        expect(resolveRedirect(db, '/blog/%C3%A9')?.to).toBe('/news');
        expect(resolveRedirect(db, '/blog')?.to).toBe('/news');
        expect(resolveRedirect(db, '/other')).toBeUndefined();
        expect(resolveRedirect(db, '//evil.example')).toBeUndefined();
    });

    it('serves from memory and drops the cache on every write', () => {
        const db = database();
        saveRedirect(db, undefined, { from: '/a', to: '/b', status: 301 });
        expect(resolveRedirect(db, '/a')?.to).toBe('/b');
        // A direct write is invisible until the cache is dropped: proof that the lookup does not read on every request.
        db.exec("UPDATE redirects SET to_path = '/direct'");
        expect(resolveRedirect(db, '/a')?.to).toBe('/b');
        const id = listRedirects(db)[0]!.id;
        saveRedirect(db, id, { from: '/a', to: '/c', status: 301 });
        expect(resolveRedirect(db, '/a')?.to).toBe('/c');
        removeRedirect(db, id);
        expect(resolveRedirect(db, '/a')).toBeUndefined();
        recordSlugChange(db, '/p', '/q');
        expect(resolveRedirect(db, '/p')?.to).toBe('/q');
    });
});

describe('rows from a migration', () => {
    const insert = (db: ReturnType<typeof database>, from: string, to: string | null) =>
        db
            .prepare('INSERT INTO redirects (from_path, to_path, status, created_at, updated_at) VALUES (?, ?, ?, 0, 0)')
            .run(from, to, to === null ? 410 : 301);

    it('are used only when a save could have written them', () => {
        const db = database();
        const warn = vi.spyOn(console, 'warn').mockImplementation(quiet);
        insert(db, '/typo', '//evil.example');
        insert(db, '/Old-Page/', '/new');
        insert(db, '/good', '/target');
        insert(db, '/50%-off', '/sale');
        expect(resolveRedirect(db, '/typo')).toBeUndefined();
        expect(resolveRedirect(db, '/old-page')).toBeUndefined();
        expect(resolveRedirect(db, '/good')?.to).toBe('/target');
        // The browser sends a literal % encoded; it is decoded once.
        expect(resolveRedirect(db, '/50%25-off')?.to).toBe('/sale');
        expect(warn).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });
});

describe('hits', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('are counted in memory and written by a flush, one update per rule', () => {
        const db = database();
        saveRedirect(db, undefined, { from: '/a', to: '/b', status: 301 });
        recordRedirectHit(db, '/a', 100);
        recordRedirectHit(db, '/a', 200);
        expect(listRedirects(db)[0]).toMatchObject({ hits: 0, lastHitAt: null });
        flushRedirectHits(db);
        expect(listRedirects(db)[0]).toMatchObject({ hits: 2, lastHitAt: 200 });
        flushRedirectHits(db);
        expect(listRedirects(db)[0]).toMatchObject({ hits: 2 });
    });

    it('are flushed every ten seconds without a call', () => {
        const db = database();
        saveRedirect(db, undefined, { from: '/a', to: '/b', status: 301 });
        recordRedirectHit(db, '/a');
        vi.advanceTimersByTime(9_999);
        expect(listRedirects(db)[0]).toMatchObject({ hits: 0 });
        vi.advanceTimersByTime(1);
        expect(listRedirects(db)[0]).toMatchObject({ hits: 1 });
    });

    it('never throw: a hit for a removed rule changes nothing, and a closed database only logs', () => {
        const db = database();
        const warn = vi.spyOn(console, 'warn').mockImplementation(quiet);
        recordRedirectHit(db, '/gone');
        expect(() => flushRedirectHits(db)).not.toThrow();
        recordRedirectHit(db, '/gone');
        db.close();
        expect(() => flushRedirectHits(db)).not.toThrow();
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });
});

describe('recordSlugChange', () => {
    it('redirects the old address to the new one and moves the rows that led to the old one', () => {
        const db = database();
        saveRedirect(db, undefined, { from: '/very-old', to: '/old', status: 301 });
        recordSlugChange(db, '/old', '/new');
        expect(pairs(db)).toEqual([
            ['/old', '/new', 301],
            ['/very-old', '/new', 301],
        ]);
    });

    it('removes the row of the new address (a move back) and turns a 410 of the old one into a 301', () => {
        const db = database();
        recordSlugChange(db, '/a', '/b');
        recordSlugChange(db, '/b', '/a');
        expect(pairs(db)).toEqual([['/b', '/a', 301]]);
        saveRedirect(db, undefined, { from: '/gone', to: '', status: 410 });
        recordSlugChange(db, '/gone', '/back');
        expect(pairs(db)).toContainEqual(['/gone', '/back', 301]);
    });

    it('ignores an unchanged or invalid address, and joins the transaction of the caller', () => {
        const db = database();
        recordSlugChange(db, '/a', '/a/');
        recordSlugChange(db, '/a', 'https://evil.example');
        expect(pairs(db)).toEqual([]);
        expect(() =>
            transaction(db, () => {
                recordSlugChange(db, '/a', '/b');
                throw new Error('the caller failed');
            }),
        ).toThrow('the caller failed');
        expect(pairs(db)).toEqual([]);
        transaction(db, () => recordSlugChange(db, '/a', '/b'));
        expect(pairs(db)).toEqual([['/a', '/b', 301]]);
    });
});
