import assert from "node:assert/strict";
import { test } from "node:test";
import { mailWorld } from "./mail-fixtures.js";

async function world(t, mode) {
  const f = await mailWorld(t);
  f.app.email.instanceUrl = f.base;
  const account = (await f.call("/api/mail/accounts", { method: "POST", body: { name: "Studio", key: f.keyA } })).data;
  const domain = (await f.call("/api/mail/domains", { method: "POST", body: { name: "studio.test", accountId: account.id, mode } })).data;
  f.state.dnsReady.add(domain.name);
  if (mode === "send-only") f.state.receivingPending = new Set([domain.name]);
  await f.call(`/api/mail/domains/${domain.id}/verify`, { method: "POST" });
  return { ...f, domain };
}
const message = { to: ["recipient@example.test"], subject: "x", body_text: "y" };

test("two agents cannot be assigned the same send-only sender", async (t) => {
  const f = await world(t, "send-only");
  const a = f.app.store.createAgent({ name: "Nico", enabled: true, tools: true });
  const b = f.app.store.createAgent({ name: "Other", enabled: true, tools: true });
  assert.equal((await f.call(`/api/agents/${a.id}/email`, { method: "PUT", body: { resendSender: { local: "nico", domainId: f.domain.id } } })).status, 200);
  const dup = await f.call(`/api/agents/${b.id}/email`, { method: "PUT", body: { resendSender: { local: "nico", domainId: f.domain.id } } });
  if (dup.status === 200) {
    const sent = await f.app.email.send(b, { ...message, sender_id: "resend" }, { requester: { kind: "owner" } });
    assert.fail(`duplicate sender accepted; Other sent as ${sent.from}`);
  }
  assert.equal(dup.status, 409);
});

test("a send-only sender cannot reuse another agent's receiving mailbox address", async (t) => {
  const f = await world(t, "send-receive");
  const a = f.app.store.createAgent({ name: "Nico", enabled: true, tools: true });
  const b = f.app.store.createAgent({ name: "Other", enabled: true, tools: true });
  f.app.store.setValue(`agentMailbox:${a.id}`, { status: "ready", email: "nico@studio.test", agentId: "nico@studio.test", previousEmails: [] });
  const res = await f.call(`/api/agents/${b.id}/email`, { method: "PUT", body: { resendSender: { local: "nico", domainId: f.domain.id } } });
  if (res.status === 200) {
    const sent = await f.app.email.send(b, { ...message, sender_id: "resend" }, { requester: { kind: "owner" } });
    assert.fail(`Other sent as Nico's mailbox ${sent.from}, provider ${sent.provider}`);
  }
  assert.equal(res.status, 409);
});

test("retained mailbox addresses and existing outgoing senders reserve the address in both directions", async (t) => {
  const f = await world(t, "send-receive");
  const a = f.app.store.createAgent({ name: "Nico", enabled: true, tools: true });
  const b = f.app.store.createAgent({ name: "Other", enabled: true, tools: true });
  f.app.store.setValue(`agentMailbox:${a.id}`, { status: "ready", email: "nico@usecora.space", previousEmails: ["retained@studio.test"] });
  assert.equal((await f.call(`/api/agents/${b.id}/email`, { method: "PUT", body: { resendSender: { local: "retained", domainId: f.domain.id } } })).status, 409);
  assert.equal((await f.call(`/api/agents/${a.id}/email`, { method: "PUT", body: { resendSender: { local: "outgoing", domainId: f.domain.id } } })).status, 200);
  assert.equal((await f.call(`/api/agents/${b.id}/mailbox`, { method: "PUT", body: { local: "outgoing", domain: f.domain.name } })).status, 409);
  f.app.store.setValue(`emailRules:${b.id}`, { resendSender: { local: "outgoing", domainId: f.domain.id }, senderId: "resend" });
  await assert.rejects(() => f.app.email.send(b, message, { requester: { kind: "owner" } }), /altro agente/);
  assert.equal(f.state.providerSent, undefined);
});

test("a pending receiving mailbox assignment cannot be claimed as another agent's outgoing sender", async (t) => {
  const f = await world(t, "send-receive");
  const a = f.app.store.createAgent({ name: "Nico", enabled: true, tools: true });
  const b = f.app.store.createAgent({ name: "Other", enabled: true, tools: true });
  let release, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  f.app.mailDomains.boxes = { assignMailbox: async () => { entered(); await new Promise((resolve) => { release = resolve; }); return { email: "nico@studio.test", status: "ready" }; } };
  const assignment = f.call(`/api/agents/${a.id}/mailbox`, { method: "PUT", body: { local: "nico", domain: f.domain.name } });
  await waiting;
  assert.equal((await f.call(`/api/agents/${b.id}/email`, { method: "PUT", body: { resendSender: { local: "nico", domainId: f.domain.id } } })).status, 409);
  release();
  assert.equal((await assignment).status, 200);
});
