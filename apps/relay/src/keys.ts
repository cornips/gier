import { fromBase64Url, toBase64Url, utf8 } from '@gier/relay-protocol';

/**
 * Keys derived from DATA_KEY: one for encrypting chat ids (AES-GCM), one for HMAC lookups and
 * pseudonyms. A leaked database alone does not reveal who uses the bot.
 */
export interface DataKeys {
  encrypt(plain: string): Promise<string>;
  decrypt(payload: string): Promise<string>;
  /** Stable keyed hash, e.g. of a chat id. */
  hash(value: string): Promise<string>;
}

const cache = new Map<string, Promise<DataKeys>>();

export function dataKeys(secret: string): Promise<DataKeys> {
  let keys = cache.get(secret);
  if (!keys) {
    keys = derive(secret);
    cache.set(secret, keys);
  }
  return keys;
}

async function derive(secret: string): Promise<DataKeys> {
  const raw = fromBase64Url(secret);
  if (raw.length < 32) throw new Error('DATA_KEY must be at least 32 bytes (base64url)');
  const master = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  const hkdf = (info: string) => ({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: utf8('gier-relay'),
    info: utf8(info),
  });
  const aes = await crypto.subtle.deriveKey(
    hkdf('chat-id-encryption'),
    master,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const mac = await crypto.subtle.deriveKey(
    hkdf('lookup-hmac'),
    master,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  );
  return {
    async encrypt(plain) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, utf8(plain));
      return `v1.${toBase64Url(iv)}.${toBase64Url(data)}`;
    },
    async decrypt(payload) {
      const [v, iv, data] = payload.split('.');
      if (v !== 'v1' || !iv || !data) throw new Error('unknown_payload');
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64Url(iv) },
        aes,
        fromBase64Url(data),
      );
      return new TextDecoder().decode(plain);
    },
    async hash(value) {
      return toBase64Url(await crypto.subtle.sign('HMAC', mac, utf8(value)));
    },
  };
}
