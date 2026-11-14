import { spawn } from "node:child_process";
import { noteChildPid } from "./thread-sessions.js";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { geminiSettings } from "./gemini-profile.js";
import { codexCredentialStore } from "./harnesses.js";
import { deepSeekUsage, emptyMeter, mergeMeter } from "./usage.js";

export const MCP_SCRIPT = fileURLToPath(new URL("./mcp-server.js", import.meta.url));
const SECRET_ENV = ["DISCORD_BOT_TOKEN", "TELEGRAM_BOT_TOKEN", "SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "OLLAMA_API_KEY", "ORCAROUTER_API_KEY", "TYPESAFE_API_KEY", "SONIOX_API_KEY", "DEEPSEEK_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "CORA_ADMIN_PASSWORD", "CORA_SESSION_KEY", "CORA_VAULT_KEY", "CORA_MAIL_REGISTRATION_TOKEN", "VAPID_KEY", "BRAIN_DATABASE_URL", "CORA_BRAIN_DATABASE_URL", "CORO_BRAIN_DATABASE_URL"];
const CODEX_CORA_INSTRUCTIONS = [
  "You are running inside Cora. Codex's read-only sandbox protects the local CLI host; its native shell, filesystem editing and browser tools are disabled.",
  "The mcp__cora tools are provided by Cora separately. When available, mcp__cora.shell executes on the agent's own Linux desktop, where files can be written and authorized remote connectors can be called. The local host sandbox does not make those connectors read-only.",
  "Use only the tools exposed for this turn. Follow the owner's actual request or scheduled task, including any read-only limit, recipient, account and confirmation requirements. Tool availability alone is not authorization for unrelated writes.",
  "For an already authorized action, inspect the connector's actual schema and results. Do not invent a missing write permission from the CLI sandbox. Respect real permission denials and report their evidence; never bypass them or change the host sandbox.",
].join("\n");
const CODEX_DISABLED_FEATURES = [
  "shell_tool", "unified_exec", "apps", "browser_use", "browser_use_external", "computer_use",
  "tool_suggest", "view_image", "memories", "sleep_tool", "multi_agent",
];

/** Cora's environment without its secrets: what an agent's CLI starts with. */
export function childEnv() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (SECRET_ENV.includes(name) || /^COR[AO]_(BOT|TG_BOT|SK_BOT|SK_APP|GH_KEY|MAIL_ACCOUNT|GOOGLE|KNOWLEDGE)_/.test(name)) delete env[name];
  return env;
}

function run(bin, args, { input, cwd, timeoutMs, onLine, env = {}, authEnv, signal, interactive }) {
  signal?.throwIfAborted();
  return new Promise((resolve) => {
    const tracked = Boolean(noteChildPid.getStore());
    const child = spawn(bin, args, { cwd, env: { ...(authEnv || childEnv()), ...env }, stdio: ["pipe", "pipe", "pipe"], detached: tracked });
    if (tracked) noteChildPid.getStore()(child.pid);
    const stdout = [];
    const stderr = [];
    let partial = "";
    const io = {
      write(message) { if (child.stdin.writable) child.stdin.write(`${JSON.stringify(message)}\n`); },
      close() { child.stdin.end(); },
    };
    const lines = (chunk, end = false) => {
      if (!onLine) return;
      partial += chunk;
      const parts = partial.split("\n");
      partial = end ? "" : parts.pop();
      for (const line of parts) {
        if (!line.trim()) continue;
        try { onLine(line, io); } catch {}
      }
    };
    let timedOut = false;
    let killTimer;
    const terminate = () => {
      if (tracked) {
        try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
      } else child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (tracked) {
          try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
        } else child.kill("SIGKILL");
      }, 5000);
      killTimer.unref();
    };
    signal?.addEventListener("abort", terminate, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
      lines(String(chunk));
    });
    child.stderr.on("data", (chunk) => { if (stderr.length < 200) stderr.push(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", terminate);
      resolve({ code: -1, stdout: "", stderr: error.message, timedOut });
    });
    child.on("close", (code, exitSignal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", terminate);
      lines("", true);
      resolve({ code, signal: exitSignal, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), timedOut });
    });
    child.stdin.on("error", () => {});
    if (interactive) interactive(io);
    else child.stdin.end(input);
  });
}

