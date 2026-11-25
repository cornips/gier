import { eq } from 'drizzle-orm';
import { stores } from '@gier/db';
import type { Ctx } from '../context';
import { encrypt } from '../lib/crypto';

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

/**
 * Quick actions are rate limited (on the Workers Free plan one per 10 seconds), so renders wait in one
 * queue with a minimum interval instead of failing with 429.
 */
let renderQueue: Promise<unknown> = Promise.resolve();
let lastRender = 0;
const RENDER_INTERVAL_MS = 10_000;

/** Rendered HTML via the /content quick action. Cookies come from a stored login session, if any. */
export function renderHtml(
  ctx: Ctx,
  url: string,
  cookies: StoredCookie[] = [],
): Promise<string | null> {
  if (!browserRunAvailable(ctx)) return Promise.resolve(null);
  const run = async () => {
    const wait = lastRender + RENDER_INTERVAL_MS - Date.now();
    if (wait > 0 && ctx.env.NODE_ENV !== 'test') await new Promise((r) => setTimeout(r, wait));
    lastRender = Date.now();
    return renderNow(ctx, url, cookies);
  };
  const next = renderQueue.then(run, run);
  renderQueue = next.catch(() => null);
  return next;
}

async function renderNow(ctx: Ctx, url: string, cookies: StoredCookie[]): Promise<string | null> {
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
  /** Stores the remote browser's cookies as the store's session. */
  save: () => Promise<void>;
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
 * The user says they are logged in: keep the remote browser's cookies (encrypted) as the store's
 * session and close the browser. Gier's own login window asks for this, not Browser Run's handoff
 * panel, which would cover the shop's page inside Live View.
 */
export async function completeHandoff(id: string) {
  const s = sessions.get(id);
  if (!s || s.handoff.status !== 'waiting') return s?.handoff ?? null;
  try {
    await s.save();
    s.handoff.status = 'done';
  } catch (e) {
    s.handoff.status = 'failed';
    s.handoff.error = e instanceof Error ? e.message : String(e);
  } finally {
    await s.close();
  }
  return s.handoff;
}

/**
 * Starts a remote browser on the store's login page and returns a Live View URL for the user, who
 * logs in there and then confirms in Gier (completeHandoff). Unconfirmed handoffs expire after
 * HANDOFF_MS. An earlier handoff for the same store is closed first, so abandoned attempts do not use
 * up the Browser Run limits.
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
  const expiry = setTimeout(() => {
    if (handoff.status === 'waiting') handoff.status = 'expired';
    void close();
  }, HANDOFF_MS);
  expiry.unref?.();
  const close = async () => {
    if (closed) return;
    closed = true;
    clearTimeout(expiry);
    await browser.close().catch(() => undefined);
    // Keep the final status around briefly for the polling web app.
    setTimeout(() => sessions.delete(handoff.id), 60_000).unref?.();
  };

  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();
    const save = async () => {
      const cookies = (await context.cookies()) as StoredCookie[];
      ctx.db
        .update(stores)
        .set({
          sessionEncrypted: encrypt(JSON.stringify(cookies), ctx.env.GIER_SECRET),
          sessionUpdatedAt: ctx.now(),
        })
        .where(eq(stores.id, storeId))
        .run();
    };
    sessions.set(handoff.id, { handoff, page, save, close });
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    const cdp = await context.newCDPSession(page);
    // Cloudflare-specific CDP commands are not in Playwright's protocol typings.
    const live = (await (cdp.send as unknown as (m: string, p: object) => Promise<object>)(
      'Cloudflare.getLiveView',
      // "tab" shows only the page, without DevTools around it.
      { mode: 'tab', expiresInMs: HANDOFF_MS },
    )) as { devtoolsFrontendUrl?: string };
    handoff.liveViewUrl = String(live.devtoolsFrontendUrl ?? '');
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
