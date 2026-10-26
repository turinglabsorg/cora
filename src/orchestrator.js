import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isTelegramChannel, telegramChannel, telegramChatId } from "./channels.js";
import { SALOTTO, isWebRoom, privateRoom, roomAgentId } from "./rooms.js";
import { MEMORY_TOOLS } from "./tools.js";
import { userName } from "./telegram.js";
import { asksToStop } from "./brain.js";

const MAX_PARALLEL_AGENTS = 4;
const HUMAN_DEBOUNCE_MS = 1200;
// A follow-up without names within this window goes to the agents the human was talking to.
const FOCUS_MS = 5 * 60 * 1000;
// After a restart, unanswered human messages this recent are picked up again.
const CATCH_UP_MS = 15 * 60 * 1000;
// Someone called an agent and it has said nothing yet: it acknowledges on its own after this long.
const ACK_AFTER_MS = 15000;
/** The acknowledgement answers silence: an agent that has just spoken here does not repeat it. */
const ACK_QUIET_MS = 5 * 60 * 1000;
/** How long a round holds its channel before the agents still working carry on in the background. */
const RELEASE_AFTER_MS = 20000;
const ACK_TEXT = { it: "Ricevuto, ci lavoro: ti aggiorno qui.", en: "Got it, working on it: I'll keep you posted here." };
const IMAGE_LIMIT_BYTES = 5 * 1024 * 1024;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalize(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function mentions(text, name) {
  const escaped = normalize(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])@?${escaped}([^\\p{L}\\p{N}]|$)`, "u").test(normalize(text));
}

function describeMessage(raw, nameFor = () => null) {
  const parts = [];
  if (raw.content) {
    const mentioned = new Map((raw.mentions || []).map((user) => [user.id, user.global_name || user.username]));
    parts.push(raw.content.replace(/<@!?(\d+)>/g, (match, id) => {
      const name = nameFor(id) || mentioned.get(id);
      return name ? `@${name}` : match;
    }));
  }
  for (const attachment of raw.attachments || []) {
    parts.push(`[allegato: ${attachment.filename} ${attachment.url}]`);
  }
  for (const embed of raw.embeds || []) {
    const text = [embed.title, embed.description].filter(Boolean).join(" — ");
    if (text) parts.push(`[embed: ${text.slice(0, 400)}]`);
  }
  for (const sticker of raw.sticker_items || []) parts.push(`[sticker: ${sticker.name}]`);
  if (raw.referenced_message?.content) {
    const ref = raw.referenced_message;
    parts.unshift(`(in risposta a ${ref.author?.global_name || ref.author?.username}: "${ref.content.slice(0, 160)}")`);
  }
  return parts.join(" ").slice(0, 3000) || "(messaggio vuoto)";
}

export class Orchestrator {
  constructor({ store, discord, brain, log, bots = null, channels, telegram = null, tgBots = null, emit = () => {}, filesDir = null, notifier = null, watching = () => false }) {
    this.notifier = notifier;
    this.watching = watching;
    this.requestsByAgent = new Map();
    this.bots = bots;
    this.channels = channels;
    this.telegram = telegram;
    this.tgBots = tgBots;
    this.emit = emit;
    this.filesDir = filesDir;
    this.store = store;
    this.discord = discord;
    this.brain = brain;
    this.log = log;
    this.states = new Map();
    // Discord DM channels, each owned by the one agent whose bot received the message.
    this.dmAgent = new Map();
    this.routineRuns = new Set();
    this.ackAfterMs = ACK_AFTER_MS;
    // An agent has one computer, so it runs one task at a time: what it is on, by agent id.
    this.atWork = new Map();
    this.threadWork = new Map();
    this.ackQuietMs = ACK_QUIET_MS;
    // A task can take hours: after this long the channel is free again for the others while the agent keeps working.
    this.releaseAfterMs = RELEASE_AFTER_MS;
    this.ackText = null;
  }

  state(channelId) {
    let state = this.states.get(channelId);
    if (!state) {
      state = { id: channelId, history: [], seen: new Set(), heardFrom: new Set(), mainBlind: false, generation: 0, budget: 0, ownerOrigin: false, running: false, pending: false, timer: null, loading: null };
      this.states.set(channelId, state);
    }
    return state;
  }

  allowedGuild(guildId) {
    return this.store.settings.guildIds.includes(guildId);
  }

  channelMeta(channelId) {
    if (this.dmAgentId(channelId)) {
      return { id: channelId, kind: "discord", name: "DM", guildId: null, guildName: "", parentId: null, where: "in privato con te", place: "in un messaggio privato", note: "messaggio privato" };
    }
    return this.channels.info(channelId);
  }

  dmAgentId(channelId) {
    return this.dmAgent.get(channelId) || null;
  }

  agentsFor(channelId) {
    if (isWebRoom(channelId)) {
      const only = roomAgentId(channelId);
      return this.store.agents().filter((agent) => agent.enabled && (!only || agent.id === only));
    }
    const dm = this.dmAgentId(channelId);
    if (dm) {
      const agent = this.store.agent(dm);
      return agent?.enabled ? [agent] : [];
    }
    const telegram = isTelegramChannel(channelId);
    const info = telegram ? null : this.discord.channelInfo(channelId);
    return this.store.agents().filter((agent) => {
      if (!agent.enabled) return false;
      const chosen = agent.channelIds.filter((id) => isTelegramChannel(id) === telegram);
      return !chosen.length || chosen.includes(channelId) || Boolean(info?.parentId && chosen.includes(info.parentId));
    });
  }

  isOwner(userId) {
    const owners = this.store.settings.ownerIds;
    return !owners.length || owners.includes(userId);
  }

  nameForUser(userId) {
    const agentId = this.bots?.agentIdForUser(userId);
    if (agentId) return this.store.agent(agentId)?.name || null;
    if (userId && userId === this.discord.user?.id) return this.discord.user.username;
    return null;
  }

  classify(raw) {
    const agents = this.store.agents();
    const username = raw.author?.username || "";
    const ownBot = raw.author?.id && this.bots?.agentIdForUser(raw.author.id);
    if (ownBot) return { kind: "agent", agentId: ownBot, authorName: this.store.agent(ownBot)?.name || username };
    if (raw.webhook_id) {
      const agent = agents.find((item) => item.name === username);
      if (agent && (this.discord.isAgentWebhook(raw) || !this.discord.ownWebhookIds.size)) {
        return { kind: "agent", agentId: agent.id, authorName: agent.name };
      }
      return { kind: "bot", authorName: username || "webhook" };
    }
    if (raw.author?.id && raw.author.id === this.discord.user?.id) {
      const match = /^\*\*(.+?)\*\* · /.exec(raw.content || "");
      const agent = match && agents.find((item) => item.name === match[1]);
      if (agent) return { kind: "agent", agentId: agent.id, authorName: agent.name, strip: match[0].length };
      return { kind: "bot", authorName: raw.author.global_name || username };
    }
    if (raw.author?.bot) return { kind: "bot", authorName: raw.author.global_name || username };
    const authorName = raw.member?.nick || raw.author?.global_name || username || "qualcuno";
    return { kind: this.isOwner(raw.author?.id) ? "owner" : "human", authorName };
  }

  toItem(raw) {
    const who = this.classify(raw);
    let content = describeMessage(raw, (id) => this.nameForUser(id));
    if (who.strip) content = content.slice(who.strip);
    // People or bots named with a real Discord mention who are not agents (e.g. "@GROG ci sei?").
    const others = (raw.mentions || []).filter((user) => !this.bots?.agentIdForUser(user.id)).map((user) => user.global_name || user.username);
    return {
      id: raw.id,
      at: Date.parse(raw.timestamp || "") || Date.now(),
      authorId: raw.author?.id,
      authorName: who.authorName,
      kind: who.kind,
      agentId: who.agentId || null,
      content,
      others,
    };
  }

  push(state, item) {
    if (state.seen.has(item.id)) return false;
    state.seen.add(item.id);
    state.history.push(item);
    const keep = this.store.settings.historySize;
    if (state.history.length > keep * 2) {
      const removed = state.history.splice(0, state.history.length - keep);
      for (const old of removed) state.seen.delete(old.id);
    }
    return true;
  }

  /** Load the channel's recent messages once; `exclude` keeps out the message being handled, which Discord may already list. */
  async ensureHistory(state, { exclude = null } = {}) {
    if (state.loaded) return;
    if (isWebRoom(state.id) || isTelegramChannel(state.id) || this.dmAgentId(state.id)) {
      const existing = state.history;
      state.history = [];
      state.seen = new Set();
      for (const item of [...this.store.recentMessages(state.id, this.store.settings.historySize), ...existing]) this.push(state, item);
      state.loaded = true;
      return;
    }
    if (!state.loading) {
      state.loading = this.discord.fetchMessages(state.id, this.store.settings.historySize)
        .catch(async (error) => {
          // A private channel the main bot cannot read: another agent's bot may be in it, and
          // only the agents whose bots are in it can speak there. A passing network error is not that.
          if (/\b40[13]\b/.test(error.message)) state.mainBlind = true;
          const viaBot = await this.bots?.fetchMessages(state.id, this.store.settings.historySize);
          if (viaBot) return viaBot;
          throw error;
        })
        .then((messages) => {
          const items = messages.filter((raw) => raw.id !== exclude).map((raw) => this.toItem(raw));
          const existing = state.history;
          state.history = [];
          state.seen = new Set();
          for (const item of [...items, ...existing]) this.push(state, item);
          state.history.sort((a, b) => a.at - b.at);
        })
        .catch((error) => this.log({ type: "error", channelId: state.id, text: `history: ${error.message}` }))
        .finally(() => { state.loaded = true; });
    }
    await state.loading;
  }

  async attachImages(item, raw) {
    const images = [];
    for (const attachment of raw.attachments || []) {
      if (!String(attachment.content_type || "").startsWith("image/") || attachment.size > IMAGE_LIMIT_BYTES) continue;
      try {
        const response = await fetch(attachment.url, { signal: AbortSignal.timeout(15000) });
        if (response.ok) images.push(Buffer.from(await response.arrayBuffer()).toString("base64"));
      } catch {}
      if (images.length >= 2) break;
    }
    if (images.length) item.images = images;
  }

  async onMessage(raw, viaAgentId = null) {
    const guildId = raw.guild_id || this.discord.channelInfo(raw.channel_id)?.guildId;
    if (!guildId || !this.allowedGuild(guildId)) return;
    // Only real messages and replies: joins, pins, boosts and the like have no text for the agents.
    if (raw.type !== undefined && raw.type !== 0 && raw.type !== 19) return;
    if (!raw.content && !raw.attachments?.length && !raw.embeds?.length && !raw.sticker_items?.length) return;
    if (this.discord.isOwnMessage(raw) || this.bots?.isOwnMessage(raw)) return;
    // What an agent's own bot posts is already in the history (Cora posted it); the gateway echo can arrive first.
    if (raw.author?.id && this.bots?.agentIdForUser(raw.author.id)) return;
    const state = this.state(raw.channel_id);
    // Who delivered it is who is in the channel: in a private one, only they can answer.
    if (viaAgentId) state.heardFrom.add(viaAgentId);
    // Several bots may hear the same channel: the first delivery wins, the rest are the same message.
    if (state.seen.has(raw.id) || this.store.hasMessage(raw.id)) return;
    await this.ensureHistory(state, { exclude: raw.id });
    const item = this.toItem(raw);
    if (item.kind === "owner" || item.kind === "human") await this.attachImages(item, raw);
    this.ingest(state, item);
  }

  /**
   * A direct message to an agent's own bot: that one agent answers, in the DM,
   * as a private conversation. DMs need no server, so they are heard even where
   * the agent listens to no channel.
   */
  async onDirectMessage(agentId, raw) {
    const agent = this.store.agent(agentId);
    if (!agent?.enabled) return;
    if (raw.type !== undefined && raw.type !== 0 && raw.type !== 19) return;
    if (!raw.content && !raw.attachments?.length && !raw.embeds?.length && !raw.sticker_items?.length) return;
    // Ignore bots and anything our own agents posted (the DM echoes the agent's own reply back).
    if (raw.author?.bot || this.bots?.agentIdForUser(raw.author?.id) || this.discord.isOwnMessage(raw)) return;
    this.dmAgent.set(raw.channel_id, agentId);
    const state = this.state(raw.channel_id);
    await this.ensureHistory(state);
    const item = this.toItem(raw);
    if (item.kind !== "owner" && item.kind !== "human") return;
    await this.attachImages(item, raw);
    this.ingest(state, item);
  }

  /**
   * Run when the Discord connection comes up: messages written while Cora was
   * down are archived, and a recent human message nobody answered gets answered.
   */
  async catchUp() {
    if (this.channels.active !== "discord") return;
    for (const channel of this.channels.list()) {
      const state = this.state(channel.id);
      if (state.running || state.nextRoundAt) continue;
      state.loaded = false;
      state.loading = null;
      await this.ensureHistory(state);
      const missed = state.history.filter((item) => !this.store.hasMessage(item.id));
      for (const item of missed) this.store.appendArchive(state.id, item);
      const last = state.history[state.history.length - 1];
      if (!last || !missed.includes(last) || Date.now() - last.at > CATCH_UP_MS) continue;
      const human = ["owner", "human"].includes(last.kind);
      const botCall = last.kind === "bot" && this.agentsFor(state.id).some((agent) => mentions(last.content, agent.name));
      if (!human && !botCall) continue;
      this.log({ type: "message", channelId: state.id, author: last.authorName, kind: last.kind, text: `(arrivato mentre ero spenta) ${last.content.slice(0, 280)}` });
      if (human) {
        this.address(state, last);
        state.budget = this.store.settings.maxAgentTurns;
      }
      state.generation += 1;
      state.ownerOrigin = last.kind === "owner";
      this.schedule(state, HUMAN_DEBOUNCE_MS);
    }
  }

  /**
   * Who a human message is for: the agents it names, or else the ones the
   * human was just talking to. Addressed messages keep the others quiet.
   */
  address(state, item) {
    const named = this.agentsFor(state.id).filter((agent) => mentions(item.content, agent.name)).map((agent) => agent.id);
    const now = Date.now();
    // An open question to the owner: their next message is the answer, even without the agent's name.
    const asked = item.kind === "owner" && state.request && !item.others?.length ? state.request : null;
    if (item.kind === "owner" && !item.others?.length) state.request = null;
    if (named.length) state.focus = { ids: named, at: now };
    else if (item.others?.length) state.focus = null;
    else if (asked && this.store.agent(asked.agentId)?.enabled) state.focus = { ids: [asked.agentId], at: now };
    else if (state.focus && now - state.focus.at < FOCUS_MS) state.focus.at = now;
    else state.focus = null;
    item.addressed = state.focus ? [...state.focus.ids] : [];
    item.toOthers = !named.length && Boolean(item.others?.length);
  }

  /** A message someone else wrote: archive it and wake the agents. */
  ingest(state, item) {
    if (!this.push(state, item)) return;
    this.store.appendArchive(state.id, item);
    this.log({ type: "message", channelId: state.id, author: item.authorName, kind: item.kind, text: item.content.slice(0, 300) });
    if (item.kind === "owner" || item.kind === "human") {
      this.address(state, item);
      state.generation += 1;
      state.budget = this.store.settings.maxAgentTurns;
      state.ownerOrigin = item.kind === "owner";
      this.schedule(state, HUMAN_DEBOUNCE_MS);
    } else if (item.kind === "bot") {
      // Another bot can call an agent by name; it never gets the owner's tools.
      const called = this.agentsFor(state.id).some((agent) => mentions(item.content, agent.name));
      if (called) state.ownerOrigin = false;
      if (called || state.budget > 0) this.schedule(state, called ? HUMAN_DEBOUNCE_MS : 2500);
    }
  }

  /* ---------- Telegram ---------- */
  isTelegramOwner(userId) {
    const owners = this.store.settings.telegramOwnerIds;
    return !owners.length || owners.includes(String(userId));
  }

  /** Until an owner is set, the person in a private chat or the group's creator becomes it. */
  async claimTelegramOwner(chat, from) {
    if (this.store.settings.telegramOwnerIds.length || !from?.id) return;
    let ownerId = null;
    if (chat.type === "private") ownerId = String(from.id);
    else {
      try {
        const admins = await this.telegram.request("getChatAdministrators", { chat_id: chat.id });
        const creator = admins.find((member) => member.status === "creator");
        if (creator) ownerId = String(creator.user.id);
      } catch {}
    }
    if (!ownerId || this.store.settings.telegramOwnerIds.length) return;
    this.store.updateSettings({ telegramOwnerIds: [ownerId] });
    this.log({ type: "settings", text: `proprietario Telegram impostato (${chat.type === "private" ? "chat privata" : "creatore del gruppo"})` });
  }

  telegramText(message) {
    const parts = [];
    let text = message.text || message.caption || "";
    const entities = message.entities || message.caption_entities || [];
    for (const entity of [...entities].sort((a, b) => b.offset - a.offset)) {
      if (entity.type !== "mention") continue;
      const handle = text.slice(entity.offset, entity.offset + entity.length);
      const agentId = this.tgBots?.agentIdForUsername(handle);
      const agent = agentId && this.store.agent(agentId);
      if (agent) text = `${text.slice(0, entity.offset)}@${agent.name}${text.slice(entity.offset + entity.length)}`;
    }
    if (text) parts.push(text);
    if (message.photo) parts.push("[foto]");
    if (message.document) parts.push(`[allegato: ${message.document.file_name || "file"}]`);
    if (message.voice || message.audio) parts.push("[messaggio vocale]");
    if (message.video || message.video_note) parts.push("[video]");
    if (message.sticker) parts.push(`[sticker ${message.sticker.emoji || ""}]`.replace(" ]", "]"));
    if (message.location) parts.push(`[posizione: ${message.location.latitude}, ${message.location.longitude}]`);
    const ref = message.reply_to_message;
    if (ref && (ref.text || ref.caption)) {
      let who = userName(ref.from);
      let quoted = String(ref.text || ref.caption);
      const ownBot = this.tgBots?.agentIdForUser(ref.from?.id);
      if (ownBot) who = this.store.agent(ownBot)?.name || who;
      else if (ref.from?.id && String(ref.from.id) === String(this.telegram.user?.id)) {
        const [first, ...rest] = quoted.split("\n");
        if (this.store.agents().some((agent) => agent.name === first)) {
          who = first;
          quoted = rest.join("\n");
        }
      }
      parts.unshift(`(in risposta a ${who}: "${quoted.slice(0, 160)}")`);
    }
    return parts.join(" ").slice(0, 3000) || "(messaggio vuoto)";
  }

  async onTelegramMessage(message) {
    if (this.channels.active !== "telegram" || !message?.chat) return;
    const chatId = String(message.chat.id);
    if (!this.store.settings.telegramChatIds.includes(chatId)) return;
    const from = message.from || {};
    if (from.is_bot && (String(from.id) === String(this.telegram.user?.id) || this.tgBots?.agentIdForUser(from.id))) return;
    await this.claimTelegramOwner(message.chat, from);
    const state = this.state(telegramChannel(chatId));
    await this.ensureHistory(state);
    const kind = from.is_bot ? "bot" : this.isTelegramOwner(from.id) ? "owner" : "human";
    const item = {
      id: `tg_${chatId}_${message.message_id}`,
      at: (message.date || Date.now() / 1000) * 1000,
      authorId: String(from.id || ""),
      authorName: userName(from),
      kind,
      agentId: null,
      content: this.telegramText(message),
    };
    if ((kind === "owner" || kind === "human") && message.photo?.length) {
      const photo = [...message.photo].sort((a, b) => (b.file_size || 0) - (a.file_size || 0)).find((size) => !size.file_size || size.file_size <= IMAGE_LIMIT_BYTES);
      const data = photo && await this.telegram.download(photo.file_id, IMAGE_LIMIT_BYTES).catch(() => null);
      if (data) item.images = [data.toString("base64")];
    }
    this.ingest(state, item);
  }

  schedule(state, delay) {
    clearTimeout(state.timer);
    state.nextRoundAt = Date.now() + delay;
    state.timer = setTimeout(() => {
      state.nextRoundAt = 0;
      this.runRound(state);
    }, delay);
  }

  /** True when no channel has a round running or scheduled, and no agent is still working. */
  quiet() {
    return !this.atWork.size && !this.threadWork.size && [...this.states.values()].every((state) => !state.running && !state.nextRoundAt && !state.pending && !state.working?.size);
  }

  async runRound(state) {
    if (state.running) {
      state.pending = true;
      return;
    }
    state.running = true;
    try {
      // Agents on a long task keep working after this; the channel answers the others meanwhile.
      const round = this.round(state).catch((error) => this.log({ type: "error", channelId: state.id, text: `round: ${error.message}` }));
      await Promise.race([round, sleep(this.releaseAfterMs)]);
    } finally {
      state.running = false;
      if (state.pending) {
        state.pending = false;
        this.schedule(state, 300);
      }
    }
  }

  pickCandidates(state, last, agents, { summonedOnly = false } = {}) {
    const fromHuman = last.kind === "owner" || last.kind === "human";
    const pool = agents.filter((agent) => agent.id !== last.agentId);
    // In a thread agents stay out unless someone summons them by name (or they are mid-conversation with that name).
    if (summonedOnly) {
      const forced = pool.filter((agent) => mentions(last.content, agent.name) || (fromHuman && last.addressed?.includes(agent.id)));
      return { forced, optional: [] };
    }
    if (last.kind === "bot") {
      const called = pool.filter((agent) => mentions(last.content, agent.name));
      if (called.length) return { forced: called, optional: [] };
    }
    if (!fromHuman && state.budget <= 0) return { forced: [], optional: [] };
    if (fromHuman && (roomAgentId(state.id) || this.dmAgentId(state.id))) return { forced: pool, optional: [] };
    const forced = pool.filter((agent) => mentions(last.content, agent.name) || (fromHuman && last.addressed?.includes(agent.id)));
    if (fromHuman && forced.length) return { forced, optional: [] };
    if (fromHuman && last.toOthers) return { forced: [], optional: [] };
    // While the human is talking to someone, the others join only when called by name.
    if (!fromHuman && state.focus && Date.now() - state.focus.at < FOCUS_MS) return { forced, optional: [] };
    // Nobody was named: one message from a human gets exactly one answer, never a chorus.
    // Chattiness decides who feels like speaking; the chattiest answers when nobody does.
    if (fromHuman) {
      const willing = pool.filter((agent) => Math.random() < agent.chattiness);
      const one = willing.length
        ? willing[Math.floor(Math.random() * willing.length)]
        : [...pool].sort((a, b) => (b.chattiness - a.chattiness) || (Math.random() - 0.5))[0];
      return { forced: one ? [one] : [], optional: [] };
    }
    const optional = pool.filter((agent) => !forced.includes(agent) && Math.random() < agent.chattiness * 0.6)
      .sort(() => Math.random() - 0.5).slice(0, Math.max(0, MAX_PARALLEL_AGENTS - forced.length));
    return { forced, optional };
  }

  async round(state) {
    const last = state.history[state.history.length - 1];
    if (!last) return;
    state.working ??= new Set();
    // An agent still on a task gets new messages through its inbox, never a second turn.
    let agents = this.agentsFor(state.id).filter((agent) => !state.working.has(agent.id));
    // A channel the main bot cannot see is private: only the agents whose own bot is in it can read or post there.
    if (state.mainBlind && state.heardFrom.size) agents = agents.filter((agent) => state.heardFrom.has(agent.id));
    if (!agents.length) return;
    const summonedOnly = Boolean(this.channelMeta(state.id).parentId);
    const { forced, optional } = this.pickCandidates(state, last, agents, { summonedOnly });
    if (!forced.length && !optional.length) return;

    const generation = state.generation;
    const channel = this.channelMeta(state.id);
    const snapshot = state.history.slice(-this.store.settings.historySize);
    const limitOptional = Math.max(0, this.store.settings.maxRepliesPerRound - forced.length);
    let postedOptional = 0;
    let posted = 0;
    let queue = Promise.resolve();

    const typeNow = () => this.typing(state.id, [...forced, ...optional]);
    const typing = setInterval(typeNow, 8000);
    typeNow();
    const turn = async (agent, isForced) => {
      state.working.add(agent.id);
      try {
        return await work(agent, isForced);
      } finally {
        state.working.delete(agent.id);
      }
    };
    const work = async (agent, isForced) => {
      // Already on a task elsewhere: it still answers, but it does not take its computer
      // for a second job at the same time.
      const busyWith = this.atWork.get(agent.id);
      const computer = agent.tools && state.ownerOrigin && !busyWith && !this.threadWork.has(state.id);
      const started = Date.now();
      if (computer) this.atWork.set(agent.id, `una richiesta ${this.channelMeta(state.id).where || "in chat"}`);
      if (computer) this.threadWork.set(state.id, agent.id);
      let spoke = false;
      const say = (text) => {
        spoke = true;
        return this.postAs(agent, state, text);
      };
      // "Ricevuto, ci lavoro" tells the owner an agent is there when nothing else does. In a live
      // conversation it says nothing they cannot already see, so it is sent only after a silence.
      const quiet = started - this.spokeHereAt(state, agent.id) > this.ackQuietMs;
      const ack = isForced && quiet ? setTimeout(() => {
        if (spoke || (state.request?.agentId === agent.id && state.request.at >= started)) return;
        say(this.ackText || ACK_TEXT[this.store.settings.language] || ACK_TEXT.it).catch(() => {});
        this.log({ type: "say", agentId: agent.id, channelId: state.id, text: "(conferma automatica: sta ancora lavorando)" });
      }, this.ackAfterMs) : null;
      let result;
      try {
        result = await this.brain.chatTurn({
          agent, history: snapshot, channel, forced: isForced, computer,
          postFile: (file, caption) => this.postAs(agent, state, caption, file),
          say,
          // Everything already in the channel when the turn starts is old news, not just what the prompt shows.
          inbox: this.inbox(state, state.history.slice()),
        });
      } catch (error) {
        this.log({ type: "error", agentId: agent.id, channelId: state.id, text: error.message });
        if (isForced) result = { text: `(non riesco a rispondere: ${error.message.slice(0, 180)})` };
        else return;
      } finally {
        clearTimeout(ack);
        if (computer) this.atWork.delete(agent.id);
        if (computer) this.threadWork.delete(state.id);
      }
      if (!result.text) {
        this.log({ type: "pass", agentId: agent.id, channelId: state.id, ms: Date.now() - started, traceId: result.traceId });
        return;
      }
      queue = queue.then(async () => {
        if (!isForced && (state.generation !== generation || postedOptional >= limitOptional)) return;
        if (!isForced && last.kind !== "owner" && last.kind !== "human" && state.budget <= 0) return;
        if (!isForced) postedOptional += 1;
        if (posted > 0) await sleep(700 + Math.random() * 1500);
        try {
          await this.postAs(agent, state, result.text, undefined, result.traceId);
          posted += 1;
        } catch (error) {
          this.log({ type: "error", agentId: agent.id, channelId: state.id, text: `post: ${error.message}` });
        }
      });
      await queue;
    };
    try {
      await Promise.all([...forced.map((agent) => turn(agent, true)), ...optional.map((agent) => turn(agent, false))]);
      await queue;
    } finally {
      clearInterval(typing);
    }
    if (posted && state.budget > 0 && state.generation === generation) this.schedule(state, 2500 + Math.random() * 4000);
  }

  /** A notice from usecora.space, posted as "Cora" in the channel named in settings.noticeChannel. */
  async cloudNotice(fields) {
    const english = this.store.settings.language === "en";
    const who = [fields.email, fields.company ? `(${fields.company})` : ""].filter(Boolean).join(" ");
    const text = fields.type === "waitlist"
      ? (english ? `📬 New sign-up on the usecora.space waitlist: **${who}**` : `📬 Nuova iscrizione alla lista d'attesa di usecora.space: **${who}**`)
      : String(fields.text || "").slice(0, 1500);
    if (!text) return;
    const name = String(this.store.settings.noticeChannel || "").replace(/^#/, "").toLowerCase();
    const channel = name ? this.channels?.list().find((item) => item.kind === "discord" && String(item.name).toLowerCase() === name) : null;
    this.log({ type: "settings", channelId: channel?.id, text: text.replace(/\*\*/g, "") });
    if (!channel) return;
    await this.discord.post(channel.id, { username: "Cora", content: text });
  }

  /**
   * After a restart: the long tasks that the restart cut short are picked up
   * again, in the same place, by the same agents, if they started in the last
   * hours and used the agent's computer.
   */
  resumeInterrupted({ withinMs = 8 * 3600 * 1000 } = {}) {
    const pendingRuns = this.store.pendingRoutineRuns();
    const ids = [...new Set([...(this.store.interruptedAtStart || []), ...pendingRuns.map((run) => run.traceId).filter(Boolean)])];
    this.store.interruptedAtStart = [];
    const resumed = [];
    for (const id of ids) {
      const trace = this.store.trace(id);
      if (!trace || !["chat", "routine", "reminder"].includes(trace.kind) || !trace.channelId) continue;
      const pendingRun = pendingRuns.find((run) => run.traceId === trace.id);
      if (!pendingRun && Date.now() - Date.parse(trace.startedAt) > withinMs) continue;
      if (!pendingRun && !trace.tools.some((name) => !MEMORY_TOOLS.has(name))) continue;
      const agent = this.store.agent(trace.agentId);
      if (!agent?.enabled || (!pendingRun && !agent.tools)) continue;
      if (!isWebRoom(trace.channelId) && !this.channels?.isActive(trace.channelId)) continue;
      const latest = this.store.recentMessages(trace.channelId, this.store.settings.historySize).findLast((item) =>
        item.at > Date.parse(trace.startedAt) && item.kind === "owner" &&
        (mentions(item.content, agent.name) || !this.store.agents().some((other) => mentions(item.content, other.name))));
      if (latest && asksToStop(latest.content)) continue;
      const routine = ["routine", "reminder"].includes(trace.kind) ? this.routineForTrace(trace) : null;
      if (["routine", "reminder"].includes(trace.kind) && (!routine?.enabled || (pendingRun && pendingRun.routineUpdatedAt !== routine.updatedAt))) continue;
      resumed.push(trace.id);
      this.resumeTask(agent, trace, routine).catch((error) => this.log({ type: "error", agentId: agent.id, channelId: trace.channelId, text: `ripresa: ${error.message}` }));
    }
    return resumed;
  }

  routineForTrace(trace) {
    const id = /\[Attività programmata: (rt_[a-f0-9]+)\]/.exec(trace.prompt || "")?.[1];
    if (id) return this.store.routine(id);
    const run = this.store.pendingRoutineRuns().find((item) => item.traceId === trace.id);
    if (run) return this.store.routine(run.routineId);
    const name = /È il momento della tua routine "([^"]+)"/.exec(trace.prompt || "")?.[1];
    return this.store.routines(trace.agentId).find((routine) => routine.channelId === trace.channelId && routine.name === name) || null;
  }

  async resumeTask(agent, trace, routine = null) {
    if (routine) {
      const run = this.store.pendingRoutineRuns().find((item) => item.routineId === routine.id);
      return this.runRoutine(routine, { resumeTrace: trace, resumeRunId: run?.id || "" });
    }
    if (this.atWork.has(agent.id) || this.threadWork.has(trace.channelId)) return;
    this.atWork.set(agent.id, "il compito interrotto");
    this.threadWork.set(trace.channelId, agent.id);
    const state = this.state(trace.channelId);
    state.working ??= new Set();
    state.working.add(agent.id);
    this.log({ type: "settings", agentId: agent.id, channelId: state.id, text: "riprende il lavoro interrotto dal riavvio" });
    try {
      await this.ensureHistory(state);
      const english = this.store.settings.language === "en";
      await this.postAs(agent, state, english ? "Cora restarted while I was working: picking up where I left off." : "Cora si è riavviata mentre lavoravo: riprendo da dove ero.");
      const result = await this.brain.resumeTurn({
        agent, trace, channel: this.channelMeta(state.id),
        postFile: (file, caption) => this.postAs(agent, state, caption, file),
        say: (text) => this.postAs(agent, state, text),
        inbox: this.inbox(state, state.history), routine,
      });
      if (result.text) await this.postAs(agent, state, result.text, undefined, result.traceId);
    } finally {
      state.working.delete(agent.id);
      this.atWork.delete(agent.id);
      this.threadWork.delete(state.id);
    }
  }

  /** Messages people wrote in the channel after a turn started, each handed out once: how a busy agent gets steered. */
  inbox(state, seenItems) {
    const seen = new Set(seenItems.map((item) => item.id));
    return () => {
      const fresh = state.history.filter((item) => !seen.has(item.id) && (item.kind === "owner" || item.kind === "human"));
      for (const item of fresh) seen.add(item.id);
      return fresh;
    };
  }

  /** Agents with their own bot type as themselves; the others share the main bot's indicator. */
  typing(channelId, agents) {
    if (isWebRoom(channelId)) {
      this.emit({ type: "web-typing", room: channelId, agentIds: agents.map((agent) => agent.id) });
      return;
    }
    const chatId = telegramChatId(channelId);
    if (chatId) {
      let shared = false;
      for (const agent of agents) {
        const own = this.tgBots?.client(agent.id);
        if (own) own.typing(chatId);
        else shared = true;
      }
      if (shared) this.telegram.typing(chatId);
      return;
    }
    let shared = false;
    for (const agent of agents) {
      const own = this.bots?.client(agent.id);
      if (own) own.typing(channelId);
      else shared = true;
    }
    if (shared) this.discord.typing(channelId);
  }

  /** When this agent last said something in this channel, 0 when it has not. */
  spokeHereAt(state, agentId) {
    for (let index = state.history.length - 1; index >= 0; index -= 1) {
      const item = state.history[index];
      if (item.kind === "agent" && item.agentId === agentId) return item.at || 0;
    }
    return 0;
  }

  async postAs(agent, state, text, file, traceId, { ping = "", request } = {}) {
    if (isWebRoom(state.id)) return this.postWeb(agent, state, text, file, traceId, { request });
    const chatId = telegramChatId(state.id);
    // The ping (a Discord mention) goes out with the message but stays out of the archive and the agents' transcripts.
    const content = ping && text ? `${ping} ${text}` : text || "";
    let sent;
    if (chatId) sent = await this.postTelegram(agent, chatId, content, file);
    else {
      const own = this.bots?.client(agent.id);
      sent = own
        ? await own.say(state.id, { content, file })
        : await this.discord.post(state.id, { username: agent.name, avatarUrl: agent.avatarUrl, content, file });
    }
    const last = sent[sent.length - 1];
    if (text) {
      const item = {
        id: chatId && last?.message_id ? `tg_${chatId}_${last.message_id}` : last?.id || `local_${Date.now()}`,
        at: Date.now(),
        authorId: null,
        authorName: agent.name,
        kind: "agent",
        agentId: agent.id,
        content: file ? `${text} [file: ${file.name}]` : text,
        traceId,
        request,
      };
      this.push(state, item);
      this.store.appendArchive(state.id, item);
      state.budget -= 1;
    }
    this.log({ type: "say", agentId: agent.id, channelId: state.id, text: (text || `[file ${file?.name}]`).slice(0, 500), file: file?.name, traceId });
    return sent;
  }

  /** As the agent's own Telegram bot when it is in the chat, otherwise through the main bot with its name on top. */
  async postTelegram(agent, chatId, text, file) {
    const own = this.tgBots?.client(agent.id);
    if (own && await this.tgBots.inChat(agent.id, chatId)) {
      try {
        return await own.say(chatId, { content: text || "", file });
      } catch (error) {
        this.tgBots.forgetMembership(agent.id);
        this.log({ type: "warning", agentId: agent.id, channelId: telegramChannel(chatId), text: `bot Telegram suo: ${error.message}; scrivo col bot principale` });
      }
    }
    return this.telegram.say(chatId, { content: text || "", file, name: agent.name });
  }

  /** A message in a panel room: archived like a Discord one and pushed live to the panel. */
  postWeb(agent, state, text, file, traceId, { request } = {}) {
    const item = {
      id: `web_${randomBytes(8).toString("hex")}`,
      at: Date.now(),
      authorId: null,
      authorName: agent.name,
      kind: "agent",
      agentId: agent.id,
      content: file ? `${text || ""} [file: ${file.name}]`.trim() : text,
      traceId,
      file: file ? this.saveWebFile(file) : undefined,
      request,
    };
    this.push(state, item);
    this.store.appendArchive(state.id, item);
    if (text) state.budget -= 1;
    this.emit({ type: "web-message", room: state.id, item });
    this.log({ type: "say", agentId: agent.id, channelId: state.id, text: (text || `[file ${file?.name}]`).slice(0, 500), file: file?.name, traceId });
    // Nobody has the panel open: the reply reaches the owner's phone.
    if (this.notifier?.enabled && !this.watching() && !item.request) {
      const url = state.id === "web" ? "/#/" : `/#/agent/${agent.id}/chat`;
      this.notifier.notify({ title: agent.name, body: text || `📎 ${file?.name}`, url, tag: state.id }).catch(() => {});
    }
    return [item];
  }

  /**
   * An agent asking the owner something. The question lands where the
   * conversation is: in a Discord or Telegram channel it mentions the owner and
   * lists the answers as text (the app on their phone does the notifying); in a
   * panel room it shows quick answers and goes out as a push. Without a
   * conversation it goes to the agent's private room. The owner's next message
   * there, typed or tapped, is the answer and goes to this agent.
   */
  async askOwner(agent, { question, choices = [] }, { channelId } = {}) {
    const text = String(question || "").trim().slice(0, 1500);
    if (!text) throw new Error("empty question");
    const now = Date.now();
    const recent = (this.requestsByAgent.get(agent.id) || []).filter((at) => now - at < 24 * 3600 * 1000);
    if (recent.length && now - recent[recent.length - 1] < 60000) throw new Error("you asked the owner something less than a minute ago: wait for the answer");
    if (recent.length >= 30) throw new Error("daily limit of requests reached");
    recent.push(now);
    this.requestsByAgent.set(agent.id, recent);
    const here = channelId && (isWebRoom(channelId) || this.channels?.isActive(channelId));
    const state = this.state(here ? channelId : privateRoom(agent.id));
    await this.ensureHistory(state);
    const clean = [...new Set((Array.isArray(choices) ? choices : []).map((choice) => String(choice).trim().slice(0, 40)).filter(Boolean))].slice(0, 4);
    const request = { choices: clean };
    const english = this.store.settings.language === "en";
    let item;
    if (isWebRoom(state.id)) {
      [item] = this.postWeb(agent, state, text, undefined, undefined, { request });
      this.emit({ type: "request", agentId: agent.id });
      if (this.notifier?.enabled) {
        const url = state.id === SALOTTO ? "/#/" : `/#/agent/${agent.id}/chat`;
        this.notifier.notify({ title: english ? `${agent.name} asks you` : `${agent.name} ti chiede`, body: text, url, tag: `request-${agent.id}` }).catch(() => {});
      }
    } else {
      const owner = !telegramChatId(state.id) && this.store.settings.ownerIds[0];
      const body = clean.length ? `${text}\n${english ? "Answers" : "Risposte"}: ${clean.join(" · ")}` : text;
      await this.postAs(agent, state, body, undefined, undefined, { ping: owner ? `<@${owner}>` : "", request });
      item = state.history.findLast((entry) => entry.agentId === agent.id && entry.request === request);
    }
    state.request = { agentId: agent.id, at: Date.now() };
    this.log({ type: "request", agentId: agent.id, channelId: state.id, text: text.slice(0, 300) });
    return { id: item?.id, where: this.channels?.label(state.id) || state.id, here: Boolean(here) };
  }

  saveWebFile(file) {
    if (!this.filesDir) return undefined;
    mkdirSync(this.filesDir, { recursive: true, mode: 0o700 });
    const id = randomBytes(12).toString("hex");
    const name = String(file.name || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    writeFileSync(join(this.filesDir, id), file.data, { mode: 0o600 });
    writeFileSync(join(this.filesDir, `${id}.json`), JSON.stringify({ name, type: file.type || "application/octet-stream" }), { mode: 0o600 });
    return { id, name, type: file.type || "application/octet-stream" };
  }

  /** The owner writing from the panel: same flow as a Discord message from the owner. */
  async onWebMessage({ room, text, user }) {
    const content = String(text || "").trim().slice(0, 3000);
    if (!content) return null;
    const state = this.state(room);
    await this.ensureHistory(state);
    const item = {
      id: `web_${randomBytes(8).toString("hex")}`,
      at: Date.now(),
      authorId: user?.id || "panel",
      authorName: user?.name || user?.email || this.store.ownerName() || "Proprietario",
      kind: "owner",
      agentId: null,
      content,
    };
    this.address(state, item);
    this.push(state, item);
    this.store.appendArchive(state.id, item);
    this.emit({ type: "web-message", room, item });
    this.log({ type: "message", channelId: room, author: item.authorName, kind: item.kind, text: content.slice(0, 300) });
    state.generation += 1;
    state.budget = this.store.settings.maxAgentTurns;
    state.ownerOrigin = true;
    this.schedule(state, 400);
    return item;
  }

  async runRoutine(routine, { manual = false, resumeTrace = null, resumeRunId = "" } = {}) {
    routine = this.store.routine(routine.id);
    if (!routine) return { status: "archived" };
    if (this.routineRuns.has(routine.id)) return { status: "busy" };
    const agent = this.store.agent(routine.agentId);
    if (!agent) return { status: "missing-agent" };
    const pendingRun = this.store.pendingRoutineRuns().find((run) => run.routineId === routine.id);
    if (resumeTrace && !manual) {
      const latest = this.store.recentMessages(routine.channelId, this.store.settings.historySize).findLast((item) => item.at > Date.parse(resumeTrace.startedAt) && item.kind === "owner"
        && (mentions(item.content, agent.name) || !this.store.agents().some((other) => mentions(item.content, other.name))));
      if (latest && asksToStop(latest.content)) {
        this.store.updateRoutine(routine.id, { enabled: false });
        this.store.recordRoutineRun(routine.id, "stopped", "Il proprietario ha chiesto di fermarsi prima della ripresa.", { runId: pendingRun?.id });
        return { status: "stopped" };
      }
    }
    if (pendingRun && !resumeRunId) {
      if (pendingRun.status !== "interrupted" || !manual) return { status: "busy" };
      if (pendingRun.traceId && pendingRun.routineUpdatedAt === routine.updatedAt) {
        resumeTrace = this.store.trace(pendingRun.traceId);
        resumeRunId = pendingRun.id;
      } else this.store.recordRoutineRun(routine.id, "interrupted", "Esecuzione interrotta prima di registrare una traccia; nuova prova richiesta manualmente.", { runId: pendingRun.id });
    }
    // One agent, one computer: a routine that lands on a busy agent waits for its next turn
    // instead of opening a second session on the same work.
    const busyWith = this.atWork.get(agent.id) || (this.threadWork.has(routine.channelId) ? "un compito già attivo in questo thread" : null);
    if (busyWith) {
      this.store.recordRoutineRun(routine.id, "skipped", `saltata: stava già lavorando a ${busyWith}`);
      this.log({ type: "routine-skip", agentId: agent.id, channelId: routine.channelId, text: `${routine.name}: stava già lavorando` });
      return { status: "busy" };
    }
    const channel = this.channelMeta(routine.channelId);
    if (!this.channels.isActive(routine.channelId)) {
      this.store.recordRoutineRun(routine.id, "error", `il canale è su ${isTelegramChannel(routine.channelId) ? "Telegram" : "Discord"}, ma ora Cora vive sull'altro`, { runId: pendingRun?.id });
      return { status: "error" };
    }
    if (channel.guildId && !this.allowedGuild(channel.guildId)) {
      this.store.recordRoutineRun(routine.id, "error", "channel is in a server cora does not use", { runId: pendingRun?.id });
      return { status: "error" };
    }
    const snapshot = { ...routine };
    const run = this.store.beginRoutineRun(routine, { manual, resumeRunId });
    if (!run) return { status: "busy" };
    this.routineRuns.add(routine.id);
    this.atWork.set(agent.id, `la routine «${routine.name}»`);
    this.threadWork.set(routine.channelId, agent.id);
    this.log({ type: "routine-start", agentId: agent.id, channelId: routine.channelId, text: routine.name, manual });
    const state = this.state(routine.channelId);
    state.working ??= new Set();
    state.working.add(agent.id);
    state.focus = { ids: [agent.id], at: Date.now() };
    const typing = setInterval(() => this.typing(routine.channelId, [agent]), 8000);
    try {
      await this.ensureHistory(state);
      const result = await this.brain[resumeTrace ? "resumeTurn" : "routineTurn"]({
        agent, routine: snapshot, history: state.history, channel, trace: resumeTrace,
        postFile: (file, caption) => this.postAs(agent, state, caption, file),
        say: (text) => this.postAs(agent, state, text),
        inbox: this.inbox(state, state.history),
        onTrace: (traceId) => this.store.attachRoutineTrace(run.id, traceId),
      });
      if (result.text) {
        await this.postAs(agent, state, result.text);
        state.ownerOrigin = false;
        state.budget = Math.max(state.budget, Math.ceil(this.store.settings.maxAgentTurns / 2));
        this.schedule(state, 3000);
      }
      const current = this.store.routine(routine.id);
      let verification = null;
      let status = result.stopped || !current || current.updatedAt !== snapshot.updatedAt ? "stopped" : result.text ? "posted" : "nothing";
      if (snapshot.kind === "reminder" && status !== "stopped") {
        verification = await this.brain.verifyReminder({ agent, routine: snapshot, result, delivered: Boolean(result.text) });
        const latest = this.store.routine(routine.id);
        status = !latest || latest.updatedAt !== snapshot.updatedAt ? "stopped" : verification.met ? "completed" : verification.blocked ? "blocked" : "unverified";
      }
      this.store.tx(() => {
        this.store.recordRoutineRun(routine.id, status, result.text || "PASS", { runId: run.id, snapshot, traceId: result.traceId, verification });
        if (status === "completed") this.store.deleteRoutine(routine.id, "completed");
      });
      if (["blocked", "unverified"].includes(status) && !result.asked) await this.postAs(agent, state, this.store.settings.language === "en"
        ? `Reminder kept open: ${verification.reason || "success has not been verified."}` : `Reminder non archiviato: ${verification.reason || "il successo non è stato verificato."}`);
      this.log({ type: "routine-end", agentId: agent.id, channelId: routine.channelId, text: routine.name, kind: snapshot.kind || "routine", ok: !["stopped", "blocked", "unverified"].includes(status), steps: result.steps });
      return { status, verification };
    } catch (error) {
      this.store.recordRoutineRun(routine.id, "error", error.message, { runId: run.id, snapshot });
      this.log({ type: "routine-end", agentId: agent.id, channelId: routine.channelId, text: `${routine.name}: ${error.message}`, ok: false });
      return { status: "error", error: error.message };
    } finally {
      clearInterval(typing);
      this.routineRuns.delete(routine.id);
      state.working.delete(agent.id);
      this.atWork.delete(agent.id);
      this.threadWork.delete(routine.channelId);
    }
  }
}
