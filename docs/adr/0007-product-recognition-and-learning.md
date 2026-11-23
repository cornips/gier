# ADR-007: Product recognition and learning

- Status: Accepted
- Date: 2026-11-22

## Context

Gier must understand exactly which product is meant (e.g. a deodorant in a specific size), not just similar items.

## Decision

- A fingerprint with brand, line, form, quantity, model and GTIN; each attribute can be locked or loose. Multipacks are optional and compared per unit (per piece or per 100 ml/g).
- Claude Haiku proposes the fingerprint and judges doubtful matches; a rule-based fallback works without AI.
- Exclusions (e.g. _refill_, _travel size_) are learned per category: after the user excludes a term twice it is applied automatically. Refurbished/used terms are always excluded.

## Consequences

Step 1 of the wizard always asks the user to confirm what Gier understood.
