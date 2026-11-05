import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { startCora } from "../src/main.js";
import { passKeys, signPass } from "../src/pass.js";
import { fakeDocker, tempHome } from "./helpers.js";

const SEED = "fixture-share-signing-seed-for-tests-only-0123456789abc";
const keys = passKeys(SEED);
const OWNER = { sub: "ac_owner", role: "owner", name: "Owner", email: "owner@example.test", emailVerified: true };
const SHARE = "report--acme.usecora.test";

/** A request to the instance as if it came through the cloud for another host: Host is what decides. */
function hit(port, host, path, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path, method, headers: { host, ...headers } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function fixture(t) {
  const docker = fakeDocker();
  const app = startCora({ home: tempHome(), host: "127.0.0.1", port: 0, insecureCookies: true,
    adminPassword: "fixture-password", sessionKey: "fixture-session-shares", useResidentSubscriptions: false,
    cloudUrl: "https://usecora.test", cloudKey: keys.publicKey, cloudSpace: "acme",
    discordToken: "", telegramToken: "", ollamaKey: "", orcaKey: "", claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes",
    botTokenFor: () => "", docker: docker.path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  t.after(() => app.stop());
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const entered = await fetch(`${base}/auth/cloud?${new URLSearchParams({ pass: signPass(keys.privateKey, { aud: "acme.usecora.test", ...OWNER }) })}`, { redirect: "manual" });
  const cookie = entered.headers.get("set-cookie").split(";")[0];
  const call = async (path, { method = "GET", body } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, "X-Cora": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const agent = app.store.createAgent({ name: "Nico", model: "ollama/test-model", tools: true });
  const put = (file, content) => {
    const target = join(docker.desktop(agent.id), "work", file);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  };
  const owner = app.store.panelUsers().find((user) => user.role === "owner" && user.email === OWNER.email);
  return { app, port, base, cookie, call, agent, put, owner };
}

/** In through the cloud: a pass for this host, then the cookie that host sets. */
async function enter(port, host, identity, next = "/") {
  const pass = signPass(keys.privateKey, { aud: `share:${host}`, sub: `test:${identity.email}`, emailVerified: true, ...identity });
  const response = await hit(port, host, `/_cora/auth?${new URLSearchParams({ pass, next })}`);
  return { response, cookie: response.headers["set-cookie"]?.[0]?.split(";")[0] || "", pass };
}

test("a share serves a folder's served version on its own host, only to the addresses its access names", async (t) => {
  const { app, port, call, agent, put, owner, cookie: panelCookie } = await fixture(t);
  put("site/index.html", "<h1>Report</h1><script>fetch('/api/state')</script>");
  put("site/about/index.html", "<h1>About</h1>");
  put("site/docs.html", "<h1>Docs</h1>");
  put("site/404.html", "<h1>Not here</h1>");
  put("site/media/clip.mp4", "0123456789");
  const pushed = await app.artifacts.push({ agent, folder: "clienti/acme/sito", path: "/home/agent/work/site", message: "sito", requester: { kind: "owner", id: "1", name: "Owner" },
    create: { title: "Sito Acme", description: "Il sito per Acme", kind: "site" } });
  await app.artifacts.review(pushed.commit.id, { decision: "approve", user: owner });
  const folderId = pushed.folder.id;

  for (const [body, error] of [
    [{ label: "report", access: {} }, /un link si apre solo per qualcuno/],
    [{ label: "report", access: { domains: ["gmail.com"] } }, /gmail\.com è di tutti/],
    [{ label: "p-0123456789ab", access: { emails: ["a@b.test"] } }, /almeno tre lettere/],
    [{ label: "a--b", access: { emails: ["a@b.test"] } }, /almeno tre lettere/],
  ]) {
    const refused = await call(`/api/artifacts/folders/${folderId}/shares`, { method: "POST", body });
    assert.equal(refused.status, 400);
    assert.match(refused.data.error, error);
  }
  const created = await call(`/api/artifacts/folders/${folderId}/shares`, { method: "POST", body: { label: "report", access: { emails: ["giulia@cliente.test"], domains: ["cliente.test"] } } });
  assert.equal(created.status, 201);
  assert.equal(created.data.url, `https://${SHARE}/`);
  assert.equal(created.data.view, "site");
  const share = created.data;

  const outside = await hit(port, SHARE, "/docs?x=1");
  assert.equal(outside.status, 302);
  assert.equal(outside.headers.location, `https://usecora.test/share?${new URLSearchParams({ to: SHARE, next: "/docs?x=1" })}`, "a visitor proves who they are at usecora.space first");
  const api = await hit(port, SHARE, "/api/state", { headers: { cookie: panelCookie } });
  assert.equal(api.status, 302, "nothing of the panel answers on a share host, whatever cookie comes along");
  assert.equal((await hit(port, SHARE, "/", { method: "POST" })).status, 405);

  const elsewhere = await enter(port, "other--acme.usecora.test", { email: "giulia@cliente.test", via: "email" });
  const wrongHost = await hit(port, SHARE, `/_cora/auth?${new URLSearchParams({ pass: elsewhere.pass })}`);
  assert.equal(wrongHost.status, 302);
  assert.match(wrongHost.headers.location, /^https:\/\/usecora\.test\/share\?/, "a pass for another host does not open this one");
  const stranger = await enter(port, SHARE, { email: "mario@other.test", via: "google" });
  assert.equal(stranger.response.status, 403);
  assert.match(stranger.response.body, /mario@other\.test non è tra chi può aprire questo link/);
  assert.equal(stranger.cookie, "");
  const personal = await enter(port, SHARE, { email: "boss@cliente.test", via: "google", hd: "" });
  assert.equal(personal.response.status, 403, "a Google account under the domain's address that is not its Workspace's does not count for the domain");
  const workspace = await enter(port, SHARE, { email: "boss@cliente.test", via: "google", hd: "cliente.test" }, "/docs");
  assert.equal(workspace.response.status, 302);
  assert.equal(workspace.response.headers.location, "/docs");
  assert.match(workspace.cookie, /^cora_share=v1\./);
  assert.doesNotMatch(workspace.response.headers["set-cookie"].join(";"), /cora_session/, "a share host never sets the panel's cookie");
  const replay = await hit(port, SHARE, `/_cora/auth?${new URLSearchParams({ pass: workspace.pass })}`);
  assert.equal(replay.status, 302);
  assert.match(replay.headers.location, /usecora\.test\/share/, "a pass works once");
  const mailbox = await enter(port, SHARE, { email: "anyone@cliente.test", via: "email" });
  assert.equal(mailbox.response.status, 302, "a link sent to a mailbox of the domain proves it");
  const named = await enter(port, SHARE, { email: "giulia@cliente.test", via: "google" });
  const cookie = named.cookie;

  const page = async (path, headers = {}) => hit(port, SHARE, path, { headers: { cookie, ...headers } });
  const home = await page("/");
  assert.equal(home.status, 200);
  assert.equal(home.headers["content-type"], "text/html; charset=utf-8");
  assert.match(home.body, /<h1>Report<\/h1><script>/, "a shared site runs as a site, on its own address");
  assert.equal(home.headers["x-robots-tag"], "noindex, nofollow");
  assert.equal(home.headers["x-content-type-options"], "nosniff");
  assert.doesNotMatch(home.headers.etag, new RegExp(pushed.files.find((file) => file.path === "index.html").sha256.slice(0, 12)), "the ETag never gives the file's hash away");
  assert.equal((await page("/", { "if-none-match": home.headers.etag })).status, 304);
  const folder = await page("/about?ref=1");
  assert.equal(folder.status, 302);
  assert.equal(folder.headers.location, "/about/?ref=1");
  assert.equal((await page("/about/")).body, "<h1>About</h1>");
  assert.equal((await page("/docs")).body, "<h1>Docs</h1>");
  const missing = await page("/nowhere");
  assert.equal(missing.status, 404);
  assert.equal(missing.body, "<h1>Not here</h1>");
  const escape = await page("//evil.test/");
  assert.equal(escape.status, 404);
  assert.equal(escape.headers.location, undefined, "no redirect to another host");
  assert.equal((await page("/%2e%2e/%2e%2e/etc/passwd")).status, 404);
  const part = await page("/media/clip.mp4", { range: "bytes=2-5" });
  assert.equal(part.status, 206);
  assert.equal(part.body, "2345");
  assert.equal(part.headers["content-range"], "bytes 2-5/10");
  assert.equal((await page("/media/clip.mp4", { range: "bytes=20-" })).status, 416);
  const head = await hit(port, SHARE, "/docs.html", { method: "HEAD", headers: { cookie } });
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  const files = JSON.parse((await page("/_cora/files.json")).body);
  assert.deepEqual(files.files.map((file) => file.path).sort(), ["404.html", "about/index.html", "docs.html", "index.html", "media/clip.mp4"]);

  const narrowed = await call(`/api/artifacts/shares/${share.id}`, { method: "PUT", body: { access: { emails: ["giulia@cliente.test"] } } });
  assert.equal(narrowed.data.revision, 2);
  assert.equal((await page("/")).status, 302, "changing who may enter closes the doors already open");
  const again = await enter(port, SHARE, { email: "giulia@cliente.test", via: "email" });
  assert.equal((await hit(port, SHARE, "/", { headers: { cookie: again.cookie } })).status, 200);
  assert.equal((await enter(port, SHARE, { email: "anyone@cliente.test", via: "email" })).response.status, 403);
  await call(`/api/artifacts/shares/${share.id}`, { method: "PUT", body: { status: "revoked" } });
  const revoked = await hit(port, SHARE, "/", { headers: { cookie: again.cookie } });
  assert.equal(revoked.status, 404);
  assert.match(revoked.body, /Questo link non esiste più/);

  const listing = await call(`/api/artifacts/folders/${folderId}/shares`, { method: "POST", body: { label: "materiali", view: "files", access: { emails: ["giulia@cliente.test"] } } });
  const filesHost = "materiali--acme.usecora.test";
  const inFiles = await enter(port, filesHost, { email: "giulia@cliente.test", via: "email" });
  const list = await hit(port, filesHost, "/", { headers: { cookie: inFiles.cookie } });
  assert.equal(list.status, 200);
  assert.match(list.body, /about\/.*media\/.*404\.html.*docs\.html.*index\.html/s);
  assert.match(list.headers["content-security-policy"], /default-src 'none'/);
  const download = await hit(port, filesHost, "/index.html", { headers: { cookie: inFiles.cookie } });
  assert.equal(download.headers["content-type"], "application/octet-stream", "in a folder of files a page downloads, it does not run");
  assert.match(download.headers["content-disposition"], /^attachment/);
  assert.equal((await hit(port, filesHost, "/media", { headers: { cookie: inFiles.cookie } })).headers.location, "/media/");
  assert.equal(listing.status, 201);
});

test("a commit's preview host opens only for its folder's reviewers, and the cloud asks before it mails", async (t) => {
  const { app, port, base, call, agent, put, owner } = await fixture(t);
  put("draft/index.html", "<h1>Draft</h1><img src=\"/logo.svg\">");
  put("draft/logo.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  const pushed = await app.artifacts.push({ agent, folder: "bozze", path: "/home/agent/work/draft", message: "bozza", requester: { kind: "owner", id: "1", name: "Owner" }, create: { description: "Bozze", kind: "site" } });
  const view = await call(`/api/artifacts/commits/${pushed.commit.id}`);
  const preview = `p-${pushed.commit.id.slice(3)}--acme.usecora.test`;
  assert.equal(view.data.previewUrl, `https://${preview}/`);
  const reviewer = await enter(port, preview, { email: OWNER.email, via: "google" });
  assert.equal(reviewer.response.status, 302);
  const shown = await hit(port, preview, "/logo.svg", { headers: { cookie: reviewer.cookie } });
  assert.equal(shown.headers["content-type"], "image/svg+xml", "absolute paths work on the commit's own address");
  const member = await enter(port, preview, { email: "alice@company.test", via: "google" });
  assert.equal(member.response.status, 403, "someone who does not review this folder does not see its drafts");
  assert.equal(owner.role, "owner");

  await call(`/api/artifacts/folders/${pushed.folder.id}/shares`, { method: "POST", body: { label: "bozza", access: { emails: ["giulia@cliente.test"] } } });
  const ask = async (email, host = "bozza--acme.usecora.test") => {
    const pass = signPass(keys.privateKey, { aud: "share-access:acme.usecora.test", host, email });
    const response = await fetch(`${base}/api/cloud/share-access`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ pass }) });
    return { status: response.status, data: await response.json(), pass };
  };
  const yes = await ask("giulia@cliente.test");
  assert.equal(yes.data.allowed, true);
  assert.equal(yes.data.title, "bozze");
  const no = await ask("mario@other.test");
  assert.deepEqual(no.data, { allowed: false, title: "", language: "it" });
  assert.equal((await ask("giulia@cliente.test", "nothere--acme.usecora.test")).data.allowed, false);
  const replay = await fetch(`${base}/api/cloud/share-access`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ pass: yes.pass }) });
  assert.equal(replay.status, 403);
});
