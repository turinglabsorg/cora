import assert from "node:assert/strict";
import { createECDH, createDecipheriv, createPublicKey, hkdfSync, randomBytes, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { after, before, beforeEach, describe, test } from "node:test";
import { startCora } from "../src/main.js";
import { passKeys, signPass } from "../src/pass.js";
import { LISTENING_INTENTS } from "../src/discord.js";
import { loginLinkToken } from "../src/web.js";
import { SHARED, Store } from "../src/store.js";
import { identityCli } from "./subscription-fixtures.js";
import { subscriptionEnvironment } from "../src/subscriptions.js";
import { LLM } from "../src/llm.js";
import { runClaude, runCodex } from "../src/cli.js";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BOT, CHANNEL, GUILD, MAIN_TOKEN, OTHER_CHANNEL, OTHER_GUILD, OWNER, STRANGER, TG_GROUP, TG_OTHER_GROUP, TG_OWNER, TG_STRANGER, fakeCli, fakeDiscord, fakeDocker, fakeOllama, fakeTelegram, sleep, tempHome, waitFor } from "./helpers.js";

const PASSWORD = "correct horse battery staple";
let discord;
let telegram;
let ollama;
let docker;
let app;
let base;
let cookie = "";
let replies;
// The goal calls do not belong to any agent: tests set `goals`/`checks` to drive them.
let goals;
let checks;
let intentions;
let cli;
let home;
let orca;
const subscriptionIds = {};
const botTokens = {};
const hushVault = {};

async function subscriptionApp(t, existing) {
  const identity = existing?.identity || identityCli();
  const directory = existing?.home || tempHome();
  const instance = startCora({ home: directory, host: "127.0.0.1", port: 0, insecureCookies: true,
    adminPassword: PASSWORD, sessionKey: "subscription-fixture-session", useResidentSubscriptions: false, discordToken: "", telegramToken: "", ollamaKey: "", orcaKey: "", cloudUrl: "", cloudKey: "", cloudSpace: "",
    claudeBin: identity.claude, codexBin: identity.codex, hermesBin: "/not-installed/hermes", botTokenFor: () => "",
    docker: docker.path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/not-installed/AGENTS.md", sshAuthorizedKeys: "/not-installed/keys",
  });
  await instance.ready;
  let stopped = false;
  const stop = async () => { if (!stopped) { stopped = true; await instance.stop(); } };
  t.after(stop);
  const root = `http://127.0.0.1:${instance.server.address().port}`;
  const login = await fetch(`${root}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ password: PASSWORD }) });
  const session = login.headers.get("set-cookie").split(";")[0];
  const request = async (path, { method = "GET", body, headers = {} } = {}) => {
    const response = await fetch(`${root}${path}`, { method, headers: { Cookie: session, "X-Cora": "1", "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  return { app: instance, identity, home: directory, request, root, stop };
}

async function connectIdentity(fixture, provider, label = provider) {
  const created = await fixture.request("/api/subscriptions", { method: "POST", body: { provider, label } });
  assert.equal(created.status, 201);
  const started = await fixture.request(`/api/subscriptions/${created.data.id}/login`, { method: "POST" });
  assert.equal(started.status, 202);
  if (provider === "claude") await fixture.request(`/api/subscriptions/${created.data.id}/code`, { method: "POST", body: { code: "fixture-authorization-code" } });
  else fixture.identity.set({ complete: true });
  return waitFor(() => { const record = fixture.app.store.subscription(created.data.id); return record.status === "ready" && record; });
}

function lastUserText(body) {
  const users = body.messages.filter((message) => message.role === "user");
  return users[users.length - 1]?.content || "";
}

function whoAmI(body) {
  for (const message of body.messages) {
    const name = /^Sei (\p{Lu}[^.]*)\./u.exec(String(message.content))?.[1];
    if (name) return name;
  }
  return null;
}

function lastChatLine(body) {
  const chat = /<chat>\n([\s\S]*?)\n<\/chat>/.exec(lastUserText(body))?.[1] || "";
  return chat.split("\n").pop();
}

const quiet = () => waitFor(() => app.orchestrator.quiet(), { what: "agents to stop talking", timeout: 30000 });

async function call(path, { method = "GET", body, headers = {}, auth = true } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "X-Cora": "1", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(auth && cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { status: response.status, data, headers: response.headers };
}

/** OrcaRouter as far as Cora can tell: an OpenAI-style router with a model list and chat completions. */
function fakeRouter() {
  const state = { requests: [], reply: () => ({ content: "PASS" }) };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const json = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== "Bearer sk-orca-test") return json(401, { error: { message: "bad key" } });
    if (req.method === "GET" && req.url === "/v1/models") {
      return json(200, { object: "list", data: [{ id: "openai/gpt-test", object: "model", supported_endpoint_types: ["openai", "anthropic"] }, { id: "anthropic/only-native", supported_endpoint_types: ["anthropic"] }] });
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      state.requests.push(body);
      const reply = await state.reply(body);
      const message = { role: "assistant", content: reply.content ?? null };
      if (reply.tool_calls) message.tool_calls = reply.tool_calls.map((call, index) => ({ id: `call_${state.requests.length}_${index}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) } }));
      return json(200, { id: "chatcmpl-1", object: "chat.completion", choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }] });
    }
    json(404, {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}/v1`, state, close: () => new Promise((done) => server.close(done)) })));
}

before(async () => {
  orca = await fakeRouter();
  discord = await fakeDiscord();
  telegram = await fakeTelegram();
  replies = new Map();
  goals = null;
  checks = null;
  ollama = await fakeOllama(async (body) => {
    const system = String(body.messages[0]?.content || "");
    if (/^Scrivi la condizione di completamento/.test(system)) return { content: goals ? goals(body) : "NESSUNO" };
    if (/^Giudichi se un compito è finito/.test(system)) return { content: checks ? checks(body) : JSON.stringify({ met: true, reason: "" }) };
    if (/^Valuti l'intenzione/.test(system)) {
      const latest = String(body.messages[1].content).split("Nuovi messaggi da valutare:\n")[1] || "";
      return { content: intentions ? await intentions(body) : JSON.stringify({ intent: /fermati|stoppa tutto/.test(latest) ? "stop" : "update" }) };
    }
    const name = whoAmI(body);
    const handler = replies.get(name) || replies.get("*");
    return handler ? handler(body) : { content: "PASS" };
  });
  docker = fakeDocker();
  cli = fakeCli();
  home = tempHome();
  writeFileSync(join(home, "owner-AGENTS.md"), "# Global Agent Instructions\nISTRUZIONI DI PROVA: rispondi sempre in italiano.\n");
  writeFileSync(join(home, "authorized_keys"), [
    `ssh-ed25519 ${"A".repeat(68)} seb@laptop`,
    `from="10.0.0.1",restrict,command="/bin/gate" ssh-ed25519 ${"B".repeat(68)} gate@server`,
    "# a comment",
  ].join("\n"));
  const seed = new Store(home);
  seed.updateSettings({ guildIds: [GUILD] });
  seed.close();
  app = startCora({
    home,
    host: "127.0.0.1",
    port: 0,
    adminPassword: PASSWORD,
    sessionKey: "test-session-key",
    insecureCookies: true,
    discordToken: MAIN_TOKEN,
    discordApi: discord.url,
    telegramApi: telegram.url,
    telegramPollTimeout: 1,
    ollamaUrl: ollama.url,
    ollamaKey: "test-ollama-key",
    orcaUrl: orca.url,
    orcaKey: "sk-orca-test",
    hermesBin: cli.hermes,
    hermesHome: join(home, "hermes-home"),
    hermesBaseUrl: `${ollama.url}/v1`,
    claudeBin: cli.claude,
    codexBin: cli.codex,
    codexModelsFile: cli.models,
    ownerInstructions: join(home, "owner-AGENTS.md"),
    sshAuthorizedKeys: join(home, "authorized_keys"),
    vapidKey: "test-vapid-secret",
    sshJump: "sam@host",
    botTokenFor: (name) => botTokens[name] || "",
    storeSecret: async (name, value) => { hushVault[name] = value; },
    docker: docker.path,
    schedulerTickMs: 3600000,
    startBoxes: false,
  });
  await app.ready;
  for (const provider of ["claude", "codex"]) {
    const identity = app.store.createSubscription({ provider, label: `Fixture ${provider}` });
    app.store.updateSubscription(identity.id, { status: "ready" });
    subscriptionIds[provider] = identity.id;
  }
  base = `http://127.0.0.1:${app.server.address().port}`;
  await waitFor(() => app.discord.state === "ready" && app.discord.guilds.size === 2, { what: "gateway ready" });
});

after(async () => {
  await orca.close();
  await app.stop();
  await discord.close();
  await telegram.close();
  await ollama.close();
});

beforeEach(async () => {
  if (app) await quiet();
  replies.clear();
  goals = null;
  checks = null;
  intentions = null;
  discord.state.webhookPosts.length = 0;
  discord.state.botPosts.length = 0;
});

