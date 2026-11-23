import type { LoginContext } from './Auth.ts';
import { getDatabase, type Database } from './Database.ts';
import { LoginThrottle } from './LoginThrottle.ts';
import { getSettings, type Settings } from './Settings.ts';

export interface Runtime extends LoginContext {
    readonly settings: Settings;
    readonly db: Database;
}

let throttle: LoginThrottle | undefined;

/** What pages, actions and the middleware use: settings, the database and the login throttle of this process. */
export function runtime(): Runtime {
    const settings = getSettings();
    throttle ??= new LoginThrottle(settings.sessionSecret, settings.loginMaxAttempts, settings.loginWindowMs);
    return { settings, db: getDatabase(), throttle, sessionSecret: settings.sessionSecret, sessionTtlMs: settings.sessionTtlMs };
}
