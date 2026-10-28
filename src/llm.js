import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runClaude, runCodex, runHermes } from "./cli.js";

const REQUEST_TIMEOUT_MS = 240000;

/**
 * Failures worth trying again: a model at capacity, a rate limit, a connection
 * that broke, a CLI that answered nothing. Never a refusal or a bad request,
 * which would fail the same way for ever.
 */
const TRANSIENT = /\b(at capacity|capacity|rate.?limit|too many requests|429|50[0234]|overloaded|unavailable|temporar\w*|try again)\b|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|fetch failed|network|timed out|no answer within|returned no content|exited with \d+ and said nothing/i;
const RETRIES = 2;
/** The largest context we ask a local model for: more is rarely worth the memory it eats. */
const MAX_CONTEXT = 32_768;
const RETRY_WAIT_MS = 4000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The cards in this machine, asked of nvidia-smi. A host without one answers
 * nothing and that is a fact, not a failure: a Mac has no card to report here.
 */
const isLocalUrl = (value) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/i.test(String(value || ""));

/** Ollama refuses a model it cannot read yet: that deserves the real sentence, not a number. */
function pullFailure(status, text) {
  if (status === 412 || /newer version of ollama/i.test(text)) return "questo modello richiede un Ollama più recente di quello installato";
  if (status === 404 || /not found|unknown model/i.test(text)) return "questo modello non esiste nella libreria di Ollama";
  if (/no space|disk/i.test(text)) return "spazio su disco finito";
  return String(text || `errore ${status}`).slice(0, 200);
}

/**
 * Install a model on one of this machine's Ollama servers. Ollama does the whole
 * setup itself; this only follows the download and says how far it got.
 */
export async function pullModel(url, name, onProgress = () => {}) {
  let response;
  try {
    response = await fetch(`${url}/api/pull`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: name, stream: true }),
    });
  } catch (error) {
    return { ok: false, error: `non raggiungo Ollama: ${error.message}` };
  }
  if (!response.ok || !response.body) return { ok: false, error: pullFailure(response.status, await response.text().catch(() => "")) };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let failure = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.error) failure = pullFailure(200, event.error);
      else onProgress({ status: String(event.status || ""), completed: Number(event.completed) || 0, total: Number(event.total) || 0 });
    }
  }
  return failure ? { ok: false, error: failure } : { ok: true };
}

export function graphicsCards({ bin = "nvidia-smi", timeoutMs = 4000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, ["--query-gpu=index,uuid,name,memory.total,memory.used,utilization.gpu", "--format=csv,noheader,nounits"], { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve([]);
      return;
    }
    let out = "";
    const timer = setTimeout(() => { try { child.kill(); } catch {} resolve([]); }, timeoutMs);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("error", () => { clearTimeout(timer); resolve([]); });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out.split("\n").map((line) => line.split(",").map((part) => part.trim())).filter((parts) => parts.length >= 6 && parts[2]).map((parts) => ({
        index: Number(parts[0]) || 0,
        uuid: parts[1],
        name: parts[2],
        memoryTotal: Number(parts[3]) || 0,
        memoryUsed: Number(parts[4]) || 0,
        load: Number(parts[5]) || 0,
      })));
    });
  });
}

export const PROVIDERS = {
  claude: "Claude (abbonamento)",
  codex: "ChatGPT (abbonamento)",
  ollama: "Ollama Cloud",
  orcarouter: "OrcaRouter",
  hermes: "Hermes Agent",
};

/** Routers that speak the OpenAI chat format: every model behind one key, run on the Cora harness. */
const ROUTERS = {
  orcarouter: { label: "OrcaRouter", auto: "orcarouter/auto" },
};

/** An Ollama name that answers from the cloud, not from this machine: name:cloud, name:tag-cloud. */
const CLOUD_NAME = /(^|[:-])cloud$/i;

/** Model families that take images, for routers whose model list does not say. */
const VISION = /(gpt-4o|gpt-4\.1|gpt-5|o3|o4|claude|gemini|grok-4|pixtral|vision|-vl|llava|qwen.*vl)/i;

