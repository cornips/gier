# ADR-010: Deal verdict and fake discounts

- Status: Accepted
- Date: 2026-11-22

## Context

[Research by the Consumentenbond (2026)](https://www.consumentenbond.nl/acties-claims/nieuws/2026/nepaanbiedingen) showed common tricks in Dutch web shops: raising prices before a sale, inflated percentages, unused list prices and endless sales.

## Decision

- Verdict labels: top deal, good, normal, expensive, or _not enough history_ (< 30 days).
- Eight checks, all based on Gier's own observations, never on shop claims alone:
  1. raised before the sale; 2. claimed vs real percentage against the 30-day low; 3. list price no tracked shop charges; 4. false "usually" price; 5. inflated was-price; 6. deal label without a drop; 7. endless sale; 8. cheaper elsewhere.
- Each finding carries its evidence (amounts in cents) and is shown as plain text.

## Consequences

Fake-discount alerts are possible from day one; percentage checks wait for 30 days of history.
