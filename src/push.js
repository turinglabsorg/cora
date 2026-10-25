import { createECDH, createHash, createCipheriv, createPrivateKey, hkdfSync, randomBytes, sign } from "node:crypto";

const RECORD_SIZE = 4096;
const AGENT_GAP_MS = 60 * 1000;
const AGENT_DAILY = 20;

const b64url = (value) => Buffer.from(value).toString("base64url");

/**
 * The VAPID key pair, derived from one secret kept in hush (CORA_VAPID_KEY):
 * the same secret always gives the same key, so subscriptions survive restarts.
 */
export function vapidKeys(secret) {
  let seed = createHash("sha256").update(`cora-vapid:${secret}`).digest();
  for (;;) {
    try {
      const ecdh = createECDH("prime256v1");
      ecdh.setPrivateKey(seed);
      const publicKey = ecdh.getPublicKey();
      const privateKey = createPrivateKey({
        format: "jwk",
        key: { kty: "EC", crv: "P-256", d: b64url(seed), x: b64url(publicKey.subarray(1, 33)), y: b64url(publicKey.subarray(33, 65)) },
      });
      return { publicKey: b64url(publicKey), privateKey };
    } catch {
      seed = createHash("sha256").update(seed).digest();
    }
  }
}

/** RFC 8291 payload encryption (aes128gcm) for one subscription. */
export function encryptPayload(payload, { p256dh, auth }) {
  const receiver = Buffer.from(p256dh, "base64url");
  const authSecret = Buffer.from(auth, "base64url");
  const ecdh = createECDH("prime256v1");
  const sender = ecdh.generateKeys();
  const shared = ecdh.computeSecret(receiver);
  const salt = randomBytes(16);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), receiver, sender]), 32));
  const key = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(sender.length, 20);
  return Buffer.concat([header, sender, body]);
}

function vapidHeader(endpoint, keys, subject) {
  const url = new URL(endpoint);
  const unsigned = `${b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }))}.${b64url(JSON.stringify({ aud: `${url.protocol}//${url.host}`, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }))}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key: keys.privateKey, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64url(signature)}, k=${keys.publicKey}`;
}

/** Notifications to the owner's devices that installed the panel and allowed them. */
export class Push {
  constructor({ store, secret = "", subject = "https://github.com/turinglabsorg/cora", log }) {
    this.store = store;
    this.keys = secret ? vapidKeys(secret) : null;
    this.subject = subject;
    this.log = log;
    this.sentByAgent = new Map();
  }

  get enabled() {
    return Boolean(this.keys);
  }

  status() {
    return { enabled: this.enabled, publicKey: this.keys?.publicKey || "", devices: this.store.pushSubscriptions().length };
  }

  /** Send to every device; subscriptions the push service has dropped are removed. */
  async notify({ title, body = "", url = "/", tag = "" }) {
    if (!this.keys) return { sent: 0 };
    const payload = JSON.stringify({ title: String(title).slice(0, 80), body: String(body).slice(0, 400), url, tag });
    let sent = 0;
    await Promise.all(this.store.pushSubscriptions().map(async (subscription) => {
      try {
        const response = await fetch(subscription.endpoint, {
          method: "POST",
          headers: {
            TTL: "86400",
            Urgency: "normal",
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            Authorization: vapidHeader(subscription.endpoint, this.keys, this.subject),
          },
          body: encryptPayload(payload, subscription.keys),
          signal: AbortSignal.timeout(15000),
        });
        if (response.status === 404 || response.status === 410) this.store.removePushSubscription(subscription.endpoint);
        else if (response.ok) sent += 1;
        else this.log?.({ type: "warning", text: `notifica: il servizio push risponde ${response.status}` });
      } catch (error) {
        this.log?.({ type: "warning", text: `notifica: ${error.message}` });
      }
    }));
    return { sent };
  }

  /** An agent asking to notify the owner: at most one a minute and twenty a day each. */
  async fromAgent(agent, { title, message, url }) {
    if (!this.keys) return { error: "notifications are not set up" };
    if (!this.store.pushSubscriptions().length) return { error: "the owner has not turned notifications on in the panel" };
    const now = Date.now();
    const recent = (this.sentByAgent.get(agent.id) || []).filter((at) => now - at < 24 * 3600 * 1000);
    if (recent.length && now - recent[recent.length - 1] < AGENT_GAP_MS) return { error: "you sent a notification less than a minute ago" };
    if (recent.length >= AGENT_DAILY) return { error: "daily notification limit reached" };
    recent.push(now);
    this.sentByAgent.set(agent.id, recent);
    const result = await this.notify({ title: title ? `${agent.name}: ${title}` : agent.name, body: message, url: url || `/#/agent/${agent.id}/chat`, tag: `agent-${agent.id}-${now}` });
    return result.sent ? { sent: result.sent } : { error: "no device accepted the notification" };
  }
}
