import assert from "node:assert/strict";
import { test } from "node:test";
import { MailDomains } from "../src/mail-domains.js";
import { childEnv } from "../src/cli.js";
import { mailWorld } from "./mail-fixtures.js";
import { waitFor } from "./helpers.js";

test("multiple Resend accounts keep their domains, webhooks, credentials and real agent mailboxes separate", async (t) => {
  const { app, state, vault, keyA, keyB, call } = await mailWorld(t);
  assert.equal((await call("/api/mail/domains", { auth: false })).status, 401);
  assert.equal((await call("/api/mail/domains", { asMember: true })).data.canManage, false);
  assert.equal((await call("/api/mail/accounts", { method: "POST", asMember: true, body: { name: "Denied", key: keyA } })).status, 403);
  const alpha = (await call("/api/mail/accounts", { method: "POST", body: { name: "Azienda", key: keyA } })).data;
  const beta = (await call("/api/mail/accounts", { method: "POST", body: { name: "Altro account", key: keyB } })).data;
  assert.equal(alpha.ready, true);
  assert.equal(beta.ready, true);
  assert.equal((await call(`/api/mail/accounts/${alpha.id}/check`, { method: "POST", asMember: true })).status, 403);
  assert.equal((await call("/api/mail/domains", { method: "POST", asMember: true, body: { name: "not-allowed.test", accountId: alpha.id } })).status, 403);
  assert.equal(vault.get(app.mailDomains.keyName(alpha.id)), keyA);
  assert.equal(state.accounts.get(keyA).hooks[0].endpoint.endsWith(`/v1/inbound/accounts/${alpha.id}`), true);
  const first = (await call("/api/mail/domains", { method: "POST", body: { name: "posta.azienda.test", accountId: alpha.id } })).data;
  const second = (await call("/api/mail/domains", { method: "POST", body: { name: "team.altro.test", accountId: beta.id } })).data;
  assert.equal(first.ready, false);
  assert.equal(first.records.length, 3);
  const agent = (await call("/api/agents", { method: "POST", body: { name: "Nico", tools: true, model: "ollama/test-model" } })).data;
  await waitFor(() => app.store.value(`agentMailbox:${agent.id}`, null)?.status === "ready");
  const before = app.store.value(`agentMailbox:${agent.id}`).email;
  const denied = await call(`/api/agents/${agent.id}/mailbox`, { method: "PUT", body: { local: "nico", domain: first.name } });
  assert.equal(denied.status, 409, "an unverified domain cannot be assigned");
  state.dnsReady.add(first.name);
  const verified = await call(`/api/mail/domains/${first.id}/verify`, { method: "POST" });
  assert.equal(verified.data.ready, true);
  assert.equal((await call(`/api/mail/domains/${second.id}/check`, { method: "POST" })).data.ready, false);
  const changed = await call(`/api/agents/${agent.id}/mailbox`, { method: "PUT", asMember: true, body: { local: "nico", domain: first.name } });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal(changed.data.email, "nico@posta.azienda.test");
  assert.deepEqual(changed.data.previousEmails, [before]);
  assert.equal(state.routes.get(first.name).account_id, alpha.id);
  assert.equal(state.routes.get(second.name).account_id, beta.id);
  assert.equal(state.relayAccounts.get(alpha.id).api_key, keyA);
  assert.equal(state.relayAccounts.get(beta.id).api_key, keyB);
  const swapped = await call(`/api/mail/accounts/${alpha.id}`, { method: "PUT", body: { name: "Wrong account", key: keyB } });
  assert.equal(swapped.status, 409, "a valid key from another account cannot replace the domain's account");
  assert.equal(vault.get(app.mailDomains.keyName(alpha.id)), keyA);
  assert.equal(state.relayAccounts.get(alpha.id).api_key, keyA);
  const metadata = (await call("/api/mail/domains")).data;
  assert.equal(metadata.accounts.find((item) => item.id === alpha.id).keyHint, "•••• lpha");
  assert.equal(metadata.accounts.find((item) => item.id === beta.id).keyHint, "•••• beta");
  assert.doesNotMatch(JSON.stringify(metadata), /re_fixture|whsec_|fixture-mail-registration|fixture-mailbox-client-key/);
  assert.doesNotMatch(JSON.stringify(app.store.value("mailDomains")), /re_fixture|whsec_/);
  const restarted = new MailDomains({ ...app.mailDomains, tokenFor: (name) => vault.get(name) || "" });
  assert.equal((await restarted.checkAccount(alpha.id)).ready, true);
  assert.equal(state.accounts.get(keyA).hooks.length, 1, "restart reuses the existing webhook");
});

