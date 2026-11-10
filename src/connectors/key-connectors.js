import { createHash, randomBytes } from "node:crypto";
import { CONNECTORS, connectorForTool, KEY_SERVICES, summarizeTool, toolDefinition, toolFor } from "./index.js";

export { KEY_SERVICES };

/**
 * Connectors that need nothing but a key or an app registered by the owner: a person
 * pastes what the service gives them, Cora checks it against the service itself, and
 * the value goes into the vault where authorised agents take it by name.
 */

export class KeyConnectorError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const clean = (value, max = 400) => String(value ?? "").trim().slice(0, max);

export class KeyConnectors {
  constructor({ store, vault = null, google = null, log = () => {}, linearApi = "https://api.linear.app/graphql", asanaApi = "https://app.asana.com/api/1.0", canvaApi = "https://api.canva.com/rest/v1", oauthUrls = {}, fetch: fetchImpl = fetch }) {
    Object.assign(this, { store, vault, google, log, linearApi, asanaApi, canvaApi, oauthUrls, fetch: fetchImpl });
    // OAuth authorisations under way: nonce → who started it, the PKCE verifier and where Google-style callbacks return.
    this.pending = new Map();
    // Access tokens renewed from a stored refresh token, until they expire.
    this.access = new Map();
  }

  api() { return { linear: this.linearApi, asana: this.asanaApi, canva: this.canvaApi }; }

  /** A module's OAuth endpoints, which a test may point elsewhere. */
  oauthOf(service) {
    const connector = CONNECTORS.find((item) => item.id === service);
    return connector?.oauth ? { ...connector.oauth, ...(this.oauthUrls[service] || {}) } : null;
  }

  records() { return this.store.value("keyConnectors", []); }
  save(records) { this.store.setValue("keyConnectors", records); }
  record(service) { return this.records().find((item) => item.service === service && !item.disconnected) || null; }

  view() {
    const records = this.records();
    return Object.keys(KEY_SERVICES).map((service) => {
      const record = records.find((item) => item.service === service && !item.disconnected);
      return record ? { ...record, name: KEY_SERVICES[service].name } : { service, name: KEY_SERVICES[service].name, status: "new", agents: [] };
    });
  }

  by(user) { return { kind: "user", id: user.id, name: user.name || "" }; }

  vaultReady() {
    if (!this.vault) throw new KeyConnectorError("La cassaforte dei segreti non è pronta: riprova tra poco.", 409);
    return this.vault;
  }

  secretName(service) { return KEY_SERVICES[service].secret; }

