# ADR-002: Scope, language and users

- Status: Accepted
- Date: 2026-11-22

## Context

Gier automates everyday price research: search a product, find the top trustworthy shops, follow them for years and judge whether a deal is real.

## Decision

- Single user, self-hosted. No accounts, no multi-tenancy.
- English is the source language for code, commits, issues, docs and the UI. The UI follows the browser or system language when a translation exists, and can be switched in Settings. Dutch ships as the first translation; more are welcome.
- Netherlands first for shopping: Dutch shops, euro prices, Dutch search results.

## Consequences

No authentication inside Gier: whoever exposes it puts their own authenticating reverse proxy in front. Notifications follow the language the user sees in the app.
