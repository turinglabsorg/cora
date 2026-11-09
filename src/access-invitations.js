import { createHash, randomBytes } from "node:crypto";
import { ValidationError } from "./store.js";

const KEY = "accessInvitations";
const digest = (value) => createHash("sha256").update(value).digest("hex");

export class AccessInvitations {
  constructor({ store, cloud, space }) {
    Object.assign(this, { store, cloud, space });
    this.active = new Map();
    this.closed = false;
    const records = this.store.value(KEY) || {};
    for (const record of Object.values(records)) {
      if (record.status === "sending") Object.assign(record, { status: "uncertain", nonceHash: "", expiresAt: 0 });
    }
    this.store.setValue(KEY, records);
  }

  view() {
    const records = this.store.value(KEY) || {};
    const blocked = new Set(this.store.panelUsers().filter((user) => user.blocked).map((user) => user.email));
    return this.store.accessPolicy().emails.map((email) => {
      const record = records[email] || {};
      return { email, status: blocked.has(email) ? "blocked" : record.status || "not_sent", attemptedAt: record.attemptedAt || null, sentAt: record.sentAt || null };
    });
  }

  prune() {
    const allowed = new Set(this.store.accessPolicy().emails);
    const records = this.store.value(KEY) || {};
    for (const email of Object.keys(records)) if (!allowed.has(email)) {
      delete records[email];
      this.active.get(email)?.controller.abort();
    }
    this.store.setValue(KEY, records);
  }

  claim(nonce) {
    if (this.closed || !/^[A-Za-z0-9_-]{43}$/.test(String(nonce || ""))) return null;
    const hash = digest(nonce), records = this.store.value(KEY) || {};
    const entry = Object.entries(records).find(([, record]) => record.status === "sending" && record.nonceHash === hash && record.expiresAt > Date.now());
    if (!entry) return null;
    const [email, record] = entry;
    if (!this.store.accessPolicy().emails.includes(email) || this.store.panelUsers().some((user) => user.email === email && user.blocked)) return null;
    Object.assign(record, { nonceHash: "", expiresAt: 0 });
    this.store.setValue(KEY, records);
    return { email, invitedBy: record.invitedBy, language: this.store.settings.language === "en" ? "en" : "it" };
  }

  send(email, user) {
    email = String(email || "").trim().toLowerCase();
    if (!this.store.accessPolicy().emails.includes(email)) throw new ValidationError("Autorizza prima questo indirizzo.");
    if (this.store.panelUsers().some((person) => person.email === email && person.blocked)) throw new ValidationError("Riabilita l'accesso prima di inviare l'invito.");
    if (this.active.has(email)) return this.active.get(email).promise;
    if (this.closed) throw new ValidationError("Inviti temporaneamente non disponibili.");
    const nonce = randomBytes(32).toString("base64url"), id = randomBytes(12).toString("hex");
    const records = this.store.value(KEY) || {};
    records[email] = { id, status: this.cloud ? "sending" : "unavailable", attemptedAt: new Date().toISOString(), sentAt: null,
      invitedBy: String(user?.name || "").replace(/[\r\n]/g, " ").slice(0, 120), nonceHash: this.cloud ? digest(nonce) : "", expiresAt: this.cloud ? Date.now() + 120000 : 0 };
    this.store.setValue(KEY, records);
    if (!this.cloud) return Promise.resolve();
    const controller = new AbortController();
    const promise = this.deliver(email, id, nonce, controller).finally(() => this.active.delete(email));
    this.active.set(email, { controller, promise });
    return promise;
  }

  async deliver(email, id, nonce, controller) {
    let status = "uncertain";
    try {
      const response = await fetch(`${this.cloud.url}/spaces/${encodeURIComponent(this.space)}/invitations`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ nonce }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]), redirect: "error",
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.sent === true) status = "sent";
      else if (result.error === "mail_unavailable" || response.status === 404) status = "unavailable";
      else if ([400, 403, 409, 429].includes(response.status)) status = "failed";
    } catch {}
    const records = this.store.value(KEY) || {};
    if (records[email]?.id !== id) return;
    Object.assign(records[email], { status, sentAt: status === "sent" ? new Date().toISOString() : null, nonceHash: "", expiresAt: 0 });
    this.store.setValue(KEY, records);
  }

  async stop() {
    this.closed = true;
    const active = [...this.active.values()];
    for (const item of active) item.controller.abort();
    await Promise.allSettled(active.map((item) => item.promise));
  }
}