describe("per-agent subscription authentication", () => {
  test("connects both official login shapes, exposes metadata only and validates assignments", async (t) => {
    const fixture = await subscriptionApp(t);
    const claude = await connectIdentity(fixture, "claude", "Design team");
    const codex = await connectIdentity(fixture, "codex", "Engineering team");
    assert.match(claude.email, /@example.test$/);
    assert.equal(codex.plan, "pro");
    const list = await fixture.request("/api/subscriptions");
    assert.equal(list.data.length, 2);
    assert.doesNotMatch(JSON.stringify(list.data), /access_token|refresh_token|fixture-authorization-code|TEST-ONLY|state=fixture/);
    assert.doesNotMatch(JSON.stringify(fixture.app.store.subscriptions()), /access_token|refresh_token|login|directory/);
    const missing = await fixture.request("/api/agents", { method: "POST", body: { name: "Missing", model: "codex/gpt-6-sol" } });
    assert.equal(missing.status, 400);
    const wrong = await fixture.request("/api/agents", { method: "POST", body: { name: "Wrong", model: "codex/gpt-6-sol", subscriptionId: claude.id } });
    assert.equal(wrong.status, 400);
    const created = await fixture.request("/api/agents", { method: "POST", body: { name: "Ada", model: "codex/gpt-6-sol", subscriptionId: codex.id, tools: false } });
    assert.equal(created.status, 201);
    assert.equal(created.data.subscriptionId, codex.id);
    const second = await fixture.request("/api/agents", { method: "POST", body: { name: "Bob", model: "codex/gpt-6-sol", subscriptionId: codex.id, tools: false } });
    assert.equal(second.status, 201, "several agents can select an existing subscription");
    assert.equal((await fixture.request(`/api/subscriptions/${codex.id}`, { method: "DELETE" })).status, 400);
    assert.equal((await fixture.request(`/api/subscriptions/${claude.id}/check`, { method: "POST" })).data.status, "ready");
    assert.equal((await fixture.request(`/api/subscriptions/${codex.id}/check`, { method: "POST" })).data.status, "ready");
    const changed = await fixture.request(`/api/agents/${created.data.id}`, { method: "PUT", body: { model: "claude/claude-sonnet-5-5", subscriptionId: claude.id } });
    assert.equal(changed.status, 200);
    assert.equal(changed.data.subscriptionId, claude.id);
  });

  test("the Brain routes different agents to different local accounts without host credential overrides", async (t) => {
    const fixture = await subscriptionApp(t);
    const first = await connectIdentity(fixture, "codex", "First account");
    const second = await connectIdentity(fixture, "codex", "Second account");
    const third = await connectIdentity(fixture, "claude", "Third account");
    const agents = [first, second, third].map((record, index) => fixture.app.store.createAgent({ name: `Agent ${index}`, model: record.provider === "codex" ? "codex/gpt-6-sol" : "claude/claude-sonnet-5-5", subscriptionId: record.id, tools: false }));
    const results = await Promise.all(agents.map((agent) => fixture.app.brain.chatTurn({ agent, history: [{ id: `m-${agent.id}`, kind: "owner", at: Date.now(), content: "Which identity?", authorName: "Owner" }], channel: { id: "web", name: "test" }, forced: true, computer: false })));
    for (const [index, record] of [first, second, third].entries()) assert.match(results[index].text, new RegExp(record.email.replaceAll(".", "\\.")));
    const runs = fixture.identity.calls();
    assert.equal(new Set(runs.map((run) => run.directory)).size, 3);
    assert.ok(runs.every((run) => run.directory.startsWith(join(fixture.home, "subscriptions"))));
    assert.ok(runs.every((run) => run.inheritedKeys.length === 0));
    const env = subscriptionEnvironment("codex", "/fixture/account", { HOME: "/fixture/user", PATH: "/bin", ANTHROPIC_API_KEY: "fixture-host-key", OPENAI_API_KEY: "fixture-host-key", CODEX_HOME: "/other-account", CLAUDE_CODE_USE_VERTEX: "1", CORA_BOT_PRIVATE: "fixture-bot-key", CLOUDSDK_CONFIG: "/other-project" });
    assert.deepEqual(env, { HOME: "/fixture/user", PATH: "/bin", CODEX_HOME: "/fixture/account" });
  });

  test("rejects unauthenticated and cross-origin login control; cancellation and failed login can recover", async (t) => {
    const fixture = await subscriptionApp(t);
    assert.equal((await fetch(`${fixture.root}/api/subscriptions`)).status, 401);
    const created = await fixture.request("/api/subscriptions", { method: "POST", body: { provider: "codex", label: "Pending" } });
    const id = created.data.id;
    const path = `/api/subscriptions/${id}/login`;
    assert.equal((await fixture.request(path, { method: "POST", headers: { Origin: "https://elsewhere.example" } })).status, 403);
    fixture.identity.set({ evilUrl: "https://elsewhere.example/steal" });
    const failed = await fixture.request(path, { method: "POST" });
    assert.equal(failed.data.status, "error");
    assert.equal(failed.data.login, undefined);
    fixture.identity.set({ complete: false });
    const retry = await fixture.request(path, { method: "POST" });
    assert.equal(retry.data.status, "connecting");
    assert.equal(retry.data.login.url, "https://auth.openai.com/codex/device");
    assert.equal((await fixture.request(`/api/subscriptions/${id}/cancel`, { method: "POST" })).data.status, "disconnected");
    assert.equal((await fixture.request(`/api/subscriptions/${id}/code`, { method: "POST", body: { code: "not-a-claude-flow" } })).status, 400);
    fixture.identity.set({ complete: true });
    await fixture.request(path, { method: "POST" });
    await waitFor(() => fixture.app.store.subscription(id).status === "ready");
    assert.doesNotMatch(JSON.stringify(fixture.app.store.recentActivity(100)), /TEST-ONLY|state=fixture|private provider detail/);
  });

  test("a restart retains selected accounts and clears an interrupted sign-in without importing host authentication", async (t) => {
    const fixture = await subscriptionApp(t);
    const connected = await connectIdentity(fixture, "claude");
    const agent = fixture.app.store.createAgent({ name: "Persistent", model: "claude/claude-sonnet-5-5", subscriptionId: connected.id, tools: false });
    const pending = (await fixture.request("/api/subscriptions", { method: "POST", body: { provider: "claude", label: "Incomplete" } })).data;
    await fixture.request(`/api/subscriptions/${pending.id}/login`, { method: "POST" });
    await fixture.stop();
    const restarted = await subscriptionApp(t, fixture);
    assert.equal(restarted.app.store.agent(agent.id).subscriptionId, connected.id);
    assert.equal(restarted.app.store.subscription(pending.id).status, "disconnected");
    assert.equal((await restarted.request(`/api/subscriptions/${connected.id}/check`, { method: "POST" })).data.status, "ready");
    assert.equal(restarted.app.store.subscriptions().length, 2);
  });

  test("shared subscriptions serialize work, queued cancellation is prompt and login cannot race a running account", async (t) => {
    const fixture = await subscriptionApp(t);
    const record = await connectIdentity(fixture, "claude");
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    let entered = false;
    const first = fixture.app.subscriptions.run(record.id, "claude", null, async () => { entered = true; await hold; return "first"; });
    await waitFor(() => entered);
    let secondEntered = false;
    const controller = new AbortController();
    const second = fixture.app.subscriptions.run(record.id, "claude", controller.signal, async () => { secondEntered = true; });
    const stopped = assert.rejects(second, /cancelled/);
    controller.abort(new Error("cancelled"));
    await stopped;
    assert.equal(secondEntered, false);
    assert.equal((await fixture.request(`/api/subscriptions/${record.id}/login`, { method: "POST" })).status, 400);
    release();
    assert.equal(await first, "first");
  });

  test("refuses a Claude CLI that ignores its profile; a successful retry and unused-account removal recover", async (t) => {
    const fixture = await subscriptionApp(t);
    const record = (await fixture.request("/api/subscriptions", { method: "POST", body: { provider: "claude", label: "Isolation", legacyHost: true } })).data;
    assert.equal(record.legacyHost, undefined, "a browser cannot designate the host's account");
    fixture.identity.set({ wrongDirectory: true });
    const refused = await fixture.request(`/api/subscriptions/${record.id}/login`, { method: "POST" });
    assert.equal(refused.data.status, "error");
    assert.equal(refused.data.issue, "isolation");
    assert.equal(refused.data.login, undefined);
    fixture.identity.set({});
    await fixture.request(`/api/subscriptions/${record.id}/login`, { method: "POST" });
    await fixture.request(`/api/subscriptions/${record.id}/code`, { method: "POST", body: { code: "fixture-authorization-code" } });
    await waitFor(() => fixture.app.store.subscription(record.id).status === "ready");
    assert.equal((await fixture.request(`/api/subscriptions/${record.id}`, { method: "DELETE" })).status, 200);
    assert.equal(fixture.app.store.subscription(record.id), null);
  });

  test("with resident defaults disabled, older agents require browser onboarding", async (t) => {
    const fixture = await subscriptionApp(t);
    const agent = fixture.app.store.createAgent({ name: "Existing", model: "ollama/test-model", tools: false });
    const old = { ...agent, model: "claude/claude-sonnet-5-5" };
    delete old.subscriptionId;
    fixture.app.store.db.prepare("UPDATE agents SET data = ? WHERE id = ?").run(JSON.stringify(old), agent.id);
    await fixture.stop();
    const restarted = await subscriptionApp(t, fixture);
    assert.equal(restarted.app.store.agent(agent.id).subscriptionId, "");
    assert.equal(restarted.app.store.subscriptions().length, 0);
    await assert.rejects(restarted.app.llm.runAgent({ model: old.model, tools: [], timeoutMs: 5000 }), /subscription da collegare/);
    assert.equal(restarted.identity.calls().length, 0);
  });

  test("retired host links remain isolated when resident defaults are disabled", async (t) => {
    const fixture = await subscriptionApp(t);
    const oldIds = [];
    for (const provider of ["claude", "codex"]) {
      const record = fixture.app.store.createSubscription({ provider, label: `${provider} · Server` });
      const old = { ...record, status: "ready", email: "old-host@example.test", plan: "old-plan", legacyHost: true };
      fixture.app.store.db.prepare("UPDATE subscriptions SET data = ? WHERE id = ?").run(JSON.stringify(old), record.id);
      fixture.app.store.createAgent({ name: provider, model: provider === "claude" ? "claude/claude-sonnet-5-5" : "codex/gpt-6-sol", subscriptionId: record.id, tools: false });
      oldIds.push(record.id);
    }
    await fixture.stop();
    const restarted = await subscriptionApp(t, fixture);
    for (const id of oldIds) {
      const record = restarted.app.store.subscription(id);
      assert.equal(record.legacyHost, undefined);
      assert.equal(record.status, "disconnected");
      assert.equal(record.email, "");
      assert.equal(record.plan, "");
      assert.doesNotMatch(record.label, /Server/);
      const env = restarted.app.subscriptions.environment(record);
      assert.equal(env[record.provider === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME"], join(restarted.home, "subscriptions", id));
      assert.equal((await restarted.request(`/api/subscriptions/${id}/check`, { method: "POST" })).data.status, "disconnected");
      await assert.rejects(restarted.app.llm.runAgent({ model: `${record.provider}/test-model`, subscriptionId: id, tools: [], timeoutMs: 5000 }), /subscription da collegare/);
    }
    assert.equal(restarted.identity.calls().length, 0, "old agents launch no inference against host logins");
    const id = oldIds[0];
    await restarted.request(`/api/subscriptions/${id}/login`, { method: "POST" });
    await restarted.request(`/api/subscriptions/${id}/code`, { method: "POST", body: { code: "fixture-authorization-code" } });
    await waitFor(() => restarted.app.store.subscription(id).status === "ready");
    const run = await restarted.app.llm.runAgent({ model: "claude/claude-sonnet-5-5", subscriptionId: id, system: "Reply", prompt: "Which identity?", tools: [], timeoutMs: 5000 });
    assert.match(run.text, /Identity: sub_/);
    assert.equal(restarted.identity.calls()[0].directory, join(restarted.home, "subscriptions", id));
    assert.equal(restarted.app.store.subscription(oldIds[1]).status, "disconnected");
  });

  test("the LLM and both CLI runners refuse implicit global authentication", async () => {
    const llm = new LLM({ cliWorkDir: "/unused", claudeBin: cli.claude, codexBin: cli.codex });
    const before = cli.calls().length;
    for (const provider of ["claude", "codex"]) await assert.rejects(llm.runAgent({ model: `${provider}/test-model`, tools: [], subscriptionId: "sub_000000000000" }), /subscription da collegare/);
    await assert.rejects(runClaude({}), /subscription da collegare/);
    await assert.rejects(runCodex({}), /subscription da collegare/);
    assert.equal(cli.calls().length, before);
  });
});

describe("panel auth", () => {
  test("refuses a wrong password and API calls without a session", async () => {
    const wrong = await call("/api/login", { method: "POST", body: { password: "nope" }, auth: false });
    assert.equal(wrong.status, 401);
    const state = await call("/api/state", { auth: false });
    assert.equal(state.status, 401);
  });

  test("refuses mutating requests without the X-Cora header or from another origin", async () => {
    const missing = await fetch(`${base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) });
    assert.equal(missing.status, 403);
    const foreign = await call("/api/login", { method: "POST", body: { password: PASSWORD }, headers: { Origin: "https://evil.example" }, auth: false });
    assert.equal(foreign.status, 403);
  });

  test("logs in with the right password", async () => {
    const ok = await call("/api/login", { method: "POST", body: { password: PASSWORD }, auth: false });
    assert.equal(ok.status, 200);
    const setCookie = ok.headers.get("set-cookie");
    assert.match(setCookie, /cora_session=.+HttpOnly; SameSite=Strict/);
    cookie = setCookie.split(";")[0];
    const me = await call("/api/me");
    assert.equal(me.data.authed, true);
  });

  test("serves the panel with a strict CSP", async () => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
    assert.match(await response.text(), /assets\/app\.js/);
  });

  test("database context from the panel reaches every provider through the shared system prompt", async () => {
    const signedIn = await call("/api/login", { method: "POST", body: { password: PASSWORD }, auth: false });
    const headers = { Cookie: signedIn.headers.get("set-cookie").split(";")[0] };
    const created = await call("/api/context/documents", { method: "POST", headers, body: { name: "runtime-context.md", content: "Fixture shared reference: ORBIT." } });
    assert.equal(created.status, 201);
    try {
      for (const provider of ["claude", "codex", "ollama", "orcarouter"]) {
        const agent = { id: "ag_context_fixture", name: "Context fixture", model: `${provider}/fixture`, personality: "", core: "" };
        assert.match(app.brain.systemPrompt(agent, { place: "test", withoutComputer: true }), /Fixture shared reference: ORBIT/);
      }
      await call(`/api/context/documents/${created.data.id}`, { method: "PUT", headers, body: { enabled: false } });
      assert.doesNotMatch(app.brain.systemPrompt({ id: "ag_context_fixture", name: "Fixture", personality: "", core: "" }, { place: "test" }), /Fixture shared reference: ORBIT/);
    } finally { await call(`/api/context/documents/${created.data.id}`, { method: "DELETE", headers }); }
  });
});

describe("agents in Discord", () => {
  let marta;
  let bea;

  test("the owner comes from the allowed server and the client server stays out", async () => {
    const state = await call("/api/state");
    assert.equal(state.status, 200);
    assert.deepEqual(state.data.settings.ownerIds, [OWNER]);
    assert.ok(state.data.channels.some((channel) => channel.id === CHANNEL));
    assert.ok(!state.data.channels.some((channel) => channel.id === OTHER_CHANNEL));
    assert.ok(state.data.models.some((model) => model.id === "ollama/test-model"));
    assert.ok(state.data.models.some((model) => model.id === "claude/claude-opus-5-5"));
    assert.ok(state.data.models.some((model) => model.id === "codex/gpt-6-sol"));
    assert.ok(!state.data.models.some((model) => model.id === "codex/hidden"));
    assert.deepEqual(state.data.providers, { claude: true, codex: true, ollama: true, orcarouter: true, hermes: true });
  });

  test("creates two agents through the API", async () => {
    const one = await call("/api/agents", { method: "POST", body: { name: "Marta", model: "ollama/test-model", personality: "Cinica e precisa.", chattiness: 1, tools: false } });
    assert.equal(one.status, 201);
    marta = one.data;
    const two = await call("/api/agents", { method: "POST", body: { name: "Bea", model: "ollama/test-model", personality: "Entusiasta.", chattiness: 0, tools: false } });
    assert.equal(two.status, 201);
    bea = two.data;
    const duplicate = await call("/api/agents", { method: "POST", body: { name: "marta" } });
    assert.equal(duplicate.status, 400);
  });

  test("an agent answers the owner through a webhook with its own name", async () => {
    replies.set("Marta", () => ({ content: "Ciao capo, eccomi." }));
    discord.say({ content: "ciao a tutti" });
    const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Marta"), { what: "Marta's reply" });
    assert.equal(post.content, "Ciao capo, eccomi.");
    assert.equal(fakeOllama.lastAuth, "Bearer test-ollama-key");
    assert.equal(post.authorized, false);
    assert.deepEqual(post.allowed_mentions, { parse: ["users"] });
  });

  test("a mention makes a quiet agent answer, and agents talk to each other", async () => {
    replies.set("Bea", (body) => (lastChatLine(body).includes("Marta (agente): Bea, tu che dici?")
      ? { content: "Dico che hai ragione, Marta!" }
      : { content: "Sono Bea, presente. Marta, salutami." }));
    replies.set("Marta", (body) => (lastChatLine(body).includes("Sono Bea, presente.") ? { content: "Bea, tu che dici?" } : { content: "PASS" }));
    discord.say({ content: "Bea ci sei?" });
    await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Bea" && item.content.startsWith("Sono Bea, presente.")), { what: "Bea forced reply" });
    await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Marta" && item.content === "Bea, tu che dici?"), { what: "Marta follow-up" });
    await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Bea" && item.content === "Dico che hai ragione, Marta!"), { what: "Bea answers Marta" });
  });

  test("messages from a server cora does not use are ignored", async () => {
    replies.set("*", () => ({ content: "non dovrei parlare" }));
    discord.say({ content: "Marta ci sei?", channel: OTHER_CHANNEL, guild: OTHER_GUILD, author: STRANGER, username: "Cliente" });
    await sleep(2500);
    assert.equal(discord.state.webhookPosts.length, 0);
  });

  test("agent-to-agent talk stops when the turn budget is spent", async () => {
    await call("/api/settings", { method: "PUT", body: { maxAgentTurns: 3 } });
    replies.set("Marta", () => ({ content: "Bea, ancora tu!" }));
    replies.set("Bea", () => ({ content: "Marta, ancora tu!" }));
    discord.say({ content: "Marta e Bea litigate pure" });
    await sleep(500);
    await quiet();
    assert.ok(discord.state.webhookPosts.length <= 4, `posted ${discord.state.webhookPosts.length}`);
    assert.ok(discord.state.webhookPosts.length >= 2);
    await call("/api/settings", { method: "PUT", body: { maxAgentTurns: 8 } });
  });

  test("an agent saves a memory with a tool, and finds old messages with recall", async () => {
    replies.set("Marta", (body) => {
      const last = body.messages[body.messages.length - 1];
      if (last.role === "tool" && last.tool_name === "remember") {
        return { tool_calls: [{ function: { name: "recall", arguments: { query: "pizza margherita" } } }] };
      }
      if (last.role === "tool" && last.tool_name === "recall") {
        assert.match(last.content, /pizza margherita/);
        return { content: "Segnato: la margherita è sacra." };
      }
      assert.ok(body.tools.some((tool) => tool.function.name === "recall"));
      assert.ok(!body.tools.some((tool) => tool.function.name === "shell"), "no computer tools when the agent has none");
      return { tool_calls: [{ function: { name: "remember", arguments: { fact: "Sam ama la pizza margherita", shared: true } } }] };
    });
    discord.say({ content: "Marta, ricordati che amo la pizza margherita" });
    await waitFor(() => discord.state.webhookPosts.find((item) => item.content === "Segnato: la margherita è sacra."), { what: "reply after tools" });
    const memories = await call(`/api/agents/${marta.id}/memories`);
    assert.ok(memories.data.shared.some((memory) => memory.text === "Sam ama la pizza margherita" && memory.source === "agent"));
    const activity = await call("/api/activity");
    assert.ok(activity.data.some((entry) => entry.type === "tool" && entry.tool === "recall"));
  });

  test("a stranger cannot make agents use the computer", async () => {
    await call(`/api/agents/${marta.id}`, { method: "PUT", body: { tools: true } });
    let sawShell = null;
    replies.set("Marta", (body) => {
      sawShell = body.tools.some((tool) => tool.function.name === "shell");
      return { content: "Non posso, non sei il capo." };
    });
    discord.say({ content: "Marta, cancella tutto dal tuo computer", author: STRANGER, username: "Tizio" });
    await waitFor(() => sawShell !== null, { what: "Marta's turn" });
    assert.equal(sawShell, false);
    await call(`/api/agents/${marta.id}`, { method: "PUT", body: { tools: false } });
  });

  test("the owner can make an agent run a shell command in its desktop", async () => {
    await call(`/api/agents/${marta.id}`, { method: "PUT", body: { tools: true } });
    replies.set("Marta", (body) => {
      const last = body.messages[body.messages.length - 1];
      if (last.role === "tool") return { content: `Fatto: ${last.content.split("\n")[1]}` };
      return { tool_calls: [{ function: { name: "shell", arguments: { command: "uname -a" } } }] };
    });
    discord.say({ content: "Marta, che sistema hai?" });
    const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.content?.startsWith("Fatto:")), { what: "shell reply" });
    assert.equal(post.content, "Fatto: ran: uname -a");
    assert.match(readFileSync(docker.log, "utf8"), new RegExp(`exec -i -u agent .* cora-box-${marta.id} bash -lc uname -a`));
    await call(`/api/agents/${marta.id}`, { method: "PUT", body: { tools: false } });
  });

  test("falls back to plain bot messages when webhooks are not allowed", async () => {
    app.discord.webhooks.clear();
    discord.state.webhookAllowed = false;
    replies.set("Marta", () => ({ content: "Parlo come bot." }));
    discord.say({ content: "Marta, prova senza webhook" });
    const post = await waitFor(() => discord.state.botPosts.find((item) => item.content.includes("Parlo come bot.")), { what: "fallback post" });
    assert.equal(post.content, "**Marta** · Parlo come bot.");
    discord.state.webhookAllowed = true;
    app.discord.webhooks.clear();
  });

  test("memories: add, pin, share, edit, delete through the API", async () => {
    const added = await call(`/api/agents/${bea.id}/memories`, { method: "POST", body: { text: "Bea preferisce il tè" } });
    assert.equal(added.status, 201);
    const pinned = await call(`/api/agents/${bea.id}/memories/${added.data.id}`, { method: "PUT", body: { pinned: true, shared: true } });
    assert.equal(pinned.data.pinned, true);
    let list = await call(`/api/agents/${bea.id}/memories`);
    assert.ok(list.data.shared.some((memory) => memory.id === added.data.id));
    await call(`/api/agents/${bea.id}/memories/${added.data.id}`, { method: "PUT", body: { shared: false, text: "Bea preferisce il tè verde" } });
    list = await call(`/api/agents/${bea.id}/memories`);
    assert.ok(list.data.facts.some((memory) => memory.text === "Bea preferisce il tè verde" && memory.pinned));
    const removed = await call(`/api/agents/${bea.id}/memories/${added.data.id}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    const core = await call(`/api/agents/${bea.id}/core`, { method: "PUT", body: { text: "Sam è il capo." } });
    assert.equal(core.data.core, "Sam è il capo.");
  });

  test("relevant memories reach the agent, pinned ones always", async () => {
    app.store.addMemory(marta.id, "Il gatto di Sam si chiama Ugo", "manual");
    app.store.addMemory(marta.id, "Odia il caffè americano", "manual", { pinned: true });
    let prompt = "";
    replies.set("Marta", (body) => {
      prompt = lastUserText(body);
      return { content: "Ugo è il re di casa." };
    });
    discord.say({ content: "Marta, come sta il gatto?" });
    await waitFor(() => discord.state.webhookPosts.find((item) => item.content === "Ugo è il re di casa."), { what: "reply" });
    assert.match(prompt, /Il gatto di Sam si chiama Ugo/);
    assert.match(prompt, /Odia il caffè americano \(fissato\)/);
  });

  test("sleep consolidates memory: new facts, merged duplicates, core card, diary", async () => {
    const dup = app.store.addMemory(marta.id, "Sam ha un gatto", "agent");
    replies.set("Marta", (body) => {
      assert.match(lastUserText(body), /pizza margherita/);
      return {
        content: JSON.stringify({
          core: "Sam: ama la margherita, ha un gatto di nome Ugo. Bea è entusiasta.",
          add: [{ text: "Sam usa Discord per parlare con gli agenti", shared: false }],
          update: [],
          remove: [dup.id, "mem_not_mine"],
          diary: "Oggi ho conosciuto Bea e parlato di pizza.",
        }),
      };
    });
    const started = await call(`/api/agents/${marta.id}/sleep`, { method: "POST" });
    assert.equal(started.status, 202);
    const memories = await waitFor(async () => {
      const data = (await call(`/api/agents/${marta.id}/memories`)).data;
      return data.diary.length ? data : null;
    }, { what: "diary page" });
    assert.equal(memories.core, "Sam: ama la margherita, ha un gatto di nome Ugo. Bea è entusiasta.");
    assert.ok(memories.facts.some((memory) => memory.text === "Sam usa Discord per parlare con gli agenti" && memory.source === "sleep"));
    assert.ok(!memories.facts.some((memory) => memory.id === dup.id));
    assert.ok(memories.lastSleepAt);
    assert.ok(app.store.memories(SHARED).length >= 1);
  });

  test("an agent runs one task at a time: a routine landing on a busy agent is skipped, not run beside it", async () => {
    const created = await call("/api/agents", { method: "POST", body: { name: "Tosca", model: "ollama/test-model", chattiness: 0, tools: true, channelIds: [CHANNEL] } });
    assert.equal(created.status, 201);
    const slow = await call(`/api/agents/${created.data.id}/routines`, { method: "POST", body: { name: "Lunga", schedule: "0 9 * * *", channelId: CHANNEL, prompt: "Controlla tutto" } });
    const other = await call(`/api/agents/${created.data.id}/routines`, { method: "POST", body: { name: "Altra", schedule: "0 10 * * *", channelId: CHANNEL, prompt: "Controlla altro" } });
    assert.equal(slow.status, 201);
    assert.equal(other.status, 201);
    let running = 0;
    let together = 0;
    replies.set("Tosca", async () => {
      running += 1;
      together = Math.max(together, running);
      await sleep(1500);
      running -= 1;
      return { content: "Finito." };
    });
    // Both fire in the same instant, exactly as the scheduler did.
    const [first, second] = await Promise.all([
      call(`/api/routines/${slow.data.id}/run`, { method: "POST" }),
      call(`/api/routines/${other.data.id}/run`, { method: "POST" }),
    ]);
    assert.equal(first.status, 202);
    assert.equal(second.status, 202);
    await waitFor(() => discord.state.webhookPosts.some((item) => item.username === "Tosca" && item.content === "Finito."), { what: "the first routine finishing", timeout: 20000 });
    await quiet();
    assert.equal(together, 1, "never two sessions of the same agent at once");
    const routines = (await call("/api/state")).data.routines.filter((r) => r.agentId === created.data.id);
    assert.ok(routines.some((r) => r.lastStatus === "skipped"), "the one that landed on a busy agent says it was skipped");
    const skipped = routines.find((r) => r.lastStatus === "skipped");
    assert.match(skipped.lastOutput || "", /stava già lavorando/);
    await call(`/api/agents/${created.data.id}`, { method: "PUT", body: { enabled: false } });
  });

  test("what a turn spends is counted and served by day, for the heatmap", async () => {
    const created = await call("/api/agents", { method: "POST", body: { name: "Nuvola", model: "ollama/test-model", chattiness: 0, tools: false } });
    assert.equal(created.status, 201);
    replies.set("Nuvola", () => ({ content: "Eccomi." }));
    discord.say({ content: "Nuvola, ci sei?" });
    await waitFor(() => discord.state.webhookPosts.some((item) => item.username === "Nuvola" && item.content === "Eccomi."), { what: "Nuvola's answer" });
    await quiet();
    const [trace] = (await call(`/api/agents/${created.data.id}/traces`)).data;
    assert.equal(trace.tokensIn, 120, "the input tokens of the call are kept");
    assert.equal(trace.tokensOut, 30);
    const usage = await call("/api/usage");
    assert.equal(usage.status, 200);
    assert.match(usage.data.today, /^\d{4}-\d{2}-\d{2}$/);
    const mine = usage.data.usage.find((row) => row.agentId === created.data.id);
    assert.ok(mine, "the agent has a day of its own");
    assert.equal(mine.day, usage.data.today);
    assert.equal(mine.tokensIn, 120);
    assert.equal(mine.tokensOut, 30);
    assert.equal(mine.turns, 1);
    await call(`/api/agents/${created.data.id}`, { method: "PUT", body: { enabled: false } });
  });

  test("a routine says what it is going to check before it starts working", async () => {
    const created = await call("/api/agents", { method: "POST", body: { name: "Lina", model: "ollama/test-model", chattiness: 0, tools: true, channelIds: [CHANNEL] } });
    assert.equal(created.status, 201);
    const routine = await call(`/api/agents/${created.data.id}/routines`, { method: "POST", body: { name: "Coda social", schedule: "0 9 * * *", channelId: CHANNEL, prompt: "Controlla la coda dei post e i follower" } });
    assert.equal(routine.status, 201);
    let brief = "";
    let calls = 0;
    replies.set("Lina", (body) => {
      calls += 1;
      if (calls === 1) {
        brief = lastUserText(body);
        return { tool_calls: [{ function: { name: "say", arguments: { text: "Routine «Coda social»: guardo la coda dei post e poi i follower." } } }] };
      }
      return { content: "Coda vuota, follower stabili." };
    });
    assert.equal((await call(`/api/routines/${routine.data.id}/run`, { method: "POST" })).status, 202);
    await waitFor(() => discord.state.webhookPosts.some((item) => item.username === "Lina" && item.content === "Coda vuota, follower stabili."), { what: "the routine result", timeout: 20000 });
    await quiet();
    // The owner is told what is being checked, not just that something is happening.
    assert.match(brief, /manda con say una riga che dice quale routine è partita e cosa vai a controllare/);
    assert.match(brief, /non basta "ci guardo"/);
    const said = discord.state.webhookPosts.filter((item) => item.username === "Lina").map((item) => item.content);
    assert.ok(said.indexOf("Routine «Coda social»: guardo la coda dei post e poi i follower.") < said.indexOf("Coda vuota, follower stabili."), "the briefing comes before the result");
    await call(`/api/agents/${created.data.id}`, { method: "PUT", body: { enabled: false } });
  });

  test("a routine runs on demand and posts in its channel", async () => {
    const bad = await call(`/api/agents/${bea.id}/routines`, { method: "POST", body: { name: "x", schedule: "61 * * * *", channelId: CHANNEL, prompt: "x" } });
    assert.equal(bad.status, 400);
    const created = await call(`/api/agents/${bea.id}/routines`, { method: "POST", body: { name: "Buongiorno", schedule: "0 9 * * *", channelId: CHANNEL, prompt: "Saluta tutti" } });
    assert.equal(created.status, 201);
    assert.ok(created.data.nextRunAt);
    replies.set("Bea", (body) => {
      assert.match(lastUserText(body), /routine "Buongiorno"/);
      return { content: "Buongiorno a tutti!" };
    });
    const run = await call(`/api/routines/${created.data.id}/run`, { method: "POST" });
    assert.equal(run.status, 202);
    await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Bea" && item.content === "Buongiorno a tutti!"), { what: "routine post" });
    const state = await waitFor(async () => {
      const data = (await call("/api/state")).data;
      return data.routines.find((routine) => routine.id === created.data.id && routine.lastStatus === "posted") ? data : null;
    }, { what: "routine status" });
    assert.ok(state);
  });

  test("Claude Code follows the thread's current goal under Cora's verifier", async (t) => {
    await call("/api/settings", { method: "PUT", body: { goalMode: true } });
    t.after(() => call("/api/settings", { method: "PUT", body: { goalMode: false } }));
    const created = await call("/api/agents", { method: "POST", body: { name: "Nora", model: "claude/claude-sonnet-5-5", subscriptionId: subscriptionIds.claude, chattiness: 0, tools: true } });
    assert.equal(created.status, 201);
    const goal = "la pagina è online e risponde 200";
    goals = () => goal;
    let judged = false;
    checks = () => { judged = true; return JSON.stringify({ met: true, reason: "" }); };
    const before = cli.calls().length;
    cli.set({ reply: "Online, risponde 200." });
    discord.say({ content: "Nora, pubblica la pagina e controlla che risponda" });
    await waitFor(() => discord.state.webhookPosts.some((item) => item.username === "Nora" && item.content.startsWith("Online, risponde 200.")), { what: "Nora's answer" });
    await quiet();
    const run = cli.calls().slice(before).find((item) => item.flavor === "claude");
    assert.ok(!run.argv.includes("--input-format"), "no separate native goal can outlive the thread's current goal");
    assert.match(run.stdin, /Nora, pubblica la pagina e controlla che risponda/, "the task keeps all its context");
    assert.ok(run.stdin.includes(`[Obiettivo] Questa è l'unica condizione attuale; sostituisce gli obiettivi precedenti: ${goal}`));
    assert.equal(cli.calls().slice(before).filter((item) => item.flavor === "claude").length, 1, "one session, not one run per round");
    assert.ok(judged, "the same verifier controls every provider");
    await call(`/api/agents/${created.data.id}`, { method: "PUT", body: { enabled: false } });
  });

  test("a model at capacity is tried again on its own, and the owner only sees the answer", async () => {
    const created = await call("/api/agents", { method: "POST", body: { name: "Rea", model: "codex/gpt-6-sol", subscriptionId: subscriptionIds.codex, chattiness: 0, tools: false } });
    assert.equal(created.status, 201);
    const before = cli.calls().length;
    // The first run fails the way Codex does when the model is busy; the second works.
    cli.set({ reply: "Eccomi, tutto a posto.", failFirst: cli.calls().filter((item) => item.flavor === "codex").length + 1 });
    discord.say({ content: "Rea, ci sei?" });
    const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Rea"), { what: "Rea's answer", timeout: 30000 });
    assert.equal(post.content, "Eccomi, tutto a posto.");
    assert.ok(!/capacity|non riesco a rispondere/i.test(post.content), "the passing failure never reaches the chat");
    const runs = cli.calls().slice(before).filter((item) => item.flavor === "codex");
    assert.ok(runs.length >= 2, `tried again by itself (${runs.length} runs)`);
    assert.equal(runs[0].failed, true);
    await quiet();
    cli.set({ reply: "ok" });
    await call(`/api/agents/${created.data.id}`, { method: "PUT", body: { enabled: false } });
  });

  test("when the Codex CLI dies after the agent has answered, the answer is kept and no JSON is reported", async () => {
    const created = await call("/api/agents", { method: "POST", body: { name: "Gaia", model: "codex/gpt-6-sol", subscriptionId: subscriptionIds.codex, chattiness: 0, tools: false } });
    assert.equal(created.status, 201);
    cli.set({ reply: "Ho finito: tutto a posto.", crash: true });
    discord.say({ content: "Gaia, com'è andata?" });
    const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Gaia"), { what: "Gaia's answer" });
    assert.equal(post.content, "Ho finito: tutto a posto.", "the answer survives the crash");
    assert.ok(!/item\.completed|mcp_tool_call|\{"type"/.test(post.content), "never the raw event stream");
    await quiet();
    cli.set({ reply: "ok" });
    await call(`/api/agents/${created.data.id}`, { method: "PUT", body: { enabled: false } });
  });

  test("an agent on Claude Code (subscription) uses cora's memory tools over MCP", async () => {
    const created = await call("/api/agents", { method: "POST", body: { name: "Clara", model: "claude/claude-sonnet-5-5", subscriptionId: subscriptionIds.claude, chattiness: 0, tools: false } });
    assert.equal(created.status, 201);
    cli.set({ tool: "remember", args: { fact: "Il colore preferito di Sam è il verde" }, reply: "Me lo segno." });
    process.env.CORA_BOT_LEAK = "not-for-the-cli";
    discord.say({ content: "Clara, il mio colore preferito è il verde" });
    const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Clara"), { what: "Clara's reply" });
    delete process.env.CORA_BOT_LEAK;
    assert.match(post.content, /^Me lo segno\. \[saved \[mem_/);
    // Other agents run Claude Code too, and the tests share the log: take Clara's own run.
    const run = cli.calls().find((item) => item.flavor === "claude" && /^Sei Clara\./.test(item.argv[item.argv.indexOf("--system-prompt") + 1] || ""));
    assert.equal(run.argv[run.argv.indexOf("--model") + 1], "claude-sonnet-5-5");
    assert.equal(run.argv[run.argv.indexOf("--tools") + 1], "", "Claude Code's own tools are off");
    assert.ok(run.argv.includes("--no-session-persistence"));
    assert.deepEqual(run.secretEnv, [], "no bot token reaches the CLI");
    assert.match(run.argv[run.argv.indexOf("--system-prompt") + 1], /^Sei Clara\./);
    assert.match(run.argv[run.argv.indexOf("--system-prompt") + 1], /<istruzioni_personali>\n# Global Agent Instructions\nISTRUZIONI DI PROVA/);
    // Its own routines travel with it: they are the agent's own, not the owner's computer.
    assert.deepEqual(run.argv[run.argv.indexOf("--allowedTools") + 1].split(","), ["mcp__cora__say", "mcp__cora__remember", "mcp__cora__forget", "mcp__cora__recall", "mcp__cora__update_core", "mcp__cora__list_routines", "mcp__cora__set_routine", "mcp__cora__delete_routine", "mcp__cora__notify", "mcp__cora__ask_owner"]);
    assert.ok(run.tools.includes("recall") && !run.tools.includes("shell"));
    assert.match(run.stdin, /Clara, il mio colore preferito è il verde/);
    const memories = await call(`/api/agents/${created.data.id}/memories`);
    assert.ok(memories.data.facts.some((memory) => memory.text === "Il colore preferito di Sam è il verde"));
    assert.ok(!readdirSync(join(home, "cli-work")).some((name) => name.startsWith("mcp-")), "the MCP config with the run token is deleted");
    assert.ok(run.argv.includes("stream-json") && run.argv.includes("--verbose"), "Claude Code streams its steps");
    const [summary] = (await call(`/api/agents/${created.data.id}/traces`)).data;
    const trace = (await call(`/api/traces/${summary.id}`)).data;
    assert.equal(trace.status, "done");
    assert.match(trace.system, /^Sei Clara\./);
    assert.match(trace.prompt, /Clara, il mio colore preferito è il verde/);
    assert.ok(trace.steps.some((step) => step.type === "thinking" && step.hidden), "Claude's hidden thinking is marked, not invented");
    assert.ok(trace.steps.some((step) => step.type === "text" && step.text === "Prima controllo."), "text between tool calls is kept");
    const tool = trace.steps.find((step) => step.type === "tool");
    assert.equal(tool.name, "remember");
    assert.equal(tool.args.fact, "Il colore preferito di Sam è il verde");
    assert.match(tool.result, /^saved \[mem_/);
    assert.equal(trace.steps.filter((step) => step.type === "text").length, 1, "the answer is not repeated as a step");
    assert.match(trace.output, /^Me lo segno\./);
    await call(`/api/agents/${created.data.id}`, { method: "DELETE" });
  });

  test("an agent on Codex (ChatGPT subscription) gets cora's desktop tools from the owner, never Codex's shell", async () => {
    const created = await call("/api/agents", { method: "POST", body: { name: "Gino", model: "codex/gpt-6-sol", subscriptionId: subscriptionIds.codex, chattiness: 0, tools: true } });
    cli.set({ tool: "shell", args: { command: "date" }, reply: "Ecco la data.", thinking: "**Controllo l'ora** sul mio computer con date." });
    discord.say({ content: "Gino, che ore sono sul tuo computer?" });
    const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Gino"), { what: "Gino's reply" });
    assert.match(post.content, /^Ecco la data\. \[\[exit 0\]/);
    // Other agents run Codex too, and the tests share the log: take Gino's own completed run.
    const run = cli.calls().find((item) => item.flavor === "codex" && !item.failed && /Sei Gino\./.test(item.stdin || ""));
    assert.match(run.stdin, /ISTRUZIONI DI PROVA/);
    for (const feature of ["shell_tool", "unified_exec", "computer_use", "browser_use", "multi_agent"]) {
      assert.ok(run.argv.some((arg, index) => arg === feature && run.argv[index - 1] === "--disable"), `${feature} is disabled`);
    }
    assert.equal(run.argv[run.argv.indexOf("-m") + 1], "gpt-6-sol");
    assert.ok(run.argv.includes("--ephemeral") && run.argv.includes("read-only"));
    assert.ok(run.argv.includes("mcp_servers.cora.default_tools_approval_mode=\"approve\""), "cora's tools run without an approval prompt");
    assert.ok(run.tools.includes("shell") && run.tools.includes("screenshot"));
    assert.match(run.stdin, /<istruzioni_di_sistema>\nSei Gino\./);
    assert.match(readFileSync(docker.log, "utf8"), new RegExp(`cora-box-${created.data.id} bash -lc date`));
    assert.ok(run.argv.includes("--json") && run.argv.includes("model_reasoning_summary=\"detailed\""), "Codex streams its reasoning summary");
    const [summary] = (await call(`/api/agents/${created.data.id}/traces`)).data;
    const trace = (await call(`/api/traces/${summary.id}`)).data;
    assert.ok(trace.steps.some((step) => step.type === "thinking" && step.text === "**Controllo l'ora** sul mio computer con date."));
    assert.ok(trace.steps.some((step) => step.type === "tool" && step.name === "shell" && step.args.command === "date"));
    assert.deepEqual(summary.tools, ["shell"]);
    await call(`/api/agents/${created.data.id}`, { method: "DELETE" });
  });

  test("a tool call with an unknown run token is refused by the bridge", async () => {
    const response = await fetch(`${app.bridge.url}/tools/call`, { method: "POST", headers: { Authorization: "Bearer nope" }, body: "{}" });
    assert.equal(response.status, 401);
  });

  test("an agent with its own bot token talks as its own Discord user and answers @mentions", async () => {
    const PIA = "600000000000000001";
    botTokens.CORA_BOT_PIA = "pia-token";
    discord.state.botUsers.set("pia-token", { id: PIA, username: "pia-old" });
    const created = await call("/api/agents", { method: "POST", body: { name: "Pia", model: "ollama/test-model", chattiness: 0, tools: false } });
    await waitFor(() => app.bots.client(created.data.id), { what: "Pia's bot online" });
    await waitFor(() => discord.state.profilePatches.some((patch) => patch.token === "pia-token" && patch.username === "Pia"), { what: "profile sync" });
    let prompt = "";
    replies.set("Pia", (body) => {
      prompt = lastUserText(body);
      return { content: "Eccomi, sono Pia." };
    });
    discord.say({ content: `<@${PIA}> ci sei?`, mentions: [{ id: PIA, username: "Pia" }] });
    const post = await waitFor(() => discord.state.botPosts.find((item) => item.token === "pia-token"), { what: "Pia's own post" });
    assert.equal(post.content, "Eccomi, sono Pia.");
    assert.match(prompt, /Sam ★: @Pia ci sei\?/);
    assert.ok(!discord.state.webhookPosts.some((item) => item.username === "Pia"), "no webhook when the agent has its own bot");
    await sleep(3000);
    assert.equal(discord.state.botPosts.filter((item) => item.token === "pia-token").length, 1, "its own echo does not start a new round");
    const agent = await call(`/api/agents/${created.data.id}`);
    assert.equal(agent.data.bot.env, "CORA_BOT_PIA");
    assert.equal(agent.data.bot.user.id, PIA);
    assert.equal(agent.data.bot.inGuild, true);
    assert.match(agent.data.bot.inviteUrl, new RegExp(`client_id=${PIA}&scope=bot&permissions=\\d+&guild_id=`));
    delete botTokens.CORA_BOT_PIA;
    await call(`/api/agents/${created.data.id}`, { method: "DELETE" });
    assert.equal(app.bots.client(created.data.id), null);
  });

  test("a bot token pasted in the panel is checked with Discord, stored in hush and connected at once", async () => {
    const LIA = "600000000000000002";
    const token = (tail) => `MTQ2NzEyMzQ1Njc4OTAxMjM0NQ.Gabcde.${tail.padEnd(27, "x")}`;
    discord.state.botUsers.set(token("lia"), { id: LIA, username: "lia-app" });
    discord.state.botUsers.set(token("human"), { id: "600000000000000003", username: "persona", bot: false });
    discord.state.botUsers.set(token("main"), { id: BOT, username: "GROG" });
    const lia = await call("/api/agents", { method: "POST", body: { name: "Lia", model: "ollama/test-model", chattiness: 0, tools: false } });
    const other = await call("/api/agents", { method: "POST", body: { name: "Leo", model: "ollama/test-model", chattiness: 0, tools: false } });
    const paste = (agent, value) => call(`/api/agents/${agent.data.id}/bot`, { method: "PUT", body: { token: value } });

    assert.match((await paste(lia, "ciao")).data.error, /non sembra un token/);
    assert.match((await paste(lia, token("unknown"))).data.error, /Discord rifiuta/);
    assert.match((await paste(lia, token("human"))).data.error, /non è di un bot/);
    const main = await paste(lia, token("main"));
    assert.equal(main.status, 400);
    assert.match(main.data.error, /bot principale/);
    assert.deepEqual(hushVault, {}, "nothing is stored until Discord accepts the token");

    const saved = await paste(lia, ` Bot ${token("lia")} `);
    assert.equal(saved.status, 200);
    assert.equal(hushVault.CORA_BOT_LIA, token("lia"));
    assert.equal(saved.data.bot.user.id, LIA);
    assert.equal(saved.data.bot.inGuild, true);
    assert.equal(JSON.stringify(saved.data).includes(token("lia")), false, "the token never comes back");
    await waitFor(() => discord.state.profilePatches.some((patch) => patch.token === token("lia") && patch.username === "Lia"), { what: "profile sync" });

    const taken = await paste(other, token("lia"));
    assert.equal(taken.status, 400);
    assert.match(taken.data.error, /già collegato a un altro agente/);
    assert.equal(hushVault.CORA_BOT_LEO, undefined);

    await call(`/api/agents/${lia.data.id}`, { method: "DELETE" });
    await call(`/api/agents/${other.data.id}`, { method: "DELETE" });
    assert.equal(app.bots.client(lia.data.id), null);
  });

  test("the owner talks to one agent from the panel and can read why it answered", async () => {
    const created = await call("/api/agents", { method: "POST", body: { name: "Vale", model: "ollama/test-model", chattiness: 0, tools: false } });
    const room = `web-${created.data.id}`;
    replies.set("Vale", (body) => {
      if (!body.messages.some((message) => message.role === "tool")) {
        return { thinking: "Mi chiede del colore: controllo nei ricordi.", tool_calls: [{ function: { name: "recall", arguments: { query: "colore preferito" } } }] };
      }
      return { thinking: "Trovato, rispondo.", content: "Il verde, me lo ricordo." };
    });
    const sent = await call(`/api/rooms/${room}/messages`, { method: "POST", body: { text: "Qual è il mio colore preferito?" } });
    assert.equal(sent.status, 201);
    assert.equal(sent.data.kind, "owner");
    const reply = await waitFor(async () => (await call(`/api/rooms/${room}/messages`)).data.messages.find((item) => item.agentId === created.data.id), { what: "Vale's reply in the panel" });
    assert.equal(reply.content, "Il verde, me lo ricordo.");
    assert.ok(!discord.state.webhookPosts.some((post) => post.username === "Vale") && !discord.state.botPosts.some((post) => post.content.includes("verde")), "panel chats stay off Discord");

    const trace = (await call(`/api/traces/${reply.traceId}`)).data;
    assert.equal(trace.kind, "chat");
    assert.equal(trace.channelId, room);
    assert.equal(trace.status, "done");
    assert.match(trace.prompt, /Qual è il mio colore preferito\?/);
    assert.match(trace.prompt, /Ultimi messaggi nella chat privata del pannello \(ci siete solo tu e il proprietario/);
    assert.deepEqual(trace.steps.map((step) => step.type), ["thinking", "tool", "thinking"]);
    assert.equal(trace.steps[0].text, "Mi chiede del colore: controllo nei ricordi.");
    assert.deepEqual([trace.steps[1].name, trace.steps[1].args.query, trace.steps[1].ok], ["recall", "colore preferito", true]);
    assert.equal(trace.output, "Il verde, me lo ricordo.");
    assert.equal((await call(`/api/agents/${created.data.id}/traces`)).data[0].id, trace.id);
    assert.ok(app.brain.channelIdsFor(app.store.agent(created.data.id)).includes(room), "the private chat is part of its memory");

    assert.equal((await call(`/api/rooms/${room}/messages`, { method: "POST", body: { text: "  " } })).status, 400);
    assert.equal((await call("/api/rooms/web-nobody/messages")).status, 404);
    assert.equal((await call("/api/traces/tr_0000")).status, 404);
    await call(`/api/agents/${created.data.id}`, { method: "DELETE" });
  });

  test("in the salotto the agent called by name answers, live on the panel's event stream", async () => {
    const created = await call("/api/agents", { method: "POST", body: { name: "Ugo", model: "ollama/test-model", chattiness: 0, tools: false } });
    replies.set("Ugo", () => ({ content: "Ciao dal salotto!" }));
    const abort = new AbortController();
    const stream = await fetch(`${base}/api/events`, { headers: { Cookie: cookie }, signal: abort.signal });
    let events = "";
    const reading = (async () => {
      const decoder = new TextDecoder();
      try { for await (const chunk of stream.body) events += decoder.decode(chunk, { stream: true }); } catch {}
    })();
    const sent = await call("/api/rooms/web/messages", { method: "POST", body: { text: "Ugo, ci sei?" } });
    assert.equal(sent.status, 201);
    const reply = await waitFor(async () => (await call("/api/rooms/web/messages")).data.messages.find((item) => item.agentId === created.data.id), { what: "Ugo's reply" });
    assert.equal(reply.content, "Ciao dal salotto!");
    await waitFor(() => events.includes("Ciao dal salotto!"), { what: "the reply on the event stream" });
    const parsed = events.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
    assert.ok(parsed.some((event) => event.type === "web-message" && event.room === "web" && event.item.content === "Ugo, ci sei?"));
    assert.ok(parsed.some((event) => event.type === "trace" && event.event === "start" && event.trace.agentId === created.data.id && event.trace.channelId === "web"));
    assert.ok(parsed.some((event) => event.type === "trace" && event.event === "end" && event.trace.id === reply.traceId && event.trace.status === "done"));
    const trace = (await call(`/api/traces/${reply.traceId}`)).data;
    assert.match(trace.prompt, /Ultimi messaggi nel salotto del pannello/);
    assert.match(trace.system, /^Sei Ugo\./, "the shared system prompt comes back with the trace");
    abort.abort();
    await reading;
    await quiet();
    await call(`/api/agents/${created.data.id}`, { method: "DELETE" });
  });

  test("desktops get SSH on a fixed port with the host's plain keys, Tailscale SSH after a login link, and upgrades that keep the volumes", async () => {
    const { rmSync } = await import("node:fs");
    const phone = `ssh-ed25519 ${"C".repeat(68)} telefono`;
    const saved = await call("/api/settings", { method: "PUT", body: { sshKeys: [phone, "not a key"] } });
    assert.deepEqual(saved.data.sshKeys, [phone]);
    writeFileSync(join(docker.dir, "inspect"), "MISSING");
    const created = await call("/api/agents", { method: "POST", body: { name: "Sara", model: "ollama/test-model", chattiness: 0, tools: true } });
    const agent = await waitFor(() => app.store.agent(created.data.id)?.sshPort && app.store.agent(created.data.id), { what: "an SSH port" });
    const runs = () => readFileSync(docker.log, "utf8").split("\n").filter((line) => line.startsWith(`run -d --name cora-box-${agent.id} `));
    await waitFor(() => runs().length === 1, { what: "the box to be created" });
    assert.match(runs()[0], new RegExp(`-p 127\\.0\\.0\\.1:${agent.sshPort}:22 `));
    assert.match(runs()[0], new RegExp(`-v cora-home-${agent.id}:/home/agent -v cora-sys-${agent.id}:/var/lib/cora `));
    const keys = await waitFor(() => { try { return readFileSync(join(docker.dir, "authorized_keys"), "utf8"); } catch { return ""; } }, { what: "authorized keys" });
    assert.match(keys, /seb@laptop/);
    assert.match(keys, /telefono/);
    assert.doesNotMatch(keys, /gate@server/, "keys with options (restricted ones) are never copied");

    rmSync(join(docker.dir, "inspect"));
    const access = await call(`/api/agents/${agent.id}/box/access`);
    assert.equal(access.data.ssh.command, "ssh -J sam@host -p 2201 agent@127.0.0.1");
    assert.equal(access.data.tailscale.state, "NeedsLogin");
    const connect = await call(`/api/agents/${agent.id}/box/tailscale`, { method: "POST" });
    assert.equal(connect.data.authUrl, "https://login.tailscale.com/a/test");
    assert.match(readFileSync(docker.log, "utf8"), new RegExp(`exec -i -u root .*cora-box-${agent.id} tailscale up --ssh --hostname=sara --accept-dns=false`));
    writeFileSync(join(docker.dir, "tailscale.json"), JSON.stringify({ BackendState: "Running", Self: { HostName: "sara", DNSName: "sara.tail1234.ts.net.", TailscaleIPs: ["100.64.0.9"], Online: true } }));
    const running = await call(`/api/agents/${agent.id}/box/tailscale`, { method: "POST" });
    assert.deepEqual([running.data.state, running.data.host, running.data.dnsName], ["Running", "sara", "sara.tail1234.ts.net"]);
    assert.match(readFileSync(docker.log, "utf8"), new RegExp(`cora-box-${agent.id} tailscale set --ssh --hostname=sara`));

    writeFileSync(join(docker.dir, "inspect"), '{"Running":true,"Status":"running"}\t{"22/tcp":[{"HostPort":"2201"}]}\tsha256:old\t/home/agent,/var/lib/cora,\n');
    app.boxes.imageCache.at = 0;
    assert.equal((await call(`/api/agents/${agent.id}`)).data.box.outdated, true);
    await app.boxes.ensure(app.store.agent(agent.id));
    assert.equal(runs().length, 1, "a running box is not recreated behind the agent's back");
    const upgraded = await call(`/api/agents/${agent.id}/box/upgrade`, { method: "POST" });
    assert.equal(upgraded.status, 200);
    assert.equal(runs().length, 2, "the upgrade recreates the box from the new image");
    assert.match(readFileSync(docker.log, "utf8"), new RegExp(`rm -f cora-box-${agent.id}\n`));
    assert.doesNotMatch(readFileSync(docker.log, "utf8"), new RegExp(`volume rm .*${agent.id}`), "volumes are kept");

    rmSync(join(docker.dir, "inspect"));
    rmSync(join(docker.dir, "tailscale.json"));
    await call("/api/settings", { method: "PUT", body: { sshKeys: [] } });
    await call(`/api/agents/${agent.id}`, { method: "DELETE" });
  });

  test("the desktop proxy needs a session", async () => {
    const response = await fetch(`${base}/box/${marta.id}/vnc.html`);
    assert.equal(response.status, 401);
  });

  test("deleting an agent removes its desktop container", async () => {
    const removed = await call(`/api/agents/${bea.id}`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    assert.match(readFileSync(docker.log, "utf8"), new RegExp(`rm -f cora-box-${bea.id}`));
    const state = await call("/api/state");
    assert.ok(!state.data.agents.some((agent) => agent.id === bea.id));
    assert.ok(!state.data.routines.some((routine) => routine.agentId === bea.id));
  });
});

/** A phone for Web Push: its own key pair, and a push service that keeps what it receives. */
async function fakePhone() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const received = [];
  let status = 201;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(status);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const decrypt = ({ body }) => {
    const salt = body.subarray(0, 16);
    const sender = body.subarray(21, 21 + body[20]);
    const shared = ecdh.computeSecret(sender);
    const ikm = Buffer.from(hkdfSync("sha256", shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), sender]), 32));
    const key = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
    const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
    const data = body.subarray(21 + body[20]);
    const decipher = createDecipheriv("aes-128-gcm", key, nonce);
    decipher.setAuthTag(data.subarray(data.length - 16));
    const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
    assert.equal(plain[plain.length - 1], 2, "last record delimiter");
    return JSON.parse(plain.subarray(0, plain.length - 1).toString("utf8"));
  };
  const vapidValid = ({ headers }) => {
    const [, jwt, key] = /^vapid t=([^,]+), k=(\S+)$/.exec(headers.authorization);
    const [head, claims, signature] = jwt.split(".");
    const raw = Buffer.from(key, "base64url");
    const publicKey = createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") } });
    const payload = JSON.parse(Buffer.from(claims, "base64url").toString("utf8"));
    return verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")) && payload.aud === `http://127.0.0.1:${server.address().port}` ? payload : null;
  };
  return {
    subscription: { endpoint: `http://127.0.0.1:${server.address().port}/push/phone`, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } },
    received, decrypt, vapidValid,
    gone() { status = 410; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

describe("talking with the agents", () => {
  const posts = (name) => discord.state.webhookPosts.filter((item) => item.username === name).map((item) => item.content);
  let olga;
  let pino;

  before(async () => {
    olga = (await call("/api/agents", { method: "POST", body: { name: "Olga", model: "ollama/test-model", chattiness: 1, tools: true, channelIds: [CHANNEL] } })).data;
    pino = (await call("/api/agents", { method: "POST", body: { name: "Pino", model: "ollama/test-model", chattiness: 1, tools: false, channelIds: [CHANNEL] } })).data;
    for (const agent of app.store.agents()) {
      if (![olga.id, pino.id].includes(agent.id) && agent.enabled) await call(`/api/agents/${agent.id}`, { method: "PUT", body: { enabled: false } });
    }
  });

  test("a message that names nobody gets one answer, not a chorus", async () => {
    replies.set("Olga", () => ({ content: "Dico la mia." }));
    replies.set("Pino", () => ({ content: "Dico la mia anche io." }));
    const before = posts("Olga").length + posts("Pino").length;
    // Both are as chatty as can be and both are in the channel: still, one voice answers.
    for (let round = 0; round < 4; round += 1) {
      discord.say({ content: `ragazzi, che si fa oggi? (${round})` });
      await sleep(1800);
      await quiet();
    }
    const after = posts("Olga").length + posts("Pino").length;
    assert.equal(after - before, 4, "four messages, four answers, never two voices on the same one");
  });

  test("in a thread agents stay out unless summoned by name", async () => {
    const THREAD = "1599000000000000701";
    discord.dispatch("THREAD_CREATE", { id: THREAD, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "triage" });
    await sleep(120);
    replies.set("Olga", () => ({ content: "Nel thread ci sono." }));
    replies.set("Pino", () => ({ content: "Anche io!" }));
    // Nobody named: no agent works in the thread.
    discord.say({ content: "qualcuno sa come si risolve?", channel: THREAD });
    await sleep(2500);
    await quiet();
    assert.deepEqual(posts("Olga"), [], "Olga stays out of the thread uncalled");
    assert.deepEqual(posts("Pino"), [], "Pino too, even though he is chatty");
    // Named: only that agent answers, in the thread.
    discord.say({ content: "Olga, ci pensi tu?", channel: THREAD });
    const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Olga" && item.content === "Nel thread ci sono."), { what: "Olga summoned in the thread" });
    assert.equal(post.channelId, THREAD, "the answer lands in the thread");
    await quiet();
    assert.deepEqual(posts("Pino"), []);
  });

  test("only the agent you name answers, a follow-up without names goes to it again, and a mention of someone else keeps them quiet", async () => {
    replies.set("Olga", () => ({ content: "Sono Olga, dimmi." }));
    replies.set("Pino", () => ({ content: "Anche io!" }));
    discord.say({ content: "Olga, ci sei?" });
    await waitFor(() => posts("Olga").length === 1, { what: "Olga" });
    discord.say({ content: "allora ascolta" });
    await waitFor(() => posts("Olga").length === 2, { what: "Olga again" });
    await quiet();
    assert.deepEqual(posts("Pino"), [], "Pino stays out even though he is chatty");

    discord.say({ content: "<@700000000000000001> ci sei?", mentions: [{ id: "700000000000000001", username: "GROG" }] });
    await sleep(2500);
    await quiet();
    assert.equal(posts("Olga").length, 2);
    assert.deepEqual(posts("Pino"), []);

    discord.say({ content: "", type: 7, author: "700000000000000002", username: "NuovoBot", bot: true });
    await sleep(1500);
    assert.equal((await call(`/api/rooms/web/messages`)).status, 200);
    assert.ok(!app.store.recentMessages(CHANNEL, 10).some((item) => item.content === "(messaggio vuoto)"), "system messages are not archived");
  });

  test("in a live conversation an agent does not keep saying it is on it", async (t) => {
    app.orchestrator.ackAfterMs = 300;
    t.after(() => { app.orchestrator.ackAfterMs = 15000; });
    const ack = "Ricevuto, ci lavoro: ti aggiorno qui.";
    let turn = 0;
    replies.set("Olga", async () => {
      turn += 1;
      if (turn === 1) return { content: "Eccomi, dimmi." };
      await sleep(900);
      return { content: "Fatto, guardato." };
    });
    // It answers at once, so nobody needs telling it is there.
    discord.say({ content: "Olga, ci sei?" });
    await waitFor(() => posts("Olga").includes("Eccomi, dimmi."), { what: "Olga's quick answer" });
    await quiet();
    // The next request takes longer, but the conversation is live: no second "ricevuto".
    discord.say({ content: "Olga, allora guarda quella cosa" });
    await waitFor(() => posts("Olga").includes("Fatto, guardato."), { what: "Olga's slower answer", timeout: 20000 });
    await quiet();
    assert.ok(!posts("Olga").includes(ack), "it never repeats the acknowledgement to someone it is already talking to");
  });

  test("a busy agent says it is on it, gets the new messages while it works, and a named agent that passes is asked again", async () => {
    app.orchestrator.ackAfterMs = 300;
    // The acknowledgement is for silence; this test is about a busy agent, so allow it either way.
    app.orchestrator.ackQuietMs = 0;
    let steered = "";
    replies.set("Olga", async (body) => {
      const last = body.messages[body.messages.length - 1];
      if (last.role !== "tool") {
        discord.say({ content: "Olga, anzi controlla anche la cucina" });
        await sleep(1600);
        return { tool_calls: [{ function: { name: "recall", arguments: { query: "cucina" } } }] };
      }
      steered = last.content;
      return { content: "Fatto: ho controllato anche la cucina." };
    });
    discord.say({ content: "Olga, controlla il salotto" });
    await waitFor(() => posts("Olga").includes("Fatto: ho controllato anche la cucina."), { what: "the steered answer", timeout: 20000 });
    assert.match(steered, /\[Nel frattempo nella chat\][\s\S]*controlla anche la cucina/);
    assert.ok(posts("Olga").includes("Ricevuto, ci lavoro: ti aggiorno qui."), "the automatic acknowledgement came first");
    await quiet();
    app.orchestrator.ackAfterMs = 15000;
    app.orchestrator.ackQuietMs = 5 * 60 * 1000;

    let asked = 0;
    replies.set("Pino", (body) => {
      asked += 1;
      return /Hai risposto PASS/.test(lastUserText(body)) ? { content: "Scusa, eccomi." } : { content: "PASS" };
    });
    discord.say({ content: "Pino, ci sei?" });
    await waitFor(() => posts("Pino").includes("Scusa, eccomi."), { what: "Pino after the retry" });
    assert.equal(asked, 2);
    await quiet();
  });

  test("agents post along the way with say, and create, list and delete their own routines when the owner asks", async () => {
    let step = 0;
    replies.set("Olga", () => {
      step += 1;
      if (step === 1) return { tool_calls: [{ function: { name: "say", arguments: { text: "Ci guardo." } } }] };
      if (step === 2) return { tool_calls: [{ function: { name: "set_routine", arguments: { name: "Buongiorno", schedule: "0 9 * * 1-5", prompt: "Saluta tutti." } } }] };
      if (step === 3) return { tool_calls: [{ function: { name: "set_routine", arguments: { name: "Rotta", schedule: "99 * * * *", prompt: "x" } } }] };
      if (step === 4) return { tool_calls: [{ function: { name: "list_routines", arguments: {} } }] };
      return { content: "Routine creata." };
    });
    discord.say({ content: "Olga, fammi una routine di buongiorno nei giorni feriali alle 9" });
    await waitFor(() => posts("Olga").includes("Routine creata."), { what: "the routine reply" });
    assert.ok(posts("Olga").indexOf("Ci guardo.") < posts("Olga").indexOf("Routine creata."));
    const routines = app.store.routines(olga.id);
    assert.deepEqual(routines.map((routine) => [routine.name, routine.schedule, routine.channelId]), [["Buongiorno", "0 9 * * 1-5", CHANNEL]]);
    const [trace] = (await call(`/api/agents/${olga.id}/traces`)).data;
    const full = (await call(`/api/traces/${trace.id}`)).data;
    assert.match(full.steps.find((item) => item.name === "set_routine" && item.args.schedule === "99 * * * *").result, /^error: schedule/);
    assert.match(full.steps.find((item) => item.name === "list_routines").result, /Buongiorno · 0 9 \* \* 1-5/);
    await quiet();
  });

  test("what the owner says on the panel reaches the agent on Discord too: one conversation, two places", async () => {
    replies.set("Olga", () => ({ content: "Segnato." }));
    const room = `web-${olga.id}`;
    await call(`/api/rooms/${room}/messages`, { method: "POST", body: { text: "Il codice del cancello è 4721" } });
    await waitFor(async () => (await call(`/api/rooms/${room}/messages`)).data.messages.some((item) => item.content === "Segnato."), { what: "Olga on the panel" });
    await quiet();
    let prompt = "";
    replies.set("Olga", (body) => {
      prompt = lastUserText(body);
      return { content: "È 4721." };
    });
    discord.say({ content: "Olga, qual è il codice del cancello?" });
    await waitFor(() => posts("Olga").includes("È 4721."), { what: "Olga on Discord" });
    assert.match(prompt, /<altrove dove="chat privata con Olga \(pannello\)">[\s\S]*Il codice del cancello è 4721[\s\S]*<\/altrove>/);
    await quiet();
  });

  test("a question to the owner lands where they are talking, mentions them, and their next message goes to the agent who asked", async () => {
    replies.set("Pino", () => ({ content: "Ci sono anch'io!" }));
    replies.set("Olga", (body) => {
      if (body.messages[body.messages.length - 1].role === "tool") return { content: "PASS" };
      if (/routine "Pulizia"/.test(lastUserText(body))) return { tool_calls: [{ function: { name: "ask_owner", arguments: { question: "Cancello i file vecchi?", choices: ["Sì", "No"] } } }] };
      return { content: lastChatLine(body).endsWith(": Sì") ? "Perfetto, cancello." : "Ok." };
    });
    const before = posts("Olga").length;
    const routine = (await call(`/api/agents/${olga.id}/routines`, { method: "POST", body: { name: "Pulizia", schedule: "0 3 * * *", channelId: CHANNEL, prompt: "Controlla lo spazio su disco" } })).data;
    await call(`/api/routines/${routine.id}/run`, { method: "POST" });
    await waitFor(() => posts("Olga").length > before, { what: "the question on Discord" });
    await quiet();
    assert.deepEqual(posts("Olga").slice(before), [`<@${OWNER}> Cancello i file vecchi?\nRisposte: Sì · No`], "asked once, in the channel, pinging the owner");
    const archived = app.store.recentMessages(CHANNEL, 5).find((item) => item.request);
    assert.deepEqual([archived.content, archived.request.choices], ["Cancello i file vecchi?\nRisposte: Sì · No", ["Sì", "No"]]);
    assert.ok(!(await call("/api/state")).data.requests.some((item) => item.agentId === olga.id), "a Discord question is not left pending on the panel");

    discord.say({ content: "Sì" });
    await waitFor(() => posts("Olga").includes("Perfetto, cancello."), { what: "Olga acting on the answer" });
    await quiet();
    assert.ok(!posts("Pino").includes("Ci sono anch'io!"), "the answer goes to the agent who asked, not to the chattiest one");
    await call(`/api/routines/${routine.id}`, { method: "DELETE" });
  });

  test("Cora harness: a task goes past the old 14 steps, an agent that announces work is sent back to it, and the end is confirmed before posting", async () => {
    let calls = 0;
    const nudges = [];
    replies.set("Olga", (body) => {
      calls += 1;
      const last = body.messages[body.messages.length - 1];
      if (last.role === "user" && String(last.content).startsWith("[Cora]")) nudges.push(String(last.content).split(":")[0] + ":" + String(last.content).split(":")[1]);
      if (calls <= 20) return { tool_calls: [{ function: { name: "list_routines", arguments: { pass: calls } } }] };
      if (calls === 21) return { content: "Sto preparando il resoconto, ti aggiorno appena è pronto." };
      if (calls === 22) return { tool_calls: [{ function: { name: "list_routines", arguments: { pass: calls } } }] };
      if (calls === 23) return { content: "Fatto: 22 controlli, tutto in ordine." };
      // Asked to confirm, it does one more check before replying DONE: the real answer must survive it.
      if (calls === 24) return { tool_calls: [{ function: { name: "list_routines", arguments: { recheck: true } } }] };
      return { content: "DONE" };
    });
    discord.say({ content: "Olga, controlla le routine finché non è tutto a posto" });
    await waitFor(() => posts("Olga").includes("Fatto: 22 controlli, tutto in ordine."), { what: "the finished task", timeout: 20000 });
    await quiet();
    const said = posts("Olga");
    assert.ok(said.indexOf("Sto preparando il resoconto, ti aggiorno appena è pronto.") < said.indexOf("Fatto: 22 controlli, tutto in ordine."), "the announcement reached the chat as an update");
    assert.ok(!said.includes("DONE"), "the word DONE is never posted as the result");
    assert.equal(said.filter((text) => text === "Fatto: 22 controlli, tutto in ordine.").length, 1, "the real answer is posted once, even after a check between confirm and DONE");
    assert.deepEqual(nudges, ["[Cora] Non hai finito: quello che hai scritto è un aggiornamento, non il risultato. Continua adesso con gli strumenti, senza chiedere se andare avanti e senza annunciare", "[Cora] Prima di chiudere: il compito che ti hanno dato è finito davvero e verificato? Se manca qualcosa, continua adesso con gli strumenti. Se è tutto fatto, rispondi solo DONE."]);
    const [trace] = (await call(`/api/agents/${olga.id}/traces`)).data;
    assert.ok(trace.stepCount > 22, `worked through ${trace.stepCount} steps`);
  });

  test("an agent can pause and delete its own routines even without the owner's computer", async () => {
    let offered = [];
    let done = "";
    replies.set("Pino", (body) => {
      offered = (body.tools || []).map((tool) => tool.function.name);
      if (!done) {
        done = "set";
        return { tool_calls: [{ function: { name: "set_routine", arguments: { name: "Promemoria", schedule: "0 9 * * *", prompt: "ricorda" } } }] };
      }
      return { content: "Routine sistemata." };
    });
    // Pino has no computer here: the conversation is a plain question, not the owner's work.
    discord.say({ content: "Pino, mettiti un promemoria ogni mattina", author: STRANGER, username: "Ospite" });
    await waitFor(() => posts("Pino").includes("Routine sistemata."), { what: "Pino's answer", timeout: 20000 });
    await quiet();
    assert.ok(offered.includes("set_routine") && offered.includes("delete_routine"), "its own routines are always within reach");
    assert.ok(!offered.includes("shell"), "the owner's computer still is not");
    const mine = (await call("/api/state")).data.routines.filter((r) => r.agentId === pino.id);
    assert.ok(mine.some((r) => r.name === "Promemoria"), "and it really made one");
    for (const r of mine) await call(`/api/routines/${r.id}`, { method: "DELETE" });
  });

  test("told to stop, an agent stops: no more tools, no more goal rounds", async (t) => {
    await call("/api/settings", { method: "PUT", body: { goalMode: true } });
    t.after(() => call("/api/settings", { method: "PUT", body: { goalMode: false } }));
    goals = () => "tutti i file sono stati controllati uno per uno";
    let checked = 0;
    checks = () => { checked += 1; return JSON.stringify({ met: false, reason: "mancano file" }); };
    let calls = 0;
    const refusals = [];
    replies.set("Olga", (body) => {
      calls += 1;
      const last = body.messages[body.messages.length - 1];
      if (last.role === "tool" && /asked you to stop/.test(String(last.content))) refusals.push(String(last.content));
      if (calls === 1) {
        // The owner changes their mind while it works; the message reaches it with this result.
        discord.say({ content: "Olga, fermati" });
        return { tool_calls: [{ function: { name: "list_routines", arguments: { pass: 1 } } }] };
      }
      if (calls === 2) return { tool_calls: [{ function: { name: "list_routines", arguments: { pass: 2 } } }] };
      return { content: "Ero a metà: controllati 2 file su 10." };
    });
    discord.say({ content: "Olga, controlla tutti i file" });
    await waitFor(() => posts("Olga").includes("Mi fermo qui."), { what: "Olga stopping", timeout: 25000 });
    await quiet();
    assert.ok(calls <= 2 || refusals.length >= 1, "the turn is aborted or its subsequent tools are refused");
    assert.equal(checked, 0, "the goal never sends it back once it has been told to stop");
    assert.ok(calls < 6, `it stopped instead of going on (${calls} calls)`);
  });

  test("the owner's next words rewrite the goal instead of being argued with", async (t) => {
    await call("/api/settings", { method: "PUT", body: { goalMode: true } });
    t.after(() => call("/api/settings", { method: "PUT", body: { goalMode: false } }));
    const asked = [];
    goals = (body) => {
      const text = String(body.messages[1].content);
      asked.push(text);
      return /Poi il proprietario ha detto/.test(text) ? "il report è su Telegram" : "il report è via email";
    };
    const judged = [];
    checks = (body) => {
      judged.push(String(body.messages[1].content));
      return JSON.stringify({ met: judged.length > 1, reason: "manca l'invio" });
    };
    let calls = 0;
    replies.set("Olga", () => {
      calls += 1;
      if (calls === 1) {
        discord.say({ content: "Olga, anzi mandalo su Telegram non via email" });
        return { tool_calls: [{ function: { name: "list_routines", arguments: {} } }] };
      }
      return { content: "Mandato su Telegram." };
    });
    discord.say({ content: "Olga, manda il report" });
    await waitFor(() => posts("Olga").includes("Mandato su Telegram."), { what: "Olga's answer", timeout: 25000 });
    await quiet();
    assert.ok(asked.some((text) => /Poi il proprietario ha detto[\s\S]*Telegram/.test(text)), "the goal is rewritten from what they said next");
    assert.ok(posts("Olga").some((text) => /Cambio obiettivo: il report è su Telegram/.test(text)), "and it says so out loud");
    assert.ok(judged.some((text) => /Telegram/.test(text)), "the check judges the new goal, not the old one");
  });

  test("with goal mode off nobody writes a goal and nobody checks one", async () => {
    let asked = false;
    goals = () => { asked = true; return "una condizione qualsiasi"; };
    checks = () => { asked = true; return JSON.stringify({ met: false, reason: "no" }); };
    replies.set("Olga", () => ({ content: "Fatto e basta." }));
    discord.say({ content: "Olga, guarda una cosa" });
    await waitFor(() => posts("Olga").includes("Fatto e basta."), { what: "Olga's answer", timeout: 20000 });
    await quiet();
    assert.ok(!asked, "no goal is written and no check runs while the switch is off");
    const [trace] = (await call(`/api/agents/${olga.id}/traces`)).data;
    const steps = (await call(`/api/traces/${trace.id}`)).data.steps;
    assert.ok(!steps.some((step) => /Obiettivo:|Controllo obiettivo/.test(step.text || "")), "and nothing about a goal reaches the record");
  });

  test("goal mode: a task gets a goal, a separate check sends the agent back with the reason, and nothing is posted until it is met", async (t) => {
    await call("/api/settings", { method: "PUT", body: { goalMode: true } });
    t.after(() => call("/api/settings", { method: "PUT", body: { goalMode: false } }));
    const goal = "il deploy è in produzione e verificato dall'esterno";
    let askedFrom = "";
    goals = (body) => { askedFrom = String(body.messages[1].content); return goal; };
    const judged = [];
    checks = (body) => {
      judged.push(String(body.messages[1].content));
      return JSON.stringify(judged.length === 1 ? { met: false, reason: "il deploy non risulta verificato" } : { met: true, reason: "verificato" });
    };
    let calls = 0;
    const sent = [];
    let sawContract = false;
    replies.set("Olga", (body) => {
      calls += 1;
      const last = body.messages[body.messages.length - 1];
      if (String(body.messages[1]?.content || "").includes(`[Obiettivo]`)) sawContract = true;
      if (last.role === "user" && String(last.content).startsWith("[Cora]")) sent.push(String(last.content));
      if (calls === 1) return { tool_calls: [{ function: { name: "list_routines", arguments: {} } }] };
      if (calls === 2) return { content: "Fatto, deployato." };
      if (calls === 3) return { tool_calls: [{ function: { name: "list_routines", arguments: { verify: true } } }] };
      return { content: "Deploy in produzione, verificato dall'esterno." };
    });
    discord.say({ content: "Olga, fai il deploy e verificalo" });
    await waitFor(() => posts("Olga").includes("Deploy in produzione, verificato dall'esterno."), { what: "the task finished on its goal", timeout: 20000 });
    await quiet();
    assert.match(askedFrom, /fai il deploy e verificalo/, "the goal is written from what was asked");
    assert.ok(sawContract, "the goal travels in the prompt, so the harness running the agent sees it");
    assert.equal(sent.length, 1, "sent back once, by the check and not by guesswork");
    assert.match(sent[0], /obiettivo non è ancora raggiunto: il deploy non risulta verificato/i);
    assert.ok(!posts("Olga").includes("Fatto, deployato."), "the answer the goal refused is never posted");
    assert.match(judged[0], /list_routines/, "the check reads what the agent really did, not only what it says");
    const [trace] = (await call(`/api/agents/${olga.id}/traces`)).data;
    const notes = (await call(`/api/traces/${trace.id}`)).data.steps.filter((step) => step.type === "note").map((step) => step.text);
    assert.ok(notes.some((text) => text === `Obiettivo: ${goal}`), "the goal is on the record");
    assert.ok(notes.some((text) => /Controllo obiettivo: raggiunto/.test(text)));
  });

  test("Cora harness: an agent that works and says nothing is asked for the result, and one that repeats itself is stopped", async () => {
    let calls = 0;
    replies.set("Olga", (body) => {
      calls += 1;
      const last = body.messages[body.messages.length - 1];
      if (calls === 1) return { tool_calls: [{ function: { name: "list_routines", arguments: {} } }] };
      if (calls === 2) return { content: "" };
      if (/non hai scritto niente/.test(String(last.content))) return { content: "Nessuna routine da sistemare." };
      return { content: "DONE" };
    });
    discord.say({ content: "Olga, guarda le routine" });
    await waitFor(() => posts("Olga").includes("Nessuna routine da sistemare."), { what: "the result after the nudge" });
    await quiet();

    let looped = "";
    replies.set("Olga", (body) => {
      const last = body.messages[body.messages.length - 1];
      if (last.role === "tool" && /already done exactly this/.test(String(last.content))) {
        looped = String(last.content);
        return { content: "Mi fermo: la lista delle routine non cambia, mi serve un'indicazione." };
      }
      return { tool_calls: [{ function: { name: "list_routines", arguments: {} } }] };
    });
    discord.say({ content: "Olga, controlla di nuovo le routine" });
    await waitFor(() => posts("Olga").includes("Mi fermo: la lista delle routine non cambia, mi serve un'indicazione."), { what: "the agent stopped in a loop" });
    assert.match(looped, /Stop repeating it/);
    await quiet();
  });

  test("Cora harness: a long task frees the channel for the others, still gets new messages, and picks up again after a restart", async () => {
    app.orchestrator.releaseAfterMs = 300;
    let open;
    const gate = new Promise((resolve) => { open = resolve; });
    let steered = "";
    let calls = 0;
    replies.set("Olga", async (body) => {
      calls += 1;
      const last = body.messages[body.messages.length - 1];
      if (calls === 1) {
        await gate;
        return { tool_calls: [{ function: { name: "list_routines", arguments: { step: 1 } } }] };
      }
      if (last.role === "tool" && /Nel frattempo nella chat/.test(String(last.content))) steered = String(last.content);
      if (calls === 2) return { content: "Lavoro lungo finito, con la nota sulla cucina." };
      return { content: "DONE" };
    });
    replies.set("Pino", () => ({ content: "Ci sono io." }));
    discord.say({ content: "Olga, fai il lavoro lungo" });
    await waitFor(() => calls === 1, { what: "Olga starting her task" });
    await sleep(500);
    discord.say({ content: "Pino, ci sei?" });
    await waitFor(() => posts("Pino").includes("Ci sono io."), { what: "Pino answering while Olga works" });
    assert.ok(!posts("Olga").includes("Lavoro lungo finito, con la nota sulla cucina."), "Olga is still on her task");
    discord.say({ content: "Olga, aggiungi anche la cucina" });
    await sleep(300);
    open();
    await waitFor(() => posts("Olga").includes("Lavoro lungo finito, con la nota sulla cucina."), { what: "Olga's long task" });
    assert.match(steered, /aggiungi anche la cucina/);
    await quiet();
    app.orchestrator.releaseAfterMs = 20000;

    // A task the restart cut short: the trace was still running when Cora went down.
    const cut = {
      id: "tr_cut_by_restart", agentId: olga.id, kind: "chat", channelId: CHANNEL, model: "ollama/test-model", startedAt: new Date(Date.now() - 600000).toISOString(),
      endedAt: null, status: "running", prompt: "Ora: ieri.\n\nRifai l'inventario delle routine", system: "", output: "", error: "", dropped: 0,
      steps: [{ at: Date.now() - 500000, type: "tool", name: "list_routines", args: { page: 1 }, result: "Nessuna routine.", ok: true }],
    };
    app.store.saveTrace(cut);
    app.store.interruptedAtStart = [cut.id];
    let resumePrompt = "";
    replies.set("Olga", (body) => {
      const first = body.messages.find((message) => message.role === "user");
      if (!resumePrompt) resumePrompt = String(first.content);
      const last = body.messages[body.messages.length - 1];
      if (last.role === "user" && !String(last.content).startsWith("[Cora]")) return { tool_calls: [{ function: { name: "list_routines", arguments: { page: 2 } } }] };
      if (last.role === "tool") return { content: "Inventario ripreso e finito." };
      return { content: "DONE" };
    });
    assert.deepEqual(app.orchestrator.resumeInterrupted(), [cut.id]);
    await waitFor(() => posts("Olga").includes("Inventario ripreso e finito."), { what: "the resumed task" });
    assert.ok(posts("Olga").includes("Cora si è riavviata mentre lavoravo: riprendo da dove ero."));
    assert.match(resumePrompt, /Rifai l'inventario delle routine[\s\S]*Cora si è riavviata[\s\S]*list_routines \{"page":1\} → Nessuna routine\./);
    await quiet();
  });

  test("an agent on OrcaRouter runs on the Cora harness: the router's models, OpenAI-style tools and results, a task to the end", async (t) => {
    const models = (await call("/api/state")).data.models.map((model) => model.id);
    assert.ok(models.includes("orcarouter/openai/gpt-test"));
    assert.ok(models.includes("orcarouter/orcarouter/auto"), "the router can also pick the model");
    assert.ok(!models.includes("orcarouter/anthropic/only-native"), "only models it serves in the OpenAI format");
    await call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "orcarouter/openai/gpt-test" } });
    t.after(() => call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "ollama/test-model" } }));
    orca.state.requests.length = 0;
    orca.state.reply = (body) => {
      const last = body.messages[body.messages.length - 1];
      if (last.role === "user" && !String(last.content).startsWith("[Cora]")) return { tool_calls: [{ name: "list_routines", arguments: {} }] };
      if (last.role === "tool") return { content: "Routine controllate su OrcaRouter: tutto a posto." };
      return { content: "DONE" };
    };
    discord.say({ content: "Olga, controlla le routine" });
    await waitFor(() => posts("Olga").includes("Routine controllate su OrcaRouter: tutto a posto."), { what: "Olga's answer through OrcaRouter" });
    const [first, second] = orca.state.requests;
    assert.equal(first.model, "openai/gpt-test");
    assert.equal(first.messages[0].role, "system");
    assert.ok(first.tools.some((tool) => tool.type === "function" && tool.function.name === "list_routines"));
    const toolCall = second.messages.find((message) => message.role === "assistant" && message.tool_calls);
    const toolResult = second.messages.find((message) => message.role === "tool");
    assert.equal(toolResult.tool_call_id, toolCall.tool_calls[0].id, "the result answers its call");
    assert.equal(typeof toolCall.tool_calls[0].function.arguments, "string");
    assert.ok(orca.state.requests.length >= 3, "the end was confirmed (DONE)");
    await quiet();
    await call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "ollama/test-model" } });
  });

  test("a model can be typed by hand: any provider/model with a provider Cora knows", async (t) => {
    t.after(() => call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "ollama/test-model" } }));
    const bad = await call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "deepseek-v4" } });
    assert.equal(bad.status, 400);
    assert.match(bad.data.error, /provider\/modello/);
    assert.equal((await call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "nope/some-model" } })).status, 400);
    const typed = await call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "orcarouter/vendor/brand-new-model" } });
    assert.equal(typed.status, 200);
    assert.equal(app.store.agent(olga.id).model, "orcarouter/vendor/brand-new-model", "a model the list does not show yet is kept as typed");
  });

  test("an agent on Hermes gets Cora's tools only, through its own Hermes home, and no secrets", async (t) => {
    const models = (await call("/api/state")).data.models.map((model) => model.id);
    assert.ok(models.includes("hermes/test-model"));
    assert.ok(!models.includes("hermes/embed"), "only models that write");
    assert.ok(models.includes("hermes/test-model:cloud"), "Ollama Cloud models through the local Ollama");
    await call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "hermes/test-model" } });
    t.after(() => call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "ollama/test-model" } }));
    const before = cli.calls().length;
    cli.set({ reply: "Routine controllate con Hermes.", tool: "list_routines" });
    discord.say({ content: "Olga, controlla le routine con Hermes" });
    await waitFor(() => posts("Olga").some((text) => text.startsWith("Routine controllate con Hermes.")), { what: "Olga's answer through Hermes" });
    await quiet();
    const run = cli.calls().slice(before).find((item) => item.flavor === "hermes");
    assert.equal(run.argv[run.argv.indexOf("-t") + 1], "cora", "only Cora's tools: no terminal, files or computer use");
    assert.ok(run.argv.includes("--ignore-rules"));
    assert.equal(run.argv[run.argv.indexOf("-m") + 1], "test-model");
    assert.match(run.argv[run.argv.indexOf("-z") + 1], /^Sei Olga\./, "Cora's system prompt leads the prompt");
    assert.ok(run.tools.includes("list_routines") && run.tools.includes("say"));
    assert.match(run.output, /Buongiorno|Nessuna routine/, "the tool really ran through Cora's bridge");
    assert.match(run.hermesConfig, /CORA_BRIDGE_TOKEN: "\$\{CORA_BRIDGE_TOKEN\}"/, "the session token never lands in the file");
    assert.deepEqual(run.secretEnv, []);
    await call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "ollama/test-model" } });
  });

  test("when Hermes answers that the model gave it no content, the agent fails openly instead of saying that banner", async (t) => {
    await call("/api/state");
    assert.equal((await call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "hermes/test-model" } })).status, 200);
    t.after(() => call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "ollama/test-model" } }));
    cli.set({ reply: "⚠️ No reply: the model returned empty content after retries and any fallback providers. Try `continue`, switch model/provider, or inspect the tool output above." });
    discord.say({ content: "Olga, a che punto sei?" });
    await waitFor(() => posts("Olga").some((text) => text.includes("non riesco a rispondere")), { what: "Olga reporting the failure" });
    await quiet();
    assert.ok(!posts("Olga").some((text) => /No reply/i.test(text)), "Hermes' banner is never posted as the agent's own words");
    const trace = (await call(`/api/agents/${olga.id}/traces`)).data.find((item) => item.status === "error");
    assert.equal(trace.status, "error");
    assert.match(trace.error, /test-model returned no content/);
  });

  test("an agent without its computer is told to ask the owner instead of passing when someone else wants work done", async () => {
    let system = "";
    replies.set("Olga", (body) => {
      system = String(body.messages[0].content);
      return { content: "Serve il via libera di Sam: glielo chiedo." };
    });
    discord.say({ content: "Olga, mi sistemi il sito?", author: STRANGER, username: "Ospite" });
    await waitFor(() => posts("Olga").includes("Serve il via libera di Sam: glielo chiedo."), { what: "Olga answering a guest" });
    assert.match(system, /non hai il tuo computer[\s\S]*ask_owner/);
    await quiet();
  });

  test("after a restart the first message is answered, messages written while down are picked up, and a bot can call an agent by name", async () => {
    replies.set("Olga", (body) => ({ content: `Ok: ${lastChatLine(body).split(": ").pop()}` }));
    replies.set("Pino", () => ({ content: "Pino qui." }));
    app.orchestrator.states.delete(CHANNEL);
    discord.say({ content: "Olga, primo messaggio dopo il riavvio" });
    await waitFor(() => posts("Olga").includes("Ok: Olga, primo messaggio dopo il riavvio"), { what: "the first message after a restart" });
    await quiet();

    discord.offline = true;
    discord.say({ content: "Olga, ti scrivo mentre sei spenta" });
    discord.offline = false;
    await app.orchestrator.catchUp();
    await waitFor(() => posts("Olga").includes("Ok: Olga, ti scrivo mentre sei spenta"), { what: "the message written while down" });
    await quiet();
    const before = posts("Olga").length;
    await app.orchestrator.catchUp();
    await sleep(1500);
    assert.equal(posts("Olga").length, before, "a message already answered is not answered twice");

    discord.say({ content: "Olga, qui GROG, mi senti?", bot: true, author: "700000000000000009", username: "GROG" });
    await waitFor(() => posts("Olga").includes("Ok: Olga, qui GROG, mi senti?"), { what: "Olga answering a bot" });
    await quiet();
    discord.offline = true;
    discord.say({ content: "Olga, qui GROG di nuovo, mentre eri spenta", bot: true, author: "700000000000000009", username: "GROG" });
    discord.offline = false;
    await app.orchestrator.catchUp();
    await waitFor(() => posts("Olga").includes("Ok: Olga, qui GROG di nuovo, mentre eri spenta"), { what: "a bot's call picked up after a restart" });
    await quiet();
    const pino = posts("Pino").length;
    discord.say({ content: "messaggio di servizio", bot: true, author: "700000000000000009", username: "GROG" });
    await sleep(2000);
    assert.equal(posts("Pino").length, pino, "a bot that names nobody wakes nobody");
  });

  test("the reasoning level reaches Claude Code and Codex", async () => {
    const created = await call("/api/agents", { method: "POST", body: { name: "Ugo2", model: "claude/claude-sonnet-5-5", subscriptionId: subscriptionIds.claude, effort: "high", chattiness: 0, tools: false, channelIds: [CHANNEL] } });
    assert.equal(created.data.effort, "high");
    cli.set({ reply: "Ok." });
    discord.say({ content: "Ugo2, pensaci bene" });
    await waitFor(() => posts("Ugo2").length, { what: "Ugo2" });
    const claude = cli.calls().reverse().find((item) => item.flavor === "claude");
    assert.equal(claude.argv[claude.argv.indexOf("--effort") + 1], "high");
    await quiet();
    await call(`/api/agents/${created.data.id}`, { method: "PUT", body: { model: "codex/gpt-6-sol", subscriptionId: subscriptionIds.codex, effort: "low" } });
    discord.say({ content: "Ugo2, e adesso?" });
    await waitFor(() => posts("Ugo2").length === 2, { what: "Ugo2 on Codex" });
    const codex = cli.calls().reverse().find((item) => item.flavor === "codex");
    assert.ok(codex.argv.includes('model_reasoning_effort="low"'));
    await quiet();
    for (const id of [created.data.id, olga.id, pino.id]) await call(`/api/agents/${id}`, { method: "DELETE" });
  });
});

