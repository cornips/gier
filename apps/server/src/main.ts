import { serve } from '@hono/node-server';
import { and, isNull, lte, or } from 'drizzle-orm';
import { openDb, products } from '@gier/db';
import { createApp } from './app';
import type { Ctx } from './context';
import { loadEnv } from './env';
import { Fetcher } from './lib/fetcher';
import { ensureLocalSecrets } from './lib/secrets';
import { generateAdvice } from './services/advice';
import { runDueChecks } from './services/checker';
import { sendDigestIfDue } from './services/digest';
import { discoveryDue, failInterruptedRuns, startDiscovery } from './services/discovery';
import { seedStores } from './services/stores';

const env = loadEnv();
const secrets = ensureLocalSecrets(env);
if (secrets.created) console.log(`Generated secrets in ${secrets.file}`);
const { db } = openDb(env.DATABASE_FILE);
const ctx: Ctx = {
  env,
  db,
  fetcher: new Fetcher({ userAgent: env.USER_AGENT }),
  http: fetch,
  now: () => new Date(),
};

const added = seedStores(ctx);
if (added) console.log(`Seeded ${added} fixed stores`);
// A restart ends every discovery that was still running.
failInterruptedRuns(ctx);

const app = createApp(ctx);
const base = env.GIER_BASE_PATH;
serve(
  {
    // Works behind proxies that keep the base path and ones that strip it: requests without the
    // prefix get it added.
    fetch: (req) => {
      const url = new URL(req.url);
      if (base && url.pathname !== base && !url.pathname.startsWith(`${base}/`)) {
        url.pathname = `${base}${url.pathname}`;
        return app.fetch(new Request(url, req));
      }
      return app.fetch(req);
    },
    port: env.PORT,
  },
  (info) => {
    console.log(`Gier listening on http://localhost:${info.port}${env.GIER_BASE_PATH}/`);
  },
);

if (env.SCHEDULER === 'on') {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const outcomes = await runDueChecks(ctx);
      if (outcomes.length)
        console.log(
          `Checked ${outcomes.length} listings, ${outcomes.filter((o) => o.status === 'changed').length} changed`,
        );

      // Advice after changes (automatic mode only; generateAdvice enforces mode and budget).
      const changedProducts = new Set(
        outcomes.filter((o) => o.status === 'changed').map((o) => o.productId),
      );
      for (const pid of changedProducts)
        await generateAdvice(ctx, pid, false).catch((e) => console.warn('advice failed', e));

      // Weekly re-discovery (F10).
      const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);
      const stale = db
        .select()
        .from(products)
        .where(
          and(
            isNull(products.archivedAt),
            or(isNull(products.lastDiscoveryAt), lte(products.lastDiscoveryAt, weekAgo)),
          ),
        )
        .all()
        .filter((p) => discoveryDue(ctx, p.id))
        .slice(0, 2);
      for (const p of stale) {
        startDiscovery(ctx, {
          productId: p.id,
          query: p.name,
          fingerprint: p.fingerprint,
          follow: true,
          useAi: p.aiBudgetTier !== 'none',
        });
      }

      // Weekly digest (F17), Sunday 10:00 Europe/Amsterdam.
      if (await sendDigestIfDue(ctx)) console.log('Weekly digest sent');
    } catch (e) {
      console.error('Scheduler tick failed', e);
    } finally {
      busy = false;
    }
  };
  setInterval(() => void tick(), 60_000);
  setTimeout(() => void tick(), 5_000);
}
