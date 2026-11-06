import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { createDecipheriv } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { startCora } from "../src/main.js";
import { executeTool } from "../src/tools.js";
import { passKeys, signPass } from "../src/pass.js";
import { fakeDocker, tempHome } from "./helpers.js";

const SEED = "fixture-share-signing-seed-for-tests-only-0123456789abc";
const keys = passKeys(SEED);
const OWNER = { sub: "ac_owner", role: "owner", name: "Owner", email: "owner@example.test", emailVerified: true };
const SHARE = "report--acme.usecora.test";

/** A request to the instance as if it came through the cloud for another host: Host is what decides. */
function hit(port, host, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path, method, headers: { host, ...headers } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end(body);
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
    [{ label: "report", access: {} }, /aggiungi almeno un indirizzo.*pubblico o con password/],
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

test("a share can be public, or open with a password; addresses are lowercase however they are written", async (t) => {
  const { app, port, base, call, agent, put, owner } = await fixture(t);
  put("open/index.html", "<h1>Open</h1>");
  const pushed = await app.artifacts.push({ agent, folder: "aperta", path: "/home/agent/work/open", message: "pagina", requester: { kind: "owner", id: "1", name: "Owner" }, create: { description: "Pagine aperte", kind: "site" } });
  await app.artifacts.review(pushed.commit.id, { decision: "approve", user: owner });
  const folderId = pushed.folder.id;
  const shares = (body) => call(`/api/artifacts/folders/${folderId}/shares`, { method: "POST", body });

  const open = await shares({ label: "Vetrina", access: { mode: "public" } });
  assert.equal(open.status, 201);
  assert.equal(open.data.label, "vetrina");
  assert.equal(open.data.access.mode, "public");
  const shown = await hit(port, "vetrina--acme.usecora.test", "/");
  assert.equal(shown.status, 200, "a public share opens for anyone with the link, signed in nowhere");
  assert.equal(shown.body, "<h1>Open</h1>");
  assert.equal(shown.headers["x-robots-tag"], "noindex, nofollow", "and still stays out of search engines");
  assert.equal(shown.headers["set-cookie"], undefined);
  assert.equal((await hit(port, "VETRINA--acme.usecora.test", "/")).status, 200, "a host is the same host in capitals");

  assert.match((await shares({ label: "chiusa", access: { mode: "password", password: "corta" } })).data.error, /almeno 6/);
  const locked = await shares({ label: "chiusa", access: { mode: "password", password: "fixture-door-1" } });
  assert.equal(locked.status, 201);
  assert.equal(locked.data.access.mode, "password");
  assert.equal(locked.data.access.password, undefined, "the panel never gets the password, or its hash, back");
  assert.equal(JSON.stringify(app.store.artifactShares(folderId)).includes("fixture-door-1"), false, "only a hash of it is kept");
  const HOST = "chiusa--acme.usecora.test";
  const outside = await hit(port, HOST, "/about?x=1");
  assert.equal(outside.status, 302);
  assert.equal(outside.headers.location, `/_cora/password?${new URLSearchParams({ next: "/about?x=1" })}`, "the password is asked on the share's own host, not at usecora.space");
  const form = await hit(port, HOST, outside.headers.location);
  assert.equal(form.status, 200);
  assert.match(form.body, /<input id="password" name="password" type="password"/);
  assert.match(form.headers["content-security-policy"], /form-action 'self'/);
  const post = (password, headers = { "sec-fetch-site": "same-origin" }) => hit(port, HOST, "/_cora/password?next=%2Fabout", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams({ password }).toString() });
  assert.equal((await post("fixture-door-1", { "sec-fetch-site": "cross-site" })).status, 403, "another site cannot post the form");
  assert.equal((await post("fixture-door-1", { origin: "https://evil.test" })).status, 403);
  const wrong = await post("not-the-door");
  assert.equal(wrong.status, 401);
  assert.match(wrong.body, /Password sbagliata/);
  const right = await post("fixture-door-1");
  assert.equal(right.status, 302);
  assert.equal(right.headers.location, "/about");
  const cookie = right.headers["set-cookie"][0].split(";")[0];
  assert.equal((await hit(port, HOST, "/", { headers: { cookie } })).body, "<h1>Open</h1>");
  const email = await enter(port, HOST, { email: "giulia@cliente.test", via: "email" });
  assert.equal(email.response.status, 403, "a password share is not opened by an address");
  const asked = await fetch(`${base}/api/cloud/share-access`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" },
    body: JSON.stringify({ pass: signPass(keys.privateKey, { aud: "share-access:acme.usecora.test", host: HOST, email: "owner@example.test" }) }) });
  assert.equal((await asked.json()).allowed, false, "and the cloud mails no link for it");

  for (let i = 0; i < 10; i += 1) await post(`wrong-${i}`);
  const blocked = await post("fixture-door-1");
  assert.equal(blocked.status, 429, "ten wrong passwords in ten minutes, then a pause even for the right one");
  assert.match(blocked.body, /Troppi tentativi/);

  const unset = await call(`/api/artifacts/shares/${open.data.id}`, { method: "PUT", body: { access: { mode: "password" } } });
  assert.equal(unset.status, 400, "a share turns to a password only with one");
  assert.match(unset.data.error, /scegli la password/);
  const kept = await call(`/api/artifacts/shares/${locked.data.id}`, { method: "PUT", body: { access: { mode: "password" } } });
  assert.equal(kept.status, 200, "an edit without a new password keeps the one it had");
  assert.equal(app.artifacts.passwordOpens(app.store.artifactShare(locked.data.id), "fixture-door-1"), true);
  const renewed = await call(`/api/artifacts/shares/${locked.data.id}`, { method: "PUT", body: { access: { mode: "password", password: "fixture-door-2" } } });
  assert.equal(renewed.status, 200);
  assert.equal((await hit(port, HOST, "/", { headers: { cookie } })).status, 302, "a new password sends out who came in with the old one");
  assert.equal(app.artifacts.passwordOpens(app.store.artifactShare(locked.data.id), "fixture-door-2"), true);
  assert.equal(app.artifacts.passwordOpens(app.store.artifactShare(locked.data.id), "fixture-door-1"), false);

  const people = await shares({ label: "persone", access: { emails: " Giulia@Cliente.TEST, MARIO@cliente.test ", domains: ["Studio.TEST"] } });
  assert.equal(people.status, 201);
  assert.deepEqual([people.data.access.mode, people.data.access.emails, people.data.access.domains], ["people", ["giulia@cliente.test", "mario@cliente.test"], ["studio.test"]]);
  const giulia = await enter(port, "persone--acme.usecora.test", { email: "GIULIA@cliente.test", via: "google" });
  assert.equal(giulia.response.status, 302, "an address is the same address in capitals");
});

