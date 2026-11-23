import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  DAY,
  isFakeDiscount,
  lowestSeries,
  payPrice,
  percentChange,
  pointAt,
  productVerdict,
  runChecks,
  unitPrice,
  type Finding,
  type PricePoint,
} from '@gier/core';
import {
  adviceEntries,
  aiCalls,
  alerts,
  listings,
  pricePoints,
  products,
  stores,
  type Listing,
  type PricePointRow,
  type Product,
  type Store,
} from '@gier/db';
import type { Ctx } from '../context';

export const toPricePoint = (r: PricePointRow): PricePoint => ({
  at: r.observedAt,
  priceCents: r.priceCents,
  shippingCents: r.shippingCents,
  inStock: r.inStock,
  referenceCents: r.referenceCents,
  referenceType: r.referenceType,
  claimedDiscountPct: r.claimedDiscountPct,
  dealLabel: r.dealLabel,
});

export interface ListingSeries {
  listing: Listing;
  store: Store;
  /** Raw observations as shown by the shop. */
  points: PricePoint[];
  /** Pay price per compare unit (multipacks divided, shipping included). */
  unitPoints: PricePoint[];
}

export function toUnitPoints(
  product: Product,
  listing: Listing,
  points: PricePoint[],
): PricePoint[] {
  const q = product.fingerprint.quantity;
  const quantity = {
    packCount: listing.packCount,
    amount: q?.amount ?? 1,
    unit: q?.unit ?? ('piece' as const),
  };
  return points.map((p) => ({
    ...p,
    priceCents: unitPrice(payPrice(p), quantity, product.compareUnit),
    shippingCents: 0,
    referenceCents: p.referenceCents
      ? unitPrice(p.referenceCents, quantity, product.compareUnit)
      : p.referenceCents,
  }));
}

export const asVerdictSeries = (s: ListingSeries) => ({
  storeName: s.store.name,
  points: s.unitPoints,
  preferencePenaltyPct: s.store.rules?.preferenceThresholdPct,
});

export function loadSeries(ctx: Ctx, product: Product): ListingSeries[] {
  const rows = ctx.db
    .select({ listing: listings, store: stores })
    .from(listings)
    .innerJoin(stores, eq(listings.storeId, stores.id))
    .where(and(eq(listings.productId, product.id), eq(listings.active, true)))
    .all();
  return rows.map(({ listing, store }) => {
    const points = ctx.db
      .select()
      .from(pricePoints)
      .where(eq(pricePoints.listingId, listing.id))
      .orderBy(asc(pricePoints.observedAt))
      .all()
      .map(toPricePoint);
    return { listing, store, points, unitPoints: toUnitPoints(product, listing, points) };
  });
}

function sparkline(series: PricePoint[], from: Date, to: Date, samples = 16): number[] {
  if (!series.length) return [];
  const out: number[] = [];
  const span = Math.max(DAY, to.getTime() - from.getTime());
  for (let i = 0; i < samples; i += 1) {
    const p = pointAt(series, new Date(from.getTime() + (span * i) / (samples - 1)));
    if (p) out.push(p.priceCents);
  }
  return out;
}

export interface ListingView {
  id: number;
  url: string;
  title: string | null;
  storeId: number;
  storeName: string;
  storeTrust: Store['trust'];
  packCount: number;
  followedAutomatically: boolean;
  priceCents: number | null;
  unitPriceCents: number | null;
  shippingCents: number | null;
  inStock: boolean | null;
  referenceCents: number | null;
  referenceType: string | null;
  claimedDiscountPct: number | null;
  dealLabel: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  findings: Finding[];
}

export function listingViews(series: ListingSeries[], now: Date): ListingView[] {
  return series
    .map((s) => {
      const current = pointAt(s.points, now);
      const unit = pointAt(s.unitPoints, now);
      const findings = runChecks({
        storeName: s.store.name,
        points: s.unitPoints,
        others: series
          .filter((o) => o !== s)
          .map((o) => ({ storeName: o.store.name, points: o.unitPoints })),
        now,
      });
      return {
        id: s.listing.id,
        url: s.listing.url,
        title: s.listing.title,
        storeId: s.store.id,
        storeName: s.store.name,
        storeTrust: s.store.trust,
        packCount: s.listing.packCount,
        followedAutomatically: s.listing.followedAutomatically,
        priceCents: current?.priceCents ?? null,
        unitPriceCents: unit?.priceCents ?? null,
        shippingCents: current?.shippingCents ?? null,
        inStock: current?.inStock ?? null,
        referenceCents: current?.referenceCents ?? null,
        referenceType: current?.referenceType ?? null,
        claimedDiscountPct: current?.claimedDiscountPct ?? null,
        dealLabel: current?.dealLabel ?? null,
        lastCheckedAt: s.listing.lastCheckedAt?.toISOString() ?? null,
        lastError: s.listing.lastError,
        findings,
      };
    })
    .sort((a, b) => (a.unitPriceCents ?? Infinity) - (b.unitPriceCents ?? Infinity));
}

