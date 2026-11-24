import type { Deps } from './env';

/** The parts of the Telegram Bot API the relay uses. */
export interface TgUser {
  id: number;
  is_bot?: boolean;
  language_code?: string;
}
export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}
export interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  photo?: unknown[];
  document?: unknown;
  voice?: unknown;
  video?: unknown;
  sticker?: unknown;
}
export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
  my_chat_member?: { chat: TgChat; new_chat_member: { status: string } };
}

export interface Button {
  text: string;
  url?: string;
  callback_data?: string;
}
export type Keyboard = Button[][];

export class TelegramError extends Error {
  constructor(
    readonly status: number,
    readonly description: string,
    readonly retryAfter?: number,
  ) {
    super(`telegram_${status}`);
  }
  /** The user blocked the bot or deleted the chat: the link is dead. */
  get gone() {
    return this.status === 403 || /chat not found/i.test(this.description);
  }
}

export class Telegram {
  constructor(private readonly deps: Deps) {}

  private async call(method: string, body: Record<string, unknown>) {
    const base = this.deps.env.TELEGRAM_API_URL ?? 'https://api.telegram.org';
    const res = await this.deps.fetch(`${base}/bot${this.deps.env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      parameters?: { retry_after?: number };
    };
    if (!res.ok || !json.ok)
      throw new TelegramError(res.status, json.description ?? '', json.parameters?.retry_after);
    return json;
  }

  send(chatId: string | number, html: string, keyboard?: Keyboard) {
    return this.call('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  answerCallback(id: string, text?: string) {
    return this.call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) });
  }

  /** Removes the buttons under an earlier message so they cannot be pressed twice. */
  clearButtons(chatId: number, messageId: number) {
    return this.call('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    }).catch(() => undefined);
  }
}
