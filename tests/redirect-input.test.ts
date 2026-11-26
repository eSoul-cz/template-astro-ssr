import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    checkRedirect,
    isCanonicalRule,
    matcher,
    normalizePath,
    planSave,
    trailingSlash,
    type RedirectInput,
    type RedirectRule,
    type StoredRule,
} from '../src/server/redirect-input.ts';

const move = (from: string, to: string): RedirectInput => ({ from, to, status: 301 });
const rule = (id: number, from: string, to: string | null): StoredRule => ({ id, from, to, status: to === null ? 410 : 301 });

describe('trailingSlash', () => {
    it('is the setting of astro.config.mjs', () => {
        const config = readFileSync('astro.config.mjs', 'utf8');
        expect(config).toContain(`trailingSlash: '${trailingSlash}'`);
    });
});

describe('normalizePath', () => {
    it('adds the leading slash, drops query and hash and decodes', () => {
        expect(normalizePath('old page?x=1#top', { mode: 'never' })).toBe('/old page');
        expect(normalizePath('/caf%C3%A9', { mode: 'never' })).toBe('/café');
        expect(normalizePath('//a///b', { mode: 'never' })).toBeUndefined();
        expect(normalizePath('/a///b', { mode: 'never' })).toBe('/a/b');
    });

    it('follows the trailingSlash mode: always adds it (except for a file), never and ignore remove it', () => {
        expect(normalizePath('/about', { mode: 'always' })).toBe('/about/');
        expect(normalizePath('/about/', { mode: 'always' })).toBe('/about/');
        expect(normalizePath('/files/a.pdf', { mode: 'always' })).toBe('/files/a.pdf');
        expect(normalizePath('/about/', { mode: 'never' })).toBe('/about');
        expect(normalizePath('/about/', { mode: 'ignore' })).toBe('/about');
        expect(normalizePath('/', { mode: 'never' })).toBe('/');
    });

    it('keeps a prefix rule only where wildcards are allowed', () => {
        expect(normalizePath('/old/*', { wildcard: true, mode: 'always' })).toBe('/old/*');
        expect(normalizePath('/old/*', { mode: 'always' })).toBeUndefined();
        expect(normalizePath('/*', { wildcard: true })).toBeUndefined();
        expect(normalizePath('/a*b/*', { wildcard: true })).toBeUndefined();
    });

    it.each([
        'https://evil.example/x',
        'mailto:a@b.c',
        '//evil.example',
        '/%2F%2Fevil.example',
        '/a\\b',
        '/a%5Cb',
        '/a\u0000b',
        '/a%00b',
        '/../x',
        '/a/./b',
        '/%E0%A4%A',
    ])('refuses %j', (raw) => {
        expect(normalizePath(raw)).toBeUndefined();
    });
});

describe('checkRedirect', () => {
    it('accepts a 301 and canonicalises both paths', () => {
        expect(checkRedirect(move('Old/', '/new/'), 'never').value).toEqual({ from: '/Old', to: '/new', status: 301 });
        expect(checkRedirect(move('old', '/new'), 'always').value).toEqual({ from: '/old/', to: '/new/', status: 301 });
    });

    it('stores no target for a 410, whatever was typed', () => {
        expect(checkRedirect({ from: '/gone', to: 'https://evil.example', status: 410 }).value).toEqual({ from: '/gone', to: null, status: 410 });
    });

    it('refuses an empty or reserved from, a missing, external or identical target', () => {
        expect(checkRedirect(move('', '/x')).issues).toEqual({ from: 'required' });
        expect(checkRedirect(move('/', '/x')).issues).toEqual({ from: 'reserved' });
        expect(checkRedirect(move('/admin/x', '/x')).issues).toEqual({ from: 'reserved' });
        expect(checkRedirect(move('/admin', '/x')).issues).toEqual({ from: 'reserved' });
        expect(checkRedirect(move('/_actions/login', '/x')).issues).toEqual({ from: 'reserved' });
        expect(checkRedirect(move('/a', '')).issues).toEqual({ to: 'required' });
        expect(checkRedirect(move('/a', 'https://evil.example')).issues).toEqual({ to: 'invalid' });
        expect(checkRedirect(move('/a', '//evil.example')).issues).toEqual({ to: 'invalid' });
        expect(checkRedirect(move('/a', '/\\evil.example')).issues).toEqual({ to: 'invalid' });
        expect(checkRedirect(move('/a', 'relative')).issues).toEqual({ to: 'invalid' });
        expect(checkRedirect(move('/a', '/a/')).issues).toEqual({ to: 'same' });
        expect(checkRedirect(move('/a'.repeat(200), '/b')).issues).toEqual({ from: 'tooLong' });
    });

    it('refuses a prefix rule whose target lies under its own prefix', () => {
        expect(checkRedirect(move('/old/*', '/old/new')).issues).toEqual({ to: 'loop' });
        expect(checkRedirect(move('/old/*', '/new')).value).toEqual({ from: '/old/*', to: '/new', status: 301 });
    });
});

