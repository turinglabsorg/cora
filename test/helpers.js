import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
/** A Discord multipart post: payload_json, plus the first file's name, type and bytes. */
function discordForm(req, body) {
  const type = String(req.headers["content-type"] || "");
  if (!type.startsWith("multipart/")) return JSON.parse(body.toString("utf8"));
  const boundary = /boundary=([^;]+)/.exec(type)[1];
  const parts = body.toString("latin1").split(`--${boundary}`);
  let payload = {};
  for (const part of parts) {
    const head = part.slice(0, part.indexOf("\r\n\r\n"));
    const content = part.slice(head.length + 4, part.length - 2);
    if (/name="payload_json"/.test(head)) payload = { ...JSON.parse(Buffer.from(content, "latin1").toString("utf8")), ...payload };
    const file = /filename="([^"]+)"/.exec(head);
    if (file) payload = { ...payload, file: file[1], fileType: /Content-Type: ([^\r]+)/i.exec(head)?.[1] || "", fileBytes: Buffer.from(content, "latin1") };
  }
  return payload;
}

export async function fakeDiscord() {
  const state = {
    webhookPosts: [],
    botPosts: [],
    // Attachment bytes people sent, served at /attachments/<name>.
    files: new Map(),
    typing: 0,
    sockets: new Set(),
    socketUser: new Map(),
    identifies: 0,
    history: new Map(),
    webhookAllowed: true,
    // channel id -> the only bot token allowed to read it (a private channel).
    privateTo: new Map(),
    deniedPosts: new Map(),
    botUsers: new Map(),
    intentPatches: [],
    refuseIntent: new Set(),
    profilePatches: [],
    // Answers to pressed buttons: POST /interactions/<id>/<token>/callback.
    interactionAnswers: [],
    // Threads opened through the API: id -> the thread, and who opened it.
    threads: new Map(),
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
    if ((match = /^\/interactions\/(\d+)\/([^/]+)\/callback$/.exec(url.pathname)) && req.method === "POST") {
      state.interactionAnswers.push({ id: match[1], token: match[2], ...JSON.parse(String(body || "{}")) });
      res.writeHead(204);
      return res.end();
    }
    if ((match = /^\/attachments\/(.+)$/.exec(url.pathname)) && state.files.has(match[1])) {
      const file = state.files.get(match[1]);
      res.writeHead(200, { "Content-Type": file.type });
      return res.end(file.data);
    }
    if ((match = /^\/channels\/(\d+)\/messages$/.exec(url.pathname)) && req.method === "GET") {
      const only = state.privateTo.get(match[1]);
      const asking = String(req.headers.authorization || "").replace(/^Bot /, "");
      if (only && only !== asking) return json(res, 403, { message: "Missing Access", code: 50001 });
      return json(res, 200, [...(state.history.get(match[1]) || [])].reverse());
    }
    if ((match = /^\/channels\/(\d+)\/threads$/.exec(url.pathname)) && req.method === "POST") {
      const asked = JSON.parse(String(body || "{}"));
      const opener = state.botUsers.get(String(req.headers.authorization || "").replace(/^Bot /, "")) || { id: BOT, username: "Cora" };
      const thread = { id: id(), type: asked.type || 11, name: asked.name, parent_id: match[1], guild_id: GUILD, owner_id: opener.id, thread_metadata: { archived: false } };
      state.threads.set(thread.id, { ...thread, openedBy: opener.username });
      json(res, 201, thread);
      setTimeout(() => dispatch("THREAD_CREATE", thread), 20);
      return;
    }
    if ((match = /^\/channels\/(\d+)$/.exec(url.pathname)) && req.method === "GET") {
      const thread = state.threads.get(match[1]);
      if (thread) { const { openedBy, ...plain } = thread; return json(res, 200, plain); }
      if (match[1] === CHANNEL) return json(res, 200, { id: CHANNEL, type: 0, name: "general", guild_id: GUILD });
      return json(res, 404, { message: "Unknown Channel", code: 10003 });
    }
    if ((match = /^\/channels\/(\d+)\/webhooks$/.exec(url.pathname))) {
      if (!state.webhookAllowed) return json(res, 403, { message: "Missing Permissions" });
      if (req.method === "GET") return json(res, 200, []);
      return json(res, 200, { id: "500000000000000001", token: "webhook-token", name: "cora", application_id: BOT, channel_id: match[1] });
    }
    if ((match = /^\/webhooks\/(\d+)\/([^/]+)$/.exec(url.pathname)) && req.method === "POST") {
      const payload = discordForm(req, body);
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
    // A DM channel with a person: always the same one for the same person, numeric like Discord's.
    if (url.pathname === "/users/@me/channels" && req.method === "POST") {
      const recipient = JSON.parse(body.toString("utf8")).recipient_id;
      state.dms ??= new Map();
      if (!state.dms.has(recipient)) state.dms.set(recipient, id());
      return json(res, 200, { id: state.dms.get(recipient), type: 1, recipients: [{ id: recipient }] });
    }
    if (url.pathname === "/users/@me" && req.method === "PATCH") {
      const patch = JSON.parse(body.toString("utf8"));
      state.profilePatches.push({ token, username: patch.username, avatar: Boolean(patch.avatar) });
      if (patch.username) caller.username = patch.username;
      return json(res, 200, { ...caller, bot: true });
    }
    if ((match = /^\/channels\/(\d+)\/messages$/.exec(url.pathname)) && req.method === "POST") {
      if (state.deniedPosts.get(match[1])?.has(token)) return json(res, 403, { message: "Missing Access", code: 50001 });
      const payload = discordForm(req, body);
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
    /** An event only one bot's connection receives, like a thread created in a channel only that bot can see. */
    dispatchTo(botUserId, type, data) {
      for (const [socket, user] of state.socketUser) if (user?.id === botUserId) send(socket, { op: 0, t: type, s: ++seq, d: data });
    },
    /** A message in a channel only one bot can see: only that bot's connection receives it. */
    sayTo({ content, botUserId, channel, author = OWNER, username = "Sam", guild = GUILD, bot = false }) {
      counter += 1;
      const message = {
        id: id(), type: 0, channel_id: channel, guild_id: guild, content, attachments: [], embeds: [], mentions: [],
        author: { id: author, username, global_name: username, bot }, timestamp: new Date(Date.now() + counter).toISOString(),
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
    /** A file someone sends, served by this stand-in: what goes in a message's `attachments`. */
    attachment(filename, data, contentType) {
      state.files.set(filename, { data, type: contentType });
      return { id: id(), filename, url: `http://127.0.0.1:${port}/attachments/${filename}`, content_type: contentType, size: data.length };
    },
    /** A human (or bot) writes in a channel. */
    say({ content, author = OWNER, username = "Sam", channel = CHANNEL, guild = GUILD, bot = false, attachments = [], mentions = [], type = 0, flags = 0 }) {
      counter += 1;
      const message = {
        id: id(), type, flags, channel_id: channel, guild_id: guild, content, attachments, embeds: [], mentions,
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
      return res.end(JSON.stringify({ models: [
        { name: "test-model", size: 18_600_000_000, capabilities: ["completion", "tools"] },
        { name: "embed", capabilities: ["embedding"] },
        // A local Ollama also lists the cloud models it proxies.
        { name: "test-model-big:cloud", size: 0, capabilities: ["completion", "tools"] },
      ] }));
    }
    // A local Ollama answers /api/me with the account it is paired to, or refuses with
    // the link to pair it. `fakeOllama.cloud = false` is a machine nobody signed in on.
    if (url.pathname === "/api/me") {
      if (fakeOllama.cloud === false) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "unauthorized", signin_url: "https://ollama.com/connect?name=fixture" }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ name: "fixture" }));
    }
    if (url.pathname === "/api/version") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ version: "0.16.2" }));
    }
    // How much a model holds, only for the models a test gave a window to (`handle.context`).
    if (url.pathname === "/api/show") {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      const length = handle.context[body.model];
      if (!length) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "not found" }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ model_info: { "test.context_length": length }, capabilities: ["completion", "tools"] }));
    }
    if (url.pathname === "/api/pull") {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      calls.push({ pull: body.model });
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      if (fakeOllama.pullError) {
        res.end(`${JSON.stringify({ error: fakeOllama.pullError })}\n`);
        return;
      }
      res.write(`${JSON.stringify({ status: "pulling manifest" })}\n`);
      res.write(`${JSON.stringify({ status: "downloading", completed: 500, total: 1000 })}\n`);
      res.end(`${JSON.stringify({ status: "success" })}\n`);
      return;
    }
    if (url.pathname === "/api/ps") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ models: [{ name: "test-model", size: 18_600_000_000, size_vram: 17_100_000_000, expires_at: "2026-10-28T13:00:00Z" }] }));
    }
    // Embeddings that follow the letters a text is made of: close texts come out close, the same every time.
    if (url.pathname === "/api/embed") {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      calls.push({ embed: body.model, count: body.input.length });
      res.writeHead(body.model === "missing-embed" ? 404 : 200, { "Content-Type": "application/json" });
      if (body.model === "missing-embed") return res.end(JSON.stringify({ error: `model "${body.model}" not found` }));
      const vector = (text) => {
        const counts = new Array(26).fill(0);
        for (const char of String(text).normalize("NFD").toLowerCase()) { const index = char.charCodeAt(0) - 97; if (index >= 0 && index < 26) counts[index] += 1; }
        const norm = Math.sqrt(counts.reduce((sum, value) => sum + value * value, 0)) || 1;
        return counts.map((value) => value / norm);
      };
      return res.end(JSON.stringify({ model: body.model, embeddings: body.input.map(vector) }));
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
      // Ollama reports what the call used; the panel's heatmap is built from these.
      return res.end(JSON.stringify({ message: { role: "assistant", content: "", ...message }, done: true, prompt_eval_count: 120, eval_count: 30 }));
    }
    res.writeHead(404);
    res.end();
  });
  fakeOllama.current = reply;
  const port = await listen(server);
  const handle = {
    url: `http://127.0.0.1:${port}`,
    calls,
    context: {},
    setReply(fn) { fakeOllama.current = fn; },
    close() {
      server.closeAllConnections?.();
      return new Promise((resolve) => server.close(resolve));
    },
  };
  return handle;
}

