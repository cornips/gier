import type { Deps } from './env';
import { FEEDBACK_LABEL, hostOf, type FeedbackKind } from './messages';
import type { Store } from './store';

export const notionConfigured = (deps: Deps) =>
  Boolean(deps.env.NOTION_TOKEN && deps.env.NOTION_FEEDBACK_DATABASE_ID);

const text = (content: string) => [{ type: 'text', text: { content: content.slice(0, 2000) } }];

/**
 * Copies pending feedback to Notion, in the same shape as Gier's in-app feedback. Rows that fail
 * stay in D1 and are retried by the cron trigger; the text is deleted from D1 once it is in Notion.
 */
export async function syncFeedback(deps: Deps, store: Store, ids?: number[]) {
  if (!notionConfigured(deps)) return { synced: 0, failed: 0 };
  const rows = await store.feedbackForSync(10, ids);
  let synced = 0;
  let failed = 0;
  for (const row of rows) {
    const message = row.message ?? '';
    const summary = message.replace(/\s+/g, ' ').trim().slice(0, 60);
    const label = FEEDBACK_LABEL[row.kind as FeedbackKind] ?? FEEDBACK_LABEL.other;
    try {
      const res = await deps.fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${deps.env.NOTION_TOKEN}`,
          'notion-version': '2022-06-28',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          parent: { database_id: deps.env.NOTION_FEEDBACK_DATABASE_ID },
          properties: {
            Samenvatting: { title: text(summary || label) },
            Bericht: { rich_text: text(message) },
            Soort: { select: { name: label } },
            Taal: { select: { name: row.lang } },
            Installatie: { rich_text: text(row.base_url ? hostOf(row.base_url) : 'unknown') },
            Afzender: { rich_text: text(row.sender) },
            Ontvangen: { date: { start: new Date(row.created_at).toISOString() } },
          },
          children: [
            {
              object: 'block',
              type: 'code',
              code: { language: 'plain text', rich_text: text('channel: telegram') },
            },
          ],
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        throw new Error(`notion_${res.status}${body.code ? `_${body.code}` : ''}`);
      }
      const page = (await res.json()) as { id: string };
      await store.feedbackSynced(row.id, page.id);
      synced++;
    } catch (e) {
      await store.feedbackFailed(row.id, (e as Error).message);
      failed++;
      // Notion rate limits per connection; stop this round and let the next one continue.
      if ((e as Error).message.startsWith('notion_429')) break;
    }
  }
  return { synced, failed };
}
