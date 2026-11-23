// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import astro from 'eslint-plugin-astro';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Flat config: ESLint recommended + typescript-eslint + eslint-plugin-astro. Formatting is Prettier's job (`pnpm format`).
export default defineConfig(
    globalIgnores(['.astro/', 'dist/', 'data/', 'node_modules/', 'playwright-report/', 'test-results/']),
    js.configs.recommended,
    ...tseslint.configs.recommended,
    ...astro.configs.recommended,
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        },
    },
    {
        // Server code, Node scripts, tests and config files run on Node.
        files: ['**/*.mjs', 'src/server/**', 'e2e/**', 'tests/**', 'scripts/**', 'eslint.config.js', 'playwright.config.ts', 'vitest.config.ts'],
        languageOptions: { globals: globals.node },
    },
);
