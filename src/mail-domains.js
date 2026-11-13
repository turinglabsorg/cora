import { keyHint } from "./key-hint.js";
import { randomBytes } from "node:crypto";
import { domainToASCII } from "node:url";

export class MailError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function mailDomainName(value) {
  const name = domainToASCII(String(value || "").trim().toLowerCase());
  if (name.length > 253 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(name) || name.split(".").some((part) => part.length > 63) || /^\d+(?:\.\d+){3}$/.test(name)) throw new MailError(400, "Scrivi un dominio, per esempio posta.azienda.it, senza https:// o indirizzi email.");
  return name;
}

export class MailDomains {
  constructor({ store, boxes, endpoint, namespace, token, defaultDomain = "", resendApi = "https://api.resend.com", storeSecret, tokenFor = () => "" }) {
    Object.assign(this, { store, boxes, endpoint, namespace, token, defaultDomain, resendApi, storeSecret, tokenFor });
    this.keys = new Map();
    this.assigning = new Map();
    this.pendingAddresses = new Map();
    this.queue = Promise.resolve();
    this.providerQueue = Promise.resolve();
    this.providerAt = 0;
  }

  get available() { return Boolean(this.token && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(this.namespace)); }
  data() { return this.store.value("mailDomains", { accounts: [], domains: [] }); }
  save(data) { this.store.setValue("mailDomains", data); }
  keyName(id) { return `CORA_MAIL_ACCOUNT_${id.toUpperCase()}`; }
  key(account) {
    const key = this.keys.get(account.id) || this.tokenFor(this.keyName(account.id));
    if (!key) throw new MailError(409, "La chiave di questo account non è disponibile: ricollega l'account Resend.");
    return key;
  }
  requireAvailable() { if (!this.available) throw new MailError(409, "Il servizio email non è configurato per questo spazio."); }
  mutate(fn) {
    const next = this.queue.then(() => { this.requireAvailable(); return fn(this.data()); });
    this.queue = next.catch(() => {});
    return next;
  }
  view() {
    const data = this.data();
    const legacy = this.available && this.defaultDomain && !data.domains.some((domain) => domain.name === this.defaultDomain) ? [{ id: "default", name: this.defaultDomain, accountId: "", accountName: "Cora", legacy: true, ready: true, relayReady: true, records: [] }] : [];
    return { available: this.available, defaultDomain: this.defaultDomain, accounts: data.accounts.map((account) => ({ ...account, keyHint: keyHint(this.keys.get(account.id) || this.tokenFor(this.keyName(account.id))) })), domains: [...legacy, ...data.domains.map((domain) => ({ ...domain, ready: domain.ready && data.accounts.some((account) => account.id === domain.accountId && account.ready), accountName: data.accounts.find((account) => account.id === domain.accountId)?.name || "Resend" }))] };
  }

