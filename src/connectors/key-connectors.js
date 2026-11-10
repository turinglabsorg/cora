import { randomBytes } from "node:crypto";
import { CONNECTORS, connectorForTool, KEY_SERVICES } from "./index.js";

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
  constructor({ store, vault = null, log = () => {}, linearApi = "https://api.linear.app/graphql", asanaApi = "https://app.asana.com/api/1.0", fetch: fetchImpl = fetch }) {
    Object.assign(this, { store, vault, log, linearApi, asanaApi, fetch: fetchImpl });
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
    const names = [KEY_SERVICES[service].secret, ...(KEY_SERVICES[service].appSecrets || [])].filter(Boolean);
    for (const name of names) { try { this.vault?.remove(name, user ? this.by(user) : null); } catch { /* the value is already gone */ } }
    this.log({ type: "connector", text: `connettore ${KEY_SERVICES[service].name}: scollegato` });
  }

  /** The connector tools this agent may use: only connected services whose key the owner gave it. */
  toolsFor(agent) {
    if (!agent || !this.vault?.enabled) return [];
    return this.records().filter((record) => !record.disconnected && record.status === "connected").flatMap((record) => {
      const connector = CONNECTORS.find((item) => item.id === record.service);
      if (!connector?.definition || !this.allowed(record, connector, agent)) return [];
      return [connector.definition(record)];
    });
  }

  allowed(record, connector, agent) {
    const secret = this.store.vaultSecret(connector.secret);
    return Boolean(secret && (record.agents || []).includes(agent.id) && this.vault.canUse(secret, agent));
  }

  handles(name) { return Boolean(connectorForTool(name)); }

  summarize(name, args) { return connectorForTool(name)?.summarize?.(args || {}) || ""; }

  /** Answers the HTTP status and JSON of a call, without throwing on a refusal: the agent reads it. */
  async call(url, { method = "GET", headers = {}, body } = {}) {
    let response;
    try {
      response = await this.fetch(url, { method, headers: { Accept: "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    } catch {
      return { status: 0, data: null };
    }
    let data = null;
    try { data = await response.json(); } catch { data = null; }
    return { status: response.status, data };
  }

  /** Runs a connector tool for an agent: Cora takes the key from the vault, the agent gets only the service's answer. */
  async runTool(agent, name, args = {}) {
    const connector = connectorForTool(name);
    const record = connector && this.record(connector.id);
    if (!connector || !record || record.status !== "connected") return { text: `error: ${connector?.name || name} is not connected: the owner connects it in Connettori` };
    if (!this.vault?.enabled || !this.allowed(record, connector, agent)) return { text: `error: you are not authorised for ${connector.name}: the owner picks the agents in its card in Connettori` };
    const token = this.vault.value(this.store.vaultSecret(connector.secret)).toString("utf8");
    let result;
    try {
      const request = async (url, options) => {
        const answer = await this.call(url, options);
        if (!answer.status) throw new Error(`${connector.name} does not answer: try again shortly`);
        return answer;
      };
      result = await connector.run(args || {}, { token, request, api: { linear: this.linearApi, asana: this.asanaApi } });
    } catch (error) {
      result = { error: error.message };
    }
    const hide = (text) => token ? text.split(token).join("[key]") : text;
    if (result.error !== undefined) return { text: hide(`error: ${result.error}`) };
    const text = JSON.stringify(result.data);
    const LIMIT = 40000;
    return { text: hide(text.length > LIMIT ? `${text.slice(0, LIMIT)}\n[truncated at ${LIMIT} of ${text.length} characters: ask for fewer fields or fewer items]` : text) };
  }
}
