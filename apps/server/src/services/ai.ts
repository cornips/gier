import { and, avg, eq, gte, sql } from 'drizzle-orm';
import {
  canSpend,
  costUsd,
  estimateTokens,
  MAX_PROMPT_TOKENS,
  parseQuantity,
  type BudgetTier,
  type Fingerprint,
} from '@gier/core';
import { aiCalls, products } from '@gier/db';
import type { Ctx } from '../context';
import { eurPerUsd } from './fx';
import { language, languageName } from '../i18n';

export type AiPurpose = 'fingerprint' | 'match' | 'extract' | 'advice';

export class AiUnavailable extends Error {
  constructor(
    public readonly reason: 'no_key' | 'tier_none' | 'product_cap' | 'global_cap' | 'too_long',
  ) {
    super(`AI unavailable: ${reason}`);
  }
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export function spentThisMonthEur(ctx: Ctx, productId?: number | null): number {
  const where = productId
    ? and(gte(aiCalls.createdAt, monthStart(ctx.now())), eq(aiCalls.productId, productId))
    : gte(aiCalls.createdAt, monthStart(ctx.now()));
  return (
    ctx.db
      .select({ t: sql<number>`coalesce(sum(${aiCalls.costEur}), 0)` })
      .from(aiCalls)
      .where(where)
      .get()?.t ?? 0
  );
}

export function averageAdviceCostEur(ctx: Ctx, productId: number): number | null {
  const row = ctx.db
    .select({ a: avg(aiCalls.costEur) })
    .from(aiCalls)
    .where(and(eq(aiCalls.productId, productId), eq(aiCalls.purpose, 'advice')))
    .get();
  return row?.a == null ? null : Number(row.a);
}

interface CallOptions {
  productId: number | null;
  purpose: AiPurpose;
  system: string;
  prompt: string;
  maxTokens: number;
}

/**
 * Calls the Anthropic Messages API with budget checks before the call and a cost log after it (ADR-009).
 */
export async function callClaude(
  ctx: Ctx,
  o: CallOptions,
): Promise<{ text: string; costEur: number; callId: number }> {
  const { env } = ctx;
  if (!env.ANTHROPIC_API_KEY) throw new AiUnavailable('no_key');
  const inTokens = estimateTokens(o.system + o.prompt);
  if (inTokens > MAX_PROMPT_TOKENS) throw new AiUnavailable('too_long');

  const rate = await eurPerUsd(ctx);
  const tier: BudgetTier = o.productId
    ? (ctx.db
        .select({ t: products.aiBudgetTier })
        .from(products)
        .where(eq(products.id, o.productId))
        .get()?.t ?? 'frugal')
    : 'frugal';
  const estimate = costUsd(env.ANTHROPIC_MODEL, inTokens, o.maxTokens) * rate;
  const decision = canSpend(
    {
      tier,
      productSpentThisMonthEur: o.productId ? spentThisMonthEur(ctx, o.productId) : 0,
      globalSpentThisMonthEur: spentThisMonthEur(ctx),
      globalCapEur: env.AI_MONTHLY_CAP_EUR,
    },
    estimate,
  );
  if (!decision.allowed) throw new AiUnavailable(decision.reason);

  const res = await ctx.http('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL,
      max_tokens: o.maxTokens,
      system: o.system,
      messages: [{ role: 'user', content: o.prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    content: { type: string; text?: string }[];
    usage: { input_tokens: number; output_tokens: number };
  };
  const usd = costUsd(env.ANTHROPIC_MODEL, data.usage.input_tokens, data.usage.output_tokens);
  const costEur = Math.round(usd * rate * 1_000_000) / 1_000_000;
  const [row] = ctx.db
    .insert(aiCalls)
    .values({
      productId: o.productId,
      purpose: o.purpose,
      model: env.ANTHROPIC_MODEL,
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      costUsd: usd,
      costEur,
    })
    .returning({ id: aiCalls.id })
    .all();
  const text = data.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('');
  return { text, costEur, callId: row!.id };
}

/** Pulls the first JSON object or array out of a model reply. */
export function parseJson<T>(text: string): T {
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start < 0 || end < start) throw new Error('No JSON in model reply');
  return JSON.parse(text.slice(start, end + 1)) as T;
}

export interface FingerprintProposal {
  fingerprint: Fingerprint;
  name: string;
  category: string | null;
  variants: { label: string; quantity: string }[];
}

const FINGERPRINT_SYSTEM = `You help a price tracker understand exactly which physical product a user means.
Shops are mostly Dutch, so titles may be in Dutch.
Reply with JSON only, no prose. Schema:
{"name": string, "brand": string|null, "line": string|null, "form": string|null, "size": string|null,
 "gtin": string|null, "model": string|null, "category": string|null,
 "variants": [{"label": string, "quantity": string}]}
"size" is the content per item such as "150 ml" or "1 kg", null for non-consumables.
"variants" lists other sizes or packs that exist for the same product line (max 5).
"category" is a short lowercase English shop category such as "personal care", "audio", "kitchen".`;

export async function proposeFingerprint(
  ctx: Ctx,
  query: string,
  hits: { title: string; snippet: string }[],
): Promise<FingerprintProposal & { costEur: number }> {
  const prompt = `User search: "${query}"\n\nTop search results:\n${hits
    .slice(0, 12)
    .map((h, i) => `${i + 1}. ${h.title} — ${h.snippet.slice(0, 160)}`)
    .join('\n')}`;
  const { text, costEur } = await callClaude(ctx, {
    productId: null,
    purpose: 'fingerprint',
    system: FINGERPRINT_SYSTEM,
    prompt,
    maxTokens: 500,
  });
  const r = parseJson<{
    name: string;
    brand: string | null;
    line: string | null;
    form: string | null;
    size: string | null;
    gtin: string | null;
    model: string | null;
    category: string | null;
    variants?: { label: string; quantity: string }[];
  }>(text);
  const q = r.size ? parseQuantity(r.size) : null;
  const locked: Fingerprint['locked'] = [];
  if (r.brand) locked.push('brand');
  if (r.line) locked.push('line');
  if (q && q.unit !== 'piece') locked.push('quantity');
  if (r.model) locked.push('model');
  return {
    name: r.name,
    category: r.category,
    variants: r.variants ?? [],
    costEur,
    fingerprint: {
      title: r.name,
      brand: r.brand,
      line: r.line,
      form: r.form,
      quantity: q && q.unit !== 'piece' ? { ...q, packCount: 1 } : null,
      gtin: r.gtin,
      model: r.model,
      locked,
      allowMultipack: true,
      compareUnit: 'piece',
      exclude: [],
    },
  };
}

const MATCH_SYSTEM = `You decide whether shop listings are the exact product a user wants.
Reply with JSON only: [{"i": number, "same": boolean, "reason": string}] where reason is max 8 English words.
Different size, variant, colour line, bundle with extra items, refurbished or used means not the same.
A multipack of the exact same item counts as the same.`;

export async function judgeDoubtfulMatches(
  ctx: Ctx,
  productId: number | null,
  fp: Fingerprint,
  titles: string[],
): Promise<{ same: boolean; reason: string }[]> {
  const prompt = `Wanted: ${fp.title}${fp.quantity ? ` (${fp.quantity.amount} ${fp.quantity.unit})` : ''}\nListings:\n${titles
    .map((t, i) => `${i}. ${t}`)
    .join('\n')}`;
  const { text } = await callClaude(ctx, {
    productId,
    purpose: 'match',
    system: MATCH_SYSTEM,
    prompt,
    maxTokens: 60 + titles.length * 30,
  });
  const rows = parseJson<{ i: number; same: boolean; reason: string }[]>(text);
  return titles.map((_, i) => {
    const r = rows.find((x) => x.i === i);
    return { same: r?.same ?? false, reason: r?.reason ?? 'no verdict' };
  });
}

const adviceSystem = (lang: string) =>
  `You write the buying advice of Gier, a price tracker. Write in ${lang}, at most 3 short sentences.
Say whether buying now or waiting is wise and why, based only on the given price history and checks.
Do not state future prices as fact. Mention fake discounts if the checks contain them. No list, no greeting.`;

export async function writeAdvice(ctx: Ctx, productId: number, summary: string) {
  return callClaude(ctx, {
    productId,
    purpose: 'advice',
    system: adviceSystem(languageName(language(ctx))),
    prompt: summary,
    maxTokens: 220,
  });
}
