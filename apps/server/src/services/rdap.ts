import type { Ctx } from '../context';

/** Domain age in days via RDAP (free, no key). Returns null when the registry does not tell. */
export async function domainAgeDays(ctx: Ctx, domain: string): Promise<number | null> {
  try {
    const res = await ctx.http(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { accept: 'application/rdap+json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { events?: { eventAction?: string; eventDate?: string }[] };
    const reg = data.events?.find((e) => e.eventAction === 'registration')?.eventDate;
    if (!reg) return null;
    const days = Math.floor((ctx.now().getTime() - new Date(reg).getTime()) / 86_400_000);
    return Number.isFinite(days) ? days : null;
  } catch {
    return null;
  }
}
