import type { APIRoute } from 'astro';
import { runtime } from '../server/runtime.ts';

/** Docker HEALTHCHECK and the external check: `200 {"status":"ok"}` once the database answers, `503` otherwise. No session, no CSRF. */
export const GET: APIRoute = () => {
    const headers = { 'Cache-Control': 'no-store' };
    try {
        runtime().db.prepare('SELECT 1').get();
        return Response.json({ status: 'ok' }, { headers });
    } catch {
        return Response.json({ status: 'error' }, { status: 503, headers });
    }
};
