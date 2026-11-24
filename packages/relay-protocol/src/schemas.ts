import { z } from 'zod';

/** Kinds of notifications Gier sends; the relay only picks an icon from it. Mirrors the db enum. */
export const NOTIFICATION_KINDS = [
  'deal',
  'fake',
  'store',
  'warning',
  'advice',
  'digest',
  'login',
  'test',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const LANGUAGES = ['en', 'nl'] as const;
export type RelayLanguage = (typeof LANGUAGES)[number];

/** Opaque, pseudonymous reference to one user of an installation. Never an email address. */
export const subjectSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

/** 32-byte raw Ed25519 public key, base64url. */
export const publicKeySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** Link code as it appears after /start: Telegram allows 1–64 characters of A-Z a-z 0-9 _ -. */
export const linkCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

const httpsUrl = z
  .url()
  .refine((u) => {
    const url = new URL(u);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return (url.protocol === 'https:' || (local && url.protocol === 'http:')) && !url.search;
  }, 'base_url must be https without a query string')
  .transform((u) => u.replace(/\/+$/, ''));

export const registerRequest = z.object({
  /** Public address of the installation including its base path, e.g. https://example.com/gier */
  base_url: httpsUrl,
  public_key: publicKeySchema,
  registration_token: z.string().min(1).max(256),
});
export type RegisterRequest = z.input<typeof registerRequest>;
export const registerResponse = z.object({ installation_id: z.string() });

export const rotateKeyRequest = z.object({ public_key: publicKeySchema });
export const updateInstallationRequest = z.object({ base_url: httpsUrl });

export const linkCodeRequest = z.object({
  subject: subjectSchema,
  lang: z.enum(LANGUAGES).optional(),
});
export const linkCodeResponse = z.object({
  code: z.string(),
  url: z.string(),
  expires_at: z.string(),
});
export type LinkCodeResponse = z.infer<typeof linkCodeResponse>;

export const linkSchema = z.object({
  id: z.string(),
  subject: z.string(),
  lang: z.enum(LANGUAGES),
  created_at: z.string(),
});
export type RelayLink = z.infer<typeof linkSchema>;
export const linksResponse = z.object({ links: z.array(linkSchema) });

/** Paths stay inside the installation: no scheme, no host, no backslashes, no "//". */
const pathSchema = z
  .string()
  .max(300)
  .regex(/^\/(?!\/)[^\s\\]*$/);

export const notificationRequest = z.object({
  /** Without a subject the notification goes to every chat linked to this installation. */
  subject: subjectSchema.optional(),
  kind: z.enum(NOTIFICATION_KINDS),
  /** Plain text, already translated by Gier. The relay escapes it and neutralises links. */
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(600).default(''),
  /** Path below base_url for the "View" button, e.g. /p/42. */
  path: pathSchema.optional(),
  lang: z.enum(LANGUAGES).optional(),
  idempotency_key: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{8,100}$/)
    .optional(),
});
export type NotificationRequest = z.input<typeof notificationRequest>;
export const notificationResponse = z.object({
  sent: z.number(),
  failed: z.number(),
  removed: z.number(),
  duplicate: z.boolean().optional(),
});
export type NotificationResponse = z.infer<typeof notificationResponse>;

export const errorResponse = z.object({ error: z.string() });
