import { SALOTTO, isWebRoom, roomLabel } from "./rooms.js";
import { isDirectChannel } from "./slack.js";

/** How each transport is named to people. */
export const TRANSPORT_LABELS = { discord: "Discord", telegram: "Telegram", slack: "Slack", web: "pannello" };

/**
 * A Telegram chat: tg:<chat id>. A private chat with an agent's own bot carries the agent too,
 * tg:<chat id>@<agent id>: Telegram gives a person's private chat the same id whichever bot it is with.
 */
export function telegramChannel(chatId, agentId = "") {
  return agentId ? `tg:${chatId}@${agentId}` : `tg:${chatId}`;
}

export function isTelegramChannel(id) {
  return /^tg:-?\d{1,20}(@ag_[a-z0-9]{1,40})?$/.test(String(id || ""));
}

export function telegramChatId(id) {
  return isTelegramChannel(id) ? id.slice(3).split("@")[0] : null;
}

/** The agent whose own bot a Telegram private chat is with, or null. */
export function telegramBotAgent(id) {
  return isTelegramChannel(id) ? id.split("@")[1] || null : null;
}

/** A Slack conversation, and a thread inside it: sl:<channel>[:<thread ts>]. */
export function slackChannel(channelId, threadTs = "") {
  return threadTs ? `sl:${channelId}:${threadTs}` : `sl:${channelId}`;
}

export function isSlackChannel(id) {
  return /^sl:[A-Z0-9]{5,}(:\d{10}\.\d{1,8})?$/i.test(String(id || ""));
}

/** The conversation and thread behind a Slack channel id, or null for anything else. */
export function slackIds(id) {
  if (!isSlackChannel(id)) return null;
  const [channelId, threadTs = ""] = String(id).slice(3).split(":");
  return { channelId, threadTs };
}

/** Which transport a channel id belongs to; the panel's own rooms belong to all of them. */
export function transportOf(id) {
  if (isWebRoom(id)) return "web";
  if (isTelegramChannel(id)) return "telegram";
  if (isSlackChannel(id)) return "slack";
  return "discord";
}

/**
 * Where the cora lives: Discord, Telegram and Slack, each switched on or off
 * (settings.transports), together if wanted, plus the panel's own rooms, which
 * are always there. One of them is the primary (settings.transport): Cora's
 * private word to the owner goes there. Each agent is on the platforms it is
 * not switched off on, in the channels chosen for it there (none: all of them).
 */
export class Channels {
  constructor({ store, discord, bots = null, telegram, tgBots = null, slack = null, skBots = null }) {
    this.store = store;
    this.discord = discord;
    this.bots = bots;
    this.telegram = telegram;
    this.tgBots = tgBots;
    this.slack = slack;
    this.skBots = skBots;
  }

  /** The primary platform: where Cora writes privately to the owner. */
  get active() {
    return this.store.settings.transport;
  }

  /** Every platform switched on. */
  get enabled() {
    const list = this.store.settings.transports;
    return Array.isArray(list) && list.length ? list : [this.active];
  }

  on(kind) {
    return this.enabled.includes(kind);
  }

  /** Whether an agent is on a platform: switched on there, and not switched off for it. */
  agentOn(agent, kind) {
    return this.on(kind) && !(agent?.platformsOff || []).includes(kind);
  }

  apply() {
    if (!this.on("telegram")) {
      this.telegram.stop();
      this.tgBots?.stop();
    }
    if (!this.on("slack")) {
      this.slack?.stop();
      this.skBots?.stop();
    }
    if (!this.on("discord")) {
      this.discord.stop();
      this.bots?.stop();
    }
    if (this.on("telegram")) {
      this.telegram.start();
      this.tgBots?.start();
    }
    if (this.on("slack")) {
      this.slack?.start();
      this.skBots?.start();
    }
    if (this.on("discord")) {
      this.discord.start();
      this.bots?.start();
    }
  }

  /** What an app knows about a Slack conversation: the main one first, then the agents' own. */
  slackInfo(channelId) {
    const own = this.slack?.channelInfo(channelId);
    if (own) return own;
    for (const [, entry] of this.skBots?.clients || []) {
      const info = entry.client.channelInfo(channelId);
      if (info) return info;
    }
    return null;
  }

  /** What a bot knows about a Discord channel or thread: the main one first, then the agents' own, the only ones in a private channel. */
  discordInfo(channelId) {
    const own = this.discord.channelInfo(channelId);
    if (own) return own;
    for (const [, entry] of this.bots?.clients || []) {
      const info = entry.client.channelInfo(channelId);
      if (info) return info;
    }
    return null;
  }

