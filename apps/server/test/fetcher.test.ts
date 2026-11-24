import { describe, expect, it } from 'vitest';
import { Fetcher } from '../src/lib/fetcher';

describe('fetcher', () => {
  it('reads a page for its user even when robots.txt disallows crawlers', async () => {
    const asked: string[] = [];
    const fetcher = new Fetcher({
      userAgent: 'Gier/test',
      perDomainIntervalMs: 0,
      fetchImpl: (async (input: string | URL | Request) => {
        const url = String(input);
        asked.push(url);
        if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /');
        return new Response('<html><body>price</body></html>', { status: 200 });
      }) as typeof fetch,
    });
    const res = await fetcher.get('https://shop.example/p/123');
    expect(res).toMatchObject({ ok: true, blocked: false });
    expect(asked).toEqual(['https://shop.example/p/123']);
  });

  it('still recognises a bot wall', async () => {
    const fetcher = new Fetcher({
      userAgent: 'Gier/test',
      perDomainIntervalMs: 0,
      fetchImpl: (async () => new Response('Access Denied', { status: 403 })) as typeof fetch,
    });
    expect(await fetcher.get('https://shop.example/p/1')).toMatchObject({
      ok: false,
      blocked: true,
    });
  });
});
