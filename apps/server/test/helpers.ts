import { openDb } from '@gier/db';
import type { Ctx } from '../src/context';
import { loadEnv } from '../src/env';
import { Fetcher } from '../src/lib/fetcher';
import { clearRdapCache } from '../src/services/rdap';
import { seedStores } from '../src/services/stores';

/** A fake web: map of URL → HTML (or a function for changing prices). */
export type FakeWeb = Record<string, string | (() => string)>;

export const productPage = (o: {
  name: string;
  price: number;
  brand?: string;
  gtin?: string;
  seller?: string;
  extra?: string;
  footer?: string;
}) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: o.name,
    brand: o.brand ? { '@type': 'Brand', name: o.brand } : undefined,
    gtin13: o.gtin,
    offers: {
      '@type': 'Offer',
      price: o.price.toFixed(2),
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      seller: o.seller ? { '@type': 'Organization', name: o.seller } : undefined,
    },
  })}</script></head><body>${o.extra ?? ''}<footer>${o.footer ?? 'KvK 12345678 · Retourneren'}</footer></body></html>`;

export function makeCtx(
  web: FakeWeb,
  opts: {
    /** Search results for every query, or per query. */
    searx?: { url: string; title: string }[] | ((q: string) => { url: string; title: string }[]);
    now?: () => Date;
    env?: Record<string, string>;
  } = {},
) {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_FILE: ':memory:',
    SEARXNG_URL: 'http://searx.test',
    SCHEDULER: 'off',
    // Exercise a non-root base path; the default is the site root.
    GIER_BASE_PATH: '/gier',
    ...opts.env,
  });
  clearRdapCache();
  const { db } = openDb(':memory:');
  const pageFetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith('/robots.txt'))
      return new Response('User-agent: *\nDisallow: /checkout', { status: 200 });
    const page = web[url];
    if (!page) return new Response('not found', { status: 404 });
    return new Response(typeof page === 'function' ? page() : page, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }) as typeof fetch;
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('http://searx.test/search')) {
      const q = new URL(url).searchParams.get('q') ?? '';
      const hits = typeof opts.searx === 'function' ? opts.searx(q) : (opts.searx ?? []);
      return Response.json({
        results: hits.map((r) => ({ url: r.url, title: r.title, content: '' })),
      });
    }
    if (url.startsWith('https://rdap.org/domain/')) {
      return Response.json({
        events: [
          {
            eventAction: 'registration',
            eventDate: url.includes('nieuw')
              ? new Date(Date.now() - 19 * 86400000).toISOString()
              : '2010-01-01T00:00:00Z',
          },
        ],
      });
    }
    if (url.includes('ecb.europa.eu')) return new Response(`<Cube currency='USD' rate='1.1500'/>`);
    return pageFetch(input, init);
  }) as typeof fetch;
  const ctx: Ctx = {
    env,
    db,
    fetcher: new Fetcher({ userAgent: 'test', perDomainIntervalMs: 0, fetchImpl: pageFetch }),
    http,
    now: opts.now ?? (() => new Date()),
  };
  seedStores(ctx);
  return ctx;
}
