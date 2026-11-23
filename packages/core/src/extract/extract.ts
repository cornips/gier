import { load, type CheerioAPI } from 'cheerio';
import { parsePrice, type Cents } from '../money';
import type { Availability, ExtractedOffer, ReferenceType, SelectorConfig } from './types';

type Json = Record<string, unknown>;

const asArray = <T>(v: T | T[] | undefined | null): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];
const str = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && 'name' in v) return str((v as Json).name);
  return null;
};
const isType = (node: Json, type: string) =>
  asArray(node['@type'] as string | string[]).some(
    (t) => typeof t === 'string' && t.toLowerCase() === type.toLowerCase(),
  );

function collectNodes(value: unknown, out: Json[] = []): Json[] {
  if (Array.isArray(value)) {
    for (const v of value) collectNodes(v, out);
  } else if (value && typeof value === 'object') {
    const node = value as Json;
    out.push(node);
    if (node['@graph']) collectNodes(node['@graph'], out);
    if (node.hasVariant) collectNodes(node.hasVariant, out);
  }
  return out;
}

function parseJsonLd($: CheerioAPI): Json[] {
  const nodes: Json[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      collectNodes(JSON.parse(raw), nodes);
    } catch {
      // Some shops ship invalid JSON-LD (trailing commas, comments). Try a lenient cleanup once.
      try {
        collectNodes(
          JSON.parse(raw.replace(/,\s*([}\]])/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '')),
          nodes,
        );
      } catch {
        /* ignore */
      }
    }
  });
  return nodes;
}

export function mapAvailability(value: string | null | undefined): Availability {
  if (!value) return 'unknown';
  const v = value.toLowerCase();
  if (
    v.includes('outofstock') ||
    v.includes('soldout') ||
    v.includes('discontinued') ||
    v.includes('uitverkocht')
  )
    return 'out_of_stock';
  if (v.includes('limited')) return 'limited';
  if (v.includes('preorder') || v.includes('presale')) return 'preorder';
  if (
    v.includes('instock') ||
    v.includes('onlineonly') ||
    v.includes('instoreonly') ||
    v.includes('op voorraad')
  )
    return 'in_stock';
  return 'unknown';
}

interface OfferPick {
  price: Cents | null;
  currency: string | null;
  availability: Availability;
  seller: string | null;
  shipping: Cents | null;
  reference: Cents | null;
  referenceType: ReferenceType;
}

function priceTypeToReference(priceType: string | null): ReferenceType | null {
  if (!priceType) return null;
  const t = priceType.toLowerCase();
  if (t.includes('strikethrough')) return 'was';
  if (t.includes('listprice') || t.includes('msrp') || t.includes('srp')) return 'list';
  return null;
}

function pickOffer(offers: Json[]): OfferPick | null {
  let best: OfferPick | null = null;
  for (const offer of offers) {
    const specs = asArray(offer.priceSpecification as Json | Json[]);
    let price = parsePrice(str(offer.price) ?? str(offer.lowPrice));
    let reference: Cents | null = null;
    let referenceType: ReferenceType = 'none';
    for (const spec of specs) {
      const kind = priceTypeToReference(str(spec.priceType));
      const value = parsePrice(str(spec.price));
      if (kind && value) {
        reference = value;
        referenceType = kind;
      } else if (!kind && value && price === null) {
        price = value;
      }
    }
    if (price === null) continue;
    const shippingSpec = asArray(offer.shippingDetails as Json | Json[])[0];
    const shippingRate = shippingSpec ? (shippingSpec.shippingRate as Json | undefined) : undefined;
    const pick: OfferPick = {
      price,
      currency: str(offer.priceCurrency) ?? (specs[0] ? str(specs[0].priceCurrency) : null),
      availability: mapAvailability(str(offer.availability)),
      seller: str(offer.seller),
      shipping: shippingRate ? parsePrice(str(shippingRate.value)) : null,
      reference,
      referenceType,
    };
    if (!best || (pick.price! < best.price! && pick.availability !== 'out_of_stock')) best = pick;
  }
  return best;
}