const CLAUDE_MODELS = [
  { name: "claude-opus-5-5", label: "Opus 5.5" },
  { name: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { name: "claude-haiku-5-5", label: "Haiku 5.5" },
  { name: "claude-fable-5-1", label: "Fable 5.1" },
];

function callId() {
  return `call_${randomBytes(6).toString("hex")}`;
}

export function splitModel(model) {
  const value = String(model || "");
  const slash = value.indexOf("/");
  if (slash < 0) return { provider: "ollama", name: value };
  return { provider: value.slice(0, slash), name: value.slice(slash + 1) };
}

function parseArgs(value) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value || "{}"); } catch { return { _raw: String(value) }; }
}

export function onPath(bin) {
  if (bin.includes("/")) return existsSync(bin);
  return (process.env.PATH || "").split(":").some((dir) => dir && existsSync(join(dir, bin)));
}

export class LLM {
  constructor({ ollamaUrl, ollamaKey, orcaUrl = "https://api.orcarouter.ai/v1", orcaKey = "", claudeBin = "claude", codexBin = "codex", hermesBin = "hermes", hermesHome = "", hermesBaseUrl = "http://127.0.0.1:11434/v1", cliWorkDir, bridge, codexModelsFile, subscriptions }) {
    this.hermes = { bin: hermesBin, home: hermesHome || join(homedir(), ".cora", "hermes-home"), baseUrl: String(hermesBaseUrl).replace(/\/$/, "") };
    this.ollamaUrl = ollamaUrl;
    this.ollamaKey = ollamaKey;
    this.routers = { orcarouter: { url: String(orcaUrl).replace(/\/$/, ""), key: orcaKey } };
    this.claudeBin = claudeBin;
    this.codexBin = codexBin;
    this.cliWorkDir = cliWorkDir;
    this.bridge = bridge;
    this.subscriptions = subscriptions;
    this.codexModelsFile = codexModelsFile || join(homedir(), ".codex", "models_cache.json");
    this.cache = { at: 0, models: [] };
  }

  /** An Ollama on this machine or this network answers without a key: on-premise has its own GPU. */
  get localOllama() {
    return isLocalUrl(this.ollamaUrl);
  }

  /**
   * The Ollama servers of this machine. Ollama decides which card it uses when
   * it starts (CUDA_VISIBLE_DEVICES), never per request, so one server per card
   * is how an agent is put on a card: its address is the choice.
   */
  ollamaHostList(extra = []) {
    const seen = new Set();
    const list = [];
    for (const host of [{ url: this.ollamaUrl, label: "", gpu: "" }, ...extra]) {
      const url = String(host?.url || "").replace(/\/$/, "");
      if (!url || seen.has(url)) continue;
      seen.add(url);
      list.push({ url, label: String(host?.label || ""), gpu: String(host?.gpu || ""), local: isLocalUrl(url) });
    }
    return list;
  }

