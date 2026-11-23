/**
 * Fills a database with realistic demo data: products with months of price history across
 * several stores, including a fake discount. For screenshots, UI work and trying Gier out.
 *
 *   pnpm --filter @gier/server demo   (uses DATABASE_FILE, default ./data/gier.db)
 */
import { openDb } from '@gier/db';
import { alerts, listings, notifications, pricePoints, products, stores } from '@gier/db/schema';
import { fingerprintFromTitle } from '@gier/core';
import { eq } from 'drizzle-orm';
import { loadEnv } from './env';
import { Fetcher } from './lib/fetcher';
import { seedStores } from './services/stores';

const DAY = 86_400_000;
const env = loadEnv();
const { db, sqlite } = openDb(env.DATABASE_FILE);
const now = Date.now();
seedStores({
  env,
  db,
  fetcher: new Fetcher({ userAgent: env.USER_AGENT }),
  http: fetch,
  now: () => new Date(),
});

// Deterministic pseudo-random so screenshots are stable.
let seed = 42;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

interface Plan {
  name: string;
  brand: string;
  image?: string;
  compareUnit?: 'piece' | 'per100';
  target?: number;
  days: number;
  stores: {
    name: string;
    base: number;
    pack?: number;
    shipping?: number;
    fake?: boolean;
    drift?: number;
  }[];
}

const plans: Plan[] = [
  {
    name: 'Sony WH-1000XM6 wireless headphones',
    brand: 'Sony',
    target: 32900,
    days: 210,
    stores: [
      { name: 'Coolblue', base: 39900, drift: -0.18 },
      { name: 'bol', base: 39900, drift: -0.2 },
      { name: 'MediaMarkt', base: 41900, drift: -0.12, fake: true },
      { name: 'Amazon.nl', base: 38900, drift: -0.17 },
    ],
  },
  {
    name: 'Rexona Men Invisible antiperspirant spray 150 ml',
    brand: 'Rexona',
    compareUnit: 'piece',
    days: 160,
    stores: [
      { name: 'Kruidvat', base: 499, drift: -0.1 },
      { name: 'Etos', base: 529 },
      { name: 'Albert Heijn', base: 549, drift: 0.04 },
      { name: 'bol', base: 1399, pack: 3, drift: -0.05 },
    ],
  },
  {
    name: 'Philips Airfryer XXL HD9285/90',
    brand: 'Philips',
    days: 120,
    stores: [
      { name: 'Coolblue', base: 22999, fake: true },
      { name: 'bol', base: 21999, drift: -0.05 },
      { name: 'MediaMarkt', base: 22999, drift: 0.02 },
    ],
  },
  {
    name: 'LEGO Technic Ferrari SF-24 42207',
    brand: 'LEGO',
    days: 90,
    stores: [
      { name: 'bol', base: 21999, drift: -0.22 },
      { name: 'Amazon.nl', base: 20999, drift: -0.2 },
      { name: 'HEMA', base: 22999 },
    ],
  },
  {
    name: 'Samsung 990 PRO 2TB NVMe SSD',
    brand: 'Samsung',
    days: 300,
    stores: [
      { name: 'Megekko', base: 15900, drift: 0.12, shipping: 495 },
      { name: 'Azerty', base: 15499, drift: 0.14 },
      { name: 'Alternate', base: 16290, drift: 0.1 },
      { name: 'Paradigit', base: 16900, drift: 0.08 },
    ],
  },
  {
    name: 'Rituals The Ritual of Sakura Foaming Shower Gel 200 ml',
    brand: 'Rituals',
    days: 20,
    stores: [
      { name: 'Rituals', base: 1050 },
      { name: 'Douglas', base: 1050, drift: -0.1 },
    ],
  },
];

