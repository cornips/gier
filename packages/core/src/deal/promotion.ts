import type { Cents } from '../money';

/**
 * A multi-buy promotion as shops show it next to the price: "1+1 gratis", "2e halve prijs",
 * "2 voor € 5", "3 halen 2 betalen". Some only apply with the shop's loyalty card or app.
 */
export interface Promotion {
  /** The text as the shop shows it, for the user. */
  text: string;
  kind: 'buy_get' | 'nth_discount' | 'bundle_price';
  /** Items to buy for the deal (1+1 → 2, 2e halve prijs → 2, 2 voor € 5 → 2). */
  quantity: number;
  /** Items paid for at full price (buy_get). */
  paid?: number;
  /** Discount on the last item in percent (nth_discount). */
  pct?: number;
  /** Price for the whole bundle (bundle_price). */
  bundleCents?: Cents;
  /** 'card': only with the shop's loyalty card, club or app. */
  requires: 'none' | 'card';
  /**
   * Where Gier read it: 'selector' from the store's own promotion selector, 'page' from scanning the
   * page for promotion-like elements. Missing on promotions read before this was recorded.
   */
  source?: 'selector' | 'page';
  /** The text around it on the page (trimmed), so the user can see where it came from. */
  context?: string;
}

/** Identifies a deal regardless of wording or where it was read; used to dedupe and dismiss. */
export const promotionKey = (p: Promotion) =>
  `${p.kind}:${p.quantity}:${p.paid ?? ''}:${p.pct ?? ''}:${p.bundleCents ?? ''}:${p.requires}`;

/**
 * The promotions Gier may count for a listing. On marketplaces (bol, Amazon) a product page also shows
 * deals of other sellers and campaign teasers, so a page scan cannot tell which deal applies: only
 * promotions from a store selector count there. Deals the user marked as wrong never count.
 */
export function usablePromotions(
  promotions: Promotion[] | null | undefined,
  { marketplace, dismissed }: { marketplace: boolean; dismissed?: string[] | null },
): Promotion[] | null {
  const usable = (promotions ?? []).filter(
    (p) => !(marketplace && p.source !== 'selector') && !dismissed?.includes(promotionKey(p)),
  );
  return usable.length ? usable : null;
}

const CARD_RE =
  /\b(?:club(?:actie|prijs|deal)?|klantenkaart|bonuskaart|kaarthouders?|met (?:je |uw |de )?(?:\w+[ -])?kaart|leden(?:prijs|actie)?|members?|app[- ]?(?:deal|actie|prijs)|persoonlijke (?:bonus|aanbieding)|beautycard|beauty card)\b/i;

const NUM_WORDS: Record<string, number> = { een: 1, één: 1, twee: 2, drie: 3, vier: 4 };
const num = (s: string) => NUM_WORDS[s.toLowerCase()] ?? Number(s);

/** Reads one promotion from a short text. Returns null when the text is not a multi-buy deal. */
export function parsePromotion(raw: string): Promotion | null {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 160) return null;
  const t = text.toLowerCase().replace(/\u00a0/g, ' ');
  const requires = CARD_RE.test(t) ? 'card' : 'none';
  const base = { text, requires } as const;

  // "1+1 gratis", "2 + 1 gratis", "1+2 gratis"
  let m = /\b(\d|een|één|twee)\s*\+\s*(\d|een|één|twee)\s*gratis\b/.exec(t);
  if (m) {
    const paid = num(m[1]!);
    const free = num(m[2]!);
    if (paid >= 1 && free >= 1 && paid + free <= 10)
      return { ...base, kind: 'buy_get', quantity: paid + free, paid };
  }
  // "3 halen 2 betalen"
  m = /\b(\d)\s*halen,?\s*(\d)\s*betalen\b/.exec(t);
  if (m && Number(m[1]) > Number(m[2]))
    return { ...base, kind: 'buy_get', quantity: Number(m[1]), paid: Number(m[2]) };
  // "2e halve prijs", "tweede voor de halve prijs", "2e gratis"
  m =
    /\b(2e|3e|tweede|derde)\s+(?:artikel\s+|product\s+)?(?:voor\s+de\s+|tegen\s+)?(halve prijs|gratis)\b/.exec(
      t,
    );
  if (m) {
    const n = /^(2e|tweede)$/.test(m[1]!) ? 2 : 3;
    return m[2] === 'gratis'
      ? { ...base, kind: 'buy_get', quantity: n, paid: n - 1 }
      : { ...base, kind: 'nth_discount', quantity: n, pct: 50 };
  }
  // "25% korting op de 2e", "2e voor 50% korting"
  m = /\b(\d{1,2})\s*%\s*korting\s+op\s+(?:de\s+|het\s+)?(2e|3e|tweede|derde)\b/.exec(t);
  if (m)
    return {
      ...base,
      kind: 'nth_discount',
      quantity: /^(2e|tweede)$/.test(m[2]!) ? 2 : 3,
      pct: Number(m[1]),
    };
  m = /\b(2e|tweede)\s+(?:voor\s+|met\s+)?(\d{1,2})\s*%\s*korting\b/.exec(t);
  if (m) return { ...base, kind: 'nth_discount', quantity: 2, pct: Number(m[2]) };
  // "2 voor € 5", "2 stuks voor 7,99", "3 voor 10 euro"
  m =
    /\b(\d)\s*(?:stuks\s+)?voor\s*(?:€|eur|euro)?\s*(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)?(?!\s*%)/.exec(
      t,
    );
  if (m) {
    const count = Number(m[1]);
    const amount = m[2]!;
    const hasMoney = /[.,]\d/.test(amount) || /€|eur/.test(t);
    if (count >= 2 && hasMoney)
      return {
        ...base,
        kind: 'bundle_price',
        quantity: count,
        bundleCents: Math.round(Number(amount.replace(',', '.')) * 100),
      };
    // "3 voor 2": three for the price of two
    if (count >= 2 && !hasMoney && Number(amount) < count && Number.isInteger(Number(amount)))
      return { ...base, kind: 'buy_get', quantity: count, paid: Number(amount) };
  }
  return null;
}

/** Price per item when buying the promotion's quantity, or null when it does not lower the price. */
export function promotionUnitCents(p: Promotion, unitCents: Cents): Cents | null {
  let perItem: number;
  switch (p.kind) {
    case 'buy_get':
      perItem = (unitCents * (p.paid ?? p.quantity)) / p.quantity;
      break;
    case 'nth_discount':
      perItem =
        (unitCents * (p.quantity - 1) + (unitCents * (100 - (p.pct ?? 0))) / 100) / p.quantity;
      break;
    case 'bundle_price':
      perItem = (p.bundleCents ?? Infinity) / p.quantity;
      break;
  }
  const cents = Math.round(perItem);
  return cents > 0 && cents < unitCents ? cents : null;
}

/**
 * The best promotion that applies for this user: card-only deals count only when the user has that
 * shop's card. Returns the promotion with its price per item.
 */
export function bestPromotion(
  promotions: Promotion[] | null | undefined,
  unitCents: Cents,
  hasCard: boolean,
): { promotion: Promotion; unitCents: Cents } | null {
  let best: { promotion: Promotion; unitCents: Cents } | null = null;
  for (const p of promotions ?? []) {
    if (p.requires === 'card' && !hasCard) continue;
    const cents = promotionUnitCents(p, unitCents);
    if (cents !== null && (!best || cents < best.unitCents))
      best = { promotion: p, unitCents: cents };
  }
  return best;
}
