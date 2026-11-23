import { describe, expect, it } from 'vitest';
import { bestPromotion, combineQuantity, parsePromotion, parseQuantity } from '../src/browser';
import { storeCategoriesFor } from '../src/stores/registry';

describe('multipacks', () => {
  it.each([
    ['2 x Syoss - Max Hold - Haarspray - 300 ml - 2 stuks', 2],
    ['3 x Syoss - Max Hold - Haarspray - Grootverpakking', 3],
    ['Syoss - Max Hold - Haarspray - 300 ml - stuks', 1],
    ['Haarspray 300 ml x 2', 2],
    ['Nivea duo pack 2x250ml', 2],
    ['Voordeelverpakking van 6', 6],
    ['Samsung 4K TV 55 inch 3x HDMI', 1],
  ])('%s → %i', (title, count) => {
    expect(parseQuantity(title).packCount).toBe(count);
  });

  it('combines name, heading, URL words and a separate size field', () => {
    expect(
      combineQuantity([
        'Syoss - Max Hold - Haarspray - stuks',
        '300ml',
        '2 x syoss max hold 2 stuks',
      ]),
    ).toMatchObject({ packCount: 2, amount: 300, unit: 'ml' });
  });
});

describe('multi-buy promotions', () => {
  it.each([
    [
      'Got2b en Syoss Style 1+1 gratis',
      { kind: 'buy_get', quantity: 2, paid: 1, requires: 'none' },
    ],
    [
      'Clubactie: Syoss styling 1+2 gratis',
      { kind: 'buy_get', quantity: 3, paid: 1, requires: 'card' },
    ],
    ['2e halve prijs', { kind: 'nth_discount', quantity: 2, pct: 50 }],
    ['3 halen 2 betalen', { kind: 'buy_get', quantity: 3, paid: 2 }],
    ['2 voor € 10', { kind: 'bundle_price', quantity: 2, bundleCents: 1000 }],
  ])('%s', (text, expected) => {
    expect(parsePromotion(text)).toMatchObject(expected);
  });

  it('ignores text that is not a multi-buy deal', () => {
    expect(parsePromotion('Gratis verzending vanaf €20')).toBeNull();
  });

  it('uses card-only deals only with the card, and never one that costs more', () => {
    const promos = ['1+1 gratis', 'Clubactie 1+2 gratis', '2 voor €20']
      .map(parsePromotion)
      .filter((p) => p !== null);
    expect(bestPromotion(promos, 799, false)).toMatchObject({ unitCents: 400 });
    expect(bestPromotion(promos, 799, true)).toMatchObject({ unitCents: 266 });
    expect(bestPromotion([parsePromotion('2 voor €20')!], 799, true)).toBeNull();
  });
});

describe('store relevance', () => {
  it('picks drugstores for hair care, electronics stores for a TV, everything when unknown', () => {
    expect(storeCategoriesFor('hair care')).toContain('drugstore');
    expect(storeCategoriesFor('hair care')).not.toContain('electronics');
    expect(storeCategoriesFor('perfume')).toContain('perfumery');
    expect(storeCategoriesFor('television')).toContain('electronics');
    expect(storeCategoriesFor(null)).toBeNull();
  });
});
