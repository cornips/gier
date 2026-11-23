import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { stores } from '@gier/db';
import { createApp } from '../src/app';
import { judgeDoubtfulMatches, proposeFingerprint } from '../src/services/ai';
import { classifyBrowserRunError } from '../src/services/browser-run';
import { runDiscovery } from '../src/services/discovery';
import { isPublicUrl, referenceImage } from '../src/services/images';
import { seedStores } from '../src/services/stores';
import { makeCtx, productPage } from './helpers';

const fp = {
  title: 'Rexona Men Invisible 150 ml',
  brand: 'Rexona',
  line: 'Men Invisible',
  form: 'deospray',
  quantity: { amount: 150, unit: 'ml' as const, packCount: 1 },
  gtin: null,
  model: null,
  locked: ['brand' as const],
  allowMultipack: true,
  compareUnit: 'piece' as const,
  exclude: [],
};

/** Fake Anthropic API: records request bodies and answers with the given content blocks. */
function withClaude(ctx: ReturnType<typeof makeCtx>, reply: object) {
  const bodies: Record<string, unknown>[] = [];
  const inner = ctx.http;
  ctx.http = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith('https://api.anthropic.com/')) {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ usage: { input_tokens: 100, output_tokens: 50 }, ...reply });
    }
    return inner(input, init);
  }) as typeof fetch;
  return bodies;
}

describe('AI with thinking models', () => {
  it('asks for structured JSON at low effort and reads text after a thinking block', async () => {
    const ctx = makeCtx({}, { env: { ANTHROPIC_API_KEY: 'test' } });
    const bodies = withClaude(ctx, {
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: '' },
        {
          type: 'text',
          text: JSON.stringify({
            verdicts: [
              { i: 0, same: true, reason: 'same size' },
              { i: 1, same: false, reason: 'six pack' },
            ],
          }),
        },
      ],
    });
    const verdicts = await judgeDoubtfulMatches(ctx, null, fp, ['A 150 ml', 'B 6 x 150 ml']);
    expect(verdicts.map((v) => v.same)).toEqual([true, false]);
    const body = bodies[0]!;
    expect(body.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
    // Room for thinking on top of the answer, so the reply is not cut off after thinking.
    expect(body.max_tokens).toBeGreaterThan(1024);
  });

  it('explains a reply that stopped before any text', async () => {
    const ctx = makeCtx({}, { env: { ANTHROPIC_API_KEY: 'test' } });
    withClaude(ctx, { stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '' }] });
    await expect(proposeFingerprint(ctx, 'rexona', [])).rejects.toThrow(/cut off/);
  });

  it('keeps a discovery running when AI matching fails', async () => {
    const web = {
      'https://www.etos.nl/rexona': productPage({
        name: 'Rexona deodorant spray',
        price: 4.99,
        brand: 'Rexona',
      }),
    };
    const ctx = makeCtx(web, {
      env: { ANTHROPIC_API_KEY: 'test' },
      searx: [{ url: 'https://www.etos.nl/rexona', title: 'Rexona' }],
    });
    const input = {
      productId: null,
      query: 'rexona',
      fingerprint: fp,
      follow: false,
    };
    const withoutAi = await runDiscovery(ctx, 0, { ...input, useAi: false });
    withClaude(ctx, { stop_reason: 'max_tokens', content: [] });
    const out = await runDiscovery(ctx, 0, { ...input, useAi: true });
    expect(out.map((c) => c.match)).toEqual(withoutAi.map((c) => c.match));
  });
});

describe('stores', () => {
  it('fills in a login page for existing installations without touching user changes', () => {
    const ctx = makeCtx({});
    const makro = ctx.db.select().from(stores).where(eq(stores.domain, 'makro.nl')).get()!;
    ctx.db
      .update(stores)
      .set({ rules: { requiresLogin: true, preferenceThresholdPct: 3 } })
      .where(eq(stores.id, makro.id))
      .run();
    seedStores(ctx);
    const after = ctx.db.select().from(stores).where(eq(stores.id, makro.id)).get()!;
    expect(after.rules).toEqual({
      requiresLogin: true,
      preferenceThresholdPct: 3,
      loginUrl: 'https://my.makro.nl/',
    });
  });

  it('only accepts a login page on the store domain', async () => {
    const ctx = makeCtx({});
    const app = createApp(ctx);
    const makro = ctx.db.select().from(stores).where(eq(stores.domain, 'makro.nl')).get()!;
    const patch = (loginUrl: string) =>
      app.request(`/gier/api/stores/${makro.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ loginUrl }),
      });
    expect((await patch('https://evil.example.com/')).status).toBe(400);
    expect((await patch('https://my.makro.nl/login')).status).toBe(200);
  });

  it('turns Browser Run limits into errors the user can act on', () => {
    expect(
      classifyBrowserRunError(new Error('429 Too Many Requests Rate limit exceeded')).code,
    ).toBe('browser_run_rate_limited');
    expect(
      classifyBrowserRunError(new Error('429: Browser time limit exceeded for today')).code,
    ).toBe('browser_run_daily_limit');
    expect(classifyBrowserRunError(new Error('401 Unauthorized')).code).toBe(
      'browser_run_unauthorized',
    );
  });
});

describe('images', () => {
  it('refuses image URLs that point into the local network', async () => {
    expect(await isPublicUrl('http://192.168.1.96:5001/x.png')).toBe(false);
    expect(await isPublicUrl('http://127.0.0.1/x.png')).toBe(false);
    expect(await isPublicUrl('http://localhost/x.png')).toBe(false);
    expect(await isPublicUrl('file:///etc/passwd')).toBe(false);
    expect(await isPublicUrl('https://93.184.215.14/x.png')).toBe(true);
  });

  it('picks a search thumbnail that resembles the product name', async () => {
    const ctx = makeCtx({});
    const ref = await referenceImage(ctx, 'Rexona Men Invisible 150 ml', [
      { url: 'https://a.nl/1', title: 'Something else', snippet: '', image: 'https://a.nl/x.jpg' },
      {
        url: 'https://b.nl/2',
        title: 'Rexona Men Invisible deospray',
        snippet: '',
        image: 'https://b.nl/y.jpg',
      },
    ]);
    expect(ref).toEqual({ imageUrl: 'https://b.nl/y.jpg', source: 'https://b.nl/2' });
  });

  it('serves the image proxy only for images', async () => {
    const ctx = makeCtx({});
    const app = createApp(ctx);
    expect((await app.request('/gier/api/img?u=http://10.0.0.1/a.png')).status).toBe(403);
  });
});
