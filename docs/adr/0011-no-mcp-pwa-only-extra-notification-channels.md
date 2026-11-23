# ADR-011: No MCP, PWA only, extra notification channels

- Status: Accepted
- Date: 2026-11-22

## Context

An MCP integration works the wrong way round for this use case, and a native companion app is not needed.

## Decision

- No MCP server. Gier calls the AI, not the other way round.
- The PWA is the only client. Web Push via VAPID; on iOS this requires adding the app to the home screen.
- Fallback channels when push is not possible: Telegram bot, ntfy and a Home Assistant webhook.
- Quiet hours 22:00–07:00 Europe/Amsterdam; only urgent notifications (top deals) come through.

## Consequences

A weekly digest summarises the week instead of many small pings.
