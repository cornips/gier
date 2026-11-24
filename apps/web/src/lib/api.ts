import type {
  AlertRule,
  Costs,
  DiscoveryRun,
  Fingerprint,
  FingerprintProposal,
  Handoff,
  Health,
  NotificationRow,
  ProductDetail,
  ProductSummary,
  StoreRow,
  BudgetTier,
  AdviceMode,
  AlertKind,
  Trust,
  TelegramStatus,
} from './types';

/**
 * The server injects <base href> with its base path, so one build works at the site root or below a path.
 */
export const BASE =
  typeof document === 'undefined' ? '' : new URL(document.baseURI).pathname.replace(/\/$/, '');
export const API = `${BASE}/api`;

/** Shop images go through Gier's image proxy, so the browser never contacts shops directly. */
export const imageSrc = (url: string | null | undefined) =>
  url ? `${API}/img?u=${encodeURIComponent(url)}` : undefined;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** The session ended: a proxy in front of Gier (e.g. Cloudflare Access) wants the user to sign in again. */
export const AUTH_REQUIRED = 'auth_required';
export const OFFLINE = 'offline';

export const isAuthError = (e: unknown) => e instanceof ApiError && e.code === AUTH_REQUIRED;

/** Sends the browser through the login page and back to where the user was. */
export function signInAgain() {
  const next = window.location.pathname + window.location.search;
  window.location.assign(`${API}/login?next=${encodeURIComponent(next)}`);
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...rest,
      // A login redirect must not be followed by fetch: it would end in a cross-site error.
      redirect: 'manual',
      headers: {
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...rest.headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError(0, navigator.onLine === false ? OFFLINE : 'network_error');
  }
  const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
  // Gier itself always answers in JSON; a redirect or a bare 401/403 comes from the login proxy.
  if (res.type === 'opaqueredirect' || ((res.status === 401 || res.status === 403) && !isJson))
    throw new ApiError(401, AUTH_REQUIRED);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  if (!isJson) throw new ApiError(res.status, 'unexpected_response');
  return (await res.json()) as T;
}

export interface CreateProductInput {
  name: string;
  query: string;
  category?: string | null;
  fingerprint: Fingerprint;
  aiBudgetTier: BudgetTier;
  adviceMode: AdviceMode;
  targetPriceCents?: number | null;
  alerts?: AlertKind[];
  discover: boolean;
}

export const api = {
  health: () => request<Health>('/health'),
  sendFeedback: (body: {
    kind: 'bug' | 'idea' | 'question' | 'other';
    message: string;
    lang: 'en' | 'nl';
    context: Record<string, string>;
  }) => request<{ ok: true }>('/feedback', { method: 'POST', json: body }),
  products: () => request<ProductSummary[]>('/products'),
  product: (id: number) => request<ProductDetail>(`/products/${id}`),
  createProduct: (input: CreateProductInput) =>
    request<{ product: { id: number }; runId: number | null }>('/products', {
      method: 'POST',
      json: input,
    }),
  productFromUrl: (url: string) =>
    request<{ product: { id: number } }>('/products/from-url', { method: 'POST', json: { url } }),
  updateProduct: (
    id: number,
    patch: Partial<{
      name: string;
      notes: string | null;
      targetPriceCents: number | null;
      aiBudgetTier: BudgetTier;
      adviceMode: AdviceMode;
      compareUnit: 'piece' | 'per100';
      archived: boolean;
    }>,
  ) => request<ProductDetail>(`/products/${id}`, { method: 'PATCH', json: patch }),
  checkProduct: (id: number) =>
    request<{ outcomes: unknown[] }>(`/products/${id}/check`, { method: 'POST' }),
  advice: (id: number) =>
    request<
      { status: 'ok'; text: string; costEur: number } | { status: 'skipped'; reason: string }
    >(`/products/${id}/advice`, { method: 'POST' }),
  rediscover: (id: number) =>
    request<{ runId: number }>(`/products/${id}/discover`, { method: 'POST' }),
  addListing: (id: number, url: string) =>
    request<unknown>(`/products/${id}/listings`, { method: 'POST', json: { url } }),
  exclude: (id: number, term: string) =>
    request<{ fingerprint: Fingerprint }>(`/products/${id}/exclude`, {
      method: 'POST',
      json: { term },
    }),
  setAlerts: (
    id: number,
    rules: Pick<AlertRule, 'kind' | 'thresholdCents' | 'percent' | 'active'>[],
  ) => request<AlertRule[]>(`/products/${id}/alerts`, { method: 'PUT', json: rules }),
  setListingActive: (id: number, active: boolean) =>
    request<{ ok: true }>(`/listings/${id}`, { method: 'PATCH', json: { active } }),
  exportUrl: (id: number) => `${API}/products/${id}/export.csv`,
  search: (q: string) =>
    request<{ followed: { id: number; name: string }[] }>(`/search?q=${encodeURIComponent(q)}`),
  proposeFingerprint: (query: string) =>
    request<FingerprintProposal>('/discovery/fingerprint', { method: 'POST', json: { query } }),
  discovery: (id: number) => request<DiscoveryRun>(`/discovery/${id}`),
  stores: () => request<StoreRow[]>('/stores'),
  addStore: (name: string, url: string) =>
    request<StoreRow>('/stores', { method: 'POST', json: { name, url } }),
  updateStore: (
    id: number,
    patch: Partial<{
      trust: Trust;
      requiresLogin: boolean;
      preferenceThresholdPct: number;
      loginUrl: string | null;
      loyaltyCard: boolean;
    }>,
  ) => request<{ ok: true }>(`/stores/${id}`, { method: 'PATCH', json: patch }),
  startLogin: (id: number, loginUrl?: string) =>
    request<Handoff>(`/stores/${id}/login`, { method: 'POST', json: loginUrl ? { loginUrl } : {} }),
  handoff: (id: string) => request<Handoff>(`/handoffs/${id}`),
  handoffInput: (id: string, input: { text?: string; key?: 'Enter' | 'Tab' | 'Backspace' }) =>
    request<{ ok: true }>(`/handoffs/${id}/input`, { method: 'POST', json: input }),
  cancelHandoff: (id: string) =>
    request<{ ok: true }>(`/handoffs/${id}`, { method: 'DELETE' }).catch(() => undefined),
  notifications: () => request<NotificationRow[]>('/notifications'),
  markRead: (ids?: number[]) =>
    request<{ ok: true }>('/notifications/read', { method: 'POST', json: ids ? { ids } : {} }),
  pushKey: () => request<{ publicKey: string | null }>('/push/key'),
  subscribe: (sub: PushSubscriptionJSON) =>
    request<{ ok: true }>('/push/subscribe', { method: 'POST', json: sub }),
  testPush: () => request<unknown>('/push/test', { method: 'POST' }),
  telegram: () => request<TelegramStatus>('/telegram'),
  telegramLink: () =>
    request<{ url: string; expiresAt: string }>('/telegram/link', { method: 'POST' }),
  telegramUnlink: (id: string) =>
    request<{ ok: true }>(`/telegram/links/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  costs: () => request<Costs>('/costs'),
  setLanguage: (language: string) =>
    request<{ language: string }>('/settings/language', { method: 'PUT', json: { language } }),
};
