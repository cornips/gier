# Changelog

## 0.1.0 — unreleased

- Monorepo with web (PWA), server (Hono + scheduler), core and db packages.
- JSON-LD/microdata extraction with reference prices, claimed discounts and deal labels.
- Product fingerprints, unit pricing, matching, exclusion learning and trust scoring.
- Eight fake-discount checks and deal labels from own price history.
- Discovery via SearXNG with Brave fallback and budget guard.
- Optional Claude Haiku integration with per-product cost logging and budget rules.
- Web Push, Telegram, ntfy and Home Assistant notifications with quiet hours and a weekly digest.
- PWA: overview with filters, product detail (dialog and full page) with price charts, three-step wizard, store
  registry with login handoff and editable store preferences, notifications inbox, costs and settings.
- English UI with a Dutch translation; follows the browser language, switchable in Settings; notifications follow it.
- One build serves Gier at the site root or below any path (`GIER_BASE_PATH`).
- Docker image on GHCR, `compose.yaml` with SearXNG; secrets generated on first start; GitHub Actions CI.
- Demo data script for trying Gier without real shops.
- Shared Telegram bot through gier-relay (ADR-016): a Cloudflare Worker that keeps the bot token, signed
  requests from installations, linking per user with a one-time `/start` code, and `/feedback` for alpha testers.
