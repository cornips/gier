import { describe, expect, it } from 'vitest';
import {
  generateKeyPair,
  HEADERS,
  RelayClient,
  RelayError,
  signRequest,
} from '@gier/relay-protocol';
import { defang, notificationHtml } from '../src/messages';
import { makeRelay } from './harness';

const ALICE = 1001;
const BOB = 2002;

async function linked(relay = makeRelay(), chat = ALICE, subject = 'subject-0001') {
  const inst = await relay.register();
  const { code } = await inst.linkCode(subject);
  await relay.text(chat, `/start ${code}`);
  return { relay, inst };
}

describe('webhook', () => {
  it('ignores requests without the right secret', async () => {
    const relay = makeRelay();
    const res = await relay.update(
      { message: { message_id: 1, chat: { id: 1, type: 'private' }, text: '/help' } },
      'nope',
    );
    expect(res.status).toBe(401);
    expect(relay.messages()).toHaveLength(0);
  });

  it('ignores group chats', async () => {
    const relay = makeRelay();
    await relay.update({
      message: { message_id: 1, chat: { id: -5, type: 'group' }, text: '/start' },
    });
    expect(relay.messages()).toHaveLength(0);
  });
});

describe('registration', () => {
  const body = (token: string) =>
    JSON.stringify({
      base_url: 'https://x.example',
      public_key: 'A'.repeat(43),
      registration_token: token,
    });
  const post = (relay: ReturnType<typeof makeRelay>, token: string) =>
    relay.app.request('/v1/installations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body(token),
    });

  it('is closed without a registration token', async () => {
    const res = await post(makeRelay({ REGISTRATION_TOKEN: '' }), 'anything');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'registration_closed' });
  });

  it('refuses a wrong token and accepts the right one', async () => {
    const relay = makeRelay();
    expect((await post(relay, 'wrong')).status).toBe(403);
    expect((await post(relay, 'reg-token')).status).toBe(201);
  });
});

describe('signed requests', () => {
  it('refuses unsigned, stale, tampered and replayed requests', async () => {
    const relay = makeRelay();
    const inst = await relay.register();

    expect((await relay.app.request('/v1/links')).status).toBe(401);

    const headers = await signRequest({
      installationId: inst.id,
      privateKey: inst.keys.privateKey,
      method: 'GET',
      path: '/v1/links',
      body: '',
      now: new Date(relay.deps.now().getTime() - 10 * 60_000),
    });
    const stale = await relay.app.request('/v1/links', { headers });
    expect(await stale.json()).toEqual({ error: 'stale_timestamp' });

    const fresh = await signRequest({
      installationId: inst.id,
      privateKey: inst.keys.privateKey,
      method: 'GET',
      path: '/v1/links',
      body: '',
      now: relay.deps.now(),
    });
    const tampered = await relay.app.request('/v1/links?subject=subject-0001', { headers: fresh });
    expect(await tampered.json()).toEqual({ error: 'bad_signature' });

    expect((await relay.app.request('/v1/links', { headers: fresh })).status).toBe(200);
    const again = await relay.app.request('/v1/links', { headers: fresh });
    expect(await again.json()).toEqual({ error: 'replayed' });
  });

  it('keeps installations apart', async () => {
    const { relay, inst } = await linked();
    const other = await relay.register('https://other.example');
    const [link] = await inst.links();
    expect(await other.links()).toEqual([]);
    expect((await other.call('DELETE', `/v1/links/${link!.id}`)).status).toBe(404);
    expect(await inst.links()).toHaveLength(1);
  });

  it('rejects a forged installation header', async () => {
    const relay = makeRelay();
    const inst = await relay.register();
    const headers = await signRequest({
      installationId: inst.id,
      privateKey: inst.keys.privateKey,
      method: 'GET',
      path: '/v1/links',
      body: '',
      now: relay.deps.now(),
    });
    const other = await relay.register('https://other.example');
    const res = await relay.app.request('/v1/links', {
      headers: { ...headers, [HEADERS.installation]: other.id },
    });
    expect(res.status).toBe(401);
  });
});

