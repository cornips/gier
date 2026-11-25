import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { Fingerprint, Promotion, SelectorConfig, StoreCategory, StoreRules } from '@gier/core';

const id = () => integer('id').primaryKey({ autoIncrement: true });
const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

export const products = sqliteTable('products', {
  id: id(),
  name: text('name').notNull(),
  brand: text('brand'),
  category: text('category'),
  gtin: text('gtin'),
  imageUrl: text('image_url'),
  fingerprint: text('fingerprint', { mode: 'json' }).$type<Fingerprint>().notNull(),
  compareUnit: text('compare_unit', { enum: ['piece', 'per100'] })
    .notNull()
    .default('piece'),
  aiBudgetTier: text('ai_budget_tier', { enum: ['none', 'frugal', 'normal', 'generous'] })
    .notNull()
    .default('frugal'),
  adviceMode: text('advice_mode', { enum: ['auto', 'on_request', 'off'] })
    .notNull()
    .default('auto'),
  targetPriceCents: integer('target_price_cents'),
  notes: text('notes'),
  lastDiscoveryAt: integer('last_discovery_at', { mode: 'timestamp_ms' }),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
});

export type TrustLevel = 'trusted' | 'doubt' | 'blocked';
export type ExtractionMethod = 'api' | 'jsonld' | 'selector' | 'browser' | 'ai';

