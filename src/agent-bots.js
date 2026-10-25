import { Discord, PRESENCE_INTENTS } from "./discord.js";
import { ValidationError } from "./store.js";

// Application flags meaning the Message Content intent is on (the limited one is for unverified apps).
const MESSAGE_CONTENT_FLAGS = (1 << 18) | (1 << 19);

// View channels, send messages, embed links, attach files, read history, add reactions.
const INVITE_PERMISSIONS = 1024 + 2048 + 16384 + 32768 + 65536 + 64;

export function agentSlug(agent) {
  const slug = String(agent.name).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug || agent.id.toUpperCase();
}

/** The hush secret (and environment variable) holding an agent's own bot token: CORA_BOT_<NAME>. */
export function botEnvName(agent) {
  return `CORA_BOT_${agentSlug(agent)}`;
}

export function inviteUrl(applicationId, guildId) {
  const query = new URLSearchParams({ client_id: applicationId, scope: "bot", permissions: String(INVITE_PERMISSIONS) });
  if (guildId) {
    query.set("guild_id", guildId);
    query.set("disable_guild_select", "true");
  }
  return `https://discord.com/oauth2/authorize?${query}`;
}

/**
 * One Discord connection per agent that has its own bot token. These
 * connections only keep the bot online and post as it; listening stays on the
 * main connection, so every message is handled once.
 */
export class AgentBots {
  constructor({ store, apiBase, gatewayUrl = "", tokenFor = (name) => process.env[name] || "", log }) {
    this.store = store;
    this.apiBase = apiBase;
    this.gatewayUrl = gatewayUrl;
    this.tokenFor = tokenFor;
    this.log = log;
    this.clients = new Map();
    this.synced = new Map();
    this.added = new Map();
    this.active = true;
    this.onChange = null;
  }

  /**
   * The bot cora listens with when no dedicated listening bot is configured:
   * the first agent's own bot whose app has the Message Content intent on.
   */
  listener() {
    for (const agent of this.store.agents()) {
      const entry = this.clients.get(agent.id);
      if (entry?.client.user && entry.messageContent) return { agentId: agent.id, token: entry.token, user: entry.client.user };
    }
    return null;
  }

  /** Read the app's flags (is Message Content on?) and tell cora when it changed. */
  async readFlags(agentId) {
    const entry = this.clients.get(agentId);
    if (!entry) return;
    try {
      const app = await entry.client.request("GET", "/applications/@me");
      const on = Boolean((app?.flags || 0) & MESSAGE_CONTENT_FLAGS);
      if (on !== entry.messageContent) {
        entry.messageContent = on;
        this.onChange?.();
      }
    } catch {}
  }

  start() {
    this.active = true;
    this.sync();
  }

  token(agent) {
    const env = botEnvName(agent);
    return this.added.get(env) || this.tokenFor(env);
  }

  /** Check a pasted token with Discord: it must be a bot, not the main one and not another agent's. */
  async verify(agent, token, { mainUserId } = {}) {
    let user;
    try {
      user = await new Discord({ token, apiBase: this.apiBase }).request("GET", "/users/@me");
    } catch (error) {
      if (error.status === 401) throw new ValidationError("Discord rifiuta questo token: rifai Reset Token e incolla quello nuovo");
      throw error;
    }
    if (!user?.bot) throw new ValidationError("questo token non è di un bot");
    if (user.id === mainUserId) throw new ValidationError("questo è il token del bot principale: serve quello di un'applicazione nuova");
    const owner = this.agentIdForUser(user.id);
    if (owner && owner !== agent.id) throw new ValidationError("questo bot è già collegato a un altro agente");
    return user;
  }

  /** Use a token stored while running (the next start reads it from hush) and wait for the bot to come online. */
  async attach(agent, token, timeoutMs = 10000) {
    this.added.set(botEnvName(agent), token);
    this.sync();
    const deadline = Date.now() + timeoutMs;
    let readyAt = 0;
    while (Date.now() < deadline) {
      const client = this.client(agent.id);
      if (client) {
        readyAt ||= Date.now();
        if (client.guilds.size || Date.now() - readyAt > 2000) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return this.client(agent.id);
  }

  sync() {
    if (!this.active) return;
    const wanted = new Map();
    for (const agent of this.store.agents()) {
      const token = this.token(agent);
      if (agent.enabled && token) wanted.set(agent.id, { agent, token });
    }
    for (const [agentId, entry] of this.clients) {
      const next = wanted.get(agentId);
      if (!next || next.token !== entry.token) {
        entry.client.stop();
        this.clients.delete(agentId);
      }
    }
    for (const [agentId, { agent, token }] of wanted) {
      if (this.clients.has(agentId)) {
        this.syncProfile(agent);
        if (!this.clients.get(agentId).messageContent) this.readFlags(agentId);
        continue;
      }
      const client = new Discord({ token, apiBase: this.apiBase, gatewayUrl: this.gatewayUrl, intents: PRESENCE_INTENTS });
      client.on("ready", () => {
        this.log?.({ type: "discord", agentId, text: `bot collegato come ${client.user?.username}` });
        this.syncProfile(this.store.agent(agentId));
        this.readFlags(agentId);
      });
      client.on("status", (status) => {
        if (status.state === "error") this.log?.({ type: "error", agentId, text: `bot Discord: ${status.error}` });
      });
      this.clients.set(agentId, { client, token, messageContent: false });
      client.start();
    }
  }

  /** Name and avatar follow the panel; retried only when they change. */
  syncProfile(agent) {
    const entry = agent && this.clients.get(agent.id);
    if (!entry?.client.user) return;
    const key = `${agent.name}|${agent.avatarUrl}`;
    if (this.synced.get(agent.id) === key) return;
    this.synced.set(agent.id, key);
    entry.client.syncProfile({ username: agent.name, avatarUrl: agent.avatarUrl })
      .then((user) => { if (user) this.log?.({ type: "discord", agentId: agent.id, text: "profilo del bot aggiornato" }); })
      .catch((error) => this.log?.({ type: "warning", agentId: agent.id, text: `profilo del bot: ${error.message}` }));
  }

  stop() {
    this.active = false;
    for (const { client } of this.clients.values()) client.stop();
    this.clients.clear();
    this.synced.clear();
  }

  /** The agent's own client, once it is connected. */
  client(agentId) {
    const entry = this.clients.get(agentId);
    return entry?.client.user ? entry.client : null;
  }

  agentIdForUser(userId) {
    for (const [agentId, { client }] of this.clients) {
      if (client.user?.id === userId) return agentId;
    }
    return null;
  }

  isOwnMessage(message) {
    for (const { client } of this.clients.values()) if (client.isOwnMessage(message)) return true;
    return false;
  }

  status(agent, guildId) {
    const env = botEnvName(agent);
    const entry = this.clients.get(agent.id);
    if (!entry) return { env, configured: false, state: "missing-token" };
    const user = entry.client.user;
    return {
      env,
      configured: true,
      messageContent: Boolean(entry.messageContent),
      state: entry.client.state,
      error: entry.client.lastError,
      user: user ? { id: user.id, username: user.username } : null,
      inviteUrl: user ? inviteUrl(user.id, guildId) : null,
      inGuild: user ? [...entry.client.guilds.keys()].includes(guildId) : false,
    };
  }
}
