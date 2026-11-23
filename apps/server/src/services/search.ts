import { and, gte, eq, sql } from 'drizzle-orm';
import { searchUsage } from '@gier/db';
import type { Ctx } from '../context';

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
  /** Thumbnail from the search engine, when it gives one. */
  image?: string | null;
}

export interface SearchOutcome {
  provider: 'searxng' | 'brave' | 'none';
  hits: SearchHit[];
  note?: string;
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Brave spend this month in USD, from our own usage log (ADR-005: stay inside the free credit). */
export function braveSpentThisMonth(ctx: Ctx): number {
  const row = ctx.db
    .select({ total: sql<number>`coalesce(sum(${searchUsage.costUsd}), 0)` })
    .from(searchUsage)
    .where(
      and(eq(searchUsage.provider, 'brave'), gte(searchUsage.createdAt, monthStart(ctx.now()))),
    )
    .get();
  return row?.total ?? 0;
}

async function searxng(ctx: Ctx, query: string): Promise<SearchHit[] | null> {
  if (!ctx.env.SEARXNG_URL) return null;
  const url = new URL('/search', ctx.env.SEARXNG_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('language', 'nl-NL');
  url.searchParams.set('safesearch', '0');
  try {
    const res = await ctx.http(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: {
        url: string;
        title?: string;
        content?: string;
        thumbnail?: string;
        img_src?: string;
      }[];
      unresponsive_engines?: unknown[];
    };
    const hits = (data.results ?? []).map((r) => ({
      url: r.url,
      title: r.title ?? '',
      snippet: r.content ?? '',
      image: r.thumbnail || r.img_src || null,
    }));
    ctx.db.insert(searchUsage).values({ provider: 'searxng', query, results: hits.length }).run();
    return hits;
  } catch {
    return null;
  }
}

async function brave(ctx: Ctx, query: string): Promise<SearchHit[] | null> {
  if (!ctx.env.BRAVE_API_KEY) return null;
  if (braveSpentThisMonth(ctx) + ctx.env.BRAVE_COST_PER_QUERY_USD > ctx.env.BRAVE_MONTHLY_CAP_USD)
    return null;
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('country', 'nl');
  url.searchParams.set('search_lang', 'nl');
  url.searchParams.set('count', '20');
  try {
    const res = await ctx.http(url, {
      headers: { accept: 'application/json', 'x-subscription-token': ctx.env.BRAVE_API_KEY },
    });
    ctx.db
      .insert(searchUsage)
      .values({ provider: 'brave', query, results: 0, costUsd: ctx.env.BRAVE_COST_PER_QUERY_USD })
      .run();
    if (!res.ok) return null;
    const data = (await res.json()) as {
      web?: {
        results?: {
          url: string;
          title?: string;
          description?: string;
          thumbnail?: { src?: string; original?: string };
        }[];
      };
    };
    return (data.web?.results ?? []).map((r) => ({
      url: r.url,
      title: r.title ?? '',
      snippet: r.description ?? '',
      image: r.thumbnail?.original ?? r.thumbnail?.src ?? null,
    }));
  } catch {
    return null;
  }
}

/** SearXNG first; Brave only when SearXNG is missing, failing or empty, and only within budget. */
export async function webSearch(ctx: Ctx, query: string): Promise<SearchOutcome> {
  const local = await searxng(ctx, query);
  if (local && local.length > 0) return { provider: 'searxng', hits: local };
  const paid = await brave(ctx, query);
  if (paid)
    return { provider: 'brave', hits: paid, note: local ? 'searxng_empty' : 'searxng_unavailable' };
  return { provider: 'none', hits: [], note: 'no_search_provider' };
}
