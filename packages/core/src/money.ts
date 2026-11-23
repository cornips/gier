/** Prices are stored as integer euro cents to avoid floating point drift. */
export type Cents = number;

const PRICE_RE = /(\d{1,3}(?:[.\s\u00a0]\d{3})+|\d+)(?:[.,](\d{1,2}|-{1,2}|–))?/;

/**
 * Parses a price as written on Dutch and international shop pages.
 * Accepts "€ 1.049,99", "1049.99", "12,-", "12,–", "1 049,50" and plain numbers.
 */
export function parsePrice(input: string | number | null | undefined): Cents | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    return Number.isFinite(input) && input >= 0 ? Math.round(input * 100) : null;
  }
  const text = input.replace(/\u00a0/g, ' ').trim();
  if (!text) return null;

  // Machine formats first: "1049.99" or "1049,99" without thousand separators.
  const plain = /^\s*(?:€|eur)?\s*(\d+)(?:[.,](\d{1,2}))?\s*(?:€|eur)?\s*$/i.exec(text);
  if (plain) {
    const euros = Number(plain[1]);
    const cents = plain[2] ? Number(plain[2].padEnd(2, '0')) : 0;
    return euros * 100 + cents;
  }

  // English style "1,049.99"
  const english = /(\d{1,3}(?:,\d{3})+)\.(\d{2})(?!\d)/.exec(text);
  if (english) {
    return Number(english[1]!.replace(/,/g, '')) * 100 + Number(english[2]);
  }

  const match = PRICE_RE.exec(text);
  if (!match) return null;
  const euros = Number(match[1]!.replace(/[.\s\u00a0]/g, ''));
  const decimals = match[2];
  const cents = decimals && /^\d+$/.test(decimals) ? Number(decimals.padEnd(2, '0')) : 0;
  if (!Number.isFinite(euros)) return null;
  return euros * 100 + cents;
}

export function formatEuro(cents: Cents, locale = 'nl-NL'): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Percentage change from `from` to `to`, rounded to one decimal. Negative means cheaper. */
export function percentChange(from: Cents, to: Cents): number {
  if (from <= 0) return 0;
  return Math.round(((to - from) / from) * 1000) / 10;
}
