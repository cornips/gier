import { describe, expect, it } from 'vitest';
import { extractOffer } from '../src';

// Synthetic fixtures modelled on common shop markup patterns. They are not copies of real pages.
const jsonLd = (data: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

describe('extractOffer – JSON-LD', () => {
  it('reads a plain Product with Offer', () => {
    const html = `<html><head>${jsonLd({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Sony WH-1000XM6',
      brand: { '@type': 'Brand', name: 'Sony' },
      gtin13: '4548736000000',
      offers: {
        '@type': 'Offer',
        price: '349.00',
        priceCurrency: 'EUR',
        availability: 'https://schema.org/InStock',
        seller: { '@type': 'Organization', name: 'Coolblue' },
      },
    })}</head><body></body></html>`;
    const o = extractOffer(html, 'https://www.coolblue.nl/product/1');
    expect(o).toMatchObject({
      name: 'Sony WH-1000XM6',
      brand: 'Sony',
      gtin: '4548736000000',
      priceCents: 34900,
      currency: 'EUR',
      availability: 'in_stock',
      sellerName: 'Coolblue',
      method: 'jsonld',
      referenceType: 'none',
    });
  });

  it('reads a strikethrough price specification and @graph', () => {
    const html = jsonLd({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: 'x' },
        {
          '@type': 'Product',
          name: 'Tefal airfryer',
          offers: {
            '@type': 'Offer',
            priceCurrency: 'EUR',
            priceSpecification: [
              { '@type': 'UnitPriceSpecification', price: 62.7, priceCurrency: 'EUR' },
              {
                '@type': 'UnitPriceSpecification',
                price: 90,
                priceType: 'https://schema.org/ListPrice',
              },
            ],
          },
        },
      ],
    });
    const o = extractOffer(html, 'https://shop.example/p');
    expect(o.priceCents).toBe(6270);
    expect(o.referenceCents).toBe(9000);
    expect(o.referenceType).toBe('list');
    expect(o.claimedDiscountPct).toBe(30);
  });

  it('takes the lowest in-stock offer of an AggregateOffer', () => {
    const html = jsonLd({
      '@type': 'Product',
      name: 'Deo',
      offers: {
        '@type': 'AggregateOffer',
        offers: [
          { '@type': 'Offer', price: '4.49', priceCurrency: 'EUR', availability: 'InStock' },
          { '@type': 'Offer', price: '3.95', priceCurrency: 'EUR', availability: 'InStock' },
        ],
      },
    });
    expect(extractOffer(html, 'https://x.nl').priceCents).toBe(395);
  });

  it('tolerates trailing commas in JSON-LD', () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"A","offers":{"@type":"Offer","price":"10.00","priceCurrency":"EUR",},}</script>`;
    expect(extractOffer(html, 'https://x.nl').priceCents).toBe(1000);
  });

  it('ignores non-euro prices', () => {
    const html = jsonLd({
      '@type': 'Product',
      name: 'A',
      offers: { '@type': 'Offer', price: '10', priceCurrency: 'USD' },
    });
    expect(extractOffer(html, 'https://x.com').priceCents).toBeNull();
  });
});

describe('extractOffer – microdata, selectors and heuristics', () => {
  it('reads microdata', () => {
    const html = `<div itemscope itemtype="https://schema.org/Product">
      <h1 itemprop="name">Philips Hue starterkit</h1>
      <meta itemprop="gtin13" content="8719514342000">
      <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
        <meta itemprop="price" content="149.99"><meta itemprop="priceCurrency" content="EUR">
        <link itemprop="availability" href="https://schema.org/LimitedAvailability">
      </div></div>`;
    const o = extractOffer(html, 'https://x.nl');
    expect(o).toMatchObject({
      name: 'Philips Hue starterkit',
      priceCents: 14999,
      availability: 'limited',
      method: 'microdata',
    });
  });

  it('finds a was-price, percentage badge and deal label in markup', () => {
    const html = `${jsonLd({ '@type': 'Product', name: 'TV', offers: { '@type': 'Offer', price: '389', priceCurrency: 'EUR' } })}
      <div class="price-block"><span class="sales-price">389,-</span>
        <span class="usual-price">Meestal <del>429,-</del></span></div>
      <span class="badge badge--deal">Black Friday deal</span>
      <span class="discount-label">-9%</span>`;
    const o = extractOffer(html, 'https://www.bol.com/nl/p/1');
    expect(o.referenceCents).toBe(42900);
    expect(o.referenceType).toBe('usual');
    expect(o.dealLabel).toBe('Black Friday deal');
    expect(o.claimedDiscountPct).toBe(9);
  });

  it('applies store selectors', () => {
    const html = `<h1 class="t">Weber kettle</h1><div class="p">€ 219,-</div><s class="o">€ 259,-</s><b class="d">Dagdeal</b>`;
    const o = extractOffer(html, 'https://shop.nl', {
      name: '.t',
      price: '.p',
      referencePrice: '.o',
      referenceType: 'was',
      dealLabel: '.d',
    });
    expect(o).toMatchObject({
      name: 'Weber kettle',
      priceCents: 21900,
      referenceCents: 25900,
      dealLabel: 'Dagdeal',
      method: 'selector',
    });
  });
});