/** A stand-in docker CLI: records its arguments and fakes the few commands cora uses. */
export function fakeDocker() {
  const dir = mkdtempSync(join(tmpdir(), "cora-docker-"));
  const log = join(dir, "calls.log");
  const script = join(dir, "docker");
  // Cora's Python on a desktop runs for real, against <dir>/desktops/cora-box-<agentId> as /home/agent.
  writeFileSync(join(dir, "python.mjs"), `import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const index = args.findIndex((arg) => arg.startsWith("cora-box-"));
const root = join(${JSON.stringify(dir)}, "desktops", args[index]);
mkdirSync(join(root, "work"), { recursive: true });
const at = args.indexOf("python3", index);
const script = args[at + 2].replaceAll("/home/agent", root);
const parameters = args.slice(at + 3).map((arg) => (arg.startsWith("/home/agent/") ? root + arg.slice("/home/agent".length) : arg));
spawn("python3", ["-c", script, ...parameters], { stdio: "inherit" }).on("exit", (code) => process.exit(code ?? 1));
`);
  // A desktop's own node script (the GitHub sign-in) runs for real too, with that desktop as its home.
  writeFileSync(join(dir, "node-desktop.mjs"), `import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const index = args.findIndex((arg) => arg.startsWith("cora-box-"));
const root = join(${JSON.stringify(dir)}, "desktops", args[index]);
mkdirSync(root, { recursive: true });
const script = args[args.indexOf("-e", index) + 1];
spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: "inherit", env: { ...process.env, HOME: root, GIT_CONFIG_NOSYSTEM: "1" } }).on("exit", (code) => process.exit(code ?? 1));
`);
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
      *" python3 -c "*) exec "${process.execPath}" "${dir}/python.mjs" "$@" ;;
      *github-token*) exec "${process.execPath}" "${dir}/node-desktop.mjs" "$@" ;;
      *cora_authorized_keys*) cat > "${dir}/authorized_keys"; exit 0 ;;
      *"tailscale status --json"*) if [ -f "${dir}/tailscale.json" ]; then cat "${dir}/tailscale.json"; else echo '{"BackendState":"NeedsLogin","AuthURL":""}'; fi; exit 0 ;;
      *"tailscale up"*) echo '{"BackendState":"NeedsLogin","AuthURL":"https://login.tailscale.com/a/test"}' > "${dir}/tailscale.json"; exit 0 ;;
      *"tailscale set"*) exit 0 ;;
      *cora-cdp*)
        if [ -f "${dir}/cdp" ]; then cat "${dir}/cdp"; exit 0; fi
        echo '{"url":"https://example.test/","title":"Esempio","text":"ciao dal browser"}'; exit 0 ;;
    esac
    for last; do :; done
    echo "ran: $last"; exit 0 ;;
esac
exit 0
`);
  chmodSync(script, 0o755);
  return { path: script, log, dir, desktop: (agentId) => join(dir, "desktops", `cora-box-${agentId}`) };
}

/**
 * A stand-in doc: the two modules Cora runs, with doc's input and answer shapes. It
 * stops a reply carrying STIMA-DI-PROVA or INCOLLA-QUI-IL-TOKEN, denies a comment
 * with a /home/ path and holds one marked DA-RICONTROLLARE; every call is logged.
 */
export function fakeDoc() {
  const root = mkdtempSync(join(tmpdir(), "cora-doc-"));
  const log = join(root, "calls.jsonl");
  mkdirSync(join(root, "doc"));
  writeFileSync(join(root, "doc", "__init__.py"), "");
  const record = `import json, os, sys, time
payload = json.load(sys.stdin)
def note(outcome):
    log = os.environ.get("DOC_USAGE_LOG")
    if log:
        with open(log, "a") as usage:
            if os.environ.get("TYPESAFE_API_KEY"):
                usage.write(json.dumps({"ts": int(time.time()), "purpose": "check", "input_tokens": 100, "ms": 5}) + "\\n")
            usage.write(json.dumps({"ts": int(time.time()), "purpose": "check", "outcome": outcome, "agent": "claude"}) + "\\n")
