import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

// The commands doc-hook lets through to publish_guard: only these could post a comment.
const PUBLISHING = /gh\s+(?:issue|pr)\s+(?:comment|create|edit|review)|gh\s+api[^|;&]*comment|grog(?:\/index\.js)?\s+(?:answer|create|update)/;
// Shorter than this, doc's reply_check passes a text without reading it.
const SHORTEST_REPLY = 40;
const BODY_LIMIT = 256 * 1024;
// A day of decisions fits many times over in the end of the log, which only grows.
const LOG_TAIL = 1024 * 1024;

/**
 * Where doc is on this machine: the folder holding the `doc` Python package.
 * `CORA_DOC_DIR` names it (`off` turns the checks off); otherwise the `doc` CLI on
 * PATH, or where Fluxkit and a plain clone put it.
 */
export function findDoc(configured = "") {
  if (configured === "off") return "";
  const onPath = String(process.env.PATH || "").split(delimiter).filter(Boolean).map((dir) => join(dir, "doc")).find((bin) => existsSync(bin));
  let fromPath = "";
  try { if (onPath) fromPath = dirname(dirname(realpathSync(onPath))); } catch {}
  return [configured, fromPath, join(homedir(), ".fluxkit", "src", "doc"), join(homedir(), "doc")]
    .find((root) => root && existsSync(join(root, "doc", "reply_check.py")) && existsSync(join(root, "doc", "publish_guard.py"))) || "";
}

