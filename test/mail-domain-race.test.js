import assert from "node:assert/strict";
import { test } from "node:test";
import { mailWorld } from "./mail-fixtures.js";

test("RADIX: mailbox assignment racing a send-only switch", async (t) => {
  const { app, state, keyA, call } = await mailWorld(t);
  const account = (await call("/api/mail/accounts", { method: "POST", body: { name: "Azienda", key: keyA } })).data;
  const domain = (await call("/api/mail/domains", { method: "POST", body: { name: "posta.azienda.test", accountId: account.id } })).data;
  state.dnsReady.add(domain.name);
  assert.equal((await call(`/api/mail/domains/${domain.id}/verify`, { method: "POST" })).data.ready, true);
  let provisions = 0;
  app.mailDomains.boxes = { assignMailbox: async (agent, { local, domain: d }) => { provisions++; const m = { email: `${local}@${d}`, status: "ready" }; app.store.setValue(`agentMailbox:${agent.id}`, m); return m; } };
  const agent = app.store.createAgent({ name: "Fixture", tools: true });
  const original = app.mailDomains.resend.bind(app.mailDomains);
  let inPatch, release;
  const entered = new Promise((r) => (inPatch = r));
  const gate = new Promise((r) => (release = r));
  app.mailDomains.resend = async (acc, path, options = {}) => {
    if (options.method === "PATCH" && path.startsWith("/domains/")) { inPatch(); await gate; }
    return original(acc, path, options);
  };
  const switching = call(`/api/mail/domains/${domain.id}`, { method: "PUT", body: { mode: "send-only" } });
  await entered;
  const assigning = call(`/api/agents/${agent.id}/mailbox`, { method: "PUT", body: { local: "nico", domain: domain.name } });
  await new Promise((r) => setTimeout(r, 200));
  release();
  const [sw, as] = await Promise.all([switching, assigning]);
  const final = app.mailDomains.data().domains[0];
  console.log("switch", sw.status, "mode", final.mode, "receiving", state.accounts.get(keyA).domains[0].capabilities.receiving);
  console.log("assign", as.status, JSON.stringify(as.data), "provisions", provisions, "mailbox", JSON.stringify(app.store.value(`agentMailbox:${agent.id}`, null)));
  assert.ok(!(final.mode === "send-only" && provisions > 0), "a receiving mailbox was provisioned on a send-only domain");
});
