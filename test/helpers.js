import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const GUILD = "100000000000000001";
export const OTHER_GUILD = "100000000000000002";
export const CHANNEL = "200000000000000001";
export const OTHER_CHANNEL = "200000000000000002";
export const OWNER = "300000000000000001";
export const STRANGER = "300000000000000002";
export const BOT = "400000000000000001";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(check, { timeout = 15000, interval = 50, what = "condition" } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await sleep(interval);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function encodeFrame(text) {
  const payload = Buffer.from(text);
  let header;
  if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
  else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const opcode = buffer[offset] & 0x0f;
    let length = buffer[offset + 1] & 0x7f;
    const masked = Boolean(buffer[offset + 1] & 0x80);
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.length < cursor + 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length < cursor + 8) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    const mask = masked ? buffer.subarray(cursor, cursor + 4) : null;
    if (masked) cursor += 4;
    if (buffer.length < cursor + length) break;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    frames.push({ opcode, payload });
    offset = cursor + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

export const MAIN_TOKEN = "test-token";

/** A stand-in Discord: REST for channels/webhooks/messages and a Gateway over WebSocket. */
export async function fakeDiscord() {
  const state = {
    webhookPosts: [],
    botPosts: [],
    typing: 0,
    sockets: new Set(),
    socketUser: new Map(),
    identifies: 0,
    history: new Map(),
    webhookAllowed: true,
    // channel id -> the only bot token allowed to read it (a private channel).
    privateTo: new Map(),
    botUsers: new Map(),
    intentPatches: [],
    refuseIntent: new Set(),
    profilePatches: [],
    nextId: 900000000000000000n,
  };
  const id = () => String(state.nextId++);
  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const body = await readBody(req);
    let match;
    if (url.pathname === "/gateway/bot") return json(res, 200, { url: `ws://127.0.0.1:${server.address().port}/gateway`, session_start_limit: { remaining: 999 } });
    if ((match = /^\/channels\/(\d+)\/messages$/.exec(url.pathname)) && req.method === "GET") {
      const only = state.privateTo.get(match[1]);
      const asking = String(req.headers.authorization || "").replace(/^Bot /, "");
      if (only && only !== asking) return json(res, 403, { message: "Missing Access", code: 50001 });
      return json(res, 200, [...(state.history.get(match[1]) || [])].reverse());
    }
    if ((match = /^\/channels\/(\d+)\/webhooks$/.exec(url.pathname))) {
      if (!state.webhookAllowed) return json(res, 403, { message: "Missing Permissions" });
      if (req.method === "GET") return json(res, 200, []);
      return json(res, 200, { id: "500000000000000001", token: "webhook-token", name: "cora", application_id: BOT, channel_id: match[1] });
    }
    if ((match = /^\/webhooks\/(\d+)\/([^/]+)$/.exec(url.pathname)) && req.method === "POST") {
      let payload;
      if (String(req.headers["content-type"]).startsWith("multipart/")) {
        const text = body.toString("latin1");
        const json = /name="payload_json"\r\n\r\n([\s\S]*?)\r\n--/.exec(text)?.[1];
        payload = { ...JSON.parse(json || "{}"), file: /filename="([^"]+)"/.exec(text)?.[1] };
      } else payload = JSON.parse(body.toString("utf8"));
      const channelId = url.searchParams.get("thread_id") || CHANNEL;
      const message = {
        id: id(), channel_id: channelId, guild_id: GUILD, content: payload.content, webhook_id: match[1],
        author: { id: match[1], username: payload.username, bot: true }, timestamp: new Date().toISOString(), attachments: [],
      };
      state.webhookPosts.push({ ...payload, channelId, authorized: Boolean(req.headers.authorization) });
      json(res, 200, message);
      setTimeout(() => dispatch("MESSAGE_CREATE", message), 20);
      return;
    }
    const token = String(req.headers.authorization || "").replace(/^Bot /, "");
    const caller = state.botUsers.get(token) || { id: BOT, username: "GROG" };
    if (url.pathname === "/applications/@me" && req.method === "GET") {
      return json(res, 200, { id: caller.id, name: caller.username, flags: caller.appFlags || 0 });
    }
    // An app under 100 servers may switch its own limited gateway intents on.
    if (url.pathname === "/applications/@me" && req.method === "PATCH") {
      if (!state.botUsers.has(token)) return json(res, 404, { message: "404: not found", code: 0 });
      const patch = JSON.parse(body.toString("utf8"));
      state.intentPatches.push({ token, flags: Number(patch.flags) || 0 });
      if (state.refuseIntent.has(token)) return json(res, 403, { message: "403: Missing Permissions", code: 0 });
      caller.appFlags = Number(patch.flags) || 0;
      return json(res, 200, { id: caller.id, name: caller.username, flags: caller.appFlags });
    }
    if (url.pathname === "/users/@me" && req.method === "GET") {
      if (!state.botUsers.has(token) && token !== MAIN_TOKEN) return json(res, 401, { message: "401: Unauthorized", code: 0 });
      return json(res, 200, { bot: true, ...caller });
    }
    if (url.pathname === "/users/@me" && req.method === "PATCH") {
      const patch = JSON.parse(body.toString("utf8"));
      state.profilePatches.push({ token, username: patch.username, avatar: Boolean(patch.avatar) });
      if (patch.username) caller.username = patch.username;
      return json(res, 200, { ...caller, bot: true });
    }
    if ((match = /^\/channels\/(\d+)\/messages$/.exec(url.pathname)) && req.method === "POST") {
      const payload = JSON.parse(body.toString("utf8"));
      const message = { id: id(), channel_id: match[1], guild_id: GUILD, content: payload.content, author: { id: caller.id, username: caller.username, bot: true }, timestamp: new Date().toISOString() };
      state.botPosts.push({ ...payload, channelId: match[1], token });
      json(res, 200, message);
      setTimeout(() => dispatch("MESSAGE_CREATE", message), 20);
      return;
    }
    if (/^\/channels\/\d+\/typing$/.test(url.pathname)) {
      state.typing += 1;
      res.writeHead(204);
      return res.end();
    }
    json(res, 404, { message: "not found" });
  });

  let seq = 0;
  const send = (socket, payload) => socket.write(encodeFrame(JSON.stringify(payload)));
  const dispatch = (type, data) => {
    seq += 1;
    for (const socket of state.sockets) send(socket, { op: 0, t: type, s: seq, d: data });
  };

  server.on("upgrade", (req, socket) => {
    const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    state.sockets.add(socket);
    let buffer = Buffer.alloc(0);
    send(socket, { op: 10, d: { heartbeat_interval: 45000 } });
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const { frames, rest } = decodeFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        if (frame.opcode === 8) {
          socket.end();
          continue;
        }
        if (frame.opcode !== 1) continue;
        const payload = JSON.parse(frame.payload.toString("utf8"));
        if (payload.op === 1) send(socket, { op: 11 });
        if (payload.op === 2) {
          state.identifies += 1;
          const own = state.botUsers.get(payload.d.token);
          state.socketUser.set(socket, own || { id: BOT, username: "GROG" });
          seq += 1;
          send(socket, { op: 0, t: "READY", s: seq, d: { user: own || { id: BOT, username: "GROG" }, session_id: "sess", resume_gateway_url: `ws://127.0.0.1:${server.address().port}/gateway` } });
          if (own) {
            seq += 1;
            send(socket, { op: 0, t: "GUILD_CREATE", s: seq, d: { id: GUILD, name: "testworld", owner_id: OWNER, channels: [{ id: CHANNEL, name: "general", type: 0, position: 0 }], threads: [] } });
            continue;
          }
          seq += 1;
          send(socket, { op: 0, t: "GUILD_CREATE", s: seq, d: { id: GUILD, name: "testworld", owner_id: OWNER, channels: [{ id: CHANNEL, name: "general", type: 0, position: 0 }], threads: [] } });
          seq += 1;
          send(socket, { op: 0, t: "GUILD_CREATE", s: seq, d: { id: OTHER_GUILD, name: "cliente", owner_id: STRANGER, channels: [{ id: OTHER_CHANNEL, name: "clienti", type: 0, position: 0 }], threads: [] } });
        }
      }
    });
    socket.on("close", () => { state.sockets.delete(socket); state.socketUser.delete(socket); });
    socket.on("error", () => state.sockets.delete(socket));
  });

  const port = await listen(server);
  let counter = 0;
  return {
    state,
    url: `http://127.0.0.1:${port}`,
    dispatch,
    /** A message in a channel only one bot can see: only that bot's connection receives it. */
    sayTo({ content, botUserId, channel, author = OWNER, username = "Sam", guild = GUILD }) {
      counter += 1;
      const message = {
        id: id(), type: 0, channel_id: channel, guild_id: guild, content, attachments: [], embeds: [], mentions: [],
        author: { id: author, username, global_name: username, bot: false }, timestamp: new Date(Date.now() + counter).toISOString(),
      };
      state.history.set(channel, [...(state.history.get(channel) || []), message]);
      for (const [socket, user] of state.socketUser) if (user?.id === botUserId) send(socket, { op: 0, t: "MESSAGE_CREATE", s: ++seq, d: message });
      return message;
    },
    /** A person DMs one bot (by its user id). Only that bot's connection receives it, with no server. */
    dm({ content, botUserId, author = OWNER, username = "Sam", channel = "7" + botUserId }) {
      counter += 1;
      const message = {
        id: id(), type: 0, channel_id: channel, content, attachments: [], embeds: [], mentions: [],
        author: { id: author, username, global_name: username, bot: false }, timestamp: new Date(Date.now() + counter).toISOString(),
      };
      for (const [socket, user] of state.socketUser) if (user?.id === botUserId) send(socket, { op: 0, t: "MESSAGE_CREATE", s: ++seq, d: message });
      return message;
    },
    /** A human (or bot) writes in a channel. */
    say({ content, author = OWNER, username = "Sam", channel = CHANNEL, guild = GUILD, bot = false, attachments = [], mentions = [], type = 0 }) {
      counter += 1;
      const message = {
        id: id(), type, channel_id: channel, guild_id: guild, content, attachments, embeds: [], mentions,
        author: { id: author, username, global_name: username, bot }, timestamp: new Date(Date.now() + counter).toISOString(),
      };
      // Like the real Discord, the message is in the channel's history before the gateway delivers it.
      state.history.set(channel, [...(state.history.get(channel) || []), message]);
      if (!this.offline) dispatch("MESSAGE_CREATE", message);
      return message;
    },
    close() {
      for (const socket of state.sockets) socket.destroy();
      server.closeAllConnections?.();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/** A stand-in Ollama /api/chat whose answers come from `reply(body)`. */
export async function fakeOllama(reply) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ models: [{ name: "test-model", capabilities: ["completion", "tools"] }, { name: "embed", capabilities: ["embedding"] }] }));
    }
    if (url.pathname === "/api/chat") {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      calls.push(body);
      fakeOllama.lastAuth = req.headers.authorization;
      let message;
      try {
        message = await fakeOllama.current(body, calls);
      } catch (error) {
        // A throwing test handler must fail its own test, never hang every request after it.
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: String(error.message || error) }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ message: { role: "assistant", content: "", ...message }, done: true }));
    }
    res.writeHead(404);
    res.end();
  });
  fakeOllama.current = reply;
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    setReply(fn) { fakeOllama.current = fn; },
    close() {
      server.closeAllConnections?.();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/** A stand-in docker CLI: records its arguments and fakes the few commands cora uses. */
export function fakeDocker() {
  const dir = mkdtempSync(join(tmpdir(), "cora-docker-"));
  const log = join(dir, "calls.log");
  const script = join(dir, "docker");
  writeFileSync(script, `#!/bin/sh
echo "$@" >> "${log}"
case "$1" in
  image) echo sha256:test; exit 0 ;;
  inspect)
    if [ -f "${dir}/inspect" ]; then
      grep -q MISSING "${dir}/inspect" && exit 1
      cat "${dir}/inspect"; exit 0
    fi
    printf '{"Running":true,"Status":"running"}\\t{"6080/tcp":[{"HostIp":"127.0.0.1","HostPort":"1"}],"22/tcp":[{"HostIp":"127.0.0.1","HostPort":"2201"}]}\\tsha256:test\\t/home/agent,/var/lib/cora,\\n'; exit 0 ;;
  run|start|stop|restart|rm|volume) echo ok; exit 0 ;;
  exec)
    case "$*" in
      *cora_authorized_keys*) cat > "${dir}/authorized_keys"; exit 0 ;;
      *"tailscale status --json"*) if [ -f "${dir}/tailscale.json" ]; then cat "${dir}/tailscale.json"; else echo '{"BackendState":"NeedsLogin","AuthURL":""}'; fi; exit 0 ;;
      *"tailscale up"*) echo '{"BackendState":"NeedsLogin","AuthURL":"https://login.tailscale.com/a/test"}' > "${dir}/tailscale.json"; exit 0 ;;
      *"tailscale set"*) exit 0 ;;
    esac
    for last; do :; done
    echo "ran: $last"; exit 0 ;;
esac
exit 0
`);
  chmodSync(script, 0o755);
  return { path: script, log, dir };
}

export function tempHome() {
  return mkdtempSync(join(tmpdir(), "cora-home-"));
}

/**
 * Stand-in `claude` and `codex` CLIs. They log their arguments, start the MCP
 * server cora hands them, call the tool named in CORA_FAKE_TOOL (with
 * CORA_FAKE_ARGS) and answer with CORA_FAKE_REPLY plus the tool's output.
 */
export function fakeCli() {
  const dir = mkdtempSync(join(tmpdir(), "cora-cli-"));
  const log = join(dir, "calls.jsonl");
  const control = join(dir, "control.json");
  const source = `#!${process.execPath}
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
const flavor = path.basename(process.argv[1]);
const control = JSON.parse(fs.readFileSync(${JSON.stringify(control)}, "utf8"));
let stdin = "";
process.stdin.on("data", (d) => { stdin += d; });
process.stdin.on("end", async () => {
  let server = null;
  let hermesConfig = null;
  if (flavor === "claude") {
    const index = argv.indexOf("--mcp-config");
    if (index >= 0) server = JSON.parse(fs.readFileSync(argv[index + 1], "utf8")).mcpServers.cora;
  } else if (flavor === "hermes") {
    // Hermes reads config.yaml in HERMES_HOME and fills \${...} from its own environment.
    hermesConfig = fs.readFileSync(path.join(process.env.HERMES_HOME, "config.yaml"), "utf8");
    const fill = (value) => value.replace(/\\$\\{(\\w+)\\}/g, (_, key) => process.env[key] || "");
    const pick = (pattern) => JSON.parse(hermesConfig.match(pattern)[1]);
    if ((argv[argv.indexOf("-t") + 1] || "").split(",").includes("cora")) {
      server = {
        command: pick(/^    command: (.*)$/m), args: [pick(/^      - (.*)$/m)],
        env: { CORA_BRIDGE_URL: fill(pick(/CORA_BRIDGE_URL: (.*)$/m)), CORA_BRIDGE_TOKEN: fill(pick(/CORA_BRIDGE_TOKEN: (.*)$/m)) },
      };
    }
  } else {
    const value = (key) => { const item = argv.find((arg) => arg.startsWith("mcp_servers.cora." + key + "=")); return item ? item.slice(("mcp_servers.cora." + key + "=").length) : null; };
    if (value("command")) {
      const env = {};
      for (const [, k, v] of value("env").matchAll(/(\\w+) = ("[^"]*")/g)) env[k] = JSON.parse(v);
      server = { command: JSON.parse(value("command")), args: JSON.parse(value("args")), env };
    }
  }
  const record = { flavor, argv, stdin, tools: null, output: null, hermesConfig, secretEnv: Object.keys(process.env).filter((key) => key.startsWith("CORA_BOT_") || key === "DISCORD_BOT_TOKEN" || key === "ORCAROUTER_API_KEY" || key === "OLLAMA_API_KEY") };
  if (server && control.tool) {
    const child = spawn(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ["pipe", "pipe", "inherit"] });
    let buffer = "";
    const waiting = new Map();
    child.stdout.on("data", (d) => {
      buffer += d;
      let n;
      while ((n = buffer.indexOf("\\n")) >= 0) {
        const msg = JSON.parse(buffer.slice(0, n));
        buffer = buffer.slice(n + 1);
        waiting.get(msg.id)?.(msg);
      }
    });
    let id = 0;
    const rpc = (method, params) => new Promise((resolve) => { id += 1; waiting.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\\n"); });
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake", version: "0" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\\n");
    record.tools = (await rpc("tools/list", {})).result.tools.map((tool) => tool.name);
    const call = await rpc("tools/call", { name: control.tool, arguments: control.args || {} });
    record.output = call.result.content[0].text;
    child.kill();
  }
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(record) + "\\n");
  const answer = control.reply + (record.output ? " [" + record.output + "]" : "");
  const line = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
  if (flavor === "hermes") {
    process.stdout.write(answer + "\\n");
  } else if (flavor === "claude") {
    line({ type: "system", subtype: "init" });
    line({ type: "assistant", message: { content: [{ type: "thinking", thinking: control.thinking || "" }] } });
    if (control.tool) {
      line({ type: "assistant", message: { content: [{ type: "text", text: "Prima controllo." }] } });
      line({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__cora__" + control.tool, input: control.args || {} }] } });
    }
    line({ type: "assistant", message: { content: [{ type: "text", text: answer }] } });
    line({ type: "result", is_error: false, result: answer });
  } else {
    line({ type: "thread.started" });
    if (control.thinking) line({ type: "item.completed", item: { type: "reasoning", text: control.thinking } });
    if (control.tool) line({ type: "item.completed", item: { type: "mcp_tool_call", server: "cora", tool: control.tool } });
    line({ type: "item.completed", item: { type: "agent_message", text: answer } });
    fs.writeFileSync(argv[argv.indexOf("-o") + 1], answer);
  }
});
`;
  for (const name of ["claude", "codex", "hermes"]) {
    writeFileSync(join(dir, name), source);
    chmodSync(join(dir, name), 0o755);
  }
  const models = join(dir, "models_cache.json");
  writeFileSync(models, JSON.stringify({ models: [{ slug: "gpt-6-sol", visibility: "list" }, { slug: "hidden", visibility: "hide" }] }));
  return {
    claude: join(dir, "claude"),
    codex: join(dir, "codex"),
    hermes: join(dir, "hermes"),
    models,
    set(value) { writeFileSync(control, JSON.stringify(value)); },
    calls() {
      try { return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; }
    },
  };
}

export const TG_GROUP = "-1001234567890";
export const TG_OTHER_GROUP = "-1009999999999";
export const TG_OWNER = "777000111";
export const TG_STRANGER = "777000222";

/** A stand-in Telegram Bot API: getUpdates long polling, sending, files, members. */
export async function fakeTelegram() {
  const state = {
    bots: new Map(),
    updates: [],
    sent: [],
    names: [],
    members: new Set(),
    nextUpdate: 1,
    nextMessage: 5000,
    waiting: new Set(),
  };
  const ok = (res, result) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, result }));
  };
  const fail = (res, status, description) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error_code: status, description }));
  };
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/file/")) {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      return res.end(Buffer.from("fake-jpeg"));
    }
    const match = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname);
    if (!match) return fail(res, 404, "Not Found");
    const [, token, method] = match;
    const bot = state.bots.get(token);
    if (!bot) return fail(res, 401, "Unauthorized");
    let params = {};
    if (String(req.headers["content-type"]).startsWith("multipart/")) {
      const text = body.toString("latin1");
      for (const [, name, value] of text.matchAll(/name="(\w+)"\r\n\r\n([^\r]*)\r\n/g)) params[name] = value;
      params.file = /name="(photo|document)"; filename="([^"]+)"/.exec(text)?.slice(1, 3) || null;
    } else if (body.length) params = JSON.parse(body.toString("utf8"));
    const message = (extra) => ({ message_id: state.nextMessage++, date: Math.floor(Date.now() / 1000), chat: { id: Number(params.chat_id) }, from: { ...bot, is_bot: true }, ...extra });
    switch (method) {
      case "getMe": return ok(res, { ...bot, is_bot: bot.is_bot ?? true });
      case "getUpdates": {
        const pending = () => state.updates.filter((update) => update.update_id >= (params.offset || 0));
        const deliver = () => ok(res, pending());
        if (pending().length) return deliver();
        const waiter = { deliver, timer: null };
        waiter.timer = setTimeout(() => { state.waiting.delete(waiter); deliver(); }, (params.timeout || 0) * 1000);
        state.waiting.add(waiter);
        req.on("close", () => { clearTimeout(waiter.timer); state.waiting.delete(waiter); });
        return;
      }
      case "sendMessage":
      case "sendPhoto":
      case "sendDocument": {
        state.sent.push({ token, method, ...params });
        return ok(res, message({ text: params.text || params.caption || "" }));
      }
      case "sendChatAction": return ok(res, true);
      case "setMyName": state.names.push({ token, name: params.name }); return ok(res, true);
      case "getChatAdministrators": return ok(res, [{ status: "creator", user: { id: Number(TG_OWNER), first_name: "Seb" } }]);
      case "getChatMember": return ok(res, { status: state.members.has(`${params.chat_id}:${params.user_id}`) ? "member" : "left" });
      case "getFile": return ok(res, { file_id: params.file_id, file_path: "photos/1.jpg", file_size: 9 });
      default: return fail(res, 400, `Bad Request: unknown method ${method}`);
    }
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    addBot(token, user) { state.bots.set(token, user); },
    push(message) {
      state.updates.push({ update_id: state.nextUpdate++, message: { message_id: state.nextMessage++, date: Math.floor(Date.now() / 1000), ...message } });
      for (const waiter of state.waiting) {
        clearTimeout(waiter.timer);
        state.waiting.delete(waiter);
        waiter.deliver();
      }
    },
    close() {
      for (const waiter of state.waiting) clearTimeout(waiter.timer);
      server.closeAllConnections?.();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
