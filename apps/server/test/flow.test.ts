import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { fingerprintFromTitle, type Fingerprint } from '@gier/core';
import { alerts, listings, notifications, pricePoints, products, stores } from '@gier/db';
import { createApp } from '../src/app';
import { setLanguage, translator } from '../src/i18n';
import { decrypt, encrypt } from '../src/lib/crypto';
import { checkListing } from '../src/services/checker';
import { runDiscovery } from '../src/services/discovery';
import { seedStores } from '../src/services/stores';
import { productDetail } from '../src/services/products';
import { makeCtx, productPage } from './helpers';

const rexona: Fingerprint = {
  title: 'Rexona Men Invisible Black + White deodorant spray 150 ml',
  brand: 'Rexona',
  line: 'Men Invisible Black White',
  form: 'spray',
  quantity: { packCount: 1, amount: 150, unit: 'ml' },
  gtin: null,
  model: null,
  locked: ['brand', 'line', 'quantity'],
  allowMultipack: true,
  compareUnit: 'piece',
  exclude: [],
};

describe('discovery → follow → check → alert', () => {
  it('finds trustworthy shops, follows them and reacts to a price drop', async () => {
    let kruidvatPrice = 4.49;
    const web = {
      'https://www.kruidvat.nl/rexona-150': () =>
        productPage({
          name: 'Rexona Men Invisible Black & White deospray 150 ml',
          price: kruidvatPrice,
          brand: 'Rexona',
        }),
      'https://www.plein.nl/rexona-6x150': productPage({
        name: 'Rexona Men Invisible Black + White deodorant spray 6 x 150 ml',
        price: 19.95,
        brand: 'Rexona',
      }),
      'https://www.etos.nl/rexona-200': productPage({
        name: 'Rexona Men Invisible Black + White spray 200 ml',
        price: 5.29,
        brand: 'Rexona',
      }),
      'https://deo-nieuw-voordeel.nl/rexona': productPage({
        name: 'Rexona Men Invisible Black White spray 150ml',
        price: 1.49,
        brand: 'Rexona',
        footer: '',
      }),
      'https://www.youtube.com/watch?v=1': '<html></html>',
    };
    const ctx = makeCtx(web, {
      searx: Object.keys(web).map((url) => ({ url, title: 'Rexona' })),
    });
    const [product] = ctx.db
      .insert(products)
      .values({ name: rexona.title, brand: 'Rexona', category: 'verzorging', fingerprint: rexona })
      .returning()
      .all();
    ctx.db.insert(alerts).values({ productId: product!.id, kind: 'all_time_low' }).run();

    const candidates = await runDiscovery(ctx, 0, {
      productId: product!.id,
      query: 'rexona men invisible',
      fingerprint: rexona,
      follow: true,
      useAi: false,
    });
    const byDomain = Object.fromEntries(candidates.map((c) => [c.domain, c]));
    expect(byDomain['kruidvat.nl']).toMatchObject({
      match: 'match',
      trust: 'trusted',
      followed: true,
    });
    expect(byDomain['plein.nl']).toMatchObject({
      match: 'match',
      trust: 'trusted',
      followed: true,
      packCount: 6,
      unitPriceCents: 333,
    });
    expect(byDomain['etos.nl']?.match).toBe('reject');
    expect(byDomain['deo-nieuw-voordeel.nl']).toMatchObject({
      match: 'match',
      trust: 'excluded',
      followed: false,
    });
    expect(byDomain['youtube.com']).toBeUndefined();

    const followed = ctx.db
      .select()
      .from(listings)
      .where(eq(listings.productId, product!.id))
      .all();
    expect(followed).toHaveLength(2);

    // A price drop at Kruidvat below everything seen before fires the all-time-low alert.
    kruidvatPrice = 2.99;
    const kv = followed.find((l) => l.url.includes('kruidvat'))!;
    const outcome = await checkListing(ctx, kv);
    expect(outcome.status).toBe('changed');
    const inbox = ctx.db.select().from(notifications).all();
    // The first search ran unwatched, so it announced itself; then the price drop.
    expect(inbox.map((n) => n.title)).toEqual([
      `Search done · ${rexona.title}`,
      `Top deal · ${rexona.title}`,
    ]);

    // Notifications follow the language the web app reports.
    setLanguage(ctx, 'nl');
    expect(translator(ctx).t('alert.low.title', { product: 'X' })).toBe('Topdeal · X');

    // Unchanged price → no new point within a day.
    expect((await checkListing(ctx, kv)).status).toBe('unchanged');
    expect(
      ctx.db.select().from(pricePoints).where(eq(pricePoints.listingId, kv.id)).all(),
    ).toHaveLength(2);

    const detail = productDetail(ctx, product!.id)!;
    expect(detail.lowestCents).toBe(299);
    expect(detail.lowestStore).toBe('Kruidvat');
    expect(detail.listings[0]!.storeName).toBe('Kruidvat');
  });

  it('only counts offers sold by bol itself', async () => {
    const ctx = makeCtx({
      'https://www.bol.com/nl/p/1': productPage({
        name: 'Sony WH-1000XM6',
        price: 299,
        brand: 'Sony',
        seller: 'Koptelefoonshop BV',
      }),
    });
    const bol = ctx.db.select().from(stores).where(eq(stores.domain, 'bol.com')).get()!;
    ctx.db
      .update(stores)
      .set({ rules: { soldByOnly: 'bol' } })
      .where(eq(stores.id, bol.id))
      .run();
    const [product] = ctx.db
      .insert(products)
      .values({
        name: 'Sony WH-1000XM6',
        fingerprint: fingerprintFromTitle('Sony WH-1000XM6', 'Sony'),
      })
      .returning()
      .all();
    const [listing] = ctx.db
      .insert(listings)
      .values({ productId: product!.id, storeId: bol.id, url: 'https://www.bol.com/nl/p/1' })
      .returning()
      .all();
    const outcome = await checkListing(ctx, listing!);
    expect(outcome).toMatchObject({ status: 'skipped', error: 'seller:Koptelefoonshop BV' });
  });
});

