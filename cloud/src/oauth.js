import { createHash, randomBytes } from "node:crypto";

/**
 * Signing in with Google (OpenID Connect) and GitHub (OAuth): the
 * authorization code flow with PKCE and a state bound to the browser. Each
 * provider ends in the same shape: who this person is for that provider.
 */
export const DEFAULT_ENDPOINTS = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    userinfo: "https://openidconnect.googleapis.com/v1/userinfo",
  },
  github: {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    api: "https://api.github.com",
  },
};

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export class OAuth {
  constructor({ clients, endpoints = {}, redirectBase }) {
    this.clients = clients;
    this.endpoints = {
      google: { ...DEFAULT_ENDPOINTS.google, ...endpoints.google },
      github: { ...DEFAULT_ENDPOINTS.github, ...endpoints.github },
    };
    this.redirectBase = redirectBase.replace(/\/$/, "");
  }

  enabled(provider) {
    return Boolean(this.clients[provider]?.id && this.clients[provider]?.secret);
  }

  redirectUri(provider) {
    return `${this.redirectBase}/auth/${provider}/callback`;
  }

  /** Where to send the browser to start signing in. */
  authorizeUrl(provider, { state, challenge }) {
    const client = this.clients[provider];
    const params = new URLSearchParams({
      client_id: client.id,
      redirect_uri: this.redirectUri(provider),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    if (provider === "google") {
      params.set("response_type", "code");
      params.set("scope", "openid email profile");
      params.set("prompt", "select_account");
    } else {
      params.set("scope", "read:user user:email");
      params.set("allow_signup", "true");
    }
    return `${this.endpoints[provider].authorize}?${params}`;
  }

  /** The code the provider sent back, turned into who signed in. */
  async identify(provider, { code, verifier }) {
    return provider === "google" ? this.google(code, verifier) : this.github(code, verifier);
  }

  async google(code, verifier) {
    const client = this.clients.google;
    const token = await json(this.endpoints.google.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        code, client_id: client.id, client_secret: client.secret, redirect_uri: this.redirectUri("google"),
        grant_type: "authorization_code", code_verifier: verifier,
      }),
    });
    if (!token.access_token) throw new Error("google gave no access token");
    const user = await json(this.endpoints.google.userinfo, { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!user.sub) throw new Error("google gave no user");
    return {
      subject: String(user.sub),
      email: String(user.email || "").toLowerCase(),
      emailVerified: user.email_verified === true || user.email_verified === "true",
      name: String(user.name || ""),
      avatar: String(user.picture || ""),
      login: "",
    };
  }

  async github(code, verifier) {
    const client = this.clients.github;
    const token = await json(this.endpoints.github.token, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: client.id, client_secret: client.secret, code, redirect_uri: this.redirectUri("github"), code_verifier: verifier }),
    });
    if (!token.access_token) throw new Error(`github gave no access token${token.error ? ` (${token.error})` : ""}`);
    const headers = { Authorization: `Bearer ${token.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "cora-cloud" };
    const user = await json(`${this.endpoints.github.api}/user`, { headers });
    if (!user.id) throw new Error("github gave no user");
    let email = "";
    let emailVerified = false;
    try {
      const emails = await json(`${this.endpoints.github.api}/user/emails`, { headers });
      const primary = (Array.isArray(emails) ? emails : []).find((item) => item.primary && item.verified);
      if (primary) {
        email = String(primary.email).toLowerCase();
        emailVerified = true;
      }
    } catch {}
    return {
      subject: String(user.id),
      login: String(user.login || "").toLowerCase(),
      email,
      emailVerified,
      name: String(user.name || user.login || ""),
      avatar: String(user.avatar_url || ""),
    };
  }
}

async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${new URL(url).host} answered ${response.status} with no JSON`);
  }
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}${data.error ? `: ${data.error}` : ""}`);
  return data;
}
