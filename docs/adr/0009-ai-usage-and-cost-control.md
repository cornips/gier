# ADR-009: AI usage and cost control

- Status: Accepted
- Date: 2026-11-22

## Context

AI is useful for recognition, matching and buying advice, but costs must stay visible and small.

## Decision

- Model: Claude Haiku via the Messages API. Every call is logged with tokens and cost, per product.
- Budget tiers per product: none (€0), frugal (€0.05), normal (€0.25), generous (€1) per month; a global cap of €2 per month.
- Buying advice runs automatically while an average advice costs less than €0.02; otherwise only on request. Without budget the deal verdict (ADR-010) is the fallback.
- Prompts stay below the long-context price threshold.

## Consequences

The costs screen shows spend per product and the caps.
