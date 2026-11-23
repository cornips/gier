# ADR-004: Technical stack

- Status: Accepted
- Date: 2026-11-22

## Context

A simple, well-documented setup that is easy to maintain.

## Decision

- pnpm monorepo, TypeScript, ESM. Packages: `@gier/core` (pure logic), `@gier/db` (Drizzle + SQLite), `apps/server` (Hono), `apps/web` (PWA).
- Web: Vite, React, Tailwind CSS v4, shadcn/ui (MIT), Recharts, TanStack Query, react-router, i18next, vite-plugin-pwa (injectManifest).
- Server: Hono on Node 22, Drizzle ORM on better-sqlite3 (WAL), zod, web-push, playwright-core for Browser Run CDP sessions.
- Tests: Vitest with HTML fixtures and an in-memory database.

## Consequences

SQLite keeps years of price history in one file that is easy to back up. The server runs TypeScript via tsx; no separate compile step. Only UI code that may be published under an open-source licence goes into the repository.
