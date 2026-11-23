import { eq } from 'drizzle-orm';
import { stores } from '@gier/db';
import type { Ctx } from '../context';
import { encrypt } from '../lib/crypto';
import { translator } from '../i18n';

/**
 * Cloudflare Browser Run (formerly Browser Rendering), used for JavaScript-only shop pages and for the
 * login handoff of ADR-014. Requires CLOUDFLARE_ACCOUNT_ID and an API token with Browser Run Edit.
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
  status: 'waiting' | 'done' | 'failed' | 'expired' | 'cancelled';
  liveViewUrl: string | null;
  error?: string;
  startedAt: number;
}

/** A Browser Run failure the user can act on; `code` is translated in the web app. */
export class BrowserRunError extends Error {
  constructor(
    public readonly code:
      | 'browser_run_rate_limited'
      | 'browser_run_daily_limit'
      | 'browser_run_unauthorized'
      | 'browser_run_failed',
    message: string,
  ) {
    super(message);
  }
}

export function classifyBrowserRunError(e: unknown): BrowserRunError {
  const message = e instanceof Error ? e.message : String(e);
  if (/time limit exceeded/i.test(message))
    return new BrowserRunError('browser_run_daily_limit', message);
  if (/\b429\b|rate limit/i.test(message))
    return new BrowserRunError('browser_run_rate_limited', message);
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|authentication/i.test(message))
    return new BrowserRunError('browser_run_unauthorized', message);
  return new BrowserRunError('browser_run_failed', message);
}

/** Five minutes is enough for a login and keeps the Workers Free daily allowance (10 min) usable. */
const HANDOFF_MS = 5 * 60_000;

type Page = import('playwright-core').Page;
interface Session {
  handoff: LoginHandoff;
  page: Page;
  close: () => Promise<void>;
}

const sessions = new Map<string, Session>();

export const getHandoff = (id: string) => sessions.get(id)?.handoff ?? null;

/** Closes the remote browser of a handoff; it then stops counting against Browser Run limits. */
export async function cancelHandoff(id: string) {
  const s = sessions.get(id);
  if (!s) return false;
  if (s.handoff.status === 'waiting') s.handoff.status = 'cancelled';
  await s.close();
  return true;
}

/**
 * Types into the field that has focus in the remote browser. Live View has no on-screen keyboard on
 * phones, so the web app relays text through Gier. Nothing is stored or logged.
 */
export async function typeIntoHandoff(
  id: string,
  input: { text?: string; key?: 'Enter' | 'Tab' | 'Backspace' },
) {
  const s = sessions.get(id);
  if (!s || s.handoff.status !== 'waiting') return false;
  if (input.text) await s.page.keyboard.insertText(input.text);
  if (input.key) await s.page.keyboard.press(input.key);
  return true;
}

/**
 * Starts a remote browser on the store's login page and returns a Live View URL for the user. When the
 * user finishes (Cloudflare.handoffComplete), the cookies are encrypted and stored. An earlier handoff
 * for the same store is closed first, so abandoned attempts do not use up the Browser Run limits.
 */
export async function startLoginHandoff(
  ctx: Ctx,
  storeId: number,
  loginUrl: string,
): Promise<LoginHandoff> {
  if (!browserRunAvailable(ctx)) throw new Error('Browser Run is not configured');
  for (const [id, s] of sessions)
    if (s.handoff.storeId === storeId || s.handoff.status !== 'waiting') await cancelHandoff(id);

  const { chromium } = await import('playwright-core');
  const handoff: LoginHandoff = {
    id: crypto.randomUUID(),
    storeId,
    status: 'waiting',
    liveViewUrl: null,
    startedAt: Date.now(),
  };

  let browser: import('playwright-core').Browser;
  try {
    browser = await chromium.connectOverCDP(
      `wss://api.cloudflare.com/client/v4/accounts/${ctx.env.CLOUDFLARE_ACCOUNT_ID}/browser-run/devtools/browser?keep_alive=${HANDOFF_MS}`,
      { headers: { Authorization: `Bearer ${ctx.env.CLOUDFLARE_API_TOKEN}` } },
    );
  } catch (e) {
    throw classifyBrowserRunError(e);
  }
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await browser.close().catch(() => undefined);
    // Keep the final status around briefly for the polling web app.
    setTimeout(() => sessions.delete(handoff.id), 60_000).unref?.();
  };

  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();
    sessions.set(handoff.id, { handoff, page, close });
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    const cdp = await context.newCDPSession(page);
    // Cloudflare-specific CDP commands are not in Playwright's protocol typings.
    const send = cdp.send.bind(cdp) as unknown as (
      method: string,
      params?: object,
    ) => Promise<Record<string, unknown>>;
    const live = await send('Cloudflare.getLiveView', { mode: 'tab', expiresInMs: HANDOFF_MS });
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
      timeout: HANDOFF_MS,
    });

    void done
      .then(async (result) => {
        if (handoff.status !== 'waiting') return;
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
      .finally(() => void close());
  } catch (e) {
    await close();
    throw classifyBrowserRunError(e);
  }
  return handoff;
}

export const cookieHeader = (cookies: StoredCookie[], domain: string) =>
  cookies
    .filter((c) => domain.endsWith(c.domain.replace(/^\./, '')))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
