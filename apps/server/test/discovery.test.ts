import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { FIXED_STORES, type Fingerprint } from '@gier/core';
import { discoveryRuns, products, stores } from '@gier/db';
import {
  discoveryDue,
  failInterruptedRuns,
  queriesFor,
  runDiscovery,
  startDiscovery,
} from '../src/services/discovery';
import { productDetail } from '../src/services/products';
import { makeCtx, productPage } from './helpers';

const syoss: Fingerprint = {
  title: 'Syoss Max Hold Haarspray 300 ml',
  brand: 'Syoss',
  line: 'Max Hold',
  form: 'haarspray',
  quantity: { packCount: 1, amount: 300, unit: 'ml' },
  gtin: null,
  model: null,
  locked: ['brand', 'line', 'quantity'],
  allowMultipack: true,
  compareUnit: 'piece',
  exclude: [],
};
const EAN = '5410091775070';

/** A Kruidvat page as it really looks: size only in the description, EAN only in the text, promotions in spans. */
const kruidvatPage = `<html><head><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'Syoss Hold 5 Max Hold Haarspray',
  description: '300ml',
  brand: { '@type': 'Brand', name: 'Syoss' },
  offers: {
    '@type': 'Offer',
    price: '7.99',
    priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
  },
})}</script></head><body>
<h1>Syoss Hold 5 Max Hold Haarspray</h1>
<div class="product-add-to-cart">
  <span class="product-add-to-cart__promotion-title">Clubactie: Syoss styling 1+2 gratis</span>
  <span class="product-add-to-cart__promotion-description">Alleen met je Kruidvat klantenkaart</span>
</div>
<div class="promotion-box"><div class="promotion-box__description">Got2b en Syoss Style 1+1 gratis</div></div>
<div class="product-recommendations"><span class="promo-badge">3 voor 2</span></div>
<p>EAN code:${EAN}</p>
<footer>KvK 12345678 · Retourneren</footer></body></html>`;

const KRUIDVAT_PAGE = 'https://www.kruidvat.nl/syoss-hold-5-max-hold-haarspray/p/6236270';
const BOL_2 =
  'https://www.bol.com/nl/nl/p/2-x-syoss-max-hold-haarspray-300-ml-2-stuks/9300000111111/';
const BOL_3 =
  'https://www.bol.com/nl/nl/p/3-x-syoss-max-hold-haarspray-300ml-grootverpakking/9300000222222/';
const AMAZON = 'https://www.amazon.nl/Syoss-Max-Hold-Haarspray-300/dp/B000000001';
const INKT = 'https://www.123inkt.nl/syoss-max-hold-haarspray-300ml';
const SCHOON = 'https://www.123schoon.nl/syoss-max-hold-300ml';
const MEGEKKO = 'https://www.megekko.nl/product/1/montagekit-syoss';

function syossWeb() {
  const query = queriesFor(syoss, 'Syoss Max Hold haarspray')[0]!;
  const kruidvatApi = FIXED_STORES.find(
    (s) => s.domain === 'kruidvat.nl',
  )!.rules!.search!.url.replace('{q}', encodeURIComponent(query));
  const web = {
    [kruidvatApi]: JSON.stringify({
      products: [{ url: '/syoss-hold-5-max-hold-haarspray/p/6236270', name: 'Syoss', ean: EAN }],
    }),
    [KRUIDVAT_PAGE]: kruidvatPage,
    // bol's own name leaves out the count; only the URL and heading carry it.
    [BOL_2]: productPage({
      name: 'Syoss - Max Hold - Haarspray - 300 ml - stuks',
      price: 24.95,
      brand: 'Syoss',
      seller: 'bol',
      extra: '<h1>2 x Syoss - Max Hold - Haarspray - 300 ml - 2 stuks</h1>',
    }),
    [BOL_3]: productPage({
      name: '3 x Syoss - Max Hold - Haarspray - Grootverpakking',
      price: 25.95,
      brand: 'Syoss',
      seller: 'bol',
    }),
    [AMAZON]: productPage({
      name: 'Syoss Max Hold Haarspray 300 ml',
      price: 18.34,
      brand: 'Syoss',
      seller: 'Amazon',
    }),
    [INKT]: productPage({ name: 'Syoss Max Hold Haarspray 300ml', price: 7.5, brand: 'Syoss' }),
    [SCHOON]: productPage({
      name: 'Syoss Max Hold 300ml',
      price: 5.49,
      brand: 'Syoss',
      gtin: EAN,
    }),
    [MEGEKKO]: productPage({ name: 'Montagekit voor wandsteun', price: 12.95 }),
  };
  return { web, query };
}

const searx = (q: string) => {
  if (q === EAN) return [{ url: SCHOON, title: 'Syoss' }];
  if (q.includes('site:')) return [];
  return [BOL_2, BOL_3, AMAZON, INKT, MEGEKKO].map((url) => ({ url, title: 'Syoss' }));
};

function addProduct(ctx: ReturnType<typeof makeCtx>) {
  const [product] = ctx.db
    .insert(products)
    .values({
      name: 'Syoss Max Hold Haarspray 300 ml',
      brand: 'Syoss',
      category: 'hair care',
      fingerprint: syoss,
    })
    .returning()
    .all();
  return product!;
}

