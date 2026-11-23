/** Lowercase, strip diacritics and punctuation so titles from different shops compare fairly. */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9.,\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(text: string): string[] {
  return normalize(text)
    .split(/[\s,-]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean);
}

/** Model numbers such as "WH-1000XM6", "ECAM290.61", "C-5750": tokens mixing letters and digits, as written. */
export function rawModelNumbers(text: string): string[] {
  const raw = text.toUpperCase().match(/\b[A-Z0-9]+(?:[-.][A-Z0-9]+)*\b/g) ?? [];
  return [
    ...new Set(
      raw.filter((t) => /[A-Z]/.test(t) && /\d/.test(t) && t.replace(/[-.]/g, '').length >= 4),
    ),
  ];
}

/** Model numbers normalised for comparison ("WH-1000XM6" and "WH1000XM6" are equal). */
export function modelNumbers(text: string): string[] {
  return [...new Set(rawModelNumbers(text).map((t) => t.replace(/[-.]/g, '')))];
}

/** Jaccard similarity of token sets, 0..1. */
export function similarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

export function containsPhrase(haystack: string, phrase: string): boolean {
  const h = ` ${normalize(haystack)} `;
  const p = normalize(phrase);
  return p.length > 0 && h.includes(` ${p} `);
}
