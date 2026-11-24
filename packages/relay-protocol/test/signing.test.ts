import { describe, expect, it } from 'vitest';
import {
  fromBase64Url,
  generateKeyPair,
  HEADERS,
  notificationRequest,
  registerRequest,
  safeEqual,
  signRequest,
  timestampFresh,
  toBase64Url,
  verifySignature,
} from '../src';

async function signed(body = '{"a":1}', path = '/v1/notifications') {
  const keys = await generateKeyPair();
  const headers = await signRequest({
    installationId: 'inst_1',
    privateKey: keys.privateKey,
    method: 'POST',
    path,
    body,
  });
  return { keys, headers };
}

const verify = (
  publicKey: string,
  h: Record<string, string>,
  over: Partial<{ method: string; path: string; body: string }> = {},
) =>
  verifySignature({
    publicKey,
    method: over.method ?? 'POST',
    path: over.path ?? '/v1/notifications',
    body: over.body ?? '{"a":1}',
    timestamp: h[HEADERS.timestamp]!,
    nonce: h[HEADERS.nonce]!,
    signature: h[HEADERS.signature]!,
  });

describe('request signing', () => {
  it('accepts a correctly signed request', async () => {
    const { keys, headers } = await signed();
    expect(await verify(keys.publicKey, headers)).toBe(true);
  });

  it('rejects a changed body, path or method', async () => {
    const { keys, headers } = await signed();
    expect(await verify(keys.publicKey, headers, { body: '{"a":2}' })).toBe(false);
    expect(await verify(keys.publicKey, headers, { path: '/v1/links' })).toBe(false);
    expect(await verify(keys.publicKey, headers, { method: 'DELETE' })).toBe(false);
  });

  it('rejects a signature from another key', async () => {
    const { headers } = await signed();
    const other = await generateKeyPair();
    expect(await verify(other.publicKey, headers)).toBe(false);
  });

  it('treats garbage as invalid instead of throwing', async () => {
    const { keys, headers } = await signed();
    expect(await verify(keys.publicKey, { ...headers, [HEADERS.signature]: '!!' })).toBe(false);
  });

  it('only accepts timestamps within five minutes', () => {
    const now = new Date('2026-11-24T12:00:00Z');
    const t = (s: number) => String(Math.floor(now.getTime() / 1000) + s);
    expect(timestampFresh(t(0), now)).toBe(true);
    expect(timestampFresh(t(-299), now)).toBe(true);
    expect(timestampFresh(t(301), now)).toBe(false);
    expect(timestampFresh('abc', now)).toBe(false);
  });
});

describe('encoding', () => {
  it('round-trips base64url', () => {
    const bytes = new Uint8Array([0, 255, 62, 63, 1, 2, 3]);
    expect([...fromBase64Url(toBase64Url(bytes))]).toEqual([...bytes]);
  });

  it('compares strings safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('schemas', () => {
  it('only allows paths inside the installation', () => {
    const base = { kind: 'deal', title: 'T' };
    expect(notificationRequest.safeParse({ ...base, path: '/p/42' }).success).toBe(true);
    for (const path of ['//evil.example', 'https://evil.example', '/a\\b', 'p/1', '/a b'])
      expect(notificationRequest.safeParse({ ...base, path }).success).toBe(false);
  });

  it('wants an https base url without query', () => {
    const base = { public_key: 'A'.repeat(43), registration_token: 't' };
    expect(registerRequest.parse({ ...base, base_url: 'https://x.example/gier/' }).base_url).toBe(
      'https://x.example/gier',
    );
    expect(registerRequest.safeParse({ ...base, base_url: 'http://x.example' }).success).toBe(
      false,
    );
    expect(registerRequest.safeParse({ ...base, base_url: 'https://x.example/?a=1' }).success).toBe(
      false,
    );
  });
});
