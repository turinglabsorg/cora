import { createHash, randomBytes } from "node:crypto";

/**
 * Google: an account connected through Cora's OAuth broker, which asks Google for
 * gmail.send only. An agent authorised on an account gets the google_email tool:
 * it lists the accounts it may send from and sends from one of them. Cora takes
 * the refresh token from the vault and renews the access token; the agent never
 * holds either.
 */
export const google = {
  id: "google",
  name: "Google",
  kind: "google",
  tool: "google_email",
  card: {
    icon: "mail",
    description: "Invia email dal tuo account Gmail o Google Workspace con gli agenti che scegli.",
    meta: "Gmail · Google Workspace",
  },
  definition(connections) {
    return {
      name: "google_email",
      description: `Google email: send from a Gmail or Google Workspace account the owner connected in Connettori and authorised you on (${connections.map((item) => item.email).join(", ")}). action "accounts" lists them; action "send" sends one message from one of them, with from (its address), to, subject and body_html and/or body_text. The account only allows sending: it cannot read the mailbox. Send only what the person asked for, to the recipients they named; a send is final, so never retry one whose result is uncertain: check with the person first.`,
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["accounts", "send"], description: "default accounts" },
          from: { type: "string", description: "send: the connected address to send from (or its id); optional when you have one account" },
          to: { type: "array", items: { type: "string" }, description: "send: recipient addresses" },
          subject: { type: "string" },
          body_html: { type: "string" },
          body_text: { type: "string" },
          in_reply_to: { type: "string", description: "optional Message-ID this answers" },
        },
      },
    };
  },
  summarize(args) {
    const action = String(args.action || "accounts");
    return action === "send" ? `send ${String(args.from || "")} → ${(Array.isArray(args.to) ? args.to : [args.to]).filter(Boolean).join(", ")}`.slice(0, 200) : action;
  },
};

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[a-z]{2,}$/i;

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
  /** The google_email tool, for an agent authorised on at least one account. */
  toolsFor(agent) {
    const connections = agent && this.enabled ? this.forAgent(agent) : [];
    return connections.length ? [google.definition(connections)] : [];
  }

  async runTool(agent, args = {}) {
    const connections = this.forAgent(agent);
    if (!connections.length) return { text: "error: you are not authorised on a Google account: the owner picks the agents in the Google card in Connettori" };
    const action = String(args.action || "accounts");
    if (action === "accounts") return { text: JSON.stringify(connections.map(({ id, email, scope }) => ({ id, email, can: String(scope || "").includes("gmail.send") ? ["send"] : [] }))) };
    if (action !== "send") return { text: "error: action is accounts or send" };
    const from = String(args.from || "").trim().toLowerCase();
    const connection = from ? connections.find((item) => item.id === from || item.email.toLowerCase() === from) : connections.length === 1 ? connections[0] : null;
    if (!connection) return { text: `error: from is one of ${connections.map((item) => item.email).join(", ")}` };
    const to = (Array.isArray(args.to) ? args.to : [args.to]).map((item) => String(item || "").trim()).filter(Boolean);
    if (!to.length || to.length > 50 || to.some((item) => !EMAIL.test(item))) return { text: "error: to is a list of 1 to 50 email addresses" };
    const subject = String(args.subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, 500);
    if (!subject) return { text: "error: subject is required" };
    const bodyHtml = String(args.body_html || ""), bodyText = String(args.body_text || "");
    if (!bodyHtml && !bodyText) return { text: "error: write body_html or body_text" };
    try {
      const sent = await this.send(agent, connection.id, { to, subject, body_html: bodyHtml || bodyText.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]).replace(/\n/g, "<br>"), body_text: bodyText || bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), in_reply_to: args.in_reply_to ? String(args.in_reply_to) : "" });
      return { text: JSON.stringify({ sent: true, from: sent.email, to, message_id: sent.message_id }) };
    } catch (error) {
      return { text: `error: ${error.message}` };
    }
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
