import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ThreadState } from "./thread-state.js";
import { TRANSPORT_LABELS, isSlackChannel, isTelegramChannel, slackChannel, slackIds, telegramBotAgent, telegramChannel, telegramChatId, transportOf } from "./channels.js";
import { SALOTTO, isWebRoom, isSalotto, ownerRoom, privateRoom, roomAgentId } from "./rooms.js";
import { MEMORY_TOOLS } from "./tools.js";
import { userName } from "./telegram.js";
import { asksToStop } from "./brain.js";
import { VOICE_MESSAGE } from "./discord.js";
import { AUDIO_LIMIT_BYTES, VOICE_LANGUAGES, speechParts } from "./voice.js";
import { imageMime } from "./images.js";

const HUMAN_DEBOUNCE_MS = 1200;
const INACTIVITY_MS = 30 * 60 * 1000;
// After a restart, unanswered human messages this recent are picked up again.
const CATCH_UP_MS = 15 * 60 * 1000;
/** How long a round holds its channel before the agents still working carry on in the background. */
const RELEASE_AFTER_MS = 20000;
const IMAGE_LIMIT_BYTES = 5 * 1024 * 1024;
// What a voice message becomes in the chat; the archive keeps 4000 characters of a message.
const TRANSCRIPT_LIMIT = 3500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Slack message subtypes that still carry words for the agents.
const SLACK_SUBTYPES = new Set(["bot_message", "file_share", "me_message", "thread_broadcast"]);

const isAudio = (type) => String(type || "").startsWith("audio/");
const slackAudio = (file) => isAudio(file.mimetype) || file.subtype === "slack_audio" || file.media_display_type === "audio";

function normalize(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const escapeName = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * "@Name" outside code turns into the real mention `<@id>` (the same markup on
 * Discord and Slack) for each person in `people`, longest names first so
 * "@Anna Maria" is not taken for "@Anna".
 */
function tagPeople(parts, people) {
  const named = [...people].filter(([, id]) => id).sort(([a], [b]) => b.length - a.length);
  for (const [name, id] of named) {
    const tagged = new RegExp(`(^|[^\\p{L}\\p{N}_@.])@${escapeName(name)}(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}])`, "giu");
    for (let index = 0; index < parts.length; index += 2) parts[index] = parts[index].replace(tagged, `$1<@${id}>`);
  }
}

export function mentions(text, name) {
  const escaped = normalize(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])@?${escaped}([^\\p{L}\\p{N}]|$)`, "u").test(normalize(text));
}

/**
 * Whether a text tags this name: "@Name", which is how a real mention reads here. Only a tag calls an
 * agent; writing its name, even to someone ("Sarax, …", "Sarax is not listening"), calls nobody.
 */
export function tagged(text, name) {
  const escaped = normalize(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_])@${escaped}([^\\p{L}\\p{N}]|$)`, "u").test(normalize(text));
}

/**
 * A voice message cannot carry an "@": there the name said to someone is the call ("Ada, …", "ci sei,
 * Ada?"), within the words heard, not a name said in passing.
 */
