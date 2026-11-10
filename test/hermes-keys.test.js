import assert from "node:assert/strict";
import http from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { Credentials } from "../src/credentials.js";
import { hermesKeyBackend, hermesRemoteModel } from "../src/hermes-keys.js";
import { LLM } from "../src/llm.js";
import { startCora } from "../src/main.js";
import { Store } from "../src/store.js";
import { fakeCli, fakeDocker, tempHome } from "./helpers.js";
import { panelHarness } from "./panel.js";

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** A stand-in Ollama Cloud and DeepSeek: the key is accepted only when it is the one the test handed out. */
async function keyApi() {
  const seen = [];
  const server = await listen(async (req, res) => {
    const auth = String(req.headers.authorization || "");
    seen.push({ path: req.url, method: req.method });
    const ok = auth === "Bearer sk-good-deepseek-MINE" || auth === "Bearer sk-good-ollama-MINE" || auth === "Bearer sk-space-deepseek-SPACE" || auth === "Bearer sk-space-ollama-SPACE";
    // The catalog is public, as on ollama.com: a bad key still sees the names.
    if (req.method === "GET" && req.url === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "qwen3-coder:480b" }, { name: "argo-skip" }] }));
      return;
    }
    if (!ok) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "no" }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/me") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: "fixture" }));
      return;
    }
    if (req.url === "/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    seen,
    ends: {
      ollama: { baseUrl: `${url}/v1`, modelsUrl: `${url}/api/tags` },
      deepseek: { baseUrl: url, modelsUrl: `${url}/models` },
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function llmFor(home, cli, ends) {
  const llm = new LLM({
    ollamaUrl: "http://127.0.0.1:1",
    ollamaKey: "sk-space-ollama-SPACE",
    orcaKey: "",
    hermesBin: cli.hermes,
    hermesHome: join(home, "hermes-home"),
    hermesBaseUrl: "http://127.0.0.1:1/v1",
    hermesEnds: ends,
    deepseekBin: "/missing/dsh",
    deepseekKey: "sk-space-deepseek-SPACE",
    claudeBin: "/missing/claude",
    codexBin: "/missing/codex",
    grokBin: "/missing/grok",
    museBin: "/missing/muse",
    geminiBin: "/missing/agy",
    cliWorkDir: join(home, "work"),
    bridge: { register() { return null; } },
  });
  return llm;
}

test("a Hermes id says which key it needs, and the model name after it", () => {
  assert.equal(hermesKeyBackend("hermes/qwen3:14b"), "");
  assert.equal(hermesKeyBackend("hermes/deepseek/deepseek-flash"), "deepseek");
  assert.equal(hermesKeyBackend("hermes/ollama/qwen3-coder:480b"), "ollama");
  assert.equal(hermesKeyBackend("hermes/orcarouter/vendor/model"), "");
  assert.equal(hermesRemoteModel("hermes/deepseek/deepseek-flash"), "deepseek-flash");
  assert.equal(hermesRemoteModel("hermes/ollama/qwen3-coder:480b"), "qwen3-coder:480b");
});

test("Hermes runs local Ollama, Ollama Cloud and DeepSeek, with the person's key or the space key, and never writes the key down", async (t) => {
  const home = tempHome();
  const store = new Store(home);
  const credentials = new Credentials({ store, key: "fixture-session" });
  const cli = fakeCli();
  cli.set({ reply: "fatto" });
  const api = await keyApi();
  t.after(() => api.close());
  const llm = llmFor(home, cli, api.ends);
  llm.credentials = credentials;
  const mine = credentials.create({ provider: "deepseek", secret: "sk-person-deepseek-MINE1", label: "Mia", connectedBy: { id: "local-owner", name: "Owner" } });
  const ollamaMine = credentials.create({ provider: "ollama", secret: "sk-person-ollama-MINE2", connectedBy: { id: "local-owner", name: "Owner" } });
  assert.equal(credentials.secret(mine.id), "sk-person-deepseek-MINE1");
  assert.equal(JSON.stringify(credentials.list({ id: "local-owner" })).includes("MINE1"), false);
  assert.equal(credentials.list({ id: "someone-else" }).length, 0);

  const run = async (model, credentialId) => {
    const before = cli.calls().length;
    await llm.runAgent({ model, credentialId, system: "sistema", prompt: "domanda", tools: [], execute: async () => "", timeoutMs: 10000 });
    return cli.calls()[before];
  };

  const local = await run("hermes/qwen3:14b", "");
  assert.equal(local.endpointKey, "");
  assert.match(local.hermesConfig, /base_url: "http:\/\/127\.0\.0\.1:1\/v1"/);
  assert.equal(local.argv[local.argv.indexOf("-m") + 1], "qwen3:14b");

  const ownDeep = await run("hermes/deepseek/deepseek-flash", mine.id);
  assert.equal(ownDeep.endpointKeyLast4, "INE1");
  assert.match(ownDeep.hermesConfig, /base_url: "http:\/\/127\.0\.0\.1:\d+"/);
  assert.equal(ownDeep.argv[ownDeep.argv.indexOf("-m") + 1], "deepseek-flash");
  assert.equal(ownDeep.hermesConfig.includes("MINE1"), false);
  assert.match(ownDeep.hermesConfig, /api_key: "\$\{CORA_ENDPOINT_KEY\}"/);

  const spaceDeep = await run("hermes/deepseek/deepseek-v4-pro", "");
  assert.equal(spaceDeep.endpointKeyLast4, "PACE");
  assert.equal(spaceDeep.argv[spaceDeep.argv.indexOf("-m") + 1], "deepseek-v4-pro");
  assert.equal(spaceDeep.hermesConfig.includes("SPACE"), false);

  const ownCloud = await run("hermes/ollama/qwen3-coder:480b", ollamaMine.id);
  assert.equal(ownCloud.endpointKeyLast4, "INE2");
  assert.match(ownCloud.hermesConfig, /\/v1"/);
  assert.equal(ownCloud.argv[ownCloud.argv.indexOf("-m") + 1], "qwen3-coder:480b");
  assert.equal(ownCloud.hermesConfig.includes("MINE2"), false);

  const spaceCloud = await run("hermes/ollama/qwen3-coder:480b", "");
  assert.equal(spaceCloud.endpointKeyLast4, "PACE");

  await assert.rejects(() => run("hermes/deepseek/deepseek-flash", "key_deadbeefdead"), /chiave API non trovata/);
  assert.throws(() => store.createAgent({ name: "Bad", model: "hermes/deepseek/deepseek-flash", credentialId: ollamaMine.id }), /incompatibile/);
  const agent = store.createAgent({ name: "Nico", model: "hermes/deepseek/deepseek-flash", credentialId: mine.id });
  assert.equal(agent.credentialId, mine.id);
  assert.throws(() => credentials.remove(mine.id, { id: "local-owner" }), /usata da un agente/);
  const back = store.updateAgent(agent.id, { model: "hermes/qwen3:14b" });
  assert.equal(back.credentialId, "", "a local model does not keep the cloud key");
  credentials.remove(mine.id, { id: "local-owner" });
  assert.equal(credentials.list({ id: "local-owner" }).some((item) => item.id === mine.id), false);

  const models = await llm.listModels();
  assert.ok(models.some((model) => model.id === "hermes/deepseek/deepseek-flash" && model.backend === "deepseek"));
  assert.ok(models.some((model) => model.id === "hermes/deepseek/deepseek-v4-pro"));
});

test("the panel offers the three Hermes ends and both keys, and the API keeps each person's key to themselves", async (t) => {
  const api = await keyApi();
  t.after(() => api.close());
  const home = tempHome();
  const cli = fakeCli();
  cli.set({ reply: "ok" });
  const app = startCora({
    home, host: "127.0.0.1", port: 0, insecureCookies: true,
    adminPassword: "fixture-password", sessionKey: "fixture-session",
    discordToken: "", telegramToken: "", ollamaUrl: "http://127.0.0.1:1", ollamaKey: "sk-space-ollama-SPACE", orcaKey: "",
    deepseekKey: "sk-space-deepseek-SPACE", deepseekBin: "/missing/dsh",
    hermesBin: cli.hermes, hermesHome: join(home, "hermes-home"), hermesBaseUrl: "http://127.0.0.1:1/v1", hermesEnds: api.ends,
    cloudUrl: "", cloudKey: "", cloudSpace: "",
    claudeBin: "/missing/claude", codexBin: "/missing/codex", grokBin: "/missing/grok", museBin: "/missing/muse", geminiBin: "/missing/agy",
    botTokenFor: () => "", docker: fakeDocker().path, startBoxes: false, schedulerTickMs: 3600000,
    ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
  });
  await app.ready;
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ password: "fixture-password" }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const request = async (path, { method = "GET", body } = {}) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, "X-Cora": "1", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    return { status: response.status, data };
  };

  const created = await request("/api/credentials", { method: "POST", body: { provider: "deepseek", secret: "sk-good-deepseek-MINE", label: "Mia DeepSeek" } });
  assert.equal(created.status, 201);
  assert.equal(created.data.last4, "MINE");
  assert.equal(JSON.stringify(created.data).includes("sk-good"), false);
  assert.ok(created.data.models.some((model) => model.name === "deepseek-flash"));
  const refused = await request("/api/credentials", { method: "POST", body: { provider: "ollama", secret: "sk-nope", label: "No" } });
  assert.equal(refused.status, 400);
  assert.match(refused.data.error, /non accetta/);
  const cloudKey = await request("/api/credentials", { method: "POST", body: { provider: "ollama", secret: "sk-good-ollama-MINE", label: "Mia Ollama" } });
  assert.equal(cloudKey.status, 201, JSON.stringify(cloudKey.data));
  assert.equal(cloudKey.data.last4, "MINE");
  assert.ok(cloudKey.data.models.some((model) => model.name === "qwen3-coder:480b"));
  assert.equal(cloudKey.data.models.some((model) => model.name.startsWith("argo-")), false);
  assert.equal(JSON.stringify(cloudKey.data).includes("sk-good"), false);

  const stranger = new Credentials({ store: app.store, key: "fixture-session" }).create({
    provider: "deepseek", secret: "sk-other-person-SECRET", connectedBy: { id: "ac_other", name: "Other" },
  });
  const listed = await request("/api/credentials");
  assert.equal(listed.data.some((item) => item.id === created.data.id), true);
  assert.equal(listed.data.some((item) => item.id === stranger.id), false);
  assert.equal(JSON.stringify(listed.data).includes("SECRET"), false);

  const state = await request("/api/state");
  assert.equal(state.status, 200);
  assert.ok(state.data.models.some((model) => model.id === "hermes/deepseek/deepseek-flash"));
  assert.equal(JSON.stringify(state.data).includes("sk-good"), false);
  assert.equal(JSON.stringify(state.data).includes("SECRET"), false);

  const agent = await request("/api/agents", { method: "POST", body: { name: "Nico", model: "hermes/deepseek/deepseek-flash", credentialId: created.data.id } });
  assert.equal(agent.status, 201, JSON.stringify(agent.data));
  assert.equal(agent.data.credential.id, created.data.id);
  assert.equal(agent.data.credential.last4, "MINE");
  assert.equal(JSON.stringify(agent.data).includes("sk-good"), false);

  const stolen = await request(`/api/agents/${agent.data.id}`, { method: "PUT", body: { credentialId: stranger.id } });
  assert.equal(stolen.status, 403);
  const space = await request(`/api/agents/${agent.data.id}`, { method: "PUT", body: { model: "hermes/ollama/qwen3-coder:480b", credentialId: "" } });
  assert.equal(space.status, 200);
  assert.equal(space.data.credentialId, "");
  app.llm.deepseek.key = "";
  const missing = await request(`/api/agents/${agent.data.id}`, { method: "PUT", body: { model: "hermes/deepseek/deepseek-flash", credentialId: "" } });
  assert.equal(missing.status, 400);

  const calls = [];
  const panel = panelHarness({ fetch: async (path, options = {}) => {
    calls.push([options.method || "GET", path]);
    if (String(path).includes("/api/hermes/models") || String(path).includes("/models")) {
      return { ok: true, status: 200, json: async () => ({ models: [{ name: "deepseek-flash", label: "DeepSeek V4.1 Flash" }, { name: "qwen3-coder:480b", label: "qwen3-coder:480b" }] }) };
    }
    if (path === "/api/hardware") return { ok: true, status: 200, json: async () => ({ hosts: [{ url: "http://127.0.0.1:11434", label: "qui", models: [{ name: "qwen3:14b", local: true, completion: true, tools: true, size: 0, context: 131072 }] }], gpus: [] }) };
    if (path === "/api/credentials" && options.method === "POST") {
      return { ok: true, status: 201, json: async () => ({ id: "key_abcdefabcdef", provider: "ollama", label: "Mia", last4: "MINE", models: [{ name: "qwen3-coder:480b" }] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  } });
  panel.run(`S.data = {
    settings: { defaultModel: "hermes/qwen3:14b" },
    currentUser: { id: "local-owner", name: "Owner", role: "owner" },
    providers: { hermes: true, ollama: true, deepseek: false },
    keys: { ollama: true, deepseek: false },
    credentials: [{ id: "key_aaaaaaaaaaaa", provider: "deepseek", label: "Mia DeepSeek", last4: "MINE", connectedBy: { id: "local-owner", name: "Owner" } }],
    models: [
      { id: "hermes/qwen3:14b", provider: "hermes", label: "qwen3:14b", local: true, tools: true },
      { id: "hermes/deepseek/deepseek-flash", provider: "hermes", label: "DeepSeek V4.1 Flash", local: false, backend: "deepseek", tools: true, via: "DeepSeek" },
      { id: "hermes/deepseek/deepseek-v4-pro", provider: "hermes", label: "DeepSeek V4 Pro", local: false, backend: "deepseek", tools: true, via: "DeepSeek" },
    ],
    ollamaCloud: { signedIn: false },
    agents: [],
    subscriptions: [],
  }`);
  panel.run(`window.__brain = brainPanel({ id: "ag_1", name: "Nico", model: "hermes/qwen3:14b", credentialId: "", subscriptionId: "", tools: true })`);
  panel.run(`document.getElementById("app").append(window.__brain.node)`);
  const ends = () => panel.app.querySelectorAll(".hermes-end").map((button) => button.textContent);
  assert.deepEqual(ends(), ["Su questa macchina", "Ollama Cloud", "DeepSeek"]);

  panel.app.querySelectorAll(".hermes-end").find((button) => button.textContent === "DeepSeek").click();
  await new Promise((resolve) => setImmediate(resolve));
  const keys = () => panel.app.querySelectorAll(".hermes-key").map((button) => button.textContent);
  assert.ok(keys().some((text) => text.includes("Chiave dello space") && text.includes("non configurata")));
  assert.ok(keys().some((text) => text.includes("Mia DeepSeek") && text.includes("MINE")));
  const spaceDeep = () => panel.app.querySelectorAll(".hermes-key").find((button) => button.textContent.includes("Chiave dello space"));
  assert.ok("disabled" in spaceDeep().attributes, "the space row stays, and is off when that key is missing");
  assert.equal(panel.run("window.__brain.credentialId()"), "", "opening the tab does not change the saved key");
  panel.app.querySelectorAll(".model-row").find((button) => button.textContent.includes("DeepSeek V4.1 Flash")).click();
  assert.equal(panel.run("window.__brain.credentialId()"), "key_aaaaaaaaaaaa", "the person's saved key is the one already on this end");
  assert.equal(panel.run("window.__brain.validate()"), true);
  spaceDeep().click();
  assert.equal(panel.run("window.__brain.credentialId()"), "key_aaaaaaaaaaaa", "a missing space key cannot be chosen");

  panel.app.querySelectorAll(".hermes-end").find((button) => button.textContent === "Ollama Cloud").click();
  await new Promise((resolve) => setImmediate(resolve));
  const spaceCloud = () => panel.app.querySelectorAll(".hermes-key").find((button) => button.textContent.includes("Chiave dello space"));
  assert.ok(spaceCloud().textContent.includes("pronta"));
  assert.equal("disabled" in spaceCloud().attributes, false);
  panel.app.querySelectorAll(".model-row").find((button) => button.textContent.includes("qwen3-coder:480b")).click();
  assert.equal(panel.run("window.__brain.credentialId()"), "", "with no personal key the space key is the choice");
  assert.equal(panel.run("window.__brain.validate()"), true);
  spaceCloud().click();
  assert.equal(panel.run("window.__brain.credentialId()"), "", "the space key stays selectable beside a future personal key");

  const secret = panel.app.querySelectorAll("input").find((input) => input.getAttribute("type") === "password");
  secret.value = "sk-good-ollama-MINE";
  secret.dispatch("input");
  panel.app.querySelectorAll("button").find((button) => button.textContent.includes("Aggiungi la tua chiave")).click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(calls.some(([method, path]) => method === "POST" && path === "/api/credentials"));
  assert.equal(panel.run("window.__brain.credentialId()"), "key_abcdefabcdef", "adding a key selects it for the model already chosen");
  spaceCloud().click();
  assert.equal(panel.run("window.__brain.credentialId()"), "", "the space key stays available beside the personal one");
  panel.app.querySelectorAll(".hermes-key").find((button) => button.textContent.includes("Mia") && button.textContent.includes("MINE")).click();
  assert.equal(panel.run("window.__brain.credentialId()"), "key_abcdefabcdef");

  panel.app.querySelectorAll(".hermes-end").find((button) => button.textContent === "Su questa macchina").click();
  panel.app.querySelectorAll(".model-row").find((button) => button.textContent.includes("qwen3:14b") && !button.textContent.includes("Predefinito")).click();
  assert.equal(panel.run("window.__brain.credentialId()"), "", "a local model does not keep a cloud key");
});
