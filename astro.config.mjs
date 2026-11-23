// @ts-check
import node from '@astrojs/node';
import { defineConfig } from 'astro/config';
import { existsSync } from 'node:fs';

// `.env` for `pnpm dev`, `pnpm build` and `pnpm check`; the process environment wins (Jenkins and Docker build args need no file).
// The scripts of `src/server/` load it with `node --env-file-if-exists=.env`.
if (existsSync('.env')) process.loadEnvFile('.env');

// Build-time copy of SITE_URL: `security.allowedDomains` is baked into the server build. The runtime reads SITE_URL again
// (canonical links, sitemap, cookie flag), so both must be the same value: the Docker image passes it as a build argument
// and keeps it as the default of the runtime variable.
const site = new URL(process.env.SITE_URL || 'http://localhost:4321');

// Requests and actions carry small forms only: nothing in this template uploads files.
const bodyLimit = 64 * 1024;

// https://astro.build/config
export default defineConfig({
    site: site.origin,
    output: 'server',
    trailingSlash: 'ignore',
    build: { format: 'directory' },
    // No Markdown in the site: nothing to highlight (Shiki inline styles clash with the CSP).
    markdown: { syntaxHighlight: false },

    adapter: node({ mode: 'standalone', bodySizeLimit: bodyLimit }),

    security: {
        actionBodySizeLimit: bodyLimit,
        // Behind the host NGINX: X-Forwarded-Host/-Proto/-For are trusted only for this origin, so `Astro.url` is the
        // public https address (the origin check of form posts needs it) and `clientAddress` is the visitor's IP.
        allowedDomains: [{ hostname: site.hostname, protocol: site.protocol.replace(':', ''), ...(site.port ? { port: site.port } : {}) }],
        // Pages rendered on demand get the CSP as a response header (the build computes the script and style hashes);
        // a prerendered page gets a <meta> tag instead, where `frame-ancestors` does not work and must not be relied on
        // (the middleware also sends X-Frame-Options on every response).
        csp: {
            directives: [
                "default-src 'self'",
                "img-src 'self' data:",
                "font-src 'self'",
                "connect-src 'self'",
                "base-uri 'self'",
                "form-action 'self'",
                "object-src 'none'",
                "frame-ancestors 'none'",
            ],
        },
    },
});