export const stores = sqliteTable(
  'stores',
  {
    id: id(),
    name: text('name').notNull(),
    domain: text('domain'),
    category: text('category').$type<StoreCategory>().notNull().default('unknown'),
    isFixed: integer('is_fixed', { mode: 'boolean' }).notNull().default(false),
    trust: text('trust').$type<TrustLevel>().notNull().default('doubt'),
    origin: text('origin', { enum: ['fixed', 'learned', 'manual'] })
      .notNull()
      .default('learned'),
    extraction: text('extraction').$type<ExtractionMethod>().notNull().default('jsonld'),
    selectors: text('selectors', { mode: 'json' }).$type<SelectorConfig>(),
    rules: text('rules', { mode: 'json' }).$type<StoreRules>(),
    searchUrl: text('search_url'),
    requiresLogin: integer('requires_login', { mode: 'boolean' }).notNull().default(false),
    /** AES-GCM encrypted browser session (cookies) from the login handoff, never a password. */
    sessionEncrypted: text('session_encrypted'),
    sessionUpdatedAt: integer('session_updated_at', { mode: 'timestamp_ms' }),
    domainAgeDays: integer('domain_age_days'),
    failCount: integer('fail_count').notNull().default(0),
    lastSuccessAt: integer('last_success_at', { mode: 'timestamp_ms' }),
    needsResearch: integer('needs_research', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('stores_domain_idx').on(t.domain)],
);

export const listings = sqliteTable(
  'listings',
  {
    id: id(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    storeId: integer('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    title: text('title'),
    packCount: integer('pack_count').notNull().default(1),
    /** promotionKey()s of deals the user marked as wrong for this listing; Gier ignores them. */
    dismissedPromotions: text('dismissed_promotions', { mode: 'json' }).$type<string[]>(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    followedAutomatically: integer('followed_automatically', { mode: 'boolean' })
      .notNull()
      .default(false),
    lastCheckedAt: integer('last_checked_at', { mode: 'timestamp_ms' }),
    nextCheckAt: integer('next_check_at', { mode: 'timestamp_ms' }),
    failStreak: integer('fail_streak').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('listings_product_url_idx').on(t.productId, t.url),
    index('listings_next_check_idx').on(t.nextCheckAt),
  ],
);

export const pricePoints = sqliteTable(
  'price_points',
  {
    id: id(),
    listingId: integer('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    observedAt: integer('observed_at', { mode: 'timestamp_ms' }).notNull(),
    priceCents: integer('price_cents').notNull(),
    shippingCents: integer('shipping_cents'),
    inStock: integer('in_stock', { mode: 'boolean' }).notNull().default(true),
    referenceCents: integer('reference_cents'),
    referenceType: text('reference_type', { enum: ['was', 'list', 'usual', 'none'] })
      .notNull()
      .default('none'),
    claimedDiscountPct: integer('claimed_discount_pct'),
    dealLabel: text('deal_label'),
    /** Multi-buy promotions shown with this price (1+1 gratis, 2e halve prijs, …). */
    promotions: text('promotions', { mode: 'json' }).$type<Promotion[]>(),
    isHeartbeat: integer('is_heartbeat', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('price_points_listing_idx').on(t.listingId, t.observedAt)],
);

export const alerts = sqliteTable('alerts', {
  id: id(),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  kind: text('kind', {
    enum: [
      'below',
      'above',
      'any_change',
      'drop_percent',
      'all_time_low',
      'back_in_stock',
      'new_store',
      'fake_discount',
    ],
  }).notNull(),
  thresholdCents: integer('threshold_cents'),
  percent: real('percent'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  lastFiredAt: integer('last_fired_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
});

export const notifications = sqliteTable('notifications', {
  id: id(),
  productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
  kind: text('kind', {
    enum: ['deal', 'fake', 'store', 'warning', 'advice', 'digest', 'login'],
  }).notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  data: text('data', { mode: 'json' }).$type<Record<string, unknown>>(),
  deliveredVia: text('delivered_via', { mode: 'json' }).$type<string[]>(),
  readAt: integer('read_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
});

export const exclusionRules = sqliteTable(
  'exclusion_rules',
  {
    id: id(),
    term: text('term').notNull(),
    category: text('category'),
    count: integer('count').notNull().default(1),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  (t) => [uniqueIndex('exclusion_term_category_idx').on(t.term, t.category)],
);

export interface DiscoveryCandidate {
  url: string;
  storeName: string;
  domain: string | null;
  title: string | null;
  priceCents: number | null;
  unitPriceCents: number | null;
  shippingCents: number | null;
  packCount: number;
  match: 'match' | 'doubt' | 'reject';
  matchReasons: string[];
  trust: 'trusted' | 'doubt' | 'excluded';
  trustReasons: string[];
  followed: boolean;
  /** Product image on the shop page, shown through the image proxy. */
  imageUrl?: string | null;
  /** Best multi-buy promotion that applies for this user, and the price per item with it. */
  promotion?: Promotion | null;
  promoUnitCents?: number | null;
  /** A card-only promotion the user cannot use yet (no card for this store). */
  cardPromotion?: Promotion | null;
  cardUnitCents?: number | null;
  gtin?: string | null;
}

/** A page Gier found but could not read during a discovery, and why. */
export interface UnreadPage {
  url: string;
  domain: string | null;
  reason: string;
}

export interface DiscoveryStats {
  searches?: number;
  storeSearches?: number;
  results?: number;
  read?: number;
  priced?: number;
  matched?: number;
  doubt?: number;
  followed?: number;
  unread?: UnreadPage[];
}

export const discoveryRuns = sqliteTable('discovery_runs', {
  id: id(),
  productId: integer('product_id').references(() => products.id, { onDelete: 'cascade' }),
  query: text('query').notNull(),
  status: text('status', { enum: ['running', 'done', 'failed'] })
    .notNull()
    .default('running'),
  stage: text('stage', { enum: ['search', 'extract', 'match', 'trust', 'done'] })
    .notNull()
    .default('search'),
  stats: text('stats', { mode: 'json' }).$type<DiscoveryStats>(),
  candidates: text('candidates', { mode: 'json' }).$type<DiscoveryCandidate[]>(),
  error: text('error'),
  startedAt: createdAt(),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
});

export const aiCalls = sqliteTable(
  'ai_calls',
  {
    id: id(),
    productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
    purpose: text('purpose', { enum: ['fingerprint', 'match', 'extract', 'advice'] }).notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    costUsd: real('cost_usd').notNull(),
    costEur: real('cost_eur').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('ai_calls_product_idx').on(t.productId, t.createdAt)],
);

export const adviceEntries = sqliteTable('advice', {
  id: id(),
  productId: integer('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  aiCallId: integer('ai_call_id').references(() => aiCalls.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const searchUsage = sqliteTable('search_usage', {
  id: id(),
  provider: text('provider', { enum: ['searxng', 'brave'] }).notNull(),
  query: text('query').notNull(),
  results: integer('results').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  createdAt: createdAt(),
});

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: id(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>(),
});

export type Product = typeof products.$inferSelect;
export type Store = typeof stores.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type PricePointRow = typeof pricePoints.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type AiCall = typeof aiCalls.$inferSelect;
export type DiscoveryRun = typeof discoveryRuns.$inferSelect;
