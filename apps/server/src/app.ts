import { Hono, type Context } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { and, desc, eq, gte, isNull, like, sql } from 'drizzle-orm';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  ALWAYS_EXCLUDE,
  defaultExclusions,
  domainOf,
  fingerprintFromTitle,
  GLOBAL_CAP_EUR,
  recordExclusion,
  TIER_CAP_EUR,
  AUTO_ADVICE_MAX_EUR,
  type Fingerprint,
} from '@gier/core';
import {
  aiCalls,
  alerts,
  discoveryRuns,
  exclusionRules,
  listings,
  notifications,
  pricePoints,
  products,
  pushSubscriptions,
  searchUsage,
  stores,
} from '@gier/db';
import type { Ctx } from './context';
import { generateAdvice } from './services/advice';
import { AiUnavailable, proposeFingerprint, spentThisMonthEur } from './services/ai';
import { proxyImage, referenceImage } from './services/images';
import { createDefaultAlerts } from './services/alerts';
import {
  browserRunAvailable,
  BrowserRunError,
  cancelHandoff,
  getHandoff,
  startLoginHandoff,
  typeIntoHandoff,
} from './services/browser-run';
import { checkListing, fetchOffer, recordObservation } from './services/checker';
import { markRunSeen, startDiscovery } from './services/discovery';
import { notify } from './services/notify';
import {
  allowFeedback,
  FEEDBACK_KINDS,
  feedbackAvailable,
  pseudonym,
  sendFeedback,
} from './services/feedback';
import { APP_VERSION } from './version';
import { listProducts, productDetail } from './services/products';
import { braveSpentThisMonth, webSearch } from './services/search';
import { ensureStore } from './services/stores';
import { isLanguage, language, setLanguage, translator } from './i18n';

const fingerprintSchema = z.object({
  title: z.string().min(1),
  brand: z.string().nullish(),
  line: z.string().nullish(),
  form: z.string().nullish(),
  quantity: z
    .object({
      packCount: z.number().int().min(1),
      amount: z.number().positive(),
      unit: z.enum(['ml', 'g', 'piece']),
    })
    .nullish(),
  gtin: z.string().nullish(),
  model: z.string().nullish(),
  locked: z.array(z.enum(['brand', 'line', 'form', 'quantity', 'model'])).default([]),
  allowMultipack: z.boolean().default(true),
  compareUnit: z.enum(['piece', 'per100']).default('piece'),
  exclude: z.array(z.string()).default([]),
});

