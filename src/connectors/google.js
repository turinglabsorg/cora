import { createHash, randomBytes } from "node:crypto";

/**
 * Google: an account connected through Cora's OAuth broker. It has no tool of its
 * own: an agent authorised on the account sends from it with email_send and its
 * sender_id. The broker asks Google for gmail.send only.
 */
export const google = {
  id: "google",
  name: "Google",
  kind: "google",
  card: {
    icon: "mail",
    description: "Invia email dal tuo account Gmail o Google Workspace con gli agenti che scegli.",
    meta: "Gmail · Google Workspace",
  },
};

const hash = (value) => createHash("sha256").update(value).digest("base64url");
const SECRET = (id) => `CORA_GOOGLE_${id.toUpperCase()}`;
export class ConnectorError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export class GoogleConnector {
  constructor({ store, broker, space, storeSecret, tokenFor, enabled = true, api = "https://gmail.googleapis.com/gmail/v1/users/me" }) {
    Object.assign(this, { store, enabled, broker: String(broker || "").replace(/\/$/, ""), space, storeSecret, tokenFor, api });
    this.pending = new Map(); this.bundles = new Map(); this.access = new Map();
  }
  records() { return this.store.value("googleConnectors", []); }
  view(user = null) {
    return { available: Boolean(this.enabled && this.broker && this.space), connections: this.records().filter((item) => !item.disconnected && (!this.knowledge?.ownerMemory || item.connectedBy === user?.id)),
      agents: (this.knowledge?.ownerMemory ? this.knowledge.agentsFor(user) : this.store.agents()).map(({ id, name }) => ({ id, name })) };
  }
  forAgent(agent) { return this.records().filter((item) => !item.disconnected && item.agents.includes(agent.id)); }
  identity(agent, id) {
    const connection = this.forAgent(agent).find((item) => item.id === id);
    if (!connection) throw new ConnectorError("Questo account Google non è autorizzato per l'agente.", 403);
    return connection;
  }
  begin(user) {
    if (!this.enabled || !this.broker || !this.space) throw new ConnectorError("Il collegamento Google non è disponibile.", 409);
    for (const [key, value] of this.pending) if (value.expires < Date.now()) this.pending.delete(key);
    const nonce = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
    this.pending.set(nonce, { userId: user.id, verifier, expires: Date.now() + 900000 });
    const url = new URL(`${this.broker}/connectors/google/start`);
    url.search = new URLSearchParams({ space: this.space, nonce, challenge: hash(verifier) });
    return { url: url.href, nonce };
  }
  async relay(path, body) {
    const response = await fetch(`${this.broker}/connectors/google/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new ConnectorError("Google non ha completato il collegamento. Riprova da Connettori.", 502);
    return response.json();
  }
  async finish({ state, code, error, nonce }) {
    let data;
    try { data = JSON.parse(Buffer.from(String(state).split(".")[1], "base64url")); } catch { throw new ConnectorError("Collegamento Google scaduto. Riprova."); }
    const pending = this.pending.get(data.nonce);
    if (!pending || pending.expires < Date.now() || data.space !== this.space || data.nonce !== nonce) throw new ConnectorError("Collegamento Google scaduto. Riprova.");
    this.pending.delete(data.nonce);
    const user = this.store.panelUser(pending.userId);
    if (!user || (!this.knowledge?.ownerMemory && user.role !== "owner") || user.blocked) throw new ConnectorError("Accesso non autorizzato.", 403);
    if (error || !code) throw new ConnectorError("Collegamento Google annullato.");
    const result = await this.relay("exchange", { state, code, verifier: pending.verifier });
    if (!result.refresh_token || !result.grant || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(result.email || "")) throw new ConnectorError("Google non ha confermato l'indirizzo.");
    const old = this.records().find((item) => item.email === result.email && item.connectedBy === user.id);
    const id = old?.id || `gc_${randomBytes(8).toString("hex")}`;
    const bundle = { refresh_token: result.refresh_token, grant: result.grant };
    await this.storeSecret(SECRET(id), JSON.stringify(bundle));
    this.bundles.set(id, bundle); this.access.delete(id);
    const connection = { id, email: result.email, scope: result.scope, agents: old?.agents || [], connectedBy: user.id, connectedAt: new Date().toISOString(), disconnected: false };
    this.store.setValue("googleConnectors", [...this.records().filter((item) => item.id !== id), connection]);
    return connection;
  }
  update(id, { agents }) {
    const records = this.records(), connection = records.find((item) => item.id === id && !item.disconnected);
    if (!connection) throw new ConnectorError("Account Google non trovato.", 404);
    if (!Array.isArray(agents) || agents.some((agentId) => !this.store.agent(agentId))) throw new ConnectorError("Scegli agenti validi.");
    connection.agents = [...new Set(agents)];
    this.store.setValue("googleConnectors", records);
    return this.view();
  }
  disconnect(id) {
    const records = this.records(), connection = records.find((item) => item.id === id);
    if (!connection) throw new ConnectorError("Account Google non trovato.", 404);
    connection.disconnected = true; connection.agents = [];
    this.access.delete(id); this.bundles.delete(id);
    this.store.setValue("googleConnectors", records);
  }
  async token(connection) {
    const cached = this.access.get(connection.id);
    if (cached?.until > Date.now() + 60000) return cached.token;
    let bundle = this.bundles.get(connection.id);
    if (!bundle) { try { bundle = JSON.parse(this.tokenFor(SECRET(connection.id))); } catch { throw new ConnectorError("Ricollega l'account Google da Connettori.", 409); } }
    const result = await this.relay("refresh", bundle);
    if (result.email !== connection.email || !result.access_token) throw new ConnectorError("Ricollega l'account Google da Connettori.", 409);
    this.access.set(connection.id, { token: result.access_token, until: Date.now() + Math.min(3600, Number(result.expires_in) || 300) * 1000 });
    return result.access_token;
  }
  async send(agent, senderId, message) {
    const connection = this.identity(agent, senderId), boundary = `cora_${randomBytes(16).toString("hex")}`;
    const encode = (text) => Buffer.from(text).toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
    const headers = ["MIME-Version: 1.0", `From: =?UTF-8?B?${Buffer.from(agent.name).toString("base64")}?= <${connection.email}>`, `To: ${message.to.join(", ")}`, `Subject: =?UTF-8?B?${Buffer.from(message.subject).toString("base64")}?=`, `Content-Type: multipart/alternative; boundary="${boundary}"`];
    for (const [name, value] of [["In-Reply-To", message.in_reply_to], ["References", message.references], ["Auto-Submitted", message.auto_submitted]]) {
      if (value && !/[\r\n\0]/.test(value) && value.length < 4096) headers.push(`${name}: ${value}`);
    }
    const parts = [["text/plain", message.body_text || ""], ["text/html", message.body_html || ""]].map(([type, content]) => `--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encode(content)}\r\n`).join("");
    const raw = Buffer.from(`${headers.join("\r\n")}\r\n\r\n${parts}--${boundary}--\r\n`).toString("base64url");
    const access = await this.token(connection);
    this.identity(agent, senderId);
    const response = await fetch(`${this.api}/messages/send`, { method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw }), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new ConnectorError("Google non ha confermato l'invio. Controlla la posta inviata prima di riprovare.", 502);
    const result = await response.json();
    if (!result.id) throw new ConnectorError("Google non ha confermato l'invio.", 502);
    return { message_id: result.id, email: connection.email };
  }
}
