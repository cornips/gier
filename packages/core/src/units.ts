import type { Cents } from './money';

export type QuantityUnit = 'ml' | 'g' | 'piece';

export interface Quantity {
  /** Number of items in the pack (6 for "6 x 150 ml"). */
  packCount: number;
  /** Amount per item in the base unit (ml or g), or 1 for pieces. */
  amount: number;
  unit: QuantityUnit;
}

export type CompareUnit = 'piece' | 'per100';

const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*(ml|cl|dl|l|liter|litre|g|gr|gram|kg)\b/i;
const PACK_RES = [
  // "6 x 150 ml", "6x150ml"
  /(\d+)\s*[x×]\s*\d+(?:[.,]\d+)?\s*(?:ml|cl|dl|l|g|gr|kg)\b/i,
  // "150 ml x 6"
  /\d+(?:[.,]\d+)?\s*(?:ml|cl|dl|l|g|gr|kg)\s*[x×]\s*(\d+)\b/i,
  // "2 x Syoss Max Hold …" at the start, or after a separator: "Bulkverpakking - 3 x Syoss"
  /(?:^\s*|[(|–—-]\s*)(\d{1,2})\s*[x×]\s+(?=[a-z])/i,
  // "3-pack", "2 stuks", "(4 st.)"
  /(\d+)\s*-?\s*(?:pack|pak|stuks|stuk|st\.?|pcs|pieces)\b/i,
  /\b(?:pack|set|doos|voordeelpak|voordeelverpakking|multipack)\s+(?:van\s+)?(\d+)\b/i,
];
const PACK_WORDS: [RegExp, number][] = [
  [/\b(?:duo|duopak|duopack|duoverpakking|tweepak)\b/i, 2],
  [/\b(?:trio|driepak|triopak)\b/i, 3],
];

const TO_BASE: Record<string, { unit: QuantityUnit; factor: number }> = {
  ml: { unit: 'ml', factor: 1 },
  cl: { unit: 'ml', factor: 10 },
  dl: { unit: 'ml', factor: 100 },
  l: { unit: 'ml', factor: 1000 },
  liter: { unit: 'ml', factor: 1000 },
  litre: { unit: 'ml', factor: 1000 },
  g: { unit: 'g', factor: 1 },
  gr: { unit: 'g', factor: 1 },
  gram: { unit: 'g', factor: 1 },
  kg: { unit: 'g', factor: 1000 },
};

/** Reads pack size and content from a product title, e.g. "Rexona deo spray 6 x 150 ml". */
export function parseQuantity(title: string): Quantity {
  let packCount = 1;
  for (const re of PACK_RES) {
    const m = re.exec(title);
    if (m) {
      const n = Number(m[1]);
      if (n > 1 && n <= 200) {
        packCount = n;
        break;
      }
    }
  }
  if (packCount === 1)
    for (const [re, n] of PACK_WORDS)
      if (re.test(title)) {
        packCount = n;
        break;
      }
  const size = SIZE_RE.exec(title);
  if (size) {
    const base = TO_BASE[size[2]!.toLowerCase()];
    if (base) {
      const amount = Number(size[1]!.replace(',', '.')) * base.factor;
      return { packCount, amount: Math.round(amount * 100) / 100, unit: base.unit };
    }
  }
  return { packCount, amount: 1, unit: 'piece' };
}

/**
 * Reads the quantity from several descriptions of the same offer (title, page heading, URL, size field)
 * and combines them: the size from wherever it is given, the largest credible pack count. Shops often put
 * the pack count only in the URL or heading ("2-x-…-2-stuks") and the size only in a separate field.
 */
export function combineQuantity(sources: (string | null | undefined)[]): Quantity {
  const parsed = sources.filter((s): s is string => Boolean(s?.trim())).map(parseQuantity);
  const sized = parsed.find((q) => q.unit !== 'piece');
  const packCount = Math.max(1, ...parsed.map((q) => q.packCount));
  return sized
    ? { packCount, amount: sized.amount, unit: sized.unit }
    : { packCount, amount: 1, unit: 'piece' };
}

/** Price for one item, or per 100 ml/g, in cents. */
export function unitPrice(price: Cents, quantity: Quantity, mode: CompareUnit): Cents {
  const perItem = price / Math.max(1, quantity.packCount);
  if (mode === 'piece' || quantity.unit === 'piece') return Math.round(perItem);
  return Math.round((perItem / quantity.amount) * 100);
}

export function sameSize(a: Quantity, b: Quantity, tolerance = 0.02): boolean {
  if (a.unit !== b.unit) return false;
  if (a.unit === 'piece') return true;
  return Math.abs(a.amount - b.amount) / Math.max(a.amount, b.amount) <= tolerance;
}

export function describeQuantity(q: Quantity): string {
  const size =
    q.unit === 'piece'
      ? ''
      : q.amount >= 1000
        ? `${q.amount / 1000} ${q.unit === 'ml' ? 'l' : 'kg'}`
        : `${q.amount} ${q.unit}`;
  if (q.packCount > 1) return size ? `${q.packCount} × ${size}` : `${q.packCount} stuks`;
  return size || '1 stuk';
}