  /** What one Ollama answers: which models it has, which are loaded, which version it speaks. */
  async ollamaReport(host) {
    const report = { ...host, reachable: false, version: "", models: [], loaded: [], cloud: { signedIn: false, signinUrl: "" } };
    const ask = async (path, timeoutMs = 5000) => {
      const response = await fetch(`${host.url}${path}`, { headers: this.ollamaHeaders(), signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    };
    try {
      report.version = String((await ask("/api/version")).version || "");
      report.reachable = true;
    } catch {
      return report;
    }
    try {
      const tags = await ask("/api/tags", 8000);
      const listed = (tags.models || []).map((model) => ({
        name: model.name,
        size: Number(model.size) || 0,
        remote: model.remote === true || /:cloud$/.test(model.name),
        caps: Array.isArray(model.capabilities) ? model.capabilities : null,
      }));
      // Older Ollama answers /api/tags without capabilities. Assuming tools there would
      // put an agent on a model that cannot call any: ask each model instead.
      const missing = listed.filter((model) => !model.caps && !model.remote);
      for (let index = 0; index < missing.length; index += 4) {
        await Promise.all(missing.slice(index, index + 4).map(async (model) => {
          model.caps = await this.modelCapabilities(host.url, model.name);
        }));
      }
      report.models = listed.map((model) => {
        const caps = model.caps || [];
        return {
          name: model.name, size: model.size, local: host.local && !model.remote,
          completion: !caps.length || caps.includes("completion"),
          tools: caps.includes("tools"), vision: caps.includes("vision"), thinking: caps.includes("thinking"),
        };
      });
    } catch {}
    try {
      const running = await ask("/api/ps");
      report.loaded = (running.models || []).map((model) => ({ name: model.name, size: Number(model.size) || 0, vram: Number(model.size_vram) || 0 }));
    } catch {}
    // A local Ollama lists the cloud models whether or not the machine may run them.
    // /api/me is the one cheap way to know: it answers the account, or a link to pair it.
    try {
      const response = await fetch(`${host.url}/api/me`, { method: "POST", headers: this.ollamaHeaders(), signal: AbortSignal.timeout(4000) });
      const data = await response.json().catch(() => ({}));
      report.cloud = response.ok
        ? { signedIn: true, signinUrl: "", name: String(data.name || data.user || "") }
        : { signedIn: false, signinUrl: typeof data.signin_url === "string" ? data.signin_url : "" };
    } catch {}
    if (this.ollamaKey) report.cloud = { ...report.cloud, signedIn: true };
    return report;
  }

  ollamaHeaders() {
    return this.ollamaKey ? { Authorization: `Bearer ${this.ollamaKey}` } : {};
  }

  providers() {
    return {
      claude: onPath(this.claudeBin),
      codex: onPath(this.codexBin),
      ollama: Boolean(this.ollamaKey) || this.localOllama,
      // An Ollama on this machine is not an Ollama Cloud account: it lists the cloud
      // models either way, and only a paired machine (or a key) can run them.
      ollamaLocal: this.localOllama,
      ollamaCloud: Boolean(this.ollamaKey) || Boolean(this.cloudAccount?.signedIn),
      orcarouter: Boolean(this.routers.orcarouter.key),
      hermes: onPath(this.hermes.bin),
    };
  }

  /**
   * What this machine has to run models with: the cards, what is loaded in them
   * right now, and which Ollama answers. An install with its own GPU should be
   * able to see it; a host without one simply reports none.
   */
  async hardware({ hosts = [] } = {}) {
    const list = this.ollamaHostList(hosts);
    const reports = await Promise.all(list.map((host) => this.ollamaReport(host)));
    const out = { gpus: list.some((host) => host.local) ? await graphicsCards() : [], hosts: reports };
    // What the panel showed before this had several servers: the first local one.
    const first = reports.find((host) => host.local) || reports[0] || { url: "", local: false, reachable: false, version: "" };
    out.ollama = { url: first.url, local: Boolean(first.local), reachable: first.reachable, version: first.version };
    out.loaded = first.loaded || [];
    out.cloud = first.cloud || { signedIn: false, signinUrl: "" };
    return out;
  }

  /** What a model can actually do, straight from it, remembered for the session. */
  async modelCapabilities(url, name) {
    this.capsCache ||= new Map();
    const key = `${url}|${name}`;
    if (this.capsCache.has(key)) return this.capsCache.get(key);
    let caps = [];
    try {
      const response = await fetch(`${url}/api/show`, {
        method: "POST", headers: { "Content-Type": "application/json", ...this.ollamaHeaders() },
        body: JSON.stringify({ model: name }), signal: AbortSignal.timeout(8000),
      });
      const data = await response.json();
      if (Array.isArray(data.capabilities)) caps = data.capabilities;
    } catch {}
    this.capsCache.set(key, caps);
    return caps;
  }

  /**
   * How much a model can hold. Ollama does not refuse a prompt that is too long:
   * it quietly drops the oldest part, so an agent would forget the beginning of
   * its own task without a word. Asking the model and saying so is the whole fix.
   */
  async contextLength(model, host = "") {
    const { provider, name } = splitModel(model);
    if (provider !== "ollama") return 0;
    const url = host || this.ollamaUrl;
    this.contextCache ||= new Map();
    const key = `${url}|${name}`;
    if (this.contextCache.has(key)) return this.contextCache.get(key);
    let length = 0;
    try {
      const response = await fetch(`${url}/api/show`, {
        method: "POST", headers: { "Content-Type": "application/json", ...this.ollamaHeaders() },
        body: JSON.stringify({ model: name }), signal: AbortSignal.timeout(8000),
      });
      const data = await response.json();
      const info = data.model_info || {};
      const found = Object.entries(info).find(([field]) => field.endsWith(".context_length"));
      length = Number(found?.[1]) || 0;
      // What the model was built with is a ceiling; the Modelfile may ask for less.
      const asked = Number(/num_ctx\s+(\d+)/.exec(String(data.parameters || ""))?.[1]) || 0;
      if (asked) length = asked;
    } catch {}
    this.contextCache.set(key, length);
    return length;
  }

  /** Past this much conversation an agent should write itself a summary: 70% of what it can hold. */
  async compactAt(model, host = "", fallback = 180_000) {
    const length = await this.contextLength(model, host);
    if (!length) return fallback;
    // Roughly three and a half characters to a token, and room left to answer.
    return Math.max(20_000, Math.round(length * 3.5 * 0.7));
  }

  /** The models of one of this machine's other Ollama servers, cached like the main list. */
  async hostModels(host, { fresh = false } = {}) {
    this.hostCache ||= new Map();
    const cached = this.hostCache.get(host);
    if (!fresh && cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.models;
    const report = await this.ollamaReport({ url: host, label: "", gpu: "", local: isLocalUrl(host) });
    const models = report.models.filter((model) => model.completion).map((model) => ({
      id: `ollama/${model.name}`, provider: "ollama", label: model.name,
      local: model.local, size: model.size, tools: model.tools, vision: model.vision, thinking: model.thinking,
    }));
    this.hostCache.set(host, { at: Date.now(), models });
    return models;
  }

  /** Harnesses with a goal mode of their own: Cora hands them the condition and lets them iterate. */
  hasGoalMode(model) {
    return splitModel(model).provider === "claude";
  }

  /** Claude Code, Codex and Hermes run the whole tool loop themselves; Ollama and the routers go through the Cora harness. */
  isAgentic(model) {
    const { provider } = splitModel(model);
    return provider === "claude" || provider === "codex" || provider === "hermes";
  }

  /**
   * The endpoint behind a Hermes model. `<router>/<model>` runs on that router with its
   * key; anything else runs on Hermes' own endpoint, which is this machine's Ollama.
   */
  hermesEndpoint(name) {
    const slash = String(name).indexOf("/");
    const router = slash > 0 ? this.routers[name.slice(0, slash)] : null;
    // Each endpoint keeps its own Hermes home: runs in parallel share one config.yaml, and
    // two turns on two addresses must never rewrite each other's.
    if (router?.key) return { baseUrl: router.url, key: router.key, model: name.slice(slash + 1), home: `${this.hermes.home}-${name.slice(0, slash)}` };
    return { baseUrl: this.hermes.baseUrl, key: "", model: String(name), home: this.hermes.home };
  }

  async listModels({ fresh = false, host = "" } = {}) {
    if (host && host !== this.ollamaUrl) return this.hostModels(host, { fresh });
    if (!fresh && Date.now() - this.cache.at < 5 * 60 * 1000 && this.cache.models.length) return this.cache.models;
    const available = this.providers();
    const models = [];
    if (available.claude) {
      for (const model of CLAUDE_MODELS) models.push({ id: `claude/${model.name}`, provider: "claude", label: model.label, tools: true, vision: true, thinking: true });
    }
    if (available.codex) {
      for (const slug of this.codexModels()) models.push({ id: `codex/${slug}`, provider: "codex", label: slug, tools: true, vision: true, thinking: true });
    }
    if (available.ollama) {
      // One place decides what a model is and what it can do, asking the model when the
      // server does not say: a list that guesses "tools" puts an agent on a model that has none.
      const report = await this.ollamaReport({ url: this.ollamaUrl, label: "", gpu: "", local: this.localOllama });
      for (const model of report.models) {
        if (!model.completion) continue;
        const reachable = model.local || report.cloud.signedIn;
        models.push({
          id: `ollama/${model.name}`, provider: "ollama", label: model.name,
          local: model.local, size: model.size,
          tools: model.tools, vision: model.vision, thinking: model.thinking,
          ...(reachable ? {} : { usable: false, reason: "questa macchina non è collegata a Ollama Cloud" }),
        });
      }
      this.cloudAccount = report.cloud;
    }
    if (available.hermes) {
      // Hermes runs the models of its endpoint: by default the local Ollama, cloud models included.
      try {
        const root = this.hermes.baseUrl.replace(/\/v1$/, "");
        const response = await fetch(`${root}/api/tags`, { signal: AbortSignal.timeout(5000) });
        const data = await response.json();
        for (const model of data.models || []) {
          // argo-* models belong to another project on this machine.
          if (!model.name || /^argo-/i.test(model.name)) continue;
          if (Array.isArray(model.capabilities) && !model.capabilities.includes("completion")) continue;
          const size = Number(model.size) || 0;
          const local = !CLOUD_NAME.test(model.name) && size > 0;
          models.push({
            id: `hermes/${model.name}`, provider: "hermes", label: model.name,
            local, size, ...(local ? {} : { via: PROVIDERS.ollama }),
            tools: true, vision: false, thinking: false,
          });
        }
      } catch {}
    }
    for (const [provider, router] of Object.entries(this.routers)) {
      if (!available[provider]) continue;
      const ids = new Set();
      try {
        const response = await fetch(`${router.url}/models`, { headers: { Authorization: `Bearer ${router.key}` }, signal: AbortSignal.timeout(8000) });
        const data = await response.json();
        for (const model of data.data || []) {
          if (!model.id || ids.has(model.id)) continue;
          if (Array.isArray(model.supported_endpoint_types) && !model.supported_endpoint_types.includes("openai")) continue;
          ids.add(model.id);
          models.push({ id: `${provider}/${model.id}`, provider, label: model.id, tools: true, vision: VISION.test(model.id), thinking: false });
        }
      } catch {}
      const auto = ROUTERS[provider].auto;
      if (auto && !ids.has(auto)) models.unshift({ id: `${provider}/${auto}`, provider, label: `${auto} (sceglie il router)`, tools: true, vision: false, thinking: false });
    }
    // Hermes drives any OpenAI-compatible endpoint, so every cloud model Cora can reach is
    // one Hermes can run too. Ollama Cloud answers through the local Ollama under its cloud
    // name; a router answers at its own address, which the id carries as a first segment.
    if (available.hermes) {
      const seen = new Set(models.filter((model) => model.provider === "hermes").map((model) => model.id));
      // Only what is really in the cloud: a model installed here has no cloud twin to invent.
      for (const model of models.filter((item) => item.provider === "ollama" && !item.local)) {
        const name = splitModel(model.id).name;
        const cloud = CLOUD_NAME.test(name) ? name : name.includes(":") ? `${name}-cloud` : `${name}:cloud`;
        if (/^argo-/i.test(name) || seen.has(`hermes/${cloud}`)) continue;
        seen.add(`hermes/${cloud}`);
        models.push({ id: `hermes/${cloud}`, provider: "hermes", label: cloud, via: PROVIDERS.ollama, local: false, tools: model.tools, vision: false, thinking: false });
      }
      for (const model of models.filter((item) => ROUTERS[item.provider])) {
        const id = `hermes/${model.provider}/${splitModel(model.id).name}`;
        if (seen.has(id)) continue;
        seen.add(id);
        models.push({ id, provider: "hermes", label: model.label, via: ROUTERS[model.provider].label, local: false, tools: model.tools, vision: false, thinking: false });
      }
    }
    this.cache = { at: Date.now(), models };
    return models;
  }

  codexModels() {
    try {
      const data = JSON.parse(readFileSync(this.codexModelsFile, "utf8"));
      const list = Array.isArray(data) ? data : data.models || [];
      const slugs = list.filter((model) => (model.visibility || "list") === "list").map((model) => model.slug || model.id).filter(Boolean);
      if (slugs.length) return slugs;
    } catch {}
    return ["gpt-6-sol", "gpt-6-luna"];
  }

  async capabilities(model, host = "") {
    const known = (await this.listModels({ host })).find((item) => item.id === model);
    if (known) return known;
    const { provider } = splitModel(model);
    return { id: model, provider, tools: true, vision: provider !== "ollama", thinking: false };
  }

  /**
   * A full agent turn on a subscription CLI. `tools` are cora's tool definitions,
   * `execute(name, args)` runs one of them; both reach the CLI through MCP.
   */
  async runAgent({ model, subscriptionId, system, prompt, tools, execute, timeoutMs, onStep, effort = "", goal = "", signal }) {
    const { provider, name } = splitModel(model);
    subscriptionId ||= this.subscriptions?.defaultId(provider);
    if (["claude", "codex"].includes(provider) && (!this.subscriptions || !subscriptionId)) throw new Error("subscription da collegare");
    const runSignal = timeoutMs ? AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]) : signal;
    // A failed attempt is only retried when the agent had not started working: re-running a
    // turn that already used a tool would do its side effects twice.
    let used = 0;
    const once = async () => {
      const watched = async (toolName, args) => {
        used += 1;
        return execute(toolName, args);
      };
      const run = tools.length ? this.bridge.register({ tools, execute: watched, ttlMs: timeoutMs + 60000 }) : null;
      const options = {
        model: name, system, prompt, mcp: run, toolNames: tools.map((tool) => tool.name), workDir: this.cliWorkDir, timeoutMs, onStep, effort, goal, signal: runSignal,
      };
      try {
        if (provider === "claude" || provider === "codex") {
          const invoke = (authEnv, residentAuth) => (provider === "claude" ? runClaude : runCodex)({ bin: provider === "claude" ? this.claudeBin : this.codexBin, ...options, authEnv, residentAuth,
            workDir: authEnv ? join(this.cliWorkDir, subscriptionId) : this.cliWorkDir });
          return await this.subscriptions.run(subscriptionId, provider, runSignal, invoke);
        }
        if (provider === "hermes") {
          const endpoint = this.hermesEndpoint(name);
          return await runHermes({ bin: this.hermes.bin, ...options, home: endpoint.home, baseUrl: endpoint.baseUrl, model: endpoint.model, apiKey: endpoint.key });
        }
        throw new Error(`${provider} is not a CLI provider`);
      } finally {
        run?.dispose();
      }
    };
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await once();
      } catch (error) {
        runSignal?.throwIfAborted();
        if (attempt >= RETRIES || used || !TRANSIENT.test(String(error.message || ""))) throw error;
        onStep?.({ type: "note", text: `${error.message} — riprovo (${attempt + 1}/${RETRIES}).` });
        await wait(RETRY_WAIT_MS * (attempt + 1));
      }
    }
  }

  /**
   * One model call on Ollama Cloud. `messages` use the internal shape:
   * {role:"system"|"user", content, images?} · {role:"assistant", content, toolCalls?}
   * · {role:"tool", toolCallId, name, content, image?}. Returns {text, thinking, toolCalls}.
   */
  /** One model call, retried on a passing failure: it has no side effects, so trying again is free. */
  async chat(options) {
    for (let attempt = 0; ; attempt += 1) {
      options.signal?.throwIfAborted();
      try {
        return await this.chatOnce(options);
      } catch (error) {
        options.signal?.throwIfAborted();
        if (attempt >= RETRIES || !TRANSIENT.test(String(error.message || ""))) throw error;
        await wait(RETRY_WAIT_MS * (attempt + 1));
      }
    }
  }

  async chatOnce({ model, messages, tools = [], effort = "", signal, host = "" }) {
    const { provider, name } = splitModel(model);
    if (this.routers[provider]) return this.routerChat(provider, name, model, { messages, tools, signal });
    if (provider !== "ollama") throw new Error(`unknown model provider: ${provider}`);
    // An agent put on a card talks to that card's Ollama; everyone else to the instance's own.
    const url = host || this.ollamaUrl;
    if (!this.ollamaKey && !isLocalUrl(url)) throw new Error("OLLAMA_API_KEY is not set");
    const caps = await this.capabilities(model, host);
    const out = [];
    for (const message of messages) {
      if (message.role === "assistant") {
        const entry = { role: "assistant", content: message.content || "" };
        if (message.toolCalls?.length) entry.tool_calls = message.toolCalls.map((call) => ({ function: { name: call.name, arguments: call.args } }));
        out.push(entry);
      } else if (message.role === "tool") {
        out.push({ role: "tool", content: message.content, tool_name: message.name });
        if (message.image && caps.vision) out.push({ role: "user", content: `(immagine restituita da ${message.name})`, images: [message.image] });
      } else {
        const entry = { role: message.role, content: message.content };
        if (message.images?.length && caps.vision) entry.images = message.images;
        out.push(entry);
      }
    }
    const body = { model: name, messages: out, stream: false, options: { temperature: 0.8 } };
    // Ask for the whole window the model was built with (within reason), or Ollama uses
    // its small default and silently forgets the start of a long task.
    const window = await this.contextLength(model, host);
    if (window) body.options.num_ctx = Math.min(window, MAX_CONTEXT);
    if (tools.length && caps.tools) {
      body.tools = tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
    }
    // Ollama: no level = the model's default; "low" turns thinking off; gpt-oss takes the level itself.
    if (caps.thinking && effort) body.think = effort === "low" ? false : /gpt-oss/i.test(name) ? effort : true;
    const response = await fetch(`${url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.ollamaHeaders() },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(`ollama ${name}: ${String(data.error || response.status).slice(0, 200)}`);
    const message = data.message || {};
    return {
      usage: { in: Number(data.prompt_eval_count) || 0, out: Number(data.eval_count) || 0 },
      text: message.content || "",
      thinking: message.thinking || "",
      toolCalls: (message.tool_calls || []).map((call) => ({ id: call.id || callId(), name: call.function?.name, args: parseArgs(call.function?.arguments) })),
    };
  }

  /**
   * One model call through a router that speaks the OpenAI chat format
   * (OrcaRouter): same messages and tools as Ollama, same {text, thinking, toolCalls}.
   */
  async routerChat(provider, name, model, { messages, tools, signal }) {
    const router = this.routers[provider];
    if (!router.key) throw new Error(`${ROUTERS[provider].label}: no API key (CORA_${provider.toUpperCase()}_API_KEY in hush)`);
    const caps = await this.capabilities(model);
    const picture = (image) => ({ type: "image_url", image_url: { url: String(image).startsWith("data:") ? image : `data:image/png;base64,${image}` } });
    const out = [];
    for (const message of messages) {
      if (message.role === "assistant") {
        const entry = { role: "assistant", content: message.content || "" };
        if (message.toolCalls?.length) {
          entry.tool_calls = message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args || {}) } }));
        }
        out.push(entry);
      } else if (message.role === "tool") {
        out.push({ role: "tool", tool_call_id: message.toolCallId, content: String(message.content ?? "") });
        // Tool results carry only text: a screenshot follows as a picture from the user side.
        if (message.image && caps.vision) out.push({ role: "user", content: [{ type: "text", text: `(immagine restituita da ${message.name})` }, picture(message.image)] });
      } else if (message.images?.length && caps.vision) {
        out.push({ role: message.role, content: [{ type: "text", text: String(message.content ?? "") }, ...message.images.map(picture)] });
      } else {
        out.push({ role: message.role, content: String(message.content ?? "") });
      }
    }
    const body = { model: name, messages: out, temperature: 0.8 };
    if (tools.length && caps.tools) {
      body.tools = tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
    }
    const response = await fetch(`${router.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${router.key}` },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      const reason = data.error?.message || data.error || data.message || response.status;
      throw new Error(`${ROUTERS[provider].label} ${name}: ${String(reason).slice(0, 200)}`);
    }
    const message = data.choices?.[0]?.message || {};
    const text = Array.isArray(message.content) ? message.content.map((part) => part.text || "").join("") : message.content || "";
    return {
      usage: { in: Number(data.usage?.prompt_tokens) || 0, out: Number(data.usage?.completion_tokens) || 0 },
      text,
      thinking: message.reasoning_content || message.reasoning || "",
      toolCalls: (message.tool_calls || []).map((call) => ({ id: call.id || callId(), name: call.function?.name, args: parseArgs(call.function?.arguments) })),
    };
  }
}
