import assert from "node:assert/strict";
import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { startCora } from "../src/main.js";
import { passKeys, signPass } from "../src/pass.js";
import { Store } from "../src/store.js";
import { executeTool } from "../src/tools.js";
import { Vault } from "../src/vault.js";
import { fakeDocker, tempHome } from "./helpers.js";

const NICO = { id: "ag_aaaaaaaaaaaa", name: "Nico", enabled: true, tools: true };
const VERA = { id: "ag_bbbbbbbbbbbb", name: "Vera", enabled: true, tools: true };
const SEED = "fixture-vault-signing-seed-for-tests-only-0123456789abcd";
const keys = passKeys(SEED);

function bare() {
  const home = tempHome();
  const store = new Store(home);
  for (const [position, agent] of [NICO, VERA].entries()) store.db.prepare("INSERT INTO agents (id, position, data) VALUES (?, ?, ?)").run(agent.id, position, JSON.stringify(agent));
  store.cachedAgents = [NICO, VERA];
  const imported = [];
  const notices = [];
  const vault = new Vault({ store, key: "fixture-session-key", instanceUrl: "https://acme.usecora.test", log: () => {},
    boxes: { importSecret: async (agentId, name, value) => { imported.push({ agentId, name, value: value.toString("utf8") }); } },
    notice: async (channelId, text) => { notices.push({ channelId, text }); } });
  return { home, store, vault, imported, notices };
}

test("a secret is kept encrypted, read back by nobody, and put into the hush only of an agent allowed to use it", async () => {
  const { home, store, vault, imported } = bare();
  const shown = vault.put({ name: "acme stripe-key", value: "sk_live_fixture_value_0001\n", description: "Stripe di Acme", agents: [NICO.id], by: { kind: "user", id: "u1", name: "Owner" } });
  assert.equal(shown.name, "ACME_STRIPE_KEY");
  assert.equal(shown.sealed, undefined, "the panel's view carries no ciphertext either");
  assert.equal(JSON.stringify(vault.list()).includes("fixture_value"), false);
  store.close();
  assert.equal(readFileSync(join(home, "cora.db")).includes("sk_live_fixture_value_0001"), false, "the database holds no clear value");
  const reopened = new Store(home);
  reopened.cachedAgents = [NICO, VERA];
  const again = new Vault({ store: reopened, key: "fixture-session-key", boxes: { importSecret: async (agentId, name, value) => { imported.push({ agentId, name, value: value.toString("utf8") }); } }, log: () => {} });
  assert.equal(again.value(reopened.vaultSecret("ACME_STRIPE_KEY")).toString("utf8"), "sk_live_fixture_value_0001");
  const other = new Vault({ store: reopened, key: "another-key", log: () => {} });
  assert.throws(() => other.value(reopened.vaultSecret("ACME_STRIPE_KEY")), "another key opens nothing");
  const record = reopened.vaultSecret("ACME_STRIPE_KEY");
  assert.throws(() => again.value({ ...record, name: "OTHER_NAME" }), "a value moved under another name does not open");

  assert.equal(await again.importInto(NICO, "acme_stripe_key"), "ACME_STRIPE_KEY");
  assert.deepEqual(imported, [{ agentId: NICO.id, name: "ACME_STRIPE_KEY", value: "sk_live_fixture_value_0001" }]);
  await assert.rejects(again.importInto(VERA, "ACME_STRIPE_KEY"), /you may not use ACME_STRIPE_KEY/);
  await assert.rejects(again.importInto(NICO, "NOT_THERE"), /there is no secret NOT_THERE.*secret_request/);
  const used = again.list()[0];
  assert.equal(used.uses, 1);
  assert.equal(used.lastUse.name, "Nico");
  reopened.close();
});

test("the agents ask for a secret by link, use it by name and never see it; sending it out waits for the owner", async () => {
  const { store, vault, imported, notices } = bare();
  const ctx = { agent: NICO, store, vault, channelId: "c1", boxes: { ensure: async () => {} } };
  const asked = await executeTool({ name: "secret_request", args: { name: "ROSSI_FTP_PASSWORD", description: "La password FTP di Rossi" } }, ctx);
  const link = /https:\/\/acme\.usecora\.test\/send\/r\/([A-Za-z0-9_-]{32})/.exec(asked.text);
  assert.ok(link, asked.text);
  assert.match(asked.text, /Never ask for the value in a message/);
  assert.match((await executeTool({ name: "secret_list", args: {} }, ctx)).text, /the vault is empty/);
  vault.fillRequest(link[1], "ftp-fixture-value");
  assert.match(notices[0].text, /È arrivato \*\*ROSSI_FTP_PASSWORD\*\* nella cassaforte \(chiesto da Nico\)/);
  assert.throws(() => vault.fillRequest(link[1], "again"), /non è più valido/, "a request link works once");
  const listed = JSON.parse((await executeTool({ name: "secret_list", args: {} }, ctx)).text);
  assert.deepEqual(listed.secrets.map((secret) => [secret.name, secret.you_may_use]), [["ROSSI_FTP_PASSWORD", true]], "the agent that asked may use what arrived");
  assert.equal(JSON.parse((await executeTool({ name: "secret_list", args: {} }, { ...ctx, agent: VERA })).text).secrets[0].you_may_use, false);
  const used = await executeTool({ name: "secret_import", args: { name: "ROSSI_FTP_PASSWORD" } }, ctx);
  assert.match(used.text, /ROSSI_FTP_PASSWORD is in your hush\. Use it only like this: hush run --name ROSSI_FTP_PASSWORD/);
  assert.equal(used.text.includes("ftp-fixture-value"), false, "the agent's tool result never carries the value");
  assert.equal(imported[0].value, "ftp-fixture-value");
  const send = await executeTool({ name: "secret_send", args: { name: "ROSSI_FTP_PASSWORD", to: "il sistemista di Rossi", reason: "deve aggiornare il server" } }, ctx);
  assert.match(send.text, /^REQUESTED, NOT SENT/);
  const proposed = vault.sends().find((item) => item.status === "proposed");
  assert.equal(proposed.data, undefined, "a proposed send holds nothing it could give away");
});

