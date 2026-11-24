import { z } from 'zod';
import {
  linkCodeResponse,
  linksResponse,
  notificationResponse,
  registerResponse,
  type LinkCodeResponse,
  type NotificationRequest,
  type NotificationResponse,
  type RelayLanguage,
  type RelayLink,
} from './schemas';
import { signRequest } from './signing';

export class RelayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfter?: number,
  ) {
    super(`relay_${status}_${code}`);
  }
}

export interface RelayIdentity {
  installationId: string;
  privateKey: string;
}

/** Client for gier-relay, used by a Gier installation. */
export class RelayClient {
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly identity: () => Promise<RelayIdentity>,
    private readonly http: typeof fetch = fetch,
  ) {
    this.base = baseUrl.replace(/\/+$/, '');
  }

  /** One-time registration; needs the registration token from whoever runs the relay. */
  static async register(
    baseUrl: string,
    body: { base_url: string; public_key: string; registration_token: string },
    http: typeof fetch = fetch,
  ): Promise<string> {
    const res = await http(`${baseUrl.replace(/\/+$/, '')}/v1/installations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await parse(res, registerResponse)).installation_id;
  }

  private async call<T extends z.ZodType>(
    method: string,
    path: string,
    schema: T,
    payload?: unknown,
  ): Promise<z.infer<T>> {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const id = await this.identity();
    const headers = await signRequest({
      installationId: id.installationId,
      privateKey: id.privateKey,
      method,
      path,
      body,
    });
    const res = await this.http(`${this.base}${path}`, {
      method,
      headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body } : {}),
    });
    return parse(res, schema);
  }

  createLinkCode(subject: string, lang?: RelayLanguage): Promise<LinkCodeResponse> {
    return this.call('POST', '/v1/link-codes', linkCodeResponse, { subject, lang });
  }

  async links(subject?: string): Promise<RelayLink[]> {
    const query = subject ? `?subject=${encodeURIComponent(subject)}` : '';
    return (await this.call('GET', `/v1/links${query}`, linksResponse)).links;
  }

  async unlink(id: string): Promise<void> {
    await this.call('DELETE', `/v1/links/${encodeURIComponent(id)}`, okSchema);
  }

  notify(n: NotificationRequest): Promise<NotificationResponse> {
    return this.call('POST', '/v1/notifications', notificationResponse, n);
  }

  async updateBaseUrl(baseUrl: string): Promise<void> {
    await this.call('PATCH', '/v1/installations/self', okSchema, { base_url: baseUrl });
  }
}

const okSchema = z.unknown();

async function parse<T extends z.ZodType>(res: Response, schema: T): Promise<z.infer<T>> {
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    const retry = Number(res.headers.get('retry-after'));
    throw new RelayError(
      res.status,
      json.error ?? 'unknown',
      Number.isFinite(retry) && retry > 0 ? retry : undefined,
    );
  }
  return schema.parse(json);
}
