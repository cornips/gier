import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import {
  addVat,
  DAY,
  domainOf,
  extractOffer,
  nextCheckDelay,
  productVerdict,
  runChecks,
  type ExtractedOffer,
} from '@gier/core';
import { listings, pricePoints, products, stores, type Listing, type Store } from '@gier/db';
import type { Ctx } from '../context';
import { decrypt } from '../lib/crypto';
import { evaluateAlerts } from './alerts';
import { cookieHeader, renderHtml, type StoredCookie } from './browser-run';
import { notify } from './notify';
import { asVerdictSeries, loadSeries, toPricePoint } from './products';
import { translator } from '../i18n';

export interface CheckOutcome {
  listingId: number;
  productId: number;
  status: 'changed' | 'unchanged' | 'failed' | 'skipped';
  priceCents?: number | null;
  error?: string;
}

function sessionCookies(ctx: Ctx, store: Store): StoredCookie[] {
  if (!store.sessionEncrypted) return [];
  try {
    return JSON.parse(decrypt(store.sessionEncrypted, ctx.env.GIER_SECRET)) as StoredCookie[];
  } catch {
    return [];
  }
}

/** Fetches a page politely; falls back to Browser Run when the plain fetch is blocked or has no price. */
export async function fetchOffer(
  ctx: Ctx,
  url: string,
  store: Store | null,
  opts: { mayRender?: () => boolean } = {},
): Promise<{ offer: ExtractedOffer | null; html?: string; error?: string }> {
  const cookies = store ? sessionCookies(ctx, store) : [];
  const domain = domainOf(url) ?? '';
  const res = await ctx.fetcher.get(url, {
    cookie: cookies.length ? cookieHeader(cookies, domain) : undefined,
  });
  let html = res.ok ? res.html : undefined;
  let offer = html ? extractOffer(html, res.url, store?.selectors ?? undefined) : null;
  if (!offer?.priceCents && (opts.mayRender?.() ?? true)) {
    const rendered = await renderHtml(ctx, url, cookies).catch(() => null);
    if (rendered) {
      html = rendered;
      offer = extractOffer(rendered, url, store?.selectors ?? undefined);
      if (offer.priceCents && store && store.extraction !== 'browser') {
        ctx.db.update(stores).set({ extraction: 'browser' }).where(eq(stores.id, store.id)).run();
      }
    }
  }
  if (!offer?.priceCents)
    return {
      offer,
      html,
      error: res.blocked ? 'blocked' : res.ok ? 'no_price' : `http_${res.status}`,
    };
  return { offer, html };
}

/** Applies store rules from the registry (ADR-013): seller restrictions and VAT conversion. */
export function applyStoreRules(
  offer: ExtractedOffer,
  store: Store,
): { offer: ExtractedOffer; rejected?: string } {
  const rules = store.rules ?? {};
  if (
    rules.soldByOnly &&
    offer.sellerName &&
    !offer.sellerName.toLowerCase().includes(rules.soldByOnly.toLowerCase())
  ) {
    if (!rules.partnersAsFallback) return { offer, rejected: `seller:${offer.sellerName}` };
  }
  if (rules.pricesExcludeVat && offer.priceCents) {
    return {
      offer: {
        ...offer,
        priceCents: addVat(offer.priceCents),
        referenceCents: offer.referenceCents ? addVat(offer.referenceCents) : null,
      },
    };
  }
  return { offer };
}

const sameObservation = (a: typeof pricePoints.$inferSelect, o: ExtractedOffer) =>
  a.priceCents === o.priceCents &&
  (a.shippingCents ?? null) === (o.shippingCents ?? null) &&
  a.inStock === (o.availability !== 'out_of_stock') &&
  (a.referenceCents ?? null) === (o.referenceCents ?? null) &&
  (a.dealLabel ?? null) === (o.dealLabel ?? null) &&
  (a.claimedDiscountPct ?? null) === (o.claimedDiscountPct ?? null) &&
  JSON.stringify(a.promotions ?? []) === JSON.stringify(o.promotions ?? []);

/** Stores a price point only when something changed, plus one heartbeat per day (ADR-004). */
export function recordObservation(
  ctx: Ctx,
  listing: Listing,
  offer: ExtractedOffer,
): 'changed' | 'unchanged' {
  const last = ctx.db
    .select()
    .from(pricePoints)
    .where(eq(pricePoints.listingId, listing.id))
    .orderBy(desc(pricePoints.observedAt))
    .get();
  const now = ctx.now();
  if (last && sameObservation(last, offer)) {
    if (now.getTime() - last.observedAt.getTime() >= DAY) {
      ctx.db
        .insert(pricePoints)
        .values({ ...rowFrom(listing, offer, now), isHeartbeat: true })
        .run();
    }
    return 'unchanged';
  }
  ctx.db
    .insert(pricePoints)
    .values(rowFrom(listing, offer, now))
    .run();
  return 'changed';
}

const rowFrom = (listing: Listing, o: ExtractedOffer, at: Date) => ({
  listingId: listing.id,
  observedAt: at,
  priceCents: o.priceCents!,
  shippingCents: o.shippingCents,
  inStock: o.availability !== 'out_of_stock',
  referenceCents: o.referenceCents,
  referenceType: o.referenceType,
  claimedDiscountPct: o.claimedDiscountPct,
  dealLabel: o.dealLabel,
  promotions: o.promotions?.length ? o.promotions : null,
});

