import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as webpush from 'web-push';
import type { Env } from '../env';

export const DEV_SECRET = 'development-secret-change-me';

interface LocalSecrets {
  gierSecret: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
}

/**
 * Zero-config secrets: when GIER_SECRET or the VAPID keys are not set, Gier generates them once and
 * keeps them next to the database (secrets.json, mode 600). Values from the environment always win.
 * Back up the data folder as a whole: sessions and push subscriptions depend on these keys.
 */
export function ensureLocalSecrets(env: Env): { file: string; created: boolean } {
  const file = join(dirname(env.DATABASE_FILE), 'secrets.json');
  let secrets: LocalSecrets;
  let created = false;
  if (existsSync(file)) {
    secrets = JSON.parse(readFileSync(file, 'utf8')) as LocalSecrets;
  } else {
    const vapid = webpush.generateVAPIDKeys();
    secrets = {
      gierSecret: randomBytes(32).toString('base64url'),
      vapidPublicKey: vapid.publicKey,
      vapidPrivateKey: vapid.privateKey,
    };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    chmodSync(file, 0o600);
    created = true;
  }
  if (env.GIER_SECRET === DEV_SECRET && env.NODE_ENV !== 'test')
    env.GIER_SECRET = secrets.gierSecret;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    env.VAPID_PUBLIC_KEY = secrets.vapidPublicKey;
    env.VAPID_PRIVATE_KEY = secrets.vapidPrivateKey;
  }
  // Apple's push service wants a real contact; the public URL is a valid "https:" subject.
  if (env.VAPID_SUBJECT === 'mailto:gier@example.com' && env.GIER_PUBLIC_URL.startsWith('https://'))
    env.VAPID_SUBJECT = env.GIER_PUBLIC_URL;
  return { file, created };
}
