import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

/**
 * The vault: secrets kept encrypted on the server and used by name, the way hush
 * works. Nobody reads a value back from the panel. A value arrives through the
 * panel or through a request link sent to whoever holds it (Bitwarden Send's
 * receiving side, inside Cora); an agent puts one into the hush on its own
 * computer and uses it there with `hush run`, never seeing it; and a value
 * leaves only through a send link the owner creates or approves, opened a set
 * number of times, whose key lives in the link alone.
 */
export const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
export const MAX_SECRET = 64 * 1024;
const USES_KEPT = 50;

export class VaultError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const tokenHash = (token) => createHash("sha256").update(String(token)).digest("hex");
// A send on an address of its own, like a shared folder: v-<12 hex of its id>--<space>.<domain>.
const SEND_LABEL = /^v-([a-f0-9]{12})$/;
const PUBLIC = { mode: "public", emails: [], domains: [], members: false };
const b64url = (buffer) => Buffer.from(buffer).toString("base64url");

/** AES-256-GCM: iv, tag and ciphertext together; the additional data binds a value to its record. */
function seal(key, value, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(Buffer.from(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

function unseal(key, sealed, aad) {
  const raw = Buffer.from(String(sealed), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
}

export class Vault {
  constructor({ store, key, boxes = null, log = () => {}, notice = null, push = null, instanceUrl = "", access = null, shareSuffix = "" }) {
    this.store = store;
    // Who may open a send follows the same rules as a shared folder's link (Artifacts' cleanAccess, passwordOpens, allows).
    this.access = access;
    this.shareSuffix = shareSuffix;
    this.recent = new Map();
    this.boxes = boxes;
    this.log = log;
    this.notice = notice;
    this.webPush = push;
    this.instanceUrl = instanceUrl;
    // Derived for the vault alone: the session key signs cookies, this one only encrypts values.
    this.key = key ? Buffer.from(hkdfSync("sha256", Buffer.from(String(key)), Buffer.alloc(0), Buffer.from("cora vault v1"), 32)) : null;
  }

  get enabled() {
    return Boolean(this.key);
  }

  /**
   * One line in the vault's log. `who` is a visitor (their proven address, or a code from
   * their network and browser), `by` someone of the space or an agent. A page opened again
   * by the same visitor within a minute is not a new line.
   */
  event(kind, fields = {}) {
    const now = Date.now();
    if (fields.who && /-page$/.test(kind)) {
      const key = `${kind}.${fields.sendId || fields.requestId || fields.name}.${fields.who.email || fields.who.visitor}`;
      if ((this.recent.get(key) || 0) > now - 60000) return;
      this.recent.set(key, now);
      if (this.recent.size > 2000) for (const [entry, at] of this.recent) if (at < now - 60000) this.recent.delete(entry);
    }
    this.store.addVaultEvent?.({ at: now, kind, ...fields });
  }

  events(options) {
    return this.store.vaultEvents(options);
  }

  need() {
    if (!this.key) throw new VaultError("questa Cora non ha una chiave per la cassaforte (CORA_SESSION_KEY)", 409);
  }

  cleanName(name) {
    const value = String(name || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
    if (!SECRET_NAME.test(value)) throw new VaultError("il nome di un segreto è fatto di maiuscole, cifre e trattini bassi, come ACME_STRIPE_KEY");
    return value;
  }

  cleanAgents(agents) {
    const list = Array.isArray(agents) ? agents.map(String) : [];
    if (list.includes("*")) return ["*"];
    const known = new Set(this.store.agents().map((agent) => agent.id));
    return [...new Set(list.filter((id) => known.has(id)))];
  }

  cleanValue(value) {
    const text = String(value ?? "");
    if (!text.trim()) throw new VaultError("il valore è vuoto");
    if (Buffer.byteLength(text) > MAX_SECRET) throw new VaultError(`un segreto sta in ${MAX_SECRET / 1024} KB`);
    return text.replace(/\r\n/g, "\n").replace(/\n+$/, "");
  }

  view(secret) {
    const last = secret.uses?.[0];
    return {
      id: secret.id, name: secret.name, description: secret.description, agents: secret.agents, size: secret.size, source: secret.source,
      createdBy: secret.createdBy, createdAt: secret.createdAt, updatedAt: secret.updatedAt,
      uses: secret.useCount || 0, lastUse: last ? { agentId: last.agentId, name: last.name, at: last.at } : null,
    };
  }

  list() {
    return this.store.vaultSecrets().map((secret) => this.view(secret));
  }

  canUse(secret, agent) {
    return Boolean(agent && (secret.agents || []).some((id) => id === "*" || id === agent.id));
  }

  /** Stores a value under a name, new or replacing the old one; who may use it stays unless given. */
  put({ name, value, description, agents, by, source = "panel" }) {
    this.need();
    const clean = this.cleanName(name);
    const text = this.cleanValue(value);
    const old = this.store.vaultSecret(clean);
    const now = Date.now();
    const secret = {
      id: old?.id || `vs_${randomBytes(6).toString("hex")}`, name: clean,
      description: description !== undefined ? String(description || "").trim().slice(0, 300) : old?.description || "",
      agents: agents !== undefined ? this.cleanAgents(agents) : old?.agents || [],
      size: Buffer.byteLength(text), source, createdBy: old?.createdBy || by || null, updatedBy: by || null,
      createdAt: old?.createdAt || now, updatedAt: now, uses: old?.uses || [], useCount: old?.useCount || 0,
    };
    secret.sealed = seal(this.key, text, `${secret.id}.${clean}`);
    this.store.writeVaultSecret(secret);
    this.log({ type: "secret", text: `${old ? "sostituito" : "nuovo"} segreto ${clean}${by?.name ? ` (${by.name})` : ""}` });
    if (source !== "request") this.event(old ? "secret-replaced" : "secret-created", { name: clean, by: by ? { kind: by.kind || "user", name: by.name || "" } : null });
    return this.view(secret);
  }

  update(name, { description, agents }, by = null) {
    const secret = this.store.vaultSecret(this.cleanName(name));
    if (!secret) throw new VaultError("segreto non trovato", 404);
    if (description !== undefined) secret.description = String(description || "").trim().slice(0, 300);
    if (agents !== undefined) secret.agents = this.cleanAgents(agents);
    secret.updatedAt = Date.now();
    this.store.writeVaultSecret(secret);
    this.event(agents !== undefined ? "secret-agents" : "secret-changed", { name: secret.name, agents: agents !== undefined ? secret.agents : undefined, by: by ? { kind: by.kind || "user", name: by.name || "" } : null });
    return this.view(secret);
  }

  remove(name, by = null) {
    const clean = this.cleanName(name);
    if (!this.store.vaultSecret(clean)) throw new VaultError("segreto non trovato", 404);
    this.store.deleteVaultSecret(clean);
    this.log({ type: "secret", text: `eliminato il segreto ${clean}` });
    this.event("secret-deleted", { name: clean, by: by ? { kind: by.kind || "user", name: by.name || "" } : null });
  }

  value(secret) {
    this.need();
    return unseal(this.key, secret.sealed, `${secret.id}.${secret.name}`);
  }

  /**
   * Puts a secret into the hush on an agent's computer, sealed to that hush's own key
   * and opened straight into its vault: the value never reaches the agent's model.
   */
  async importInto(agent, name, { as = "" } = {}) {
    if (!this.boxes) throw new VaultError("there are no desktops here");
    const clean = this.cleanName(name);
    const secret = this.store.vaultSecret(clean);
    if (!secret) throw new VaultError(`there is no secret ${clean}: secret_list shows the names; to get a new one, send the person a link with secret_request`, 404);
    if (!this.canUse(secret, agent)) throw new VaultError(`you may not use ${clean}: the owner allows agents per secret in the panel`, 403);
    const target = as ? this.cleanName(as) : clean;
    await this.boxes.importSecret(agent.id, target, this.value(secret));
    secret.uses = [{ agentId: agent.id, name: agent.name, at: Date.now() }, ...(secret.uses || [])].slice(0, USES_KEPT);
    secret.useCount = (secret.useCount || 0) + 1;
    this.store.writeVaultSecret(secret);
    this.log({ type: "secret", agentId: agent.id, text: `${agent.name} ha messo ${clean} nel suo hush` });
    this.event("secret-imported", { name: clean, as: target !== clean ? target : undefined, by: { kind: "agent", id: agent.id, name: agent.name } });
    return target;
  }

  link(path) {
    return `${this.instanceUrl}${path}`;
  }

  /** A one-time page where whoever holds a secret puts it in, so it never passes through a chat. */
  requestLink({ name, description = "", agents = [], by, channelId = "", hours = 72 }) {
    this.need();
    const clean = this.cleanName(name);
    const token = b64url(randomBytes(24));
    const now = Date.now();
    const request = {
      id: `vr_${randomBytes(6).toString("hex")}`, name: clean, description: String(description || "").trim().slice(0, 300), agents: this.cleanAgents(agents),
      by: by || null, channelId, status: "open", createdAt: now, expiresAt: now + Math.min(Math.max(Number(hours) || 72, 1), 24 * 14) * 3600000,
      replaces: Boolean(this.store.vaultSecret(clean)),
    };
    this.store.writeVaultRequest(tokenHash(token), request);
    this.log({ type: "secret", text: `link per ricevere ${clean}${by?.name ? ` (chiesto da ${by.name})` : ""}` });
    this.event("request-created", { name: clean, requestId: request.id, by: by ? { kind: by.kind || "user", name: by.name || "" } : null });
    return { ...request, url: this.link(`/send/r/${token}`) };
  }

  requests() {
    return this.store.vaultRequests().map((request) => ({ ...request, expired: request.status === "open" && request.expiresAt < Date.now() }));
  }

  /** What the request page shows: a request that can still be filled, or null. */
  openRequest(token) {
    const request = this.store.vaultRequest(tokenHash(token));
    return request && request.status === "open" && request.expiresAt > Date.now() ? request : null;
  }

  cancelRequest(id, by = null) {
    const found = this.store.vaultRequests().find((request) => request.id === id);
    if (!found) throw new VaultError("richiesta non trovata", 404);
    const hash = this.store.stmt("SELECT token_hash FROM vault_requests WHERE json_extract(data, '$.id') = ?").get(id)?.token_hash;
    if (hash) this.store.closeVaultRequest(hash, { ...found, status: "cancelled" });
    this.event("request-cancelled", { name: found.name, requestId: id, by: by ? { kind: by.kind || "user", name: by.name || "" } : null });
  }

  /** The value arrives: stored under the requested name, the link closed, the asker told. */
  fillRequest(token, value, who = null) {
    this.need();
    const hash = tokenHash(token);
    const request = this.openRequest(token);
    if (!request) throw new VaultError("questo link non è più valido", 410);
    const text = this.cleanValue(value);
    if (!this.store.closeVaultRequest(hash, { ...request, status: "filled", filledAt: Date.now() })) throw new VaultError("questo link non è più valido", 410);
    const secret = this.put({ name: request.name, value: text, description: request.description || undefined, agents: request.agents.length ? request.agents : undefined, by: request.by, source: "request" });
    this.event("request-filled", { name: request.name, requestId: request.id, who });
    const asker = request.by?.name ? ` (chiesto da ${request.by.name})` : "";
    this.webPush?.notify({ title: "Cassaforte", body: `È arrivato ${request.name}${asker}`, url: "/#/artefatti/segreti", tag: `secret-${request.id}` }).catch?.(() => {});
    if (request.channelId && this.notice) Promise.resolve(this.notice(request.channelId, `🔐 È arrivato **${request.name}** nella cassaforte${asker}: si usa per nome, con secret_import.`)).catch(() => {});
    return secret;
  }

  /**
   * A send link: the value encrypted under a key that lives only in the link's
   * fragment, opened a given number of times before it is gone. An agent's send
   * waits for the owner, and only then gets its key.
   */
  /** Who may open a send: anyone with the link, whoever knows its password, or the people it names. */
  cleanSendAccess(access, previous = null) {
    if (!access || !this.access) return previous || { ...PUBLIC };
    const clean = this.access.cleanAccess(access, previous);
    if (clean.mode === "people" && !this.shareSuffix) throw new VaultError("un segreto per persone precise ha bisogno di uno spazio su usecora.space: qui usa un link pubblico o con password");
    return clean;
  }

  createSend({ name, views = 1, days = 7, note = "", by, status = "active", channelId = "", access = null }) {
    this.need();
    const clean = this.cleanName(name);
    const secret = this.store.vaultSecret(clean);
    if (!secret) throw new VaultError("segreto non trovato", 404);
    const now = Date.now();
    const send = {
      id: `vx_${randomBytes(6).toString("hex")}`, name: clean, views: Math.min(Math.max(Math.round(Number(views) || 1), 1), 20),
      days: Math.min(Math.max(Number(days) || 7, 1), 30), note: String(note || "").trim().slice(0, 300), by: by || null, channelId,
      status, createdAt: now, expiresAt: now + Math.min(Math.max(Number(days) || 7, 1), 30) * 86400000, opened: 0, revision: 1,
      access: this.cleanSendAccess(access),
    };
    const actor = by ? { kind: by.kind || "user", id: by.id, name: by.name || "" } : null;
    if (status === "proposed") {
      this.store.writeVaultSend(`proposed:${send.id}`, send);
      this.webPush?.notify({ title: "Cassaforte", body: `${by?.name || "Un agente"} chiede di mandare ${clean}`, url: "/#/artefatti/segreti", tag: `send-${send.id}` }).catch?.(() => {});
      this.log({ type: "secret", text: `${by?.name || "un agente"} chiede di mandare ${clean}: aspetta il proprietario` });
      this.event("send-proposed", { name: clean, sendId: send.id, note: send.note, by: actor });
      return this.sendView(send);
    }
    const armed = this.arm(send, secret);
    this.event("send-created", { name: clean, sendId: send.id, mode: send.access.mode, views: send.views, note: send.note, by: actor });
    return armed;
  }

  arm(send, secret) {
    const token = b64url(randomBytes(24));
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(this.value(secret)), cipher.final(), cipher.getAuthTag()]);
    const armed = { ...send, status: "active", iv: iv.toString("base64"), data: data.toString("base64") };
    this.store.writeVaultSend(tokenHash(token), armed);
    this.log({ type: "secret", text: `link per mandare ${send.name} (${send.views} ${send.views === 1 ? "apertura" : "aperture"})` });
    // On a space routed by usecora.space a send has an address of its own, so people can sign in to it like to a folder.
    const url = this.shareSuffix ? `https://v-${send.id.slice(3)}${this.shareSuffix}/#${b64url(key)}` : this.link(`/send/s/${token}#${b64url(key)}`);
    return { ...this.sendView(armed), url };
  }

  /** The owner lets an agent's send go: only now does it get its key, and its link goes to the owner. */
  /** The owner lets an agent's send go, with the access, views and expiry chosen in the same form as any send. */
  approveSend(id, by, { access, views, days, note } = {}) {
    const found = this.store.vaultSendById(id);
    if (!found || found.send.status !== "proposed") throw new VaultError("invio non trovato", 404);
    const secret = this.store.vaultSecret(found.send.name);
    if (!secret) throw new VaultError("segreto non trovato", 404);
    const chosen = {
      access: access ? this.cleanSendAccess(access) : found.send.access || { ...PUBLIC },
      views: views !== undefined ? Math.min(Math.max(Math.round(Number(views) || 1), 1), 20) : found.send.views,
      days: days !== undefined ? Math.min(Math.max(Number(days) || 7, 1), 30) : found.send.days,
      note: note !== undefined ? String(note || "").trim().slice(0, 300) : found.send.note,
    };
    this.store.stmt("DELETE FROM vault_sends WHERE token_hash = ?").run(found.hash);
    const now = Date.now();
    const armed = this.arm({ ...found.send, ...chosen, approvedBy: by || null, createdAt: now, expiresAt: now + chosen.days * 86400000 }, secret);
    this.event("send-approved", { name: found.send.name, sendId: id, mode: chosen.access.mode, views: chosen.views, by: by ? { kind: by.kind || "user", name: by.name || "" } : null, for: found.send.by?.name || "" });
    if (found.send.channelId && this.notice) Promise.resolve(this.notice(found.send.channelId, `🔐 Il proprietario ha approvato l'invio di **${found.send.name}**: il link lo manda lui.`)).catch(() => {});
    return armed;
  }

  revokeSend(id, by = null) {
    const found = this.store.vaultSendById(id);
    if (!found) throw new VaultError("invio non trovato", 404);
    this.store.writeVaultSend(found.hash, { ...found.send, status: "revoked", revision: (found.send.revision || 1) + 1, iv: undefined, data: undefined });
    this.event(found.send.status === "proposed" ? "send-rejected" : "send-revoked", { name: found.send.name, sendId: id, by: by ? { kind: by.kind || "user", name: by.name || "" } : null });
  }

  sendView(send) {
    const { iv, data, ...rest } = send;
    const { password, ...access } = send.access || PUBLIC;
    return { ...rest, access: { ...PUBLIC, ...access }, left: Math.max(0, send.views - send.opened), expired: send.expiresAt < Date.now() };
  }

  /** A send's own address, v-<12 hex>: the send behind it while it still opens, for the share hosts. */
  resolveHost(label) {
    const match = SEND_LABEL.exec(String(label || ""));
    if (!match) return null;
    const found = this.store.vaultSendById(`vx_${match[1]}`);
    const send = found?.send;
    if (!send || send.status !== "active" || send.expiresAt < Date.now() || send.opened >= send.views || !send.data) return null;
    return { kind: "send", send, hash: found.hash, share: { access: send.access || { ...PUBLIC } }, folder: null, scope: `send:${send.id}`, revision: send.revision || 1, view: "send" };
  }

  sends() {
    return this.store.vaultSends().map((send) => this.sendView(send));
  }

  /** One opening of a send: its sealed bytes, which only the link's fragment can open, or null when it is gone. */
  openSend(token, who = null) {
    return this.openSendHash(tokenHash(token), who);
  }

  openSendHash(hash, who = null) {
    const send = this.store.vaultSend(hash);
    if (!send || send.status !== "active" || send.expiresAt < Date.now() || send.opened >= send.views || !send.data) return null;
    const opened = send.opened + 1;
    const spent = opened >= send.views;
    this.store.writeVaultSend(hash, { ...send, opened, lastOpenedAt: Date.now(), ...(spent ? { status: "spent", iv: undefined, data: undefined } : {}) });
    this.log({ type: "secret", text: `aperto il link di ${send.name} (${opened}/${send.views})` });
    this.event("send-opened", { name: send.name, sendId: send.id, opened, views: send.views, who });
    return { name: send.name, iv: send.iv, data: send.data, left: send.views - opened };
  }

  /** The send behind a link on the instance's own /send/s/ path, while it still opens. */
  sendAlive(token) {
    const send = this.store.vaultSend(tokenHash(token));
    return send && send.status === "active" && send.expiresAt > Date.now() && send.opened < send.views ? send : null;
  }
}
