import { and, desc, eq } from 'drizzle-orm';
import {
  bestPromotion,
  defaultExclusions,
  detectShopFacts,
  domainOf,
  matchCandidate,
  median,
  normalize,
  scoreTrust,
  storeCategoriesFor,
  unitPrice,
  type ExtractedOffer,
  type Fingerprint,
} from '@gier/core';
import {
  discoveryRuns,
  exclusionRules,
  listings,
  products,
  stores,
  type DiscoveryCandidate,
  type DiscoveryStats,
  type Store,
  type UnreadPage,
} from '@gier/db';
import type { Ctx } from '../context';
import { AiUnavailable, judgeDoubtfulMatches } from './ai';
import { fetchOffer, recordObservation } from './checker';
import { notify } from './notify';
import { domainAgeDays } from './rdap';
import { webSearch } from './search';
import { ensureStore } from './stores';
import { storeSearch } from './store-search';
import { translator } from '../i18n';

/** Sites that are never shops (reviews, social, news, encyclopedias, comparison sites). */
const NOT_SHOPS = [
  'youtube.com',
  'reddit.com',
  'wikipedia.org',
  'facebook.com',
  'instagram.com',
  'pinterest.com',
  'tiktok.com',
  'x.com',
  'twitter.com',
  'linkedin.com',
  'tweakers.net',
  'kieskeurig.nl',
  'beslist.nl',
  'consumentenbond.nl',
  'google.com',
  'google.nl',
  'marktplaats.nl',
  'tweedehands.nl',
  'vinted.nl',
  'ebay.com',
  'ebay.nl',
  'nu.nl',
];

export const MAX_FOLLOW = 20;

const stripTags = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
const MAX_PAGES = 30;
/** Known stores asked through their own search, and through site: queries in batches. */
const MAX_STORE_SEARCHES = 6;
const SITE_BATCH = 5;
const MAX_SITE_QUERIES = 3;
/** Browser renders per run, only for known stores (Browser Run time is scarce on the Free plan). */
const MAX_RENDERS = 4;
/** A price per item this far above the median, without a detected pack size, is probably a multipack. */
const MULTIPACK_RATIO = 2.2;
const MULTIPACK_HINT =
  /\b\d+\s*[x×]|\b(?:stuks|pack|set|voordeel\w*|groot\w*|multi\w*|duo|trio)\b/i;

export function queriesFor(fp: Fingerprint, userQuery: string): string[] {
  const base = [
    fp.brand,
    fp.line,
    fp.form,
    fp.quantity && fp.quantity.unit !== 'piece'
      ? `${fp.quantity.amount} ${fp.quantity.unit}`
      : null,
  ]
    .filter(Boolean)
    .join(' ');
  const name = base.trim() || fp.title || userQuery;
  const qs = [name, `${name} kopen`];
  if (fp.gtin) qs.unshift(fp.gtin);
  else if (fp.model) qs.unshift(`${fp.brand ?? ''} ${fp.model}`.trim());
  return [...new Set(qs.map((q) => q.replace(/\s+/g, ' ').trim()))].slice(0, 3);
}

interface RunInput {
  productId: number | null;
  query: string;
  fingerprint: Fingerprint;
  /** Product category (AI label), so only fitting known stores are searched. */
  category?: string | null;
  /** Follow trusted matches automatically (ADR-008). Only when a product exists. */
  follow: boolean;
  useAi: boolean;
}

/** When the web app last polled a run. A run that finishes unwatched sends a notification. */
const lastSeen = new Map<number, number>();
export const markRunSeen = (id: number) => lastSeen.set(id, Date.now());
const watched = (id: number) => Date.now() - (lastSeen.get(id) ?? 0) < 20_000;

function updateRun(ctx: Ctx, id: number, patch: Partial<typeof discoveryRuns.$inferInsert>) {
  ctx.db.update(discoveryRuns).set(patch).where(eq(discoveryRuns.id, id)).run();
}

/** Runs left 'running' by a restart can never finish; mark them failed so they don't block new runs. */
export function failInterruptedRuns(ctx: Ctx) {
  ctx.db
    .update(discoveryRuns)
    .set({ status: 'failed', error: 'interrupted', finishedAt: ctx.now() })
    .where(eq(discoveryRuns.status, 'running'))
    .run();
}

const BACKOFF_HOURS = [1, 6, 24];

