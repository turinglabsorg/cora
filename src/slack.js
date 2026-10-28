import { EventEmitter } from "node:events";
import { splitMessage } from "./discord.js";

const MAX_TEXT = 3800;
const PAGE = 200;
// Tokens Slack will never accept again: asking a second time only burns the connection.
const FATAL = new Set(["invalid_auth", "account_inactive", "token_revoked", "token_expired", "not_authed", "invalid_app_token"]);
const BOLD = "\u0001";
const CODE = "\u0000";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Slack reads &, < and > as markup, so a message that means them says them. */
export function escapeSlack(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The agents write Markdown, Slack speaks mrkdwn: one asterisk is bold, an
 * underscore is italic, and a link carries its label inside the brackets.
 * Code spans are set aside first so nothing inside them is rewritten.
 */
export function toMrkdwn(text) {
  const spans = [];
  const kept = escapeSlack(text).replace(/```[\s\S]*?```|`[^`\n]*`/g, (match) => `${CODE}${spans.push(match) - 1}${CODE}`);
  const converted = kept
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "<$2|$1>")
    .replace(/\*\*([^*\n]+)\*\*/g, `${BOLD}$1${BOLD}`)
    .replace(/__([^_\n]+)__/g, `${BOLD}$1${BOLD}`)
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1_$2_")
    .replace(/^(\s*)[-*] /gm, "$1• ")
    .replace(/^(#{1,6})\s+(.+)$/gm, (_, __, title) => `${BOLD}${title}${BOLD}`);
  return converted.replace(new RegExp(BOLD, "g"), "*").replace(new RegExp(`${CODE}(\\d+)${CODE}`, "g"), (_, index) => spans[Number(index)]);
}

/** A direct message conversation (D…) is private to one person and one bot. */
export function isDirectChannel(id) {
  return /^D[A-Z0-9]+$/i.test(String(id || ""));
}

/**
 * A Slack app: the Web API with its bot token (xoxb) and Socket Mode with its
 * app-level token (xapp), so an instance behind a tunnel needs no public URL.
 * Every agent has an app of its own; the main one keeps the channel catalog.
 */
export class Slack extends EventEmitter {
  constructor({ botToken = "", appToken = "", apiBase = "https://slack.com/api", socketUrl = "" } = {}) {
    super();
    this.apiBase = apiBase.replace(/\/$/, "");
    this.socketUrl = socketUrl;
    this.channels = new Map();
    this.users = new Map();
    this.retries = 0;
    this.stopped = true;
    this.useTokens(botToken, appToken);
  }

  useTokens(botToken, appToken) {
    this.stop();
    this.botToken = botToken || "";
    this.appToken = appToken || "";
    this.user = null;
    this.team = null;
    this.channels = new Map();
    const missing = !this.botToken || !this.appToken;
    this.state = missing ? "missing-token" : "idle";
    this.lastError = missing ? "no Slack tokens" : "";
  }

  status() {
    return {
      state: this.state,
      error: this.lastError,
      user: this.user ? { id: this.user.id, username: this.user.name } : null,
      team: this.team ? { id: this.team.id, name: this.team.name } : null,
      channels: [...this.channels.values()],
    };
  }

  setState(state, error = "") {
    this.state = state;
    this.lastError = error;
    this.emit("status", this.status());
  }

  start() {
    if (!this.botToken || !this.appToken || !this.stopped) return;
    this.stopped = false;
    this.connect().catch((error) => this.scheduleReconnect(error.message));
  }

  stop() {
    const running = !this.stopped;
    this.stopped = true;
    this.retries = 0;
    clearTimeout(this.reconnectTimer);
    try { this.ws?.close(1000); } catch {}
    this.ws = null;
    if (running) this.setState("stopped");
  }

  async connect() {
    if (this.stopped) return;
    this.setState("connecting");
    if (!this.user) await this.identity();
    const url = this.socketUrl || (await this.request("apps.connections.open", {}, { auth: "app" })).url;
    if (this.stopped) return;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener("message", (event) => {
      let payload;
      try { payload = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8")); } catch { return; }
      this.onEnvelope(ws, payload);
    });
    ws.addEventListener("close", (event) => this.onClose(ws, event.code));
    ws.addEventListener("error", () => {});
  }

  /**
   * Slack drops an unacknowledged envelope after three seconds, so the receipt
   * goes out before the work. It also recycles sockets by itself: a disconnect
   * is routine, not a failure.
   */
  onEnvelope(ws, envelope) {
    if (ws !== this.ws) return;
    if (envelope.envelope_id) {
      try { ws.send(JSON.stringify({ envelope_id: envelope.envelope_id })); } catch {}
    }
    if (envelope.type === "hello") {
      this.retries = 0;
      this.setState("ready");
      this.emit("ready", this.user);
      return;
    }
    if (envelope.type === "disconnect") {
      try { ws.close(1000); } catch {}
      this.ws = null;
      this.scheduleReconnect(`Slack asked to reconnect (${envelope.reason || "unknown"})`);
      return;
    }
    const event = envelope.payload?.event;
    if (!event) return;
    if (event.type === "message") this.emit("message", event);
    else if (event.type === "channel_left" || event.type === "group_left") this.channels.delete(event.channel);
    else if (event.type === "member_joined_channel" && event.user === this.user?.id) this.emit("joined", event.channel);
  }

  onClose(ws, code) {
    if (ws !== this.ws) return;
    this.ws = null;
    if (this.stopped) {
      this.setState("stopped");
      return;
    }
    this.scheduleReconnect(`socket closed (${code})`);
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

  /**
   * Every method takes form parameters (the only encoding the whole Web API
   * accepts), nested values as JSON. A rejected token stops the connection
   * instead of being tried again.
   */
  async request(method, params = {}, { auth = "bot", timeoutMs = 30000 } = {}) {
    const token = auth === "app" ? this.appToken : this.botToken;
    const body = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      body.set(name, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let response;
      try {
        response = await fetch(`${this.apiBase}/${method}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const reason = error.name === "TimeoutError" ? "timeout" : error.cause?.code || error.message;
        if (attempt === 4) throw new Error(`Slack ${method}: ${reason}`);
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (response.status === 429) {
        await sleep(Math.min((Number(response.headers.get("retry-after")) || 1) * 1000 + 100, 30000));
        continue;
      }
      if (response.status >= 500 && attempt < 4) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      const data = await response.json().catch(() => ({}));
      if (!data.ok) {
        const error = new Error(`Slack ${method} -> ${data.error || response.status}`);
        error.status = response.status;
        error.slack = data.error || "";
        if (FATAL.has(error.slack)) {
          this.stopped = true;
          this.setState("error", `Slack rifiuta i token dell'app (${error.slack})`);
        }
        throw error;
      }
      return data;
    }
    throw new Error(`Slack ${method}: too many retries`);
  }

  /** Who this app is and which workspace it belongs to. */
  async identity() {
    const auth = await this.request("auth.test");
    this.user = { id: auth.user_id, name: auth.user, botId: auth.bot_id };
    this.team = { id: auth.team_id, name: auth.team, url: auth.url };
    return this.user;
  }

  isOwnMessage(event) {
    return Boolean(this.user && (event?.user === this.user.id || (event?.bot_id && event.bot_id === this.user.botId)));
  }

  /** The conversations this app is actually in: the Slack answer to "which channels can it see". */
  async listChannels() {
    const out = [];
    let cursor = "";
    do {
      const page = await this.request("users.conversations", {
        types: "public_channel,private_channel", exclude_archived: true, limit: PAGE, cursor: cursor || undefined,
      });
      for (const channel of page.channels || []) {
        const entry = {
          id: channel.id,
          name: channel.name || channel.id,
          guildId: this.team?.id || "",
          guildName: this.team?.name || "Slack",
          thread: false,
          private: Boolean(channel.is_private),
        };
        this.channels.set(channel.id, entry);
        out.push(entry);
      }
      cursor = page.response_metadata?.next_cursor || "";
    } while (cursor);
    return out;
  }

  channelInfo(channelId) {
    return this.channels.get(channelId) || null;
  }

  /** A channel this app knows nothing about yet (a direct message, a channel it was just added to). */
  async loadChannel(channelId) {
    const cached = this.channels.get(channelId);
    if (cached) return cached;
    try {
      const { channel } = await this.request("conversations.info", { channel: channelId });
      const entry = {
        id: channel.id,
        name: channel.name || (channel.is_im ? "messaggio diretto" : channel.id),
        guildId: this.team?.id || "",
        guildName: this.team?.name || "Slack",
        thread: false,
        private: Boolean(channel.is_private || channel.is_im),
        direct: Boolean(channel.is_im),
      };
      this.channels.set(channel.id, entry);
      return entry;
    } catch {
      return null;
    }
  }

  /** A person's name, cached: Slack events carry only ids. */
  async userName(userId) {
    if (!userId) return "qualcuno";
    const cached = this.users.get(userId);
    if (cached) return cached.name;
    try {
      const { user } = await this.request("users.info", { user: userId });
      const name = user?.profile?.display_name || user?.profile?.real_name || user?.real_name || user?.name || userId;
      this.users.set(userId, { name, owner: Boolean(user?.is_owner || user?.is_primary_owner), bot: Boolean(user?.is_bot) });
      return name;
    } catch {
      return userId;
    }
  }

  async userInfo(userId) {
    await this.userName(userId);
    return this.users.get(userId) || null;
  }

  async fetchMessages(channelId, limit = 30, threadTs = "") {
    const data = threadTs
      ? await this.request("conversations.replies", { channel: channelId, ts: threadTs, limit: Math.min(200, limit) })
      : await this.request("conversations.history", { channel: channelId, limit: Math.min(200, limit) });
    const messages = data.messages || [];
    return threadTs ? messages : messages.reverse();
  }

  /**
   * Post text, and a file with it. `name` makes the message carry that name
   * and avatar (chat:write.customize), for an agent with no app of its own.
   */
  async say(channelId, { content = "", file = null, name = "", avatarUrl = "", threadTs = "" } = {}) {
    const chunks = splitMessage(String(content || ""), MAX_TEXT);
    if (!chunks.length && !file) return [];
    const sent = [];
    for (const chunk of chunks) {
      try {
        sent.push(await this.post(channelId, { text: toMrkdwn(chunk), name, avatarUrl, threadTs }));
      } catch (error) {
        error.sentCount = sent.length;
        throw error;
      }
    }
    if (file) {
      try {
        sent.push(await this.upload(channelId, file, { threadTs, name, avatarUrl }));
      } catch (error) {
        error.sentCount = sent.length;
        throw error;
      }
    }
    return sent;
  }

  async post(channelId, { text, name = "", avatarUrl = "", threadTs = "" }) {
    const params = { channel: channelId, text, mrkdwn: true, unfurl_links: false, unfurl_media: false };
    if (threadTs) params.thread_ts = threadTs;
    if (name) {
      params.username = name;
      if (avatarUrl) params.icon_url = avatarUrl;
    }
    const data = await this.request("chat.postMessage", params);
    return { ts: data.ts, channel: data.channel };
  }

  /** files.upload is retired: ask for a slot, send the bytes, then share it. */
  async upload(channelId, file, { threadTs = "", title = "", name = "", avatarUrl = "" } = {}) {
    const slot = await this.request("files.getUploadURLExternal", { filename: file.name || "file", length: file.data.length });
    const form = new FormData();
    form.set("file", new Blob([file.data], { type: file.type || "application/octet-stream" }), file.name || "file");
    const upload = await fetch(slot.upload_url, { method: "POST", body: form, signal: AbortSignal.timeout(120000) });
    if (!upload.ok) throw new Error(`Slack upload -> ${upload.status}`);
    await upload.body?.cancel().catch(() => {});
    const params = {
      files: [{ id: slot.file_id, title: title || file.name || "file" }],
      channel_id: channelId,
    };
    if (threadTs) params.thread_ts = threadTs;
    if (name) {
      params.username = name;
      if (avatarUrl) params.icon_url = avatarUrl;
    }
    const data = await this.request("files.completeUploadExternal", params);
    const shared = data.files?.[0]?.shares;
    const ts = shared && Object.values(shared).flatMap((scope) => Object.values(scope).flat())[0]?.ts;
    return { ts: ts || "", channel: channelId, file: slot.file_id };
  }

  /** A file someone sent: Slack serves it only to the token that can see the channel. */
  async download(file, limit) {
    if (!file?.url_private || (file.size && file.size > limit)) return null;
    const response = await fetch(file.url_private, {
      headers: { Authorization: `Bearer ${this.botToken}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) return null;
    const data = Buffer.from(await response.arrayBuffer());
    return data.length <= limit ? data : null;
  }

  /** Slack has no typing indicator for a bot user outside assistant threads. */
  typing() {}
}
