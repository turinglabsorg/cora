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
    geminiBin: harnesses.includes("gemini") ? identity.gemini : "/missing/agy",
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
    assert.deepEqual(saved.data, { provider, configured: true, keyHint: "•••• -key" });
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

  // Settings: every entry in one list on the left, grouped, the one in the address open on the right.
  // The address of the old Connections tab still opens the same account's page.
  const connections = await (async () => {
    const panel = panelHarness({ language: "en", fetch: (path, init) => fetch(`${base}${path}`, { ...init, headers: { ...init?.headers, Cookie: owner } }) });
    await panel.run("boot()");
    await waitFor(() => panel.run("Boolean(S.data && S.data.subscriptions && S.data.currentUser)"));
    return panel.run(`(() => {
      globalThis.history = { replaceState() {} };
      location.hash = "#/settings/collegamenti/codex";
      renderSettings();
      const root = document.getElementById("app").querySelector(".rail");
      const items = () => root.querySelectorAll(".rail-item");
      const open = () => root.querySelectorAll(".rail-page").filter((page) => !page.hidden).map((page) => page.attributes["data-page"]);
      const groups = root.querySelectorAll(".rail-group").map((group) => group.textContent);
      const before = { ids: items().map((item) => item.attributes["data-page"]), groups, codex: items().find((item) => item.attributes["data-page"] === "codex").textContent, open: open(), className: root.className };
      items().find((item) => item.attributes["data-page"] === "chiavi-api").click();
      const keys = root.querySelectorAll(".rail-page").find((page) => page.attributes["data-page"] === "chiavi-api").querySelectorAll("h2").map((heading) => heading.textContent);
      return { ...before, keys, after: open(), active: items().filter((item) => item.className.includes("active")).map((item) => item.attributes["data-page"]) };
    })()`);
  })();
  assert.deepEqual(connections.groups, ["Context", "Channels", "Connectors", "Intelligence", "Agents", "People", "General"], "the agents' context opens Settings");
  assert.deepEqual(connections.ids.slice(0, 10), ["contesto", "discord", "telegram", "slack", "email", "connettori", "mcp", "server", "claude", "codex"]);
  const firstKey = connections.ids.indexOf("chiavi-api");
  assert.ok(firstKey > connections.ids.indexOf("codex"));
  assert.equal(connections.ids.filter((id) => ["ollama", "orcarouter", "deepseek", "typesafe", "soniox"].includes(id)).length, 0);
  assert.deepEqual(connections.ids.slice(firstKey + 1), ["regia", "modelli", "domini", "accesso", "ssh", "spazio", "cifratura", "controlli", "preferenze"], "agent permissions and GitHub apps live inside each agent; Domains stay with the agents, Spazio with general settings");
  assert.match(connections.codex, /ChatGPT \/ Codex2 accounts/, "the server's account and Sara's, both ready");
  assert.deepEqual([connections.open, connections.className], [["codex"], "rail open"]);
  assert.deepEqual([connections.after, connections.active], [["chiavi-api"], ["chiavi-api"]]);
  assert.deepEqual(connections.keys, ["Ollama", "OrcaRouter", "DeepSeek", "TypeSafe", "Soniox"]);

  // A harness's page lists every account it has, and "Add account" connects one more.
  const accounts = await (async () => {
    const panel = panelHarness({ language: "en", fetch: (path, init) => fetch(`${base}${path}`, { ...init, headers: { ...init?.headers, Cookie: owner } }) });
    await panel.run("boot()");
    await waitFor(() => panel.run("Boolean(S.data && S.data.subscriptions && S.data.currentUser)"));
    return panel.run(`(async () => {
      const root = subscriptionAccounts("codex");
      const rows = () => root.querySelectorAll(".account-row").map((row) => row.textContent);
      const before = rows();
      const add = root.querySelectorAll("button").find((button) => button.textContent === "Add account");
      await add.listeners.click[0]();
      return { before, after: rows() };
    })()`);
  })();
  assert.equal(accounts.before.length, 1);
  assert.match(accounts.before[0], /Sara's account · Connected/);
  assert.equal(accounts.after.length, 2, "a second ChatGPT account, being signed in");
  assert.equal((await request(owner, "/api/subscriptions")).data.filter((record) => record.provider === "codex" && !record.resident).length, 2);
});