/**
 * Whether the scheduler may start a discovery for this product now: never while one is running, and
 * after failed runs only after a growing pause (1 h, 6 h, then daily), so a broken search does not
 * hammer shops every minute.
 */
export function discoveryDue(ctx: Ctx, productId: number): boolean {
  const recent = ctx.db
    .select()
    .from(discoveryRuns)
    .where(eq(discoveryRuns.productId, productId))
    .orderBy(desc(discoveryRuns.id))
    .limit(5)
    .all();
  if (recent[0]?.status === 'running') return false;
  let failures = 0;
  for (const r of recent) {
    if (r.status !== 'failed') break;
    failures += 1;
  }
  if (!failures) return true;
  const last = recent[0]!.finishedAt ?? recent[0]!.startedAt;
  const pause = BACKOFF_HOURS[Math.min(failures, BACKOFF_HOURS.length) - 1]! * 3600_000;
  return ctx.now().getTime() - last.getTime() >= pause;
}

export function startDiscovery(ctx: Ctx, input: RunInput): number {
  if (input.productId) {
    const running = ctx.db
      .select()
      .from(discoveryRuns)
      .where(and(eq(discoveryRuns.productId, input.productId), eq(discoveryRuns.status, 'running')))
      .get();
    if (running) return running.id;
  }
  const [run] = ctx.db
    .insert(discoveryRuns)
    .values({ productId: input.productId, query: input.query, stage: 'search' })
    .returning()
    .all();
  void runDiscovery(ctx, run!.id, input).catch((e: unknown) => {
    console.warn(`Discovery ${run!.id} failed`, e);
    updateRun(ctx, run!.id, {
      status: 'failed',
      error: e instanceof Error ? e.message : String(e),
      finishedAt: ctx.now(),
    });
  });
  return run!.id;
}

/** Known stores worth searching for this product: fitting category and brand, not blocked. */
export function storesInScope(all: Store[], fp: Fingerprint, category: string | null): Store[] {
  const wanted = storeCategoriesFor(category);
  return all.filter(
    (s) =>
      s.isFixed &&
      s.domain &&
      s.trust !== 'blocked' &&
      (!wanted || s.category === 'unknown' || wanted.includes(s.category)) &&
      (!s.rules?.brands ||
        s.rules.brands.some((b) => fp.brand && normalize(b) === normalize(fp.brand))),
  );
}

interface Read {
  url: string;
  store: Store | null;
  offer: ExtractedOffer | null;
  text: string;
  error?: string;
}

