import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Store } from "../src/store.js";
import { startCora } from "../src/main.js";
import { fakeDocker, tempHome } from "./helpers.js";

async function fixture(t) {
  const home = tempHome();
  const residentDirectories = { claude: join(home, "resident-claude"), codex: join(home, "resident-codex") };
  for (const directory of Object.values(residentDirectories)) mkdirSync(directory);
  const ownerInstructions = join(home, "owner-AGENTS.md");
  writeFileSync(ownerInstructions, "# Shared instructions\nFollow the fixture rules.\n");
  writeFileSync(join(residentDirectories.claude, "CLAUDE.md"), "# Claude resident\nLocal fixture notes.\n");
  writeFileSync(join(residentDirectories.codex, "AGENTS.md"), "# Codex resident\nNot loaded when --ignore-rules is set.\n");
  const app = startCora({ home, residentDirectories, ownerInstructions, host: "127.0.0.1", port: 0, insecureCookies: true,
    adminPassword: "fixture-password", sessionKey: "fixture-session", useResidentSubscriptions: false,
    cloudUrl: "", cloudKey: "", cloudSpace: "", discordToken: "", telegramToken: "", ollamaKey: "", orcaKey: "",
    claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes", botTokenFor: () => "",
    docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  let stopped = false;
  const stop = async () => { if (!stopped) { stopped = true; await app.stop(); } };
  t.after(stop);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "X-Cora": "1", "Content-Type": "application/json" }, body: JSON.stringify({ password: "fixture-password" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const request = async (path = "/api/context", auth = true, { method = "GET", body, csrf = true } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(auth ? { Cookie: cookie } : {}), ...(csrf ? { "X-Cora": "1" } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  return { app, home, residentDirectories, ownerInstructions, request, stop };
}

test("Context shows the actual common instructions, source metadata and provider rule handling", async (t) => {
  const { app, ownerInstructions, request } = await fixture(t);
  app.store.updateSettings({ sharedMemory: "Team fixture memory." });
  const response = await request();
  assert.equal(response.status, 200);
  const owner = response.data.sources.find((source) => source.id === "owner");
  assert.equal(owner.status, "applied");
  assert.equal(owner.path, ownerInstructions);
  assert.equal(owner.content, app.brain.ownerInstructions());
  assert.ok(owner.updatedAt);
  const claude = response.data.sources.find((source) => source.id === "resident-claude-CLAUDE.md");
  assert.equal(claude.status, "detected");
  assert.match(claude.content, /Local fixture notes/);
  const codex = response.data.sources.find((source) => source.id === "resident-codex-AGENTS.md");
  assert.equal(codex.status, "excluded");
  assert.match(codex.content, /ignore-rules/);
  assert.equal(response.data.sources.find((source) => source.id === "shared-memory").content, "Team fixture memory.");
  writeFileSync(ownerInstructions, "# Updated rules\nFresh fixture instructions.");
  utimesSync(ownerInstructions, new Date(), new Date(Date.now() + 1000));
  assert.match((await request()).data.sources.find((source) => source.id === "owner").content, /Fresh fixture instructions/);
});

test("Context requires authentication, ignores arbitrary paths, and refuses links to credential-shaped files", async (t) => {
  const { home, residentDirectories, request } = await fixture(t);
  assert.equal((await request("/api/context", false)).status, 401);
  const forbidden = join(home, "fixture-auth.json");
  writeFileSync(forbidden, '{"fixture_private_value":"fixture-do-not-expose"}');
  symlinkSync(forbidden, join(residentDirectories.codex, "AGENTS.override.md"));
  const response = await request(`/api/context?path=${encodeURIComponent(forbidden)}`);
  assert.equal(response.status, 200);
  const link = response.data.sources.find((source) => source.id === "resident-codex-AGENTS.override.md");
  assert.equal(link.available, false);
  assert.equal(link.status, "unavailable");
  assert.doesNotMatch(JSON.stringify(response.data), /fixture-do-not-expose|fixture_private_value/);
  assert.ok(response.data.sources.some((source) => source.status === "missing"));
});

test("Context bounds the preview to the same common instruction limit and only includes existing managed notes", async (t) => {
  const { app, home, ownerInstructions, request } = await fixture(t);
  writeFileSync(ownerInstructions, "a".repeat(70000));
  utimesSync(ownerInstructions, new Date(), new Date(Date.now() + 2000));
  const account = app.store.createSubscription({ provider: "claude", label: "Team notes" });
  const profile = join(home, "subscriptions", account.id);
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, "CLAUDE.md"), "# Managed account notes");
  app.store.createSubscription({ provider: "codex", label: "Empty profile" });
  const response = await request();
  const owner = response.data.sources.find((source) => source.id === "owner");
  assert.equal(owner.content.length, 60000);
  assert.equal(owner.truncated, true);
  assert.equal(owner.content, app.brain.ownerInstructions());
  const managed = response.data.sources.filter((source) => source.scope === "account");
  assert.equal(managed.length, 1);
  assert.equal(managed[0].accountLabel, "Team notes");
});


test("database context files persist, join the shared prompt, and support updates, disable and deletion", async (t) => {
  const { app, home, request, stop } = await fixture(t);
  const path = "/api/context/documents";
  const created = await request(path, true, { method: "POST", body: { name: "team.md", content: "Always use the fixture team vocabulary.", createdBy: "forged-user" } });
  assert.equal(created.status, 201);
  const document = created.data;
  assert.equal(document.createdBy, "local-owner");
  assert.equal(document.revision, 1);
  const source = (await request()).data.sources.find((item) => item.id === document.id);
  assert.equal(source.storage, "database");
  assert.equal(source.status, "applied");
  const agent = { id: "ag_fixture", name: "Fixture", personality: "", core: "" };
  const prompt = () => app.brain.systemPrompt(agent, { place: "test", withoutComputer: true });
  assert.match(prompt(), /Always use the fixture team vocabulary/);
  const updated = await request(`${path}/${document.id}`, true, { method: "PUT", body: { name: "style.txt", content: "Use concise answers.", expectedRevision: 1 } });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.revision, 2);
  assert.match(prompt(), /Use concise answers/);
  assert.doesNotMatch(prompt(), /fixture team vocabulary/);
  const stale = await request(`${path}/${document.id}`, true, { method: "PUT", body: { content: "Stale overwrite", expectedRevision: 1 } });
  assert.equal(stale.status, 409);
  assert.equal(app.store.contextDocument(document.id).content, "Use concise answers.");
  assert.equal((await request(`${path}/${document.id}`, true, { method: "PUT", body: { enabled: false } })).status, 200);
  assert.doesNotMatch(prompt(), /Use concise answers/);
  assert.equal((await request()).data.sources.find((item) => item.id === document.id).status, "disabled");
  assert.equal((await request(`${path}/${document.id}`, true, { method: "PUT", body: { enabled: true } })).status, 200);
  const remove = await request(path, true, { method: "POST", body: { name: "delete.md", content: "Delete this fixture." } });
  assert.equal((await request(`${path}/${remove.data.id}`, true, { method: "DELETE" })).status, 200);
  assert.equal((await request(`${path}/${remove.data.id}`, true, { method: "DELETE" })).status, 404);
  await stop();
  const reopened = new Store(home);
  try { assert.equal(reopened.contextDocument(document.id).content, "Use concise answers."); assert.equal(reopened.contextDocument(remove.data.id), null); }
  finally { reopened.close(); }
});

test("context writes enforce auth, CSRF, text formats and bounds without changing existing sources", async (t) => {
  const { app, request } = await fixture(t);
  const path = "/api/context/documents";
  const body = { name: "allowed.md", content: "Fixture text" };
  assert.equal((await request(path, false, { method: "POST", body })).status, 401);
  assert.equal((await request(path, true, { method: "POST", body, csrf: false })).status, 403);
  for (const invalid of [{ ...body, name: "../outside.md" }, { ...body, name: "folder\\outside.md" }, { ...body, name: "document.pdf" }, { ...body, content: "" }, { ...body, content: "binary\u0000data" }, { ...body, content: "a".repeat(30001) }, { ...body, enabled: "true" }]) {
    assert.equal((await request(path, true, { method: "POST", body: invalid })).status, 400);
  }
  const created = (await request(path, true, { method: "POST", body })).data;
  assert.equal((await request(path, true, { method: "POST", body: { ...body, name: "ALLOWED.MD" } })).status, 400);
  assert.equal(app.store.contextDocuments().length, 1);
  assert.equal((await request("/api/context/documents/owner", true, { method: "DELETE" })).status, 404);
  assert.equal((await request()).data.sources.find((source) => source.id === "owner").status, "applied");
  assert.equal(app.store.contextDocument(created.id).content, body.content);
  assert.ok(app.store.accessAudit().some((entry) => entry.action === "context" && entry.userId === "local-owner"));
});

test("active context budget, count limit and instance isolation prevent silent truncation or leakage", async (t) => {
  const one = await fixture(t);
  const two = await fixture(t);
  const path = "/api/context/documents";
  const create = (name, content, enabled = true) => one.request(path, true, { method: "POST", body: { name, content, enabled } });
  assert.equal((await create("first.md", "a".repeat(30000))).status, 201);
  assert.equal((await create("second.txt", "b".repeat(30000))).status, 201);
  assert.equal((await create("over-budget.md", "c")).status, 400);
  const disabled = await create("disabled.md", "c", false);
  assert.equal(disabled.status, 201);
  assert.equal((await one.request(`${path}/${disabled.data.id}`, true, { method: "PUT", body: { enabled: true } })).status, 400);
  assert.equal(one.app.store.contextDocument(disabled.data.id).enabled, false);
  for (let index = 3; index < 20; index++) assert.equal((await create(`inactive-${index}.md`, "Notes", false)).status, 201);
  assert.equal((await create("twenty-first.md", "Notes", false)).status, 400);
  const documents = (await one.request()).data.sources.filter((source) => source.storage === "database");
  assert.equal(documents.length, 20);
  assert.equal(documents.filter((source) => source.enabled).reduce((sum, source) => sum + source.content.length, 0), 60000);
  assert.equal((await two.request()).data.sources.some((source) => source.storage === "database"), false);
});
