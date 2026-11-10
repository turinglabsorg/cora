import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { HERMES_KEY_PROVIDERS } from "./hermes-keys.js";
import { ValidationError, newId } from "./store.js";

/** API keys a person keeps for their own agents. The space key stays a separate choice. */
export const KEY_PROVIDERS = HERMES_KEY_PROVIDERS;

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

export class Credentials {
  constructor({ store, key }) {
    this.store = store;
    // Derived for these keys alone: the session key signs cookies, this one only encrypts values.
    this.key = key ? Buffer.from(hkdfSync("sha256", Buffer.from(String(key)), Buffer.alloc(0), Buffer.from("cora credentials v1"), 32)) : null;
  }

  view(record) {
    if (!record) return null;
    const { sealed, ...rest } = record;
    return rest;
  }

  /** Only the keys this person saved. A space key is not one of these. */
  list(user) {
    return this.store.credentials()
      .filter((record) => record.connectedBy?.id === user?.id)
      .map((record) => this.view(record));
  }

  summary(id, user) {
    const view = this.view(this.store.credential(id));
    if (!view) return null;
    return { ...view, owned: view.connectedBy?.id === user?.id };
  }

  create({ provider, secret, label, connectedBy }) {
    if (!this.key) throw new ValidationError("impossibile conservare la chiave");
    if (!KEY_PROVIDERS.includes(provider)) throw new ValidationError("provider non valido");
    const value = String(secret || "");
    if (!value.trim() || value.length > 2048 || /[\r\n\x00]/.test(value)) throw new ValidationError("chiave API non valida");
    if (!connectedBy?.id) throw new ValidationError("chiave senza proprietario");
    const owned = this.store.credentials().filter((record) => record.connectedBy?.id === connectedBy.id);
    if (owned.length >= 20) throw new ValidationError("troppe chiavi: rimuovi quelle inutilizzate");
    const id = newId("key");
    const at = new Date().toISOString();
    const record = {
      id, provider,
      label: String(label || (provider === "ollama" ? "Ollama Cloud" : "DeepSeek")).replace(/[\r\n]/g, " ").trim().slice(0, 80),
      last4: value.slice(-4),
      connectedBy: { id: String(connectedBy.id).slice(0, 64), name: String(connectedBy.name || "").replace(/[\r\n]/g, " ").trim().slice(0, 80) },
      status: "ready",
      sealed: seal(this.key, value, `${id}.${provider}`),
      createdAt: at,
      updatedAt: at,
    };
    this.store.saveCredential(record);
    return this.view(record);
  }

  secret(id) {
    const record = this.store.credential(id);
    if (!record?.sealed || !this.key) return "";
    try { return unseal(this.key, record.sealed, `${record.id}.${record.provider}`).toString(); }
    catch { return ""; }
  }

  remove(id, user) {
    const record = this.store.credential(id);
    if (!record || record.connectedBy?.id !== user?.id) throw new ValidationError("chiave non trovata");
    if (this.store.agents().some((agent) => agent.credentialId === id)) throw new ValidationError("chiave usata da un agente");
    this.store.deleteCredential(id);
  }
}
