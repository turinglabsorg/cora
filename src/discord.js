import { EventEmitter } from "node:events";

export const LISTENER_INTENTS = (1 << 0) | (1 << 9) | (1 << 15);
export const PRESENCE_INTENTS = 1 << 0;
/** Direct messages reach a bot without the privileged content intent. */
export const DIRECT_MESSAGE_INTENTS = PRESENCE_INTENTS | (1 << 12);
/** An agent bot that may read message content listens to its channels too, so private ones are heard. */
export const LISTENING_INTENTS = LISTENER_INTENTS | (1 << 12);
const FATAL_CLOSE_CODES = new Map([
  [4004, "the bot token was rejected"],
  [4010, "invalid shard"],
  [4011, "sharding required"],
  [4012, "invalid API version"],
  [4013, "invalid intents"],
  [4014, "Message Content Intent is not enabled for the bot"],
]);
const TEXT_CHANNEL_TYPES = new Set([0, 5]);
const THREAD_TYPES = new Set([10, 11, 12]);
const WEBHOOK_NAME = "cora";
const MAX_CONTENT = 1990;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function splitMessage(text, max = MAX_CONTENT) {
  const chunks = [];
  let rest = String(text || "").trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export class Discord extends EventEmitter {
  constructor({ token, apiBase, gatewayUrl = "", intents = LISTENER_INTENTS, activity = "" }) {
    super();
    this.token = token;
    this.intents = intents;
    this.activity = activity;
    this.apiBase = apiBase.replace(/\/$/, "");
    this.gatewayUrl = gatewayUrl;
    this.state = token ? "idle" : "missing-token";
    this.lastError = token ? "" : "no Discord bot token";
    this.user = null;
    this.guilds = new Map();
    this.webhooks = new Map();
    this.ownMessageIds = new Set();
    this.ownWebhookIds = new Set();
    this.ws = null;
    this.sessionId = null;
    this.resumeUrl = null;
    this.seq = null;
    this.heartbeat = null;
    this.acked = true;
    this.retries = 0;
    this.stopped = true;
  }

  /** Switch to another bot token (cora listening through an agent's own bot); call start() after. */
  /** Change what the connection asks to hear, reconnecting when it is already running. */
  useIntents(intents) {
    if (this.intents === intents) return;
    const running = !this.stopped;
    if (running) this.stop();
    this.intents = intents;
    if (running) this.start();
  }

  useToken(token) {
    this.stop();
    this.token = token || "";
    this.user = null;
    this.guilds = new Map();
    this.webhooks = new Map();
    this.ownWebhookIds = new Set();
    this.state = this.token ? "idle" : "missing-token";
    this.lastError = this.token ? "" : "no Discord bot token";
  }

  status() {
    return {
      state: this.state,
      error: this.lastError,
      user: this.user ? { id: this.user.id, username: this.user.username } : null,
      guilds: [...this.guilds.values()].map((guild) => ({ id: guild.id, name: guild.name })),
    };
  }

  setState(state, error = "") {
    this.state = state;
    this.lastError = error;
    this.emit("status", this.status());
  }

  async request(method, path, { body, form, auth = true } = {}) {
    const safePath = path.replace(/\/webhooks\/(\d+)\/[^/?]+/, "/webhooks/$1/***");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const headers = { "User-Agent": "DiscordBot (https://github.com/turinglabsorg/cora, 0.1)" };
      if (auth) headers.Authorization = `Bot ${this.token}`;
      const options = { method, headers };
      if (form) options.body = form;
      else if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
      }
      let response;
      try {
        response = await fetch(`${this.apiBase}${path}`, options);
      } catch (error) {
        if (attempt === 4) throw new Error(`Discord ${method} ${safePath}: ${error.message}`);
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (response.status === 429) {
        const data = await response.json().catch(() => ({}));
        await sleep(Math.min(Number(data.retry_after || 1) * 1000 + 100, 30000));
        continue;
      }
      if (response.status >= 500 && attempt < 4) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (response.status === 204) return null;
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const error = new Error(`Discord ${method} ${safePath} -> ${response.status}${data?.message ? `: ${data.message}` : ""}`);
        error.status = response.status;
        throw error;
      }
      return data;
    }
    throw new Error(`Discord ${method} ${safePath}: too many retries`);
  }

  start() {
    if (!this.token || !this.stopped) return;
    this.stopped = false;
    this.connect().catch((error) => this.scheduleReconnect(error.message));
  }

  /** A clean close (1000) ends the session on Discord's side, so the next start identifies again. */
  stop() {
    this.stopped = true;
    this.sessionId = null;
    this.resumeUrl = null;
    this.seq = null;
    this.retries = 0;
    clearTimeout(this.firstBeat);
    clearInterval(this.heartbeat);
    clearTimeout(this.reconnectTimer);
    try { this.ws?.close(1000); } catch {}
  }

  async connect() {
    if (this.stopped) return;
    this.setState("connecting");
    let base = this.sessionId && this.resumeUrl ? this.resumeUrl : this.gatewayUrl;
    if (!base) {
      const gateway = await this.request("GET", "/gateway/bot");
      if (gateway?.session_start_limit?.remaining === 0) {
        throw new Error("Discord session start limit reached");
      }
      base = gateway.url;
    }
    const url = new URL(base);
    url.searchParams.set("v", "10");
    url.searchParams.set("encoding", "json");
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener("message", (event) => {
      let payload;
      try { payload = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8")); } catch { return; }
      this.onPayload(ws, payload);
    });
    ws.addEventListener("close", (event) => this.onClose(ws, event.code));
    ws.addEventListener("error", () => {});
  }

  send(ws, op, d) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op, d }));
  }

  onPayload(ws, payload) {
    if (ws !== this.ws) return;
    if (payload.s !== null && payload.s !== undefined) this.seq = payload.s;
    switch (payload.op) {
      case 10: {
        const interval = payload.d.heartbeat_interval;
        clearInterval(this.heartbeat);
        this.acked = true;
        const beat = () => {
          if (!this.acked) {
            try { ws.close(4000); } catch {}
            return;
          }
          this.acked = false;
          this.send(ws, 1, this.seq);
        };
        clearTimeout(this.firstBeat);
        this.firstBeat = setTimeout(() => {
          if (ws !== this.ws || this.stopped) return;
          beat();
          this.heartbeat = setInterval(beat, interval);
        }, Math.floor(interval * Math.random()));
        if (this.sessionId) {
          this.send(ws, 6, { token: this.token, session_id: this.sessionId, seq: this.seq });
        } else {
          this.send(ws, 2, {
            token: this.token,
            intents: this.intents,
            properties: { os: process.platform, browser: "cora", device: "cora" },
            presence: {
              status: "online",
              since: null,
              afk: false,
              activities: this.activity ? [{ name: "Custom Status", type: 4, state: this.activity }] : [],
            },
          });
        }
        break;
      }
      case 11:
        this.acked = true;
        break;
      case 1:
        this.send(ws, 1, this.seq);
        break;
      case 7:
        try { ws.close(4000); } catch {}
        break;
      case 9:
        if (!payload.d) {
          this.sessionId = null;
          this.resumeUrl = null;
          this.seq = null;
        }
        setTimeout(() => { try { ws.close(4000); } catch {} }, 1000 + Math.random() * 4000);
        break;
      case 0:
        this.dispatch(payload.t, payload.d);
        break;
      default:
        break;
    }
  }

  onClose(ws, code) {
    if (ws !== this.ws) return;
    clearTimeout(this.firstBeat);
    clearInterval(this.heartbeat);
    if (this.stopped) {
      this.setState("stopped");
      return;
    }
    if (FATAL_CLOSE_CODES.has(code)) {
      this.setState("error", `Discord closed the gateway (${code}): ${FATAL_CLOSE_CODES.get(code)}`);
      return;
    }
    if (code === 4007 || code === 4009) {
      this.sessionId = null;
      this.resumeUrl = null;
      this.seq = null;
    }
    this.scheduleReconnect(`gateway closed (${code})`);
  }

  scheduleReconnect(reason) {
    if (this.stopped) return;
    const wait = Math.min(1000 * 2 ** this.retries, 30000);
    this.retries += 1;
    this.setState("reconnecting", reason);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => this.scheduleReconnect(error.message));
    }, wait);
  }

  dispatch(type, data) {
    switch (type) {
      case "READY":
        this.user = data.user;
        this.sessionId = data.session_id;
        this.resumeUrl = data.resume_gateway_url;
        this.retries = 0;
        this.setState("ready");
        this.emit("ready", data);
        break;
      case "RESUMED":
        this.retries = 0;
        this.setState("ready");
        break;
      case "GUILD_CREATE":
        this.guilds.set(data.id, {
          id: data.id,
          name: data.name,
          ownerId: data.owner_id,
          channels: new Map((data.channels || []).map((channel) => [channel.id, { ...channel, guild_id: data.id }])),
          threads: new Map((data.threads || []).map((thread) => [thread.id, { ...thread, guild_id: data.id }])),
        });
        this.emit("guild", this.guilds.get(data.id));
        this.emit("status", this.status());
        break;
      case "GUILD_DELETE":
        this.guilds.delete(data.id);
        this.emit("status", this.status());
        break;
      case "CHANNEL_CREATE":
      case "CHANNEL_UPDATE":
        this.guilds.get(data.guild_id)?.channels.set(data.id, data);
        break;
      case "CHANNEL_DELETE":
        this.guilds.get(data.guild_id)?.channels.delete(data.id);
        break;
      case "THREAD_CREATE":
      case "THREAD_UPDATE":
        this.guilds.get(data.guild_id)?.threads.set(data.id, data);
        break;
      case "THREAD_DELETE":
        this.guilds.get(data.guild_id)?.threads.delete(data.id);
        break;
      case "MESSAGE_CREATE":
        this.emit("message", data);
        break;
      default:
        break;
    }
  }

  channelInfo(channelId) {
    for (const guild of this.guilds.values()) {
      const channel = guild.channels.get(channelId) || guild.threads.get(channelId);
      if (channel) {
        return {
          id: channel.id,
          name: channel.name,
          type: channel.type,
          guildId: guild.id,
          guildName: guild.name,
          parentId: THREAD_TYPES.has(channel.type) ? channel.parent_id : null,
        };
      }
    }
    return null;
  }

  listChannels(guildIds) {
    const allowed = new Set(guildIds);
    const out = [];
    for (const guild of this.guilds.values()) {
      if (!allowed.has(guild.id)) continue;
      const channels = [...guild.channels.values()]
        .filter((channel) => TEXT_CHANNEL_TYPES.has(channel.type))
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      for (const channel of channels) {
        out.push({ id: channel.id, name: channel.name, guildId: guild.id, guildName: guild.name, thread: false });
      }
      for (const thread of guild.threads.values()) {
        if (!THREAD_TYPES.has(thread.type) || thread.thread_metadata?.archived) continue;
        out.push({ id: thread.id, name: thread.name, guildId: guild.id, guildName: guild.name, thread: true, parentId: thread.parent_id });
      }
    }
    return out;
  }

  async fetchMessages(channelId, limit = 30) {
    const messages = await this.request("GET", `/channels/${channelId}/messages?limit=${Math.min(100, limit)}`);
    return (messages || []).reverse();
  }

  async webhookFor(channelId) {
    const cached = this.webhooks.get(channelId);
    if (cached?.hook) return cached.hook;
    if (cached?.failedAt && Date.now() - cached.failedAt < 10 * 60 * 1000) return null;
    try {
      const existing = await this.request("GET", `/channels/${channelId}/webhooks`);
      let hook = (existing || []).find((item) => item.name === WEBHOOK_NAME && item.token && item.application_id === this.user?.id)
        || (existing || []).find((item) => item.name === WEBHOOK_NAME && item.token);
      if (!hook) hook = await this.request("POST", `/channels/${channelId}/webhooks`, { body: { name: WEBHOOK_NAME } });
      const entry = { id: hook.id, token: hook.token };
      this.ownWebhookIds.add(hook.id);
      this.webhooks.set(channelId, { hook: entry });
      return entry;
    } catch (error) {
      this.webhooks.set(channelId, { failedAt: Date.now(), error: error.message });
      this.emit("warning", `no webhook for channel ${channelId} (${error.message}); agents will post as the bot`);
      return null;
    }
  }

  webhookState(channelId) {
    const entry = this.webhooks.get(channelId);
    if (!entry) return "unknown";
    return entry.hook ? "webhook" : "fallback";
  }

  rememberOwn(message) {
    if (!message?.id) return;
    this.ownMessageIds.add(message.id);
    if (this.ownMessageIds.size > 5000) {
      const first = this.ownMessageIds.values().next().value;
      this.ownMessageIds.delete(first);
    }
  }

  isOwnMessage(message) {
    return this.ownMessageIds.has(message.id);
  }

  isAgentWebhook(message) {
    return Boolean(message.webhook_id && this.ownWebhookIds.has(message.webhook_id));
  }

  /** Post as an agent: through the channel's webhook (own name and avatar), or as the bot with a name prefix. */
  async post(channelId, { username, avatarUrl, content, file }) {
    const info = this.channelInfo(channelId);
    const target = info?.parentId || channelId;
    const hook = await this.webhookFor(target);
    const chunks = splitMessage(content);
    if (!chunks.length && !file) return [];
    const sent = [];
    for (let index = 0; index < Math.max(chunks.length, 1); index += 1) {
      const text = chunks[index] || "";
      const attach = index === Math.max(chunks.length, 1) - 1 ? file : null;
      let message;
      if (hook) {
        const query = new URLSearchParams({ wait: "true" });
        if (info?.parentId) query.set("thread_id", channelId);
        const payload = { content: text, username, allowed_mentions: { parse: ["users"] } };
        if (avatarUrl) payload.avatar_url = avatarUrl;
        message = await this.sendPayload(`/webhooks/${hook.id}/${hook.token}?${query}`, payload, attach, false);
      } else {
        const payload = { content: text ? `**${username}** · ${text}`.slice(0, 2000) : `**${username}**`, allowed_mentions: { parse: ["users"] } };
        message = await this.sendPayload(`/channels/${channelId}/messages`, payload, attach, true);
      }
      this.rememberOwn(message);
      sent.push(message);
    }
    return sent;
  }

  /** Post as this bot user (an agent with its own Discord application). */
  async say(channelId, { content, file }) {
    const chunks = splitMessage(content);
    if (!chunks.length && !file) return [];
    const sent = [];
    for (let index = 0; index < Math.max(chunks.length, 1); index += 1) {
      const attach = index === Math.max(chunks.length, 1) - 1 ? file : null;
      const message = await this.sendPayload(`/channels/${channelId}/messages`, { content: chunks[index] || "", allowed_mentions: { parse: ["users"] } }, attach, true);
      this.rememberOwn(message);
      sent.push(message);
    }
    return sent;
  }

  /** Align this bot's Discord profile with the agent's name and avatar. */
  async syncProfile({ username, avatarUrl }) {
    const patch = {};
    if (username && this.user && this.user.username !== username) patch.username = username;
    if (avatarUrl) {
      const response = await fetch(avatarUrl, { signal: AbortSignal.timeout(15000) });
      if (response.ok) {
        const type = response.headers.get("content-type") || "image/png";
        patch.avatar = `data:${type.split(";")[0]};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
      }
    }
    if (!Object.keys(patch).length) return null;
    const user = await this.request("PATCH", "/users/@me", { body: patch });
    this.user = { ...this.user, ...user };
    return user;
  }

  async sendPayload(path, payload, file, auth) {
    if (!file) return this.request("POST", path, { body: payload, auth });
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ ...payload, attachments: [{ id: 0, filename: file.name }] }));
    form.append("files[0]", new Blob([file.data], { type: file.type || "application/octet-stream" }), file.name);
    return this.request("POST", path, { form, auth });
  }

  async typing(channelId) {
    try { await this.request("POST", `/channels/${channelId}/typing`); } catch {}
  }
}
