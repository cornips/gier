import { describe, expect, it } from 'vitest';
import {
  adviceMode,
  blackFriday,
  canSpend,
  costUsd,
  defaultExclusions,
  detectShopFacts,
  domainOf,
  FIXED_STORES,
  fingerprintFromTitle,
  matchCandidate,
  nextCheckDelay,
  recordExclusion,
  scoreTrust,
  type Fingerprint,
  type TrustSignals,
} from '../src';

const rexona: Fingerprint = {
  title: 'Rexona Men Invisible Black + White deodorant spray 150 ml',
  brand: 'Rexona',
  line: 'Men Invisible Black White',
  form: 'spray',
  quantity: { packCount: 1, amount: 150, unit: 'ml' },
  gtin: null,
  model: null,
  locked: ['brand', 'line', 'quantity'],
  allowMultipack: true,
  compareUnit: 'piece',
  exclude: ['cadeauset', 'travel size'],
};

describe('matchCandidate', () => {
  it('matches the same product with a different title order', () => {
    expect(
      matchCandidate(rexona, {
        title: 'Rexona Men Deodorant Spray Invisible Black & White - 150ml',
      }).verdict,
    ).toBe('match');
  });
  it('accepts multipacks and reports the pack size', () => {
    const r = matchCandidate(rexona, {
      title: 'Rexona Men Invisible Black + White deospray 6 x 150 ml',
    });
    expect(r.verdict).toBe('match');
    expect(r.quantity.packCount).toBe(6);
  });
  it('rejects another size', () => {
    expect(
      matchCandidate(rexona, {
        title: 'Rexona Men Invisible Black + White deodorant spray 200 ml',
      }),
    ).toMatchObject({
      verdict: 'reject',
      reasons: ['quantity'],
    });
  });
  it('rejects excluded terms and refurbished goods', () => {
    expect(
      matchCandidate(rexona, { title: 'Rexona Men Invisible cadeauset 150 ml' }).reasons,
    ).toEqual(['excluded:cadeauset']);
    expect(
      matchCandidate(fingerprintFromTitle('Sony WH-1000XM6', 'Sony'), {
        title: 'Sony WH-1000XM6 refurbished',
      }).verdict,
    ).toBe('reject');
  });
  it('rejects another brand', () => {
    expect(matchCandidate(rexona, { title: 'Axe Black deodorant spray 150 ml' }).verdict).toBe(
      'reject',
    );
  });
  it('doubts another line of the same brand', () => {
    expect(
      matchCandidate(rexona, { title: 'Rexona Men Invisible Fresh deodorant spray 150 ml' })
        .verdict,
    ).not.toBe('match');
  });
  it('matches on model numbers', () => {
    const fp = fingerprintFromTitle('Sony WH-1000XM6 draadloze koptelefoon', 'Sony');
    expect(fp.model).toBe('WH-1000XM6');
    expect(
      matchCandidate(fp, {
        title: 'Sony WH1000XM6 Noise Cancelling Headphones zwart',
        brand: 'Sony',
      }).verdict,
    ).toBe('match');
    expect(
      matchCandidate(fp, { title: 'Sony WH-1000XM5 koptelefoon', brand: 'Sony' }).verdict,
    ).toBe('reject');
  });
  it('trusts identical GTINs', () => {
    const fp = { ...rexona, gtin: '08710447000000' };
    expect(matchCandidate(fp, { title: 'Iets anders', gtin: '8710447000000' }).verdict).toBe(
      'match',
    );
  });
});

describe('exclusion learning', () => {
  it('applies a rule after two exclusions in the same category', () => {
    let rules = recordExclusion([], 'Reisformaat', 'verzorging');
    expect(defaultExclusions(rules, 'verzorging')).toEqual([]);
    rules = recordExclusion(rules, 'reisformaat', 'verzorging');
    expect(defaultExclusions(rules, 'verzorging').map((r) => r.term)).toEqual(['reisformaat']);
    expect(defaultExclusions(rules, 'audio')).toEqual([]);
  });
});

