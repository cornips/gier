import { fromBase64Url, randomToken, sha256Hex, toBase64Url, utf8 } from './encoding';

/**
 * Request signing between an installation and the relay (ADR-016).
 *
 * The signature covers METHOD, path with query, timestamp, nonce and the SHA-256 of the body, so a
 * request can be neither changed nor replayed (the relay accepts each nonce once, within ±5 min).
 */
export const HEADERS = {
  installation: 'gier-installation',
  timestamp: 'gier-timestamp',
  nonce: 'gier-nonce',
  signature: 'gier-signature',
} as const;

export const MAX_CLOCK_SKEW_SECONDS = 300;

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

const ALG = { name: 'Ed25519' } as const;
/** CryptoKey without depending on DOM or Workers type libraries. */
type Key = Parameters<typeof crypto.subtle.exportKey>[1];

/** New Ed25519 key pair: raw public key and PKCS#8 private key, both base64url. */
export async function generateKeyPair(): Promise<KeyPair> {
  const pair = (await crypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as {
    publicKey: Key;
    privateKey: Key;
  };
  const [pub, priv] = await Promise.all([
    crypto.subtle.exportKey('raw', pair.publicKey) as Promise<ArrayBuffer>,
    crypto.subtle.exportKey('pkcs8', pair.privateKey) as Promise<ArrayBuffer>,
  ]);
  return { publicKey: toBase64Url(pub), privateKey: toBase64Url(priv) };
}

export function canonical(parts: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
}): string {
  return [
    parts.method.toUpperCase(),
    parts.path,
    parts.timestamp,
    parts.nonce,
    parts.bodyHash,
  ].join('\n');
}

export async function signRequest(o: {
  installationId: string;
  privateKey: string;
  method: string;
  /** Path including the query string, as the relay sees it. */
  path: string;
  body: string;
  now?: Date;
}): Promise<Record<string, string>> {
  const timestamp = String(Math.floor((o.now ?? new Date()).getTime() / 1000));
  const nonce = randomToken(16);
  const key = await crypto.subtle.importKey('pkcs8', fromBase64Url(o.privateKey), ALG, false, [
    'sign',
  ]);
  const message = canonical({
    method: o.method,
    path: o.path,
    timestamp,
    nonce,
    bodyHash: await sha256Hex(o.body),
  });
  const signature = await crypto.subtle.sign(ALG, key, utf8(message));
  return {
    [HEADERS.installation]: o.installationId,
    [HEADERS.timestamp]: timestamp,
    [HEADERS.nonce]: nonce,
    [HEADERS.signature]: toBase64Url(signature),
  };
}

export async function verifySignature(o: {
  publicKey: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
  signature: string;
}): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', fromBase64Url(o.publicKey), ALG, false, [
      'verify',
    ]);
    const message = canonical({
      method: o.method,
      path: o.path,
      timestamp: o.timestamp,
      nonce: o.nonce,
      bodyHash: await sha256Hex(o.body),
    });
    return await crypto.subtle.verify(ALG, key, fromBase64Url(o.signature), utf8(message));
  } catch {
    return false;
  }
}

export function timestampFresh(timestamp: string, now: Date = new Date()): boolean {
  if (!/^\d{9,12}$/.test(timestamp)) return false;
  return Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp)) <= MAX_CLOCK_SKEW_SECONDS;
}
