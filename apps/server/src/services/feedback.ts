import { createHmac } from 'node:crypto';
import type { Ctx } from '../context';
import { APP_VERSION } from '../version';

export const FEEDBACK_KINDS = ['bug', 'idea', 'question', 'other'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** Option names in the Notion database (shared with the Telegram relay). */
const KIND_LABEL: Record<FeedbackKind, string> = {
  bug: 'Bug',
  idea: 'Idee',
  question: 'Vraag',
  other: 'Overig',
};

export interface FeedbackInput {
  kind: FeedbackKind;
  message: string;
  lang: 'en' | 'nl';
  /** Technical context from the app: page, client build, screen, display mode, browser. */
  context: Record<string, string>;
  /** Who sent it, as told by the login proxy (Cloudflare Access). Never stored in plain text. */
  user: string | null;
}

export const feedbackAvailable = (ctx: Ctx) =>
  Boolean(ctx.env.NOTION_TOKEN && ctx.env.NOTION_FEEDBACK_DATABASE_ID);

/** Same person → same short code, without storing who it is. */
export function pseudonym(ctx: Ctx, user: string | null): string {
  if (!user) return 'anonymous';
  return createHmac('sha256', ctx.env.GIER_SECRET)
    .update(user.toLowerCase())
    .digest('hex')
    .slice(0, 8);
}

const recent = new Map<string, number[]>();
const LIMIT = 5;
const WINDOW_MS = 10 * 60_000;

/** At most a few messages per person per ten minutes, so a stuck button cannot flood Notion. */
export function allowFeedback(sender: string, now = Date.now()): boolean {
  const times = (recent.get(sender) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= LIMIT) return false;
  times.push(now);
  recent.set(sender, times);
  return true;
}

const text = (content: string) => [{ type: 'text', text: { content: content.slice(0, 2000) } }];

/** Creates one row in the feedback database. Throws with the Notion status on failure. */
export async function sendFeedback(ctx: Ctx, input: FeedbackInput): Promise<{ id: string }> {
  const sender = pseudonym(ctx, input.user);
  const instance =
    ctx.env.GIER_INSTANCE_NAME ??
    (() => {
      try {
        return new URL(ctx.env.GIER_PUBLIC_URL).host;
      } catch {
        return 'gier';
      }
    })();
  const summary = input.message.replace(/\s+/g, ' ').trim().slice(0, 60);
  const context = {
    server: ctx.env.GIER_COMMIT
      ? `${APP_VERSION} · ${ctx.env.GIER_COMMIT.slice(0, 7)}`
      : APP_VERSION,
    ...input.context,
  };
  const res = await ctx.http('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ctx.env.NOTION_TOKEN}`,
      'notion-version': '2022-06-28',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      parent: { database_id: ctx.env.NOTION_FEEDBACK_DATABASE_ID },
      properties: {
        Samenvatting: { title: text(summary || KIND_LABEL[input.kind]) },
        Bericht: { rich_text: text(input.message) },
        Soort: { select: { name: KIND_LABEL[input.kind] } },
        Taal: { select: { name: input.lang } },
        Installatie: { rich_text: text(instance) },
        Afzender: { rich_text: text(sender) },
        Ontvangen: { date: { start: ctx.now().toISOString() } },
      },
      children: [
        {
          object: 'block',
          type: 'code',
          code: {
            language: 'plain text',
            rich_text: text(
              Object.entries(context)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n'),
            ),
          },
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    throw new Error(`notion_${res.status}${body.code ? `_${body.code}` : ''}`);
  }
  const page = (await res.json()) as { id: string };
  return { id: page.id };
}
