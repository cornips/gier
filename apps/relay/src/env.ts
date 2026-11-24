/** Bindings of the Worker (wrangler.toml vars + secrets + D1). */
export interface Bindings {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  BOT_USERNAME: string;
  /** 32 random bytes, base64url. Encrypts chat ids and keys the pseudonyms. */
  DATA_KEY: string;
  /** Unset or empty = registration closed. */
  REGISTRATION_TOKEN?: string;
  NOTION_TOKEN?: string;
  NOTION_FEEDBACK_DATABASE_ID?: string;
  DAILY_NOTIFICATION_LIMIT?: string;
  /** Only for tests and local development. */
  TELEGRAM_API_URL?: string;
}

/** What the handlers need besides the bindings; swapped out in tests. */
export interface Deps {
  env: Bindings;
  now: () => Date;
  fetch: typeof fetch;
  /** Run work after the response is sent (ctx.waitUntil in the Worker). */
  defer: (p: Promise<unknown>) => void;
}

export const LIMITS = {
  linkCodeTtlMs: 10 * 60_000,
  nonceTtlMs: 10 * 60_000,
  chatStateTtlMs: 10 * 60_000,
  deliveryTtlMs: 48 * 3600_000,
  /** Link codes an installation may ask for per hour. */
  linkCodesPerHour: 30,
  /** Registration attempts per IP per day (the token is required anyway). */
  registrationsPerIpPerDay: 10,
  feedbackPerChatPerHour: 5,
  feedbackMaxLength: 2000,
  defaultDailyNotifications: 300,
} as const;

export const dailyLimit = (env: Bindings) => {
  const n = Number(env.DAILY_NOTIFICATION_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : LIMITS.defaultDailyNotifications;
};
