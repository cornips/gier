import {
  containsPhrase,
  modelNumbers,
  normalize,
  rawModelNumbers,
  similarity,
  tokens,
} from '../text';
import { parseQuantity, sameSize, type CompareUnit, type Quantity } from '../units';

/** ADR-007: what the user means, with each attribute either locked (must match) or loose. */
export interface Fingerprint {
  title: string;
  brand?: string | null;
  line?: string | null;
  form?: string | null;
  quantity?: Quantity | null;
  gtin?: string | null;
  model?: string | null;
  /** Attribute keys that must match: 'brand' | 'line' | 'form' | 'quantity' | 'model'. */
  locked: Array<'brand' | 'line' | 'form' | 'quantity' | 'model'>;
  /** Accept multipacks of the locked quantity and compare per item. */
  allowMultipack: boolean;
  compareUnit: CompareUnit;
  /** Terms that disqualify a candidate (learned or set by the user). */
  exclude: string[];
}

export interface Candidate {
  title: string;
  brand?: string | null;
  gtin?: string | null;
  mpn?: string | null;
  sellerName?: string | null;
}

export type MatchVerdict = 'match' | 'doubt' | 'reject';

export interface MatchResult {
  verdict: MatchVerdict;
  score: number;
  quantity: Quantity;
  reasons: string[];
}

/** Terms that almost always mean a different product condition. */
export const ALWAYS_EXCLUDE = [
  'refurbished',
  'tweedehands',
  'gebruikt',
  'used',
  'renewed',
  'b-keuze',
  'demo model',
  'occasion',
];

export function matchCandidate(fp: Fingerprint, c: Candidate): MatchResult {
  const reasons: string[] = [];
  const quantity = parseQuantity(c.title);
  const title = normalize(`${c.brand ?? ''} ${c.title}`);

  // Hard exclusions first: they are cheap and explainable.
  for (const term of [...ALWAYS_EXCLUDE, ...fp.exclude]) {
    if (containsPhrase(title, term)) {
      return { verdict: 'reject', score: 0, quantity, reasons: [`excluded:${term}`] };
    }
  }

  // An identical GTIN is the strongest signal there is.
  if (fp.gtin && c.gtin && fp.gtin.replace(/^0+/, '') === c.gtin.replace(/^0+/, '')) {
    if (!fp.allowMultipack && quantity.packCount > 1) {
      return { verdict: 'reject', score: 0, quantity, reasons: ['multipack_not_allowed'] };
    }
    return { verdict: 'match', score: 1, quantity, reasons: ['gtin'] };
  }
  if (fp.gtin && c.gtin && fp.gtin !== c.gtin && fp.locked.includes('quantity')) {
    // Different GTIN usually means a different size or variant, but bundles keep their own GTIN.
    reasons.push('gtin_differs');
  }

  let score = similarity(fp.title, c.title) * 0.4;

  if (fp.brand) {
    const ok = containsPhrase(title, fp.brand);
    if (!ok && fp.locked.includes('brand'))
      return { verdict: 'reject', score: 0, quantity, reasons: ['brand'] };
    if (ok) score += 0.2;
  }
  if (fp.line) {
    const lineTokens = tokens(fp.line);
    const present =
      lineTokens.filter((t) => tokens(title).includes(t)).length / Math.max(1, lineTokens.length);
    if (present < 0.75 && fp.locked.includes('line')) {
      return {
        verdict: present >= 0.5 ? 'doubt' : 'reject',
        score: present * 0.5,
        quantity,
        reasons: ['line'],
      };
    }
    score += 0.2 * present;
  }
  if (fp.form && containsPhrase(title, fp.form)) score += 0.05;
  else if (fp.form && fp.locked.includes('form')) reasons.push('form_missing');

  if (fp.model) {
    const wanted = modelNumbers(fp.model);
    const found = modelNumbers(`${c.title} ${c.mpn ?? ''}`);
    const hit = wanted.some((m) => found.includes(m));
    if (hit) score += 0.4;
    else if (fp.locked.includes('model') && found.length) {
      return { verdict: 'reject', score: 0, quantity, reasons: ['model'] };
    } else if (fp.locked.includes('model')) reasons.push('model_missing');
  }

  if (fp.quantity && fp.locked.includes('quantity')) {
    if (quantity.unit !== 'piece' && !sameSize(quantity, fp.quantity)) {
      return { verdict: 'reject', score: 0, quantity, reasons: ['quantity'] };
    }
    if (quantity.unit === 'piece' && fp.quantity.unit !== 'piece') reasons.push('quantity_missing');
    if (quantity.packCount > 1 && !fp.allowMultipack) {
      return { verdict: 'reject', score: 0, quantity, reasons: ['multipack_not_allowed'] };
    }
    score += 0.1;
  }

  score = Math.min(1, Math.round(score * 100) / 100);
  const verdict: MatchVerdict =
    score >= 0.6 && reasons.length === 0 ? 'match' : score >= 0.35 ? 'doubt' : 'reject';
  if (verdict !== 'match' && reasons.length === 0) reasons.push('low_similarity');
  return { verdict, score, quantity, reasons };
}

/** A sensible starting fingerprint from a title, before AI or the user refine it. */
export function fingerprintFromTitle(
  title: string,
  brand?: string | null,
  gtin?: string | null,
): Fingerprint {
  const quantity = parseQuantity(title);
  const models = rawModelNumbers(title);
  return {
    title,
    brand: brand ?? null,
    line: null,
    form: null,
    quantity: quantity.unit === 'piece' ? null : { ...quantity, packCount: 1 },
    gtin: gtin ?? null,
    model: models[0] ?? null,
    locked: [
      brand ? 'brand' : null,
      quantity.unit !== 'piece' ? 'quantity' : null,
      models[0] ? 'model' : null,
    ].filter((x): x is 'brand' | 'quantity' | 'model' => x !== null),
    allowMultipack: true,
    compareUnit: 'piece',
    exclude: [],
  };
}
