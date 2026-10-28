import { agentSlug } from "./agent-bots.js";
import { Slack, isDirectChannel } from "./slack.js";
import { ValidationError } from "./store.js";

const MEMBERSHIP_TTL_MS = 60000;

/** What an agent's app may do: read its channels, write as itself, exchange files. */
export const BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "chat:write",
  "chat:write.customize",
  "files:read",
  "files:write",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "im:write",
  "mpim:history",
  "mpim:read",
  "reactions:write",
  "users:read",
];

export const BOT_EVENTS = ["app_mention", "message.channels", "message.groups", "message.im", "message.mpim", "member_joined_channel"];

/** The hush secrets (and environment variables) holding an agent's own Slack tokens. */
export function slackBotEnvName(agent) {
  return `CORA_SK_BOT_${agentSlug(agent)}`;
}

export function slackAppEnvName(agent) {
  return `CORA_SK_APP_${agentSlug(agent)}`;
}

/**
 * The manifest that creates this agent's Slack app in one paste: Socket Mode
 * on (no public URL), the scopes above, and the agent's own name, which is
 * the only place Slack takes a bot's name from.
 */
export function appManifest(agent) {
  return {
    display_information: {
      name: agent.name,
      description: (String(agent.personality || "").split("\n")[0] || `${agent.name}, agente di Cora`).slice(0, 140),
    },
    features: {
      bot_user: { display_name: agent.name, always_online: true },
      app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
    },
    oauth_config: { scopes: { bot: BOT_SCOPES } },
    settings: {
      event_subscriptions: { bot_events: BOT_EVENTS },
      interactivity: { is_enabled: false },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  };
}

/**
 * One Slack app per agent: each is a real bot user, so people mention it and
 * write to it directly. Every app listens on its own socket, and a channel is
 * heard as long as one of them is in it; repeats are dropped by message id.
 */
export class SlackBots {
  constructor({ store, apiBase, tokenFor = (name) => process.env[name] || "", log, onDirect = null, onGuild = null }) {
    this.store = store;
    this.apiBase = apiBase;
    this.tokenFor = tokenFor;
    this.log = log;
    this.onDirect = onDirect;
    this.onGuild = onGuild;
    this.clients = new Map();
    this.added = new Map();
    this.membership = new Map();
    this.active = false;
  }

  tokens(agent) {
    const botEnv = slackBotEnvName(agent);
    const appEnv = slackAppEnvName(agent);
    return {
      botToken: this.added.get(botEnv) || this.tokenFor(botEnv),
      appToken: this.added.get(appEnv) || this.tokenFor(appEnv),
    };
  }

  start() {
    this.active = true;
    this.sync();
  }

  stop() {
    this.active = false;
    for (const entry of this.clients.values()) entry.client.stop();
    this.clients.clear();
    this.membership.clear();
  }

  sync() {
    if (!this.active) return;
    const wanted = new Map();
    for (const agent of this.store.agents()) {
      const { botToken, appToken } = this.tokens(agent);
      if (agent.enabled && botToken && appToken) wanted.set(agent.id, { agent, botToken, appToken });
    }
    for (const [agentId, entry] of this.clients) {
      const next = wanted.get(agentId);
      if (!next || next.botToken !== entry.botToken || next.appToken !== entry.appToken) {
        entry.client.stop();
        this.clients.delete(agentId);
        this.forgetMembership(agentId);
      }
    }
    for (const [agentId, { botToken, appToken }] of wanted) {
      if (this.clients.has(agentId)) continue;
      const client = new Slack({ botToken, appToken, apiBase: this.apiBase });
      const entry = { client, botToken, appToken, error: "" };
      this.clients.set(agentId, entry);
      client.on("message", (event) => {
        if (event.channel_type === "im") this.onDirect?.(agentId, event);
        else this.onGuild?.(event, agentId);
      });
      client.on("ready", () => {
        this.log?.({ type: "slack", agentId, text: `app Slack collegata come @${client.user?.name}` });
        client.listChannels().catch(() => {});
      });
      client.on("joined", () => this.forgetMembership(agentId));
      client.on("status", (status) => {
        if (status.state === "error") {
          entry.error = status.error;
          this.log?.({ type: "error", agentId, text: `app Slack: ${status.error}` });
        }
      });
      client.start();
    }
  }

  client(agentId) {
    const entry = this.clients.get(agentId);
    return entry?.client.user ? entry.client : null;
  }

  agentIdForUser(userId) {
    for (const [agentId, { client }] of this.clients) if (client.user?.id === userId) return agentId;
    return null;
  }

  agentIdForBot(botId) {
    for (const [agentId, { client }] of this.clients) if (botId && client.user?.botId === botId) return agentId;
    return null;
  }

  isOwnMessage(event) {
    for (const { client } of this.clients.values()) if (client.isOwnMessage(event)) return true;
    return false;
  }

  /** Check a pasted pair: a bot of its own, in the right workspace, not already taken. */
  async verify(agent, { botToken, appToken, teamId = "", mainUserId = "" }) {
    const client = new Slack({ botToken, appToken, apiBase: this.apiBase });
    let user;
    try {
      user = await client.identity();
    } catch (error) {
      if (error.slack) throw new ValidationError("Slack rifiuta il token del bot: copialo di nuovo da OAuth & Permissions");
      throw error;
    }
    if (!user?.botId) throw new ValidationError("questo token non è di un bot: serve quello che comincia con xoxb-");
    if (mainUserId && user.id === mainUserId) throw new ValidationError("questo è il token dell'app principale: ogni agente ha la sua app");
    if (teamId && client.team?.id !== teamId) throw new ValidationError("questa app è di un altro workspace Slack");
    const owner = this.agentIdForUser(user.id);
    if (owner && owner !== agent.id) throw new ValidationError("questa app Slack è già collegata a un altro agente");
    try {
      await client.request("apps.connections.open", {}, { auth: "app" });
    } catch (error) {
      if (error.slack) throw new ValidationError("il token a livello app non apre il Socket Mode: serve quello xapp- con lo scope connections:write");
      throw error;
    }
    return { user, team: client.team };
  }

  /** Use tokens stored while running and wait for the app to answer. */
  async attach(agent, { botToken, appToken }, timeoutMs = 10000) {
    this.added.set(slackBotEnvName(agent), botToken);
    this.added.set(slackAppEnvName(agent), appToken);
    if (!this.active) return null;
    this.sync();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !this.client(agent.id) && !this.clients.get(agent.id)?.error) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return this.client(agent.id);
  }

  /** The channels an agent's app is in, cached for a minute. */
  async channelsFor(agentId) {
    const client = this.client(agentId);
    if (!client) return [];
    const cached = this.membership.get(agentId);
    if (cached && Date.now() - cached.at < MEMBERSHIP_TTL_MS) return cached.channels;
    let channels = cached?.channels || [];
    try {
      channels = await client.listChannels();
    } catch {}
    this.membership.set(agentId, { at: Date.now(), channels });
    return channels;
  }

  async inChannel(agentId, channelId) {
    if (!channelId) return false;
    const client = this.client(agentId);
    if (!client) return false;
    if (isDirectChannel(channelId) || client.channelInfo(channelId)?.direct) return true;
    return (await this.channelsFor(agentId)).some((channel) => channel.id === channelId);
  }

  forgetMembership(agentId) {
    this.membership.delete(agentId);
  }

  /** Read a channel's recent messages with any app that is in it. */
  async fetchMessages(channelId, limit, threadTs = "") {
    for (const [agentId, { client }] of this.clients) {
      if (!client.user || !(await this.inChannel(agentId, channelId))) continue;
      try {
        return await client.fetchMessages(channelId, limit, threadTs);
      } catch {}
    }
    return null;
  }

  async status(agent, channelId) {
    const botEnv = slackBotEnvName(agent);
    const appEnv = slackAppEnvName(agent);
    const entry = this.clients.get(agent.id);
    const { botToken, appToken } = this.tokens(agent);
    const manifest = appManifest(agent);
    if (!entry) {
      return {
        env: botEnv, appEnv, manifest,
        configured: Boolean(botToken && appToken),
        state: botToken && appToken ? "off" : "missing-token",
      };
    }
    const user = entry.client.user;
    return {
      env: botEnv,
      appEnv,
      manifest,
      configured: true,
      state: user ? entry.client.state : entry.error ? "error" : "connecting",
      error: entry.error || entry.client.lastError,
      user: user ? { id: user.id, username: user.name } : null,
      team: entry.client.team,
      inChannel: user ? await this.inChannel(agent.id, channelId) : false,
    };
  }
}
