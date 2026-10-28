import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { after, before, describe, test } from "node:test";
import { createCloud } from "../cloud/src/app.js";
import { CloudStore } from "../cloud/src/store.js";
import { verifyPass } from "../src/pass.js";
import { tempHome, waitFor } from "./helpers.js";

const DOMAIN = "usecora.test";
const SEED = "a test seed that is long enough for the cloud 0123456789";
let cloud;
let store;
let port;
let origin;
let providers;
let upstream;
const logs = [];
const notices = [];

/** Google and GitHub as far as the cloud can tell: they hand out codes for the users the test approves. */
function fakeProviders() {
  const codes = new Map();
  const tokens = new Map();
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    const json = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url, "http://x");
    const exchange = (fields, provider) => {
      const grant = codes.get(fields.code);
      if (!grant || grant.provider !== provider) return json(400, { error: "invalid_grant" });
      if (fields.client_secret !== `${provider}-secret`) return json(401, { error: "invalid_client" });
      const challenge = createHash("sha256").update(String(fields.code_verifier || "")).digest("base64url");
      if (challenge !== grant.challenge) return json(400, { error: "invalid_grant", detail: "pkce" });
      codes.delete(fields.code);
      const token = `tok_${Math.random().toString(36).slice(2)}`;
      tokens.set(token, grant.user);
      return json(200, { access_token: token, token_type: "bearer" });
    };
    const bearer = tokens.get(String(req.headers.authorization || "").replace(/^Bearer /, ""));
    if (url.pathname === "/google/token") return exchange(Object.fromEntries(new URLSearchParams(raw)), "google");
    if (url.pathname === "/github/token") return exchange(JSON.parse(raw || "{}"), "github");
    if (!bearer) return json(401, { error: "unauthorized" });
    if (url.pathname === "/google/userinfo") return json(200, bearer);
    if (url.pathname === "/github/api/user") return json(200, bearer);
    if (url.pathname === "/github/api/user/emails") return json(200, bearer.emails || []);
    return json(404, {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({
      endpoints: {
        google: { authorize: `${base}/google/authorize`, token: `${base}/google/token`, userinfo: `${base}/google/userinfo` },
        github: { authorize: `${base}/github/authorize`, token: `${base}/github/token`, api: `${base}/github/api` },
      },
      approve: (code, grant) => codes.set(code, grant),
      close: () => new Promise((done) => server.close(done)),
    });
  }));
}

/** A space's Cora as far as the proxy can tell: it echoes, streams, and speaks WebSocket. */
function fakeSpace() {
  const server = http.createServer((req, res) => {
    if (req.url === "/stream") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: first\n\n");
      setTimeout(() => res.end("data: second\n\n"), 400);
      return;
    }
    if (req.url === "/api/cloud/notice") {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        notices.push({ headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end("{}");
      });
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": ["a=1; Path=/", "b=2; Path=/"] });
    res.end(JSON.stringify({ host: req.headers.host, proto: req.headers["x-forwarded-proto"], path: req.url, method: req.method }));
  });
  const upgraded = new Set();
  server.on("upgrade", (req, socket) => {
    upgraded.add(socket);
    socket.on("close", () => upgraded.delete(socket));
    socket.on("end", () => socket.end());
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.on("data", (data) => socket.write(`echo:${data}`));
  });
  let closed = false;
  const close = () => new Promise((done) => {
    if (closed) return done();
    closed = true;
    for (const socket of upgraded) socket.destroy();
    server.closeAllConnections();
    server.close(() => done());
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close })));
}

