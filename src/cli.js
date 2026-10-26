import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const MCP_SCRIPT = fileURLToPath(new URL("./mcp-server.js", import.meta.url));
const SECRET_ENV = ["DISCORD_BOT_TOKEN", "TELEGRAM_BOT_TOKEN", "OLLAMA_API_KEY", "ORCAROUTER_API_KEY", "CORA_ADMIN_PASSWORD", "CORA_SESSION_KEY", "VAPID_KEY"];
const CODEX_DISABLED_FEATURES = [
  "shell_tool", "unified_exec", "apps", "browser_use", "browser_use_external", "computer_use",
  "tool_suggest", "view_image", "memories", "sleep_tool", "multi_agent",
];

function childEnv() {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (SECRET_ENV.includes(name) || name.startsWith("CORA_BOT_") || name.startsWith("CORA_TG_BOT_")) delete env[name];
  return env;
}

function run(bin, args, { input, cwd, timeoutMs, onLine, env = {} }) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env: { ...childEnv(), ...env }, stdio: ["pipe", "pipe", "pipe"] });
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
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout.push(chunk);
      lines(String(chunk));
    });
    child.stderr.on("data", (chunk) => { if (stderr.length < 200) stderr.push(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: "", stderr: error.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
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
export async function runClaude({ bin, model, system, prompt, mcp, toolNames, workDir, timeoutMs, onStep, effort = "", goal = "" }) {
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
  let data = null;
  const texts = textSteps(onStep);
  const onLine = (line) => {
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
  };
  try {
    const out = await run(bin, args, { input, cwd: workDir, timeoutMs, onLine });
    if (out.timedOut) throw new Error(`claude: no answer within ${Math.round(timeoutMs / 1000)}s`);
    if (!data) throw new Error(`claude: ${(out.stderr || out.stdout).trim().slice(-240) || `exit ${out.code}`}`);
    if (data.is_error) throw new Error(`claude: ${String(data.result || data.subtype || "error").slice(0, 240)}`);
    texts.finish(data.result);
    return { text: String(data.result || "") };
  } finally {
    rmSync(mcpFile, { force: true });
  }
}

/**
 * Hermes' config for Cora's runs, in a home of its own: the model through an
 * OpenAI-style endpoint (a local Ollama by default) and Cora's MCP server,
 * whose session arrives per run through ${...} placeholders Hermes fills in
 * from the environment. Runs in parallel share it.
 */
export function hermesConfig({ baseUrl, model }) {
  return [
    "# Written by Cora: Hermes runs Cora's agents with Cora's tools only.",
    "model:",
    "  provider: cora-endpoint",
    `  base_url: ${JSON.stringify(baseUrl)}`,
    `  default: ${JSON.stringify(model)}`,
    "providers:",
    "  cora-endpoint:",
    `    api: ${JSON.stringify(baseUrl)}`,
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
export async function runHermes({ bin, model, system, prompt, mcp, toolNames, workDir, timeoutMs, home, baseUrl }) {
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const configFile = join(home, "config.yaml");
  const config = hermesConfig({ baseUrl, model });
  let current = "";
  try { current = readFileSync(configFile, "utf8"); } catch {}
  // Only the default model changes between runs, and -m overrides it: rewrite when anything else differs.
  const settled = (text) => text.replace(/^\s+default(_model)?:.*$/gm, "");
  if (settled(current) !== settled(config)) writeFileSync(configFile, config, { mode: 0o600 });
  const tools = mcp && toolNames.length;
  // In one-shot mode an MCP server's toolset is named after the server, and -t is the complete list.
  const args = ["-z", `${system}\n\n---\n\n${prompt}`, "-m", model, "--provider", "cora-endpoint", "--ignore-rules", "-t", tools ? "cora" : "clarify"];
  const env = { HERMES_HOME: home, ...(tools ? { CORA_BRIDGE_URL: mcp.url, CORA_BRIDGE_TOKEN: mcp.token } : {}) };
  const out = await run(bin, args, { cwd: workDir, timeoutMs, env });
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
export async function runCodex({ bin, model, system, prompt, mcp, toolNames, workDir, timeoutMs, onStep, effort = "" }) {
  mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const id = randomBytes(6).toString("hex");
  const outFile = join(workDir, `codex-${id}.txt`);
  const args = [
    "exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--color", "never",
    "-s", "read-only", "-C", workDir, "-m", model, "-o", outFile, "--json",
    "-c", "approval_policy=\"never\"", "-c", "model_reasoning_summary=\"detailed\"",
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
  const onLine = (line) => {
    const event = JSON.parse(line);
    if (event.type === "error" || event.type === "turn.failed") failure = String(event.message || event.error?.message || failure);
    if (event.type !== "item.completed") return;
    const item = event.item || {};
    if (item.type === "reasoning" && item.text?.trim()) {
      texts.flush();
      onStep?.({ type: "thinking", text: item.text });
    } else if (item.type === "agent_message" && item.text?.trim()) {
      texts.text(item.text);
    } else if (item.type === "mcp_tool_call") {
      texts.flush();
    }
  };
  try {
    const out = await run(bin, args, { input, cwd: workDir, timeoutMs, onLine });
    if (out.timedOut) throw new Error(`codex: no answer within ${Math.round(timeoutMs / 1000)}s`);
    let text = "";
    try { text = readFileSync(outFile, "utf8"); } catch {}
    if (out.code !== 0 && !text.trim()) throw new Error(`codex: ${(failure || out.stderr || out.stdout).trim().split("\n").slice(-3).join(" ").slice(0, 240) || `exit ${out.code}`}`);
    texts.finish(text);
    return { text };
  } finally {
    rmSync(outFile, { force: true });
  }
}