describe("listening without a dedicated bot", () => {
  test("an agent bot without Message Content asks Discord for it and becomes the listener; refused, cora stays deaf", async (t) => {
    const fake = await fakeDiscord();
    const ZENO = "600000000000000010";
    fake.state.botUsers.set("zeno-token", { id: ZENO, username: "Zeno", appFlags: 0 });
    // Discord refuses the intent at first (an app over 100 servers cannot switch it on itself).
    fake.state.refuseIntent.add("zeno-token");
    const otherHome = tempHome();
    const seed = new Store(otherHome);
    seed.updateSettings({ guildIds: [GUILD] });
    const zeno = seed.createAgent({ name: "Zeno", model: "ollama/test-model", chattiness: 0, tools: false });
    seed.close();
    const other = startCora({
      home: otherHome, host: "127.0.0.1", port: 0, adminPassword: "x", sessionKey: "y", insecureCookies: true,
      discordToken: "", discordApi: fake.url, telegramApi: telegram.url, telegramPollTimeout: 1, ollamaUrl: ollama.url, ollamaKey: "k",
      claudeBin: cli.claude, codexBin: cli.codex, codexModelsFile: cli.models, ownerInstructions: join(home, "owner-AGENTS.md"),
      botTokenFor: (name) => (name === "CORA_BOT_ZENO" ? "zeno-token" : ""), storeSecret: async () => {},
      docker: docker.path, schedulerTickMs: 3600000, startBoxes: false,
    });
    t.after(async () => { await other.stop(); await fake.close(); });
    await other.ready;
    await waitFor(() => other.bots.client(zeno.id), { what: "Zeno's own bot online" });
    await waitFor(() => fake.state.intentPatches.some((patch) => patch.token === "zeno-token"), { what: "Zeno asking for the intent" });
    await sleep(300);
    assert.equal(other.discord.state, "missing-token", "refused the intent, nobody listens");
    assert.equal(fake.state.botUsers.get("zeno-token").appFlags, 0, "and the app keeps no content flag");

    // Discord grants it on the next try: the bot switches itself to listening.
    fake.state.refuseIntent.delete("zeno-token");
    await other.bots.readFlags(zeno.id);
    assert.ok(fake.state.botUsers.get("zeno-token").appFlags & (1 << 19), "it turned Message Content on for its own app");
    await waitFor(() => other.discord.state === "ready" && other.discord.user?.id === ZENO, { what: "listening as Zeno" });
    replies.set("Zeno", () => ({ content: "Ti sento." }));
    fake.say({ content: "Zeno, mi senti?" });
    const post = await waitFor(() => fake.state.botPosts.find((item) => item.content === "Ti sento."), { what: "Zeno's reply" });
    assert.equal(post.token, "zeno-token");
    await sleep(1500);
    assert.equal(fake.state.botPosts.filter((item) => item.content === "Ti sento.").length, 1, "its own message is not heard as new");
  });
});

