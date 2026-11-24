import { createApp } from './app';
import type { Bindings, Deps } from './env';
import { syncFeedback } from './feedback';
import { Store } from './store';

const deps = (env: Bindings, ctx: ExecutionContext): Deps => ({
  env,
  now: () => new Date(),
  fetch: (input, init) => fetch(input, init),
  defer: (p) => ctx.waitUntil(p.catch((e) => console.error('deferred task failed', e))),
});

export default {
  fetch(request, env, ctx) {
    return createApp(deps(env, ctx)).fetch(request);
  },

  /** Every 15 minutes: retry feedback for Notion and clear expired codes, nonces and counters. */
  async scheduled(_controller, env, ctx) {
    const d = deps(env, ctx);
    const store = new Store(env.DB);
    await syncFeedback(d, store);
    await store.cleanup(d.now().getTime());
  },
} satisfies ExportedHandler<Bindings>;
