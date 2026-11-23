/** ADR-008: trust without AI. Every verdict lists its reasons so the user can overrule it. */
export type TrustVerdict = 'trusted' | 'doubt' | 'excluded';

export interface TrustSignals {
  fixedStore: boolean;
  previouslyTrusted: boolean;
  blocklisted: boolean;
  domainAgeDays: number | null;
  hasKvk: boolean | null;
  hasReturnPolicy: boolean | null;
  hasTrustmark: boolean | null;
  /** Candidate pay price divided by the median of all matched candidates. */
  priceVsMedian: number | null;
  thirdPartySeller: boolean;
}

export type TrustReason =
  | 'fixed_store'
  | 'previously_trusted'
  | 'blocklisted'
  | 'young_domain'
  | 'unknown_domain_age'
  | 'no_kvk'
  | 'no_return_policy'
  | 'trustmark'
  | 'price_outlier'
  | 'third_party_seller';

export interface TrustResult {
  verdict: TrustVerdict;
  score: number;
  reasons: TrustReason[];
}

export const YOUNG_DOMAIN_DAYS = 180;
export const OUTLIER_RATIO = 0.7;

export function scoreTrust(s: TrustSignals): TrustResult {
  const reasons: TrustReason[] = [];
  if (s.blocklisted) return { verdict: 'excluded', score: 0, reasons: ['blocklisted'] };

  // Fixed and previously trusted stores are trusted, but a third-party marketplace seller still gets a doubt.
  if (s.fixedStore || s.previouslyTrusted) {
    reasons.push(s.fixedStore ? 'fixed_store' : 'previously_trusted');
    if (s.thirdPartySeller)
      return { verdict: 'doubt', score: 0.6, reasons: [...reasons, 'third_party_seller'] };
    return { verdict: 'trusted', score: 1, reasons };
  }

  let score = 0.5;
  if (s.domainAgeDays === null) {
    reasons.push('unknown_domain_age');
    score -= 0.1;
  } else if (s.domainAgeDays < YOUNG_DOMAIN_DAYS) {
    reasons.push('young_domain');
    score -= 0.4;
  } else {
    score += Math.min(0.2, s.domainAgeDays / 3650);
  }
  if (s.hasKvk === false) {
    reasons.push('no_kvk');
    score -= 0.15;
  } else if (s.hasKvk) score += 0.1;
  if (s.hasReturnPolicy === false) {
    reasons.push('no_return_policy');
    score -= 0.1;
  } else if (s.hasReturnPolicy) score += 0.05;
  if (s.hasTrustmark) {
    reasons.push('trustmark');
    score += 0.1;
  }
  if (s.priceVsMedian !== null && s.priceVsMedian < OUTLIER_RATIO) {
    reasons.push('price_outlier');
    score -= 0.35;
  }
  if (s.thirdPartySeller) {
    reasons.push('third_party_seller');
    score -= 0.15;
  }
  score = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  const verdict: TrustVerdict = score >= 0.6 ? 'trusted' : score >= 0.35 ? 'doubt' : 'excluded';
  return { verdict, score, reasons };
}

/** Rough KvK and return-policy detection on a shop's page text (Dutch shops must show their KvK number). */
export function detectShopFacts(text: string): {
  hasKvk: boolean;
  hasReturnPolicy: boolean;
  hasTrustmark: boolean;
} {
  const t = text.toLowerCase();
  return {
    hasKvk: /\b(kvk|kamer van koophandel|chamber of commerce)\b[^\d]{0,20}\d{8}\b/.test(t),
    hasReturnPolicy: /(retourneren|retourbeleid|herroepingsrecht|bedenktijd|returns? policy)/.test(
      t,
    ),
    hasTrustmark: /(thuiswinkel waarborg|webshop keurmerk|trusted shops|safeshops|qshops)/.test(t),
  };
}
