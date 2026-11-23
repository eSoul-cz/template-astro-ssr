import { expect, test as base } from '@playwright/test';
import { openDatabase } from '../src/server/Database.ts';
import { startApp, type App } from './app.ts';

// What a browser sends with a form post from the site's own page (Astro's origin check looks at it).
const sameOrigin = { 'Sec-Fetch-Site': 'same-origin' };

// One server per worker, on its own data directory.
const test = base.extend<object, { app: App }>({
    app: [
        // eslint-disable-next-line no-empty-pattern
        async ({}, use) => {
            const app = await startApp();
            await use(app);
            await app.stop();
            app.cleanup();
        },
        { scope: 'worker' },
    ],
});

test.describe('public pages', () => {
    test('the health endpoint answers ok after a database query and is never cached', async ({ app, request }) => {
        const response = await request.get(`${app.baseURL}/healthz`);
        expect(response.status()).toBe(200);
        expect(await response.json()).toEqual({ status: 'ok' });
        expect(response.headers()['cache-control']).toBe('no-store');
    });

    test('the home page has the security headers, a CSP without unsafe-inline scripts and no console errors', async ({ app, page }) => {
        const errors: string[] = [];
        page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
        const response = await page.goto(`${app.baseURL}/`);
        expect(response?.status()).toBe(200);
        const headers = response?.headers() ?? {};
        expect(headers['x-content-type-options']).toBe('nosniff');
        expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
        expect(headers['x-frame-options']).toBe('DENY');
        expect(headers['cache-control']).toBe('no-cache');

        // The CSP comes from Astro as a header; the page's own inline style is allowed by its hash, not by 'unsafe-inline'.
        const csp = headers['content-security-policy'] ?? '';
        expect(csp).toContain("default-src 'self'");
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).toMatch(/style-src [^;]*'sha256-/);
        expect(csp).not.toMatch(/'unsafe-(inline|eval)'/);
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${app.baseURL}/`);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Example');
        expect(errors).toEqual([]);
    });

    test('an unknown page is a 404 with the headers', async ({ app, request }) => {
        const response = await request.get(`${app.baseURL}/no-such-page`);
        expect(response.status()).toBe(404);
        expect(response.headers()['x-content-type-options']).toBe('nosniff');
        expect(await response.text()).toContain('Page not found');
    });

    test('robots.txt, the sitemap and llms.txt follow the site settings', async ({ app, request }) => {
        const robots = await (await request.get(`${app.baseURL}/robots.txt`)).text();
        expect(robots).toContain('Disallow: /admin/');
        expect(robots).toContain(`Sitemap: ${app.baseURL}/sitemap.xml`);
        const sitemap = await (await request.get(`${app.baseURL}/sitemap.xml`)).text();
        expect(sitemap).toContain(`<loc>${app.baseURL}/</loc>`);
        expect(sitemap).not.toContain('/admin');
        expect(await (await request.get(`${app.baseURL}/llms.txt`)).text()).toContain('# Example');
    });
});

test.describe('admin', () => {
    test('an admin page without a session redirects to the sign-in page and is never cached', async ({ app, request }) => {
        const response = await request.get(`${app.baseURL}/admin`, { maxRedirects: 0 });
        expect(response.status()).toBe(302);
        expect(response.headers().location).toBe('/admin/login');
        expect(response.headers()['cache-control']).toBe('private, no-store');
    });

    test('a wrong password shows one message and creates no session', async ({ app, page, context }) => {
        await page.goto(`${app.baseURL}/admin/login`);
        await page.getByLabel('E-mail').fill(app.admin.email);
        await page.getByLabel('Password').fill('not the right password');
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(page.getByRole('alert')).toHaveText('Wrong e-mail or password.');
        expect((await context.cookies()).filter((cookie) => cookie.name === 'session')).toEqual([]);
        // The same message for an unknown account.
        await page.getByLabel('E-mail').fill('nobody@example.com');
        await page.getByLabel('Password').fill('not the right password');
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(page.getByRole('alert')).toHaveText('Wrong e-mail or password.');
    });

    test('signs in with the generated account, shows the shell and signs out', async ({ app, page, context }) => {
        await page.goto(`${app.baseURL}/admin`);
        await expect(page).toHaveURL(`${app.baseURL}/admin/login`);
        await page.getByLabel('E-mail').fill(app.admin.email);
        await page.getByLabel('Password').fill(app.admin.password);
        await page.getByRole('button', { name: 'Sign in' }).click();

        await expect(page).toHaveURL(`${app.baseURL}/admin`);
        await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible();
        await expect(page.getByRole('banner').getByText(app.admin.email)).toBeVisible();
        const cookie = (await context.cookies()).find((candidate) => candidate.name === 'session');
        expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });

        await page.getByRole('button', { name: 'Sign out' }).click();
        await expect(page).toHaveURL(`${app.baseURL}/admin/login`);
        await page.goto(`${app.baseURL}/admin`);
        await expect(page).toHaveURL(`${app.baseURL}/admin/login`);
    });

    test('works without JavaScript: a plain form post signs in', async ({ app, browser }) => {
        const context = await browser.newContext({ javaScriptEnabled: false });
        const page = await context.newPage();
        await page.goto(`${app.baseURL}/admin/login`);
        await page.getByLabel('E-mail').fill(app.admin.email);
        await page.getByLabel('Password').fill(app.admin.password);
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(page).toHaveURL(`${app.baseURL}/admin`);
        await context.close();
    });

    test('refuses a form post from another origin and an oversized body', async ({ app, request }) => {
        const foreign = await request.post(`${app.baseURL}/admin/login?_action=login`, {
            form: { email: app.admin.email, password: app.admin.password },
            headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
            maxRedirects: 0,
        });
        expect(foreign.status()).toBe(403);
        const large = await request.post(`${app.baseURL}/admin/login?_action=login`, {
            data: 'x'.repeat(70_000),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...sameOrigin },
            maxRedirects: 0,
        });
        expect(large.status()).toBe(413);
    });

    test('an action call without a session is refused', async ({ app, request }) => {
        const response = await request.post(`${app.baseURL}/_actions/logout/`, { form: {}, headers: sameOrigin });
        expect(response.status()).toBe(401);
    });
});

test.describe('process', () => {
    test('the session cookie is Secure when the site is served over https', async ({ request }) => {
        const app = await startApp({ env: { SITE_URL: 'https://app.example.test' } });
        try {
            const response = await request.post(`${app.baseURL}/admin/login?_action=login`, {
                form: { email: app.admin.email, password: app.admin.password },
                headers: sameOrigin,
                maxRedirects: 0,
            });
            expect(response.status()).toBe(303);
            const cookie = response.headersArray().find((header) => header.name.toLowerCase() === 'set-cookie')?.value ?? '';
            expect(cookie).toMatch(/HttpOnly/i);
            expect(cookie).toMatch(/SameSite=Lax/i);
            expect(cookie).toMatch(/Secure/i);
        } finally {
            await app.stop();
            app.cleanup();
        }
    });

    test('SIGTERM stops the server gracefully with exit code 0, and a restart does not run the seeds again', async () => {
        const first = await startApp();
        expect(first.output()).toContain('Seed 0001_site_name ran');
        // The client edits seeded data...
        const db = openDatabase(`${first.dataDir}/app.db`);
        db.prepare("UPDATE site_settings SET value = 'Edited by the client' WHERE key = 'site_name'").run();
        db.close();

        expect(await first.stop()).toBe(0);
        expect(first.output()).toContain('SIGTERM received');

        // ...and the next start keeps it: migrations and seeds that ran are never repeated.
        const second = await startApp({ dataDir: first.dataDir });
        try {
            expect(second.output()).not.toContain('Seed ');
            expect(second.output()).not.toContain('Migration ');
            expect(await (await fetch(`${second.baseURL}/llms.txt`)).text()).toContain('# Edited by the client');
            expect(await second.stop()).toBe(0);
        } finally {
            second.cleanup();
        }
    });

    test('an invalid setting stops the start before the server listens', async () => {
        await expect(startApp({ env: { SESSION_SECRET: 'short' } })).rejects.toThrow(/exited with 1[\s\S]*SESSION_SECRET/);
    });
});