function request(path, { host = DOMAIN, method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path, headers: { host: `${host}:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const cookieOf = (res, name) => (res.headers["set-cookie"] || []).map((line) => line.split(";")[0]).find((pair) => pair.startsWith(`${name}=`)) || "";

/** The whole sign-in, as a browser would do it: start, the provider approves, the callback. */
async function signIn(provider, user, next = "/account") {
  const start = await request(`/auth/${provider}?next=${encodeURIComponent(next)}`);
  assert.equal(start.status, 302);
  const to = new URL(start.headers.location);
  assert.equal(to.searchParams.get("code_challenge_method"), "S256");
  assert.equal(to.searchParams.get("redirect_uri"), `${origin}/auth/${provider}/callback`);
  const code = `code_${Math.random().toString(36).slice(2)}`;
  providers.approve(code, { provider, challenge: to.searchParams.get("code_challenge"), user });
  const back = await request(`/auth/${provider}/callback?code=${code}&state=${to.searchParams.get("state")}`, { headers: { cookie: cookieOf(start, "cora_oauth") } });
  return { back, cookie: cookieOf(back, "cora_cloud") };
}

before(async () => {
  providers = await fakeProviders();
  upstream = await fakeSpace();
  store = new CloudStore(tempHome());
  const owner = store.createAccount({ name: "" });
  store.invite(owner.id, "google", "Owner@Example.com");
  store.invite(owner.id, "github", "owner-gh");
  store.addSpace({ slug: "acme", accountId: owner.id, upstream: upstream.url });
  // The cloud needs its public address before it starts, and the port only exists once it listens.
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  origin = `http://${DOMAIN}:${port}`;
  cloud = createCloud({
    config: {
      domain: DOMAIN, publicOrigin: origin, seed: SEED, insecureCookies: true, notify: "acme",
      clients: { google: { id: "google-id", secret: "google-secret" }, github: { id: "github-id", secret: "github-secret" } },
    },
    store, endpoints: providers.endpoints, log: (event) => logs.push(event),
  });
  await new Promise((resolve) => cloud.server.listen(port, "127.0.0.1", resolve));
});

after(async () => {
  cloud.server.closeAllConnections();
  await new Promise((resolve) => cloud.server.close(resolve));
  await providers.close();
  await upstream.close();
  store.close();
});

describe("usecora.space", () => {
  test("the apex is the landing; www goes to the apex; an unknown space and an unknown host are not found", async () => {
    const landing = await request("/");
    assert.equal(landing.status, 200);
    assert.match(landing.body, /AI agents that live/);
    assert.match(landing.body, /Bring your own<\/em> intelligence/);
    assert.doesNotMatch(landing.body, /href="[^"]*\/(login|account)/, "the landing has no sign-in until it opens");
    assert.match(landing.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.match(landing.headers["content-security-policy"], /script-src 'self'/);
    assert.equal((await request("/assets/cloud.css")).status, 200);
    assert.equal((await request("/assets/../src/app.js")).status, 404, "nothing outside the assets folder");
    const www = await request("/privacy?x=1", { host: `www.${DOMAIN}` });
    assert.equal(www.status, 302);
    assert.equal(www.headers.location, `${origin}/privacy?x=1`);
    const nobody = await request("/", { host: `nobody.${DOMAIN}` });
    assert.equal(nobody.status, 404);
    assert.match(nobody.body, /no space called nobody/);
    assert.equal((await request("/", { host: "elsewhere.example" })).status, 404);
    const key = JSON.parse((await request("/.well-known/cora-cloud.json")).body);
    assert.equal(key.publicKey, cloud.publicKey);
  });

  test("the owner signs in with Google or GitHub into the same invited account, and enters the space with a pass only it accepts", async () => {
    assert.equal((await request("/account")).headers.location, "/login?next=%2Faccount", "the account page asks to sign in first");
    const google = await signIn("google", { sub: "g-111", email: "owner@example.com", email_verified: true, name: "Sam Owner", picture: "https://img.example/sam.png" });
    assert.equal(google.back.status, 302);
    assert.equal(google.back.headers.location, "/account");
    const page = await request("/account", { headers: { cookie: google.cookie } });
    assert.equal(page.status, 200);
    assert.match(page.body, /Sam Owner/);
    assert.match(page.body, /<b>acme<\/b>\.usecora\.test/);

    const github = await signIn("github", { id: 4242, login: "Owner-GH", name: "Sam", avatar_url: "", emails: [{ email: "sam@work.example", primary: true, verified: true }] });
    const again = await request("/account", { headers: { cookie: github.cookie } });
    assert.match(again.body, /<b>acme<\/b>/, "GitHub lands in the same account");
    assert.match(again.body, /owner@example\.com/);
    assert.match(again.body, /owner-gh/);

    const go = await request("/go/acme?next=%2F%23%2Fagent%2Fx%2Fchat", { headers: { cookie: google.cookie } });
    assert.equal(go.status, 302);
    const to = new URL(go.headers.location);
    assert.equal(to.origin, `http://acme.${DOMAIN}:${port}`);
    assert.equal(to.pathname, "/auth/cloud");
    assert.equal(to.searchParams.get("next"), "/#/agent/x/chat");
    const pass = verifyPass(cloud.publicKey, to.searchParams.get("pass"), { audience: `acme.${DOMAIN}` });
    assert.ok(pass, "the space can check the pass with the public key alone");
    assert.equal(pass.email, "owner@example.com");
    assert.equal(verifyPass(cloud.publicKey, to.searchParams.get("pass"), { audience: `other.${DOMAIN}` }), null, "a pass for one space opens no other");
    assert.equal(verifyPass(cloud.publicKey, to.searchParams.get("pass"), { audience: `acme.${DOMAIN}`, now: Date.now() + 120000 }), null, "and it expires");
  });

  test("a sign-in with a forged or stale state, or a provider that refuses, gets nowhere", async () => {
    const start = await request("/auth/google");
    const to = new URL(start.headers.location);
    const forged = await request(`/auth/google/callback?code=x&state=${to.searchParams.get("state")}x`, { headers: { cookie: cookieOf(start, "cora_oauth") } });
    assert.equal(forged.headers.location, "/login?error=expired");
    assert.equal(cookieOf(forged, "cora_cloud"), "");
    const noCookie = await request(`/auth/google/callback?code=x&state=${to.searchParams.get("state")}`);
    assert.equal(noCookie.headers.location, "/login?error=expired");
    const otherProvider = await request(`/auth/github/callback?code=x&state=${to.searchParams.get("state")}`, { headers: { cookie: cookieOf(start, "cora_oauth") } });
    assert.equal(otherProvider.headers.location, "/login?error=expired");
    const unknownCode = await request(`/auth/google/callback?code=never-approved&state=${to.searchParams.get("state")}`, { headers: { cookie: cookieOf(start, "cora_oauth") } });
    assert.equal(unknownCode.headers.location, "/login?error=provider");
    const unverified = await signIn("google", { sub: "g-evil", email: "owner@example.com", email_verified: false, name: "Not Sam" });
    const page = await request("/account", { headers: { cookie: unverified.cookie } });
    assert.match(page.body, /No space yet/, "an unverified address does not claim an invite");
    const login = await request("/login?error=expired");
    assert.match(login.body, /took too long/);
  });

  test("someone new gets an account of their own, can ask for a space name, and cannot enter spaces that are not theirs", async () => {
    const { cookie } = await signIn("github", { id: 777, login: "newcomer", name: "New Comer", emails: [] });
    const page = await request("/account", { headers: { cookie } });
    assert.match(page.body, /No space yet/);
    assert.equal((await request("/go/acme", { headers: { cookie } })).status, 403);

    const form = (body, headers = {}) => request("/account/request", { method: "POST", body, headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin, ...headers } });
    assert.equal((await form("slug=new-co&note=ops")).headers.location, "/account?notice=requested");
    assert.equal((await form("slug=acme")).headers.location, "/account?error=taken");
    assert.equal((await form("slug=Bad_Name")).headers.location, "/account?error=bad-name");
    assert.equal((await form("slug=www")).headers.location, "/account?error=bad-name");
    assert.equal((await form("slug=sneaky", { origin: "https://evil.example" })).status, 403, "another site cannot post for you");
    assert.deepEqual(store.requests().map((item) => [item.slug, item.note]), [["new-co", "ops"]]);
    assert.match((await request("/account", { headers: { cookie } })).body, /<b>new-co<\/b>/);

    const deleted = await request("/account/delete", { method: "POST", body: "confirm=yes", headers: { cookie, "content-type": "application/x-www-form-urlencoded", origin } });
    assert.equal(deleted.headers.location, "/");
    assert.equal((await request("/account", { headers: { cookie } })).status, 302, "a deleted account is signed out");
    assert.deepEqual(store.requests(), []);
  });

  test("people join the waitlist from the landing with an email, once each; bad addresses, other sites and bots get nowhere", async () => {
    const join = (body, headers = {}) => request("/waitlist", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", origin, ...headers } });
    const joined = await join("email=Ada%40Acme.example&company=Acme&website=");
    assert.equal(joined.headers.location, "/?joined=1#waitlist");
    assert.equal((await join("email=ada%40acme.example&company=&from=bottom")).headers.location, "/?joined=1#join", "joining again is fine, and the bottom form comes back to the bottom");
    assert.equal((await join("email=not-an-address")).headers.location, "/?waitlist=invalid#waitlist");
    assert.equal((await join("email=eve%40evil.example", { origin: "https://evil.example" })).status, 403);
    assert.equal((await join("email=bot%40spam.example&website=http%3A%2F%2Fspam")).headers.location, "/?joined=1#waitlist", "a bot gets the same thanks");
    assert.deepEqual(store.waitlist().map((entry) => [entry.email, entry.company]), [["ada@acme.example", "Acme"]]);
    await waitFor(() => notices.length === 2, { what: "the operator's space told about both joins" });
    const told = verifyPass(cloud.publicKey, notices[0].body.notice, { audience: "notices" });
    assert.deepEqual([told.type, told.email, told.company], ["waitlist", "ada@acme.example", "Acme"]);
    assert.equal(notices[0].headers["x-cora"], "1");
    assert.equal(notices.length, 2, "bots and refused addresses tell nobody");
    const thanks = await request("/?joined=1");
    assert.match(thanks.body, /You're on the list/);
    assert.doesNotMatch(thanks.body, /name="email"/, "no form once you joined");
    assert.match((await request("/?waitlist=invalid")).body, /doesn't look right/);
  });

  test("signing out everywhere ends every session of the account", async () => {
    const first = await signIn("google", { sub: "g-111", email: "owner@example.com", email_verified: true, name: "Sam Owner" });
    const second = await signIn("google", { sub: "g-111", email: "owner@example.com", email_verified: true, name: "Sam Owner" });
    assert.equal((await request("/account", { headers: { cookie: first.cookie } })).status, 200);
    const out = await request("/logout?everywhere=1", { method: "POST", headers: { cookie: second.cookie } });
    assert.equal(out.headers.location, "/");
    assert.equal((await request("/account", { headers: { cookie: first.cookie } })).status, 302);
    const owner = store.spaces()[0].accountId;
    assert.throws(() => store.deleteAccount(owner), /owns a space/);
  });

  test("a space's address reaches its Cora: host kept, cookies, a live event stream, WebSockets; a Cora that is down shows the offline page", async () => {
    const echo = await request("/api/x?y=1", { host: `acme.${DOMAIN}`, method: "POST", body: "{}" });
    assert.equal(echo.status, 200);
    assert.deepEqual(JSON.parse(echo.body), { host: `acme.${DOMAIN}:${port}`, proto: "https", path: "/api/x?y=1", method: "POST" });
    assert.deepEqual(echo.headers["set-cookie"], ["a=1; Path=/", "b=2; Path=/"]);

    const firstChunk = await new Promise((resolve, reject) => {
      const started = Date.now();
      http.get({ host: "127.0.0.1", port, path: "/stream", headers: { host: `acme.${DOMAIN}` } }, (res) => {
        res.once("data", (chunk) => {
          resolve({ text: String(chunk), ms: Date.now() - started });
          res.destroy();
        });
      }).on("error", reject);
    });
    assert.equal(firstChunk.text, "data: first\n\n");
    assert.ok(firstChunk.ms < 350, "events are not held back until the stream ends");

    const echoed = await new Promise((resolve, reject) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.write(`GET /box/x/websockify HTTP/1.1\r\nHost: acme.${DOMAIN}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`);
      });
      let seen = "";
      socket.on("data", (data) => {
        seen += data;
        if (seen.includes("101 Switching Protocols") && !seen.includes("echo:")) socket.write("ping");
        if (seen.includes("echo:ping")) {
          socket.destroy();
          resolve(seen);
        }
      });
      socket.on("error", reject);
    });
    assert.match(echoed, /echo:ping/);

    await upstream.close();
    const down = await request("/", { host: `acme.${DOMAIN}` });
    assert.equal(down.status, 502);
    assert.match(down.body, /acme is not answering/);
    assert.ok(logs.some((event) => event.type === "space-offline" && event.space === "acme"));
  });
});

