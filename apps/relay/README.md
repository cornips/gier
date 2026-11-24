# gier-relay

One shared Telegram bot for every Gier installation ([ADR-016](../../docs/adr/0016-shared-telegram-bot-relay.md)).
A Cloudflare Worker with D1 keeps the bot token; installations register with an Ed25519 key and sign
every request. Users link their own chat from Gier (Settings → Telegram), which opens the bot with a
one-time `/start` code. Gier never sees a chat id, and the relay never sees an email address.

The bot also takes feedback from linked users (`/feedback`) and writes it to the same Notion database
as the in-app feedback.

You only need this if you want to run a relay yourself. To use an existing relay, set
`GIER_RELAY_URL` and `GIER_RELAY_REGISTRATION_TOKEN` in Gier.

## API

| Method | Path                           | Purpose                                   |
| ------ | ------------------------------ | ----------------------------------------- |
| POST   | `/telegram/webhook`            | Telegram updates (secret header required) |
| POST   | `/v1/installations`            | Register (needs the registration token)   |
| PATCH  | `/v1/installations/self`       | Change the public address                 |
| POST   | `/v1/installations/rotate-key` | Replace the key (signed with the old one) |
| DELETE | `/v1/installations/self`       | Remove the installation and all its links |
| POST   | `/v1/link-codes`               | One-time link for a user (subject)        |
| GET    | `/v1/links?subject=`           | Links of the installation or of one user  |
| DELETE | `/v1/links/{id}`               | Unlink                                    |
| POST   | `/v1/notifications`            | Send to all links, or to one subject      |
| GET    | `/healthz`                     | Health check                              |

All `/v1` requests except registration carry `gier-installation`, `gier-timestamp`, `gier-nonce` and
`gier-signature` headers; see `packages/relay-protocol`.

## Run your own

You need a Cloudflare account (the free Workers plan is enough) and a bot from @BotFather. Use a
separate test bot for development: a bot has only one webhook.

```sh
cd apps/relay
cp wrangler.example.toml wrangler.toml        # git-ignored; set BOT_USERNAME
pnpm wrangler d1 create gier-relay            # put the database_id in wrangler.toml
pnpm migrate                                  # apply migrations/ to the remote database

# Secrets (wrangler asks for the value, so it stays out of your shell history)
pnpm wrangler secret put TELEGRAM_BOT_TOKEN
pnpm wrangler secret put TELEGRAM_WEBHOOK_SECRET   # e.g. openssl rand -hex 32
pnpm wrangler secret put DATA_KEY                  # openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
pnpm wrangler secret put REGISTRATION_TOKEN        # openssl rand -hex 24; hand it to installations you allow
pnpm wrangler secret put NOTION_TOKEN              # optional, for /feedback

pnpm run deploy                               # `pnpm deploy` is a pnpm command; use `run`
TELEGRAM_BOT_TOKEN=… TELEGRAM_WEBHOOK_SECRET=… RELAY_URL=https://gier-relay.<you>.workers.dev \
  node scripts/setup-bot.mjs
```

Keep `DATA_KEY` safe: without it the stored chat ids cannot be read, and every user has to link again.
Without `REGISTRATION_TOKEN` registration is closed.

## Operating

There are no admin commands in the bot. Use D1 directly, for example:

```sh
pnpm wrangler d1 execute gier-relay --remote --command "SELECT id, base_url, status FROM installations"
pnpm wrangler d1 execute gier-relay --remote --command "UPDATE installations SET status = 'blocked' WHERE id = 'inst_…'"
```
