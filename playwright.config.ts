import { defineConfig, devices } from '@playwright/test';

// End-to-end tests of the built server (`pnpm build` first). Every spec file starts the server it needs
// (`e2e/app.ts`: a temporary data directory, a random port, a generated session secret and a generated admin
// account), so no web server is configured here and nothing runs against a shared database.
export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
        { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ],
});
