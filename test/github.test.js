import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { startCora } from "../src/main.js";
import { passKeys, signPass } from "../src/pass.js";
import { fakeDocker, tempHome } from "./helpers.js";

const SEED = "fixture-github-signing-seed-for-tests-only-0123456789abc";
const keys = passKeys(SEED);
const OWNER = { sub: "ac_owner", role: "owner", name: "Owner", email: "owner@example.test", emailVerified: true };

/** GitHub's side of a manifest app: the conversion, the bot user, installations and their tokens, checked against the app's key. */
async function fakeGithub() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const state = { codes: new Set(["code-1"]), installed: new Set(), tokens: 0, calls: [] };
  const appJwt = (req) => {
    const [header, payload, signature] = String(req.headers.authorization || "").replace(/^Bearer /, "").split(".");
    if (!signature || !createVerify("RSA-SHA256").update(`${header}.${payload}`).verify(publicKey, signature, "base64url")) return false;
    return JSON.parse(Buffer.from(payload, "base64url").toString()).iss === "321";
  };
  const installations = { 77: { id: 77, account: { login: "acme", type: "Organization" }, repository_selection: "selected" }, 88: { id: 88, account: { login: "Beta-Co", type: "Organization" }, repository_selection: "all" } };
  const server = http.createServer((req, res) => {
    state.calls.push(`${req.method} ${req.url}`);
    const json = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    let match = /^\/app-manifests\/([\w-]+)\/conversions$/.exec(req.url);
    if (match && req.method === "POST") {
      if (!state.codes.delete(match[1])) return json(404, { message: "Not Found" });
      return json(201, { id: 321, slug: "nico-acme", name: "Nico-acme", owner: { login: "acme", type: "Organization" }, html_url: "https://github.test/apps/nico-acme", pem: privateKey.export({ type: "pkcs1", format: "pem" }) });
    }
    if (req.url === "/users/nico-acme%5Bbot%5D") return json(200, { id: 4242, login: "nico-acme[bot]" });
    if (req.url.startsWith("/app/")) {
      if (!appJwt(req)) return json(401, { message: "A JSON web token could not be decoded" });
      if (req.url === "/app/installations") return json(200, [...state.installed].map((id) => installations[id]));
      match = /^\/app\/installations\/(\d+)(\/access_tokens)?$/.exec(req.url);
      if (!match || !state.installed.has(Number(match[1]))) return json(404, { message: "Not Found" });
      if (!match[2]) return json(200, installations[match[1]]);
      state.tokens += 1;
      return json(201, { token: `ghs_${installations[match[1]].account.login.toLowerCase().replace("-", "")}${String(state.tokens).padStart(4, "0")}abcdefghij`, expires_at: new Date(Date.now() + 3600000).toISOString() });
    }
    json(404, { message: "Not Found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, state, close: () => server.close() };
}

test("an agent's own GitHub App: made from the panel, installed on GitHub, its hour-long token on the desktop for git", async (t) => {
  const github = await fakeGithub();
  t.after(() => github.close());
  const docker = fakeDocker();
  const stored = new Map();
  const app = startCora({ home: tempHome(), host: "127.0.0.1", port: 0, insecureCookies: true,
    adminPassword: "fixture-password", sessionKey: "fixture-session-github", useResidentSubscriptions: false,
    cloudUrl: "https://usecora.test", cloudKey: keys.publicKey, cloudSpace: "acme", githubApi: github.url, githubWeb: "https://github.test",
    discordToken: "", telegramToken: "", ollamaKey: "", orcaKey: "", claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes",
    botTokenFor: (name) => stored.get(name) || "", storeSecret: async (name, value) => { stored.set(name, value); },
    docker: docker.path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const entered = await fetch(`${base}/auth/cloud?${new URLSearchParams({ pass: signPass(keys.privateKey, { aud: "acme.usecora.test", ...OWNER }) })}`, { redirect: "manual" });
  const cookie = entered.headers.get("set-cookie").split(";")[0];
  const call = async (path, { method = "GET", body, as = cookie } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: as, "X-Cora": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  // From GitHub's site the panel's cookie does not come along: a top-level visit from another site.
  const fromGithub = (path) => fetch(`${base}${path}`, { headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" } });
  const nico = app.store.createAgent({ name: "Nico", model: "ollama/test-model", tools: true });
  const home = docker.desktop(nico.id);

  assert.equal((await call(`/api/agents/${nico.id}`)).data.github.state, "none");
  assert.equal((await call("/api/settings", { method: "PUT", body: { githubOrg: "https://github.com/acme/" } })).data.githubOrg, "acme", "the organization is kept as its name");
  assert.equal((await call("/api/settings", { method: "PUT", body: { githubOrg: "not an org!" } })).data.githubOrg, "");
  await call("/api/settings", { method: "PUT", body: { githubOrg: "acme" } });
  const panel = await fetch(`${base}/`, { headers: { Cookie: cookie } });
  assert.match(panel.headers.get("content-security-policy"), /form-action 'self' https:\/\/github\.test/, "the panel may post the manifest to GitHub, nowhere else");

  const begun = await call(`/api/agents/${nico.id}/github/manifest`, { method: "POST" });
  assert.equal(begun.status, 200);
  const action = new URL(begun.data.action);
  assert.equal(`${action.origin}${action.pathname}`, "https://github.test/organizations/acme/settings/apps/new");
  const manifest = JSON.parse(begun.data.manifest);
  assert.equal(manifest.name, "Nico-acme");
  assert.equal(manifest.public, true, "public, so it can be installed on other organizations too");
  assert.equal(manifest.redirect_url, "https://acme.usecora.test/github/created");
  assert.equal(manifest.setup_url, `https://acme.usecora.test/github/installed?agent=${nico.id}`);
  assert.deepEqual([manifest.default_permissions.contents, manifest.default_permissions.pull_requests, manifest.default_permissions.issues, manifest.default_permissions.metadata], ["write", "write", "write", "read"]);
  const stateParam = action.searchParams.get("state");
  assert.equal((await fromGithub(`/github/created?code=code-1&state=${encodeURIComponent(`${stateParam}x`)}`)).status, 403, "a state not signed here is refused");

  const back = await fromGithub(`/github/created?code=code-1&state=${encodeURIComponent(stateParam)}`);
  assert.equal(back.status, 200);
  const page = await back.text();
  assert.match(page, new RegExp(`<meta http-equiv="refresh" content="1;url=/#/agent/${nico.id}/profilo">`), "a page of its own opens the panel, so the panel's cookie comes along again");
  assert.match(back.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(Buffer.from(stored.get("CORA_GH_KEY_NICO"), "base64").toString(), /BEGIN RSA PRIVATE KEY/, "the app's key goes to hush");
  assert.equal((await fromGithub(`/github/created?code=code-1&state=${encodeURIComponent(stateParam)}`)).status, 403, "and the state works once");
  let view = (await call(`/api/agents/${nico.id}`)).data.github;
  assert.deepEqual([view.state, view.public, view.installations], ["created", true, []]);
  assert.equal(view.settingsUrl, "https://github.test/organizations/acme/settings/apps/nico-acme");
  assert.equal((await call(`/api/agents/${nico.id}/github/manifest`, { method: "POST" })).status, 409, "one app per agent");
  assert.equal((await call(`/api/agents/${nico.id}/github/check`, { method: "POST" })).data.installations.length, 0, "not installed yet");

  // From the panel: GitHub asks which organization and which repositories; it comes back trusted.
  const link = new URL((await call(`/api/agents/${nico.id}/github/install`, { method: "POST" })).data.url);
  assert.equal(`${link.origin}${link.pathname}`, "https://github.test/apps/nico-acme/installations/new");
  github.state.installed.add(77);
  assert.equal((await fromGithub(`/github/installed?agent=${nico.id}&installation_id=999&setup_action=install`)).status, 404, "an installation GitHub does not confirm as this app's is not kept");
  const installed = await fromGithub(`/github/installed?agent=${nico.id}&installation_id=77&setup_action=install&state=${encodeURIComponent(link.searchParams.get("state"))}`);
  assert.equal(installed.status, 200);
  assert.match(await installed.text(), /ora lavora anche su acme/);
  view = (await call(`/api/agents/${nico.id}`)).data.github;
  assert.deepEqual([view.state, view.login, view.primary], ["installed", "nico-acme[bot]", "acme"]);
  assert.deepEqual(view.installations.map((item) => [item.account, item.repositorySelection, item.approved, item.url]), [["acme", "selected", true, "https://github.test/organizations/acme/settings/installations/77"]]);
  assert.equal(readFileSync(join(home, ".config/cora/github-tokens/acme"), "utf8"), "ghs_acme0001abcdefghij", "a token per organization on the desktop");
  assert.equal(readFileSync(join(home, ".config/cora/github-token"), "utf8"), "ghs_acme0001abcdefghij");

  // Installed elsewhere by whoever: it waits for the owner, since a public app can be installed by anyone.
  github.state.installed.add(88);
  const elsewhere = await fromGithub(`/github/installed?agent=${nico.id}&installation_id=88&setup_action=install`);
  assert.match(await elsewhere.text(), /Installazione da approvare/);
  view = (await call(`/api/agents/${nico.id}`)).data.github;
  assert.deepEqual(view.installations.map((item) => [item.account, item.approved]), [["acme", true], ["Beta-Co", false]]);
  assert.equal(existsSync(join(home, ".config/cora/github-tokens/beta-co")), false, "no token for an organization nobody approved");
  assert.equal((await call(`/api/agents/${nico.id}/github/installations/88`, { method: "PUT", body: { approved: true } })).data.installations[1].approved, true);
  assert.equal(readFileSync(join(home, ".config/cora/github-tokens/beta-co"), "utf8"), "ghs_betaco0002abcdefghij");
  const fill = (path) => spawnSync("git", ["credential", "fill"], { input: `protocol=https\nhost=github.com\npath=${path}\n\n`, encoding: "utf8", env: { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: "1" } }).stdout;
  assert.match(fill("Beta-Co/site.git"), /password=ghs_betaco0002abcdefghij/, "git picks the token of the repository's organization");
  assert.match(fill("acme/api.git"), /password=ghs_acme000\d/);
  assert.match(fill("someone/else.git"), /password=ghs_acme000\d/, "and the primary one elsewhere");

  const gitconfig = readFileSync(join(home, ".gitconfig"), "utf8");
  assert.match(gitconfig, /useHttpPath = true/);
  assert.match(gitconfig, /email = 4242\+nico-acme\[bot\]@users\.noreply\.github\.com/, "its commits are its bot's");
  assert.match(readFileSync(join(home, ".config/gh/hosts.yml"), "utf8"), /users:\n\s*nico-acme\[bot\]:\n\s*oauth_token: ghs_acme000\d/, "gh works on the primary organization");
  assert.doesNotMatch(readFileSync(docker.log, "utf8"), /ghs_/, "no token ever travels on a command line");
  assert.match(readFileSync(docker.log, "utf8"), new RegExp(`exec -i -u root .*cora-box-${nico.id} sh -c command -v gh`), "gh is put on the running desktop, as root, when missing");
  const prompt = app.brain.systemPrompt(app.store.agent(nico.id), { place: "", computer: true });
  assert.match(prompt, /## GitHub\nSu GitHub sei nico-acme\[bot\], la tua app, installata su: acme \(i repo scelti\), Beta-Co \(tutti i repo\)/);
  assert.match(prompt, /gh \(GitHub CLI\) è installato e lavora su acme; per un repo di Beta-Co anteponi GH_TOKEN=/);

  const minted = github.state.tokens;
  await app.github.refreshAll();
  assert.equal(github.state.tokens, minted, "tokens with time left are not asked again");
  app.github.tokens.get(`${nico.id}:77`).expiresAt = Date.now() + 5 * 60000;
  await app.github.refreshAll();
  assert.equal(github.state.tokens, minted + 1, "the one about to end is renewed");
  assert.notEqual(readFileSync(join(home, ".config/cora/github-tokens/acme"), "utf8"), "ghs_acme0001abcdefghij");

  // Uninstalled on GitHub: at the next renewal it goes, and so does its token.
  github.state.installed.delete(88);
  app.github.tokens.get(`${nico.id}:88`).expiresAt = Date.now();
  await app.github.refreshAll();
  assert.deepEqual((await call(`/api/agents/${nico.id}`)).data.github.installations.map((item) => item.account), ["acme"]);
  assert.equal(existsSync(join(home, ".config/cora/github-tokens/beta-co")), false);

  await app.store.db.prepare("INSERT INTO panel_users (id, name, email, role, source, created_at, last_seen_at) VALUES ('ac_member', 'Sara', 'sara@example.test', 'member', 'cloud', 0, 0)").run();
  await call("/api/access", { method: "PUT", body: { domains: ["example.test"] } });
  const memberIn = await fetch(`${base}/auth/cloud?${new URLSearchParams({ pass: signPass(keys.privateKey, { aud: "acme.usecora.test", sub: "ac_member", role: "member", name: "Sara", email: "sara@example.test", emailVerified: true }) })}`, { redirect: "manual" });
  const member = memberIn.headers.get("set-cookie").split(";")[0];
  assert.equal((await call(`/api/agents/${nico.id}/github/installations/77`, { method: "PUT", body: { approved: false }, as: member })).status, 403, "only the owner manages an agent's app");

  const gone = await call(`/api/agents/${nico.id}/github`, { method: "DELETE" });
  assert.equal(gone.data.state, "none");
  assert.equal(gone.data.deleteUrl, "https://github.test/organizations/acme/settings/apps/nico-acme", "the panel points to where it is deleted on GitHub");
  assert.equal(existsSync(join(home, ".config/cora/github-token")), false, "and the tokens leave the desktop");
  assert.equal(existsSync(join(home, ".config/cora/github-tokens")), false);
  assert.doesNotMatch(readFileSync(join(home, ".gitconfig"), "utf8"), /github\.com|nico-acme/);
  assert.doesNotMatch(app.brain.systemPrompt(app.store.agent(nico.id), { place: "", computer: true }), /## GitHub/);
});
