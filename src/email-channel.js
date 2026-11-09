import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { transportOf } from "./channels.js";

const FOLDERS = ["inbox", "important", "transactional", "notification", "spam", "sent"];
const MODES = ["manual", "notify", "auto"];
const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 24);
const defaults = { enabled: false, mode: "notify", reportChannelId: "", senders: [], folders: ["inbox", "important"], replyMode: "draft", instructions: "", track: true };
const addressOf = (text) => String(text || "").match(/<([^<>\s]+@[^<>\s]+)>/)?.[1]?.toLowerCase() || String(text || "").trim().toLowerCase();
const matches = (rules, from) => !rules.length || rules.some((rule) => rule.startsWith("@") ? from.endsWith(rule) : from === rule);
const files = Object.fromEntries(["milo_compose.py", "milo_signature.py", "signature_assets/Geist-Regular.ttf", "signature_assets/Geist-SemiBold.ttf", "signature_assets/OFL.txt"].map((name) => [name, readFileSync(new URL(`./mail/${name}`, import.meta.url)).toString("base64")]));

export class EmailError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export class EmailChannel {
  constructor({ store, boxes, channels, orchestrator, instanceUrl = "", key, log = () => {}, googleConnector = null }) {
    Object.assign(this, { store, boxes, channels, orchestrator, instanceUrl, key, log, googleConnector });
    this.jobs = new Map();
    this.processing = new Map();
    this.hooks = new Map();
    this.renderers = new Map();
    this.stopped = false;
    store.db.exec(`CREATE TABLE IF NOT EXISTS agent_mail (
      agent_id TEXT NOT NULL, mailbox TEXT NOT NULL, id TEXT NOT NULL, direction TEXT NOT NULL,
      at TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL, channel_id TEXT NOT NULL DEFAULT '',
      token TEXT UNIQUE, tracked INTEGER NOT NULL DEFAULT 0, opened TEXT, opens INTEGER NOT NULL DEFAULT 0,
      signature BLOB, delivery_id TEXT NOT NULL DEFAULT '', PRIMARY KEY(agent_id, mailbox, id));
      CREATE INDEX IF NOT EXISTS agent_mail_recent ON agent_mail(agent_id, at DESC, id);
      CREATE INDEX IF NOT EXISTS agent_mail_pending ON agent_mail(status, agent_id);
      CREATE UNIQUE INDEX IF NOT EXISTS agent_mail_delivery ON agent_mail(agent_id,mailbox,delivery_id) WHERE delivery_id!='';`);
    store.db.prepare("UPDATE agent_mail SET status='interrupted' WHERE status IN ('working','notifying','sending')").run();
  }

