// Browser-safe subset of @gier/core (no cheerio / Node APIs) for the web app.
export * from './money';
export * from './units';
export * from './text';
export * from './deal/history';
export * from './deal/checks';
export * from './deal/verdict';
export * from './costs/ai';
export type { ExtractedOffer, ReferenceType, Availability } from './extract/types';
export type { Fingerprint, MatchVerdict } from './match/fingerprint';
export type { TrustVerdict, TrustReason } from './trust/score';
export type { StoreCategory, StoreRules } from './stores/registry';
