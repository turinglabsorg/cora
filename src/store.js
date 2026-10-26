import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { plainKeys } from "./box.js";

export const SHARED = "_shared";
/** The providers a model id can name (provider/model). */
export const MODEL_PROVIDERS = ["claude", "codex", "ollama", "orcarouter", "hermes"];

function checkModel(value) {
  const model = cleanText(value, 160).trim();
  if (!model) return "";
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1 || !MODEL_PROVIDERS.includes(model.slice(0, slash)) || /\s/.test(model)) {
    throw new ValidationError(`modello non valido: usa provider/modello, con provider fra ${MODEL_PROVIDERS.join(", ")}`);
  }
  return model;
}

const DEFAULT_SETTINGS = {
  guildIds: [],
  ownerIds: [],
  maxAgentTurns: 8,
  maxRepliesPerRound: 2,
  historySize: 30,
  sharedMemory: "",
  defaultModel: "ollama/deepseek-v4.1-flash",
  // Goal mode is off until it yields to the owner: a goal it cannot drop fights whoever asked for it.
  goalMode: false,
  sleepHour: 4,
  transport: "discord",
  telegramChatIds: [],
  telegramOwnerIds: [],
  sshKeys: [],
  language: "it",
  // Where notices from usecora.space (waitlist sign-ups) are posted: a channel with this name.
  noticeChannel: "waitlist",
};
const SSH_PORT_BASE = 2201;
export const TRANSPORTS = ["discord", "telegram"];

