# ADR-016: Shared Telegram bot through a relay

- Status: Accepted
- Date: 2026-11-24
- Extends: ADR-011

## Context

Gier can send notifications through Telegram (ADR-011). Until now every installation needed its own
bot and had to look up a chat id by hand. Users should instead be able to link one shared bot with a
`/start` command, also when they use someone else's installation.

The bot token cannot be shared. Telegram delivers a bot's updates to exactly one webhook, and whoever
holds the token can message every chat that ever started the bot.

## Decision

### Relay

- A small central service, **gier-relay**, holds the token of the shared bot. It is a Cloudflare
  Worker with D1 (SQLite) in `apps/relay`, open source like the rest of Gier.
- The bot token and every other secret exist only as Worker secrets, never in the repository or in an
  installation.
- Telegram updates arrive through a webhook. The relay only accepts requests carrying the
  `secret_token` given to `setWebhook`, compared in constant time.

### Installations

- An installation creates an Ed25519 key pair and registers with its public key and its public
  address (`base_url`). The relay stores only the public key.
- Registering requires a **registration token** from whoever runs the relay. During the alpha this
  keeps registration closed. Opening it up is a separate, later decision.
- Every request from an installation is signed over method, path, timestamp, a nonce and the SHA-256
  of the body. Clock skew is limited to ±5 minutes and each nonce works once, so requests cannot be
  replayed.
- Keys can be replaced with a request signed by the old key.

### Linking

1. In Gier a user chooses _Link Telegram_. Gier asks for a link code for a **subject**: a
   pseudonymous reference to that user. The relay never sees an email address.
2. The code is 128 random bits, works once and is valid for 10 minutes. The relay stores only its
   hash.
3. Gier shows `https://t.me/<bot>?start=<code>` and polls the status until the link exists, so Gier
   does not have to be reachable from the internet.
4. The bot confirms the link and names the address of the installation. Unlinking takes one tap.
5. Gier never sees a chat id.

### Notifications

- Gier sends the kind of notification, a title, a body (plain text, already translated) and a path
  inside the installation.
- The relay builds the message: everything escaped, fixed maximum lengths, link-like text and
  @names made harmless, and the _View_ button always points to `base_url` + path. An installation
  cannot send a link to another domain.
- Every message ends with _via Gier_. When a chat is linked to more than one installation, the
  address of the installation is added.
- Without a subject a notification goes to every link of the installation: all users of an
  installation see the same products. With a subject it goes to that user only. Per-user preferences
  are a later decision.
- An `idempotency_key` prevents sending the same notification twice. When a user blocks the bot,
  that link is removed.

### Bot

- Commands: `/start`, `/status`, `/stop`, `/feedback`, `/privacy` and `/help`, in Dutch or English
  following the user's Telegram language.
- No admin commands in the public bot. Administration happens outside the bot.
- Private chats only; groups are off.

### Feedback during the alpha

- Linked users can send a bug, idea or question with `/feedback` or the _Give feedback_ button.
  Chats that are not linked cannot, so feedback does not fill up with spam.
- Feedback goes to the same Notion database as the in-app feedback, with the same schema. The sender
  is a pseudonym.
- The relay writes to D1 first and then to Notion. When that fails, a scheduled job retries. The text
  is removed from D1 once it is in Notion.

### Privacy

- Stored: the encrypted chat id, language, the installation and subject of a link, and timestamps.
- Not stored: Telegram names and the content of notifications.
- `/privacy` explains this. `/stop` removes a link.

### Own bot remains possible

Without `GIER_RELAY_URL`, Gier keeps using its own bot token and chat id as before.

## Consequences

- There is one central service. When it is down, Telegram notifications do not arrive; Web Push,
  ntfy and Home Assistant keep working.
- The relay is designed for the free tier of Cloudflare Workers. Under abuse it refuses requests
  instead of running up costs.
- Gier and the relay share a protocol package (`packages/relay-protocol`) with schemas and signing.
- Testing uses a separate test bot, since a bot can have only one webhook.

## Rejected

- **Sharing the token with installations:** unsafe and technically unworkable (one webhook per bot).
- **Fixed message templates in the relay:** safer, but every text would live in two places. To be
  revisited when registration opens up.
- **A callback from the relay to Gier:** many installations are not reachable from the internet;
  Gier polls instead.
- **Admin commands in the bot:** the bot is public; there is no reason to expose admin functions.
- **Group chats:** later, together with per-user notifications.
