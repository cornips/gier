import { describe, expect, it } from 'vitest';
import i18n from 'i18next';
import nl from '../src/i18n/nl.json';
import en from '../src/i18n/en.json';
import { isGtin, isUrl, parseEuroInput, pct } from '../src/lib/format';
import { findingText } from '../src/lib/findings';

describe('format', () => {
  it('parses euro input the Dutch way', () => {
    expect(parseEuroInput('19,99')).toBe(1999);
    expect(parseEuroInput('€ 1.299,00')).toBe(129900);
    expect(parseEuroInput('1,299.00')).toBe(129900);
    expect(parseEuroInput('19.99')).toBe(1999);
    expect(parseEuroInput('1.299')).toBe(129900);
    expect(parseEuroInput('abc')).toBeNull();
  });
  it('recognises URLs and EANs', () => {
    expect(isUrl('https://www.bol.com/p/x')).toBe(true);
    expect(isGtin('8710103937559')).toBe(true);
    expect(isGtin('sony')).toBe(false);
  });
  it('signs percentages', () => {
    expect(pct(-20.1)).toBe('-20.1%');
    expect(pct(3)).toBe('+3%');
  });
});

describe('i18n', () => {
  const keys = (o: object, prefix = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      v && typeof v === 'object' ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
    );
  it('has the same keys in Dutch and English', () => {
    expect(keys(en).sort()).toEqual(keys(nl).sort());
  });
  it('formats findings with money evidence', async () => {
    await i18n.init({
      lng: 'nl',
      resources: { nl: { translation: nl } },
      interpolation: { escapeValue: false },
    });
    const text = findingText(i18n.t, {
      code: 'inflated_percentage',
      evidence: { claimed: 18, real: 0, low30: 33599 },
    });
    expect(text.replace(/\u00a0/g, ' ')).toBe(
      'Geclaimd 18% korting, echt 0% t.o.v. de laagste prijs van 30 dagen (€ 335,99).',
    );
  });
});