function cliFailure(message, out) {
  return Object.assign(new Error(message), { code: "HARNESS_FAILURE", exitCode: out.code, signal: out.signal || "", timedOut: out.timedOut });
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

/**
 * Text the model writes between tool calls is part of its reasoning; the last
 * text is the answer itself. Hold each text until something follows it.
 */
function textSteps(onStep) {
  let pending = "";
  return {
    text(value) {
      if (pending) onStep?.({ type: "text", text: pending });
      pending = value;
    },
    flush() {
      if (pending) onStep?.({ type: "text", text: pending });
      pending = "";
    },
    finish(answer) {
      if (pending && pending.trim() !== String(answer || "").trim()) onStep?.({ type: "text", text: pending });
      pending = "";
    },
  };
}

const GEMINI_THOUGHT_LEVELS = { low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" };

/**
 * Antigravity over ACP: the only mode that streams its thoughts. Each run gets its own
 * --gemini-dir, so the Cora MCP server and the permissions belong to this run alone.
 */
export async function runGemini({ bin, model, system, prompt, mcp, toolNames, workDir, timeoutMs, onStep, effort = "", authEnv, signal }) {
  if (!authEnv?.HOME || !authEnv.ANTIGRAVITY_CREDENTIAL_SCOPE) throw new Error("subscription da collegare");
  const directory = join(workDir, `gemini-${randomBytes(6).toString("hex")}`);
  const agents = join(directory, ".agents", "agents");
  const geminiDir = join(directory, ".gemini");
  for (const dir of [agents, join(geminiDir, "config"), join(geminiDir, "antigravity-cli")]) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tools = mcp && toolNames.length ? toolNames : [];
  writeFileSync(join(agents, "cora.md"), `---\nname: cora\ndescription: Cora agent with Cora MCP tools only\nmainAgent: true\nsubagent: false\ntools: []\ncommandExecutionPolicy: off\n---\n${system}\n`, { mode: 0o600 });
  writeFileSync(join(geminiDir, "config", "mcp_config.json"), JSON.stringify({ mcpServers: tools.length ? {
    cora: { command: process.execPath, args: [MCP_SCRIPT], env: { CORA_BRIDGE_URL: mcp.url, CORA_BRIDGE_TOKEN: mcp.token }, enabledTools: tools,
      tools: Object.fromEntries(tools.map((name) => [name, { eager: true }])) },
  } : {} }), { mode: 0o600 });
  writeFileSync(join(geminiDir, "antigravity-cli", "settings.json"), JSON.stringify(geminiSettings(tools)), { mode: 0o600 });
  const args = ["acp", "--agent", "cora", "--disable-telemetry", "--gemini-dir", geminiDir];
  const text = `<istruzioni_di_sistema>\n${system}\n</istruzioni_di_sistema>\n\n${prompt}`;
  const texts = textSteps(onStep);
  const pending = new Map();
  let nextId = 0;
  let fragment = "";
  let thought = "";
  let result = null;
  let failure = "";
  const flushThought = () => {
    if (thought.trim()) onStep?.({ type: "thinking", text: thought.trim() });
    thought = "";
  };
  const request = (io, method, params, then) => {
    nextId += 1;
    pending.set(nextId, then);
    io.write({ jsonrpc: "2.0", id: nextId, method, params });
  };
  const fail = (io, error) => {
    failure = String(error?.message || error || "");
    io.close();
  };
  const start = (io) => request(io, "initialize", { protocolVersion: 1, clientCapabilities: {} }, (error) => {
    if (error) return fail(io, error);
    request(io, "session/new", { cwd: directory, mcpServers: [] }, (error, session) => {
      if (error) return fail(io, error);
      const sessionId = session.sessionId;
      const ask = () => request(io, "session/prompt", { sessionId, prompt: [{ type: "text", text }] }, (error, done) => {
        if (error) return fail(io, error);
        result = done || {};
        io.close();
      });
      request(io, "session/set_model", { sessionId, modelId: model }, (error) => {
        if (error) return fail(io, error);
        const level = GEMINI_THOUGHT_LEVELS[effort];
        if (!level) return ask();
        request(io, "session/set_config_option", { sessionId, configId: "thought_level", value: level }, () => ask());
      });
    });
  });
  const onLine = (line, io) => {
    const message = JSON.parse(line);
    if (message.method === "session/update") {
      const update = message.params?.update || {};
      const chunk = String(update.content?.text || "");
      if (update.sessionUpdate === "agent_thought_chunk") thought += chunk;
      else if (update.sessionUpdate === "agent_message_chunk") {
        flushThought();
        fragment += chunk;
      } else if (update.sessionUpdate === "tool_call") {
        flushThought();
        if (fragment) { texts.text(fragment); fragment = ""; }
        texts.flush();
      }
      return;
    }
    if (message.method === "session/request_permission") {
      const call = message.params?.toolCall || {};
      const ours = /^mcp_cora_/.test(String(call.name || call.title || "")) || /^mcp_cora_/.test(String(call.rawInput?.name || ""));
      const options = message.params?.options || [];
      const option = options.find((item) => String(item.kind).startsWith(ours ? "allow_once" : "reject")) || options.find((item) => String(item.kind).startsWith(ours ? "allow" : "reject"));
      io.write({ jsonrpc: "2.0", id: message.id, result: { outcome: option ? { outcome: "selected", optionId: option.optionId } : { outcome: "cancelled" } } });
      return;
    }
    if (message.method && message.id !== undefined) {
      io.write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "not supported by Cora" } });
      return;
    }
    const then = pending.get(message.id);
    if (!then) return;
    pending.delete(message.id);
    then(message.error || null, message.result);
  };
  try {
    const out = await run(bin, args, { cwd: directory, timeoutMs, onLine, authEnv, signal, interactive: start });
    signal?.throwIfAborted();
    if (out.timedOut) throw cliFailure(`gemini: no answer within ${Math.round(timeoutMs / 1000)}s`, out);
    flushThought();
    const answer = fragment.trim();
    const warning = /^\u26a0\ufe0f?\s*/.test(answer) ? answer.replace(/^\u26a0\ufe0f?\s*/, "") : "";
    const problem = failure || warning;
    if (!result || problem || !["end_turn", "max_tokens"].includes(result.stopReason)) {
      if (/authentication required|authentication failed|not signed in|not logged in/i.test(`${problem} ${out.stderr}`)) throw new Error("gemini: not signed in, collega la subscription");
      const error = new Error(`gemini: ${String(problem || "Antigravity non ha completato la richiesta").slice(0, 240)}`);
      if (/individual quota reached|usage limit reached/i.test(problem)) Object.assign(error, { code: "GEMINI_QUOTA_EXHAUSTED", model });
      throw error;
    }
    texts.finish(answer);
    const usage = result.usage || {};
    return { text: answer, usage: {
      in: (Number(usage.inputTokens) || 0) + (Number(usage.cachedReadTokens) || 0),
      out: Number(usage.outputTokens) || 0,
    } };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

/** One agent turn on Claude Code with the owner's subscription; cora's tools arrive over MCP. */
export async function runClaude({ bin, model, system, prompt, mcp, toolNames, workDir, timeoutMs, onStep, effort = "", goal = "", authEnv, residentAuth = false, signal }) {
  if (!authEnv || (!authEnv.CLAUDE_CONFIG_DIR && !residentAuth)) throw new Error("subscription da collegare");
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const id = randomBytes(6).toString("hex");
  const mcpFile = join(workDir, `mcp-${id}.json`);
  // The owner's own hooks stay out: the Cora harness runs doc's checks itself, for every model.
  // Thinking arrives empty unless the session asks for summaries with --thinking-display.
  const args = ["-p", "--output-format", "stream-json", "--verbose", ...(effort ? ["--effort", effort] : []), "--model", model, "--system-prompt", system, "--tools", "", "--no-session-persistence", "--thinking-display", "summarized", "--strict-mcp-config", "--settings", JSON.stringify({ disableAllHooks: true })];
  // Claude Code has a goal mode of its own: `/goal <condition>` makes it check after each
  // turn whether the condition holds and go back to work until it does, inside one session.
  // Sent as two streamed messages, the goal first, so the task keeps all its context.
  if (goal) args.push("--input-format", "stream-json");
  const message = (text) => `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } })}\n`;
  const input = goal ? `${message(`/goal ${goal}`)}${message(prompt)}` : prompt;
  if (mcp && toolNames.length) {
    writeFileSync(mcpFile, JSON.stringify({
      mcpServers: { cora: { command: process.execPath, args: [MCP_SCRIPT], env: { CORA_BRIDGE_URL: mcp.url, CORA_BRIDGE_TOKEN: mcp.token } } },
    }), { mode: 0o600 });
    args.push("--mcp-config", mcpFile, "--allowedTools", toolNames.map((name) => `mcp__cora__${name}`).join(","));
  }
  const stream = messageStream(onStep);
  try {
    const out = await run(bin, args, { input, cwd: workDir, timeoutMs, onLine: stream.onLine, authEnv, signal });
    signal?.throwIfAborted();
    if (out.timedOut) throw cliFailure(`claude: no answer within ${Math.round(timeoutMs / 1000)}s`, out);
    return stream.answer("claude", out);
  } finally {
    rmSync(mcpFile, { force: true });
  }
}

/**
 * Claude Code's stream-json, which Grok Build speaks too: thinking, text and
 * tool use as they come, then one result with the answer and the tokens.
 */
function messageStream(onStep) {
  let data = null;
  const texts = textSteps(onStep);
  return {
    onLine(line) {
      const event = JSON.parse(line);
      if (event.type === "result") data = event;
      if (event.type !== "assistant") return;
      for (const block of event.message?.content || []) {
        if (block.type === "thinking" || block.type === "redacted_thinking") {
          texts.flush();
          onStep?.(block.thinking?.trim() ? { type: "thinking", text: block.thinking } : { type: "thinking", hidden: true });
        } else if (block.type === "text" && block.text?.trim()) {
          texts.text(block.text);
        } else if (block.type === "tool_use") {
          texts.flush();
        }
      }
    },
    answer(name, out) {
      if (!data) throw cliFailure(`${name}: ${(out.stderr || out.stdout).trim().slice(-240) || `exit ${out.code}`}`, out);
      if (data.is_error) throw new Error(`${name}: ${String(data.result || data.subtype || "error").slice(0, 240)}`);
      texts.finish(data.result);
      const used = data.usage || {};
      return {
        text: String(data.result || ""),
        // Cached input was still read for this turn: it counts as what the turn cost.
        usage: {
          in: (Number(used.input_tokens) || 0) + (Number(used.cache_read_input_tokens) || 0) + (Number(used.cache_creation_input_tokens) || 0),
          out: Number(used.output_tokens) || 0,
        },
      };
    },
  };
}

/**
 * Hermes' config for Cora's runs, in a home of its own: the model through an
 * OpenAI-style endpoint (a local Ollama by default) and Cora's MCP server,
 * whose session arrives per run through ${...} placeholders Hermes fills in
 * from the environment. Runs in parallel share it.
 */
export function hermesConfig({ baseUrl, model, keyed = false, vision = false }) {
  return [
    "# Written by Cora: Hermes runs Cora's agents with Cora's tools only.",
    "model:",
    "  provider: cora-endpoint",
    `  base_url: ${JSON.stringify(baseUrl)}`,
    `  default: ${JSON.stringify(model)}`,
    `  supports_vision: ${Boolean(vision)}`,
    "providers:",
    "  cora-endpoint:",
    `    api: ${JSON.stringify(baseUrl)}`,
    `    base_url: ${JSON.stringify(baseUrl)}`,
    // The key never lands in the file: Hermes expands the variable the run gives it.
    ...(keyed ? ["    api_key: \"${CORA_ENDPOINT_KEY}\""] : []),
    `    default_model: ${JSON.stringify(model)}`,
    "plugins:",
    "  enabled:",
    "    - cora-tools",
    "",
  ].join("\n");
}

/** Hermes' own banner when the model answered with nothing at all. */
const NO_REPLY = /^\s*\W{0,4}No reply\b/i;

/**
 * Hermes keeps each step of a session in its state.db as it goes: the thoughts, the
 * text between tool calls and the calls. One-shot mode prints only the answer, so Cora
 * follows the session there: found by the prompt it was given, then by the id Hermes
 * reports at the end.
 */
function hermesSteps({ home, input, since, onStep }) {
  const texts = textSteps(onStep);
  let db = null;
  let sessionId = "";
  let lastId = 0;
  const open = () => {
    if (db) return db;
    const file = join(home, "state.db");
    if (!existsSync(file)) return null;
    try { db = new DatabaseSync(file, { readOnly: true }); } catch { db = null; }
    return db;
  };
  const read = (id = "") => {
    if (!onStep) return;
    const handle = open();
    if (!handle) return;
    try {
      if (!sessionId) {
        sessionId = id || handle.prepare("SELECT m.session_id AS id FROM sessions s JOIN messages m ON m.session_id = s.id WHERE s.started_at >= ? AND m.role = 'user' AND m.content = ? ORDER BY s.started_at DESC LIMIT 1").get(since, input)?.id || "";
      }
      if (!sessionId) return;
      const rows = handle.prepare("SELECT id, role, content, reasoning, reasoning_content, tool_calls FROM messages WHERE session_id = ? AND id > ? ORDER BY id").all(sessionId, lastId);
      for (const row of rows) {
        lastId = row.id;
        if (row.role !== "assistant") continue;
        const thought = String(row.reasoning || row.reasoning_content || "").trim();
        if (thought) {
          texts.flush();
          onStep({ type: "thinking", text: thought });
        }
        if (String(row.content || "").trim()) texts.text(String(row.content));
        if (row.tool_calls && row.tool_calls !== "[]") texts.flush();
      }
    } catch {}
  };
  return {
    read,
    answer(id = "") {
      const handle = open();
      if (!handle) return "";
      try {
        const session = id || sessionId || handle.prepare("SELECT m.session_id AS id FROM sessions s JOIN messages m ON m.session_id = s.id WHERE s.started_at >= ? AND m.role = 'user' AND m.content = ? ORDER BY s.started_at DESC LIMIT 1").get(since, input)?.id;
        if (!session) return "";
        const row = handle.prepare("SELECT role, content, tool_calls FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1").get(session);
        return row?.role === "assistant" && (!row.tool_calls || ["[]", "null"].includes(row.tool_calls)) ? String(row.content || "").trim() : "";
      } catch { return ""; }
    },
    finish(id, answer) {
      read(id);
      texts.finish(answer);
      try { db?.close(); } catch {}
      db = null;
    },
  };
}

/**
 * One agent turn on Hermes Agent, one-shot: only Cora's tools (the cora
 * toolset: no terminal, files or computer use on the host), no personal rules
 * or memory of the owner's Hermes, the answer on stdout. Its thoughts and steps
 * come from the session it records.
 */
export async function runHermes({ bin, model, system, prompt, mcp, toolNames, workDir, timeoutMs, home, baseUrl, apiKey = "", vision = false, onStep, beforeTool, signal }) {
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const configFile = join(home, "config.yaml");
  const plugin = join(home, "plugins", "cora-tools");
  mkdirSync(plugin, { recursive: true, mode: 0o700 });
  for (const file of ["plugin.yaml", "__init__.py"]) {
    const source = fileURLToPath(new URL(`./hermes-cora/${file}`, import.meta.url));
    const target = join(plugin, file);
    if (existsSync(target) && readFileSync(target, "utf8") === readFileSync(source, "utf8")) continue;
    const temporary = `${target}.${randomBytes(6).toString("hex")}`;
    copyFileSync(source, temporary);
    renameSync(temporary, target);
  }
  const config = hermesConfig({ baseUrl, model, keyed: Boolean(apiKey), vision });
  let current = "";
  try { current = readFileSync(configFile, "utf8"); } catch {}
  // Only the default model changes between runs, and -m overrides it: rewrite when anything else differs.
  const settled = (text) => text.replace(/^\s+default(_model)?:.*$/gm, "");
  if (settled(current) !== settled(config)) writeFileSync(configFile, config, { mode: 0o600 });
  const tools = mcp && toolNames.length;
  const input = `${system}\n\n---\n\n${prompt}`;
  const usageFile = join(workDir, `hermes-usage-${randomBytes(6).toString("hex")}.json`);
  // In one-shot mode an MCP server's toolset is named after the server, and -t is the complete list.
  let streamed = Buffer.byteLength(input, "utf8") >= 64 * 1024;
  const args = () => streamed
    ? ["chat", "--query-file", "-", "--quiet", "--oneshot", "-m", model, "--provider", "cora-endpoint", "--ignore-rules", "-t", tools ? "cora" : "clarify"]
    : ["-z", input, "-m", model, "--provider", "cora-endpoint", "--ignore-rules", "-t", tools ? "cora" : "clarify", "--usage-file", usageFile];
  const env = { HERMES_HOME: home, CORA_MODEL_VISION: vision ? "1" : "0", ...(apiKey ? { CORA_ENDPOINT_KEY: apiKey } : {}), ...(tools ? { CORA_BRIDGE_URL: mcp.url, CORA_BRIDGE_TOKEN: mcp.token } : {}) };
  const steps = hermesSteps({ home, input, since: Date.now() / 1000 - 5, onStep });
  const poll = onStep ? setInterval(() => steps.read(), 1000) : null;
  poll?.unref?.();
  // Hermes records the turn that calls a tool before running it: its thought comes before the tool.
  if (beforeTool) beforeTool.run = () => steps.read();
  try {
    const launch = () => run(bin, args(), { input: streamed ? input : undefined, cwd: workDir, timeoutMs, env, signal });
    let out;
    try { out = await launch(); }
    catch (error) {
      if (error.code !== "E2BIG" || streamed) throw error;
      streamed = true;
      onStep?.({ type: "note", text: "Hermes: argomenti troppo grandi; riparto passando il contesto su stdin." });
      out = await launch();
    }
    if (!streamed && out.code === -1 && /^spawn E2BIG$/.test(out.stderr.trim())) {
      streamed = true;
      onStep?.({ type: "note", text: "Hermes: argomenti troppo grandi; riparto passando il contesto su stdin." });
      out = await launch();
    }
    clearInterval(poll);
    signal?.throwIfAborted();
    if (out.timedOut) throw cliFailure(`hermes: no answer within ${Math.round(timeoutMs / 1000)}s`, out);
    const sessionId = streamed ? out.stderr.match(/^session_id:\s*(\S+)\s*$/m)?.[1] || "" : "";
    const text = streamed && out.code === 0 ? steps.answer(sessionId) : out.stdout.trim();
    if (out.code !== 0 || /^hermes -z: agent failed/m.test(text) || /^hermes -z: agent failed/m.test(out.stderr)) {
      throw cliFailure(`hermes: ${(out.stderr || text).trim().slice(-240) || `exit ${out.code}`}`, out);
    }
    let report = {};
    try { report = JSON.parse(readFileSync(usageFile, "utf8")); } catch {}
    // A provider's refusal (no credits, a bad key) comes back as the answer with exit 0:
    // the report says the run failed, and that text is never said in the agent's name.
    if (report.failed === true) throw new Error(`hermes: ${text.slice(-240) || `${model} failed`}`);
    // Hermes exits 0 and prints a banner when the model gave it nothing: that is a
    // failed turn, never something to say in the agent's name.
    if (!text || NO_REPLY.test(text)) throw new Error(`hermes: ${model} returned no content`);
    steps.finish(report.session_id || sessionId, text);
    return { text };
  } finally {
    clearInterval(poll);
    if (beforeTool) beforeTool.run = null;
    steps.finish("", "");
    rmSync(usageFile, { force: true });
  }
}

/**
 * The rows of dsh's headless profile Cora switches off: every tool that acts on this
 * machine (the agent works on its own computer through Cora's tools), the owner's
 * instructions and skills dsh would read from disk, dsh's own goal tools (Cora checks
 * the work itself), the extra call that titles a session, and the session files.
 */
export const DSH_OFF = [
  "tool-bash", "tool-pwsh", "tool-jobs", "tool-fs", "tool-fs-search", "tool-web", "tool-workflow", "tool-working-directory",
  "tool-subagent", "tool-subagent-fork", "tool-subagent-control", "tool-subagent-list-agents", "tool-skill", "skill-filesystem",
  "agent-instructions", "tool-goal", "mcp-resources", "session-title-llm",
  "session-persistence-jsonl", "session-projection-cache", "session-checkpoint-policy",
];
// Cora's effort levels on DeepSeek's: "" leaves DeepSeek's default (high).
const DSH_EFFORTS = { low: "low", medium: "high", high: "max" };

/**
 * The overlay one dsh run boots with, on top of its headless profile. The system
 * prompt travels with the task instead: dsh reads {{…}} in its own prompt as
 * variables, and the owner's instructions may hold any text.
 */
export function dshPatch({ model, effort = "", mcp = false, workDir }) {
  const lines = [
    "- id: agent-default-model",
    "  config:",
    "    provider: deepseek-official",
    `    model: ${JSON.stringify(model)}`,
    ...(DSH_EFFORTS[effort] ? [`    reasoningEffort: ${DSH_EFFORTS[effort]}`] : []),
    "- id: system-prompt",
    "  config:",
    "    personaPrefix: You are an agent of Cora, running on the {{model}} model through DeepSeek Harness.",
    "- id: session-telemetry-otel",
    "  config:",
    "    mode: DISABLED",
    ...DSH_OFF.flatMap((id) => [`- id: ${id}`, "  disabled: true"]),
  ];
  if (mcp) {
    lines.push(
      "- insert:",
      "    - id: mcp-cora",
      "      name: '@deepseek-ai/dsh-mcp-client'",
      "      config:",
      "        serverName: cora",
      "        transport: stdio",
      `        command: ${JSON.stringify(process.execPath)}`,
      `        args: [${JSON.stringify(MCP_SCRIPT)}]`,
      "        env:",
      "          CORA_BRIDGE_URL: !!js process.env.CORA_BRIDGE_URL",
      "          CORA_BRIDGE_TOKEN: !!js process.env.CORA_BRIDGE_TOKEN",
      `        cwd: ${JSON.stringify(workDir)}`,
      "        toolCallTimeoutMs: 3600000",
      "        failOnStartupError: true",
    );
  }
  return `${lines.join("\n")}\n`;
}

/** dsh is a Node program: it runs on Cora's own Node, whatever `node` the PATH would pick. */
function dshScript(bin) {
  const found = bin.includes("/") ? bin : (process.env.PATH || "").split(":").map((dir) => join(dir, bin)).find((path) => path && existsSync(path));
  if (!found || !existsSync(found)) throw new Error("deepseek: dsh non è installato su questa macchina");
  return realpathSync(found);
}

/**
 * One agent turn on DeepSeek Harness (dsh), headless, with the instance's DeepSeek
 * key: Cora's tools arrive over MCP and dsh's own are off. `home` is Cora's own
 * DSH_HOME, never the owner's, and nothing is sent to DeepSeek's telemetry.
 */
export async function runDeepSeek({ bin, model, system, prompt, mcp, toolNames, workDir, timeoutMs, onStep, onUsage, effort = "", home, apiKey, signal }) {
  if (!apiKey) throw new Error("deepseek: la chiave DeepSeek non è collegata");
  const script = dshScript(bin);
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const tools = Boolean(mcp && toolNames.length);
  const patchFile = join(workDir, `dsh-${randomBytes(6).toString("hex")}.yml`);
  writeFileSync(patchFile, dshPatch({ model, effort, mcp: tools, workDir }), { mode: 0o600 });
  const env = {
    DSH_HOME: home, DEEPSEEK_API_KEY: apiKey, DSH_TELEMETRY_MODE: "DISABLED", DSH_PERMISSION_MODE: "read-only",
    ...(tools ? { CORA_BRIDGE_URL: mcp.url, CORA_BRIDGE_TOKEN: mcp.token } : {}),
  };
  const input = `<istruzioni_di_sistema>\n${system}\n</istruzioni_di_sistema>\n\n${prompt}`;
  const texts = textSteps(onStep);
  const used = { in: 0, out: 0, meter: emptyMeter() };
  const started = new Map();
  const completed = new Set();
  let final = null;
  let failure = "";
  const onLine = (line) => {
    const event = JSON.parse(line);
    // DeepSeek often skips thinking on a plain step after a tool: the block arrives with no
    // text at all, which is no thought rather than a hidden one.
    if (event.type === "thinking") {
      if (!String(event.text || "").trim()) return;
      texts.flush();
      onStep?.({ type: "thinking", text: event.text });
    } else if (event.type === "text" && String(event.text || "").trim()) texts.text(event.text);
    else if (event.type === "tool_call") texts.flush();
    else if (event.type === "status" && event.phase === "step_start") started.set(`${event.turn}:${event.step}`, Date.now());
    else if (event.type === "status" && event.phase === "step_end") {
      const key = `${event.turn}:${event.step}`;
      if (completed.has(key)) return;
      completed.add(key);
      const usage = deepSeekUsage(model, event.usage, { startedAt: started.get(key) ?? Date.now(), endedAt: Date.now() });
      used.in += usage.in;
      used.out += usage.out;
      mergeMeter(used.meter, usage.meter);
      onUsage?.(usage);
    } else if (event.type === "status" && event.phase === "turn_end" && event.reason?.kind === "error") failure = String(event.reason.error?.message || "error");
    else if (event.type === "error") failure = String(event.message || "error");
    else if (event.type === "final") final = event;
  };
  try {
    const out = await run(process.execPath, [script, "--profile", "headless", "--patch", patchFile, "--json", "-"], { input, cwd: workDir, timeoutMs, onLine, env, signal });
    signal?.throwIfAborted();
    if (out.timedOut) throw cliFailure(`deepseek: no answer within ${Math.round(timeoutMs / 1000)}s`, out);
    const text = String(final?.text || "");
    if (out.code !== 0 || !final) throw cliFailure(`deepseek: ${(failure || out.stderr.replace(/^dsh: /gm, "") || `exit ${out.code}`).trim().slice(-240)}`, out);
    if (!text.trim()) throw new Error(`deepseek: ${model} returned no content`);
    texts.finish(text);
    return { text, usage: used, usageStreamed: Boolean(onUsage) };
  } finally {
    rmSync(patchFile, { force: true });
  }
}

/** One agent turn on the Codex CLI with the owner's ChatGPT subscription; its own shell and browser tools are off. */
export async function runCodex({ bin, model, system, prompt, mcp, toolNames, workDir, timeoutMs, onStep, effort = "", authEnv, residentAuth = false, signal }) {
  if (!authEnv || (!authEnv.CODEX_HOME && !residentAuth)) throw new Error("subscription da collegare");
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const id = randomBytes(6).toString("hex");
  const outFile = join(workDir, `codex-${id}.txt`);
  const args = [
    "exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--color", "never",
    "-s", "read-only", "-C", workDir, "-m", model, "-o", outFile, "--json",
    "-c", "approval_policy=\"never\"", "-c", "model_reasoning_summary=\"detailed\"",
    "-c", `developer_instructions=${tomlString(CODEX_CORA_INSTRUCTIONS)}`,
    "-c", codexCredentialStore(residentAuth), "-c", 'forced_login_method="chatgpt"',
    ...(effort ? ["-c", `model_reasoning_effort=${tomlString(effort)}`] : []),
  ];
  for (const feature of CODEX_DISABLED_FEATURES) args.push("--disable", feature);
  if (mcp && toolNames.length) {
    args.push(
      "-c", `mcp_servers.cora.command=${tomlString(process.execPath)}`,
      "-c", `mcp_servers.cora.args=[${tomlString(MCP_SCRIPT)}]`,
      "-c", `mcp_servers.cora.env={ CORA_BRIDGE_URL = ${tomlString(mcp.url)}, CORA_BRIDGE_TOKEN = ${tomlString(mcp.token)} }`,
      "-c", "mcp_servers.cora.default_tools_approval_mode=\"approve\"",
    );
  }
  args.push("-");
  const input = `<istruzioni_di_sistema>\n${system}\n</istruzioni_di_sistema>\n\n${prompt}`;
  const texts = textSteps(onStep);
  let failure = "";
  // The last thing the agent actually said: if the CLI dies after saying it, that answer is not lost.
  let said = "";
  const used = { in: 0, out: 0 };
  const onLine = (line) => {
    const event = JSON.parse(line);
    if (event.type === "turn.completed" && event.usage) {
      used.in += Number(event.usage.input_tokens) || 0;
      used.out += (Number(event.usage.output_tokens) || 0) + (Number(event.usage.reasoning_output_tokens) || 0);
    }
    if (event.type === "error" || event.type === "turn.failed") failure = String(event.message || event.error?.message || failure);
    if (event.type !== "item.completed") return;
    const item = event.item || {};
    if (item.type === "reasoning" && item.text?.trim()) {
      texts.flush();
      onStep?.({ type: "thinking", text: item.text });
    } else if (item.type === "agent_message" && item.text?.trim()) {
      said = item.text;
      texts.text(item.text);
    } else if (item.type === "mcp_tool_call") {
      texts.flush();
    }
  };
  try {
    const out = await run(bin, args, { input, cwd: workDir, timeoutMs, onLine, authEnv, signal });
    signal?.throwIfAborted();
    if (out.timedOut) throw cliFailure(`codex: no answer within ${Math.round(timeoutMs / 1000)}s`, out);
    let text = "";
    try { text = readFileSync(outFile, "utf8"); } catch {}
    // A CLI that exits badly after the agent has answered still has an answer to give.
    if (out.code !== 0 && !text.trim() && said.trim()) text = said;
    // stdout is the event stream: dumping its last lines reports JSON, not a reason.
    if (out.code !== 0 && !text.trim()) throw cliFailure(`codex: ${(failure || out.stderr).trim().split("\n").slice(-3).join(" ").slice(0, 240) || `exited with ${out.code} and said nothing`}`, out);
    texts.finish(text);
    return { text, usage: used };
  } finally {
    rmSync(outFile, { force: true });
  }
}

/** The owner's Claude Code and Cursor setup Grok would otherwise bring along: agents, hooks, MCP servers, rules, skills. */
const GROK_IMPORTS = ["CLAUDE", "CURSOR"].flatMap((source) => ["AGENTS", "HOOKS", "MCPS", "RULES", "SKILLS"].map((kind) => `GROK_${source}_${kind}_ENABLED`));

/**
 * Grok's config for Cora's runs: only Cora's MCP server, whose session arrives
 * per run through ${...} placeholders Grok fills in from the environment, so
 * runs in parallel share it.
 */
export function grokConfig() {
  return [
    "# Written by Cora: Grok Build runs Cora's agents with Cora's tools only.",
    "[mcp_servers.cora]",
    `command = ${tomlString(process.execPath)}`,
    `args = [${tomlString(MCP_SCRIPT)}]`,
    'env = { CORA_BRIDGE_URL = "${CORA_BRIDGE_URL}", CORA_BRIDGE_TOKEN = "${CORA_BRIDGE_TOKEN}" }',
    "",
  ].join("\n");
}

/**
 * mise's own folders, as the owner's HOME would give them. On Omarchy `grok` is a
 * mise wrapper (`mise x npm:@xai-official/grok -- grok`): with the empty HOME a turn
 * runs in, mise would look for its tools there and refuse to start.
 */
function miseFolders() {
  const under = (variable, fallback) => join(process.env[variable] || join(homedir(), fallback), "mise");
  return {
    MISE_CONFIG_DIR: process.env.MISE_CONFIG_DIR || under("XDG_CONFIG_HOME", ".config"),
    MISE_DATA_DIR: process.env.MISE_DATA_DIR || under("XDG_DATA_HOME", ".local/share"),
    MISE_STATE_DIR: process.env.MISE_STATE_DIR || under("XDG_STATE_HOME", ".local/state"),
    MISE_CACHE_DIR: process.env.MISE_CACHE_DIR || under("XDG_CACHE_HOME", ".cache"),
  };
}

/**
 * One agent turn on Grok Build. Grok has no per-run MCP flag and keeps every session
 * on disk, prompts and a search index included, so each turn gets a Grok home of its
 * own that is gone when the turn ends: Cora's MCP server in its config.toml, the
 * account's login read where it lives (GROK_AUTH_PATH), so turns on one account run
 * side by side and the machine's own login works without a copy. An empty HOME and
 * the import switches keep the owner's Claude and Cursor setup out, and search_tool
 * and use_tool are its only tools: through them the model reaches Cora's and nothing
 * else. `home` keeps what Grok last said it can run, for the model list.
 */
export async function runGrok({ bin, model, system, prompt, mcp, toolNames, workDir, timeoutMs, onStep, effort = "", authEnv, residentAuth = false, home, signal }) {
  if (!authEnv || (!authEnv.GROK_HOME && !residentAuth)) throw new Error("subscription da collegare");
  const auth = join(authEnv.GROK_HOME || join(homedir(), ".grok"), "auth.json");
  const id = randomBytes(6).toString("hex");
  const runHome = join(workDir, `grok-${id}`);
  const empty = join(runHome, "home");
  mkdirSync(empty, { recursive: true, mode: 0o700 });
  writeFileSync(join(runHome, "config.toml"), grokConfig(), { mode: 0o600 });
  const promptFile = join(runHome, "prompt.md");
  writeFileSync(promptFile, prompt, { mode: 0o600 });
  const args = [
    "--prompt-file", promptFile, "--output-format", "streaming-messages-json", "-m", model,
    "--system-prompt-override", system, "--tools", "search_tool,use_tool", "--always-approve",
    "--no-auto-update", "--no-memory", "--no-subagents", "--disable-web-search",
    ...(effort ? ["--effort", effort] : []),
  ];
  const tools = mcp && toolNames.length;
  const env = {
    HOME: empty, GROK_HOME: runHome, GROK_AUTH_PATH: auth, GROK_DISABLE_AUTOUPDATER: "1", GROK_MEMORY: "0", ...miseFolders(),
    ...Object.fromEntries(GROK_IMPORTS.map((name) => [name, "0"])),
    CORA_BRIDGE_URL: tools ? mcp.url : "", CORA_BRIDGE_TOKEN: tools ? mcp.token : "",
  };
  const stream = messageStream(onStep);
  try {
    const out = await run(bin, args, { cwd: workDir, timeoutMs, onLine: stream.onLine, env, authEnv, signal });
    signal?.throwIfAborted();
    if (out.timedOut) throw cliFailure(`grok: no answer within ${Math.round(timeoutMs / 1000)}s`, out);
    return stream.answer("grok", out);
  } finally {
    if (home) {
      try {
        mkdirSync(home, { recursive: true, mode: 0o700 });
        copyFileSync(join(runHome, "models_cache.json"), join(home, "models_cache.json"));
      } catch {}
    }
    rmSync(runHome, { recursive: true, force: true });
  }
}

/** Muse Code with nothing of its own: no built-in tools, rules from other agents, reminder agents, web or session log. */
const MUSE_FLAGS = [
  "--json", "--preset", "empty", "--no-foreign-personal-context", "--disable-reminders", "--disable-request-user-input",
  "--disable-web-tools", "--no-session-log", "--approval-mode", "never",
  // Meta trains on a subscriber's turns unless told not to.
  "--contributor-mode", "off",
];

/**
 * One agent turn on Muse Code, one-shot. Cora's system prompt replaces Muse's own,
 * and its MCP server is handed over for this run only, so the account's settings
 * never change. Credentials stay in a file: on a Mac a service cannot always
 * reach the Keychain, and on Linux the file is all there is.
 */
export async function runMuse({ bin, model, system, prompt, mcp, toolNames, workDir, timeoutMs, onStep, effort = "", authEnv, residentAuth = false, signal }) {
  if (!authEnv || (!authEnv.XDG_CONFIG_HOME && !residentAuth)) throw new Error("subscription da collegare");
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const id = randomBytes(6).toString("hex");
  const promptFile = join(workDir, `muse-${id}.md`);
  writeFileSync(promptFile, prompt, { mode: 0o600 });
  const tools = mcp && toolNames.length;
  const server = { command: process.execPath, args: [MCP_SCRIPT], env: { CORA_BRIDGE_URL: "${CORA_BRIDGE_URL}", CORA_BRIDGE_TOKEN: "${CORA_BRIDGE_TOKEN}" } };
  const args = [
    "exec", ...MUSE_FLAGS, "--model", model, ...(effort ? ["--reasoning-effort", effort] : []),
    "-c", `run.system_prompt=${JSON.stringify(system)}`,
    ...(tools ? ["-c", `mcpServers.cora=${JSON.stringify(server)}`] : []),
    "--prompt-file", promptFile,
  ];
  const env = { MUSE_NO_AUTO_UPDATE: "1", TBH_CREDENTIAL_BACKEND: "file", ...(tools ? { CORA_BRIDGE_URL: mcp.url, CORA_BRIDGE_TOKEN: mcp.token } : {}) };
  const texts = textSteps(onStep);
  let said = "";
  let answer = null;
  let failure = "";
  const used = { in: 0, out: 0 };
  const onLine = (line) => {
    const event = JSON.parse(line);
    const payload = event.payload || {};
    const type = String(event.payload_type || "");
    if (type === "run.output.delta") said += payload.text || "";
    else if (type === "task.lifecycle.proposed" && String(payload.event?.task_kind || "").startsWith("tool.")) {
      // What it wrote before reaching for a tool was its reasoning, not the answer.
      if (said.trim()) texts.text(said);
      said = "";
      texts.flush();
    } else if (type === "task.lifecycle.failed") failure = String(payload.event?.reason || failure);
    else if (type === "run.usage") {
      for (const item of payload.models || []) {
        used.in += Number(item.input_tokens) || 0;
        used.out += (Number(item.output_tokens) || 0) + (Number(item.reasoning_tokens) || 0);
      }
    } else if (type.startsWith("run.terminal.")) {
      if (payload.terminal === "completed") answer = String(payload.text ?? said);
      else failure = String(payload.reason || payload.terminal || failure);
    }
  };
  try {
    const out = await run(bin, args, { cwd: workDir, timeoutMs, onLine, env, authEnv, signal });
    signal?.throwIfAborted();
    if (out.timedOut) throw cliFailure(`muse: no answer within ${Math.round(timeoutMs / 1000)}s`, out);
    // stdout is the event stream; the reason a run stopped is its last line on stderr.
    if (answer === null) throw cliFailure(`muse: ${(failure || out.stderr.trim().split("\n").pop() || "").slice(0, 240) || `exit ${out.code}`}`, out);
    texts.finish(answer);
    return { text: answer, usage: used };
  } finally {
    rmSync(promptFile, { force: true });
  }
}
