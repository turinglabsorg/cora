import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const FLUXKIT_GOOGLE_CLIENT_ID = "912240824457-9hjeo5a3tpqg21d8vb4kb8ub661hcljc.apps.googleusercontent.com";
const GMAIL = "https://www.googleapis.com/auth/gmail.";
/**
 * What a space asks Google for: "send" (gmail.send only, what the verified app shows) or
 * "mail" (also drafts with gmail.compose, and reading, labels and archive with gmail.modify).
 * The person may leave some out on Google's screen; at least one must be granted.
 */
const ACCESS = { send: [`${GMAIL}send`], mail: [`${GMAIL}send`, `${GMAIL}compose`, `${GMAIL}modify`] };
const digest = (value) => createHash("sha256").update(value).digest("base64url");
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export class GoogleConnectorBroker {
  constructor({ origin, key, clientId = FLUXKIT_GOOGLE_CLIENT_ID, clientSecret = "", spaceOrigin, endpoints = {}, redirectUri = "" }) {
    Object.assign(this, { origin, key, clientId, clientSecret, spaceOrigin });
    this.redirectUri = redirectUri || `${origin}/connectors/google/callback`;
    this.endpoints = { authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", userinfo: "https://openidconnect.googleapis.com/v1/userinfo", ...endpoints };
    this.used = new Map();
  }
  sign(data) {
    const body = Buffer.from(JSON.stringify(data)).toString("base64url");
    return `cora.${body}.${createHmac("sha256", this.key).update(`google.connector.${body}`).digest("base64url")}`;
  }
  verify(value, kind) {
    const [prefix, body, signature] = String(value || "").split(".");
    if (prefix !== "cora" || !body || body.length > 5000 || !signature || !safeEqual(signature, createHmac("sha256", this.key).update(`google.connector.${body}`).digest("base64url"))) throw new Error("Invalid connector state");
    const data = JSON.parse(Buffer.from(body, "base64url"));
    if (data.kind !== kind || data.expires < Date.now() || !this.spaceOrigin(data.space)) throw new Error("Expired connector state");
    return data;
  }
  start({ space, nonce, challenge, access = "send" }) {
    if (!this.clientSecret || !this.spaceOrigin(space)) throw new Error("Google connector unavailable");
    if (!/^[A-Za-z0-9_-]{43}$/.test(nonce || "") || !/^[A-Za-z0-9_-]{43}$/.test(challenge || "")) throw new Error("Invalid connector request");
    if (!Object.hasOwn(ACCESS, access)) throw new Error("Invalid connector request");
    const state = this.sign({ kind: "connect", space, nonce, challenge, access, expires: Date.now() + 900000 });
    const url = new URL(this.endpoints.authorize);
    url.search = new URLSearchParams({ client_id: this.clientId, redirect_uri: this.redirectUri, response_type: "code", scope: ["openid", "email", ...ACCESS[access]].join(" "), state, code_challenge: challenge, code_challenge_method: "S256", access_type: "offline", prompt: "consent select_account" });
    return url.href;
  }
  callback({ state, code, error }) {
    const data = this.verify(state, "connect");
    const url = new URL("/connectors/google/callback", this.spaceOrigin(data.space));
    url.search = new URLSearchParams({ state, ...(error || !code ? { error: "denied" } : { code }) });
    return url.href;
  }
  async token(body) {
    const response = await fetch(this.endpoints.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...body, client_id: this.clientId, client_secret: this.clientSecret }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error("Google authorization failed");
    return response.json();
  }
  async exchange({ state, code, verifier }) {
    const data = this.verify(state, "connect");
    if (!/^[A-Za-z0-9_-]{43}$/.test(verifier || "") || !safeEqual(digest(verifier), data.challenge)) throw new Error("Invalid connector verification");
    for (const [key, until] of this.used) if (until < Date.now()) this.used.delete(key);
    if (this.used.has(state) || this.used.size > 10000) throw new Error("Connector state already used");
    this.used.set(state, data.expires);
    const token = await this.token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: this.redirectUri });
    const granted = String(token.scope || "").split(" ").filter((scope) => (ACCESS[data.access] || ACCESS.send).includes(scope));
    if (!token.refresh_token || !granted.length) throw new Error("Google did not grant email sending");
    const response = await fetch(this.endpoints.userinfo, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Google identity unavailable");
    const identity = await response.json();
    if (!identity.email_verified || !identity.sub || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(identity.email || "")) throw new Error("Google email not verified");
    const grant = this.sign({ kind: "refresh", space: data.space, subject: identity.sub, email: identity.email.toLowerCase(), refresh: digest(token.refresh_token), expires: Date.now() + 365 * 86400000 });
    return { refresh_token: token.refresh_token, grant, email: identity.email.toLowerCase(), scope: granted.join(" ") };
  }
  async refresh({ grant, refresh_token }) {
    const data = this.verify(grant, "refresh");
    if (!safeEqual(digest(String(refresh_token || "")), data.refresh)) throw new Error("Invalid Google grant");
    const token = await this.token({ grant_type: "refresh_token", refresh_token });
    return { access_token: token.access_token, expires_in: token.expires_in, email: data.email };
  }
}
