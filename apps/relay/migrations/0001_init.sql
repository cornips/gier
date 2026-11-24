-- gier-relay schema (ADR-016). Times are Unix milliseconds.

CREATE TABLE installations (
  id TEXT PRIMARY KEY,
  base_url TEXT NOT NULL,
  public_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active | blocked
  created_at INTEGER NOT NULL
);

-- One-time codes behind t.me/<bot>?start=<code>; only the SHA-256 of the code is stored.
CREATE TABLE link_codes (
  code_hash TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  lang TEXT,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

-- A Telegram chat that linked itself to one user (subject) of one installation.
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  chat_hash TEXT NOT NULL, -- HMAC of the chat id, for lookups
  chat_enc TEXT NOT NULL,  -- AES-GCM encrypted chat id, for sending
  lang TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (installation_id, subject, chat_hash)
);
CREATE INDEX links_chat ON links (chat_hash);

-- Replay protection for signed requests.
CREATE TABLE nonces (
  installation_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (installation_id, nonce)
);

-- Idempotency keys of notifications already sent.
CREATE TABLE deliveries (
  installation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (installation_id, idempotency_key)
);

-- Fixed-window counters for quotas and rate limits.
CREATE TABLE counters (
  key TEXT NOT NULL,
  win_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, win_start)
);

-- Short-lived conversation state, e.g. "waiting for the feedback text".
CREATE TABLE chat_state (
  chat_hash TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  data TEXT,
  expires_at INTEGER NOT NULL
);

-- Feedback waiting for (or already copied to) Notion. The text is cleared once it is in Notion.
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id TEXT,
  sender TEXT NOT NULL,
  kind TEXT NOT NULL,
  lang TEXT NOT NULL,
  message TEXT,
  created_at INTEGER NOT NULL,
  notion_page_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE INDEX feedback_pending ON feedback (notion_page_id, attempts);
