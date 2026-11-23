import { spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSettings, SettingsError } from '../src/server/Settings.ts';

const secret = 'x'.repeat(32);
const valid = { SESSION_SECRET: secret };

const issuesOf = (env: NodeJS.ProcessEnv) => {
    try {
        parseSettings(env);
    } catch (error) {
        if (error instanceof SettingsError) return error.issues.join('\n');
        throw error;
    }
    return '';
};

describe('parseSettings', () => {
    it('applies the defaults', () => {
        const settings = parseSettings(valid);
        expect(settings).toMatchObject({
            host: 'localhost',
            port: 4321,
            siteUrl: 'http://localhost:4321',
            loginMaxAttempts: 5,
            noindex: false,
            secureCookies: false,
        });
        expect(settings.sessionTtlMs).toBe(30 * 24 * 60 * 60 * 1000);
        expect(isAbsolute(settings.dataDir)).toBe(true);
        expect(settings.databasePath).toBe(`${settings.dataDir}/app.db`);
    });

    it('reads the values, treats empty variables as unset and marks https sites as secure', () => {
        const settings = parseSettings({
            ...valid,
            SITE_URL: 'https://example.com/',
            PORT: '8080',
            DATA_DIR: '/var/data',
            PUBLIC_NOINDEX: 'true',
            SESSION_TTL_DAYS: '',
            LOGIN_MAX_ATTEMPTS: '3',
        });
        expect(settings).toMatchObject({
            siteUrl: 'https://example.com',
            port: 8080,
            dataDir: '/var/data',
            databasePath: '/var/data/app.db',
            noindex: true,
            secureCookies: true,
            loginMaxAttempts: 3,
        });
        expect(settings.sessionTtlMs).toBe(30 * 24 * 60 * 60 * 1000);
    });

    it('names every invalid variable', () => {
        const issues = issuesOf({
            SESSION_SECRET: 'short',
            PORT: '70000',
            SITE_URL: 'http://example.com',
            PUBLIC_NOINDEX: 'maybe',
            LOGIN_MAX_ATTEMPTS: '0',
        });
        for (const name of ['SESSION_SECRET', 'PORT', 'SITE_URL', 'PUBLIC_NOINDEX', 'LOGIN_MAX_ATTEMPTS']) expect(issues).toContain(name);
    });

    it('requires the session secret', () => {
        expect(issuesOf({})).toContain('SESSION_SECRET');
        expect(issuesOf({ SESSION_SECRET: '' })).toContain('SESSION_SECRET');
    });

    it('refuses a SITE_URL that is not https unless it is local', () => {
        expect(issuesOf({ ...valid, SITE_URL: 'http://example.com' })).toContain('SITE_URL');
        expect(issuesOf({ ...valid, SITE_URL: 'not a url' })).toContain('SITE_URL');
        expect(issuesOf({ ...valid, SITE_URL: 'http://127.0.0.1:4330' })).toBe('');
    });
});

describe('the migrate script', () => {
    it('exits non-zero with a clear message on an invalid setting', () => {
        const result = spawnSync(process.execPath, ['src/server/migrate.ts'], {
            encoding: 'utf8',
            env: { PATH: process.env.PATH, SESSION_SECRET: 'short', PORT: 'abc' },
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('Invalid settings');
        expect(result.stderr).toContain('SESSION_SECRET');
        expect(result.stderr).toContain('PORT');
    });
});
