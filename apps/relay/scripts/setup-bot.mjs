// Points the bot at the relay and sets its commands and privacy settings (ADR-016).
// Run once after deploying, and again after changing the webhook secret or the bot token:
//
//   TELEGRAM_BOT_TOKEN=… TELEGRAM_WEBHOOK_SECRET=… RELAY_URL=https://… node scripts/setup-bot.mjs
//
// Values come from the environment only, so they do not end up in your shell history files.
const {
  TELEGRAM_BOT_TOKEN: token,
  TELEGRAM_WEBHOOK_SECRET: secret,
  RELAY_URL: relay,
} = process.env;
if (!token || !secret || !relay) {
  console.error('Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and RELAY_URL.');
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  console.error('TELEGRAM_WEBHOOK_SECRET may only contain A-Z a-z 0-9 _ - (max 256).');
  process.exit(1);
}

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  console.log(`✓ ${method}`);
}

const commands = {
  en: [
    ['status', 'Linked installations'],
    ['stop', 'Unlink'],
    ['feedback', 'Share a bug, idea or question'],
    ['privacy', 'What is stored'],
    ['help', 'How it works'],
  ],
  nl: [
    ['status', 'Gekoppelde installaties'],
    ['stop', 'Ontkoppelen'],
    ['feedback', 'Meld een bug, idee of vraag'],
    ['privacy', 'Wat er wordt bewaard'],
    ['help', 'Hoe het werkt'],
  ],
};

await call('setWebhook', {
  url: `${relay.replace(/\/+$/, '')}/telegram/webhook`,
  secret_token: secret,
  allowed_updates: ['message', 'callback_query', 'my_chat_member'],
  drop_pending_updates: true,
});
await call('setMyCommands', {
  commands: commands.en.map(([command, description]) => ({ command, description })),
});
await call('setMyCommands', {
  language_code: 'nl',
  commands: commands.nl.map(([command, description]) => ({ command, description })),
});
await call('setMyDescription', {
  description:
    'Price alerts from Gier, the self-hosted price tracker. Link this chat from Settings → Telegram in Gier.',
});
await call('setMyDescription', {
  language_code: 'nl',
  description:
    'Prijsmeldingen van Gier, de self-hosted prijsvolger. Koppel deze chat via Instellingen → Telegram in Gier.',
});
console.log('Done. Also set "Allow groups" to off in @BotFather (/setjoingroups).');
