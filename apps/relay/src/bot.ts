import { linkCodeSchema, randomToken, sha256Hex } from '@gier/relay-protocol';
import { LIMITS, type Deps } from './env';
import { syncFeedback } from './feedback';
import { dataKeys } from './keys';
import { FEEDBACK_KINDS, hostOf, langOf, t, type FeedbackKind, type Lang } from './messages';
import type { Store } from './store';
import {
  Telegram,
  type Keyboard,
  type TgCallbackQuery,
  type TgMessage,
  type TgUpdate,
} from './telegram';

/** Handles one Telegram update. Only private chats; groups are ignored. */
export async function handleUpdate(deps: Deps, store: Store, update: TgUpdate) {
  const bot = new Bot(deps, store);
  if (update.my_chat_member) {
    const { chat, new_chat_member } = update.my_chat_member;
    // Blocking the bot ends every link of that chat.
    if (chat.type === 'private' && ['kicked', 'left'].includes(new_chat_member.status))
      await store.deleteLinksForChat(await bot.chatHash(chat.id));
    return;
  }
  if (update.callback_query) return bot.callback(update.callback_query);
  if (update.message && update.message.chat.type === 'private' && !update.message.from?.is_bot)
    return bot.message(update.message);
}

class Bot {
  private readonly tg: Telegram;

  constructor(
    private readonly deps: Deps,
    private readonly store: Store,
  ) {
    this.tg = new Telegram(deps);
  }

  private now = () => this.deps.now().getTime();

  async chatHash(chatId: number) {
    return (await dataKeys(this.deps.env.DATA_KEY)).hash(`chat:${chatId}`);
  }

  private async sender(chatId: number) {
    const h = await (await dataKeys(this.deps.env.DATA_KEY)).hash(`sender:${chatId}`);
    return `tg-${h.slice(0, 8)}`;
  }

  async message(m: TgMessage) {
    const lang = langOf(m.from?.language_code);
    const chatId = m.chat.id;
    const chat = await this.chatHash(chatId);
    const text = m.text?.trim();

    if (!text) {
      if (m.photo || m.document || m.voice || m.video) await this.tg.send(chatId, t(lang).onlyText);
      return;
    }

    const command = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
    if (command) {
      const name = command[1]!.toLowerCase();
      const arg = command[2]?.trim() ?? '';
      if (name !== 'feedback') await this.store.clearChatState(chat);
      switch (name) {
        case 'start':
          return arg ? this.link(chatId, chat, arg, lang) : this.tg.send(chatId, t(lang).help);
        case 'status':
          return this.status(chatId, chat, lang);
        case 'stop':
          return this.stop(chatId, chat, lang);
        case 'feedback':
          return this.feedbackStart(chatId, chat, lang, arg);
        case 'cancel':
        case 'annuleer':
          return this.tg.send(chatId, t(lang).fbCancelled);
        case 'privacy':
          return this.tg.send(chatId, t(lang).privacy);
        default:
          return this.tg.send(chatId, t(lang).help);
      }
    }

    // Free text: the feedback text we asked for, or an offer to send it as feedback.
    const state = await this.store.chatState(chat, this.now());
    if (state?.state === 'feedback_text') {
      const kind = (FEEDBACK_KINDS as readonly string[]).includes(state.data ?? '')
        ? (state.data as FeedbackKind)
        : 'other';
      return this.saveFeedback(chatId, chat, lang, kind, text);
    }
    const links = await this.store.linksForChat(chat);
    if (!links.length) return this.tg.send(chatId, t(lang).help);
    if (text.length > LIMITS.feedbackMaxLength)
      return this.tg.send(chatId, t(lang).fbTooLong(LIMITS.feedbackMaxLength));
    await this.store.setChatState(
      chat,
      'feedback_confirm',
      text,
      this.now() + LIMITS.chatStateTtlMs,
    );
    return this.tg.send(chatId, t(lang).fbConfirm, [
      [
        { text: t(lang).yes, callback_data: 'fb:send' },
        { text: t(lang).no, callback_data: 'fb:no' },
      ],
    ]);
  }

