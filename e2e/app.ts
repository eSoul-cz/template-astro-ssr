import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdmin } from '../src/server/Auth.ts';
import { closeDatabase, openDatabase } from '../src/server/Database.ts';

export interface App {
    readonly baseURL: string;
    readonly dataDir: string;
    /** An admin account made through the server's own module with a random password, never a fixed one. */
    readonly admin: { readonly email: string; readonly password: string };
    /** Everything the server printed so far. */
    output(): string;
    /** Sends SIGTERM and resolves with the exit code. */
    stop(): Promise<number | null>;
    /** Removes the data directory (call after `stop`). */
    cleanup(): void;
}

export interface StartOptions {
    /** Reuse a data directory (a restart); a new temporary one by default. */
    readonly dataDir?: string;
    readonly env?: Record<string, string>;
    /** Run `src/server/seed.ts` before the start, like a developer does by hand (the start never seeds). Default: true. */
    readonly seed?: boolean;
    /** Create the admin after the start. Default: true; `false` when the schema is not expected to exist (the credentials are returned, not created). */
    readonly admin?: boolean;
}

const freePort = () =>
    new Promise<number>((resolve, reject) => {
        const probe = createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address() as { port: number };
            probe.close(() => resolve(port));
        });
    });

async function waitForHealth(baseURL: string, child: ChildProcess, output: () => string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
        if (child.exitCode !== null) throw new Error(`The server exited with ${child.exitCode} before it was ready:\n${output()}`);
        try {
            if ((await fetch(`${baseURL}/healthz`)).ok) return;
        } catch {
            // not listening yet
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`The server did not become healthy:\n${output()}`);
}

/** Starts the built server (`node src/server/start.ts`, what the image runs) on a temporary data directory. */
export async function startApp(options: StartOptions = {}): Promise<App> {
    if (!existsSync('dist/server/entry.mjs')) throw new Error('dist/ is missing: run `pnpm build` before the e2e tests.');
    const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'app-e2e-'));
    const port = await freePort();
    const baseURL = `http://127.0.0.1:${port}`;

    const env = {
        PATH: process.env.PATH,
        HOST: '127.0.0.1',
        PORT: String(port),
        SITE_URL: baseURL,
        DATA_DIR: dataDir,
        SESSION_SECRET: randomBytes(32).toString('base64url'),
        ...options.env,
    };
    if (options.seed !== false) {
        const seeded = spawnSync(process.execPath, ['src/server/seed.ts'], { env, encoding: 'utf8' });
        if (seeded.status !== 0) {
            if (!options.dataDir) rmSync(dataDir, { recursive: true, force: true });
            throw new Error(`The seed script exited with ${seeded.status}:\n${seeded.stdout}${seeded.stderr}`);
        }
    }

    let log = '';
    const child = spawn(process.execPath, ['src/server/start.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => (log += chunk));
    child.stderr.on('data', (chunk) => (log += chunk));
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
    try {
        await waitForHealth(baseURL, child, () => log);
    } catch (error) {
        child.kill('SIGKILL');
        if (!options.dataDir) rmSync(dataDir, { recursive: true, force: true });
        throw error;
    }

    // The migrations have run: create the admin the way `pnpm admin:create` does, with the server's own module.
    const admin = { email: 'e2e-admin@example.com', password: randomBytes(18).toString('base64url') };
    if (options.admin !== false) {
        const db = openDatabase(join(dataDir, 'app.db'));
        try {
            if (!db.prepare('SELECT 1 FROM admins WHERE email = ?').get(admin.email)) await createAdmin(db, admin.email, admin.password);
        } finally {
            db.close();
            closeDatabase();
        }
    }

    return {
        baseURL,
        dataDir,
        admin,
        output: () => log,
        stop: () => {
            child.kill('SIGTERM');
            return exited;
        },
        cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
    };
}
