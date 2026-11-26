import { transaction, type Database } from './Database.ts';
import {
    checkRedirect,
    isCanonicalRule,
    matcher,
    normalizePath,
    planSave,
    redirectStatuses,
    type RedirectInput,
    type RedirectIssues,
    type RedirectRule,
    type RedirectStatus,
    type StoredRule,
} from './redirect-input.ts';

/**
 * The redirects from the old addresses: the rows the admin edits and the lookup the middleware uses. A path is looked up
 * here only when it would answer 404, so a redirect never hides a live page.
 */
export interface Redirect {
    readonly id: number;
    readonly from: string;
    readonly to: string | null;
    readonly status: RedirectStatus;
    readonly hits: number;
    readonly lastHitAt: number | null;
}

/** What answers a request: the rule's status and target, and its `from` for the hit counter. */
export type ResolvedRedirect = RedirectRule;

export type SaveRedirectResult =
    | { readonly ok: true; readonly redirects: readonly Redirect[] }
    | { readonly ok: false; readonly reason: 'invalid'; readonly issues: RedirectIssues; readonly pointedAt: readonly string[] }
    | { readonly ok: false; readonly reason: 'notFound' };

interface Row {
    id: number;
    from_path: string;
    to_path: string | null;
    status: number;
    hits: number;
    last_hit_at: number | null;
}

const asStatus = (value: number): RedirectStatus => redirectStatuses.find((status) => status === value) ?? 410;

const stored = (row: Row): StoredRule => ({ id: row.id, from: row.from_path, to: row.to_path, status: asStatus(row.status) });

const selectAll = (db: Database) =>
    db.prepare('SELECT id, from_path, to_path, status, hits, last_hit_at FROM redirects ORDER BY from_path, id').all() as unknown as Row[];

export const listRedirects = (db: Database): Redirect[] =>
    selectAll(db).map((row) => ({ ...stored(row), hits: row.hits, lastHitAt: row.last_hit_at }));

// What lives in memory per database: the compiled rules (loaded on the first lookup, dropped by every write) and the hits
// that wait for the next flush. Astro bundles `src/server/` while `start.ts` imports it natively (see `Database.ts`), so the
// state sits on `globalThis`: both copies of this module share it and `start.ts` can flush it on SIGTERM.
interface State {
    lookup?: (path: string) => StoredRule | undefined;
    /** Count and time of the last hit per rule. */
    pending: Map<string, { count: number; at: number }>;
    timer?: ReturnType<typeof setInterval>;
}

const slot = Symbol.for('esoul.app.redirects');
const holder = globalThis as { [slot]?: WeakMap<Database, State> };

const stateOf = (db: Database): State => {
    const states = (holder[slot] ??= new WeakMap());
    let state = states.get(db);
    if (!state) states.set(db, (state = { pending: new Map() }));
    return state;
};

const invalidate = (db: Database) => {
    stateOf(db).lookup = undefined;
};

/** Runs in the caller's transaction when there is one (a project calls `recordSlugChange` from its own save). */
const atomically = <T>(db: Database, work: () => T): T => (db.isTransaction ? work() : transaction(db, work));

/** The rows the lookup uses: those a save could have written. A row from a project's migration with a typo is skipped and logged. */
const usableRules = (db: Database): StoredRule[] =>
    selectAll(db)
        .map(stored)
        .filter((rule) => {
            const usable = isCanonicalRule(rule);
            if (!usable) console.warn(`Redirect ${rule.id} (${rule.from} -> ${rule.to ?? 'gone'}) is not in the canonical form and is ignored`);
            return usable;
        });

/** The rule for a request path as the browser sent it (percent-encoded, with or without the trailing slash), or `undefined`. */
export function resolveRedirect(db: Database, raw: string): ResolvedRedirect | undefined {
    const path = normalizePath(raw);
    if (path === undefined) return undefined;
    const state = stateOf(db);
    state.lookup ??= matcher(usableRules(db));
    const rule = state.lookup(path);
    return rule && { from: rule.from, to: rule.to, status: rule.status };
}

