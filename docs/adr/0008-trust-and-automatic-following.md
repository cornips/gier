# ADR-008: Trust and automatic following

- Status: Accepted
- Date: 2026-11-22

## Context

Trustworthy shops should be followed automatically; unknown ones should not slip in.

## Decision

- Trust score from: fixed store list, domain age (RDAP), KvK/company details on the page, price outlier (< 0.7× median is suspicious) and third-party marketplace sellers.
- Matches at trusted shops are followed automatically, fixed stores first, up to 20 per product. Doubtful ones are shown with a _follow anyway_ action.
- Weekly re-discovery finds new shops; a notification reports newly followed stores.

## Consequences

The store registry grows over time (_learned_ stores) and can be corrected by hand (trust, block).
