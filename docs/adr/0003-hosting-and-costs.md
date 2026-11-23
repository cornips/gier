# ADR-003: Hosting and costs

- Status: Accepted
- Date: 2026-11-22

## Context

Only usage-based costs are acceptable; no fixed monthly fees. Background work must keep running when no browser is open.

## Decision

- Gier is self-hosted as two containers: `gier` and `searxng` (`compose.yaml`). A ready image is published to `ghcr.io/cornips/gier`; building locally works too.
- Gier runs at the site root or below any path (`GIER_BASE_PATH`); one build serves both.
- Paid services are optional and metered: Claude Haiku tokens, Brave Search fallback queries, Cloudflare Browser Run minutes. Each has a hard monthly cap.

## Consequences

All scheduling runs on the server. iOS background tasks are not relied on. Where and how Gier is hosted is up to whoever runs it.