  async json(url, { token, method = "GET", body } = {}, provider = false) {
    let response;
    try {
      response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    } catch { throw new MailError(502, provider ? "Resend non risponde. Riprova tra poco." : "Il servizio email non risponde. Riprova tra poco."); }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (provider && [401, 403].includes(response.status)) throw new MailError(400, "Resend rifiuta questa chiave: usa una API key con accesso completo all'account.");
      throw new MailError(response.status === 409 ? 409 : 502, provider ? "Resend ha rifiutato l'operazione. Verifica il collegamento dell'account e riprova." : response.status === 409 ? "Questo dominio o account è già gestito da un altro spazio." : "Il servizio email ha rifiutato l'operazione. Riprova tra poco.");
    }
    try { return await response.json(); } catch { throw new MailError(502, "Il servizio email ha restituito una risposta non valida."); }
  }

  resend(account, path, options = {}) {
    const request = this.providerQueue.then(async () => {
      const delay = 550 - (Date.now() - this.providerAt);
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      this.providerAt = Date.now();
      options.beforeRequest?.();
      return this.json(`${this.resendApi}${path}`, { ...options, token: this.key(account) }, true);
    });
    this.providerQueue = request.catch(() => {});
    return request;
  }

  relay(path, body) { return this.json(`${this.endpoint}${path}`, { token: this.token, method: "PUT", body: { ...body, namespace: this.namespace } }); }

  async list(account, path) {
    const items = [];
    let after = "";
    for (let page = 0; page < 20; page++) {
      const data = await this.resend(account, `${path}${after ? `?after=${encodeURIComponent(after)}` : ""}`);
      if (!Array.isArray(data.data)) throw new MailError(502, "Resend ha restituito un elenco non valido.");
      items.push(...data.data);
      if (!data.has_more) return items;
      after = data.data.at(-1)?.id;
      if (!after) break;
    }
    throw new MailError(502, "L'elenco Resend è incompleto. Riprova tra poco.");
  }

  async ensureAccount(account, data) {
    const endpoint = `${this.endpoint}/v1/inbound/accounts/${account.id}`;
    const hooks = await this.list(account, "/webhooks");
    let hook = hooks.find((item) => item.endpoint === endpoint);
    if (hook) {
      hook = await this.resend(account, `/webhooks/${encodeURIComponent(hook.id)}`);
      if (!hook.events?.includes("email.received") || hook.status === "disabled") await this.resend(account, `/webhooks/${encodeURIComponent(hook.id)}`, { method: "PATCH", body: { events: [...new Set([...(hook.events || []), "email.received"])], status: "enabled" } });
    } else hook = await this.resend(account, "/webhooks", { method: "POST", body: { endpoint, events: ["email.received"] } });
    if (!/^whsec_/.test(hook.signing_secret || "")) throw new MailError(502, "Resend non ha restituito la firma del collegamento email.");
    await this.relay(`/v1/domains/accounts/${account.id}`, { api_key: this.key(account), webhook_secret: hook.signing_secret });
    account.webhookId = hook.id;
    account.ready = true;
    account.error = "";
    account.checkedAt = Date.now();
    this.save(data);
  }

  connect({ id = "", name, key }) {
    return this.mutate(async (data) => {
      name = String(name || "").trim().slice(0, 80);
      key = String(key || "").trim();
      if (!name) throw new MailError(400, "Dai un nome all'account Resend.");
      if (!/^re_[A-Za-z0-9_-]{8,1020}$/.test(key)) throw new MailError(400, "La chiave API di Resend comincia con re_.");
      if (id && !data.accounts.some((account) => account.id === id)) throw new MailError(404, "Account Resend non trovato.");
      const account = data.accounts.find((account) => account.id === id) || { id: `ma_${randomBytes(8).toString("hex")}`, name, ready: false };
      const previousKey = this.keys.get(account.id);
      this.keys.set(account.id, key);
      try {
        const domains = await this.list(account, "/domains");
        if (id && data.domains.some((domain) => domain.accountId === id && !domains.some((item) => item.id === domain.resendId && item.name === domain.name))) throw new MailError(409, "Questa chiave non gestisce i domini già collegati. Collega l'altro account Resend separatamente.");
      }
      catch (error) { if (previousKey) this.keys.set(account.id, previousKey); else this.keys.delete(account.id); throw error; }
      try { await this.storeSecret(this.keyName(account.id), key); }
      catch { if (previousKey) this.keys.set(account.id, previousKey); else this.keys.delete(account.id); throw new MailError(502, "Non è stato possibile salvare la chiave. Riprova."); }
      account.name = name;
      account.ready = false;
      if (!id) data.accounts.push(account);
      this.save(data);
      try { await this.ensureAccount(account, data); }
      catch (error) { account.error = error.message; this.save(data); }
      return account;
    });
  }

  checkAccount(id) {
    return this.mutate(async (data) => {
      const account = data.accounts.find((item) => item.id === id);
      if (!account) throw new MailError(404, "Account Resend non trovato.");
      try { await this.ensureAccount(account, data); }
      catch (error) { account.ready = false; account.error = error.message; this.save(data); }
      return account;
    });
  }

  domainMode(mode = "send-receive") {
    if (!["send-receive", "send-only"].includes(mode)) throw new MailError(400, "Scegli Solo invio oppure Invio e ricezione.");
    return mode;
  }

  addressInUse(agent, email) {
    email = email.toLowerCase();
    const pending = this.pendingAddresses.get(email);
    if (pending && pending.agentId !== agent.id) return true;
    const domains = this.data().domains;
    return this.store.agents().some((other) => {
      if (other.id === agent.id) return false;
      const mailbox = this.store.value(`agentMailbox:${other.id}`, null);
      const sender = this.store.value(`emailRules:${other.id}`, {}).resendSender;
      const domain = domains.find((item) => item.id === sender?.domainId);
      const outgoing = domain ? `${sender.local}@${domain.name}` : "";
      return [mailbox?.email, ...(mailbox?.previousEmails || []), outgoing].some((address) => address?.toLowerCase() === email);
    });
  }

  requireUnused(domain, { remove = false } = {}) {
    if (domain.name === this.defaultDomain) throw new MailError(409, "Il dominio predefinito di Cora deve restare disponibile per invio e ricezione.");
    if (this.assigning.get(domain.name)) throw new MailError(409, "Un indirizzo su questo dominio è in attivazione. Riprova al termine.");
    const used = this.store.agents().some((agent) => {
      if (remove && this.store.value(`emailRules:${agent.id}`, {}).resendSender?.domainId === domain.id) return true;
      const mailbox = this.store.value(`agentMailbox:${agent.id}`, null);
      return [mailbox?.email, ...(mailbox?.previousEmails || [])].some((email) => email?.toLowerCase().endsWith(`@${domain.name}`));
    });
    if (used) throw new MailError(409, "Questo dominio è usato da un indirizzo attuale, precedente o di invio di un agente. Rimuovi prima il mittente di invio; le caselle attuali e precedenti restano protette.");
  }

  removeDomain(id) {
    return this.mutate((data) => {
      const domain = data.domains.find((item) => item.id === id);
      if (!domain) throw new MailError(404, "Dominio non trovato.");
      this.requireUnused(domain, { remove: true });
      data.domains = data.domains.filter((item) => item.id !== id);
      this.save(data);
      return { removed: true };
    });
  }

  updateDomain(id, { mode }) {
    return this.mutate(async (data) => {
      mode = this.domainMode(mode);
      const domain = data.domains.find((item) => item.id === id);
      if (!domain) throw new MailError(404, "Dominio non trovato.");
      if (mode === "send-only") this.requireUnused(domain);
      const account = data.accounts.find((item) => item.id === domain.accountId);
      if (!account?.ready) throw new MailError(409, "Verifica prima il collegamento dell'account Resend.");
      await this.resend(account, `/domains/${encodeURIComponent(domain.resendId)}`, { method: "PATCH", body: { capabilities: { sending: "enabled", receiving: mode === "send-only" ? "disabled" : "enabled" } } });
      domain.mode = mode;
      domain.ready = domain.relayReady = false;
      this.save(data);
      try { return await this.refresh(domain, account, data); }
      catch (error) { domain.error = error.message; this.save(data); return domain; }
    });
  }

  addDomain({ name, accountId, mode = "send-receive" }) {
    return this.mutate(async (data) => {
      name = mailDomainName(name);
      mode = this.domainMode(mode);
      if (name === this.defaultDomain || data.domains.some((domain) => domain.name === name)) throw new MailError(409, "Questo dominio è già presente.");
      const account = data.accounts.find((item) => item.id === accountId);
      if (!account?.ready) throw new MailError(409, "Verifica prima il collegamento dell'account Resend.");
      const existing = (await this.list(account, "/domains")).find((domain) => domain.name === name);
      const created = existing || await this.resend(account, "/domains", { method: "POST", body: { name, capabilities: { sending: "enabled", receiving: mode === "send-only" ? "disabled" : "enabled" } } });
      if (!created.id) throw new MailError(502, "Resend non ha restituito il dominio creato.");
      const domain = { id: `md_${randomBytes(8).toString("hex")}`, name, accountId, mode, resendId: created.id, ready: false, relayReady: false, records: [] };
      data.domains.push(domain);
      this.save(data);
      try {
        await this.resend(account, `/domains/${encodeURIComponent(domain.resendId)}`, { method: "PATCH", body: { capabilities: { sending: "enabled", receiving: mode === "send-only" ? "disabled" : "enabled" } } });
        await this.refresh(domain, account, data);
      } catch (error) { domain.error = error.message; this.save(data); }
      return domain;
    });
  }

  sendingReady(domain) {
    const sending = (domain.records || []).filter((record) => ["DKIM", "SPF"].includes(record.record));
    return domain.capabilities?.sending === "enabled" && sending.some((record) => record.record === "DKIM") && sending.some((record) => record.record === "SPF") && sending.every((record) => record.status === "verified");
  }

  senderDomains() {
    const data = this.data();
    return data.domains.filter((domain) => this.sendingReady(domain) && data.accounts.some((account) => account.id === domain.accountId && account.ready)).map(({ id, name }) => ({ id, name }));
  }

  sender(agent, config = this.store.value(`emailRules:${agent.id}`, {}).resendSender) {
    const domain = this.data().domains.find((item) => item.id === config?.domainId);
    const local = String(config?.local || "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(local) || !domain || !this.senderDomains().some((item) => item.id === domain.id)) throw new MailError(409, "Scegli un dominio con invio verificato e un nome da 3 a 32 lettere, numeri o trattini.");
    const email = `${local}@${domain.name}`;
    if (this.addressInUse(agent, email)) throw new MailError(409, "Questo indirizzo appartiene già a un altro agente.");
    return { id: "resend", provider: "resend", email, domainId: domain.id, local };
  }

  send(agent, message, expectedFrom) {
    return this.mutate(async (data) => {
      const identity = this.sender(agent);
      const domain = data.domains.find((item) => item.id === identity.domainId);
      const account = data.accounts.find((item) => item.id === domain.accountId);
      try { await this.refresh(domain, account, data); }
      catch (error) { domain.ready = false; domain.error = error.message; this.save(data); throw error; }
      if (!this.sendingReady(domain) || this.sender(agent).email !== expectedFrom) throw new MailError(409, "Il mittente o la verifica del dominio sono cambiati. Invio annullato.");
      const recipients = (value) => Array.isArray(value) && value.length <= 30 && value.every((email) => /^[^\s<>@]+@[^\s<>@]+\.[a-z]{2,}$/i.test(email));
      if (!recipients(message.to) || !message.to.length || [message.cc, message.bcc].some((items) => items !== undefined && !recipients(items))) throw new MailError(400, "Destinatari email non validi.");
      const current = this.store.agent(agent.id);
      if (!current?.enabled || !current.tools) throw new MailError(403, "L'autorizzazione email è cambiata. Invio annullato.");
      const mailbox = this.store.value(`agentMailbox:${agent.id}`, null);
      const replyTo = mailbox?.status === "ready" ? mailbox.email : "";
      const result = await this.resend(account, "/emails", { method: "POST", beforeRequest: () => {
        const latest = this.store.agent(agent.id);
        if (!latest?.enabled || !latest.tools || this.sender(agent).email !== expectedFrom) throw new MailError(409, "Il mittente o la verifica del dominio sono cambiati. Invio annullato.");
      }, body: { from: identity.email, to: message.to, subject: message.subject, text: message.body_text, html: message.body_html, ...(replyTo ? { reply_to: replyTo } : {}), ...(message.cc?.length ? { cc: message.cc } : {}), ...(message.bcc?.length ? { bcc: message.bcc } : {}) } });
      if (!result.id) throw new MailError(502, "Resend non ha confermato l'invio.");
      return { message_id: result.id, provider: "resend", email: identity.email };
    });
  }

  async refresh(domain, account, data, verify = false) {
    if (verify) await this.resend(account, `/domains/${encodeURIComponent(domain.resendId)}/verify`, { method: "POST" });
    const checked = await this.resend(account, `/domains/${encodeURIComponent(domain.resendId)}`);
    if (checked.name !== domain.name) throw new MailError(502, "Il dominio restituito da Resend non corrisponde.");
    domain.status = checked.status;
    domain.capabilities = checked.capabilities || {};
    domain.records = Array.isArray(checked.records) ? checked.records.map(({ record, name, type, value, status, priority, ttl }) => ({ record, name, type, value, status, priority, ttl })) : [];
    domain.checkedAt = Date.now();
    domain.ready = false;
    domain.relayReady = false;
    domain.error = "";
    this.save(data);
    if (domain.mode === "send-only") {
      domain.ready = this.sendingReady(domain) && domain.capabilities.receiving === "disabled";
      this.save(data);
      return domain;
    }
    const route = await this.relay(`/v1/domains/routes/${encodeURIComponent(domain.name)}`, { account_id: account.id, resend_id: domain.resendId });
    domain.relayReady = true;
    domain.ready = route.ready === true;
    this.save(data);
    return domain;
  }

  checkDomain(id, { verify = false } = {}) {
    return this.mutate(async (data) => {
      const domain = data.domains.find((item) => item.id === id);
      if (!domain) throw new MailError(404, "Dominio non trovato.");
      const account = data.accounts.find((item) => item.id === domain.accountId);
      if (!account?.ready) throw new MailError(409, "Verifica prima il collegamento dell'account Resend.");
      try { return await this.refresh(domain, account, data, verify); }
      catch (error) { domain.ready = false; domain.error = error.message; this.save(data); return domain; }
    });
  }

  async assign(agent, { local, domain }) {
    this.requireAvailable();
    local = String(local || "").trim().toLowerCase();
    domain = mailDomainName(domain);
    if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(local)) throw new MailError(400, "Usa da 3 a 32 lettere minuscole, numeri o trattini, iniziando e finendo con una lettera o un numero.");
    if (!agent.enabled || !agent.tools) throw new MailError(409, "Accendi l'agente e il suo computer prima di assegnargli un'email.");
    const email = `${local}@${domain}`;
    if (this.addressInUse(agent, email)) throw new MailError(409, "Questo indirizzo appartiene già a un altro agente.");
    const reservation = this.pendingAddresses.get(email) || { agentId: agent.id, count: 0 };
    reservation.count++;
    this.pendingAddresses.set(email, reservation);
    this.assigning.set(domain, (this.assigning.get(domain) || 0) + 1);
    try {
      const managed = this.data().domains.find((item) => item.name === domain);
      const checked = managed ? await this.checkDomain(managed.id) : null;
      if (checked ? checked.mode === "send-only" || !checked.ready : domain !== this.defaultDomain) throw new MailError(409, "Scegli un dominio verificato per invio e ricezione.");
      if (this.addressInUse(agent, email)) throw new MailError(409, "Questo indirizzo appartiene già a un altro agente.");
      try { return await this.boxes.assignMailbox(agent, { local, domain }); }
      catch (error) { throw new MailError(/HTTP 409/.test(error.message) ? 409 : 502, /HTTP 409/.test(error.message) ? "Questo indirizzo è già in uso. Scegline un altro." : "Non è stato possibile attivare il nuovo indirizzo. La casella precedente resta attiva."); }
    } finally {
      if (--reservation.count === 0) this.pendingAddresses.delete(email);
      const remaining = this.assigning.get(domain) - 1;
      if (remaining) this.assigning.set(domain, remaining); else this.assigning.delete(domain);
    }
  }
}
