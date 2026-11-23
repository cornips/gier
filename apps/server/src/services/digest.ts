import { eq, isNull } from 'drizzle-orm';
import { products, settings } from '@gier/db';
import type { Ctx } from '../context';
import { notify } from './notify';
import { productSummary } from './products';
import { spentThisMonthEur } from './ai';
import { translator } from '../i18n';

const KEY = 'digest.lastSentAt';
const WEEK = 7 * 86_400_000;

/** Sunday 10:00 in Europe/Amsterdam, or later that day if the server was down. */
export function digestDue(now: Date, lastSentAt: number | null): boolean {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      hour: 'numeric',
      hour12: false,
      timeZone: 'Europe/Amsterdam',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  if (parts.weekday !== 'Sun' || Number(parts.hour) < 10) return false;
  return lastSentAt === null || now.getTime() - lastSentAt > WEEK - 86_400_000;
}

/** F17: one weekly summary of what moved, instead of many small pings. */
export async function sendDigestIfDue(ctx: Ctx): Promise<boolean> {
  const now = ctx.now();
  const row = ctx.db.select().from(settings).where(eq(settings.key, KEY)).get();
  const last = typeof row?.value === 'number' ? row.value : null;
  if (!digestDue(now, last)) return false;

  const summaries = ctx.db
    .select()
    .from(products)
    .where(isNull(products.archivedAt))
    .all()
    .map((p) => productSummary(ctx, p));
  if (!summaries.length) return false;

  const deals = summaries.filter((s) => s.label === 'topdeal' || s.label === 'good');
  const lows = summaries.filter(
    (s) => s.lowestCents != null && s.allTimeLow != null && s.lowestCents <= s.allTimeLow,
  );
  const fakes = summaries.reduce((n, s) => n + s.fakeDiscounts, 0);
  const { t, money } = translator(ctx);
  const lines = [
    ...deals.slice(0, 5).map((s) =>
      t('digest.deal', {
        product: s.name,
        price: money(s.lowestCents),
        store: s.lowestStore ?? '',
      }),
    ),
    lows.length ? t('digest.lows', { count: lows.length }) : '',
    fakes ? t('digest.fakes', { count: fakes }) : '',
    t('digest.ai', { cost: money(Math.round(spentThisMonthEur(ctx) * 100)) }),
  ].filter(Boolean);

  await notify(ctx, {
    kind: 'digest',
    title: deals.length ? t('digest.title.deals', { count: deals.length }) : t('digest.title.none'),
    body: lines.join('\n'),
  });
  ctx.db
    .insert(settings)
    .values({ key: KEY, value: now.getTime() })
    .onConflictDoUpdate({ target: settings.key, set: { value: now.getTime() } })
    .run();
  return true;
}
