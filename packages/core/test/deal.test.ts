import { describe, expect, it } from 'vitest';
import { DAY, productVerdict, runChecks, type PricePoint } from '../src';

const now = new Date('2026-11-27T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);
const p = (d: number, euro: number, extra: Partial<PricePoint> = {}): PricePoint => ({
  at: daysAgo(d),
  priceCents: Math.round(euro * 100),
  ...extra,
});
const codes = (f: { code: string }[]) => f.map((x) => x.code).sort();

/*
 * Scenarios based on the examples in the Consumentenbond's 2026 research into fake Black Friday deals.
 * The price histories around those examples are simplified.
 */
describe('fake discount checks (ADR-010)', () => {
  it('flags a price raised just before a "discount" against a list price (Playmobil example)', () => {
    const points = [
      p(120, 51.79),
      p(37, 59.99, {
        referenceCents: 8499,
        referenceType: 'list',
        claimedDiscountPct: 29,
        dealLabel: 'Black Friday-deal',
      }),
    ];
    const f = runChecks({
      storeName: 'Amazon.nl',
      points,
      others: [{ storeName: 'bol', points: [p(120, 54.99)] }],
      now,
    });
    expect(codes(f)).toEqual(
      [
        'endless_sale',
        'inflated_percentage',
        'label_without_drop',
        'raised_before_sale',
        'unused_list_price',
        'cheaper_elsewhere',
      ].sort(),
    );
    const raised = f.find((x) => x.code === 'raised_before_sale')!;
    expect(raised.evidence.diff).toBe(820);
  });

  it('flags an inflated percentage (airfryer example: 30% claimed, about 5% real)', () => {
    const points = [
      p(90, 66),
      p(2, 62.7, { referenceCents: 9000, referenceType: 'list', claimedDiscountPct: 30 }),
    ];
    const f = runChecks({ storeName: 'Amazon.nl', points, others: [], now });
    const inflated = f.find((x) => x.code === 'inflated_percentage')!;
    expect(inflated.evidence).toMatchObject({ claimed: 30, real: 5 });
    expect(codes(f)).toContain('unused_list_price');
  });

  it('flags a false "usually" price (TV example: meestal € 429, really € 399)', () => {
    const points = [
      p(60, 399),
      p(1, 389, {
        referenceCents: 42900,
        referenceType: 'usual',
        claimedDiscountPct: 9,
        dealLabel: 'Deal',
      }),
    ];
    const f = runChecks({ storeName: 'bol', points, others: [], now });
    expect(codes(f)).toEqual(['false_usual_price', 'inflated_percentage']);
    expect(f.find((x) => x.code === 'false_usual_price')!.evidence.median).toBe(39900);
  });

  it('flags an inflated was-price under the 30-day rule', () => {
    const points = [
      p(80, 449),
      p(40, 369),
      p(3, 349, { referenceCents: 44900, referenceType: 'was' }),
    ];
    const f = runChecks({ storeName: 'MediaMarkt', points, others: [], now });
    expect(codes(f)).toContain('inflated_was_price');
    expect(f.find((x) => x.code === 'inflated_was_price')!.evidence.low30).toBe(36900);
  });

  it('flags a deal label without a price drop', () => {
    const points = [p(60, 249), p(10, 239), p(2, 249, { dealLabel: 'Onweerstaanbieding' })];
    const f = runChecks({ storeName: 'Coolblue', points, others: [], now });
    expect(codes(f)).toEqual(['label_without_drop', 'raised_before_sale']);
  });

  it('accepts a genuine discount', () => {
    const points = [
      p(90, 449),
      p(5, 349, {
        referenceCents: 44900,
        referenceType: 'was',
        claimedDiscountPct: 22,
        dealLabel: 'Deal',
      }),
    ];
    const f = runChecks({
      storeName: 'Coolblue',
      points,
      others: [{ storeName: 'bol', points: [p(90, 449)] }],
      now,
    });
    expect(f).toEqual([]);
  });

  it('reports insufficient history instead of guessing', () => {
    const points = [
      p(10, 59.99, { referenceCents: 8499, referenceType: 'list', claimedDiscountPct: 29 }),
    ];
    const f = runChecks({ storeName: 'Amazon.nl', points, others: [], now });
    expect(codes(f)).toEqual(['insufficient_history', 'unused_list_price']);
  });
});

describe('productVerdict', () => {
  const listings = [
    { storeName: 'Coolblue', points: [p(250, 459), p(220, 449), p(40, 379), p(4, 349)] },
    { storeName: 'bol', points: [p(250, 449), p(100, 409), p(20, 359)] },
  ];
  it('labels the lowest ever price a topdeal', () => {
    const v = productVerdict(listings, now);
    expect(v).toMatchObject({
      label: 'topdeal',
      currentLowest: 34900,
      currentStore: 'Coolblue',
      allTimeLow: 34900,
    });
    expect(v.trackedDays).toBeGreaterThan(200);
  });
  it('applies a store preference threshold (Amazon only when clearly cheaper)', () => {
    const v = productVerdict(
      [
        { storeName: 'Amazon.nl', points: [p(60, 339)], preferencePenaltyPct: 5 },
        { storeName: 'Coolblue', points: [p(60, 349)] },
      ],
      now,
    );
    expect(v).toMatchObject({ currentStore: 'Coolblue', currentLowest: 34900 });
  });
  it('needs 30 days of history', () => {
    expect(productVerdict([{ storeName: 'x', points: [p(5, 10)] }], now).label).toBe(
      'insufficient_history',
    );
  });
});
