// API shapes returned by apps/server. Kept by hand so the web build stays free of server deps.
import type { DealLabel, Finding, Fingerprint, ProductVerdict } from '@gier/core/browser';

export type { DealLabel, Finding, Fingerprint };
export type Trust = 'trusted' | 'doubt' | 'blocked';
export type BudgetTier = 'none' | 'frugal' | 'normal' | 'generous';
export type AdviceMode = 'auto' | 'on_request' | 'off';
export type AlertKind =
  | 'below'
  | 'above'
  | 'any_change'
  | 'drop_percent'
  | 'all_time_low'
  | 'back_in_stock'
  | 'new_store'
  | 'fake_discount';

export interface Health {
  ok: boolean;
  version: string;
  features: Record<
    'searxng' | 'brave' | 'ai' | 'browserRun' | 'push' | 'telegram' | 'ntfy' | 'homeAssistant',
    boolean
  >;
}

export interface ProductSummary {
  id: number;
  name: string;
  brand: string | null;
  category: string | null;
  imageUrl: string | null;
  compareUnit: 'piece' | 'per100';
  storesCount: number;
  lowestCents: number | null;
  lowestStore: string | null;
  startCents: number | null;
  deltaPct: number | null;
  label: DealLabel;
  allTimeLow: number | null;
  fakeDiscounts: number;
  sparkline: number[];
  alerts: { kind: AlertKind; thresholdCents: number | null }[];
  trackedSince: string;
  lastCheckedAt: number | null;
}

export interface ListingView {
  id: number;
  url: string;
  title: string | null;
  storeId: number;
  storeName: string;
  storeTrust: Trust;
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

export interface AlertRule {
  id: number;
  productId: number;
  kind: AlertKind;
  thresholdCents: number | null;
  percent: number | null;
  active: boolean;
}

export interface ProductDetail extends ProductSummary {
  fingerprint: Fingerprint;
  gtin: string | null;
  notes: string | null;
  targetPriceCents: number | null;
  aiBudgetTier: BudgetTier;
  adviceMode: AdviceMode;
  verdict: ProductVerdict;
  lowestSeries: { at: string; cents: number }[];
  storeSeries: { storeName: string; points: { at: string; cents: number }[] }[];
  listings: ListingView[];
  changes: { at: string; storeName: string; fromCents: number; toCents: number }[];
  alertRules: AlertRule[];
  advice: { text: string; createdAt: string } | null;
  aiCost: { calls: number; eur: number; inputTokens: number; outputTokens: number };
}

export interface FingerprintProposal {
  source: 'ai' | 'rules';
  search: string;
  name: string;
  category: string | null;
  variants: string[];
  costEur: number;
  fingerprint: Fingerprint;
  learned: { term: string; category: string | null; count: number }[];
  alwaysExcluded: string[];
  aiUnavailable?: string;
}

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
}

export interface DiscoveryRun {
  id: number;
  productId: number | null;
  query: string;
  status: 'running' | 'done' | 'failed';
  stage: 'search' | 'extract' | 'match' | 'trust' | 'done';
  stats: Record<string, number> | null;
  candidates: DiscoveryCandidate[] | null;
  error: string | null;
}

export interface StoreRow {
  id: number;
  name: string;
  domain: string | null;
  category: string;
  trust: Trust;
  origin: 'fixed' | 'learned' | 'manual';
  isFixed: boolean;
  extraction: string;
  requiresLogin: boolean;
  hasSession: boolean;
  failCount: number;
  needsResearch: boolean;
  domainAgeDays: number | null;
  products: number;
  rules: Record<string, unknown> | null;
}

export interface NotificationRow {
  id: number;
  productId: number | null;
  kind: 'deal' | 'fake' | 'store' | 'warning' | 'advice' | 'digest' | 'login';
  title: string;
  body: string;
  deliveredVia: string[] | null;
  readAt: string | null;
  createdAt: string;
}

export interface Costs {
  month: string;
  aiEur: number;
  braveUsd: number;
  perProduct: {
    productId: number | null;
    name: string | null;
    tier: BudgetTier | null;
    adviceMode: AdviceMode | null;
    calls: number;
    advice: number;
    inputTokens: number;
    outputTokens: number;
    eur: number;
  }[];
  searches: { provider: string; n: number; usd: number }[];
  rules: {
    autoAdviceMaxEur: number;
    tierCapsEur: Record<BudgetTier, number>;
    globalCapEur: number;
    braveCapUsd: number;
  };
}

export interface Handoff {
  id: string;
  storeId: number;
  status: 'waiting' | 'done' | 'failed' | 'expired';
  liveViewUrl?: string;
  error?: string;
}
