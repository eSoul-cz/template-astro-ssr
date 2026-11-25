import type { Server } from 'node:http';
import { closeDatabase } from './Database.ts';
import { migrateDatabaseOrLog } from './prepare.ts';
import { loadSettingsOrExit } from './Settings.ts';

/**
 * Production entry (`pnpm start`, the Docker image): validates the settings, applies pending migrations, then starts the
 * built Astro server. An invalid setting exits non-zero before the server listens. A failing migration does not: it is
 * logged loudly and the server starts anyway. The start never runs the seeds (`pnpm seed`, by hand).
 *
 * The Node adapter does not handle stop signals (its `standalone.js` only listens). So the adapter's autostart is
 * switched off, `startServer()` is called here, and on SIGTERM / SIGINT the server stops accepting connections, lets
 * in-flight requests finish, closes the database and exits 0; after `graceMs` it closes the remaining connections.
 */
process.env.ASTRO_NODE_AUTOSTART = 'disabled';

const graceMs = 8_000;

loadSettingsOrExit();
migrateDatabaseOrLog();

// A dynamic import: the entry is build output (it does not exist while this file is type-checked) and it reads
// ASTRO_NODE_AUTOSTART when it is loaded, so it must be imported after the assignment above.
const entry = new URL('../../dist/server/entry.mjs', import.meta.url);
const { startServer } = (await import(entry.href)) as { startServer: () => { server: { server: Server } } };
const http = startServer().server.server;

let stopping = false;
const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received, stopping`);
    setTimeout(() => http.closeAllConnections(), graceMs).unref();
    http.close(() => {
        closeDatabase();
        process.exit(0);
    });
    http.closeIdleConnections();
};
process.once('SIGTERM', () => stop('SIGTERM'));
process.once('SIGINT', () => stop('SIGINT'));