describe('linking with /start', () => {
  it('links a chat with a one-time code and confirms the installation address', async () => {
    const relay = makeRelay();
    const inst = await relay.register();
    const { code, url } = await inst.linkCode();
    expect(url).toBe(`https://t.me/gier_test_bot?start=${code}`);

    await relay.text(ALICE, `/start ${code}`);
    expect(relay.last().body.text).toContain('gier.example.com/gier');
    expect(await inst.links('subject-0001')).toHaveLength(1);
    // Gier never gets to see the chat id.
    expect(JSON.stringify(await inst.links())).not.toContain(String(ALICE));

    await relay.text(BOB, `/start ${code}`);
    expect(relay.last().body.text).toContain('verlopen of al gebruikt');
    expect(await inst.links()).toHaveLength(1);
  });

  it('refuses expired codes', async () => {
    const relay = makeRelay();
    const inst = await relay.register();
    const { code } = await inst.linkCode();
    relay.advance(11 * 60_000);
    await relay.text(ALICE, `/start ${code}`, 'en');
    expect(relay.last().body.text).toContain('expired');
  });

  it('stores the chat id encrypted', async () => {
    const { relay } = await linked();
    const row = relay.sqlite.prepare('SELECT * FROM links').get() as Record<string, string>;
    expect(JSON.stringify(row)).not.toContain(String(ALICE));
  });

  it('unlinks with /stop and when the user blocks the bot', async () => {
    const { relay, inst } = await linked();
    await relay.text(ALICE, '/stop');
    const button = (
      relay.last().body.reply_markup as { inline_keyboard: { callback_data: string }[][] }
    ).inline_keyboard[0]![0]!;
    await relay.press(ALICE, button.callback_data);
    expect(await inst.links()).toEqual([]);

    const { code } = await inst.linkCode();
    await relay.text(ALICE, `/start ${code}`);
    expect(await inst.links()).toHaveLength(1);
    await relay.update({
      my_chat_member: {
        chat: { id: ALICE, type: 'private' },
        new_chat_member: { status: 'kicked' },
      },
    });
    expect(await inst.links()).toEqual([]);
  });
});

describe('notifications', () => {
  it('sends to every linked chat with a button that stays on the installation', async () => {
    const { relay, inst } = await linked();
    const { code } = await inst.linkCode('subject-0002');
    await relay.text(BOB, `/start ${code}`);

    const res = await inst.notify({
      kind: 'deal',
      title: '20% goedkoper · <Weber>',
      body: 'bol.com: € 279,99. Zie https://evil.example en @someone',
      path: '/p/42',
      lang: 'nl',
    });
    expect(await res.json()).toEqual({ sent: 2, failed: 0, removed: 0 });
    const [a, b] = relay.messages().slice(-2);
    expect(a!.body.chat_id).toBe(String(ALICE));
    expect(b!.body.chat_id).toBe(String(BOB));
    const text = String(a!.body.text);
    expect(text).toContain('&lt;Weber&gt;');
    expect(text).not.toContain('bol.com');
    expect(text).not.toContain('https://');
    expect(text).not.toContain('@someone');
    expect(text).toContain('<i>via Gier</i>');
    expect(a!.body.reply_markup).toEqual({
      inline_keyboard: [[{ text: 'Bekijk', url: 'https://gier.example.com/gier/p/42' }]],
    });
  });

  it('can target one user', async () => {
    const { relay, inst } = await linked();
    const { code } = await inst.linkCode('subject-0002');
    await relay.text(BOB, `/start ${code}`);
    await inst.notify({ kind: 'test', title: 'Hoi', subject: 'subject-0002' });
    expect(relay.last().body.chat_id).toBe(String(BOB));
  });

  it('refuses links to other sites', async () => {
    const { inst } = await linked();
    const res = await inst.notify({ kind: 'deal', title: 'x', path: '//evil.example/p' });
    expect(res.status).toBe(400);
  });

  it('sends an idempotency key only once', async () => {
    const { relay, inst } = await linked();
    const n = { kind: 'deal', title: 'x', idempotency_key: 'notification-1' };
    await inst.notify(n);
    const before = relay.messages().length;
    expect(await (await inst.notify(n)).json()).toMatchObject({ duplicate: true });
    expect(relay.messages()).toHaveLength(before);
  });

  it('drops links of chats that blocked the bot', async () => {
    const { relay, inst } = await linked();
    relay.tgStatus.set(String(ALICE), 403);
    expect(await (await inst.notify({ kind: 'deal', title: 'x' })).json()).toEqual({
      sent: 0,
      failed: 0,
      removed: 1,
    });
    expect(await inst.links()).toEqual([]);
  });

  it('names the installation when a chat follows more than one', async () => {
    const { relay, inst } = await linked();
    const other = await relay.register('https://other.example');
    const { code } = await other.linkCode();
    await relay.text(ALICE, `/start ${code}`);
    await inst.notify({ kind: 'deal', title: 'x' });
    expect(relay.last().body.text).toContain('via Gier · gier.example.com/gier');
  });

  it('enforces the daily limit', async () => {
    const { inst } = await linked(makeRelay({ DAILY_NOTIFICATION_LIMIT: '2' }));
    await inst.notify({ kind: 'deal', title: '1' });
    await inst.notify({ kind: 'deal', title: '2' });
    expect((await inst.notify({ kind: 'deal', title: '3' })).status).toBe(429);
  });
});

