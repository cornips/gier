import { eq } from 'drizzle-orm';
import { stores } from '@gier/db';
import type { Ctx } from '../context';
import { encrypt } from '../lib/crypto';
import { translator } from '../i18n';

/**
 * Cloudflare Browser Run (formerly Browser Rendering), used for JavaScript-only shop pages and for the
 * login handoff of ADR-014. Requires CLOUDFLARE_ACCOUNT_ID and an API token with Browser Rendering Edit.
 */
const base = (ctx: Ctx) =>
  `https://api.cloudflare.com/client/v4/accounts/${ctx.env.CLOUDFLARE_ACCOUNT_ID}/browser-run`;

export const browserRunAvailable = (ctx: Ctx) =>
  Boolean(ctx.env.CLOUDFLARE_ACCOUNT_ID && ctx.env.CLOUDFLARE_API_TOKEN);

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
}

/** Rendered HTML via the /content quick action. Cookies come from a stored login session, if any. */
export async function renderHtml(
  ctx: Ctx,
  url: string,
  cookies: StoredCookie[] = [],
): Promise<string | null> {
  if (!browserRunAvailable(ctx)) return null;
  const res = await ctx.http(`${base(ctx)}/content`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${ctx.env.CLOUDFLARE_API_TOKEN}`,
    },
    body: JSON.stringify({
      url,
      cookies: cookies.length ? cookies : undefined,
      userAgent: ctx.env.USER_AGENT,
      gotoOptions: { waitUntil: 'networkidle2', timeout: 30_000 },
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { success: boolean; result?: string };
  return data.success && typeof data.result === 'string' ? data.result : null;
}

export interface LoginHandoff {
  id: string;
  storeId: number;
  status: 'waiting' | 'done' | 'failed' | 'expired';
  liveViewUrl: string | null;
  error?: string;
  startedAt: number;
}

const handoffs = new Map<string, LoginHandoff>();

export const getHandoff = (id: string) => handoffs.get(id) ?? null;

/**
 * Starts a remote browser on the store's login page and returns a Live View URL for the user. When the
 * user finishes (Cloudflare.handoffComplete), the cookies are encrypted and stored. The password is typed
 * by the user inside the remote browser and never passes through Gier.
 */
export async function startLoginHandoff(
  ctx: Ctx,
  storeId: number,
  loginUrl: string,
): Promise<LoginHandoff> {
  if (!browserRunAvailable(ctx)) throw new Error('Browser Run is not configured');
  const { chromium } = await import('playwright-core');
  const id = crypto.randomUUID();
  const handoff: LoginHandoff = {
    id,
    storeId,
    status: 'waiting',
    liveViewUrl: null,
    startedAt: Date.now(),
  };
  handoffs.set(id, handoff);

  const browser = await chromium.connectOverCDP(
    `wss://api.cloudflare.com/client/v4/accounts/${ctx.env.CLOUDFLARE_ACCOUNT_ID}/browser-run/devtools/browser?keep_alive=600000`,
    { headers: { Authorization: `Bearer ${ctx.env.CLOUDFLARE_API_TOKEN}` } },
  );
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage();
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  const cdp = await context.newCDPSession(page);
  // Cloudflare-specific CDP commands are not in Playwright's protocol typings.
  const send = cdp.send.bind(cdp) as unknown as (
    method: string,
    params?: object,
  ) => Promise<Record<string, unknown>>;
  const live = await send('Cloudflare.getLiveView', { mode: 'tab', expiresInMs: 600_000 });
  handoff.liveViewUrl = String(live.devtoolsFrontendUrl ?? '');

  const done = new Promise<{ success?: boolean; reason?: string }>((resolve) => {
    (
      cdp as unknown as {
        once: (e: string, cb: (x: { success?: boolean; reason?: string }) => void) => void;
      }
    ).once('Cloudflare.handoffComplete', resolve);
  });
  await send('Cloudflare.handoff', {
    instructions: translator(ctx).t('login.instructions'),
    timeout: 600_000,
  });

  void done
    .then(async (result) => {
      if (!result.success) {
        handoff.status = result.reason === 'timeout' ? 'expired' : 'failed';
        handoff.error = result.reason;
        return;
      }
      const cookies = (await context.cookies()) as StoredCookie[];
      ctx.db
        .update(stores)
        .set({
          sessionEncrypted: encrypt(JSON.stringify(cookies), ctx.env.GIER_SECRET),
          sessionUpdatedAt: ctx.now(),
        })
        .where(eq(stores.id, storeId))
        .run();
      handoff.status = 'done';
    })
    .catch((e: unknown) => {
      handoff.status = 'failed';
      handoff.error = e instanceof Error ? e.message : String(e);
    })
    .finally(() => void browser.close().catch(() => undefined));

  return handoff;
}

export const cookieHeader = (cookies: StoredCookie[], domain: string) =>
  cookies
    .filter((c) => domain.endsWith(c.domain.replace(/^\./, '')))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
