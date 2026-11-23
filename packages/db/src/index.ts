import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

export * from './schema';
export { schema };

export type Db = BetterSQLite3Database<typeof schema>;

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

/** Opens (and migrates) the SQLite database. Use ':memory:' for tests. */
export function openDb(file: string): { db: Db; sqlite: Database.Database } {
  if (file !== ':memory:') mkdirSync(dirname(resolve(file)), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { db, sqlite };
}
