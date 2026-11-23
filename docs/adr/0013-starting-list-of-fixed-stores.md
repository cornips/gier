# ADR-013: Starting list of fixed stores

- Status: Accepted
- Date: 2026-11-22

## Context

Discovery works better when it starts from shops that are known to be reliable. Gier targets the Dutch market first, so it ships with a list of 38 well-known Dutch shops, each with rules about which offers count.

## Decision

- Seeded from `packages/core/src/stores/registry.ts` on first start; seeding never overwrites changes made in the app.
- Default rules:
  - bol: only offers _sold by bol_, partner sellers only as a fallback.
  - Amazon.nl: only offers _sold by Amazon_, and only counted as the cheapest store when it is at least 5% cheaper than the next one. This default reflects concerns about Amazon's business practices: a small price difference is not worth the trade-off.
  - Brand stores (e.g. Rituals, Nike) only for their own brands.
  - Sligro and Makro need a login and show prices excluding VAT.
  - Lidl, Aldi and Action have a limited online range.
- Every preference is a default, not a verdict: users can set the preference percentage of any store in the store registry (0% removes it), trust or block stores, and add their own fixed stores.
- Shops without a known domain (Robbshop, OFM, Stumpel) are marked for research.

## Consequences

The list grows with learned stores; fixed stores are always searched first. Reported prices are always the real prices; preferences only affect which store is shown as cheapest.
