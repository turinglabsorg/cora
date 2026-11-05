import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
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