test("files uploaded from the panel land where the person is: a reviewer publishes them, anyone else proposes", async (t) => {
  const { app, base, cookie, call, agent, put, owner } = await fixture(t);
  put("site/index.html", "<h1>Home</h1>");
  const pushed = await app.artifacts.push({ agent, folder: "caricati", path: "/home/agent/work/site", message: "sito", requester: { kind: "owner", id: "1", name: "Owner" }, create: { description: "Caricati dal pannello", kind: "site" } });
  await app.artifacts.review(pushed.commit.id, { decision: "approve", user: owner });
  const folderId = pushed.folder.id;
  const blob = (content, headers = {}, who = cookie) => fetch(`${base}/api/artifacts/folders/${folderId}/blobs`, { method: "POST", headers: { Cookie: who, "X-Cora": "1", "Content-Type": "application/octet-stream", ...headers }, body: content });
  const sent = await blob("<h1>Chi siamo</h1>");
  assert.equal(sent.status, 201);
  const about = await sent.json();
  assert.equal(about.size, 18);
  assert.equal((await blob("x", { "X-Cora": "" })).status, 403, "a page elsewhere cannot upload");
  const logo = await (await blob(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]))).json();

  const placed = await call(`/api/artifacts/folders/${folderId}/upload`, { method: "POST", body: { dir: "chi-siamo", base: pushed.commit.id, files: [{ path: "index.html", sha: about.sha }, { path: "img/logo.png", sha: logo.sha }] } });
  assert.equal(placed.status, 201);
  assert.equal(placed.data.commit.status, "published", "the owner reviews this folder, so an upload goes on air at once");
  assert.equal(placed.data.commit.message, "Caricati 2 file in chi-siamo");
  const folder = await call(`/api/artifacts/folders/${folderId}`);
  assert.deepEqual(folder.data.tree.map((file) => file.path), ["chi-siamo/img/logo.png", "chi-siamo/index.html", "index.html"], "they sit under the folder the person was in, beside what was there");
  assert.equal(folder.data.folder.head, placed.data.commit.id);

  const again = await call(`/api/artifacts/folders/${folderId}/upload`, { method: "POST", body: { files: [{ path: "index.html", sha: about.sha }] } });
  assert.equal(again.status, 201, "at the root by default, over the file that was there");
  assert.deepEqual(again.data.commit.changed.map((change) => [change.kind, change.path]), [["modified", "index.html"]]);
  const stale = await call(`/api/artifacts/folders/${folderId}/upload`, { method: "POST", body: { base: placed.data.commit.id, files: [{ path: "nuovo.txt", sha: logo.sha }] } });
  assert.equal(stale.status, 201, "made on an older version, it is laid over the new one");
  assert.ok((await call(`/api/artifacts/folders/${folderId}`)).data.tree.some((file) => file.path === "index.html" && file.sha === about.sha));

  const foreign = await call(`/api/artifacts/folders/${folderId}/upload`, { method: "POST", body: { files: [{ path: "copia.html", sha: pushed.files.find((file) => file.path === "index.html").sha256 }] } });
  assert.equal(foreign.status, 201, "a file of this folder's own history counts as held");
  assert.equal((await call(`/api/artifacts/folders/${folderId}/upload`, { method: "POST", body: { files: [{ path: "x.txt", sha: "a".repeat(64) }] } })).status, 409, "holding a hash is not having the file");
  for (const path of ["../fuori.txt", "/assoluto.txt", "a//b.txt", "_cora/x"]) {
    assert.equal((await call(`/api/artifacts/folders/${folderId}/upload`, { method: "POST", body: { files: [{ path, sha: about.sha }] } })).status, 400, path);
  }
  assert.equal((await call(`/api/artifacts/folders/${folderId}/upload`, { method: "POST", body: { dir: "../su", files: [{ path: "a.txt", sha: about.sha }] } })).status, 400);
  const token = await (await blob(`STRIPE=${"sk_live_"}${"0123456789abcdefghijklmn"}\n`)).json();
  const refused = await call(`/api/artifacts/folders/${folderId}/upload`, { method: "POST", body: { files: [{ path: "conf.txt", sha: token.sha }] } });
  assert.equal(refused.status, 422);
  assert.match(refused.data.error, /conf\.txt \(riga 1\).*cassaforte/);
  const huge = await new Promise((resolve, reject) => {
    const request = http.request(`${base}/api/artifacts/folders/${folderId}/blobs`, { method: "POST", headers: { Cookie: cookie, "X-Cora": "1", "Content-Length": String(200 * 1024 * 1024) } }, (response) => { response.resume(); resolve(response.statusCode); });
    request.on("error", reject);
    request.write("abc");
  });
  assert.equal(huge, 413, "a file over the limit is refused before it arrives");

  await call("/api/access", { method: "PUT", body: { domains: ["company.test"] } });
  const entered = await fetch(`${base}/auth/cloud?${new URLSearchParams({ pass: signPass(keys.privateKey, { aud: "acme.usecora.test", sub: "ac_member", role: "member", name: "Sara", email: "sara@company.test", emailVerified: true }) })}`, { redirect: "manual" });
  const member = entered.headers.get("set-cookie").split(";")[0];
  assert.equal((await blob("<p>bozza</p>", {}, member)).status, 201);
  const draft = await (await blob("<p>bozza di Sara</p>", {}, member)).json();
  const theirs = await fetch(`${base}/api/artifacts/folders/${folderId}/upload`, { method: "POST", headers: { Cookie: member, "X-Cora": "1", "Content-Type": "application/json" }, body: JSON.stringify({ files: [{ path: "bozza.html", sha: draft.sha }] }) });
  const proposal = await theirs.json();
  assert.equal(theirs.status, 201);
  assert.equal(proposal.commit.status, "proposed", "someone who does not review the folder proposes, like an agent");
  const owners = await (await blob("<p>solo del proprietario</p>")).json();
  const lifted = await fetch(`${base}/api/artifacts/folders/${folderId}/upload`, { method: "POST", headers: { Cookie: member, "X-Cora": "1", "Content-Type": "application/json" }, body: JSON.stringify({ files: [{ path: "preso.html", sha: owners.sha }] }) });
  assert.equal(lifted.status, 409, "what another person uploaded and never placed stays theirs");
});

