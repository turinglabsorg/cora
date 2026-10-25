import { EventEmitter } from "node:events";
import { splitMessage } from "./discord.js";

const MAX_TEXT = 4000;
const MAX_CAPTION = 1024;
const PHOTO_LIMIT_BYTES = 10 * 1024 * 1024;
const POLL_TIMEOUT_S = 30;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function escapeHtml(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function chatTitle(chat) {
  return chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || (chat.username ? `@${chat.username}` : String(chat.id));
}

export function userName(user) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(" ") || (user?.username ? `@${user.username}` : "qualcuno");
}

/**
 * A Telegram bot on the Bot API. The listening bot long-polls getUpdates;
 * agents' own bots only send. The token is part of every URL, so URLs are
 * never logged or put in errors.
 */
export class Telegram extends EventEmitter {
  constructor({ token = "", apiBase = "https://api.telegram.org", pollTimeout = POLL_TIMEOUT_S, chats = [] } = {}) {
    super();
    this.apiBase = apiBase.replace(/\/$/, "");
    this.pollTimeout = pollTimeout;
    this.chats = new Map(chats.map((chat) => [chat.id, chat]));
    this.generation = 0;
    this.stopped = true;
    this.offset = 0;
    this.useToken(token);
  }

  useToken(token) {
    this.stop();
    this.token = token || "";
    this.user = null;
    this.state = this.token ? "idle" : "missing-token";
    this.lastError = this.token ? "" : "no Telegram bot token";
  }

  status() {
    return {
      state: this.state,
      error: this.lastError,
      user: this.user ? { id: String(this.user.id), username: this.user.username, name: this.user.first_name } : null,
      chats: [...this.chats.values()],
    };
  }

  setState(state, error = "") {
    this.state = state;
    this.lastError = error;
    this.emit("status", this.status());
  }

  start() {
    if (!this.token || !this.stopped) return;
    this.stopped = false;
    this.poll(++this.generation);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.generation += 1;
    this.polling?.abort();
    this.setState("stopped");
  }

  async poll(generation) {
    let retries = 0;
    const live = () => !this.stopped && generation === this.generation;
    while (live()) {
      try {
        if (!this.user) {
          this.setState("connecting");
          this.user = await this.request("getMe");
          this.setState("ready");
          this.emit("ready", this.user);
        }
        const updates = await this.request("getUpdates", {
          offset: this.offset, timeout: this.pollTimeout, allowed_updates: ["message", "my_chat_member"],
        }, { timeoutMs: (this.pollTimeout + 15) * 1000, poll: true });
        if (!live()) return;
        retries = 0;
        if (this.state !== "ready") this.setState("ready");
        for (const update of updates) {
          this.offset = update.update_id + 1;
          this.handle(update);
        }
      } catch (error) {
        if (!live()) return;
        if (error.status === 401 || error.status === 404) {
          this.stopped = true;
          this.setState("error", "Telegram rifiuta il token del bot");
          return;
        }
        const conflict = error.status === 409;
        this.setState("reconnecting", conflict ? "un altro programma sta già leggendo questo bot (getUpdates o webhook)" : error.message);
        await sleep(conflict ? 15000 : Math.min(1000 * 2 ** retries, 30000));
        retries += 1;
      }
    }
  }

  handle(update) {
    const member = update.my_chat_member;
    const message = update.message;
    const chat = member?.chat || message?.chat;
    if (chat) {
      const id = String(chat.id);
      const previous = this.chats.get(id);
      const status = member?.new_chat_member?.status;
      const info = {
        id,
        title: chatTitle(chat),
        type: chat.type,
        member: status ? !["left", "kicked"].includes(status) : previous?.member ?? true,
      };
      if (JSON.stringify(info) !== JSON.stringify(previous)) {
        this.chats.set(id, info);
        this.emit("chat", info);
      }
    }
    if (message) this.emit("message", message);
  }

  async request(method, params = {}, { form = null, timeoutMs = 30000, poll = false } = {}) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const controller = new AbortController();
      if (poll) this.polling = controller;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(`${this.apiBase}/bot${this.token}/${method}`, form
          ? { method: "POST", body: form, signal: controller.signal }
          : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params), signal: controller.signal });
      } catch (error) {
        clearTimeout(timer);
        const reason = error.name === "AbortError" ? "timeout" : error.cause?.code || error.message;
        if (poll || attempt === 4) throw new Error(`Telegram ${method}: ${reason}`);
        await sleep(500 * 2 ** attempt);
        continue;
      }
      clearTimeout(timer);
      const data = await response.json().catch(() => ({}));
      if (response.status === 429) {
        await sleep(Math.min(Number(data.parameters?.retry_after || 1) * 1000 + 100, 30000));
        continue;
      }
      if (response.status >= 500 && !poll && attempt < 4) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (!data.ok) {
        const error = new Error(`Telegram ${method} -> ${response.status}${data.description ? `: ${data.description}` : ""}`);
        error.status = response.status;
        throw error;
      }
      return data.result;
    }
    throw new Error(`Telegram ${method}: too many retries`);
  }

  /** Post text (and optionally a file); `name` puts the agent's name in bold on top, for agents without their own bot. */
  async say(chatId, { content = "", file = null, name = "" }) {
    const header = name ? `<b>${escapeHtml(name)}</b>\n` : "";
    const sent = [];
    let text = String(content || "").trim();
    if (file) {
      const form = new FormData();
      const photo = /^image\/(png|jpeg|webp)$/.test(file.type || "") && file.data.length <= PHOTO_LIMIT_BYTES;
      const caption = header + escapeHtml(text);
      form.set("chat_id", String(chatId));
      form.set(photo ? "photo" : "document", new Blob([file.data], { type: file.type || "application/octet-stream" }), file.name || "file");
      form.set("parse_mode", "HTML");
      if (caption.length <= MAX_CAPTION) {
        form.set("caption", caption);
        text = "";
      } else if (header) form.set("caption", header.trim());
      sent.push(await this.request(photo ? "sendPhoto" : "sendDocument", {}, { form, timeoutMs: 120000 }));
      if (!text) return sent;
    }
    for (const chunk of splitMessage(text, MAX_TEXT - header.length)) {
      sent.push(await this.request("sendMessage", {
        chat_id: chatId, text: header + escapeHtml(chunk), parse_mode: "HTML", link_preview_options: { is_disabled: true },
      }));
    }
    return sent;
  }

  typing(chatId) {
    this.request("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  }

  /** Download a file a user sent (photos for the agents that can see), up to `limit` bytes. */
  async download(fileId, limit) {
    const file = await this.request("getFile", { file_id: fileId });
    if (!file?.file_path || (file.file_size && file.file_size > limit)) return null;
    const response = await fetch(`${this.apiBase}/file/bot${this.token}/${file.file_path}`, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) return null;
    const data = Buffer.from(await response.arrayBuffer());
    return data.length <= limit ? data : null;
  }
}
