import { normalize } from '../text';

/** ADR-007: every exclusion becomes a rule with a counter per category. */
export interface ExclusionRule {
  term: string;
  category: string | null;
  count: number;
}

export const AUTO_APPLY_AFTER = 2;

export function recordExclusion(
  rules: ExclusionRule[],
  term: string,
  category: string | null,
): ExclusionRule[] {
  const t = normalize(term);
  if (!t) return rules;
  const existing = rules.find((r) => r.term === t && r.category === category);
  if (existing) return rules.map((r) => (r === existing ? { ...r, count: r.count + 1 } : r));
  return [...rules, { term: t, category, count: 1 }];
}

/** Exclusions to prefill for a new product: global rules and rules for its category used at least twice. */
export function defaultExclusions(
  rules: ExclusionRule[],
  category: string | null,
): ExclusionRule[] {
  return rules
    .filter((r) => r.count >= AUTO_APPLY_AFTER && (r.category === null || r.category === category))
    .sort((a, b) => b.count - a.count);
}
