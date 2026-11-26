import type { APIContext, MiddlewareNext } from 'astro';
import { defineMiddleware } from 'astro:middleware';
import { adminPath, loginPath, sessionAdmin } from './lib/session.ts';
import { isReservedPath } from './server/redirect-input.ts';
import { recordRedirectHit, resolveRedirect, type ResolvedRedirect } from './server/Redirects.ts';
import { runtime } from './server/runtime.ts';

/** Nothing in this template uploads files: a request body is a small form. Larger ones are refused before they are read. */
const maxBodyBytes = 64 * 1024;

/** On every response. HSTS is the reverse proxy's job (it ends TLS); the CSP of the pages is set by Astro (`security.csp`). */
const securityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/$/, '') : path);
const isAdminPath = (path: string) => trimSlash(path) === adminPath || path.startsWith(`${adminPath}/`);

/** An action call: `/_actions/<name>` from scripts, `?_action=<name>` from a form posted without JavaScript. */
const isActionRequest = (url: URL) => url.pathname.startsWith('/_actions/') || url.searchParams.has('_action');

/** `413` for a body above the limit, `411` for a body of unknown length (a browser never sends one for a form). */
function refuseLargeBody(request: Request): Response | undefined {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return undefined;
    const length = request.headers.get('content-length');
    if (length === null) {
        return request.headers.has('transfer-encoding') ? new Response(null, { status: 411, statusText: 'Length Required' }) : undefined;
    }
    return Number(length) > maxBodyBytes ? new Response(null, { status: 413, statusText: 'Content Too Large' }) : undefined;
}

/** Sets headers, on a copy when the response's headers are immutable (e.g. from `Response.redirect`). */
function withHeaders(response: Response, headers: Record<string, string>): Response {
    try {
        for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
        return response;
    } catch {
        const copy = new Response(response.body, response);
        for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value);
        return copy;
    }
}

/**
 * The redirect row for an address, or nothing; a failing lookup never turns a 404 into a 500. The admin and the
 * application's own endpoints have none.
 */
function findRedirect(path: string): ResolvedRedirect | undefined {
    if (isReservedPath(path)) return undefined;
    try {
        return resolveRedirect(runtime().db, path);
    } catch (error) {
        console.error(`Looking up a redirect for ${path} failed: ${String(error)}`);
        return undefined;
    }
}

/**
 * Answers a request that would end in 404 with its redirect row: a 301 to the target (the query string goes along), a 410
 * with the 404 page. A dynamic route answers its 404 without a body, so the page is rendered here, whatever the route
 * returned. The use is counted in memory, never waited for.
 */
async function answerWithRedirect(context: APIContext, rule: ResolvedRedirect): Promise<Response> {
    if (context.request.method === 'GET') {
        try {
            recordRedirectHit(runtime().db, rule.from);
        } catch (error) {
            console.error(`Counting a redirect hit failed: ${String(error)}`);
        }
    }
    if (rule.status === 301 && rule.to !== null) return context.redirect(`${encodeURI(rule.to)}${context.url.search}`, 301);
    const page = await context.rewrite('/404');
    const headers = new Headers(page.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'text/html');
    return new Response(page.body, { status: 410, statusText: 'Gone', headers });
}

/** Session lookup, the admin gate (every `/admin` page but the sign-in page needs a session) and the redirects of old addresses. */
async function guard(context: APIContext, next: MiddlewareNext): Promise<Response> {
    const { pathname } = context.url;
    if (pathname === '/healthz') return next();

    const admin = sessionAdmin(context.cookies);
    context.locals.admin = admin;
    const isSafe = context.request.method === 'GET' || context.request.method === 'HEAD';
    if (!isAdminPath(pathname)) {
        // A redirect row applies only where the site has no page: the response must be a 404 first.
        const response = await next();
        if (!isSafe || response.status !== 404) return response;
        // The raw path: Astro has decoded `pathname` already, and the lookup decodes once itself (a literal `%` would fail twice).
        const rule = findRedirect(new URL(context.request.url).pathname);
        return rule ? answerWithRedirect(context, rule) : response;
    }
    if (trimSlash(pathname) === loginPath) return admin && isSafe ? context.redirect(adminPath) : next();
    return admin ? next() : context.redirect(loginPath, isSafe ? 302 : 303);
}

export const onRequest = defineMiddleware(async (context, next) => {
    // A page with `prerender = true` is rendered once at build time, without a request (no cookies, no body): nothing to
    // guard there. The adapter serves such files without this middleware, so they get their headers from the web server.
    const response = context.isPrerendered ? await next() : (refuseLargeBody(context.request) ?? (await guard(context, next)));
    const headers: Record<string, string> = { ...securityHeaders };
    // Admin pages and action answers are per user: never cached, and Back after signing out asks the server again.
    if (isAdminPath(context.url.pathname) || isActionRequest(context.url)) headers['Cache-Control'] = 'private, no-store';
    else if (!response.headers.has('Cache-Control') && (response.headers.get('Content-Type') ?? '').startsWith('text/html')) {
        headers['Cache-Control'] = 'no-cache';
    }
    if (isAdminPath(context.url.pathname)) headers['X-Robots-Tag'] = 'noindex, nofollow';
    return withHeaders(response, headers);
});