  get settings() { return { ...defaults, ...this.store.value("emailChannel", {}) }; }
  overrides(agent) { return this.store.value(`emailRules:${agent.id}`, {}); }
  effective(agent) {
    const global = this.settings, own = this.overrides(agent);
    return { ...global, ...own, enabled: global.enabled, mode: own.mode && own.mode !== "inherit" ? own.mode : global.mode,
      replyMode: own.replyMode && own.replyMode !== "inherit" ? own.replyMode : global.replyMode,
      reportChannelId: own.reportChannelId || global.reportChannelId,
      senders: global.senders, agentSenders: own.senders || [], folders: global.folders,
      instructions: [global.instructions, own.instructions].filter(Boolean).join("\n\n"), track: own.track ?? global.track,
      signature: own.signature ?? "", enabledAt: Math.max(Date.parse(global.enabledAt) || 0, Date.parse(own.enabledAt) || 0) };
  }
  clean(input, agent = null) {
    const out = {};
    if (typeof input !== "object" || !input || Array.isArray(input)) throw new EmailError("Regole email non valide.");
    if (input.enabled !== undefined && !agent) out.enabled = input.enabled === true;
    if (input.mode !== undefined) {
      if (![...MODES, ...(agent ? ["inherit"] : [])].includes(input.mode)) throw new EmailError("Modalità email non valida.");
      out.mode = input.mode;
    }
    if (input.replyMode !== undefined) {
      if (!["draft", "auto", ...(agent ? ["inherit"] : [])].includes(input.replyMode)) throw new EmailError("Modalità di risposta non valida.");
      out.replyMode = input.replyMode;
    }
    if (input.senderId !== undefined && agent) out.senderId = String(input.senderId);
    if (input.reportChannelId !== undefined) out.reportChannelId = String(input.reportChannelId).trim().slice(0, 120);
    if (input.instructions !== undefined) out.instructions = String(input.instructions).trim().slice(0, 8000);
    if (input.signature !== undefined && agent) out.signature = String(input.signature).trim().slice(0, 1500);
    if (input.track !== undefined) out.track = agent && input.track === null ? null : input.track === true;
    if (input.senders !== undefined) {
      const list = Array.isArray(input.senders) ? input.senders : String(input.senders).split(/[\s,;]+/);
      out.senders = [...new Set(list.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
      if (out.senders.length > 100 || out.senders.some((item) => !/^([^\s@<>]+)?@[a-z0-9.-]+\.[a-z]{2,}$/.test(item))) throw new EmailError("Inserisci indirizzi o domini validi, ad esempio @azienda.it.");
    }
    if (!agent && input.folders !== undefined) {
      if (!Array.isArray(input.folders) || !input.folders.length || input.folders.some((folder) => !FOLDERS.includes(folder) || ["spam", "sent"].includes(folder))) throw new EmailError("Cartelle email non valide.");
      out.folders = [...new Set(input.folders)];
    }
    return out;
  }
  async update(input, agent = null) {
    const patch = this.clean(input, agent);
    if (patch.senderId) this.googleConnector.identity(agent, patch.senderId);
    if (patch.reportChannelId) await this.checkChannel(patch.reportChannelId, agent);
    const previous = agent ? this.overrides(agent) : this.settings;
    if ((!agent && patch.enabled && !previous.enabled) || (patch.mode && patch.mode !== "manual" && patch.mode !== previous.mode)) patch.enabledAt = new Date().toISOString();
    this.store.setValue(agent ? `emailRules:${agent.id}` : "emailChannel", { ...previous, ...patch });
    this.log({ type: "settings", ...(agent ? { agentId: agent.id } : {}), text: "regole del canale E-mail aggiornate" });
    return agent ? this.view(agent) : this.view();
  }
  async checkChannel(id, agent = null) {
    const listed = agent ? this.channels.listFor(agent) : this.channels.list();
    const channel = listed.find((item) => item.id === id);
    if (!channel) throw new EmailError("Scegli un canale accessibile all'agente.");
    if (agent && transportOf(id) === "discord" && this.orchestrator.bots && !await this.orchestrator.bots.canRead(agent, id)) throw new EmailError("L'agente non può accedere a questo canale.", 403);
    return channel;
  }
  destination(agent) {
    const policy = this.effective(agent), allowed = this.channels.listFor(agent);
    if (policy.reportChannelId) return allowed.find((item) => item.id === policy.reportChannelId) || null;
    const general = allowed.filter((item) => item.name?.toLowerCase() === "general" && item.kind === this.channels.active);
    return general.length === 1 ? general[0] : null;
  }
  summary(agent) {
    return this.store.db.prepare("SELECT direction, COUNT(*) AS count FROM agent_mail WHERE agent_id=? AND direction IN ('received','sent','draft') GROUP BY direction").all(agent.id).reduce((out, row) => ({ ...out, [row.direction]: row.count }), { received: 0, sent: 0, draft: 0 });
  }
  recent(agent, direction = "") {
    const filter = ["received", "sent", "draft"].includes(direction) ? direction : "";
    return this.store.db.prepare("SELECT * FROM agent_mail WHERE agent_id=? AND (?='' OR direction=?) ORDER BY at DESC,id DESC LIMIT 30").all(agent.id, filter, filter).map(({ data, signature, token, tracked, opened, opens, status, channel_id, direction, at }) => ({ ...JSON.parse(data), direction, at, tracked: Boolean(tracked), opened, opens, status, channelId: channel_id }));
  }
  view(agent = null) {
    if (!agent) return { settings: this.settings, channels: this.channels.list(), agents: this.store.agents().map((item) => ({ id: item.id, name: item.name, ...this.summary(item), status: this.store.value(`emailStatus:${item.id}`, null) })) };
    return { senders: this.googleConnector?.forAgent(agent) || [], overrides: this.overrides(agent), effective: this.effective(agent), destination: this.destination(agent), channels: this.channels.listFor(agent), summary: this.summary(agent), recent: this.recent(agent), status: this.store.value(`emailStatus:${agent.id}`, null) };
  }
  mailboxes(agent) {
    const mailbox = this.store.value(`agentMailbox:${agent.id}`, null);
    return mailbox?.status === "ready" ? [...new Set([mailbox.email, ...(mailbox.previousEmails || [])])] : [];
  }
  signatureKey(agent, mailbox) { return createHmac("sha256", this.key).update(`cora.email.${agent.id}.${mailbox}`).digest("hex"); }
  async webhook(agent, mailbox) {
    const enabled = this.settings.enabled && this.effective(agent).mode !== "manual";
    const url = enabled && this.instanceUrl ? `${this.instanceUrl}/mail/events/${agent.id}/${hash(mailbox)}` : "";
    const version = `${mailbox}:${url}`;
    if (this.hooks.get(`${agent.id}:${mailbox}`) === version) return;
    await this.boxes.mailCommand(agent, { action: "webhook", mailbox, url, secret: url ? this.signatureKey(agent, mailbox) : "" });
    this.hooks.set(`${agent.id}:${mailbox}`, version);
  }
  async acceptEvent(agentId, mailboxHash, body, signature) {
    const agent = this.store.agent(agentId), mailbox = agent && this.mailboxes(agent).find((email) => hash(email) === mailboxHash);
    if (!mailbox || !agent.enabled || !agent.tools) throw new EmailError("Not found", 404);
    let event;
    try { event = JSON.parse(body); } catch { throw new EmailError("Invalid event"); }
    if (event.type === "ping" && Object.keys(event).length === 1) return;
    const expected = `sha256=${createHmac("sha256", this.signatureKey(agent, mailbox)).update(body).digest("hex")}`;
    const actual = Buffer.from(String(signature || ""));
    if (actual.length !== expected.length || !timingSafeEqual(actual, Buffer.from(expected))) throw new EmailError("Invalid signature", 401);
    if (event.type !== "email.received" || !/^msg_[a-zA-Z0-9_-]{1,100}$/.test(event.email_id || "")) throw new EmailError("Invalid email event");
    this.poll(agent).catch(() => {});
  }
  eligible(agent, email) {
    const policy = this.effective(agent), from = addressOf(email.from);
    const current = this.store.agent(agent.id);
    return current?.enabled && current.tools && policy.enabled && policy.mode !== "manual" && policy.folders.includes(email.folder)
      && Date.parse(email.receivedAt) >= policy.enabledAt && matches(policy.senders, from) && matches(policy.agentSenders, from)
      && !this.mailboxes(agent).includes(from) && !/^(?:mailer-daemon|postmaster|no[-_.]?reply|notifications?)(?:[+._-].*)?@/i.test(from)
      && !["auto-replied", "auto-generated"].includes(String(email.autoSubmitted).toLowerCase());
  }
  ingest(agent, email) {
    const direction = email.folder === "sent" ? "sent" : "received";
    const status = direction === "sent" ? "sent" : this.eligible(agent, email) ? "pending" : "ignored";
    this.store.db.prepare("INSERT OR IGNORE INTO agent_mail(agent_id,mailbox,id,direction,at,data,status,delivery_id) VALUES(?,?,?,?,?,?,?,?)").run(agent.id, email.mailbox, email.id, direction, email.receivedAt, JSON.stringify(email), status, email.deliveryId || "");
  }
  poll(agent) {
    if (this.stopped || !agent.enabled || !agent.tools || !this.mailboxes(agent).length) return Promise.resolve();
    if (!this.jobs.has(agent.id)) {
      const job = this.pollNow(agent).finally(() => { if (this.jobs.get(agent.id) === job) this.jobs.delete(agent.id); });
      this.jobs.set(agent.id, job);
    }
    return this.jobs.get(agent.id);
  }
  async pollNow(agent) {
    try {
      let hookReady = true, partial = false;
      for (const mailbox of this.mailboxes(agent)) {
        try { await this.webhook(agent, mailbox); } catch { hookReady = false; }
        for (const folder of FOLDERS) {
          if (this.stopped) return;
          const key = `emailCursor:${agent.id}:${hash(mailbox)}:${folder}`;
          const cursor = this.store.value(key, null) || { since: new Date(Date.now() - 7 * 86400000).toISOString() };
          const until = cursor.until || new Date().toISOString();
          let next = cursor.cursor || "", more = false;
          for (let page = 0; page < 5; page++) {
            const result = await this.boxes.mailCommand(agent, { action: "poll", mailbox, folder, since: cursor.since, cursor: next });
            for (const email of result.emails) this.ingest(agent, email);
            more = result.hasMore;
            next = result.cursor;
            if (!more) break;
            if (!next) { partial = true; break; }
          }
          this.store.setValue(key, more ? { since: cursor.since, ...(next ? { cursor: next, until } : {}) } : { since: new Date(Date.parse(until) - 60000).toISOString() });
        }
      }
      this.store.setValue(`emailStatus:${agent.id}`, { state: "ready", checkedAt: new Date().toISOString(), push: hookReady && Boolean(this.instanceUrl), partial });
      this.processQueue(agent);
    } catch (error) {
      this.store.setValue(`emailStatus:${agent.id}`, { state: "error", error: "Non riesco ad aggiornare la posta. Riproverò automaticamente.", checkedAt: this.store.value(`emailStatus:${agent.id}`, {})?.checkedAt || null });
    }
  }
  processQueue(agent) {
    if (this.stopped || this.processing.has(agent.id)) return;
    const job = this.drain(agent).catch(() => {}).finally(() => this.processing.delete(agent.id));
    this.processing.set(agent.id, job);
  }
  async drain(agent) {
    for (const row of this.store.db.prepare("SELECT * FROM agent_mail WHERE agent_id=? AND status='pending' ORDER BY at,id LIMIT 10").all(agent.id)) {
      if (this.stopped) return;
      const email = JSON.parse(row.data), policy = this.effective(agent);
      if (!this.eligible(agent, email)) { this.status(agent, email, "ignored"); continue; }
      const channel = this.destination(agent);
      if (!channel) { this.store.setValue(`emailStatus:${agent.id}`, { state: "destination", error: "Scegli il canale dei resoconti email." }); return; }
      try {
        await this.checkChannel(channel.id, agent);
        if (policy.mode === "notify") {
          const text = this.store.settings.language === "en" ? `New email from ${email.from}\n${email.subject}` : `Nuova email da ${email.from}\n${email.subject}`;
          this.status(agent, email, "notifying", channel.id);
          await this.orchestrator.postDirect(agent, this.orchestrator.state(channel.id), channel.id, text, { passive: true });
          this.status(agent, email, "notified", channel.id);
        } else {
          const result = await this.orchestrator.runEmail(agent, email, channel);
          if (result === "busy") return;
        }
      } catch { this.store.setValue(`emailStatus:${agent.id}`, { state: "destination", error: "Non riesco a scrivere nel canale scelto. Controlla l'accesso dell'agente." }); return; }
    }
  }
  status(agent, email, status, channelId = "") {
    this.store.db.prepare("UPDATE agent_mail SET status=?,channel_id=? WHERE agent_id=? AND mailbox=? AND id=?").run(status, channelId, agent.id, email.mailbox, email.id);
  }
  async read(agent, id) {
    const row = this.store.db.prepare("SELECT data,mailbox,direction FROM agent_mail WHERE agent_id=? AND id=?").get(agent.id, id);
    if (!row) throw new EmailError("Email non trovata.", 404);
    return this.boxes.mailCommand(agent, { action: row.direction === "draft" ? "readDraft" : "read", mailbox: row.mailbox, id });
  }
  async draft(agent, message, { invocation } = {}) {
    const mailbox = this.mailboxes(agent)[0];
    if (!mailbox) throw new EmailError("Email non disponibile.");
    const result = await this.boxes.mailCommand(agent, { action: "draft", mailbox, message });
    const email = { id: result.id, mailbox, from: mailbox, to: message.to, subject: message.subject, receivedAt: new Date().toISOString(), sourceId: invocation?.id || "" };
    this.store.db.prepare("INSERT INTO agent_mail(agent_id,mailbox,id,direction,at,data,status) VALUES(?,?,?,?,?,?,?)").run(agent.id, mailbox, email.id, "draft", email.receivedAt, JSON.stringify(email), "draft");
    return email;
  }
  async compose(agent, message, token, track, from = "") {
    const mailbox = this.mailboxes(agent)[0], own = this.overrides(agent);
    if (!from && own.senderId) from = this.googleConnector.identity(agent, own.senderId).email;
    const compose = { text: message.body_text || "", html: message.body_html || "", signature: own.signature || `${agent.name}\n${from || mailbox}`,
      email: from || mailbox, avatar: this.store.avatar(agent.id).toString("base64"), track,
      image_url: `${this.instanceUrl}/mail/media/${token}.png`, pixel_url: `${this.instanceUrl}/mail/media/${token}.gif` };
    if (!this.renderers.has(agent.id)) {
      const job = this.boxes.ensureMailRenderer(agent).catch((error) => { this.renderers.delete(agent.id); throw error; });
      this.renderers.set(agent.id, job);
    }
    await this.renderers.get(agent.id);
    return this.boxes.mailCommand(agent, { action: "compose", mailbox, compose, files });
  }
  async send(agent, message, { requester, invocation } = {}) {
    const policy = this.effective(agent), senderId = message.sender_id || policy.senderId || "";
    const external = senderId ? this.googleConnector.identity(agent, senderId) : null;
    const mailbox = external?.email || this.mailboxes(agent)[0];
    if (!mailbox) throw new EmailError("Email non disponibile.");
    if (!["owner", "authorized"].includes(requester?.kind) && !(invocation && policy.enabled && policy.mode === "auto" && policy.replyMode === "auto" && this.eligible(agent, invocation))) throw new EmailError("L'invio richiede la richiesta di un utente autorizzato.", 403);
    if (!Array.isArray(message.to) || !message.to.length || message.to.length > 30 || message.to.some((email) => !/^[^\s<>@]+@[^\s<>@]+\.[a-z]{2,}$/i.test(email)) || !String(message.subject || "").trim() || !String(message.body_text || message.body_html || "").trim()) throw new EmailError("Destinatario, oggetto e messaggio sono obbligatori.");
    if (!requester && (message.to.length !== 1 || addressOf(message.to[0]) !== addressOf(invocation.from) || message.cc?.length || message.bcc?.length)) throw new EmailError("La risposta automatica può essere inviata solo al mittente.", 403);
    if (!this.instanceUrl) throw new EmailError("L'indirizzo pubblico dello spazio non è ancora pronto.");
    const sourceId = invocation ? `${invocation.mailbox}/${invocation.id}` : "";
    if (sourceId) {
      const previous = this.store.db.prepare("SELECT id,status FROM agent_mail WHERE agent_id=? AND direction='sent' AND json_extract(data,'$.sourceId')=? LIMIT 1").get(agent.id, sourceId);
      if (previous) {
        if (previous.status === "sent") return { id: previous.id, status: "already_sent" };
        throw new EmailError("Un invio precedente è da verificare. Non lo ripeto automaticamente.", 409);
      }
    }
    const token = randomBytes(18).toString("base64url"), track = message.track ?? policy.track;
    const prepared = await this.compose(agent, message, token, track, mailbox);
    const current = this.store.agent(agent.id), latest = this.effective(agent);
    if (!current?.enabled || !current.tools || !requester && (!latest.enabled || latest.mode !== "auto" || latest.replyMode !== "auto" || !this.eligible(current, invocation))) throw new EmailError("L'autorizzazione email è cambiata. Invio annullato.", 403);
    const at = new Date().toISOString(), id = `sending_${token}`;
    const data = { id, mailbox, from: mailbox, to: message.to, subject: message.subject, receivedAt: at, sourceId, senderId };
    this.store.db.prepare("INSERT INTO agent_mail(agent_id,mailbox,id,direction,at,data,status,token,tracked,signature) VALUES(?,?,?,?,?,?,?,?,?,?)").run(agent.id, mailbox, id, "sent", at, JSON.stringify(data), "sending", token, Number(track), Buffer.from(prepared.png, "base64"));
    try {
      const outgoing = { ...message, body_text: prepared.text, body_html: prepared.html, ...(invocation ? { in_reply_to: invocation.messageId, references: invocation.references, auto_submitted: "auto-replied" } : {}) };
      const result = external ? await this.googleConnector.send(agent, senderId, outgoing) : await this.boxes.mailCommand(agent, { action: "send", mailbox, message: outgoing });
      data.id = result.message_id;
      this.store.db.prepare("UPDATE agent_mail SET id=?,data=?,status='sent' WHERE agent_id=? AND mailbox=? AND id=?").run(data.id, JSON.stringify(data), agent.id, mailbox, id);
      return { id: data.id, status: "sent", tracked: track };
    } catch (error) {
      this.store.db.prepare("UPDATE agent_mail SET status='uncertain' WHERE agent_id=? AND mailbox=? AND id=?").run(agent.id, mailbox, id);
      throw new EmailError("Invio non confermato. Controlla la posta inviata prima di riprovare.", 502);
    }
  }
  media(token, { preview = false, png = true, head = false } = {}) {
    const row = this.store.db.prepare("SELECT signature,tracked FROM agent_mail WHERE token=?").get(token);
    if (!row) return null;
    if (!preview && !head && row.tracked) this.store.db.prepare("UPDATE agent_mail SET opened=COALESCE(opened,?),opens=opens+1 WHERE token=?").run(new Date().toISOString(), token);
    return png ? Buffer.from(row.signature) : Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");
  }
  start() {
    const tick = () => {
      if (!this.settings.enabled) return;
      for (const agent of this.store.agents()) {
        this.processQueue(agent);
        const status = this.store.value(`emailStatus:${agent.id}`, null);
        if (this.effective(agent).mode === "manual" || status?.push && Date.now() - Date.parse(status.checkedAt) < 300000) continue;
        this.poll(agent).catch(() => {});
      }
    };
    this.timer = setInterval(tick, 60000);
    this.initial = setTimeout(tick, 1500);
  }
  async stop() { this.stopped = true; clearInterval(this.timer); clearTimeout(this.initial); await Promise.allSettled([...this.jobs.values()]); await Promise.allSettled([...this.processing.values()]); }
}
