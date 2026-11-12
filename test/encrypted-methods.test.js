import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHmac } from "node:crypto";
import { readdirSync } from "node:fs";
import { encryptedSpaceFor } from "../src/encrypted-space.js";
import { knowledgeWorld } from "./knowledge-fixtures.js";
import { createPasskey, createFolderKeys, protectBundle, unlockBundle, proveAccess, encryptDocument, documentId } from "../web/encrypted-crypto.js";
import { uploadEncryptedFile, downloadEncryptedFile } from "../web/encrypted-files.js";
import { convertEncryptedFolder } from "../web/encrypted-conversion.js";
const password = "synthetic plaintext conversion password";
async function setup(t) {
  const f = await knowledgeWorld(); t.after(f.close);
  const api = async (path, options) => { const r = await f.request(f.alice, path, options); if (r.status >= 400) throw Object.assign(Error(r.data.error), { status: r.status }); return r.data; };
  const folder = await api("/api/artifacts/folders", { method: "POST", body: { path: "synthetic/method-conversion", title: "Private documents" } });
  const keys = await createFolderKeys(folder.id, "password", password), saved = await api(`/api/encrypted/folders/${folder.id}/configure`, { method: "POST", body: keys });
  const bundle = await unlockBundle(folder.id, saved.methods[0], password);
  const x = { f, folder: folder.id, api, bundle, method: saved.methods[0], publicKey: keys.publicKey };
  x.proof = intent => proveAccess(api, x.folder, bundle, x.method, intent);
  x.save = async (value, kind = "artifact", previous = null) => {
    const id = previous?.id || documentId(), base = previous?.version || 0;
    return api(`/api/encrypted/folders/${x.folder}/documents`, { method: "POST", body: { id, base, kind, envelope: await encryptDocument(keys.publicKey, JSON.stringify(value), `cora:${x.folder}:${id}:${base + 1}`), proof: await x.proof(`write:${id}:${base}`) } });
  };
  return x;
}
function authenticator(t, prf) {
  const descriptors = ["navigator", "window", "location"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]), records = new Map(); let creates = 0;
  const auth = () => { const bytes = new Uint8Array(37); bytes[32] = 5; return bytes.buffer; };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { PublicKeyCredential: true } });
  Object.defineProperty(globalThis, "location", { configurable: true, value: { hostname: "localhost" } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { credentials: {
    create: async ({ publicKey: pk }) => { creates++; const id = randomBytes(32).toString("base64url"); records.set(id, Buffer.from(pk.user.id)); return { id, response: { getAuthenticatorData: auth }, getClientExtensionResults: () => ({ prf: { enabled: prf } }) }; },
    get: async ({ publicKey: pk }) => { const id = Buffer.from(pk.allowCredentials[0].id).toString("base64url"), seed = records.get(id); assert.ok(seed); return { id, response: { authenticatorData: auth(), userHandle: Uint8Array.from(seed).buffer }, getClientExtensionResults: () => ({ prf: { results: { first: Uint8Array.from(createHmac("sha256", seed).update(Buffer.from(pk.extensions?.prf.eval.first || [])).digest()).buffer } } }) }; }
  } } });
  t.after(() => { for (const [key, descriptor] of descriptors) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  return () => creates;
}
for (const prf of [false, true]) test(`one personal passkey with PRF ${prf} protects independent folders and remains listed after unlinking`, async t => {
  const x = await setup(t), count = authenticator(t, prf), credential = await createPasskey("Shared authenticator");
  await x.api("/api/encrypted/passkeys", { method: "POST", body: credential });
  const folders = [];
  for (const name of ["one", "two"]) {
    const folder = await x.api("/api/artifacts/folders", { method: "POST", body: { path: "synthetic/passkey-" + name } });
    const keys = await createFolderKeys(folder.id, "passkey", "", credential.label, "auto", undefined, name, credential);
    const saved = await x.api(`/api/encrypted/folders/${folder.id}/configure`, { method: "POST", body: keys });
    const bundle = await unlockBundle(folder.id, saved.methods[0]); folders.push({ folder, keys, saved, bundle });
  }
  assert.equal(count(), 1); assert.notDeepEqual(folders[0].bundle.privateKey, folders[1].bundle.privateKey);
  assert.notEqual(folders[0].saved.methods[0].salt, folders[1].saved.methods[0].salt);
  let registry = await x.api("/api/encrypted/passkeys"); assert.equal(registry.passkeys.length, 1); assert.equal(registry.passkeys[0].folders.length, 2);
  assert.equal(registry.passkeys[0].derivation, prf ? "prf-v1" : "handle-v1"); assert.ok(registry.passkeys[0].createdAt);
  assert.equal((await x.f.request(x.f.bob, "/api/encrypted/passkeys")).data.passkeys.length, 0);
  assert.equal((await x.f.request(x.f.admin, "/api/encrypted/passkeys")).data.passkeys.length, 0);
  assert.doesNotMatch(JSON.stringify(registry), /privateKey|signingKey|ciphertext|prfOutput|userHandle/);
  const a = folders[0], proof = intent => proveAccess(x.api, a.folder.id, a.bundle, a.saved.methods[0], intent);
  await assert.rejects(x.api(`/api/encrypted/folders/${a.folder.id}/methods`, { method: "PUT", body: { remove: a.saved.methods[0].id, proof: await proof("methods") } }), e => e.status === 409);
  await x.api(`/api/encrypted/folders/${a.folder.id}/methods`, { method: "PUT", body: { add: await protectBundle(a.folder.id, a.bundle, "password", password), proof: await proof("methods") } });
  await x.api(`/api/encrypted/folders/${a.folder.id}/methods`, { method: "PUT", body: { remove: a.saved.methods[0].id, proof: await proof("methods") } });
  registry = await x.api("/api/encrypted/passkeys"); assert.deepEqual(registry.passkeys[0].folders.map(f => f.id), [folders[1].folder.id]);
  const old = await unlockBundle(folders[1].folder.id, folders[1].saved.methods[0]); assert.deepEqual(old, folders[1].bundle);
});
test("confirmed decryption preserves binary bytes, paths, empty files, every version, conversation and private result", async t => {
  const x = await setup(t), first = randomBytes(600000), second = randomBytes(313), path = "Nested/日本語/résumé.bin";
  const one = await uploadEncryptedFile({ ...x, path, file: new File([first], "résumé.bin") });
  await uploadEncryptedFile({ ...x, path, file: new File([second], "résumé.bin"), previous: one.doc });
  await uploadEncryptedFile({ ...x, file: new File([], "empty.txt") });
  await x.save({ title: "My document", content: "EXACT EDITOR CONTENT\n" });
  const transcript = { format: "conversation-v1", title: "Private dialogue", messages: [{ role: "user", content: "Synthetic private question" }] }, chat = await x.save(transcript, "chat");
  const agent = x.f.app.store.createAgent({ name: "Private converter", model: "ollama/fixture", brainOwnerId: x.f.alice.user.id, enabled: false });
  x.f.state.answer = () => ({ content: "SYNTHETIC RESULT", thinking: "SYNTHETIC REASONING" });
  const request = await x.api(`/api/encrypted/folders/${x.folder}/requests`, { method: "POST", body: { agent: agent.id, document: chat.id, version: 1, operation: "chat" } });
  await x.api(`/api/encrypted/requests/${request.id}/approve`, { method: "POST", body: { content: JSON.stringify(transcript), instruction: "Continue", proof: await x.proof(`approve:${request.id}`) } });
  let finalInput;
  const api = async (url, opts) => { if (url.endsWith("/decrypt-finish")) finalInput = opts.body; return x.api(url, opts); };
  const conversion = encryptedSpaceFor(x.f.app.store).conversion, snapshot = conversion.snapshot; let fullChecks = 0;
  conversion.snapshot = function (...args) { fullChecks++; return snapshot.apply(this, args); };
  const result = await convertEncryptedFolder({ ...x, api }); assert.equal(result.versions, 6);
  assert.equal(fullChecks, 2, "full ciphertext checks run at preparation and cutover, not for every chunk");
  const store = x.f.app.store, artifacts = x.f.app.artifacts, folder = store.artifactFolder(x.folder);
  assert.equal(store.value(`encryptedFolder:${x.folder}`), false); assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM encrypted_documents WHERE folder = ?").get(x.folder).n, 0);
  const commits = store.artifactCommits(x.folder); assert.equal(commits.length, 6);
  const read = (commit, path) => artifacts.readObject(artifacts.treeOf(commit).get(path).sha, 2 * 1024 * 1024);
  const old = commits.find(c => c.encryptedSource.id === one.doc.id && c.encryptedSource.version === 1); assert.deepEqual(read(old.id, path), first); assert.deepEqual(read(folder.head, path), second);
  assert.equal(read(folder.head, "empty.txt").length, 0);
  assert.equal(read(folder.head, `Conversations/${chat.id}.json`).toString(), JSON.stringify(transcript));
  assert.match(read(folder.head, `Sessions/${request.id}.json`).toString(), /SYNTHETIC RESULT/); assert.match(read(folder.head, `Sessions/${request.id}.json`).toString(), /SYNTHETIC REASONING/);
  const editor = commits.find(c => c.encryptedSource.title === "My document"); assert.equal(read(editor.id, editor.encryptedSource.path).toString(), "EXACT EDITOR CONTENT\n");
  assert.deepEqual(await x.api(`/api/encrypted/folders/${x.folder}/decrypt-finish`, { method: "POST", body: finalInput }), result);
  assert.equal((await x.f.request(x.f.bob, `/api/encrypted/folders/${x.folder}/decrypt-finish`, { method: "POST", body: finalInput })).status, 404);
});
test("cancel, tampering, global policy changes and persistence failures leave all encrypted versions intact", async t => {
  const x = await setup(t), originalBytes = randomBytes(600000);
  const binary = await uploadEncryptedFile({ ...x, file: new File([originalBytes], "unchanged.bin") });
  await uploadEncryptedFile({ ...x, file: new File(["SECOND VERSIONED FILE"], "second.txt") });
  const snapshot = () => JSON.stringify(x.f.app.store.db.prepare("SELECT data FROM encrypted_documents WHERE folder = ?").all(x.folder));
  const original = snapshot(), controller = new AbortController();
  await assert.rejects(convertEncryptedFolder({ ...x, signal: controller.signal, progress: () => controller.abort() }), e => e.name === "AbortError"); assert.equal(snapshot(), original);
  const tamper = async (url, opts) => { if (url.endsWith("/decrypt-chunk") && opts.body.chunk === 0 && opts.body.item === 0) opts = { ...opts, body: { ...opts.body, bytes: Buffer.alloc(512 * 1024, 1).toString("base64url") } }; return x.api(url, opts); };
  await assert.rejects(convertEncryptedFolder({ ...x, api: tamper }), e => e.status === 409); assert.equal(snapshot(), original);
  const write = x.f.app.store.writeArtifactCommit; let writes = 0; x.f.app.store.writeArtifactCommit = function (...args) { if (++writes === 2) throw Error("Synthetic commit failure"); return write.apply(this, args); };
  await assert.rejects(convertEncryptedFolder(x), /Synthetic commit failure/); x.f.app.store.writeArtifactCommit = write; assert.equal(snapshot(), original);
  let policySet = false;
  const policy = async (url, opts) => { const r = await x.api(url, opts); if (!policySet && url.endsWith("/decrypt-chunk")) { policySet = true; await x.f.request(x.f.admin, "/api/encrypted/settings", { method: "PUT", body: { enabled: true } }); } return r; };
  await assert.rejects(convertEncryptedFolder({ ...x, api: policy }), e => e.status === 409); assert.equal(snapshot(), original);
  const store = x.f.app.store; assert.equal(store.artifactCommits(x.folder).length, 0); assert.equal(store.value(`encryptedFolder:${x.folder}`), true); assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM encrypted_conversions").get().n, 0);
  assert.equal(store.artifactBytes(), 0);
  assert.equal(readdirSync(x.f.app.artifacts.dir + "/objects", { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).length, 0);
  await x.f.request(x.f.admin, "/api/encrypted/settings", { method: "PUT", body: { enabled: false } });
  const restored = await x.api(`/api/encrypted/folders/${x.folder}`);
  const fresh = await unlockBundle(x.folder, restored.folder.methods[0], password);
  const recovered = restored.documents.find(doc => doc.id === binary.doc.id);
  const exact = await downloadEncryptedFile({ ...x, bundle: fresh, document: recovered }); assert.deepEqual(Buffer.from(exact.bytes), originalBytes);
  const retry = await convertEncryptedFolder({ ...x, bundle: fresh }); assert.equal(retry.versions, 2);

});
test("concurrent encrypted edits prevent an incomplete plaintext cutover", async t => {
  const x = await setup(t), original = await x.save({ title: "Concurrent", content: "first" }); let changed = false;
  const api = async (url, opts) => { const data = await x.api(url, opts); if (url.endsWith("/decrypt-chunk") && !changed) { changed = true; await x.save({ title: "Concurrent", content: "second" }, "artifact", original); } return data; };
  await assert.rejects(convertEncryptedFolder({ ...x, api }), e => e.status === 409);
  assert.equal((await x.api(`/api/encrypted/folders/${x.folder}`)).documents[0].version, 2); assert.equal(x.f.app.store.artifactCommits(x.folder).length, 0);
});

test("a personal folder cannot discard the key still protecting another folder's shared grant", async t => {
  const x = await setup(t), f = x.f;
  await x.api(`/api/encrypted/folders/${x.folder}/methods`, { method: "PUT", body: { acceptShares: true, proof: await x.proof("methods") } });
  const api = async (url, options) => { const r = await f.request(f.bob, url, options); if (r.status >= 400) throw Object.assign(Error(r.data.error), { status: r.status }); return r.data; };
  const source = await api("/api/artifacts/folders", { method: "POST", body: { path: "synthetic/shared-source" } });
  await api(`/api/artifacts/folders/${source.id}`, { method: "PUT", body: { memberAccess: { default: "none", users: { [f.alice.user.id]: "read" } } } });
  const keys = await createFolderKeys(source.id, "password", password), configured = await api(`/api/encrypted/folders/${source.id}/configure`, { method: "POST", body: keys });
  const bundle = await unlockBundle(source.id, configured.methods[0], password), id = "eg_" + randomBytes(12).toString("hex");
  const grant = await api(`/api/encrypted/folders/${source.id}/grants`, { method: "POST", body: { id, target: x.folder, envelope: await encryptDocument(x.publicKey, JSON.stringify(bundle), `cora:${source.id}:grant:${id}:${x.folder}`), proof: await proveAccess(api, source.id, bundle, configured.methods[0], `grant:${id}:${x.folder}`) } });
  await assert.rejects(convertEncryptedFolder(x), error => error.status === 409 && /altre cartelle/.test(error.message));
  assert.equal(f.app.store.value(`encryptedFolder:${x.folder}`), true);
  assert.equal(f.app.store.db.prepare("SELECT COUNT(*) AS n FROM encrypted_folder_grants WHERE id = ?").get(grant.id).n, 1);
});

test("plaintext confirmation covers inherited links and refuses permission or share changes during conversion", async t => {
  const x = await setup(t), { artifacts, store } = x.f.app;
  await uploadEncryptedFile({ ...x, file: new File(["PREFIX LINK CONTENT"], "proof.txt") });
  artifacts.shareSuffix = "fixture.usecora.space";
  const publicLink = () => artifacts.createShare("ag:synthetic", { label: "conversion-" + randomBytes(6).toString("hex"), access: { mode: "public" }, createdBy: { kind: "user", id: x.f.alice.user.id, name: "alice" } });
  let changed = false, added;
  const newShare = async (url, options) => { const result = await x.api(url, options); if (!changed && url.endsWith("/decrypt-chunk")) { changed = true; added = publicLink(); } return result; };
  await assert.rejects(convertEncryptedFolder({ ...x, api: newShare }), e => e.status === 409);
  assert.equal(store.value(`encryptedFolder:${x.folder}`), true); assert.equal(artifacts.groupTree(store.artifactShare(added.id)).tree.size, 0);
  changed = false;
  const permissions = async (url, options) => { const result = await x.api(url, options); if (!changed && url.endsWith("/decrypt-chunk")) { changed = true; const folder = store.artifactFolder(x.folder); store.writeArtifactFolder({ ...folder, memberAccess: { default: "none", users: { [x.f.bob.user.id]: "read" } } }); } return result; };
  await assert.rejects(convertEncryptedFolder({ ...x, api: permissions }), e => e.status === 409);
  assert.equal(store.value(`encryptedFolder:${x.folder}`), true); assert.equal(store.artifactCommits(x.folder).length, 0);
  changed = false;
  const inherited = async (url, options) => { const result = await x.api(url, options); if (!changed && url.endsWith("/decrypt-chunk")) { changed = true; artifacts.updateLevelAccess("synthetic", { default: "none", users: { [x.f.bob.user.id]: "write" } }, x.f.alice.user); } return result; };
  await assert.rejects(convertEncryptedFolder({ ...x, api: inherited }), e => e.status === 409);
  assert.equal(store.value(`encryptedFolder:${x.folder}`), true); assert.equal(store.artifactCommits(x.folder).length, 0);
  const result = await convertEncryptedFolder(x); assert.equal(result.versions, 1);
  const tree = artifacts.groupTree(store.artifactShare(added.id)).tree, item = tree.get("method-conversion/proof.txt");
  assert.ok(item); assert.equal(artifacts.readObject(item.sha).toString(), "PREFIX LINK CONTENT");
});

test("network interruption distinguishes confirmed rollback from an unknown final result and supports retry", async t => {
  const x = await setup(t);
  await x.save({ title: "Network recovery", content: "EXACT NETWORK RECOVERY" });
  const original = JSON.stringify((await x.api(`/api/encrypted/folders/${x.folder}`)).documents);
  const offline = async (url, options) => {
    if (url.endsWith("/decrypt-finish")) throw new TypeError("Failed to fetch");
    return x.api(url, options);
  };
  await assert.rejects(convertEncryptedFolder({ ...x, api: offline }), /Connessione interrotta.*intatta/);
  assert.equal(JSON.stringify((await x.api(`/api/encrypted/folders/${x.folder}`)).documents), original);
  let ticket;
  const uncertain = async (url, options) => {
    if (url.endsWith("/decrypt-finish") || url.endsWith("/decrypt-cancel")) throw new TypeError("Failed to fetch");
    const result = await x.api(url, options); if (url.endsWith("/decrypt-start")) ticket = result.id; return result;
  };
  await assert.rejects(convertEncryptedFolder({ ...x, api: uncertain }), /Verifica lo stato della cartella/);
  assert.equal(JSON.stringify((await x.api(`/api/encrypted/folders/${x.folder}`)).documents), original);
  await x.api(`/api/encrypted/folders/${x.folder}/decrypt-cancel`, { method: "POST", body: { conversion: ticket } });
  assert.equal((await convertEncryptedFolder(x)).versions, 1);
});
