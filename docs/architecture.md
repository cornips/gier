# Architecture

Gier is one Node process plus a SearXNG container. The process serves the API, the PWA and a scheduler.

```
                 ┌─────────────────────────── Docker host ──────────────────────────────┐
 phone/laptop    │  gier (Node 22)                                         searxng      │
 ┌──────────┐    │  ┌───────────────┐  ┌──────────────────────────────┐  ┌──────────┐  │
 │  PWA     │◄──►│  │ Hono /api     │  │ scheduler (every 60 s)       │─►│  search  │  │
 │ (React)  │    │  │ + static PWA  │  │ checks · advice · discovery  │  └──────────┘  │
 └──────────┘    │  └──────┬────────┘  │ · weekly digest              │                │
      ▲ push     │         │           └──────────────┬───────────────┘                │
      │          │         ▼                          ▼                                │
      │          │   SQLite (WAL) ◄──── @gier/core: extract · match · trust · deal checks│
      │          └──────────────────────────────────────────────────────────────────────┘
      │                         │ optional, metered
      └── Web Push / Telegram / ntfy / Home Assistant
                                ├─ Claude Haiku (Messages API)
                                ├─ Brave Search API (fallback)
                                └─ Cloudflare Browser Run (/content, Live View login)
```

## Packages

| Package         | Role                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core` | Pure TypeScript, no I/O: money and units, text normalisation, offer extraction (JSON-LD, microdata, selectors), price history helpers, the eight fake-discount checks and deal verdict, fingerprints and matching, exclusion learning, trust scoring, AI cost model, schedule, known store registry. A browser-safe subset is exported as `@gier/core/browser`. |
| `packages/db`   | Drizzle schema and SQL migrations; `openDb()` opens SQLite in WAL mode and migrates.                                                                                                                                                                                                                                                                            |
| `apps/server`   | Hono API under `${GIER_BASE_PATH}/api`, the scheduler, and services: polite fetcher, search, RDAP, ECB exchange rate, Claude, Browser Run, notifications, discovery, checker, alerts, advice, digest.                                                                                                                                                           |
| `apps/web`      | Vite + React PWA with shadcn/ui, TanStack Query, react-router, i18next and a custom service worker (precache, SPA fallback, push).                                                                                                                                                                                                                              |

## Main flows

**Track a product (wizard).** `POST /discovery/fingerprint` proposes a fingerprint (Claude Haiku, or rules without a key). The user confirms; `POST /products` stores it and starts a discovery run. The run searches (known stores first via `site:` queries), reads up to 30 pages politely, matches each candidate against the fingerprint (AI only for doubtful ones), scores trust and follows up to 20 trusted matches. The web app polls `GET /discovery/:id`. Step 3 sets the AI budget and alerts.

**Checks.** Each tick picks due listings (`next_check_at`), fetches them (static HTML, or Browser Run for JavaScript shops, with the stored session for login shops), applies store rules (seller, VAT), stores a price point only on change (plus daily heartbeats), runs the checks and evaluates alerts. Changed products may get automatic advice when the budget allows.

**Base path and language.** The web build uses relative URLs; the server adds `<base href>` with `GIER_BASE_PATH`, so one image runs at the site root or below a path. The app picks English or a translation from the browser language (or the choice in Settings) and reports it to the server, which uses it for notifications and the AI advice.

**Deal verdict.** Per day the lowest pay price (price + shipping, per unit) across in-stock listings forms the product series. Labels compare the current lowest with the 30-day low, the 90-day median and the all-time low; store preference thresholds (Amazon.nl 5% by default, editable per store) apply when choosing the cheapest store.

## Data

All money is stored in euro cents. Price history is a step series: a price holds until the next observation. The database is a single file (`DATABASE_FILE`), easy to back up and export (`GET /products/:id/export.csv`).

## Security

- Single user and no login of its own: put an authenticating reverse proxy in front if you expose Gier.
- Shop sessions from the login handoff are encrypted with AES-256-GCM (`GIER_SECRET`); passwords never pass through Gier.
- Outbound requests identify themselves with `USER_AGENT` and respect robots.txt.

Decisions and their reasoning: [docs/adr](adr/README.md).