describe('feedback', () => {
  it('is only for linked chats', async () => {
    const relay = makeRelay();
    await relay.text(ALICE, '/feedback het werkt niet');
    expect(relay.last().body.text).toContain('alpha-testers');
    expect(relay.sqlite.prepare('SELECT COUNT(*) AS n FROM feedback').get()).toEqual({ n: 0 });
  });

  it('asks for the kind, takes the text and puts it in Notion', async () => {
    const { relay } = await linked();
    await relay.text(ALICE, '/feedback');
    expect(relay.last().body.text).toBe('Waar gaat het over?');
    await relay.press(ALICE, 'fb:kind:bug');
    await relay.text(ALICE, 'De grafiek laadt niet op mijn telefoon');
    expect(relay.last().body.text).toContain('Bedankt');
    await relay.settle();

    expect(relay.notion).toHaveLength(1);
    const props = relay.notion[0]!.properties as Record<string, Record<string, unknown>>;
    expect(props.Soort).toEqual({ select: { name: 'Bug' } });
    expect(props.Taal).toEqual({ select: { name: 'nl' } });
    expect(JSON.stringify(props.Installatie)).toContain('gier.example.com/gier');
    expect(JSON.stringify(props.Afzender)).toMatch(/tg-[A-Za-z0-9_-]{8}/);
    expect(JSON.stringify(relay.notion[0])).not.toContain(String(ALICE));
    // Delivered: the relay no longer keeps the text.
    expect(relay.sqlite.prepare('SELECT message FROM feedback').get()).toEqual({ message: null });
  });

  it('offers to send free text as feedback', async () => {
    const { relay } = await linked();
    await relay.text(ALICE, 'Kun je ook Action toevoegen?');
    expect(relay.last().body.text).toContain('als feedback sturen');
    await relay.press(ALICE, 'fb:send');
    await relay.settle();
    expect(relay.notion).toHaveLength(1);
  });

  it('keeps feedback when Notion is down and retries later', async () => {
    const { relay } = await linked();
    relay.setNotionStatus(502);
    await relay.text(ALICE, '/feedback werkt niet');
    await relay.settle();
    expect(relay.notion).toHaveLength(0);
    relay.setNotionStatus(200);
    const { syncFeedback } = await import('../src/feedback');
    const { Store } = await import('../src/store');
    expect(await syncFeedback(relay.deps, new Store(relay.deps.env.DB))).toEqual({
      synced: 1,
      failed: 0,
    });
  });

  it('limits how much feedback one chat can send', async () => {
    const { relay } = await linked();
    for (let i = 0; i < 6; i++) await relay.text(ALICE, `/feedback bericht ${i}`);
    expect(relay.last().body.text).toContain('veel feedback');
  });
});

describe('message safety', () => {
  it('neutralises links, e-mail addresses and @names', () => {
    expect(defang('bol.com en www.evil.example/login')).toBe('bol․com en www․evil․example/login');
    expect(defang('mail me@evil.example')).not.toMatch(/@evil\.example/);
    expect(defang('€ 279.99 en v0.1')).toBe('€ 279.99 en v0.1');
  });

  it('escapes HTML', () => {
    expect(notificationHtml({ kind: 'deal', title: '<a href="x">', body: '' })).toContain(
      '&lt;a href="x"&gt;',
    );
  });
});

describe('RelayClient against the relay', () => {
  it('registers, links, notifies and unlinks', async () => {
    const relay = makeRelay();
    const http = ((input: string | URL | Request, init?: RequestInit) =>
      relay.app.request(String(input), init)) as typeof fetch;
    const keys = await generateKeyPair();
    const installationId = await RelayClient.register(
      'https://relay.test',
      {
        base_url: 'https://gier.example.com',
        public_key: keys.publicKey,
        registration_token: 'reg-token',
      },
      http,
    );
    const client = new RelayClient(
      'https://relay.test',
      async () => ({ installationId, privateKey: keys.privateKey }),
      http,
    );
    const code = await client.createLinkCode('subject-0001', 'en');
    await relay.text(ALICE, `/start ${code.code}`, 'en');
    const [link] = await client.links('subject-0001');
    expect(link?.lang).toBe('en');
    expect(await client.notify({ kind: 'test', title: 'Test', path: '/notifications' })).toEqual({
      sent: 1,
      failed: 0,
      removed: 0,
    });
    await client.unlink(link!.id);
    expect(await client.links()).toEqual([]);
    await expect(client.unlink(link!.id)).rejects.toBeInstanceOf(RelayError);
  });
});