const hitInterval = 10_000;

/**
 * Counts a use of the rule in memory; `flushRedirectHits` writes the counts in one transaction, every ten seconds and on
 * shutdown. Best effort: the counts of the last seconds are lost when the process is killed, and a failure never reaches a
 * response.
 */
export function recordRedirectHit(db: Database, from: string, now = Date.now()): void {
    const state = stateOf(db);
    state.pending.set(from, { count: (state.pending.get(from)?.count ?? 0) + 1, at: now });
    state.timer ??= setInterval(() => flushRedirectHits(db), hitInterval).unref();
}

export function flushRedirectHits(db: Database): void {
    const { pending } = stateOf(db);
    if (pending.size === 0) return;
    const batch = [...pending];
    pending.clear();
    try {
        atomically(db, () => {
            const update = db.prepare('UPDATE redirects SET hits = hits + ?, last_hit_at = ? WHERE from_path = ?');
            for (const [from, { count, at }] of batch) update.run(count, at, from);
        });
    } catch (error) {
        console.warn(`Counting redirect hits failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export function saveRedirect(db: Database, id: number | undefined, input: RedirectInput, now = Date.now()): SaveRedirectResult {
    const checked = checkRedirect(input);
    if (checked.issues) return { ok: false, reason: 'invalid', issues: checked.issues, pointedAt: [] };
    const { value } = checked;
    try {
        return atomically(db, (): SaveRedirectResult => {
            const all = selectAll(db).map(stored);
            const before = id === undefined ? undefined : all.find((rule) => rule.id === id);
            if (id !== undefined && !before) return { ok: false, reason: 'notFound' };
            const plan = planSave(
                value,
                all.filter((rule) => rule.id !== id),
                before?.from,
            );
            if (plan.issues) return { ok: false, reason: 'invalid', issues: plan.issues, pointedAt: (plan.pointedAt ?? []).map((rule) => rule.from) };
            if (id === undefined) {
                db.prepare('INSERT INTO redirects (from_path, to_path, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
                    value.from,
                    value.to,
                    value.status,
                    now,
                    now,
                );
            } else {
                db.prepare('UPDATE redirects SET from_path = ?, to_path = ?, status = ?, updated_at = ? WHERE id = ?').run(
                    value.from,
                    value.to,
                    value.status,
                    now,
                    id,
                );
            }
            return { ok: true, redirects: listRedirects(db) };
        });
    } finally {
        invalidate(db);
    }
}

export function removeRedirect(db: Database, id: number): void {
    try {
        db.prepare('DELETE FROM redirects WHERE id = ?').run(id);
    } finally {
        invalidate(db);
    }
}

/**
 * A public address changed: the old one redirects to the new one, and the redirects that led to the old one follow. A
 * project calls it where it saves a changed slug (inside its own transaction is fine).
 */
export function recordSlugChange(db: Database, oldRaw: string, newRaw: string, now = Date.now()): void {
    const from = normalizePath(oldRaw);
    const to = normalizePath(newRaw);
    if (from === undefined || to === undefined || from === to) return;
    try {
        atomically(db, () => {
            // The new address is a live page again: a redirect from it (an earlier move back and forth) would hide nothing
            // but must not stay, or the old address would chain through it.
            db.prepare('DELETE FROM redirects WHERE from_path = ?').run(to);
            // Redirects that led to the old address lead to the new one, so no chain of two exists.
            db.prepare('UPDATE redirects SET to_path = ?, updated_at = ? WHERE to_path = ?').run(to, now, from);
            db.prepare(
                `INSERT INTO redirects (from_path, to_path, status, created_at, updated_at) VALUES (?, ?, 301, ?, ?)
                 ON CONFLICT (from_path) DO UPDATE SET to_path = excluded.to_path, status = 301, updated_at = excluded.updated_at`,
            ).run(from, to, now, now);
        });
    } finally {
        invalidate(db);
    }
}
