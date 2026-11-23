import type { Promotion } from './promotion';
import type { Cents } from '../money';
import type { ReferenceType } from '../extract/types';

export const DAY = 24 * 60 * 60 * 1000;

export interface PricePoint {
  at: Date;
  priceCents: Cents;
  shippingCents?: Cents | null;
  inStock?: boolean;
  referenceCents?: Cents | null;
  referenceType?: ReferenceType;
  claimedDiscountPct?: number | null;
  dealLabel?: string | null;
  /** Multi-buy promotions shown with this price. */
  promotions?: Promotion[] | null;
  /** On unit points: the promotion that set this price per item, if any. */
  appliedPromotion?: Promotion | null;
}

/** Price points are stored on change only; the price holds until the next point (step function). */
export function sortPoints(points: PricePoint[]): PricePoint[] {
  return [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function pointAt(points: PricePoint[], at: Date): PricePoint | null {
  let current: PricePoint | null = null;
  for (const p of sortPoints(points)) {
    if (p.at.getTime() <= at.getTime()) current = p;
    else break;
  }
  return current;
}

export const payPrice = (p: PricePoint): Cents => p.priceCents + (p.shippingCents ?? 0);

/** Daily samples (one per day at the same time of day as `to`) of the pay price in [from, to]. */
export function dailySamples(points: PricePoint[], from: Date, to: Date): Cents[] {
  const sorted = sortPoints(points);
  const out: Cents[] = [];
  for (let t = to.getTime(); t >= from.getTime(); t -= DAY) {
    const p = pointAt(sorted, new Date(t));
    if (p) out.push(payPrice(p));
  }
  return out.reverse();
}

export function minBetween(points: PricePoint[], from: Date, to: Date): Cents | null {
  const sorted = sortPoints(points);
  let min: Cents | null = null;
  const start = pointAt(sorted, from);
  if (start) min = payPrice(start);
  for (const p of sorted) {
    const t = p.at.getTime();
    if (t > from.getTime() && t <= to.getTime())
      min = min === null ? payPrice(p) : Math.min(min, payPrice(p));
  }
  return min;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

export function medianBetween(points: PricePoint[], from: Date, to: Date): Cents | null {
  return median(dailySamples(points, from, to));
}

export function allTimeLow(points: PricePoint[]): Cents | null {
  return points.length ? Math.min(...points.map(payPrice)) : null;
}

/** Start of the current uninterrupted run of points that carry a deal label. */
export function dealLabelSince(points: PricePoint[]): Date | null {
  const sorted = sortPoints(points);
  let since: Date | null = null;
  for (const p of sorted) {
    if (p.dealLabel) since ??= p.at;
    else since = null;
  }
  return since;
}

export function trackedDays(points: PricePoint[], now: Date): number {
  const first = sortPoints(points)[0];
  return first ? Math.floor((now.getTime() - first.at.getTime()) / DAY) : 0;
}
