import { describe, expect, it } from 'vitest';
import { setLanguage } from '../src/i18n';
import { notify } from '../src/services/notify';
import { makeCtx } from './helpers';

describe('Telegram notifications', () => {
  it('labels the link button in the user language', async () => {
    const ctx = makeCtx(
      {},
      {
        env: {
          TELEGRAM_BOT_TOKEN: 'test-token',
          TELEGRAM_CHAT_ID: '42',
          GIER_PUBLIC_URL: 'https://gier.example.com',
        },
      },
    );
    const sent: { text: string; url: string }[] = [];
    ctx.http = (async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      sent.push(body.reply_markup.inline_keyboard[0][0]);
      return Response.json({ ok: true });
    }) as typeof fetch;
    const n = { kind: 'deal' as const, title: 'T', body: 'B', productId: null, urgent: true };

    await notify(ctx, n);
    setLanguage(ctx, 'nl');
    await notify(ctx, n);

    expect(sent).toEqual([
      { text: 'View', url: 'https://gier.example.com/gier/notifications' },
      { text: 'Bekijk', url: 'https://gier.example.com/gier/notifications' },
    ]);
  });
});
