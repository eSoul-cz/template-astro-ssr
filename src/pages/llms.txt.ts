import type { APIRoute } from 'astro';
import { publicPaths } from '../lib/routes.ts';
import { runtime } from '../server/runtime.ts';
import { getSiteName } from '../server/Site.ts';

// https://llmstxt.org: a short Markdown index of the public pages for language models.
export const GET: APIRoute = () => {
    const { db, settings } = runtime();
    const lines = [
        `# ${getSiteName(db)}`,
        '',
        '> Astro SSR application starter.',
        '',
        ...publicPaths.map((path) => `- [${path}](${settings.siteUrl}${path})`),
        '',
    ];
    return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
