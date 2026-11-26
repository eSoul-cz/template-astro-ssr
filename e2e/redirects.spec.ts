import { expect, test as base, type Page } from '@playwright/test';
import { openDatabase } from '../src/server/Database.ts';
import { startApp, type App } from './app.ts';

const sameOrigin = { 'Sec-Fetch-Site': 'same-origin' };

// One server per worker, with the rows the public tests need written before the first request (the lookup reads the
// table once and keeps it until the admin changes it).
const test = base.extend<object, { app: App }>({
    app: [
        // eslint-disable-next-line no-empty-pattern
        async ({}, use) => {
            const app = await startApp();
            const db = openDatabase(`${app.dataDir}/app.db`);
            const insert = db.prepare('INSERT INTO redirects (from_path, to_path, status, created_at, updated_at) VALUES (?, ?, ?, 0, 0)');
            insert.run('/old-page', '/', 301);
            insert.run('/old-section/*', '/', 301);
            insert.run('/removed', null, 410);
            // Stored decoded: the browser asks for `/50%25-off`.
            insert.run('/50%-off', '/', 301);
            // A row for an address the site really serves: it must never hide the page.
            insert.run('/llms.txt', '/', 301);
            db.close();
            await use(app);
            await app.stop();
            app.cleanup();
        },
        { scope: 'worker' },
    ],
});

