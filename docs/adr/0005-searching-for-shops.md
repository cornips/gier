# ADR-005: Searching for shops

- Status: Accepted
- Date: 2026-11-22

## Context

Google's Custom Search JSON API is closed to new customers and ends on 1 January 2027, so it cannot be the foundation.

## Decision

- Primary: self-hosted SearXNG with JSON output (free).
- Fallback: Brave Search API, per query, within `BRAVE_MONTHLY_CAP_USD`.
- Queries include `site:` searches for the fixed store list (ADR-013) so known shops are always tried first.

## Consequences

Search quality depends on SearXNG engines; usage is logged per provider and shown on the costs screen.