const AGENT_DEFAULTS = {
  avatarUrl: "",
  color: "#e8a33d",
  personality: "",
  core: "",
  model: "",
  subscriptionId: "",
  chattiness: 0.5,
  channelIds: [],
  enabled: true,
  tools: true,
  think: false,
  effort: "",
};
const EFFORTS = ["", "low", "medium", "high"];

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, position INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, provider TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS routines (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  pinned INTEGER NOT NULL DEFAULT 0,
  by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS memories_owner ON memories(owner, created_at);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(text, content='memories', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF text ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO memories_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TABLE IF NOT EXISTS diary (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS diary_agent ON diary(agent_id, created_at);
CREATE TABLE IF NOT EXISTS core_history (id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL, by TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  author_id TEXT,
  author_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  agent_id TEXT,
  content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_channel_at ON messages(channel_id, at);
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(author_name, content, content='messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, author_name, content) VALUES (new.rowid, new.author_name, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, author_name, content) VALUES ('delete', old.rowid, old.author_name, old.content);
END;
CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  channel_id TEXT,
  model TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL,
  step_count INTEGER NOT NULL DEFAULT 0,
  tools TEXT NOT NULL DEFAULT '',
  system_hash TEXT,
  prompt TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL DEFAULT '[]',
  output TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS traces_agent ON traces(agent_id, started_at);
CREATE TABLE IF NOT EXISTS trace_systems (hash TEXT PRIMARY KEY, text TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, device TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
`;
const TRACES_KEPT_PER_AGENT = 300;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

export function newId(prefix) {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function cleanIds(value, pattern = /^\d{5,25}$/) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter((item) => pattern.test(item)))];
}

/** A Discord channel id, or a Telegram chat as tg:<chat id>. */
const CHANNEL_ID = /^(\d{5,25}|tg:-?\d{1,20}|web(-[\w-]+)?)$/;

function cleanText(value, max) {
  return String(value ?? "").slice(0, max);
}

/** FTS5 query from free text: every word quoted (no syntax injection), any of them may match. */
export function ftsQuery(text) {
  const words = String(text || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2)
    .slice(0, 40);
  return [...new Set(words)].map((word) => `"${word.replace(/"/g, "\"\"")}"`).join(" OR ");
}

export function sanitizeAgent(input, previous = {}) {
  const merged = { ...AGENT_DEFAULTS, ...previous, ...input };
  const name = cleanText(merged.name, 32).replace(/[\r\n]/g, " ").trim();
  if (!name) throw new ValidationError("name is required");
  if (/discord|clyde/i.test(name)) throw new ValidationError("Discord does not allow 'discord' or 'clyde' in a webhook name");
  const avatarUrl = cleanText(merged.avatarUrl, 500).trim();
  if (avatarUrl && !/^https:\/\//.test(avatarUrl)) throw new ValidationError("avatarUrl must be https");
  return {
    id: previous.id || input.id || newId("ag"),
    name,
    avatarUrl,
    color: /^#[0-9a-fA-F]{6}$/.test(merged.color) ? merged.color : AGENT_DEFAULTS.color,
    personality: cleanText(merged.personality, 8000),
    core: cleanText(merged.core, 4000),
    model: checkModel(merged.model),
    subscriptionId: cleanText(merged.subscriptionId, 80).trim(),
    chattiness: clampNumber(merged.chattiness, 0, 1, 0.5),
    channelIds: cleanIds(merged.channelIds, CHANNEL_ID),
    enabled: Boolean(merged.enabled),
    tools: Boolean(merged.tools),
    think: Boolean(merged.think),
    effort: EFFORTS.includes(merged.effort) ? merged.effort : merged.think && merged.effort === undefined ? "high" : "",
    lastSleepAt: previous.lastSleepAt || null,
    sshPort: previous.sshPort || null,
    createdAt: previous.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function sanitizeSettings(input, previous = DEFAULT_SETTINGS) {
  const merged = { ...DEFAULT_SETTINGS, ...previous, ...input };
  return {
    guildIds: cleanIds(merged.guildIds),
    ownerIds: cleanIds(merged.ownerIds),
    maxAgentTurns: Math.round(clampNumber(merged.maxAgentTurns, 0, 40, 8)),
    maxRepliesPerRound: Math.round(clampNumber(merged.maxRepliesPerRound, 1, 6, 2)),
    historySize: Math.round(clampNumber(merged.historySize, 5, 100, 30)),
    sharedMemory: cleanText(merged.sharedMemory, 12000),
    defaultModel: checkModel(merged.defaultModel) || DEFAULT_SETTINGS.defaultModel,
    goalMode: Boolean(merged.goalMode),
    sleepHour: Math.round(clampNumber(merged.sleepHour, 0, 23, 4)),
    transport: TRANSPORTS.includes(merged.transport) ? merged.transport : "discord",
    telegramChatIds: cleanIds(merged.telegramChatIds, /^-?\d{1,20}$/),
    telegramOwnerIds: cleanIds(merged.telegramOwnerIds, /^\d{1,20}$/),
    language: ["it", "en"].includes(merged.language) ? merged.language : "it",
    noticeChannel: cleanText(merged.noticeChannel, 100).trim().replace(/^#/, ""),
    sshKeys: plainKeys(Array.isArray(merged.sshKeys) ? merged.sshKeys.join("\n") : merged.sshKeys).slice(0, 30),
  };
}

export function sanitizeRoutine(input, previous = {}) {
  const merged = { enabled: true, ...previous, ...input };
  const name = cleanText(merged.name, 80).trim();
  if (!name) throw new ValidationError("name is required");
  const schedule = cleanText(merged.schedule, 80).trim();
  if (!schedule) throw new ValidationError("schedule is required");
  const prompt = cleanText(merged.prompt, 8000).trim();
  if (!prompt) throw new ValidationError("prompt is required");
  const channelId = String(merged.channelId || "").trim();
  if (!CHANNEL_ID.test(channelId)) throw new ValidationError("channelId is required");
  return {
    id: previous.id || newId("rt"),
    agentId: String(previous.agentId || merged.agentId),
    name,
    schedule,
    channelId,
    prompt,
    enabled: Boolean(merged.enabled),
    lastRunAt: previous.lastRunAt || null,
    lastStatus: previous.lastStatus || null,
    lastOutput: previous.lastOutput || "",
    createdAt: previous.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function memoryRow(row) {
  return {
    id: row.id,
    text: row.text,
    source: row.source,
    pinned: Boolean(row.pinned),
    by: row.by,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
  };
}

function messageRow(row) {
  return {
    id: row.id,
    channelId: row.channel_id,
    at: row.at,
    authorId: row.author_id,
    authorName: row.author_name,
    kind: row.kind,
    agentId: row.agent_id,
    content: row.content,
    ...(row.meta ? JSON.parse(row.meta) : {}),
  };
}

function traceRow(row, full) {
  const trace = {
    id: row.id,
    agentId: row.agent_id,
    kind: row.kind,
    channelId: row.channel_id,
    model: row.model,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    stepCount: row.step_count,
    tools: row.tools ? row.tools.split(",") : [],
    tokensIn: row.tokens_in || 0,
    tokensOut: row.tokens_out || 0,
    output: full ? row.output : row.output.slice(0, 240),
    error: row.error,
  };
  if (full) Object.assign(trace, { system: row.system || "", prompt: row.prompt, steps: JSON.parse(row.steps) });
  return trace;
}

/** Everything cora keeps, in one SQLite file (~/.cora/cora.db). */
export class Store {
  constructor(home) {
    this.home = home;
    mkdirSync(home, { recursive: true, mode: 0o700 });
    this.path = join(home, "cora.db");
    this.db = new DatabaseSync(this.path);
    try { chmodSync(this.path, 0o600); } catch {}
    this.db.exec(SCHEMA);
    try { this.db.exec("ALTER TABLE messages ADD COLUMN meta TEXT"); } catch {}
    // Older databases have no token counts: their traces simply read as zero.
    for (const column of ["tokens_in", "tokens_out"]) {
      try { this.db.exec(`ALTER TABLE traces ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`); } catch {}
    }
    // Turns cut short by the restart: the long tasks among them are picked up again (Orchestrator.resumeInterrupted).
    this.interruptedAtStart = this.db.prepare("SELECT id FROM traces WHERE status = 'running'").all().map((row) => row.id);
    this.db.exec("UPDATE traces SET status = 'interrupted' WHERE status = 'running'");
    this.q = {};
    const settingsRow = this.db.prepare("SELECT value FROM settings WHERE key = 'settings'").get();
    this.cachedSettings = sanitizeSettings(settingsRow ? JSON.parse(settingsRow.value) : {}, DEFAULT_SETTINGS);
    this.cachedAgents = this.db.prepare("SELECT data FROM agents ORDER BY position").all().map((row) => JSON.parse(row.data));
    this.cachedRoutines = this.db.prepare("SELECT data FROM routines ORDER BY rowid").all().map((row) => JSON.parse(row.data));
    this.tx(() => {
      for (const record of this.subscriptions()) {
        if (!record.legacyHost) continue;
        delete record.legacyHost;
        Object.assign(record, { status: "disconnected", email: "", plan: "", issue: "", label: record.provider === "claude" ? "Claude" : "ChatGPT", updatedAt: new Date().toISOString() });
        this.stmt("UPDATE subscriptions SET data = ? WHERE id = ?").run(JSON.stringify(record), record.id);
      }
      for (const agent of this.cachedAgents) {
        if (Object.hasOwn(agent, "subscriptionId")) continue;
        agent.subscriptionId = "";
        this.writeAgent(agent);
      }
    });
  }

  stmt(sql) {
    if (!this.q[sql]) this.q[sql] = this.db.prepare(sql);
    return this.q[sql];
  }

  tx(fn) {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    try { this.db.close(); } catch {}
  }

  flush() {}

  /* ---------- settings ---------- */
  get settings() { return this.cachedSettings; }

  /** Small JSON values kept next to the settings (e.g. the Telegram chats cora has seen). */
  value(key, fallback = null) {
    const row = this.stmt("SELECT value FROM settings WHERE key = ?").get(`value:${key}`);
    return row ? JSON.parse(row.value) : fallback;
  }

  setValue(key, value) {
    this.stmt("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(`value:${key}`, JSON.stringify(value));
  }

  updateSettings(input) {
    this.cachedSettings = sanitizeSettings(input, this.cachedSettings);
    this.stmt("INSERT INTO settings(key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(this.cachedSettings));
    return this.cachedSettings;
  }

  /* ---------- subscription identities; credentials belong to the official CLIs ---------- */
  subscriptions() {
    return this.stmt("SELECT data FROM subscriptions ORDER BY rowid").all().map((row) => JSON.parse(row.data));
  }

  subscription(id) {
    const row = this.stmt("SELECT data FROM subscriptions WHERE id = ?").get(id);
    return row ? JSON.parse(row.data) : null;
  }

  createSubscription({ provider, label }) {
    if (!["claude", "codex"].includes(provider)) throw new ValidationError("provider subscription non valido");
    const name = cleanText(label, 80).replace(/[\r\n]/g, " ").trim();
    if (!name) throw new ValidationError("nome subscription richiesto");
    const at = new Date().toISOString();
    const record = { id: newId("sub"), provider, label: name, status: "disconnected", email: "", plan: "", createdAt: at, updatedAt: at };
    this.stmt("INSERT INTO subscriptions(id, provider, data) VALUES (?, ?, ?)").run(record.id, provider, JSON.stringify(record));
    return record;
  }

  updateSubscription(id, input) {
    const record = this.subscription(id);
    if (!record) return null;
    const next = { ...record, updatedAt: new Date().toISOString() };
    if (input.status !== undefined) {
      if (!["disconnected", "connecting", "ready", "error"].includes(input.status)) throw new ValidationError("stato subscription non valido");
      next.status = input.status;
    }
    for (const key of ["email", "plan"]) if (input[key] !== undefined) next[key] = cleanText(input[key], key === "email" ? 254 : 80);
    if (input.issue !== undefined) next.issue = input.issue === "isolation" ? "isolation" : "";
    if (input.status === "ready" || input.status === "connecting") next.issue = "";
    this.stmt("UPDATE subscriptions SET data = ? WHERE id = ?").run(JSON.stringify(next), id);
    return next;
  }

  deleteSubscription(id) {
    if (this.agents().some((agent) => agent.subscriptionId === id)) throw new ValidationError("subscription usata da un agente");
    return this.stmt("DELETE FROM subscriptions WHERE id = ?").run(id).changes > 0;
  }

  checkAgentSubscription(agent, { unchanged = false } = {}) {
    const provider = (agent.model || this.settings.defaultModel).split("/")[0];
    const needsSubscription = ["claude", "codex"].includes(provider);
    if (!agent.subscriptionId) {
      if (needsSubscription && !unchanged) throw new ValidationError("scegli una subscription collegata per questo modello");
      return;
    }
    const subscription = this.subscription(agent.subscriptionId);
    if (!subscription || subscription.provider !== provider) throw new ValidationError("subscription incompatibile con il modello");
    if (subscription.status !== "ready" && !unchanged) throw new ValidationError("collega la subscription prima di usarla");
  }

  /* ---------- agents ---------- */
  agents() { return this.cachedAgents; }

  agent(id) { return this.cachedAgents.find((agent) => agent.id === id) || null; }

  writeAgent(agent) {
    const position = this.cachedAgents.findIndex((item) => item.id === agent.id);
    this.stmt("INSERT INTO agents(id, position, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET position = excluded.position, data = excluded.data")
      .run(agent.id, position < 0 ? this.cachedAgents.length : position, JSON.stringify(agent));
  }

  createAgent(input) {
    const agent = sanitizeAgent(input);
    this.checkAgentSubscription(agent);
    if (this.cachedAgents.some((other) => other.name.toLowerCase() === agent.name.toLowerCase())) {
      throw new ValidationError("an agent with this name already exists");
    }
    this.cachedAgents.push(agent);
    this.writeAgent(agent);
    return agent;
  }

  updateAgent(id, input) {
    const index = this.cachedAgents.findIndex((agent) => agent.id === id);
    if (index < 0) return null;
    const agent = sanitizeAgent(input, this.cachedAgents[index]);
    const previous = this.cachedAgents[index];
    this.checkAgentSubscription(agent, { unchanged: (agent.subscriptionId || "") === (previous.subscriptionId || "") && (agent.model || this.settings.defaultModel).split("/")[0] === (previous.model || this.settings.defaultModel).split("/")[0] });
    if (this.cachedAgents.some((other) => other.id !== id && other.name.toLowerCase() === agent.name.toLowerCase())) {
      throw new ValidationError("an agent with this name already exists");
    }
    this.cachedAgents[index] = agent;
    this.writeAgent(agent);
    return agent;
  }

  deleteAgent(id) {
    const before = this.cachedAgents.length;
    this.cachedAgents = this.cachedAgents.filter((agent) => agent.id !== id);
    this.cachedRoutines = this.cachedRoutines.filter((routine) => routine.agentId !== id);
    this.tx(() => {
      this.stmt("DELETE FROM agents WHERE id = ?").run(id);
      this.stmt("DELETE FROM memories WHERE owner = ?").run(id);
      this.stmt("DELETE FROM diary WHERE agent_id = ?").run(id);
      this.stmt("DELETE FROM core_history WHERE agent_id = ?").run(id);
      this.stmt("DELETE FROM routines WHERE agent_id = ?").run(id);
      this.stmt("DELETE FROM traces WHERE agent_id = ?").run(id);
      this.stmt("DELETE FROM trace_systems WHERE hash NOT IN (SELECT system_hash FROM traces WHERE system_hash IS NOT NULL)").run();
    });
    return this.cachedAgents.length !== before;
  }

  /** The host port of an agent's SSH server, fixed once given so saved connections keep working. */
  sshPort(agentId) {
    const agent = this.agent(agentId);
    if (!agent) return null;
    if (agent.sshPort) return agent.sshPort;
    const used = new Set(this.cachedAgents.map((item) => item.sshPort).filter(Boolean));
    let port = SSH_PORT_BASE;
    while (used.has(port)) port += 1;
    agent.sshPort = port;
    this.writeAgent(agent);
    return port;
  }

  setCore(agentId, text, by = "manual") {
    const agent = this.agent(agentId);
    if (!agent) return null;
    const clean = cleanText(text, 4000);
    if (agent.core && agent.core !== clean) {
      this.stmt("INSERT INTO core_history(agent_id, text, at, by) VALUES (?, ?, ?, ?)").run(agentId, agent.core, new Date().toISOString(), by);
      this.stmt("DELETE FROM core_history WHERE agent_id = ? AND id NOT IN (SELECT id FROM core_history WHERE agent_id = ? ORDER BY id DESC LIMIT 15)").run(agentId, agentId);
    }
    agent.core = clean;
    agent.updatedAt = new Date().toISOString();
    this.writeAgent(agent);
    return agent;
  }

  coreHistory(agentId) {
    return this.stmt("SELECT text, at, by FROM core_history WHERE agent_id = ? ORDER BY id").all(agentId).map((row) => ({ ...row }));
  }

  markSlept(agentId, at) {
    const agent = this.agent(agentId);
    if (!agent) return;
    agent.lastSleepAt = at;
    this.writeAgent(agent);
  }

  /* ---------- memories ---------- */
  memories(key) {
    return this.stmt("SELECT * FROM memories WHERE owner = ? ORDER BY created_at, rowid").all(key).map(memoryRow);
  }

  memoryCount(key) {
    return this.stmt("SELECT COUNT(*) AS n FROM memories WHERE owner = ?").get(key).n;
  }

  addMemory(key, text, source = "manual", { pinned = false, by = "" } = {}) {
    const clean = cleanText(text, 1000).trim();
    if (!clean) throw new ValidationError("memory text is required");
    const duplicate = this.stmt("SELECT * FROM memories WHERE owner = ? AND lower(text) = lower(?)").get(key, clean);
    if (duplicate) return memoryRow(duplicate);
    const memory = { id: newId("mem"), text: clean, source, pinned: Boolean(pinned), by: cleanText(by, 64), createdAt: new Date().toISOString() };
    this.stmt("INSERT INTO memories(id, owner, text, source, pinned, by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(memory.id, key, memory.text, memory.source, memory.pinned ? 1 : 0, memory.by, memory.createdAt);
    return memory;
  }

  findMemory(id) {
    const row = this.stmt("SELECT * FROM memories WHERE id = ?").get(String(id));
    return row ? { key: row.owner, memory: memoryRow(row) } : null;
  }

  updateMemory(key, memoryId, patch) {
    const row = this.stmt("SELECT * FROM memories WHERE id = ? AND owner = ?").get(memoryId, key);
    if (!row) return null;
    let text = row.text;
    if (patch.text !== undefined) {
      text = cleanText(patch.text, 1000).trim();
      if (!text) throw new ValidationError("memory text is required");
    }
    const pinned = patch.pinned === undefined ? row.pinned : (patch.pinned ? 1 : 0);
    this.stmt("UPDATE memories SET text = ?, pinned = ?, updated_at = ? WHERE id = ?").run(text, pinned, new Date().toISOString(), memoryId);
    return memoryRow(this.stmt("SELECT * FROM memories WHERE id = ?").get(memoryId));
  }

  moveMemory(fromKey, memoryId, toKey) {
    const result = this.stmt("UPDATE memories SET owner = ?, updated_at = ? WHERE id = ? AND owner = ?").run(toKey, new Date().toISOString(), memoryId, fromKey);
    return result.changes ? this.findMemory(memoryId).memory : null;
  }

  deleteMemory(key, memoryId) {
    return this.stmt("DELETE FROM memories WHERE id = ? AND owner = ?").run(memoryId, key).changes > 0;
  }

  /** Full-text search over the facts of the given owners, best first (FTS5 bm25). */
  searchMemories(keys, text, limit = 10, { includePinned = true } = {}) {
    const match = ftsQuery(text);
    if (!match || !keys.length) return [];
    const placeholders = keys.map(() => "?").join(",");
    const pinnedFilter = includePinned ? "" : "AND m.pinned = 0";
    return this.db.prepare(`
      SELECT m.*, bm25(memories_fts) AS rank FROM memories_fts
      JOIN memories m ON m.rowid = memories_fts.rowid
      WHERE memories_fts MATCH ? AND m.owner IN (${placeholders}) ${pinnedFilter}
      ORDER BY rank LIMIT ?`).all(match, ...keys, limit).map((row) => ({ ...memoryRow(row), owner: row.owner }));
  }

  /* ---------- diary ---------- */
  diary(agentId) {
    return this.stmt("SELECT id, text, created_at FROM diary WHERE agent_id = ? ORDER BY created_at").all(agentId)
      .map((row) => ({ id: row.id, text: row.text, createdAt: row.created_at }));
  }

  addDiary(agentId, text) {
    const clean = cleanText(text, 4000).trim();
    if (!clean) return null;
    const entry = { id: newId("day"), text: clean, createdAt: new Date().toISOString() };
    this.stmt("INSERT INTO diary(id, agent_id, text, created_at) VALUES (?, ?, ?, ?)").run(entry.id, agentId, entry.text, entry.createdAt);
    return entry;
  }

  deleteDiary(agentId, entryId) {
    return this.stmt("DELETE FROM diary WHERE id = ? AND agent_id = ?").run(entryId, agentId).changes > 0;
  }

  /* ---------- message archive ---------- */
  appendArchive(channelId, item) {
    const meta = {};
    if (item.traceId) meta.traceId = item.traceId;
    if (item.file) meta.file = item.file;
    if (item.request) meta.request = item.request;
    this.stmt("INSERT OR IGNORE INTO messages(id, channel_id, at, author_id, author_name, kind, agent_id, content, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(String(item.id), String(channelId), Number(item.at) || Date.now(), item.authorId || null, String(item.authorName || "?"), String(item.kind || "human"), item.agentId || null, cleanText(item.content, 4000), Object.keys(meta).length ? JSON.stringify(meta) : null);
  }

  hasMessage(id) {
    return Boolean(this.stmt("SELECT 1 FROM messages WHERE id = ?").get(String(id)));
  }

  /** The last messages of one channel, oldest first. */
  recentMessages(channelId, limit = 50) {
    return this.stmt("SELECT * FROM (SELECT * FROM messages WHERE channel_id = ? ORDER BY at DESC LIMIT ?) ORDER BY at").all(String(channelId), limit).map(messageRow);
  }

  /** The channels where an agent spoke most recently, each with its latest messages since `since`. */
  recentElsewhere(agentId, channelIds, since, { channels = 2, perChannel = 8 } = {}) {
    if (!channelIds.length) return [];
    const placeholders = channelIds.map(() => "?").join(",");
    const rows = this.db.prepare(`SELECT channel_id, MAX(at) AS last FROM messages WHERE agent_id = ? AND at > ? AND channel_id IN (${placeholders})
      GROUP BY channel_id ORDER BY last DESC LIMIT ?`).all(String(agentId), since, ...channelIds.map(String), channels);
    return rows.map((row) => ({
      channelId: row.channel_id,
      messages: this.stmt("SELECT * FROM (SELECT * FROM messages WHERE channel_id = ? AND at > ? ORDER BY at DESC LIMIT ?) ORDER BY at").all(row.channel_id, since, perChannel).map(messageRow),
    })).reverse();
  }

  /** The newest request in each panel room that the owner has not answered yet (requests on Discord or Telegram are answered there). */
  pendingRequests() {
    return this.stmt(`SELECT m.* FROM messages m WHERE (m.channel_id = 'web' OR m.channel_id LIKE 'web-%') AND m.kind = 'agent' AND m.meta LIKE '%"request"%'
      AND NOT EXISTS (SELECT 1 FROM messages o WHERE o.channel_id = m.channel_id AND o.kind = 'owner' AND o.at > m.at)
      ORDER BY m.at DESC LIMIT 20`).all().map(messageRow);
  }

  /** How the owner signs on Discord, for messages written in the panel. */
  ownerName() {
    return this.stmt("SELECT author_name FROM messages WHERE kind = 'owner' ORDER BY at DESC LIMIT 1").get()?.author_name || "";
  }

  searchMessages(channelIds, text, limit = 10, before = Number.MAX_SAFE_INTEGER) {
    const match = ftsQuery(text);
    if (!match || !channelIds.length) return [];
    const placeholders = channelIds.map(() => "?").join(",");
    return this.db.prepare(`
      SELECT m.*, bm25(messages_fts) AS rank FROM messages_fts
      JOIN messages m ON m.rowid = messages_fts.rowid
      WHERE messages_fts MATCH ? AND m.channel_id IN (${placeholders}) AND m.at < ?
      ORDER BY rank LIMIT ?`).all(match, ...channelIds, before, limit).map(messageRow);
  }

  messagesSince(channelIds, since, limit = 400) {
    if (!channelIds.length) return [];
    const placeholders = channelIds.map(() => "?").join(",");
    return this.db.prepare(`
      SELECT * FROM (SELECT * FROM messages WHERE channel_id IN (${placeholders}) AND at > ? ORDER BY at DESC LIMIT ?)
      ORDER BY at`).all(...channelIds, since, limit).map(messageRow);
  }

  archivedChannels() {
    return this.stmt("SELECT DISTINCT channel_id FROM messages").all().map((row) => row.channel_id);
  }

  /* ---------- routines ---------- */
  routines(agentId) {
    return agentId ? this.cachedRoutines.filter((routine) => routine.agentId === agentId) : this.cachedRoutines;
  }

  routine(id) { return this.cachedRoutines.find((routine) => routine.id === id) || null; }

  writeRoutine(routine) {
    this.stmt("INSERT INTO routines(id, agent_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
      .run(routine.id, routine.agentId, JSON.stringify(routine));
  }

  createRoutine(agentId, input) {
    const routine = sanitizeRoutine({ ...input, agentId });
    this.cachedRoutines.push(routine);
    this.writeRoutine(routine);
    return routine;
  }

  updateRoutine(id, input) {
    const index = this.cachedRoutines.findIndex((routine) => routine.id === id);
    if (index < 0) return null;
    this.cachedRoutines[index] = sanitizeRoutine(input, this.cachedRoutines[index]);
    this.writeRoutine(this.cachedRoutines[index]);
    return this.cachedRoutines[index];
  }

  recordRoutineRun(id, status, output) {
    const routine = this.routine(id);
    if (!routine) return;
    routine.lastRunAt = new Date().toISOString();
    routine.lastStatus = status;
    routine.lastOutput = cleanText(output, 4000);
    this.writeRoutine(routine);
  }

  deleteRoutine(id) {
    const before = this.cachedRoutines.length;
    this.cachedRoutines = this.cachedRoutines.filter((routine) => routine.id !== id);
    this.stmt("DELETE FROM routines WHERE id = ?").run(id);
    return this.cachedRoutines.length !== before;
  }

  /* ---------- reasoning traces ---------- */
  /** The system prompt (it carries the owner's instructions) is stored once and shared by the traces that used it. */
  saveTrace(trace) {
    const tools = [...new Set(trace.steps.filter((step) => step.type === "tool").map((step) => step.name))].join(",");
    let systemHash = null;
    if (trace.system) {
      systemHash = createHash("sha256").update(trace.system).digest("hex");
      this.stmt("INSERT OR IGNORE INTO trace_systems(hash, text) VALUES (?, ?)").run(systemHash, trace.system);
    }
    this.stmt(`INSERT OR REPLACE INTO traces(id, agent_id, kind, channel_id, model, started_at, ended_at, status, step_count, tools, system_hash, prompt, steps, output, error, tokens_in, tokens_out)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      trace.id, trace.agentId, trace.kind, trace.channelId || null, trace.model || "", trace.startedAt, trace.endedAt || null, trace.status,
      trace.steps.length + (trace.dropped || 0), tools, systemHash, trace.prompt || "", JSON.stringify(trace.steps), trace.output || "", trace.error || "",
      Number(trace.tokensIn) || 0, Number(trace.tokensOut) || 0,
    );
    if (trace.status !== "running" && Math.random() < 0.05) this.pruneTraces(trace.agentId);
  }

  pruneTraces(agentId) {
    this.stmt("DELETE FROM traces WHERE agent_id = ? AND id NOT IN (SELECT id FROM traces WHERE agent_id = ? ORDER BY started_at DESC LIMIT ?)").run(agentId, agentId, TRACES_KEPT_PER_AGENT);
    this.stmt("DELETE FROM trace_systems WHERE hash NOT IN (SELECT system_hash FROM traces WHERE system_hash IS NOT NULL)").run();
  }

  traces(agentId, limit = 50) {
    return this.stmt("SELECT id, agent_id, kind, channel_id, model, started_at, ended_at, status, step_count, tools, output, error, tokens_in, tokens_out FROM traces WHERE agent_id = ? ORDER BY started_at DESC LIMIT ?")
      .all(agentId, limit).map((row) => traceRow(row, false));
  }

  recentTraces(limit = 12) {
    return this.stmt("SELECT id, agent_id, kind, channel_id, model, started_at, ended_at, status, step_count, tools, output, error, tokens_in, tokens_out FROM traces ORDER BY started_at DESC LIMIT ?")
      .all(limit).map((row) => traceRow(row, false));
  }

  /**
   * What every agent spent, one row per agent per local day: the heatmap reads
   * this straight. Days with nothing simply do not appear.
   */
  usageByDay(days = 365, timezone = "Europe/Rome") {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const rows = this.stmt("SELECT agent_id, started_at, tokens_in, tokens_out FROM traces WHERE started_at >= ? AND (tokens_in > 0 OR tokens_out > 0)").all(since);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    const totals = new Map();
    for (const row of rows) {
      const key = `${row.agent_id}|${day.format(new Date(row.started_at))}`;
      const seen = totals.get(key) || { agentId: row.agent_id, day: key.split("|")[1], tokensIn: 0, tokensOut: 0, turns: 0 };
      seen.tokensIn += row.tokens_in || 0;
      seen.tokensOut += row.tokens_out || 0;
      seen.turns += 1;
      totals.set(key, seen);
    }
    return [...totals.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  }

  trace(id) {
    const row = this.stmt("SELECT t.*, s.text AS system FROM traces t LEFT JOIN trace_systems s ON s.hash = t.system_hash WHERE t.id = ?").get(String(id));
    return row ? traceRow(row, true) : null;
  }

  /* ---------- push notifications ---------- */
  addPushSubscription({ endpoint, keys }, device = "") {
    if (!/^https?:\/\/\S+$/.test(String(endpoint || "")) || !keys?.p256dh || !keys?.auth) throw new ValidationError("subscription non valida");
    this.stmt("INSERT INTO push_subscriptions(endpoint, p256dh, auth, device, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device")
      .run(String(endpoint), String(keys.p256dh), String(keys.auth), cleanText(device, 200), new Date().toISOString());
  }

  removePushSubscription(endpoint) {
    this.stmt("DELETE FROM push_subscriptions WHERE endpoint = ?").run(String(endpoint));
  }

  pushSubscriptions() {
    return this.stmt("SELECT * FROM push_subscriptions").all().map((row) => ({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth }, device: row.device }));
  }

  /* ---------- activity log ---------- */
  appendActivity(entry) {
    try {
      this.stmt("INSERT INTO activity(at, data) VALUES (?, ?)").run(entry.at || new Date().toISOString(), JSON.stringify(entry));
      if (Math.random() < 0.01) this.stmt("DELETE FROM activity WHERE id < (SELECT MAX(id) - 5000 FROM activity)").run();
    } catch {}
  }

  recentActivity(limit = 200) {
    return this.stmt("SELECT data FROM activity ORDER BY id DESC LIMIT ?").all(limit).map((row) => JSON.parse(row.data)).reverse();
  }
}
