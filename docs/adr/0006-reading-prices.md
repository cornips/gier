# ADR-006: Reading prices

- Status: Accepted
- Date: 2026-11-22

## Context

Shops expose prices in different ways and some render them with JavaScript.

## Decision

- Order: JSON-LD `Product/Offer` → microdata → learned CSS selectors → Cloudflare Browser Run `/content` for JavaScript pages.
- A polite fetcher: one request at a time per domain, a minimum interval, robots.txt respected, an honest user agent, bot-wall detection.
- Adaptive interval of 4–12 hours with jitter and backoff on failures; heartbeat points when nothing changed.

## Consequences

Low load on shops. Price history is a step series: a price holds until the next observation.
