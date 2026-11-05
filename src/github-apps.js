import { createHmac, createSign, randomBytes, timingSafeEqual } from "node:crypto";

const API_VERSION = "2022-11-28";
// What an agent's app may do: write code, pull requests and issues; read the rest it needs around them.
export const GITHUB_PERMISSIONS = { contents: "write", pull_requests: "write", issues: "write", metadata: "read", checks: "read", actions: "read", statuses: "read" };
// An installation token lives an hour: it is renewed when less than this is left.
const RENEW_BEFORE_MS = 15 * 60000;
// How long the trip to GitHub to create an app may take before its state is no good.
const STATE_TTL_MS = 60 * 60000;
const ORG = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export class GithubError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const base64url = (value) => Buffer.from(value).toString("base64url");

/**
 * Each agent's own GitHub App, made from the panel: Cora hands GitHub a manifest, the owner
 * presses Create and then installs it on the repositories they choose. GitHub allows no fully
 * automatic accounts, so these two clicks are the owner's. The app's private key goes to hush;
 * Cora mints the hour-long installation tokens and writes them on the agent's desktop, where
 * git and gh read them, so the agent never holds a key that lasts.
 */
export class GithubApps {
  constructor({ store, boxes, apiBase = "https://api.github.com", webBase = "https://github.com", keyFor = (name) => process.env[name] || "", storeSecret = async () => {}, sessionKey = "", instanceUrl = "", log = () => {} }) {
    this.store = store;
    this.boxes = boxes;
    this.apiBase = apiBase.replace(/\/+$/, "");
    this.webBase = webBase.replace(/\/+$/, "");
    this.keyFor = keyFor;
    this.storeSecret = storeSecret;
    this.secret = sessionKey || randomBytes(32).toString("hex");
    this.instanceUrl = instanceUrl;
    this.log = log;
    this.keys = new Map();
    this.tokens = new Map();
    this.states = new Map();
    this.timer = null;
  }

  /** The GitHub organization the agents' apps belong to; empty means the owner's own account. */
  get org() {
    return String(this.store.settings.githubOrg || "");
  }

  /** GitHub sends the owner back here after each step, so the space needs an address. */
  get available() {
    return Boolean(this.instanceUrl);
  }

  /** The hush secret holding an app's private key: named after the agent the first time, kept across renames. */
  envName(agent) {
    const key = `githubKeyEnv:${agent.id}`;
    const stored = this.store.value(key);
    if (stored) return stored;
    const preferred = `CORA_GH_KEY_${String(agent.name).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || agent.id.toUpperCase()}`;
    const taken = this.store.agents().some((other) => other.id !== agent.id && this.store.value(`githubKeyEnv:${other.id}`) === preferred);
    const env = taken ? `CORA_GH_KEY_${agent.id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}` : preferred;
    this.store.setValue(key, env);
    return env;
  }

  record(agent) {
    return this.store.value(`githubApp:${agent.id}`, null);
  }

  save(agent, record) {
    this.store.setValue(`githubApp:${agent.id}`, record);
  }

  privateKey(agent) {
    const env = this.envName(agent);
    const stored = this.keys.get(env) || this.keyFor(env);
    return stored ? Buffer.from(stored, "base64").toString("utf8") : "";
  }

  /** The app's name on GitHub, unique across all of it: the agent's, then the organization's. */
  appName(agent) {
    const owner = this.org || "cora";
    const name = `${agent.name}-${owner}`.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    return name.slice(0, 34).replace(/-$/, "");
  }

  manifest(agent) {
    return {
      name: this.appName(agent),
      url: this.instanceUrl,
      description: `${agent.name}, an agent of Cora (${new URL(this.instanceUrl).host}).`,
      public: false,
      redirect_url: `${this.instanceUrl}/github/created`,
      setup_url: `${this.instanceUrl}/github/installed?agent=${encodeURIComponent(agent.id)}`,
      setup_on_update: true,
      default_permissions: GITHUB_PERMISSIONS,
      default_events: [],
    };
  }

