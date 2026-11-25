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
- Multi-buy promotions (1+1 gratis, 2e halve prijs) lower the compared price only when Gier can tell they belong to this offer. On marketplaces (bol, Amazon) the product page also shows other sellers' and campaign deals, so only a store-specific promotion selector counts there, not a scan of the page. Every promotion records where it was read; the user can see that and mark a deal as wrong for a listing, after which Gier ignores it, including in the price history.

## Consequences

Fake-discount alerts are possible from day one; percentage checks wait for 30 days of history.