const signIn = async (page: Page, app: App) => {
    await page.goto(`${app.baseURL}/admin/login`);
    await page.getByLabel('E-mail').fill(app.admin.email);
    await page.getByLabel('Password').fill(app.admin.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(`${app.baseURL}/admin`);
};

test.describe('old addresses', () => {
    test('a 301 keeps the query string, with and without the trailing slash, and a prefix rule covers what is under it', async ({ app, request }) => {
        const exact = await request.get(`${app.baseURL}/old-page/?utm=1`, { maxRedirects: 0 });
        expect(exact.status()).toBe(301);
        expect(exact.headers().location).toBe('/?utm=1');
        expect((await request.get(`${app.baseURL}/old-page`, { maxRedirects: 0 })).status()).toBe(301);
        const prefix = await request.get(`${app.baseURL}/old-section/deep/page`, { maxRedirects: 0 });
        expect(prefix.status()).toBe(301);
        expect(prefix.headers().location).toBe('/');
        expect(prefix.headers()['x-content-type-options']).toBe('nosniff');
    });

    test('a literal percent sign in the address is decoded once', async ({ app, request }) => {
        const response = await request.get(`${app.baseURL}/50%25-off`, { maxRedirects: 0 });
        expect(response.status()).toBe(301);
        expect(response.headers().location).toBe('/');
    });

    test('a 410 shows the 404 page as html with the status 410', async ({ app, request }) => {
        const response = await request.get(`${app.baseURL}/removed`);
        expect(response.status()).toBe(410);
        expect(response.headers()['content-type']).toContain('text/html');
        expect(response.headers()['x-content-type-options']).toBe('nosniff');
        expect(await response.text()).toContain('Page not found');
        expect((await request.head(`${app.baseURL}/removed`)).status()).toBe(410);
    });

    test('a row never hides a page the site serves', async ({ app, request }) => {
        const response = await request.get(`${app.baseURL}/llms.txt`, { maxRedirects: 0 });
        expect(response.status()).toBe(200);
        expect(await response.text()).toContain('# Example');
    });

    test('an address without a row stays a 404, and only a read is redirected', async ({ app, request }) => {
        expect((await request.get(`${app.baseURL}/no-such-page`)).status()).toBe(404);
        const post = await request.post(`${app.baseURL}/old-page`, { form: {}, headers: sameOrigin, maxRedirects: 0 });
        expect(post.status()).not.toBe(301);
    });

    test('the hits are written when the server stops', async () => {
        const app = await startApp();
        try {
            const db = openDatabase(`${app.dataDir}/app.db`);
            db.prepare("INSERT INTO redirects (from_path, to_path, status, created_at, updated_at) VALUES ('/counted', '/', 301, 0, 0)").run();
            db.close();
            await fetch(`${app.baseURL}/counted`, { redirect: 'manual' });
            await fetch(`${app.baseURL}/counted`, { redirect: 'manual' });
            expect(await app.stop()).toBe(0);
            const after = openDatabase(`${app.dataDir}/app.db`);
            expect(after.prepare("SELECT hits FROM redirects WHERE from_path = '/counted'").get()).toEqual({ hits: 2 });
            after.close();
        } finally {
            app.cleanup();
        }
    });
});

test.describe('admin', () => {
    test('the actions are refused without a session', async ({ app, request }) => {
        for (const action of ['redirects.save', 'redirects.remove']) {
            const response = await request.post(`${app.baseURL}/_actions/${action}/`, {
                form: { from: '/x', to: '/', status: '301', id: '1' },
                headers: sameOrigin,
            });
            expect(response.status()).toBe(401);
        }
        const page = await request.get(`${app.baseURL}/admin/redirects`, { maxRedirects: 0 });
        expect(page.status()).toBe(302);
        expect(page.headers().location).toBe('/admin/login');
    });

    test('adds a redirect that works at once, refuses a loop and an external target, edits and deletes', async ({ app, page, request }) => {
        await signIn(page, app);
        await page.getByRole('link', { name: 'Redirects' }).click();
        await expect(page.getByRole('heading', { name: 'Redirects', level: 1 })).toBeVisible();
        const form = page.getByRole('form', { name: 'Add redirect' });

        await form.locator('input[name=from]').fill('/from-admin');
        await form.locator('input[name=to]').fill('/to-admin');
        await form.getByRole('button', { name: 'Add' }).click();
        await expect(page.getByRole('row', { name: /\/from-admin/ })).toContainText('/to-admin');
        // The cache was dropped by the save: the new row answers without a restart.
        const live = await request.get(`${app.baseURL}/from-admin?a=b`, { maxRedirects: 0 });
        expect(live.status()).toBe(301);
        expect(live.headers().location).toBe('/to-admin?a=b');

        // A loop: the target of the first row leads back.
        await form.locator('input[name=from]').fill('/to-admin');
        await form.locator('input[name=to]').fill('/from-admin');
        await form.getByRole('button', { name: 'Add' }).click();
        await expect(page.getByRole('form', { name: 'Add redirect' }).locator('.error')).toContainText('in a circle');
        expect((await request.get(`${app.baseURL}/to-admin`)).status()).toBe(404);

        await form.locator('input[name=from]').fill('/steal');
        await form.locator('input[name=to]').fill('https://evil.example/');
        await form.getByRole('button', { name: 'Add' }).click();
        await expect(page.getByRole('form', { name: 'Add redirect' }).locator('.error')).toContainText('never another site');

        // An address that another row leads to is a live page for the admin: the rows are listed.
        await page.locator('input[name=from]').fill('/to-admin');
        await page.locator('input[name=to]').fill('');
        await page.locator('select[name=status]').selectOption('410');
        await page.getByRole('button', { name: 'Add' }).click();
        await expect(page.getByRole('form', { name: 'Add redirect' }).locator('.error')).toContainText('/from-admin');

        await page.goto(`${app.baseURL}/admin/redirects`);
        await page.getByRole('link', { name: 'Edit /from-admin' }).click();
        const edit = page.getByRole('form', { name: 'Edit redirect' });
        await edit.locator('select[name=status]').selectOption('410');
        await edit.getByRole('button', { name: 'Save' }).click();
        await expect(page.getByRole('row', { name: /\/from-admin/ })).toContainText('410');
        expect((await request.get(`${app.baseURL}/from-admin`)).status()).toBe(410);

        await page.getByRole('button', { name: 'Delete /from-admin' }).click();
        await expect(page.getByRole('row', { name: /\/from-admin/ })).toHaveCount(0);
        expect((await request.get(`${app.baseURL}/from-admin`)).status()).toBe(404);
    });
});