test("request and send pages: only their own page posts, a send opens its set number of times, and only the link's key opens it", async (t) => {
  const docker = fakeDocker();
  const app = startCora({ home: tempHome(), host: "127.0.0.1", port: 0, insecureCookies: true,
    adminPassword: "fixture-password", sessionKey: "fixture-session-vault", useResidentSubscriptions: false,
    // A space on its own domain has no share hosts: its sends stay on the instance's /send/s/ path.
    cloudUrl: "https://usecora.test", cloudKey: keys.publicKey, cloudSpace: "acme", publicHost: "acme.usecora.test",
    discordToken: "", telegramToken: "", ollamaKey: "", orcaKey: "", claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes",
    botTokenFor: () => "", docker: docker.path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  t.after(() => app.stop());
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const enter = async (identity) => {
    const response = await fetch(`${base}/auth/cloud?${new URLSearchParams({ pass: signPass(keys.privateKey, { aud: "acme.usecora.test", ...identity }) })}`, { redirect: "manual" });
    return response.headers.get("set-cookie").split(";")[0];
  };
  const owner = await enter({ sub: "ac_owner", role: "owner", name: "Owner", email: "owner@example.test", emailVerified: true });
  const call = async (path, { method = "GET", body, cookie = owner } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, "X-Cora": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };

  const made = await call("/api/secrets/requests", { method: "POST", body: { name: "acme_ftp", description: "FTP di Acme", agents: ["*"] } });
  assert.equal(made.status, 201);
  const path = new URL(made.data.url).pathname;
  assert.match(made.data.url, /^https:\/\/acme\.usecora\.test\/send\/r\//);
  const page = await fetch(`${base}${path}`, { headers: { "accept-language": "it" } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Owner ti chiede <b>ACME_FTP<\/b> \(FTP di Acme\)/);
  assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
  const post = (headers, value = "ftp-fixture-value") => fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams({ value }).toString(), redirect: "manual" });
  assert.equal((await post({})).status, 403, "a post that says nothing about where it comes from is refused");
  assert.equal((await post({ Origin: "https://evil.test" })).status, 403);
  assert.equal((await post({ "Sec-Fetch-Site": "cross-site", Origin: "null" })).status, 403);
  const filled = await post({ "Sec-Fetch-Site": "same-origin", Origin: "null" });
  assert.equal(filled.status, 200, "the page's own form, posted with Origin null by a no-referrer browser, gets in");
  assert.equal((await post({ Origin: base })).status, 410, "a request link works once");
  const listed = await call("/api/secrets");
  assert.deepEqual(listed.data.secrets.map((secret) => [secret.name, secret.source, secret.agents]), [["ACME_FTP", "request", ["*"]]]);
  assert.equal(JSON.stringify(listed.data).includes("ftp-fixture-value"), false, "the panel never gets a value back");

  const out = await call("/api/secrets/ACME_FTP/sends", { method: "POST", body: { views: 2, days: 1, note: "per il sistemista" } });
  assert.equal(out.status, 201);
  const link = new URL(out.data.url);
  const key = link.hash.slice(1);
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(app.store.vaultSends()).includes(key), false, "the send's key lives only in the link");
  const sendPage = await fetch(`${base}${link.pathname}`);
  assert.equal(sendPage.status, 200);
  assert.match(sendPage.headers.get("content-security-policy"), /script-src 'self'/);
  const open = () => fetch(`${base}${link.pathname}`, { method: "POST", headers: { "X-Cora": "1", Origin: base } });
  assert.equal((await fetch(`${base}${link.pathname}`, { method: "POST", headers: { "X-Cora": "1", Origin: "https://evil.test" } })).status, 403);
  for (let i = 0; i < 2; i += 1) {
    const sealed = await (await open()).json();
    const raw = Buffer.from(sealed.data, "base64");
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "base64url"), Buffer.from(sealed.iv, "base64"));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    assert.equal(Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]).toString("utf8"), "ftp-fixture-value");
  }
  assert.equal((await open()).status, 410, "it opens the number of times it was made for");
  assert.equal((await fetch(`${base}${link.pathname}`)).status, 410);
  assert.equal(JSON.stringify(app.store.vaultSends()).includes("data\":\""), false, "a spent send keeps no sealed bytes");

  await call("/api/access", { method: "PUT", body: { domains: ["company.test"] } });
  const member = await enter({ sub: "ac_member", role: "member", name: "Sara", email: "sara@company.test", emailVerified: true });
  const seen = await call("/api/secrets", { cookie: member });
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.data.secrets.map((secret) => secret.name), ["ACME_FTP"], "a member sees the names");
  assert.deepEqual(seen.data.requests, []);
  assert.equal((await call("/api/secrets", { method: "POST", cookie: member, body: { name: "X_Y", value: "v" } })).status, 403, "only the owner fills the vault");
  assert.equal((await call("/api/secrets/ACME_FTP/sends", { method: "POST", cookie: member, body: {} })).status, 403, "and only the owner sends");
});

