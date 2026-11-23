import { eq } from 'drizzle-orm';
import { settings } from '@gier/db';
import type { Ctx } from '../context';

const KEY = 'fx.usd_eur';
const FALLBACK_EUR_PER_USD = 0.87;

/**
 * EUR per USD from the ECB daily reference rates (free), cached for a day in settings.
 * The ECB publishes USD per EUR, so the value is inverted.
 */
export async function eurPerUsd(ctx: Ctx): Promise<number> {
  const cached = ctx.db.select().from(settings).where(eq(settings.key, KEY)).get()?.value as
    { rate: number; at: number } | undefined;
  if (cached && ctx.now().getTime() - cached.at < 24 * 3600_000) return cached.rate;
  try {
    const res = await ctx.http('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml');
    const xml = await res.text();
    const m = /currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]/.exec(xml);
    if (m) {
      const rate = Math.round((1 / Number(m[1])) * 10_000) / 10_000;
      const value = { rate, at: ctx.now().getTime() };
      ctx.db
        .insert(settings)
        .values({ key: KEY, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } })
        .run();
      return rate;
    }
  } catch {
    /* fall through */
  }
  return cached?.rate ?? FALLBACK_EUR_PER_USD;
}