  async request(url, { method = "GET", headers = {}, body } = {}) {
    let response;
    try {
      response = await this.fetch(url, { method, headers: { Accept: "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    } catch {
      throw new KeyConnectorError("Il servizio non risponde. Riprova tra poco.", 502);
    }
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok) {
      const rejected = [401, 403].includes(response.status);
      throw new KeyConnectorError(rejected ? "Il servizio rifiuta questa credenziale: controllala e riprova." : "Il servizio ha rifiutato la richiesta. Riprova tra poco.", rejected ? 400 : 502);
    }
    return data;
  }

  async checkLinear(workspace, token) {
    const query = "query { viewer { name email organization { name urlKey } } }";
    const call = (authorization) => this.request(this.linearApi, { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: { query } });
    let data;
    try { data = await call(`Bearer ${token}`); }
    catch (error) {
      // Linear takes a personal API key either as a bearer token or bare in the header.
      if (error.status !== 400) throw error;
      data = await call(token);
    }
    const viewer = data?.data?.viewer;
    if (!viewer?.organization?.urlKey) throw new KeyConnectorError("Linear non ha riconosciuto la chiave: crea una chiave API personale e incollala di nuovo.");
    const actual = String(viewer.organization.urlKey);
    if (actual.toLowerCase() !== workspace.toLowerCase()) throw new KeyConnectorError(`Questa chiave appartiene al workspace «${actual}», non a «${workspace}». Controlla il nome del workspace.`);
    return { workspace: actual, account: clean(viewer.name || viewer.email, 120) };
  }

  async checkAsana(token) {
    const me = await this.request(`${this.asanaApi}/users/me`, { headers: { Authorization: `Bearer ${token}` } });
    const workspaces = await this.request(`${this.asanaApi}/workspaces`, { headers: { Authorization: `Bearer ${token}` } });
    const workspace = Array.isArray(workspaces?.data) ? workspaces.data[0] : null;
    if (!me?.data?.name) throw new KeyConnectorError("Asana non ha riconosciuto il token: creane uno nuovo e incollalo di nuovo.");
    return { workspace: clean(workspace?.name || "", 120), workspaceId: clean(workspace?.gid || "", 40), account: clean(me.data.name, 120) };
  }

  appInput(input, service) {
    const clientId = clean(input.clientId, 300), clientSecret = clean(input.clientSecret, 400);
    if (!clientId || !clientSecret) throw new KeyConnectorError(`Per ${KEY_SERVICES[service].name} servono il client ID e il client secret dell'app che crei tu.`);
    return { clientId, clientSecret };
  }

  async connect(service, input = {}, user) {
    const meta = KEY_SERVICES[service];
    if (!meta) throw new KeyConnectorError("Connettore sconosciuto.", 404);
    const previous = this.record(service);
    const agents = previous?.agents || [];
    const base = { service, agents, connectedBy: user.id, connectedAt: new Date().toISOString() };
    let next;
    if (service === "linear") {
      const workspace = clean(input.workspace, 80);
      const token = clean(input.token, 4000);
      if (!workspace) throw new KeyConnectorError("Scrivi il workspace di Linear, quello che compare nell'indirizzo linear.app/<workspace>.");
      if (!token) throw new KeyConnectorError("Incolla la chiave API personale di Linear.");
      const checked = await this.checkLinear(workspace, token);
      this.vaultReady();
      this.vault.put({ name: meta.secret, value: token, description: `Connettore Linear · workspace ${checked.workspace}`, agents, by: this.by(user) });
      next = { ...base, ...checked, status: "connected", mode: "key" };
    } else if (service === "asana") {
      if (input.mode === "oauth") {
        const app = this.appInput(input, service);
        this.vaultReady();
        await this.vault.put({ name: meta.appSecrets[0], value: app.clientId, description: "Connettore Asana · client ID dell'app", agents: [], by: this.by(user) });
        await this.vault.put({ name: meta.appSecrets[1], value: app.clientSecret, description: "Connettore Asana · client secret dell'app", agents: [], by: this.by(user) });
        next = { ...base, status: "app", mode: "oauth", workspace: "", account: "" };
      } else {
        const token = clean(input.token, 4000);
        if (!token) throw new KeyConnectorError("Incolla il token personale di Asana, oppure scegli di collegarla con un'app.");
        const checked = await this.checkAsana(token);
        this.vaultReady();
        this.vault.put({ name: meta.secret, value: token, description: `Connettore Asana · token personale di ${checked.account}`, agents, by: this.by(user) });
        next = { ...base, ...checked, status: "connected", mode: "pat" };
      }
    } else {
      if (input.decision === "later") {
        next = { ...base, status: "later", mode: "later", workspace: "", account: "" };
      } else {
        const app = this.appInput(input, service);
        this.vaultReady();
        await this.vault.put({ name: meta.appSecrets[0], value: app.clientId, description: "Connettore Canva · client ID dell'app", agents: [], by: this.by(user) });
        await this.vault.put({ name: meta.appSecrets[1], value: app.clientSecret, description: "Connettore Canva · client secret dell'app", agents: [], by: this.by(user) });
        next = { ...base, status: "app", mode: "oauth", workspace: "", account: "" };
      }
    }
    next.id = previous?.id || `kc_${randomBytes(6).toString("hex")}`;
    next.updatedAt = new Date().toISOString();
    this.save([...this.records().filter((item) => item.service !== service), next]);
    this.log({ type: "connector", text: `connettore ${meta.name}: ${next.status === "connected" ? "collegato" : next.status === "app" ? "app registrata" : "non richiesto"} (${user.name})` });
    return next;
  }

  appCredentials(service) {
    const [idName, secretName] = KEY_SERVICES[service].appSecrets || [];
    const id = idName && this.store.vaultSecret(idName), secret = secretName && this.store.vaultSecret(secretName);
    if (!id || !secret) throw new KeyConnectorError(`Salva prima client ID e client secret dell'app ${KEY_SERVICES[service].name}.`, 409);
    return { clientId: this.vault.value(id).toString("utf8"), clientSecret: this.vault.value(secret).toString("utf8") };
  }

  /** Starts the owner's OAuth authorisation of a registered app: answers the service's page to open. */
  beginOAuth(service, user, redirectUri) {
    const oauth = this.oauthOf(service);
    const record = this.record(service);
    if (!oauth) throw new KeyConnectorError("Questo connettore non ha un'autorizzazione OAuth.", 404);
    if (!record || !["app", "connected"].includes(record.status) || (record.status === "connected" && record.mode !== "oauth")) throw new KeyConnectorError(`Salva prima l'app ${KEY_SERVICES[service].name}.`, 409);
    if (!redirectUri) throw new KeyConnectorError("Cora non conosce il suo indirizzo pubblico: l'autorizzazione OAuth non può tornare qui.", 409);
    this.vaultReady();
    const { clientId } = this.appCredentials(service);
    for (const [key, value] of this.pending) if (value.expires < Date.now()) this.pending.delete(key);
    const nonce = randomBytes(24).toString("base64url"), verifier = randomBytes(48).toString("base64url");
    this.pending.set(nonce, { service, userId: user.id, verifier, redirectUri, expires: Date.now() + 900000 });
    const url = new URL(oauth.authorize);
    url.search = new URLSearchParams({
      response_type: "code", client_id: clientId, redirect_uri: redirectUri, state: nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
      ...(oauth.scopes?.length ? { scope: oauth.scopes.join(" ") } : {}),
    });
    return { url: url.href, nonce };
  }

  /** Calls a token endpoint with a form body, the way OAuth wants it. */
  async tokenCall(service, params) {
    const oauth = this.oauthOf(service);
    const { clientId, clientSecret } = this.appCredentials(service);
    const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
    const form = new URLSearchParams(params);
    if (oauth.clientAuth === "basic") headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    else { form.set("client_id", clientId); form.set("client_secret", clientSecret); }
    let response;
    try { response = await this.fetch(oauth.token, { method: "POST", headers, body: form.toString(), signal: AbortSignal.timeout(20000) }); }
    catch { throw new KeyConnectorError(`${KEY_SERVICES[service].name} non risponde. Riprova tra poco.`, 502); }
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok || !data?.access_token) throw new KeyConnectorError(`${KEY_SERVICES[service].name} non ha concesso l'autorizzazione: riprova da Connettori.`, response.status === 400 || response.status === 401 ? 400 : 502);
    return data;
  }

  bundle(previous, data) {
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token || previous?.refresh_token || "",
      expires_at: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000,
    };
  }

