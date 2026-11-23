import { domainOf } from '@gier/core';

export interface FetchResult {
  ok: boolean;
  status: number;
  url: string;
  html: string;
  blocked: boolean;
}

export interface FetcherOptions {
  userAgent: string;
  /** Minimum milliseconds between two requests to the same domain. */
  perDomainIntervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const BLOCK_MARKERS = [
  /captcha/i,
  /are you a robot/i,
  /access denied/i,
  /cf-chl-/i,
  /bot detection/i,
  /verify you are human/i,
];

/**
 * Polite HTTP client: one request per domain at a time with a minimum interval, honours robots.txt,
 * identifies itself, and recognises bot walls so the caller can fall back to a browser.
 */
export class Fetcher {
  private readonly lastHit = new Map<string, number>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly robots = new Map<string, { rules: string[]; fetchedAt: number }>();
  private readonly f: typeof fetch;

  constructor(private readonly opts: FetcherOptions) {
    this.f = opts.fetchImpl ?? fetch;
  }

  async get(
    url: string,
    init: { cookie?: string; skipRobots?: boolean; accept?: string } = {},
  ): Promise<FetchResult> {
    const domain = domainOf(url) ?? url;
    const run = async () => {
      if (!init.skipRobots && !(await this.allowed(url))) {
        return { ok: false, status: 999, url, html: '', blocked: true };
      }
      const wait =
        (this.lastHit.get(domain) ?? 0) + (this.opts.perDomainIntervalMs ?? 4000) - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastHit.set(domain, Date.now());
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 20_000);
      try {
        const res = await this.f(url, {
          signal: controller.signal,
          redirect: 'follow',
          headers: {
            'user-agent': this.opts.userAgent,
            accept: init.accept ?? 'text/html,application/xhtml+xml',
            'accept-language': 'nl-NL,nl;q=0.9,en;q=0.6',
            ...(init.cookie ? { cookie: init.cookie } : {}),
          },
        });
        const html = await res.text();
        const blocked =
          res.status === 403 ||
          res.status === 429 ||
          (html.length < 20_000 && BLOCK_MARKERS.some((r) => r.test(html)));
        return { ok: res.ok && !blocked, status: res.status, url: res.url || url, html, blocked };
      } catch (error) {
        return { ok: false, status: 0, url, html: String(error), blocked: false };
      } finally {
        clearTimeout(timer);
      }
    };
    const previous = this.queues.get(domain) ?? Promise.resolve();
    const next = previous.then(run, run);
    this.queues.set(
      domain,
      next.catch(() => undefined),
    );
    return next;
  }

  /** Minimal robots.txt support: Disallow rules for "*" and for our bot name. */
  async allowed(url: string): Promise<boolean> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    const origin = u.origin;
    let entry = this.robots.get(origin);
    if (!entry || Date.now() - entry.fetchedAt > 24 * 3600_000) {
      let rules: string[] = [];
      try {
        const res = await this.f(`${origin}/robots.txt`, {
          headers: { 'user-agent': this.opts.userAgent },
        });
        if (res.ok) rules = parseRobots(await res.text(), 'gierbot');
      } catch {
        rules = [];
      }
      entry = { rules, fetchedAt: Date.now() };
      this.robots.set(origin, entry);
    }
    const path = u.pathname + u.search;
    return !entry.rules.some((r) => r !== '' && matchesRule(path, r));
  }
}

export function parseRobots(text: string, bot: string): string[] {
  const groups: { agents: string[]; disallow: string[] }[] = [];
  let current: { agents: string[]; disallow: string[] } | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === 'user-agent') {
      if (!current || current.disallow.length) {
        current = { agents: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (field === 'disallow' && current) {
      current.disallow.push(value);
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && bot.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.disallow);
}

function matchesRule(path: string, rule: string): boolean {
  const anchored = rule.endsWith('$');
  const pattern = rule
    .replace(/\$$/, '')
    .split('*')
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path);
}