with open(${JSON.stringify(log)}, "a") as calls:
    calls.write(json.dumps({"module": __name__.split(".")[-1] if __name__ != "__main__" else os.path.basename(__file__)[:-3], "payload": payload, "key": os.environ.get("TYPESAFE_API_KEY", "")}) + "\\n")
`;
  writeFileSync(join(root, "doc", "reply_check.py"), `${record}
text = payload.get("last_assistant_message") or ""
try:
    settings = json.load(open(os.environ["DOC_RULES"]))
except Exception:
    settings = {}
off = set(settings.get("off") or [])
asks_secret = "INCOLLA-QUI-IL-TOKEN" in text and "reply:secret_request" not in off
mine = [rule for rule in settings.get("add") or [] if rule.get("enabled", True) and "reply" in rule.get("on", []) and "ACME" in text]
blocked = "STIMA-DI-PROVA" in text or asks_secret or bool(mine) or ("giorni di sviluppo" in text and os.environ.get("TYPESAFE_API_KEY"))
note("blocked" if blocked else "passed")
if mine:
    print(json.dumps({"decision": "block", "reason": "doc: your last reply %s (0.95), which the user's rules forbid. %s" % (mine[0]["reason"], mine[0]["fix"])}))
elif blocked:
    print(json.dumps({"decision": "block", "reason": "doc: your last reply breaks a rule (0.99), which the user's rules forbid. Rewrite it."}))
`);
  writeFileSync(join(root, "doc", "publish_guard.py"), `${record}
command = (payload.get("tool_input") or {}).get("command") or ""
decision = "deny" if "/home/" in command else "ask" if "DA-RICONTROLLARE" in command else ""
note(decision or "allow")
if decision:
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": decision, "permissionDecisionReason": "doc: this comment breaks the publishing rules: it contains local paths."}}))
`);
  // The built-in rules it lists, and a draft rule's score: high when the text names ACME.
  writeFileSync(join(root, "doc", "rules.py"), `import json, os, sys
if sys.argv[1:2] == ["try"]:
    request = json.load(sys.stdin)
    if not os.environ.get("TYPESAFE_API_KEY"):
        print(json.dumps({"error": "TYPESAFE_API_KEY is not set"}))
    else:
        print(json.dumps({"score": 0.95 if "ACME" in (request.get("text") or "") else 0.05}))
else:
    print(json.dumps([{"key": "effort", "on": "reply", "reason": "gives an effort or time estimate for work"},
                      {"key": "secret_request", "on": "reply", "reason": "asks the user to paste a secret into the chat"},
                      {"key": "local_state", "on": "comment", "reason": "it describes local or unpushed state"}]))