  /** The service sent the owner back with a code: Cora trades it for tokens and stores them in the vault. */
  async finishOAuth(service, { state, code, error }, nonce) {
    const pending = this.pending.get(String(state || ""));
    if (!pending || pending.service !== service || pending.expires < Date.now() || state !== nonce) throw new KeyConnectorError("Autorizzazione scaduta. Riprova da Connettori.");
    this.pending.delete(state);
    const user = this.store.panelUser(pending.userId);
    if (!user || user.blocked) throw new KeyConnectorError("Accesso non autorizzato.", 403);
    if (error || !code) throw new KeyConnectorError("Autorizzazione annullata.");
    this.vaultReady();
    const data = await this.tokenCall(service, { grant_type: "authorization_code", code: String(code), redirect_uri: pending.redirectUri, code_verifier: pending.verifier });
    const bundle = this.bundle(null, data);
    const request = async (url, options) => {
      const answer = await this.call(url, options);
      if (answer.status < 200 || answer.status >= 300) throw new KeyConnectorError(`${KEY_SERVICES[service].name} non ha confermato l'account.`, 502);
      return answer;
    };
    const checked = await this.oauthOf(service).identify({ access: bundle.access_token, request, api: this.api() });
    const previous = this.record(service);
    const agents = previous?.agents || [];
    const meta = KEY_SERVICES[service];
    await this.vault.put({ name: meta.secret, value: JSON.stringify(bundle), description: `Connettore ${meta.name} · token OAuth${checked.account ? ` di ${checked.account}` : ""}`, agents, by: this.by(user) });
    this.access.set(service, bundle);
    const next = { ...(previous || {}), service, agents, ...checked, status: "connected", mode: "oauth", connectedBy: user.id, connectedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), id: previous?.id || `kc_${randomBytes(6).toString("hex")}` };
    this.save([...this.records().filter((item) => item.service !== service), next]);
    this.log({ type: "connector", text: `connettore ${meta.name}: autorizzato con OAuth (${user.name})` });
    return next;
  }

  /** The access token of an OAuth connector, renewed with its refresh token when it is about to expire. */
  async oauthAccess(connector, record) {
    const stored = this.access.get(connector.id) || JSON.parse(this.vault.value(this.store.vaultSecret(connector.secret)).toString("utf8"));
    if (stored.expires_at > Date.now() + 60000) { this.access.set(connector.id, stored); return stored; }
    if (!stored.refresh_token) throw new Error(`${connector.name} needs a new authorisation: the owner authorises it again in Connettori`);
    let data;
    try { data = await this.tokenCall(connector.id, { grant_type: "refresh_token", refresh_token: stored.refresh_token }); }
    catch { throw new Error(`${connector.name} did not renew the authorisation: the owner authorises it again in Connettori`); }
    const bundle = this.bundle(stored, data);
    // Some services (Canva) hand out a new refresh token each time: the old one stops working, so the new one is stored at once.
    await this.vault.put({ name: connector.secret, value: JSON.stringify(bundle), agents: record.agents || [], by: this.store.vaultSecret(connector.secret)?.createdBy || null, source: "connector" });
    this.access.set(connector.id, bundle);
    return bundle;
  }

  updateAgents(service, agents, user) {
    const records = this.records();
    const record = records.find((item) => item.service === service && !item.disconnected);
    if (!record) throw new KeyConnectorError("Connettore non collegato.", 404);
    if (!Array.isArray(agents) || agents.some((id) => !this.store.agent(id))) throw new KeyConnectorError("Scegli agenti validi.");
    record.agents = [...new Set(agents.map(String))];
    record.updatedAt = new Date().toISOString();
    this.save(records);
    if (record.status === "connected" && KEY_SERVICES[service].secret) this.vaultReady().update(KEY_SERVICES[service].secret, { agents: record.agents }, this.by(user));
    return record;
  }

  disconnect(service, user = null) {
    const record = this.record(service);
    if (!record) throw new KeyConnectorError("Connettore non collegato.", 404);
    this.save(this.records().filter((item) => item.service !== service));
    this.access.delete(service);
    const names = [KEY_SERVICES[service].secret, ...(KEY_SERVICES[service].appSecrets || [])].filter(Boolean);
    for (const name of names) { try { this.vault?.remove(name, user ? this.by(user) : null); } catch { /* the value is already gone */ } }
    this.log({ type: "connector", text: `connettore ${KEY_SERVICES[service].name}: scollegato` });
  }

  /** The connector tools this agent may use: only connected services whose key the owner gave it. */
  toolsFor(agent) {
    const google = this.google?.toolsFor(agent) || [];
    if (!agent || !this.vault?.enabled) return google;
    return google.concat(this.records().filter((record) => !record.disconnected && record.status === "connected").flatMap((record) => {
      const connector = CONNECTORS.find((item) => item.id === record.service);
      if (!connector?.tools?.length || !this.allowed(record, connector, agent)) return [];
      return connector.tools.map((tool) => toolDefinition(tool, record));
    }));
  }

  allowed(record, connector, agent) {
    const secret = this.store.vaultSecret(connector.secret);
    return Boolean(secret && (record.agents || []).includes(agent.id) && this.vault.canUse(secret, agent));
  }

  handles(name) { return Boolean(connectorForTool(name)); }

  summarize(name, args) { return summarizeTool(name, args || {}); }

  /** Answers the HTTP status and JSON of a call, without throwing on a refusal: the agent reads it. */
  async call(url, { method = "GET", headers = {}, body, raw, timeout = 30000 } = {}) {
    let response;
    try {
      response = await this.fetch(url, { method, headers: { Accept: "application/json", ...headers }, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
    } catch {
      return { status: 0, data: null };
    }
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    return { status: response.status, data };
  }

  /** Runs a connector tool for an agent: Cora takes the key from the vault, the agent gets only the service's answer. */
  async runTool(agent, name, args = {}, { readFile = null, writeFile = null } = {}) {
    const connector = connectorForTool(name), tool = toolFor(name);
    if (connector?.kind === "google") return this.google ? this.google.runTool(agent, name, args || {}, { readFile, writeFile }) : { text: "error: Google is not available on this Cora" };
    const record = connector && this.record(connector.id);
    if (!connector || !record || record.status !== "connected") return { text: `error: ${connector?.name || name} is not connected: the owner connects it in Connettori` };
    if (!this.vault?.enabled || !this.allowed(record, connector, agent)) return { text: `error: you are not authorised for ${connector.name}: the owner picks the agents in its card in Connettori` };
    let token = "", hidden = [];
    let result;
    try {
      if (record.mode === "oauth") {
        const bundle = await this.oauthAccess(connector, record);
        token = bundle.access_token; hidden = [bundle.refresh_token];
      } else token = this.vault.value(this.store.vaultSecret(connector.secret)).toString("utf8");
      const request = async (url, options) => {
        const answer = await this.call(url, options);
        if (!answer.status) throw new Error(`${connector.name} does not answer: try again shortly`);
        return answer;
      };
      const base = { token, request, api: this.api(), record, readFile, writeFile };
      result = { data: await tool.run(args || {}, connector.context ? connector.context(base) : base) };
    } catch (error) {
      result = { error: error.message };
    }
    const hide = (text) => [token, ...hidden].filter((value) => value && value.length > 7).reduce((out, value) => out.split(value).join("[key]"), text);
    if (result.error !== undefined) return { text: hide(`error: ${result.error}`) };
    const text = JSON.stringify(result.data ?? null);
    const LIMIT = 40000;
    return { text: hide(text.length > LIMIT ? `${text.slice(0, LIMIT)}\n[truncated at ${LIMIT} of ${text.length} characters: ask for fewer fields or fewer items]` : text) };
  }
}
