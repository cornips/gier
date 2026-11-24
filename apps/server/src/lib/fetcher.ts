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
 * HTTP client for Gier's reads. Gier does what its user would otherwise do by hand: search shops,
 * open product pages and keep an eye on the prices. It fetches on behalf of that one user, like a
 * browser, so robots.txt (meant for crawlers that index or republish) does not apply. To stay stable
 * and reliable it still sends one request per domain at a time with a minimum interval, identifies
 * itself, and recognises bot walls so the caller can report them.
 */
export class Fetcher {
  private readonly lastHit = new Map<string, number>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly f: typeof fetch;

  constructor(private readonly opts: FetcherOptions) {
    this.f = opts.fetchImpl ?? fetch;
  }

  async get(url: string, init: { cookie?: string; accept?: string } = {}): Promise<FetchResult> {
    const domain = domainOf(url) ?? url;
    const run = async () => {
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
}