test("refused credentials and service failures preserve working addresses and can recover", async (t) => {
  const { app, state, vault, keyA, call } = await mailWorld(t);
  assert.equal((await call("/api/mail/accounts", { method: "POST", body: { name: "Bad", key: "re_invalid_fixture" } })).status, 400);
  assert.equal(vault.size, 0);
  assert.equal(app.store.value("mailDomains", null), null);
  const account = (await call("/api/mail/accounts", { method: "POST", body: { name: "Azienda", key: keyA } })).data;
  assert.equal((await call("/api/mail/domains", { method: "POST", body: { name: "https://azienda.test", accountId: account.id } })).status, 400);
  const domain = (await call("/api/mail/domains", { method: "POST", body: { name: "posta.azienda.test", accountId: account.id } })).data;
  state.dnsReady.add(domain.name);
  state.relayRefuse = true;
  const failed = await call(`/api/mail/domains/${domain.id}/verify`, { method: "POST" });
  assert.equal(failed.data.ready, false);
  assert.doesNotMatch(JSON.stringify(failed.data), /fixture-provider-secret/);
  state.relayRefuse = false;
  assert.equal((await call(`/api/mail/domains/${domain.id}/check`, { method: "POST" })).data.ready, true);
  state.refuse = true;
  const old = vault.get(app.mailDomains.keyName(account.id));
  const refused = await call(`/api/mail/accounts/${account.id}`, { method: "PUT", body: { name: "Replacement", key: "re_invalid_fixture" } });
  assert.equal(refused.status, 400);
  assert.equal(vault.get(app.mailDomains.keyName(account.id)), old);
  assert.equal((await call("/api/mail/domains")).data.accounts[0].name, "Azienda");
  state.refuse = false;
  assert.equal((await call(`/api/mail/accounts/${account.id}/check`, { method: "POST" })).data.ready, true);
});

test("model CLIs do not inherit any Resend account key", () => {
  const name = "CORA_MAIL_ACCOUNT_MA_FIXTURE";
  process.env[name] = "fixture-only";
  try { assert.equal(name in childEnv(), false); } finally { delete process.env[name]; }
});

