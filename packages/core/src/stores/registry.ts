/**
 * ADR-013: default fixed stores for the Dutch market, the seed for the store registry. They are trusted
 * from the start and searched first; users can change every rule in the app. Domains marked `verify` are best guesses to confirm on the first discovery run;
 * `domain: null` means the shop still has to be identified (backlog: research task).
 */
export type StoreCategory =
  | 'marketplace'
  | 'electronics'
  | 'computers'
  | 'drugstore'
  | 'health'
  | 'perfumery'
  | 'brand'
  | 'supermarket'
  | 'wholesale'
  | 'liquor'
  | 'department'
  | 'discounter'
  | 'home'
  | 'fashion'
  | 'shoes'
  | 'travel'
  | 'unknown';

export interface StoreRules {
  /** Only count offers sold by the shop itself (bol, Amazon). Value is the seller name to match. */
  soldByOnly?: string;
  /** Allow partner sellers only when the shop itself does not sell the product. */
  partnersAsFallback?: boolean;
  /**
   * Only count this shop as cheapest when its price is at least this % lower than the next best.
   * Amazon.nl defaults to 5% because of concerns about its business practices (ADR-013); editable per store.
   */
  preferenceThresholdPct?: number;
  /** Brand shops are only searched when the product brand matches. */
  brands?: string[];
  requiresLogin?: boolean;
  /** Prices on the site exclude VAT (wholesale). */
  pricesExcludeVat?: boolean;
  /** Page where the login handoff starts (ADR-014). Defaults to the store's home page. */
  loginUrl?: string;
  /** Mostly physical store; online assortment is limited. */
  limitedOnline?: boolean;
}

export interface StoreSeed {
  name: string;
  domain: string | null;
  category: StoreCategory;
  rules?: StoreRules;
  verify?: boolean;
}

export const FIXED_STORES: StoreSeed[] = [
  {
    name: 'bol',
    domain: 'bol.com',
    category: 'marketplace',
    rules: { soldByOnly: 'bol', partnersAsFallback: true },
  },
  {
    name: 'Amazon.nl',
    domain: 'amazon.nl',
    category: 'marketplace',
    rules: { soldByOnly: 'Amazon', preferenceThresholdPct: 5 },
  },
  { name: 'Coolblue', domain: 'coolblue.nl', category: 'electronics' },
  { name: 'MediaMarkt', domain: 'mediamarkt.nl', category: 'electronics' },
  { name: 'Megekko', domain: 'megekko.nl', category: 'computers' },
  { name: 'Paradigit', domain: 'paradigit.nl', category: 'computers' },
  { name: 'Azerty', domain: 'azerty.nl', category: 'computers' },
  { name: 'Alternate', domain: 'alternate.nl', category: 'computers' },
  { name: 'Robbshop', domain: null, category: 'unknown' },
  { name: 'OFM', domain: null, category: 'unknown' },
  { name: 'Kruidvat', domain: 'kruidvat.nl', category: 'drugstore' },
  { name: 'Etos', domain: 'etos.nl', category: 'drugstore' },
  { name: 'Plein.nl', domain: 'plein.nl', category: 'drugstore' },
  { name: 'Holland & Barrett', domain: 'hollandandbarrett.nl', category: 'health' },
  { name: 'ICI Paris XL', domain: 'iciparisxl.nl', category: 'perfumery' },
  { name: 'Douglas', domain: 'douglas.nl', category: 'perfumery' },
  { name: 'Rituals', domain: 'rituals.com', category: 'brand', rules: { brands: ['Rituals'] } },
  { name: 'Albert Heijn', domain: 'ah.nl', category: 'supermarket' },
  { name: 'Jumbo', domain: 'jumbo.com', category: 'supermarket' },
  { name: 'Lidl', domain: 'lidl.nl', category: 'supermarket', rules: { limitedOnline: true } },
  { name: 'Aldi', domain: 'aldi.nl', category: 'supermarket', rules: { limitedOnline: true } },
  { name: 'Dirk van den Broek', domain: 'dirk.nl', category: 'supermarket' },
  {
    name: 'Amazing Oriental',
    domain: 'amazingoriental.com',
    category: 'supermarket',
    verify: true,
  },
  {
    name: 'Sligro',
    domain: 'sligro.nl',
    category: 'wholesale',
    rules: { requiresLogin: true, pricesExcludeVat: true },
  },
  {
    name: 'Makro',
    domain: 'makro.nl',
    category: 'wholesale',
    rules: { requiresLogin: true, pricesExcludeVat: true, loginUrl: 'https://my.makro.nl/' },
  },
  { name: 'Gall & Gall', domain: 'gall.nl', category: 'liquor' },
  { name: 'Dirck III', domain: 'dirckiii.nl', category: 'liquor', verify: true },
  { name: 'HEMA', domain: 'hema.nl', category: 'department' },
  { name: 'Action', domain: 'action.com', category: 'discounter', rules: { limitedOnline: true } },
  { name: 'Xenos', domain: 'xenos.nl', category: 'home' },
  { name: 'JYSK', domain: 'jysk.nl', category: 'home' },
  { name: 'Stumpel', domain: null, category: 'unknown' },
  { name: 'ANWB', domain: 'anwb.nl', category: 'travel' },
  { name: 'Zara', domain: 'zara.com', category: 'brand', rules: { brands: ['Zara'] } },
  {
    name: 'PME Legend',
    domain: 'pme-legend.com',
    category: 'brand',
    rules: { brands: ['PME Legend'] },
    verify: true,
  },
  { name: 'C&A', domain: 'c-and-a.com', category: 'fashion' },
  { name: 'Nike', domain: 'nike.com', category: 'brand', rules: { brands: ['Nike', 'Jordan'] } },
  { name: 'Van Haren', domain: 'vanharen.nl', category: 'shoes' },
];

/** Registrable domain of a URL ("www.bol.com" → "bol.com", "shop.example.co.uk" → "example.co.uk"). */
export function domainOf(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const parts = host.replace(/^www\./, '').split('.');
  const twoPartTlds = ['co.uk', 'com.au', 'co.nz'];
  const lastTwo = parts.slice(-2).join('.');
  return twoPartTlds.includes(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

/** VAT conversion for wholesale prices (21% standard, 9% for food and some other goods). */
export const addVat = (cents: number, rate: 0.21 | 0.09 = 0.21) => Math.round(cents * (1 + rate));
