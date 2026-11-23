# ADR-014: Shops that need a login

- Status: Accepted
- Date: 2026-11-22

## Context

Wholesalers such as Sligro and Makro only show prices to logged-in business customers.

## Decision

- The user logs in themselves inside a remote browser: Cloudflare Browser Run with Live View and a human-in-the-loop handoff over CDP.
- Gier never sees or stores the password; it stores only the resulting session cookies, encrypted with AES-256-GCM using `GIER_SECRET`.
- Prices excluding VAT are converted to including VAT for comparison.

## Consequences

Sessions expire; Gier asks to log in again when checks start failing.
