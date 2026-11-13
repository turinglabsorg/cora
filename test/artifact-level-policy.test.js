import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { knowledgeWorld } from "./knowledge-fixtures.js";
import { fakeDocker } from "./helpers.js";

const level = (path, suffix = "") => `/api/artifacts/level${suffix}?${new URLSearchParams({ path })}`;

test("artifact level publication follows nearest owner rules for existing and future folders and actual agent pushes", async (t) => {
  const docker = fakeDocker();
  const f = await knowledgeWorld({ docker: docker.path }); t.after(f.close);
  const make = async (actor, path) => {
    const r = await f.request(actor, "/api/artifacts/folders", { method: "POST", body: { path } });
    assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data;
  };
  const set = async (actor, path, policy) => f.request(actor, level(path, "/settings"), { method: "PUT", body: { policy } });
  const view = async (folder) => (await f.request(f.alice, `/api/artifacts/folders/${folder.id}`)).data.folder;
  const a = await make(f.alice, "crm/acme/reports");
  const sibling = await make(f.alice, "crmx/docs");
  const other = await make(f.bob, "crm/bob/docs");
  const agent = f.app.store.createAgent({ name: "Policy writer", model: "ollama/test-model", brainOwnerId: f.alice.user.id, tools: true });
  const desktop = join(docker.desktop(agent.id), "work", "proof"); mkdirSync(desktop, { recursive: true });
  let n = 0;
  const push = async (folder) => {
    writeFileSync(join(desktop, "proof.txt"), `Synthetic policy evidence ${++n}`);
    return f.app.artifacts.push({ agent, folder: folder.path, path: "/home/agent/work/proof", message: `Policy check ${n}` });
  };
  const pending = await push(a); assert.equal(pending.commit.status, "proposed");
  assert.equal((await set(f.alice, "crm", "direct")).status, 200);
  assert.equal((await view(a)).policy, "direct"); assert.equal((await view(a)).policyLevel, "crm");
  assert.equal((await push(a)).commit.status, "published", "the effective rule controls a real desktop upload");
  assert.equal(f.app.store.artifactCommit(pending.commit.id).status, "superseded", "a rule change does not publish an earlier proposal");
  const later = await make(f.alice, "crm/later/docs"); assert.equal(later.policy, "direct");
  assert.equal((await view(sibling)).policy, "review", "prefix matching respects the slash boundary");
  assert.equal((await f.request(f.bob, `/api/artifacts/folders/${other.id}`)).data.folder.policy, "review", "another owner's folders stay unchanged");
  assert.equal((await set(f.alice, "crm/acme", "review")).status, 200);
  assert.equal((await view(a)).policyLevel, "crm/acme"); assert.equal((await push(a)).commit.status, "proposed");
  assert.equal((await set(f.alice, "crm/acme", null)).status, 200);
  assert.equal((await view(a)).policyLevel, "crm");
  await f.request(f.alice, `/api/artifacts/folders/${a.id}`, { method: "PUT", body: { policy: "review" } });
  assert.equal((await view(a)).policyOverride, true); assert.equal((await push(a)).commit.status, "proposed");
  await f.request(f.alice, `/api/artifacts/folders/${a.id}`, { method: "PUT", body: { policy: null } });
  assert.equal((await view(a)).policyOverride, false); assert.equal((await push(a)).commit.status, "published");
  assert.ok(f.app.artifacts.foldersFor(agent).find((item) => item.folder === a.path).publishing.includes("at once"));
  const nextAgent = f.app.store.createAgent({ name: "Not a writer", model: "ollama/test-model", brainOwnerId: f.alice.user.id, tools: true });
  await f.request(f.alice, `/api/artifacts/folders/${a.id}`, { method: "PUT", body: { writers: [agent.id] } });
  await assert.rejects(f.app.artifacts.push({ agent: nextAgent, folder: a.path, path: "/home/agent/work/proof" }), /may not push/);
  assert.equal((await set(f.alice, "crm", null)).status, 200);
  assert.equal((await view(a)).policy, "review"); assert.equal((await view(later)).policy, "review");
});