describe("shared listening", () => {
  test("a private channel the main bot cannot read is heard through the agent's bot that is in it, and one message gets one answer", async (t) => {
    const fake = await fakeDiscord();
    const PIA = "600000000000000030";
    const VALE = "600000000000000031";
    fake.state.botUsers.set("pia-token", { id: PIA, username: "Pia", appFlags: 1 << 19 });
    fake.state.botUsers.set("vale-token", { id: VALE, username: "Vale", appFlags: 1 << 19 });
    const PRIVATE = "1599000000000000900";
    // Only Vale's bot may read that channel: the listener (Pia, the first agent) gets 403 there.
    fake.state.privateTo.set(PRIVATE, "vale-token");
    const otherHome = tempHome();
    const seed = new Store(otherHome);
    seed.updateSettings({ guildIds: [GUILD] });
    const pia = seed.createAgent({ name: "Pia", model: "ollama/test-model", chattiness: 0, tools: false });
    const vale = seed.createAgent({ name: "Vale", model: "ollama/test-model", chattiness: 0, tools: false });
    seed.close();
    const other = startCora({
      home: otherHome, host: "127.0.0.1", port: 0, adminPassword: "x", sessionKey: "y", insecureCookies: true,
      discordToken: "", discordApi: fake.url, telegramApi: telegram.url, telegramPollTimeout: 1, ollamaUrl: ollama.url, ollamaKey: "k",
      claudeBin: cli.claude, codexBin: cli.codex, codexModelsFile: cli.models, ownerInstructions: join(home, "owner-AGENTS.md"),
      botTokenFor: (name) => ({ CORA_BOT_PIA: "pia-token", CORA_BOT_VALE: "vale-token" })[name] || "",
      storeSecret: async () => {}, docker: docker.path, schedulerTickMs: 3600000, startBoxes: false,
    });
    t.after(async () => { await other.stop(); await fake.close(); });
    await other.ready;
    await waitFor(() => other.discord.user?.id === PIA, { what: "Pia listening as the main bot" });
    await waitFor(() => [pia.id, vale.id].every((id) => other.bots.client(id)?.intents === LISTENING_INTENTS), { what: "both bots listening to their channels" });
    await sleep(300);

    replies.set("Vale", () => ({ content: "Ci sono, nel canale privato." }));
    replies.set("Pia", () => ({ content: "PASS" }));
    // Delivered only to Vale's connection, as Discord does for a channel the others cannot see.
    fake.sayTo({ botUserId: VALE, channel: PRIVATE, content: "Vale, ci sei?" });
    const post = await waitFor(() => fake.state.botPosts.find((item) => item.content === "Ci sono, nel canale privato."), { what: "Vale answering in the private channel" });
    assert.equal(post.channelId, PRIVATE);
    assert.equal(post.token, "vale-token", "she answers with her own bot");
    await sleep(800);
    assert.equal(fake.state.botPosts.filter((item) => item.content === "Ci sono, nel canale privato.").length, 1);

    // A public channel every bot hears: the same message must still get a single answer.
    fake.say({ content: "Vale, e qui?", channel: CHANNEL });
    await waitFor(() => fake.state.botPosts.some((item) => item.channelId === CHANNEL && item.content === "Ci sono, nel canale privato."), { what: "Vale answering in the shared channel" });
    await sleep(1500);
    const inChannel = fake.state.botPosts.filter((item) => item.channelId === CHANNEL && item.content === "Ci sono, nel canale privato.");
    assert.equal(inChannel.length, 1, "heard by several bots, answered once");

    // Nobody named, in a channel only Vale's bot is in: Pia is not even a candidate there.
    replies.set("Pia", () => ({ content: "Parlo io." }));
    replies.set("Vale", () => ({ content: "Rispondo io, che sono dentro." }));
    fake.sayTo({ botUserId: VALE, channel: PRIVATE, content: "allora, come procede?" });
    await waitFor(() => fake.state.botPosts.some((item) => item.channelId === PRIVATE && item.content === "Rispondo io, che sono dentro."), { what: "the agent inside the channel answering" });
    await sleep(800);
    assert.ok(!fake.state.botPosts.some((item) => item.channelId === PRIVATE && item.token === "pia-token"), "an agent whose bot is not in the channel never speaks there");
  });
});

