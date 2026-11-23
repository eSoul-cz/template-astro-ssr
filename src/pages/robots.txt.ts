import type { APIRoute } from 'astro';
import { runtime } from '../server/runtime.ts';

// Public noindex switch for staging: PUBLIC_NOINDEX=true disallows everything. The pages stay reachable (crawlers must
// fetch them to see `noindex`); a staging site is hidden by robots.txt + meta and protected by the gate of the web server.
export const GET: APIRoute = () => {
    const { noindex, siteUrl } = runtime().settings;
    const lines = noindex
        ? ['User-agent: *', 'Disallow: /', '']
        : ['User-agent: *', 'Allow: /', 'Disallow: /admin/', '', `Sitemap: ${siteUrl}/sitemap.xml`, ''];
    return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
