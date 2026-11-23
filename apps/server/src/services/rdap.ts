import type { Ctx } from '../context';

const DAY = 86_400_000;
const BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';

/** TLD → RDAP base URL, from the IANA bootstrap file. Refreshed weekly. */
let bootstrap: { at: number; map: Map<string, string> } | null = null;
/** Domain → age in days (or null when the registry does not tell). Kept for a week. */
const cache = new Map<string, { at: number; days: number | null }>();

async function registryFor(ctx: Ctx, tld: string): Promise<string | null> {
  if (!bootstrap || Date.now() - bootstrap.at > 7 * DAY) {
    const map = new Map<string, string>();
    try {
      const res = await ctx.http(BOOTSTRAP, { headers: { 'user-agent': ctx.env.USER_AGENT } });
      if (res.ok) {
        const data = (await res.json()) as { services?: [string[], string[]][] };
        for (const [tlds, urls] of data.services ?? []) {
          const url = urls.find((u) => u.startsWith('https://')) ?? urls[0];
          if (url) for (const t of tlds) map.set(t.toLowerCase(), url.replace(/\/?$/, '/'));
        }
      }
    } catch {
      /* fall back to rdap.org below */
    }
    bootstrap = { at: Date.now(), map };
  }
  return bootstrap.map.get(tld) ?? null;
}

/**
 * Domain age in days via RDAP, asked of the registry itself (rdap.sidn.nl for .nl) with rdap.org as
 * fallback. Results are cached, so a discovery never asks twice for the same domain.
 */
export async function domainAgeDays(ctx: Ctx, domain: string): Promise<number | null> {
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < 7 * DAY) return hit.days;
  const tld = domain.split('.').pop()!.toLowerCase();
  const base = (await registryFor(ctx, tld)) ?? 'https://rdap.org/';
  let days: number | null = null;
  try {
    const res = await ctx.http(`${base}domain/${encodeURIComponent(domain)}`, {
      headers: { accept: 'application/rdap+json', 'user-agent': ctx.env.USER_AGENT },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        events?: { eventAction?: string; eventDate?: string }[];
      };
      const reg = data.events?.find((e) => e.eventAction === 'registration')?.eventDate;
      if (reg) {
        const d = Math.floor((ctx.now().getTime() - new Date(reg).getTime()) / DAY);
        days = Number.isFinite(d) ? d : null;
      }
    }
  } catch {
    days = null;
  }
  cache.set(domain, { at: Date.now(), days });
  return days;
}

/** For tests. */
export function clearRdapCache() {
  cache.clear();
  bootstrap = null;
}