describe("direct messages", () => {
  test("a DM to an agent's own bot is answered by that agent alone, in the DM, even with no channel assigned", async (t) => {
    const fake = await fakeDiscord();
    const DINA = "600000000000000020";
    fake.state.botUsers.set("dina-token", { id: DINA, username: "Dina", appFlags: 0 });
    const otherHome = tempHome();
    const seed = new Store(otherHome);
    seed.updateSettings({ guildIds: [GUILD] });
    // No channels assigned: Dina hears nothing in the servers, but still answers her DMs.
    const dina = seed.createAgent({ name: "Dina", model: "ollama/test-model", chattiness: 0, tools: false });
    seed.close();
    const other = startCora({
      home: otherHome, host: "127.0.0.1", port: 0, adminPassword: "x", sessionKey: "y", insecureCookies: true,
      discordToken: "", discordApi: fake.url, telegramApi: telegram.url, telegramPollTimeout: 1, ollamaUrl: ollama.url, ollamaKey: "k",
      claudeBin: cli.claude, codexBin: cli.codex, codexModelsFile: cli.models, ownerInstructions: join(home, "owner-AGENTS.md"),
      botTokenFor: (name) => (name === "CORA_BOT_DINA" ? "dina-token" : ""), storeSecret: async () => {},
      docker: docker.path, schedulerTickMs: 3600000, startBoxes: false,
    });
    t.after(async () => { await other.stop(); await fake.close(); });
    await other.ready;
    await waitFor(() => other.bots.client(dina.id), { what: "Dina's own bot online" });
    // Her app had no Message Content: she asks Discord for the limited intent herself, then listens.
    await waitFor(() => fake.state.intentPatches.some((patch) => patch.token === "dina-token" && (patch.flags & (1 << 19))), { what: "Dina switching Message Content on" });
    await waitFor(() => other.bots.client(dina.id)?.intents === LISTENING_INTENTS, { what: "Dina listening once she may read content" });
    // Switching intents reconnects her bot: wait for the socket to be back before writing to her.
    await waitFor(() => other.bots.client(dina.id)?.state === "ready", { what: "Dina's bot back online" });

    let prompt = "";
    replies.set("Dina", (body) => {
      prompt = lastUserText(body);
      return { content: "Ciao! Dimmi pure." };
    });
    const room = `7${DINA}`;
    fake.dm({ botUserId: DINA, content: "Ciao Dina, ci sei?" });
    const post = await waitFor(() => fake.state.botPosts.find((item) => item.content === "Ciao! Dimmi pure." && item.channelId === room), { what: "Dina's DM reply" });
    assert.equal(post.token, "dina-token", "she answers with her own bot, in the DM");
    assert.match(prompt, /in privato con te|messaggio privato/, "the agent knows it is a private message");
    await sleep(1200);
    assert.equal(fake.state.botPosts.filter((item) => item.content === "Ciao! Dimmi pure.").length, 1, "her own reply is not heard as a new DM");
  });
});

