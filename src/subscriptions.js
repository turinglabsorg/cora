import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { resolve as resolvePath, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ValidationError } from "./store.js";
import { onPath } from "./llm.js";
import { HARNESSES, SUBSCRIPTION_PROVIDERS } from "./harnesses.js";
import { geminiScope, prepareGeminiProfile } from "./gemini-profile.js";
import { geminiQuotaMessage } from "./gemini-quota.js";

const LOGIN_MS = 10 * 60 * 1000;
const BROWSER_HELPER = fileURLToPath(new URL("./subscription-browser.js", import.meta.url));
const TERMINAL_HELPER = fileURLToPath(new URL("./subscription-terminal.py", import.meta.url));
const USAGE_HELPER = fileURLToPath(new URL("./subscription-usage-worker.js", import.meta.url));
const AUTH_FAILURE = /authentication_failed|failed to authenticate|login expired|not logged in|not signed in|not authenticated|please (run \/login|log in)|refresh token.*(expired|invalid|revoked)/i;
/** The CLIs that log in by showing a code to confirm on a page, and how to start it. */
const DEVICE_LOGIN = { grok: ["login", "--device-auth"], muse: ["login"] };
const LOGOUT = { claude: ["auth", "logout"], codex: ["-c", 'cli_auth_credentials_store="file"', "logout"], grok: ["logout"], muse: ["logout"], gemini: ["--settings", '{"disableSlashCommands":false}', "-p", "/logout"] };

function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 1500);
    timer.unref();
    child.once("close", () => { clearTimeout(timer); resolve(); });
    child.kill("SIGTERM");
  });
}

/** Do not let a host API key, proxy or cloud-provider override select another account. */
export function subscriptionEnvironment(provider, directory, source = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    if (/^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LANGUAGE|TERM|TMPDIR|TEMP|TMP|SystemRoot|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|CODEX_CA_CERTIFICATE)$/.test(key) || /^LC_/.test(key)) env[key] = value;
  }
  env[HARNESSES[provider].homeVar] = directory;
  if (provider === "claude") env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  if (provider === "muse") {
    env.XDG_DATA_HOME = join(directory, "data");
    // A login in a file: a service on a Mac cannot always reach the Keychain.
    env.TBH_CREDENTIAL_BACKEND = "file";
    env.MUSE_NO_AUTO_UPDATE = "1";
  }
  if (provider === "grok") env.GROK_DISABLE_AUTOUPDATER = "1";
  if (provider === "gemini") {
    env.ANTIGRAVITY_CREDENTIAL_SCOPE = geminiScope(directory);
    env.AGY_CLI_DISABLE_AUTO_UPDATE = "1";
    env.TERM = "xterm-256color";
    for (const key of ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"]) if (source[key]) env[key] = source[key];
  }
  return env;
}

function allowedLoginUrl(value, provider) {
  try {
    const url = new URL(value);
    const { loginHosts, deviceParam } = HARNESSES[provider];
    if (url.protocol !== "https:" || !loginHosts.includes(url.hostname) || url.username || url.password) return "";
    if ([...url.searchParams.keys()].some((key) => /token|secret/i.test(key))) return "";
    // A device page may carry the code it shows; any other code in a link is an authorization code.
    if (url.searchParams.has("code") && deviceParam !== "code" && url.searchParams.get("code") !== "true") return "";
    return url.href;
  } catch { return ""; }
}

class CodexAccount {
  constructor(bin, env, cwd, onEvent, onExit, resident = false) {
    this.pending = new Map();
    this.id = 0;
    this.child = spawn(bin, [...(!resident ? ["-c", 'cli_auth_credentials_store="file"'] : []), "-c", 'forced_login_method="chatgpt"', "app-server"], { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
    this.closed = false;
    this.child.stdin.on("error", () => {});
    this.child.stderr.resume();
    let buffer = "";
    this.child.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) return this.close();
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        const request = this.pending.get(message.id);
        if (request) {
          this.pending.delete(message.id);
          clearTimeout(request.timer);
          if (message.error) request.reject(new Error("Codex ha rifiutato la richiesta di autenticazione"));
          else request.resolve(message.result);
        } else if (message.method) onEvent?.(message.method, message.params || {});
      }
    });
    const exit = () => {
      if (this.closed) return;
      this.closed = true;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Codex non ha completato l'autenticazione"));
      }
      this.pending.clear();
      onExit?.();
    };
    this.child.on("error", exit);
    this.child.on("close", exit);
  }

  request(method, params) {
    if (this.closed) return Promise.reject(new Error("sessione di autenticazione chiusa"));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("il provider non risponde, riprova"));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async initialize() {
    await this.request("initialize", { clientInfo: { name: "cora", version: "0.1.0" }, capabilities: {} });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized" })}\n`);
  }

  close() {
    return terminate(this.child);
  }
}