describe("waitlist Discord webhook", () => {
  async function fixture(t) {
    const received = [];
    const events = [];
    let status = 204;
    let disconnect = false;
    const webhook = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      received.push({ path: req.url, method: req.method, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      if (disconnect) return req.socket.destroy();
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(status === 204 ? undefined : JSON.stringify({ message: `failed ${req.url}` }));
    });
    await new Promise((resolve) => webhook.listen(0, "127.0.0.1", resolve));
    const upstreamUrl = `http://127.0.0.1:${webhook.address().port}`;
    const webhookUrl = `${upstreamUrl}/api/webhooks/test/test-private-path`;
    const ownStore = new CloudStore(tempHome());
    const owner = ownStore.createAccount();
    ownStore.addSpace({ slug: "operator", accountId: owner.id, upstream: upstreamUrl });
    const config = { domain: DOMAIN, seed: SEED, insecureCookies: true, notify: "operator", waitlistWebhookUrl: webhookUrl };
    const ownCloud = createCloud({ config, store: ownStore, log: (event) => events.push(event) });
    await new Promise((resolve) => ownCloud.server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      ownCloud.server.closeAllConnections();
      await new Promise((resolve) => ownCloud.server.close(resolve));
      webhook.closeAllConnections();
      await new Promise((resolve) => webhook.close(resolve));
      ownStore.close();
    });
    const join = (fields, extraHeaders = {}) => new Promise((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1", port: ownCloud.server.address().port, path: "/waitlist", method: "POST",
        headers: { Host: DOMAIN, Origin: `https://${DOMAIN}`, "Content-Type": "application/x-www-form-urlencoded", ...extraHeaders },
      }, (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode, headers: new Headers(res.headers) }));
      });
      req.on("error", reject);
      req.end(new URLSearchParams(fields).toString());
    });
    return { received, events, store: ownStore, config, join, webhookUrl, setStatus: (value) => { status = value; }, disconnect: () => { disconnect = true; } };
  }

  test("a valid sign-up posts its normalized text directly, without mentions or a second space notification", async (t) => {
    const f = await fixture(t);
    const response = await f.join({ email: "  Ada@Acme.example  ", company: "  Acme @everyone  " });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/?joined=1#waitlist");
    await waitFor(() => f.events.some((event) => event.type === "notify-sent"), { what: "the webhook accepting the waitlist text" });
    assert.equal(f.received.length, 1);
    assert.equal(f.received[0].path, "/api/webhooks/test/test-private-path?wait=true");
    assert.equal(f.received[0].method, "POST");
    assert.deepEqual(f.received[0].body, {
      username: "Cora",
      content: "📬 Nuova iscrizione alla lista d'attesa di usecora.space: **ada@acme.example (Acme @everyone)**",
      allowed_mentions: { parse: [] },
    });
    assert.deepEqual(f.store.waitlist().map(({ email, company }) => [email, company]), [["ada@acme.example", "Acme @everyone"]]);
    assert.deepEqual(f.events.find((event) => event.type === "notify-sent"), { type: "notify-sent", destination: "discord-webhook", status: 204 });

    await f.join({ email: "invalid" });
    await f.join({ email: "bot@example.com", website: "spam" });
    assert.equal((await f.join({ email: "outsider@example.com" }, { Origin: "https://elsewhere.example" })).status, 403);
    assert.equal(f.received.length, 1, "refused addresses and honeypots never reach the webhook");
  });

  test("a rejected webhook keeps the registration and logs only safe status metadata", async (t) => {
    const f = await fixture(t);
    f.setStatus(429);
    const response = await f.join({ email: "saved@example.com", company: "Saved" });
    assert.equal(response.headers.get("location"), "/?joined=1#waitlist");
    await waitFor(() => f.events.some((event) => event.type === "notify-failed"), { what: "the webhook refusal recorded safely" });
    assert.deepEqual(f.events.find((event) => event.type === "notify-failed"), { type: "notify-failed", destination: "discord-webhook", status: 429 });
    assert.equal(f.store.waitlist()[0].email, "saved@example.com");
    assert.equal(f.received.length, 1, "no duplicate delivery through the old route after an ambiguous failure");
    assert.ok(!JSON.stringify(f.events).includes(f.webhookUrl));
    assert.ok(!JSON.stringify(f.events).includes("test-private-path"));
  });

  test("a disconnected webhook keeps the registration and never logs request URLs", async (t) => {
    const f = await fixture(t);
    f.disconnect();
    assert.equal((await f.join({ email: "offline@example.com" })).status, 302);
    await waitFor(() => f.events.some((event) => event.type === "notify-failed"), { what: "the network failure recorded safely" });
    assert.deepEqual(f.events.find((event) => event.type === "notify-failed"), { type: "notify-failed", destination: "discord-webhook", reason: "request-failed" });
    assert.equal(f.store.waitlist()[0].email, "offline@example.com");
    assert.ok(!JSON.stringify(f.events).includes("test-private-path"));
  });

  test("missing old-route configuration is visible in logs while the registration succeeds", async (t) => {
    const f = await fixture(t);
    f.config.waitlistWebhookUrl = "";
    f.config.notify = "";
    assert.equal((await f.join({ email: "unconfigured@example.com" })).status, 302);
    assert.deepEqual(f.events.find((event) => event.type === "notify-failed"), { type: "notify-failed", destination: "space", reason: "not-configured" });
    assert.equal(f.store.waitlist()[0].email, "unconfigured@example.com");
    assert.equal(f.received.length, 0);
  });

  test("a malformed webhook is reported safely after saving the registration", async (t) => {
    const f = await fixture(t);
    f.config.waitlistWebhookUrl = "invalid-test-private-path";
    assert.equal((await f.join({ email: "malformed@example.com" })).status, 302);
    assert.deepEqual(f.events.find((event) => event.type === "notify-failed"), { type: "notify-failed", destination: "discord-webhook", reason: "request-failed" });
    assert.equal(f.store.waitlist()[0].email, "malformed@example.com");
    assert.ok(!JSON.stringify(f.events).includes("test-private-path"));
    assert.equal(f.received.length, 0);
  });
});
