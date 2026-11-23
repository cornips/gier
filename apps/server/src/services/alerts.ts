import { and, eq } from 'drizzle-orm';
import { isFakeDiscount, type Finding } from '@gier/core';
import { alerts, products } from '@gier/db';
import type { Ctx } from '../context';
import { notify } from './notify';
import { translator } from '../i18n';

export interface PriceEvent {
  productId: number;
  storeName: string;
  previousLowest: number | null;
  newLowest: number | null;
  allTimeLowBefore: number | null;
  backInStock: boolean;
  findings: Finding[];
  previousFindings: Finding[];
}

const COOLDOWN_MS = 12 * 3600_000;

/** Evaluates a product's alert rules after a price change and sends notifications (F11). */
export async function evaluateAlerts(ctx: Ctx, e: PriceEvent): Promise<number> {
  const product = ctx.db.select().from(products).where(eq(products.id, e.productId)).get();
  if (!product) return 0;
  const rules = ctx.db
    .select()
    .from(alerts)
    .where(and(eq(alerts.productId, e.productId), eq(alerts.active, true)))
    .all();
  const now = ctx.now();
  let sent = 0;
  const lowest = e.newLowest;
  const { t, money: fmt } = translator(ctx);

  for (const rule of rules) {
    if (
      rule.lastFiredAt &&
      now.getTime() - rule.lastFiredAt.getTime() < COOLDOWN_MS &&
      rule.kind !== 'any_change'
    )
      continue;
    let message: {
      title: string;
      body: string;
      kind: 'deal' | 'fake' | 'store' | 'warning';
      urgent?: boolean;
    } | null = null;

    switch (rule.kind) {
      case 'below':
        if (
          lowest !== null &&
          rule.thresholdCents !== null &&
          lowest <= rule.thresholdCents &&
          (e.previousLowest === null || e.previousLowest > rule.thresholdCents)
        ) {
          message = {
            kind: 'deal',
            title: t('alert.below.title', { product: product.name }),
            body: t('alert.below.body', {
              store: e.storeName,
              price: fmt(lowest),
              target: fmt(rule.thresholdCents),
            }),
          };
        }
        break;
      case 'above':
        if (
          lowest !== null &&
          rule.thresholdCents !== null &&
          lowest >= rule.thresholdCents &&
          (e.previousLowest === null || e.previousLowest < rule.thresholdCents)
        ) {
          message = {
            kind: 'warning',
            title: t('alert.above.title', {
              threshold: fmt(rule.thresholdCents),
              product: product.name,
            }),
            body: t('alert.above.body', { price: fmt(lowest) }),
          };
        }
        break;
      case 'any_change':
        if (lowest !== e.previousLowest) {
          message = {
            kind: 'deal',
            title: t('alert.change.title', { product: product.name }),
            body: t('alert.change.body', {
              from: fmt(e.previousLowest),
              to: fmt(lowest),
              store: e.storeName,
            }),
          };
        }
        break;
      case 'drop_percent':
        if (
          lowest !== null &&
          e.previousLowest &&
          rule.percent &&
          ((e.previousLowest - lowest) / e.previousLowest) * 100 >= rule.percent
        ) {
          message = {
            kind: 'deal',
            title: t('alert.drop.title', {
              percent: Math.round((1 - lowest / e.previousLowest) * 100),
              product: product.name,
            }),
            body: t('alert.change.body', {
              from: fmt(e.previousLowest),
              to: fmt(lowest),
              store: e.storeName,
            }),
          };
        }
        break;
      case 'all_time_low':
        if (lowest !== null && e.allTimeLowBefore !== null && lowest < e.allTimeLowBefore) {
          message = {
            kind: 'deal',
            urgent: true,
            title: t('alert.low.title', { product: product.name }),
            body: t('alert.low.body', { store: e.storeName, price: fmt(lowest) }),
          };
        }
        break;
      case 'back_in_stock':
        if (e.backInStock)
          message = {
            kind: 'store',
            title: t('alert.stock.title', { product: product.name }),
            body: t('alert.stock.body', { store: e.storeName }),
          };
        break;
      case 'fake_discount':
        if (isFakeDiscount(e.findings) && !isFakeDiscount(e.previousFindings)) {
          message = {
            kind: 'fake',
            title: t('alert.fake.title', { product: product.name }),
            body: t('alert.fake.body', { store: e.storeName }),
          };
        }
        break;
      case 'new_store':
        break; // fired by discovery
    }

    if (message) {
      await notify(ctx, {
        productId: product.id,
        kind: message.kind,
        title: message.title,
        body: message.body,
        urgent: message.urgent,
      });
      ctx.db.update(alerts).set({ lastFiredAt: now }).where(eq(alerts.id, rule.id)).run();
      sent += 1;
    }
  }
  return sent;
}

/** Default alerts for a new product (wizard step 3 can change them). */
export function createDefaultAlerts(ctx: Ctx, productId: number, targetPriceCents: number | null) {
  const values: (typeof alerts.$inferInsert)[] = [
    { productId, kind: 'all_time_low' },
    { productId, kind: 'new_store' },
    { productId, kind: 'fake_discount' },
  ];
  if (targetPriceCents) values.push({ productId, kind: 'below', thresholdCents: targetPriceCents });
  ctx.db.insert(alerts).values(values).run();
}
