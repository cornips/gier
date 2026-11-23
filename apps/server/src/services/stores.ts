import { eq } from 'drizzle-orm';
import { domainOf, FIXED_STORES } from '@gier/core';
import { stores, type Store } from '@gier/db';
import type { Ctx } from '../context';

/**
 * Seeds the known stores (ADR-013). Idempotent: existing rows keep the user's changes.
 */
export function seedStores(ctx: Ctx): number {
  let added = 0;
  for (const s of FIXED_STORES) {
    const existing = s.domain
      ? ctx.db.select().from(stores).where(eq(stores.domain, s.domain)).get()
      : ctx.db.select().from(stores).where(eq(stores.name, s.name)).get();
    if (existing) {
      // Technical settings from the registry (login page, store search) follow new versions of Gier;
      // the user's own choices (trust, preference, card) are never touched.
      const patch: Record<string, unknown> = {};
      if (s.rules?.loginUrl && !existing.rules?.loginUrl) patch.loginUrl = s.rules.loginUrl;
      if (
        s.rules?.search &&
        JSON.stringify(s.rules.search) !== JSON.stringify(existing.rules?.search)
      )
        patch.search = s.rules.search;
      if (Object.keys(patch).length)
        ctx.db
          .update(stores)
          .set({ rules: { ...(existing.rules ?? {}), ...patch } })
          .where(eq(stores.id, existing.id))
          .run();
      continue;
    }
    ctx.db
      .insert(stores)
      .values({
        name: s.name,
        domain: s.domain,
        category: s.category,
        isFixed: true,
        trust: 'trusted',
        origin: 'fixed',
        rules: s.rules ?? null,
        requiresLogin: Boolean(s.rules?.requiresLogin),
        needsResearch: s.domain === null || Boolean(s.verify),
      })
      .run();
    added += 1;
  }
  return added;
}

export function storeForUrl(ctx: Ctx, url: string): Store | null {
  const domain = domainOf(url);
  if (!domain) return null;
  return ctx.db.select().from(stores).where(eq(stores.domain, domain)).get() ?? null;
}

/** Finds or creates a learned store for a URL found during discovery. */
export function ensureStore(
  ctx: Ctx,
  url: string,
  trust: Store['trust'] = 'doubt',
  name?: string,
): Store {
  const existing = storeForUrl(ctx, url);
  if (existing) return existing;
  const domain = domainOf(url)!;
  const [row] = ctx.db
    .insert(stores)
    .values({ name: name ?? prettyName(domain), domain, trust, origin: 'learned', isFixed: false })
    .returning()
    .all();
  return row!;
}

export const prettyName = (domain: string) => {
  const base = domain.split('.')[0] ?? domain;
  return base.charAt(0).toUpperCase() + base.slice(1);
};
