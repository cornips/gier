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
  /** The user has this store's loyalty card, so card-only promotions count (set by the user). */
  loyaltyCard?: boolean;
  /** The store's own product search, used next to web search so known stores are never missed. */
  search?: StoreSearch;
}

export interface StoreSearch {
  /** URL with {q} for the URL-encoded query. */
  url: string;
  /** 'html': product links in the page; 'json': a JSON API with a list of products. */
  type: 'html' | 'json';
  /** html: regular expression for product paths, e.g. "/producten/[^\"?#]+\\.html". */
  productPath?: string;
  /** json: dotted path to the product list, and the fields for link and name. */
  items?: string;
  link?: string;
  name?: string;
  /** Prefix for relative links. */
  base?: string;
}

/**
 * Store categories worth searching for a product category (the AI's short English label). Marketplaces
 * always count. Returns null when the category is unknown: then every known store is in scope.
 */
export function storeCategoriesFor(
  productCategory: string | null | undefined,
): StoreCategory[] | null {
  const c = (productCategory ?? '').toLowerCase();
  if (!c) return null;
  const groups: [RegExp, StoreCategory[]][] = [
    [
      /perfum|fragrance|parfum|eau de|cologne|geur/,
      ['perfumery', 'drugstore', 'department', 'health', 'brand'],
    ],
    [
      /personal care|hair|haar|skin|huid|beauty|cosmetic|make-?up|deodor|shav|scheer|oral|tand|hygien|body|lichaam|verzorging|baby/,
      ['drugstore', 'perfumery', 'health', 'department', 'discounter', 'supermarket', 'brand'],
    ],
    [/health|vitamin|supplement|gezondheid|medic|pharma/, ['drugstore', 'health', 'supermarket']],
    [
      /food|grocer|drink|beverage|snack|coffee|tea|voeding|eten|drank/,
      ['supermarket', 'wholesale', 'discounter'],
    ],
    [/wine|beer|spirit|liquor|alcohol|whisk|wijn|bier/, ['liquor', 'supermarket', 'wholesale']],
    [
      /computer|laptop|pc|monitor|keyboard|mouse|storage|ssd|gpu|network|printer/,
      ['computers', 'electronics'],
    ],
    [
      /audio|headphone|speaker|\btv\b|televis|phone|camera|electronic|gaming|console|smart|wearable|appliance/,
      ['electronics', 'computers', 'department'],
    ],
    [
      /kitchen|home|household|garden|furniture|decor|keuken|huis|tuin|clean|schoon/,
      ['home', 'department', 'discounter', 'supermarket', 'drugstore'],
    ],
    [/fashion|cloth|apparel|kleding/, ['fashion', 'department']],
    [/shoe|schoen/, ['shoes', 'fashion']],
    [/travel|reis|camping|car|auto/, ['travel', 'department']],
  ];
  const hit = groups.find(([re]) => re.test(c));
  return hit ? ['marketplace', ...hit[1]] : null;
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
  {
    name: 'Kruidvat',
    domain: 'kruidvat.nl',
    category: 'drugstore',
    rules: {
      search: {
        type: 'json',
        url: 'https://api.kruidvat.nl/api/v2/kvn-spa/search?fields=FULL&searchType=PRODUCT&query={q}&lang=nl&curr=EUR',
        items: 'products',
        link: 'url',
        name: 'name',
        base: 'https://www.kruidvat.nl',
      },
    },
  },
  {
    name: 'Etos',
    domain: 'etos.nl',
    category: 'drugstore',
    rules: {
      search: {
        type: 'html',
        url: 'https://www.etos.nl/search/?q={q}',
        productPath: '/producten/[^"?#]+\\.html',
        base: 'https://www.etos.nl',
      },
    },
  },
  { name: 'Plein.nl', domain: 'plein.nl', category: 'drugstore' },
  { name: 'Holland & Barrett', domain: 'hollandandbarrett.nl', category: 'health' },
  { name: 'ICI Paris XL', domain: 'iciparisxl.nl', category: 'perfumery' },
  {
    name: 'Douglas',
    domain: 'douglas.nl',
    category: 'perfumery',
    rules: {
      search: {
        type: 'html',
        url: 'https://www.douglas.nl/nl/search?q={q}',
        productPath: '/nl/p/\\d+(?:\\?variant=\\d+)?',
        base: 'https://www.douglas.nl',
      },
    },
  },
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