describe('matcher', () => {
    const rules: RedirectRule[] = [
        { from: '/a/*', to: '/short', status: 301 },
        { from: '/a/b/*', to: '/long', status: 301 },
        { from: '/a/b/exact', to: '/exact', status: 301 },
    ];
    const find = matcher(rules);

    it('takes the exact address first, then the longest prefix', () => {
        expect(find('/a/b/exact')?.to).toBe('/exact');
        expect(find('/a/b/other')?.to).toBe('/long');
        expect(find('/a/c')?.to).toBe('/short');
        expect(find('/b')).toBeUndefined();
    });

    it('lets a prefix rule cover its own address without the trailing slash', () => {
        expect(find('/a')?.to).toBe('/short');
    });
});

describe('planSave', () => {
    const others = [rule(1, '/a', '/b'), rule(2, '/gone', null), rule(3, '/x/*', '/y')];
    const value = (from: string, to: string | null): RedirectRule => ({ from, to, status: to === null ? 410 : 301 });

    it('refuses an address that is taken', () => {
        expect(planSave(value('/a', '/c'), others).issues).toEqual({ from: 'taken' });
    });

    it('refuses a chain, and a loop when the other row leads straight back', () => {
        expect(planSave(value('/c', '/a'), others).issues).toEqual({ to: 'chain' });
        expect(planSave(value('/c', '/x/page'), others).issues).toEqual({ to: 'chain' });
        expect(planSave(value('/b', '/a'), others).issues).toEqual({ to: 'loop' });
    });

    it('refuses an address other rows point at, and lists them', () => {
        const plan = planSave(value('/b', null), others);
        expect(plan.issues).toEqual({ from: 'pointedAt' });
        expect(plan.pointedAt?.map((row) => row.from)).toEqual(['/a']);
        expect(planSave(value('/y/*', null), others).pointedAt?.map((row) => row.from)).toEqual(['/x/*']);
    });

    it('treats the from an edit replaces as a target too', () => {
        expect(planSave(value('/b2', '/z'), others, '/b').issues).toEqual({ from: 'pointedAt' });
        expect(planSave(value('/free', '/z'), others, '/free').issues).toBeUndefined();
    });

    it('accepts a row that touches nothing', () => {
        expect(planSave(value('/new', '/target'), others)).toEqual({});
    });
});

describe('a target with a query or hash', () => {
    it.each(['/new?a=1', '/new#top', '/new%3Fa=1', '/new%23top'])('is refused: %j', (to) => {
        expect(checkRedirect(move('/old', to)).issues).toEqual({ to: 'query' });
    });
});

describe('isCanonicalRule', () => {
    const row = (from: string, to: string | null): RedirectRule => ({ from, to, status: to === null ? 410 : 301 });

    it('accepts what a save writes, a literal % included', () => {
        expect(isCanonicalRule(row('/old', '/new'), 'never')).toBe(true);
        expect(isCanonicalRule(row('/old/*', null), 'never')).toBe(true);
        expect(isCanonicalRule(row('/50%-off', '/sale'), 'never')).toBe(true);
        expect(isCanonicalRule(row('/old/', '/new/'), 'always')).toBe(true);
    });

    it.each([
        ['an open redirect', row('/old', '//evil.example')],
        ['an external target', row('/old', 'https://evil.example')],
        ['a target without the slash', row('/old', 'new')],
        ['a target with a query', row('/old', '/new?a=1')],
        ['a from without the leading slash', row('old', '/new')],
        ['a from with a trailing slash', row('/old/', '/new')],
        ['a reserved from', row('/admin/x', '/new')],
        ['a loop onto itself', row('/old', '/old')],
        ['a prefix rule over its own target', row('/old/*', '/old/new')],
    ])('refuses %s', (_name, rule) => {
        expect(isCanonicalRule(rule, 'never')).toBe(false);
    });
});
