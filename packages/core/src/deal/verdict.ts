import type { Cents } from '../money';
import {
  DAY,
  allTimeLow,
  medianBetween,
  minBetween,
  payPrice,
  pointAt,
  trackedDays,
  type PricePoint,
} from './history';

export type DealLabel = 'topdeal' | 'good' | 'normal' | 'expensive' | 'insufficient_history';

export interface ProductVerdict {
  label: DealLabel;
  currentLowest: Cents | null;
  currentStore: string | null;
  low30: Cents | null;
  median90: Cents | null;
  allTimeLow: Cents | null;
  trackedDays: number;
}

export interface ListingSeries {
  storeName: string;
  points: PricePoint[];
  /**
   * Store preference (ADR-013): this listing only counts as cheapest when it beats the others by this
   * percentage, e.g. Amazon with 5%. Reported prices stay real.
   */
  preferencePenaltyPct?: number;
}

const effective = (price: Cents, l: ListingSeries) =>
  price * (1 + (l.preferencePenaltyPct ?? 0) / 100);

/** Lowest pay price across listings per day: the "laagste prijs" series shown in charts. */
export function lowestSeries(listings: ListingSeries[], from: Date, to: Date): PricePoint[] {
  const out: PricePoint[] = [];
  let prev: Cents | null = null;
  for (let t = from.getTime(); t <= to.getTime(); t += DAY) {
    let low: Cents | null = null;
    let lowEff = Infinity;
    for (const l of listings) {
      const p = pointAt(l.points, new Date(t));
      if (p && p.inStock !== false && effective(payPrice(p), l) < lowEff) {
        lowEff = effective(payPrice(p), l);
        low = payPrice(p);
      }
    }
    if (low !== null && low !== prev) {
      out.push({ at: new Date(t), priceCents: low });
      prev = low;
    }
  }
  return out;
}

export function productVerdict(listings: ListingSeries[], now: Date): ProductVerdict {
  let currentLowest: Cents | null = null;
  let currentStore: string | null = null;
  let bestEff = Infinity;
  for (const l of listings) {
    const p = pointAt(l.points, now);
    if (!p || p.inStock === false) continue;
    const price = payPrice(p);
    if (effective(price, l) < bestEff) {
      bestEff = effective(price, l);
      currentLowest = price;
      currentStore = l.storeName;
    }
  }
  const first = Math.min(
    ...listings.flatMap((l) => l.points.map((p) => p.at.getTime())),
    now.getTime(),
  );
  const series = lowestSeries(listings, new Date(first), now);
  const days = trackedDays(series, now);
  const low30 = minBetween(series, new Date(now.getTime() - 30 * DAY), now);
  const median90 = medianBetween(series, new Date(now.getTime() - 90 * DAY), now);
  const atl = allTimeLow(series);

  let label: DealLabel = 'insufficient_history';
  if (currentLowest !== null && days >= 30 && median90 !== null && atl !== null) {
    if (currentLowest <= atl) label = 'topdeal';
    else if (currentLowest < median90) label = 'good';
    else if (currentLowest > median90 * 1.05) label = 'expensive';
    else label = 'normal';
  }
  return {
    label,
    currentLowest,
    currentStore,
    low30,
    median90,
    allTimeLow: atl,
    trackedDays: days,
  };
}
