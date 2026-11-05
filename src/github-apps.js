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
      // Public, so it can be installed on any organization the owner administers, each with the repositories they pick.
      public: true,
      redirect_url: `${this.instanceUrl}/github/created`,
      setup_url: `${this.instanceUrl}/github/installed?agent=${encodeURIComponent(agent.id)}`,
      setup_on_update: true,
      default_permissions: GITHUB_PERMISSIONS,
      default_events: [],
    };
  }

  /** A state for one trip to GitHub and back: signed here, for one agent and one purpose, good once for an hour. */
  signState(agent, purpose) {
    const nonce = randomBytes(12).toString("hex");
    const expires = Date.now() + STATE_TTL_MS;
    for (const [key, at] of this.states) if (at < Date.now()) this.states.delete(key);
    this.states.set(nonce, expires);
    const body = `${agent.id}.${expires}.${nonce}`;
    return `${body}.${createHmac("sha256", this.secret).update(`github.${purpose}.${body}`).digest("base64url")}`;
  }

  /** The agent a state was issued for, or null when it is not one of ours, has expired or was used. */
  readState(state, purpose) {
    const [agentId, expires, nonce, signature, extra] = String(state || "").split(".");
    const expected = createHmac("sha256", this.secret).update(`github.${purpose}.${agentId}.${expires}.${nonce}`).digest("base64url");
    const valid = extra === undefined && signature && signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!valid || Number(expires) < Date.now() || !this.states.has(nonce)) return null;
    this.states.delete(nonce);
    return agentId;
  }

  /** Where the panel posts the manifest, with a state that brings the owner back to this agent once. */
  begin(agent) {
    if (!this.available) throw new GithubError("le app GitHub vogliono un indirizzo pubblico di questo spazio, dove GitHub rimanda dopo ogni passo", 409);
    if (this.record(agent)) throw new GithubError("questo agente ha già la sua app GitHub", 409);
    const where = this.org ? `${this.webBase}/organizations/${encodeURIComponent(this.org)}/settings/apps/new` : `${this.webBase}/settings/apps/new`;
    return { action: `${where}?state=${encodeURIComponent(this.signState(agent, "create"))}`, manifest: JSON.stringify(this.manifest(agent)) };
  }

  /**
   * Where the owner installs the app on one more account: GitHub asks which organization and
   * which repositories. The state makes the installation that comes back trusted at once.
   */
  installLink(agent) {
    const record = this.record(agent);
    if (!record) throw new GithubError("questo agente non ha un'app GitHub", 404);
    return { url: `${this.webBase}/apps/${record.slug}/installations/new?state=${encodeURIComponent(this.signState(agent, "install"))}` };
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
    const agentId = this.readState(state, "create");
    if (!agentId) throw new GithubError("questo ritorno da GitHub non è più valido: crea l'app di nuovo dal pannello", 403);
    const agent = this.store.agent(agentId);
    if (!agent) throw new GithubError("l'agente non c'è più", 404);
    if (!/^[\w-]{1,200}$/.test(String(code || ""))) throw new GithubError("GitHub non ha mandato il codice dell'app");
    const app = await this.request("POST", `/app-manifests/${encodeURIComponent(code)}/conversions`);
    if (!app.pem || !app.id || !app.slug) throw new GithubError("GitHub non ha dato la chiave dell'app", 502);
    const env = this.envName(agent);
    const key = Buffer.from(app.pem).toString("base64");
    await this.storeSecret(env, key);
    this.keys.set(env, key);
    const bot = await this.request("GET", `/users/${encodeURIComponent(`${app.slug}[bot]`)}`).catch(() => null);
    this.save(agent, { appId: app.id, slug: app.slug, name: app.name || app.slug, owner: app.owner?.login || "", ownerType: app.owner?.type || "", htmlUrl: app.html_url || "", botId: bot?.id || 0, public: true, createdAt: Date.now(), installations: [] });
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

  /** The accounts the app is installed on; an app recorded before there could be several has its one. */
  installations(record) {
    if (Array.isArray(record?.installations)) return record.installations;
    return record?.installationId ? [{ id: record.installationId, account: record.account || "", accountType: record.accountType || "", repositorySelection: record.repositorySelection || "", approved: true }] : [];
  }

  saveInstallations(agent, list) {
    const record = this.record(agent);
    const { installationId, account, accountType, repositorySelection, ...rest } = record;
    this.save(agent, { ...rest, installations: list });
  }

  /**
   * An installation GitHub reports for this app, kept once GitHub confirms it is this app's.
   * One started from the panel (its state checks out) is used at once; any other waits for the
   * owner in the panel, since a public app can be installed by anyone.
   */
  async installed(agent, installationId, { state = "", trusted = false } = {}) {
    const record = this.record(agent);
    if (!record) throw new GithubError("questo agente non ha un'app GitHub", 404);
    const found = await this.request("GET", `/app/installations/${Number(installationId) || 0}`, { jwt: this.jwt(agent) });
    const approvedNow = trusted || (state && this.readState(state, "install") === agent.id);
    const list = this.installations(record);
    const before = list.find((item) => item.id === found.id);
    const entry = { id: found.id, account: found.account?.login || "", accountType: found.account?.type || "", repositorySelection: found.repository_selection || "", approved: Boolean(before?.approved || approvedNow), at: Date.now() };
    this.saveInstallations(agent, [...list.filter((item) => item.id !== found.id), entry]);
    this.tokens.delete(`${agent.id}:${found.id}`);
    this.log({ type: "github", agentId: agent.id, text: `app GitHub ${record.slug} installata su ${entry.account}${entry.approved ? "" : ": da approvare nel pannello"}` });
    if (entry.approved) await this.provision(agent, { force: true }).catch(() => {});
    return this.view(agent);
  }

  /** The owner says whether an installation is used. */
  async approve(agent, installationId, approved) {
    const record = this.record(agent);
    const list = this.installations(record);
    if (!record || !list.some((item) => item.id === Number(installationId))) throw new GithubError("installazione non trovata", 404);
    this.saveInstallations(agent, list.map((item) => (item.id === Number(installationId) ? { ...item, approved: Boolean(approved) } : item)));
    this.tokens.delete(`${agent.id}:${Number(installationId)}`);
    await this.provision(agent, { force: true }).catch(() => {});
    return this.view(agent);
  }

  /** The installations as GitHub has them now: new ones wait for the owner, removed ones go. */
  async check(agent) {
    const record = this.record(agent);
    if (!record) throw new GithubError("questo agente non ha un'app GitHub", 404);
    const remote = await this.request("GET", "/app/installations", { jwt: this.jwt(agent) });
    const known = new Map(this.installations(record).map((item) => [item.id, item]));
    const list = (Array.isArray(remote) ? remote : []).map((found) => ({
      id: found.id, account: found.account?.login || "", accountType: found.account?.type || "", repositorySelection: found.repository_selection || "",
      approved: Boolean(known.get(found.id)?.approved), at: known.get(found.id)?.at || Date.now(),
    }));
    this.saveInstallations(agent, list);
    await this.provision(agent, { force: true }).catch(() => {});
    return this.view(agent);
  }

  async token(agent, installation) {
    const key = `${agent.id}:${installation.id}`;
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt - Date.now() > RENEW_BEFORE_MS) return cached;
    const data = await this.request("POST", `/app/installations/${installation.id}/access_tokens`, { jwt: this.jwt(agent) });
    const token = { token: String(data.token || ""), expiresAt: Date.parse(data.expires_at) || Date.now() + 3600000, written: false };
    this.tokens.set(key, token);
    return token;
  }

  /** Who the agent is on GitHub: its app's bot, with the address that ties commits to it. */
  identity(record) {
    const login = `${record.slug}[bot]`;
    return { login, name: login, email: record.botId ? `${record.botId}+${login}@users.noreply.github.com` : `${login}@users.noreply.github.com` };
  }

  /** The account gh works on by default: the organization of the settings when the app is there, else the first. */
  primary(agent, approved) {
    const wanted = (this.org || this.record(agent)?.owner || "").toLowerCase();
    return approved.find((item) => item.account.toLowerCase() === wanted) || approved[0] || null;
  }

  /**
   * A live token per approved account on the agent's desktop, for git and gh, written again
   * when one is renewed. An installation GitHub no longer has is dropped.
   */
  async provision(agent, { force = false } = {}) {
    const record = this.record(agent);
    if (!record || !this.boxes) return null;
    let changed = force;
    const tokens = [];
    for (const installation of this.installations(record).filter((item) => item.approved)) {
      try {
        const token = await this.token(agent, installation);
        if (!token.written) changed = true;
        tokens.push({ account: installation.account, token });
      } catch (error) {
        if (error.status !== 404) throw error;
        this.saveInstallations(agent, this.installations(this.record(agent)).filter((item) => item.id !== installation.id));
        this.log({ type: "github", agentId: agent.id, text: `app GitHub ${record.slug} non è più installata su ${installation.account}` });
        changed = true;
      }
    }
    if (!changed) return tokens;
    try {
      if (!tokens.length) await this.boxes.githubLogout?.(agent.id);
      else {
        // gh is put on the desktop if it is missing; without it git still pushes, so a failure only gets logged.
        await this.boxes.ensureGh?.(agent.id).catch((error) => this.log({ type: "github", agentId: agent.id, text: error.message }));
        const main = this.primary(agent, this.installations(this.record(agent)).filter((item) => item.approved));
        await this.boxes.githubLogin(agent.id, { tokens: tokens.map((item) => ({ account: item.account, token: item.token.token })), primary: main?.account || tokens[0].account, ...this.identity(record) });
      }
      for (const item of tokens) item.token.written = true;
      if (this.record(agent).error) this.save(agent, { ...this.record(agent), error: "" });
    } catch (error) {
      this.save(agent, { ...this.record(agent), error: String(error.message).slice(0, 200) });
      throw error;
    }
    return tokens;
  }

  /** Every agent with an installed app keeps a live token on its desktop; a stopped desktop is tried again later. */
  async refreshAll() {
    for (const agent of this.store.agents()) {
      if (!agent.enabled || !agent.tools || !this.installations(this.record(agent)).some((item) => item.approved)) continue;
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
    for (const key of this.tokens.keys()) if (key.startsWith(`${agent.id}:`)) this.tokens.delete(key);
    await this.boxes?.githubLogout?.(agent.id).catch(() => {});
    this.log({ type: "github", agentId: agent.id, text: `app GitHub ${record.slug} scollegata` });
    return { ...this.view(agent), deleteUrl: this.settingsUrl(record) };
  }

  settingsUrl(record) {
    const org = record.ownerType ? record.ownerType === "Organization" : Boolean(this.org);
    return org ? `${this.webBase}/organizations/${record.owner || this.org}/settings/apps/${record.slug}` : `${this.webBase}/settings/apps/${record.slug}`;
  }

  /** What the panel shows: where the app is installed, and the links for the steps that are the owner's. */
  view(agent) {
    const record = this.record(agent);
    const base = { available: this.available, org: this.org };
    if (!record) return { ...base, state: "none" };
    const installations = this.installations(record).map((item) => {
      const token = this.tokens.get(`${agent.id}:${item.id}`);
      return {
        id: item.id, account: item.account, repositorySelection: item.repositorySelection, approved: Boolean(item.approved), tokenUntil: token?.written ? token.expiresAt : 0,
        url: item.accountType === "User" ? `${this.webBase}/settings/installations/${item.id}` : `${this.webBase}/organizations/${item.account}/settings/installations/${item.id}`,
      };
    });
    const approved = installations.filter((item) => item.approved);
    return {
      ...base,
      state: approved.length ? "installed" : "created",
      slug: record.slug, name: record.name, login: this.identity(record).login, appUrl: record.htmlUrl || `${this.webBase}/apps/${record.slug}`,
      settingsUrl: this.settingsUrl(record), public: record.public === true, installations, primary: this.primary(agent, approved)?.account || "",
      keyMissing: !this.privateKey(agent), error: record.error || "",
    };
  }
}

export function cleanGithubOrg(value) {
  const org = String(value || "").trim().replace(/^@/, "").replace(/^https?:\/\/github\.com\//i, "").replace(/\/.*$/, "");
  return ORG.test(org) ? org : "";
}
