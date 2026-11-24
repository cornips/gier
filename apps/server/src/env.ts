import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8787),
  /** Optional base path when Gier is served below a path, e.g. "/gier". Empty = site root. */
  GIER_BASE_PATH: z.string().default(''),
  /** Public origin used in notification links, e.g. https://gier.example.com */
  GIER_PUBLIC_URL: z.string().default('http://localhost:8787'),
  /** Secret for encrypting stored shop sessions (32+ characters). Generated into the data folder when unset. */
  GIER_SECRET: z.string().min(16).default('development-secret-change-me'),
  DATABASE_FILE: z.string().default('./data/gier.db'),
  /** Language for notifications until the web app reports the user's language (en, nl). */
  GIER_LANGUAGE: z.enum(['en', 'nl']).default('en'),
  /** Directory with the built web app; served under the base path. */
  WEB_DIST: z.string().default('../web/dist'),
  SCHEDULER: z.enum(['on', 'off']).default('on'),
  USER_AGENT: z
    .string()
    .default(
      'GierBot/0.1 (+https://github.com/cornips/gier; self-hosted price tracker, low frequency)',
    ),

  SEARXNG_URL: optional,
  BRAVE_API_KEY: optional,
  /** Hard cap for Brave usage in USD per month; defaults to the free monthly credit. */
  BRAVE_MONTHLY_CAP_USD: z.coerce.number().default(5),
  BRAVE_COST_PER_QUERY_USD: z.coerce.number().default(0.005),

  ANTHROPIC_API_KEY: optional,
  ANTHROPIC_MODEL: z.string().default('claude-haiku-5-5'),
  AI_MONTHLY_CAP_EUR: z.coerce.number().default(2),

  CLOUDFLARE_ACCOUNT_ID: optional,
  CLOUDFLARE_API_TOKEN: optional,

  VAPID_PUBLIC_KEY: optional,
  VAPID_PRIVATE_KEY: optional,
  VAPID_SUBJECT: z.string().default('mailto:gier@example.com'),

  TELEGRAM_BOT_TOKEN: optional,
  TELEGRAM_CHAT_ID: optional,
  /**
   * Shared Telegram bot through gier-relay (ADR-016). Both set = users link their own chat from
   * Settings; this takes precedence over TELEGRAM_BOT_TOKEN/_CHAT_ID.
   */
  GIER_RELAY_URL: optional,
  GIER_RELAY_REGISTRATION_TOKEN: optional,
  NTFY_URL: optional,
  NTFY_TOKEN: optional,
  HOME_ASSISTANT_WEBHOOK_URL: optional,

  /**
   * In-app feedback to a Notion database (alpha testing). Token of a Notion connection that may only
   * insert into that database. Both empty = the feedback option is hidden.
   */
  NOTION_TOKEN: optional,
  NOTION_FEEDBACK_DATABASE_ID: optional,
  /** Name of this installation in feedback rows; defaults to the host of GIER_PUBLIC_URL. */
  GIER_INSTANCE_NAME: optional,
  /** Commit the image was built from (set by the Docker build). */
  GIER_COMMIT: optional,
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  // Treat empty values (KEY= in .env files, ${KEY:-} in Compose) as not set.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''),
  );
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    throw new Error(
      `Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  const env = parsed.data;
  env.GIER_BASE_PATH = '/' + env.GIER_BASE_PATH.replace(/^\/+|\/+$/g, '');
  if (env.GIER_BASE_PATH === '/') env.GIER_BASE_PATH = '';
  return env;
}