/** The speurtocht (ADR-005/007/008): search → read pages → match → trust → follow. */
export async function runDiscovery(
  ctx: Ctx,
  runId: number,
  input: RunInput,
): Promise<DiscoveryCandidate[]> {
  const product = input.productId
    ? ctx.db.select().from(products).where(eq(products.id, input.productId)).get()
    : null;
  const learned = defaultExclusions(
    ctx.db
      .select()
      .from(exclusionRules)
      .all()
      .map((r) => ({ term: r.term, category: r.category, count: r.count })),
    product?.category ?? null,
  ).map((r) => r.term);
  let fp: Fingerprint = {
    ...input.fingerprint,
    exclude: [...new Set([...input.fingerprint.exclude, ...learned])],
  };
  const allStores = ctx.db.select().from(stores).all();
  const byDomain = (d: string | null) => allStores.find((s) => s.domain === d) ?? null;
  const blocked = new Set(allStores.filter((s) => s.trust === 'blocked').map((s) => s.domain));
  const stats: DiscoveryStats = { searches: 0, storeSearches: 0, results: 0 };
  const unread: UnreadPage[] = [];

  // 1. Search. Known stores in a fitting category come first: through their own search where Gier
  // knows it, otherwise through site: queries; then the open web.
  const queries = queriesFor(fp, input.query);
  const scope = storesInScope(allStores, fp, product?.category ?? input.category ?? null);
  const urls = new Map<string, string>();
  const perDomain = new Map<string, number>();
  const addHits = (hits: { url: string }[], max = 2) => {
    for (const h of hits) {
      const d = domainOf(h.url);
      if (!d || NOT_SHOPS.includes(d) || blocked.has(d) || urls.has(h.url)) continue;
      if ((perDomain.get(d) ?? 0) >= max) continue;
      perDomain.set(d, (perDomain.get(d) ?? 0) + 1);
      urls.set(h.url, d);
    }
  };
  const searchQuery = queries.find((q) => !/^\d+$/.test(q)) ?? queries[0]!;
  const searchable = scope.filter((s) => s.rules?.search).slice(0, MAX_STORE_SEARCHES);
  const storeHits = await Promise.all(
    searchable.map(async (s) => {
      const terms = fp.gtin ? [fp.gtin, searchQuery] : [searchQuery];
      for (const q of terms) {
        const r = await storeSearch(ctx, s, q).catch(() => ({ urls: [], error: 'failed' }));
        stats.storeSearches! += 1;
        if (r.urls.length) return r.urls;
        if (r.error) unread.push({ url: s.rules!.search!.url, domain: s.domain, reason: r.error });
      }
      return [];
    }),
  );
  for (const hits of storeHits)
    addHits(
      hits.map((url) => ({ url })),
      3,
    );

  const first = await webSearch(ctx, queries[0]!);
  stats.searches! += 1;
  addHits(first.hits);
  const found = new Set(urls.values());
  const missing = scope.filter((s) => !s.rules?.search && !found.has(s.domain!));
  for (let i = 0; i < missing.length && i / SITE_BATCH < MAX_SITE_QUERIES; i += SITE_BATCH) {
    const batch = missing.slice(i, i + SITE_BATCH);
    const q = `${searchQuery} ${batch.map((s) => `site:${s.domain}`).join(' OR ')}`;
    addHits((await webSearch(ctx, q)).hits);
    stats.searches! += 1;
  }
  for (const q of queries.slice(1)) {
    if (urls.size >= MAX_PAGES) break;
    addHits((await webSearch(ctx, q)).hits);
    stats.searches! += 1;
  }
  stats.results = urls.size;
  updateRun(ctx, runId, { stage: 'extract', stats });

  // 2. Read pages, known stores first. Browser renders only for known stores, a few per run.
  let renders = MAX_RENDERS;
  const readAll = async (list: string[]): Promise<Read[]> =>
    Promise.all(
      list.map(async (url) => {
        const store = byDomain(domainOf(url));
        const mayRender = () => Boolean(store?.isFixed) && renders-- > 0;
        const { offer, html, error } = await fetchOffer(ctx, url, store, { mayRender }).catch(
          (e: unknown) => ({
            offer: null,
            html: undefined,
            error: e instanceof Error ? e.message : 'failed',
          }),
        );
        if (error && (store || error !== 'no_price'))
          unread.push({ url, domain: domainOf(url), reason: error });
        return { url, store, offer, text: html ? stripTags(html).slice(-20_000) : '', error };
      }),
    );
  const known = (u: string) => Boolean(byDomain(domainOf(u))?.isFixed);
  const pages = [...urls.keys()]
    .sort((a, b) => Number(known(b)) - Number(known(a)))
    .slice(0, MAX_PAGES);
  let read = await readAll(pages);
  stats.read = pages.length;

  // 3. Match against the fingerprint.
  const matchAll = (rs: Read[]) =>
    rs
      .filter((r) => r.offer?.priceCents)
      .map((r) => ({
        ...r,
        match: matchCandidate(fp, {
          title: r.offer!.name ?? '',
          altTitles: r.offer!.titles,
          size: r.offer!.size,
          brand: r.offer!.brand,
          gtin: r.offer!.gtin,
          mpn: r.offer!.mpn,
          sellerName: r.offer!.sellerName,
        }),
      }));
  let matched = matchAll(read);

  // 3b. Learn the EAN: when matches agree on one, it finds the exact product in more shops.
  if (!fp.gtin) {
    const gtin = agreedGtin(matched);
    if (gtin) {
      fp = { ...fp, gtin };
      if (product)
        ctx.db
          .update(products)
          .set({ gtin: product.gtin ?? gtin, fingerprint: { ...product.fingerprint, gtin } })
          .where(eq(products.id, product.id))
          .run();
      const extra = new Map<string, string>();
      const before = new Set(urls.keys());
      addHits((await webSearch(ctx, gtin)).hits);
      stats.searches! += 1;
      for (const [u, d] of urls) if (!before.has(u)) extra.set(u, d);
      const more = await readAll([...extra.keys()].slice(0, 10));
      stats.read += more.length;
      read = [...read, ...more];
      matched = matchAll(read);
    }
  }
  stats.priced = matched.length;
  updateRun(ctx, runId, { stage: 'match', stats });

  // AI only for doubtful cases and only within budget.
  const doubts = matched.filter((m) => m.match.verdict === 'doubt');
  if (input.useAi && doubts.length) {
    try {
      const judged = await judgeDoubtfulMatches(
        ctx,
        input.productId,
        fp,
        doubts.map((d) => d.offer!.name ?? ''),
      );
      doubts.forEach((d, i) => {
        d.match = {
          ...d.match,
          verdict: judged[i]!.same ? 'match' : 'reject',
          reasons: [...d.match.reasons, `ai:${judged[i]!.reason}`],
        };
      });
    } catch (e) {
      // Without a verdict the doubtful offers stay doubtful; the user decides in the wizard.
      if (!(e instanceof AiUnavailable)) console.warn('AI matching failed', e);
    }
  }
  updateRun(ctx, runId, { stage: 'trust', stats });

  // 4. Trust. The outlier check uses the regular price per item; ranking uses the price with the best
  // promotion the user can actually use.
  const unit = (r: (typeof matched)[number]) =>
    unitPrice(
      r.offer!.priceCents! + (r.offer!.shippingCents ?? 0),
      {
        ...r.match.quantity,
        amount: fp.quantity?.amount ?? r.match.quantity.amount,
        unit: fp.quantity?.unit ?? r.match.quantity.unit,
      },
      fp.compareUnit,
    );
  const med = median(matched.filter((m) => m.match.verdict === 'match').map(unit));
  const candidates: (DiscoveryCandidate & {
    _store: Store | null;
    _offer: ExtractedOffer | null;
  })[] = [];
  for (const m of matched) {
    const domain = domainOf(m.url);
    const store = m.store;
    const thirdParty = Boolean(
      store?.rules?.soldByOnly &&
      m.offer!.sellerName &&
      !m.offer!.sellerName.toLowerCase().includes(store.rules.soldByOnly.toLowerCase()),
    );
    let age = store?.domainAgeDays ?? null;
    if (!store?.isFixed && age === null && domain) age = await domainAgeDays(ctx, domain);
    // Page footers usually carry KvK and return-policy links; only positive signals count (ADR-008).
    const facts = m.text ? detectShopFacts(m.text) : null;
    const regular = unit(m);
    const ratio = med ? regular / med : null;
    const trust = scoreTrust({
      fixedStore: Boolean(store?.isFixed),
      previouslyTrusted: store?.trust === 'trusted',
      blocklisted: store?.trust === 'blocked',
      domainAgeDays: age,
      hasKvk: facts ? facts.hasKvk || null : null,
      hasReturnPolicy: facts ? facts.hasReturnPolicy || null : null,
      hasTrustmark: facts?.hasTrustmark ?? null,
      priceVsMedian: ratio,
      thirdPartySeller: thirdParty,
    });
    let verdict = m.match.verdict;
    const reasons = [...m.match.reasons];
    const hinted = [m.offer!.name, ...(m.offer!.titles ?? []), m.url].some(
      (t) => t && MULTIPACK_HINT.test(t.replace(/[-_/]/g, ' ')),
    );
    if (
      verdict === 'match' &&
      m.match.quantity.packCount === 1 &&
      hinted &&
      ratio &&
      ratio > MULTIPACK_RATIO
    ) {
      // Often a multipack whose count Gier could not read; let the user decide instead of following.
      verdict = 'doubt';
      reasons.push('possible_multipack');
    }
    const hasCard = Boolean(store?.rules?.loyaltyCard);
    const promo = bestPromotion(m.offer!.promotions, regular, hasCard);
    const card = hasCard ? null : bestPromotion(m.offer!.promotions, regular, true);
    const cardBetter =
      card && card.promotion.requires === 'card' && card.unitCents < (promo?.unitCents ?? regular);
    candidates.push({
      url: m.url,
      storeName: store?.name ?? domain ?? m.url,
      domain,
      title: m.offer!.name,
      priceCents: m.offer!.priceCents,
      unitPriceCents: promo?.unitCents ?? regular,
      shippingCents: m.offer!.shippingCents,
      packCount: m.match.quantity.packCount,
      match: verdict,
      matchReasons: reasons,
      trust: trust.verdict,
      trustReasons: trust.reasons,
      followed: false,
      imageUrl: m.offer!.image ? new URL(m.offer!.image, m.url).toString() : null,
      promotion: promo?.promotion ?? null,
      promoUnitCents: promo ? promo.unitCents : null,
      cardPromotion: cardBetter ? card.promotion : null,
      cardUnitCents: cardBetter ? card.unitCents : null,
      gtin: m.offer!.gtin,
      _store: store,
      _offer: m.offer,
    });
  }

  // Best offer per domain, cheapest first.
  const best = new Map<string, (typeof candidates)[number]>();
  for (const c of candidates.sort(
    (a, b) => (a.unitPriceCents ?? Infinity) - (b.unitPriceCents ?? Infinity),
  )) {
    if (c.match === 'match' && !best.has(c.domain ?? c.url)) best.set(c.domain ?? c.url, c);
  }

  // 5. Follow trusted matches automatically, fixed stores first, max 20.
  let newStores = 0;
  if (input.follow && product) {
    const toFollow = [...best.values()]
      .filter((c) => c.trust === 'trusted')
      .sort((a, b) => Number(Boolean(b._store?.isFixed)) - Number(Boolean(a._store?.isFixed)))
      .slice(0, MAX_FOLLOW);
    for (const c of toFollow) {
      const store = c._store ?? ensureStore(ctx, c.url, 'trusted');
      if (!c._store) newStores += 1;
      const exists = ctx.db
        .select()
        .from(listings)
        .where(and(eq(listings.productId, product.id), eq(listings.url, c.url)))
        .get();
      if (exists) continue;
      const [listing] = ctx.db
        .insert(listings)
        .values({
          productId: product.id,
          storeId: store.id,
          url: c.url,
          title: c.title,
          packCount: c.packCount,
          followedAutomatically: true,
          lastCheckedAt: ctx.now(),
          nextCheckAt: new Date(ctx.now().getTime() + 6 * 3600_000),
        })
        .returning()
        .all();
      recordObservation(ctx, listing!, c._offer!);
      c.followed = true;
    }
    const image = toFollow.find((c) => c.imageUrl)?.imageUrl;
    ctx.db
      .update(products)
      .set({
        lastDiscoveryAt: ctx.now(),
        ...(image && !product.imageUrl ? { imageUrl: image } : {}),
      })
      .where(eq(products.id, product.id))
      .run();
    if (!product.lastDiscoveryAt && !watched(runId)) {
      // The first search for a product takes a while; tell the user when it is done.
      const { t } = translator(ctx);
      await notify(ctx, {
        productId: product.id,
        kind: 'store',
        title: t('discovery.done.title', { product: product.name }),
        body: t('discovery.done.body', { count: toFollow.length }),
      });
    } else if (newStores && product.lastDiscoveryAt) {
      await notify(ctx, {
        productId: product.id,
        kind: 'store',
        title: translator(ctx).t('discovery.new.title', { product: product.name }),
        body: translator(ctx).t('discovery.new.body', { count: newStores }),
      });
    }
  }

  const out: DiscoveryCandidate[] = candidates.map(({ _store: _s, _offer: _o, ...c }) => c);
  updateRun(ctx, runId, {
    status: 'done',
    stage: 'done',
    finishedAt: ctx.now(),
    candidates: out,
    stats: {
      ...stats,
      matched: out.filter((c) => c.match === 'match').length,
      doubt: out.filter((c) => c.match === 'doubt').length,
      followed: out.filter((c) => c.followed).length,
      unread: unread.slice(0, 20),
    },
  });
  return out;
}

/**
 * The EAN that matched offers agree on: one from a known store counts, otherwise two pages must name
 * the same code. Valid EAN/GTIN lengths only.
 */
function agreedGtin(
  matched: { store: Store | null; offer: ExtractedOffer | null; match: { verdict: string } }[],
): string | null {
  const counts = new Map<string, number>();
  for (const m of matched) {
    const g = m.offer?.gtin?.replace(/\D/g, '');
    if (m.match.verdict !== 'match' || !g || ![8, 12, 13, 14].includes(g.length)) continue;
    counts.set(g, (counts.get(g) ?? 0) + (m.store?.isFixed ? 2 : 1));
  }
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return top && top[1] >= 2 ? top[0] : null;
}
