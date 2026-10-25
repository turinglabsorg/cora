import { SALOTTO, isWebRoom, roomLabel } from "./rooms.js";

export function telegramChannel(chatId) {
  return `tg:${chatId}`;
}

export function isTelegramChannel(id) {
  return /^tg:-?\d{1,20}$/.test(String(id || ""));
}

export function telegramChatId(id) {
  return isTelegramChannel(id) ? id.slice(3) : null;
}

/**
 * Where the cora lives: Discord or Telegram, one at a time (settings.transport),
 * plus the panel's own rooms, which are always there. Switching starts the
 * chosen transport and stops the other, agents' own bots included.
 */
export class Channels {
  constructor({ store, discord, bots = null, telegram, tgBots = null }) {
    this.store = store;
    this.discord = discord;
    this.bots = bots;
    this.telegram = telegram;
    this.tgBots = tgBots;
  }

  get active() {
    return this.store.settings.transport;
  }

  apply() {
    if (this.active === "telegram") {
      this.discord.stop();
      this.bots?.stop();
      this.telegram.start();
      this.tgBots?.start();
    } else {
      this.telegram.stop();
      this.tgBots?.stop();
      this.discord.start();
      this.bots?.start();
    }
  }

  /** Channels of the active transport the cora listens to. */
  list() {
    if (this.active === "telegram") {
      return this.store.settings.telegramChatIds.map((chatId) => {
        const chat = this.telegram.chats.get(chatId);
        return { id: telegramChannel(chatId), name: chat?.title || chatId, guildId: null, guildName: "Telegram", thread: false, kind: "telegram", chatType: chat?.type || "", member: chat?.member ?? false };
      });
    }
    return this.discord.listChannels(this.store.settings.guildIds).map((channel) => ({ ...channel, kind: "discord" }));
  }

  /** Whether a channel belongs to the transport in use (panel rooms always do). */
  isActive(id) {
    if (isWebRoom(id)) return true;
    return isTelegramChannel(id) ? this.active === "telegram" : this.active === "discord";
  }

  /**
   * What the prompts need about a channel: `where` the messages are
   * ("in #general") and the `place` the cora is in right now.
   */
  info(id) {
    if (isWebRoom(id)) {
      return id === SALOTTO
        ? { id, kind: "web", web: true, name: "salotto", where: "nel salotto del pannello", place: "nel pannello web di cora", note: "il proprietario vi scrive dal pannello web di cora, ci siete tutti voi agenti" }
        : { id, kind: "web", web: true, name: "chat privata", where: "nella chat privata del pannello", place: "nel pannello web di cora", note: "ci siete solo tu e il proprietario, che ti scrive dal pannello web di cora: rispondigli sempre" };
    }
    const chatId = telegramChatId(id);
    if (chatId) {
      const chat = this.telegram.chats.get(chatId);
      const title = chat?.title || chatId;
      const direct = chat?.type === "private";
      return {
        id, kind: "telegram", telegram: true, chatId, name: title, guildId: null, guildName: title,
        where: direct ? "nella chat privata Telegram" : `nella chat Telegram "${title}"`,
        place: direct ? "su Telegram, in chat privata con il proprietario" : `su Telegram, nel gruppo "${title}"`,
      };
    }
    const info = this.discord.channelInfo(id);
    if (!info) return { id, kind: "discord", name: id, guildId: null, guildName: "", parentId: null, where: `in #${id}`, place: "su Discord" };
    return { ...info, kind: "discord", where: `in #${info.name}`, place: `su Discord, nel server "${info.guildName}"` };
  }

  label(id) {
    if (isWebRoom(id)) return roomLabel(id, this.store);
    if (isTelegramChannel(id)) return `${this.info(id).name} (Telegram)`;
    const info = this.discord.channelInfo(id);
    return info ? `#${info.name}` : `#${id}`;
  }

  status() {
    return { active: this.active, discord: this.discord.status(), telegram: this.telegram.status() };
  }
}