test("changing an agent's brain offers the accounts already signed in, the server's and the linked ones, instead of a new sign-in", async (t) => {
  const keys = passKeys("fixture-connections-signing-seed-0123456789abcdef");
  const home = tempHome();
  const identity = identityCli();
  const residentCodex = join(home, "resident-codex");
  const residentClaude = join(home, "resident-claude");
  mkdirSync(residentCodex);
  mkdirSync(residentClaude);
  writeFileSync(join(residentCodex, "fixture-account.json"), JSON.stringify({ type: "chatgpt", email: "server@example.test", planType: "pro" }));
  const app = startCora({ home, host: "127.0.0.1", port: 0, insecureCookies: true,
    adminPassword: "fixture-password", sessionKey: "fixture-session-switch", residentDirectories: { codex: residentCodex, claude: residentClaude },
    cloudUrl: "https://usecora.test", cloudKey: keys.publicKey, cloudSpace: "alpha",
    discordToken: "", telegramToken: "", ollamaKey: "", orcaKey: "", claudeBin: identity.claude, codexBin: identity.codex, hermesBin: "/missing/hermes",
    grokBin: "/missing/grok", museBin: "/missing/muse", botTokenFor: () => "",
    docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const pass = signPass(keys.privateKey, { aud: "alpha.usecora.test", emailVerified: true, sub: "ac_owner", role: "owner", name: "Owner", email: "owner@example.test" });
  const owner = (await fetch(`${base}/auth/cloud?${new URLSearchParams({ pass })}`, { redirect: "manual" })).headers.get("set-cookie")?.split(";")[0] || "";
  assert.ok(owner);
  const request = async (path, { method = "GET", body } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: owner, "X-Cora": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  await waitFor(() => app.store.residentSubscription("codex")?.status === "ready");
  assert.notEqual(app.store.residentSubscription("claude")?.status, "ready");

  // The owner's own Claude account is signed in; the server's Claude is not.
  identity.set({ complete: false, email: "owner-claude@example.test" });
  const claude = await request("/api/subscriptions", { method: "POST", body: { provider: "claude", label: "Claude" } });
  await request(`/api/subscriptions/${claude.data.id}/login`, { method: "POST" });
  await request(`/api/subscriptions/${claude.data.id}/code`, { method: "POST", body: { code: "fixture-authorization-code" } });
  await waitFor(() => app.store.subscription(claude.data.id).status === "ready");

  const panel = panelHarness({ language: "en", fetch: (path, init) => fetch(`${base}${path}`, { ...init, headers: { ...init?.headers, Cookie: owner } }) });
  const boot = async () => {
    await panel.run("boot()");
    await waitFor(() => panel.run("Boolean(S.data && S.data.subscriptions && S.data.currentUser)"));
  };
  const switchBrain = (currentId, from, to) => panel.run(`(() => {
    const picker = subscriptionPicker(${JSON.stringify(currentId)}, {});
    picker.setProvider(${JSON.stringify(from)});
    picker.setProvider(${JSON.stringify(to)});
    const node = picker.node;
    return { text: node.textContent, value: picker.value(), options: [...node.querySelectorAll(".subscription-option")].map((option) => option.textContent),
      buttons: [...node.querySelectorAll("button")].map((button) => button.textContent.trim()).filter(Boolean) };
  })()`);
  await boot();

  // An agent on the server's ChatGPT moves to Claude: it lands on the Claude account already signed in, not on a new sign-in.
  const toClaude = switchBrain("", "codex", "claude");
  assert.equal(toClaude.value, claude.data.id);
  assert.match(toClaude.text, /owner-claude@example\.test/);
  assert.match(toClaude.text, /This agent will use your account\./);
  assert.doesNotMatch(toClaude.text, /No resident account is available/);

  // An agent still on the server's Claude, which is not signed in, can pick the linked account from there.
  const onResident = switchBrain("", "claude", "claude");
  assert.equal(onResident.value, "");
  assert.match(onResident.text, /No resident account is available/);
  assert.ok(onResident.buttons.includes("Change account"), JSON.stringify(onResident.buttons));

  // With both the server's ChatGPT and a linked ChatGPT ready, moving to ChatGPT lists both to choose from.
  identity.set({ complete: false, email: "owner-chatgpt@example.test" });
  const codex = await request("/api/subscriptions", { method: "POST", body: { provider: "codex", label: "ChatGPT" } });
  await request(`/api/subscriptions/${codex.data.id}/login`, { method: "POST" });
  identity.set({ complete: true, email: "owner-chatgpt@example.test" });
  await waitFor(() => app.store.subscription(codex.data.id).status === "ready");
  await boot();
  const toCodex = switchBrain(claude.data.id, "claude", "codex");
  assert.match(toCodex.text, /Choose the account this agent will use\./);
  assert.equal(toCodex.options.length, 2);
  assert.match(toCodex.options[0], /Server account/);
  assert.match(toCodex.options[1], /owner-chatgpt@example\.test/);
  assert.doesNotMatch(toCodex.text, /Connect ChatGPT/);

  // An agent that keeps its brain keeps its account: the server's ChatGPT stays the default.
  const kept = switchBrain("", "codex", "codex");
  assert.equal(kept.value, "");
  assert.match(kept.text, /Server account · default/);
});

test("Gemini connects through Google's manual authorization and keeps each subscription in its own profile", async (t) => {
  const { app, home, identity, request } = await fixture(t, { harnesses: ["claude", "codex", "gemini"] });
  assert.equal(app.store.residentSubscription("gemini"), null, "the machine's shared keyring is never borrowed");
  assert.equal((await request("/api/state")).data.providers.gemini, true);
  const accounts = [];
  for (const label of ["Personal Gemini", "Other Gemini"]) {
    const created = await request("/api/subscriptions", { method: "POST", body: { provider: "gemini", label } });
    assert.equal(created.status, 201);
    const started = await request(`/api/subscriptions/${created.data.id}/login`, { method: "POST" });
    assert.equal(started.data.status, "connecting");
    assert.equal(new URL(started.data.login.url).hostname, "accounts.google.com");
    assert.equal(started.data.login.manualCode, true);
    assert.equal((await request(`/api/subscriptions/${created.data.id}/code`, { method: "POST", body: { code: "bad\ncode" } })).status, 400);
    assert.equal((await request(`/api/subscriptions/${created.data.id}/code`, { method: "POST", body: { code: "\u001b[2J" } })).status, 400);
    await request(`/api/subscriptions/${created.data.id}/code`, { method: "POST", body: { code: "fixture-authorization-code" } });
    const record = await waitFor(() => { const value = app.store.subscription(created.data.id); return value.status === "ready" && value; });
    assert.equal(record.email, `${record.id}@example.test`);
    assert.ok(!JSON.stringify(record).includes("authorization-code"));
    accounts.push(record);
  }
  const options = { model: "gemini/gemini-4-argon-high", tools: [], system: "Test", prompt: "Identity?", timeoutMs: 5000 };
  const answers = await Promise.all(accounts.map((record) => app.llm.runAgent({ ...options, subscriptionId: record.id })));
  assert.deepEqual(answers.map((answer) => answer.text), accounts.map((record) => `Identity: ${record.id}@example.test`));
  assert.deepEqual(answers[0].usage, { in: 25, out: 3 });
  const runs = identity.calls().filter((run) => run.provider === "gemini");
  assert.equal(new Set(runs.map((run) => run.scope)).size, 2);
  assert.ok(runs.every((run) => run.directory === join(home, "subscriptions", accounts.find((record) => run.account.startsWith(record.id)).id) && run.inheritedKeys.length === 0));
  const state = (await request("/api/state")).data;
  assert.deepEqual(state.models.filter((model) => model.provider === "gemini").map((model) => model.id), ["gemini/gemini-4-argon-high", "gemini/gemini-3.8-flash-medium", "gemini/claude-opus-5-5-high", "gemini/claude-sonnet-5-5-low", "gemini/gpt-oss-120b-medium"]);
  assert.equal(state.models.find((model) => model.id === "gemini/claude-opus-5-5-high").vision, true);
  assert.equal(state.models.find((model) => model.id === "gemini/gpt-oss-120b-medium").vision, false);
  for (const model of ["gemini/claude-sonnet-5-5-low", "gemini/gpt-oss-120b-medium"]) {
    const result = await app.llm.runAgent({ ...options, model, subscriptionId: accounts[0].id });
    assert.equal(result.text, `Identity: ${accounts[0].id}@example.test`);
    assert.equal(identity.calls().at(-1).model, model.slice("gemini/".length), "the third-party model runs through the same Google profile");
  }
  const panel = panelHarness({ language: "en", fetch: async () => { throw new Error("unexpected request"); } });
  panel.run(`S.data = ${JSON.stringify(state)}`);
  const picker = panel.run(`(() => { const p = subscriptionPicker(${JSON.stringify(accounts[0].id)}); p.setProvider("gemini"); return { text: p.node.textContent, value: p.value() }; })()`);
  assert.equal(picker.value, accounts[0].id);
  assert.match(picker.text, /Gemini.*Your account/s);
  const loginUi = panel.run(`(() => {
    const record = { ...S.data.subscriptions.find(a => a.id === ${JSON.stringify(accounts[0].id)}), status: "connecting", login: { url: "https://accounts.google.com/o/oauth2/auth?state=fixture", manualCode: true } };
    const input = document.createElement("input");
    return subscriptionLoginSteps(record, "Gemini", { authCode: input, act() {} }).map(n => n.textContent).join(" ");
  })()`);
  assert.match(loginUi, /Sign in to Gemini.*Return here with the code/s);
  assert.doesNotMatch(loginUi, /Claude|ChatGPT/);
  await assert.rejects(app.llm.runAgent(options), /subscription da collegare/, "Gemini always needs an explicitly selected account");
  for (const record of accounts) {
    assert.equal((await request(`/api/subscriptions/${record.id}`, { method: "DELETE" })).status, 200);
    assert.ok(!existsSync(join(home, "subscriptions", record.id)));
  }
  assert.equal(app.store.residentSubscription("gemini"), null);
});