test("a folder of files opens like a drive: cards, search, a page per file, a zip of it all, and every visit in the folder's log", async (t) => {
  const { app, port, call, agent, put, owner } = await fixture(t);
  put("drive/docs/report.csv", "mese,vendite\ngennaio,120\n\"febbraio, corto\",98\n");
  put("drive/docs/nota.md", "# Nota\n\nPrima riga <b>non HTML</b>\n");
  put("drive/foto.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
  put("drive/index.html", "<script>alert(1)</script><h1>Ciao</h1>");
  put("drive/dati.bin", Buffer.from([0, 1, 2, 3, 4, 5]));
  const pushed = await app.artifacts.push({ agent, folder: "condivisi/drive", path: "/home/agent/work/drive", message: "file", requester: { kind: "owner", id: "1", name: "Owner" }, create: { title: "Materiali", description: "File da condividere", kind: "files" } });
  await app.artifacts.review(pushed.commit.id, { decision: "approve", user: owner });
  const folderId = pushed.folder.id;
  const made = await call(`/api/artifacts/folders/${folderId}/shares`, { method: "POST", body: { label: "materiali", view: "files", access: { mode: "public" } } });
  assert.equal(made.status, 201);
  const HOST = "materiali--acme.usecora.test";
  const get = (path, headers = {}) => hit(port, HOST, path, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605 Chrome/131.0 Safari/537", ...headers } });

  const home = await get("/", { "sec-fetch-dest": "document" });
  assert.equal(home.status, 200);
  assert.match(home.headers["content-security-policy"], /default-src 'none'/);
  assert.doesNotMatch(home.headers["content-security-policy"], /script-src/, "the drive runs no script");
  assert.match(home.body, /<h2>Cartelle<\/h2>.*href="\/docs\/".*<b>docs<\/b>.*2 file/s, "folders first, with what they hold");
  assert.match(home.body, /<img loading="lazy" decoding="async" src="\/foto\.png"/, "pictures show as themselves");
  assert.match(home.body, /href="\/_cora\/view\/index\.html"/, "a file opens on a page of its own");
  assert.match(home.body, /href="\/dati\.bin\?download=1"/, "and downloads in one click");
  assert.match(home.body, /href="\/_cora\/zip"/, "the whole folder downloads as one zip");
  assert.match(home.body, /Condiviso da Owner · 5 file/);
  assert.match(home.body, /<link rel="icon" href="\/_cora\/icon\.svg"/);
  const mark = await hit(port, HOST, "/_cora/icon.svg");
  assert.equal(mark.headers["content-type"], "image/svg+xml", "the tab shows Cora's mark");
  assert.match(mark.body, /^<svg /);
  assert.doesNotMatch(home.body, /<script>alert/);
  const found = await get("/?q=NOTA");
  assert.match(found.body, /Risultati per «NOTA»/);
  assert.match(found.body, /<b title="nota\.md">nota\.md<\/b><small>[^<]* · docs<\/small>/, "a search runs over the whole folder, saying where each file is");
  assert.doesNotMatch(found.body, /report\.csv/);
  const list = await get("/docs/?v=list");
  assert.match(list.body, /class="row head"/);
  assert.match(list.body, /nota\.md.*report\.csv/s);

  const sheet = await get("/_cora/view/docs/report.csv", { "sec-fetch-dest": "document" });
  assert.equal(sheet.status, 200);
  assert.match(sheet.body, /<th>mese<\/th><th>vendite<\/th>.*<td>febbraio, corto<\/td><td>98<\/td>/s, "a table reads as a table");
  assert.match(sheet.body, /href="\/_cora\/view\/docs\/nota\.md"/, "the file before it is a click away");
  assert.match(sheet.body, /href="\/docs\/"/, "and so is its folder");
  const source = await get("/_cora/view/index.html");
  assert.match(source.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, "a page in a folder of files shows as its source, never running");
  assert.match(source.headers["content-security-policy"], /default-src 'none'/);
  const image = await get("/_cora/view/foto.png");
  assert.match(image.body, /<img src="\/foto\.png"/);
  assert.equal((await get("/foto.png", { "sec-fetch-dest": "image" })).headers["content-type"], "image/png", "the preview fetches the picture itself");
  const saved = await get("/foto.png?download=1", { "sec-fetch-dest": "document" });
  assert.match(saved.headers["content-disposition"], /^attachment; filename="foto\.png"/);
  assert.equal((await get("/_cora/view/nowhere.txt")).status, 404);

  const zip = await new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: "/_cora/zip?dir=docs", headers: { host: HOST } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ headers: response.headers, body: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
  assert.equal(zip.headers["content-type"], "application/zip");
  assert.match(zip.headers["content-disposition"], /filename="docs\.zip"/);
  const archive = join(tempHome(), "docs.zip");
  writeFileSync(archive, zip.body);
  const listed = spawnSync("python3", ["-c", "import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print('|'.join(z.namelist())); print(z.read('report.csv').decode())", archive], { encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /^nota\.md\|report\.csv\nmese,vendite/, "a zip any tool opens, with the files as they are");

  await get("/_cora/view/docs/report.csv", { "sec-fetch-dest": "document" });
  const log = await call(`/api/artifacts/folders/${folderId}/events`);
  assert.equal(log.status, 200);
  const lines = log.data.events.map((event) => [event.kind, event.path || event.action || event.detail]).reverse();
  assert.deepEqual(lines, [
    ["share", "created"], ["open", ""], ["search", "NOTA"], ["view", "docs/report.csv"], ["view", "index.html"], ["view", "foto.png"],
    ["download", "foto.png"], ["download", "docs/"],
  ], "opening, searching, viewing and downloading, once each within a minute; what a page embeds is not a view");
  const viewing = log.data.events.find((event) => event.kind === "view");
  assert.equal(viewing.who.via, "public");
  assert.match(viewing.who.visitor, /^[a-z0-9_-]{6}$/);
  assert.equal(viewing.who.device, "Chrome · macOS");
  assert.equal(log.data.events.find((event) => event.kind === "share").by.name, "Owner");
  const folder = await call(`/api/artifacts/folders/${folderId}`);
  assert.deepEqual(folder.data.activity[made.data.id], { views: 3, downloads: 2, visits: 1, last: folder.data.activity[made.data.id].last });
  await call(`/api/artifacts/shares/${made.data.id}`, { method: "PUT", body: { status: "revoked" } });
  assert.equal((await call(`/api/artifacts/folders/${folderId}/events?share=${made.data.id}`)).data.events[0].action, "revoked");
});

test("the artifacts may take half the disk they live on, unless the owner sets a limit in Settings", async (t) => {
  const { app, base, cookie, call, agent } = await fixture(t);
  const before = await call("/api/artifacts");
  assert.equal(before.data.quota.custom, false);
  assert.ok(before.data.quota.disk.total > 0);
  assert.equal(before.data.quota.limit, Math.floor(before.data.quota.disk.total / 2), "half the disk unless someone chose otherwise");
  assert.equal((await call("/api/state")).data.artifacts.space.limit, before.data.quota.limit, "the owner's state carries it for Settings");
  const set = await call("/api/settings", { method: "PUT", body: { artifactQuotaGb: 3 } });
  assert.equal(set.data.artifactQuotaGb, 3);
  const after = await call("/api/artifacts");
  assert.deepEqual([after.data.quota.limit, after.data.quota.custom], [3 * 1024 ** 3, true]);
  assert.equal((await call("/api/settings", { method: "PUT", body: { artifactQuotaGb: -5 } })).data.artifactQuotaGb, 0, "a negative limit is no limit of the owner's");

  await call("/api/settings", { method: "PUT", body: { artifactQuotaGb: 1 } });
  const folder = app.artifacts.createFolder({ path: "pieno", description: "per la quota", createdBy: { kind: "user", id: "1", name: "Owner" } });
  app.store.artifactBytes = () => 1024 ** 3 - 4;
  const full = await fetch(`${base}/api/artifacts/folders/${folder.id}/blobs`, { method: "POST", headers: { Cookie: cookie, "X-Cora": "1", "Content-Type": "application/octet-stream" }, body: "0123456789" });
  assert.equal(full.status, 507);
  assert.match((await full.json()).error, /Impostazioni → Spazio/, "the refusal says where to raise it");
  assert.ok(agent);
});

test("the panel frames a PDF from an address apart from itself, signed for one file and a few minutes", async (t) => {
  const { app, port, base, cookie, call, agent, put, owner } = await fixture(t);
  put("docs/report.pdf", "%PDF-1.4\n% fixture\n");
  put("docs/altro.pdf", "%PDF-1.4\n% other\n");
  const pushed = await app.artifacts.push({ agent, folder: "documenti", path: "/home/agent/work/docs", message: "pdf", requester: { kind: "owner", id: "1", name: "Owner" }, create: { description: "PDF", kind: "files" } });
  await app.artifacts.review(pushed.commit.id, { decision: "approve", user: owner });
  const panel = await fetch(`${base}/`, { headers: { Cookie: cookie } });
  assert.match(panel.headers.get("content-security-policy"), /frame-src 'self' https:\/\/\*\.usecora\.test/, "the panel may frame its space's preview hosts, nothing else");
  const view = await call(`/api/artifacts/commits/${pushed.commit.id}/view?${new URLSearchParams({ path: "report.pdf" })}`);
  assert.equal(view.status, 200);
  const url = new URL(view.data.url);
  assert.equal(url.host, `r-${pushed.commit.id.slice(3)}--acme.usecora.test`);
  assert.equal(url.pathname, "/report.pdf");
  const shown = await hit(port, url.host, `${url.pathname}${url.search}`);
  assert.equal(shown.status, 200);
  assert.equal(shown.headers["content-type"], "application/pdf");
  assert.equal(shown.headers["content-security-policy"], "frame-ancestors https://acme.usecora.test", "only the panel of this space may frame it");
  assert.equal(shown.headers["set-cookie"], undefined);
  assert.equal((await hit(port, url.host, `/altro.pdf${url.search}`)).status, 403, "the signature is for one file");
  assert.equal((await hit(port, url.host, url.pathname)).status, 403, "and nothing opens without it");
  const [expires, signature] = url.searchParams.get("t").split(".");
  assert.equal((await hit(port, url.host, `${url.pathname}?t=${Number(expires) + 600000}.${signature}`)).status, 403, "nor for longer than it was given");
  assert.equal((await hit(port, url.host, `${url.pathname}${url.search}`, { method: "POST" })).status, 405);
  assert.equal((await call(`/api/artifacts/commits/${pushed.commit.id}/view?path=nowhere.pdf`)).status, 404);
  const label = await call(`/api/artifacts/folders/${pushed.folder.id}/shares`, { method: "POST", body: { label: "r-0123456789ab", access: { mode: "public" } } });
  assert.equal(label.status, 400, "no link can take a preview address's name");
});

test("a secret sent to named people lives on its own host: they sign in like to a folder, and the log names them", async (t) => {
  const { app, port, base, call } = await fixture(t);
  await call("/api/secrets", { method: "POST", body: { name: "ACME_TOKEN", value: "token-fixture-value", agents: ["*"] } });
  const made = await call("/api/secrets/ACME_TOKEN/sends", { method: "POST", body: { views: 1, days: 1, access: { mode: "people", emails: ["Giulia@Cliente.test"] } } });
  assert.equal(made.status, 201);
  const link = new URL(made.data.url);
  const HOST = `v-${made.data.id.slice(3)}--acme.usecora.test`;
  assert.equal(link.host, HOST, "a send has an address of its own, like a shared folder");
  const key = link.hash.slice(1);
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  const outside = await hit(port, HOST, "/");
  assert.equal(outside.status, 200, "the page loads, so it can keep the key while its visitor signs in");
  assert.match(outside.body, new RegExp(`href="https://usecora\\.test/share\\?to=${HOST.replace(/\./g, "\\.")}&amp;next=%2F"`));
  assert.match(outside.headers["content-security-policy"], /script-src 'self'/);
  assert.equal((await hit(port, HOST, "/_cora/send.js")).headers["content-type"], "text/javascript; charset=utf-8");
  const openWith = (cookie = "") => hit(port, HOST, "/_cora/open", { method: "POST", headers: { "x-cora": "1", "sec-fetch-site": "same-origin", "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: "{}" });
  assert.equal((await openWith()).status, 403, "nobody gets the bytes before signing in");

  const asked = async (email) => {
    const response = await fetch(`${base}/api/cloud/share-access`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" },
      body: JSON.stringify({ pass: signPass(keys.privateKey, { aud: "share-access:acme.usecora.test", host: HOST, email }) }) });
    return response.json();
  };
  assert.deepEqual(await asked("giulia@cliente.test"), { allowed: true, title: "un segreto mandato con Cora", language: "it" }, "the mail never names the secret");
  assert.equal((await asked("mario@other.test")).allowed, false);
  const stranger = await enter(port, HOST, { email: "mario@other.test", via: "google" });
  assert.equal(stranger.response.status, 403);
  const giulia = await enter(port, HOST, { email: "giulia@cliente.test", via: "email" });
  assert.equal(giulia.response.status, 302);
  const signed = await hit(port, HOST, "/", { headers: { cookie: giulia.cookie } });
  assert.match(signed.body, /<button id="open" type="button">/, "signed in, the page offers to show it");
  const sealed = await openWith(giulia.cookie);
  assert.equal(sealed.status, 200);
  const body = JSON.parse(sealed.body);
  const raw = Buffer.from(body.data, "base64");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "base64url"), Buffer.from(body.iv, "base64"));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  assert.equal(Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]).toString("utf8"), "token-fixture-value");
  assert.equal((await openWith(giulia.cookie)).status, 404, "spent, the address is gone");

  const log = await call("/api/secrets/events");
  const kinds = log.data.events.map((event) => [event.kind, event.who?.email || ""]).reverse();
  assert.deepEqual(kinds, [["secret-created", ""], ["send-created", ""], ["send-page", ""], ["send-refused", "mario@other.test"], ["send-enter", "giulia@cliente.test"], ["send-page", "giulia@cliente.test"], ["send-opened", "giulia@cliente.test"]]);
  assert.ok(app.vault);
});

test("a site without an index shows its files, and a click serves the page itself", async (t) => {
  const { app, port, call, agent, put, owner } = await fixture(t);
  put("landing/v1/landing.html", "<h1>Landing</h1>");
  put("landing/v1/style.css", "h1{color:red}");
  put("landing/onboarding.html", "<h1>Onboarding</h1>");
  const pushed = await app.artifacts.push({ agent, folder: "landing", path: "/home/agent/work/landing", message: "bozze", requester: { kind: "owner", id: "1", name: "Owner" }, create: { description: "Bozze della landing", kind: "site" } });
  await app.artifacts.review(pushed.commit.id, { decision: "approve", user: owner });
  await call(`/api/artifacts/folders/${pushed.folder.id}/shares`, { method: "POST", body: { label: "bozze-landing", view: "site", access: { mode: "public" } } });
  const HOST = "bozze-landing--acme.usecora.test";
  const top = await hit(port, HOST, "/");
  assert.equal(top.status, 200, "no index.html: the files instead of a 404");
  assert.match(top.body, /<b>v1<\/b>/);
  assert.match(top.body, /href="\/onboarding\.html"/, "on a site a page opens as itself");
  assert.doesNotMatch(top.body, /\/_cora\/view\//);
  assert.equal((await hit(port, HOST, "/v1")).headers.location, "/v1/", "a folder without an index is a place to list");
  const inside = await hit(port, HOST, "/v1/");
  assert.match(inside.body, /href="\/v1\/landing\.html"/);
  const page = await hit(port, HOST, "/v1/landing.html");
  assert.equal(page.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(page.body, "<h1>Landing</h1>");
  assert.equal((await hit(port, HOST, "/nowhere/")).status, 404);
});

test("a link can share any level of a folder: only what is under it, as if it were the whole folder", async (t) => {
  const { app, port, call, agent, put, owner } = await fixture(t);
  put("design/design-system/README.md", "# Design system");
  put("design/landing/index.html", "<h1>Landing</h1><script src=\"./vendor/react.js\"></script>");
  put("design/landing/vendor/react.js", "/* react */");
  const pushed = await app.artifacts.push({ agent, folder: "progetti/design", path: "/home/agent/work/design", message: "design", requester: { kind: "owner", id: "1", name: "Owner" }, create: { title: "design", description: "Design", kind: "files" } });
  await app.artifacts.review(pushed.commit.id, { decision: "approve", user: owner });
  const made = await call(`/api/artifacts/folders/${pushed.folder.id}/shares`, { method: "POST", body: { label: "solo-landing", view: "site", root: "/landing/", access: { mode: "public" } } });
  assert.equal(made.status, 201);
  assert.equal(made.data.root, "landing", "the root is kept clean");
  assert.equal((await call(`/api/artifacts/folders/${pushed.folder.id}/shares`, { method: "POST", body: { label: "fuori", view: "site", root: "../x", access: { mode: "public" } } })).status, 400);
  const HOST = "solo-landing--acme.usecora.test";
  const home = await hit(port, HOST, "/");
  assert.equal(home.body, "<h1>Landing</h1><script src=\"./vendor/react.js\"></script>", "the subfolder's index is the link's top");
  assert.equal((await hit(port, HOST, "/vendor/react.js")).body, "/* react */", "and its own paths work as they are");
  assert.equal((await hit(port, HOST, "/design-system/README.md")).status, 404, "nothing outside the subfolder is served");
  assert.equal((await hit(port, HOST, "/landing/index.html")).status, 404);
  const files = JSON.parse((await hit(port, HOST, "/_cora/files.json")).body);
  assert.deepEqual(files.files.map((file) => file.path).sort(), ["index.html", "vendor/react.js"]);
  const zip = await hit(port, HOST, "/_cora/zip");
  assert.match(zip.headers["content-disposition"], /filename="landing\.zip"/);
  const moved = await call(`/api/artifacts/shares/${made.data.id}`, { method: "PUT", body: { root: "" } });
  assert.equal(moved.data.root, "");
  assert.match((await hit(port, HOST, "/")).body, /<b>design-system<\/b>.*<b>landing<\/b>/s, "back to the whole folder, listed since it has no index");
});

test("the panel shows a web page as the site it belongs to, framed apart from itself, its links working", async (t) => {
  const { app, port, base, call, agent, put, owner } = await fixture(t);
  put("design/landing/index.html", "<link rel=\"stylesheet\" href=\"style.css\"><script src=\"/abs.js\"></script><h1>Landing</h1>");
  put("design/landing/style.css", "h1{color:red}");
  put("design/abs.js", "/* absolute */");
  put("design/docs/report.pdf", "%PDF-1.4\n");
  const pushed = await app.artifacts.push({ agent, folder: "progetti/design", path: "/home/agent/work/design", message: "design", requester: { kind: "owner", id: "1", name: "Owner" }, create: { title: "design", description: "Design", kind: "files" } });
  await app.artifacts.review(pushed.commit.id, { decision: "approve", user: owner });
  const view = await call(`/api/artifacts/commits/${pushed.commit.id}/view?${new URLSearchParams({ path: "landing/index.html" })}`);
  const url = new URL(view.data.url);
  assert.equal(url.host, `r-${pushed.commit.id.slice(3)}--acme.usecora.test`);
  const token = /^\/_t\/([^/]+)\/landing\/index\.html$/.exec(url.pathname)?.[1];
  assert.ok(token, "the token is in the path, so the page's relative links keep it");
  const page = await hit(port, url.host, url.pathname);
  assert.equal(page.status, 200);
  assert.equal(page.headers["content-type"], "text/html; charset=utf-8", "rendered as a page, not as text");
  assert.equal(page.headers["content-security-policy"], "frame-ancestors https://acme.usecora.test", "only the panel of this space may frame it");
  const cookie = page.headers["set-cookie"]?.[0]?.split(";")[0] || "";
  assert.match(cookie, /^cora_raw=/);
  assert.match(page.headers["set-cookie"][0], /HttpOnly; SameSite=Lax; Max-Age=\d+/);
  const style = await hit(port, url.host, `/_t/${token}/landing/style.css`);
  assert.equal(style.status, 200);
  assert.equal(style.headers["content-type"], "text/css; charset=utf-8");
  assert.equal((await hit(port, url.host, "/abs.js", { headers: { cookie } })).body, "/* absolute */", "an absolute link works through this host's own cookie");
  assert.equal((await hit(port, url.host, "/abs.js")).status, 403, "and nothing opens without either");
  const folderPath = await hit(port, url.host, `/_t/${token}/landing`);
  assert.equal(folderPath.status, 302);
  assert.equal(folderPath.headers.location, `/_t/${token}/landing/`);
  const [expires, signature] = token.split(".");
  assert.equal((await hit(port, url.host, `/_t/${Number(expires) + 600000}.${signature}/landing/index.html`)).status, 403, "not for longer than it was given");
  const other = await app.artifacts.push({ agent, folder: "altro", path: "/home/agent/work/design/landing", message: "altro", requester: { kind: "owner", id: "1", name: "Owner" }, create: { title: "altro", description: "Altro", kind: "site" } });
  assert.equal((await hit(port, `r-${other.commit.id.slice(3)}--acme.usecora.test`, `/_t/${token}/index.html`)).status, 403, "a token opens only its own commit");
  const pdf = new URL((await call(`/api/artifacts/commits/${pushed.commit.id}/view?${new URLSearchParams({ path: "docs/report.pdf" })}`)).data.url);
  assert.equal(pdf.pathname, "/docs/report.pdf", "a PDF is still signed for itself alone");

  await call("/api/access", { method: "PUT", body: { domains: ["company.test"] } });
  const entered = await fetch(`${base}/auth/cloud?${new URLSearchParams({ pass: signPass(keys.privateKey, { aud: "acme.usecora.test", sub: "ac_member", role: "member", name: "Sara", email: "sara@company.test", emailVerified: true }) })}`, { redirect: "manual" });
  const member = entered.headers.get("set-cookie").split(";")[0];
  const asMember = async (commitId) => (await (await fetch(`${base}/api/artifacts/commits/${commitId}/view?${new URLSearchParams({ path: "index.html" })}`, { headers: { Cookie: member, "X-Cora": "1" } })).json()).url;
  assert.match(await asMember(other.commit.id), /^$/, "a page nobody approved yet runs only for who reviews it");
  assert.match((await call(`/api/artifacts/commits/${other.commit.id}/view?${new URLSearchParams({ path: "index.html" })}`)).data.url, /\/_t\//, "the reviewer sees it running");
  await app.artifacts.review(other.commit.id, { decision: "approve", user: owner });
  assert.match(await asMember(other.commit.id), /\/_t\//, "once on air anyone in the panel sees it running");
});

test("an agent shares a folder itself when a person asks it, at any level and with any access; a routine only asks", async (t) => {
  const { app, port, agent, put, owner } = await fixture(t);
  put("design/landing/index.html", "<h1>Landing</h1>");
  put("design/notes.md", "# notes");
  const pushed = await app.artifacts.push({ agent, folder: "progetti/design", path: "/home/agent/work/design", message: "design", requester: { kind: "owner", id: "1", name: "Owner" }, create: { title: "design", description: "Design", kind: "files" } });
  await app.artifacts.review(pushed.commit.id, { decision: "approve", user: owner });
  const notices = [];
  app.artifacts.notice = (channelId, text) => notices.push({ channelId, text });
  const ctx = { agent, store: app.store, artifacts: app.artifacts, channelId: "chan-1", requester: { kind: "authorized", id: "42", name: "Sncl" } };
  const made = await executeTool({ name: "artifact_share", args: { folder: "progetti/design", subfolder: "landing", label: "landing-pubblica", access: "public", reason: "Sncl vuole il link" } }, ctx);
  assert.match(made.text, /^ACTIVE: https:\/\/landing-pubblica--acme\.usecora\.test\/ opens progetti\/design\/landing as a website to anyone with the link/);
  assert.equal((await hit(port, "landing-pubblica--acme.usecora.test", "/")).body, "<h1>Landing</h1>", "it works at once, from the subfolder");
  assert.match(notices[0].text, /Nico ha aperto un link pubblico per \*\*progetti\/design\/landing\*\*: https:\/\/landing-pubblica--acme\.usecora\.test/);
  const share = app.store.artifactShareByLabel("landing-pubblica");
  assert.equal(share.status, "active");
  assert.equal(share.createdBy.name, "Nico");
  assert.equal(share.requestedBy.name, "Sncl");
  assert.ok(app.store.artifactEvents(pushed.folder.id).some((event) => event.kind === "share" && event.action === "created" && event.by?.name === "Nico"), "the folder's log says who opened it");

  const locked = await executeTool({ name: "artifact_share", args: { folder: "progetti/design", label: "con-password", access: "password", days: 7, reason: "per il cliente" } }, ctx);
  const password = /the password (\S+) \(give it only to Sncl\)/.exec(locked.text)?.[1];
  assert.ok(password && password.length >= 6, locked.text);
  assert.match(locked.text, /, until \d{4}-\d{2}-\d{2}\./);
  assert.ok(app.artifacts.passwordOpens(app.store.artifactShareByLabel("con-password"), password));
  const people = await executeTool({ name: "artifact_share", args: { folder: "progetti/design", label: "per-acme", access: "people", emails: ["Ada@Acme.com"], domains: ["acme.com"], reason: "per Acme" } }, ctx);
  assert.match(people.text, /opens progetti\/design's files to only ada@acme\.com, anyone at acme\.com, after signing in/, "without an index it is a page of files");

  assert.match((await executeTool({ name: "artifact_share", args: { folder: "progetti/design", subfolder: "nowhere", label: "nowhere", access: "public", reason: "x" } }, ctx)).text, /^error: progetti\/design has no subfolder nowhere/);
  assert.match((await executeTool({ name: "artifact_share", args: { folder: "progetti/design/landing", label: "sbagliata", access: "public", reason: "x" } }, ctx)).text, /a subfolder goes in subfolder/);
  const stranger = app.store.createAgent({ name: "Ugo", model: "ollama/test-model", tools: true });
  app.artifacts.updateFolder(pushed.folder.id, { writers: [agent.id] }, owner);
  assert.match((await executeTool({ name: "artifact_share", args: { folder: "progetti/design", label: "di-ugo", access: "public", reason: "x" } }, { ...ctx, agent: stranger })).text, /^error: you may not share progetti\/design/);

  const routine = await executeTool({ name: "artifact_share", args: { folder: "progetti/design", label: "da-routine", access: "public", reason: "routine" } }, { ...ctx, requester: null });
  assert.match(routine.text, /^REQUESTED, NOT ACTIVE/);
  assert.equal(app.store.artifactShareByLabel("da-routine").status, "proposed");
  assert.equal((await hit(port, "da-routine--acme.usecora.test", "/")).status, 404, "a link only asked for opens nothing");
  assert.match(notices.at(-1).text, /Richiesta di un link per \*\*progetti\/design\*\* \(da-routine\) da Nico/);
});

test("from the panel a file or a whole subfolder comes out as a commit: a reviewer's goes on air, anyone else's is proposed", async (t) => {
  const { app, base, call, agent, put, owner } = await fixture(t);
  put("site/index.html", "<h1>Home</h1>");
  put("site/landing/index.html", "<h1>Landing</h1>");
  put("site/landing/img/logo.png", "png");
  put("site/old.txt", "old");
  const pushed = await app.artifacts.push({ agent, folder: "pulizie", path: "/home/agent/work/site", message: "sito", requester: { kind: "owner", id: "1", name: "Owner" }, create: { description: "Da pulire", kind: "site" } });
  await app.artifacts.review(pushed.commit.id, { decision: "approve", user: owner });
  const folderId = pushed.folder.id;
  const one = await call(`/api/artifacts/folders/${folderId}/remove`, { method: "POST", body: { base: pushed.commit.id, paths: ["old.txt"] } });
  assert.equal(one.status, 201);
  assert.equal(one.data.commit.status, "published");
  assert.equal(one.data.commit.message, "Eliminato old.txt");
  assert.deepEqual(one.data.commit.changed.map((change) => [change.kind, change.path]), [["deleted", "old.txt"]]);
  const dir = await call(`/api/artifacts/folders/${folderId}/remove`, { method: "POST", body: { base: one.data.commit.id, paths: ["/landing/"] } });
  assert.equal(dir.data.commit.message, "Eliminata la cartella landing");
  assert.deepEqual((await call(`/api/artifacts/folders/${folderId}`)).data.tree.map((file) => file.path), ["index.html"], "everything under the subfolder went with it");
  assert.equal((await call(`/api/artifacts/folders/${folderId}/remove`, { method: "POST", body: { paths: ["landing"] } })).status, 404, "what is not there cannot go");
  assert.equal((await call(`/api/artifacts/folders/${folderId}/remove`, { method: "POST", body: { paths: ["../fuori"] } })).status, 400);
  assert.equal((await call(`/api/artifacts/folders/${folderId}/remove`, { method: "POST", body: { paths: [] } })).status, 400);
  assert.match(app.store.recentActivity(20).map((item) => item.text).join("\n"), /Owner ha eliminato 2 file da pulizie/);

  await call("/api/access", { method: "PUT", body: { domains: ["company.test"] } });
  const entered = await fetch(`${base}/auth/cloud?${new URLSearchParams({ pass: signPass(keys.privateKey, { aud: "acme.usecora.test", sub: "ac_member", role: "member", name: "Sara", email: "sara@company.test", emailVerified: true }) })}`, { redirect: "manual" });
  const member = entered.headers.get("set-cookie").split(";")[0];
  const theirs = await fetch(`${base}/api/artifacts/folders/${folderId}/remove`, { method: "POST", headers: { Cookie: member, "X-Cora": "1", "Content-Type": "application/json" }, body: JSON.stringify({ paths: ["index.html"] }) });
  const proposal = await theirs.json();
  assert.equal(theirs.status, 201);
  assert.equal(proposal.commit.status, "proposed", "someone who does not review the folder only proposes it");
  assert.deepEqual((await call(`/api/artifacts/folders/${folderId}`)).data.tree.map((file) => file.path), ["index.html"], "and nothing goes until it is approved");
});

test("an agent sets who may push to a folder for the person asking; publishing without review only on the owner's word", async (t) => {
  const { app, agent, put } = await fixture(t);
  put("guida/guida.pdf", "%PDF-1.4\n");
  const vera = app.store.createAgent({ name: "Vera", model: "ollama/test-model", tools: true });
  const sncl = { kind: "authorized", id: "42", name: "Sncl" };
  const boss = { kind: "owner", id: "1", name: "Owner" };
  const pushed = await app.artifacts.push({ agent, folder: "clienti/nobrainer/docs", path: "/home/agent/work/guida", message: "guida", requester: boss, create: { title: "Docs", description: "I documenti di No Brainer" } });
  const receipt = app.artifacts.pushReceipt(pushed);
  assert.match(receipt, /^PROPOSED.*\nnew folder clienti\/nobrainer\/docs: every agent may push to it; each push waits for a reviewer\. Who may push changes with artifact_folder_update\./, "the agent knows who may push from the first receipt");
  const listed = JSON.parse((await executeTool({ name: "artifact_folders", args: {} }, { agent, store: app.store, artifacts: app.artifacts })).text).folders[0];
  assert.equal(listed.who_can_push, "all agents");

  const ctx = { agent, store: app.store, artifacts: app.artifacts, requester: sncl };
  const only = await executeTool({ name: "artifact_folder_update", args: { folder: "clienti/nobrainer/docs", writers: ["@vera", "Nico"] } }, ctx);
  assert.equal(only.text, "clienti/nobrainer/docs updated. Who may push: Nico, Vera. Publishing: each push waits for a reviewer. Title: Docs.");
  assert.deepEqual(app.store.artifactFolder(pushed.folder.id).writers.sort(), [agent.id, vera.id].sort());
  assert.match((await executeTool({ name: "artifact_folder_update", args: { folder: "clienti/nobrainer/docs", writers: ["Zorro"] } }, ctx)).text, /^error: no agent called Zorro: the agents are Nico, Vera/);
  assert.match((await executeTool({ name: "artifact_folder_update", args: { folder: "clienti/nobrainer/docs", policy: "direct" } }, ctx)).text, /^error: only the owner of the space decides/, "someone else asking cannot skip the review");
  assert.match((await executeTool({ name: "artifact_folder_update", args: { folder: "clienti/nobrainer/docs", writers: ["all"] } }, { ...ctx, requester: null })).text, /^error: a folder's settings change only while a person is asking you directly/);
  const direct = await executeTool({ name: "artifact_folder_update", args: { folder: "clienti/nobrainer/docs", writers: ["all"], policy: "direct" } }, { ...ctx, requester: boss });
  assert.equal(direct.text, "clienti/nobrainer/docs updated. Who may push: all agents. Publishing: published at once. Title: Docs.");
  assert.equal(app.store.artifactFolder(pushed.folder.id).policy, "direct");
  assert.match(app.store.recentActivity(20).map((item) => item.text).join("\n"), /Nico ha cambiato clienti\/nobrainer\/docs per Owner: possono caricare tutti gli agenti; si pubblica subito/);

  put("altro/a.txt", "a");
  await assert.rejects(app.artifacts.push({ agent, folder: "clienti/nobrainer/altro", path: "/home/agent/work/altro", message: "a", requester: sncl, create: { description: "Altro", policy: "direct" } }), /only the owner of the space decides/);
  const made = await app.artifacts.push({ agent, folder: "clienti/nobrainer/altro", path: "/home/agent/work/altro", message: "a", requester: boss, create: { description: "Altro", writers: ["Vera"], policy: "direct" } });
  assert.equal(made.commit.status, "published", "the owner asked for a folder that publishes at once");
  assert.deepEqual(made.folder.writers.sort(), [agent.id, vera.id].sort(), "the agent making it stays among who may push");
  assert.match(app.artifacts.pushReceipt(made), /^PUBLISHED.*\nnew folder clienti\/nobrainer\/altro: (Nico, Vera|Vera, Nico) may push to it; pushes are published at once\./);
});

test("a reviewer can ignore a proposal that is no longer needed: out of the reviews, kept in the history, nobody told", async (t) => {
  const { app, call, agent, put, owner } = await fixture(t);
  put("hero/index.html", "<h1>v1</h1>");
  const boss = { kind: "owner", id: "1", name: "Owner" };
  const first = await app.artifacts.push({ agent, folder: "progetti/hero", path: "/home/agent/work/hero", message: "v1", requester: boss, create: { description: "Hero" } });
  await app.artifacts.review(first.commit.id, { decision: "approve", user: owner });
  put("hero/index.html", "<h1>v2 superata</h1>");
  const stale = await app.artifacts.push({ agent, folder: "progetti/hero", path: "/home/agent/work/hero", message: "v2", requester: boss, channelId: "chan-1" });
  assert.equal(stale.commit.status, "proposed");
  const notices = [];
  app.artifacts.notice = (channelId, text) => notices.push(text);
  assert.equal((await call("/api/artifacts")).data.reviews.length, 1);
  const ignored = await call(`/api/artifacts/commits/${stale.commit.id}/review`, { method: "POST", body: { decision: "ignore" } });
  assert.equal(ignored.status, 200);
  assert.equal(ignored.data.commit.status, "ignored");
  assert.equal(ignored.data.commit.review.decision, "ignore");
  assert.equal((await call("/api/artifacts")).data.reviews.length, 0, "it leaves the reviews");
  assert.equal((await call(`/api/artifacts/folders/${first.folder.id}`)).data.folder.head, first.commit.id, "nothing goes on air");
  assert.ok((await call(`/api/artifacts/folders/${first.folder.id}`)).data.commits.some((commit) => commit.id === stale.commit.id && commit.status === "ignored"), "and it stays in the history");
  assert.deepEqual(notices, [], "the agent is not told: there is nothing to redo");
  assert.match(app.store.recentActivity(10).map((item) => item.text).join("\n"), /Owner ha ignorato [0-9a-f]{7} in progetti\/hero/);
  const again = await call(`/api/artifacts/commits/${stale.commit.id}/review`, { method: "POST", body: { decision: "approve" } });
  assert.equal(again.status, 409);
  assert.match(again.data.error, /già ignorato/);
  assert.equal((await call(`/api/artifacts/commits/${first.commit.id}/review`, { method: "POST", body: { decision: "nope" } })).status, 400);
});

test("a space on its own address has shares too: the cloud calls it by that address, with the share's host signed", async (t) => {
  const docker = fakeDocker();
  const app = startCora({ home: tempHome(), host: "127.0.0.1", port: 0, insecureCookies: true,
    adminPassword: "fixture-password", sessionKey: "fixture-session-own-address", useResidentSubscriptions: false,
    cloudUrl: "https://usecora.test", cloudKey: keys.publicKey, cloudSpace: "acme", publicHost: "cora-acme.example.test",
    discordToken: "", telegramToken: "", ollamaKey: "", orcaKey: "", claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes",
    botTokenFor: () => "", docker: docker.path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  t.after(() => app.stop());
  const port = app.server.address().port;
  assert.equal(app.artifacts.shareSuffix, "--acme.usecora.test", "shares are on, though the space has its own address");
  const agent = app.store.createAgent({ name: "Nico", model: "ollama/test-model", tools: true });
  const target = join(docker.desktop(agent.id), "work", "sito", "index.html");
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, "<h1>Sito</h1>");
  writeFileSync(join(target, "..", "doc.pdf"), "%PDF-1.4\n");
  const owner = { id: "u1", name: "Owner", role: "owner" };
  const pushed = await app.artifacts.push({ agent, folder: "sito", path: "/home/agent/work/sito", message: "sito", requester: { kind: "owner", id: "1", name: "Owner" }, create: { description: "Il sito", kind: "site" } });
  await app.artifacts.review(pushed.commit.id, { decision: "approve", user: owner });
  app.artifacts.createShare(pushed.folder.id, { label: "report", access: { mode: "public" }, createdBy: owner });
  const OWN = "cora-acme.example.test";
  const routed = (host, audience = `share-route:${OWN}`) => signPass(keys.privateKey, { aud: audience, host });
  const viaCloud = await hit(port, OWN, "/", { headers: { "x-cora-share": routed(SHARE) } });
  assert.equal(viaCloud.status, 200);
  assert.equal(viaCloud.body, "<h1>Sito</h1>", "the share answers, called by the space's own address");
  assert.notEqual((await hit(port, OWN, "/")).body, "<h1>Sito</h1>", "without the cloud's pass the address is the panel");
  assert.notEqual((await hit(port, OWN, "/", { headers: { "x-cora-share": routed(SHARE, "share-route:other.example.test") } })).body, "<h1>Sito</h1>", "a pass for another space is no good");
  assert.notEqual((await hit(port, OWN, "/", { headers: { "x-cora-share": "forged.pass" } })).body, "<h1>Sito</h1>");
  // The panel that frames a preview is the space's own address, not its usecora.space name.
  const entered = await fetch(`http://127.0.0.1:${port}/auth/cloud?${new URLSearchParams({ pass: signPass(keys.privateKey, { aud: OWN, ...OWNER }) })}`, { redirect: "manual" });
  const cookie = entered.headers.get("set-cookie").split(";")[0];
  const view = await (await fetch(`http://127.0.0.1:${port}/api/artifacts/commits/${pushed.commit.id}/view?path=doc.pdf`, { headers: { Cookie: cookie, "X-Cora": "1" } })).json();
  const raw = new URL(view.url);
  assert.equal(raw.host, `r-${pushed.commit.id.slice(3)}--acme.usecora.test`);
  const framed = await hit(port, OWN, `${raw.pathname}${raw.search}`, { headers: { "x-cora-share": routed(raw.host) } });
  assert.equal(framed.status, 200);
  assert.equal(framed.headers["content-security-policy"], `frame-ancestors https://${OWN}`);
});