describe('trust', () => {
  const base: TrustSignals = {
    fixedStore: false,
    previouslyTrusted: false,
    blocklisted: false,
    domainAgeDays: 4000,
    hasKvk: true,
    hasReturnPolicy: true,
    hasTrustmark: false,
    priceVsMedian: 1,
    thirdPartySeller: false,
  };
  it('trusts an established shop', () => expect(scoreTrust(base).verdict).toBe('trusted'));
  it('excludes a young domain far below the median', () => {
    const r = scoreTrust({ ...base, domainAgeDays: 19, hasKvk: false, priceVsMedian: 0.42 });
    expect(r.verdict).toBe('excluded');
    expect(r.reasons).toEqual(['young_domain', 'no_kvk', 'price_outlier']);
  });
  it('keeps fixed stores trusted, but doubts third-party sellers', () => {
    expect(scoreTrust({ ...base, fixedStore: true, domainAgeDays: null }).verdict).toBe('trusted');
    expect(scoreTrust({ ...base, fixedStore: true, thirdPartySeller: true }).verdict).toBe('doubt');
  });
  it('detects KvK numbers and return policies', () => {
    expect(detectShopFacts('KvK-nummer: 12345678 · Retourneren binnen 30 dagen')).toMatchObject({
      hasKvk: true,
      hasReturnPolicy: true,
    });
  });
});

describe('stores', () => {
  it('has 38 fixed stores with unique names', () => {
    expect(FIXED_STORES).toHaveLength(38);
    expect(new Set(FIXED_STORES.map((s) => s.name)).size).toBe(38);
  });
  it('extracts registrable domains', () => {
    expect(domainOf('https://www.bol.com/nl/p/x')).toBe('bol.com');
    expect(domainOf('https://shop.example.co.uk/a')).toBe('example.co.uk');
  });
});

describe('AI costs (ADR-009)', () => {
  it('prices Claude Haiku 5.5 calls', () => {
    expect(costUsd('claude-haiku-5-5', 3_400, 420)).toBeCloseTo(0.00055, 6);
    expect(costUsd('claude-haiku-5-5', 120_000, 1_000)).toBeCloseTo(0.0625, 6);
  });
  it('enforces budgets', () => {
    expect(
      canSpend({ tier: 'none', productSpentThisMonthEur: 0, globalSpentThisMonthEur: 0 }, 0.001),
    ).toEqual({
      allowed: false,
      reason: 'tier_none',
    });
    expect(
      canSpend(
        { tier: 'frugal', productSpentThisMonthEur: 0.049, globalSpentThisMonthEur: 0 },
        0.002,
      ).allowed,
    ).toBe(false);
    expect(
      canSpend(
        { tier: 'normal', productSpentThisMonthEur: 0, globalSpentThisMonthEur: 1.999 },
        0.002,
      ),
    ).toEqual({
      allowed: false,
      reason: 'global_cap',
    });
    expect(
      canSpend(
        { tier: 'frugal', productSpentThisMonthEur: 0.01, globalSpentThisMonthEur: 0.1 },
        0.001,
      ).allowed,
    ).toBe(true);
  });
  it('switches advice to on-request when it gets expensive', () => {
    expect(adviceMode('auto', 'frugal', 0.0005)).toBe('auto');
    expect(adviceMode('auto', 'frugal', 0.03)).toBe('on_request');
    expect(adviceMode('auto', 'none', 0.0005)).toBe('off');
  });
});

describe('schedule', () => {
  it('computes Black Friday', () => {
    expect(blackFriday(2026).toISOString().slice(0, 10)).toBe('2026-11-27');
    expect(blackFriday(2027).toISOString().slice(0, 10)).toBe('2027-11-26');
  });
  it('checks more often around sales and deal labels', () => {
    const quiet = nextCheckDelay({
      now: new Date('2026-06-10T10:00:00Z'),
      hasDealLabel: false,
      recentChanges: 0,
      failStreak: 0,
    });
    const busy = nextCheckDelay({
      now: new Date('2026-11-25T10:00:00Z'),
      hasDealLabel: false,
      recentChanges: 0,
      failStreak: 0,
    });
    expect(quiet).toBeGreaterThan(10 * 3600_000);
    expect(busy).toBeLessThan(5 * 3600_000);
  });
});

describe('monthly estimate', () => {
  it('stays well below the tier caps with Haiku', async () => {
    const { estimateMonthlyUsd, TIER_CAP_EUR } = await import('../src/costs/ai');
    expect(estimateMonthlyUsd('none')).toBe(0);
    expect(estimateMonthlyUsd('frugal')).toBeLessThan(TIER_CAP_EUR.frugal);
    expect(estimateMonthlyUsd('generous')).toBeGreaterThan(estimateMonthlyUsd('normal'));
  });
});
