import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { makeCtx } from './helpers';

describe('signing in again behind a login proxy', () => {
  const app = createApp(makeCtx({}));
  const login = (next?: string) =>
    app.request(`/gier/api/login${next === undefined ? '' : `?next=${encodeURIComponent(next)}`}`);

  it('returns to the page the user was on', async () => {
    const res = await login('/gier/p/3?tab=history');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/gier/p/3?tab=history');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('never redirects outside Gier', async () => {
    for (const next of [
      'https://evil.example.com/',
      '//evil.example.com/gier/',
      '/other/',
      '/gier\\\\evil',
    ])
      expect((await login(next)).headers.get('location')).toBe('/gier/');
    expect((await login()).headers.get('location')).toBe('/gier/');
  });
});