test("a send with a password asks for it before the bytes leave, and the vault's log says who did what", async (t) => {
  const docker = fakeDocker();
  const app = startCora({ home: tempHome(), host: "127.0.0.1", port: 0, insecureCookies: true,
    adminPassword: "fixture-password", sessionKey: "fixture-session-vault-log", useResidentSubscriptions: false,
    cloudUrl: "https://usecora.test", cloudKey: keys.publicKey, cloudSpace: "acme", publicHost: "acme.usecora.test",
    discordToken: "", telegramToken: "", ollamaKey: "", orcaKey: "", claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes",
    botTokenFor: () => "", docker: docker.path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const entered = await fetch(`${base}/auth/cloud?${new URLSearchParams({ pass: signPass(keys.privateKey, { aud: "acme.usecora.test", sub: "ac_owner", role: "owner", name: "Owner", email: "owner@example.test", emailVerified: true }) })}`, { redirect: "manual" });
  const owner = entered.headers.get("set-cookie").split(";")[0];
  const call = async (path, { method = "GET", body } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: owner, "X-Cora": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  await call("/api/secrets", { method: "POST", body: { name: "ACME_FTP", value: "ftp-fixture-value", agents: ["*"] } });
  const people = await call("/api/secrets/ACME_FTP/sends", { method: "POST", body: { views: 1, access: { mode: "people", emails: ["giulia@cliente.test"] } } });
  assert.equal(people.status, 400, "a space on its own domain has no address for named people");
  assert.match(people.data.error, /pubblico o con password/);
  const made = await call("/api/secrets/ACME_FTP/sends", { method: "POST", body: { views: 2, days: 1, note: "per Giulia", access: { mode: "password", password: "fixture-door" } } });
  assert.equal(made.status, 201);
  assert.equal(made.data.access.mode, "password");
  assert.equal(made.data.access.password, undefined, "the panel never gets the password back");
  const link = new URL(made.data.url);
  assert.equal(link.origin, "https://acme.usecora.test", "without share hosts a send stays on the instance's own path");
  const page = await fetch(`${base}${link.pathname}`, { headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1" } });
  assert.match(await page.text(), /<input id="password" type="password"/);
  const open = (password) => fetch(`${base}${link.pathname}`, { method: "POST", headers: { "X-Cora": "1", Origin: base, "Content-Type": "application/json", "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1" }, body: JSON.stringify(password === undefined ? {} : { password }) });
  assert.equal((await open()).status, 401, "no password, no bytes");
  assert.equal((await open("wrong-door")).status, 401);
  const sealed = await open("fixture-door");
  assert.equal(sealed.status, 200);
  assert.equal((await sealed.json()).name, "ACME_FTP");

  const log = await call("/api/secrets/events");
  const lines = log.data.events.map((event) => event.kind).reverse();
  assert.deepEqual(lines, ["secret-created", "send-created", "send-page", "send-refused", "send-refused", "send-opened"]);
  const opened = log.data.events[0];
  assert.deepEqual([opened.opened, opened.views, opened.who.device], [1, 2, "Safari · iOS"]);
  assert.match(opened.who.visitor, /^[a-z0-9_-]{6}$/);
  assert.equal(log.data.events.find((event) => event.kind === "send-created").by.name, "Owner");
  assert.equal(log.data.events.find((event) => event.kind === "send-created").mode, "password");
  await call(`/api/secrets/sends/${made.data.id}`, { method: "DELETE" });
  await call("/api/secrets/ACME_FTP", { method: "PUT", body: { agents: [] } });
  await call("/api/secrets/ACME_FTP", { method: "DELETE" });
  assert.deepEqual((await call("/api/secrets/events")).data.events.slice(0, 3).map((event) => event.kind), ["secret-deleted", "secret-agents", "send-revoked"]);
  assert.equal((await call("/api/secrets/events?name=ACME_FTP")).data.events.length, 9, "one secret's log");
});
