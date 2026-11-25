import { describe, expect, it } from 'vitest';
import { migrateDatabaseOrLog } from '../src/server/prepare.ts';

describe('migrateDatabaseOrLog (the production start)', () => {
    it('reports success and logs nothing', () => {
        const lines: string[] = [];
        const log = (line: string) => lines.push(line);
        expect(migrateDatabaseOrLog(() => undefined, log)).toBe(true);
        expect(lines).toEqual([]);
    });

    it('logs a failing migration loudly and does not throw, so the server still starts', () => {
        const lines: string[] = [];
        const log = (line: string) => lines.push(line);
        const failing = () => {
            throw new Error('Migration 2 failed: no such table');
        };
        expect(migrateDatabaseOrLog(failing, log)).toBe(false);
        expect(lines.join('\n')).toContain('MIGRATION FAILED: Migration 2 failed: no such table');
        expect(lines.join('\n')).toContain('starts anyway');
    });
});
