import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { makeCtx } from './helpers';

const NOTION_ENV = {
  NOTION_TOKEN: 'secret_test',
  NOTION_FEEDBACK_DATABASE_ID: 'db123',
  GIER_PUBLIC_URL: 'https://prices.example.com/gier',
};

function setup(env: Record<string, string> = NOTION_ENV, status = 200) {
  const ctx = makeCtx({}, { env });
  const calls: {
    url: string;
    headers: Headers; // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Notion request bodies are loose JSON
    body: Record<string, any>;
  }[] = [];
  const inner = ctx.http;
  ctx.http = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://api.notion.com/')) {
      calls.push({
        url,
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      return Response.json(
        { id: 'page1', code: status === 200 ? undefined : 'unauthorized' },
        { status },
      );
    }
    return inner(input, init);
  }) as typeof fetch;
  const app = createApp(ctx);
  const post = (body: unknown, email = 'tester@example.com') =>
    app.request('/gier/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-access-authenticated-user-email': email },
      body: JSON.stringify(body),
    });
  return { app, calls, post };
}

describe('in-app feedback', () => {
  it('creates a row in the Notion feedback database without the email address', async () => {
    const { calls, post } = setup();
    const res = await post({
      kind: 'bug',
      message: 'De productpagina scrolt horizontaal bij Winkels.',
      lang: 'nl',
      context: { page: '/gier/p/1', app: '0.1.0 · abc1234' },
    });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    const { headers, body } = calls[0]!;
    expect(headers.get('authorization')).toBe('Bearer secret_test');
    expect(body.parent).toEqual({ database_id: 'db123' });
    expect(body.properties.Soort).toEqual({ select: { name: 'Bug' } });
    expect(body.properties.Taal).toEqual({ select: { name: 'nl' } });
    expect(body.properties.Installatie.rich_text[0].text.content).toBe('prices.example.com');
    const sender = body.properties.Afzender.rich_text[0].text.content as string;
    expect(sender).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(body)).not.toContain('tester@example.com');
    expect(body.children[0].code.rich_text[0].text.content).toContain('page: /gier/p/1');
  });

  it('limits messages per person', async () => {
    const { post } = setup();
    const send = () =>
      post({ kind: 'idea', message: 'Nog een idee', lang: 'nl' }, 'busy@example.com');
    for (let i = 0; i < 5; i++) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });

  it('is hidden and refused when Notion is not configured', async () => {
    const { app, post } = setup({});
    const health = (await (await app.request('/gier/api/health')).json()) as {
      features: { feedback: boolean };
    };
    expect(health.features.feedback).toBe(false);
    expect((await post({ kind: 'bug', message: 'Hallo daar' })).status).toBe(503);
  });

  it('reports a Notion failure without crashing', async () => {
    const { post } = setup(NOTION_ENV, 401);
    const res = await post({ kind: 'question', message: 'Werkt dit?' }, 'other@example.com');
    expect(res.status).toBe(502);
  });
});
