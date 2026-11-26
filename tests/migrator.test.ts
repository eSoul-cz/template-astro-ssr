import { describe, expect, it } from 'vitest';
import { MigrationError, runMigrations, type Migration } from '../src/server/Migrator.ts';
import { migrations } from '../src/server/migrations/index.ts';
import { memoryDatabase, tableNames } from './helpers.ts';

const quiet = () => undefined;
const create = (id: number, table: string): Migration => ({ id, name: table, up: (db) => db.exec(`CREATE TABLE ${table} (id INTEGER)`) });

describe('runMigrations', () => {
    it('runs migrations in id order whatever the registration order, and only once', () => {
        const db = memoryDatabase();
        const order: number[] = [];
        const record = (id: number): Migration => ({ id, name: `m${id}`, up: () => void order.push(id) });
        expect(runMigrations(db, [record(3), record(1), record(2)], quiet)).toEqual([1, 2, 3]);
        expect(order).toEqual([1, 2, 3]);
        expect(runMigrations(db, [record(3), record(1), record(2)], quiet)).toEqual([]);
        expect(order).toEqual([1, 2, 3]);
    });

    it('applies only the new migrations later on', () => {
        const db = memoryDatabase();
        runMigrations(db, [create(1, 'a')], quiet);
        expect(runMigrations(db, [create(1, 'a'), create(2, 'b')], quiet)).toEqual([2]);
        expect(tableNames(db)).toEqual(expect.arrayContaining(['a', 'b', 'migrations']));
    });

    it('refuses to start when a registered migration below the latest applied one never ran', () => {
        const db = memoryDatabase();
        runMigrations(db, [create(1, 'a'), create(3, 'c')], quiet);
        expect(() => runMigrations(db, [create(1, 'a'), create(2, 'b'), create(3, 'c')], quiet)).toThrow(MigrationError);
        expect(() => runMigrations(db, [create(1, 'a'), create(2, 'b'), create(3, 'c')], quiet)).toThrow(/2 \(b\).*latest applied one \(3\)/);
        expect(tableNames(db)).not.toContain('b');
    });

    it('runs nothing when the gap is detected, even for a migration above the latest one', () => {
        const db = memoryDatabase();
        runMigrations(db, [create(1, 'a'), create(3, 'c')], quiet);
        expect(() => runMigrations(db, [create(1, 'a'), create(2, 'b'), create(3, 'c'), create(4, 'd')], quiet)).toThrow(MigrationError);
        expect(tableNames(db)).not.toContain('d');
    });

    it('rolls a failing migration back together with its marker and stops there', () => {
        const db = memoryDatabase();
        const failing: Migration = {
            id: 2,
            name: 'broken',
            up: (database) => {
                database.exec('CREATE TABLE half (id INTEGER)');
                throw new Error('boom');
            },
        };
        expect(() => runMigrations(db, [create(1, 'a'), failing, create(3, 'c')], quiet)).toThrow(/Migration 2 \(broken\) failed: boom/);
        expect(tableNames(db)).toEqual(expect.arrayContaining(['a']));
        expect(tableNames(db)).not.toContain('half');
        expect(tableNames(db)).not.toContain('c');
        expect((db.prepare('SELECT id FROM migrations ORDER BY id').all() as { id: number }[]).map((row) => row.id)).toEqual([1]);
    });

    it('rejects duplicate and invalid ids', () => {
        expect(() => runMigrations(memoryDatabase(), [create(1, 'a'), create(1, 'b')], quiet)).toThrow(/share the id 1/);
        expect(() => runMigrations(memoryDatabase(), [create(0, 'a')], quiet)).toThrow(/invalid id/);
    });

    it('applies the registered migrations of the template to an empty database', () => {
        const db = memoryDatabase();
        runMigrations(db, migrations, quiet);
        expect(tableNames(db)).toEqual(expect.arrayContaining(['admins', 'sessions', 'site_settings', 'redirects', 'migrations']));
    });
});