export function spokenTo(text, name) {
  const heard = /\[messaggio vocale: «([\s\S]*)»\]/.exec(String(text || ""))?.[1] || "";
  const escaped = normalize(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Boolean(heard) && new RegExp(`(^|[^\\p{L}\\p{N}_@])${escaped}\\s*[,:!?]|^\\s*${escaped}([^\\p{L}\\p{N}]|$)`, "u").test(normalize(heard));
}

function discordConversationMessage(raw, archived = null) {
  return (raw.type === undefined || raw.type === 0 || raw.type === 19)
    && Boolean(raw.content?.trim() || raw.attachments?.length || raw.embeds?.length || raw.sticker_items?.length
      || (archived?.voice || archived?.voiceOnly) && archived.content?.trim());
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
  constructor({ store, discord, brain, log, bots = null, channels, telegram = null, tgBots = null, slack = null, skBots = null, voice = null, emit = () => {}, filesDir = null, notifier = null, watching = () => false }) {
    this.notifier = notifier;
    this.voice = voice;
    // Messages being read right now (a voice message takes seconds): the other bots' copies wait for nothing.
    this.arriving = new Set();
    this.watching = watching;
    this.requestsByAgent = new Map();
    this.bots = bots;
    this.channels = channels;
    this.telegram = telegram;
    this.tgBots = tgBots;
    this.slack = slack;
    this.skBots = skBots;
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
    // One worker per agent and conversation; colleagues keep independent tasks.
    this.threadWork = new ThreadState();
    this.engagements = this.store.value("conversationEngagements", {});
    this.reminding = new Set();
    // The names people go by, by server (or "slack"): who wrote or was tagged since the start, on top of the archive.
    this.knownPeople = new Map();
    // A task can take hours: after this long the channel is free again for the others while the agent keeps working.
    this.releaseAfterMs = RELEASE_AFTER_MS;
    // When an agent called by name could not hear: one offer per agent and channel every half hour.
    this.offered = new Map();
    this.instanceUrl = "";
  }

  state(channelId) {
    let state = this.states.get(channelId);
    if (!state) {
      state = { id: channelId, history: [], seen: new Set(), heardFrom: new Set(), humanQueue: new Map(), mainBlind: false, focus: this.engagements[channelId] || null, generation: 0, budget: 0, ownerOrigin: false, running: false, pending: false, timer: null, loading: null };
      this.states.set(channelId, state);
    }
    return state;
  }

  allowedGuild(guildId) {
    return this.store.settings.guildIds.includes(guildId);
  }

  channelMeta(channelId) {
    if (this.dmAgentId(channelId)) {
      return { id: channelId, kind: transportOf(channelId), name: "DM", guildId: null, guildName: "", parentId: null, where: "in privato con te", place: "in un messaggio privato", note: "messaggio privato" };
    }
    return this.channels.info(channelId);
  }

  dmAgentId(channelId) {
    return this.dmAgent.get(channelId) || telegramBotAgent(channelId) || null;
  }

  agentsFor(channelId) {
    if (isWebRoom(channelId)) {
      const only = roomAgentId(channelId);
      return this.store.agents().filter((agent) => agent.enabled && (!only || agent.id === only) && (!this.brain.knowledge?.ownerMemory || only || channelId === ownerRoom(this.brain.knowledge.ownerId(agent))));
    }
    const dm = this.dmAgentId(channelId);
    if (dm) {
      const agent = this.store.agent(dm);
      return agent?.enabled ? [agent] : [];
    }
    const transport = transportOf(channelId);
    const info = transport === "discord" ? this.channels.discordInfo(channelId) : transport === "slack" ? this.channels.info(channelId) : null;
    return this.store.agents().filter((agent) => {
      if (!agent.enabled || !this.channels.agentOn(agent, transport)) return false;
      const chosen = agent.channelIds.filter((id) => transportOf(id) === transport);
      return !chosen.length || chosen.includes(channelId) || Boolean(info?.parentId && chosen.includes(info.parentId));
    });
  }

  isOwner(userId) {
    const owners = this.store.settings.ownerIds;
    return !owners.length || owners.includes(userId);
  }

  /**
   * A private message from Cora to the owner, on the platform in use: a DM from
   * the main Discord bot or Slack app, or a Telegram message. False when there is
   * no owner to reach there.
   */
  async messageOwner(text) {
    const { settings } = this.store;
    const active = this.channels.active;
    if (active === "slack") {
      const owner = settings.slackOwnerIds[0];
      if (!owner || !this.slack?.user) return false;
      const opened = await this.slack.request("conversations.open", { users: owner });
      await this.slack.say(opened.channel.id, { content: text });
      return true;
    }
    if (active === "telegram") {
      const owner = settings.telegramOwnerIds[0];
      if (!owner || !this.telegram?.user) return false;
      await this.telegram.say(owner, { content: text });
      return true;
    }
    const owner = settings.ownerIds[0];
    if (!owner || !this.discord.user) return false;
    const dm = await this.discord.request("POST", "/users/@me/channels", { body: { recipient_id: owner } });
    await this.discord.say(dm.id, { content: text });
    return true;
  }

  async messagePerson(text, personId) {
    const match = /^(discord|slack|telegram):(.+)$/.exec(String(personId || ""));
    if (!match) return false;
    const [, transport, id] = match;
    if (transport === "slack") {
      if (!this.slack?.user) return false;
      const opened = await this.slack.request("conversations.open", { users: id });
      await this.slack.say(opened.channel.id, { content: text });
    } else if (transport === "telegram") {
      if (!this.telegram?.user) return false;
      await this.telegram.say(id, { content: text });
    } else {
      if (!this.discord.user) return false;
      const dm = await this.discord.request("POST", "/users/@me/channels", { body: { recipient_id: id } });
      await this.discord.say(dm.id, { content: text });
    }
    return true;
  }

  /**
   * Whether the owner lets the person who wrote this put the agent to work on
   * its computer, as if they had asked themselves (Settings → Permissions).
   */
  authorized(item, agent, state) {
    if (item?.kind !== "human" || !item.authorId) return false;
    const transport = transportOf(state.id);
    if (transport === "web") return false;
    const id = `${transport}:${item.authorId}`;
    // The person an agent belongs to answers for it: their word counts as the owner's for their own agents.
    if (this.ownsAgent(item, agent, state)) return true;
    return this.store.hasAgentPermission(id, agent.id);
  }

  /** Whether this message comes from the person the agent belongs to (not the owner of the space). */
  ownsAgent(item, agent, state) {
    if (!item?.authorId || !agent) return false;
    return this.store.agentOwnerChats(agent).includes(`${transportOf(state.id)}:${item.authorId}`);
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
    const space = raw.guild_id || this.channelMeta(raw.channel_id).guildId;
    // Who an agent can tag here: the people, and the other bots with an account of their own (another agent
    // like GROG), never a webhook, Cora or its agents.
    const ownBot = (id) => !id || id === this.discord.user?.id || Boolean(this.bots?.agentIdForUser(id));
    if (who.kind === "owner" || who.kind === "human" || (who.kind === "bot" && !raw.webhook_id && !ownBot(raw.author?.id))) {
      this.learnPerson(space, raw.author?.id, [who.authorName, raw.author?.global_name, raw.author?.username]);
    }
    for (const user of raw.mentions || []) {
      if (!ownBot(user.id)) this.learnPerson(space, user.id, [user.member?.nick, user.global_name, user.username]);
    }
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
    if (this.brain.knowledge?.afterReset(item) === false) return false;
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
    if (isWebRoom(state.id) || isTelegramChannel(state.id) || isSlackChannel(state.id) || this.dmAgentId(state.id)) {
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
        .then(async (messages) => {
          const archived = new Map(this.store.recentMessages(state.id, this.store.settings.historySize).map((item) => [item.id, item]));
          // A voice message comes back as the words it was heard as, not as its attachment.
          const items = [];
          for (const raw of messages) {
            const kept = archived.get(raw.id);
            if (!discordConversationMessage(raw, kept)) continue;
            if (raw.id === exclude || this.arriving.has(raw.id)) continue;
            const item = { ...this.toItem(raw), ...(kept?.passive ? { passive: true } : {}), ...(kept?.voice || kept?.voiceOnly ? kept : {}) };
            if (!kept && Date.now() - item.at < CATCH_UP_MS) await this.arrive(raw.id, () => this.hearDiscord(state, item, raw));
            items.push(item);
          }
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
    const guildId = raw.guild_id || this.channels.discordInfo(raw.channel_id)?.guildId;
    if (!guildId || !this.allowedGuild(guildId)) return;
    // Only real messages and replies: joins, pins, boosts and the like have no text for the agents.
    if (!discordConversationMessage(raw)) return;
    if (this.discord.isOwnMessage(raw) || this.bots?.isOwnMessage(raw)) return;
    // What an agent's own bot posts is already in the history (Cora posted it); the gateway echo can arrive first.
    if (raw.author?.id && this.bots?.agentIdForUser(raw.author.id)) return;
    const state = this.state(raw.channel_id);
    // Who delivered it is who is in the channel: in a private one, only they can answer.
    if (viaAgentId) state.heardFrom.add(viaAgentId);
    // Several bots may hear the same channel: the first delivery wins, the rest are the same message.
    if (state.seen.has(raw.id) || this.store.hasMessage(raw.id)) return;
    await this.arrive(raw.id, async () => {
      await this.ensureHistory(state, { exclude: raw.id });
      const item = this.toItem(raw);
      if (item.kind === "owner" || item.kind === "human") {
        await this.attachImages(item, raw);
        await this.hearDiscord(state, item, raw);
      }
      await this.ingest(state, item);
    });
  }

  /** One delivery of a message at a time: while it is being read, another bot's copy is the same message. */
  async arrive(id, work) {
    if (this.arriving.has(id)) return;
    this.arriving.add(id);
    try {
      await work();
    } finally {
      this.arriving.delete(id);
    }
  }

  /** The languages a voice message here is likely in: the agents' own and the instance's. */
  languagesFor(state) {
    return [...new Set([...this.agentsFor(state.id).map((agent) => agent.voiceLanguage), this.store.settings.language || "it"].filter(Boolean))];
  }

  /**
   * A voice message, heard: Soniox writes down what was said and the agents read
   * those words where the attachment was. The message is marked as spoken, and a
   * spoken message gets a spoken answer. Without Soniox it stays an attachment.
   */
  async hear(state, item, { placeholder, filename, size = 0, read }) {
    if (!this.voice?.enabled || (item.kind !== "owner" && item.kind !== "human")) return;
    let line;
    try {
      if (size > AUDIO_LIMIT_BYTES) throw new Error("è troppo lungo");
      const audio = await read();
      if (!audio?.length) throw new Error("non riesco a scaricarlo");
      const heard = await this.voice.transcribe(audio, { filename, languages: this.languagesFor(state), reference: item.id });
      item.spokenIn = heard.language;
      const words = heard.text.length > TRANSCRIPT_LIMIT ? `${heard.text.slice(0, TRANSCRIPT_LIMIT)}…` : heard.text;
      line = words ? `[messaggio vocale: «${words}»]` : "[messaggio vocale senza parole]";
    } catch (error) {
      this.log({ type: "error", channelId: state.id, text: `vocale: ${error.message}` });
      line = `[messaggio vocale che non sono riuscito ad ascoltare: ${error.message.slice(0, 160)}]`;
    }
    item.voice = true;
    item.content = item.content.includes(placeholder) ? item.content.replace(placeholder, () => line) : `${item.content} ${line}`.trim();
    item.replyMode = await this.brain.voiceReplyMode(item.content);
  }

  /** A Discord voice message (or any audio file) in a message. */
  async hearDiscord(state, item, raw) {
    const attachments = raw.attachments || [];
    const audio = (raw.flags & VOICE_MESSAGE) ? attachments[0] : attachments.find((attachment) => isAudio(attachment.content_type));
    if (!audio?.url) return;
    await this.hear(state, item, {
      placeholder: `[allegato: ${audio.filename} ${audio.url}]`, filename: audio.filename, size: audio.size,
      read: async () => {
        const response = await fetch(audio.url, { signal: AbortSignal.timeout(30000) });
        return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
      },
    });
  }

  /**
   * A direct message to an agent's own bot: that one agent answers, in the DM,
   * as a private conversation. DMs need no server, so they are heard even where
   * the agent listens to no channel.
   */
  async onDirectMessage(agentId, raw) {
    const agent = this.store.agent(agentId);
    if (!agent?.enabled) return;
    if (!discordConversationMessage(raw)) return;
    // Ignore bots and anything our own agents posted (the DM echoes the agent's own reply back).
    if (raw.author?.bot || this.bots?.agentIdForUser(raw.author?.id) || this.discord.isOwnMessage(raw)) return;
    this.dmAgent.set(raw.channel_id, agentId);
    const state = this.state(raw.channel_id);
    await this.arrive(raw.id, async () => {
      await this.ensureHistory(state);
      const item = this.toItem(raw);
      if (item.kind !== "owner" && item.kind !== "human") return;
      await this.attachImages(item, raw);
      await this.hearDiscord(state, item, raw);
      await this.ingest(state, item);
    });
  }

  /**
   * Run when the Discord connection comes up: messages written while Cora was
   * down are archived, and a recent human message nobody answered gets answered.
   */
  async catchUp() {
    if (this.channels.on("slack")) await this.catchUpSlack();
    if (!this.channels.on("discord")) return;
    for (const channel of this.channels.list().filter((item) => item.kind === "discord")) {
      const state = this.state(channel.id);
      if (state.running || state.nextRoundAt) continue;
      state.loaded = false;
      state.loading = null;
      await this.ensureHistory(state);
      const missed = state.history.filter((item) => !this.store.hasMessage(item.id));
      for (const item of missed) this.store.appendArchive(state.id, item);
      await this.wakeIfMissed(state, missed);
    }
  }

  /** The last message nobody answered, when it is still recent, starts a round. */
  async wakeIfMissed(state, missed) {
    const last = state.history[state.history.length - 1];
    if (!last || !missed.includes(last) || Date.now() - last.at > CATCH_UP_MS) return;
    const human = ["owner", "human"].includes(last.kind);
    const botCall = last.kind === "bot" && this.agentsFor(state.id).some((agent) => tagged(last.content, agent.name));
    if (!human && !botCall) return;
    this.log({ type: "message", channelId: state.id, author: last.authorName, kind: last.kind, text: `(arrivato mentre ero spenta) ${last.content.slice(0, 280)}` });
    if (human) {
      await this.address(state, last);
      state.humanQueue.set(last.id, last);
      state.budget = this.store.settings.maxAgentTurns;
    }
    state.generation += 1;
    state.ownerOrigin = last.kind === "owner";
    this.schedule(state, HUMAN_DEBOUNCE_MS);
  }

  /**
   * Who a human message is for: the agents it names, or else the ones the
   * human was just talking to. Addressed messages keep the others quiet.
   */
  async address(state, item) {
    const available = this.agentsFor(state.id).filter((agent) => !this.brain.knowledge || this.brain.knowledge.acceptsMessage(agent, item, state.id));
    if (!state.focus) state.focus = this.engagements[state.id] || null;
    if (state.focus) state.focus = { ...state.focus, ids: state.focus.ids.filter((id) => available.some((agent) => agent.id === id)) };
    const previous = state.focus?.ids || [];
    const calls = (agent) => tagged(item.content, agent.name) || (item.voice && spokenTo(item.content, agent.name));
    const named = available.filter(calls).map((agent) => agent.id);
    const leaving = previous.length ? await this.brain.disengagement({ message: item.content, agents: available.filter((agent) => previous.includes(agent.id)), history: state.history.filter((entry) => entry.id !== item.id) }) : [];
    // The answer to an agent's question comes from whoever it asked: the owner, or the person the agent belongs to.
    const askedBy = state.request ? this.store.agent(state.request.agentId) : null;
    const asked = state.request && !item.others?.length && (item.kind === "owner" || this.ownsAgent(item, askedBy, state)) ? state.request : null;
    if (asked) state.request = null;
    const direct = roomAgentId(state.id) || this.dmAgentId(state.id);
    const recipients = named.length ? named : asked ? [asked.agentId] : previous.length ? previous : direct ? [direct] : [];
    const ids = [...new Set([...previous, ...recipients])].filter((id) => !leaving.includes(id) && available.some((agent) => agent.id === id));
    const now = Number(item.at) || Date.now();
    state.focus = ids.length ? { ids, at: now, remindedAt: 0, owner: item.kind === "owner" || Boolean(state.focus?.owner) } : null;
    this.engagements[state.id] = state.focus;
    this.store.setValue("conversationEngagements", this.engagements);
    item.addressed = recipients.filter((id) => available.some((agent) => agent.id === id));
    // Called by name where they do not listen, or while switched off: they cannot answer, so Cora says why.
    item.deaf = direct ? [] : this.store.agents().filter((agent) => !available.some((candidate) => candidate.id === agent.id) && calls(agent)).map((agent) => agent.id);
    item.handledBy = [...leaving];
    item.toOthers = !named.length && Boolean(item.others?.length);
    item.disengaged = leaving;
    for (const id of leaving) {
      this.acknowledge(state, id, [...state.humanQueue.keys()]);
      const agent = this.store.agent(id);
      if (agent) await this.postAs(agent, state, this.store.settings.language === "en" ? "I have stopped listening to this conversation." : "Ho smesso di ascoltare questa conversazione.", undefined, undefined, { passive: true, ...this.replyDelivery(item) }).catch((error) => this.log({ type: "error", agentId: id, channelId: state.id, text: `disingaggio: ${error.message}` }));
    }
  }

  acknowledge(state, agentId, ids) {
    for (const id of ids) {
      const item = state.humanQueue.get(id);
      if (!item || (item.addressed?.length && !item.addressed.includes(agentId))) continue;
      item.handledBy ??= [];
      if (!item.handledBy.includes(agentId)) item.handledBy.push(agentId);
      if (!item.addressed?.length || item.addressed.every((recipient) => item.handledBy.includes(recipient) || !this.store.agent(recipient)?.enabled)) state.humanQueue.delete(id);
    }
  }

  async checkEngagements(now = Date.now()) {
    for (const [channelId, focus] of Object.entries(this.engagements)) {
      if (!focus?.ids?.length || focus.remindedAt || now - focus.at < INACTIVITY_MS || this.reminding.has(channelId) || !this.channels.isActive(channelId)) continue;
      const channel = this.channelMeta(channelId);
      if (channel.guildId && !this.allowedGuild(channel.guildId)) continue;
      this.reminding.add(channelId);
      try {
        for (const id of focus.ids) {
          const agent = this.agentsFor(channelId).find((candidate) => candidate.id === id);
          if (!agent) continue;
          if (transportOf(channelId) === "discord" && !this.dmAgentId(channelId) && this.bots && !await this.bots.canRead(agent, channelId)) continue;
          if (this.engagements[channelId] !== focus) break;
          const text = this.store.settings.language === "en" ? "It has been 30 minutes since your last message. Should I keep listening to this conversation? I will stay connected until you explicitly ask me to leave." : "Sono passati 30 minuti dal tuo ultimo messaggio. Devo rimanere in ascolto di questa conversazione? Resto collegato finché non mi chiedi esplicitamente di uscire.";
          await this.postAs(agent, this.state(channelId), text, undefined, undefined, { passive: true });
          if (this.engagements[channelId] === focus) {
            focus.remindedAt = now;
            this.store.setValue("conversationEngagements", this.engagements);
          }
          break;
        }
      } catch (error) { this.log({ type: "error", channelId, text: `ascolto: ${error.message}` }); }
      finally { this.reminding.delete(channelId); }
    }
  }

  /** Human routing is serialized before the message becomes visible to working agents. */
  async ingest(state, item) {
    const pending = state.ingesting || Promise.resolve();
    const ingestion = pending.catch(() => {}).then(async () => {
      if (state.seen.has(item.id)) return;
      const human = item.kind === "owner" || item.kind === "human";
      if (human) await this.address(state, item);
      if (!this.push(state, item)) return;
      this.store.appendArchive(state.id, item);
      this.log({ type: "message", channelId: state.id, author: item.authorName, kind: item.kind, text: item.content.slice(0, 300) });
      if (human && item.deaf?.length) this.offerListening(state, item).catch((error) => this.log({ type: "error", channelId: state.id, text: `ascolto: ${error.message}` }));
      if (human) {
        if (item.addressed.some((id) => !item.handledBy.includes(id)) || (!item.disengaged.length && (roomAgentId(state.id) || this.dmAgentId(state.id)))) state.humanQueue.set(item.id, item);
        state.generation += 1;
        state.budget = this.store.settings.maxAgentTurns;
        state.ownerOrigin = item.kind === "owner";
        this.schedule(state, HUMAN_DEBOUNCE_MS);
      } else if (item.kind === "bot") {
        const called = this.agentsFor(state.id).some((agent) => tagged(item.content, agent.name));
        if (called) state.ownerOrigin = false;
        if (called) this.schedule(state, HUMAN_DEBOUNCE_MS);
      }
    });
    state.ingesting = ingestion;
    this.brain.incoming?.set(state.id, ingestion);
    try { await ingestion; }
    finally { if (this.brain.incoming?.get(state.id) === ingestion) this.brain.incoming.delete(state.id); }
  }

  /* ---------- Telegram ---------- */
  isTelegramOwner(userId) {
    const owners = this.store.settings.telegramOwnerIds;
    return !owners.length || owners.includes(String(userId));
  }

  /** Until an owner is set, the person in a private chat or the group's creator becomes it. */
  async claimTelegramOwner(chat, from, client = this.telegram) {
    if (this.store.settings.telegramOwnerIds.length || !from?.id) return;
    let ownerId = null;
    if (chat.type === "private") ownerId = String(from.id);
    else {
      try {
        const admins = await client.request("getChatAdministrators", { chat_id: chat.id });
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

  /**
   * A Telegram message, heard by the main bot or by an agent's own bot. A private chat with an
   * agent's bot is a conversation only that agent answers (tg:<chat>@<agent>); a group is heard
   * by any of them, once.
   */
  async onTelegramMessage(message, viaAgentId = null) {
    if (!this.channels.on("telegram") || !message?.chat) return;
    const chatId = String(message.chat.id);
    const privateWith = viaAgentId && message.chat.type === "private" ? viaAgentId : null;
    if (!privateWith && !this.store.settings.telegramChatIds.includes(chatId)) return;
    const client = (viaAgentId && this.tgBots?.client(viaAgentId)) || this.telegram;
    const from = message.from || {};
    if (from.is_bot && (String(from.id) === String(this.telegram.user?.id) || this.tgBots?.agentIdForUser(from.id))) return;
    if (privateWith && !this.store.agent(privateWith)?.enabled) return;
    // Anyone can write to an agent's bot: a private chat with one never makes its writer the
    // owner, nor counts as the owner's while none is set. The owner's own chats are chosen in Settings.
    if (!privateWith) await this.claimTelegramOwner(message.chat, from, client);
    const channelId = telegramChannel(chatId, privateWith || "");
    if (privateWith) this.dmAgent.set(channelId, privateWith);
    const state = this.state(channelId);
    await this.ensureHistory(state);
    const owner = this.isTelegramOwner(from.id) && !(privateWith && !this.store.settings.telegramOwnerIds.length);
    const kind = from.is_bot ? "bot" : owner ? "owner" : "human";
    const item = {
      id: `tg_${chatId}${privateWith ? `@${privateWith}` : ""}_${message.message_id}`,
      at: (message.date || Date.now() / 1000) * 1000,
      authorId: String(from.id || ""),
      authorName: userName(from),
      kind,
      agentId: null,
      content: this.telegramText(message),
    };
    if (kind === "owner" || kind === "human") {
      for (const source of [message, message.reply_to_message].filter(Boolean)) {
        const document = source.document;
        const imageDocument = document && (/^image\/(?:png|jpe?g|webp|gif)$/i.test(document.mime_type || "") || /\.(?:png|jpe?g|webp|gif)$/i.test(document.file_name || ""));
        if (!source.photo?.length && !imageDocument) continue;
        const picture = source.photo?.length
          ? [...source.photo].sort((a, b) => (b.file_size || b.width * b.height || 0) - (a.file_size || a.width * a.height || 0)).find((size) => !size.file_size || size.file_size <= IMAGE_LIMIT_BYTES)
          : !document.file_size || document.file_size <= IMAGE_LIMIT_BYTES ? document : null;
        const data = picture?.file_id && await client.download(picture.file_id, IMAGE_LIMIT_BYTES).catch(() => null);
        if (data && imageMime(data)) (item.images ||= []).push(data.toString("base64"));
        else item.content += " [Cora: immagine non disponibile: download non riuscito, file troppo grande o formato non supportato. Non inventarne il contenuto.]";
      }
    }
    const audio = message.voice || message.audio;
    if (audio?.file_id) {
      await this.hear(state, item, {
        placeholder: "[messaggio vocale]", filename: message.voice ? "voice.ogg" : audio.file_name || "audio.mp3", size: audio.file_size,
        read: () => client.download(audio.file_id, AUDIO_LIMIT_BYTES),
      });
    }
    await this.ingest(state, item);
  }

  /* ---------- Slack ---------- */
  isSlackOwner(userId) {
    const owners = this.store.settings.slackOwnerIds;
    return !owners.length || owners.includes(String(userId));
  }

  /** Until an owner is set, the workspace's own owner takes the role the first time they write. */
  async claimSlackOwner(event, client) {
    if (this.store.settings.slackOwnerIds.length || !event.user) return;
    const info = await client.userInfo(event.user).catch(() => null);
    if (!info?.owner || this.store.settings.slackOwnerIds.length) return;
    this.store.updateSettings({ slackOwnerIds: [String(event.user)] });
    this.log({ type: "settings", text: `proprietario Slack impostato (${info.name})` });
  }

  /** Slack writes ids where people read names: mentions, channels and links come back as words. */
  async slackText(event, client) {
    const parts = [];
    let text = String(event.text || "");
    for (const [match, userId] of [...text.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g)]) {
      const agentId = this.skBots?.agentIdForUser(userId);
      const name = agentId ? this.store.agent(agentId)?.name : await client.userName(userId);
      if (name && !agentId) this.learnPerson("slack", userId, [name]);
      if (name) text = text.split(match).join(`@${name}`);
    }
    text = text
      .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
      .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2 ($1)")
      .replace(/<(https?:\/\/[^>]+)>/g, "$1")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    if (text.trim()) parts.push(text.trim());
    for (const file of event.files || []) {
      parts.push(String(file.mimetype || "").startsWith("image/") ? "[immagine]" : slackAudio(file) ? "[messaggio vocale]" : `[allegato: ${file.name || "file"}]`);
    }
    return parts.join(" ").slice(0, 3000) || "(messaggio vuoto)";
  }

  async slackItem(event, client) {
    const bot = Boolean(event.bot_id || event.subtype === "bot_message");
    const item = {
      id: `sl_${event.channel}_${event.ts}`,
      at: Math.round(Number(event.ts) * 1000) || Date.now(),
      authorId: String(event.user || event.bot_id || ""),
      authorName: bot ? String(event.username || "bot") : await client.userName(event.user),
      kind: bot ? "bot" : this.isSlackOwner(event.user) ? "owner" : "human",
      agentId: null,
      content: await this.slackText(event, client),
    };
    if ((item.kind === "owner" || item.kind === "human") && event.files?.length) {
      const picture = event.files.find((file) => String(file.mimetype || "").startsWith("image/") && (!file.size || file.size <= IMAGE_LIMIT_BYTES));
      const data = picture && await client.download(picture, IMAGE_LIMIT_BYTES).catch(() => null);
      if (data) item.images = [data.toString("base64")];
    }
    return item;
  }

  /** A Slack audio clip (or audio file), read with the token of the app that heard it. */
  async hearSlack(state, item, event, client) {
    const audio = (event.files || []).find(slackAudio);
    if (!audio) return;
    await this.hear(state, item, { placeholder: "[messaggio vocale]", filename: audio.name || "audio.webm", size: audio.size, read: () => client.download(audio, AUDIO_LIMIT_BYTES) });
  }

  /**
   * A message in a Slack conversation, delivered by whichever agent's app is in
   * it: in a private channel only those agents can answer. A reply inside a
   * thread belongs to that thread, where agents speak only when summoned.
   */
  async onSlackMessage(event, viaAgentId = null) {
    if (!this.channels.on("slack") || !event?.channel) return;
    // Edits, deletions, joins and the rest carry no new words for the agents.
    if (event.subtype && !SLACK_SUBTYPES.has(event.subtype)) return;
    if (!this.store.settings.slackChannelIds.includes(event.channel)) return;
    const client = (viaAgentId && this.skBots?.client(viaAgentId)) || this.slack;
    if (!client?.user) return;
    // What our own apps post is already in the history: the socket echoes it back.
    if (this.skBots?.isOwnMessage(event) || this.slack?.isOwnMessage(event) || this.skBots?.agentIdForBot(event.bot_id)) return;
    const threadTs = event.thread_ts && event.thread_ts !== event.ts ? event.thread_ts : "";
    const state = this.state(slackChannel(event.channel, threadTs));
    // Who delivered it is who is in the conversation.
    if (viaAgentId) state.heardFrom.add(viaAgentId);
    const id = `sl_${event.channel}_${event.ts}`;
    // Every app in the channel hears the same message: the first delivery wins.
    if (state.seen.has(id) || this.store.hasMessage(id)) return;
    await this.arrive(id, async () => {
      await this.ensureHistory(state);
      await this.claimSlackOwner(event, client);
      const item = await this.slackItem(event, client);
      await this.hearSlack(state, item, event, client);
      await this.ingest(state, item);
    });
  }

  /** A direct message to an agent's own Slack app: a private conversation only that agent answers. */
  async onSlackDirect(agentId, event) {
    if (!this.channels.on("slack") || !event?.channel) return;
    const agent = this.store.agent(agentId);
    if (!agent?.enabled) return;
    if (event.subtype && event.subtype !== "file_share") return;
    const client = this.skBots?.client(agentId);
    if (!client || event.bot_id || this.skBots?.isOwnMessage(event)) return;
    const id = slackChannel(event.channel);
    this.dmAgent.set(id, agentId);
    const state = this.state(id);
    if (state.seen.has(`sl_${event.channel}_${event.ts}`) || this.store.hasMessage(`sl_${event.channel}_${event.ts}`)) return;
    await this.ensureHistory(state);
    const item = await this.slackItem(event, client);
    if (item.kind !== "owner" && item.kind !== "human") return;
    await this.hearSlack(state, item, event, client);
    await this.ingest(state, item);
  }

  /** Slack delivers only what happens while the socket is open: on connect, pick up what was missed. */
  async catchUpSlack() {
    for (const channel of this.channels.list()) {
      const info = this.channels.info(channel.id);
      const state = this.state(channel.id);
      if (state.running || state.nextRoundAt) continue;
      const client = this.slack?.user ? this.slack : null;
      const messages = await this.slackHistory(info.channelId, this.store.settings.historySize);
      if (!messages?.length) continue;
      await this.ensureHistory(state);
      const missed = [];
      for (const event of messages) {
        if (event.thread_ts && event.thread_ts !== event.ts) continue;
        if (event.subtype && !SLACK_SUBTYPES.has(event.subtype)) continue;
        if (this.skBots?.isOwnMessage(event) || this.slack?.isOwnMessage(event) || this.skBots?.agentIdForBot(event.bot_id)) continue;
        const item = await this.slackItem({ ...event, channel: info.channelId }, client || this.skBots?.client(this.store.agents()[0]?.id) || this.slack);
        if (this.store.hasMessage(item.id) || !this.push(state, item)) continue;
        this.store.appendArchive(state.id, item);
        missed.push(item);
      }
      if (!missed.length) continue;
      state.history.sort((a, b) => a.at - b.at);
      await this.wakeIfMissed(state, missed);
    }
  }

  /** Recent messages of a Slack conversation, read by any app that is in it. */
  async slackHistory(channelId, limit, threadTs = "") {
    if (this.slack?.user) {
      try { return await this.slack.fetchMessages(channelId, limit, threadTs); } catch {}
    }
    return this.skBots?.fetchMessages(channelId, limit, threadTs) || null;
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
    return !this.threadWork.size && [...this.states.values()].every((state) => !state.running && !state.nextRoundAt && !state.pending && !state.working?.size);
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

  pickCandidates(state, last, agents) {
    if (last.toOthers) return { forced: [], optional: [] };
    const fromHuman = last.kind === "owner" || last.kind === "human";
    const pool = agents.filter((agent) => agent.id !== last.agentId && !last.handledBy?.includes(agent.id) && !last.disengaged?.includes(agent.id));
    // In a room or a DM of one agent, whatever a person writes is for it.
    if (fromHuman && (roomAgentId(state.id) || this.dmAgentId(state.id))) return { forced: pool, optional: [] };
    // Everywhere else an agent speaks only when called, in a channel as in a thread: named by a person (or still in
    // the conversation that person is having with it), called directly by another agent or bot. Nobody called,
    // nobody answers; agents calling each other stop when the turn budget is spent.
    if (last.kind === "agent" && state.budget <= 0) return { forced: [], optional: [] };
    return { forced: pool.filter((agent) => (fromHuman ? last.addressed?.includes(agent.id) : tagged(last.content, agent.name))), optional: [] };
  }

  async round(state) {
    state.working ??= new Set();
    await this.brain.settleChannel(state.id);
    // An agent still on a task gets new messages through its inbox, never a second turn.
    let eligible = this.agentsFor(state.id);
    // A channel the main bot cannot see is private: only the agents whose own bot is in it can read or post there.
    if (state.mainBlind && state.heardFrom.size) eligible = eligible.filter((agent) => state.heardFrom.has(agent.id));
    if (!isWebRoom(state.id) && !isTelegramChannel(state.id) && !this.dmAgentId(state.id) && this.bots) {
      const access = await Promise.allSettled(eligible.map((agent) => this.bots.canRead(agent, state.id)));
      eligible = eligible.filter((agent, index) => access[index].status === "fulfilled" && access[index].value);
    }
    // A message that calls nobody is for nobody, except in a room or a DM of one agent.
    const direct = Boolean(roomAgentId(state.id) || this.dmAgentId(state.id));
    for (const [id, item] of state.humanQueue) {
      for (const recipient of item.addressed || []) {
        if (!eligible.some((agent) => agent.id === recipient)) this.acknowledge(state, recipient, [id]);
      }
      if (item.toOthers || (item.kind === "agent" && state.budget <= 0) || (!direct && !item.addressed?.length)
        || (item.addressed?.length && item.addressed.every((id) => item.handledBy?.includes(id)))) state.humanQueue.delete(id);
    }
    const agents = eligible.filter((agent) => !state.working.has(agent.id));
    if (!agents.length) return;
    const pending = [...state.humanQueue.values()];
    const queued = pending.find((item) => agents.some((agent) => (!item.addressed?.length || item.addressed.includes(agent.id)) && !item.handledBy?.includes(agent.id)));
    if (pending.length && !queued) return;
    const last = queued || state.history[state.history.length - 1];
    if (!last || last.passive) return;
    const { forced, optional } = this.pickCandidates(state, last, agents.filter((agent) => !this.brain.knowledge || this.brain.knowledge.acceptsMessage(agent, last, state.id)));
    if (!forced.length && !optional.length) return;

    const generation = state.generation;
    const channel = this.turnChannel(state.id);
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
      if (last.kind === "agent" && state.focus?.ids.includes(last.agentId) && !state.focus.ids.includes(agent.id)) {
        state.focus = { ...state.focus, ids: [...state.focus.ids, agent.id] };
        this.engagements[state.id] = state.focus;
        this.store.setValue("conversationEngagements", this.engagements);
      }
      try {
        return await work(agent, isForced);
      } finally {
        state.working.delete(agent.id);
      }
    };
    const work = async (agent, isForced) => {
      // An agent already working here receives steering, while a colleague gets its own worker.
      // Someone the owner authorized gets the computer the owner would: no "can I?" in between.
      const authorized = this.authorized(queued, agent, state);
      const mayUseComputer = queued ? queued.kind === "owner" || authorized || queued.delegated : state.ownerOrigin;
      const computer = Boolean(agent.tools && mayUseComputer && !this.threadWork.has(state.id, agent.id));
      this.acknowledge(state, agent.id, [...state.humanQueue.values()].filter((item) => item.id === queued?.id || snapshot.includes(item)).map((item) => item.id));
      const delegationAuthorized = queued ? queued.kind === "owner" || Boolean(queued.delegated) : state.ownerOrigin;
      const started = Date.now();
      if (computer) this.threadWork.set(state.id, agent.id);
      const say = (text, target = state.id, { voice = false, replyTo = queued, traceId } = {}) =>
        this.postDirect(agent, state, target, text, { voice, traceId, ...(target === state.id ? this.replyDelivery(replyTo) : {}), delegationAuthorized });
      // An agent at work shows it the way a person does: the typing indicator, kept alive
      // for as long as the turn lasts. Where the platform has none — Slack gives bots
      // nothing — it marks the message it took instead. No line in the channel either way.
      const working = this.showWorking(state, agent, last);
      let result;
      try {
        result = await this.brain.chatTurn({
          agent, history: snapshot, channel, forced: isForced, computer, authorized: authorized && computer, belongsTo: this.ownsAgent(queued, agent, state),
          computerDenied: Boolean(agent.tools && !mayUseComputer),
          replyTo: queued,
          postFile: (file, caption, { replyTo = queued, traceId } = {}) => this.postAs(agent, state, caption, file, traceId, { ...this.replyDelivery(replyTo), delegationAuthorized }),
          say,
          // Everything already in the channel when the turn starts is old news, not just what the prompt shows.
          inbox: this.inbox(state, state.history.slice()),
          onMessageHandled: (ids) => { this.acknowledge(state, agent.id, ids); },
        });
      } catch (error) {
        this.log({ type: "error", agentId: agent.id, channelId: state.id, text: error.message });
        if (isForced) result = { text: error.userMessage || `(non riesco a rispondere: ${error.message.slice(0, 180)})` };
        else return;
      } finally {
        working.stop();
        if (computer) this.threadWork.delete(state.id, agent.id);
      }
      if (!result.text) {
        this.acknowledge(state, agent.id, result.handledMessageIds || []);
        this.log({ type: "pass", agentId: agent.id, channelId: state.id, ms: Date.now() - started, traceId: result.traceId });
        return;
      }
      queue = queue.then(async () => {
        if (!isForced && (state.generation !== generation || postedOptional >= limitOptional)) return;
        if (!isForced && last.kind !== "owner" && last.kind !== "human" && state.budget <= 0) return;
        if (!isForced) postedOptional += 1;
        if (posted > 0) await sleep(700 + Math.random() * 1500);
        try {
          await this.postAs(agent, state, result.text, undefined, result.traceId, { ...this.replyDelivery(result.replyTo || queued), delegationAuthorized });
          this.acknowledge(state, agent.id, result.handledMessageIds || []);
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
    if (state.humanQueue.size) this.schedule(state, 300);
    else if (posted && state.budget > 0 && state.generation === generation) this.schedule(state, 2500 + Math.random() * 4000);
  }

  /**
   * A notice from Cora herself in a conversation (an artifact proposed or reviewed):
   * archived as passive, so it wakes nobody. A private conversation with an agent's
   * own bot has no voice of Cora's and gets nothing.
   */
  async notice(channelId, text) {
    const content = String(text || "").slice(0, 1500);
    if (!content || this.dmAgent.has(channelId)) return [];
    if (isWebRoom(channelId)) {
      const state = this.state(channelId);
      const item = { id: `web_${randomBytes(8).toString("hex")}`, at: Date.now(), authorId: null, authorName: "Cora", kind: "bot", content, passive: true };
      this.push(state, item);
      this.store.appendArchive(state.id, item);
      this.emit({ type: "web-message", room: state.id, item });
      return [item];
    }
    const chatId = telegramChatId(channelId);
    if (chatId) return (this.telegramClientFor(channelId) || this.telegram).say(chatId, { content, name: "Cora" });
    if (slackIds(channelId)) {
      const info = this.channels.info(channelId);
      return this.slack.say(info.channelId, { content, name: "Cora", threadTs: info.threadTs });
    }
    return this.discord.post(channelId, { username: "Cora", content });
  }

  /**
   * An agent called by name where it does not listen: Cora says so. On Discord the owner gets a
   * button that puts the agent to listen here, and the agent then answers what it was asked;
   * anywhere else, or if the button cannot be sent, the notice says where to do it in the panel.
   */
  async offerListening(state, item, now = Date.now()) {
    const english = this.store.settings.language === "en";
    for (const id of item.deaf || []) {
      const agent = this.store.agent(id);
      const key = `${state.id}:${id}`;
      if (!agent || (this.offered.get(key) || 0) > now - 30 * 60000) continue;
      this.offered.set(key, now);
      const transport = transportOf(state.id);
      const where = agent.channelIds.filter((channelId) => transportOf(channelId) === transport).map((channelId) => this.channelMeta(channelId)?.name).filter(Boolean).map((name) => `#${name}`);
      const link = this.instanceUrl ? `${this.instanceUrl}/#/agent/${agent.id}/profilo` : "";
      // Switched off on this whole platform, not just away from this channel.
      const away = agent.enabled && !this.channels.agentOn(agent, transport);
      const platform = TRANSPORT_LABELS[transport] || transport;
      const why = !agent.enabled
        ? (english ? `**${agent.name}** is switched off, so it cannot answer.` : `**${agent.name}** è spento, quindi non può rispondere.`)
        : away ? (english ? `**${agent.name}** is not on ${platform}.` : `**${agent.name}** non è su ${platform}.`)
        : (english ? `**${agent.name}** is not listening in this channel${where.length ? `: it answers in ${where.join(", ")}` : ""}.` : `**${agent.name}** non è in ascolto in questo canale${where.length ? `: risponde in ${where.join(", ")}` : ""}.`);
      if (agent.enabled && transport === "discord" && !this.dmAgentId(state.id)) {
        try {
          await this.discord.say(state.id, {
            content: `${why} ${english ? "The owner can put it to listen here:" : "Il proprietario può metterlo in ascolto qui:"}`,
            components: [{ type: 1, components: [{ type: 2, style: 1, label: (english ? `Let ${agent.name} listen here` : `Metti ${agent.name} in ascolto qui`).slice(0, 80), custom_id: `cora:listen:${agent.id}:${item.id}` }] }],
          });
          continue;
        } catch (error) {
          this.log({ type: "warning", channelId: state.id, text: `pulsante di ascolto non inviato: ${error.message}` });
        }
      }
      const how = !agent.enabled
        ? (english ? `Switch it on in the panel${link ? `: ${link}` : ""}.` : `Lo riaccendi dal pannello${link ? `: ${link}` : ""}.`)
        : away ? (english ? `To have it answer here, open it in the panel${link ? ` (${link})` : ""} and turn ${platform} on under Listening.` : `Per farlo rispondere qui aprilo nel pannello${link ? ` (${link})` : ""} e accendi ${platform} in Ascolto.`)
        : (english ? `To have it answer here, open it in the panel${link ? ` (${link})` : ""} and add this channel under Listening.` : `Per farlo rispondere qui aprilo nel pannello${link ? ` (${link})` : ""} e aggiungi questo canale in Ascolto.`);
      await this.notice(state.id, `${why} ${how}`);
    }
  }

  /** A button pressed on one of Cora's messages: only the owner may put an agent to listen. */
  async onInteraction(interaction) {
    const match = /^cora:listen:(ag_[a-f0-9]{12}):(\d+)$/.exec(String(interaction?.data?.custom_id || ""));
    if (!match) return;
    const english = this.store.settings.language === "en";
    const userId = interaction.member?.user?.id || interaction.user?.id || "";
    const channelId = String(interaction.channel_id || "");
    const agent = this.store.agent(match[1]);
    if (!this.isOwner(userId)) {
      return this.discord.answerInteraction(interaction, { content: english ? "Only Cora's owner can do that." : "Lo può fare solo il proprietario di Cora." });
    }
    if (!agent || !channelId) return this.discord.answerInteraction(interaction, { content: english ? "That agent is no longer here." : "Questo agente non c'è più." });
    const chosen = agent.channelIds.filter((id) => transportOf(id) === "discord");
    const listening = {
      // Away from Discord altogether, it comes back for this channel only.
      ...(agent.platformsOff.includes("discord") ? { platformsOff: agent.platformsOff.filter((kind) => kind !== "discord"), channelIds: [...new Set([...agent.channelIds, channelId])] } : {}),
      ...(chosen.length && !chosen.includes(channelId) ? { channelIds: [...new Set([...agent.channelIds, channelId])] } : {}),
    };
    if (Object.keys(listening).length) this.store.updateAgent(agent.id, { ...agent, ...listening });
    const who = interaction.member?.user?.global_name || interaction.member?.user?.username || interaction.user?.username || "";
    this.log({ type: "agent", agentId: agent.id, text: `${agent.name} ora ascolta ${this.channelMeta(channelId)?.name || channelId}${who ? ` (da Discord, ${who})` : ""}` });
    await this.discord.answerInteraction(interaction, { update: true, content: english ? `✅ **${agent.name}** is listening here now.` : `✅ **${agent.name}** ora è in ascolto qui.` });
    // The message that called it gets its answer now.
    const state = this.state(channelId);
    const item = state.history.find((entry) => entry.id === match[2]);
    if (item) {
      item.addressed = [...new Set([...(item.addressed || []), agent.id])];
      item.handledBy = (item.handledBy || []).filter((id) => id !== agent.id);
      state.focus = { ids: [...new Set([...(state.focus?.ids || []), agent.id])], at: Date.now(), remindedAt: 0, owner: true };
      this.engagements[state.id] = state.focus;
      this.store.setValue("conversationEngagements", this.engagements);
      state.humanQueue.set(item.id, item);
      state.ownerOrigin = item.kind === "owner";
      state.generation += 1;
      state.budget = this.store.settings.maxAgentTurns;
      this.schedule(state, 0);
    }
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
    const channel = name ? this.channels?.list().find((item) => ["discord", "slack"].includes(item.kind) && String(item.name).toLowerCase() === name) : null;
    this.log({ type: "settings", channelId: channel?.id, text: text.replace(/\*\*/g, "") });
    if (!channel) return;
    if (channel.kind === "slack") {
      await this.slack.say(this.channels.info(channel.id).channelId, { content: text, name: "Cora" });
      return;
    }
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
    if (Object.hasOwn(this.engagements, trace.channelId) && !this.engagements[trace.channelId]?.ids.includes(agent.id)) {
      this.store.saveTrace({ ...trace, status: "stopped", endedAt: new Date().toISOString(), error: "The agent was explicitly disengaged from this conversation." });
      return;
    }
    if (!isWebRoom(trace.channelId) && !isTelegramChannel(trace.channelId) && !this.dmAgentId(trace.channelId) && this.bots && !await this.bots.canRead(agent, trace.channelId)) {
      this.store.saveTrace({ ...trace, status: "stopped", endedAt: new Date().toISOString(), error: "The agent no longer has access to this channel." });
      this.log({ type: "warning", agentId: agent.id, channelId: trace.channelId, text: "Il lavoro non riparte: il bot dell'agente non ha accesso al canale." });
      return;
    }
    // Each interrupted thread picks up on its own: an agent working in three threads resumes all three.
    if (this.threadWork.has(trace.channelId, agent.id)) return;
    this.threadWork.set(trace.channelId, agent.id);
    const state = this.state(trace.channelId);
    state.working ??= new Set();
    state.working.add(agent.id);
    this.log({ type: "settings", agentId: agent.id, channelId: state.id, text: "riprende il lavoro interrotto dal riavvio" });
    let replyTo;
    try {
      await this.ensureHistory(state);
      replyTo = trace.steps?.findLast((step) => step.replyTo)?.replyTo
        || state.history.findLast((item) => ["human", "owner"].includes(item.kind) && item.at <= Date.parse(trace.startedAt));
      const english = this.store.settings.language === "en";
      await this.postAs(agent, state, english ? "Cora restarted while I was working: picking up where I left off." : "Cora si è riavviata mentre lavoravo: riprendo da dove ero.", undefined, undefined, this.replyDelivery(replyTo));
      const result = await this.brain.resumeTurn({
        agent, trace, channel: this.turnChannel(state.id), replyTo,
        postFile: (file, caption, options = {}) => this.postAs(agent, state, caption, file, options.traceId, this.replyDelivery(options.replyTo || replyTo)),
        say: (text, target = state.id, options = {}) => this.postDirect(agent, state, target, text, { ...options, ...(target === state.id ? this.replyDelivery(options.replyTo || replyTo) : {}) }),
        inbox: this.inbox(state, state.history), routine,
        onMessageHandled: (ids) => { this.acknowledge(state, agent.id, ids); },
      });
      if (result.text) await this.postAs(agent, state, result.text, undefined, result.traceId, this.replyDelivery(result.replyTo || replyTo));
      this.acknowledge(state, agent.id, result.handledMessageIds || []);
    } catch (error) {
      if (error.userMessage) await this.postAs(agent, state, error.userMessage, undefined, undefined, this.replyDelivery(replyTo)).catch(() => {});
      throw error;
    } finally {
      state.working.delete(agent.id);
      this.threadWork.delete(state.id, agent.id);
      if (state.humanQueue.size) this.schedule(state, 300);
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
        const own = this.telegramClientFor(channelId) || this.tgBots?.client(agent.id);
        if (own) own.typing(chatId);
        else shared = true;
      }
      if (shared) this.telegram.typing(chatId);
      return;
    }
    // Slack shows no typing indicator for a bot user, so there is nothing to send.
    if (isSlackChannel(channelId)) return;
    let shared = false;
    for (const agent of agents) {
      const own = this.bots?.client(agent.id);
      if (own) own.typing(channelId);
      else shared = true;
    }
    if (shared) this.discord.typing(channelId);
  }

  /**
   * Show that this agent is on it, in the way its home allows: the typing
   * indicator refreshed while the turn runs, or on Slack a mark on the message
   * that started it, taken back when the answer arrives.
   */
  showWorking(state, agent, item) {
    const slack = slackIds(state.id);
    if (slack) {
      const ts = String(item?.id || "").startsWith("sl_") ? String(item.id).split("_").pop() : "";
      const client = this.skBots?.client(agent.id) || this.slack;
      if (!ts || !client) return { stop() {} };
      client.react(slack.channelId, ts).catch(() => {});
      return { stop: () => client.unreact(slack.channelId, ts).catch(() => {}) };
    }
    const beat = () => this.typing(state.id, [agent]);
    beat();
    // Discord's indicator lasts about ten seconds, Telegram's about five.
    const timer = setInterval(beat, isTelegramChannel(state.id) ? 4000 : 7000);
    if (timer.unref) timer.unref();
    return { stop: () => clearInterval(timer) };
  }

  async postDirect(agent, current, target, text, options = {}) {
    if (!target || target === current.id) return this.postAs(agent, current, text, undefined, undefined, options);
    let info = this.channels.listFor(agent).find((channel) => channel.id === target);
    // A thread under a channel it may write to counts too, even one opened since the list was made.
    if (!info && transportOf(target) === "discord") info = await this.threadFor(agent, target);
    const allowed = target === (this.brain.knowledge?.ownerMemory ? ownerRoom(this.brain.knowledge.ownerId(agent)) : SALOTTO) || target === privateRoom(agent.id) || telegramBotAgent(target) === agent.id || Boolean(info);
    if (!allowed || !this.channels.isActive(target)) throw new Error("destination not authorized; use list_channels");
    const state = this.state(target);
    if (transportOf(target) === "discord") {
      if (!info?.guildId || !this.allowedGuild(info.guildId)) throw new Error("destination not authorized");
      const own = this.bots?.client(agent.id);
      await (own || this.discord).fetchMessages(target, 1);
    }
    return this.postAs(agent, state, text, undefined, undefined, { ...options, passive: true });
  }

  /**
   * A thread an agent may write in: under a channel it may write to. Looked up on Discord when the
   * cache does not have it yet (just opened, or archived), and remembered.
   */
  async threadFor(agent, threadId) {
    if (transportOf(threadId) !== "discord" || !/^\d{5,30}$/.test(String(threadId))) return null;
    const listed = this.channels.listFor(agent);
    const known = listed.find((channel) => channel.id === threadId);
    if (known) return known;
    let thread = null;
    try { thread = await this.discord.request("GET", `/channels/${threadId}`); } catch { return null; }
    if (![10, 11, 12].includes(thread?.type)) return null;
    const parent = listed.find((channel) => channel.id === thread.parent_id && !channel.thread);
    if (!parent || !this.allowedGuild(parent.guildId)) return null;
    this.discord.guilds?.get(parent.guildId)?.threads.set(thread.id, { ...thread, guild_id: parent.guildId });
    return { id: thread.id, name: thread.name, kind: "discord", guildId: parent.guildId, guildName: parent.guildName, thread: true, parentId: parent.id };
  }

  /**
   * A Discord thread an agent opens through Cora, under a channel it may write to (beside the
   * current thread when it is in one), by its own bot when that bot reads the channel.
   */
  async openThread(agent, currentId, { name, channelId = "" } = {}) {
    const title = String(name || "").trim().slice(0, 100);
    if (!title) throw new Error("the thread needs a name");
    const listed = this.channels.listFor(agent);
    let parentId = String(channelId || currentId || "");
    const here = listed.find((channel) => channel.id === parentId) || (transportOf(parentId) === "discord" ? await this.threadFor(agent, parentId) : null);
    if (here?.thread) parentId = here.parentId;
    const parent = listed.find((channel) => channel.id === parentId && !channel.thread);
    if (!parent || transportOf(parentId) !== "discord" || !this.allowedGuild(parent.guildId)) throw new Error("a thread opens only under a Discord channel from list_channels");
    const own = this.bots?.client(agent.id);
    const client = own && (await this.bots.canRead(agent, parentId).catch(() => false)) ? own : this.discord;
    const thread = await client.request("POST", `/channels/${parentId}/threads`, { body: { name: title, type: 11, auto_archive_duration: 10080 } });
    for (const cache of [this.discord, own]) cache?.guilds?.get(parent.guildId)?.threads.set(thread.id, { ...thread, guild_id: parent.guildId });
    this.log({ type: "message", agentId: agent.id, channelId: parentId, text: `${agent.name} ha aperto il thread «${thread.name}»` });
    return { id: thread.id, name: thread.name, kind: "discord", guildId: parent.guildId, thread: true, parentId };
  }

  learnPerson(space, id, names) {
    if (!space || !id) return;
    if (!this.knownPeople.has(space)) this.knownPeople.set(space, new Map());
    const people = this.knownPeople.get(space);
    if (!people.has(id)) people.set(id, new Set());
    for (const name of names) if (String(name || "").trim()) people.get(id).add(String(name).trim());
  }

  /**
   * Who a message in this channel can tag, name → id: the people who wrote in
   * this server's channels (in the whole workspace on Slack) or were tagged
   * there. Agents are tagged through their own bots instead, and a name two
   * people share tags nobody.
   */
  /**
   * The channel as an agent's turn sees it, with whom it can tag there: one name per person,
   * written as Cora turns it into a real mention, the owner first.
   */
  turnChannel(channelId) {
    const channel = this.channelMeta(channelId);
    const transport = transportOf(channelId);
    if (transport !== "discord" && transport !== "slack") return channel;
    const owners = new Set(transport === "slack" ? this.store.settings.slackOwnerIds : this.store.settings.ownerIds);
    const byId = new Map();
    for (const [name, id] of this.peopleFor({ id: channelId })) if (id && !byId.has(id)) byId.set(id, name);
    const people = [...byId].map(([id, name]) => ({ name, owner: owners.has(id) })).sort((a, b) => Number(b.owner) - Number(a.owner)).slice(0, 25);
    return { ...channel, people };
  }

  peopleFor(state) {
    const slack = transportOf(state.id) === "slack";
    const meta = this.channelMeta(state.id);
    const space = slack ? "slack" : meta.guildId;
    if (!space) return new Map();
    const channelIds = slack ? [] : [state.id, meta.parentId, ...this.channels.list().filter((channel) => channel.guildId === space).map((channel) => channel.id)];
    const found = this.store.people([...new Set(channelIds.filter(Boolean))], slack ? "sl:" : "").map((row) => [row.id, row.name]);
    for (const [id, names] of this.knownPeople.get(space) || []) for (const name of names) found.push([id, name]);
    const agents = new Set(this.store.agents().map((agent) => normalize(agent.name)));
    // By name as written in the chat, and by the same name in any case or accent: null when two people share it.
    const names = new Map();
    const ids = new Map();
    for (const [id, name] of found) {
      const key = normalize(name);
      if (agents.has(key)) continue;
      ids.set(key, ids.has(key) && ids.get(key) !== id ? null : id);
      names.set(name, key);
    }
    return new Map([...names].map(([name, key]) => [name, ids.get(key)]));
  }

  async discordMentions(agent, state, text) {
    const parts = String(text || "").split(/(```[\s\S]*?```|`[^`\n]*`)/g);
    for (const other of this.agentsFor(state.id)) {
      if (other.id === agent.id) continue;
      const id = this.bots?.client(other.id)?.user?.id;
      if (!id) continue;
      const name = other.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const tagged = new RegExp(`(^|[^\\p{L}\\p{N}_@.])@${name}(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}])`, "giu");
      if (!parts.some((part, index) => index % 2 === 0 && tagged.test(part))) continue;
      if (!await this.bots.canRead(other, state.id)) continue;
      for (let index = 0; index < parts.length; index += 2) {
        parts[index] = parts[index].replace(tagged, `$1<@${id}>`);
      }
    }
    if (parts.some((part, index) => index % 2 === 0 && part.includes("@"))) tagPeople(parts, this.peopleFor(state));
    return parts.join("");
  }

  replyDelivery(item) {
    return item?.voice ? { replyMode: ["text", "both"].includes(item.replyMode) ? item.replyMode : "voice", language: item.spokenIn || "" } : {};
  }

  async postAs(agent, state, text, file, traceId, { voice = false, replyMode, language = "", traceId: deliveryTraceId, ...options } = {}) {
    traceId ||= replyMode === "voice" ? deliveryTraceId : undefined;
    if (replyMode === "voice" && text) {
      const files = file ? await this.deliver(agent, state, "", file, traceId, options) : [];
      const spoken = await this.speak(agent, state, text, language, { ...options, archive: true, traceId });
      if (spoken.error) {
        state.voiceFailures ??= new Map();
        if (Date.now() - (state.voiceFailures.get(agent.id) || 0) > 60000) {
          state.voiceFailures.set(agent.id, Date.now());
          await this.deliver(agent, state, this.store.settings.language === "en" ? "I couldn't send the voice message. Please retry or ask for a written reply." : "Non riesco a inviare il vocale. Riprova oppure chiedimi una risposta scritta.", undefined, traceId, { passive: true });
        }
        throw new Error(`voice message not delivered: ${spoken.error}`);
      }
      const sent = [...files, ...spoken.messages];
      sent.voice = spoken;
      return sent;
    }
    const sent = await this.deliver(agent, state, text, file, traceId, options);
    if ((replyMode === "both" || (!replyMode && voice)) && text) sent.voice = await this.speak(agent, state, text, language);
    return sent;
  }

  async speak(agent, state, text, language = "", { archive = false, traceId, ...options } = {}) {
    if (!this.voice?.enabled) return { error: "Soniox is not connected: the owner adds its key in Settings → Connections" };
    const parts = speechParts(text);
    if (!parts.length) return { error: "nothing in this message can be said aloud" };
    try {
      const tongue = (VOICE_LANGUAGES.includes(language) && language) || agent.voiceLanguage || this.store.settings.language || "it";
      const voice = await this.voice.voiceFor(agent, tongue);
      const messages = [];
      for (const [index, part] of parts.entries()) {
        const note = await this.voice.voiceNote(part, { voice, language: tongue });
        const content = parts.length === 1 ? text : part;
        const metadata = { ...options, traceId, text: archive ? content : "", voiceOnly: archive, continuation: index > 0 };
        const sent = await this.postVoice(agent, state, note, metadata);
        if (!sent?.length) throw new Error("the platform returned no voice message");
        if (archive && !isWebRoom(state.id)) this.recordReply(agent, state, content, undefined, traceId, sent, { ...metadata, voiceOnly: true });
        messages.push(...sent);
        this.log({ type: "say", agentId: agent.id, channelId: state.id, traceId, text: `[vocale${note.duration ? ` ${Math.round(note.duration)}s` : ""}] ${part.slice(0, 200)}` });
      }
      return { messages };
    } catch (error) {
      this.log({ type: "error", agentId: agent.id, channelId: state.id, text: `voce: ${error.message}` });
      return { error: error.message };
    }
  }

  async postVoice(agent, state, note, { text = "", traceId, voiceOnly = false, ...options } = {}) {
    const clip = { name: this.store.settings.language === "en" ? "voice-message.mp3" : "messaggio-vocale.mp3", data: note.mp3, type: "audio/mpeg" };
    if (isWebRoom(state.id)) return this.postWeb(agent, state, text, clip, traceId, voiceOnly ? { ...options, voiceOnly } : { passive: true, silent: true });
    const chatId = telegramChatId(state.id);
    if (chatId) {
      const own = this.telegramClientFor(state.id) || this.tgBots?.client(agent.id);
      if (own && (telegramBotAgent(state.id) || !this.telegram.token || await this.tgBots.inChat(agent.id, chatId))) {
        try { return await own.voiceNote(chatId, note); }
        catch (error) { this.log({ type: "warning", agentId: agent.id, channelId: state.id, text: `vocale col bot Telegram suo: ${error.message}; lo mando col bot principale` }); }
      }
      return this.telegram.voiceNote(chatId, { ...note, name: agent.name });
    }
    if (slackIds(state.id)) {
      const info = this.channels.info(state.id);
      const own = this.skBots?.client(agent.id);
      if (own && (info.direct || await this.skBots.inChannel(agent.id, info.channelId))) return [await own.upload(info.channelId, clip, { threadTs: info.threadTs })];
      if (!this.slack?.user) throw new Error("no Slack app in this conversation");
      return [await this.slack.upload(info.channelId, clip, { threadTs: info.threadTs, name: agent.name, avatarUrl: agent.avatarUrl })];
    }
    // Discord: a real voice message needs the agent's own bot (webhooks cannot send one); otherwise an audio file.
    const own = this.bots?.client(agent.id);
    const shared = () => this.discord.post(state.id, { username: agent.name, avatarUrl: agent.avatarUrl, content: "", file: clip });
    if (!own) return shared();
    if (note.ogg) {
      try { return await own.voiceNote(state.id, note); }
      catch (error) { this.log({ type: "warning", agentId: agent.id, channelId: state.id, text: `vocale Discord: ${error.message}; lo mando come file audio` }); }
    }
    try { return await own.say(state.id, { content: "", file: clip }); }
    catch (error) {
      if (this.dmAgent.has(state.id) || state.mainBlind) throw error;
      return shared();
    }
  }

  async deliver(agent, state, text, file, traceId, { ping = "", request, passive = false, delegationAuthorized = false } = {}) {
    if (isWebRoom(state.id)) return this.postWeb(agent, state, text, file, traceId, { request, passive, delegationAuthorized });
    const chatId = telegramChatId(state.id);
    const slack = slackIds(state.id);
    // The ping (a mention of the owner) goes out with the message but stays out of the archive and the agents' transcripts.
    const body = chatId ? text || "" : slack ? await this.slackMentions(agent, state, text) : await this.discordMentions(agent, state, text);
    const content = ping && body ? `${ping} ${body}` : body;
    let sent;
    if (chatId) sent = await this.postTelegram(agent, chatId, content, file, state.id);
    else if (slack) sent = await this.postSlack(agent, state, content, file);
    else {
      const own = this.bots?.client(agent.id);
      const shared = () => this.discord.post(state.id, { username: agent.name, avatarUrl: agent.avatarUrl, content, file });
      if (!own) sent = await shared();
      else {
        try { sent = await own.say(state.id, { content, file }); }
        catch (error) {
          const channel = this.channelMeta(state.id);
          if (error.status !== 403 || error.sentCount || state.mainBlind || this.dmAgent.has(state.id) || !channel.guildId || !this.allowedGuild(channel.guildId)) throw error;
          await own.fetchMessages(state.id, 1);
          await this.discord.fetchMessages(state.id, 1);
          this.log({ type: "warning", agentId: agent.id, channelId: state.id, text: "Il bot dell'agente non può scrivere qui; rispondo con la sua identità tramite il bot principale autorizzato." });
          sent = await shared();
        }
      }
    }
    if (text) this.recordReply(agent, state, text, file, traceId, sent, { request, passive, delegationAuthorized });
    this.log({ type: "say", agentId: agent.id, channelId: state.id, text: (text || `[file ${file?.name}]`).slice(0, 500), file: file?.name, traceId });
    return sent;
  }

  recordReply(agent, state, text, file, traceId, sent, { request, passive = false, delegationAuthorized = false, voiceOnly = false, continuation = false } = {}) {
    const last = sent.at(-1);
    const chatId = telegramChatId(state.id);
    const slack = slackIds(state.id);
    if (text) {
      const item = {
        id: chatId && last?.message_id ? `tg_${chatId}_${last.message_id}`
          : slack && last?.ts ? `sl_${slack.channelId}_${last.ts}`
          : last?.id || `local_${Date.now()}`,
        at: Date.now(),
        authorId: null,
        authorName: agent.name,
        kind: "agent",
        agentId: agent.id,
        content: file ? `${text} [file: ${file.name}]` : text,
        traceId,
        request,
        passive,
        ...(voiceOnly ? { voiceOnly: true } : {}),
      };
      this.push(state, item);
      this.store.appendArchive(state.id, item);
      if (!passive && !continuation) {
        state.budget -= 1;
        this.queueColleagues(state, item, delegationAuthorized);
      }
    }
  }

  queueColleagues(state, item, authorized = false) {
    if (state.budget <= 0 || !state.focus?.ids.includes(item.agentId)) return;
    const called = this.agentsFor(state.id).filter((agent) => agent.id !== item.agentId && tagged(item.content, agent.name));
    if (!called.length) return;
    item.addressed = called.map((agent) => agent.id);
    item.delegated = authorized;
    state.humanQueue.set(item.id, item);
    this.schedule(state, 300);
  }

  /** An agent naming another one turns into a real Slack mention, so that agent is pinged. */
  async slackMentions(agent, state, text) {
    const parts = String(text || "").split(/(```[\s\S]*?```|`[^`\n]*`)/g);
    const info = this.channels.info(state.id);
    for (const other of this.agentsFor(state.id)) {
      if (other.id === agent.id) continue;
      const id = this.skBots?.client(other.id)?.user?.id;
      if (!id || !(await this.skBots.inChannel(other.id, info.channelId))) continue;
      const name = other.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const tagged = new RegExp(`(^|[^\\p{L}\\p{N}_@.])@${name}(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}])`, "giu");
      for (let index = 0; index < parts.length; index += 2) {
        parts[index] = parts[index].replace(tagged, `$1<@${id}>`);
      }
    }
    if (parts.some((part, index) => index % 2 === 0 && part.includes("@"))) tagPeople(parts, this.peopleFor(state));
    return parts.join("");
  }

  /** As the agent's own Slack app when it is in the conversation, otherwise through the main app with its name and avatar. */
  async postSlack(agent, state, text, file) {
    const info = this.channels.info(state.id);
    const payload = { content: text || "", file, threadTs: info.threadTs };
    const own = this.skBots?.client(agent.id);
    if (own && (info.direct || await this.skBots.inChannel(agent.id, info.channelId))) {
      try {
        return await own.say(info.channelId, payload);
      } catch (error) {
        if (error.sentCount || info.direct) throw error;
        this.skBots.forgetMembership(agent.id);
        this.log({ type: "warning", agentId: agent.id, channelId: state.id, text: `app Slack sua: ${error.message}; scrivo con l'app principale` });
      }
    }
    if (!this.slack?.user) throw new Error("no Slack app in this conversation");
    return this.slack.say(info.channelId, { ...payload, name: agent.name, avatarUrl: agent.avatarUrl });
  }

  /** As the agent's own Telegram bot when it is in the chat, otherwise through the main bot with its name on top. */
  /** The bot a Telegram chat is answered through: an agent's own private chat only by that bot. */
  telegramClientFor(channelId) {
    const privateBot = telegramBotAgent(channelId);
    return privateBot ? this.tgBots?.client(privateBot) || null : null;
  }

  async postTelegram(agent, chatId, text, file, channelId = "") {
    if (telegramBotAgent(channelId)) {
      const bot = this.telegramClientFor(channelId);
      if (!bot) throw new Error("il bot Telegram di questo agente non è collegato");
      return bot.say(chatId, { content: text || "", file });
    }
    const own = this.tgBots?.client(agent.id);
    // Without a main bot, an agent's own bot is the only voice there is.
    const main = Boolean(this.telegram.token);
    if (own && (!main || await this.tgBots.inChat(agent.id, chatId))) {
      try {
        return await own.say(chatId, { content: text || "", file });
      } catch (error) {
        if (!main) throw error;
        this.tgBots.forgetMembership(agent.id);
        this.log({ type: "warning", agentId: agent.id, channelId: telegramChannel(chatId), text: `bot Telegram suo: ${error.message}; scrivo col bot principale` });
      }
    }
    return this.telegram.say(chatId, { content: text || "", file, name: agent.name });
  }

  /** A message in a panel room: archived like a Discord one and pushed live to the panel. */
  postWeb(agent, state, text, file, traceId, { request, passive = false, silent = false, delegationAuthorized = false, voiceOnly = false, continuation = false } = {}) {
    const item = {
      id: `web_${randomBytes(8).toString("hex")}`,
      at: Date.now(),
      authorId: null,
      authorName: agent.name,
      kind: "agent",
      agentId: agent.id,
      content: file ? `${text || ""} [file: ${file.name}]`.trim() : text,
      traceId,
      file: file ? this.saveWebFile(file, agent) : undefined,
      request,
      passive,
      ...(voiceOnly ? { voiceOnly: true } : {}),
    };
    this.push(state, item);
    this.store.appendArchive(state.id, item);
    if (text && !passive && !continuation) {
      state.budget -= 1;
      this.queueColleagues(state, item, delegationAuthorized);
    }
    this.emit({ type: "web-message", room: state.id, item });
    this.log({ type: "say", agentId: agent.id, channelId: state.id, text: (text || `[file ${file?.name}]`).slice(0, 500), file: file?.name, traceId });
    // Nobody has the panel open: the reply reaches the owner's phone.
    if (this.notifier?.enabled && !this.watching() && !item.request && !silent) {
      const url = isSalotto(state.id) ? "/#/salotto" : `/#/agent/${agent.id}/chat`;
      this.notifier.notify({ userId: this.memoryOwner?.(agent) || "", title: agent.name, body: voiceOnly ? `🎙 ${file?.name}` : text || `📎 ${file?.name}`, url, tag: state.id }).catch(() => {});
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
  async askOwner(agent, { question, choices = [] }, { channelId, replyTo, traceId } = {}) {
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
      [item] = await this.postAs(agent, state, text, undefined, traceId, { request, ...this.replyDelivery(replyTo) });
      this.emit({ type: "request", agentId: agent.id });
      if (this.notifier?.enabled) {
        const url = isSalotto(state.id) ? "/#/salotto" : `/#/agent/${agent.id}/chat`;
        this.notifier.notify({ userId: this.memoryOwner?.(agent) || "", title: english ? `${agent.name} asks you` : `${agent.name} ti chiede`, body: replyTo?.voice && replyTo.replyMode !== "text" && replyTo.replyMode !== "both" ? (english ? "Voice message" : "Messaggio vocale") : text, url, tag: `request-${agent.id}` }).catch(() => {});
      }
    } else {
      const slack = slackIds(state.id);
      // An agent asks the person it belongs to when they are in this chat, the owner otherwise.
      const transport = transportOf(state.id);
      const own = this.store.agentOwnerChats(agent).find((id) => id.startsWith(`${transport}:`))?.slice(transport.length + 1);
      const owner = own || (slack ? this.store.settings.slackOwnerIds[0] : !telegramChatId(state.id) && this.store.settings.ownerIds[0]);
      const body = clean.length ? `${text}\n${english ? "Answers" : "Risposte"}: ${clean.join(" · ")}` : text;
      await this.postAs(agent, state, body, undefined, traceId, { ping: owner ? `<@${owner}>` : "", request, ...this.replyDelivery(replyTo) });
      item = state.history.findLast((entry) => entry.agentId === agent.id && entry.request === request);
    }
    state.request = { agentId: agent.id, at: Date.now() };
    this.log({ type: "request", agentId: agent.id, channelId: state.id, text: text.slice(0, 300) });
    return { id: item?.id, where: this.channels?.label(state.id) || state.id, here: Boolean(here) };
  }

  saveWebFile(file, agent = null) {
    if (!this.filesDir) return undefined;
    mkdirSync(this.filesDir, { recursive: true, mode: 0o700 });
    const id = randomBytes(12).toString("hex");
    const name = String(file.name || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    writeFileSync(join(this.filesDir, id), file.data, { mode: 0o600 });
    writeFileSync(join(this.filesDir, `${id}.json`), JSON.stringify({ name, type: file.type || "application/octet-stream", ...(this.memoryOwner && agent ? { ownerId: this.memoryOwner(agent) } : {}) }), { mode: 0o600 });
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
    await this.ingest(state, item);
    this.emit({ type: "web-message", room, item });
    this.schedule(state, 400);
    return item;
  }

  async runEmail(agent, email, channel) {
    if (this.threadWork.has(channel.id)) return "busy";
    this.threadWork.set(channel.id, agent.id);
    const state = this.state(channel.id);
    state.working ??= new Set();
    state.working.add(agent.id);
    this.email.status(agent, email, "working", channel.id);
    try {
      const result = await this.brain.emailTurn({ agent, email, channel,
        say: (text, target = channel.id, options = {}) => this.postDirect(agent, state, target, text, { ...options, passive: true }),
        inbox: this.inbox(state, state.history),
        onMessageHandled: (ids) => this.acknowledge(state, agent.id, ids),
      });
      if (result.text && result.text !== "PASS") await this.postAs(agent, state, result.text, undefined, result.traceId, { passive: true });
      this.email.status(agent, email, result.stopped ? "stopped" : "processed", channel.id);
      return "processed";
    } catch (error) {
      this.email.status(agent, email, "error", channel.id);
      this.log({ type: "error", agentId: agent.id, channelId: channel.id, text: "Email processing failed." });
      return "error";
    } finally {
      state.working.delete(agent.id);
      this.threadWork.delete(channel.id, agent.id);
      if (state.humanQueue.size) this.schedule(state, 300);
    }
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
    const channel = this.turnChannel(routine.channelId);
    if (!this.channels.isActive(routine.channelId)) {
      this.store.recordRoutineRun(routine.id, "error", `il canale è su ${TRANSPORT_LABELS[transportOf(routine.channelId)]}, ma ora Cora vive altrove`, { runId: pendingRun?.id });
      return { status: "error" };
    }
    if (channel.guildId && !this.allowedGuild(channel.guildId)) {
      this.store.recordRoutineRun(routine.id, "error", "channel is in a server cora does not use", { runId: pendingRun?.id });
      return { status: "error" };
    }
    if (!isWebRoom(routine.channelId) && !isTelegramChannel(routine.channelId) && !this.dmAgentId(routine.channelId) && this.bots && !await this.bots.canRead(agent, routine.channelId)) {
      this.store.recordRoutineRun(routine.id, "blocked", "Il bot dell'agente non ha accesso a questo canale.", { runId: pendingRun?.id });
      return { status: "blocked" };
    }
    if (this.store.routine(routine.id)?.updatedAt !== routine.updatedAt) return { status: "stopped" };
    // One task per thread: a routine that lands on a thread already at work waits for its next
    // turn instead of opening a second session on the same work. Other threads do not matter.
    const busyWith = this.threadWork.has(routine.channelId) ? "un compito già attivo in questo thread" : null;
    if (busyWith) {
      this.store.recordRoutineRun(routine.id, "skipped", `saltata: stava già lavorando a ${busyWith}`);
      this.log({ type: "routine-skip", agentId: agent.id, channelId: routine.channelId, text: `${routine.name}: stava già lavorando` });
      return { status: "busy" };
    }
    const snapshot = { ...routine };
    const run = this.store.beginRoutineRun(routine, { manual, resumeRunId });
    if (!run) return { status: "busy" };
    this.routineRuns.add(routine.id);
    this.threadWork.set(routine.channelId, agent.id);
    this.log({ type: "routine-start", agentId: agent.id, channelId: routine.channelId, text: routine.name, manual });
    const state = this.state(routine.channelId);
    state.working ??= new Set();
    state.working.add(agent.id);

    const typing = setInterval(() => this.typing(routine.channelId, [agent]), 8000);
    try {
      await this.ensureHistory(state);
      const result = await this.brain[resumeTrace ? "resumeTurn" : "routineTurn"]({
        agent, routine: snapshot, history: state.history, channel, trace: resumeTrace,
        replyTo: resumeTrace?.steps?.findLast((step) => step.replyTo)?.replyTo,
        postFile: (file, caption, { replyTo, traceId } = {}) => this.postAs(agent, state, caption, file, traceId, { passive: true, ...this.replyDelivery(replyTo) }),
        say: (text, target = state.id, { voice = false, replyTo, traceId } = {}) => this.postDirect(agent, state, target, text, { passive: true, voice, traceId, ...(target === state.id ? this.replyDelivery(replyTo) : {}) }),
        inbox: this.inbox(state, state.history),
        onTrace: (traceId) => this.store.attachRoutineTrace(run.id, traceId),
        onMessageHandled: (ids) => { this.acknowledge(state, agent.id, ids); },
      });
      if (result.text) {
        await this.postAs(agent, state, result.text, undefined, result.traceId, { passive: true, ...this.replyDelivery(result.replyTo) });
      }
      this.acknowledge(state, agent.id, result.handledMessageIds || []);
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
        ? `Reminder kept open: ${verification.reason || "success has not been verified."}` : `Reminder non archiviato: ${verification.reason || "il successo non è stato verificato."}`, undefined, undefined, { passive: true });
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
      this.threadWork.delete(routine.channelId, agent.id);
      if (state.humanQueue.size) this.schedule(state, 300);
    }
  }
}
