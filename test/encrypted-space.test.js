import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { knowledgeWorld } from "./knowledge-fixtures.js";
import { createFolderKeys, protectBundle, unlockBundle, encryptDocument, decryptDocument, proveAccess } from "../web/encrypted-space.js";
import { encryptedSpaceFor } from "../src/encrypted-space.js";
import { executeTool } from "../src/tools.js";

const password = "synthetic fixture password, not an account credential";
const payload = JSON.stringify({ title: "Synthetic private title", content: "SYNTHETIC_DOCUMENT_MUST_NEVER_REACH_CHAT_OR_LOGS" });
async function world(t) {
  const f = await knowledgeWorld(); t.after(() => f.close());
  f.api = (actor) => async (path, options) => { const r = await f.request(actor, path, options); if (r.status >= 400) throw Object.assign(Error(r.data.error), { status: r.status }); return r.data; };
  f.aliceApi = f.api(f.alice); f.bobApi = f.api(f.bob);
  await f.request(f.admin, "/api/encrypted/settings", { method: "PUT", body: { enabled: true } });
  f.agent = f.app.store.createAgent({ name: "Private worker", model: "ollama/fixture", brainOwnerId: f.alice.user.id, enabled: false, tools: false });
  f.make = async (actor, suffix) => {
    const api = f.api(actor);
    const folder = await api("/api/artifacts/folders", { method: "POST", body: { path: "synthetic/" + suffix, title: "Encrypted " + suffix } });
    const keys = await createFolderKeys(folder.id, "password", password);
    const configured = await api(`/api/encrypted/folders/${folder.id}/configure`, { method: "POST", body: keys });
    const method = configured.methods[0], bundle = await unlockBundle(folder.id, method, password);
    const proof = (intent) => proveAccess(api, folder.id, bundle, method, intent);
    return { folder, configured, method, bundle, proof, api };
  };
  f.a = await f.make(f.alice, "alice");
  f.save = async (a = f.a, old = null, content = payload) => {
    const documentId = old?.id || "ed_" + randomBytes(12).toString("hex");
    return a.api(`/api/encrypted/folders/${a.folder.id}/documents`, { method: "POST", body: { id: documentId, base: old?.version || 0, envelope: await encryptDocument(a.configured.publicKey, content, `cora:${a.folder.id}:${documentId}:${(old?.version || 0) + 1}`), proof: await a.proof(`write:${documentId}:${old?.version || 0}`) } });
  };
  f.requestAccess = (doc) => f.aliceApi(`/api/encrypted/folders/${f.a.folder.id}/requests`, { method: "POST", body: { agent: f.agent.id, document: doc.id, version: doc.version, operation: "read" } });
  f.approve = async (r) => f.aliceApi(`/api/encrypted/requests/${r.id}/approve`, { method: "POST", body: { content: payload, instruction: "Synthetic private instruction", proof: await f.a.proof(`approve:${r.id}`) } });
  return f;
}
test("encrypted space defaults off, isolates owners/admin and refuses plaintext artifact writes", async (t) => {
  const f = await knowledgeWorld(); t.after(() => f.close());
  assert.equal((await f.request(f.admin, "/api/encrypted/settings")).data.enabled, false);
  assert.equal((await f.request(f.alice, "/api/encrypted/settings", { method: "PUT", body: { enabled: true } })).status, 403);
  const a = await f.request(f.alice, "/api/artifacts/folders", { method: "POST", body: { path: "synthetic/a" } });
  const keys = await createFolderKeys(a.data.id, "password", password);
  assert.equal((await f.request(f.alice, `/api/encrypted/folders/${a.data.id}/configure`, { method: "POST", body: keys })).status, 409);
  await f.request(f.admin, "/api/encrypted/settings", { method: "PUT", body: { enabled: true } });
  assert.equal((await f.request(f.alice, `/api/encrypted/folders/${a.data.id}/configure`, { method: "POST", body: keys })).status, 201);
  for (const actor of [f.bob, f.admin]) assert.equal((await f.request(actor, `/api/encrypted/folders/${a.data.id}`)).status, 404);
  for (const action of ["blobs", "upload", "shares", "remove"]) assert.equal((await f.request(f.alice, `/api/artifacts/folders/${a.data.id}/${action}`, { method: "POST", body: {} })).status, 409);
  await assert.rejects(f.app.artifacts.receive(a.data.id, f.alice.user, null, 0), /Encrypted folder/);
  assert.throws(() => f.app.artifacts.createShare(a.data.id, {}), /Encrypted folder/);
});
test("versioned encrypted storage, AAD, tamper rejection, fresh browser keys and single-use proof", async (t) => {
  const f = await world(t), a = f.a;
  const doc = await f.save(); assert.equal(doc.version, 1); assert.equal(await decryptDocument(a.bundle, doc.envelope), payload);
  const reloaded = await unlockBundle(a.folder.id, (await a.api(`/api/encrypted/folders/${a.folder.id}`)).folder.methods[0], password);
  assert.equal(await decryptDocument(reloaded, doc.envelope), payload);
  await assert.rejects(unlockBundle(a.folder.id, a.method, "incorrect fixture password"), /Sblocco/);
  const cipher = { ...doc.envelope, ciphertext: (doc.envelope.ciphertext[0] === "A" ? "B" : "A") + doc.envelope.ciphertext.slice(1) };
  await assert.rejects(decryptDocument(a.bundle, cipher));
  const second = await f.save(a, doc, payload + " updated"); assert.equal(second.version, 2);
  assert.equal((await a.api(`/api/encrypted/folders/${a.folder.id}/documents?document=${doc.id}&version=1`)).version, 1);
  await assert.rejects(f.save(a, doc), (e) => e.status === 409);
  const proof = await a.proof("read");
  await a.api(`/api/encrypted/folders/${a.folder.id}/read`, { method: "POST", body: { proof } });
  await assert.rejects(a.api(`/api/encrypted/folders/${a.folder.id}/read`, { method: "POST", body: { proof } }), (e) => e.status === 403);
  const substituted = await a.proof("export:wrong");
  await assert.rejects(a.api(`/api/encrypted/folders/${a.folder.id}/read`, { method: "POST", body: { proof: substituted } }), (e) => e.status === 403);
  const records = JSON.stringify(f.app.store.db.prepare("SELECT * FROM encrypted_documents").all());
  assert.ok(!records.includes("SYNTHETIC_DOCUMENT") && !records.includes("Synthetic private title"));
});
test("independent folder keys, alternative passwords, revocation and separately encrypted recipient copy", async (t) => {
  const f = await world(t), a = f.a, b = await f.make(f.bob, "bob"), doc = await f.save();
  await assert.rejects(decryptDocument(b.bundle, doc.envelope));
  const add = await protectBundle(a.folder.id, a.bundle, "password", password + " alternative");
  const updated = await a.api(`/api/encrypted/folders/${a.folder.id}/methods`, { method: "PUT", body: { add, proof: await a.proof("methods") } });
  assert.equal(updated.methods.length, 2);
  const alternative = await unlockBundle(a.folder.id, updated.methods[1], password + " alternative");
  assert.equal(await decryptDocument(alternative, doc.envelope), payload);
  await b.api(`/api/encrypted/folders/${b.folder.id}/methods`, { method: "PUT", body: { acceptShares: true, proof: await b.proof("methods") } });
  const recipients = await a.api("/api/encrypted/recipients"); assert.equal(recipients.length, 1); assert.ok(!JSON.stringify(recipients).includes("methods"));
  const targetDocument = "ed_" + randomBytes(12).toString("hex");
  const delivery = await a.api(`/api/encrypted/folders/${a.folder.id}/share`, { method: "POST", body: { document: doc.id, version: 1, target: b.folder.id, targetDocument, envelope: await encryptDocument(b.configured.publicKey, payload, `cora:${b.folder.id}:${targetDocument}:1`), proof: await a.proof(`share:${doc.id}:1:${b.folder.id}:${targetDocument}`) } });
  assert.equal(delivery.state, "pending");
  const inbox = (await b.api(`/api/encrypted/folders/${b.folder.id}`)).inbox; assert.equal(inbox.length, 1);
  assert.notEqual(inbox[0].envelope.key, doc.envelope.key); assert.equal(await decryptDocument(b.bundle, inbox[0].envelope), payload);
  await assert.rejects(decryptDocument(a.bundle, inbox[0].envelope));
  await b.api(`/api/encrypted/folders/${b.folder.id}/receive`, { method: "POST", body: { delivery: delivery.id, accept: true, proof: await b.proof(`accept:${delivery.id}`) } });
  assert.equal((await b.api(`/api/encrypted/folders/${b.folder.id}`)).documents.length, 1);
  a.method = updated.methods[1]; a.bundle = alternative; a.proof = (intent) => proveAccess(a.api, a.folder.id, a.bundle, a.method, intent);
  await a.api(`/api/encrypted/folders/${a.folder.id}/methods`, { method: "PUT", body: { remove: updated.methods[0].id, proof: await a.proof("methods") } });
  await assert.rejects(a.api(`/api/encrypted/folders/${a.folder.id}/methods`, { method: "PUT", body: { remove: a.method.id, proof: await a.proof("methods") } }), (e) => e.status === 409);
});
test("private model journey encrypts chat/reasoning and never enters messages, traces or tool execution", async (t) => {
  const f = await world(t), doc = await f.save();
  let seen;
  f.state.answer = (body) => { seen = body; return { content: "SYNTHETIC_PRIVATE_RESULT", thinking: "SYNTHETIC_PRIVATE_REASONING" }; };
  const request = await f.requestAccess(doc), result = await f.approve(request);
  assert.equal(result.state, "complete"); assert.ok(!seen.tools?.length);
  assert.ok(seen.messages[1].content.includes("SYNTHETIC_DOCUMENT"));
  const plain = JSON.parse(await decryptDocument(f.a.bundle, result.result));
  assert.equal(plain.answer, "SYNTHETIC_PRIVATE_RESULT"); assert.equal(plain.reasoning, "SYNTHETIC_PRIVATE_REASONING");
  await assert.rejects(f.approve(request), (e) => e.status === 409);
  for (const row of f.app.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
    if (!/^[a-z_]+$/.test(row.name)) continue;
    const records = JSON.stringify(f.app.store.db.prepare(`SELECT * FROM ${row.name}`).all());
    for (const secret of ["SYNTHETIC_DOCUMENT_MUST", "SYNTHETIC_PRIVATE_RESULT", "SYNTHETIC_PRIVATE_REASONING", "Synthetic private instruction"]) assert.ok(!records.includes(secret), `${row.name} leaked ${secret}`);
  }
  const denied = await executeTool({ name: "say", args: { text: "private" } }, { encryptedSession: true, store: f.app.store, agent: f.agent }); assert.match(denied.text, /cannot execute/);
});
test("revocation, expiry, changed versions, foreign ownership and encrypted-only tool refusals", async (t) => {
  const f = await world(t), doc = await f.save(), request = await f.requestAccess(doc);
  assert.equal((await f.request(f.bob, `/api/encrypted/requests/${request.id}`)).status, 404);
  let started, release; const waiting = new Promise((resolve) => { started = resolve; });
  f.app.llm.chat = async () => { started(); return new Promise((resolve) => { release = resolve; }); };
  const running = f.approve(request); await waiting;
  await f.aliceApi(`/api/encrypted/requests/${request.id}`, { method: "DELETE" });
  release({ text: "SYNTHETIC_REVOKED_RESULT", thinking: "" }); await assert.rejects(running, (e) => e.status === 409);
  const current = await f.aliceApi(`/api/encrypted/requests/${request.id}`); assert.equal(current.state, "revoked"); assert.equal(current.result, undefined);
  const stale = await f.requestAccess(doc); await f.save(f.a, doc);
  await assert.rejects(f.approve(stale), (e) => e.status === 409);
  await f.aliceApi(`/api/encrypted/agents/${f.agent.id}`, { method: "PUT", body: { encryptedOnly: true } });
  for (const name of ["shell", "email_send", "share_file", "artifact_push", "brain_search", "secret_import"]) {
    const result = await executeTool({ name, args: {} }, { agent: f.agent, store: f.app.store }); assert.match(result.text, /encrypted-only mode/);
  }
  assert.equal((await f.request(f.bob, `/api/encrypted/agents/${f.agent.id}`, { method: "PUT", body: { encryptedOnly: false } })).status, 404);
  await f.request(f.admin, "/api/encrypted/settings", { method: "PUT", body: { enabled: false } });
  const records = await f.a.api(`/api/encrypted/folders/${f.a.folder.id}`); assert.equal(records.documents.length, 1);
  await assert.rejects(f.requestAccess(doc), (e) => e.status === 409);
});

