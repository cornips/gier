import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { fingerprintFromTitle } from '@gier/core';
import { listings, openDb, pricePoints, products, stores } from '../src';

describe('database', () => {
  it('migrates and stores a product with a listing and price points', () => {
    const { db, sqlite } = openDb(':memory:');
    const [product] = db
      .insert(products)
      .values({
        name: 'Sony WH-1000XM6',
        fingerprint: fingerprintFromTitle('Sony WH-1000XM6', 'Sony'),
      })
      .returning()
      .all();
    const [store] = db
      .insert(stores)
      .values({ name: 'Coolblue', domain: 'coolblue.nl', isFixed: true, trust: 'trusted' })
      .returning()
      .all();
    const [listing] = db
      .insert(listings)
      .values({ productId: product!.id, storeId: store!.id, url: 'https://www.coolblue.nl/p/1' })
      .returning()
      .all();
    db.insert(pricePoints)
      .values({ listingId: listing!.id, observedAt: new Date(), priceCents: 34900 })
      .run();
    const rows = db.select().from(pricePoints).where(eq(pricePoints.listingId, listing!.id)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.referenceType).toBe('none');
    expect(db.select().from(products).all()).toHaveLength(1);
    sqlite.close();
  });
});
