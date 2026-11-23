import { ActionError, defineAction } from 'astro:actions';
import { z } from 'astro/zod';
import { login as checkCredentials, maxPasswordLength } from '../server/Auth.ts';
import { revokeSession } from '../server/Sessions.ts';
import { runtime } from '../server/runtime.ts';
import { clearSessionCookie, requireAdmin, sessionCookie, setSessionCookie } from '../lib/session.ts';

// Both actions take a plain `<form method="post">` and work without JavaScript: the page renders the result from
// `Astro.getActionResult()`. Every other action of the project starts with `requireAdmin(context)`.
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
};
