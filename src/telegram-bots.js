import { agentSlug } from "./agent-bots.js";
import { ValidationError } from "./store.js";
import { Telegram } from "./telegram.js";

const MEMBERSHIP_TTL_MS = 60000;

/** The hush secret (and environment variable) holding an agent's own Telegram bot token. */
export function telegramBotEnvName(agent) {
  return `CORA_TG_BOT_${agentSlug(agent)}`;
}

/**
 * Agents' own Telegram bots. They only send: Telegram never shows a bot the
 * messages of other bots, and listening stays on the main bot anyway.
 */
export class TelegramBots {
  constructor({ store, apiBase, tokenFor = (name) => process.env[name] || "", log }) {
    this.store = store;
    this.apiBase = apiBase;
    this.tokenFor = tokenFor;
    this.log = log;
    this.clients = new Map();
    this.added = new Map();
    this.membership = new Map();
    this.active = false;
  }

  token(agent) {
    const env = telegramBotEnvName(agent);
    return this.added.get(env) || this.tokenFor(env);
  }

  sync() {
    if (!this.active) return;
    const wanted = new Map();
    for (const agent of this.store.agents()) {
      const token = this.token(agent);
      if (agent.enabled && token) wanted.set(agent.id, { agent, token });
    }
    for (const [agentId, entry] of this.clients) {
      if (wanted.get(agentId)?.token !== entry.token) this.clients.delete(agentId);
    }
    for (const [agentId, { agent, token }] of wanted) {
      const entry = this.clients.get(agentId);
      if (entry) {
        this.syncName(agent, entry);
        continue;
      }
      const client = new Telegram({ token, apiBase: this.apiBase });
      const fresh = { client, token, user: null, error: "", named: "" };
      this.clients.set(agentId, fresh);
      client.request("getMe")
        .then((user) => {
          if (this.clients.get(agentId) !== fresh) return;
          fresh.user = user;
          this.log?.({ type: "telegram", agentId, text: `bot Telegram collegato come @${user.username}` });
          this.syncName(this.store.agent(agentId), fresh);
        })
        .catch((error) => {
          fresh.error = error.status === 401 || error.status === 404 ? "Telegram rifiuta il token" : error.message;
          this.log?.({ type: "error", agentId, text: `bot Telegram: ${fresh.error}` });
        });
    }
  }

  /** The bot's display name follows the panel (the photo can only be set in BotFather). */
  syncName(agent, entry) {
    if (!agent || !entry.user || entry.named === agent.name || entry.user.first_name === agent.name) return;
    entry.named = agent.name;
    entry.client.request("setMyName", { name: agent.name })
      .then(() => this.log?.({ type: "telegram", agentId: agent.id, text: "nome del bot Telegram aggiornato" }))
      .catch((error) => this.log?.({ type: "warning", agentId: agent.id, text: `nome del bot Telegram: ${error.message}` }));
  }

  start() {
    this.active = true;
    this.sync();
  }

  stop() {
    this.active = false;
    this.clients.clear();
  }

  client(agentId) {
    const entry = this.clients.get(agentId);
    return entry?.user ? entry.client : null;
  }

  agentIdForUser(userId) {
    for (const [agentId, entry] of this.clients) if (String(entry.user?.id) === String(userId)) return agentId;
    return null;
  }

  agentIdForUsername(username) {
    const wanted = String(username || "").replace(/^@/, "").toLowerCase();
    for (const [agentId, entry] of this.clients) if (entry.user?.username?.toLowerCase() === wanted) return agentId;
    return null;
  }

  async verify(agent, token, { mainUserId } = {}) {
    let user;
    try {
      user = await new Telegram({ token, apiBase: this.apiBase }).request("getMe");
    } catch (error) {
      if (error.status === 401 || error.status === 404) throw new ValidationError("Telegram rifiuta questo token: copialo di nuovo da BotFather");
      throw error;
    }
    if (!user?.is_bot) throw new ValidationError("questo token non è di un bot");
    if (String(user.id) === String(mainUserId)) throw new ValidationError("questo è il bot principale: per l'agente serve un bot suo, creato con /newbot");
    const owner = this.agentIdForUser(user.id);
    if (owner && owner !== agent.id) throw new ValidationError("questo bot è già collegato a un altro agente");
    return user;
  }

  /** Use a token stored while running and wait for the bot to answer. */
  async attach(agent, token, timeoutMs = 8000) {
    this.added.set(telegramBotEnvName(agent), token);
    if (!this.active) return null;
    this.sync();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !this.client(agent.id) && !this.clients.get(agent.id)?.error) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return this.client(agent.id);
  }

  /** Whether the agent's bot is in the chat, cached for a minute. */
  async inChat(agentId, chatId) {
    const entry = this.clients.get(agentId);
    if (!entry?.user || !chatId) return false;
    const key = `${agentId}:${chatId}`;
    const cached = this.membership.get(key);
    if (cached && Date.now() - cached.at < MEMBERSHIP_TTL_MS) return cached.value;
    let value = false;
    try {
      const member = await entry.client.request("getChatMember", { chat_id: chatId, user_id: entry.user.id }, { timeoutMs: 5000 });
      value = !["left", "kicked"].includes(member?.status);
    } catch {}
    this.membership.set(key, { at: Date.now(), value });
    return value;
  }

  forgetMembership(agentId) {
    for (const key of this.membership.keys()) if (key.startsWith(`${agentId}:`)) this.membership.delete(key);
  }

  async status(agent, chatId) {
    const env = telegramBotEnvName(agent);
    const entry = this.clients.get(agent.id);
    if (!entry) return { env, configured: Boolean(this.token(agent)), state: this.token(agent) ? "off" : "missing-token" };
    const user = entry.user;
    return {
      env,
      configured: true,
      state: user ? "ready" : entry.error ? "error" : "connecting",
      error: entry.error,
      user: user ? { id: String(user.id), username: user.username, name: user.first_name } : null,
      link: user ? `https://t.me/${user.username}` : null,
      inChat: user ? await this.inChat(agent.id, chatId) : false,
    };
  }
}
