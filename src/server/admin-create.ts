import { AuthError, createAdmin, resetAdminPassword } from './Auth.ts';
import { closeDatabase } from './Database.ts';
import { migrateDatabaseOrExit } from './prepare.ts';
import { loadSettingsOrExit } from './Settings.ts';

/**
 * `pnpm admin:create <email>`: creates the admin account, the only way to get a first one (no seed ships credentials).
 * The password is read from the terminal without echo, or from stdin when it is piped (`printf '%s' "$PASSWORD" | ...`),
 * and is never an argument, so it stays out of the shell history and the process list.
 * `--reset` sets a new password for an existing admin and ends their sessions.
 * In the container: `docker compose exec -u app app node src/server/admin-create.ts <email>`.
 */

const usage = 'Usage: pnpm admin:create <email> [--reset]';

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const email = args.find((arg) => !arg.startsWith('--'));
if (!email) {
    console.error(usage);
    process.exit(2);
}

/** Reads a line from the terminal without echoing it. */
function readHidden(prompt: string): Promise<string> {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const stdin = process.stdin;
    process.stderr.write(prompt);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
        for (const char of chunk) {
            if (char === '\u0003') {
                stdin.setRawMode(false);
                reject(new Error('Cancelled'));
                return;
            }
            if (char === '\r' || char === '\n') {
                stdin.setRawMode(false);
                stdin.pause();
                stdin.off('data', onData);
                process.stderr.write('\n');
                resolve(value);
                return;
            }
            if (char === '\u007f') value = value.slice(0, -1);
            else value += char;
        }
    };
    stdin.on('data', onData);
    return promise;
}

async function readPassword(): Promise<string> {
    if (process.stdin.isTTY) {
        const password = await readHidden('Password: ');
        if (password !== (await readHidden('Repeat the password: '))) throw new AuthError('The passwords do not match.');
        return password;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks)
        .toString('utf8')
        .replace(/\r?\n$/, '');
}

loadSettingsOrExit();
try {
    const password = await readPassword();
    const db = migrateDatabaseOrExit();
    if (reset) {
        await resetAdminPassword(db, email, password);
        console.log(`Password of ${email.trim().toLowerCase()} changed, its sessions ended`);
    } else {
        await createAdmin(db, email, password);
        console.log(`Admin ${email.trim().toLowerCase()} created`);
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
} finally {
    closeDatabase();
}
