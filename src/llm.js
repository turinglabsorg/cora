import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runClaude, runCodex } from "./cli.js";

const REQUEST_TIMEOUT_MS = 240000;

export const PROVIDERS = {
  claude: "Claude (abbonamento)",
  codex: "ChatGPT (abbonamento)",
  ollama: "Ollama Cloud",
};

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
  constructor({ ollamaUrl, ollamaKey, claudeBin = "claude", codexBin = "codex", cliWorkDir, bridge, codexModelsFile }) {
    this.ollamaUrl = ollamaUrl;
    this.ollamaKey = ollamaKey;
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
    };
  }

  /** Claude Code and Codex run the whole tool loop themselves; Ollama goes through cora's loop. */
  isAgentic(model) {
    const { provider } = splitModel(model);
    return provider === "claude" || provider === "codex";
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
}