test("domain configuration supports send-only, restoration and removal without touching provider domains", async (t) => {
  const { app, state, keyA, call } = await mailWorld(t);
  const account = (await call("/api/mail/accounts", { method: "POST", body: { name: "Azienda", key: keyA } })).data;
  assert.equal((await call("/api/mail/domains", { method: "POST", body: { name: "invalid.test", accountId: account.id, mode: "other" } })).status, 400);
  const domain = (await call("/api/mail/domains", { method: "POST", body: { name: "send.azienda.test", accountId: account.id, mode: "send-only" } })).data;
  const provider = state.accounts.get(keyA).domains.find((item) => item.id === domain.resendId);
  assert.equal(domain.mode, "send-only");
  assert.equal(provider.capabilities.receiving, "disabled");
  assert.equal(state.routes.has(domain.name), false, "send-only never activates an inbound relay route");
  assert.equal(domain.ready, false);
  state.dnsReady.add(domain.name);
  state.receivingPending = new Set([domain.name]);
  const verified = (await call(`/api/mail/domains/${domain.id}/verify`, { method: "POST" })).data;
  assert.equal(verified.ready, true);
  assert.equal(verified.relayReady, false);
  assert.equal(verified.records.find((record) => record.record === "Receiving").status, "not_started");
  state.receivingPending.clear();
  assert.equal((await call(`/api/mail/domains/${domain.id}`, { method: "PUT", asMember: true, body: { mode: "send-receive" } })).status, 403);
  assert.equal((await call(`/api/mail/domains/${domain.id}`, { method: "DELETE", asMember: true })).status, 403);
  const restored = (await call(`/api/mail/domains/${domain.id}`, { method: "PUT", body: { mode: "send-receive" } })).data;
  assert.equal(restored.ready, true);
  assert.equal(restored.relayReady, true);
  assert.equal(provider.capabilities.receiving, "enabled");
  state.refuse = true;
  assert.equal((await call(`/api/mail/domains/${domain.id}`, { method: "PUT", body: { mode: "send-only" } })).status, 400);
  assert.equal(app.mailDomains.data().domains[0].mode, "send-receive");
  state.refuse = false;
  state.domainCheckRefuse = true;
  const incomplete = (await call(`/api/mail/domains/${domain.id}`, { method: "PUT", body: { mode: "send-only" } })).data;
  assert.equal(incomplete.mode, "send-only");
  assert.equal(incomplete.ready, false);
  assert.ok(incomplete.error);
  assert.doesNotMatch(JSON.stringify(incomplete), /fixture-provider-secret/);
  assert.equal(provider.capabilities.receiving, "disabled");
  state.domainCheckRefuse = false;
  const changed = (await call(`/api/mail/domains/${domain.id}/check`, { method: "POST" })).data;
  assert.equal(changed.ready, true);
  assert.equal(provider.capabilities.receiving, "disabled");
  const restarted = new MailDomains({ ...app.mailDomains, tokenFor: (name) => app.mailDomains.tokenFor(name) });
  assert.equal(restarted.view().domains.find((item) => item.id === domain.id).mode, "send-only");
  state.refuse = true;
  assert.equal((await call(`/api/mail/domains/${domain.id}`, { method: "DELETE" })).data.removed, true, "a disconnected account cannot prevent removing unused Cora configuration");
  assert.equal(app.mailDomains.view().domains.some((item) => item.id === domain.id), false);
  assert.equal(state.accounts.get(keyA).domains.includes(provider), true, "provider domain is preserved");
  assert.equal(app.mailDomains.data().accounts.length, 1);
  assert.equal((await call(`/api/mail/domains/${domain.id}`, { method: "DELETE" })).status, 404);
  assert.equal((await call(`/api/mail/domains/${domain.id}`, { method: "PUT", body: { mode: "send-receive" } })).status, 404);
});

test("domain removal and send-only refuse current, retained and default mailbox domains", async (t) => {
  const { app, state, keyA, call } = await mailWorld(t);
  const account = (await call("/api/mail/accounts", { method: "POST", body: { name: "Azienda", key: keyA } })).data;
  const domain = (await call("/api/mail/domains", { method: "POST", body: { name: "posta.azienda.test", accountId: account.id } })).data;
  const agent = app.store.createAgent({ name: "Fixture", tools: false });
  for (const mailbox of [{ email: `nico@${domain.name}` }, { email: "nico@usecora.space", previousEmails: [`old@${domain.name}`] }]) {
    app.store.setValue(`agentMailbox:${agent.id}`, mailbox);
    for (const method of ["PUT", "DELETE"]) {
      const result = await call(`/api/mail/domains/${domain.id}`, { method, ...(method === "PUT" ? { body: { mode: "send-only" } } : {}) });
      assert.equal(result.status, 409, JSON.stringify(result.data));
    }
    assert.equal(state.accounts.get(keyA).domains[0].capabilities.receiving, "enabled");
    assert.deepEqual(app.store.value(`agentMailbox:${agent.id}`), mailbox);
  }
  app.store.setValue(`agentMailbox:${agent.id}`, { email: "nico@usecora.space" });
  app.mailDomains.defaultDomain = domain.name;
  assert.equal((await call(`/api/mail/domains/${domain.id}`, { method: "DELETE" })).status, 409);
  assert.equal((await call(`/api/mail/domains/${domain.id}`, { method: "PUT", body: { mode: "send-only" } })).status, 409);
});