for (const plan of plans) {
  const fp = fingerprintFromTitle(plan.name, plan.brand);
  const [product] = db
    .insert(products)
    .values({
      name: plan.name,
      brand: plan.brand,
      fingerprint: fp,
      compareUnit: plan.compareUnit ?? fp.compareUnit,
      targetPriceCents: plan.target ?? null,
      aiBudgetTier: 'frugal',
      createdAt: new Date(now - plan.days * DAY),
    })
    .returning()
    .all();
  db.insert(alerts)
    .values([
      {
        productId: product!.id,
        kind: 'below',
        thresholdCents: plan.target ?? null,
        active: Boolean(plan.target),
      },
      { productId: product!.id, kind: 'all_time_low' },
      { productId: product!.id, kind: 'fake_discount' },
      { productId: product!.id, kind: 'new_store' },
    ])
    .run();

  for (const s of plan.stores) {
    const store = db.select().from(stores).where(eq(stores.name, s.name)).get();
    if (!store) throw new Error(`Unknown store ${s.name}`);
    const [listing] = db
      .insert(listings)
      .values({
        productId: product!.id,
        storeId: store.id,
        url: `https://www.${store.domain}/demo/${product!.id}`,
        title: s.pack ? `${plan.name} (${s.pack}-pack)` : plan.name,
        packCount: s.pack ?? 1,
        followedAutomatically: true,
        lastCheckedAt: new Date(now - Math.round(rnd() * 3 * 3600_000)),
        nextCheckAt: new Date(now + 6 * 3600_000),
      })
      .returning()
      .all();
    let price = s.base;
    const points: (typeof pricePoints.$inferInsert)[] = [];
    for (let d = plan.days; d >= 0; d -= 1) {
      const progress = 1 - d / plan.days;
      const trend = Math.round(s.base * (1 + (s.drift ?? 0) * progress));
      // Occasional short promos, otherwise follow the trend in whole-euro steps.
      const promo = rnd() < 0.04;
      let next = promo ? Math.round(trend * 0.9) : trend;
      next = Math.round(next / 100) * 100 - 1;
      if (s.fake && d === 6) next = Math.round((s.base * 1.25) / 100) * 100 - 1; // raise first…
      if (s.fake && d < 6) next = Math.round((s.base * 1.02) / 100) * 100 - 1; // …then a "sale"
      if (next !== price || d === plan.days || d === 0) {
        points.push({
          listingId: listing!.id,
          observedAt: new Date(now - d * DAY - Math.round(rnd() * 6 * 3600_000)),
          priceCents: next,
          shippingCents: s.shipping ?? 0,
          inStock: true,
          referenceCents: s.fake && d < 6 ? Math.round((s.base * 1.25) / 100) * 100 - 1 : null,
          referenceType: s.fake && d < 6 ? 'was' : 'none',
          claimedDiscountPct: s.fake && d < 6 ? 18 : null,
          dealLabel: s.fake && d < 6 ? 'Black Friday' : null,
        });
        price = next;
      }
    }
    db.insert(pricePoints).values(points).run();
  }
}

const first = db.select().from(products).get();
db.insert(notifications)
  .values([
    {
      productId: first!.id,
      kind: 'deal',
      title: 'Top deal · Sony WH-1000XM6',
      body: 'Lowest price ever at bol.',
      deliveredVia: ['push'],
      createdAt: new Date(now - 2 * 3600_000),
    },
    {
      productId: first!.id,
      kind: 'fake',
      title: 'Fake discount spotted · MediaMarkt',
      body: 'Raised first, then “18% off”.',
      deliveredVia: ['push', 'telegram'],
      createdAt: new Date(now - 26 * 3600_000),
      readAt: new Date(now - 20 * 3600_000),
    },
    {
      productId: null,
      kind: 'store',
      title: 'New store learned',
      body: 'Paradigit passed the trust checks and is now followed.',
      createdAt: new Date(now - 4 * DAY),
      readAt: new Date(now - 3 * DAY),
    },
  ])
  .run();

console.log(`Demo data added to ${env.DATABASE_FILE}: ${plans.length} products.`);
sqlite.close();
