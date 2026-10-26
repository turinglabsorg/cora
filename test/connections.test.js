import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { startCora } from "../src/main.js";
import { fakeDocker, tempHome, waitFor } from "./helpers.js";
import { identityCli } from "./subscription-fixtures.js";

async function fixture(t, { storeSecret } = {}) {
  const home = tempHome();
  const identity = identityCli();
  const residentDirectories = {};
  for (const provider of ["claude", "codex"]) {
    const directory = join(home, `resident-${provider}`);
    mkdirSync(directory);
    writeFileSync(join(directory, "fixture-account.json"), JSON.stringify({ type: "chatgpt", email: `${provider}-resident@example.test`, planType: "pro" }));
    residentDirectories[provider] = directory;
  }
  const app = startCora({ home, host: "127.0.0.1", port: 0, insecureCookies: true,
    adminPassword: "fixture-password", sessionKey: "fixture-session", residentDirectories,
    discordToken: "", telegramToken: "", ollamaKey: "", orcaKey: "", cloudUrl: "", cloudKey: "", cloudSpace: "",
    claudeBin: identity.claude, codexBin: identity.codex, hermesBin: "/missing/hermes", botTokenFor: () => "",
    docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys", storeSecret,
  });
  await app.ready;
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ password: "fixture-password" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const request = async (path, { method = "GET", body, auth = true, csrf = true } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(auth ? { Cookie: cookie } : {}), ...(csrf ? { "X-Cora": "1" } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  return { app, identity, request, residentDirectories };
}

test("resident subscriptions are detected, default for both CLIs, and never receive login or logout", async (t) => {
  const { app, identity, request, residentDirectories } = await fixture(t);
  assert.equal(app.store.settings.useResidentSubscriptions, true);
  const state = (await request("/api/state")).data;
  assert.equal(state.subscriptions.length, 2);
  assert.ok(state.subscriptions.every((item) => item.resident && item.status === "ready" && item.plan === "pro"));
  for (const provider of ["claude", "codex"]) {
    const record = state.subscriptions.find((item) => item.provider === provider);
    assert.equal(record.email, `${provider}-resident@example.test`);
    const created = await request("/api/agents", { method: "POST", body: { name: provider, model: `${provider}/test`, tools: false } });
    assert.equal(created.status, 201);
    assert.equal(created.data.subscriptionId, "");
    const result = await app.llm.runAgent({ model: `${provider}/test`, tools: [], system: "Test", prompt: "Identity?", timeoutMs: 3000 });
    assert.match(result.text, new RegExp(`${provider}-resident@example.test`));
    assert.equal(identity.calls().at(-1).directory, residentDirectories[provider]);
    for (const action of ["login", ""]) {
      const response = await request(`/api/subscriptions/${record.id}${action ? `/${action}` : ""}`, { method: action ? "POST" : "DELETE" });
      assert.equal(response.status, 400);
    }
    assert.equal(app.store.subscription(record.id).status, "ready");
  }
  const scanned = await request("/api/subscriptions/resident/check", { method: "POST" });
  assert.equal(scanned.status, 200);
  assert.equal(scanned.data.length, 2);
  assert.ok(identity.calls().every((call) => call.inheritedKeys.length === 0));
});

test("turning off resident defaults blocks them without falling back from an explicitly selected account", async (t) => {
  const { app, identity, request } = await fixture(t);
  const created = (await request("/api/subscriptions", { method: "POST", body: { provider: "codex", label: "Other account", resident: true } })).data;
  assert.equal(created.resident, undefined, "the API cannot make an account resident");
  const options = { model: "codex/test", tools: [], system: "Test", prompt: "Identity?", timeoutMs: 3000 };
  await assert.rejects(app.llm.runAgent({ ...options, subscriptionId: created.id }), /subscription da collegare/);
  assert.equal(identity.calls().length, 0);
  await request(`/api/subscriptions/${created.id}/login`, { method: "POST" });
  identity.set({ complete: true });
  await waitFor(() => app.store.subscription(created.id).status === "ready");
  await request("/api/settings", { method: "PUT", body: { useResidentSubscriptions: false } });
  await assert.rejects(app.llm.runAgent(options), /subscription da collegare/);
  const resident = app.store.residentSubscription("codex");
  await assert.rejects(app.llm.runAgent({ ...options, subscriptionId: resident.id }), /subscription da collegare/);
  const result = await app.llm.runAgent({ ...options, subscriptionId: created.id });
  assert.match(result.text, new RegExp(`${created.id}@example.test`));
  assert.equal(identity.calls().length, 1);
  await request("/api/settings", { method: "PUT", body: { useResidentSubscriptions: true } });
  assert.equal(app.store.subscription(created.id).status, "ready");
  assert.match((await app.llm.runAgent(options)).text, /codex-resident@example.test/);
});

test("disabling resident subscriptions also rejects work queued before the setting changed", async (t) => {
  const { app, request } = await fixture(t);
  const resident = app.store.residentSubscription("codex");
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const active = app.subscriptions.run(resident.id, "codex", undefined, async () => {
    entered.resolve();
    await release.promise;
    return "active work completed";
  });
  await entered.promise;
  let executed = false;
  const queued = app.subscriptions.run(resident.id, "codex", undefined, async () => { executed = true; });
  const rejected = assert.rejects(queued, /subscription da ricollegare/);
  await request("/api/settings", { method: "PUT", body: { useResidentSubscriptions: false } });
  release.resolve();
  assert.equal(await active, "active work completed");
  await rejected;
  assert.equal(executed, false);
});

test("API keys are stored through hush before taking effect, never returned and protected by auth and CSRF", async (t) => {
  const stored = new Map();
  const { app, request } = await fixture(t, { storeSecret: async (name, value) => stored.set(name, value) });
  for (const provider of ["ollama", "orcarouter"]) {
    const path = `/api/providers/${provider}/key`;
    assert.equal((await request(path, { method: "PUT", body: { key: "fixture-key" }, auth: false })).status, 401);
    assert.equal((await request(path, { method: "PUT", body: { key: "fixture-key" }, csrf: false })).status, 403);
    assert.equal((await request(path, { method: "PUT", body: { key: " " } })).status, 400);
    const saved = await request(path, { method: "PUT", body: { key: `fixture-${provider}-key` } });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.data, { provider, configured: true });
    assert.equal(stored.get(`CORA_${provider.toUpperCase()}_API_KEY`), `fixture-${provider}-key`);
    assert.equal(app.llm.providers()[provider], true);
  }
  const state = (await request("/api/state")).data;
  assert.doesNotMatch(JSON.stringify(state), /fixture-ollama-key|fixture-orcarouter-key/);
  assert.doesNotMatch(JSON.stringify(app.store.recentActivity(100)), /fixture-.*-key/);
  assert.doesNotMatch(JSON.stringify(app.store.settings), /fixture-.*-key/);
});

test("failed secret storage leaves the running provider unchanged and returns a safe error", async (t) => {
  const { app, request } = await fixture(t, { storeSecret: async () => { throw new Error("fixture-private-detail"); } });
  const saved = await request("/api/providers/orcarouter/key", { method: "PUT", body: { key: "fixture-private-key" } });
  assert.equal(saved.status, 502);
  assert.equal(app.llm.providers().orcarouter, false);
  assert.doesNotMatch(JSON.stringify(saved), /fixture-private/);
});
