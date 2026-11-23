import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'astro/zod';

/**
 * Every setting of the application, read from the environment and validated once. Validation runs when the migrations
 * run and when the server starts (`src/server/start.ts`), so an invalid value fails the deploy, not a request.
 * No `astro:*` imports: the scripts in `src/server/` run this file directly on Node.
 */

/** An empty variable (`NAME=` in `.env`) counts as not set, so the default applies. */
const blankIsUnset = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankIsUnset, schema);

const localHosts = ['localhost', '127.0.0.1', '[::1]'];

const schema = z.object({
    HOST: optional(z.string().min(1).default('localhost')),
    PORT: optional(z.coerce.number().int().min(1).max(65535).default(4321)),
    SITE_URL: optional(
        z
            .url()
            .default('http://localhost:4321')
            .refine((value) => {
                // The URL check above already reports an unparsable value.
                if (!URL.canParse(value)) return true;
                const url = new URL(value);
                return url.protocol === 'https:' || (url.protocol === 'http:' && localHosts.includes(url.hostname));
            }, 'must be an https:// address (http:// only for localhost)'),
    ),
    DATA_DIR: optional(z.string().min(1).default('data')),
    SESSION_SECRET: z.string({ error: 'is required' }).min(32, 'must be at least 32 characters (generate one with `openssl rand -base64 32`)'),
    SESSION_TTL_DAYS: optional(z.coerce.number().int().min(1).max(365).default(30)),
    LOGIN_MAX_ATTEMPTS: optional(z.coerce.number().int().min(1).max(100).default(5)),
    LOGIN_WINDOW_MINUTES: optional(z.coerce.number().int().min(1).max(1440).default(15)),
    PUBLIC_NOINDEX: optional(z.enum(['true', 'false'], { error: 'must be true or false' }).default('false')),
});

export interface Settings {
    readonly host: string;
    readonly port: number;
    /** Canonical origin without a trailing slash (canonical links, sitemap, cookie `Secure` flag). */
    readonly siteUrl: string;
    /** Absolute path of the directory with the SQLite file (a bind mount in production). */
    readonly dataDir: string;
    readonly databasePath: string;
    readonly sessionSecret: string;
    readonly sessionTtlMs: number;
    readonly loginMaxAttempts: number;
    readonly loginWindowMs: number;
    /** Staging gate: every page is `noindex`, robots.txt disallows everything, the sitemap is empty. */
    readonly noindex: boolean;
    /** The session cookie is `Secure` whenever the site is served over https. */
    readonly secureCookies: boolean;
}

export class SettingsError extends Error {
    readonly issues: readonly string[];

    constructor(issues: readonly string[]) {
        super(`Invalid settings:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
        this.name = 'SettingsError';
        this.issues = issues;
    }
}

const minute = 60_000;
const day = 24 * 60 * minute;

export function parseSettings(env: NodeJS.ProcessEnv): Settings {
    const parsed = schema.safeParse(env);
    if (!parsed.success) {
        throw new SettingsError(parsed.error.issues.map((issue) => `${issue.path.join('.') || 'settings'}: ${issue.message}`));
    }
    const values = parsed.data;
    const url = new URL(values.SITE_URL);
    const dataDir = isAbsolute(values.DATA_DIR) ? values.DATA_DIR : resolve(values.DATA_DIR);
    return {
        host: values.HOST,
        port: values.PORT,
        siteUrl: url.origin,
        dataDir,
        databasePath: join(dataDir, 'app.db'),
        sessionSecret: values.SESSION_SECRET,
        sessionTtlMs: values.SESSION_TTL_DAYS * day,
        loginMaxAttempts: values.LOGIN_MAX_ATTEMPTS,
        loginWindowMs: values.LOGIN_WINDOW_MINUTES * minute,
        noindex: values.PUBLIC_NOINDEX === 'true',
        secureCookies: url.protocol === 'https:',
    };
}

let cached: Settings | undefined;

/** The settings of this process, parsed on first use. */
export function getSettings(): Settings {
    return (cached ??= parseSettings(process.env));
}

/** For scripts: prints every problem and exits non-zero instead of throwing. */
export function loadSettingsOrExit(): Settings {
    try {
        return getSettings();
    } catch (error) {
        console.error(error instanceof SettingsError ? error.message : error);
        process.exit(1);
    }
}
