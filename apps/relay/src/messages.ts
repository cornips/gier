import type { NotificationKind, RelayLanguage } from '@gier/relay-protocol';

export type Lang = RelayLanguage;

export const langOf = (code?: string): Lang => (code?.toLowerCase().startsWith('nl') ? 'nl' : 'en');

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Makes text that came from an installation harmless before it goes out in the bot's name:
 * Telegram turns domains, URLs, e-mail addresses and @names into links by itself. A one-dot leader
 * (U+2024) instead of the dot, and a zero-width space after "@", keep them readable but not clickable.
 */
export function defang(s: string): string {
  return s
    .replace(/([\p{L}\p{N}-])\.(?=[\p{L}]{2,})/gu, '$1․')
    .replace(/:\/\//g, ':∕∕')
    .replace(/@(?=[A-Za-z0-9_]{3,})/g, '@​');
}

/** Plain text from an installation → safe HTML for Telegram. */
export const safeText = (s: string) => escapeHtml(defang(s));

export const hostOf = (baseUrl: string) => {
  try {
    const u = new URL(baseUrl);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return baseUrl;
  }
};

const ICON: Record<NotificationKind, string> = {
  deal: '📉',
  fake: '⚠️',
  store: '🏪',
  warning: '⚠️',
  advice: '💡',
  digest: '🗓️',
  login: '🔑',
  test: '🦅',
};

export function notificationHtml(n: {
  kind: NotificationKind;
  title: string;
  body: string;
  /** Shown only when the chat is linked to more than one installation. */
  host?: string;
}) {
  const lines = [`${ICON[n.kind]} <b>${safeText(n.title)}</b>`];
  if (n.body) lines.push(safeText(n.body));
  // The bot already says it is Gier; only name the installation when there is more than one.
  if (n.host) lines.push('', `<i>${escapeHtml(n.host)}</i>`);
  return lines.join('\n');
}

export const FEEDBACK_KINDS = ['bug', 'idea', 'question', 'other'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** Option names in the Notion database, shared with the in-app feedback. */
export const FEEDBACK_LABEL: Record<FeedbackKind, string> = {
  bug: 'Bug',
  idea: 'Idee',
  question: 'Vraag',
  other: 'Overig',
};

const T = {
  en: {
    view: 'View',
    help: [
      '🦅 <b>Gier</b> sends your price alerts here.',
      '',
      'Linking starts in Gier: <i>Settings → Telegram → Link</i>. That opens this chat with a one-time code.',
      '',
      '/status – linked installations',
      '/stop – unlink',
      '/feedback – share a bug, idea or question',
      '/privacy – what is stored',
    ].join('\n'),
    linked: (host: string) =>
      `✅ Linked to Gier at <b>${host}</b>. Your price alerts will arrive here.\n\nDon't recognise this? Tap Unlink.`,
    codeInvalid:
      'This code has expired or was already used. Ask for a new one in Gier (Settings → Telegram → Link).',
    unlink: 'Unlink',
    unlinkAll: 'Unlink everything',
    giveFeedback: 'Give feedback',
    statusNone: 'This chat is not linked to any Gier installation. /help explains how.',
    statusList: (hosts: string[]) =>
      `This chat is linked to:\n${hosts.map((h) => `• ${h}`).join('\n')}`,
    stopChoose: 'Which link do you want to remove?',
    stopped: (host: string) => `Unlinked from ${host}. You will no longer get its alerts here.`,
    stoppedAll: 'All links removed. You will no longer get alerts here.',
    nothingLinked: 'Nothing to unlink.',
    fbNotLinked: 'Feedback is open to alpha testers. Link this chat from Gier first.',
    fbChoose: 'What is it about?',
    fbKinds: { bug: '🐞 Bug', idea: '💡 Idea', question: '❓ Question', other: 'Other' },
    fbType: 'Type your message. /cancel to stop.',
    fbThanks: 'Thanks! Your feedback has been received.',
    fbCancelled: 'Cancelled.',
    fbTooLong: (max: number) => `That is a bit long. Please keep it under ${max} characters.`,
    fbRate: 'You have sent a lot of feedback in a short time. Please try again later.',
    fbConfirm: 'Send this as feedback?',
    yes: 'Yes, send',
    no: 'No',
    onlyText: 'For now I can only take text. Please describe it in words.',
    privacy: [
      '<b>What gier-relay stores</b>',
      '• Per link: your chat id (encrypted), language, the installation and a pseudonymous user reference from it, and when you linked.',
      '• No Telegram names, and not the content of alerts.',
      '• Feedback goes to the maintainers with a pseudonym instead of your name; the relay deletes its copy once delivered.',
      '',
      '/stop removes your links. Blocking the bot does the same.',
    ].join('\n'),
  },
  nl: {
    view: 'Bekijk',
    help: [
      '🦅 <b>Gier</b> stuurt je prijsmeldingen hierheen.',
      '',
      'Koppelen begint in Gier: <i>Instellingen → Telegram → Koppel</i>. Dat opent deze chat met een eenmalige code.',
      '',
      '/status – gekoppelde installaties',
      '/stop – ontkoppelen',
      '/feedback – meld een bug, idee of vraag',
      '/privacy – wat er wordt bewaard',
    ].join('\n'),
    linked: (host: string) =>
      `✅ Gekoppeld aan Gier op <b>${host}</b>. Je prijsmeldingen komen voortaan hier binnen.\n\nHerken je dit niet? Tik op Ontkoppel.`,
    codeInvalid:
      'Deze code is verlopen of al gebruikt. Vraag in Gier een nieuwe aan (Instellingen → Telegram → Koppel).',
    unlink: 'Ontkoppel',
    unlinkAll: 'Alles ontkoppelen',
    giveFeedback: 'Feedback geven',
    statusNone: 'Deze chat is aan geen enkele Gier-installatie gekoppeld. /help legt uit hoe.',
    statusList: (hosts: string[]) =>
      `Deze chat is gekoppeld aan:\n${hosts.map((h) => `• ${h}`).join('\n')}`,
    stopChoose: 'Welke koppeling wil je verwijderen?',
    stopped: (host: string) => `Ontkoppeld van ${host}. Je krijgt hier geen meldingen meer van.`,
    stoppedAll: 'Alle koppelingen verwijderd. Je krijgt hier geen meldingen meer.',
    nothingLinked: 'Er is niets om te ontkoppelen.',
    fbNotLinked: 'Feedback staat open voor alpha-testers. Koppel deze chat eerst vanuit Gier.',
    fbChoose: 'Waar gaat het over?',
    fbKinds: { bug: '🐞 Bug', idea: '💡 Idee', question: '❓ Vraag', other: 'Overig' },
    fbType: 'Typ je bericht. /annuleer om te stoppen.',
    fbThanks: 'Bedankt! Je feedback is ontvangen.',
    fbCancelled: 'Geannuleerd.',
    fbTooLong: (max: number) => `Dat is wat lang. Houd het onder de ${max} tekens.`,
    fbRate: 'Je hebt in korte tijd veel feedback gestuurd. Probeer het later nog eens.',
    fbConfirm: 'Wil je dit als feedback sturen?',
    yes: 'Ja, versturen',
    no: 'Nee',
    onlyText: 'Ik kan voorlopig alleen tekst aannemen. Beschrijf het in woorden.',
    privacy: [
      '<b>Wat gier-relay bewaart</b>',
      '• Per koppeling: je chat-ID (versleuteld), taal, de installatie met een pseudonieme gebruikersverwijzing daarvan, en wanneer je koppelde.',
      '• Geen Telegram-namen en niet de inhoud van meldingen.',
      '• Feedback gaat naar de beheerders met een pseudoniem in plaats van je naam; de relay wist zijn kopie zodra die is afgeleverd.',
      '',
      '/stop verwijdert je koppelingen. De bot blokkeren doet hetzelfde.',
    ].join('\n'),
  },
} as const;

export const t = (lang: Lang) => T[lang];
