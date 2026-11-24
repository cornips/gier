# ADR-006: Reading prices

- Status: Accepted
- Date: 2026-11-22

## Context

Shops expose prices in different ways and some render them with JavaScript.

## Decision

- Order: JSON-LD `Product/Offer` → microdata → learned CSS selectors → Cloudflare Browser Run `/content` for JavaScript pages.
- A polite fetcher: one request at a time per domain, a minimum interval, an honest user agent, bot-wall detection.
- Amended 2026-11-24: Gier no longer follows robots.txt. It does what its user would otherwise do by hand (search shops, open product pages, track prices) and reports only to that user; it does not index or republish. robots.txt is meant for crawlers of that kind.
- Adaptive interval of 4–12 hours with jitter and backoff on failures; heartbeat points when nothing changed.

## Consequences

Low load on shops. Price history is a step series: a price holds until the next observation.