  /** Channels of every platform switched on that the cora listens to. */
  list() {
    const out = [];
    if (this.on("telegram")) {
      out.push(...this.store.settings.telegramChatIds.map((chatId) => {
        const chat = this.telegram.chats.get(chatId);
        return { id: telegramChannel(chatId), name: chat?.title || chatId, guildId: null, guildName: "Telegram", thread: false, kind: "telegram", chatType: chat?.type || "", member: chat?.member ?? false };
      }));
    }
    if (this.on("slack")) {
      const team = this.slack?.team;
      out.push(...this.store.settings.slackChannelIds.map((channelId) => {
        const info = this.slackInfo(channelId);
        return {
          id: slackChannel(channelId),
          name: info?.name || channelId,
          guildId: info?.guildId || team?.id || this.store.settings.slackTeamId || "",
          guildName: info?.guildName || team?.name || "Slack",
          thread: false,
          kind: "slack",
          private: Boolean(info?.private),
          member: Boolean(info),
        };
      }));
    }
    if (this.on("discord")) out.push(...this.discord.listChannels(this.store.settings.guildIds).map((channel) => ({ ...channel, kind: "discord" })));
    return out;
  }

  /**
   * The channels an agent is in: on each platform it is on, those chosen for it there, or all of
   * them when none is chosen; on Discord also those its own bot sees.
   */
  listFor(agent) {
    const channels = this.list();
    if (this.on("discord")) channels.push(...(this.bots?.client(agent.id)?.listChannels(this.store.settings.guildIds) || []).map((channel) => ({ ...channel, kind: "discord" })));
    const chosen = (kind) => agent.channelIds.filter((id) => transportOf(id) === kind);
    const scoped = (channel) => channel.kind !== "discord" || this.store.settings.guildIds.includes(channel.guildId);
    const picked = (channel) => {
      if (!this.agentOn(agent, channel.kind)) return false;
      const ids = chosen(channel.kind);
      return !ids.length || ids.includes(channel.id) || ids.includes(channel.parentId);
    };
    return [...new Map(channels.filter((channel) => scoped(channel) && picked(channel)).map((channel) => [channel.id, channel])).values()];
  }

  /** Whether a channel belongs to a platform switched on (panel rooms always do). */
  isActive(id) {
    const transport = transportOf(id);
    return transport === "web" || this.on(transport);
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
      const direct = chat?.type === "private" || Boolean(telegramBotAgent(id));
      return {
        id, kind: "telegram", telegram: true, chatId, name: title, guildId: null, guildName: title,
        where: direct ? "nella chat privata Telegram" : `nella chat Telegram "${title}"`,
        place: direct ? "su Telegram, in chat privata con il proprietario" : `su Telegram, nel gruppo "${title}"`,
      };
    }
    const slack = slackIds(id);
    if (slack) {
      const info = this.slackInfo(slack.channelId);
      const name = info?.name || slack.channelId;
      const team = info?.guildName || this.slack?.team?.name || "Slack";
      const direct = Boolean(info?.direct) || isDirectChannel(slack.channelId);
      const where = direct ? "in un messaggio diretto su Slack" : slack.threadTs ? `in un thread di #${name} su Slack` : `nel canale #${name} di Slack`;
      return {
        id, kind: "slack", slack: true, channelId: slack.channelId, threadTs: slack.threadTs,
        name, guildId: info?.guildId || "", guildName: team,
        parentId: slack.threadTs ? slackChannel(slack.channelId) : null,
        direct,
        where,
        place: direct ? "su Slack, in un messaggio diretto" : `su Slack, nello spazio "${team}"`,
      };
    }
    const info = this.discordInfo(id);
    if (!info) return { id, kind: "discord", name: id, guildId: null, guildName: "", parentId: null, where: `in #${id}`, place: "su Discord" };
    return { ...info, kind: "discord", where: `in #${info.name}`, place: `su Discord, nel server "${info.guildName}"` };
  }

  label(id) {
    if (isWebRoom(id)) return roomLabel(id, this.store);
    if (isTelegramChannel(id)) return `${this.info(id).name} (Telegram)`;
    if (isSlackChannel(id)) {
      const info = this.info(id);
      if (info.direct) return "messaggio diretto (Slack)";
      return info.threadTs ? `thread in #${info.name} (Slack)` : `#${info.name} (Slack)`;
    }
    const info = this.discordInfo(id);
    return info ? `#${info.name}` : `#${id}`;
  }

  status() {
    return { active: this.active, enabled: this.enabled, discord: this.discord.status(), telegram: this.telegram.status(), slack: this.slack ? this.slack.status() : null };
  }
}