function fromJsonLd($: CheerioAPI): Partial<ExtractedOffer> | null {
  const nodes = parseJsonLd($);
  const products = nodes.filter((n) => isType(n, 'Product') || isType(n, 'ProductGroup'));
  for (const product of products) {
    const offers = asArray(product.offers as Json | Json[]).flatMap((o) =>
      isType(o, 'AggregateOffer') && o.offers ? asArray(o.offers as Json | Json[]) : [o],
    );
    const offer = pickOffer(offers);
    if (!offer) continue;
    const gtin =
      str(product.gtin13) ??
      str(product.gtin) ??
      str(product.gtin14) ??
      str(product.gtin12) ??
      str(product.gtin8);
    return {
      name: str(product.name),
      brand: str(product.brand),
      gtin: gtin ? gtin.replace(/\D/g, '') || null : null,
      mpn: str(product.mpn),
      sku: str(product.sku),
      image: str(asArray(product.image as string | string[])[0]),
      priceCents: offer.price,
      currency: offer.currency,
      availability: offer.availability,
      sellerName: offer.seller,
      shippingCents: offer.shipping,
      referenceCents: offer.reference,
      referenceType: offer.referenceType,
      method: 'jsonld',
    };
  }
  return null;
}

function fromMicrodata($: CheerioAPI): Partial<ExtractedOffer> | null {
  const priceEl = $('[itemprop="price"]').first();
  if (!priceEl.length) return null;
  const price = parsePrice(priceEl.attr('content') ?? priceEl.text());
  if (price === null) return null;
  const scope = priceEl.closest('[itemtype*="schema.org/Product"]');
  const root = scope.length ? scope : $.root();
  const gtin = root.find('[itemprop^="gtin"]').first();
  return {
    name:
      root.find('[itemprop="name"]').first().attr('content') ??
      (root.find('[itemprop="name"]').first().text().trim() || null),
    brand: root.find('[itemprop="brand"]').first().text().trim() || null,
    gtin: (gtin.attr('content') ?? gtin.text()).replace(/\D/g, '') || null,
    priceCents: price,
    currency: $('[itemprop="priceCurrency"]').first().attr('content') ?? null,
    availability: mapAvailability(
      $('[itemprop="availability"]').first().attr('href') ??
        $('[itemprop="availability"]').first().attr('content'),
    ),
    method: 'microdata',
  };
}

const LIST_RE = /\b(adviesprijs|adv\.?\s*prijs|rrp|msrp|catalogusprijs)\b/i;
const USUAL_RE = /\b(meestal|normaal|normale prijs|usually)\b/i;
const WAS_RE = /\b(van|was|voorheen|oude prijs)\b/i;
const DEAL_RE =
  /\b(deal|aanbieding|actie|korting|black friday|cyber monday|prime day|singles day|onweerstaanbieding|topdeal|dagdeal|sale|uitverkoop|op=op|2e halve prijs|1\+1)\b/i;
const PCT_RE = /[-−–]\s?(\d{1,2})\s?%|(\d{1,2})\s?%\s*(?:korting|off|goedkoper)/i;

/**
 * Heuristics for reference prices, claimed discounts and deal labels that are usually not in JSON-LD.
 * Only looks inside elements that look like price/badge components, never at the whole page text,
 * to avoid picking up unrelated numbers.
 */
function fromHeuristics($: CheerioAPI, sellingPrice: Cents | null): Partial<ExtractedOffer> {
  const out: Partial<ExtractedOffer> = {};

  const candidates = $(
    'del, s, strike, [class*="strike" i], [class*="old-price" i], [class*="was-price" i], [class*="list-price" i], [class*="from-price" i], [class*="price--old" i], [class*="advies" i], [class*="usual" i], [class*="meestal" i], [data-test*="price" i], [data-testid*="price" i]',
  );
  candidates.each((_, el) => {
    if (out.referenceCents) return;
    const node = $(el);
    const own = node.text().replace(/\s+/g, ' ').trim();
    const context =
      `${node.parent().text()} ${node.attr('class') ?? ''} ${node.attr('aria-label') ?? ''}`
        .replace(/\s+/g, ' ')
        .slice(0, 160);
    const value = parsePrice(own);
    if (value === null || value === 0) return;
    if (sellingPrice !== null && value <= sellingPrice) return;
    out.referenceCents = value;
    out.referenceType = LIST_RE.test(context)
      ? 'list'
      : USUAL_RE.test(context)
        ? 'usual'
        : WAS_RE.test(context) || /^(del|s|strike)$/i.test(el.tagName)
          ? 'was'
          : 'was';
  });

  $(
    '[class*="badge" i], [class*="label" i], [class*="sticker" i], [class*="deal" i], [class*="promo" i], [class*="discount" i], [class*="korting" i]',
  ).each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text || text.length > 60) return;
    if (out.claimedDiscountPct == null) {
      const pct = PCT_RE.exec(text);
      if (pct) out.claimedDiscountPct = Number(pct[1] ?? pct[2]);
    }
    if (!out.dealLabel && DEAL_RE.test(text)) out.dealLabel = text;
  });

  return out;
}