  /** Where the panel posts the manifest, with a state that brings the owner back to this agent once. */
  begin(agent) {
    if (!this.available) throw new GithubError("le app GitHub vogliono un indirizzo pubblico di questo spazio, dove GitHub rimanda dopo ogni passo", 409);
    if (this.record(agent)) throw new GithubError("questo agente ha già la sua app GitHub", 409);
    const nonce = randomBytes(12).toString("hex");
    const expires = Date.now() + STATE_TTL_MS;
    for (const [key, at] of this.states) if (at < Date.now()) this.states.delete(key);
    this.states.set(nonce, expires);
    const body = `${agent.id}.${expires}.${nonce}`;
    const state = `${body}.${createHmac("sha256", this.secret).update(`github.${body}`).digest("base64url")}`;
    const where = this.org ? `${this.webBase}/organizations/${encodeURIComponent(this.org)}/settings/apps/new` : `${this.webBase}/settings/apps/new`;
    return { action: `${where}?state=${encodeURIComponent(state)}`, manifest: JSON.stringify(this.manifest(agent)) };
  }

  /** The agent a state was issued for: signed here, not expired, and used only once. */
  readState(state) {
    const [agentId, expires, nonce, signature, extra] = String(state || "").split(".");
    const expected = createHmac("sha256", this.secret).update(`github.${agentId}.${expires}.${nonce}`).digest("base64url");
    const valid = extra === undefined && signature && signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!valid || Number(expires) < Date.now() || !this.states.has(nonce)) throw new GithubError("questo ritorno da GitHub non è più valido: crea l'app di nuovo dal pannello", 403);
    this.states.delete(nonce);
    return agentId;
  }

  async request(method, path, { jwt = "", body } = {}) {
    const response = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json", "X-GitHub-Api-Version": API_VERSION, "User-Agent": "cora",
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new GithubError(`GitHub ${response.status}: ${data.message || "errore"}`, response.status === 404 ? 404 : response.status >= 500 ? 502 : 400);
    return data;
  }

  /** Back from GitHub with the app made: its key into hush, its name and id kept here. */
  async created({ code, state }) {
    const agent = this.store.agent(this.readState(state));
    if (!agent) throw new GithubError("l'agente non c'è più", 404);
    if (!/^[\w-]{1,200}$/.test(String(code || ""))) throw new GithubError("GitHub non ha mandato il codice dell'app");
    const app = await this.request("POST", `/app-manifests/${encodeURIComponent(code)}/conversions`);
    if (!app.pem || !app.id || !app.slug) throw new GithubError("GitHub non ha dato la chiave dell'app", 502);
    const env = this.envName(agent);
    const key = Buffer.from(app.pem).toString("base64");
    await this.storeSecret(env, key);
    this.keys.set(env, key);
    const bot = await this.request("GET", `/users/${encodeURIComponent(`${app.slug}[bot]`)}`).catch(() => null);
    this.save(agent, { appId: app.id, slug: app.slug, name: app.name || app.slug, owner: app.owner?.login || "", ownerType: app.owner?.type || "", htmlUrl: app.html_url || "", botId: bot?.id || 0, createdAt: Date.now(), installationId: 0 });
    this.tokens.delete(agent.id);
    this.log({ type: "github", agentId: agent.id, text: `app GitHub ${app.slug} creata, chiave salvata in hush come ${env}` });
    return agent;
  }

  /** A short-lived token that speaks for the app itself, signed with its private key. */
  jwt(agent) {
    const record = this.record(agent);
    const pem = this.privateKey(agent);
    if (!record || !pem) throw new GithubError("la chiave dell'app GitHub non c'è più: scollegala e creala di nuovo", 409);
    const now = Math.floor(Date.now() / 1000);
    const body = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(record.appId) }))}`;
    return `${body}.${createSign("RSA-SHA256").update(body).sign(pem, "base64url")}`;
  }

  /** The installation GitHub reports for this app: kept only once GitHub confirms it is this app's. */
  async installed(agent, installationId) {
    const record = this.record(agent);
    if (!record) throw new GithubError("questo agente non ha un'app GitHub", 404);
    const installation = await this.request("GET", `/app/installations/${Number(installationId) || 0}`, { jwt: this.jwt(agent) });
    this.save(agent, { ...record, installationId: installation.id, account: installation.account?.login || "", accountType: installation.account?.type || "", repositorySelection: installation.repository_selection || "", installedAt: Date.now(), error: "" });
    this.tokens.delete(agent.id);
    this.log({ type: "github", agentId: agent.id, text: `app GitHub ${record.slug} installata su ${installation.account?.login || "?"}` });
    await this.provision(agent).catch(() => {});
    return this.view(agent);
  }

  /** Whether the app has been installed meanwhile, asked to GitHub. */
  async check(agent) {
    const record = this.record(agent);
    if (!record) throw new GithubError("questo agente non ha un'app GitHub", 404);
    const list = await this.request("GET", "/app/installations", { jwt: this.jwt(agent) });
    const wanted = (this.org || record.owner).toLowerCase();
    const found = (Array.isArray(list) ? list : []).find((item) => String(item.account?.login || "").toLowerCase() === wanted) || (Array.isArray(list) ? list[0] : null);
    if (found) return this.installed(agent, found.id);
    if (record.installationId) this.save(agent, { ...record, installationId: 0, account: "", repositorySelection: "" });
    this.tokens.delete(agent.id);
    return this.view(agent);
  }

  async token(agent) {
    const cached = this.tokens.get(agent.id);
    if (cached && cached.expiresAt - Date.now() > RENEW_BEFORE_MS) return cached;
    const record = this.record(agent);
    if (!record?.installationId) throw new GithubError("l'app GitHub non è ancora installata", 409);
    const data = await this.request("POST", `/app/installations/${record.installationId}/access_tokens`, { jwt: this.jwt(agent) });
    const token = { token: String(data.token || ""), expiresAt: Date.parse(data.expires_at) || Date.now() + 3600000, written: false };
    this.tokens.set(agent.id, token);
    return token;
  }

  /** Who the agent is on GitHub: its app's bot, with the address that ties commits to it. */
  identity(record) {
    const login = `${record.slug}[bot]`;
    return { login, name: login, email: record.botId ? `${record.botId}+${login}@users.noreply.github.com` : `${login}@users.noreply.github.com` };
  }

  /** A fresh token on the agent's desktop, for git and gh, when the one there is about to end. */
  async provision(agent) {
    const record = this.record(agent);
    if (!record?.installationId || !this.boxes) return null;
    const token = await this.token(agent);
    if (token.written) return token;
    try {
      await this.boxes.githubLogin(agent.id, { token: token.token, ...this.identity(record) });
      token.written = true;
      if (record.error) this.save(agent, { ...this.record(agent), error: "" });
    } catch (error) {
      this.save(agent, { ...this.record(agent), error: String(error.message).slice(0, 200) });
      throw error;
    }
    return token;
  }

  /** Every agent with an installed app keeps a live token on its desktop; a stopped desktop is tried again later. */
  async refreshAll() {
    for (const agent of this.store.agents()) {
      if (!agent.enabled || !agent.tools || !this.record(agent)?.installationId) continue;
      await this.provision(agent).catch(() => {});
    }
  }

  start(everyMs = 5 * 60000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.refreshAll().catch(() => {}), everyMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** The app forgotten here and its token taken off the desktop; on GitHub it stays until the owner deletes it. */
  async forget(agent) {
    const record = this.record(agent);
    if (!record) return this.view(agent);
    this.store.setValue(`githubApp:${agent.id}`, null);
    this.keys.delete(this.envName(agent));
    this.tokens.delete(agent.id);
    await this.boxes?.githubLogout?.(agent.id).catch(() => {});
    this.log({ type: "github", agentId: agent.id, text: `app GitHub ${record.slug} scollegata` });
    return { ...this.view(agent), deleteUrl: this.settingsUrl(record) };
  }

  settingsUrl(record) {
    const org = record.ownerType ? record.ownerType === "Organization" : Boolean(this.org);
    return org ? `${this.webBase}/organizations/${record.owner || this.org}/settings/apps/${record.slug}` : `${this.webBase}/settings/apps/${record.slug}`;
  }

  /** What the panel shows: where the app is, and the links for the steps that are the owner's. */
  view(agent) {
    const record = this.record(agent);
    const base = { available: this.available, org: this.org };
    if (!record) return { ...base, state: "none" };
    const token = this.tokens.get(agent.id);
    const installation = record.installationId
      ? record.accountType === "User" ? `${this.webBase}/settings/installations/${record.installationId}` : `${this.webBase}/organizations/${record.account}/settings/installations/${record.installationId}`
      : "";
    return {
      ...base,
      state: record.installationId ? "installed" : "created",
      slug: record.slug, name: record.name, login: this.identity(record).login, appUrl: record.htmlUrl || `${this.webBase}/apps/${record.slug}`,
      settingsUrl: this.settingsUrl(record), installUrl: `${this.webBase}/apps/${record.slug}/installations/new`, installationUrl: installation,
      account: record.account || "", repositorySelection: record.repositorySelection || "", tokenUntil: token?.written ? token.expiresAt : 0,
      keyMissing: !this.privateKey(agent), error: record.error || "",
    };
  }
}

export function cleanGithubOrg(value) {
  const org = String(value || "").trim().replace(/^@/, "").replace(/^https?:\/\/github\.com\//i, "").replace(/\/.*$/, "");
  return ORG.test(org) ? org : "";
}
