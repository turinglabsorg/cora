import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import http from "node:http";
import { test } from "node:test";
import { knowledgeWorld } from "./knowledge-fixtures.js";
import { fakeDocker } from "./helpers.js";
import { executeTool } from "../src/tools.js";
import { passKeys, signPass } from "../src/pass.js";

function hit(base, host, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(base + path, { headers: { host, ...headers } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, data: Buffer.concat(chunks) }));
    });
    request.on("error", (error) => { error.message += ` at ${path}`; reject(error); });
  });
}

test("sealed artifact bytes stay in their desktop through review, previews, range downloads, sharing, checkout and rejection", async (t) => {
  const docker = fakeDocker();
  const keys = passKeys("fixture-sealed-artifact-signing-key-0123456789");
  const f = await knowledgeWorld({ docker: docker.path, cloudUrl: "https://usecora.test", cloudKey: keys.publicKey, cloudSpace: "acme" }, {
    cloudLoginPass: signPass(keys.privateKey, { aud: "acme.usecora.test", sub: "fixture-admin", role: "owner", name: "Admin", email: "admin@owner.test", emailVerified: true }),
  });
  t.after(f.close);
  const { artifacts, store } = f.app;
  const created = await f.request(f.alice, "/api/agents", { method: "POST", body: { name: "Isolated client", sealed: true, tools: false } });
  assert.equal(created.status, 201);
  const agent = store.agent(created.data.id);
  const root = docker.desktop(agent.id);
  mkdirSync(join(root, "work", "report"), { recursive: true });
  const content = "SEALED_PAYLOAD_SENTINEL_c3a47f\nThis remains in the client volume.\n";
  writeFileSync(join(root, "work", "report", "note.txt"), content);
  writeFileSync(join(root, "work", "report", "index.html"), "<h1>SEALED_SITE_SENTINEL</h1>");
  const requester = { kind: "owner", id: f.alice.user.id, name: "alice" };
  const push = await artifacts.push({ agent, folder: "clients/isolated/report", path: "/home/agent/work/report", requester, create: { description: "Only this client's report" } });
  assert.equal(push.commit.status, "proposed");
  assert.equal(artifacts.canReadMember(push.folder, f.bob.user), false);
  assert.equal(artifacts.canReview(push.folder, f.alice.user), true);
  const digest = createHash("sha256").update(content).digest("hex");
  assert.equal(existsSync(artifacts.objectPath(digest)), false);
  assert.equal(readFileSync(join(root, ".local/share/cora/artifact-objects", digest), "utf8"), content);
  const file = artifacts.fileAt(push.commit.id, "note.txt");
  assert.equal(file.storage, agent.id);
  assert.equal((await artifacts.readFile(file)).toString(), content);
  artifacts.trees.clear();
  assert.equal(artifacts.fileAt(push.commit.id, "note.txt").storage, agent.id, "the reference survives a cold metadata cache");
  const endpoint = `/api/artifacts/commits/${push.commit.id}/files/note.txt`;
  const response = await fetch(f.base + endpoint, { headers: f.alice.headers });
  assert.equal(response.status, 200); assert.equal(await response.text(), content);
  const partial = await fetch(f.base + endpoint, { headers: { ...f.alice.headers, Range: "bytes=2-9" } });
  assert.equal(partial.status, 206); assert.equal(await partial.text(), content.slice(2, 10));
  assert.equal((await fetch(f.base + endpoint, { headers: f.bob.headers })).status, 403);
  await assert.rejects(artifacts.review(push.commit.id, { decision: "approve", user: f.bob.user }));
  await artifacts.review(push.commit.id, { decision: "approve", user: f.alice.user });
  const ctx = { agent, store, knowledge: f.app.knowledge, artifacts, boxes: f.app.boxes, requester, channelId: "web-" + agent.id };
  const receipt = await executeTool({ name: "artifact_share", args: { folder: push.folder.path, label: "isolated-report", view: "files", access: "public" } }, ctx);
  assert.match(receipt.text, /REQUESTED, NOT ACTIVE/);
  let share = store.artifactShareByLabel("isolated-report");
  assert.equal(share.status, "proposed");
  const host = "isolated-report--acme.usecora.test";
  assert.notEqual((await hit(f.base, host, "/note.txt")).status, 200);
  artifacts.updateShare(share.id, { status: "active" }, f.alice.user);
  assert.equal((await hit(f.base, host, "/note.txt")).data.toString(), content);
  assert.match((await hit(f.base, host, "/_cora/view/note.txt")).data.toString(), /SEALED_PAYLOAD_SENTINEL/);
  assert.equal((await hit(f.base, host, "/note.txt", { Range: "bytes=0-5" })).data.toString(), content.slice(0, 6));
  assert.equal((await hit(f.base, host, "/_cora/zip")).status, 200);
  const pulled = await artifacts.pull({ agent, folder: push.folder.path });
  assert.match(pulled, /pulled/);
  assert.equal(readFileSync(join(root, "work/artifacts/clients/isolated/report/note.txt"), "utf8"), content);
  writeFileSync(join(root, "work/report/note.txt"), "REJECTED_SEALED_PAYLOAD");
  const second = await artifacts.push({ agent, folder: push.folder.path, path: "/home/agent/work/report", requester });
  await artifacts.review(second.commit.id, { decision: "reject", user: f.alice.user });
  assert.equal((await hit(f.base, host, "/note.txt")).data.toString(), content, "rejected bytes never replace the published version");
  // Only tree metadata may be written by Cora: no payload or temporary payload file.
  for (const entry of readdirSync(artifacts.dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const bytes = readFileSync(join(entry.parentPath, entry.name));
    assert.equal(bytes.includes(Buffer.from("SEALED_PAYLOAD_SENTINEL")), false);
    assert.equal(bytes.includes(Buffer.from("REJECTED_SEALED_PAYLOAD")), false);
    assert.equal(bytes.includes(Buffer.from("SEALED_SITE_SENTINEL")), false);
  }
  assert.equal(readdirSync(join(artifacts.dir, "tmp")).length, 0);
  const group = artifacts.createShare("ag:clients/isolated", { label: "isolated-level", access: { mode: "public" }, status: "active", createdBy: { kind: "agent", id: agent.id, name: agent.name } });
  assert.equal(group.status, "proposed", "even a direct method call cannot activate a sealed agent's link");
  artifacts.updateShare(group.id, { status: "active" }, f.alice.user);
  const approvedGroup = store.artifactShareByLabel("isolated-level");
  const foreignFolder = artifacts.createFolder({ path: "clients/isolated/foreign", description: "Foreign", writers: ["*"], createdBy: { kind: "user", id: f.alice.user.id } });
  assert.equal(artifacts.groupGrants(approvedGroup, foreignFolder), false, "the approver's broader rights cannot add a foreign sibling to a sealed link");
  assert.equal(artifacts.groupGrants(approvedGroup, push.folder), true);
  // A changed object fails closed; Cora never falls back to a same-hash object on the host.
  writeFileSync(join(root, ".local/share/cora/artifact-objects", digest), "tampered");
  await assert.rejects(artifacts.readFile(file), /unavailable or changed/);
  artifacts.updateShare(share.id, { status: "revoked" }, f.alice.user);
  assert.notEqual((await hit(f.base, host, "/note.txt")).status, 200);
});
