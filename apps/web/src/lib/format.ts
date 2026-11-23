import { formatEuro } from '@gier/core/browser';
import { locale } from '@/i18n';

export const euro = (cents: number | null | undefined) =>
  cents == null ? '–' : formatEuro(cents, locale());

/** Small amounts (AI costs) need more precision than shelf prices. */
export const euroPrecise = (eur: number) =>
  new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: eur < 0.1 ? 3 : 2,
  }).format(eur);

export const pct = (v: number | null | undefined, signed = true) =>
  v == null
    ? '–'
    : `${signed && v > 0 ? '+' : ''}${new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(v)}%`;

const rtf = () => new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });

export function relative(at: string | number | Date | null | undefined, now = Date.now()): string {
  if (at == null) return '–';
  const t = new Date(at).getTime();
  const s = Math.round((t - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf().format(Math.round(s), 'second');
  if (abs < 3600) return rtf().format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf().format(Math.round(s / 3600), 'hour');
  if (abs < 86400 * 30) return rtf().format(Math.round(s / 86400), 'day');
  if (abs < 86400 * 365) return rtf().format(Math.round(s / (86400 * 30)), 'month');
  return rtf().format(Math.round(s / (86400 * 365)), 'year');
}

export const date = (
  at: string | number | Date,
  opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
) => new Intl.DateTimeFormat(locale(), opts).format(new Date(at));

/** Parse a price typed by a user ("19,99", "€ 19.99", "1.299,00", "1,299.00") into cents. */
export function parseEuroInput(v: string): number | null {
  const t = v.replace(/[€\s]/g, '');
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const sep = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
  const decimals = sep >= 0 ? t.length - sep - 1 : 0;
  const n =
    sep >= 0 && decimals > 0 && decimals <= 2
      ? Number(`${t.slice(0, sep).replace(/[.,]/g, '')}.${t.slice(sep + 1)}`)
      : Number(t.replace(/[.,]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

export const isUrl = (v: string) => /^https?:\/\/\S+\.\S+/i.test(v.trim());
export const isGtin = (v: string) => /^\d{8}$|^\d{12,14}$/.test(v.trim());
