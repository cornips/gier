import { and, eq } from 'drizzle-orm';
import {
  defaultExclusions,
  detectShopFacts,
  domainOf,
  matchCandidate,
  median,
  normalize,
  scoreTrust,
  unitPrice,
  type Fingerprint,
} from '@gier/core';
import {
  discoveryRuns,
  exclusionRules,
  listings,
  products,
  stores,
  type DiscoveryCandidate,
  type Store,
} from '@gier/db';
import type { Ctx } from '../context';
import { AiUnavailable, judgeDoubtfulMatches } from './ai';
import { fetchOffer, recordObservation } from './checker';
import { notify } from './notify';
import { domainAgeDays } from './rdap';
import { webSearch } from './search';
import { ensureStore } from './stores';
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

export function startDiscovery(ctx: Ctx, input: RunInput): number {
  const [run] = ctx.db
    .insert(discoveryRuns)
    .values({ productId: input.productId, query: input.query, stage: 'search' })
    .returning()
    .all();
  void runDiscovery(ctx, run!.id, input).catch((e: unknown) => {
    updateRun(ctx, run!.id, {
      status: 'failed',
      error: e instanceof Error ? e.message : String(e),
      finishedAt: ctx.now(),
    });
  });
  return run!.id;
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
  const fp: Fingerprint = {
    ...input.fingerprint,
    exclude: [...new Set([...input.fingerprint.exclude, ...learned])],
  };
  const allStores = ctx.db.select().from(stores).all();
  const blocked = new Set(allStores.filter((s) => s.trust === 'blocked').map((s) => s.domain));

  // 1. Search: known stores first (site: queries for fixed stores in a fitting category), then the open web.
  const queries = queriesFor(fp, input.query);
  const fixedInScope = allStores.filter(
    (s) =>
      s.isFixed &&
      s.domain &&
      (!s.rules?.brands ||
        s.rules.brands.some((b) => fp.brand && normalize(b) === normalize(fp.brand))),
  );
  const urls = new Map<string, string>();
  let searches = 0;
  const perDomain = new Map<string, number>();
  const addHits = (hits: { url: string }[]) => {
    for (const h of hits) {
      const d = domainOf(h.url);
      if (!d || NOT_SHOPS.includes(d) || blocked.has(d) || urls.has(h.url)) continue;
      if ((perDomain.get(d) ?? 0) >= 2) continue;
      perDomain.set(d, (perDomain.get(d) ?? 0) + 1);
      urls.set(h.url, d);
    }
  };
  const first = await webSearch(ctx, queries[0]!);
  searches += 1;
  addHits(first.hits);
  const foundDomains = new Set(urls.values());
  const missingFixed = fixedInScope.filter((s) => !foundDomains.has(s.domain!)).slice(0, 6);
  if (missingFixed.length) {
    const siteQuery = `${queries[0]} ${missingFixed.map((s) => `site:${s.domain}`).join(' OR ')}`;
    addHits((await webSearch(ctx, siteQuery)).hits);
    searches += 1;
  }
  for (const q of queries.slice(1)) {
    if (urls.size >= MAX_PAGES) break;
    addHits((await webSearch(ctx, q)).hits);
    searches += 1;
  }
  updateRun(ctx, runId, { stage: 'extract', stats: { searches, results: urls.size } });

  // 2. Read pages.
  const pages = [...urls.keys()].slice(0, MAX_PAGES);
  const read = await Promise.all(
    pages.map(async (url) => {
      const store = allStores.find((s) => s.domain === domainOf(url)) ?? null;
      const { offer, html } = await fetchOffer(ctx, url, store);
      return { url, store, offer, text: html ? stripTags(html).slice(-20_000) : '' };
    }),
  );
  const priced = read.filter((r) => r.offer?.priceCents);
  updateRun(ctx, runId, {
    stage: 'match',
    stats: { searches, results: urls.size, read: pages.length, priced: priced.length },
  });

  // 3. Match against the fingerprint; AI only for doubtful cases and only within budget.
  const matched = priced.map((r) => ({
    ...r,
    match: matchCandidate(fp, {
      title: r.offer!.name ?? '',
      brand: r.offer!.brand,
      gtin: r.offer!.gtin,
      mpn: r.offer!.mpn,
      sellerName: r.offer!.sellerName,
    }),
  }));
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
  updateRun(ctx, runId, { stage: 'trust' });

  // 4. Trust.
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
    _offer: (typeof matched)[number]['offer'];
  })[] = [];
  for (const m of matched) {
    const domain = domainOf(m.url);
    const known = m.store;
    const thirdParty = Boolean(
      known?.rules?.soldByOnly &&
      m.offer!.sellerName &&
      !m.offer!.sellerName.toLowerCase().includes(known.rules.soldByOnly.toLowerCase()),
    );
    let age = known?.domainAgeDays ?? null;
    if (!known?.isFixed && age === null && domain) age = await domainAgeDays(ctx, domain);
    // Page footers usually carry KvK and return-policy links; only positive signals count (ADR-008).
    const facts = m.text ? detectShopFacts(m.text) : null;
    const trust = scoreTrust({
      fixedStore: Boolean(known?.isFixed),
      previouslyTrusted: known?.trust === 'trusted',
      blocklisted: known?.trust === 'blocked',
      domainAgeDays: age,
      hasKvk: facts ? facts.hasKvk || null : null,
      hasReturnPolicy: facts ? facts.hasReturnPolicy || null : null,
      hasTrustmark: facts?.hasTrustmark ?? null,
      priceVsMedian: med ? unit(m) / med : null,
      thirdPartySeller: thirdParty,
    });
    candidates.push({
      url: m.url,
      storeName: known?.name ?? domain ?? m.url,
      domain,
      title: m.offer!.name,
      priceCents: m.offer!.priceCents,
      unitPriceCents: unit(m),
      shippingCents: m.offer!.shippingCents,
      packCount: m.match.quantity.packCount,
      match: m.match.verdict,
      matchReasons: m.match.reasons,
      trust: trust.verdict,
      trustReasons: trust.reasons,
      followed: false,
      imageUrl: m.offer!.image ? new URL(m.offer!.image, m.url).toString() : null,
      _store: known,
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
      searches,
      results: urls.size,
      read: pages.length,
      priced: priced.length,
      matched: out.filter((c) => c.match === 'match').length,
      doubt: out.filter((c) => c.match === 'doubt').length,
      followed: out.filter((c) => c.followed).length,
    },
  });
  return out;
}
