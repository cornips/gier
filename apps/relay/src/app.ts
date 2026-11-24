import { Hono, type Context } from 'hono';
import {
  HEADERS,
  linkCodeRequest,
  notificationRequest,
  randomToken,
  registerRequest,
  rotateKeyRequest,
  safeEqual,
  sha256Hex,
  subjectSchema,
  timestampFresh,
  updateInstallationRequest,
  verifySignature,
} from '@gier/relay-protocol';
import { handleUpdate } from './bot';
import { dailyLimit, LIMITS, type Deps } from './env';
import { dataKeys } from './keys';
import { hostOf, notificationHtml, t } from './messages';
import { Store, type Installation } from './store';
import { Telegram, TelegramError, type TgUpdate } from './telegram';

type Vars = { installation: Installation; body: string };
type C = Context<{ Variables: Vars }>;

const json = (c: C, status: number, error: string, headers: Record<string, string> = {}) => {
  for (const [k, v] of Object.entries(headers)) c.header(k, v);
  return c.json({ error }, status as 400);
};

/** The relay as a Hono app. Everything outside the Worker runtime comes in through `deps`. */
export function createApp(deps: Deps) {
  const store = new Store(deps.env.DB);
  const now = () => deps.now().getTime();
  const app = new Hono<{ Variables: Vars }>();

  app.onError((err, c) => {
    if (err instanceof SyntaxError || (err as { name?: string }).name === 'ZodError')
      return c.json({ error: 'invalid_request' }, 400);
    console.error('relay error', err);
    return c.json({ error: 'internal' }, 500);
  });

  app.get('/healthz', (c) => c.json({ ok: true }));

  // --- Telegram ---------------------------------------------------------------

  app.post('/telegram/webhook', async (c) => {
    const secret = c.req.header('x-telegram-bot-api-secret-token') ?? '';
    if (!deps.env.TELEGRAM_WEBHOOK_SECRET || !safeEqual(secret, deps.env.TELEGRAM_WEBHOOK_SECRET))
      return c.json({ error: 'unauthorized' }, 401);
    const update = (await c.req.json().catch(() => null)) as TgUpdate | null;
    if (update) {
      try {
        await handleUpdate(deps, store, update);
      } catch (e) {
        // Always 200: otherwise Telegram keeps redelivering the same update.
        console.error('update failed', e);
      }
    }
    return c.json({ ok: true });
  });

  // --- Registration (alpha: only with the registration token) -----------------

  app.post('/v1/installations', async (c) => {
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
    if (!(await store.hit(`reg:${ip}`, 86_400_000, LIMITS.registrationsPerIpPerDay, now())))
      return json(c, 429, 'too_many_requests', { 'retry-after': '3600' });
    const body = registerRequest.parse(await c.req.json());
    const token = deps.env.REGISTRATION_TOKEN;
    if (!token) return json(c, 403, 'registration_closed');
    if (!safeEqual(body.registration_token, token))
      return json(c, 403, 'invalid_registration_token');
    const id = `inst_${randomToken(12)}`;
    await store.createInstallation({
      id,
      base_url: body.base_url,
      public_key: body.public_key,
      created_at: now(),
    });
    return c.json({ installation_id: id }, 201);
  });

  // --- Signed API --------------------------------------------------------------

  const signed = app.basePath('/v1');
  signed.use('*', async (c, next) => {
    if (c.req.method === 'POST' && c.req.path === '/v1/installations') return next();
    const id = c.req.header(HEADERS.installation) ?? '';
    const timestamp = c.req.header(HEADERS.timestamp) ?? '';
    const nonce = c.req.header(HEADERS.nonce) ?? '';
    const signature = c.req.header(HEADERS.signature) ?? '';
    if (!id || !nonce || !signature || !/^[A-Za-z0-9_-]{16,64}$/.test(nonce))
      return json(c, 401, 'unsigned');
    if (!timestampFresh(timestamp, deps.now())) return json(c, 401, 'stale_timestamp');
    const installation = await store.installation(id);
    if (!installation) return json(c, 401, 'unknown_installation');
    if (installation.status !== 'active') return json(c, 403, 'installation_blocked');
    const url = new URL(c.req.url);
    const body = await c.req.text();
    const valid = await verifySignature({
      publicKey: installation.public_key,
      method: c.req.method,
      path: url.pathname + url.search,
      timestamp,
      nonce,
      body,
      signature,
    });
    if (!valid) return json(c, 401, 'bad_signature');
    if (!(await store.useNonce(id, nonce, now()))) return json(c, 401, 'replayed');
    c.set('installation', installation);
    c.set('body', body);
    await next();
  });

  const bodyOf = (c: C) => JSON.parse(c.get('body') || '{}') as unknown;

  signed.patch('/installations/self', async (c) => {
    const { base_url } = updateInstallationRequest.parse(bodyOf(c));
    await store.setBaseUrl(c.get('installation').id, base_url);
    return c.json({ ok: true });
  });

  signed.post('/installations/rotate-key', async (c) => {
    const { public_key } = rotateKeyRequest.parse(bodyOf(c));
    await store.setPublicKey(c.get('installation').id, public_key);
    return c.json({ ok: true });
  });

  signed.delete('/installations/self', async (c) => {
    await store.deleteInstallation(c.get('installation').id);
    return c.json({ ok: true });
  });

  signed.post('/link-codes', async (c) => {
    const inst = c.get('installation');
    const req = linkCodeRequest.parse(bodyOf(c));
    if (!(await store.hit(`code:${inst.id}`, 3600_000, LIMITS.linkCodesPerHour, now())))
      return json(c, 429, 'too_many_requests', { 'retry-after': '600' });
    const code = randomToken(16);
    const expires = now() + LIMITS.linkCodeTtlMs;
    await store.createLinkCode({
      code_hash: await sha256Hex(code),
      installation_id: inst.id,
      subject: req.subject,
      lang: req.lang ?? null,
      expires_at: expires,
    });
    return c.json(
      {
        code,
        url: `https://t.me/${deps.env.BOT_USERNAME}?start=${code}`,
        expires_at: new Date(expires).toISOString(),
      },
      201,
    );
  });

  signed.get('/links', async (c) => {
    const subject = c.req.query('subject');
    if (subject !== undefined && !subjectSchema.safeParse(subject).success)
      return json(c, 400, 'invalid_request');
    const links = await store.links(c.get('installation').id, subject);
    return c.json({
      links: links.map((l) => ({
        id: l.id,
        subject: l.subject,
        lang: l.lang,
        created_at: new Date(l.created_at).toISOString(),
      })),
    });
  });

  signed.delete('/links/:id', async (c) => {
    const ok = await store.deleteLink(c.req.param('id'), {
      installationId: c.get('installation').id,
    });
    return ok ? c.json({ ok: true }) : json(c, 404, 'not_found');
  });

  signed.post('/notifications', async (c) => {
    const inst = c.get('installation');
    const n = notificationRequest.parse(bodyOf(c));
    if (n.idempotency_key && !(await store.useDelivery(inst.id, n.idempotency_key, now())))
      return c.json({ sent: 0, failed: 0, removed: 0, duplicate: true });
    if (!(await store.hit(`notify:${inst.id}`, 86_400_000, dailyLimit(deps.env), now())))
      return json(c, 429, 'daily_limit', { 'retry-after': '3600' });

    const links = await store.links(inst.id, n.subject);
    const keys = await dataKeys(deps.env.DATA_KEY);
    const tg = new Telegram(deps);
    let sent = 0;
    let failed = 0;
    let removed = 0;
    let retryAfter: number | undefined;
    for (const link of links) {
      const lang = n.lang ?? link.lang;
      const multiple = (await store.installationCount(link.chat_hash)) > 1;
      const html = notificationHtml({
        kind: n.kind,
        title: n.title,
        body: n.body,
        ...(multiple ? { host: hostOf(inst.base_url) } : {}),
      });
      const keyboard = n.path
        ? [[{ text: t(lang).view, url: `${inst.base_url}${n.path}` }]]
        : undefined;
      try {
        await tg.send(await keys.decrypt(link.chat_enc), html, keyboard);
        sent++;
      } catch (e) {
        if (e instanceof TelegramError && e.gone) {
          await store.deleteLink(link.id, { installationId: inst.id });
          removed++;
        } else {
          failed++;
          if (e instanceof TelegramError && e.retryAfter) retryAfter = e.retryAfter;
        }
      }
    }
    if (retryAfter) c.header('retry-after', String(retryAfter));
    return c.json({ sent, failed, removed });
  });

  return app;
}
