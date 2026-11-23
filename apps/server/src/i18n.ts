import { eq } from 'drizzle-orm';
import { formatEuro } from '@gier/core';
import { settings } from '@gier/db';
import type { Ctx } from './context';

/**
 * Server-side texts (notifications, digest, AI language). English is the default; the web app reports
 * the language the user sees (browser preference or chosen in settings) so notifications follow it.
 * To add a language: add it to LANGUAGES, MESSAGES and apps/web/src/i18n.
 */
export const LANGUAGES = ['en', 'nl'] as const;
export type Language = (typeof LANGUAGES)[number];
const SETTING_KEY = 'ui.language';

const LOCALE: Record<Language, string> = { en: 'en-IE', nl: 'nl-NL' };
const LANGUAGE_NAME: Record<Language, string> = { en: 'English', nl: 'Dutch' };

type Vars = Record<string, string | number>;
type Messages = Record<string, string>;

const MESSAGES: Record<Language, Messages> = {
  en: {
    'alert.below.title': 'Below target · {product}',
    'alert.below.body': '{store}: {price} (target {target}).',
    'alert.above.title': 'Above {threshold} · {product}',
    'alert.above.body': 'Lowest price is now {price}.',
    'alert.change.title': 'Price change · {product}',
    'alert.change.body': '{from} → {to} at {store}.',
    'alert.drop.title': '{percent}% cheaper · {product}',
    'alert.low.title': 'Top deal · {product}',
    'alert.low.body': '{store}: {price}, the lowest price since you started tracking.',
    'alert.stock.title': 'Back in stock · {product}',
    'alert.stock.body': '{store} has it again.',
    'alert.fake.title': 'Fake discount · {product}',
    'alert.fake.body': "{store} advertises a discount that doesn't match what Gier saw.",
    'store.relogin.title': 'Log in to {store} again',
    'store.relogin.body': 'Gier can no longer read the logged-in price.',
    'store.attention.title': '{store} needs attention',
    'store.attention.body': 'Could not read the price of {product} 3 times ({error}).',
    'discovery.new.title': 'New store found · {product}',
    'discovery.new.body': '{count} new trusted store(s) followed automatically.',
    'digest.title.deals': 'Weekly digest · {count} good deal(s)',
    'digest.title.none': 'Weekly digest · no notable deals',
    'digest.deal': '• {product}: {price} at {store}',
    'digest.lows': '{count} product(s) at their lowest price ever.',
    'digest.fakes': '{count} fake discount(s) spotted.',
    'digest.ai': 'AI this month: {cost}.',
    'push.test.title': 'Gier test',
    'push.test.body': 'Notifications work.',
    'notify.open': 'View',
    'login.instructions': 'Log in to the shop, then click Done.',
  },
  nl: {
    'alert.below.title': 'Onder doelprijs · {product}',
    'alert.below.body': '{store}: {price} (doel {target}).',
    'alert.above.title': 'Boven {threshold} · {product}',
    'alert.above.body': 'Laagste prijs is nu {price}.',
    'alert.change.title': 'Prijswijziging · {product}',
    'alert.change.body': '{from} → {to} bij {store}.',
    'alert.drop.title': '{percent}% goedkoper · {product}',
    'alert.low.title': 'Topdeal · {product}',
    'alert.low.body': '{store}: {price}, de laagste prijs sinds je volgt.',
    'alert.stock.title': 'Weer op voorraad · {product}',
    'alert.stock.body': '{store} heeft hem weer.',
    'alert.fake.title': 'Nep-korting · {product}',
    'alert.fake.body': '{store} adverteert een korting die niet klopt met wat Gier zag.',
    'store.relogin.title': 'Opnieuw inloggen bij {store}',
    'store.relogin.body': 'Gier kan de ingelogde prijs niet meer uitlezen.',
    'store.attention.title': '{store} heeft aandacht nodig',
    'store.attention.body': 'Prijs van {product} 3× niet uitgelezen ({error}).',
    'discovery.new.title': 'Nieuwe winkel gevonden · {product}',
    'discovery.new.body': '{count} nieuwe betrouwbare winkel(s) automatisch gevolgd.',
    'digest.title.deals': 'Weekoverzicht · {count} goede deal(s)',
    'digest.title.none': 'Weekoverzicht · geen bijzondere deals',
    'digest.deal': '• {product}: {price} bij {store}',
    'digest.lows': '{count} product(en) op de laagste prijs ooit.',
    'digest.fakes': '{count} nep-korting(en) gespot.',
    'digest.ai': 'AI deze maand: {cost}.',
    'push.test.title': 'Gier test',
    'push.test.body': 'Meldingen werken.',
    'notify.open': 'Bekijk',
    'login.instructions': 'Log in bij de winkel en klik daarna op Klaar.',
  },
};

export const isLanguage = (v: unknown): v is Language => LANGUAGES.includes(v as Language);

export function language(ctx: Ctx): Language {
  const row = ctx.db.select().from(settings).where(eq(settings.key, SETTING_KEY)).get();
  return isLanguage(row?.value) ? row.value : ctx.env.GIER_LANGUAGE;
}

export function setLanguage(ctx: Ctx, lang: Language) {
  ctx.db
    .insert(settings)
    .values({ key: SETTING_KEY, value: lang })
    .onConflictDoUpdate({ target: settings.key, set: { value: lang } })
    .run();
}

export const languageName = (lang: Language) => LANGUAGE_NAME[lang];

/** Translator bound to the current language; money in the matching locale. */
export function translator(ctx: Ctx) {
  const lang = language(ctx);
  const t = (key: string, vars: Vars = {}) =>
    (MESSAGES[lang][key] ?? MESSAGES.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) =>
      String(vars[k] ?? `{${k}}`),
    );
  const money = (cents: number | null | undefined) =>
    cents == null ? '–' : formatEuro(cents, LOCALE[lang]);
  return { lang, t, money };
}
