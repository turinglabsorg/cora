import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const MCP_SCRIPT = fileURLToPath(new URL("./mcp-server.js", import.meta.url));
const SECRET_ENV = ["DISCORD_BOT_TOKEN", "TELEGRAM_BOT_TOKEN", "OLLAMA_API_KEY", "ORCAROUTER_API_KEY", "CORA_ADMIN_PASSWORD", "CORA_SESSION_KEY", "VAPID_KEY"];
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

function childEnv() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (SECRET_ENV.includes(name) || name.startsWith("CORA_BOT_") || name.startsWith("CORA_TG_BOT_")) delete env[name];
  return env;
}

function run(bin, args, { input, cwd, timeoutMs, onLine, env = {}, authEnv, signal }) {
  signal?.throwIfAborted();
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env: { ...(authEnv || childEnv()), ...env }, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let partial = "";
    const lines = (chunk, end = false) => {
      if (!onLine) return;
      partial += chunk;
      const parts = partial.split("\n");
      partial = end ? "" : parts.pop();
      for (const line of parts) {
        if (!line.trim()) continue;
        try { onLine(line); } catch {}
      }
    };
    let timedOut = false;
    let killTimer;
    const terminate = () => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
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
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", terminate);
      lines("", true);
      resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), timedOut });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
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

/** One agent turn on Claude Code with the owner's subscription; cora's tools arrive over MCP. */
export async function runClaude({ bin, model, system, prompt, mcp, toolNames, workDir, timeoutMs, onStep, effort = "", goal = "", authEnv, residentAuth = false, signal }) {
  if (!authEnv || (!authEnv.CLAUDE_CONFIG_DIR && !residentAuth)) throw new Error("subscription da collegare");
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const id = randomBytes(6).toString("hex");
  const mcpFile = join(workDir, `mcp-${id}.json`);
  const args = ["-p", "--output-format", "stream-json", "--verbose", ...(effort ? ["--effort", effort] : []), "--model", model, "--system-prompt", system, "--tools", "", "--no-session-persistence", "--strict-mcp-config"];
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
    if (out.timedOut) throw new Error(`claude: no answer within ${Math.round(timeoutMs / 1000)}s`);
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
      if (!data) throw new Error(`${name}: ${(out.stderr || out.stdout).trim().slice(-240) || `exit ${out.code}`}`);
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
export function hermesConfig({ baseUrl, model, keyed = false }) {
  return [
    "# Written by Cora: Hermes runs Cora's agents with Cora's tools only.",
    "model:",
    "  provider: cora-endpoint",
    `  base_url: ${JSON.stringify(baseUrl)}`,
    `  default: ${JSON.stringify(model)}`,
    "providers:",
    "  cora-endpoint:",
    `    api: ${JSON.stringify(baseUrl)}`,
    `    base_url: ${JSON.stringify(baseUrl)}`,
    // The key never lands in the file: Hermes expands the variable the run gives it.
    ...(keyed ? ["    api_key: \"${CORA_ENDPOINT_KEY}\""] : []),
    `    default_model: ${JSON.stringify(model)}`,
    "mcp_servers:",
    "  cora:",
    `    command: ${JSON.stringify(process.execPath)}`,
    "    args:",
    `      - ${JSON.stringify(MCP_SCRIPT)}`,
    "    env:",
    "      CORA_BRIDGE_URL: \"${CORA_BRIDGE_URL}\"",
    "      CORA_BRIDGE_TOKEN: \"${CORA_BRIDGE_TOKEN}\"",
    "",
  ].join("\n");
}

/** Hermes' own banner when the model answered with nothing at all. */
const NO_REPLY = /^\s*\W{0,4}No reply\b/i;

/**
 * One agent turn on Hermes Agent, one-shot: only Cora's tools (the cora
 * toolset: no terminal, files or computer use on the host), no personal rules
 * or memory of the owner's Hermes, the answer on stdout.
 */
export async function runHermes({ bin, model, system, prompt, mcp, toolNames, workDir, timeoutMs, home, baseUrl, apiKey = "", signal }) {
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const configFile = join(home, "config.yaml");
  const config = hermesConfig({ baseUrl, model, keyed: Boolean(apiKey) });
  let current = "";
  try { current = readFileSync(configFile, "utf8"); } catch {}
  // Only the default model changes between runs, and -m overrides it: rewrite when anything else differs.
  const settled = (text) => text.replace(/^\s+default(_model)?:.*$/gm, "");
  if (settled(current) !== settled(config)) writeFileSync(configFile, config, { mode: 0o600 });
  const tools = mcp && toolNames.length;
  // In one-shot mode an MCP server's toolset is named after the server, and -t is the complete list.
  const args = ["-z", `${system}\n\n---\n\n${prompt}`, "-m", model, "--provider", "cora-endpoint", "--ignore-rules", "-t", tools ? "cora" : "clarify"];
  const env = { HERMES_HOME: home, ...(apiKey ? { CORA_ENDPOINT_KEY: apiKey } : {}), ...(tools ? { CORA_BRIDGE_URL: mcp.url, CORA_BRIDGE_TOKEN: mcp.token } : {}) };
  const out = await run(bin, args, { cwd: workDir, timeoutMs, env, signal });
  signal?.throwIfAborted();
  if (out.timedOut) throw new Error(`hermes: no answer within ${Math.round(timeoutMs / 1000)}s`);
  const text = out.stdout.trim();
  if (out.code !== 0 || /^hermes -z: agent failed/m.test(text) || /^hermes -z: agent failed/m.test(out.stderr)) {
    throw new Error(`hermes: ${(out.stderr || text).trim().slice(-240) || `exit ${out.code}`}`);
  }
  // Hermes exits 0 and prints a banner when the model gave it nothing: that is a
  // failed turn, never something to say in the agent's name.
  if (NO_REPLY.test(text)) throw new Error(`hermes: ${model} returned no content`);
  return { text };
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
    "-c", `cli_auth_credentials_store="${residentAuth ? "auto" : "file"}"`, "-c", 'forced_login_method="chatgpt"',
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
    if (out.timedOut) throw new Error(`codex: no answer within ${Math.round(timeoutMs / 1000)}s`);
    let text = "";
    try { text = readFileSync(outFile, "utf8"); } catch {}
    // A CLI that exits badly after the agent has answered still has an answer to give.
    if (out.code !== 0 && !text.trim() && said.trim()) text = said;
    // stdout is the event stream: dumping its last lines reports JSON, not a reason.
    if (out.code !== 0 && !text.trim()) throw new Error(`codex: ${(failure || out.stderr).trim().split("\n").slice(-3).join(" ").slice(0, 240) || `exited with ${out.code} and said nothing`}`);
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
    if (out.timedOut) throw new Error(`grok: no answer within ${Math.round(timeoutMs / 1000)}s`);
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
    if (out.timedOut) throw new Error(`muse: no answer within ${Math.round(timeoutMs / 1000)}s`);
    // stdout is the event stream; the reason a run stopped is its last line on stderr.
    if (answer === null) throw new Error(`muse: ${(failure || out.stderr.trim().split("\n").pop() || "").slice(0, 240) || `exit ${out.code}`}`);
    texts.finish(answer);
    return { text: answer, usage: used };
  } finally {
    rmSync(promptFile, { force: true });
  }
}
