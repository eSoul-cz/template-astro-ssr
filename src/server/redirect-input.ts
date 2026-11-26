/**
 * A redirect as the admin edits it, with the rules shared by the form and the `Redirects` service: the canonical form
 * of a path, what a valid redirect is, how a request path is matched and what a save changes in the other rows.
 * Pure, so the tests need no database and the page can check an input before it is sent.
 */
export const redirectStatuses = [301, 410] as const;
export type RedirectStatus = (typeof redirectStatuses)[number];

export interface RedirectInput {
    readonly from: string;
    /** Ignored for a 410. */
    readonly to: string;
    readonly status: RedirectStatus;
}

/** What is stored: the canonical paths, `to` only for a 301. */
export interface RedirectRule {
    readonly from: string;
    readonly to: string | null;
    readonly status: RedirectStatus;
}

export interface StoredRule extends RedirectRule {
    readonly id: number;
}

export const redirectLimits = { path: 300 } as const;

export type FromIssue = 'required' | 'invalid' | 'tooLong' | 'reserved' | 'taken' | 'pointedAt';
export type ToIssue = 'required' | 'invalid' | 'query' | 'tooLong' | 'same' | 'chain' | 'loop';
export interface RedirectIssues {
    from?: FromIssue;
    to?: ToIssue;
}

export type TrailingSlash = 'always' | 'never' | 'ignore';

/**
 * The `trailingSlash` of `astro.config.mjs` (`tests/redirect-input.test.ts` fails when they differ). With `always` the canonical
 * path ends in a slash, with `never` and `ignore` it does not; the root is `/` either way.
 */
export const trailingSlash: TrailingSlash = 'ignore';

/** Paths the application serves itself; a redirect there would never be asked for (the middleware skips them). */
const reservedRoots = ['/admin', '/healthz', '/_actions', '/_astro', '/_image', '/_server-islands'] as const;

const hasExtension = (path: string) => /\.[a-z0-9]+$/i.test(path);

/** A scheme (`https:`, `mailto:`) or a network-path reference (`//host`). */
const isExternal = (raw: string) => /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//');

/**
 * The canonical form of a path of this site: leading `/`, no query or hash, percent-decoding undone, one slash between
 * segments, the trailing slash the site's `trailingSlash` setting wants. A path with a file extension and a prefix rule
 * (ending in `*`) keep their form. `undefined` for what is no local path: another site, a `..` segment, a stray `*`,
 * a backslash, control characters, a broken `%` escape.
 */
