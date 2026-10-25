import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { passKeys, signPass } from "../../src/pass.js";
import { OAuth, pkce } from "./oauth.js";
import { proxyRequest, proxyUpgrade } from "./proxy.js";
import { PROVIDERS } from "./store.js";
import * as views from "./views.js";

/**
 * The cloud at usecora.space. The apex is the landing and the one place
 * where people sign in (Google or GitHub). Every other name one label below
 * is a space: the cloud only routes it to that space's Cora, which keeps its
 * own session. Entering a space goes through /go/<space>: a pass signed here
 * that the space checks with the cloud's public key.
 */
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const TYPES = {
  ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
};
const SESSION_DAYS = 30;
const WAITLIST_PER_MINUTE = 20;
const OAUTH_MINUTES = 10;
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  // Positions and delays are set per element (style="--at: 18%"), always by the server, never from input.
  "style-src-attr 'unsafe-inline'",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function mac(key, value) {
  return createHmac("sha256", key).update(value).digest("base64url");
}

function same(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

async function readForm(req, limit = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("body too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
}

/** A path on this site to come back to: never another host. */
export function safeNext(value, fallback = "/account") {
  const next = String(value || "");
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") && next.length < 2000 ? next : fallback;
}

export function createCloud({ config, store, endpoints = {}, log = () => {} }) {
  const origin = new URL(config.publicOrigin || `https://${config.domain}`);
  const domain = config.domain.toLowerCase();
  const secure = !config.insecureCookies;
  const seed = String(config.seed || "");
  if (seed.length < 32) throw new Error("CORA_CLOUD_SEED is missing or too short");
  const sessionKey = Buffer.from(hkdfSync("sha256", Buffer.from(seed), Buffer.alloc(0), Buffer.from("cora cloud session"), 32));
  const keys = passKeys(seed);
  const oauth = new OAuth({ clients: config.clients || {}, endpoints, redirectBase: origin.origin });
  const SESSION = secure ? "__Host-cora" : "cora_cloud";
  const STATE = secure ? "__Host-cora_oauth" : "cora_oauth";
  const spaceOrigin = (slug) => `${origin.protocol}//${slug}.${origin.host}`;
  const version = createHash("sha256").update(readFileSync(join(ASSETS, "cloud.css"))).update(readFileSync(join(ASSETS, "cloud.js"))).digest("hex").slice(0, 10);
  views.configure({ origin: origin.origin, version });
  const policy = CSP.replace("script-src 'self'", `script-src 'self' ${origin.origin}`).replace("style-src 'self'", `style-src 'self' ${origin.origin}`);

  const cookie = (name, value, { maxAge, sameSite = "Lax" }) =>
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;

  const sessionCookie = (account) => {
    const expires = Date.now() + SESSION_DAYS * 86400000;
    const body = `${account.id}.${account.epoch}.${expires}`;
    return cookie(SESSION, `${body}.${mac(sessionKey, `session.${body}`)}`, { maxAge: SESSION_DAYS * 86400 });
  };

  const currentAccount = (req) => {
    const value = cookies(req.headers.cookie)[SESSION];
    if (!value) return null;
    const parts = value.split(".");
    if (parts.length !== 4) return null;
    const [id, epoch, expires, signature] = parts;
    if (Number(expires) < Date.now() || !same(signature, mac(sessionKey, `session.${id}.${epoch}.${expires}`))) return null;
    const account = store.account(id);
    return account && String(account.epoch) === epoch ? account : null;
  };

  const headers = (extra = {}) => ({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": policy,
    ...(secure ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
    ...extra,
  });

  const html = (res, status, body, extra = {}) => {
    res.writeHead(status, headers({ "Content-Type": "text/html; charset=utf-8", ...extra }));
    res.end(body);
  };

  const redirect = (res, location, extra = {}) => {
    res.writeHead(302, headers({ Location: location, ...extra }));
    res.end();
  };

  const asset = (res, path) => {
    const file = normalize(join(ASSETS, path));
    if (!file.startsWith(ASSETS + "/") || !existsSync(file) || /\/\./.test(path)) return false;
    const type = TYPES[extname(file)];
    if (!type) return false;
    res.writeHead(200, {
      "Content-Type": type, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff",
      ...(secure ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
    });
    res.end(readFileSync(file));
    return true;
  };

  const providers = () => Object.fromEntries(PROVIDERS.map((provider) => [provider, oauth.enabled(provider)]));
  /** Tells the operator's own space (config.notify) what happened, signed with the cloud's key. */
  const notify = (fields) => {
    const space = config.notify ? store.space(config.notify) : null;
    if (!space) return;
    fetch(`${space.upstream}/api/cloud/notice`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Cora": "1" },
      body: JSON.stringify({ notice: signPass(keys.privateKey, { aud: "notices", ...fields }) }),
      signal: AbortSignal.timeout(10000),
    }).then((response) => {
      if (!response.ok) log({ type: "notify-failed", space: space.slug, status: response.status });
    }).catch((error) => log({ type: "notify-failed", space: space.slug, error: error.message }));
  };
  const joins = [];

  /** The apex: landing, sign-in, the account page and the way into a space. */
  async function site(req, res, url) {
    const path = url.pathname;
    const method = req.method;
    const account = currentAccount(req);
    const page = { account, domain };

    if (path === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("ok");
    }
    if (path === "/.well-known/cora-cloud.json") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ domain, publicKey: keys.publicKey }));
    }
    if (path.startsWith("/assets/") && (method === "GET" || method === "HEAD") && asset(res, path.slice("/assets/".length))) return;
    if (path === "/robots.txt") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("User-agent: *\nAllow: /\nDisallow: /account\nDisallow: /go/\nDisallow: /auth/\n");
    }

    if (method === "GET" && path === "/") {
      return html(res, 200, views.landing({ ...page, joined: url.searchParams.get("joined") === "1", waitlistError: url.searchParams.get("waitlist") || "" }));
    }

    if (method === "POST" && path === "/waitlist") {
      if (req.headers.origin !== origin.origin) return html(res, 403, views.notFound(page));
      const form = await readForm(req, 4096);
      // Back to the form that was used: the one at the top (#waitlist) or the one at the bottom (#join).
      const anchor = form.from === "bottom" ? "#join" : "#waitlist";
      // A field people never see: whoever fills it is a bot, and gets the same thanks.
      if (form.website) return redirect(res, `/?joined=1${anchor}`);
      const now = Date.now();
      while (joins.length && now - joins[0] > 60000) joins.shift();
      if (joins.length >= WAITLIST_PER_MINUTE) return redirect(res, `/?waitlist=busy${anchor}`);
      try {
        store.joinWaitlist(form.email, form.company);
      } catch {
        return redirect(res, `/?waitlist=invalid${anchor}`);
      }
      joins.push(now);
      log({ type: "waitlist", company: String(form.company || "").slice(0, 80) });
      notify({ type: "waitlist", email: String(form.email || "").trim().toLowerCase(), company: String(form.company || "").trim().slice(0, 80) });
      return redirect(res, `/?joined=1${anchor}`);
    }
    if (method === "GET" && path === "/privacy") return html(res, 200, views.privacy(page));

    if (method === "GET" && path === "/login") {
      const next = safeNext(url.searchParams.get("next"));
      if (account) return redirect(res, next);
      return html(res, 200, views.login({ ...page, next, providers: providers(), error: url.searchParams.get("error") || "" }));
    }

    const start = /^\/auth\/(google|github)$/.exec(path);
    if (method === "GET" && start) {
      const provider = start[1];
      if (!oauth.enabled(provider)) return redirect(res, `/login?error=unavailable`);
      const { verifier, challenge } = pkce();
      const state = randomBytes(18).toString("base64url");
      const body = Buffer.from(JSON.stringify({ p: provider, s: state, v: verifier, n: safeNext(url.searchParams.get("next")), e: Date.now() + OAUTH_MINUTES * 60000 })).toString("base64url");
      return redirect(res, oauth.authorizeUrl(provider, { state, challenge }), {
        "Set-Cookie": cookie(STATE, `${body}.${mac(sessionKey, `oauth.${body}`)}`, { maxAge: OAUTH_MINUTES * 60 }),
      });
    }

    const back = /^\/auth\/(google|github)\/callback$/.exec(path);
    if (method === "GET" && back) {
      const provider = back[1];
      const clear = cookie(STATE, "", { maxAge: 0 });
      const fail = (reason, detail) => {
        log({ type: "signin-failed", provider, reason, detail });
        redirect(res, `/login?error=${reason}`, { "Set-Cookie": clear });
      };
      const raw = cookies(req.headers.cookie)[STATE] || "";
      const [body, signature] = raw.split(".");
      if (!body || !signature || !same(signature, mac(sessionKey, `oauth.${body}`))) return fail("expired");
      let saved;
      try { saved = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return fail("expired"); }
      if (saved.p !== provider || saved.e < Date.now() || !same(saved.s, url.searchParams.get("state") || "")) return fail("expired");
      if (url.searchParams.get("error")) return fail("denied", url.searchParams.get("error"));
      const code = url.searchParams.get("code");
      if (!code) return fail("denied");
      let who;
      try {
        who = await oauth.identify(provider, { code, verifier: saved.v });
      } catch (error) {
        return fail("provider", error.message);
      }
      const signedIn = store.signIn(provider, who);
      log({ type: "signin", provider, accountId: signedIn.id });
      return redirect(res, safeNext(saved.n), { "Set-Cookie": [clear, sessionCookie(signedIn)] });
    }

    if (path === "/logout" && (method === "GET" || method === "POST")) {
      if (account && url.searchParams.get("everywhere") === "1" && method === "POST") store.bumpEpoch(account.id);
      return redirect(res, "/", { "Set-Cookie": cookie(SESSION, "", { maxAge: 0 }) });
    }

    if (!account) {
      if (method === "GET" && (path === "/account" || path.startsWith("/go/"))) return redirect(res, `/login?next=${encodeURIComponent(path + url.search)}`);
      return html(res, 404, views.notFound(page));
    }

    if (method === "GET" && path === "/account") {
      return html(res, 200, views.account({
        ...page, identities: store.identities(account.id), spaces: store.spacesOf(account.id).map((space) => ({ ...space, url: spaceOrigin(space.slug) })),
        request: store.requestOf(account.id), notice: url.searchParams.get("notice") || "", error: url.searchParams.get("error") || "",
      }));
    }

    if (method === "POST" && path === "/account/request") {
      if (req.headers.origin !== origin.origin) return html(res, 403, views.notFound(page));
      const form = await readForm(req);
      try {
        store.request(account.id, { slug: form.slug, note: form.note });
        log({ type: "space-request", accountId: account.id, slug: String(form.slug || "").toLowerCase() });
        return redirect(res, "/account?notice=requested");
      } catch (error) {
        return redirect(res, `/account?error=${encodeURIComponent(error.message === "taken" ? "taken" : "bad-name")}`);
      }
    }

    if (method === "POST" && path === "/account/delete") {
      if (req.headers.origin !== origin.origin) return html(res, 403, views.notFound(page));
      const form = await readForm(req);
      if (form.confirm !== "yes") return redirect(res, "/account");
      if (store.spacesOf(account.id).length) return redirect(res, "/account?error=has-spaces");
      store.deleteAccount(account.id);
      log({ type: "account-deleted", accountId: account.id });
      return redirect(res, "/", { "Set-Cookie": cookie(SESSION, "", { maxAge: 0 }) });
    }

    const go = /^\/go\/([a-z0-9-]+)$/.exec(path);
    if (method === "GET" && go) {
      const space = store.space(go[1]);
      if (!space || space.accountId !== account.id) return html(res, 404, views.notFound({ ...page, slug: go[1] }));
      const pass = signPass(keys.privateKey, {
        aud: `${space.slug}.${domain}`, sub: account.id, name: account.name, email: account.email,
      });
      log({ type: "enter", accountId: account.id, space: space.slug });
      const next = safeNext(url.searchParams.get("next"), "/");
      return redirect(res, `${spaceOrigin(space.slug)}/auth/cloud?${new URLSearchParams({ pass, next })}`);
    }

    return html(res, 404, views.notFound(page));
  }

  /** The space a request is for, from its Host: one label below the domain. */
  const spaceOf = (req) => {
    const host = String(req.headers.host || "").toLowerCase().replace(/:\d+$/, "");
    if (!host.endsWith(`.${domain}`)) return { host, slug: null };
    const label = host.slice(0, -domain.length - 1);
    return { host, slug: label.includes(".") ? "" : label };
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, origin.origin);
    try {
      const { host, slug } = spaceOf(req);
      if (slug === "www") return redirect(res, `${origin.origin}${url.pathname}${url.search}`);
      if (slug) {
        const space = store.space(slug);
        if (!space) return html(res, 404, views.notFound({ slug }));
        return proxyRequest(req, res, space.upstream, {
          onError: (error) => {
            log({ type: "space-offline", space: slug, error: error.message });
            html(res, 502, views.offline({ slug }));
          },
        });
      }
      if (host !== domain && url.pathname !== "/healthz") return html(res, 404, views.notFound());
      await site(req, res, url);
    } catch (error) {
      log({ type: "error", path: url.pathname, error: error.message });
      if (!res.headersSent) html(res, error.status || 500, views.notFound());
      else res.destroy();
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const { slug } = spaceOf(req);
    const space = slug && slug !== "www" ? store.space(slug) : null;
    if (!space) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    proxyUpgrade(req, socket, head, space.upstream);
  });

  return { server, publicKey: keys.publicKey, spaceOrigin };
}