describe('Syoss Max Hold: a real search that went wrong', () => {
  it('finds Kruidvat through its own search, reads its multi-buy deal and ranks it best', async () => {
    const { web } = syossWeb();
    const ctx = makeCtx(web, { searx });
    const product = addProduct(ctx);
    const [run] = ctx.db
      .insert(discoveryRuns)
      .values({ productId: product.id, query: product.name })
      .returning()
      .all();

    const candidates = await runDiscovery(ctx, run!.id, {
      productId: product.id,
      query: 'Syoss Max Hold haarspray',
      fingerprint: syoss,
      follow: true,
      useAi: false,
    });
    const by = (url: string) => candidates.find((c) => c.url === url)!;

    // Kruidvat: found through its own search; 1+1 counts, the card-only 1+2 is shown as a hint.
    const kv = by(KRUIDVAT_PAGE);
    expect(kv).toMatchObject({ match: 'match', trust: 'trusted', followed: true, gtin: EAN });
    expect(kv.promotion).toMatchObject({ kind: 'buy_get', quantity: 2, requires: 'none' });
    expect(kv.unitPriceCents).toBe(400);
    expect(kv.cardPromotion).toMatchObject({ quantity: 3, requires: 'card' });
    expect(kv.cardUnitCents).toBe(266);
    // The "3 voor 2" in the recommendations belongs to another product.
    expect(kv.promotion?.text).not.toContain('3 voor 2');

    // bol multipacks: count from the URL and the heading, and from "3 x" in the name.
    expect(by(BOL_2)).toMatchObject({ packCount: 2, unitPriceCents: 1248 });
    expect(by(BOL_3)).toMatchObject({ packCount: 3, unitPriceCents: 865 });
    expect(by(AMAZON)).toMatchObject({ packCount: 1, match: 'match' });
    expect(by(INKT).trust).toBe('trusted');
    expect(by(MEGEKKO).match).toBe('reject');

    // The EAN from Kruidvat is learned and finds a shop that web search for the name missed.
    expect(by(SCHOON)).toMatchObject({ match: 'match', followed: true });
    const saved = ctx.db.select().from(products).where(eq(products.id, product.id)).get()!;
    expect(saved.gtin).toBe(EAN);
    expect(saved.fingerprint.gtin).toBe(EAN);

    // Cheapest followed offer per item: Kruidvat with 1+1.
    const followed = candidates
      .filter((c) => c.followed)
      .sort((a, b) => a.unitPriceCents! - b.unitPriceCents!);
    expect(followed[0]!.url).toBe(KRUIDVAT_PAGE);

    // The product page shows the same: promotion applied, card deal offered.
    const detail = productDetail(ctx, product.id)!;
    const kvListing = detail.listings.find((l) => l.url === KRUIDVAT_PAGE)!;
    expect(kvListing.unitPriceCents).toBe(400);
    expect(kvListing.promotion?.kind).toBe('buy_get');
    expect(kvListing.cardPromotion?.unitCents).toBe(266);

    // With the card, the 1+2 counts.
    const kruidvat = ctx.db.select().from(stores).where(eq(stores.domain, 'kruidvat.nl')).get()!;
    ctx.db
      .update(stores)
      .set({ rules: { ...(kruidvat.rules ?? {}), loyaltyCard: true } })
      .where(eq(stores.id, kruidvat.id))
      .run();
    const withCard = productDetail(ctx, product.id)!.listings.find((l) => l.url === KRUIDVAT_PAGE)!;
    expect(withCard.unitPriceCents).toBe(266);
    expect(withCard.cardPromotion).toBeNull();
  });

  it('reports pages it could not read', async () => {
    const { web } = syossWeb();
    const blockedUrl =
      'https://www.etos.nl/producten/syoss-max-hold-haarspray-300-ml-120833672.html';
    const ctx = makeCtx(
      { ...web, [blockedUrl]: '<html><body>Are you a robot? captcha</body></html>' },
      { searx: (q) => (q.includes('site:') ? [] : [{ url: blockedUrl, title: 'Syoss' }]) },
    );
    const product = addProduct(ctx);
    const [run] = ctx.db
      .insert(discoveryRuns)
      .values({ productId: product.id, query: product.name })
      .returning()
      .all();
    await runDiscovery(ctx, run!.id, {
      productId: product.id,
      query: 'Syoss Max Hold haarspray',
      fingerprint: syoss,
      follow: false,
      useAi: false,
    });
    const stats = ctx.db.select().from(discoveryRuns).where(eq(discoveryRuns.id, run!.id)).get()!
      .stats!;
    expect(stats.unread).toContainEqual(
      expect.objectContaining({ url: blockedUrl, domain: 'etos.nl', reason: 'blocked' }),
    );
  });
});

describe('discovery scheduling', () => {
  it('runs one discovery per product and backs off after failures', () => {
    let now = new Date('2026-11-23T10:00:00Z');
    const ctx = makeCtx({}, { now: () => now });
    const product = addProduct(ctx);
    const input = {
      productId: product.id,
      query: product.name,
      fingerprint: syoss,
      follow: true,
      useAi: false,
    };

    ctx.db
      .insert(discoveryRuns)
      .values({ productId: product.id, query: product.name, status: 'running' })
      .run();
    expect(discoveryDue(ctx, product.id)).toBe(false);
    const existing = ctx.db.select().from(discoveryRuns).all()[0]!.id;
    expect(startDiscovery(ctx, input)).toBe(existing);

    // A restart ends it; then it counts as one failure.
    failInterruptedRuns(ctx);
    expect(ctx.db.select().from(discoveryRuns).all()[0]!.status).toBe('failed');
    expect(discoveryDue(ctx, product.id)).toBe(false);
    now = new Date(now.getTime() + 61 * 60_000);
    expect(discoveryDue(ctx, product.id)).toBe(true);

    // Two failures in a row: wait six hours.
    ctx.db
      .insert(discoveryRuns)
      .values({ productId: product.id, query: product.name, status: 'failed', finishedAt: now })
      .run();
    now = new Date(now.getTime() + 2 * 3600_000);
    expect(discoveryDue(ctx, product.id)).toBe(false);
    now = new Date(now.getTime() + 5 * 3600_000);
    expect(discoveryDue(ctx, product.id)).toBe(true);
  });
});
