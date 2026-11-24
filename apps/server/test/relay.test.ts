import { afterEach, describe, expect, it } from 'vitest';
import { HEADERS, verifySignature } from '@gier/relay-protocol';
import { createApp } from '../src/app';
import { notify } from '../src/services/notify';
import { forgetRelayIdentities, relaySubject } from '../src/services/relay';
import { makeCtx } from './helpers';

/** A stand-in relay that checks signatures the way gier-relay does. */
function fakeRelay() {
  let publicKey = '';
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const links = new Map<string, { id: string; subject: string }[]>();
  const http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = init?.method ?? 'GET';
    const raw = typeof init?.body === 'string' ? init.body : '';
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const path = url.pathname + url.search;
    calls.push({ method, path, body });
    if (path === '/v1/installations') {
      if (body.registration_token !== 'reg') return Response.json({ error: 'x' }, { status: 403 });
      publicKey = String(body.public_key);
      return Response.json({ installation_id: 'inst_test' }, { status: 201 });
    }
    const h = new Headers(init?.headers);
    const ok = await verifySignature({
      publicKey,
      method,
      path,
      body: raw,
      timestamp: h.get(HEADERS.timestamp) ?? '',
      nonce: h.get(HEADERS.nonce) ?? '',
      signature: h.get(HEADERS.signature) ?? '',
    });
    if (!ok || h.get(HEADERS.installation) !== 'inst_test')
      return Response.json({ error: 'bad_signature' }, { status: 401 });
    if (path === '/v1/link-codes')
      return Response.json({
        code: 'c'.repeat(22),
        url: `https://t.me/bot?start=${'c'.repeat(22)}`,
        expires_at: new Date().toISOString(),
      });
    if (path.startsWith('/v1/links?subject=')) {
      const subject = url.searchParams.get('subject')!;
      return Response.json({
        links: (links.get(subject) ?? []).map((l) => ({
          ...l,
          lang: 'nl',
          created_at: new Date().toISOString(),
        })),
      });
    }
    if (method === 'DELETE' && path.startsWith('/v1/links/')) return Response.json({ ok: true });
    if (path === '/v1/notifications') return Response.json({ sent: 1, failed: 0, removed: 0 });
    return Response.json({ error: 'not_found' }, { status: 404 });
  }) as typeof fetch;
  return { http, calls, links };
}

function setup() {
  const ctx = makeCtx(
    {},
    {
      env: {
        GIER_RELAY_URL: 'https://relay.test',
        GIER_RELAY_REGISTRATION_TOKEN: 'reg',
        GIER_PUBLIC_URL: 'https://gier.example.com',
        // Ignored once the relay is configured.
        TELEGRAM_BOT_TOKEN: 'own-bot',
        TELEGRAM_CHAT_ID: '42',
      },
    },
  );
  const relay = fakeRelay();
  ctx.http = relay.http;
  return { ctx, relay, app: createApp(ctx) };
}

afterEach(() => forgetRelayIdentities());

describe('Telegram via the shared relay', () => {
  it('registers once and sends notifications signed, with a path inside Gier', async () => {
    const { ctx, relay } = setup();
    const n = { kind: 'deal' as const, title: 'Topdeal', body: 'B', productId: null, urgent: true };
    const first = await notify(ctx, n);
    await notify(ctx, n);

    expect(first.deliveredVia).toContain('telegram');
    expect(relay.calls.filter((c) => c.path === '/v1/installations')).toHaveLength(1);
    expect(relay.calls[0]!.body.base_url).toBe('https://gier.example.com/gier');
    const sent = relay.calls.filter((c) => c.path === '/v1/notifications');
    expect(sent).toHaveLength(2);
    expect(sent[0]!.body).toMatchObject({ kind: 'deal', title: 'Topdeal', path: '/notifications' });
    // Never the own bot token once the relay is in use.
    expect(relay.calls.some((c) => c.path.includes('own-bot'))).toBe(false);
  });

  it('gives each signed-in user their own link code and status', async () => {
    const { ctx, relay, app } = setup();
    const as = (email: string) => ({ 'cf-access-authenticated-user-email': email });
    const res = await app.request('/gier/api/telegram/link', {
      method: 'POST',
      headers: as('a@x.nl'),
    });
    expect(await res.json()).toMatchObject({ url: expect.stringContaining('t.me') });
    const codeCall = relay.calls.find((c) => c.path === '/v1/link-codes')!;
    expect(codeCall.body.subject).toBe(relaySubject(ctx, 'a@x.nl'));
    expect(JSON.stringify(relay.calls)).not.toContain('a@x.nl');

    relay.links.set(relaySubject(ctx, 'a@x.nl'), [{ id: 'lnk_a', subject: 's' }]);
    const status = await app.request('/gier/api/telegram', { headers: as('a@x.nl') });
    expect(await status.json()).toMatchObject({ mode: 'relay', links: [{ id: 'lnk_a' }] });
    const other = await app.request('/gier/api/telegram', { headers: as('b@x.nl') });
    expect(await other.json()).toMatchObject({ links: [] });

    // Someone else cannot remove your link.
    const del = await app.request('/gier/api/telegram/links/lnk_a', {
      method: 'DELETE',
      headers: as('b@x.nl'),
    });
    expect(del.status).toBe(404);
    const mine = await app.request('/gier/api/telegram/links/lnk_a', {
      method: 'DELETE',
      headers: as('a@x.nl'),
    });
    expect(mine.status).toBe(200);
  });

  it('keeps the own bot when no relay is configured', async () => {
    const ctx = makeCtx({}, { env: { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '42' } });
    const app = createApp(ctx);
    expect(await (await app.request('/gier/api/telegram')).json()).toEqual({
      mode: 'direct',
      links: [],
    });
  });
});
