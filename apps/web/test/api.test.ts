import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, AUTH_REQUIRED, isAuthError } from '../src/lib/api';

const respond = (res: Partial<Response> & { json?: () => Promise<unknown> }) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    status: 200,
    type: 'basic',
    headers: new Headers(),
    json: async () => ({}),
    ...res,
  } as Response);

describe('API client behind a login proxy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('treats a redirect to the login page as an ended session', async () => {
    respond({ type: 'opaqueredirect', status: 0 });
    const err = await api.health().catch((e: unknown) => e);
    expect(isAuthError(err)).toBe(true);
  });

  it('treats a bare 403 from the proxy as an ended session', async () => {
    respond({
      status: 403,
      statusText: 'Forbidden',
      headers: new Headers({ 'content-type': 'text/html' }),
    });
    await expect(api.health()).rejects.toMatchObject({ code: AUTH_REQUIRED });
  });

  it("keeps Gier's own JSON errors", async () => {
    respond({
      status: 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'invalid_input' }),
    });
    const err = await api.health().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('invalid_input');
  });

  it('does not follow redirects itself', async () => {
    const spy = respond({ ok: true, headers: new Headers({ 'content-type': 'application/json' }) });
    await api.health();
    expect(spy.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' });
  });
});