`);
  const calls = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
  return { root, calls };
}

/** A short 16-bit mono WAV: a tone of `seconds`, what the fake Soniox speaks. */
export function toneWav(seconds = 0.6, rate = 24000) {
  const samples = Math.round(seconds * rate);
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + samples * 2, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) wav.writeInt16LE(Math.round(Math.sin(index / 9) * 8000 * Math.min(1, index / 2000)), 44 + index * 2);
  return wav;
}

/**
 * Stand-in Soniox: the files and async transcription API, the voice catalog, the key check and
 * text to speech. `state.transcripts` is what the next transcriptions say; requests are recorded.
 */
export async function fakeSoniox({ key = "soniox-test" } = {}) {
  const state = { transcripts: [], text: "testo trascritto", language: "it", uploads: [], transcriptions: [], speech: [], deleted: [], next: 1 };
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const json = (status, value) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(value === undefined ? "" : JSON.stringify(value)); };
    if (req.headers.authorization !== `Bearer ${key}`) return json(401, { message: "invalid api key" });
    const url = new URL(req.url, "http://x");
    let match;
    if (req.method === "GET" && url.pathname === "/v1/models") return json(200, { models: [{ id: "stt-async-v5" }] });
    if (req.method === "GET" && url.pathname === "/v1/tts-models") {
      return json(200, { models: [{ id: "tts-rt-v2", voices: [
        { id: "Grace", gender: "female", languages: ["en"], description: "Unhurried American guide voice." },
        { id: "Giulia", gender: "female", languages: ["it"], description: "A young Italian female voice." },
        { id: "Marco", gender: "male", languages: ["it"], description: "A young Italian male voice." },
      ] }] });
    }
    if (req.method === "POST" && url.pathname === "/v1/files") {
      const id = `file-${state.next++}`;
      state.uploads.push({ id, bytes: body.length, type: String(req.headers["content-type"] || "") });
      return json(201, { id, filename: "voice", size: body.length });
    }
    if (req.method === "POST" && url.pathname === "/v1/transcriptions") {
      const request = JSON.parse(body.toString("utf8"));
      const id = `tr-${state.next++}`;
      state.transcriptions.push({ id, ...request, text: state.transcripts.length ? state.transcripts.shift() : state.text });
      return json(201, { id, status: "queued" });
    }
    if ((match = /^\/v1\/transcriptions\/([\w-]+)(\/transcript)?$/.exec(url.pathname))) {
      const transcription = state.transcriptions.find((item) => item.id === match[1]);
      if (!transcription) return json(404, { message: "not found" });
      if (req.method === "DELETE") { state.deleted.push(match[1]); return json(204); }
      if (match[2]) return json(200, { id: transcription.id, text: transcription.text, tokens: [{ text: transcription.text, language: state.language }] });
      return json(200, { id: transcription.id, status: "completed", audio_duration_ms: 1200 });
    }
    if (req.method === "DELETE" && (match = /^\/v1\/files\/([\w-]+)$/.exec(url.pathname))) { state.deleted.push(match[1]); return json(204); }
    if (req.method === "POST" && url.pathname === "/tts") {
      const request = JSON.parse(body.toString("utf8"));
      state.speech.push(request);
      res.writeHead(200, { "Content-Type": request.audio_format === "mp3" ? "audio/mpeg" : "application/octet-stream" });
      return res.end(request.audio_format === "mp3" ? Buffer.concat([Buffer.from("ID3"), Buffer.alloc(600, 1)]) : toneWav());
    }
    json(404, { message: "no route" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { url: base, ttsUrl: `${base}/tts`, key, state, close: () => new Promise((resolve) => server.close(resolve)) };
}

export function tempHome() {
  return mkdtempSync(join(tmpdir(), "cora-home-"));
}

/**
 * Stand-in `claude`, `codex`, `grok`, `muse` and `hermes` CLIs. They log their arguments, start the MCP
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
if (flavor === "claude" && argv[0] === "auth" && argv[1] === "status") {
  process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", configDirectory: process.env.CLAUDE_CONFIG_DIR, email: "fixture@example.test" }));
  process.exit(0);
}
if (flavor === "gemini" && argv.includes("/usage")) {
  const options = fs.existsSync(${JSON.stringify(control)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(control)}, "utf8")) : {};
  if (options.geminiUsage || options.geminiUsageFailed) fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ flavor: "gemini-usage", argv, home: process.env.HOME, scope: process.env.ANTIGRAVITY_CREDENTIAL_SCOPE }) + "\\n");
  process.stdout.write(JSON.stringify(options.geminiUsage || { status: "SUCCESS", response: "Account: fixture@example.test" }));
  process.exit(options.geminiUsageFailed ? 1 : 0);
}
if (flavor === "codex" && argv.includes("debug") && argv.includes("models")) {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ flavor: "codex-catalog", argv, home: process.env.CODEX_HOME }) + "\\n");
  process.stdout.write(JSON.stringify({ models: [{ slug: "gpt-6.1-terra", display_name: "GPT-6.1 Terra", visibility: "list", priority: 1 }, { slug: "gpt-6-sol", display_name: "GPT-6-Sol", visibility: "list", priority: 2 }, { slug: "gpt-reserve", display_name: "GPT-Reserve", visibility: "hide", priority: 3 }] }));
  process.exit(0);
}
if (flavor === "grok" && argv[0] === "models") {
  process.stdout.write("You are logged in with grok.com.\\nDefault model: grok-4.8\\nAvailable models:\\n  * grok-4.8 (default)\\n  - grok-4.7-build-fast\\n");
  process.exit(0);
}
if (flavor === "muse" && argv[0] === "serve") {
  let pending = "";
  process.stdin.on("data", (chunk) => {
    pending += chunk;
    let end;
    while ((end = pending.indexOf("\\n")) >= 0) {
      const message = JSON.parse(pending.slice(0, end));
      pending = pending.slice(end + 1);
      if (message.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }) + "\\n");
      if (message.method === "model/list") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { source: "providerCatalog", models: [{ modelId: "muse-wonder-1.1", displayLabel: "Muse Wonder 1.1" }] } }) + "\\n");
    }
  });
  return;
}
if (flavor === "gemini" && argv[0] === "models") {
  process.stdout.write("gemini-4-argon-high  Gemini 4 Argon (High)\\ngemini-3.8-flash-medium  Gemini 3.8 Flash (Medium)\\n");
  process.exit(0);
}
const countCalls = (file, kind) => {
  try {
    return fs.readFileSync(file, "utf8").split("\\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.flavor === kind).length;
  } catch { return 0; }
};
const control = JSON.parse(fs.readFileSync(${JSON.stringify(control)}, "utf8"));
// control.runs: one { reply, tool, args } per run of this CLI, counting from control.from runs.
if (control.runs) Object.assign(control, { tool: null, args: null }, control.runs[Math.min(countCalls(${JSON.stringify(log)}, flavor) - (control.from || 0), control.runs.length - 1)]);
let stdin = "";
let acp = null;
const handle = async () => {
  let server = null;
  let hermesConfig = null;
  let hermes = null;
  let grokConfig = null;
  let dshPatch = null;
  let geminiSettings = null;
  let geminiMcp = null;
  if (flavor === "claude") {
    const index = argv.indexOf("--mcp-config");
    if (index >= 0) server = JSON.parse(fs.readFileSync(argv[index + 1], "utf8")).mcpServers.cora;
  } else if (flavor === "hermes") {
    // Hermes reads config.yaml in HERMES_HOME and fills \${...} from its own environment.
    hermesConfig = fs.readFileSync(path.join(process.env.HERMES_HOME, "config.yaml"), "utf8");
    const fill = (value) => value.replace(/\\$\\{(\\w+)\\}/g, (_, key) => process.env[key] || "");
    const pick = (pattern) => JSON.parse(hermesConfig.match(pattern)[1]);
    // Like Hermes, the session and the assistant's tool-call turn are recorded before the tool runs.
    if (!control.hermesRefusal) {
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(path.join(process.env.HERMES_HOME, "state.db"));
      db.exec("PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, source TEXT, started_at REAL); CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, tool_calls TEXT, tool_name TEXT, reasoning TEXT, reasoning_content TEXT)");
      const session = "fixture_" + process.pid + "_" + Date.now();
      const add = (row) => db.prepare("INSERT INTO messages (session_id, role, content, tool_calls, tool_name, reasoning, reasoning_content) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(session, row.role, row.content ?? null, row.tool_calls ?? null, row.tool_name ?? null, row.reasoning ?? null, row.reasoning ?? null);
      db.prepare("INSERT INTO sessions (id, source, started_at) VALUES (?, 'cli', ?)").run(session, Date.now() / 1000);
      add({ role: "user", content: argv.includes("--query-file") ? stdin : argv[argv.indexOf("-z") + 1] });
      if (control.tool) add({ role: "assistant", content: "Prima controllo.", reasoning: control.thinking || "Penso.", tool_calls: JSON.stringify([{ id: "call_1", type: "function", function: { name: "mcp__cora__" + control.tool, arguments: JSON.stringify(control.args || {}) } }]) });
      hermes = { db, session, add };
    }
    if ((argv[argv.indexOf("-t") + 1] || "").split(",").includes("cora")) {
      server = {
        command: pick(/^    command: (.*)$/m), args: [pick(/^      - (.*)$/m)],
        env: { CORA_BRIDGE_URL: fill(pick(/CORA_BRIDGE_URL: (.*)$/m)), CORA_BRIDGE_TOKEN: fill(pick(/CORA_BRIDGE_TOKEN: (.*)$/m)) },
      };
    }
  } else if (flavor === "grok") {
    // Grok reads its MCP servers from config.toml in GROK_HOME and fills \${...} from its own environment.
    const toml = fs.readFileSync(path.join(process.env.GROK_HOME, "config.toml"), "utf8");
    grokConfig = toml;
    const fill = (value) => value.replace(/\\$\\{(\\w+)\\}/g, (_, key) => process.env[key] || "");
    if ((argv[argv.indexOf("--tools") + 1] || "").split(",").includes("use_tool")) {
      server = {
        command: JSON.parse(toml.match(/^command = (.*)$/m)[1]), args: JSON.parse(toml.match(/^args = (.*)$/m)[1]),
        env: { CORA_BRIDGE_URL: fill("\${CORA_BRIDGE_URL}"), CORA_BRIDGE_TOKEN: fill("\${CORA_BRIDGE_TOKEN}") },
      };
    }
  } else if (flavor === "dsh") {
    // dsh boots its headless profile with Cora's --patch overlay: the MCP row runs the server, its env from dsh's own environment.
    dshPatch = fs.readFileSync(argv[argv.indexOf("--patch") + 1], "utf8");
    const command = dshPatch.match(/^        command: (.*)$/m);
    if (command) {
      server = { command: JSON.parse(command[1]), args: JSON.parse(dshPatch.match(/^        args: (.*)$/m)[1]),
        env: { CORA_BRIDGE_URL: process.env.CORA_BRIDGE_URL || "", CORA_BRIDGE_TOKEN: process.env.CORA_BRIDGE_TOKEN || "" } };
    }
  } else if (flavor === "gemini") {
    // Antigravity over ACP reads its settings and MCP servers from the --gemini-dir of this run.
    const dir = argv[argv.indexOf("--gemini-dir") + 1];
    geminiSettings = JSON.parse(fs.readFileSync(path.join(dir, "antigravity-cli", "settings.json"), "utf8"));
    geminiMcp = JSON.parse(fs.readFileSync(path.join(dir, "config", "mcp_config.json"), "utf8"));
    server = geminiMcp.mcpServers.cora;
  } else if (flavor === "muse") {
    // Muse takes the server for this run in -c and fills \${...} in its env from its own environment.
    const item = argv.find((arg) => arg.startsWith("mcpServers.cora="));
    if (item) {
      const config = JSON.parse(item.slice("mcpServers.cora=".length));
      const fill = (value) => value.replace(/\\$\\{(\\w+)\\}/g, (_, key) => process.env[key] || "");
      server = { command: config.command, args: config.args, env: Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, fill(value)])) };
    }
  } else {
    const value = (key) => { const item = argv.find((arg) => arg.startsWith("mcp_servers.cora." + key + "=")); return item ? item.slice(("mcp_servers.cora." + key + "=").length) : null; };
    if (value("command")) {
      const env = {};
      for (const [, k, v] of value("env").matchAll(/(\\w+) = ("[^"]*")/g)) env[k] = JSON.parse(v);
      server = { command: JSON.parse(value("command")), args: JSON.parse(value("args")), env };
    }
  }
  if (control.failFirst && countCalls(${JSON.stringify(log)}, flavor) < control.failFirst) {
    fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ flavor, argv, stdin, failed: true, tools: null, output: null, hermesConfig: null, secretEnv: [] }) + "\\n");
    process.stderr.write("Selected model is at capacity. Please try a different model.\\n");
    process.exit(1);
  }
  // Grok and Muse read the prompt from a file Cora deletes after the run: keep it as the run's input.
  const promptFile = argv.indexOf("--prompt-file") >= 0 ? argv[argv.indexOf("--prompt-file") + 1] : "";
  if (promptFile) stdin = fs.readFileSync(promptFile, "utf8");
  const env = Object.fromEntries(["HOME", "GROK_HOME", "GROK_AUTH_PATH", "GROK_CLAUDE_MCPS_ENABLED", "GROK_CLAUDE_HOOKS_ENABLED", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "TBH_CREDENTIAL_BACKEND", "MISE_DATA_DIR"].map((key) => [key, process.env[key] || ""]));
  if (flavor === "dsh") Object.assign(env, { DSH_HOME: process.env.DSH_HOME || "", DSH_TELEMETRY_MODE: process.env.DSH_TELEMETRY_MODE || "", DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ? "set" : "" });
  const providerKeyLast4 = flavor === "dsh" ? String(process.env.DEEPSEEK_API_KEY || "").slice(-4) : "";
  const record = { flavor, argv, stdin, env, cwd: process.cwd(), geminiSettings, geminiMcp, acp: acp && { model: acp.model, thoughtLevel: acp.thoughtLevel }, scope: process.env.ANTIGRAVITY_CREDENTIAL_SCOPE, tools: null, output: null, hermesConfig, grokConfig, dshPatch, hermesHome: process.env.HERMES_HOME || "", endpointKey: process.env.CORA_ENDPOINT_KEY ? "set" : "", endpointKeyLast4: String(process.env.CORA_ENDPOINT_KEY || "").slice(-4), providerKeyLast4, secretEnv: Object.keys(process.env).filter((key) => /^COR[AO]_(BOT|KNOWLEDGE|GH_KEY)_/.test(key) || key === "GEMINI_API_KEY" || key === "GOOGLE_API_KEY" || key === "BRAIN_DATABASE_URL" || key === "DISCORD_BOT_TOKEN" || key === "ORCAROUTER_API_KEY" || key === "OLLAMA_API_KEY") };
  if (control.hang) {
    fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ ...record, pid: process.pid }) + "\\n");
    setInterval(() => {}, 1000);
    return;
  }
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
    record.content = call.result.content;
    child.kill();
  }
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(record) + "\\n");
  if (control.exitBeforeReply) process.exit(control.exitBeforeReply);
  if (control.killAfterTool) { process.kill(process.pid, "SIGTERM"); return; }
  const answer = control.reply + (record.output ? " [" + record.output + "]" : "");
  const line = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
  if (flavor === "hermes") {
    // Hermes records the session in HERMES_HOME/state.db as it goes and, with --usage-file, reports its id.
    const usageFile = argv.includes("--usage-file") ? argv[argv.indexOf("--usage-file") + 1] : "";
    if (control.hermesRefusal) {
      if (usageFile) fs.writeFileSync(usageFile, JSON.stringify({ session_id: null, completed: false, failed: true }));
      process.stdout.write(control.hermesRefusal + "\\n");
      if (argv.includes("--query-file")) process.exitCode = 1;
      return;
    }
    if (control.tool) {
      hermes.add({ role: "tool", content: record.output, tool_name: "mcp__cora__" + control.tool });
      hermes.add({ role: "assistant", content: answer, reasoning: control.hermesFinalThought || null });
    } else hermes.add({ role: "assistant", content: answer, reasoning: control.thinking || null });
    hermes.db.close();
    if (usageFile) fs.writeFileSync(usageFile, JSON.stringify({ session_id: hermes.session, completed: true, failed: false, input_tokens: 100, output_tokens: 20 }));
    if (control.hermesWarning) process.stdout.write(control.hermesWarning + "\\n");
    if (argv.includes("--query-file")) process.stderr.write("session_id: " + hermes.session + "\\n");
    process.stdout.write(answer + "\\n");
  } else if (flavor === "grok") {
    const session = "fixture-" + process.pid;
    fs.mkdirSync(path.join(process.env.GROK_HOME, "sessions", "work", session), { recursive: true });
    line({ type: "system", subtype: "init", session_id: session, tools: ["search_tool", "use_tool"] });
    line({ type: "assistant", message: { content: [{ type: "thinking", thinking: control.thinking || "Penso." }] } });
    if (control.tool) {
      line({ type: "assistant", message: { content: [{ type: "text", text: "Prima controllo." }] } });
      line({ type: "assistant", message: { content: [{ type: "tool_use", name: "use_tool", input: { tool_name: "cora__" + control.tool, tool_input: control.args || {} } }] } });
    }
    line({ type: "assistant", message: { content: [{ type: "text", text: answer }] } });
    line({ type: "result", subtype: "success", is_error: false, result: answer, usage: { input_tokens: 70, cache_read_input_tokens: 30, output_tokens: 12 } });
  } else if (flavor === "dsh") {
    line({ type: "session", sessionId: "session-fixture", cwd: process.cwd() });
    line({ type: "status", phase: "turn_start", turn: 1 });
    if (control.thinking) line({ type: "thinking", text: control.thinking });
    if (control.tool) {
      line({ type: "text", text: "Prima controllo." });
      line({ type: "tool_call", callId: "toolu_1", tool: "mcp__cora__" + control.tool, input: control.args || {} });
      line({ type: "tool_result", callId: "toolu_1", status: "completed", result: record.output });
      // DeepSeek often answers a plain step after a tool with an empty thinking block.
      if (control.thinking) line({ type: "thinking", text: "" });
    }
    line({ type: "text", text: answer });
    const usages = control.dshUsages || [{ inputTokens: 90, outputTokens: 11, totalTokens: 101 }];
    for (let index = 0; index < usages.length; index += 1) {
      line({ type: "status", phase: "step_start", turn: 1, step: index + 1 });
      line({ type: "status", phase: "step_end", turn: 1, step: index + 1, ...(usages[index] ? { usage: usages[index] } : {}) });
    }
    if (control.dshPauseMs) await new Promise(resolve => setTimeout(resolve, control.dshPauseMs));
    if (control.dshError) { line({ type: "error", message: "fixture dsh error" }); process.exit(1); }
    line({ type: "status", phase: "turn_end", turn: 1, reason: { kind: "completed" } });
    line({ type: "final", text: answer });
  } else if (flavor === "muse") {
    const event = (payload_type, payload) => line({ schema_version: 1, payload_type, payload });
    if (control.tool) {
      event("run.output.delta", { text: "Prima " });
      event("run.output.delta", { text: "controllo." });
      event("task.lifecycle.proposed", { event: { kind: "proposed", task_kind: "tool.mcp__cora__" + control.tool } });
      event("tool.result", { text: record.output, correlation_facts: { tool_name: "mcp__cora__" + control.tool, outcome: "success" } });
    }
    event("run.output.delta", { text: answer });
    event("run.usage", { models: [{ model: "muse-wonder-1.0", input_tokens: 80, cached_tokens: 20, output_tokens: 9, reasoning_tokens: 3 }] });
    event("run.terminal.completed", { terminal: "completed", text: answer, reason: null });
  } else if (flavor === "gemini") {
    const update = (value) => line({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "fixture-gemini", update: value } });
    const say = (text) => update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
    if (control.thinking) for (const part of [control.thinking.slice(0, 5), control.thinking.slice(5)]) update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: part } });
    if (control.tool) {
      say("Prima controllo.");
      update({ sessionUpdate: "tool_call", toolCallId: "call_1", name: "mcp_cora_" + control.tool, status: "in_progress" });
      update({ sessionUpdate: "tool_call_update", toolCallId: "call_1", name: "mcp_cora_" + control.tool, status: "completed" });
    }
    // Antigravity reports a failed turn, a spent quota included, as a warning line in the answer.
    if (control.error) say("\\n\u26a0 " + control.error + "\\n");
    else { say(answer.slice(0, 4)); say(answer.slice(4)); }
    if (control.missingFinal || control.exitCode) process.exit(control.exitCode || 0);
    line({ jsonrpc: "2.0", id: acp.id, result: { stopReason: "end_turn", usage: { inputTokens: 70, cachedReadTokens: 30, outputTokens: 12, thoughtTokens: 8 } } });
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
    // control.crash: the CLI dies after the agent has answered, writing no output file.
    if (control.crash) process.exit(1);
    fs.writeFileSync(argv[argv.indexOf("-o") + 1], answer);
  }
};
if (flavor === "gemini" && argv[0] === "acp") {
  // Antigravity's ACP server: answer the handshake, then run the turn when the prompt arrives.
  const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
  acp = {};
  require("node:readline").createInterface({ input: process.stdin }).on("line", (text) => {
    const message = JSON.parse(text);
    if (message.method === "initialize") reply(message.id, { protocolVersion: 1, agentCapabilities: {} });
    else if (message.method === "session/new") reply(message.id, { sessionId: "fixture-gemini" });
    else if (message.method === "session/set_model") { acp.model = message.params.modelId; reply(message.id, {}); }
    else if (message.method === "session/set_config_option") { acp.thoughtLevel = message.params.value; reply(message.id, {}); }
    else if (message.method === "session/prompt") {
      acp.id = message.id;
      stdin = message.params.prompt.map((part) => part.text || "").join("");
      handle();
    }
  }).on("close", () => setTimeout(() => process.exit(0), 50));
} else {
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => { stdin += d; });
  process.stdin.on("end", handle);
}
`;
  for (const name of ["claude", "codex", "grok", "muse", "gemini", "hermes", "dsh"]) {
    writeFileSync(join(dir, name), source);
    chmodSync(join(dir, name), 0o755);
  }
  const models = join(dir, "models_cache.json");
  writeFileSync(models, JSON.stringify({ models: [{ slug: "gpt-6-sol", visibility: "list" }, { slug: "hidden", visibility: "hide" }] }));
  return {
    claude: join(dir, "claude"),
    codex: join(dir, "codex"),
    grok: join(dir, "grok"),
    muse: join(dir, "muse"),
    gemini: join(dir, "gemini"),
    hermes: join(dir, "hermes"),
    dsh: join(dir, "dsh"),
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
    memberStates: new Map(),
    errors: new Map(),
    nextUpdate: 1,
    nextMessage: 5000,
    waiting: new Set(),
    // Files people sent, by file_id: what getFile and /file/ serve.
    files: new Map(),
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
      const sent = state.files.get(url.pathname.split("/").pop());
      res.writeHead(200, { "Content-Type": sent ? "application/octet-stream" : "image/jpeg" });
      return res.end(sent || Buffer.from("fake-jpeg"));
    }
    const match = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname);
    if (!match) return fail(res, 404, "Not Found");
    const [, token, method] = match;
    const bot = state.bots.get(token);
    if (!bot) return fail(res, 401, "Unauthorized");
    const failure = state.errors.get(`${token}:${method}`);
    if (failure) return fail(res, failure.status, failure.description);
    let params = {};
    if (String(req.headers["content-type"]).startsWith("multipart/")) {
      const text = body.toString("latin1");
      for (const [, name, value] of text.matchAll(/name="(\w+)"\r\n\r\n([^\r]*)\r\n/g)) params[name] = value;
      params.file = /name="(photo|document|voice|audio)"; filename="([^"]+)"/.exec(text)?.slice(1, 3) || null;
    } else if (body.length) params = JSON.parse(body.toString("utf8"));
    const message = (extra) => ({ message_id: state.nextMessage++, date: Math.floor(Date.now() / 1000), chat: { id: Number(params.chat_id) }, from: { ...bot, is_bot: true }, ...extra });
    switch (method) {
      case "getMe": return ok(res, { ...bot, is_bot: bot.is_bot ?? true });
      case "getUpdates": {
        // Like Telegram, a bot gets only the updates meant for it: those pushed once it existed, or sent to it.
        const pending = () => state.updates.filter((update) => update.update_id >= (params.offset || 0) && update.to.includes(token));
        const deliver = () => ok(res, pending().map(({ to: _to, ...update }) => update));
        if (pending().length) return deliver();
        const waiter = { deliver, timer: null };
        waiter.timer = setTimeout(() => { state.waiting.delete(waiter); deliver(); }, (params.timeout || 0) * 1000);
        state.waiting.add(waiter);
        req.on("close", () => { clearTimeout(waiter.timer); state.waiting.delete(waiter); });
        return;
      }
      case "sendMessage":
      case "sendPhoto":
      case "sendDocument":
      case "sendVoice":
      case "sendAudio": {
        state.sent.push({ token, method, ...params });
        return ok(res, message({ text: params.text || params.caption || "" }));
      }
      case "sendChatAction": return ok(res, true);
      case "setMyName": state.names.push({ token, name: params.name }); return ok(res, true);
      case "getChatAdministrators": return ok(res, [{ status: "creator", user: { id: Number(TG_OWNER), first_name: "Seb" } }]);
      case "getChatMember": return ok(res, state.memberStates.get(`${params.chat_id}:${params.user_id}`) || { status: state.members.has(`${params.chat_id}:${params.user_id}`) ? "member" : "left" });
      case "getFile": {
        const sent = state.files.get(params.file_id);
        return ok(res, sent ? { file_id: params.file_id, file_path: `voice/${params.file_id}`, file_size: sent.length } : { file_id: params.file_id, file_path: "photos/1.jpg", file_size: 9 });
      }
      default: return fail(res, 400, `Bad Request: unknown method ${method}`);
    }
  });
  const port = await listen(server);
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    addBot(token, user) { state.bots.set(token, user); },
    /** A file someone sends (a voice note, say): its file_id for a message. */
    file(id, data) { state.files.set(id, data); return id; },
    /** A message in a chat, heard by every bot there is (a group), or only by `to` (a private chat with one bot). */
    push(message, { to = [...state.bots.keys()] } = {}) {
      state.updates.push({ update_id: state.nextUpdate++, to, message: { message_id: state.nextMessage++, date: Math.floor(Date.now() / 1000), ...message } });
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

export const SLACK_TEAM = "T0000000001";
export const SLACK_CHANNEL = "C0000000001";
export const SLACK_OTHER_CHANNEL = "C0000000002";
export const SLACK_DM = "D0000000001";
export const SLACK_OWNER = "U0000000001";
export const SLACK_STRANGER = "U0000000002";

/** A stand-in Slack: the Web API over HTTP and Socket Mode over WebSocket. */
export async function fakeSlack() {
  const state = {
    apps: new Map(),
    posts: [],
    uploads: [],
    reactions: [],
    sockets: new Map(),
    acks: [],
    opens: 0,
    users: new Map([
      [SLACK_OWNER, { id: SLACK_OWNER, name: "sam", real_name: "Sam", is_owner: true, is_primary_owner: true }],
      [SLACK_STRANGER, { id: SLACK_STRANGER, name: "kim", real_name: "Kim" }],
    ]),
    channels: new Map([
      [SLACK_CHANNEL, { id: SLACK_CHANNEL, name: "generale" }],
      [SLACK_OTHER_CHANNEL, { id: SLACK_OTHER_CHANNEL, name: "clienti" }],
      [SLACK_DM, { id: SLACK_DM, name: "", is_im: true }],
    ]),
    history: new Map(),
    // Files people shared, served at /files/<name> to any app's bot token.
    files: new Map(),
    // What getUploadURLExternal was asked for, in order.
    slots: [],
    nextTs: 100,
    // App configuration: the refresh tokens Slack still accepts, the access tokens it issued, each app's manifest, and every call.
    refreshTokens: new Set(),
    configTokens: new Set(),
    manifests: new Map(),
    icons: new Map(),
    // The refusal the next icons get, as Slack names it ("" = accepted).
    iconError: "",
    configCalls: [],
    rotations: 0,
  };
  const ok = (res, body) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, ...body }));
  };
  const fail = (res, error) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error }));
  };
  const appFor = (req, kind = "bot") => {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    for (const app of state.apps.values()) if ((kind === "bot" ? app.botToken : app.appToken) === token) return app;
    return null;
  };
  // Slack stamps a message with the second it arrived and a counter, so order follows the clock.
  const ts = () => `${Math.floor(Date.now() / 1000)}.${String(state.nextTs++).padStart(6, "0")}`;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const body = await readBody(req);
    if (url.pathname.startsWith("/upload/")) {
      state.uploads.push({ fileId: url.pathname.slice(8), bytes: body.length, type: /Content-Type: ([^\r]+)/i.exec(body.toString("latin1"))?.[1] || "" });
      res.writeHead(200);
      return res.end("ok");
    }
    if (url.pathname.startsWith("/files/") && state.files.has(url.pathname.slice(7))) {
      if (!appFor(req)) { res.writeHead(403); return res.end(); }
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      return res.end(state.files.get(url.pathname.slice(7)));
    }
    const method = url.pathname.replace("/api/", "");
    const params = Object.fromEntries(new URLSearchParams(body.toString("utf8")));
    if (method === "tooling.tokens.rotate") {
      if (!state.refreshTokens.delete(params.refresh_token)) return fail(res, "invalid_refresh_token");
      state.rotations += 1;
      const token = `xoxe.xoxp-1-config-${state.rotations}`;
      const refresh = `xoxe-1-refresh-${state.rotations}`;
      state.configTokens.add(token);
      state.refreshTokens.add(refresh);
      return ok(res, { token, refresh_token: refresh, team_id: SLACK_TEAM, user_id: SLACK_OWNER, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 43200 });
    }
    if (method.startsWith("apps.manifest.") || method === "apps.icon.set") {
      if (!state.configTokens.has(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""))) return fail(res, "invalid_auth");
      const appEntry = [...state.apps.values()].find((entry) => `A${entry.id.slice(1)}` === params.app_id);
      if (!appEntry) return fail(res, "invalid_app_id");
      state.configCalls.push({ method, appId: params.app_id, ...(params.manifest ? { manifest: JSON.parse(params.manifest) } : {}), ...(params.url ? { url: params.url } : {}) });
      if (method === "apps.manifest.export") {
        return ok(res, { manifest: state.manifests.get(params.app_id) || {
          display_information: { name: appEntry.name, description: "creata a mano" },
          features: { bot_user: { display_name: appEntry.name, always_online: true } },
          settings: { socket_mode_enabled: true },
        } });
      }
      if (method === "apps.manifest.update") {
        state.manifests.set(params.app_id, JSON.parse(params.manifest));
        return ok(res, { app_id: params.app_id, permissions_updated: false });
      }
      if (state.iconError) return fail(res, state.iconError);
      if (/^https:\/\//.test(params.url || "")) {
        state.icons.set(params.app_id, params.url);
        return ok(res, {});
      }
      return fail(res, "icon_not_accessible");
    }
    const app = appFor(req, method === "apps.connections.open" ? "app" : "bot");
    if (!app) return fail(res, "invalid_auth");
    switch (method) {
      case "auth.test":
        return ok(res, { user_id: app.id, user: app.name, bot_id: `B${app.id.slice(1)}`, team_id: SLACK_TEAM, team: "Dopamina", url: "https://dopamina.slack.com/" });
      case "bots.info":
        return ok(res, { bot: { id: params.bot, app_id: `A${params.bot.slice(1)}`, name: app.name } });
      case "apps.connections.open":
        state.opens += 1;
        return ok(res, { url: `ws://127.0.0.1:${server.address().port}/link?t=${encodeURIComponent(app.appToken)}` });
      case "users.conversations":
        return ok(res, { channels: [...app.channels].map((id) => ({ ...state.channels.get(id) })), response_metadata: { next_cursor: "" } });
      case "conversations.info": {
        const channel = state.channels.get(params.channel);
        return channel ? ok(res, { channel }) : fail(res, "channel_not_found");
      }
      case "conversations.history":
        return ok(res, { messages: [...(state.history.get(params.channel) || [])].reverse() });
      case "conversations.replies":
        return ok(res, { messages: (state.history.get(params.channel) || []).filter((item) => item.thread_ts === params.ts || item.ts === params.ts) });
      case "users.info": {
        const user = state.users.get(params.user);
        return user ? ok(res, { user: { ...user, profile: { display_name: user.real_name, real_name: user.real_name } } }) : fail(res, "user_not_found");
      }
      case "chat.postMessage": {
        if (!app.channels.has(params.channel)) return fail(res, "not_in_channel");
        const message = { ...params, app: app.name, ts: ts() };
        state.posts.push(message);
        return ok(res, { ts: message.ts, channel: params.channel });
      }
      case "reactions.add":
      case "reactions.remove":
        state.reactions.push({ action: method.split(".")[1], channel: params.channel, ts: params.timestamp, name: params.name, app: app.name });
        return ok(res, {});
      case "files.getUploadURLExternal":
        state.slots.push({ filename: params.filename, length: Number(params.length), app: app.name });
        return ok(res, { upload_url: `http://127.0.0.1:${server.address().port}/upload/F1`, file_id: "F1" });
      case "files.completeUploadExternal": {
        const shared = ts();
        state.posts.push({ ...params, app: app.name, ts: shared, file: true });
        return ok(res, { files: [{ id: "F1", shares: { public: { [params.channel_id]: [{ ts: shared }] } } }] });
      }
      default:
        return fail(res, `unknown_method_${method}`);
    }
  });

  server.on("upgrade", (req, socket) => {
    const token = new URL(req.url, "http://x").searchParams.get("t") || "";
    const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    state.sockets.set(socket, token);
    socket.write(encodeFrame(JSON.stringify({ type: "hello", num_connections: 1 })));
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const { frames, rest } = decodeFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        if (frame.opcode === 8) socket.end();
        else if (frame.opcode === 1) state.acks.push(JSON.parse(frame.payload.toString("utf8")));
      }
    });
    socket.on("close", () => state.sockets.delete(socket));
    socket.on("error", () => state.sockets.delete(socket));
  });

  const port = await listen(server);
  let envelope = 0;
  /** Like Slack, a thread's first message tells how many replies it has and when the last one came. */
  const markReply = (channel, threadTs, replyTs) => {
    const parent = (state.history.get(channel) || []).find((item) => item.ts === threadTs);
    if (!parent) return;
    parent.reply_count = (parent.reply_count || 0) + 1;
    parent.latest_reply = replyTs;
  };

  return {
    state,
    url: `http://127.0.0.1:${port}/api`,
    /** A refresh token Slack will accept once, as "Generate Token" under Your App Configuration Tokens gives. */
    configToken(refresh) {
      state.refreshTokens.add(refresh);
    },
    /** Register an app (the main one, or an agent's) and the channels it is in. */
    addApp({ botToken, appToken, id, name, channels = [SLACK_CHANNEL] }) {
      state.apps.set(botToken, { botToken, appToken, id, name, channels: new Set(channels) });
    },
    join(botToken, channelId) {
      state.apps.get(botToken)?.channels.add(channelId);
    },
    /** Deliver one event to one app, or to every app already in that channel. */
    deliver(event, { botToken = "" } = {}) {
      for (const [socket, token] of state.sockets) {
        const app = [...state.apps.values()].find((entry) => entry.appToken === token);
        if (!app) continue;
        if (botToken && app.botToken !== botToken) continue;
        if (!botToken && event.channel && !app.channels.has(event.channel)) continue;
        envelope += 1;
        socket.write(encodeFrame(JSON.stringify({ envelope_id: `env-${envelope}`, type: "events_api", payload: { event } })));
      }
    },
    /** The app is invited: it can see the channel, and Slack tells its socket. */
    invite(botToken, channelId) {
      const app = state.apps.get(botToken);
      if (!app) throw new Error("no app");
      app.channels.add(channelId);
      this.deliver({ type: "member_joined_channel", user: app.id, channel: channelId, channel_type: "C" }, { botToken });
    },
    /** The app leaves, and Slack tells its socket. */
    leave(botToken, channelId) {
      const app = state.apps.get(botToken);
      if (!app) throw new Error("no app");
      app.channels.delete(channelId);
      this.deliver({ type: "channel_left", channel: channelId }, { botToken });
    },
    /** A file someone shares (an audio clip, say), as it appears in a message's `files`. */
    file(name, data, mimetype, extra = {}) {
      state.files.set(name, data);
      return { id: `F${state.files.size}${name.length}`, name, mimetype, size: data.length, url_private: `http://127.0.0.1:${port}/files/${name}`, ...extra };
    },
    /** Deliver an event to every app in that channel, the way Slack does. */
    say({ text, channel = SLACK_CHANNEL, user = SLACK_OWNER, threadTs = "", files = null, botId = "", username = "" }) {
      const event = {
        type: "message", channel, user: botId ? undefined : user, text, ts: ts(),
        channel_type: channel.startsWith("D") ? "im" : "channel",
      };
      if (threadTs) {
        event.thread_ts = threadTs;
        markReply(channel, threadTs, event.ts);
      }
      if (files) {
        event.files = files;
        event.subtype = "file_share";
      }
      if (botId) {
        event.bot_id = botId;
        event.subtype = "bot_message";
        event.username = username || "bot";
      }
      const archive = state.history.get(channel) || [];
      archive.push(event);
      state.history.set(channel, archive);
      for (const [socket, token] of state.sockets) {
        const app = [...state.apps.values()].find((entry) => entry.appToken === token);
        if (!app?.channels.has(channel)) continue;
        envelope += 1;
        socket.write(encodeFrame(JSON.stringify({ envelope_id: `env-${envelope}`, type: "events_api", payload: { event } })));
      }
      return event;
    },
    /** A message written while Cora was down: in the archive, never delivered. */
    archive({ text, channel = SLACK_CHANNEL, user = SLACK_OWNER, at = null, threadTs = "" }) {
      const event = { type: "message", channel, user, text, ts: at || ts(), channel_type: "channel" };
      if (threadTs) {
        event.thread_ts = threadTs;
        markReply(channel, threadTs, event.ts);
      }
      const archive = state.history.get(channel) || [];
      archive.push(event);
      state.history.set(channel, archive);
      return event;
    },
    postsIn(channel) {
      return state.posts.filter((post) => (post.channel || post.channel_id) === channel);
    },
    close() {
      for (const socket of state.sockets.keys()) socket.destroy();
      server.closeAllConnections?.();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
