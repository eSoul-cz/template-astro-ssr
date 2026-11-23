import { openDatabase, type Database } from '../src/server/Database.ts';
import type { PasswordCost } from '../src/server/Password.ts';

/** A fresh in-memory database per test. */
export const memoryDatabase = (): Database => openDatabase(':memory:');

/** Cheap scrypt parameters: the tests check the logic, not the cost. */
export const cheapCost: PasswordCost = { N: 1024, r: 8, p: 1 };

export const tableNames = (db: Database): string[] =>
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