export const normalizePath = (
    raw: string,
    { wildcard = false, mode = trailingSlash }: { wildcard?: boolean; mode?: TrailingSlash } = {},
): string | undefined => {
    const trimmed = raw.trim().replace(/[?#].*$/s, '');
    if (isExternal(trimmed)) return undefined;
    let decoded: string;
    try {
        decoded = decodeURIComponent(trimmed);
    } catch {
        return undefined;
    }
    // Decoding may reveal what the encoded form hid (`%2F%2Fhost`, `%5C`).
    // eslint-disable-next-line no-control-regex
    if (isExternal(decoded) || /[\\\u0000-\u001f\u007f]/.test(decoded)) return undefined;
    const path = `/${decoded}`.replace(/\/{2,}/g, '/');
    const star = path.endsWith('*');
    if (star && !wildcard) return undefined;
    const body = star ? path.slice(0, -1) : path;
    if (body.includes('*') || body.split('/').some((segment) => segment === '.' || segment === '..')) return undefined;
    if (star) return body === '/' ? undefined : path;
    if (body === '/') return body;
    if (mode === 'always') return body.endsWith('/') || hasExtension(body) ? body : `${body}/`;
    return body.endsWith('/') ? body.slice(0, -1) : body;
};

const isPrefixRule = (path: string) => path.endsWith('*');

/** Whether a path lies under the prefix of a rule (`/old/` of `/old/*`); `/old` counts once it has no trailing slash. */
const under = (prefix: string, path: string) => path.startsWith(prefix) || `${path}/` === prefix;

const isReserved = (path: string) => path === '/' || reservedRoots.some((root) => path === root || path.startsWith(`${root}/`));

/** Whether a path is one the application serves itself, so the middleware never looks a redirect up for it. */
export const isReservedPath = (raw: string) => {
    const path = normalizePath(raw);
    return path !== undefined && isReserved(path);
};

/** A `?` or `#`, as typed or after percent-decoding (`%3F`). */
const hasQueryOrHash = (raw: string) => {
    if (/[?#]/.test(raw)) return true;
    try {
        return /[?#]/.test(decodeURIComponent(raw));
    } catch {
        return false;
    }
};

export type CheckedRedirect = { readonly value: RedirectRule; readonly issues?: never } | { readonly value?: never; readonly issues: RedirectIssues };

/** The rules an input can be checked for on its own; the other rows (taken, chain, loop, pointed at) are `planSave`'s job. */
export const checkRedirect = (input: RedirectInput, mode: TrailingSlash = trailingSlash): CheckedRedirect => {
    const issues: RedirectIssues = {};
    const fromRaw = input.from.trim();
    const toRaw = input.to.trim();
    const from = normalizePath(fromRaw, { wildcard: true, mode });
    if (!fromRaw) issues.from = 'required';
    else if (fromRaw.length > redirectLimits.path) issues.from = 'tooLong';
    else if (from === undefined) issues.from = 'invalid';
    else if (isReserved(from)) issues.from = 'reserved';

    let to: string | null = null;
    if (input.status === 301) {
        if (!toRaw) issues.to = 'required';
        else if (toRaw.length > redirectLimits.path) issues.to = 'tooLong';
        // The target is typed as a path of this site: starting with `/`, never another site.
        else if (!toRaw.startsWith('/') || isExternal(toRaw)) issues.to = 'invalid';
        // The visitor's own query string is appended on redirect: a `?` or `#` in the target would end up twice in the address.
        else if (hasQueryOrHash(toRaw)) issues.to = 'query';
        else {
            const normalized = normalizePath(toRaw, { mode });
            if (normalized === undefined) issues.to = 'invalid';
            else if (normalized === from) issues.to = 'same';
            else to = normalized;
        }
    }
    if (Object.keys(issues).length > 0 || from === undefined) return { issues };
    // A prefix rule whose own prefix contains its target would send a request round forever.
    if (to !== null && isPrefixRule(from) && under(from.slice(0, -1), to)) return { issues: { to: 'loop' } };
    return { value: { from, to, status: input.status } };
};

/** The rule that answers a canonical path: the exact `from` first, else the longest prefix rule that covers it. */
export const matcher = <R extends RedirectRule>(rules: ReadonlyArray<R>) => {
    const exact = new Map<string, R>();
    const prefixes: Array<{ prefix: string; rule: R }> = [];
    for (const rule of rules) {
        if (isPrefixRule(rule.from)) prefixes.push({ prefix: rule.from.slice(0, -1), rule });
        else exact.set(rule.from, rule);
    }
    prefixes.sort((a, b) => b.prefix.length - a.prefix.length || a.prefix.localeCompare(b.prefix));
    return (path: string): R | undefined => exact.get(path) ?? prefixes.find(({ prefix }) => under(prefix, path))?.rule;
};

/** Whether a rule's target is the path (or, for a prefix rule `from`, anywhere under it). */
const pointsAt = (rule: StoredRule, from: string) => rule.to !== null && (isPrefixRule(from) ? under(from.slice(0, -1), rule.to) : rule.to === from);

/** The rows that lead to an address, which therefore is a target (a live page, as far as the admin knows). */
export const pointingAt = (others: ReadonlyArray<StoredRule>, from: string, previousFrom?: string) =>
    others.filter((rule) => pointsAt(rule, from) || (previousFrom !== undefined && previousFrom !== from && pointsAt(rule, previousFrom)));

export interface SavePlan {
    readonly issues?: RedirectIssues;
    /** With `pointedAt`: the rows that lead to the address, for the message. */
    readonly pointedAt?: ReadonlyArray<StoredRule>;
}

/**
 * Checks a valid redirect against the other rows. The target must be final, so it is no `from` of another row
 * (`chain`, or `loop` when that row leads straight back). The reverse holds too: an address that other rows point at
 * (or the `from` an edit replaces) is a target, so it cannot become a redirect itself (`pointedAt`); the admin does
 * not guess what to do with those rows. Only `recordSlugChange` rewrites them, where the old address is known to be dead.
 */
export const planSave = (value: RedirectRule, others: ReadonlyArray<StoredRule>, previousFrom?: string): SavePlan => {
    if (others.some((rule) => rule.from === value.from)) return { issues: { from: 'taken' } };
    if (value.to !== null) {
        const hit = matcher(others)(value.to);
        if (hit) return { issues: { to: hit.to === value.from ? 'loop' : 'chain' } };
    }
    const pointed = pointingAt(others, value.from, previousFrom);
    if (pointed.length > 0) return { issues: { from: 'pointedAt' }, pointedAt: pointed };
    return {};
};

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/**
 * Whether a stored row is what a save would have written: canonical paths, a local target without query or hash, no loop
 * onto itself. Rows written by a project's own migration are not checked by a save, so the lookup skips those that fail
 * (an open redirect from a typo, a path that never matches). Stored paths are decoded, so they are encoded again to run
 * through the same normalisation.
 */
export const isCanonicalRule = (rule: RedirectRule, mode: TrailingSlash = trailingSlash): boolean => {
    const from = normalizePath(encodePath(rule.from), { wildcard: true, mode });
    if (from !== rule.from || isReserved(from)) return false;
    if (rule.status === 410) return rule.to === null;
    if (rule.status !== 301 || rule.to === null || hasQueryOrHash(rule.to)) return false;
    const to = normalizePath(encodePath(rule.to), { mode });
    return to === rule.to && to !== from && !(isPrefixRule(from) && under(from.slice(0, -1), to));
};
