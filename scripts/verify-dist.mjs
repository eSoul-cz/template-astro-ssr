#!/usr/bin/env node
// Build verification before deploy (CI runs it after `pnpm build`; the image build runs it too; locally `pnpm verify`).
//
// Astro and its integrations only log many of their errors and the build still finishes, so the output is checked here
// and the script exits 1 on any problem:
//   - the server entry and the client directory exist (what the Docker image and the deploy hook copy),
//   - the Content-Security-Policy is built into the server (the pages get it as a <meta> tag at runtime),
//   - `security.allowedDomains` baked into the server matches SITE_URL, when SITE_URL is set for the build,
//   - every prerendered HTML page (none in the template) has a CSP without 'unsafe-inline' / 'unsafe-eval' scripts,
//   - no `.env` file, private key or session secret ended up in the output.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');

const dist = resolve(process.cwd(), process.argv[2] ?? 'dist');
const problems = [];
const fail = (message) => problems.push(message);

if (!existsSync(dist)) {
    console.error(`verify-dist: ${dist} does not exist.`);
    process.exit(1);
}

const files = readdirSync(dist, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
const name = (file) => relative(dist, file).replaceAll('\\', '/');

// --- layout --------------------------------------------------------------------------------
if (!existsSync(join(dist, 'server', 'entry.mjs'))) fail('Missing server/entry.mjs (the adapter output).');
if (!existsSync(join(dist, 'client'))) fail('Missing the client/ directory (static files and hashed assets).');

// --- CSP and allowed domains -----------------------------------------------------------------
const serverFiles = files.filter((file) => name(file).startsWith('server/') && file.endsWith('.mjs'));
const manifest = serverFiles.map((file) => readFileSync(file, 'utf8')).find((text) => text.includes('"allowedDomains":['));
if (!manifest) {
    fail('The server build has no manifest with allowedDomains.');
} else {
    if (!/object-src 'none'/.test(manifest) || !/form-action 'self'/.test(manifest))
        fail('The Content-Security-Policy directives are not in the server build.');
    const baked = manifest.match(/allowedDomains":(\[[^\]]*\])/)?.[1];
    if (!baked || baked === '[]') fail('security.allowedDomains is empty: forwarded headers would not be trusted behind the proxy.');
    else if (process.env.SITE_URL) {
        const site = new URL(process.env.SITE_URL);
        if (!baked.includes(`"hostname":"${site.hostname}"`))
            fail(`allowedDomains ${baked} does not match SITE_URL ${process.env.SITE_URL}: SITE_URL has to be set for the build.`);
    } else {
        console.warn('verify-dist: SITE_URL is not set, allowedDomains is localhost (fine locally, never for a deploy).');
    }
}

// --- prerendered pages ---------------------------------------------------------------------
const pages = files.filter((file) => file.endsWith('.html') && name(file).startsWith('client/'));
for (const file of pages) {
    const html = readFileSync(file, 'utf8');
    const csp = html.match(/<meta\s+http-equiv="content-security-policy"\s+content="([^"]+)"/i)?.[1];
    if (!csp) {
        fail(`${name(file)}: missing Content-Security-Policy.`);
        continue;
    }
    const scriptSrc = csp.split(';').find((directive) => directive.trim().startsWith('script-src ')) ?? '';
    const unsafe = scriptSrc.match(/'unsafe-(inline|eval)'/);
    if (unsafe) fail(`${name(file)}: CSP script-src allows ${unsafe[0]}.`);
    if (/\bTODO\b/.test(html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ')))
        fail(`${name(file)}: contains a TODO placeholder.`);
}

// --- secrets -------------------------------------------------------------------------------
const secret = process.env.SESSION_SECRET;
for (const file of files) {
    if (/(^|\/)\.env(\.|$)/.test(name(file))) fail(`${name(file)}: an environment file in the output.`);
    if (/\.(woff2?|png|jpe?g|webp|avif|ico|gif)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) fail(`${name(file)}: contains a private key.`);
    if (secret && secret.length >= 16 && text.includes(secret)) fail(`${name(file)}: contains the value of SESSION_SECRET.`);
}

if (problems.length > 0) {
    console.error(`\nverify-dist: ${problems.length} problem(s):\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    process.exit(1);
}

console.log(`verify-dist: OK (${files.length} files, ${pages.length} prerendered pages).`);