function fromSelectors($: CheerioAPI, config: SelectorConfig): Partial<ExtractedOffer> {
  const pick = (sel?: string) => (sel ? $(sel).first() : null);
  const out: Partial<ExtractedOffer> = {};
  const price = pick(config.price);
  if (price?.length) {
    const v = parsePrice(price.attr('content') ?? price.text());
    if (v !== null) {
      out.priceCents = v;
      out.method = 'selector';
    }
  }
  const name = pick(config.name);
  if (name?.length) out.name = name.text().trim() || null;
  const ref = pick(config.referencePrice);
  if (ref?.length) {
    out.referenceCents = parsePrice(ref.text());
    out.referenceType = config.referenceType ?? 'was';
  }
  const label = pick(config.dealLabel);
  if (label?.length) out.dealLabel = label.text().replace(/\s+/g, ' ').trim() || null;
  const pct = pick(config.claimedDiscount);
  if (pct?.length) {
    const m = PCT_RE.exec(pct.text());
    if (m) out.claimedDiscountPct = Number(m[1] ?? m[2]);
  }
  const avail = pick(config.availability);
  if (avail?.length) out.availability = mapAvailability(avail.attr('href') ?? avail.text());
  const seller = pick(config.seller);
  if (seller?.length) out.sellerName = seller.text().trim() || null;
  return out;
}

const EMPTY: Omit<ExtractedOffer, 'url'> = {
  name: null,
  brand: null,
  gtin: null,
  mpn: null,
  sku: null,
  image: null,
  priceCents: null,
  currency: null,
  availability: 'unknown',
  shippingCents: null,
  sellerName: null,
  referenceCents: null,
  referenceType: 'none',
  claimedDiscountPct: null,
  dealLabel: null,
  method: 'none',
};

const defined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null),
  ) as Partial<T>;

/**
 * Extracts the offer from a product page. Order (ADR-006): JSON-LD → microdata → store selectors,
 * then heuristics for reference price, claimed discount and deal label.
 */
export function extractOffer(
  html: string,
  url: string,
  selectors?: SelectorConfig,
): ExtractedOffer {
  const $ = load(html);
  const base = fromJsonLd($) ?? fromMicrodata($) ?? {};
  const fromSel = selectors ? fromSelectors($, selectors) : {};
  const merged: ExtractedOffer = { ...EMPTY, url, ...defined(base), ...defined(fromSel) };
  if (!merged.name)
    merged.name =
      $('meta[property="og:title"]').attr('content')?.trim() || $('title').text().trim() || null;
  if (!merged.image) merged.image = $('meta[property="og:image"]').attr('content') ?? null;

  const heur = fromHeuristics($, merged.priceCents);
  if (merged.referenceCents === null && heur.referenceCents) {
    merged.referenceCents = heur.referenceCents;
    merged.referenceType = heur.referenceType ?? 'was';
  }
  merged.claimedDiscountPct ??= heur.claimedDiscountPct ?? null;
  merged.dealLabel ??= heur.dealLabel ?? null;

  if (merged.claimedDiscountPct === null && merged.referenceCents && merged.priceCents) {
    // Shops that show a reference price imply a discount even without a percentage badge.
    merged.claimedDiscountPct = Math.round((1 - merged.priceCents / merged.referenceCents) * 100);
  }
  if (merged.currency && merged.currency.toUpperCase() !== 'EUR') {
    // Gier only compares euro prices; foreign currency pages are kept but not priced.
    merged.priceCents = null;
  }
  return merged;
}
