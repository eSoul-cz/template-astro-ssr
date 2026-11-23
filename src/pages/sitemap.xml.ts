import type { APIRoute } from 'astro';
import { publicPaths } from '../lib/routes.ts';
import { runtime } from '../server/runtime.ts';

// An endpoint, not @astrojs/sitemap: that integration only knows the pages that exist at build time, while the site
// origin and the staging gate are runtime settings (one image serves staging and production).
export const GET: APIRoute = () => {
    const { noindex, siteUrl } = runtime().settings;
    const urls = noindex ? [] : publicPaths.map((path) => `  <url><loc>${siteUrl}${path}</loc></url>`);
    const xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''];
    return new Response(xml.join('\n'), { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
