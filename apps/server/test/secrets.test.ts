import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env';
import { DEV_SECRET, ensureLocalSecrets } from '../src/lib/secrets';

describe('env', () => {
  it('treats empty values as unset', () => {
    const env = loadEnv({
      GIER_SECRET: '',
      AI_MONTHLY_CAP_EUR: '',
      PORT: ' ',
      ANTHROPIC_API_KEY: '',
    });
    expect(env.GIER_SECRET).toBe(DEV_SECRET);
    expect(env.AI_MONTHLY_CAP_EUR).toBe(2);
    expect(env.PORT).toBe(8787);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe('local secrets', () => {
  it('generates once, keeps them private and lets the environment win', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gier-'));
    const env = loadEnv({
      NODE_ENV: 'production',
      DATABASE_FILE: join(dir, 'gier.db'),
      GIER_PUBLIC_URL: 'https://gier.example.com',
    });
    expect(env.GIER_SECRET).toBe(DEV_SECRET);
    const first = ensureLocalSecrets(env);
    expect(first.created).toBe(true);
    expect(statSync(first.file).mode & 0o777).toBe(0o600);
    expect(env.GIER_SECRET).not.toBe(DEV_SECRET);
    expect(env.VAPID_PUBLIC_KEY).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(env.VAPID_SUBJECT).toBe('https://gier.example.com');

    const again = loadEnv({
      NODE_ENV: 'production',
      DATABASE_FILE: join(dir, 'gier.db'),
      GIER_SECRET: 'x'.repeat(32),
    });
    expect(ensureLocalSecrets(again).created).toBe(false);
    expect(again.GIER_SECRET).toBe('x'.repeat(32));
    expect(again.VAPID_PUBLIC_KEY).toBe(env.VAPID_PUBLIC_KEY);
  });
});