const createProductSchema = z.object({
  name: z.string().min(1),
  query: z.string().default(''),
  category: z.string().nullish(),
  fingerprint: fingerprintSchema,
  aiBudgetTier: z.enum(['none', 'frugal', 'normal', 'generous']).default('frugal'),
  adviceMode: z.enum(['auto', 'on_request', 'off']).default('auto'),
  targetPriceCents: z.number().int().positive().nullish(),
  alerts: z
    .array(
      z.enum([
        'below',
        'any_change',
        'all_time_low',
        'new_store',
        'fake_discount',
        'back_in_stock',
      ]),
    )
    .optional(),
  discover: z.boolean().default(true),
});

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const idParam = (v: string) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function createApp(ctx: Ctx) {
  const base = ctx.env.GIER_BASE_PATH;
  const app = new Hono();
  const api = new Hono();

  api.onError((err, c) => {
    if (err instanceof z.ZodError)
      return c.json({ error: 'invalid_input', issues: err.issues }, 400);
    console.error(err);
    return c.json({ error: 'internal_error', message: err.message }, 500);
  });

  /**
   * Re-login entry point. The app sends the browser here when its session ended. With a proxy such as
   * Cloudflare Access in front, this top-level navigation goes through its login first; once the
   * request arrives here the user is signed in again and goes back to where they were.
   */
  api.get('/login', (c) => {
    const home = `${base}/`;
    const next = c.req.query('next') ?? home;
    const safe =
      next.startsWith(home) && !next.startsWith('//') && !next.includes('\\') ? next : home;
    c.header('cache-control', 'no-store');
    return c.redirect(safe, 302);
  });

  /** In-app feedback (alpha): one row in the configured Notion database. */
  api.post('/feedback', async (c) => {
    if (!feedbackAvailable(ctx)) return c.json({ error: 'feedback_unavailable' }, 503);
    const body = z
      .object({
        kind: z.enum(FEEDBACK_KINDS),
        message: z.string().trim().min(3).max(2000),
        lang: z.enum(['en', 'nl']).default('en'),
        context: z.record(z.string().max(60), z.string().max(300)).default({}),
      })
      .parse(await c.req.json());
    // Cloudflare Access tells who is signed in; only a keyed hash of it leaves this server.
    const user = c.req.header('cf-access-authenticated-user-email') ?? null;
    if (!allowFeedback(pseudonym(ctx, user))) return c.json({ error: 'too_many_requests' }, 429);
    try {
      await sendFeedback(ctx, { ...body, user });
      return c.json({ ok: true });
    } catch (e) {
      console.warn('Feedback to Notion failed', e);
      return c.json({ error: 'feedback_failed' }, 502);
    }
  });

  api.get('/health', (c) =>
    c.json({
      ok: true,
      version: APP_VERSION,
      commit: ctx.env.GIER_COMMIT?.slice(0, 7) ?? null,
      features: {
        feedback: feedbackAvailable(ctx),
        searxng: Boolean(ctx.env.SEARXNG_URL),
        brave: Boolean(ctx.env.BRAVE_API_KEY),
        ai: Boolean(ctx.env.ANTHROPIC_API_KEY),
        browserRun: browserRunAvailable(ctx),
        push: Boolean(ctx.env.VAPID_PUBLIC_KEY),
        telegram: Boolean(ctx.env.TELEGRAM_BOT_TOKEN),
        ntfy: Boolean(ctx.env.NTFY_URL),
        homeAssistant: Boolean(ctx.env.HOME_ASSISTANT_WEBHOOK_URL),
      },
    }),
  );

  // Products
  api.get('/products', (c) => c.json(listProducts(ctx)));

  api.get('/products/:id', (c) => {
    const id = idParam(c.req.param('id'));
    const detail = id ? productDetail(ctx, id) : null;
    return detail ? c.json(detail) : c.json({ error: 'not_found' }, 404);
  });

  api.post('/products', async (c) => {
    const body = createProductSchema.parse(await c.req.json());
    const [product] = ctx.db
      .insert(products)
      .values({
        name: body.name,
        brand: body.fingerprint.brand ?? null,
        category: body.category ?? null,
        gtin: body.fingerprint.gtin ?? null,
        fingerprint: body.fingerprint as Fingerprint,
        compareUnit: body.fingerprint.compareUnit,
        aiBudgetTier: body.aiBudgetTier,
        adviceMode: body.adviceMode,
        targetPriceCents: body.targetPriceCents ?? null,
      })
      .returning()
      .all();
    if (body.alerts) {
      const rows = body.alerts.map((kind) => ({
        productId: product!.id,
        kind,
        thresholdCents: kind === 'below' ? (body.targetPriceCents ?? null) : null,
      }));
      if (rows.length) ctx.db.insert(alerts).values(rows).run();
    } else {
      createDefaultAlerts(ctx, product!.id, body.targetPriceCents ?? null);
    }
    // Remember exclusions the user confirmed, so the next product in this category starts with them.
    for (const term of body.fingerprint.exclude) {
      const existing = ctx.db
        .select()
        .from(exclusionRules)
        .where(
          and(
            eq(exclusionRules.term, term),
            body.category
              ? eq(exclusionRules.category, body.category)
              : isNull(exclusionRules.category),
          ),
        )
        .get();
      if (!existing)
        ctx.db
          .insert(exclusionRules)
          .values({ term, category: body.category ?? null, count: 1, updatedAt: ctx.now() })
          .run();
    }
    const runId = body.discover
      ? startDiscovery(ctx, {
          productId: product!.id,
          query: body.query || body.name,
          fingerprint: body.fingerprint as Fingerprint,
          follow: true,
          useAi: body.aiBudgetTier !== 'none',
        })
      : null;
    return c.json({ product, runId }, 201);
  });

  api.post('/products/from-url', async (c) => {
    const { url } = z.object({ url: z.string().url() }).parse(await c.req.json());
    const store = ensureStore(ctx, url, 'doubt');
    const { offer, error } = await fetchOffer(ctx, url, store);
    if (!offer?.priceCents) return c.json({ error: error ?? 'no_price' }, 422);
    const fp = fingerprintFromTitle(offer.name ?? url, offer.brand, offer.gtin);
    const [product] = ctx.db
      .insert(products)
      .values({
        name: offer.name ?? url,
        brand: offer.brand,
        gtin: offer.gtin,
        imageUrl: offer.image,
        fingerprint: fp,
      })
      .returning()
      .all();
    const [listing] = ctx.db
      .insert(listings)
      .values({
        productId: product!.id,
        storeId: store.id,
        url,
        title: offer.name,
        lastCheckedAt: ctx.now(),
      })
      .returning()
      .all();
    recordObservation(ctx, listing!, offer);
    createDefaultAlerts(ctx, product!.id, null);
    return c.json({ product }, 201);
  });

  api.patch('/products/:id', async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'not_found' }, 404);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        notes: z.string().nullish(),
        targetPriceCents: z.number().int().positive().nullish(),
        aiBudgetTier: z.enum(['none', 'frugal', 'normal', 'generous']).optional(),
        adviceMode: z.enum(['auto', 'on_request', 'off']).optional(),
        compareUnit: z.enum(['piece', 'per100']).optional(),
        archived: z.boolean().optional(),
      })
      .parse(await c.req.json());
    const { archived, ...rest } = body;
    ctx.db
      .update(products)
      .set({
        ...rest,
        ...(archived === undefined ? {} : { archivedAt: archived ? ctx.now() : null }),
      })
      .where(eq(products.id, id))
      .run();
    return c.json(productDetail(ctx, id));
  });

  api.post('/products/:id/check', async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'not_found' }, 404);
    const rows = ctx.db
      .select()
      .from(listings)
      .where(and(eq(listings.productId, id), eq(listings.active, true)))
      .all();
    const outcomes = await Promise.all(rows.map((l) => checkListing(ctx, l)));
    return c.json({ outcomes });
  });

  api.post('/products/:id/advice', async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'not_found' }, 404);
    return c.json(await generateAdvice(ctx, id, true));
  });

  api.post('/products/:id/discover', (c) => {
    const id = idParam(c.req.param('id'));
    const product = id ? ctx.db.select().from(products).where(eq(products.id, id)).get() : null;
    if (!product) return c.json({ error: 'not_found' }, 404);
    const runId = startDiscovery(ctx, {
      productId: product.id,
      query: product.name,
      fingerprint: product.fingerprint,
      follow: true,
      useAi: product.aiBudgetTier !== 'none',
    });
    return c.json({ runId });
  });

  api.post('/products/:id/listings', async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'not_found' }, 404);
    const { url } = z.object({ url: z.string().url() }).parse(await c.req.json());
    const store = ensureStore(ctx, url, 'doubt');
    const [listing] = ctx.db
      .insert(listings)
      .values({ productId: id, storeId: store.id, url })
      .onConflictDoUpdate({ target: [listings.productId, listings.url], set: { active: true } })
      .returning()
      .all();
    const outcome = await checkListing(ctx, listing!);
    return c.json({ listing, outcome }, 201);
  });

  api.post('/products/:id/exclude', async (c) => {
    const id = idParam(c.req.param('id'));
    const product = id ? ctx.db.select().from(products).where(eq(products.id, id)).get() : null;
    if (!product) return c.json({ error: 'not_found' }, 404);
    const { term } = z.object({ term: z.string().min(2) }).parse(await c.req.json());
    const rules = ctx.db
      .select()
      .from(exclusionRules)
      .all()
      .map((r) => ({ term: r.term, category: r.category, count: r.count }));
    const updated =
      recordExclusion(rules, term, product.category).find(
        (r) => r.category === product.category && r.term === term.toLowerCase().trim(),
      ) ?? null;
    if (updated) {
      ctx.db
        .insert(exclusionRules)
        .values({
          term: updated.term,
          category: updated.category,
          count: updated.count,
          updatedAt: ctx.now(),
        })
        .onConflictDoUpdate({
          target: [exclusionRules.term, exclusionRules.category],
          set: { count: updated.count, updatedAt: ctx.now() },
        })
        .run();
    }
    const fp = {
      ...product.fingerprint,
      exclude: [...new Set([...product.fingerprint.exclude, term.toLowerCase().trim()])],
    };
    ctx.db.update(products).set({ fingerprint: fp }).where(eq(products.id, product.id)).run();
    return c.json({ fingerprint: fp, rule: updated });
  });

  api.get('/products/:id/export.csv', (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'not_found' }, 404);
    const rows = ctx.db
      .select({
        at: pricePoints.observedAt,
        store: stores.name,
        url: listings.url,
        price: pricePoints.priceCents,
        shipping: pricePoints.shippingCents,
        inStock: pricePoints.inStock,
        reference: pricePoints.referenceCents,
        referenceType: pricePoints.referenceType,
        deal: pricePoints.dealLabel,
      })
      .from(pricePoints)
      .innerJoin(listings, eq(pricePoints.listingId, listings.id))
      .innerJoin(stores, eq(listings.storeId, stores.id))
      .where(eq(listings.productId, id))
      .orderBy(pricePoints.observedAt)
      .all();
    const esc = (v: unknown) => (v == null ? '' : `"${String(v).replace(/"/g, '""')}"`);
    const csv = [
      'observed_at,store,url,price_eur,shipping_eur,in_stock,reference_eur,reference_type,deal_label',
    ]
      .concat(
        rows.map((r) =>
          [
            r.at.toISOString(),
            r.store,
            r.url,
            (r.price / 100).toFixed(2),
            r.shipping == null ? '' : (r.shipping / 100).toFixed(2),
            r.inStock,
            r.reference == null ? '' : (r.reference / 100).toFixed(2),
            r.referenceType,
            r.deal,
          ]
            .map(esc)
            .join(','),
        ),
      )
      .join('\n');
    return c.body(csv, 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="gier-product-${id}.csv"`,
    });
  });

  api.put('/products/:id/alerts', async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id || !ctx.db.select().from(products).where(eq(products.id, id)).get())
      return c.json({ error: 'not_found' }, 404);
    const rules = z
      .array(
        z.object({
          kind: z.enum([
            'below',
            'above',
            'any_change',
            'drop_percent',
            'all_time_low',
            'back_in_stock',
            'new_store',
            'fake_discount',
          ]),
          thresholdCents: z.number().int().positive().nullish(),
          percent: z.number().positive().max(100).nullish(),
          active: z.boolean().default(true),
        }),
      )
      .max(20)
      .parse(await c.req.json());
    ctx.db.transaction((tx) => {
      tx.delete(alerts).where(eq(alerts.productId, id)).run();
      if (rules.length)
        tx.insert(alerts)
          .values(
            rules.map((r) => ({
              productId: id,
              kind: r.kind,
              thresholdCents: r.thresholdCents ?? null,
              percent: r.percent ?? null,
              active: r.active,
            })),
          )
          .run();
    });
    return c.json(ctx.db.select().from(alerts).where(eq(alerts.productId, id)).all());
  });

  api.patch('/listings/:id', async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'not_found' }, 404);
    const { active } = z.object({ active: z.boolean() }).parse(await c.req.json());
    ctx.db.update(listings).set({ active }).where(eq(listings.id, id)).run();
    return c.json({ ok: true });
  });

  // Search & discovery
  api.get('/search', (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (q.length < 2) return c.json({ followed: [] });
    // Every word must appear somewhere in the name: "sony xm6" finds "Sony WH-1000XM6".
    const words = q.replace(/[%_]/g, '').split(/\s+/).filter(Boolean).slice(0, 6);
    const followed = ctx.db
      .select()
      .from(products)
      .where(and(isNull(products.archivedAt), ...words.map((w) => like(products.name, `%${w}%`))))
      .limit(8)
      .all();
    return c.json({ followed: followed.map((p) => ({ id: p.id, name: p.name })) });
  });

  api.post('/discovery/fingerprint', async (c) => {
    const { query } = z.object({ query: z.string().min(2) }).parse(await c.req.json());
    const search = await webSearch(ctx, query);
    const learned = defaultExclusions(
      ctx.db
        .select()
        .from(exclusionRules)
        .all()
        .map((r) => ({ term: r.term, category: r.category, count: r.count })),
      null,
    );
    try {
      const proposal = await proposeFingerprint(ctx, query, search.hits);
      const learnedForCategory = defaultExclusions(
        ctx.db
          .select()
          .from(exclusionRules)
          .all()
          .map((r) => ({ term: r.term, category: r.category, count: r.count })),
        proposal.category,
      );
      proposal.fingerprint.exclude = learnedForCategory.map((r) => r.term);
      const reference = await referenceImage(ctx, proposal.name, search.hits).catch(() => null);
      return c.json({
        source: 'ai',
        search: search.provider,
        ...proposal,
        reference,
        learned: learnedForCategory,
        alwaysExcluded: ALWAYS_EXCLUDE,
      });
    } catch (e) {
      if (!(e instanceof AiUnavailable)) console.warn('fingerprint AI failed', e);
      const top = search.hits[0];
      const fp = fingerprintFromTitle(top?.title ?? query);
      fp.exclude = learned.map((r) => r.term);
      const reference = await referenceImage(ctx, fp.title, search.hits).catch(() => null);
      return c.json({
        source: 'rules',
        search: search.provider,
        reference,
        name: fp.title,
        category: null,
        variants: [],
        costEur: 0,
        fingerprint: fp,
        learned,
        alwaysExcluded: ALWAYS_EXCLUDE,
        aiUnavailable: e instanceof AiUnavailable ? e.reason : 'error',
      });
    }
  });

  api.post('/discovery', async (c) => {
    const body = z
      .object({
        query: z.string().min(1),
        fingerprint: fingerprintSchema,
        productId: z.number().int().positive().nullish(),
        category: z.string().max(80).nullish(),
      })
      .parse(await c.req.json());
    const runId = startDiscovery(ctx, {
      productId: body.productId ?? null,
      query: body.query,
      category: body.category ?? null,
      fingerprint: body.fingerprint as Fingerprint,
      follow: Boolean(body.productId),
      useAi: true,
    });
    return c.json({ runId }, 202);
  });

  // Product images from shops, fetched by Gier so the browser never contacts shops directly.
  api.get('/img', async (c) => {
    const u = c.req.query('u');
    return u ? proxyImage(ctx, u) : c.json({ error: 'invalid_input' }, 400);
  });

  api.get('/discovery/:id', (c) => {
    const id = idParam(c.req.param('id'));
    if (id) markRunSeen(id);
    const run = id
      ? ctx.db.select().from(discoveryRuns).where(eq(discoveryRuns.id, id)).get()
      : null;
    return run ? c.json(run) : c.json({ error: 'not_found' }, 404);
  });

  // Stores
  api.get('/stores', (c) => {
    const rows = ctx.db.select().from(stores).orderBy(stores.name).all();
    const counts = ctx.db
      .select({ storeId: listings.storeId, n: sql<number>`count(*)` })
      .from(listings)
      .where(eq(listings.active, true))
      .groupBy(listings.storeId)
      .all();
    return c.json(
      rows.map(({ sessionEncrypted, ...s }) => ({
        ...s,
        hasSession: Boolean(sessionEncrypted),
        products: counts.find((x) => x.storeId === s.id)?.n ?? 0,
      })),
    );
  });

  api.post('/stores', async (c) => {
    const body = z
      .object({ name: z.string().min(1), url: z.string().url() })
      .parse(await c.req.json());
    const store = ensureStore(ctx, body.url, 'trusted', body.name);
    ctx.db
      .update(stores)
      .set({ isFixed: true, origin: 'manual', trust: 'trusted' })
      .where(eq(stores.id, store.id))
      .run();
    return c.json(store, 201);
  });

  api.patch('/stores/:id', async (c) => {
    const id = idParam(c.req.param('id'));
    if (!id) return c.json({ error: 'not_found' }, 404);
    const body = z
      .object({
        trust: z.enum(['trusted', 'doubt', 'blocked']).optional(),
        requiresLogin: z.boolean().optional(),
        selectors: z.record(z.string(), z.string()).nullish(),
        domain: z.string().nullish(),
        category: z.string().optional(),
        /** ADR-013: count this store as cheapest only when it beats the others by this %. 0 = no penalty. */
        preferenceThresholdPct: z.number().min(0).max(50).optional(),
        /** ADR-014: page where the login handoff starts; must be on the store's own domain. */
        loginUrl: z.string().url().nullish(),
        /** The user has this store's loyalty card: card-only promotions count. */
        loyaltyCard: z.boolean().optional(),
      })
      .parse(await c.req.json());
    const { preferenceThresholdPct, loginUrl, loyaltyCard, ...fields } = body;
    const store = ctx.db.select().from(stores).where(eq(stores.id, id)).get();
    if (!store) return c.json({ error: 'not_found' }, 404);
    if (loginUrl && domainOf(loginUrl) !== store.domain)
      return c.json({ error: 'login_url_outside_store' }, 400);
    const rules =
      preferenceThresholdPct === undefined && loginUrl === undefined && loyaltyCard === undefined
        ? undefined
        : {
            ...(store.rules ?? {}),
            ...(preferenceThresholdPct === undefined
              ? {}
              : { preferenceThresholdPct: preferenceThresholdPct || undefined }),
            ...(loginUrl === undefined ? {} : { loginUrl: loginUrl ?? undefined }),
            ...(loyaltyCard === undefined ? {} : { loyaltyCard: loyaltyCard || undefined }),
          };
    ctx.db
      .update(stores)
      .set({ ...(fields as Partial<typeof stores.$inferInsert>), ...(rules ? { rules } : {}) })
      .where(eq(stores.id, id))
      .run();
    return c.json({ ok: true });
  });

  api.post('/stores/:id/login', async (c) => {
    const id = idParam(c.req.param('id'));
    const store = id ? ctx.db.select().from(stores).where(eq(stores.id, id)).get() : null;
    if (!store?.domain) return c.json({ error: 'not_found' }, 404);
    if (!browserRunAvailable(ctx)) return c.json({ error: 'browser_run_not_configured' }, 409);
    const { loginUrl } = z
      .object({ loginUrl: z.string().url().optional() })
      .parse(await c.req.json().catch(() => ({})));
    const target = loginUrl ?? store.rules?.loginUrl ?? `https://www.${store.domain}/`;
    if (domainOf(target) !== store.domain) return c.json({ error: 'login_url_outside_store' }, 400);
    // Remember a login page the user corrected, for the next time.
    if (loginUrl && loginUrl !== store.rules?.loginUrl)
      ctx.db
        .update(stores)
        .set({ rules: { ...(store.rules ?? {}), loginUrl } })
        .where(eq(stores.id, store.id))
        .run();
    try {
      return c.json(await startLoginHandoff(ctx, store.id, target), 202);
    } catch (e) {
      if (!(e instanceof BrowserRunError)) throw e;
      console.warn(`Browser Run: ${e.message}`);
      const status =
        e.code === 'browser_run_failed' ? 502 : e.code === 'browser_run_unauthorized' ? 401 : 429;
      return c.json({ error: e.code }, status);
    }
  });

  api.get('/handoffs/:id', (c) => {
    const h = getHandoff(c.req.param('id'));
    return h ? c.json(h) : c.json({ error: 'not_found' }, 404);
  });

  // Relays typing to the remote browser; phones get no keyboard inside Live View (ADR-014).
  api.post('/handoffs/:id/input', async (c) => {
    const body = z
      .object({
        text: z.string().max(500).optional(),
        key: z.enum(['Enter', 'Tab', 'Backspace']).optional(),
      })
      .parse(await c.req.json());
    const ok = await typeIntoHandoff(c.req.param('id'), body);
    return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  });

  api.delete('/handoffs/:id', async (c) =>
    (await cancelHandoff(c.req.param('id')))
      ? c.json({ ok: true })
      : c.json({ error: 'not_found' }, 404),
  );

  // Notifications
  api.get('/notifications', (c) =>
    c.json(
      ctx.db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(100).all(),
    ),
  );
  api.post('/notifications/read', async (c) => {
    const { ids } = z
      .object({ ids: z.array(z.number().int()).optional() })
      .parse(await c.req.json().catch(() => ({})));
    const where = ids?.length ? sql`${notifications.id} in ${ids}` : isNull(notifications.readAt);
    ctx.db.update(notifications).set({ readAt: ctx.now() }).where(where).run();
    return c.json({ ok: true });
  });

  // Push
  api.get('/push/key', (c) => c.json({ publicKey: ctx.env.VAPID_PUBLIC_KEY ?? null }));
  api.post('/push/subscribe', async (c) => {
    const body = z
      .object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string(), auth: z.string() }),
      })
      .parse(await c.req.json());
    ctx.db
      .insert(pushSubscriptions)
      .values({
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: c.req.header('user-agent') ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { p256dh: body.keys.p256dh, auth: body.keys.auth },
      })
      .run();
    return c.json({ ok: true }, 201);
  });
  // The web app reports the language the user sees, so notifications follow it.
  api.get('/settings/language', (c) => c.json({ language: language(ctx) }));
  api.put('/settings/language', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { language?: unknown };
    if (!isLanguage(body.language)) return c.json({ error: 'unsupported_language' }, 400);
    setLanguage(ctx, body.language);
    return c.json({ language: body.language });
  });

  api.post('/push/test', async (c) => {
    const n = await notify(ctx, {
      kind: 'deal',
      title: translator(ctx).t('push.test.title'),
      body: translator(ctx).t('push.test.body'),
      urgent: true,
    });
    return c.json(n);
  });

  // Costs (ADR-009)
  api.get('/costs', (c) => {
    const from = monthStart(ctx.now());
    const perProduct = ctx.db
      .select({
        productId: aiCalls.productId,
        name: products.name,
        tier: products.aiBudgetTier,
        adviceMode: products.adviceMode,
        calls: sql<number>`count(*)`,
        advice: sql<number>`sum(case when ${aiCalls.purpose} = 'advice' then 1 else 0 end)`,
        inputTokens: sql<number>`sum(${aiCalls.inputTokens})`,
        outputTokens: sql<number>`sum(${aiCalls.outputTokens})`,
        eur: sql<number>`sum(${aiCalls.costEur})`,
      })
      .from(aiCalls)
      .leftJoin(products, eq(aiCalls.productId, products.id))
      .where(gte(aiCalls.createdAt, from))
      .groupBy(aiCalls.productId)
      .all();
    const searches = ctx.db
      .select({
        provider: searchUsage.provider,
        n: sql<number>`count(*)`,
        usd: sql<number>`sum(${searchUsage.costUsd})`,
      })
      .from(searchUsage)
      .where(gte(searchUsage.createdAt, from))
      .groupBy(searchUsage.provider)
      .all();
    return c.json({
      month: from.toISOString().slice(0, 7),
      aiEur: spentThisMonthEur(ctx),
      braveUsd: braveSpentThisMonth(ctx),
      perProduct,
      searches,
      rules: {
        autoAdviceMaxEur: AUTO_ADVICE_MAX_EUR,
        tierCapsEur: TIER_CAP_EUR,
        globalCapEur: ctx.env.AI_MONTHLY_CAP_EUR ?? GLOBAL_CAP_EUR,
        braveCapUsd: ctx.env.BRAVE_MONTHLY_CAP_USD,
      },
    });
  });

  api.get('/exclusions', (c) =>
    c.json(ctx.db.select().from(exclusionRules).orderBy(desc(exclusionRules.count)).all()),
  );

  app.route(`${base}/api`, api);

  // The PWA: static files under the base path, SPA fallback to index.html.
  const dist = resolve(process.cwd(), ctx.env.WEB_DIST);
  {
    // Read per request: tiny file, and a rebuilt web app never serves stale asset hashes.
    // The build uses relative URLs; <base href> anchors them to wherever Gier is served.
    const indexFile = resolve(dist, 'index.html');
    const spa = (c: Context) => {
      if (!existsSync(indexFile)) return c.text('Web app not built: run pnpm build.', 503);
      c.header('cache-control', 'no-cache');
      return c.html(
        readFileSync(indexFile, 'utf8').replace('<head>', `<head>\n    <base href="${base}/" />`),
      );
    };
    app.use(`${base}/*`, async (c, next) => {
      // Hashed assets are immutable; the service worker and index must always revalidate.
      await next();
      if (c.req.path.startsWith(`${base}/assets/`) && c.res.ok)
        c.header('cache-control', 'public, max-age=31536000, immutable');
      if (c.req.path.endsWith('/sw.js')) c.header('cache-control', 'no-cache');
    });
    app.get(`${base}/`, spa);
    app.get(`${base}/index.html`, spa);
    app.use(
      `${base}/*`,
      serveStatic({ root: dist, rewriteRequestPath: (p) => p.slice(base.length) || '/' }),
    );
    // Unknown files and API routes get a 404, not the SPA, so nothing parses HTML by mistake.
    app.get(`${base}/assets/*`, (c) => c.text('Not found', 404));
    app.all(`${base}/api/*`, (c) => c.json({ error: 'not_found' }, 404));
    app.get(`${base}/*`, spa);
    if (base) app.get('/', (c) => c.redirect(`${base}/`));
  }
  return app;
}