describe("hosted on usecora.space", () => {
  test("the panel opens only with a pass from the cloud, each pass once; the password is off; a one-time link made on the host works once", async () => {
    const keys = passKeys("a cloud seed for the hosted test 0123456789");
    const otherHome = tempHome();
    const seed = new Store(otherHome);
    seed.updateSettings({ guildIds: [GUILD] });
    seed.close();
    const hosted = startCora({
      home: otherHome, host: "127.0.0.1", port: 0, adminPassword: "an old password", sessionKey: "hosted-session-key", insecureCookies: true,
      cloudUrl: "https://usecora.test/", cloudKey: keys.publicKey, cloudSpace: "acme",
      discordToken: MAIN_TOKEN, discordApi: discord.url, telegramApi: telegram.url, telegramPollTimeout: 1, ollamaUrl: ollama.url, ollamaKey: "k",
      claudeBin: cli.claude, codexBin: cli.codex, codexModelsFile: cli.models, ownerInstructions: join(home, "owner-AGENTS.md"),
      botTokenFor: () => "", storeSecret: async () => {}, docker: docker.path, schedulerTickMs: 3600000, startBoxes: false,
    });
    await hosted.ready;
    const at = `http://127.0.0.1:${hosted.server.address().port}`;
    const get = (path, cookie = "") => fetch(`${at}${path}`, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
    const sessionOf = (response) => (response.headers.get("set-cookie") || "").split(";")[0];

    const me = await (await get("/api/me")).json();
    assert.deepEqual(me, { authed: false, cloud: { login: "https://usecora.test/go/acme", logout: "https://usecora.test/logout" } });
    const password = await fetch(`${at}/api/login`, { method: "POST", headers: { "X-Cora": "1", "Content-Type": "application/json" }, body: JSON.stringify({ password: "an old password" }) });
    assert.equal(password.status, 403, "no password on a hosted space");

    const pass = signPass(keys.privateKey, { aud: "acme.usecora.test", sub: "ac_1", email: "sam@example.com" });
    const entered = await get(`/auth/cloud?pass=${encodeURIComponent(pass)}&next=${encodeURIComponent("/#/agenti")}`);
    assert.equal(entered.status, 302);
    assert.equal(entered.headers.get("location"), "/#/agenti");
    const cookie = sessionOf(entered);
    assert.equal((await get("/api/state", cookie)).status, 200);
    assert.equal((await get(`/auth/cloud?pass=${encodeURIComponent(pass)}`)).headers.get("location"), "/?signin=refused", "a pass works once");

    const elsewhere = signPass(keys.privateKey, { aud: "other.usecora.test", sub: "ac_1" });
    assert.equal((await get(`/auth/cloud?pass=${encodeURIComponent(elsewhere)}`)).headers.get("location"), "/?signin=refused", "a pass for another space does not open this one");
    const forged = signPass(passKeys("somebody else's seed 0123456789abcdef").privateKey, { aud: "acme.usecora.test", sub: "ac_1" });
    assert.equal((await get(`/auth/cloud?pass=${encodeURIComponent(forged)}`)).headers.get("location"), "/?signin=refused", "only the cloud's key signs passes");
    const stale = signPass(keys.privateKey, { aud: "acme.usecora.test", sub: "ac_1" }, Date.now() - 120000);
    assert.equal((await get(`/auth/cloud?pass=${encodeURIComponent(stale)}`)).headers.get("location"), "/?signin=refused", "an old pass has expired");
    const away = signPass(keys.privateKey, { aud: "acme.usecora.test", sub: "ac_1" });
    assert.equal((await get(`/auth/cloud?pass=${encodeURIComponent(away)}&next=${encodeURIComponent("//evil.example/x")}`)).headers.get("location"), "/", "it never sends you to another site");

    // usecora.space tells this space about a waitlist sign-up; it lands in the notice channel as "Cora".
    hosted.store.updateSettings({ noticeChannel: "#general" });
    const notice = signPass(keys.privateKey, { aud: "notices", type: "waitlist", email: "ada@acme.example", company: "Acme" });
    const post = (body) => fetch(`${at}/api/cloud/notice`, { method: "POST", headers: { "X-Cora": "1", "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await waitFor(() => hosted.channels.list().some((channel) => channel.name === "general"), { what: "the space's channels" });
    assert.equal((await post({ notice })).status, 200);
    const told = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Cora" && /ada@acme\.example \(Acme\)/.test(item.content)), { what: "the notice in #general" });
    assert.match(told.content, /lista d'attesa di usecora\.space/);
    assert.equal((await post({ notice })).status, 403, "each notice is posted once");
    assert.equal((await post({ notice: signPass(keys.privateKey, { aud: "acme.usecora.test", type: "waitlist", email: "x@y.z" }) })).status, 403, "a pass is not a notice");
    assert.equal((await post({ notice: signPass(passKeys("another cloud's seed 0123456789abcdef").privateKey, { aud: "notices", type: "waitlist", email: "x@y.z" }) })).status, 403);

    const token = loginLinkToken("hosted-session-key");
    const link = await get(`/auth/link?token=${encodeURIComponent(token)}`);
    assert.equal(link.status, 302);
    assert.equal((await get("/api/state", sessionOf(link))).status, 200);
    assert.equal((await get(`/auth/link?token=${encodeURIComponent(token)}`)).headers.get("location"), "/?signin=refused", "the emergency link works once");
    assert.equal((await get(`/auth/link?token=${encodeURIComponent(loginLinkToken("a guessed key"))}`)).headers.get("location"), "/?signin=refused");
    await hosted.stop();
  });
});

describe("notifications and requests", () => {
  test("a subscribed phone gets replies while the panel is closed, the agents' notices and their requests, and answering clears the request", async () => {
    const phone = await fakePhone();
    const status = (await call("/api/state")).data.push;
    assert.equal(status.enabled, true);
    assert.match(status.publicKey, /^[\w-]{87}$/);
    assert.equal((await call("/api/push/subscribe", { method: "POST", body: { subscription: phone.subscription, device: "iPhone" } })).status, 200);
    assert.equal((await call("/api/push/test", { method: "POST" })).status, 200);
    const test = phone.decrypt(phone.received[0]);
    assert.equal(test.title, "Cora");
    assert.ok(phone.vapidValid(phone.received[0])?.sub, "signed with the VAPID key the browser subscribed with");
    assert.equal(phone.received[0].headers["content-encoding"], "aes128gcm");

    const created = await call("/api/agents", { method: "POST", body: { name: "Rita", model: "ollama/test-model", chattiness: 0, tools: false } });
    const room = `web-${created.data.id}`;
    let step = 0;
    replies.set("Rita", (body) => {
      step += 1;
      if (step === 1) return { content: "Ci penso io." };
      if (step === 2) return { tool_calls: [{ function: { name: "notify", arguments: { message: "Ho finito il controllo." } } }] };
      if (step === 3) return { tool_calls: [{ function: { name: "notify", arguments: { message: "Ancora io." } } }] };
      if (step === 4) return { content: "Fatto." };
      if (step === 5) return { tool_calls: [{ function: { name: "ask_owner", arguments: { question: "Posso cancellare i file vecchi?", choices: ["Sì", "No"] } } }] };
      if (step === 6) return { content: "Ti ho chiesto il permesso." };
      return { content: lastUserText(body).includes("Sì") ? "Perfetto, procedo." : "Ok." };
    });

    await call(`/api/rooms/${room}/messages`, { method: "POST", body: { text: "Puoi controllare una cosa?" } });
    await waitFor(() => phone.received.length === 2, { what: "the reply on the phone" });
    assert.deepEqual(phone.decrypt(phone.received[1]), { title: "Rita", body: "Ci penso io.", url: `/#/agent/${created.data.id}/chat`, tag: room });

    await call(`/api/rooms/${room}/messages`, { method: "POST", body: { text: "Avvisami quando hai finito" } });
    await waitFor(() => phone.received.some((item) => phone.decrypt(item).body === "Ho finito il controllo."), { what: "the agent's notice" });
    await quiet();
    const notices = phone.received.map((item) => phone.decrypt(item)).filter((item) => item.title === "Rita" && item.body.startsWith("Ho finito"));
    assert.equal(notices.length, 1, "a second notice within a minute is refused");

    await call(`/api/rooms/${room}/messages`, { method: "POST", body: { text: "Fai pulizia" } });
    const asked = await waitFor(() => phone.received.map((item) => phone.decrypt(item)).find((item) => item.title === "Rita ti chiede"), { what: "the request on the phone" });
    assert.equal(asked.body, "Posso cancellare i file vecchi?");
    await quiet();
    const state = (await call("/api/state")).data;
    const pending = state.requests.find((item) => item.agentId === created.data.id);
    assert.deepEqual([pending.content, pending.request.choices], ["Posso cancellare i file vecchi?", ["Sì", "No"]]);

    await call(`/api/rooms/${room}/messages`, { method: "POST", body: { text: "Sì" } });
    await waitFor(async () => (await call(`/api/rooms/${room}/messages`)).data.messages.some((item) => item.content === "Perfetto, procedo."), { what: "the agent acting on the answer" });
    assert.ok(!(await call("/api/state")).data.requests.some((item) => item.agentId === created.data.id), "an answered request is no longer pending");

    phone.gone();
    await call("/api/push/test", { method: "POST" });
    assert.equal(app.store.pushSubscriptions().length, 0, "a subscription the push service dropped is removed");
    await quiet();
    await call(`/api/agents/${created.data.id}`, { method: "DELETE" });
    await phone.close();
  });
});

describe("agents in Telegram", () => {
  const MAIN_TG = "1111111:AAmainmainmainmainmainmainmainmainmain";
  const TINA_TG = "2222222:AAtinatinatinatinatinatinatinatinatina";
  const group = (from, text, extra = {}) => ({ chat: { id: Number(TG_GROUP), type: "supergroup", title: "La banda" }, from, text, ...extra });
  const seb = { id: Number(TG_OWNER), first_name: "Seb", is_bot: false };
  let tina;
  let tgPrompt = "";

  test("the main bot token is checked and stored, and switching to Telegram turns Discord off", async () => {
    telegram.addBot(MAIN_TG, { id: 1111111, username: "cora_main_bot", first_name: "Cora" });
    assert.match((await call("/api/telegram/token", { method: "PUT", body: { token: "nope" } })).data.error, /BotFather/);
    assert.match((await call("/api/telegram/token", { method: "PUT", body: { token: "9999999:AAunknownunknownunknownunknownunknown" } })).data.error, /rifiuta/);
    const saved = await call("/api/telegram/token", { method: "PUT", body: { token: MAIN_TG } });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.bot.username, "cora_main_bot");
    assert.equal(hushVault.CORA_TELEGRAM_BOT_TOKEN, MAIN_TG);
    assert.equal(app.telegram.state, "idle", "Telegram waits until it is the channel in use");

    const switched = await call("/api/settings", { method: "PUT", body: { transport: "telegram" } });
    assert.equal(switched.data.transport, "telegram");
    await waitFor(() => app.telegram.state === "ready", { what: "Telegram polling" });
    await waitFor(() => app.discord.state === "stopped", { what: "Discord off" });
    const state = (await call("/api/state")).data;
    assert.equal(state.transport, "telegram");
    assert.equal(state.telegram.user.username, "cora_main_bot");
    assert.deepEqual(state.channels, [], "no Telegram chat is allowed yet");
  });

  test("chats are heard only once allowed; the group's creator becomes the owner; agents answer through the main bot", async () => {
    tina = (await call("/api/agents", { method: "POST", body: { name: "Tina", model: "ollama/test-model", chattiness: 0, tools: false } })).data;
    replies.set("Tina", (body) => {
      tgPrompt = lastUserText(body);
      return { content: "Ciao da Telegram! <3" };
    });
    telegram.push(group(seb, "Tina, ci sei?"));
    await waitFor(() => app.telegram.chats.has(TG_GROUP), { what: "the chat to be seen" });
    await sleep(1500);
    assert.equal(telegram.state.sent.length, 0, "a chat that is not allowed is ignored");
    assert.equal((await call("/api/state")).data.telegram.chats.find((chat) => chat.id === TG_GROUP).title, "La banda");

    await call("/api/settings", { method: "PUT", body: { telegramChatIds: [TG_GROUP] } });
    const channels = (await call("/api/state")).data.channels;
    assert.deepEqual(channels.map((channel) => [channel.id, channel.name, channel.kind]), [[`tg:${TG_GROUP}`, "La banda", "telegram"]]);
    telegram.push(group(seb, "Tina, ci sei?"));
    const sent = await waitFor(() => telegram.state.sent.find((item) => item.method === "sendMessage"), { what: "Tina's reply" });
    assert.equal(sent.token, MAIN_TG);
    assert.equal(sent.chat_id, TG_GROUP);
    assert.equal(sent.parse_mode, "HTML");
    assert.equal(sent.text, "<b>Tina</b>\nCiao da Telegram! &lt;3");
    assert.deepEqual(app.store.settings.telegramOwnerIds, [TG_OWNER]);
    assert.match(tgPrompt, /Ultimi messaggi nella chat Telegram "La banda"/);
    assert.match(tgPrompt, /Seb ★: Tina, ci sei\?/);
    const [summary] = (await call(`/api/agents/${tina.id}/traces`)).data;
    const trace = (await call(`/api/traces/${summary.id}`)).data;
    assert.match(trace.system, /In questo momento parlate su Telegram, nel gruppo "La banda"\./);
    assert.doesNotMatch(trace.system, /server Discord/);
    await quiet();

    telegram.push({ chat: { id: Number(TG_OTHER_GROUP), type: "group", title: "Altro" }, from: seb, text: "Tina?" });
    await waitFor(() => app.telegram.chats.has(TG_OTHER_GROUP), { what: "the other chat" });
    await sleep(1200);
    assert.equal(telegram.state.sent.filter((item) => item.chat_id === TG_OTHER_GROUP).length, 0);
  });

  test("an agent with its own Telegram bot posts as itself and answers its @username", async () => {
    telegram.state.sent.length = 0;
    telegram.addBot(TINA_TG, { id: 2222222, username: "tina_cora_bot", first_name: "tina-app" });
    assert.match((await call(`/api/agents/${tina.id}/telegram-bot`, { method: "PUT", body: { token: MAIN_TG } })).data.error, /bot principale/);
    const saved = await call(`/api/agents/${tina.id}/telegram-bot`, { method: "PUT", body: { token: TINA_TG } });
    assert.equal(saved.status, 200);
    assert.equal(hushVault.CORA_TG_BOT_TINA, TINA_TG);
    assert.equal(saved.data.telegramBot.user.username, "tina_cora_bot");
    assert.equal(saved.data.telegramBot.inChat, false);
    await waitFor(() => telegram.state.names.some((item) => item.token === TINA_TG && item.name === "Tina"), { what: "bot renamed" });

    telegram.state.members.add(`${TG_GROUP}:2222222`);
    app.tgBots.forgetMembership(tina.id);
    replies.set("Tina", (body) => {
      tgPrompt = lastUserText(body);
      return { content: "Tutto bene, grazie." };
    });
    telegram.push(group({ id: Number(TG_STRANGER), first_name: "Ospite", is_bot: false }, "@tina_cora_bot come va?", { entities: [{ type: "mention", offset: 0, length: 14 }] }));
    const sent = await waitFor(() => telegram.state.sent.find((item) => item.text === "Tutto bene, grazie."), { what: "Tina's own post" });
    assert.equal(sent.token, TINA_TG, "posted by Tina's own bot, without the name header");
    assert.match(tgPrompt, /Ospite: @Tina come va\?/);
    assert.doesNotMatch(tgPrompt, /Ospite ★/, "a stranger is not the owner");
    assert.equal((await call(`/api/agents/${tina.id}`)).data.telegramBot.inChat, true);
  });

  test("a routine on a Discord channel does not run while the cora lives on Telegram; switching back turns Discord on again", async () => {
    const routine = await call(`/api/agents/${tina.id}/routines`, { method: "POST", body: { name: "Discord", schedule: "0 9 * * *", channelId: CHANNEL, prompt: "Saluta." } });
    await call(`/api/routines/${routine.data.id}/run`, { method: "POST" });
    const failed = await waitFor(async () => (await call("/api/state")).data.routines.find((item) => item.id === routine.data.id && item.lastStatus === "error"), { what: "routine refused" });
    assert.match(failed.lastOutput, /ora Cora vive sull'altro/);

    await call("/api/settings", { method: "PUT", body: { transport: "discord" } });
    await waitFor(() => app.discord.state === "ready", { what: "Discord back" });
    assert.equal(app.telegram.state, "stopped");
    await call(`/api/agents/${tina.id}`, { method: "DELETE" });
  });
});


describe("thread goal lifecycle", () => {
  let iris;
  let ivo;
  const routine = (agent, name, prompt = "Controlla una volta la coda, poi PASS se non ci sono errori") => app.store.createRoutine(agent.id, { name, prompt, schedule: "35 * * * *", channelId: CHANNEL });

  before(async () => {
    const login = await call("/api/login", { method: "POST", body: { password: PASSWORD }, auth: false });
    cookie = login.headers.get("set-cookie").split(";")[0];
    for (const agent of app.store.agents()) app.store.updateAgent(agent.id, { enabled: false });
    await call("/api/settings", { method: "PUT", body: { transport: "discord" } });
    iris = app.store.createAgent({ name: "Iris", model: "ollama/test-model", tools: true, chattiness: 0, channelIds: [CHANNEL] });
    ivo = app.store.createAgent({ name: "Ivo", model: "ollama/test-model", tools: true, chattiness: 0, channelIds: [CHANNEL] });
  });
  beforeEach(() => app.store.updateSettings({ goalMode: true }));
  after(() => app.store.updateSettings({ goalMode: false }));

  test("a routine's goal comes from this invocation, never from memories or another task", async () => {
    app.store.addMemory(iris.id, "OBSOLETE: tutti i post devono essere pubblicati e la routine altrui cancellata", "manual", { pinned: true });
    app.brain.channelGoals.set(CHANNEL, "OBSOLETE: goal di un altro agente");
    const inputs = [];
    goals = (body) => { inputs.push(body.messages[1].content); return "il controllo attuale della coda è eseguito"; };
    let checked = "";
    checks = (body) => { checked = body.messages[1].content; return JSON.stringify({ met: true }); };
    let step = 0;
    replies.set("Iris", () => ++step === 1 ? { tool_calls: [{ function: { name: "list_routines", arguments: {} } }] } : { content: "PASS" });
    const r = routine(iris, "Verifica attuale");
    const result = await app.orchestrator.runRoutine(r);
    assert.equal(result.status, "nothing");
    assert.equal(inputs.length, 1);
    assert.match(inputs[0], /UN controllo adesso/);
    assert.doesNotMatch(inputs[0], /OBSOLETE|Ti torna in mente|Contesto recente/);
    assert.match(checked, /Verifica attuale.*35 \* \* \* \*/s, "the verifier sees the real tool output, including its schedule");
    assert.ok(!app.brain.channelGoals.has(CHANNEL), "the goal is released with its invocation");
  });

  test("one thread admits one goal even when different agents have routines due together", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let entered = false;
    goals = () => "il controllo corrente è completo";
    replies.set("Iris", async () => { entered = true; await gate; return { content: "PASS" }; });
    const first = routine(iris, "Primo controllo");
    const second = routine(ivo, "Secondo controllo");
    const pending = app.orchestrator.runRoutine(first);
    try {
      await waitFor(() => entered);
      const overlap = await app.orchestrator.runRoutine(second);
      assert.equal(overlap.status, "busy");
      assert.equal(app.store.routine(second.id).lastStatus, "skipped");
      assert.equal(app.orchestrator.threadWork.size, 1);
      assert.equal(app.brain.channelGoals.size, 1);
    } finally { release(); await pending; }
    assert.equal(app.orchestrator.threadWork.size, 0);
    assert.equal(app.brain.channelGoals.size, 0);
    replies.set("Ivo", () => ({ content: "PASS" }));
    assert.equal((await app.orchestrator.runRoutine(app.store.routine(second.id))).status, "nothing");
  });

  test("different threads can each hold their own goal", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let entered = 0;
    goals = () => "controllo completato";
    for (const name of ["Iris", "Ivo"]) replies.set(name, async () => { entered += 1; await gate; return { content: "PASS" }; });
    const first = routine(iris, "Thread uno");
    const second = app.store.createRoutine(ivo.id, { name: "Thread due", prompt: "Controlla", schedule: "35 * * * *", channelId: "web-" + ivo.id });
    const pending = [app.orchestrator.runRoutine(first), app.orchestrator.runRoutine(second)];
    try {
      await waitFor(() => entered === 2);
      assert.equal(app.orchestrator.threadWork.size, 2);
      assert.equal(app.brain.channelGoals.size, 2);
    } finally { release(); await Promise.all(pending); }
  });

  test("pausing, deleting or rescheduling a routine cancels its active turn before it can write again", async () => {
    goals = () => "controllo completato";
    for (const change of ["pause", "delete", "reschedule"]) {
      const r = routine(iris, "Lifecycle " + change);
      let entered = false;
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      replies.set("Iris", async () => {
        entered = true;
        await gate;
        return { tool_calls: [{ function: { name: "set_routine", arguments: { id: r.id, enabled: true, schedule: "*/15 * * * *" } } }] };
      });
      const pending = app.orchestrator.runRoutine(r);
      await waitFor(() => entered);
      const changed = await call(`/api/routines/${r.id}`, change === "delete" ? { method: "DELETE" } : { method: "PUT", body: change === "pause" ? { enabled: false } : { schedule: "35 13-23 * * *" } });
      assert.equal(changed.status, 200);
      try {
        await waitFor(() => !app.orchestrator.atWork.has(iris.id), { timeout: 2000, what: "active routine cancellation" });
      } finally { release(); await pending; }
      const trace = app.store.traces(iris.id, 1)[0];
      assert.equal(trace.status, "stopped");
      assert.ok(!app.store.trace(trace.id).steps.some((step) => step.name === "set_routine"), "no stale write gets executed");
      if (change === "pause") assert.equal(app.store.routine(r.id).enabled, false);
      if (change === "delete") assert.equal(app.store.routine(r.id), null);
      if (change === "reschedule") assert.equal(app.store.routine(r.id).schedule, "35 13-23 * * *");
    }
  });

  test("a restart ignores paused routines and stopped work even when another agent was addressed later", () => {
    const at = Date.now();
    const paused = routine(iris, "Paused before restart");
    app.store.updateRoutine(paused.id, { enabled: false });
    const traces = [
      { id: "tr_paused_probe", kind: "routine", prompt: `È il momento della tua routine "${paused.name}".` },
      { id: "tr_stopped_probe", kind: "chat", prompt: "Controlla la coda" },
    ];
    for (const trace of traces) app.store.saveTrace({ ...trace, agentId: iris.id, channelId: CHANNEL, model: iris.model, startedAt: new Date(at - 1000).toISOString(), endedAt: null, status: "interrupted", system: "", output: "", error: "", dropped: 0, steps: [{ at: at - 500, type: "tool", name: "list_routines", args: {}, result: "Nessuna routine", ok: true }] });
    app.store.appendArchive(CHANNEL, { id: "stop-probe", at: at + 1, authorId: OWNER, authorName: "Sam", kind: "owner", content: "Iris, stoppa tutto" });
    app.store.appendArchive(CHANNEL, { id: "other-probe", at: at + 2, authorId: OWNER, authorName: "Sam", kind: "owner", content: "Ivo, come va?" });
    app.store.interruptedAtStart = traces.map((trace) => trace.id);
    assert.deepEqual(app.orchestrator.resumeInterrupted(), []);
  });

  test("the evaluator answers a status question while preserving the goal and running task", async () => {
    const expected = "la coda è verificata senza anticipare i post";
    let written = 0;
    goals = () => { written += 1; return expected; };
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let calls = 0;
    replies.set("Iris", async () => { calls += 1; await gate; return { content: "PASS" }; });
    const evaluated = [];
    intentions = (body) => {
      evaluated.push(body.messages[1].content);
      return JSON.stringify({ intent: "status", reply: "Sto verificando la coda; non ho ancora un risultato definitivo." });
    };
    const pending = app.orchestrator.runRoutine(routine(iris, "Recap senza stop"));
    try {
      await waitFor(() => calls === 1);
      discord.say({ content: 'Iris, senza interromperti, mi dici cosa hai già verificato? Non ti sto dicendo «fermati».' });
      await waitFor(() => discord.state.webhookPosts.some((post) => post.username === "Iris" && post.content === "Sto verificando la coda; non ho ancora un risultato definitivo."));
      assert.equal(app.brain.channelGoals.get(CHANNEL), expected);
      assert.equal(app.orchestrator.threadWork.get(CHANNEL), iris.id);
      assert.equal(calls, 1, "the recap starts no second worker");
      assert.equal(written, 1, "the goal writer is not asked to replace a status question with a new goal");
      assert.equal(evaluated.length, 1);
      assert.match(evaluated[0], /Obiettivo attuale:[\s\S]*la coda è verificata/);
    } finally { release(); await pending; }
    assert.equal(written, 1);
    assert.equal(app.store.traces(iris.id, 1)[0].status, "pass");
  });

  test("tools wait for semantic evaluation and cannot run after an evaluated stop", async () => {
    const r = routine(iris, "Stop valutato");
    goals = () => "controllo completato";
    let releaseActor;
    const actorGate = new Promise((resolve) => { releaseActor = resolve; });
    let releaseEvaluation;
    const evaluationGate = new Promise((resolve) => { releaseEvaluation = resolve; });
    let actorStarted = false;
    let evaluated = false;
    replies.set("Iris", async () => {
      actorStarted = true;
      await actorGate;
      return { tool_calls: [{ function: { name: "remember", arguments: { text: "MUST NOT BE WRITTEN" } } }] };
    });
    intentions = async () => {
      evaluated = true;
      await evaluationGate;
      return JSON.stringify({ intent: "stop" });
    };
    const pending = app.orchestrator.runRoutine(r);
    try {
      await waitFor(() => actorStarted);
      discord.say({ content: "Iris, abbandona quello che stai facendo, lo riprendiamo un altro giorno" });
      await waitFor(() => evaluated);
      releaseActor();
      await sleep(150);
      assert.ok(!app.store.memories(iris.id).some((memory) => memory.text === "MUST NOT BE WRITTEN"));
      releaseEvaluation();
      await waitFor(() => !app.orchestrator.atWork.has(iris.id));
    } finally { releaseActor(); releaseEvaluation(); await pending; }
    assert.equal(app.store.traces(iris.id, 1)[0].status, "stopped");
    assert.equal(app.store.routine(r.id).enabled, false);
    assert.ok(!app.store.memories(iris.id).some((memory) => memory.text === "MUST NOT BE WRITTEN"));
  });

  test("a future dependency ends this check instead of restarting it twelve times", async () => {
    goals = () => "la coda è verificata e le pubblicazioni future restano programmate";
    let judged = 0;
    checks = () => { judged += 1; return JSON.stringify({ met: false, blocked: true, reason: "Le pubblicazioni sono previste stasera" }); };
    let calls = 0;
    replies.set("Iris", () => ++calls === 1 ? { tool_calls: [{ function: { name: "list_routines", arguments: {} } }] } : { content: "I post restano in coda fino a stasera." });
    await app.orchestrator.runRoutine(routine(iris, "Scadenze future"));
    assert.equal(judged, 1);
    assert.equal(calls, 2);
  });

  test("a Codex goal retry retains tool evidence and the owner's replacement goal", async () => {
    app.store.updateAgent(iris.id, { model: "codex/gpt-6-sol", subscriptionId: subscriptionIds.codex });
    const before = cli.calls().length;
    goals = (body) => /Poi il proprietario ha detto/.test(body.messages[1].content) ? "il report è su Telegram" : "il report è via email";
    let judged = 0;
    checks = () => {
      judged += 1;
      if (judged === 1) {
        app.orchestrator.ingest(app.orchestrator.state(CHANNEL), { id: "retarget-" + Date.now(), at: Date.now(), authorId: OWNER, authorName: "Sam", kind: "owner", content: "Iris, mandalo su Telegram invece che via email" });
      }
      return JSON.stringify({ met: judged >= 3, reason: "manca la consegna" });
    };
    cli.set({ reply: "Report preparato.", tool: "list_routines" });
    try {
      discord.say({ content: "Iris, manda il report via email" });
      await waitFor(() => cli.calls().slice(before).filter((item) => item.flavor === "codex").length >= 2, { timeout: 20000 });
      await quiet();
      const runs = cli.calls().slice(before).filter((item) => item.flavor === "codex");
      assert.match(runs[1].stdin, /Azioni già eseguite[\s\S]*list_routines[\s\S]*Verifica attuale/);
      assert.match(runs[1].stdin, /unica condizione attuale[^\n]*il report è su Telegram/);
      assert.match(runs[1].stdin, /Messaggi successivi del proprietario[\s\S]*Telegram/);
    } finally { app.store.updateAgent(iris.id, { model: "ollama/test-model", subscriptionId: "" }); }
  });

  test("stoppa tutto terminates a running CLI and never invokes the goal verifier", async () => {
    app.store.updateAgent(iris.id, { model: "codex/gpt-6-sol", subscriptionId: subscriptionIds.codex });
    goals = () => "tutti i post sono pubblicati";
    let judged = 0;
    checks = () => { judged += 1; return JSON.stringify({ met: false }); };
    cli.set({ reply: "Non dovrebbe arrivare", hang: true });
    const before = cli.calls().length;
    try {
      discord.say({ content: "Iris, controlla i post" });
      const run = await waitFor(() => cli.calls().slice(before).find((item) => item.pid), { timeout: 15000 });
      discord.say({ content: "Iris, stoppa tutto" });
      await waitFor(() => app.store.traces(iris.id, 1)[0]?.status === "stopped", { timeout: 2500, what: "the CLI being killed" });
      assert.throws(() => process.kill(run.pid, 0), { code: "ESRCH" });
      assert.equal(judged, 0);
      await quiet();
      assert.equal(cli.calls().slice(before).length, 1, "a stopped goal starts no replacement CLI");
    } finally { app.store.updateAgent(iris.id, { model: "ollama/test-model", subscriptionId: "" }); cli.set({ reply: "PASS" }); }
  });
});
