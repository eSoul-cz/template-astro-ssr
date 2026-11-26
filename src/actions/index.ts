import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { login as checkCredentials, maxPasswordLength } from '../server/Auth.ts';
import { removeRedirect, saveRedirect } from '../server/Redirects.ts';
import type { RedirectIssues } from '../server/redirect-input.ts';
import { revokeSession } from '../server/Sessions.ts';
import { runtime } from '../server/runtime.ts';
import { clearSessionCookie, requireAdmin, sessionCookie, setSessionCookie } from '../lib/session.ts';

// Every action takes a plain `<form method="post">` and works without JavaScript: the page renders the result from
// `Astro.getActionResult()`. Every other action of the project starts with `requireAdmin(context)`.

/** What the redirects form shows after a post: nothing wrong, or the refused fields with the rows behind `pointedAt`. */
export type SaveRedirectOutcome =
    | { status: 'saved' }
    | { status: 'notFound' }
    | {
          status: 'invalid';
          issues: RedirectIssues;
          pointedAt: readonly string[];
          values: { id?: number; from: string; to: string; status: 301 | 410 };
      };
export const server = {
    login: defineAction({
        accept: 'form',
        input: z.object({
            email: z.string().trim().min(1, 'Enter your e-mail.').max(254),
            password: z.string().min(1, 'Enter your password.').max(maxPasswordLength),
        }),
        handler: async (input, context) => {
            const result = await checkCredentials(runtime(), { ...input, clientAddress: context.clientAddress });
            if (!result.ok) {
                if (result.reason === 'throttled') {
                    throw new ActionError({
                        code: 'TOO_MANY_REQUESTS',
                        message: `Too many attempts. Try again in ${Math.ceil(result.retryAfterSeconds / 60)} min.`,
                    });
                }
                // The same answer for an unknown e-mail and a wrong password.
                throw new ActionError({ code: 'UNAUTHORIZED', message: 'Wrong e-mail or password.' });
            }
            setSessionCookie(context.cookies, result.session);
            return { email: result.admin.email };
        },
    }),

    logout: defineAction({
        accept: 'form',
        handler: (_input, context) => {
            requireAdmin(context);
            const token = context.cookies.get(sessionCookie)?.value;
            const { db, sessionSecret } = runtime();
            if (token) revokeSession(db, sessionSecret, token);
            clearSessionCookie(context.cookies);
            return { signedOut: true };
        },
    }),

    redirects: {
        save: defineAction({
            accept: 'form',
            input: z.object({
                id: z.number().int().positive().optional(),
                from: z.string().max(1000),
                // An empty field arrives as nothing at all (a 410 has no target).
                to: z.string().max(1000).optional(),
                status: z.enum(['301', '410']),
            }),
            handler: ({ id, from, to, status }, context): SaveRedirectOutcome => {
                requireAdmin(context);
                const input = { from, to: to ?? '', status: status === '410' ? (410 as const) : (301 as const) };
                const result = saveRedirect(runtime().db, id, input);
                if (result.ok) return { status: 'saved' };
                if (result.reason === 'notFound') return { status: 'notFound' };
                return { status: 'invalid', issues: result.issues, pointedAt: result.pointedAt, values: { id, ...input } };
            },
        }),

        remove: defineAction({
            accept: 'form',
            input: z.object({ id: z.number().int().positive() }),
            handler: ({ id }, context) => {
                requireAdmin(context);
                removeRedirect(runtime().db, id);
                return { removed: true };
            },
        }),
    },
};
