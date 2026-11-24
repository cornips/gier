import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { generateKeyPair, signRequest, toBase64Url, type KeyPair } from '@gier/relay-protocol';
import { createApp } from '../src/app';
import type { Bindings, Deps } from '../src/env';
import type { TgUpdate } from '../src/telegram';

/** Enough of the D1 API on top of in-memory SQLite to run the relay's real SQL. */
class Stmt {
  constructor(
    private readonly s: Database.Statement,
    private readonly args: unknown[] = [],
  ) {}
  bind(...args: unknown[]) {
    return new Stmt(this.s, args);
  }
  async first<T>() {
    if (this.s.reader) return (this.s.get(...this.args) as T | undefined) ?? null;
    this.s.run(...this.args);
    return null;
  }
  async all<T>() {
    return { results: this.s.all(...this.args) as T[], success: true, meta: {} };
  }
  async run() {
    if (this.s.reader) {
      const rows = this.s.all(...this.args);
      return { success: true, meta: { changes: rows.length } };
    }
    const r = this.s.run(...this.args);
    return { success: true, meta: { changes: r.changes } };
  }
  exec() {
    return this.run();
  }
}

export function fakeD1() {
  const db = new Database(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  const d1 = {
    prepare: (sql: string) => new Stmt(db.prepare(sql)),
    batch: async (stmts: Stmt[]) => {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
  };
  return { d1: d1 as unknown as D1Database, sqlite: db };
}

export interface Sent {
  method: string;
  body: Record<string, unknown>;
}

export const TEST_DATA_KEY = toBase64Url(new Uint8Array(32).fill(7));

export function makeRelay(over: Partial<Bindings> = {}) {
  const { d1, sqlite } = fakeD1();
  const telegram: Sent[] = [];
  const notion: Record<string, unknown>[] = [];
  const deferred: Promise<unknown>[] = [];
  // Real time, so the protocol's RelayClient (which signs with the current time) works too.
  let clock = new Date();
  /** Telegram answers per chat id, e.g. 403 for a chat that blocked the bot. */
  const tgStatus = new Map<string, number>();
  let notionStatus = 200;

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (url.startsWith('https://api.telegram.org/')) {
      const method = url.split('/').pop()!;
      telegram.push({ method, body });
      const status = tgStatus.get(String(body.chat_id)) ?? 200;
      if (status !== 200)
        return Response.json(
          {
            ok: false,
            description: status === 403 ? 'Forbidden: bot was blocked by the user' : 'x',
          },
          { status },
        );
      return Response.json({ ok: true, result: {} });
    }
    if (url === 'https://api.notion.com/v1/pages') {
      if (notionStatus !== 200) return Response.json({ code: 'oops' }, { status: notionStatus });
      notion.push(body);
      return Response.json({ id: `page-${notion.length}` });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  const env: Bindings = {
    DB: d1,
    TELEGRAM_BOT_TOKEN: 'bot-token',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
    BOT_USERNAME: 'gier_test_bot',
    DATA_KEY: TEST_DATA_KEY,
    REGISTRATION_TOKEN: 'reg-token',
    NOTION_TOKEN: 'notion-token',
    NOTION_FEEDBACK_DATABASE_ID: 'db-id',
    ...over,
  };
  const deps: Deps = {
    env,
    now: () => clock,
    fetch: fetchImpl,
    defer: (p) => void deferred.push(p),
  };
  const app = createApp(deps);

  let updateId = 1;
  const relay = {
    app,
    deps,
    sqlite,
    telegram,
    notion,
    tgStatus,
    setNotionStatus: (s: number) => (notionStatus = s),
    advance: (ms: number) => (clock = new Date(clock.getTime() + ms)),
    settle: async () => {
      await Promise.all(deferred.splice(0));
    },
    /** Telegram messages sent with sendMessage, newest last. */
    messages: () => telegram.filter((m) => m.method === 'sendMessage'),
    last: () => relay.messages().at(-1)!,

    update: (u: Omit<TgUpdate, 'update_id'>, secret = 'webhook-secret') =>
      app.request('/telegram/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
        body: JSON.stringify({ update_id: updateId++, ...u }),
      }),
    text: (chatId: number, text: string, language_code = 'nl') =>
      relay.update({
        message: {
          message_id: updateId,
          chat: { id: chatId, type: 'private' },
          from: { id: chatId, language_code },
          text,
        },
      }),
    press: (chatId: number, data: string, language_code = 'nl') =>
      relay.update({
        callback_query: {
          id: `cb${updateId}`,
          from: { id: chatId, language_code },
          data,
          message: { message_id: 99, chat: { id: chatId, type: 'private' } },
        },
      }),

    async register(baseUrl = 'https://gier.example.com/gier') {
      const keys = await generateKeyPair();
      const res = await app.request('/v1/installations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          base_url: baseUrl,
          public_key: keys.publicKey,
          registration_token: 'reg-token',
        }),
      });
      const { installation_id } = (await res.json()) as { installation_id: string };
      return installationClient(installation_id, keys);
    },
  };

  function installationClient(id: string, keys: KeyPair) {
    const call = async (method: string, path: string, payload?: unknown) => {
      const body = payload === undefined ? '' : JSON.stringify(payload);
      const headers = await signRequest({
        installationId: id,
        privateKey: keys.privateKey,
        method,
        path,
        body,
        now: clock,
      });
      return app.request(path, {
        method,
        headers: { ...headers, 'content-type': 'application/json' },
        ...(body ? { body } : {}),
      });
    };
    return {
      id,
      keys,
      call,
      async linkCode(subject = 'subject-0001') {
        const res = await call('POST', '/v1/link-codes', { subject });
        return (await res.json()) as { code: string; url: string };
      },
      async links(subject?: string) {
        const res = await call('GET', `/v1/links${subject ? `?subject=${subject}` : ''}`);
        return ((await res.json()) as { links: { id: string }[] }).links;
      },
      notify: (n: Record<string, unknown>) => call('POST', '/v1/notifications', n),
    };
  }

  return relay;
}