  async callback(q: TgCallbackQuery) {
    const lang = langOf(q.from.language_code);
    const chatId = q.message?.chat.id;
    if (!chatId || q.message?.chat.type !== 'private') return this.tg.answerCallback(q.id);
    const chat = await this.chatHash(chatId);
    const data = q.data ?? '';
    await this.tg.answerCallback(q.id);
    if (q.message) await this.tg.clearButtons(chatId, q.message.message_id);

    if (data === 'unlink:all') {
      const n = await this.store.deleteLinksForChat(chat);
      return this.tg.send(chatId, n ? t(lang).stoppedAll : t(lang).nothingLinked);
    }
    if (data.startsWith('unlink:')) {
      const id = data.slice('unlink:'.length);
      const link = (await this.store.linksForChat(chat)).find((l) => l.id === id);
      if (!link || !(await this.store.deleteLink(id, { chatHash: chat })))
        return this.tg.send(chatId, t(lang).nothingLinked);
      return this.tg.send(chatId, t(lang).stopped(hostOf(link.base_url)));
    }
    if (data === 'fb:start') return this.feedbackStart(chatId, chat, lang, '');
    if (data.startsWith('fb:kind:')) {
      const kind = data.slice('fb:kind:'.length);
      if (!(FEEDBACK_KINDS as readonly string[]).includes(kind)) return;
      await this.store.setChatState(
        chat,
        'feedback_text',
        kind,
        this.now() + LIMITS.chatStateTtlMs,
      );
      return this.tg.send(chatId, t(lang).fbType);
    }
    if (data === 'fb:send') {
      const state = await this.store.chatState(chat, this.now());
      if (state?.state !== 'feedback_confirm' || !state.data)
        return this.tg.send(chatId, t(lang).fbCancelled);
      return this.saveFeedback(chatId, chat, lang, 'other', state.data);
    }
    if (data === 'fb:no') {
      await this.store.clearChatState(chat);
      return this.tg.send(chatId, t(lang).fbCancelled);
    }
  }

  private async link(chatId: number, chat: string, code: string, lang: Lang) {
    if (!linkCodeSchema.safeParse(code).success) return this.tg.send(chatId, t(lang).codeInvalid);
    const taken = await this.store.takeLinkCode(await sha256Hex(code), this.now());
    const installation = taken && (await this.store.installation(taken.installation_id));
    if (!taken || !installation || installation.status !== 'active')
      return this.tg.send(chatId, t(lang).codeInvalid);
    const keys = await dataKeys(this.deps.env.DATA_KEY);
    const link = await this.store.upsertLink({
      id: `lnk_${randomToken(12)}`,
      installation_id: installation.id,
      subject: taken.subject,
      chat_hash: chat,
      chat_enc: await keys.encrypt(String(chatId)),
      lang: taken.lang === 'nl' || taken.lang === 'en' ? taken.lang : lang,
      created_at: this.now(),
    });
    return this.tg.send(chatId, t(lang).linked(hostOf(installation.base_url)), [
      [
        { text: t(lang).unlink, callback_data: `unlink:${link.id}` },
        { text: t(lang).giveFeedback, callback_data: 'fb:start' },
      ],
    ]);
  }

  private async status(chatId: number, chat: string, lang: Lang) {
    const links = await this.store.linksForChat(chat);
    if (!links.length) return this.tg.send(chatId, t(lang).statusNone);
    return this.tg.send(chatId, t(lang).statusList(unique(links.map((l) => hostOf(l.base_url)))));
  }

  private async stop(chatId: number, chat: string, lang: Lang) {
    const links = await this.store.linksForChat(chat);
    if (!links.length) return this.tg.send(chatId, t(lang).nothingLinked);
    const keyboard: Keyboard = links.map((l) => [
      { text: `${t(lang).unlink} ${hostOf(l.base_url)}`, callback_data: `unlink:${l.id}` },
    ]);
    if (links.length > 1) keyboard.push([{ text: t(lang).unlinkAll, callback_data: 'unlink:all' }]);
    return this.tg.send(chatId, t(lang).stopChoose, keyboard);
  }

  private async feedbackStart(chatId: number, chat: string, lang: Lang, inline: string) {
    if (!(await this.store.linksForChat(chat)).length)
      return this.tg.send(chatId, t(lang).fbNotLinked);
    if (inline) return this.saveFeedback(chatId, chat, lang, 'other', inline);
    const k = t(lang).fbKinds;
    return this.tg.send(chatId, t(lang).fbChoose, [
      [
        { text: k.bug, callback_data: 'fb:kind:bug' },
        { text: k.idea, callback_data: 'fb:kind:idea' },
      ],
      [
        { text: k.question, callback_data: 'fb:kind:question' },
        { text: k.other, callback_data: 'fb:kind:other' },
      ],
    ]);
  }

  private async saveFeedback(
    chatId: number,
    chat: string,
    lang: Lang,
    kind: FeedbackKind,
    message: string,
  ) {
    const links = await this.store.linksForChat(chat);
    if (!links.length) return this.tg.send(chatId, t(lang).fbNotLinked);
    if (message.length > LIMITS.feedbackMaxLength)
      return this.tg.send(chatId, t(lang).fbTooLong(LIMITS.feedbackMaxLength));
    if (!(await this.store.hit(`fb:${chat}`, 3600_000, LIMITS.feedbackPerChatPerHour, this.now())))
      return this.tg.send(chatId, t(lang).fbRate);
    await this.store.clearChatState(chat);
    const id = await this.store.addFeedback({
      installation_id: links[0]!.installation_id,
      sender: await this.sender(chatId),
      kind,
      lang,
      message,
      created_at: this.now(),
    });
    // Answer Telegram first; Notion follows after the response (and the cron retries failures).
    this.deps.defer(syncFeedback(this.deps, this.store, [id]));
    return this.tg.send(chatId, t(lang).fbThanks);
  }
}

const unique = <T>(xs: T[]) => [...new Set(xs)];
