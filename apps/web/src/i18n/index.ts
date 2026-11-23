import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import nl from './nl.json';

/**
 * English is the source language. Gier follows the browser/system language when it has a translation,
 * unless the user picks one in Settings. Adding a language: copy en.json, translate it, register it here
 * (and in apps/server/src/i18n.ts for notifications).
 */
export const LANGUAGES = { en: 'English', nl: 'Nederlands' } as const;
export type Language = keyof typeof LANGUAGES;
export type LanguageChoice = Language | 'auto';
const STORAGE_KEY = 'gier.lang';

const isLanguage = (v: unknown): v is Language => typeof v === 'string' && v in LANGUAGES;

export function languageChoice(): LanguageChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLanguage(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function detectLanguage(): Language {
  const preferred =
    typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
  for (const tag of preferred) {
    const base = tag?.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return 'en';
}

export const resolveLanguage = (choice: LanguageChoice): Language =>
  choice === 'auto' ? detectLanguage() : choice;

export function chooseLanguage(choice: LanguageChoice) {
  try {
    if (choice === 'auto') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* private mode: the choice lasts for this session */
  }
  void i18n.changeLanguage(resolveLanguage(choice));
}

/** Locale for numbers, money and dates. Euro amounts read naturally in en-IE. */
export const locale = () => (i18n.language === 'nl' ? 'nl-NL' : 'en-IE');

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, nl: { translation: nl } },
  lng: resolveLanguage(languageChoice()),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

const syncDocument = (lng: string) => {
  if (typeof document !== 'undefined') document.documentElement.lang = lng;
};
syncDocument(i18n.language);
i18n.on('languageChanged', syncDocument);

export default i18n;
