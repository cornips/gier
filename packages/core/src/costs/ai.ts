/**
 * ADR-009: every AI call is priced and logged per product. Prices in USD per million tokens.
 * Claude Haiku 5.5 is priced by prompt length: prompts over 100k tokens pay 5x, so Gier keeps
 * every request below that threshold.
 */
export interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
  longInputPerM?: number;
  longOutputPerM?: number;
  longThreshold?: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-haiku-5-5': {
    inputPerM: 0.1,
    outputPerM: 0.5,
    longInputPerM: 0.5,
    longOutputPerM: 2.5,
    longThreshold: 100_000,
  },
  'claude-sonnet-5-5': { inputPerM: 2, outputPerM: 10 },
};

export const DEFAULT_MODEL = 'claude-haiku-5-5';
/** Keep prompts safely below the 100k long-prompt threshold. */
export const MAX_PROMPT_TOKENS = 90_000;

export function costUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICES[model] ?? MODEL_PRICES[DEFAULT_MODEL]!;
  const long = p.longThreshold !== undefined && inputTokens > p.longThreshold;
  const inRate = long ? (p.longInputPerM ?? p.inputPerM) : p.inputPerM;
  const outRate = long ? (p.longOutputPerM ?? p.outputPerM) : p.outputPerM;
  return (inputTokens * inRate + outputTokens * outRate) / 1_000_000;
}

/** Rough token estimate for budgeting before a call (about 4 characters per token). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export type BudgetTier = 'none' | 'frugal' | 'normal' | 'generous';

/** Monthly AI budget per product in euro. */
export const TIER_CAP_EUR: Record<BudgetTier, number> = {
  none: 0,
  frugal: 0.05,
  normal: 0.25,
  generous: 1,
};
export const GLOBAL_CAP_EUR = 2;
/** Advice is automatic while an average advice costs less than this; otherwise on request. */
export const AUTO_ADVICE_MAX_EUR = 0.02;

export type AdviceMode = 'auto' | 'on_request' | 'off';

export interface SpendState {
  tier: BudgetTier;
  productSpentThisMonthEur: number;
  globalSpentThisMonthEur: number;
  globalCapEur?: number;
}

export type SpendDecision =
  { allowed: true } | { allowed: false; reason: 'tier_none' | 'product_cap' | 'global_cap' };

export function canSpend(state: SpendState, estimateEur: number): SpendDecision {
  if (state.tier === 'none') return { allowed: false, reason: 'tier_none' };
  if (state.globalSpentThisMonthEur + estimateEur > (state.globalCapEur ?? GLOBAL_CAP_EUR))
    return { allowed: false, reason: 'global_cap' };
  if (state.productSpentThisMonthEur + estimateEur > TIER_CAP_EUR[state.tier])
    return { allowed: false, reason: 'product_cap' };
  return { allowed: true };
}

/** Effective advice mode given the user's choice and the average cost of past advice calls. */
export function adviceMode(
  preferred: AdviceMode,
  tier: BudgetTier,
  avgAdviceEur: number | null,
): AdviceMode {
  if (preferred === 'off' || tier === 'none') return 'off';
  if (preferred === 'on_request') return 'on_request';
  if (avgAdviceEur !== null && avgAdviceEur >= AUTO_ADVICE_MAX_EUR) return 'on_request';
  return 'auto';
}

/**
 * Expected monthly AI spend for one product, for the wizard's estimate: a weekly re-discovery that
 * judges a few doubtful matches, plus advice after price changes (more often on a bigger budget).
 */
export function estimateMonthlyUsd(tier: BudgetTier, model = DEFAULT_MODEL): number {
  if (tier === 'none') return 0;
  const advicePerMonth = { frugal: 4, normal: 8, generous: 16 }[tier];
  const rediscovery = 4 * costUsd(model, 3_000, 300);
  const advice = advicePerMonth * costUsd(model, 2_000, 250);
  return rediscovery + advice;
}
