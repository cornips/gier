import type { Cents } from '../money';

/** What kind of reference price a shop shows next to the selling price (ADR-010). */
export type ReferenceType = 'was' | 'list' | 'usual' | 'none';

export type Availability = 'in_stock' | 'limited' | 'out_of_stock' | 'preorder' | 'unknown';

export interface ExtractedOffer {
  url: string;
  name: string | null;
  brand: string | null;
  gtin: string | null;
  mpn: string | null;
  sku: string | null;
  image: string | null;
  priceCents: Cents | null;
  currency: string | null;
  availability: Availability;
  shippingCents: Cents | null;
  sellerName: string | null;
  referenceCents: Cents | null;
  referenceType: ReferenceType;
  claimedDiscountPct: number | null;
  dealLabel: string | null;
  /** Which extraction layer produced the price. */
  method: 'jsonld' | 'microdata' | 'selector' | 'none';
}

export interface SelectorConfig {
  price?: string;
  name?: string;
  referencePrice?: string;
  referenceType?: ReferenceType;
  dealLabel?: string;
  claimedDiscount?: string;
  availability?: string;
  seller?: string;
}
