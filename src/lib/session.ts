import type { AstroCookies } from 'astro';
import { ActionError } from 'astro:actions';
import { runtime } from '../server/runtime.ts';
import { findAdminBySession, type Admin, type NewSession } from '../server/Sessions.ts';

/** Outside `src/server/` because it uses Astro's cookies and `astro:actions`. */

export const sessionCookie = 'session';

export const loginPath = '/admin/login';
export const adminPath = '/admin';

export function setSessionCookie(cookies: AstroCookies, { token, expiresAt }: NewSession): void {
    cookies.set(sessionCookie, token, {
        httpOnly: true,
        secure: runtime().settings.secureCookies,
        sameSite: 'lax',
        path: '/',
        expires: new Date(expiresAt),
    });
}

export const clearSessionCookie = (cookies: AstroCookies) => cookies.delete(sessionCookie, { path: '/' });

/** The admin of the session cookie, or `undefined` (an unknown or expired token clears the cookie). */
export function sessionAdmin(cookies: AstroCookies): Admin | undefined {
    const token = cookies.get(sessionCookie)?.value;
    if (!token) return undefined;
    const { db, sessionSecret } = runtime();
    const admin = findAdminBySession(db, sessionSecret, token);
    if (!admin) clearSessionCookie(cookies);
    return admin;
}

/** The first line of every action except login: refuses a request without a session. */
export function requireAdmin(context: { locals: App.Locals; cookies: AstroCookies }): Admin {
    const admin = context.locals.admin ?? sessionAdmin(context.cookies);
    if (!admin) throw new ActionError({ code: 'UNAUTHORIZED', message: 'Sign in first.' });
    return admin;
}
