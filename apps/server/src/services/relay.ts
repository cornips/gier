import { createHmac } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateKeyPair, RelayClient, type RelayIdentity } from '@gier/relay-protocol';
import type { Ctx } from '../context';

/**
 * Telegram through the shared bot (ADR-016). Gier registers once with the relay using a key pair it
 * keeps in the data folder (relay.json, mode 600), and signs every request with it. The relay knows
 * the chats; Gier only knows pseudonymous subjects and link ids.
 */
interface StoredIdentity extends RelayIdentity {
  publicKey: string;
  relayUrl: string;
  baseUrl: string;
}

export type TelegramMode = 'relay' | 'direct' | 'off';

export function telegramMode(ctx: Ctx): TelegramMode {
  if (ctx.env.GIER_RELAY_URL && ctx.env.GIER_RELAY_REGISTRATION_TOKEN) return 'relay';
  if (ctx.env.TELEGRAM_BOT_TOKEN && ctx.env.TELEGRAM_CHAT_ID) return 'direct';
  return 'off';
}

/** Public address of this installation, as the relay uses it for the "View" button. */
export const installationUrl = (ctx: Ctx) =>
  `${ctx.env.GIER_PUBLIC_URL.replace(/\/+$/, '')}${ctx.env.GIER_BASE_PATH}`;

/** Same person → same subject, without the relay learning who it is. */
export function relaySubject(ctx: Ctx, user: string | null): string {
  return createHmac('sha256', ctx.env.GIER_SECRET)
    .update(`relay-subject:${(user ?? 'default').toLowerCase()}`)
    .digest('base64url')
    .slice(0, 32);
}

const memory = new Map<string, StoredIdentity>();
const pending = new Map<string, Promise<StoredIdentity>>();

const identityFile = (ctx: Ctx) =>
  ctx.env.DATABASE_FILE === ':memory:' ? null : join(dirname(ctx.env.DATABASE_FILE), 'relay.json');

function readIdentity(ctx: Ctx): StoredIdentity | null {
  const file = identityFile(ctx);
  if (!file) return memory.get(ctx.env.GIER_RELAY_URL ?? '') ?? null;
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as StoredIdentity) : null;
}

function writeIdentity(ctx: Ctx, identity: StoredIdentity) {
  const file = identityFile(ctx);
  if (!file) return void memory.set(identity.relayUrl, identity);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(identity, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** Registers on first use; re-registers when the relay changes, updates when the address changes. */
async function identity(ctx: Ctx): Promise<StoredIdentity> {
  const relayUrl = ctx.env.GIER_RELAY_URL!;
  const baseUrl = installationUrl(ctx);
  const known = readIdentity(ctx);
  if (known && known.relayUrl === relayUrl) {
    if (known.baseUrl !== baseUrl) {
      await new RelayClient(relayUrl, async () => known, ctx.http).updateBaseUrl(baseUrl);
      writeIdentity(ctx, { ...known, baseUrl });
    }
    return known;
  }
  let job = pending.get(relayUrl);
  if (!job) {
    job = (async () => {
      const keys = await generateKeyPair();
      const installationId = await RelayClient.register(
        relayUrl,
        {
          base_url: baseUrl,
          public_key: keys.publicKey,
          registration_token: ctx.env.GIER_RELAY_REGISTRATION_TOKEN!,
        },
        ctx.http,
      );
      const stored: StoredIdentity = {
        installationId,
        privateKey: keys.privateKey,
        publicKey: keys.publicKey,
        relayUrl,
        baseUrl,
      };
      writeIdentity(ctx, stored);
      return stored;
    })().finally(() => pending.delete(relayUrl));
    pending.set(relayUrl, job);
  }
  return job;
}

export function relayClient(ctx: Ctx): RelayClient | null {
  if (telegramMode(ctx) !== 'relay') return null;
  return new RelayClient(ctx.env.GIER_RELAY_URL!, () => identity(ctx), ctx.http);
}

/** Only for tests. */
export function forgetRelayIdentities() {
  memory.clear();
  pending.clear();
}