/** The file a publishing command posts, when it posts one: its text lives in the agent's computer, not here. */
export function bodyFile(command) {
  const field = /\bbody=@(['"]?)([^\s'"]+)\1/.exec(command);
  if (field) return field[2];
  const flag = /(?:^|\s)(?:--body-file|--description-file|-F)(?:=|\s+)(['"]?)([^\s'"]+)\1/.exec(command);
  if (flag) return flag[2] === "-" ? "" : flag[2];
  return /grog(?:\/index\.js)?\s+answer\s+\S+\s+(['"]?)([^\s'"]+)\1/.exec(command)?.[2] || "";
}

/**
 * doc's checks on what Cora's agents publish and say: the same Python modules the
 * owner's coding agents run as hooks, called by the Cora harness so they hold for
 * every model. With this instance's TypeSafe key Jev judges what needs reading;
 * without one only doc's exact rules apply. Without doc nothing is checked, and a
 * check that fails or runs out of time lets the action through.
 */
export class Doc {
  constructor({ root = "", key = "", python = "python3", usageLog = "", rulesFile = "", timeoutMs = 25000 } = {}) {
    this.root = root;
    this.key = key;
    this.python = python;
    this.usageLog = usageLog;
    this.rulesFile = rulesFile;
    this.timeoutMs = timeoutMs;
    this.rules = { off: [], add: [] };
    try {
      const saved = JSON.parse(readFileSync(rulesFile, "utf8"));
      this.rules = { off: Array.isArray(saved.off) ? saved.off : [], add: Array.isArray(saved.add) ? saved.add : [] };
    } catch {}
    this.builtinRules = null;
  }

  get installed() {
    return Boolean(this.root);
  }

  /** An older doc checks with its own rules only: the owner's need doc.rules. */
  get supportsRules() {
    return Boolean(this.root) && existsSync(join(this.root, "doc", "rules.py"));
  }

  /** doc's built-in Jev rules, as doc lists them: key, the kind of text, the reason. */
  async builtins() {
    if (!this.supportsRules) return [];
    if (!this.builtinRules) {
      const listed = await this.run("rules", null, { log: "/dev/null" });
      if (Array.isArray(listed)) this.builtinRules = listed.filter((rule) => rule && typeof rule.key === "string" && ["reply", "comment"].includes(rule.on));
    }
    return this.builtinRules || [];
  }

  /** The owner's rules, in the file doc reads through DOC_RULES; written whole, never half. */
  saveRules(rules) {
    const temporary = `${this.rulesFile}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(rules, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.rulesFile);
    this.rules = rules;
  }

  /** Jev's score for one rule, saved or not, on one text: `{score}`, `{error}` or null. */
  score(target, text, rule) {
    return this.run("rules", { target, text: String(text || ""), rule: { question: String(rule?.question || "") } }, { args: ["try"] });
  }

  /**
   * A shell command that would post a GitHub or Linear comment: allowed (null),
   * or `{decision: "deny"|"ask", reason}`. A body file is read from the agent's
   * computer through `readFile`, since doc runs here.
   */
  async publishGuard(command, readFile, options) {
    if (!this.root || !PUBLISHING.test(command)) return null;
    let checked = command;
    const file = bodyFile(command);
    if (file) {
      let body;
      try { body = String(await readFile(file)); } catch { return null; }
      checked = `gh issue comment --body-file - <<'CORA_DOC_BODY'\n${body}\nCORA_DOC_BODY\n`;
    }
    const answer = await this.run("publish_guard", { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: checked } }, options);
    const output = answer?.hookSpecificOutput;
    if (!["deny", "ask"].includes(output?.permissionDecision)) return null;
    return { decision: output.permissionDecision, reason: String(output.permissionDecisionReason || "doc: this comment breaks the publishing rules.") };
  }

  /** A message for people: "" when it may go out, otherwise doc's reason. */
  async replyCheck(text, options) {
    if (!this.root || String(text || "").trim().length < SHORTEST_REPLY) return "";
    const answer = await this.run("reply_check", { hook_event_name: "Stop", last_assistant_message: String(text), stop_hook_active: false }, options);
    return answer?.decision === "block" ? String(answer.reason || "") : "";
  }

  /** What doc did here in the last day, from the log it keeps for this instance: decisions only, never the text. */
  activity(now = Date.now()) {
    const since = now / 1000 - 86400;
    const report = { checks: 0, stopped: 0, judgedAt: "" };
    let lines = [];
    try {
      const size = statSync(this.usageLog).size;
      const length = Math.min(size, LOG_TAIL);
      const buffer = Buffer.alloc(length);
      const fd = openSync(this.usageLog, "r");
      try { readSync(fd, buffer, 0, length, size - length); } finally { closeSync(fd); }
      lines = buffer.toString("utf8").split("\n");
    } catch { return report; }
    let judged = 0;
    for (const line of lines) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (!(entry.ts >= since)) continue;
      if (entry.outcome) {
        report.checks += 1;
        if (["blocked", "deny", "ask"].includes(entry.outcome)) report.stopped += 1;
      }
      if (entry.input_tokens) judged = Math.max(judged, entry.ts);
    }
    if (judged) report.judgedAt = new Date(judged * 1000).toISOString();
    return report;
  }

  /**
   * A live proof, kept out of the log: doc answers (an exact rule, no key needed)
   * and Jev judges (a sentence with an effort estimate, which needs the key).
   */
  async probe() {
    if (!this.root) return { installed: false, runs: false, jev: false };
    const exact = await this.publishGuard('gh pr comment 1 --body "Fixed in /home/agent/work/app.js"', null, { log: "/dev/null" });
    const judged = this.key ? await this.replyCheck("Per finire tutto il lavoro ci vorranno ancora circa tre giorni di sviluppo.", { log: "/dev/null" }) : "";
    return { installed: true, runs: exact?.decision === "deny", jev: Boolean(judged) };
  }

  run(module, payload, { log = this.usageLog, args = [] } = {}) {
    return new Promise((resolve) => {
      const env = {
        PATH: process.env.PATH || "/usr/bin:/bin",
        HOME: homedir(),
        PYTHONPATH: this.root,
        ...(this.key ? { TYPESAFE_API_KEY: this.key } : {}),
        ...(log ? { DOC_USAGE_LOG: log } : {}),
        ...(this.rulesFile && existsSync(this.rulesFile) ? { DOC_RULES: this.rulesFile } : {}),
      };
      let child;
      try {
        child = spawn(this.python, ["-m", `doc.${module}`, ...args], { cwd: this.root, env, stdio: ["pipe", "pipe", "ignore"] });
      } catch {
        return resolve(null);
      }
      const chunks = [];
      let size = 0;
      const timer = setTimeout(() => child.kill("SIGKILL"), this.timeoutMs);
      child.stdout.on("data", (chunk) => {
        size += chunk.length;
        if (size <= BODY_LIMIT) chunks.push(chunk);
      });
      child.on("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const text = Buffer.concat(chunks).toString("utf8").trim();
        if (code !== 0 || !text) return resolve(null);
        try { resolve(JSON.parse(text)); } catch { resolve(null); }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(payload === null ? "" : JSON.stringify(payload));
    });
  }
}