/** The database selects an identity; the official CLI owns its protected credentials. */
export class Subscriptions {
  constructor({ store, claudeBin, codexBin, grokBin = "grok", museBin = "muse", geminiBin = "agy", timezone = "UTC", residentDirectories = {}, ownerScoped = false, emit = () => {} }) {
    this.store = store;
    this.ownerScoped = Boolean(ownerScoped);
    this.timezone = timezone;
    this.residentOverrides = residentDirectories;
    this.residentDirectories = Object.fromEntries(SUBSCRIPTION_PROVIDERS.map((provider) => [provider, residentDirectories[provider] || HARNESSES[provider].resident()]));
    this.bins = { claude: claudeBin, codex: codexBin, grok: grokBin, muse: museBin, gemini: geminiBin };
    this.emit = emit;
    this.logins = new Map();
    this.stopping = new Map();
    this.running = new Map();
    this.busy = new Set();
    this.closed = false;
    for (const record of store.subscriptions()) {
      if (record.status === "connecting") store.updateSubscription(record.id, { status: "disconnected" });
    }
  }

  defaultId(provider) {
    return this.store.settings.useResidentSubscriptions ? this.store.residentSubscription(provider)?.id || "" : "";
  }

  /** Claude Code and Codex are always offered; a newer CLI shows up once it is installed here. */
  residentProviders() {
    return SUBSCRIPTION_PROVIDERS.filter((provider) => !HARNESSES[provider].managedOnly && (provider === "claude" || provider === "codex" || this.installed(provider) || this.store.residentSubscription(provider)));
  }

  async discoverResidents() {
    const providers = this.residentProviders();
    this.store.ensureResidentSubscriptions(providers);
    await Promise.all(providers.map((provider) => {
      const id = this.store.residentSubscription(provider).id;
      return this.busy.has(id) || this.running.has(id) ? this.view(id) : this.check(id);
    }));
    await this.consolidate();
  }

  directory(record) {
    if (record.resident) return resolvePath(this.residentDirectories[record.provider]);
    if (!/^sub_[a-f0-9]{12}$/.test(record.id)) throw new ValidationError("subscription non valida");
    const directory = resolvePath(this.store.home, "subscriptions", record.id);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    return directory;
  }

  require(id) {
    const record = this.store.subscription(id);
    if (!record) throw new ValidationError("subscription non trovata");
    return record;
  }

  environment(record) {
    const env = subscriptionEnvironment(record.provider, this.directory(record));
    const variable = HARNESSES[record.provider].homeVar;
    if (record.resident && !this.residentOverrides[record.provider] && !process.env[variable]) delete env[variable];
    // The machine's own Muse keeps its sessions where it always has.
    if (record.resident) delete env.XDG_DATA_HOME;
    return env;
  }

  /** Whether the CLI this account would be used through is installed here at all. */
  installed(provider) {
    return onPath(this.bins[provider] || provider);
  }

  view(id) {
    const record = this.require(id);
    const login = this.logins.get(id);
    return {
      ...record,
      installed: this.installed(record.provider),
      ...(login ? { login: { url: login.url, userCode: login.userCode, manualCode: ["claude", "gemini"].includes(record.provider), expiresAt: login.expiresAt,
        phase: login.codeSubmitted ? "verifying" : login.url ? "authorizing" : "preparing" } } : {}),
    };
  }

  list() { return this.store.subscriptions().map((record) => this.view(record.id)); }

