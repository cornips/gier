import type { StoreSearch } from '@gier/core';
import type { Store } from '@gier/db';
import type { Ctx } from '../context';

const MAX_PER_STORE = 3;

const at = (obj: unknown, path: string | undefined): unknown =>
  path
    ? path
        .split('.')
        .reduce<unknown>(
          (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
          obj,
        )
    : obj;

const absolute = (href: string, base: string | undefined) => {
  try {
    return new URL(href.replace(/&amp;/g, '&'), base).toString();
  } catch {
    return null;
  }
};

/**
 * Asks a known store's own search for the product. Web search misses shops whose product pages are
 * barely indexed (Kruidvat, Etos), so for stores with a search config this is the reliable route.
 * Returns at most a few product URLs, in the store's own order of relevance.
 */
export async function storeSearch(
  ctx: Ctx,
  store: Store,
  query: string,
): Promise<{ urls: string[]; error?: string }> {
  const cfg = store.rules?.search as StoreSearch | undefined;
  if (!cfg) return { urls: [] };
  const url = cfg.url.replace('{q}', encodeURIComponent(query));
  const res = await ctx.fetcher.get(url, {
    accept: cfg.type === 'json' ? 'application/json' : undefined,
  });
  if (!res.ok) return { urls: [], error: res.blocked ? 'blocked' : `http_${res.status}` };
  const found: string[] = [];
  if (cfg.type === 'json') {
    let data: unknown;
    try {
      data = JSON.parse(res.html);
    } catch {
      return { urls: [], error: 'bad_json' };
    }
    const items = at(data, cfg.items);
    for (const item of Array.isArray(items) ? items : []) {
      const href = at(item, cfg.link ?? 'url');
      if (typeof href === 'string') {
        const abs = absolute(href, cfg.base ?? url);
        if (abs) found.push(abs);
      }
    }
  } else if (cfg.productPath) {
    const re = new RegExp(`href="((?:https?://[^"/]+)?${cfg.productPath})"`, 'gi');
    for (const m of res.html.matchAll(re)) {
      const abs = absolute(m[1]!, cfg.base ?? url);
      if (abs) found.push(abs);
    }
  }
  return { urls: [...new Set(found)].slice(0, MAX_PER_STORE) };
}
