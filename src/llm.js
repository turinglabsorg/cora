import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runClaude, runCodex, runHermes } from "./cli.js";

const REQUEST_TIMEOUT_MS = 240000;

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

function onPath(bin) {
  if (bin.includes("/")) return existsSync(bin);
  return (process.env.PATH || "").split(":").some((dir) => dir && existsSync(join(dir, bin)));
}

export class LLM {
  constructor({ ollamaUrl, ollamaKey, orcaUrl = "https://api.orcarouter.ai/v1", orcaKey = "", claudeBin = "claude", codexBin = "codex", hermesBin = "hermes", hermesHome = "", hermesBaseUrl = "http://127.0.0.1:11434/v1", cliWorkDir, bridge, codexModelsFile }) {
    this.hermes = { bin: hermesBin, home: hermesHome || join(homedir(), ".cora", "hermes-home"), baseUrl: String(hermesBaseUrl).replace(/\/$/, "") };
    this.ollamaUrl = ollamaUrl;
    this.ollamaKey = ollamaKey;
    this.routers = { orcarouter: { url: String(orcaUrl).replace(/\/$/, ""), key: orcaKey } };
    this.claudeBin = claudeBin;
    this.codexBin = codexBin;
    this.cliWorkDir = cliWorkDir;
    this.bridge = bridge;
    this.codexModelsFile = codexModelsFile || join(homedir(), ".codex", "models_cache.json");
    this.cache = { at: 0, models: [] };
  }

  providers() {
    return {
      claude: onPath(this.claudeBin),
      codex: onPath(this.codexBin),
      ollama: Boolean(this.ollamaKey),
      orcarouter: Boolean(this.routers.orcarouter.key),
      hermes: onPath(this.hermes.bin),
    };
  }

  /** Claude Code, Codex and Hermes run the whole tool loop themselves; Ollama and the routers go through the Cora harness. */
  isAgentic(model) {
    const { provider } = splitModel(model);
    return provider === "claude" || provider === "codex" || provider === "hermes";
  }

  async listModels({ fresh = false } = {}) {
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
      try {
        const response = await fetch(`${this.ollamaUrl}/api/tags`, { headers: { Authorization: `Bearer ${this.ollamaKey}` }, signal: AbortSignal.timeout(8000) });
        const data = await response.json();
        for (const model of data.models || []) {
          const caps = model.capabilities || ["completion", "tools"];
          if (!caps.includes("completion")) continue;
          models.push({ id: `ollama/${model.name}`, provider: "ollama", label: model.name, tools: caps.includes("tools"), vision: caps.includes("vision"), thinking: caps.includes("thinking") });
        }
      } catch {}
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
          models.push({ id: `hermes/${model.name}`, provider: "hermes", label: model.name, tools: true, vision: false, thinking: false });
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

  async capabilities(model) {
    const known = (await this.listModels()).find((item) => item.id === model);
    if (known) return known;
    const { provider } = splitModel(model);
    return { id: model, provider, tools: true, vision: provider !== "ollama", thinking: false };
  }

  /**
   * A full agent turn on a subscription CLI. `tools` are cora's tool definitions,
   * `execute(name, args)` runs one of them; both reach the CLI through MCP.
   */
  async runAgent({ model, system, prompt, tools, execute, timeoutMs, onStep, effort = "" }) {
    const { provider, name } = splitModel(model);
    const run = tools.length ? this.bridge.register({ tools, execute, ttlMs: timeoutMs + 60000 }) : null;
    const options = {
      model: name, system, prompt, mcp: run, toolNames: tools.map((tool) => tool.name), workDir: this.cliWorkDir, timeoutMs, onStep, effort,
    };
    try {
      if (provider === "claude") return await runClaude({ bin: this.claudeBin, ...options });
      if (provider === "codex") return await runCodex({ bin: this.codexBin, ...options });
      if (provider === "hermes") return await runHermes({ bin: this.hermes.bin, home: this.hermes.home, baseUrl: this.hermes.baseUrl, ...options });
      throw new Error(`${provider} is not a CLI provider`);
    } finally {
      run?.dispose();
    }
  }

  /**
   * One model call on Ollama Cloud. `messages` use the internal shape:
   * {role:"system"|"user", content, images?} · {role:"assistant", content, toolCalls?}
   * · {role:"tool", toolCallId, name, content, image?}. Returns {text, thinking, toolCalls}.
   */
  async chat({ model, messages, tools = [], effort = "" }) {
    const { provider, name } = splitModel(model);
    if (this.routers[provider]) return this.routerChat(provider, name, model, { messages, tools });
    if (provider !== "ollama") throw new Error(`unknown model provider: ${provider}`);
    if (!this.ollamaKey) throw new Error("OLLAMA_API_KEY is not set");
    const caps = await this.capabilities(model);
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
    if (tools.length && caps.tools) {
      body.tools = tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
    }
    // Ollama: no level = the model's default; "low" turns thinking off; gpt-oss takes the level itself.
    if (caps.thinking && effort) body.think = effort === "low" ? false : /gpt-oss/i.test(name) ? effort : true;
    const response = await fetch(`${this.ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.ollamaKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(`ollama ${name}: ${String(data.error || response.status).slice(0, 200)}`);
    const message = data.message || {};
    return {
      text: message.content || "",
      thinking: message.thinking || "",
      toolCalls: (message.tool_calls || []).map((call) => ({ id: call.id || callId(), name: call.function?.name, args: parseArgs(call.function?.arguments) })),
    };
  }

  /**
   * One model call through a router that speaks the OpenAI chat format
   * (OrcaRouter): same messages and tools as Ollama, same {text, thinking, toolCalls}.
   */
  async routerChat(provider, name, model, { messages, tools }) {
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
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) {
      const reason = data.error?.message || data.error || data.message || response.status;
      throw new Error(`${ROUTERS[provider].label} ${name}: ${String(reason).slice(0, 200)}`);
    }
    const message = data.choices?.[0]?.message || {};
    const text = Array.isArray(message.content) ? message.content.map((part) => part.text || "").join("") : message.content || "";
    return {
      text,
      thinking: message.reasoning_content || message.reasoning || "",
      toolCalls: (message.tool_calls || []).map((call) => ({ id: call.id || callId(), name: call.function?.name, args: parseArgs(call.function?.arguments) })),
    };
  }
}
