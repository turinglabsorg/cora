import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { startCora } from "../src/main.js";
import { passKeys, signPass } from "../src/pass.js";
import { fakeDocker, tempHome, waitFor } from "./helpers.js";
import { panelHarness } from "./panel.js";
import { identityCli } from "./subscription-fixtures.js";

async function fixture(t, { storeSecret, harnesses = ["claude", "codex"] } = {}) {
  const home = tempHome();
  const identity = identityCli();
  const residentDirectories = {};
  for (const provider of harnesses) {
    const directory = join(home, `resident-${provider}`);
    mkdirSync(directory);
    writeFileSync(join(directory, "fixture-account.json"), JSON.stringify({ type: "chatgpt", email: `${provider}-resident@example.test`, planType: "pro" }));
    residentDirectories[provider] = directory;
  }
  const app = startCora({ home, host: "127.0.0.1", port: 0, insecureCookies: true,
    adminPassword: "fixture-password", sessionKey: "fixture-session", residentDirectories,
    discordToken: "", telegramToken: "", ollamaKey: "", orcaKey: "", cloudUrl: "", cloudKey: "", cloudSpace: "",
    claudeBin: identity.claude, codexBin: identity.codex, hermesBin: "/missing/hermes", botTokenFor: () => "",
    // Grok and Muse are not installed unless a test asks for them.
    grokBin: harnesses.includes("grok") ? identity.grok : "/missing/grok", museBin: harnesses.includes("muse") ? identity.muse : "/missing/muse",
    grokHome: join(home, "grok-home"),
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
  return { app, home, identity, request, residentDirectories };
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

test("disabling resident subscriptions refuses new work at once, while work already running finishes", async (t) => {
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
  await request("/api/settings", { method: "PUT", body: { useResidentSubscriptions: false } });
  let executed = false;
  await assert.rejects(app.subscriptions.run(resident.id, "codex", undefined, async () => { executed = true; }), /subscription da collegare/);
  assert.equal(executed, false);
  release.resolve();
  assert.equal(await active, "active work completed");
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

test("Grok and Muse accounts sign in with a device code, say who they are, run in their own folder and leave when removed", async (t) => {
  const { app, home, identity, request, residentDirectories } = await fixture(t, { harnesses: ["claude", "codex", "grok", "muse"] });
  const state = (await request("/api/state")).data;
  assert.equal(state.subscriptions.length, 4, "an installed Grok and Muse bring their machine accounts along");
  assert.equal(state.subscriptions.find((item) => item.provider === "muse").plan, "Muse Code High Usage", "Muse's own tier, from muse usage");
  for (const provider of ["grok", "muse"]) {
    assert.equal(state.subscriptions.find((item) => item.provider === provider).status, "ready");
    const result = await app.llm.runAgent({ model: `${provider}/test`, tools: [], system: "Test", prompt: "Identity?", timeoutMs: 3000 });
    assert.match(result.text, new RegExp(`${provider}-resident@example.test`), "the machine's own login answers");
    assert.equal(identity.calls().at(-1).directory, residentDirectories[provider]);
  }
  // Grok's machine login is read where it is; Cora's MCP server never lands in the machine's Grok home.
  assert.ok(!existsSync(join(residentDirectories.grok, "config.toml")));

  for (const provider of ["grok", "muse"]) {
    identity.set({ complete: false });
    const created = await request("/api/subscriptions", { method: "POST", body: { provider, label: `Team ${provider}` } });
    assert.equal(created.status, 201);
    const started = await request(`/api/subscriptions/${created.data.id}/login`, { method: "POST" });
    assert.equal(started.data.status, "connecting");
    assert.equal(started.data.login.userCode, "TEST-ONLY");
    assert.equal(started.data.login.url, provider === "grok" ? "https://accounts.x.ai/oauth2/device?user_code=TEST-ONLY" : "https://auth.meta.com/oauth/device/?code=TEST-ONLY");
    assert.equal(started.data.login.manualCode, false, "the owner confirms the code on the provider's page; nothing comes back to paste");
    identity.set({ complete: true });
    await waitFor(() => app.store.subscription(created.data.id).status === "ready", { what: `${provider} account ready` });
    const account = join(home, "subscriptions", created.data.id);
    const result = await app.llm.runAgent({ model: `${provider}/test`, subscriptionId: created.data.id, tools: [], system: "Test", prompt: "Identity?", timeoutMs: 3000 });
    assert.match(result.text, new RegExp(`${created.data.id}@example.test`), "the account's own login answers, not the machine's");
    assert.equal(identity.calls().at(-1).directory, account);
    assert.equal((await request(`/api/subscriptions/${created.data.id}`, { method: "DELETE" })).status, 200);
    assert.equal(app.store.subscription(created.data.id), null);
    assert.ok(!existsSync(account), "its folder, login included, is gone");
  }

  identity.set({ complete: false, evilUrl: "https://evil.example/oauth/device?code=EVIL-CODE" });
  const created = await request("/api/subscriptions", { method: "POST", body: { provider: "muse", label: "Phished" } });
  const started = await request(`/api/subscriptions/${created.data.id}/login`, { method: "POST" });
  assert.equal(started.data.login, undefined, "a sign-in page on any other host is never shown");
  assert.notEqual(started.data.status, "ready");
});

test("an account says whose it is, and a member's new agent starts on the account they signed in", async (t) => {
  const keys = passKeys("fixture-connections-signing-seed-0123456789abcdef");
  const home = tempHome();
  const identity = identityCli();
  const resident = join(home, "resident-codex");
  mkdirSync(resident);
  writeFileSync(join(resident, "fixture-account.json"), JSON.stringify({ type: "chatgpt", email: "server@example.test", planType: "pro" }));
  const app = startCora({ home, host: "127.0.0.1", port: 0, insecureCookies: true,
    adminPassword: "fixture-password", sessionKey: "fixture-session-whose", residentDirectories: { codex: resident },
    cloudUrl: "https://usecora.test", cloudKey: keys.publicKey, cloudSpace: "alpha",
    discordToken: "", telegramToken: "", ollamaKey: "", orcaKey: "", claudeBin: identity.claude, codexBin: identity.codex, hermesBin: "/missing/hermes",
    grokBin: "/missing/grok", museBin: "/missing/muse", botTokenFor: () => "",
    docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = async (who) => {
    const pass = signPass(keys.privateKey, { aud: "alpha.usecora.test", emailVerified: true, ...who });
    return (await fetch(`${base}/auth/cloud?${new URLSearchParams({ pass })}`, { redirect: "manual" })).headers.get("set-cookie")?.split(";")[0] || "";
  };
  const request = async (cookie, path, { method = "GET", body } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, "X-Cora": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const owner = await login({ sub: "ac_owner", role: "owner", name: "Owner", email: "owner@example.test" });
  await request(owner, "/api/access", { method: "PUT", body: { domains: ["company.test"] } });
  const sara = await login({ sub: "ac_sara", role: "member", name: "Sara", email: "sara@company.test" });
  assert.ok(owner && sara);
  await waitFor(() => app.store.residentSubscription("codex")?.status === "ready");

  // Sara signs her own ChatGPT account in from the panel: the account remembers who did.
  const created = await request(sara, "/api/subscriptions", { method: "POST", body: { provider: "codex", label: "ChatGPT" } });
  assert.deepEqual(created.data.connectedBy, { id: "ac_sara", name: "Sara" });
  await request(sara, `/api/subscriptions/${created.data.id}/login`, { method: "POST" });
  identity.set({ complete: true });
  await waitFor(() => app.store.subscription(created.data.id).status === "ready");
  const listed = (await request(owner, "/api/subscriptions")).data.find((record) => record.id === created.data.id);
  assert.deepEqual(listed.connectedBy, { id: "ac_sara", name: "Sara" });

  const picker = async (cookie, options) => {
    const panel = panelHarness({ language: "en", fetch: (path, init) => fetch(`${base}${path}`, { ...init, headers: { ...init?.headers, Cookie: cookie } }) });
    await panel.run("boot()");
    await waitFor(() => panel.run("Boolean(S.data && S.data.subscriptions && S.data.currentUser)"));
    return panel.run(`(() => { const picker = subscriptionPicker("", ${JSON.stringify(options)}); picker.setProvider("codex"); return { text: picker.node.textContent, value: picker.value() }; })()`);
  };
  // A new agent Sara makes runs on her account, and the panel says so.
  const fresh = await picker(sara, { isNew: true });
  assert.equal(fresh.value, created.data.id);
  assert.match(fresh.text, /Your account/);
  assert.match(fresh.text, /This agent will use your account\./);
  // An agent already on the server's account tells Sara it is not hers, and where hers is.
  const existing = await picker(sara, {});
  assert.equal(existing.value, "");
  assert.match(existing.text, /Server account · default/);
  assert.match(existing.text, /This agent will use the server's account, not yours\. To use yours, choose “Change account”\./);
  // The owner's new agents keep the server's account, and Sara's is shown as hers, not theirs.
  const owners = await picker(owner, { isNew: true });
  assert.equal(owners.value, "");
  assert.match(owners.text, /This agent will use the server's account\./);
  const chosen = await (async () => {
    const panel = panelHarness({ language: "en", fetch: (path, init) => fetch(`${base}${path}`, { ...init, headers: { ...init?.headers, Cookie: owner } }) });
    await panel.run("boot()");
    await waitFor(() => panel.run("Boolean(S.data && S.data.subscriptions && S.data.currentUser)"));
    return panel.run(`(() => { const picker = subscriptionPicker(${JSON.stringify(created.data.id)}, {}); picker.setProvider("codex"); return picker.node.textContent; })()`);
  })();
  assert.match(chosen, /Sara's account/);
  assert.match(chosen, /This agent will use Sara's account\./);
});
