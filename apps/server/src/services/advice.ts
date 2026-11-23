import { desc, eq } from 'drizzle-orm';
import { adviceMode, formatEuro, type Finding } from '@gier/core';
import { adviceEntries, products } from '@gier/db';
import type { Ctx } from '../context';
import { AiUnavailable, averageAdviceCostEur, writeAdvice } from './ai';
import { productDetail } from './products';

const FINDING_TEXT: Record<Finding['code'], string> = {
  raised_before_sale: 'price raised before the sale',
  inflated_percentage: 'discount percentage inflated',
  unused_list_price: 'list price nobody charges',
  false_usual_price: '"usually" price is wrong',
  inflated_was_price: 'was-price above the 30-day low',
  label_without_drop: 'deal label without a price drop',
  endless_sale: 'sale has been running for a long time',
  cheaper_elsewhere: 'cheaper elsewhere',
  insufficient_history: 'not enough history yet',
};

/** Compact, factual summary for the advice prompt (stays far below the token budget). */
export function adviceSummary(detail: NonNullable<ReturnType<typeof productDetail>>): string {
  const f = (c: number | null) => (c == null ? 'unknown' : formatEuro(c));
  const lines = [
    `Product: ${detail.name}`,
    `Tracked since: ${detail.trackedSince.slice(0, 10)} (${detail.verdict.trackedDays} days)`,
    `Lowest price now: ${f(detail.lowestCents)} at ${detail.lowestStore ?? 'unknown'}`,
    `Lowest 30 days: ${f(detail.verdict.low30)}; median 90 days: ${f(detail.verdict.median90)}; all-time low: ${f(detail.verdict.allTimeLow)}`,
    `Deal label: ${detail.verdict.label}`,
    detail.targetPriceCents ? `User's target price: ${f(detail.targetPriceCents)}` : null,
    `Recent changes: ${
      detail.changes
        .slice(0, 8)
        .map((c) => `${c.at.slice(0, 10)} ${c.storeName} ${f(c.fromCents)}→${f(c.toCents)}`)
        .join('; ') || 'none'
    }`,
    `Checks per store: ${
      detail.listings
        .filter((l) => l.findings.length)
        .map((l) => `${l.storeName}: ${l.findings.map((x) => FINDING_TEXT[x.code]).join(', ')}`)
        .join(' | ') || 'nothing notable'
    }`,
  ];
  return lines.filter(Boolean).join('\n');
}

export type AdviceResult =
  { status: 'ok'; text: string; costEur: number } | { status: 'skipped'; reason: string };

/** Writes buy advice with Claude Haiku when the product's mode and budget allow it (ADR-009). */
export async function generateAdvice(
  ctx: Ctx,
  productId: number,
  requested: boolean,
): Promise<AdviceResult> {
  const product = ctx.db.select().from(products).where(eq(products.id, productId)).get();
  if (!product) return { status: 'skipped', reason: 'not_found' };
  const mode = adviceMode(
    product.adviceMode,
    product.aiBudgetTier,
    averageAdviceCostEur(ctx, productId),
  );
  if (mode === 'off') return { status: 'skipped', reason: 'off' };
  if (mode === 'on_request' && !requested) return { status: 'skipped', reason: 'on_request' };
  if (!requested) {
    const last = ctx.db
      .select()
      .from(adviceEntries)
      .where(eq(adviceEntries.productId, productId))
      .orderBy(desc(adviceEntries.createdAt))
      .get();
    if (last && ctx.now().getTime() - last.createdAt.getTime() < 12 * 3600_000)
      return { status: 'skipped', reason: 'recent' };
  }
  const detail = productDetail(ctx, productId);
  if (!detail || detail.lowestCents === null) return { status: 'skipped', reason: 'no_prices' };
  try {
    const { text, costEur, callId } = await writeAdvice(ctx, productId, adviceSummary(detail));
    ctx.db.insert(adviceEntries).values({ productId, text: text.trim(), aiCallId: callId }).run();
    return { status: 'ok', text: text.trim(), costEur };
  } catch (e) {
    if (e instanceof AiUnavailable) return { status: 'skipped', reason: e.reason };
    throw e;
  }
}