test("send-only domains cannot be provisioned as receiving agent mailboxes", async (t) => {
  const { app, state, keyA, call } = await mailWorld(t);
  const account = (await call("/api/mail/accounts", { method: "POST", body: { name: "Azienda", key: keyA } })).data;
  const domain = (await call("/api/mail/domains", { method: "POST", body: { name: "send.azienda.test", accountId: account.id, mode: "send-only" } })).data;
  state.dnsReady.add(domain.name);
  await call(`/api/mail/domains/${domain.id}/verify`, { method: "POST" });
  const agent = app.store.createAgent({ name: "Fixture", tools: true });
  let provisions = 0;
  app.mailDomains.boxes = { assignMailbox: async () => { provisions++; } };
  const result = await call(`/api/agents/${agent.id}/mailbox`, { method: "PUT", body: { local: "nico", domain: domain.name } });
  assert.equal(result.status, 409);
  assert.equal(provisions, 0);
});

test("an in-flight mailbox assignment protects domain configuration and releases its guard after failure", async (t) => {
  const { app, state, keyA, call } = await mailWorld(t);
  const account = (await call("/api/mail/accounts", { method: "POST", body: { name: "Azienda", key: keyA } })).data;
  const domain = (await call("/api/mail/domains", { method: "POST", body: { name: "posta.azienda.test", accountId: account.id } })).data;
  state.dnsReady.add(domain.name);
  const agent = app.store.createAgent({ name: "Fixture", enabled: true, tools: true });
  let release, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  app.mailDomains.boxes = { assignMailbox: async () => { entered(); await new Promise((resolve) => { release = resolve; }); throw new Error("fixture provisioning failure"); } };
  const assignment = call(`/api/agents/${agent.id}/mailbox`, { method: "PUT", body: { local: "nico", domain: domain.name } });
  await waiting;
  for (const method of ["DELETE", "PUT"]) assert.equal((await call(`/api/mail/domains/${domain.id}`, { method, ...(method === "PUT" ? { body: { mode: "send-only" } } : {}) })).status, 409);
  release();
  assert.equal((await assignment).status, 502);
  assert.equal((await call(`/api/mail/domains/${domain.id}`, { method: "DELETE" })).status, 200);
});


test("pending tracking never blocks verified domain sending", async (t) => {
  const { app, state, keyA, call } = await mailWorld(t);
  const account = (await call("/api/mail/accounts", { method: "POST", body: { name: "Studio", key: keyA } })).data;
  const domain = (await call("/api/mail/domains", { method: "POST", body: { name: "studio.test", accountId: account.id, mode: "send-only" } })).data;
  const provider = state.accounts.get(keyA).domains.find((item) => item.id === domain.resendId);
  provider.status = "partially_verified";
  for (const record of provider.records) if (["DKIM", "SPF"].includes(record.record)) record.status = "verified";
  provider.records.push({ record: "Tracking", name: "click", type: "CNAME", value: "tracking.example.test", status: "pending" });
  const checked = (await call(`/api/mail/domains/${domain.id}/check`, { method: "POST" })).data;
  assert.equal(checked.status, "partially_verified");
  assert.equal(checked.ready, true);
  assert.equal(app.mailDomains.senderDomains().some((item) => item.id === domain.id), true);
  provider.records.find((record) => record.record === "DKIM").status = "pending";
  assert.equal((await call(`/api/mail/domains/${domain.id}/check`, { method: "POST" })).data.ready, false);
  assert.equal(app.mailDomains.senderDomains().some((item) => item.id === domain.id), false);
});