  /**
   * One real account, whichever agent connected it and however often: the provider and the
   * address it signs in with decide. With per-owner memory an account is still one per owner,
   * so a shared instance never joins two people's private logins.
   */
  accountKey(record) {
    const email = this.accountEmail(record);
    if (!email || record.resident) return "";
    return [record.provider, email, this.ownerScoped ? record.connectedBy?.id || "" : ""].join("\u0000");
  }

  /**
   * The stored address, or the one a profile already on disk signed in with. Antigravity keeps
   * its sign-in in the profile's own log, so two Gemini profiles can be compared before either
   * one is checked again.
   */
  accountEmail(record) {
    const stored = String(record.email || "").trim().toLowerCase();
    if (stored) return stored;
    return record.provider === "gemini" ? String(this.geminiLogEmail(record) || "").trim().toLowerCase() : "";
  }

  accountWeight(record) {
    const agents = this.store.agents().filter((agent) => agent.subscriptionId === record.id).length;
    return (record.status === "ready" ? 100 : 0) + agents;
  }

  /**
   * Merges the records that are the same account. The record that was just signed in stays
   * and keeps the panel's selection; the other copies hand their agents over and go away,
   * profile included. A copy a turn is using right now waits for that turn to end.
   */
  async consolidate(preferred = "") {
    if (this.closed) return new Map();
    const groups = new Map();
    for (const record of this.store.subscriptions()) {
      const key = this.accountKey(record);
      if (!key) continue;
      const group = groups.get(key) || [];
      group.push(record);
      groups.set(key, group);
    }
    const merged = new Map();
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (const record of group) {
        if (record.email) continue;
        const email = this.accountEmail(record);
        if (!email) continue;
        try { this.store.updateSubscription(record.id, { email }); } catch {}
      }
      const keep = group.find((record) => record.id === preferred)
        || [...group].sort((a, b) => this.accountWeight(b) - this.accountWeight(a)
          || String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || a.id.localeCompare(b.id))[0];
      for (const duplicate of group) {
        if (duplicate.id === keep.id) continue;
        if (this.running.has(duplicate.id) || this.logins.has(duplicate.id) || this.stopping.has(duplicate.id)) continue;
        let moved = true;
        for (const agent of this.store.agents()) {
          if (agent.subscriptionId !== duplicate.id) continue;
          try { this.store.updateAgent(agent.id, { subscriptionId: keep.id }); } catch { moved = false; break; }
        }
        if (!moved || !this.store.deleteSubscription(duplicate.id)) continue;
        this.usage?.invalidate(duplicate.id, { remove: true });
        try { rmSync(join(this.store.home, "subscriptions", duplicate.id), { recursive: true, force: true }); } catch {}
        merged.set(duplicate.id, keep.id);
      }
    }
    if (merged.size) this.emit({ type: "subscriptions" });
    return merged;
  }

  /**
   * The address Antigravity signed in with. Its /usage answer has no account in it, but the
   * CLI writes the sign-in to its own log, so a Google account is one account here too.
   */
  geminiLogEmail(record) {
    if (record.resident || !/^sub_[a-f0-9]{12}$/.test(record.id)) return "";
    const logs = join(this.store.home, "subscriptions", record.id, ".gemini", "antigravity-cli", "log");
    let files;
    try { files = readdirSync(logs).filter((name) => name.endsWith(".log")).sort(); } catch { return ""; }
    for (const name of files.reverse()) {
      const path = join(logs, name);
      let text;
      try { if (statSync(path).size > 4 * 1024 * 1024) continue; text = readFileSync(path, "utf8"); } catch { continue; }
      const matches = [...text.matchAll(/(?:authenticated successfully as|applyAuthResult: email=)\s*([^\s,]+@[^\s,]+)/g)];
      const email = matches[matches.length - 1]?.[1] || "";
      if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return email.slice(0, 254);
    }
    return "";
  }

  changed(id, patch) {
    if (this.closed) return;
    if (patch.status && patch.status !== "ready") this.usage?.invalidate(id);
    this.store.updateSubscription(id, patch);
    // Authorization URLs and device codes stay in authenticated responses, never the activity feed.
    this.emit({ type: "subscriptions" });
  }

  finish(id, status, details = {}) {
    const login = this.logins.get(id);
    if (!login) return;
    this.logins.delete(id);
    clearTimeout(login.timer);
    const stopping = Promise.resolve(login.close?.());
    this.stopping.set(id, stopping);
    stopping.finally(() => { if (this.stopping.get(id) === stopping) this.stopping.delete(id); });
    this.changed(id, { status, ...details });
    login.ready?.();
    if (status === "ready" && details.email) void this.consolidate(id).catch(() => {});
  }

  async start(id, actor = null) {
    await this.stopping.get(id);
    const record = this.require(id);
    if (record.resident) throw new ValidationError("le subscription residenti si gestiscono sul server");
    if (this.closed) throw new ValidationError("Cora si sta fermando");
    if (!this.installed(record.provider)) {
      throw new ValidationError(`${HARNESSES[record.provider].product} non è installato su questa macchina: installalo sul server e riprova`);
    }
    if (this.busy.has(id) || this.running.has(id)) throw new ValidationError("subscription in uso: attendi la fine del lavoro");
    if (this.logins.has(id)) return this.view(id);
    const directory = this.directory(record);
    const env = subscriptionEnvironment(record.provider, directory);
    let ready;
    const available = new Promise((resolve) => { ready = resolve; });
    const login = { url: "", userCode: "", expiresAt: new Date(Date.now() + LOGIN_MS).toISOString(), ready };
    login.timer = setTimeout(() => this.finish(id, "error"), LOGIN_MS);
    login.timer.unref();
    this.logins.set(id, login);
    this.changed(id, { status: "connecting", ...(actor ? { connectedBy: actor } : {}) });
    try {
      if (record.provider === "gemini") {
        const existing = record.status === "ready" || existsSync(join(directory, ".gemini", "antigravity-cli", "installation_id"))
          ? await this.readGemini(record).catch(() => null) : null;
        if (this.logins.get(id) !== login) return this.view(id);
        if (existing) { this.finish(id, "ready", existing); return this.view(id); }
        prepareGeminiProfile(directory);
        const child = spawn("python3", [TERMINAL_HELPER, this.bins.gemini, "--settings", JSON.stringify({ altScreenMode: "never", showTips: false })], {
          env: { ...env, ANTIGRAVITY_REMOTE_OOB_AUTH: "true", SSH_CONNECTION: "127.0.0.1 0 127.0.0.1 0", BROWSER: `${process.execPath} ${BROWSER_HELPER}` }, cwd: directory, stdio: ["pipe", "pipe", "pipe"],
        });
        login.child = child;
        child.stdin.on("error", () => {});
        let buffer = "";
        let checking = false;
        const check = async () => {
          if (checking || !login.url || this.logins.get(id) !== login) return;
          checking = true;
          try {
            const details = await this.readAccount(record);
            if (details && this.logins.get(id) === login) this.finish(id, "ready", details);
          } catch {} finally { checking = false; }
        };
        const poll = setInterval(check, 3000);
        poll.unref();
        login.check = check;
        login.close = () => { clearInterval(poll); return terminate(child); };
        const read = (chunk) => {
          buffer = (buffer + chunk.toString().replace(/\x1b\[[0-9;?<>]*[a-zA-Z]/g, "")).slice(-32000);
          for (const match of buffer.matchAll(/https:\/\/[^\s<>"'\x00-\x20\x7f-\x9f]+/g)) {
            const url = allowedLoginUrl(match[0], "gemini");
            if (url && this.logins.get(id) === login) { login.url = url; ready(); }
          }
        };
        child.stdout.on("data", read);
        child.stderr.on("data", read);
        child.on("error", () => { if (this.logins.get(id) === login) this.finish(id, "error"); });
        child.on("close", () => {
          clearInterval(poll);
          if (this.logins.get(id) === login) this.finish(id, "error");
        });
      } else if (record.provider === "codex") {
        const rpc = new CodexAccount(this.bins.codex, env, directory, (method, params) => {
          if (method !== "account/login/completed" || this.logins.get(id) !== login) return;
          if (!params.success) return this.finish(id, "error");
          this.readCodex(rpc).then((details) => {
            if (this.logins.get(id) === login) this.finish(id, details ? "ready" : "error", details || {});
          }).catch(() => { if (this.logins.get(id) === login) this.finish(id, "error"); });
        }, () => { if (this.logins.get(id) === login) this.finish(id, "error"); });
        login.close = () => rpc.close();
        await rpc.initialize();
        const result = await rpc.request("account/login/start", { type: "chatgptDeviceCode" });
        if (this.logins.get(id) === login) {
          login.url = allowedLoginUrl(result.verificationUrl, "codex");
          login.userCode = /^[A-Z0-9-]{4,32}$/i.test(result.userCode) ? result.userCode : "";
          if (!login.url || !login.userCode) throw new Error("invalid device authorization");
          ready();
        }
      } else if (DEVICE_LOGIN[record.provider]) {
        // Grok and Muse print a page and a code to confirm there, then wait for the owner.
        const child = spawn(this.bins[record.provider], DEVICE_LOGIN[record.provider], { env, cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
        login.close = () => terminate(child);
        let buffer = "";
        const read = (chunk) => {
          buffer = (buffer + chunk.toString().replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")).slice(-32000);
          const url = [...buffer.matchAll(/https:\/\/[^\s<>"']+/g)].map((match) => allowedLoginUrl(match[0], record.provider)).find(Boolean);
          const code = buffer.match(/^\s*([A-Z0-9]{4,8}-[A-Z0-9]{4,8})\s*$/m)?.[1] || "";
          if (url && code && this.logins.get(id) === login && !login.url) {
            Object.assign(login, { url, userCode: code });
            ready();
          }
        };
        child.stdout.on("data", read);
        child.stderr.on("data", read);
        child.on("error", () => { if (this.logins.get(id) === login) this.finish(id, "error"); });
        child.on("close", (code) => {
          if (this.logins.get(id) !== login) return;
          if (code !== 0) return this.finish(id, "error");
          this.readAccount(record).then((details) => {
            if (this.logins.get(id) === login) this.finish(id, details ? "ready" : "error", details || {});
          }).catch(() => { if (this.logins.get(id) === login) this.finish(id, "error"); });
        });
      } else {
        // Older CLIs and wrappers may ignore the directory override. Never log an account in there.
        await this.readClaude(record);
        if (this.logins.get(id) !== login) return this.view(id);
        const child = spawn(this.bins.claude, ["auth", "login", "--claudeai"], {
          env: { ...env, BROWSER: `${process.execPath} ${BROWSER_HELPER}` }, cwd: directory, stdio: ["pipe", "pipe", "pipe"],
        });
        login.child = child;
        login.close = () => terminate(child);
        child.stdin.on("error", () => {});
        let buffer = "";
        const read = (chunk) => {
          buffer = (buffer + chunk.toString().replace(/\x1b\[[0-9;]*m/g, "")).slice(-32000);
          for (const match of buffer.matchAll(/https:\/\/[^\s<>"']+/g)) {
            const url = allowedLoginUrl(match[0], "claude");
            if (url && this.logins.get(id) === login) { login.url = url; ready(); }
          }
        };
        child.stdout.on("data", read);
        child.stderr.on("data", read);
        child.on("error", () => { if (this.logins.get(id) === login) this.finish(id, "error"); });
        child.on("close", (code) => {
          if (this.logins.get(id) !== login) return;
          if (code !== 0) return this.finish(id, "error");
          this.readClaude(record).then((details) => {
            if (this.logins.get(id) === login) this.finish(id, details ? "ready" : "error", details || {});
          }).catch(() => { if (this.logins.get(id) === login) this.finish(id, "error"); });
        });
      }
      const timer = setTimeout(ready, record.provider === "gemini" ? 30000 : 12000);
      await available;
      clearTimeout(timer);
      if (this.logins.get(id) === login && !login.url) this.finish(id, "error");
      await this.stopping.get(id);
      return this.view(id);
    } catch (error) {
      if (this.logins.get(id) === login) this.finish(id, "error", { issue: error.code === "ISOLATION_UNAVAILABLE" ? "isolation" : "" });
      await this.stopping.get(id);
      return this.view(id);
    }
  }

  submitCode(id, value) {
    this.require(id);
    const login = this.logins.get(id);
    const code = String(value || "").trim();
    if (!login?.child || !login.url) throw new ValidationError("nessun accesso in attesa");
    if (!code || code.length > 4096 || /[\x00-\x20\x7f-\x9f]/.test(code)) throw new ValidationError("codice di autorizzazione non valido");
    if (login.codeSubmitted) return this.view(id);
    login.codeSubmitted = true;
    login.child.stdin.write(`${code}\n`);
    login.check?.();
    return this.view(id);
  }

  async cancel(id) {
    this.require(id);
    this.finish(id, "disconnected");
    await this.stopping.get(id);
    return this.view(id);
  }

  async readCodex(rpc) {
    const { account } = await rpc.request("account/read", {});
    return account?.type === "chatgpt" ? { email: String(account.email || "").slice(0, 254), plan: String(account.planType || "").slice(0, 80) } : null;
  }

  async usageData(id, signal) {
    const record = this.require(id), directory = this.directory(record);
    const unavailable = (code = "UNAVAILABLE") => Object.assign(new Error("Subscription usage unavailable"), { code });
    if (record.status !== "ready" || !this.installed(record.provider)) throw unavailable("AUTH_REQUIRED");
    if (record.provider === "codex") {
      const rpc = new CodexAccount(this.bins.codex, this.environment(record), record.resident ? this.store.home : directory, undefined, undefined, Boolean(record.resident));
      const abort = () => { void rpc.close(); };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        signal?.throwIfAborted();
        await rpc.initialize();
        if (!await this.readCodex(rpc)) throw unavailable("AUTH_REQUIRED");
        return await rpc.request("account/rateLimits/read", {});
      } finally { signal?.removeEventListener("abort", abort); await rpc.close(); }
    }
    if (record.provider === "claude" && !await this.readClaude(record, signal)) throw unavailable("AUTH_REQUIRED");
    if (record.provider === "gemini") {
      const result = await this.geminiCommand(record, ["--settings", '{"disableSlashCommands":false}', "-p", "/usage", "--output-format", "json"], signal);
      let data; try { data = JSON.parse(result.output); } catch { throw unavailable(); }
      if (result.code || data.status !== "SUCCESS") throw unavailable();
      return data;
    }
    return new Promise((resolve, reject) => {
      const args = record.provider === "muse" ? ["usage", "--json"] : [USAGE_HELPER, record.provider, directory, record.resident ? "resident" : "managed"];
      const child = spawn(record.provider === "muse" ? this.bins.muse : process.execPath, args, { env: this.environment(record), cwd: directory, stdio: ["ignore", "pipe", "ignore"], signal });
      let output = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(unavailable()); }, 28000);
      child.stdout.on("data", (chunk) => { output += chunk; if (output.length > 256 * 1024) { child.kill("SIGKILL"); reject(unavailable()); } });
      child.on("error", () => { clearTimeout(timer); reject(unavailable()); });
      child.on("close", (code) => {
        clearTimeout(timer);
        try {
          const data = JSON.parse(output);
          if (data.error) throw Object.assign(unavailable(["AUTH_REQUIRED", "RATE_LIMITED", "UNSUPPORTED"].includes(data.error) ? data.error : "UNAVAILABLE"), { retryAfterMs: Number(data.retryAfterMs) || 0 });
          if (code !== 0) throw unavailable();
          resolve(data);
        } catch (error) { reject(error.code ? error : unavailable()); }
      });
    });
  }

  /**
   * Who an account is, from the CLI that holds it: Grok says whether it is signed in
   * before it lists its models, Muse shows the plan it bills against.
   */
  readAccount(record, signal) {
    if (record.provider === "claude") return this.readClaude(record, signal);
    if (record.provider === "gemini") return this.readGemini(record, signal);
    const args = record.provider === "grok" ? ["models"] : ["usage"];
    return new Promise((resolve, reject) => {
      const child = spawn(this.bins[record.provider], args, { env: this.environment(record), cwd: record.resident ? this.store.home : this.directory(record), stdio: ["ignore", "pipe", "pipe"], signal: signal || undefined });
      let output = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("provider timeout")); }, 15000);
      const read = (chunk) => { if (output.length < 32000) output += chunk; };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      child.on("error", () => { clearTimeout(timer); reject(signal?.reason || new Error(`${HARNESSES[record.provider].product} non disponibile`)); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (record.provider === "grok") return resolve(code === 0 && /you are logged in/i.test(output) ? { email: "", plan: "" } : null);
        const tier = output.match(/^Tier:\s*(.+)$/m)?.[1]?.trim();
        resolve(code === 0 && tier && !AUTH_FAILURE.test(output) ? { email: "", plan: tier.slice(0, 80) } : null);
      });
    });
  }

  geminiCommand(record, args, signal) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bins.gemini, args, { env: this.environment(record), cwd: this.directory(record), stdio: ["ignore", "pipe", "ignore"], signal: signal || undefined });
      let output = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Antigravity timeout")); }, 15000);
      child.stdout.on("data", (chunk) => { if (output.length < 64000) output += chunk; });
      child.on("error", () => { clearTimeout(timer); reject(signal?.reason || new Error("Antigravity non disponibile")); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ code, output }); });
    });
  }

  async readGemini(record, signal) {
    const { code, output } = await this.geminiCommand(record, ["--settings", '{"disableSlashCommands":false}', "-p", "/usage", "--output-format", "json"], signal);
    if (code !== 0 || !output.trim() || AUTH_FAILURE.test(output) || /authentication required|authentication failed/i.test(output)) return null;
    let value;
    try { value = JSON.parse(output); } catch {}
    if (value?.status && value.status !== "SUCCESS") return null;
    const text = String(value?.response || output);
    const email = text.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0] || this.geminiLogEmail(record) || "";
    return { email: email.slice(0, 254), plan: "" };
  }

  async geminiModels() {
    const record = this.store.subscriptions().find((item) => item.provider === "gemini" && item.status === "ready" && !this.logins.has(item.id));
    if (!record || !this.installed("gemini")) return [];
    try {
      const { code, output } = await this.geminiCommand(record, ["models"]);
      if (code !== 0) return [];
      const models = new Map();
      for (const line of output.replace(/\x1b\[[0-9;]*m/g, "").split("\n")) {
        const match = line.match(/^\s*[*·-]?\s*((?:gemini|claude|gpt)-[a-z0-9.-]+)\s+(.+?)\s*$/i);
        if (match) models.set(match[1], { name: match[1], label: match[2] });
      }
      return [...models.values()];
    } catch { return []; }
  }

  readClaude(record, signal) {
    return new Promise((resolve, reject) => {
      const directory = this.directory(record);
      const child = spawn(this.bins.claude, ["auth", "status", "--json"], { env: this.environment(record), cwd: record.resident ? this.store.home : directory, stdio: ["ignore", "pipe", "ignore"], signal: signal || undefined });
      let output = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("provider timeout")); }, 12000);
      child.stdout.on("data", (chunk) => { if (output.length < 32000) output += chunk; });
      child.on("error", () => { clearTimeout(timer); reject(signal?.reason || new Error("Claude Code non disponibile")); });
      child.on("close", (code) => {
        clearTimeout(timer);
        try {
          const data = JSON.parse(output);
          if (!record.resident && (typeof data.configDirectory !== "string" || resolvePath(data.configDirectory) !== directory)) {
            const error = new Error("Claude Code non conferma il profilo isolato");
            error.code = "ISOLATION_UNAVAILABLE";
            reject(error);
            return;
          }
          resolve(code === 0 && data.loggedIn && data.authMethod === "claude.ai" ? { email: String(data.email || "").slice(0, 254), plan: String(data.subscriptionType || "").slice(0, 80) } : null);
        } catch {
          const error = new Error("Claude Code non conferma il profilo isolato");
          error.code = "ISOLATION_UNAVAILABLE";
          reject(error);
        }
      });
    });
  }

  async check(id) {
    await this.stopping.get(id);
    const record = this.require(id);
    if (this.logins.has(id)) return this.view(id);
    if (this.busy.has(id) || this.running.has(id)) throw new ValidationError("subscription in uso: attendi la fine del lavoro");
    this.busy.add(id);
    let rpc;
    try {
      let details;
      if (!this.installed(record.provider)) details = null;
      else if (record.provider !== "codex") details = await this.readAccount(record);
      else {
        const directory = this.directory(record);
        rpc = new CodexAccount(this.bins.codex, this.environment(record), record.resident ? this.store.home : directory, undefined, undefined, Boolean(record.resident));
        await rpc.initialize();
        details = await this.readCodex(rpc);
      }
      this.changed(id, { status: details ? "ready" : "disconnected", email: "", plan: "", ...(details || {}) });
    } catch (error) {
      this.changed(id, { status: "error", issue: error.code === "ISOLATION_UNAVAILABLE" ? "isolation" : "" });
    } finally { await rpc?.close(); this.busy.delete(id); }
    const merged = await this.consolidate(id);
    return this.view(merged.get(id) || id);
  }

  async remove(id) {
    const record = this.require(id);
    if (record.resident) throw new ValidationError("le subscription residenti si gestiscono sul server");
    if (this.busy.has(id) || this.running.has(id)) throw new ValidationError("subscription in uso: attendi la fine del lavoro");
    if (this.store.agents().some((agent) => agent.subscriptionId === id)) throw new ValidationError("subscription usata da un agente");
    this.busy.add(id);
    this.changed(id, { status: "disconnected" });
    try {
      await this.cancel(id);
      const directory = this.directory(record);
      if (record.provider !== "gemini" || record.status === "ready") await new Promise((resolve, reject) => {
        const child = spawn(this.bins[record.provider], LOGOUT[record.provider], { env: subscriptionEnvironment(record.provider, directory), cwd: directory, stdio: "ignore" });
        const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new ValidationError("rimozione non riuscita: riprova")); }, 12000);
        child.on("error", () => { clearTimeout(timer); reject(new ValidationError("rimozione non riuscita: riprova")); });
        child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new ValidationError("rimozione non riuscita: riprova")); });
      });
      this.store.deleteSubscription(record.id);
      this.usage?.invalidate(id, { remove: true });
      rmSync(directory, { recursive: true, force: true });
      this.emit({ type: "subscriptions" });
    } finally { this.busy.delete(id); }
  }

  /**
   * One turn on an account. Turns on the same account run side by side, one per
   * thread an agent works in: only a login, a check or a removal waits for them.
   */
  async run(id, provider, signal, execute) {
    await this.stopping.get(id);
    const record = this.require(id || "");
    if (record.provider !== provider || record.status !== "ready" || (record.resident && !this.store.settings.useResidentSubscriptions)) throw new ValidationError("subscription da collegare");
    if (this.closed || this.logins.has(id) || this.busy.has(id)) throw new ValidationError("subscription in aggiornamento, riprova");
    this.running.set(id, (this.running.get(id) || 0) + 1);
    try {
      signal?.throwIfAborted();
      if (provider === "claude" && !await this.readClaude(record, signal)) throw new Error("Claude: not logged in, collega la subscription");
      signal?.throwIfAborted();
      return await execute(this.environment(record), Boolean(record.resident));
    } catch (error) {
      if (provider === "gemini" && error.code === "GEMINI_QUOTA_EXHAUSTED") {
        signal?.throwIfAborted();
        let usage;
        try {
          const { code, output } = await this.geminiCommand(record, ["--settings", '{"disableSlashCommands":false}', "-p", "/usage", "--output-format", "json"], signal);
          if (code === 0) { const data = JSON.parse(output); if (data.status === "SUCCESS") usage = data; }
        } catch {}
        signal?.throwIfAborted();
        error.message = geminiQuotaMessage({ model: error.model, usage, language: this.store.settings.language, timezone: this.timezone });
        error.userMessage = error.message;
      }
      if (AUTH_FAILURE.test(error.message || "")) this.changed(id, { status: "disconnected" });
      if (error.code === "ISOLATION_UNAVAILABLE") this.changed(id, { status: "error", issue: "isolation" });
      throw error;
    } finally {
      const left = (this.running.get(id) || 1) - 1;
      if (left) this.running.set(id, left);
      else { this.running.delete(id); void this.consolidate().catch(() => {}); }
    }
  }

  async close() {
    for (const id of [...this.logins.keys()]) this.finish(id, "disconnected");
    this.closed = true;
    await Promise.all(this.stopping.values());
  }
}
