import * as webpush from 'web-push';
import { eq } from 'drizzle-orm';
import { notifications, pushSubscriptions, type Notification } from '@gier/db';
import type { Ctx } from '../context';
import { language, translator } from '../i18n';
import { relayClient, telegramMode } from './relay';

export interface NewNotification {
  productId?: number | null;
  kind: Notification['kind'];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Quiet hours let only top deals through (F29). */
  urgent?: boolean;
}

const QUIET_FROM = 22;
const QUIET_TO = 7;

export function inQuietHours(now: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Europe/Amsterdam',
    }).format(now),
  );
  return hour >= QUIET_FROM || hour < QUIET_TO;
}

const link = (ctx: Ctx, productId?: number | null) =>
  `${ctx.env.GIER_PUBLIC_URL}${ctx.env.GIER_BASE_PATH}/${productId ? `p/${productId}` : 'notifications'}`;

async function sendWebPush(ctx: Ctx, n: NewNotification): Promise<boolean> {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = ctx.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const subs = ctx.db.select().from(pushSubscriptions).all();
  const payload = JSON.stringify({
    title: n.title,
    body: n.body,
    url: link(ctx, n.productId),
    tag: `${n.kind}-${n.productId ?? 0}`,
  });
  let sent = false;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 86_400 },
      );
      sent = true;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410)
        ctx.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)).run();
    }
  }
  return sent;
}

/** Shared bot (ADR-016): the relay sends to every chat linked to this installation. */
async function sendViaRelay(ctx: Ctx, n: NewNotification): Promise<boolean> {
  const client = relayClient(ctx);
  if (!client) return false;
  try {
    const r = await client.notify({
      kind: n.kind,
      title: n.title.slice(0, 120),
      body: n.body.slice(0, 600),
      path: n.productId ? `/p/${n.productId}` : '/notifications',
      lang: language(ctx),
    });
    return r.sent > 0;
  } catch (e) {
    console.warn('Telegram via relay failed', e);
    return false;
  }
}

async function sendTelegram(ctx: Ctx, n: NewNotification): Promise<boolean> {
  const mode = telegramMode(ctx);
  if (mode === 'relay') return sendViaRelay(ctx, n);
  if (mode === 'off') return false;
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = ctx.env;
  const res = await ctx
    .http(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: `*${escapeMd(n.title)}*\n${escapeMd(n.body)}`,
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [
            [{ text: translator(ctx).t('notify.open'), url: link(ctx, n.productId) }],
          ],
        },
      }),
    })
    .catch(() => null);
  return Boolean(res?.ok);
}

const escapeMd = (s: string) => s.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');

async function sendNtfy(ctx: Ctx, n: NewNotification): Promise<boolean> {
  if (!ctx.env.NTFY_URL) return false;
  const res = await ctx
    .http(ctx.env.NTFY_URL, {
      method: 'POST',
      headers: {
        Title: encodeURIComponent(n.title),
        Click: link(ctx, n.productId),
        Tags:
          n.kind === 'deal' ? 'chart_with_downwards_trend' : n.kind === 'fake' ? 'warning' : 'bird',
        ...(ctx.env.NTFY_TOKEN ? { Authorization: `Bearer ${ctx.env.NTFY_TOKEN}` } : {}),
      },
      body: n.body,
    })
    .catch(() => null);
  return Boolean(res?.ok);
}

async function sendHomeAssistant(ctx: Ctx, n: NewNotification): Promise<boolean> {
  if (!ctx.env.HOME_ASSISTANT_WEBHOOK_URL) return false;
  const res = await ctx
    .http(ctx.env.HOME_ASSISTANT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: n.kind,
        title: n.title,
        message: n.body,
        url: link(ctx, n.productId),
        data: n.data ?? {},
      }),
    })
    .catch(() => null);
  return Boolean(res?.ok);
}

/** Stores the notification in the inbox and delivers it to every configured channel. */
export async function notify(ctx: Ctx, n: NewNotification): Promise<Notification> {
  const deliveredVia: string[] = [];
  if (n.urgent || !inQuietHours(ctx.now())) {
    const [push, tg, ntfy, ha] = await Promise.all([
      sendWebPush(ctx, n),
      sendTelegram(ctx, n),
      sendNtfy(ctx, n),
      sendHomeAssistant(ctx, n),
    ]);
    if (push) deliveredVia.push('push');
    if (tg) deliveredVia.push('telegram');
    if (ntfy) deliveredVia.push('ntfy');
    if (ha) deliveredVia.push('home_assistant');
  }
  const [row] = ctx.db
    .insert(notifications)
    .values({
      productId: n.productId ?? null,
      kind: n.kind,
      title: n.title,
      body: n.body,
      data: n.data ?? null,
      deliveredVia,
    })
    .returning()
    .all();
  return row!;
}

export function generateVapidKeys() {
  return webpush.generateVAPIDKeys();
}
