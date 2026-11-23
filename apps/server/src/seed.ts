import { openDb } from '@gier/db';
import { loadEnv } from './env';
import { Fetcher } from './lib/fetcher';
import { ensureLocalSecrets } from './lib/secrets';
import { seedStores } from './services/stores';

const env = loadEnv();
const { db, sqlite } = openDb(env.DATABASE_FILE);
const added = seedStores({
  env,
  db,
  fetcher: new Fetcher({ userAgent: env.USER_AGENT }),
  http: fetch,
  now: () => new Date(),
});
console.log(`Database ready at ${env.DATABASE_FILE}; ${added} fixed stores added.`);
const secrets = ensureLocalSecrets(env);
console.log(
  secrets.created
    ? `Generated GIER_SECRET and VAPID keys in ${secrets.file} (used when .env leaves them empty).`
    : `Using secrets from ${secrets.file} where .env leaves them empty.`,
);
sqlite.close();