export function aiCostForProduct(ctx: Ctx, productId: number) {
  return (
    ctx.db
      .select({
        calls: sql<number>`count(*)`,
        eur: sql<number>`coalesce(sum(${aiCalls.costEur}), 0)`,
        inputTokens: sql<number>`coalesce(sum(${aiCalls.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${aiCalls.outputTokens}), 0)`,
      })
      .from(aiCalls)
      .where(eq(aiCalls.productId, productId))
      .get() ?? { calls: 0, eur: 0, inputTokens: 0, outputTokens: 0 }
  );
}

export function productSummary(ctx: Ctx, product: Product) {
  const now = ctx.now();
  const series = loadSeries(ctx, product);
  const verdict = productVerdict(series.map(asVerdictSeries), now);
  const first = Math.min(
    now.getTime(),
    ...series.flatMap((s) => s.points.map((p) => p.at.getTime())),
  );
  const lowest = lowestSeries(series.map(asVerdictSeries), new Date(first), now);
  const start = lowest[0]?.priceCents ?? null;
  const views = listingViews(series, now);
  const activeAlerts = ctx.db
    .select()
    .from(alerts)
    .where(and(eq(alerts.productId, product.id), eq(alerts.active, true)))
    .all();
  return {
    id: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    imageUrl: product.imageUrl,
    compareUnit: product.compareUnit,
    storesCount: series.length,
    lowestCents: verdict.currentLowest,
    lowestStore: verdict.currentStore,
    startCents: start,
    deltaPct: start && verdict.currentLowest ? percentChange(start, verdict.currentLowest) : null,
    label: verdict.label,
    allTimeLow: verdict.allTimeLow,
    fakeDiscounts: views.filter((v) => isFakeDiscount(v.findings)).length,
    sparkline: sparkline(lowest, new Date(first), now),
    alerts: activeAlerts.map((a) => ({ kind: a.kind, thresholdCents: a.thresholdCents })),
    trackedSince: new Date(first).toISOString(),
    lastCheckedAt:
      series
        .map((s) => s.listing.lastCheckedAt?.getTime() ?? 0)
        .reduce((a, b) => Math.max(a, b), 0) || null,
  };
}

export function listProducts(ctx: Ctx) {
  return ctx.db
    .select()
    .from(products)
    .where(isNull(products.archivedAt))
    .orderBy(desc(products.createdAt))
    .all()
    .map((p) => productSummary(ctx, p));
}

export function productDetail(ctx: Ctx, productId: number) {
  const product = ctx.db.select().from(products).where(eq(products.id, productId)).get();
  if (!product) return null;
  const now = ctx.now();
  const series = loadSeries(ctx, product);
  const summary = productSummary(ctx, product);
  const first = Math.min(
    now.getTime(),
    ...series.flatMap((s) => s.points.map((p) => p.at.getTime())),
  );
  const lowest = lowestSeries(series.map(asVerdictSeries), new Date(first), now);
  const verdict = productVerdict(series.map(asVerdictSeries), now);
  const changes = series
    .flatMap((s) =>
      s.points.slice(1).map((p, i) => ({
        at: p.at.toISOString(),
        storeName: s.store.name,
        fromCents: payPrice(s.points[i]!),
        toCents: payPrice(p),
      })),
    )
    .filter((c) => c.fromCents !== c.toCents)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 20);
  const advice = ctx.db
    .select()
    .from(adviceEntries)
    .where(eq(adviceEntries.productId, productId))
    .orderBy(desc(adviceEntries.createdAt))
    .get();
  return {
    ...summary,
    fingerprint: product.fingerprint,
    gtin: product.gtin,
    notes: product.notes,
    targetPriceCents: product.targetPriceCents,
    aiBudgetTier: product.aiBudgetTier,
    adviceMode: product.adviceMode,
    verdict,
    lowestSeries: lowest.map((p) => ({ at: p.at.toISOString(), cents: p.priceCents })),
    storeSeries: series.map((s) => ({
      storeName: s.store.name,
      points: s.unitPoints.map((p) => ({ at: p.at.toISOString(), cents: p.priceCents })),
    })),
    listings: listingViews(series, now),
    changes,
    alertRules: ctx.db.select().from(alerts).where(eq(alerts.productId, productId)).all(),
    advice: advice ? { text: advice.text, createdAt: advice.createdAt.toISOString() } : null,
    aiCost: aiCostForProduct(ctx, productId),
  };
}

export type ProductSummary = ReturnType<typeof productSummary>;
export type ProductDetail = NonNullable<ReturnType<typeof productDetail>>;