test("expired approvals, rejected tools, provider errors and disabled space fail closed", async (t) => {
  const f = await world(t), doc = await f.save(), service = encryptedSpaceFor(f.app.store);
  const expired = await f.requestAccess(doc); service.saveRequest({ ...expired, expires: Date.now() - 1 });
  await assert.rejects(f.approve(expired), (e) => e.status === 409);
  const unexpectedTool = await f.requestAccess(doc);
  f.app.llm.chat = async () => ({ text: "private", toolCalls: [{ name: "say", args: { text: "must not send" } }] });
  await assert.rejects(f.approve(unexpectedTool), (e) => e.status === 409);
  assert.equal((await f.aliceApi(`/api/encrypted/requests/${unexpectedTool.id}`)).result, undefined);
  const providerError = await f.requestAccess(doc);
  f.app.llm.chat = async () => { throw Error("SYNTHETIC_PROVIDER_BODY_CONTAINS_PRIVATE_CONTENT"); };
  await assert.rejects(f.approve(providerError), (e) => e.status === 409 && !e.message.includes("SYNTHETIC_PROVIDER"));
  const disabled = await f.requestAccess(doc);
  await f.request(f.admin, "/api/encrypted/settings", { method: "PUT", body: { enabled: false } });
  await assert.rejects(f.approve(disabled), (e) => e.status === 409);
  assert.equal((await f.aliceApi(`/api/encrypted/requests/${disabled.id}`)).state, "revoked");
  await assert.rejects(decryptDocument(f.a.bundle, doc.envelope, `cora:${f.a.folder.id}:substituted-document:1`), /versione richiesta/);
});
test("folder-method and person revocation invalidate pending/running access; interrupted workers never resume plaintext", async (t) => {
  const f = await world(t), doc = await f.save(), service = encryptedSpaceFor(f.app.store);
  const pending = await f.requestAccess(doc);
  await f.a.api(`/api/encrypted/folders/${f.a.folder.id}/methods`, { method: "PUT", body: { acceptShares: true, proof: await f.a.proof("methods") } });
  assert.equal((await f.aliceApi(`/api/encrypted/requests/${pending.id}`)).state, "revoked");
  const recovery = await f.requestAccess(doc); service.saveRequest({ ...recovery, state: "running" });
  const restored = new service.constructor({ store: f.app.store, llm: f.app.llm, knowledge: f.app.knowledge, artifacts: f.app.artifacts });
  assert.equal(restored.getRequest(recovery.id, f.alice.user).state, "interrupted");
  const personRequest = await f.requestAccess(doc); let started, release;
  const waiting = new Promise((resolve) => { started = resolve; });
  f.app.llm.chat = async () => { started(); return new Promise((resolve) => { release = resolve; }); };
  const running = f.approve(personRequest); await waiting;
  const livePerson = f.app.store.panelUser(f.alice.user.id);
  f.app.store.blockPanelUser(livePerson.id, true);
  release({ text: "SYNTHETIC_RESULT_AFTER_PERSON_REVOCATION", thinking: "" });
  await assert.rejects(running);
});
