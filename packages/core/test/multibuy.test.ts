import { describe, expect, it } from 'vitest';
import {
  bestPromotion,
  combineQuantity,
  parsePromotion,
  parseQuantity,
  promotionKey,
  usablePromotions,
} from '../src/browser';
import { extractOffer } from '../src/extract/extract';
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

describe('where a promotion came from', () => {
  const page = (promo: string) =>
    `<script type="application/ld+json">{"@type":"Product","name":"Deo","offers":{"price":"3.99","priceCurrency":"EUR"}}</script>
     <div class="buy-block"><span class="promo-label">${promo}</span> bij 3 stuks</div>`;

  it('records the source and the text around it', () => {
    const [scanned] = extractOffer(page('2 + 1 gratis'), 'https://shop.nl/p').promotions;
    expect(scanned).toMatchObject({
      kind: 'buy_get',
      source: 'page',
      context: '2 + 1 gratis bij 3 stuks',
    });
    const [selected] = extractOffer(page('1+1 gratis'), 'https://shop.nl/p', {
      promotion: '.promo-label',
    }).promotions;
    expect(selected).toMatchObject({ source: 'selector' });
  });

  it('counts only selector promotions on marketplaces, and never dismissed ones', () => {
    const scanned = parsePromotion('2 + 1 gratis')!;
    const selected = { ...parsePromotion('1+1 gratis')!, source: 'selector' as const };
    const legacy = parsePromotion('3 + 1 gratis')!;
    const both = [{ ...scanned, source: 'page' as const }, selected, legacy];
    expect(usablePromotions(both, { marketplace: false })).toHaveLength(3);
    expect(usablePromotions(both, { marketplace: true })).toEqual([selected]);
    expect(
      usablePromotions(both, { marketplace: false, dismissed: [promotionKey(legacy)] }),
    ).toHaveLength(2);
    expect(
      usablePromotions([selected], { marketplace: true, dismissed: [promotionKey(selected)] }),
    ).toBeNull();
  });
});
