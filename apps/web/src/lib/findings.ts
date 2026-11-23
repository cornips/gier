import type { TFunction } from 'i18next';
import type { Finding } from './types';
import { euro } from './format';

/** Evidence keys that hold cents and must be shown as money. */
const MONEY_KEYS = new Set([
  'before',
  'now',
  'diff',
  'low30',
  'listPrice',
  'highestSeen',
  'claimed',
  'median',
  'wasPrice',
  'lowWeek',
  'price',
]);

export function findingText(t: TFunction, f: Finding): string {
  const values: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(f.evidence)) {
    // inflated_percentage uses `claimed`/`real` as percentages, not money.
    const isMoney =
      MONEY_KEYS.has(k) &&
      typeof v === 'number' &&
      !(f.code === 'inflated_percentage' && (k === 'claimed' || k === 'real'));
    values[k] = isMoney ? euro(v as number) : v;
  }
  return t(`finding.${f.code}`, values);
}

export const isWarning = (f: Finding) => f.code !== 'insufficient_history';
