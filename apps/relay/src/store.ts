/** All D1 access in one place. Plain SQL so the same queries run on D1 and on SQLite in tests. */

export interface Installation {
  id: string;
  base_url: string;
  public_key: string;
  status: 'active' | 'blocked';
  created_at: number;
}

export interface LinkRow {
  id: string;
  installation_id: string;
  subject: string;
  chat_hash: string;
  chat_enc: string;
  lang: 'en' | 'nl';
  created_at: number;
}

export interface LinkWithInstallation extends LinkRow {
  base_url: string;
}

export interface FeedbackRow {
  id: number;
  installation_id: string | null;
  sender: string;
  kind: string;
  lang: string;
  message: string | null;
  created_at: number;
  notion_page_id: string | null;
  attempts: number;
}

export class Store {
  constructor(private readonly db: D1Database) {}

  // --- installations ---------------------------------------------------------

  installation(id: string) {
    return this.db
      .prepare('SELECT * FROM installations WHERE id = ?')
      .bind(id)
      .first<Installation>();
  }

  async createInstallation(i: Omit<Installation, 'status'>) {
    await this.db
      .prepare(
        'INSERT INTO installations (id, base_url, public_key, status, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(i.id, i.base_url, i.public_key, 'active', i.created_at)
      .run();
  }

  async setPublicKey(id: string, publicKey: string) {
    await this.db
      .prepare('UPDATE installations SET public_key = ? WHERE id = ?')
      .bind(publicKey, id)
      .run();
  }

  async setBaseUrl(id: string, baseUrl: string) {
    await this.db
      .prepare('UPDATE installations SET base_url = ? WHERE id = ?')
      .bind(baseUrl, id)
      .run();
  }

  /** Removes the installation with its codes and links (foreign keys are not enforced on D1 by default). */
  async deleteInstallation(id: string) {
    await this.db.batch([
      this.db.prepare('DELETE FROM link_codes WHERE installation_id = ?').bind(id),
      this.db.prepare('DELETE FROM links WHERE installation_id = ?').bind(id),
      this.db.prepare('DELETE FROM installations WHERE id = ?').bind(id),
    ]);
  }

  // --- replay protection, idempotency and counters ---------------------------

  /** True the first time a nonce is seen for this installation. */
  async useNonce(installationId: string, nonce: string, now: number) {
    const r = await this.db
      .prepare('INSERT OR IGNORE INTO nonces (installation_id, nonce, seen_at) VALUES (?, ?, ?)')
      .bind(installationId, nonce, now)
      .run();
    return r.meta.changes === 1;
  }

  /** True the first time an idempotency key is seen for this installation. */
  async useDelivery(installationId: string, key: string, now: number) {
    const r = await this.db
      .prepare(
        'INSERT OR IGNORE INTO deliveries (installation_id, idempotency_key, created_at) VALUES (?, ?, ?)',
      )
      .bind(installationId, key, now)
      .run();
    return r.meta.changes === 1;
  }

  /** Counts one hit in a fixed window; returns false once the limit is passed. */
  async hit(key: string, windowMs: number, limit: number, now: number) {
    // The window is stored as its start time, so windows of any size can be cleaned up alike.
    const winStart = Math.floor(now / windowMs) * windowMs;
    const row = await this.db
      .prepare(
        `INSERT INTO counters (key, win_start, count) VALUES (?, ?, 1)
         ON CONFLICT (key, win_start) DO UPDATE SET count = count + 1
         RETURNING count`,
      )
      .bind(key, winStart)
      .first<{ count: number }>();
    return (row?.count ?? 1) <= limit;
  }

  // --- linking ---------------------------------------------------------------

  async createLinkCode(c: {
    code_hash: string;
    installation_id: string;
    subject: string;
    lang: string | null;
    expires_at: number;
  }) {
    await this.db
      .prepare(
        'INSERT INTO link_codes (code_hash, installation_id, subject, lang, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(c.code_hash, c.installation_id, c.subject, c.lang, c.expires_at)
      .run();
  }

  /** Marks a valid code as used and returns it; null when unknown, used or expired. */
  takeLinkCode(codeHash: string, now: number) {
    return this.db
      .prepare(
        `UPDATE link_codes SET used_at = ?
         WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?
         RETURNING installation_id, subject, lang`,
      )
      .bind(now, codeHash, now)
      .first<{ installation_id: string; subject: string; lang: string | null }>();
  }

  /** Creates the link, or returns the existing one for the same installation, subject and chat. */
  async upsertLink(l: LinkRow): Promise<LinkRow> {
    await this.db
      .prepare(
        `INSERT INTO links (id, installation_id, subject, chat_hash, chat_enc, lang, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (installation_id, subject, chat_hash) DO UPDATE SET lang = excluded.lang`,
      )
      .bind(l.id, l.installation_id, l.subject, l.chat_hash, l.chat_enc, l.lang, l.created_at)
      .run();
    const row = await this.db
      .prepare('SELECT * FROM links WHERE installation_id = ? AND subject = ? AND chat_hash = ?')
      .bind(l.installation_id, l.subject, l.chat_hash)
      .first<LinkRow>();
    return row!;
  }

  async links(installationId: string, subject?: string) {
    const q = subject
      ? this.db
          .prepare(
            'SELECT * FROM links WHERE installation_id = ? AND subject = ? ORDER BY created_at',
          )
          .bind(installationId, subject)
      : this.db
          .prepare('SELECT * FROM links WHERE installation_id = ? ORDER BY created_at')
          .bind(installationId);
    return (await q.all<LinkRow>()).results;
  }

  async linksForChat(chatHash: string) {
    return (
      await this.db
        .prepare(
          `SELECT links.*, installations.base_url FROM links
           JOIN installations ON installations.id = links.installation_id
           WHERE links.chat_hash = ? ORDER BY links.created_at`,
        )
        .bind(chatHash)
        .all<LinkWithInstallation>()
    ).results;
  }

  /** Number of different installations this chat is linked to. */
  async installationCount(chatHash: string) {
    const row = await this.db
      .prepare('SELECT COUNT(DISTINCT installation_id) AS n FROM links WHERE chat_hash = ?')
      .bind(chatHash)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async deleteLink(id: string, scope: { installationId?: string; chatHash?: string }) {
    const r = scope.installationId
      ? await this.db
          .prepare('DELETE FROM links WHERE id = ? AND installation_id = ?')
          .bind(id, scope.installationId)
          .run()
      : await this.db
          .prepare('DELETE FROM links WHERE id = ? AND chat_hash = ?')
          .bind(id, scope.chatHash ?? '')
          .run();
    return r.meta.changes > 0;
  }

  async deleteLinksForChat(chatHash: string) {
    const r = await this.db.prepare('DELETE FROM links WHERE chat_hash = ?').bind(chatHash).run();
    return r.meta.changes;
  }

  // --- conversation state ----------------------------------------------------

  async chatState(chatHash: string, now: number) {
    return this.db
      .prepare('SELECT state, data FROM chat_state WHERE chat_hash = ? AND expires_at > ?')
      .bind(chatHash, now)
      .first<{ state: string; data: string | null }>();
  }

  async setChatState(chatHash: string, state: string, data: string | null, expiresAt: number) {
    await this.db
      .prepare(
        `INSERT INTO chat_state (chat_hash, state, data, expires_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (chat_hash) DO UPDATE SET state = excluded.state, data = excluded.data,
           expires_at = excluded.expires_at`,
      )
      .bind(chatHash, state, data, expiresAt)
      .run();
  }

  async clearChatState(chatHash: string) {
    await this.db.prepare('DELETE FROM chat_state WHERE chat_hash = ?').bind(chatHash).run();
  }

  // --- feedback --------------------------------------------------------------

  async addFeedback(f: Omit<FeedbackRow, 'id' | 'notion_page_id' | 'attempts'>) {
    const row = await this.db
      .prepare(
        `INSERT INTO feedback (installation_id, sender, kind, lang, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(f.installation_id, f.sender, f.kind, f.lang, f.message, f.created_at)
      .first<{ id: number }>();
    return row!.id;
  }

  async feedbackForSync(limit: number, ids?: number[]) {
    const base = `SELECT feedback.*, installations.base_url FROM feedback
      LEFT JOIN installations ON installations.id = feedback.installation_id
      WHERE feedback.notion_page_id IS NULL AND feedback.message IS NOT NULL AND feedback.attempts < 10`;
    const q = ids?.length
      ? this.db
          .prepare(`${base} AND feedback.id IN (${ids.map(() => '?').join(',')}) LIMIT ?`)
          .bind(...ids, limit)
      : this.db.prepare(`${base} ORDER BY feedback.id LIMIT ?`).bind(limit);
    return (await q.all<FeedbackRow & { base_url: string | null }>()).results;
  }

  /** In Notion now: drop the text from D1. */
  async feedbackSynced(id: number, pageId: string) {
    await this.db
      .prepare(
        'UPDATE feedback SET notion_page_id = ?, message = NULL, last_error = NULL WHERE id = ?',
      )
      .bind(pageId, id)
      .run();
  }

  async feedbackFailed(id: number, error: string) {
    await this.db
      .prepare('UPDATE feedback SET attempts = attempts + 1, last_error = ? WHERE id = ?')
      .bind(error.slice(0, 200), id)
      .run();
  }

  // --- housekeeping ----------------------------------------------------------

  async cleanup(now: number) {
    const day = 24 * 3600_000;
    await this.db.batch([
      this.db.prepare('DELETE FROM nonces WHERE seen_at < ?').bind(now - 15 * 60_000),
      this.db.prepare('DELETE FROM link_codes WHERE expires_at < ?').bind(now - day),
      this.db.prepare('DELETE FROM deliveries WHERE created_at < ?').bind(now - 2 * day),
      this.db.prepare('DELETE FROM chat_state WHERE expires_at < ?').bind(now),
      this.db.prepare('DELETE FROM counters WHERE win_start < ?').bind(now - 2 * day),
      this.db
        .prepare('DELETE FROM feedback WHERE notion_page_id IS NOT NULL AND created_at < ?')
        .bind(now - 30 * day),
    ]);
  }
}
