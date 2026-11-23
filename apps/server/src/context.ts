import type { Db } from '@gier/db';
import type { Env } from './env';
import type { Fetcher } from './lib/fetcher';

/** Everything a service needs, passed explicitly so tests can swap parts out. */
export interface Ctx {
  env: Env;
  db: Db;
  fetcher: Fetcher;
  /** fetch used for third-party APIs (search, AI, push); replaceable in tests. */
  http: typeof fetch;
  now: () => Date;
}