describe('API', () => {
  it('serves health, products and stores', async () => {
    const ctx = makeCtx({
      'https://www.coolblue.nl/p/1': productPage({
        name: 'Philips Hue starterkit E27',
        price: 149.99,
        brand: 'Philips',
      }),
    });
    const app = createApp(ctx);
    const health = (await (await app.request('/gier/api/health')).json()) as { ok: boolean };
    expect(health.ok).toBe(true);

    const created = await app.request('/gier/api/products/from-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.coolblue.nl/p/1' }),
    });
    expect(created.status).toBe(201);
    const list = (await (await app.request('/gier/api/products')).json()) as {
      name: string;
      lowestCents: number;
      lowestStore: string;
    }[];
    expect(list[0]).toMatchObject({
      name: 'Philips Hue starterkit E27',
      lowestCents: 14999,
      lowestStore: 'Coolblue',
    });

    const storesRes = (await (await app.request('/gier/api/stores')).json()) as {
      name: string;
      hasSession: boolean;
    }[];
    expect(storesRes).toHaveLength(38);
    expect(storesRes.every((s) => !('sessionEncrypted' in s))).toBe(true);

    const csv = await (await app.request('/gier/api/products/1/export.csv')).text();
    expect(csv.split('\n')[1]).toContain('"149.99"');

    const bad = await app.request('/gier/api/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(bad.status).toBe(400);
  });

  it('lets users change a store preference (ADR-013)', async () => {
    const ctx = makeCtx({});
    seedStores(ctx);
    const app = createApp(ctx);
    const amazon = ctx.db.select().from(stores).where(eq(stores.domain, 'amazon.nl')).get()!;
    expect(amazon.rules?.preferenceThresholdPct).toBe(5);
    const res = await app.request(`/gier/api/stores/${amazon.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preferenceThresholdPct: 0 }),
    });
    expect(res.status).toBe(200);
    const after = ctx.db.select().from(stores).where(eq(stores.id, amazon.id)).get()!;
    expect(after.rules?.preferenceThresholdPct).toBeUndefined();
    expect(after.rules?.soldByOnly).toBe('Amazon');
  });

  it('replaces alert rules for a product', async () => {
    const ctx = makeCtx({});
    const app = createApp(ctx);
    const created = await app.request('/gier/api/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Test',
        query: 'test',
        discover: false,
        fingerprint: {
          title: 'Test',
          locked: [],
          allowMultipack: false,
          compareUnit: 'piece',
          exclude: [],
        },
      }),
    });
    const { product } = (await created.json()) as { product: { id: number } };
    const res = await app.request(`/gier/api/products/${product.id}/alerts`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        { kind: 'below', thresholdCents: 1999 },
        { kind: 'fake_discount', active: false },
      ]),
    });
    const rules = (await res.json()) as { kind: string; active: boolean }[];
    expect(rules.map((r) => [r.kind, r.active])).toEqual([
      ['below', true],
      ['fake_discount', false],
    ]);
  });

  it('falls back to rule-based fingerprints without an API key', async () => {
    const ctx = makeCtx(
      {},
      {
        searx: [{ url: 'https://www.bol.com/p/x', title: 'Sony WH-1000XM6 draadloze koptelefoon' }],
      },
    );
    const app = createApp(ctx);
    const res = await app.request('/gier/api/discovery/fingerprint', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'sony xm6' }),
    });
    const body = (await res.json()) as {
      source: string;
      aiUnavailable: string;
      fingerprint: { model: string };
    };
    expect(body).toMatchObject({ source: 'rules', aiUnavailable: 'no_key' });
    expect(body.fingerprint.model).toBe('WH-1000XM6');
  });
});

describe('weekly digest', () => {
  it('is due on Sunday from 10:00 Amsterdam time, once a week', async () => {
    const { digestDue } = await import('../src/services/digest');
    const sunday11 = new Date('2026-11-22T10:00:00Z'); // 11:00 CET
    expect(digestDue(sunday11, null)).toBe(true);
    expect(digestDue(new Date('2026-11-22T08:30:00Z'), null)).toBe(false); // 09:30 CET
    expect(digestDue(new Date('2026-11-23T10:00:00Z'), null)).toBe(false); // Monday
    expect(digestDue(sunday11, sunday11.getTime() - 3600_000)).toBe(false);
    expect(digestDue(sunday11, sunday11.getTime() - 7 * 86_400_000)).toBe(true);
  });
});

describe('helpers', () => {
  it('encrypts sessions', () => {
    const secret = 'a-very-long-test-secret';
    const sealed = encrypt('[{"name":"sid","value":"x"}]', secret);
    expect(sealed).not.toContain('sid');
    expect(decrypt(sealed, secret)).toBe('[{"name":"sid","value":"x"}]');
    expect(() => decrypt(sealed, 'another-secret-value')).toThrow();
  });
});
