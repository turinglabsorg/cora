import assert from "node:assert/strict";
import { test } from "node:test";
import { mailWorld } from "./mail-fixtures.js";

async function senderWorld(t) {
  const f = await mailWorld(t);
  f.app.email.instanceUrl = f.base;
  const account = (await f.call("/api/mail/accounts", { method: "POST", body: { name: "Studio", key: f.keyA } })).data;
  const domain = (await f.call("/api/mail/domains", { method: "POST", body: { name: "studio.test", accountId: account.id, mode: "send-only" } })).data;
  f.state.dnsReady.add(domain.name);
  f.state.receivingPending = new Set([domain.name]);
  await f.call(`/api/mail/domains/${domain.id}/verify`, { method: "POST" });
  const agent = f.app.store.createAgent({ name: "Nico", enabled: true, tools: true });
  const config = { local: "nico", domainId: domain.id };
  const saved = await f.call(`/api/agents/${agent.id}/email`, { method: "PUT", body: { resendSender: config } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  return { ...f, account, domain, agent, config };
}
const message = { to: ["recipient@example.test"], subject: "A verified send-only sender", body_text: "A message from the assigned sender." };

test("send-only identity uses its Resend account, preserves the receiving mailbox and records readable sent mail", async (t) => {
  const f = await senderWorld(t);
  f.app.store.setValue(`agentMailbox:${f.agent.id}`, { status: "ready", email: "nico@usecora.space", agentId: "nico@usecora.space", endpoint: f.app.mailDomains.endpoint, previousEmails: ["old@usecora.space"] });
  const mailbox = f.app.store.value(`agentMailbox:${f.agent.id}`);
  const sent = await f.app.email.send(f.agent, { ...message, from: "forged@other.test", sender_id: "resend" }, { requester: { kind: "owner" } });
  assert.equal(sent.status, "sent");
  assert.equal(sent.provider, "resend");
  assert.equal(sent.from, "nico@studio.test");
  assert.equal(f.state.providerSent.length, 1);
  assert.equal(f.state.providerSent[0].account, "alpha");
  assert.equal(f.state.providerSent[0].from, "nico@studio.test");
  assert.equal(f.state.providerSent[0].reply_to, "nico@usecora.space");
  assert.match(f.state.providerSent[0].html, /mail\/media/);
  assert.equal(f.state.sent.length, 0, "no send through the mailbox relay");
  assert.equal(f.state.routes.has(f.domain.name), false, "no inbound relay route is required");
  assert.deepEqual(f.app.store.value(`agentMailbox:${f.agent.id}`), mailbox);
  assert.equal(f.app.email.summary(f.agent).sent, 1);
  const recent = f.app.email.recent(f.agent)[0];
  assert.equal(recent.from, "nico@studio.test");
  assert.equal(recent.provider, "resend");
  assert.equal(recent.status, "sent");
  const read = await f.app.email.read(f.agent, sent.id);
  assert.match(read.body, /assigned sender/);
  assert.equal((await f.call(`/api/mail/domains/${f.domain.id}`, { method: "DELETE" })).status, 409);
  assert.equal((await f.call(`/api/agents/${f.agent.id}/email`, { method: "PUT", body: { resendSender: null } })).status, 200);
  assert.equal((await f.call(`/api/mail/domains/${f.domain.id}`, { method: "DELETE" })).status, 200);
  assert.match((await f.app.email.read(f.agent, sent.id)).body, /assigned sender/, "removing sender configuration preserves sent mail");
});

test("send-only sender assignment rejects unauthorized changes, arbitrary senders and stale provider readiness", async (t) => {
  const f = await senderWorld(t);
  assert.equal((await f.call(`/api/agents/${f.agent.id}/email`, { method: "PUT", asMember: true, body: { resendSender: { ...f.config, local: "hijacked" } } })).status, 403);
  assert.equal((await f.call(`/api/agents/${f.agent.id}/email`, { method: "PUT", body: { resendSender: { ...f.config, local: "other@evil.test" } } })).status, 409);
  await assert.rejects(() => f.app.email.send(f.agent, message, {}), /richiesta/);
  const other = f.app.store.createAgent({ name: "Other", enabled: true, tools: true });
  await assert.rejects(() => f.app.email.send(other, { ...message, sender_id: "resend" }, { requester: { kind: "owner" } }), /Scegli un dominio/);
  await assert.rejects(() => f.app.email.send(f.agent, { ...message, sender_id: "nico@studio.test" }, { requester: { kind: "owner" } }));
  assert.equal(f.state.providerSent, undefined);
  f.state.refuse = true;
  await assert.rejects(() => f.app.email.send(f.agent, message, { requester: { kind: "owner" } }), /non confermato/);
  assert.equal(f.state.providerSent, undefined);
  assert.equal(f.app.email.recent(f.agent)[0].status, "uncertain");
  f.state.refuse = false;
  const sent = await f.app.email.send(f.agent, { ...message, subject: "Explicit new send after provider recovery" }, { requester: { kind: "owner" } });
  assert.equal(sent.provider, "resend");
  assert.equal(f.state.providerSent.length, 1);
});

test("changing the assigned send-only identity during composition cancels sending rather than substituting another sender", async (t) => {
  const f = await senderWorld(t);
  const compose = f.app.email.compose.bind(f.app.email);
  f.app.email.compose = async (...args) => {
    const result = await compose(...args);
    await f.app.email.update({ resendSender: { ...f.config, local: "different" } }, f.agent);
    return result;
  };
  await assert.rejects(() => f.app.email.send(f.agent, message, { requester: { kind: "owner" } }), /non confermato/);
  assert.equal(f.state.providerSent, undefined);
  assert.equal(f.app.email.recent(f.agent)[0].status, "uncertain");
});

test("revoking a sender while the provider request is queued prevents dispatch", async (t) => {
  const f = await senderWorld(t);
  const resend = f.app.mailDomains.resend.bind(f.app.mailDomains);
  f.app.mailDomains.resend = async (account, path, options) => {
    if (path === "/emails") await f.app.email.update({ resendSender: null }, f.agent);
    return resend(account, path, options);
  };
  await assert.rejects(() => f.app.email.send(f.agent, message, { requester: { kind: "owner" } }), /non confermato/);
  assert.equal(f.state.providerSent, undefined);
});