test("artifact level policy changes enforce ownership and validation without granting agent or team access", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  const folder = (await f.request(f.alice, "/api/artifacts/folders", { method: "POST", body: { path: "clienti/acme/docs" } })).data;
  const set = (actor, body) => f.request(actor, level("clienti", "/settings"), { method: "PUT", body });
  await f.request(f.alice, level("clienti", "/access"), { method: "PUT", body: { default: "none", users: { [f.bob.user.id]: "write" } } });
  assert.equal((await set(f.bob, { policy: "direct" })).status, 403, "a team writer is not the owner");
  await f.request(f.alice, `/api/artifacts/folders/${folder.id}`, { method: "PUT", body: { reviewers: [f.bob.user.id] } });
  assert.equal((await set(f.bob, { policy: "direct" })).status, 403, "a reviewer is not the owner");
  for (const body of [{}, { policy: "yes" }, { policy: false }, { policy: {} }]) assert.equal((await set(f.alice, body)).status, 400);
  assert.equal((await f.request(f.alice, level("clienti"))).data.settings.policy, null);
  assert.equal((await f.request(f.alice, level("clienti/acme/docs", "/settings"), { method: "PUT", body: { policy: "direct" } })).status, 404);
  assert.equal((await set(f.alice, { policy: "direct" })).status, 200);
  assert.equal((await f.request(f.admin, `/api/artifacts/folders/${folder.id}`)).status, 403, "publication is separate from access");
  const reloaded = await f.request(f.alice, level("clienti"));
  assert.deepEqual(reloaded.data.settings, { policy: "direct", effective: "direct", level: "clienti" });
});


test("artifact level rules do not bypass encrypted or sealed folder workflows", async (t) => {
  const docker = fakeDocker();
  const f = await knowledgeWorld({ docker: docker.path }); t.after(f.close);
  const encrypted = f.app.artifacts.createFolder({ path: "clients/private/encrypted", createdBy: { kind: "user", id: f.alice.user.id } });
  f.app.store.setValue(`encryptedFolder:${encrypted.id}`, true);
  const sealed = f.app.store.createAgent({ name: "Sealed policy agent", model: "ollama/test-model", brainOwnerId: f.alice.user.id, sealed: true, tools: true });
  const folder = f.app.artifacts.createFolder({ path: "clients/sealed/report", createdBy: { kind: "agent", id: sealed.id } });
  assert.equal(folder.sealedAgentId, sealed.id);
  const saved = await f.request(f.alice, level("clients", "/settings"), { method: "PUT", body: { policy: "direct" } });
  assert.equal(saved.status, 200);
  assert.equal(f.app.artifacts.folderView(encrypted).policy, "review");
  assert.equal(f.app.artifacts.folderView(encrypted).policyLevel, "");
  assert.equal(f.app.artifacts.folderView(folder).policy, "review");
  const path = join(docker.desktop(sealed.id), "work", "proof"); mkdirSync(path, { recursive: true }); writeFileSync(join(path, "report.txt"), "Synthetic sealed report");
  const result = await f.app.artifacts.push({ agent: sealed, folder: folder.path, path: "/home/agent/work/proof" });
  assert.equal(result.commit.status, "proposed", "a parent rule never publishes a sealed payload");
  await assert.rejects(f.app.artifacts.push({ agent: sealed, folder: encrypted.path, path: "/home/agent/work/proof" }), /cifrat|encrypted/i);
});


test("artifact folder creation honors explicit choices and preserves legacy direct publication once", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  const make = async (path, policy) => {
    const r = await f.request(f.alice, "/api/artifacts/folders", { method: "POST", body: { path, ...(policy === undefined ? {} : { policy }) } });
    assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data;
  };
  const legacy = await make("crm/legacy/direct", "direct");
  const record = f.app.store.artifactFolder(legacy.id); delete record.policyOverride;
  f.app.store.writeArtifactFolder(record); f.app.store.setValue("artifactPublicationPolicyVersion", 0);
  f.app.artifacts.migratePublicationPolicies();
  assert.deepEqual(f.app.store.artifactFolder(legacy.id), { ...record, policyOverride: true });
  f.app.store.setValue("artifactLevelPolicies", { crm: { [f.alice.user.id]: { policy: "review" } } });
  const direct = await make("crm/new/direct", "direct");
  assert.equal(direct.policy, "direct"); assert.equal(direct.policyOverride, true);
  assert.equal(f.app.artifacts.folderView(f.app.store.artifactFolder(legacy.id)).policy, "direct", "a pre-existing owner choice survives parent review");
  f.app.store.setValue("artifactLevelPolicies", { crm: { [f.alice.user.id]: { policy: "direct" } } });
  const review = await make("crm/new/review", "review");
  assert.equal(review.policy, "review"); assert.equal(review.policyOverride, true);
  const inherit = await make("crm/new/inherit", null);
  assert.equal(inherit.policy, "direct"); assert.equal(inherit.policyOverride, false);
  const implicit = await make("crm/new/default"); assert.equal(implicit.policy, "direct"); assert.equal(implicit.policyOverride, false);
  await f.request(f.alice, `/api/artifacts/folders/${legacy.id}`, { method: "PUT", body: { policy: null } });
  f.app.artifacts.migratePublicationPolicies();
  assert.equal(f.app.store.artifactFolder(legacy.id).policyOverride, false, "rerunning startup never restores a deliberately cleared override");
});
