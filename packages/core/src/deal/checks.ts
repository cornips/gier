import type { Cents } from '../money';
import {
  DAY,
  dealLabelSince,
  medianBetween,
  minBetween,
  payPrice,
  pointAt,
  sortPoints,
  trackedDays,
  type PricePoint,
} from './history';

/**
 * Fake-discount checks from ADR-010. Every finding carries evidence from Gier's own observations;
 * shop claims are never trusted on their own.
 */
export type CheckCode =
  | 'raised_before_sale'
  | 'inflated_percentage'
  | 'unused_list_price'
  | 'false_usual_price'
  | 'inflated_was_price'
  | 'label_without_drop'
  | 'endless_sale'
  | 'cheaper_elsewhere'
  | 'insufficient_history';

export interface Finding {
  code: CheckCode;
  /** Values for the UI string, all money in cents. */
  evidence: Record<string, number | string>;
}

export interface OtherListing {
  storeName: string;
  points: PricePoint[];
}

export interface CheckInput {
  storeName: string;
  points: PricePoint[];
  /** All other followed listings for the same product, used for list-price and cheaper-elsewhere checks. */
  others: OtherListing[];
  now: Date;
}

export const THRESHOLDS = {
  minHistoryDays: 30,
  raisedLookbackDays: 14,
  percentageTolerancePts: 5,
  listPriceLookbackDays: 90,
  usualPriceLookbackDays: 30,
  wasPriceLookbackDays: 30,
  labelLookbackDays: 7,
  endlessSaleDays: 30,
  cheaperElsewhereMinCents: 100,
} as const;

const before = (d: Date, days: number) => new Date(d.getTime() - days * DAY);

export function runChecks(input: CheckInput): Finding[] {
  const { now } = input;
  const points = sortPoints(input.points);
  const current = pointAt(points, now);
  if (!current) return [];
  const findings: Finding[] = [];
  const pay = payPrice(current);
  const days = trackedDays(points, now);
  const enoughHistory = days >= THRESHOLDS.minHistoryDays;

  const hasClaim = Boolean(
    current.dealLabel || current.referenceCents || current.claimedDiscountPct,
  );
  if (hasClaim && !enoughHistory) {
    findings.push({
      code: 'insufficient_history',
      evidence: { days, needed: THRESHOLDS.minHistoryDays },
    });
  }

  const labelSince = current.dealLabel ? (dealLabelSince(points) ?? current.at) : null;
  const saleStart = labelSince ?? (current.referenceCents ? current.at : null);

  // 1. Raised before the sale: the sale price is higher than what this shop asked shortly before it.
  if (saleStart && enoughHistory) {
    const low = minBetween(
      points,
      before(saleStart, THRESHOLDS.raisedLookbackDays),
      new Date(saleStart.getTime() - 1),
    );
    if (low !== null && pay > low) {
      findings.push({
        code: 'raised_before_sale',
        evidence: { before: low, now: pay, diff: pay - low },
      });
    }
  }

  // Reference low used by checks 2 and 5: lowest price in the 30 days before the sale started.
  const refStart = saleStart ?? current.at;
  const low30 = enoughHistory
    ? minBetween(
        points,
        before(refStart, THRESHOLDS.wasPriceLookbackDays),
        new Date(refStart.getTime() - 1),
      )
    : null;

  // 2. Inflated percentage: claimed discount vs. the real drop from the 30-day low.
  if (current.claimedDiscountPct != null && low30 !== null && low30 > 0) {
    const real = Math.round((1 - pay / low30) * 100);
    if (current.claimedDiscountPct - real > THRESHOLDS.percentageTolerancePts) {
      findings.push({
        code: 'inflated_percentage',
        evidence: { claimed: current.claimedDiscountPct, real: Math.max(real, 0), low30 },
      });
    }
  }

  // 3. List price nobody charges: no followed shop asked that much in the last 90 days.
  if (current.referenceType === 'list' && current.referenceCents) {
    const from = before(now, THRESHOLDS.listPriceLookbackDays);
    const all = [points, ...input.others.map((o) => o.points)];
    const highest = Math.max(
      ...all.map((p) => {
        const inRange = p.filter((x) => x.at >= from && x.at <= now).map((x) => x.priceCents);
        const start = pointAt(p, from);
        return Math.max(0, ...inRange, start ? start.priceCents : 0);
      }),
    );
    if (current.referenceCents > highest) {
      findings.push({
        code: 'unused_list_price',
        evidence: { listPrice: current.referenceCents, highestSeen: highest },
      });
    }
  }

  // 4. False "usually" price: claimed usual price above the 30-day median at this shop.
  if (current.referenceType === 'usual' && current.referenceCents && enoughHistory) {
    const med = medianBetween(
      points,
      before(refStart, THRESHOLDS.usualPriceLookbackDays),
      new Date(refStart.getTime() - 1),
    );
    if (med !== null && current.referenceCents > med) {
      findings.push({
        code: 'false_usual_price',
        evidence: { claimed: current.referenceCents, median: med },
      });
    }
  }

  // 5. Inflated was-price (ACM 30-day rule).
  if (
    current.referenceType === 'was' &&
    current.referenceCents &&
    low30 !== null &&
    current.referenceCents > low30
  ) {
    findings.push({
      code: 'inflated_was_price',
      evidence: { wasPrice: current.referenceCents, low30 },
    });
  }

  // 6. Deal label without a drop compared with the previous week.
  if (current.dealLabel && labelSince) {
    const lowWeek = minBetween(
      points,
      before(labelSince, THRESHOLDS.labelLookbackDays),
      new Date(labelSince.getTime() - 1),
    );
    const hadHistory = points.some((p) => p.at < labelSince);
    if (hadHistory && lowWeek !== null && pay >= lowWeek) {
      findings.push({
        code: 'label_without_drop',
        evidence: { label: current.dealLabel, lowWeek, now: pay },
      });
    }
  }

  // 7. Endless sale.
  if (labelSince) {
    const running = Math.floor((now.getTime() - labelSince.getTime()) / DAY);
    if (running > THRESHOLDS.endlessSaleDays) {
      findings.push({ code: 'endless_sale', evidence: { days: running } });
    }
  }

  // 8. Cheaper elsewhere among followed, in-stock listings.
  let cheapest: { store: string; price: Cents } | null = null;
  for (const other of input.others) {
    const p = pointAt(other.points, now);
    if (!p || p.inStock === false) continue;
    const price = payPrice(p);
    if (!cheapest || price < cheapest.price) cheapest = { store: other.storeName, price };
  }
  if (cheapest && pay - cheapest.price >= THRESHOLDS.cheaperElsewhereMinCents) {
    findings.push({
      code: 'cheaper_elsewhere',
      evidence: { store: cheapest.store, price: cheapest.price, diff: pay - cheapest.price },
    });
  }

  return findings;
}

export const isFakeDiscount = (findings: Finding[]) =>
  findings.some((f) =>
    [
      'raised_before_sale',
      'inflated_percentage',
      'unused_list_price',
      'false_usual_price',
      'inflated_was_price',
      'label_without_drop',
    ].includes(f.code),
  );