export async function checkListing(ctx: Ctx, listing: Listing): Promise<CheckOutcome> {
  const store = ctx.db.select().from(stores).where(eq(stores.id, listing.storeId)).get()!;
  const product = ctx.db.select().from(products).where(eq(products.id, listing.productId)).get()!;
  const now = ctx.now();
  const before = loadSeries(ctx, product);
  const verdictBefore = productVerdict(before.map(asVerdictSeries), now);
  const mine = before.find((s) => s.listing.id === listing.id);
  const findingsBefore = mine
    ? runChecks({
        storeName: store.name,
        points: mine.unitPoints,
        others: before
          .filter((s) => s !== mine)
          .map((s) => ({ storeName: s.store.name, points: s.unitPoints })),
        now,
      })
    : [];
  const wasOutOfStock = mine?.points.at(-1)?.inStock === false;

  const { offer, error } = await fetchOffer(ctx, listing.url, store);
  const recentChanges = ctx.db
    .select({ id: pricePoints.id })
    .from(pricePoints)
    .where(
      and(
        eq(pricePoints.listingId, listing.id),
        eq(pricePoints.isHeartbeat, false),
        gte(pricePoints.observedAt, new Date(now.getTime() - 30 * DAY)),
      ),
    )
    .all().length;

  if (!offer?.priceCents || error) {
    const failStreak = listing.failStreak + 1;
    ctx.db
      .update(listings)
      .set({
        lastCheckedAt: now,
        failStreak,
        lastError: error ?? 'no_price',
        nextCheckAt: new Date(
          now.getTime() + nextCheckDelay({ now, hasDealLabel: false, recentChanges, failStreak }),
        ),
      })
      .where(eq(listings.id, listing.id))
      .run();
    ctx.db
      .update(stores)
      .set({ failCount: store.failCount + 1 })
      .where(eq(stores.id, store.id))
      .run();
    if (failStreak === 3) {
      await notify(ctx, {
        productId: product.id,
        kind: store.requiresLogin && !store.sessionEncrypted ? 'login' : 'warning',
        title: store.requiresLogin
          ? translator(ctx).t('store.relogin.title', { store: store.name })
          : translator(ctx).t('store.attention.title', { store: store.name }),
        body: store.requiresLogin
          ? translator(ctx).t('store.relogin.body')
          : translator(ctx).t('store.attention.body', {
              product: product.name,
              error: error ?? 'no_price',
            }),
        data: { storeId: store.id },
      });
    }
    return {
      listingId: listing.id,
      productId: listing.productId,
      status: 'failed',
      error: error ?? 'no_price',
    };
  }

  const { offer: ruled, rejected } = applyStoreRules(offer, store);
  if (rejected) {
    ctx.db
      .update(listings)
      .set({ lastCheckedAt: now, lastError: rejected, nextCheckAt: new Date(now.getTime() + DAY) })
      .where(eq(listings.id, listing.id))
      .run();
    return {
      listingId: listing.id,
      productId: listing.productId,
      status: 'skipped',
      error: rejected,
    };
  }

  const status = recordObservation(ctx, listing, ruled);
  ctx.db
    .update(listings)
    .set({
      lastCheckedAt: now,
      failStreak: 0,
      lastError: null,
      title: listing.title ?? ruled.name,
      nextCheckAt: new Date(
        now.getTime() +
          nextCheckDelay({
            now,
            hasDealLabel: Boolean(ruled.dealLabel),
            recentChanges,
            failStreak: 0,
          }),
      ),
    })
    .where(eq(listings.id, listing.id))
    .run();
  ctx.db
    .update(stores)
    .set({ lastSuccessAt: now, failCount: 0 })
    .where(eq(stores.id, store.id))
    .run();

  if (status === 'changed') {
    const later = ctx.now();
    const after = loadSeries(ctx, product);
    const verdictAfter = productVerdict(after.map(asVerdictSeries), later);
    const mineAfter = after.find((s) => s.listing.id === listing.id)!;
    const findings = runChecks({
      storeName: store.name,
      points: mineAfter.unitPoints,
      others: after
        .filter((s) => s !== mineAfter)
        .map((s) => ({ storeName: s.store.name, points: s.unitPoints })),
      now: later,
    });
    await evaluateAlerts(ctx, {
      productId: product.id,
      storeName: store.name,
      previousLowest: verdictBefore.currentLowest,
      newLowest: verdictAfter.currentLowest,
      allTimeLowBefore: verdictBefore.allTimeLow,
      backInStock: wasOutOfStock && ruled.availability !== 'out_of_stock',
      findings,
      previousFindings: findingsBefore,
    });
  }
  return {
    listingId: listing.id,
    productId: listing.productId,
    status,
    priceCents: ruled.priceCents,
  };
}

/** Runs all listings that are due. Domains are serialised by the fetcher, so this stays polite. */
export async function runDueChecks(ctx: Ctx, limit = 25): Promise<CheckOutcome[]> {
  const now = ctx.now();
  const due = ctx.db
    .select({ listing: listings })
    .from(listings)
    .innerJoin(products, eq(listings.productId, products.id))
    .where(
      and(
        eq(listings.active, true),
        isNull(products.archivedAt),
        or(isNull(listings.nextCheckAt), lte(listings.nextCheckAt, now)),
      ),
    )
    .orderBy(asc(listings.nextCheckAt))
    .limit(limit)
    .all()
    .map((r) => r.listing);
  return Promise.all(
    due.map((l) =>
      checkListing(ctx, l).catch((e: unknown) => ({
        listingId: l.id,
        productId: l.productId,
        status: 'failed' as const,
        error: String(e),
      })),
    ),
  );
}

export { toPricePoint };
