import assert from "node:assert/strict";
import { createECDH, createDecipheriv, createPublicKey, hkdfSync, randomBytes, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { after, before, beforeEach, describe, test } from "node:test";
import { startCora } from "../src/main.js";
import { passKeys, signPass } from "../src/pass.js";
import { Discord, LISTENING_INTENTS } from "../src/discord.js";
import { loginLinkToken } from "../src/web.js";
import { SHARED, Store } from "../src/store.js";
import { panelHarness } from "./panel.js";
import { identityCli } from "./subscription-fixtures.js";
import { subscriptionEnvironment } from "../src/subscriptions.js";
import { LLM, graphicsCards } from "../src/llm.js";
import { runClaude, runCodex } from "../src/cli.js";
import { Doc } from "../src/doc.js";
import { chmodSync, existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BOT, CHANNEL, GUILD, MAIN_TOKEN, OTHER_CHANNEL, OTHER_GUILD, OWNER, SLACK_CHANNEL, SLACK_DM, SLACK_OTHER_CHANNEL, SLACK_OWNER, SLACK_STRANGER, STRANGER, TG_GROUP, TG_OTHER_GROUP, TG_OWNER, TG_STRANGER, fakeCli, fakeDiscord, fakeDoc, fakeDocker, fakeOllama, fakeSlack, fakeTelegram, sleep, tempHome, waitFor } from "./helpers.js";

const PASSWORD = "correct horse battery staple";
let discord;
let telegram;
let slack;
let ollama;
let docker;
let doc;
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
  slack = await fakeSlack();
  docker = fakeDocker();
  doc = fakeDoc();
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
    slackApi: slack.url,
    ollamaUrl: ollama.url,
    ollamaKey: "test-ollama-key",
    orcaUrl: orca.url,
    orcaKey: "sk-orca-test",
    hermesBin: cli.hermes,
    hermesHome: join(home, "hermes-home"),
    hermesBaseUrl: `${ollama.url}/v1`,
    claudeBin: cli.claude,
    codexBin: cli.codex,
    grokBin: cli.grok,
    museBin: cli.muse,
    codexModelsFile: cli.models,
    ownerInstructions: join(home, "owner-AGENTS.md"),
    sshAuthorizedKeys: join(home, "authorized_keys"),
    vapidKey: "test-vapid-secret",
    sshJump: "sam@host",
    botTokenFor: (name) => botTokens[name] || "",
    storeSecret: async (name, value) => { hushVault[name] = value; },
    docker: docker.path,
    docDir: doc.root,
    typesafeKey: "ts-test-key",
    schedulerTickMs: 3600000,
    startBoxes: false,
  });
  await app.ready;
  for (const provider of ["claude", "codex", "grok", "muse"]) {
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
  await slack.close();
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

  test("turns on a shared subscription run side by side, a cancelled one stops at once, and login cannot race a running account", async (t) => {
    const fixture = await subscriptionApp(t);
    const record = await connectIdentity(fixture, "claude");
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    const entered = new Set();
    // Nico asked in three threads at once: three turns on one account, none waiting for another.
    const turns = ["general", "alienwatch", "ai-nation"].map((thread) => fixture.app.subscriptions.run(record.id, "claude", null, async () => { entered.add(thread); await hold; return thread; }));
    await waitFor(() => entered.size === 3, { what: "three turns running at once on one account" });
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    let cancelledEntered = false;
    await assert.rejects(fixture.app.subscriptions.run(record.id, "claude", controller.signal, async () => { cancelledEntered = true; }), /cancelled/);
    assert.equal(cancelledEntered, false);
    assert.equal((await fixture.request(`/api/subscriptions/${record.id}/login`, { method: "POST" })).status, 400, "no login while turns use the account");
    release();
    assert.deepEqual(await Promise.all(turns), ["general", "alienwatch", "ai-nation"]);
    assert.ok(!fixture.app.subscriptions.running.has(record.id), "the account is free again once they end");
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

  test("Codex keeps its host read-only while authorized Cora desktop writes use the MCP bridge", async (t) => {
    const agent = app.store.createAgent({ name: "Remote writer", model: "codex/test-model", subscriptionId: subscriptionIds.codex, tools: true, chattiness: 0 });
    const directory = tempHome(), marker = join(directory, "connector-result.txt");
    const original = app.boxes.shell;
    app.boxes.shell = async (id, command) => {
      assert.equal(id, agent.id);
      assert.equal(command, "fixture-authorized-connector-write");
      writeFileSync(marker, "record updated in fixture connector");
      return { code: 0, output: "Fixture record updated." };
    };
    cli.set({ tool: "shell", args: { command: "fixture-authorized-connector-write" }, reply: "Aggiornamento verificato." });
    t.after(() => { app.boxes.shell = original; app.store.deleteAgent(agent.id); cli.set({ reply: "ok" }); });
    const previousGoalMode = app.store.settings.goalMode;
    app.store.updateSettings({ goalMode: true });
    goals = () => "Il record di prova è aggiornato";
    t.after(() => app.store.updateSettings({ goalMode: previousGoalMode }));
    const routine = app.store.createRoutine(agent.id, { name: "Authorized connector update", prompt: "Aggiorna il record di prova già autorizzato e verifica il risultato.", schedule: "0 9 * * *", channelId: `web-${agent.id}` });
    const before = cli.calls().length;
    const result = await app.brain.routineTurn({ agent, routine, history: [], channel: { id: `web-${agent.id}`, place: "test" }, say: async () => {} });
    assert.match(result.text, /Aggiornamento verificato/);
    assert.equal(readFileSync(marker, "utf8"), "record updated in fixture connector");
    const run = cli.calls().slice(before).find((item) => item.flavor === "codex");
    const contract = JSON.parse(run.argv.find((item) => item.startsWith("developer_instructions=")).slice("developer_instructions=".length));
    assert.match(contract, /read-only sandbox protects the local CLI host/);
    assert.match(contract, /agent's own Linux desktop/);
    assert.match(contract, /availability alone is not authorization/);
    assert.equal(run.argv[run.argv.indexOf("-s") + 1], "read-only");
    for (const feature of ["shell_tool", "unified_exec", "browser_use", "computer_use"]) assert.ok(run.argv.some((value, index) => value === "--disable" && run.argv[index + 1] === feature));
    assert.ok(!run.argv.includes("--dangerously-bypass-approvals-and-sandbox"));
    assert.match(run.stdin, /Il sandbox dell'host non rende in sola lettura/);
    assert.equal(app.store.trace(result.traceId).steps.find((step) => step.type === "tool" && step.name === "shell").ok, true);
  });

  test("Codex without a desktop retains the write boundary and cannot gain shell from application instructions", async (t) => {
    const agent = app.store.createAgent({ name: "No desktop writer", model: "codex/test-model", subscriptionId: subscriptionIds.codex, tools: true, chattiness: 0 });
    const original = app.boxes.shell;
    let called = false;
    app.boxes.shell = async () => { called = true; throw new Error("unexpected desktop access"); };
    cli.set({ tool: "shell", args: { command: "must-not-run" }, reply: "Serve il computer autorizzato." });
    t.after(() => { app.boxes.shell = original; app.store.deleteAgent(agent.id); cli.set({ reply: "ok" }); });
    const before = cli.calls().length;
    await app.brain.chatTurn({ agent, history: [{ id: "readonly-question", at: Date.now(), kind: "human", authorName: "Guest", content: "Aggiorna il connettore." }], channel: { id: `web-${agent.id}`, place: "test" }, forced: true, computer: false, say: async () => {} });
    const run = cli.calls().slice(before).find((item) => item.flavor === "codex");
    assert.equal(called, false);
    assert.ok(!run.tools.includes("shell"));
    assert.match(run.output, /tool shell is not available/);
    assert.equal(run.argv[run.argv.indexOf("-s") + 1], "read-only");
    assert.match(run.stdin, /In questa conversazione non hai il tuo computer/);
  });

  test("the verifier requires connector evidence and preserves a real permission denial", async () => {
    checks = (body) => {
      assert.match(body.messages[0].content, /la sola affermazione dell'agente non basta/);
      assert.match(body.messages[0].content, /Non chiedere tentativi di scrittura non autorizzati/);
      assert.match(lastUserText(body), /403: write permission denied/);
      return JSON.stringify({ met: false, blocked: true, reason: "Il connettore ha negato la scrittura con 403." });
    };
    const verdict = await app.brain.goalCheck("Il record autorizzato è aggiornato", { answer: "Scrittura rifiutata.", work: "update_record → 403: write permission denied" });
    assert.equal(verdict.met, false);
    assert.equal(verdict.blocked, true);
    assert.match(verdict.reason, /403/);
  });

  test("visual navigation can take many screenshots and click the same place on changing pages", async (t) => {
    const agent = app.store.createAgent({ name: "Visual browser", model: "ollama/test-model", tools: true, chattiness: 0 });
    const original = app.boxes.screenshot;
    let frames = 0, calls = 0;
    app.boxes.screenshot = async () => Buffer.from(`fixture-page-${++frames}`);
    replies.set(agent.name, () => ++calls <= 12 ? { tool_calls: [{ function: { name: calls % 2 ? "screenshot" : "computer", arguments: calls % 2 ? {} : { action: "click", x: 40, y: 40 } } }] } : { content: "Sei pagine controllate." });
    t.after(() => { app.boxes.screenshot = original; app.store.deleteAgent(agent.id); replies.delete(agent.name); });
    const result = await app.brain.loop({ agent, mode: "chat", channel: { id: `web-${agent.id}`, place: "test" }, user: "Controlla le sei pagine.", computer: true, task: false, maxSteps: 20, deadline: Date.now() + 20000, images: [] });
    assert.equal(result.text, "Sei pagine controllate.");
    assert.equal(frames, 6);
    assert.equal(app.store.trace(result.traceId).steps.filter((step) => step.type === "tool" && !step.ok).length, 0);
  });

  test("the browser tool reads the page and its session from the same Chromium, without the values", async (t) => {
    const agent = app.store.createAgent({ name: "Reader", model: "ollama/test-model", tools: true, chattiness: 0 });
    const calls = [];
    const original = app.boxes.browser;
    app.boxes.browser = async (agentId, action, argument) => {
      calls.push([action, argument]);
      if (action === "cookies") return { count: 2, cookies: [{ name: "session", domain: "slack.test", secure: true, httpOnly: true, size: 180 }] };
      return { url: "https://slack.test/apps", title: "Le tue app", text: "Crea un'app" };
    };
    let step = 0;
    replies.set(agent.name, (body) => {
      step += 1;
      if (step === 1) return { tool_calls: [{ function: { name: "browser", arguments: { action: "text" } } }] };
      if (step === 2) return { tool_calls: [{ function: { name: "browser", arguments: { action: "cookies" } } }] };
      return { content: `Pagina: ${JSON.parse(body.messages.findLast((message) => message.role === "tool" && message.content.includes("cookies")).content).cookies[0].name}` };
    });
    t.after(() => { app.boxes.browser = original; app.store.deleteAgent(agent.id); replies.delete(agent.name); });
    const result = await app.brain.loop({ agent, mode: "chat", channel: { id: `web-${agent.id}`, place: "test" }, user: "Guarda che pagina è.", computer: true, task: false, maxSteps: 8, deadline: Date.now() + 20000, images: [] });
    assert.deepEqual(calls, [["text", ""], ["cookies", ""]]);
    assert.match(result.text, /session/);
    const steps = app.store.trace(result.traceId).steps.filter((entry) => entry.type === "tool");
    assert.ok(steps.every((entry) => entry.ok), "reading the page twice is work, not a loop");
    assert.ok(!JSON.stringify(steps).includes("\"value\""), "no cookie or storage value ever reaches the transcript");
  });

  test("unchanging screenshots still stop a real observation loop", async (t) => {
    const agent = app.store.createAgent({ name: "Stuck browser", model: "ollama/test-model", tools: true, chattiness: 0 });
    const original = app.boxes.screenshot;
    app.boxes.screenshot = async () => Buffer.from("same fixture page");
    replies.set(agent.name, (body) => body.messages.at(-1).role === "tool" && body.messages.at(-1).content.startsWith("error:")
      ? { content: "La pagina non cambia: mi fermo qui." } : { tool_calls: [{ function: { name: "screenshot", arguments: {} } }] });
    t.after(() => { app.boxes.screenshot = original; app.store.deleteAgent(agent.id); replies.delete(agent.name); });
    const result = await app.brain.loop({ agent, mode: "chat", channel: { id: `web-${agent.id}`, place: "test" }, user: "Guarda la pagina.", computer: true, task: false, maxSteps: 10, deadline: Date.now() + 20000, images: [] });
    const tools = app.store.trace(result.traceId).steps.filter((step) => step.type === "tool");
    assert.equal(tools.length, 4);
    assert.equal(tools.at(-1).ok, false);
    assert.match(result.text, /mi fermo/);
  });

  test("a forbidden agent bot can deliver through an authorized shared bot without crossing private channels", async (t) => {
    const agent = app.store.createAgent({ name: "Shared delivery", tools: false, chattiness: 0 });
    const token = "shared-delivery-fixture-token";
    const own = new Discord({ token, apiBase: discord.url });
    own.user = { id: "600000000000000098", username: agent.name };
    app.bots.clients.set(agent.id, { client: own });
    discord.state.deniedPosts.set(CHANNEL, new Set([token]));
    const state = app.orchestrator.state(CHANNEL);
    const wasBlind = state.mainBlind;
    state.mainBlind = false;
    t.after(() => { app.bots.clients.delete(agent.id); app.store.deleteAgent(agent.id); discord.state.deniedPosts.delete(CHANNEL); discord.state.privateTo.delete(CHANNEL); state.mainBlind = wasBlind; });
    const before = discord.state.webhookPosts.length;
    await app.orchestrator.postAs(agent, state, "Risposta consegnata.");
    assert.equal(discord.state.webhookPosts.length, before + 1);
    assert.equal(discord.state.webhookPosts.at(-1).username, agent.name);
    assert.equal(discord.state.webhookPosts.at(-1).content, "Risposta consegnata.");
    discord.state.privateTo.set(CHANNEL, MAIN_TOKEN);
    assert.equal(await app.bots.canRead(agent, CHANNEL), false);
    await assert.rejects(app.orchestrator.postAs(agent, state, "Non può leggere, quindi non può parlare."), /403/);
    await assert.rejects(app.orchestrator.postDirect(agent, app.orchestrator.state(`web-${agent.id}`), CHANNEL, "Nessun accesso tramite il principale."), /403/);
    const inaccessible = app.store.createRoutine(agent.id, { name: "Canale non accessibile", prompt: "Non deve partire", schedule: "35 * * * *", channelId: CHANNEL });
    assert.equal((await app.orchestrator.runRoutine(inaccessible)).status, "blocked");
    const interrupted = { id: "tr_denied_channel", agentId: agent.id, channelId: CHANNEL, kind: "chat", model: "ollama/test-model", status: "interrupted", startedAt: new Date().toISOString(), endedAt: null, system: "", prompt: "Compito precedente", output: "", error: "", dropped: 0, steps: [] };
    app.store.saveTrace(interrupted);
    await app.orchestrator.resumeTask(agent, interrupted);
    assert.equal(app.store.trace(interrupted.id).status, "stopped");
    assert.ok(!app.orchestrator.threadWork.has(CHANNEL));
    discord.state.privateTo.delete(CHANNEL);
    state.mainBlind = true;
    await assert.rejects(app.orchestrator.postAs(agent, state, "Non deve passare."), /403/);
    state.mainBlind = false;
    discord.state.privateTo.set(CHANNEL, token);
    await assert.rejects(app.orchestrator.postAs(agent, state, "Il principale non può leggere."), /403/);
    assert.equal(discord.state.webhookPosts.length, before + 1);
  });

  test("a partially delivered Discord reply is never resent through another bot", async (t) => {
    const agent = app.store.createAgent({ name: "Partial delivery", tools: false, chattiness: 0 });
    const token = "partial-delivery-fixture-token";
    const own = new Discord({ token, apiBase: discord.url });
    own.user = { id: "600000000000000097", username: agent.name };
    const original = own.sendPayload.bind(own);
    own.sendPayload = async (...args) => { const sent = await original(...args); discord.state.deniedPosts.set(CHANNEL, new Set([token])); return sent; };
    app.bots.clients.set(agent.id, { client: own });
    t.after(() => { app.bots.clients.delete(agent.id); app.store.deleteAgent(agent.id); discord.state.deniedPosts.delete(CHANNEL); });
    const before = discord.state.webhookPosts.length;
    await assert.rejects(app.orchestrator.postAs(agent, app.orchestrator.state(CHANNEL), "lunga ".repeat(600)), (error) => error.status === 403 && error.sentCount === 1);
    assert.equal(discord.state.webhookPosts.length, before);
    assert.equal(discord.state.botPosts.filter((post) => post.token === token).length, 1);
  });

  test("routine reports stay passive and a new human message gets a normal answer", async (t) => {
    const agent = app.store.createAgent({ name: "Calma", model: "ollama/test-model", tools: false, chattiness: 0 });
    const room = `web-${agent.id}`, state = app.orchestrator.state(room);
    const focus = { ids: [agent.id], at: Date.now() };
    Object.assign(state, { focus, budget: 7, ownerOrigin: true });
    let calls = 0;
    replies.set(agent.name, (body) => { calls += 1; return { content: lastUserText(body).includes('routine "Report"') ? "Report concluso. Calma, controlla questo risultato." : "Sì, parliamone." }; });
    t.after(() => { app.store.deleteAgent(agent.id); replies.delete(agent.name); });
    const routine = app.store.createRoutine(agent.id, { name: "Report", schedule: "0 9 * * *", channelId: room, prompt: "Pubblica il risultato." });
    await app.orchestrator.runRoutine(routine);
    assert.equal(state.history.at(-1).passive, true);
    assert.equal(app.store.recentMessages(room, 10).at(-1).passive, true);
    assert.equal(state.budget, 7);
    assert.equal(state.ownerOrigin, true);
    assert.equal(state.focus, focus);
    assert.equal(state.nextRoundAt || 0, 0);
    await app.orchestrator.round(state);
    assert.equal(calls, 1, "a report cannot reactivate itself even with a named agent and remaining budget");
    await app.orchestrator.onWebMessage({ room, text: "Calma, possiamo parlare del risultato?" });
    await waitFor(() => state.history.some((item) => item.content === "Sì, parliamone."));
    await quiet();
    assert.equal(calls, 2);
    assert.equal(state.humanQueue.size, 0);
    assert.equal(app.store.routineHistory({ agentId: agent.id }).items.length, 1);
  });

  test("a human arriving during final routine delivery is answered once after the worker releases", async (t) => {
    const agent = app.store.createAgent({ name: "Staffetta", model: "ollama/test-model", tools: false, chattiness: 0 });
    const room = `web-${agent.id}`, state = app.orchestrator.state(room);
    let release, delivering = false, routineCalls = 0, chatCalls = 0;
    const gate = new Promise((resolve) => { release = resolve; });
    const original = app.orchestrator.postAs;
    app.orchestrator.postAs = async function (speaker, target, text, ...rest) {
      if (speaker.id === agent.id && text === "Routine finita.") { delivering = true; await gate; }
      return original.call(this, speaker, target, text, ...rest);
    };
    replies.set(agent.name, (body) => {
      if (lastUserText(body).includes('routine "Handoff"')) { routineCalls += 1; return { content: "Routine finita." }; }
      chatCalls += 1;
      assert.match(lastUserText(body), /Messaggio umano a cui rispondere adesso:.*guardiamo insieme/);
      return { content: "Certo, guardiamo insieme." };
    });
    t.after(() => { release(); app.orchestrator.postAs = original; app.store.deleteAgent(agent.id); replies.delete(agent.name); });
    const routine = app.store.createRoutine(agent.id, { name: "Handoff", schedule: "0 9 * * *", channelId: room, prompt: "Concludi il report." });
    const running = app.orchestrator.runRoutine(routine);
    await waitFor(() => delivering);
    await app.orchestrator.onWebMessage({ room, text: "Staffetta, guardiamo insieme il report?" });
    await sleep(500);
    assert.equal(chatCalls, 0);
    release();
    await running;
    await waitFor(() => state.history.some((item) => item.content === "Certo, guardiamo insieme."));
    await quiet();
    assert.equal(routineCalls, 1);
    assert.equal(chatCalls, 1);
    assert.equal(state.humanQueue.size, 0);
    assert.equal(app.orchestrator.threadWork.has(room), false);
  });

  test("status and side questions get immediate answers while the same routine goal continues", async (t) => {
    const previous = app.store.settings.goalMode;
    app.store.updateSettings({ goalMode: true });
    const agent = app.store.createAgent({ name: "Dialogo", model: "ollama/test-model", tools: true, chattiness: 0 });
    const room = `web-${agent.id}`, state = app.orchestrator.state(room);
    let release, started = false, calls = 0;
    const gate = new Promise((resolve) => { release = resolve; });
    goals = () => "Il report è stato controllato";
    intentions = (body) => JSON.stringify(lastUserText(body).includes("che significa") ? { intent: "continue", reply: "Significa che il controllo è ancora in corso." } : { intent: "status", reply: "Sto controllando il report; il lavoro continua." });
    replies.set(agent.name, async () => { calls += 1; started = true; await gate; return { content: "Report controllato." }; });
    t.after(() => { release(); app.store.updateSettings({ goalMode: previous }); app.store.deleteAgent(agent.id); replies.delete(agent.name); });
    const routine = app.store.createRoutine(agent.id, { name: "Dialogo durante il lavoro", schedule: "0 9 * * *", channelId: room, prompt: "Controlla il report." });
    const running = app.orchestrator.runRoutine(routine);
    await waitFor(() => started);
    await app.orchestrator.onWebMessage({ room, text: "Dialogo, come andiamo?" });
    await waitFor(() => state.history.some((item) => item.content === "Sto controllando il report; il lavoro continua."));
    await app.orchestrator.onWebMessage({ room, text: "Dialogo, che significa questo stato?" });
    await waitFor(() => state.history.some((item) => item.content === "Significa che il controllo è ancora in corso."));
    assert.equal(app.brain.channelGoals.get(room), "Il report è stato controllato");
    assert.equal(app.orchestrator.threadWork.get(room), agent.id);
    assert.equal(state.humanQueue.size, 0);
    release();
    await running;
    await quiet();
    assert.equal(calls, 1);
    assert.equal(app.store.routine(routine.id).enabled, true);
    assert.equal(app.store.routineHistory({ agentId: agent.id }).items.length, 1);
  });

  test("channel discovery and direct delivery work without a computer or grog and never duplicate PASS", async (t) => {
    const agent = app.store.createAgent({ name: "Canali", model: "ollama/test-model", tools: false, chattiness: 0, channelIds: [CHANNEL] });
    const room = `web-${agent.id}`, state = app.orchestrator.state(room);
    let calls = 0;
    replies.set(agent.name, (body) => {
      calls += 1;
      assert.ok(body.tools.some((tool) => tool.function.name === "list_channels"));
      assert.ok(!body.tools.some((tool) => tool.function.name === "shell"));
      if (calls === 1) return { tool_calls: [{ function: { name: "list_channels", arguments: {} } }] };
      if (calls === 2) {
        const channels = JSON.parse(body.messages.at(-1).content);
        assert.ok(channels.some((channel) => channel.id === CHANNEL && channel.kind === "discord"));
        assert.ok(!channels.some((channel) => channel.id === OTHER_CHANNEL));
        return { tool_calls: [{ function: { name: "say", arguments: { text: "Risultato pubblicato direttamente.", channel_id: CHANNEL } } }] };
      }
      assert.match(body.messages.at(-1).content, /posted directly/);
      return { content: "PASS" };
    });
    t.after(() => { app.store.deleteAgent(agent.id); replies.delete(agent.name); });
    const result = await app.brain.chatTurn({ agent, channel: app.channels.info(room), history: [{ id: "direct-question", at: Date.now(), kind: "owner", authorName: "Sam", content: "Riporta il risultato nel canale." }], forced: true, computer: false, say: (text, target) => app.orchestrator.postDirect(agent, state, target, text) });
    assert.equal(result.text, null);
    assert.equal(result.spoken, true);
    assert.equal(calls, 3);
    assert.equal(discord.state.webhookPosts.filter((item) => item.content === "Risultato pubblicato direttamente.").length, 1);
    assert.equal(app.orchestrator.state(CHANNEL).history.at(-1).passive, true);
    assert.match(app.store.trace(result.traceId).system, /Non serve grog/);
  });

  test("direct posting respects assignments, guilds and actual read permission, including own-bot channels", async (t) => {
    const privateId = "200000000000000099";
    const agent = app.store.createAgent({ name: "Confini", tools: false, chattiness: 0, channelIds: [CHANNEL, privateId, OTHER_CHANNEL] });
    const token = "direct-private-fixture-token", own = new Discord({ token, apiBase: discord.url });
    own.user = { id: "600000000000000096", username: agent.name };
    own.listChannels = () => [{ id: privateId, name: "own-private", guildId: GUILD }, { id: OTHER_CHANNEL, name: "other-guild", guildId: OTHER_GUILD }];
    app.bots.clients.set(agent.id, { client: own });
    const state = app.orchestrator.state(`web-${agent.id}`);
    t.after(() => { app.bots.clients.delete(agent.id); app.store.deleteAgent(agent.id); discord.state.privateTo.delete(privateId); });
    assert.ok(app.channels.listFor(agent).some((channel) => channel.id === privateId));
    discord.state.privateTo.set(privateId, token);
    await app.orchestrator.postDirect(agent, state, privateId, "Messaggio nel mio canale privato.");
    assert.equal(discord.state.botPosts.at(-1).channelId, privateId);
    assert.equal(discord.state.botPosts.at(-1).token, token);
    const sent = discord.state.botPosts.length + discord.state.webhookPosts.length;
    await assert.rejects(app.orchestrator.postDirect(agent, state, OTHER_CHANNEL, "Fuori area"), /not authorized/);
    await assert.rejects(app.orchestrator.postDirect(agent, state, "web-some-other-agent", "Privato altrui"), /not authorized/);
    await assert.rejects(app.orchestrator.postDirect(agent, state, "200000000000000098", "Non assegnato"), /not authorized/);
    discord.state.privateTo.set(privateId, "some-other-bot");
    await assert.rejects(app.orchestrator.postDirect(agent, state, privateId, "Non leggibile"), /403/);
    assert.equal(discord.state.botPosts.length + discord.state.webhookPosts.length, sent);
  });

  test("reloading Discord history preserves the passive flag of delivered routine reports", async (t) => {
    const agent = app.store.createAgent({ name: "Passive reload", tools: false, chattiness: 0 });
    t.after(() => app.store.deleteAgent(agent.id));
    const state = app.orchestrator.state(CHANNEL);
    const [posted] = await app.orchestrator.postAs(agent, state, "Archived routine result.", undefined, undefined, { passive: true });
    discord.state.history.set(CHANNEL, [...(discord.state.history.get(CHANNEL) || []), posted]);
    const id = state.history.at(-1).id;
    const reloaded = { id: CHANNEL, history: [], seen: new Set() };
    await app.orchestrator.ensureHistory(reloaded);
    assert.equal(reloaded.history.find((item) => item.id === id)?.passive, true);
  });

  test("a routine that answers through say then PASS does not answer the human twice", async (t) => {
    const agent = app.store.createAgent({ name: "Solo una risposta", model: "ollama/test-model", tools: false, chattiness: 0 });
    const room = `web-${agent.id}`, state = app.orchestrator.state(room);
    let release, started = false, calls = 0;
    const gate = new Promise((resolve) => { release = resolve; });
    intentions = () => JSON.stringify({ intent: "continue", reply: "" });
    replies.set(agent.name, async () => {
      calls += 1;
      if (calls === 1) { started = true; await gate; return { tool_calls: [{ function: { name: "list_routines", arguments: {} } }] }; }
      if (calls === 2) return { tool_calls: [{ function: { name: "say", arguments: { text: "Sì, ti rispondo mentre finisco." } } }] };
      return { content: "PASS" };
    });
    t.after(() => { release(); app.store.deleteAgent(agent.id); replies.delete(agent.name); });
    const routine = app.store.createRoutine(agent.id, { name: "Risposta diretta", schedule: "0 9 * * *", channelId: room, prompt: "Controlla le routine." });
    const running = app.orchestrator.runRoutine(routine);
    await waitFor(() => started);
    await app.orchestrator.onWebMessage({ room, text: "Mi rispondi mentre finisci?" });
    await sleep(200);
    release();
    await running;
    await quiet();
    assert.equal(calls, 3);
    assert.equal(state.humanQueue.size, 0);
    assert.equal(state.history.filter((item) => item.content === "Sì, ti rispondo mentre finisco.").length, 1);
  });

  test("passive routine metadata survives a store restart", () => {
    const directory = tempHome(), store = new Store(directory);
    store.appendArchive("web", { id: "passive-result", at: Date.now(), kind: "agent", authorName: "Reporter", content: "Report", passive: true });
    store.close();
    const reopened = new Store(directory);
    try { assert.equal(reopened.recentMessages("web", 1)[0].passive, true); }
    finally { reopened.close(); }
  });

  test("one-time reminders are verified by the runtime and exposed in the persistent archive", async () => {
    const signedIn = await call("/api/login", { method: "POST", body: { password: PASSWORD }, auth: false });
    const headers = { Cookie: signedIn.headers.get("set-cookie").split(";")[0] };
    const agent = app.store.createAgent({ name: "Rina Reminder", model: "ollama/test-model", tools: false, chattiness: 0 });
    replies.set(agent.name, () => ({ content: "Promemoria consegnato." }));
    try {
      const created = await call(`/api/agents/${agent.id}/routines`, { method: "POST", headers, body: {
        kind: "reminder", name: "Un solo avviso", runAt: "2050-01-01T09:00:00+01:00", channelId: `web-${agent.id}`, prompt: "Ricorda al proprietario di controllare la ricevuta." } });
      assert.equal(created.status, 201);
      await call(`/api/routines/${created.data.id}/run`, { method: "POST", headers });
      await waitFor(() => app.store.routine(created.data.id, { archived: true }).archiveReason === "completed");
      const history = await call(`/api/routines/history?agentId=${agent.id}`, { headers });
      assert.equal(history.data.items[0].verification.met, true);
      assert.equal(history.data.items[0].output, "Promemoria consegnato.");
      assert.ok(!app.store.routines(agent.id).length);
      assert.equal((await call(`/api/routines/${created.data.id}/run`, { method: "POST", headers })).status, 404);
    } finally { app.store.deleteAgent(agent.id); replies.delete(agent.name); }
  });

  test("reminder verification uses Claude and Codex subscriptions without tools or a separate API provider", async () => {
    for (const provider of ["claude", "codex"]) {
      const agent = app.store.createAgent({ name: "Verifier " + provider, model: `${provider}/test-model`, subscriptionId: subscriptionIds[provider], tools: false, chattiness: 0 });
      cli.set({ reply: JSON.stringify({ met: true, reason: "Fixture delivery verified." }) });
      const firstCall = cli.calls().length;
      try {
        const reminder = app.store.createRoutine(agent.id, { kind: "reminder", name: "Native verification", runAt: "2050-01-01T00:00:00Z", channelId: `web-${agent.id}`, prompt: "Deliver this reminder once." });
        assert.equal((await app.orchestrator.runRoutine(reminder)).status, "completed");
        const check = cli.calls().slice(firstCall).find((run) => run.flavor === provider && run.stdin.includes("Condizione:"));
        assert.ok(check, "the subscription runtime performed the verification");
        assert.equal(check.tools, null, "the verifier has no tool bridge");
        assert.equal(app.store.routineHistory({ agentId: agent.id }).items[0].verification.met, true);
      } finally { app.store.deleteAgent(agent.id); }
    }
  });

  test("opens Agents with skeletons, global usage above the roster and individual usage below", async () => {
    const first = app.store.createAgent({ name: "Memoria", model: "ollama/test-model", enabled: false, tools: false });
    const second = app.store.createAgent({ name: "Pannello", model: "ollama/test-model", enabled: false, tools: false });
    for (const [agent, tokens] of [[first, 150], [second, 250]]) {
      const trace = app.traces.start({ agentId: agent.id, kind: "chat", channelId: "web", model: agent.model });
      trace.spent({ in: tokens - 30, out: 30 });
      trace.finish({ status: "done", output: "Ok." });
    }
    const usageReady = Promise.withResolvers();
    const paths = [];
    const source = await fetch(`${base}/assets/app.js`).then((response) => response.text());
    const panel = panelHarness({ source, language: "en", fetch: async (path, options) => {
      paths.push(path);
      if (path === "/api/usage") await usageReady.promise;
      return fetch(`${base}${path}`, { ...options, headers: { ...options?.headers, Cookie: cookie } });
    } });
    try {
      const boot = panel.run("boot()");
      assert.ok(panel.app.querySelectorAll(".loading-skeleton").length, "startup reserves space before the state arrives");
      await boot;
      assert.deepEqual(panel.app.querySelectorAll("h2").map((node) => node.textContent), ["Global usage", "The agents", "Usage by agent"]);
      assert.equal(paths.filter((path) => path === "/api/usage").length, 1, "both panels share one request");
      assert.ok(!paths.some((path) => path.includes("/rooms/")), "opening the app never opens the lounge");
      assert.equal(panel.app.querySelectorAll(".loading-skeleton").length, 3, "one chart skeleton globally and one per agent");
      usageReady.resolve();
      await waitFor(() => panel.app.querySelectorAll(".heat-block").length === 3);
      assert.equal(panel.app.querySelectorAll(".loading-skeleton").length, 0);
      assert.deepEqual(panel.app.querySelectorAll(".heat-total").map((node) => node.textContent), ["400 tokens", "150 tokens", "250 tokens"]);
      assert.equal(panel.app.querySelectorAll(".heat-head")[1].querySelector("b").textContent, "Memoria", "agent names are never translated");
      await panel.navigate("#/salotto");
      await waitFor(() => panel.app.querySelector(".chat-input"));
      assert.ok(paths.includes("/api/rooms/web/messages"), "the dedicated lounge still opens its history");
      await panel.navigate("#/");
      assert.equal(panel.app.querySelector("h1").textContent, "Agents");
    } finally {
      usageReady.resolve();
      await waitFor(() => panel.app.querySelectorAll(".loading-skeleton").length === 0);
      app.store.deleteAgent(first.id);
      app.store.deleteAgent(second.id);
    }
  });

  test("usage failures clear skeletons and a slow chat cannot replace a newer page", async () => {
    const chatReady = Promise.withResolvers();
    const panel = panelHarness({ fetch: async (path, options) => {
      if (path === "/api/usage") return new Response(JSON.stringify({ error: "unavailable" }), { status: 503 });
      if (path === "/api/rooms/web/messages") await chatReady.promise;
      return fetch(`${base}${path}`, { ...options, headers: { ...options?.headers, Cookie: cookie } });
    } });
    await panel.run("boot()");
    await waitFor(() => panel.app.querySelectorAll(".loading-skeleton").length === 0);
    assert.equal(panel.app.querySelectorAll(".muted").filter((node) => node.textContent === "Consumi non disponibili.").length, 2);
    await panel.navigate("#/salotto");
    assert.ok(panel.app.querySelector(".sk-chat"));
    await panel.navigate("#/agenti");
    chatReady.resolve();
    await sleep(50);
    assert.equal(panel.app.querySelector("h1").textContent, "Agenti");
    assert.equal(panel.run("S.live"), null, "a detached chat never takes over live events");
    assert.equal(panel.app.querySelector(".chat-input"), null);
  });

  test("usage captions, months, daily details and statuses follow the panel language", async () => {
    const source = await fetch(`${base}/assets/app.js`).then((response) => response.text());
    for (const [language, expected] of [
      ["en", { summary: "All agents", hint: "Each agent's token usage, day by day.", month: "Jan", active: "26 Oct · 1.5k tokens · 1 turn", plural: "24 Oct · 3.0k tokens · 2 turns", empty: "nothing", brand: "resident agents", stopped: "stopped", lounge: "lounge", memory: "memory", error: "Usage unavailable." }],
      ["it", { summary: "Tutti insieme", hint: "Quanti token spende ognuno, giorno per giorno.", month: "gen", active: "26 ott · 1,5k token · 1 turno", plural: "24 ott · 3,0k token · 2 turni", empty: "niente", brand: "agenti residenti", stopped: "fermato", lounge: "salotto", memory: "memoria", error: "Consumi non disponibili." }],
    ]) {
      let failUsage = false;
      const panel = panelHarness({ source, language, fetch: (path, options) => failUsage && path === "/api/usage"
        ? Promise.resolve(new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }))
        : fetch(`${base}${path}`, { ...options, headers: { ...options?.headers, Cookie: cookie } }) });
      const boot = panel.run("boot()");
      assert.equal(panel.app.querySelector(".loading-skeleton").attributes["aria-label"], language === "en" ? "Loading…" : "Caricamento…");
      await boot;
      await waitFor(() => panel.app.querySelector(".heat-block"));
      assert.equal(panel.app.querySelector(".heat-head").querySelector("b").textContent, expected.summary);
      assert.ok(panel.app.textContent.includes(expected.hint));
      assert.ok(panel.app.querySelector(".brand").textContent.includes(expected.brand));
      assert.equal(panel.run("MONTHS[0]"), expected.month);
      assert.equal(panel.run("tokenTotal(1)"), "1 token");
      assert.equal(panel.run("tag(TRACE_STATUS.stopped[0]).textContent"), expected.stopped);
      assert.equal(panel.run('channelName("web")'), expected.lounge);
      assert.equal(panel.run('traceWhere({kind:"sleep"})'), expected.memory);
      const chart = panel.run('heatmap(new Map([["2026-10-26", {tokens:1500, turns:1}], ["2026-10-24", {tokens:3000, turns:2}]]), {today:"2026-10-26"})');
      const titles = chart.querySelectorAll(".heat-cell").map((node) => node.attributes.title).filter(Boolean);
      assert.ok(titles.includes(expected.active));
      assert.ok(titles.includes(expected.plural));
      assert.ok(titles.some((title) => title.endsWith(expected.empty)));
      const card = panel.run('agentCard({ id:"test", name:"Memoria", model:"ollama/test-model", enabled:true, tools:false, chattiness:0.5 }, 0)');
      assert.equal(card.querySelector(".meter").attributes.title, language === "en" ? "Chattiness 50" : "Loquacità 50");
      assert.equal(card.querySelector(".monitor").attributes["aria-label"], language === "en" ? "Memoria's desktop" : "Desktop di Memoria");
      failUsage = true;
      await panel.navigate("#/agenti");
      await waitFor(() => panel.app.querySelectorAll(".loading-skeleton").length === 0);
      assert.equal(panel.app.querySelectorAll(".muted").filter((node) => node.textContent === expected.error).length, 2);
    }
  });

  test("usage starts at each first recorded day, keeps gaps and never invents earlier history", async () => {
    const agents = ["Earlier", "Newer", "Quiet"].map((name) => app.store.createAgent({ name, model: "ollama/test-model", enabled: false, tools: false }));
    const { today } = (await call("/api/usage")).data;
    const start = new Date(`${today}T12:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 10);
    const firstDay = start.toISOString().slice(0, 10);
    for (const [agent, day] of [[agents[0], firstDay], [agents[1], today]]) {
      const trace = app.traces.start({ agentId: agent.id, kind: "chat", model: agent.model });
      trace.startedAt = `${day}T12:00:00.000Z`;
      trace.spent({ in: 100, out: 20 });
      trace.finish({ status: "done" });
    }
    try {
      const panel = panelHarness({ language: "en", fetch: (path, options) => fetch(`${base}${path}`, { ...options, headers: { ...options?.headers, Cookie: cookie } }) });
      await panel.run("boot()");
      await waitFor(() => panel.app.querySelectorAll(".heat-block").length === 4);
      const grids = panel.app.querySelectorAll(".heat-grid");
      const dated = (grid) => grid.querySelectorAll(".heat-cell").map((node) => node.attributes["data-day"]).filter(Boolean);
      assert.equal(grids.length, 3, "a quiet agent has an empty state instead of a fictional calendar");
      assert.equal(dated(grids[0]).length, 11);
      assert.equal(dated(grids[0])[0], firstDay);
      assert.equal(dated(grids[0]).at(-1), today);
      assert.deepEqual(dated(grids[1]), dated(grids[0]));
      assert.deepEqual(dated(grids[2]), [today], "a new agent shows only today's record");
      assert.ok(grids[0].querySelectorAll(".l0").length > 0, "quiet days after first usage remain in the timeline");
      assert.ok(panel.app.textContent.includes("No usage yet."));
      const crossYear = panel.run('heatmap(new Map([["2027-01-02", {tokens:5, turns:1}], ["2026-12-31", {tokens:10, turns:1}]]), {today:"2027-01-02"})');
      assert.deepEqual(dated(crossYear), ["2026-12-31", "2027-01-01", "2027-01-02"]);
      assert.match(crossYear.querySelector(".heat-range").textContent, /2026.*2027/);
      assert.equal(panel.run('heatmap(new Map(), {today:"2026-10-26"}).textContent'), "No usage yet.");
    } finally {
      for (const agent of agents) app.store.deleteAgent(agent.id);
    }
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
    assert.deepEqual(state.data.providers, { claude: true, codex: true, grok: true, muse: true, ollama: true, ollamaLocal: true, ollamaCloud: true, orcarouter: true, hermes: true });
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

  test("a thread runs one task at a time: a routine landing on a thread already at work is skipped, not run beside it", async () => {
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
    assert.equal(together, 1, "never two sessions of the same agent in one thread");
    const routines = (await call("/api/state")).data.routines.filter((r) => r.agentId === created.data.id);
    assert.ok(routines.some((r) => r.lastStatus === "skipped"), "the one that landed on a busy agent says it was skipped");
    const skipped = routines.find((r) => r.lastStatus === "skipped");
    assert.match(skipped.lastOutput || "", /stava già lavorando/);
    await call(`/api/agents/${created.data.id}`, { method: "PUT", body: { enabled: false } });
  });

  test("an agent works in several threads at once, each with its own computer: asked in two places, it is two instances", async () => {
    const created = await call("/api/agents", { method: "POST", body: { name: "Nilo", model: "ollama/test-model", chattiness: 0, tools: true, channelIds: [CHANNEL] } });
    assert.equal(created.status, 201);
    const id = created.data.id;
    const here = await call(`/api/agents/${id}/routines`, { method: "POST", body: { name: "Qui", schedule: "0 9 * * *", channelId: CHANNEL, prompt: "Lavora qui" } });
    const there = await call(`/api/agents/${id}/routines`, { method: "POST", body: { name: "Là", schedule: "0 10 * * *", channelId: `web-${id}`, prompt: "Lavora là" } });
    let running = 0;
    let together = 0;
    const computers = [];
    replies.set("Nilo", async (body) => {
      running += 1;
      together = Math.max(together, running);
      computers.push(body.tools.some((tool) => tool.function.name === "shell"));
      await sleep(1500);
      running -= 1;
      return { content: "Fatto." };
    });
    await Promise.all([here, there].map((routine) => call(`/api/routines/${routine.data.id}/run`, { method: "POST" })));
    await waitFor(async () => (await call("/api/state")).data.routines.filter((routine) => routine.agentId === id).every((routine) => routine.lastStatus === "posted"), { what: "both threads done", timeout: 20000 });
    assert.equal(together, 2, "one instance per thread, side by side");
    assert.deepEqual(computers.slice(0, 2), [true, true], "each instance has the agent's computer, not only the first");
    await call(`/api/agents/${id}`, { method: "PUT", body: { enabled: false } });
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
    assert.deepEqual(JSON.parse(run.argv[run.argv.indexOf("--settings") + 1]), { disableAllHooks: true }, "the owner's hooks stay out: the Cora harness runs doc");
    assert.deepEqual(run.secretEnv, [], "no bot token reaches the CLI");
    assert.match(run.argv[run.argv.indexOf("--system-prompt") + 1], /^Sei Clara\./);
    assert.match(run.argv[run.argv.indexOf("--system-prompt") + 1], /<istruzioni_personali>\n# Global Agent Instructions\nISTRUZIONI DI PROVA/);
    // Its own routines travel with it: they are the agent's own, not the owner's computer.
    assert.deepEqual(run.argv[run.argv.indexOf("--allowedTools") + 1].split(","), ["mcp__cora__say", "mcp__cora__list_channels", "mcp__cora__remember", "mcp__cora__forget", "mcp__cora__recall", "mcp__cora__update_core", "mcp__cora__list_routines", "mcp__cora__set_routine", "mcp__cora__set_reminder", "mcp__cora__routine_history", "mcp__cora__delete_routine", "mcp__cora__notify", "mcp__cora__ask_owner"]);
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

  test("an agent on Grok Build uses cora's tools over MCP, in a Grok home of Cora's own and none of the owner's setup", async () => {
    const created = await call("/api/agents", { method: "POST", body: { name: "Greta", model: "grok/grok-4.7", subscriptionId: subscriptionIds.grok, chattiness: 0, tools: false } });
    assert.equal(created.status, 201);
    cli.set({ tool: "remember", args: { fact: "La riunione con i fornitori è giovedì" }, reply: "Segnato.", thinking: "Lo salvo." });
    discord.say({ content: "Greta, ricordati che la riunione con i fornitori è giovedì" });
    const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Greta"), { what: "Greta's reply" });
    assert.match(post.content, /^Segnato\. \[saved \[mem_/);
    const run = cli.calls().find((item) => item.flavor === "grok" && /^Sei Greta\./.test(item.argv[item.argv.indexOf("--system-prompt-override") + 1] || ""));
    assert.equal(run.argv[run.argv.indexOf("-m") + 1], "grok-4.7");
    assert.equal(run.argv[run.argv.indexOf("--tools") + 1], "search_tool,use_tool", "Grok's own shell, files and web are off");
    assert.equal(run.argv[run.argv.indexOf("--output-format") + 1], "streaming-messages-json");
    assert.ok(run.argv.includes("--always-approve") && run.argv.includes("--no-memory") && run.argv.includes("--no-subagents"));
    assert.match(run.stdin, /Greta, ricordati che la riunione con i fornitori è giovedì/, "the prompt arrives in a file, not in an argument");
    assert.ok(run.tools.includes("remember") && !run.tools.includes("shell"));
    const account = join(home, "subscriptions", subscriptionIds.grok);
    assert.equal(dirname(run.env.GROK_HOME), join(home, "cli-work", subscriptionIds.grok), "a Grok home for this turn alone");
    assert.ok(!existsSync(run.env.GROK_HOME), "gone with the turn, and with it every session Grok keeps on disk");
    assert.equal(run.env.GROK_AUTH_PATH, join(account, "auth.json"), "the account's login, read where it lives");
    assert.equal(run.env.HOME, join(run.env.GROK_HOME, "home"), "an empty HOME: the owner's ~/.claude never reaches Grok");
    assert.equal(run.env.GROK_CLAUDE_MCPS_ENABLED, "0");
    assert.equal(run.env.GROK_CLAUDE_HOOKS_ENABLED, "0");
    assert.equal(run.env.MISE_DATA_DIR, process.env.MISE_DATA_DIR || join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "mise"), "a mise-wrapped grok (Omarchy) still finds its tools under the empty HOME");
    assert.match(run.grokConfig, /\[mcp_servers\.cora\][\s\S]*CORA_BRIDGE_TOKEN = "\$\{CORA_BRIDGE_TOKEN\}"/, "the run token never lands in the file");
    assert.deepEqual(run.secretEnv, []);
    const memories = await call(`/api/agents/${created.data.id}/memories`);
    assert.ok(memories.data.facts.some((memory) => memory.text === "La riunione con i fornitori è giovedì"));
    const [summary] = (await call(`/api/agents/${created.data.id}/traces`)).data;
    const trace = (await call(`/api/traces/${summary.id}`)).data;
    assert.ok(trace.steps.some((step) => step.type === "thinking" && step.text === "Lo salvo."));
    assert.ok(trace.steps.some((step) => step.type === "text" && step.text === "Prima controllo."), "text between tool calls is kept");
    assert.equal(trace.steps.find((step) => step.type === "tool").name, "remember");
    await call(`/api/agents/${created.data.id}`, { method: "DELETE" });
  });

  test("an agent on Muse Code uses cora's tools over MCP, with Cora's system prompt and Meta's training off", async () => {
    const created = await call("/api/agents", { method: "POST", body: { name: "Mila", model: "muse/muse-wonder-1.0", subscriptionId: subscriptionIds.muse, chattiness: 0, tools: false } });
    assert.equal(created.status, 201);
    cli.set({ tool: "remember", args: { fact: "Il fornitore di carta è Rossi" }, reply: "Fatto." });
    discord.say({ content: "Mila, ricordati che il fornitore di carta è Rossi" });
    const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Mila"), { what: "Mila's reply" });
    assert.match(post.content, /^Fatto\. \[saved \[mem_/);
    const run = cli.calls().find((item) => item.flavor === "muse" && (item.argv.find((arg) => arg.startsWith("run.system_prompt=")) || "").includes("Sei Mila."));
    assert.equal(run.argv[0], "exec");
    assert.equal(run.argv[run.argv.indexOf("--model") + 1], "muse-wonder-1.0");
    assert.equal(run.argv[run.argv.indexOf("--preset") + 1], "empty", "no built-in tools: only Cora's");
    assert.equal(run.argv[run.argv.indexOf("--contributor-mode") + 1], "off", "Meta does not train on the agent's turns");
    assert.equal(run.argv[run.argv.indexOf("--approval-mode") + 1], "never");
    for (const flag of ["--json", "--no-foreign-personal-context", "--disable-reminders", "--no-session-log", "--disable-web-tools"]) assert.ok(run.argv.includes(flag), flag);
    assert.match(JSON.parse(run.argv.find((arg) => arg.startsWith("run.system_prompt=")).slice("run.system_prompt=".length)), /^Sei Mila\./);
    assert.match(run.argv.find((arg) => arg.startsWith("mcpServers.cora=")), /"CORA_BRIDGE_TOKEN":"\$\{CORA_BRIDGE_TOKEN\}"/, "the run token stays out of the arguments");
    assert.match(run.stdin, /Mila, ricordati che il fornitore di carta è Rossi/);
    const account = join(home, "subscriptions", subscriptionIds.muse);
    assert.equal(run.env.XDG_CONFIG_HOME, account);
    assert.equal(run.env.XDG_DATA_HOME, join(account, "data"));
    assert.equal(run.env.TBH_CREDENTIAL_BACKEND, "file", "the login stays in a file, never in a Keychain a service cannot reach");
    assert.ok(run.tools.includes("remember") && !run.tools.includes("shell"));
    const memories = await call(`/api/agents/${created.data.id}/memories`);
    assert.ok(memories.data.facts.some((memory) => memory.text === "Il fornitore di carta è Rossi"));
    const [summary] = (await call(`/api/agents/${created.data.id}/traces`)).data;
    const trace = (await call(`/api/traces/${summary.id}`)).data;
    assert.ok(trace.steps.some((step) => step.type === "text" && step.text === "Prima controllo."), "what it wrote before the tool is its reasoning");
    assert.equal(trace.steps.find((step) => step.type === "tool").name, "remember");
    assert.match(trace.output, /^Fatto\./);
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

  test("agent calls become real Discord mentions without tagging code, email addresses or inaccessible colleagues", async (t) => {
    const login = await call("/api/login", { method: "POST", body: { password: PASSWORD }, auth: false });
    cookie = login.headers.get("set-cookie").split(";")[0];
    const recipients = [{ name: "Tagger", token: "tagger-token", id: "600000000000000041" }, { name: "Receiver", token: "receiver-token", id: "600000000000000042" }];
    const agents = [];
    t.after(async () => {
      discord.state.privateTo.delete(CHANNEL);
      for (const item of recipients) delete botTokens[`CORA_BOT_${item.name.toUpperCase()}`];
      for (const agent of agents) await call(`/api/agents/${agent.id}`, { method: "DELETE" });
    });
    for (const item of recipients) {
      botTokens[`CORA_BOT_${item.name.toUpperCase()}`] = item.token;
      discord.state.botUsers.set(item.token, { id: item.id, username: item.name });
      const created = await call("/api/agents", { method: "POST", body: { name: item.name, model: "ollama/test-model", tools: false, chattiness: 0, channelIds: [CHANNEL] } });
      assert.equal(created.status, 201);
      agents.push(created.data);
      await waitFor(() => app.bots.client(created.data.id)?.user?.id === item.id);
    }
    const state = app.orchestrator.state(CHANNEL);
    const text = "Receiver, registro consegnato. @Receiver controlla. ReceiverExtra resta testo. x@Receiver.it resta email. `@Receiver` resta codice.\n```\n@Receiver\n```";
    await app.orchestrator.postAs(agents[0], state, text, undefined, undefined, { passive: true });
    const delivered = discord.state.botPosts.filter((post) => post.token === "tagger-token").at(-1);
    assert.match(delivered.content, /^<@600000000000000042>, registro consegnato\. <@600000000000000042> controlla/);
    assert.match(delivered.content, /ReceiverExtra.*x@Receiver\.it.*`@Receiver`.*```\n@Receiver\n```/s);
    assert.deepEqual(delivered.allowed_mentions, { parse: ["users"] });
    assert.equal(state.history.at(-1).content, text, "readable names remain in the archive");
    assert.equal(state.history.at(-1).passive, true, "a mention does not start another routine round");
    discord.state.privateTo.set(CHANNEL, "tagger-token");
    await app.orchestrator.postAs(agents[0], state, "@Receiver cannot read this channel.", undefined, undefined, { passive: true });
    assert.equal(discord.state.botPosts.filter((post) => post.token === "tagger-token").at(-1).content, "@Receiver cannot read this channel.");
    discord.state.privateTo.delete(CHANNEL);
    const previousGoalMode = app.store.settings.goalMode;
    t.after(() => app.store.updateSettings({ goalMode: previousGoalMode }));
    app.store.updateSettings({ goalMode: true });
    goals = () => "Receiver riceve la notifica in general con vera menzione";
    app.store.updateAgent(agents[0].id, { tools: true });
    let checked = 0, step = 0;
    checks = (body) => {
      checked++;
      assert.match(body.messages[1].content, new RegExp(`Cora delivery receipt: \\{"channel_id":"${CHANNEL}","channel_name":"general","message_ids":\\["\\d+"\\],"mentions":\\["600000000000000042"\\]\\}`));
      assert.match(body.messages[0].content, /Se la conversazione corrente è il canale richiesto/);
      return JSON.stringify({ met: true });
    };
    replies.set("Tagger", () => ++step <= 2 ? { tool_calls: [{ function: { name: "say", arguments: { text: "@Receiver, notifica consegnata." } } }] } : { content: "PASS" });
    const notice = app.store.createRoutine(agents[0].id, { name: "Notify colleague", schedule: "0 9 * * *", channelId: CHANNEL, prompt: "Notifica Receiver in general con una vera menzione." });
    const before = discord.state.botPosts.length;
    await app.orchestrator.runRoutine(notice);
    assert.equal(checked, 1, "the verifier sees the actual current-channel delivery proof");
    assert.equal(discord.state.botPosts.length - before, 1, "repeated tool calls return the original delivery instead of posting twice");
  });

  test("people on the team become real Discord mentions too: who wrote on this server or was tagged there, never a shared name or another server's", async (t) => {
    const postina = app.store.createAgent({ name: "Postina", model: "ollama/test-model", tools: false, chattiness: 0 });
    t.after(() => app.store.deleteAgent(postina.id));
    const state = app.orchestrator.state(CHANNEL);
    // Old enough never to come back in a transcript.
    const wrote = (id, name, channel = CHANNEL) => app.store.appendArchive(channel, { id: `person-${id}-${name}`, at: 1000, authorId: id, authorName: name, kind: "human", agentId: null, content: "ciao" });
    wrote("700000000000000071", "Lia");
    wrote("700000000000000073", "Anna");
    wrote("700000000000000074", "Anna");
    wrote("700000000000000075", "Postina");
    wrote("700000000000000076", "Ugo", OTHER_CHANNEL);
    // Tagged by the owner before ever writing.
    app.orchestrator.toItem({
      id: "person-mention", channel_id: CHANNEL, guild_id: GUILD, content: "chiedi a <@700000000000000072>", timestamp: new Date().toISOString(),
      author: { id: OWNER, username: "sam", global_name: "Sam" }, mentions: [{ id: "700000000000000072", username: "bruno.r", global_name: "Bruno" }],
    });
    const text = "@Lia e @Bruno: è pronto. @Anna resta testo, `@Lia` resta codice, @Postina è un agente, @Ugo è di un altro server.";
    await app.orchestrator.postAs(postina, state, text, undefined, undefined, { passive: true });
    const delivered = discord.state.webhookPosts.filter((post) => post.username === "Postina").at(-1);
    assert.equal(delivered.content, "<@700000000000000071> e <@700000000000000072>: è pronto. @Anna resta testo, `@Lia` resta codice, @Postina è un agente, @Ugo è di un altro server.");
    assert.equal(state.history.at(-1).content, text, "readable names remain in the archive");
  });

  test("an owner task shares a file through Cora and refuses a disabled recipient", async (t) => {
    const sender = app.store.createAgent({ name: "File sender", model: "ollama/test-model", tools: true, chattiness: 0 });
    const recipient = app.store.createAgent({ name: "File recipient", model: "ollama/test-model", tools: true, chattiness: 0 });
    const original = app.boxes.shareFile;
    const deliveries = [];
    app.boxes.shareFile = async (...args) => { deliveries.push(args); return { path: "/home/agent/work/shared/cases-abc.csv", sha256: "abc", bytes: 42 }; };
    t.after(() => { app.boxes.shareFile = original; app.store.deleteAgent(sender.id); app.store.deleteAgent(recipient.id); replies.delete(sender.name); });
    let step = 0;
    replies.set(sender.name, () => ++step === 1 ? { tool_calls: [{ function: { name: "share_file", arguments: { path: "/home/agent/work/cases.csv", agent: recipient.name } } }] } : { content: "Registro consegnato e verificato." });
    const task = app.store.createRoutine(sender.id, { name: "Deliver cases", schedule: "0 9 * * *", channelId: CHANNEL, prompt: "Consegna il registro autorizzato al destinatario." });
    await app.orchestrator.runRoutine(task);
    assert.deepEqual(deliveries, [[sender.id, recipient.id, "/home/agent/work/cases.csv"]]);
    app.store.updateAgent(recipient.id, { enabled: false });
    step = 0;
    await app.orchestrator.runRoutine(app.store.routine(task.id), { manual: true });
    assert.equal(deliveries.length, 1, "a disabled recipient receives no file");
    const trace = app.store.traces(sender.id, 1)[0];
    assert.match(app.store.trace(trace.id).steps.find((item) => item.name === "share_file").result, /error: recipient/);
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

  test("an agent at work shows it the way a person does, without a line in the channel", async () => {
    const before = discord.state.typing;
    let turn = 0;
    replies.set("Olga", async () => {
      turn += 1;
      if (turn === 1) return { content: "Eccomi, dimmi." };
      // Long enough that the indicator has to be refreshed rather than sent once.
      await sleep(9000);
      return { content: "Fatto, guardato." };
    });
    discord.say({ content: "Olga, ci sei?" });
    await waitFor(() => posts("Olga").includes("Eccomi, dimmi."), { what: "Olga's quick answer" });
    await quiet();
    const afterQuick = discord.state.typing;
    assert.ok(afterQuick > before, "she is shown as typing while she thinks");

    discord.say({ content: "Olga, allora guarda quella cosa" });
    await waitFor(() => posts("Olga").includes("Fatto, guardato."), { what: "Olga's slower answer", timeout: 25000 });
    await quiet();
    assert.ok(discord.state.typing - afterQuick >= 2, "a long turn keeps the indicator alive instead of saying it is on it");
    assert.ok(!posts("Olga").some((text) => /Ricevuto, ci lavoro/.test(text)), "and nothing is posted to say so");
  });

  test("a busy agent gets the new messages while it works, and a named agent that passes is asked again", async () => {
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
    await quiet();

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
    intentions = (body) => JSON.stringify({ intent: lastUserText(body).includes("Pino, ci sei?") ? "continue" : "update" });
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
    assert.ok(models.includes("hermes/test-model-big:cloud"), "Ollama Cloud models through the local Ollama");
    assert.ok(!models.includes("hermes/test-model:cloud"), "a model installed here has no cloud twin to invent");
    assert.ok(models.includes("hermes/orcarouter/vendor/brand-new-model") || models.some((id) => id.startsWith("hermes/orcarouter/")),
      "a router's models are Hermes' too, at the router's address");
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

  test("Cora harness: an agent on Hermes that says it saved something without calling a tool is sent back to do it, and the claim never reaches the chat", async (t) => {
    await call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "hermes/test-model" } });
    const fact = "La riunione con i fornitori è giovedì.";
    t.after(async () => {
      await call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "ollama/test-model" } });
      for (const item of (await call(`/api/agents/${olga.id}/memories`)).data.facts.filter((item) => item.text === fact)) {
        await call(`/api/agents/${olga.id}/memories/${item.id}`, { method: "DELETE" });
      }
    });
    const before = cli.calls().length;
    cli.set({ from: cli.calls().filter((item) => item.flavor === "hermes").length, runs: [
      { reply: `Salvato in memoria: ${fact}` },
      { reply: "Adesso è davvero in memoria.", tool: "remember", args: { fact } },
    ] });
    discord.say({ content: "Olga, ricordati che la riunione con i fornitori è giovedì" });
    await waitFor(() => posts("Olga").some((text) => text.startsWith("Adesso è davvero in memoria.")), { what: "Olga's answer once she has really saved it" });
    await quiet();
    const runs = cli.calls().slice(before).filter((item) => item.flavor === "hermes");
    assert.equal(runs.length, 2, "sent back once, and not again once it has used a tool");
    assert.match(runs[1].argv[runs[1].argv.indexOf("-z") + 1], /in questo turno non hai usato nessuno strumento: quindi non sono successe/);
    assert.ok(!posts("Olga").some((text) => text.startsWith("Salvato in memoria")), "the claim that never happened is not posted");
    assert.ok((await call(`/api/agents/${olga.id}/memories`)).data.facts.some((item) => item.text === fact), "the second time the fact is really in her memory");
  });

  test("Cora harness: an agent that says it created a file without calling a tool is sent back once, and can take the claim back", async () => {
    const nudges = [];
    replies.set("Olga", (body) => {
      const last = body.messages[body.messages.length - 1];
      if (last.role === "user" && String(last.content).startsWith("[Cora] Nella risposta")) {
        nudges.push(last.content);
        return { content: "Correggo: il file non l'ho creato, qui non ho un computer." };
      }
      return { content: "Ho creato il file report.md sul desktop." };
    });
    discord.say({ content: "Olga, prepara il report sul desktop" });
    await waitFor(() => posts("Olga").some((text) => text.startsWith("Correggo:")), { what: "Olga taking the claim back" });
    await quiet();
    assert.equal(nudges.length, 1, "sent back once");
    assert.ok(!posts("Olga").includes("Ho creato il file report.md sul desktop."), "the false claim is not posted");
  });

  test("Cora harness: an agent that only looked something up and says it saved a file is sent back to do it", async () => {
    const nudges = [];
    let step = 0;
    replies.set("Olga", (body) => {
      const last = body.messages[body.messages.length - 1];
      if (last.role === "user" && String(last.content).startsWith("[Cora] Nella risposta")) nudges.push(last.content);
      // Once sent back she stays honest, whatever else the harness asks her.
      if (nudges.length) return { content: "Correggo: il riepilogo non l'ho salvato, ho solo letto le routine." };
      if (++step === 1) return { tool_calls: [{ function: { name: "list_routines", arguments: {} } }] };
      return { content: "Fatto: riepilogo salvato in /home/agent/Desktop/routine.md." };
    });
    discord.say({ content: "Olga, salva un riepilogo delle routine sul desktop" });
    await waitFor(() => posts("Olga").some((text) => text.startsWith("Correggo:")), { what: "Olga taking back a file she only looked up" });
    await quiet();
    assert.equal(nudges.length, 1, "sent back once");
    assert.match(nudges[0], /hai solo consultato \(list_routines\): nessuno strumento le ha fatte/);
    assert.ok(!posts("Olga").some((text) => text.includes("salvato in /home/agent")), "the false claim is not posted");
  });

  test("Cora harness: an agent that answers with say and then only notes the message went out posts the answer once", async () => {
    let receipt = "", step = 0;
    replies.set("Olga", (body) => {
      const last = body.messages[body.messages.length - 1];
      if (last.role === "tool") receipt = String(last.content);
      if (++step === 1) return { tool_calls: [{ function: { name: "say", arguments: { text: "Ciao Sebastiano." } } }] };
      return { content: "Messaggio già in #general." };
    });
    discord.say({ content: "Olga, ciao!" });
    await waitFor(() => posts("Olga").includes("Ciao Sebastiano."), { what: "the greeting" });
    await quiet();
    assert.ok(!posts("Olga").includes("Messaggio già in #general."), "the delivery note is not posted");
    assert.match(receipt, /Your final reply is posted here too.*end with just PASS/, "and the say receipt tells her so");

    // A first note and then a real answer are both posted.
    step = 0;
    replies.set("Olga", () => {
      step += 1;
      if (step === 1) return { tool_calls: [{ function: { name: "say", arguments: { text: "Ci guardo." } } }] };
      if (step === 2) return { tool_calls: [{ function: { name: "list_routines", arguments: {} } }] };
      return { content: "Non hai routine in programma." };
    });
    discord.say({ content: "Olga, che routine ho?" });
    await waitFor(() => posts("Olga").includes("Non hai routine in programma."), { what: "the answer after the first note" });
    await quiet();
    assert.ok(posts("Olga").indexOf("Ci guardo.") < posts("Olga").indexOf("Non hai routine in programma."));
  });

  test("Hermes on a router's model talks to the router, with a key it is handed and never writes down", async (t) => {
    await call("/api/state");
    assert.equal((await call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "hermes/orcarouter/vendor/router-model" } })).status, 200);
    t.after(() => call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "ollama/test-model" } }));
    const before = cli.calls().length;
    cli.set({ reply: "Fatto passando dal router." });
    discord.say({ content: "Olga, prova il router" });
    await waitFor(() => posts("Olga").some((text) => text.startsWith("Fatto passando dal router.")), { what: "Olga's answer through Hermes on the router" });
    await quiet();
    const run = cli.calls().slice(before).find((item) => item.flavor === "hermes");
    assert.equal(run.argv[run.argv.indexOf("-m") + 1], "vendor/router-model", "the router's own id, without the address it was routed by");
    assert.ok(run.hermesConfig.includes(`base_url: "${orca.url.replace(/\/$/, "")}"`), "Hermes is pointed at the router");
    assert.match(run.hermesConfig, /api_key: "\$\{CORA_ENDPOINT_KEY\}"/, "the file names the key, it does not hold it");
    assert.ok(!run.hermesConfig.includes("sk-orca-test"), "the key value never lands in Hermes' config");
    assert.equal(run.endpointKey, "set", "the run itself is handed the key");
    assert.match(run.hermesHome, /-orcarouter$/, "a router's turns keep their own Hermes home, so parallel turns never rewrite each other's config");
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

    const SHARED = "1599000000000000901";
    fake.dispatch("CHANNEL_CREATE", { id: SHARED, name: "strategy", guild_id: GUILD, type: 0 });
    fake.state.privateTo.set(SHARED, "pia-token");
    other.store.updateAgent(vale.id, { chattiness: 1 });
    let unexpected = 0;
    replies.set("Vale", () => { unexpected++; return { content: "Non devo entrare." }; });
    replies.set("Pia", () => ({ content: "Leggo io il documento nel mio canale." }));
    fake.say({ channel: SHARED, content: "Analizziamo questo documento" });
    await waitFor(() => fake.state.botPosts.some((item) => item.channelId === SHARED && item.content === "Leggo io il documento nel mio canale."), { what: "only the agent able to read the listener's channel responding" });
    assert.equal(unexpected, 0, "the main listener's access never admits an absent colleague");
    assert.ok(!fake.state.webhookPosts.some((item) => item.channelId === SHARED && item.username === "Vale"));
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

describe("what runs the models", () => {
  test("a model on this machine is told apart from one in the cloud, and the panel can see the cards", async () => {
    const state = (await call("/api/state")).data;
    const local = state.models.find((model) => model.id === "ollama/test-model");
    const cloud = state.models.find((model) => model.id === "ollama/test-model-big:cloud");
    assert.equal(local.local, true, "the fixture Ollama answers on 127.0.0.1: that one is here");
    assert.equal(cloud.local, false, "a :cloud model runs somewhere else, even through a local Ollama");
    assert.equal(local.size, 18_600_000_000, "its size is shown so nobody picks a model the card cannot hold");

    const hardware = (await call("/api/hardware")).data;
    assert.equal(hardware.ollama.local, true);
    assert.equal(hardware.ollama.reachable, true);
    assert.equal(hardware.ollama.version, "0.16.2");
    assert.deepEqual(hardware.loaded.map((model) => [model.name, model.vram]), [["test-model", 17_100_000_000]]);
    assert.ok(Array.isArray(hardware.gpus), "a host without a card reports none instead of failing");
  });

  test("the brain is its own tab: a harness on the left, where the model runs on the right", async () => {
    // It starts in the cloud, so a save that changed nothing could not pass for one that did.
    const agent = app.store.createAgent({ name: "Cervellone", model: "ollama/test-model-big:cloud", tools: false, chattiness: 0 });
    const panel = panelHarness({ language: "en", fetch: (path, options) => fetch(`${base}${path}`, { ...options, headers: { ...options?.headers, Cookie: cookie } }) });
    await panel.run("boot()");
    await panel.navigate(`#/agent/${agent.id}/cervello`);
    await waitFor(() => panel.app.querySelectorAll(".harness-row").length === 6);
    assert.deepEqual(panel.app.querySelectorAll(".harness-row").map((node) => node.querySelector(".harness-name").textContent),
      ["Cora's harness", "Claude Code", "Codex", "Grok Build", "Muse Code", "Hermes"], "every harness, as a list and not a dropdown");
    // It opens on the side the agent is already on: the cloud.
    const places = panel.app.querySelector(".segmented");
    assert.deepEqual(places.children.map((node) => node.textContent), ["On this machine", "In the cloud"]);
    assert.equal(places.children.find((node) => node.className === "on").textContent, "In the cloud");
    assert.ok(panel.app.querySelectorAll(".model-row").some((node) => node.textContent.includes("test-model-big:cloud")));

    // The other side lists what this machine has, with its weight.
    places.children[0].click();
    await waitFor(() => panel.app.querySelectorAll(".model-row").some((node) => node.textContent.includes("18.6 GB")));
    const here = panel.app.querySelectorAll(".model-row").find((node) => node.querySelector(".row-title").textContent.startsWith("test-model"));
    assert.ok(here, "the models of this machine are the ones offered for the local side");

    // Choosing one and saving sends only the brain's half of the agent.
    here.click();
    panel.app.querySelector("form").dispatch("submit");
    await waitFor(() => app.store.agent(agent.id).model === "ollama/test-model");
    assert.equal(app.store.agent(agent.id).name, "Cervellone", "the profile is a different tab and a different save");
  });

  test("a harness this machine cannot run says what it needs, and is never saved", async () => {
    // dopamina's machine: a card and a local Ollama, Claude Code, no Codex, no Hermes, no
    // OrcaRouter key, and a cloud the local Ollama lists without being paired to it.
    const agent = { id: "ag_x", name: "Dina", model: "ollama/qwen3:14b", enabled: true, tools: true, chattiness: 0.4, channelIds: [], color: "#e8a33d", memoryCount: 0 };
    const state = {
      agents: [agent], channels: [], routines: [], subscriptions: [], requests: [], guilds: [], discordChannels: [],
      models: [
        { id: "ollama/qwen3:14b", provider: "ollama", label: "qwen3:14b", local: true, size: 9_300_000_000, tools: true },
        { id: "ollama/deepseek-v4.1-flash:cloud", provider: "ollama", label: "deepseek-v4.1-flash:cloud", local: false, tools: true, usable: false, reason: "questa macchina non è collegata a Ollama Cloud" },
        { id: "claude/claude-sonnet-5-5", provider: "claude", label: "Sonnet 5.5", local: false, tools: true, vision: true },
      ],
      providers: { claude: true, codex: false, ollama: true, ollamaLocal: true, ollamaCloud: false, orcarouter: false, hermes: false },
      ollamaCloud: { signedIn: false, signinUrl: "https://ollama.com/connect?name=fixture" }, keys: { ollama: false, orcarouter: false },
      // Exactly what dopamina had: a default no Ollama on this machine lists at all.
      settings: { defaultModel: "ollama/deepseek-v4.1-flash", useResidentSubscriptions: false },
      transport: "discord", discord: { state: "ready", user: null, guilds: [] }, telegram: { state: "missing-token" }, slack: null,
      push: { enabled: false, publicKey: "", devices: 0 }, currentUser: { id: "u", name: "Owner", role: "owner" },
      access: { hosted: false, canManage: true }, boxImage: { name: "cora-box:latest", ready: true }, timezone: "Europe/Rome",
    };
    const puts = [];
    const reply = (body) => new Response(JSON.stringify(body));
    const panel = panelHarness({ language: "en", hash: `#/agent/${agent.id}/cervello`, fetch: async (path, options) => {
      if (path === "/api/me") return reply({ authed: true });
      if (path === "/api/state") return reply(state);
      if (path === "/api/activity") return reply([]);
      if (path === "/api/hardware") return reply({ gpus: [], hosts: [], loaded: [] });
      if (options?.method === "PUT") puts.push(path);
      return reply({});
    } });
    await panel.run("boot()");
    await waitFor(() => panel.app.querySelectorAll(".harness-row").length === 6);
    const side = () => panel.app.querySelector(".brain-side");
    const row = (name) => panel.app.querySelectorAll(".harness-row").find((node) => node.querySelector(".harness-name").textContent.startsWith(name));
    assert.ok(!row("Cora's harness").querySelector(".harness-flag"), "a missing router does not make Cora's harness missing");
    assert.equal(row("Codex").querySelector(".harness-flag").textContent, "not installed");
    assert.equal(row("Grok Build").querySelector(".harness-flag").textContent, "not installed", "a machine without Grok says so instead of hiding it");

    // Its own cloud: listed, but not choosable, and the default that points there neither.
    panel.app.querySelector(".segmented").children[1].click();
    assert.match(side().querySelector(".notice").textContent, /Ollama Cloud is not connected/);
    assert.ok(side().querySelectorAll(".model-row").every((node) => "disabled" in node.attributes));
    const fallback = side().querySelectorAll(".model-row").find((node) => node.textContent.startsWith("The instance default"));
    assert.equal(fallback.attributes.title, "is not among this machine's models", "a default that is not here is said to be not here");

    // Claude Code opens on one of its own models, never on Cora's default.
    row("Claude Code").click();
    const chosen = side().querySelectorAll(".model-row").find((node) => node.className.split(" ").includes("on"));
    assert.equal(chosen.querySelector(".row-title").textContent.replace("chosen", ""), "Sonnet 5.5");

    // Codex is not here: what it needs, no list to pick from, and no save.
    row("Codex").click();
    assert.match(side().querySelector(".notice").textContent, /Codex is not installed on this machine/);
    assert.equal(side().querySelectorAll(".model-row").length, 0);
    panel.app.querySelector("form").dispatch("submit");
    await sleep(20);
    assert.deepEqual(puts, [], "an agent is never saved onto a harness the machine does not have");
  });

  test("a machine nobody paired with Ollama Cloud says so instead of offering its models", async (t) => {
    // No key here on purpose: then the only thing that may reach the cloud is the pairing.
    const previous = fakeOllama.cloud;
    fakeOllama.cloud = false;
    t.after(() => { fakeOllama.cloud = previous; });
    const llm = new LLM({ ollamaUrl: ollama.url, ollamaKey: "", cliWorkDir: "/unused", claudeBin: "/not-installed/claude", codexBin: "/not-installed/codex", hermesBin: "/not-installed/hermes" });
    const models = await llm.listModels({ fresh: true });
    const cloud = models.find((model) => model.id === "ollama/test-model-big:cloud");
    const here = models.find((model) => model.id === "ollama/test-model");
    assert.equal(cloud.usable, false, "a cloud model on an unpaired machine cannot answer");
    assert.match(cloud.reason, /Ollama Cloud/);
    assert.equal(here.usable, undefined, "what is installed here is unaffected");
    assert.equal(llm.providers().ollamaCloud, false, "the account and the local server are two different connections");
    assert.equal(llm.providers().ollamaLocal, true, "the server on this machine is a connection of its own");

    fakeOllama.cloud = true;
    const paired = await llm.listModels({ fresh: true });
    assert.equal(paired.find((model) => model.id === "ollama/test-model-big:cloud").usable, undefined, "once paired it is a model like any other");
    assert.equal(llm.providers().ollamaCloud, true);
  });

  test("a model the card could not take whole says what is left on the processor", () => {
    const panel = panelHarness({ language: "en", fetch: async () => new Response("{}") });
    // The panel answers from inside its own realm, so compare what it says, field by field.
    const whole = panel.run("residencyOf({ size: 18_600_000_000, vram: 18_600_000_000 })");
    assert.equal(whole.kind, "on");
    assert.equal(whole.text, "running, all of it on the card", "all of it on the card is good news, plainly said");
    const spilling = panel.run("residencyOf({ size: 22_200_000_000, vram: 18_500_000_000 })");
    assert.equal(spilling.kind, "warn", "a model half on the processor crawls: that is a warning, not a detail");
    assert.equal(spilling.text, "running, 83% on the card: the rest runs on the processor");
  });

  test("an agent can be put on a card, which is the Ollama that serves it", async (t) => {
    // The stand-in keeps one reply handler for every instance: put the old one back.
    const previousReply = fakeOllama.current;
    const second = await fakeOllama(() => ({ content: "Rispondo dalla seconda scheda." }));
    const agent = app.store.createAgent({ name: "Due schede", model: "ollama/test-model", tools: false, chattiness: 0 });
    app.store.updateSettings({ ollamaHosts: [{ url: second.url, label: "RTX 4090 #1", gpu: "GPU-second" }] });
    t.after(async () => {
      app.store.updateSettings({ ollamaHosts: [] });
      app.store.deleteAgent(agent.id);
      await second.close();
      fakeOllama.current = previousReply;
    });

    const hardware = (await call("/api/hardware")).data;
    assert.deepEqual(hardware.hosts.map((host) => host.url).sort(), [ollama.url, second.url].sort(), "both servers of this machine are reported");
    assert.ok(hardware.hosts.every((host) => host.models.some((model) => model.name === "test-model")), "each one says what it has installed");

    const saved = await call(`/api/agents/${agent.id}`, { method: "PUT", body: { ollamaHost: second.url } });
    assert.equal(saved.data.ollamaHost, second.url);
    const before = second.calls.length;
    await app.brain.chatTurn({ agent: app.store.agent(agent.id), history: [{ id: "card-question", at: Date.now(), kind: "owner", authorName: "Sam", content: "Chi ti risponde?" }], channel: { id: `web-${agent.id}`, place: "test" }, forced: true, computer: false, say: async () => {} });
    assert.ok(second.calls.length > before, "its turn went to the server of its own card");
  });

  test("Hermes on a card runs on that card's Ollama in a home of its own, and a model too short for Hermes never reaches it", async (t) => {
    const previousReply = fakeOllama.current;
    const card = await fakeOllama(() => ({ content: "" }));
    card.context = { "test-model": 262144 };
    const old = await fakeOllama(() => ({ content: "" }));
    old.context = { "test-model": 40960 };
    const agent = app.store.createAgent({ name: "Ermes", model: "hermes/test-model", tools: false, chattiness: 0 });
    app.store.updateSettings({ ollamaHosts: [{ url: card.url, label: "LFM3", gpu: "" }, { url: old.url, label: "Vecchio", gpu: "" }] });
    t.after(async () => {
      app.store.updateSettings({ ollamaHosts: [] });
      app.store.deleteAgent(agent.id);
      await card.close();
      await old.close();
      fakeOllama.current = previousReply;
    });
    const turn = () => app.brain.chatTurn({ agent: app.store.agent(agent.id), history: [{ id: `hermes-card-${Date.now()}`, at: Date.now(), kind: "owner", authorName: "Sam", content: "Chi ti risponde?" }], channel: { id: `web-${agent.id}`, place: "test" }, forced: true, computer: false, say: async () => {} }).catch((error) => error);

    const hardware = (await call("/api/hardware")).data;
    const holds = (url) => hardware.hosts.find((host) => host.url === url).models.find((model) => model.name === "test-model").context;
    assert.equal(holds(card.url), 262144, "each installed model says how much it holds");
    assert.equal(holds(old.url), 40960);

    await call(`/api/agents/${agent.id}`, { method: "PUT", body: { ollamaHost: card.url } });
    const before = cli.calls().length;
    cli.set({ reply: "Rispondo da Hermes sulla scheda." });
    await turn();
    const run = cli.calls().slice(before).find((item) => item.flavor === "hermes");
    assert.ok(run, "Hermes ran");
    assert.ok(run.hermesConfig.includes(`base_url: "${card.url}/v1"`), "Hermes is pointed at the Ollama of the agent's card");
    assert.match(run.hermesHome, /-127-0-0-1-\d+$/, "a card's turns keep their own Hermes home");

    await call(`/api/agents/${agent.id}`, { method: "PUT", body: { ollamaHost: old.url } });
    const count = cli.calls().length;
    await turn();
    assert.equal(cli.calls().slice(count).filter((item) => item.flavor === "hermes").length, 0, "Hermes is never started on a model it would turn away");
    const trace = (await call(`/api/agents/${agent.id}/traces`)).data.find((item) => item.status === "error");
    assert.ok(trace, "the turn is recorded as failed");
    assert.match(trace.error, /troppo poco contesto per Hermes[\s\S]*40K/, "and says why, with the number");
  });

  test("for Hermes, a model that holds too little is shown with the reason and cannot be chosen", async (t) => {
    const previousReply = fakeOllama.current;
    const old = await fakeOllama(() => ({ content: "" }));
    old.context = { "test-model": 40960 };
    app.store.updateSettings({ ollamaHosts: [{ url: old.url, label: "Vecchio", gpu: "" }] });
    const agent = app.store.createAgent({ name: "Corto", model: "hermes/test-model", ollamaHost: old.url, tools: false, chattiness: 0 });
    t.after(async () => {
      app.store.updateSettings({ ollamaHosts: [] });
      app.store.deleteAgent(agent.id);
      await old.close();
      fakeOllama.current = previousReply;
    });
    const panel = panelHarness({ language: "en", fetch: (path, options) => fetch(`${base}${path}`, { ...options, headers: { ...options?.headers, Cookie: cookie } }) });
    await panel.run("boot()");
    await panel.navigate(`#/agent/${agent.id}/cervello`);
    const row = await waitFor(() => panel.app.querySelectorAll(".model-row").find((node) => node.querySelector(".row-title").textContent.startsWith("test-model")));
    assert.ok("disabled" in row.attributes, "Hermes would turn it away, so it cannot be picked");
    assert.match(row.textContent, /too little context for Hermes, which needs at least 64K/);
  });

  test("a model is installed on request, and a refusal is explained in words", async (t) => {
    t.after(() => { fakeOllama.pullError = ""; });
    const started = await call("/api/ollama/pull", { method: "POST", body: { model: "test-model-2" } });
    assert.equal(started.status, 202);
    assert.equal(started.data.started, true);
    await waitFor(async () => (await call("/api/activity")).data.some((entry) => /modello test-model-2 pronto/.test(entry.text || "")), { what: "the model to be ready" });
    assert.ok(ollama.calls.some((call) => call.pull === "test-model-2"), "the download was asked of Ollama");

    fakeOllama.pullError = "the model you are attempting to pull requires a newer version of Ollama";
    await call("/api/ollama/pull", { method: "POST", body: { model: "test-model-3" } });
    const refused = await waitFor(async () => (await call("/api/activity")).data.find((entry) => /test-model-3:/.test(entry.text || "")), { what: "the refusal" });
    assert.match(refused.text, /richiede un Ollama più recente/, "the real sentence, not a number");

    assert.match((await call("/api/ollama/pull", { method: "POST", body: { model: "non un modello!" } })).data.error, /nome di un modello/);
  });

  test("the cards are read from nvidia-smi when there is one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cora-gpu-"));
    const stub = join(dir, "nvidia-smi");
    writeFileSync(stub, "#!/bin/sh\necho '0, GPU-5f2c, NVIDIA GeForce RTX 4090, 24564, 17213, 41'\n");
    chmodSync(stub, 0o755);
    const cards = await graphicsCards({ bin: stub });
    assert.deepEqual(cards, [{ index: 0, uuid: "GPU-5f2c", name: "NVIDIA GeForce RTX 4090", memoryTotal: 24564, memoryUsed: 17213, load: 41 }], "the uuid is what pins an agent's Ollama to a card");
    assert.deepEqual(await graphicsCards({ bin: join(dir, "missing-smi") }), [], "no card, no noise");
  });
});

describe("installed on the customer's own machine", () => {
  test("the passes are good for its own domain and for no other", async () => {
    const keys = passKeys("a cloud seed for the on-premise test 0123456789");
    const ownHome = tempHome();
    const seed = new Store(ownHome);
    seed.updateSettings({ guildIds: [GUILD] });
    seed.close();
    const onPrem = startCora({
      home: ownHome, host: "127.0.0.1", port: 0, adminPassword: "unused", sessionKey: "on-prem-session-key", insecureCookies: true,
      cloudUrl: "https://usecora.test/", cloudKey: keys.publicKey, cloudSpace: "dopamina", publicHost: "cora.example.test",
      discordToken: MAIN_TOKEN, discordApi: discord.url, telegramApi: telegram.url, telegramPollTimeout: 1, ollamaUrl: ollama.url, ollamaKey: "k",
      claudeBin: cli.claude, codexBin: cli.codex, codexModelsFile: cli.models, ownerInstructions: join(home, "owner-AGENTS.md"),
      botTokenFor: () => "", storeSecret: async () => {}, docker: docker.path, schedulerTickMs: 3600000, startBoxes: false,
    });
    await onPrem.ready;
    const at = `http://127.0.0.1:${onPrem.server.address().port}`;
    const get = (path) => fetch(`${at}${path}`, { redirect: "manual" });
    try {
      const forOurCloud = signPass(keys.privateKey, { aud: "dopamina.usecora.test", sub: "ac_9", email: "chief@dopamina.test" });
      const refused = await get(`/auth/cloud?pass=${encodeURIComponent(forOurCloud)}`);
      assert.equal(refused.headers.get("location"), "/?signin=refused", "a pass for the cloud's own subdomain is not this install's");

      const mine = signPass(keys.privateKey, { aud: "cora.example.test", sub: "ac_9", email: "chief@dopamina.test" });
      const entered = await get(`/auth/cloud?pass=${encodeURIComponent(mine)}&next=${encodeURIComponent("/#/agenti")}`);
      assert.equal(entered.status, 302);
      assert.equal(entered.headers.get("location"), "/#/agenti");
      assert.match(entered.headers.get("set-cookie") || "", /cora_session=v2\./, "with a session of its own");
    } finally {
      await onPrem.stop();
    }
  });
});

describe("notifications and requests", () => {
  test("lounge replies and requests open the dedicated lounge route", async () => {
    const phone = await fakePhone();
    const agent = app.store.createAgent({ name: "Luce", model: "ollama/test-model", enabled: false, tools: false });
    try {
      await call("/api/push/subscribe", { method: "POST", body: { subscription: phone.subscription, device: "test lounge" } });
      app.orchestrator.postWeb(agent, app.orchestrator.state("web"), "Risposta dal salotto.");
      await waitFor(() => phone.received.length === 1);
      assert.equal(phone.decrypt(phone.received[0]).url, "/#/salotto");
      await app.orchestrator.askOwner(agent, { question: "Confermi?", choices: ["Sì", "No"] }, { channelId: "web" });
      await waitFor(() => phone.received.length === 2);
      assert.equal(phone.decrypt(phone.received[1]).url, "/#/salotto");
      app.store.appendArchive("web", { id: "test-lounge-answer", at: Date.now() + 1, authorName: "Owner", kind: "owner", content: "Sì" });
      app.orchestrator.state("web").request = null;
    } finally {
      app.store.deleteAgent(agent.id);
      phone.gone();
      await call("/api/push/test", { method: "POST" });
      await phone.close();
    }
  });

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
    assert.match(failed.lastOutput, /ora Cora vive altrove/);

    await call("/api/settings", { method: "PUT", body: { transport: "discord" } });
    await waitFor(() => app.discord.state === "ready", { what: "Discord back" });
    assert.equal(app.telegram.state, "stopped");
    await call(`/api/agents/${tina.id}`, { method: "DELETE" });
  });
});


describe("agents in Slack", () => {
  const MAIN_BOT = "xoxb-main-000000000001";
  const MAIN_APP = "xapp-main-000000000001";
  const SILVIA_BOT = "xoxb-silvia-00000000001";
  const SILVIA_APP = "xapp-silvia-00000000001";
  const NADIA_BOT = "xoxb-nadia-000000000001";
  const NADIA_APP = "xapp-nadia-000000000001";
  let silvia;
  let nadia;
  let prompt = "";

  test("the app's tokens are checked and stored, and switching to Slack turns Discord off", async () => {
    slack.addApp({ botToken: MAIN_BOT, appToken: MAIN_APP, id: "U0000000100", name: "cora", channels: [SLACK_CHANNEL] });
    assert.match((await call("/api/slack/token", { method: "PUT", body: { botToken: "nope", appToken: MAIN_APP } })).data.error, /xoxb-/);
    assert.match((await call("/api/slack/token", { method: "PUT", body: { botToken: MAIN_BOT, appToken: "nope" } })).data.error, /xapp-/);
    assert.match((await call("/api/slack/token", { method: "PUT", body: { botToken: "xoxb-unknown-00000001", appToken: MAIN_APP } })).data.error, /rifiuta/);

    const saved = await call("/api/slack/token", { method: "PUT", body: { botToken: MAIN_BOT, appToken: MAIN_APP } });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.bot.username, "cora");
    assert.equal(hushVault.CORA_SLACK_BOT_TOKEN, MAIN_BOT);
    assert.equal(hushVault.CORA_SLACK_APP_TOKEN, MAIN_APP);
    assert.equal(app.slack.state, "idle", "Slack waits until it is the channel in use");

    const switched = await call("/api/settings", { method: "PUT", body: { transport: "slack" } });
    assert.equal(switched.data.transport, "slack");
    await waitFor(() => app.slack.state === "ready", { what: "the Slack socket" });
    await waitFor(() => app.discord.state === "stopped", { what: "Discord off" });
    const state = (await call("/api/state")).data;
    assert.equal(state.slack.user.username, "cora");
    assert.equal(state.slack.team.name, "Dopamina");
    assert.deepEqual(state.channels, [], "no Slack channel is allowed yet");
    assert.equal(app.store.settings.slackTeamId, "T0000000001");
  });

  test("a channel is heard only once allowed, the workspace owner becomes the owner, and the agent answers with its own app", async () => {
    silvia = (await call("/api/agents", { method: "POST", body: { name: "Silvia", model: "ollama/test-model", chattiness: 0, tools: false } })).data;
    slack.addApp({ botToken: SILVIA_BOT, appToken: SILVIA_APP, id: "U0000000101", name: "silvia", channels: [SLACK_CHANNEL] });
    assert.match((await call(`/api/agents/${silvia.id}/slack-bot`, { method: "PUT", body: { botToken: MAIN_BOT, appToken: MAIN_APP } })).data.error, /app principale/);
    const linked = await call(`/api/agents/${silvia.id}/slack-bot`, { method: "PUT", body: { botToken: SILVIA_BOT, appToken: SILVIA_APP } });
    assert.equal(linked.status, 200);
    assert.equal(hushVault.CORA_SK_BOT_SILVIA, SILVIA_BOT);
    assert.equal(hushVault.CORA_SK_APP_SILVIA, SILVIA_APP);
    assert.equal(linked.data.slackBot.user.username, "silvia");
    assert.ok(linked.data.slackBot.manifest.settings.socket_mode_enabled, "the manifest creates a Socket Mode app");
    assert.equal(linked.data.slackBot.manifest.features.bot_user.display_name, "Silvia");

    replies.set("Silvia", (body) => {
      prompt = lastUserText(body);
      return { content: "Ci sono, dimmi pure." };
    });
    slack.say({ text: "Silvia, ci sei?" });
    await sleep(1500);
    assert.equal(slack.postsIn(SLACK_CHANNEL).length, 0, "a channel that is not allowed is ignored");

    await call("/api/settings", { method: "PUT", body: { slackChannelIds: [SLACK_CHANNEL] } });
    const channels = (await call("/api/state")).data.channels;
    assert.deepEqual(channels.map((channel) => [channel.id, channel.name, channel.kind]), [[`sl:${SLACK_CHANNEL}`, "generale", "slack"]]);

    slack.say({ text: "Silvia, ci sei?" });
    const post = await waitFor(() => slack.postsIn(SLACK_CHANNEL)[0], { what: "Silvia's answer" });
    assert.equal(post.app, "silvia", "posted by her own app");
    assert.equal(post.username, undefined, "her own app needs no name on the message");
    assert.equal(post.text, "Ci sono, dimmi pure.");
    assert.deepEqual(app.store.settings.slackOwnerIds, [SLACK_OWNER]);
    assert.match(prompt, /Ultimi messaggi nel canale #generale di Slack/);
    assert.match(prompt, /Sam ★: Silvia, ci sei\?/);
    const [summary] = (await call(`/api/agents/${silvia.id}/traces`)).data;
    const trace = (await call(`/api/traces/${summary.id}`)).data;
    assert.match(trace.system, /In questo momento parlate su Slack, nello spazio "Dopamina"\./);
    await quiet();
  });

  test("Slack's own markup becomes names and words, and what an agent writes becomes mrkdwn", async () => {
    slack.state.posts.length = 0;
    replies.set("Silvia", (body) => {
      prompt = lastUserText(body);
      return { content: "**fatto** e [il link](https://dopamina.it)" };
    });
    slack.say({ text: `<@${SLACK_STRANGER}> chiedi a <@U0000000101> in <#${SLACK_OTHER_CHANNEL}|clienti>: <https://dopamina.it|il sito> & altro`, user: SLACK_STRANGER });
    const post = await waitFor(() => slack.postsIn(SLACK_CHANNEL)[0], { what: "Silvia's answer" });
    assert.match(prompt, /@Kim chiedi a @Silvia in #clienti: il sito \(https:\/\/dopamina\.it\) & altro/);
    assert.doesNotMatch(prompt, /Kim ★/, "a colleague is not the owner");
    assert.equal(post.text, "*fatto* e <https://dopamina.it|il link>");
    await quiet();
  });

  test("on Slack a person who wrote is tagged for real, and the mention survives mrkdwn", async () => {
    slack.state.posts.length = 0;
    replies.set("Silvia", () => ({ content: "@Kim ci penso io, a < b." }));
    slack.say({ text: "Silvia, rispondi a Kim" });
    const post = await waitFor(() => slack.postsIn(SLACK_CHANNEL)[0], { what: "Silvia's answer" });
    assert.equal(post.text, `<@${SLACK_STRANGER}> ci penso io, a &lt; b.`);
    await quiet();
  });

  test("a message every app hears is answered once, and in a thread only a summoned agent speaks", async () => {
    nadia = (await call("/api/agents", { method: "POST", body: { name: "Nadia", model: "ollama/test-model", chattiness: 0, tools: false } })).data;
    slack.addApp({ botToken: NADIA_BOT, appToken: NADIA_APP, id: "U0000000102", name: "nadia", channels: [SLACK_CHANNEL] });
    await call(`/api/agents/${nadia.id}/slack-bot`, { method: "PUT", body: { botToken: NADIA_BOT, appToken: NADIA_APP } });
    await waitFor(() => app.skBots.client(nadia.id), { what: "Nadia's app" });
    slack.state.posts.length = 0;
    replies.set("*", () => ({ content: "Rispondo io." }));

    const asked = slack.say({ text: "c'è qualcuno che mi dà una mano?" });
    await waitFor(() => slack.postsIn(SLACK_CHANNEL).length, { what: "one answer" });
    await quiet();
    assert.equal(slack.postsIn(SLACK_CHANNEL).length, 1, "three sockets heard it, one agent answered");

    slack.state.posts.length = 0;
    slack.say({ text: "qualcuno sa?", threadTs: asked.ts });
    await sleep(1500);
    assert.equal(slack.state.posts.length, 0, "in a thread nobody answers unless called");

    slack.say({ text: "Nadia, ci pensi tu?", threadTs: asked.ts });
    const reply = await waitFor(() => slack.state.posts[0], { what: "Nadia in the thread" });
    assert.equal(reply.app, "nadia");
    assert.equal(reply.thread_ts, asked.ts, "the answer stays in the thread");
    await quiet();
  });

  test("while it works it marks the message, and takes the mark back when it answers", async () => {
    slack.state.reactions.length = 0;
    slack.state.posts.length = 0;
    replies.set("Silvia", async () => {
      await sleep(1200);
      return { content: "Ecco fatto." };
    });
    const asked = slack.say({ text: "Silvia, guarda una cosa" });
    await waitFor(() => slack.state.reactions.some((item) => item.action === "add"), { what: "the mark on the message" });
    const added = slack.state.reactions.find((item) => item.action === "add");
    assert.equal(added.name, "eyes");
    assert.equal(added.ts, asked.ts, "on the message that asked, not on its own answer");
    await waitFor(() => slack.postsIn(SLACK_CHANNEL).length, { what: "Silvia's answer" });
    await waitFor(() => slack.state.reactions.some((item) => item.action === "remove"), { what: "the mark taken back" });
    assert.ok(!slack.state.posts.some((post) => /Ricevuto, ci lavoro/.test(post.text || "")), "Slack gets no line saying it is on it");
    await quiet();
  });

  test("a direct message is answered by that agent alone, in private", async () => {
    slack.join(SILVIA_BOT, SLACK_DM);
    slack.state.posts.length = 0;
    replies.set("Silvia", () => ({ content: "Te lo dico in privato." }));
    slack.say({ text: "ciao, mi aiuti?", channel: SLACK_DM });
    const post = await waitFor(() => slack.postsIn(SLACK_DM)[0], { what: "the private answer" });
    assert.equal(post.app, "silvia");
    assert.equal(slack.postsIn(SLACK_CHANNEL).length, 0, "nothing leaks into the channel");
    await quiet();
  });

  test("messages written while cora was down are picked up when the socket opens", async () => {
    slack.state.posts.length = 0;
    replies.set("Silvia", () => ({ content: "Scusa, ero spenta." }));
    slack.archive({ text: "Silvia, quando puoi guarda i conti" });
    await app.orchestrator.catchUp();
    const post = await waitFor(() => slack.postsIn(SLACK_CHANNEL)[0], { what: "the missed message answered" });
    assert.equal(post.text, "Scusa, ero spenta.");
    await quiet();
  });

  test("a routine on a Discord channel does not run while the cora lives on Slack; switching back turns Discord on again", async () => {
    const routine = await call(`/api/agents/${silvia.id}/routines`, { method: "POST", body: { name: "Discord", schedule: "0 9 * * *", channelId: CHANNEL, prompt: "Saluta." } });
    await call(`/api/routines/${routine.data.id}/run`, { method: "POST" });
    const failed = await waitFor(async () => (await call("/api/state")).data.routines.find((item) => item.id === routine.data.id && item.lastStatus === "error"), { what: "routine refused" });
    assert.match(failed.lastOutput, /il canale è su Discord, ma ora Cora vive altrove/);

    await call("/api/settings", { method: "PUT", body: { transport: "discord" } });
    await waitFor(() => app.discord.state === "ready", { what: "Discord back" });
    assert.equal(app.slack.state, "stopped");
    await call(`/api/agents/${silvia.id}`, { method: "DELETE" });
    await call(`/api/agents/${nadia.id}`, { method: "DELETE" });
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

  test("a planning routine completes today's authorized work instead of accepting an unfinished queue check", async () => {
    const shell = app.boxes.shell;
    const commands = [];
    app.boxes.shell = async (id, command) => { commands.push(command); return { code: 0, output: "Contacts verified, CRM updated, future queue filled; no duplicate sends." }; };
    goals = (body) => {
      assert.match(body.messages[1].content, /Ora:.*Richiesta:/s);
      assert.match(body.messages[1].content, /Aggiorna il CRM e programma tutti i contatti validi negli orari futuri/);
      assert.match(body.messages[1].content, /Non ridurre una richiesta di ricerca, aggiornamento o programmazione a un semplice resoconto/);
      return "CRM aggiornato e contatti validi pianificati negli orari futuri, con verifiche completate";
    };
    let checksMade = 0;
    checks = (body) => {
      checksMade++;
      assert.match(body.messages[0].content, /Una verifica futura non sostituisce le azioni e le verifiche fattibili ora/);
      return JSON.stringify(checksMade === 1 ? { met: false, blocked: false, reason: "Le verifiche dei contatti e la programmazione sono ancora fattibili ora e incomplete." } : { met: true });
    };
    let step = 0;
    replies.set("Iris", () => ++step === 1 ? { content: "La coda arriva alle 10:20. Non ho completato le verifiche; controllerò alle 10:30." } : step === 2 ? { tool_calls: [{ function: { name: "shell", arguments: { command: "verify-contacts-and-plan-approved-queue" } } }] } : { content: "Verifiche completate, CRM e coda futura aggiornati." });
    const work = routine(iris, "Programmazione odierna", "Aggiorna il CRM e programma tutti i contatti validi negli orari futuri; verifica storico e duplicati. Non aspettare che partano gli invii programmati.");
    try {
      await app.orchestrator.runRoutine(work);
      assert.deepEqual(commands, ["verify-contacts-and-plan-approved-queue"]);
      assert.equal(checksMade, 2);
    } finally { app.boxes.shell = shell; }
  });

  test("a short approval resolves the preceding proposal, not memories or a later human message", async () => {
    const inputs = [];
    goals = (body) => { inputs.push(body.messages[1].content); return "le tre bozze approvate sono inviate e verificate"; };
    checks = () => JSON.stringify({ met: true });
    replies.set("Iris", () => ({ content: "Le bozze approvate sono verificate." }));
    const at = Date.now();
    const proposal = { id: "proposal", at, kind: "agent", agentId: iris.id, authorName: "Iris", content: "Ho tre bozze pronte per i destinatari verificati. Le invio dopo il tuo ok." };
    const approval = { id: "approval", at: at + 1, kind: "owner", authorName: "Sam", content: "Ok manda @Iris" };
    const later = { id: "later", at: at + 2, kind: "owner", authorName: "Sam", content: "UNRELATED_LATER_TASK" };
    await app.brain.chatTurn({ agent: iris, history: [proposal, approval, later], channel: { id: CHANNEL, name: "test" }, forced: true, computer: true, replyTo: approval });
    assert.equal(inputs.length, 1);
    assert.match(inputs[0], /tre bozze pronte/);
    assert.match(inputs[0], /Richiesta:\nOk manda @Iris/);
    assert.doesNotMatch(inputs[0], /UNRELATED_LATER_TASK|OBSOLETE|Ti torna in mente/);
  });

  test("an owner mention retains the preceding passive collaboration request instead of reviving a closed task", async () => {
    const inputs = [];
    goals = (body) => { inputs.push(body); return "il registro dei casi chiusi è reso disponibile a Ivo"; };
    checks = () => JSON.stringify({ met: true });
    replies.set("Iris", () => ({ content: "Registro verificato e disponibile." }));
    const at = Date.parse("2026-10-28T07:10:00Z");
    const closed = { id: "closed", at: at - 86400000, kind: "owner", authorName: "Sam", content: "@Ivo la vecchia pratica è chiusa, fermati" };
    const report = { id: "collaboration", at, kind: "agent", agentId: ivo.id, authorName: "Ivo", passive: true, content: "Iris, mi serve il registro aggiornato /work/cases.csv; puoi rendermelo disponibile?" };
    const request = { id: "summon", at: at + 1000, kind: "owner", authorName: "Sam", content: "@Iris" };
    const later = { id: "later-passive", at: at + 2000, kind: "agent", agentId: ivo.id, authorName: "Ivo", passive: true, content: "UNRELATED_LATER_REPORT" };
    const result = await app.brain.chatTurn({ agent: iris, history: [closed, report, request, later], channel: { id: CHANNEL, name: "test" }, forced: true, computer: true, replyTo: request });
    assert.equal(inputs.length, 1);
    const context = inputs[0].messages[1].content;
    assert.match(context, /Ivo \(agente\) \[contesto passivo\]: Iris, mi serve il registro aggiornato/);
    assert.match(context, /\[27\/10.*vecchia pratica.*\[28\/10.*registro aggiornato/s);
    assert.match(context, /Richiesta:\n@Iris/);
    assert.doesNotMatch(context, /UNRELATED_LATER_REPORT|OBSOLETE|Ti torna in mente/);
    assert.match(inputs[0].messages[0].content, /I messaggi passivi da soli non autorizzano nuovi compiti/);
    assert.match(app.store.trace(result.traceId).prompt, /\[Obiettivo\].*registro dei casi chiusi/);
  });

  test("a progress check asks for missing owner input instead of allowing more desktop searches", async () => {
    const shell = app.boxes.shell;
    const every = app.brain.progressEvery;
    const executed = [];
    app.brain.progressEvery = 2;
    app.boxes.shell = async (id, command) => { executed.push(command); return { code: 0, output: "The correct company cannot be inferred. The owner must identify it." }; };
    goals = () => "le risposte autorizzate sono inviate oppure è richiesto il dato proprietario mancante";
    let reviews = 0;
    checks = (body) => { reviews++; assert.match(body.messages[1].content, /Controllo durante l'esecuzione/); return JSON.stringify({ met: false, blocked: true, reason: "Il proprietario deve identificare la società corretta." }); };
    let step = 0;
    replies.set("Iris", () => {
      step++;
      if (step <= 3) return { tool_calls: [{ function: { name: "shell", arguments: { command: `lookup-company-${step}` } } }] };
      if (step === 4) return { tool_calls: [{ function: { name: "ask_owner", arguments: { question: "A quale società si riferisce questa pratica?" } } }] };
      return { content: "Attendo il dato necessario per completare le risposte." };
    });
    try {
      const result = await app.brain.chatTurn({ agent: iris, history: [{ id: "approval", at: Date.now(), kind: "owner", authorName: "Sam", content: "Invia le risposte approvate" }], channel: { id: CHANNEL, name: "test" }, forced: true, computer: true });
      assert.equal(result.asked, true);
      assert.deepEqual(executed, ["lookup-company-1", "lookup-company-2"]);
      assert.equal(reviews, 1);
      const trace = app.store.trace(result.traceId);
      assert.ok(trace.steps.some((entry) => entry.type === "note" && /Verifica progressi/.test(entry.text)));
      assert.ok(trace.steps.some((entry) => entry.name === "shell" && /lookup-company-3/.test(JSON.stringify(entry.args)) && !entry.ok));
    } finally { app.boxes.shell = shell; app.brain.progressEvery = every; }
  });

  test("progress reviews preserve useful work and accept an owner's clarification without replacing the goal", async () => {
    const shell = app.boxes.shell;
    const every = app.brain.progressEvery;
    const executed = [];
    app.brain.progressEvery = 2;
    app.boxes.shell = async (id, command) => { executed.push(command); return { code: 0, output: executed.length <= 2 ? "The owner must identify the company." : "The selected individual business is verified." }; };
    let written = 0;
    goals = () => { written++; return "la pratica autorizzata è verificata"; };
    let reviews = 0;
    let evaluated = 0;
    checks = async (body) => {
      if (!/Controllo durante l'esecuzione/.test(body.messages[1].content)) return JSON.stringify({ met: true });
      reviews++;
      if (reviews === 1) await waitFor(() => evaluated === 1, { what: "the owner's clarification during the progress review" });
      return JSON.stringify({ met: false, blocked: reviews === 1, reason: reviews === 1 ? "Serve identificare la società." : "La verifica sta avanzando." });
    };
    intentions = (body) => { evaluated++; assert.match(body.messages[1].content, /ditta individuale/); return JSON.stringify({ intent: "continue", reply: "" }); };
    let delivered = false;
    const inbox = () => reviews === 1 && !delivered ? (delivered = true, [{ id: "company-answer", at: Date.now(), kind: "owner", authorName: "Sam", content: "Si tratta della mia ditta individuale." }]) : [];
    let step = 0;
    replies.set("Iris", () => ++step <= 4 ? { tool_calls: [{ function: { name: "shell", arguments: { command: `verify-company-${step}` } } }] } : { content: "La pratica della ditta individuale è verificata." });
    try {
      const result = await app.brain.chatTurn({ agent: iris, history: [{ id: "verify", at: Date.now(), kind: "owner", authorName: "Sam", content: "Verifica la pratica approvata" }], channel: { id: CHANNEL, name: "test" }, forced: true, computer: true, inbox });
      assert.deepEqual(executed, ["verify-company-1", "verify-company-2", "verify-company-3", "verify-company-4"]);
      assert.equal(written, 1, "clarification keeps the original goal");
      assert.equal(reviews, 2);
      assert.equal(evaluated, 1);
      assert.equal(result.stopped, false);
      assert.equal(result.asked, false);
    } finally { app.boxes.shell = shell; app.brain.progressEvery = every; }
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
    const overlapping = app.orchestrator.runRoutine(second);
    try {
      await waitFor(() => entered);
      const overlap = await overlapping;
      assert.equal(overlap.status, "busy");
      assert.equal(app.store.routine(second.id).lastStatus, "skipped");
      assert.equal(app.orchestrator.threadWork.size, 1);
      assert.equal(app.brain.channelGoals.size, 1);
    } finally { release(); await Promise.all([pending, overlapping]); }
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
        await waitFor(() => !app.orchestrator.threadWork.has(r.channelId), { timeout: 2000, what: "active routine cancellation" });
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

  test("an evaluated task handoff releases the previous worker before the named agent receives its desktop", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let oldCalls = 0, nextCalls = 0, commands = 0;
    const shell = app.boxes.shell;
    goals = () => "il documento è letto e verificato";
    checks = () => JSON.stringify({ met: true });
    intentions = (body) => { assert.match(body.messages[1].content, /rivolti esplicitamente a un altro agente/); return JSON.stringify({ intent: "update", reply: "" }); };
    replies.set("Iris", async () => { oldCalls++; await gate; return { content: "Risposta obsoleta di Iris" }; });
    replies.set("Ivo", (body) => {
      nextCalls++;
      assert.ok(body.tools.some((tool) => tool.function.name === "shell"), "the new worker has its desktop tools");
      return nextCalls === 1 ? { tool_calls: [{ function: { name: "shell", arguments: { command: "read-authorized-document" } } }] } : { content: "Documento verificato da Ivo." };
    });
    app.boxes.shell = async () => {
      commands++;
      assert.equal(app.orchestrator.threadWork.get(CHANNEL), ivo.id, "the old worker has released the thread to the new one");
      return { code: 0, output: "Document read and verified." };
    };
    try {
      discord.say({ content: "Iris, analizza il documento" });
      await waitFor(() => oldCalls === 1);
      discord.say({ content: "Ivo, occupatene tu: leggi il documento dal tuo computer" });
      await waitFor(() => commands === 1, { what: "the named agent receiving its desktop after semantic handoff" });
      await waitFor(() => discord.state.webhookPosts.some((post) => post.username === "Ivo" && post.content === "Documento verificato da Ivo."));
      assert.equal(oldCalls, 1);
      assert.equal(app.store.traces(iris.id, 1)[0].status, "stopped");
      assert.ok(!discord.state.webhookPosts.some((post) => post.content === "Risposta obsoleta di Iris"));
      assert.ok(!app.orchestrator.state(CHANNEL).humanQueue.size);
    } finally { release(); app.boxes.shell = shell; await quiet(); }
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
      await waitFor(() => !app.orchestrator.threadWork.has(r.channelId));
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

describe("doc in the Cora harness", () => {
  let dora;
  const posts = () => discord.state.webhookPosts.filter((item) => item.username === "Dora").map((item) => item.content);
  const lastTool = (body) => {
    const last = body.messages[body.messages.length - 1];
    return last.role === "tool" ? String(last.content) : "";
  };

  before(async () => {
    const login = await call("/api/login", { method: "POST", body: { password: PASSWORD }, auth: false });
    cookie = login.headers.get("set-cookie").split(";")[0];
    for (const agent of app.store.agents()) app.store.updateAgent(agent.id, { enabled: false });
    await call("/api/settings", { method: "PUT", body: { transport: "discord" } });
    dora = app.store.createAgent({ name: "Dora", model: "ollama/test-model", tools: true, chattiness: 0, channelIds: [CHANNEL] });
  });
  after(() => app.store.updateAgent(dora.id, { enabled: false }));

  test("a message that asks for a secret is stopped once with doc's reason, and the rewrite goes out", async () => {
    let step = 0, refused = "";
    replies.set("Dora", (body) => {
      step += 1;
      if (step === 1) return { tool_calls: [{ function: { name: "say", arguments: { text: "Per collegarlo INCOLLA-QUI-IL-TOKEN di GitHub in questa chat, grazie." } } }] };
      if (step === 2) {
        refused = lastTool(body);
        return { tool_calls: [{ function: { name: "say", arguments: { text: "Per collegarlo aggiungi il token di GitHub dal pannello, nelle chiavi." } } }] };
      }
      return { content: "PASS" };
    });
    const before = doc.calls().length;
    discord.say({ content: "Dora, come colleghiamo GitHub?" });
    await waitFor(() => posts().includes("Per collegarlo aggiungi il token di GitHub dal pannello, nelle chiavi."), { what: "the rewritten message" });
    await quiet();
    assert.ok(!posts().some((text) => text.includes("INCOLLA-QUI-IL-TOKEN")), "the stopped message never reaches the channel");
    assert.match(refused, /^error: not sent\. doc: your last reply breaks a rule/, "Dora reads doc's reason");
    const checked = doc.calls().slice(before).find((item) => item.module === "reply_check" && /INCOLLA-QUI/.test(item.payload.last_assistant_message));
    assert.equal(checked.key, "ts-test-key", "Jev gets this instance's TypeSafe key");
  });

  test("a final reply doc stops is written again, and only the rewrite is posted", async () => {
    let step = 0, prompt = "";
    replies.set("Dora", (body) => {
      step += 1;
      if (step === 1) return { content: "Il report è quasi pronto: STIMA-DI-PROVA, ci vogliono ancora tre giorni di lavoro." };
      prompt = String(body.messages[body.messages.length - 1].content);
      return { content: "Il report è pronto nel thread, con i numeri di oggi e il confronto con ieri." };
    });
    discord.say({ content: "Dora, a che punto è il report?" });
    await waitFor(() => posts().includes("Il report è pronto nel thread, con i numeri di oggi e il confronto con ieri."), { what: "the rewritten reply" });
    await quiet();
    assert.ok(!posts().some((text) => text.includes("STIMA-DI-PROVA")));
    assert.match(prompt, /^\[Cora\] doc: your last reply breaks a rule.*Scrivi di nuovo la risposta finale/s);
  });

  test("a comment the agent would publish from its computer is checked first, its body file included", async () => {
    const shell = app.boxes.shell;
    const readFile = app.boxes.readFile;
    const commands = [];
    const read = [];
    app.boxes.shell = async (id, command) => { commands.push(command); return { code: 0, output: "https://github.com/acme/app/pull/7#issuecomment-1" }; };
    app.boxes.readFile = async (id, path) => { read.push(path); return Buffer.from("Fixed in /home/agent/work/app/src/pay.js, see the logs."); };
    let step = 0;
    const results = [];
    replies.set("Dora", (body) => {
      step += 1;
      if (step > 1) results.push(lastTool(body));
      if (step === 1) return { tool_calls: [{ function: { name: "shell", arguments: { command: "gh pr comment 7 --body-file work/note.md" } } }] };
      if (step === 2) return { tool_calls: [{ function: { name: "shell", arguments: { command: "gh pr comment 7 --body 'DA-RICONTROLLARE: the payment fix is live.'" } } }] };
      if (step === 3) return { tool_calls: [{ function: { name: "shell", arguments: { command: "gh pr comment 7 --body 'DA-RICONTROLLARE: the payment fix is live.'" } } }] };
      return { content: "Commento pubblicato sulla PR 7: https://github.com/acme/app/pull/7#issuecomment-1" };
    });
    try {
      discord.say({ content: "Dora, commenta la PR 7" });
      await waitFor(() => posts().some((text) => text.startsWith("Commento pubblicato sulla PR 7")), { what: "Dora's report" });
      await quiet();
      assert.deepEqual(read, ["work/note.md"], "the body file is read from Dora's computer");
      assert.match(results[0], /^error: not run\. doc: this comment breaks the publishing rules/);
      assert.match(results[1], /^error: not run\. doc: .*If it is right as it is, run exactly the same command again\./, "a borderline comment is held once");
      assert.deepEqual(commands, ["gh pr comment 7 --body 'DA-RICONTROLLARE: the payment fix is live.'"], "only the comment she confirmed ran");
    } finally {
      app.boxes.shell = shell;
      app.boxes.readFile = readFile;
    }
  });

  test("the owner turns doc's checks off and adds their own, and doc reads them", async () => {
    const listed = (await call("/api/doc/rules")).data;
    assert.deepEqual(listed.builtins.map((rule) => [rule.on, rule.key, rule.enabled]), [["reply", "effort", true], ["reply", "secret_request", true], ["comment", "local_state", true]]);
    assert.deepEqual(listed.added, []);
    const saved = await call("/api/doc/rules", { method: "PUT", body: {
      off: ["reply:secret_request", "reply:unknown"],
      add: [{ name: "Clienti per nome", on: ["reply", "email"], question: "Il testo nomina un cliente o un suo referente?", fix: "Togli il nome del cliente.", keywords: "ACME, , Rossi" }],
    } });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.data.builtins.find((rule) => rule.key === "secret_request").enabled, false);
    const [rule] = saved.data.added;
    assert.deepEqual({ ...rule }, { key: "clienti_per_nome", name: "Clienti per nome", on: ["reply"], question: "Il testo nomina un cliente o un suo referente?", reason: "breaks the rule \"Clienti per nome\"", fix: "Togli il nome del cliente.", keywords: ["acme", "rossi"], threshold: 0.8, enabled: true });
    const file = join(home, "doc-rules.json");
    assert.equal(statSync(file).mode & 0o777, 0o600, "only Cora's user reads the rules");
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).off, ["reply:secret_request"]);

    let step = 0, refused = "";
    replies.set("Dora", (body) => {
      step += 1;
      if (step === 1) return { tool_calls: [{ function: { name: "say", arguments: { text: "Per collegarlo INCOLLA-QUI-IL-TOKEN di GitHub, il controllo ora è spento." } } }] };
      if (step === 2) return { tool_calls: [{ function: { name: "say", arguments: { text: "Il preventivo per ACME è pronto, lo firmano domani in ufficio." } } }] };
      if (step === 3) {
        refused = lastTool(body);
        return { tool_calls: [{ function: { name: "say", arguments: { text: "Il preventivo è pronto, lo firmano domani in ufficio." } } }] };
      }
      return { content: "PASS" };
    });
    discord.say({ content: "Dora, aggiornami sul preventivo" });
    await waitFor(() => posts().includes("Il preventivo è pronto, lo firmano domani in ufficio."), { what: "the rewrite without the client" });
    await quiet();
    assert.ok(posts().includes("Per collegarlo INCOLLA-QUI-IL-TOKEN di GitHub, il controllo ora è spento."), "a check turned off stops nothing");
    assert.ok(!posts().some((text) => text.includes("ACME")), "the owner's own check stops the client's name");
    assert.match(refused, /breaks the rule "Clienti per nome" \(0\.95\).*Togli il nome del cliente\./);

    assert.equal((await call("/api/doc/rules", { method: "PUT", body: { add: [{ name: "Vuoto", on: ["reply"], question: "" }] } })).status, 400);
    assert.equal((await call("/api/doc/rules", { method: "PUT", body: { add: Array.from({ length: 21 }, (_, index) => ({ name: `R${index}`, on: ["reply"], question: "Q?" })) } })).status, 400);
    assert.equal((await call("/api/doc/rules", { method: "PUT", body: { off: [], add: [{ ...rule, enabled: false }] } })).data.added[0].enabled, false, "a check of the owner's can rest without being deleted");
    await call("/api/doc/rules", { method: "PUT", body: { off: [], add: [] } });
  });

  test("a rule is tried on every brain in use before it is saved: each one breaks it, is stopped and writes it again", async (t) => {
    const clea = app.store.createAgent({ name: "Clea", model: "claude/claude-sonnet-5-5", subscriptionId: subscriptionIds.claude, channelIds: [] });
    t.after(() => { app.store.updateAgent(clea.id, { enabled: false }); replies.delete("*"); cli.set({ reply: "PASS" }); });
    const prompts = [];
    replies.set("*", (body) => {
      const prompt = String(body.messages.at(-1).content);
      prompts.push(prompt);
      // Like a weaker model, the first example follows the rule instead of breaking it.
      return { content: /Scrivilo di nuovo/.test(prompt) ? "Il preventivo è pronto e firmato." : /non fa quello che il controllo cerca/.test(prompt) ? "Il preventivo per ACME è pronto, firmano domani." : "Ricordo a tutti di non scrivere i nomi dei clienti." };
    });
    cli.set({ from: cli.calls().filter((item) => item.flavor === "claude").length, runs: [
      { reply: "«Ho chiuso il contratto con ACME stamattina.»" },
      { reply: "Ho chiuso il contratto stamattina." },
    ] });
    const rule = { name: "Clienti", on: ["reply"], question: "Il testo nomina un cliente?", fix: "Togli il nome del cliente." };
    const started = await call("/api/doc/rules/test", { method: "POST", body: { rule } });
    assert.equal(started.status, 202);
    assert.equal(started.data.total, 2, "Dora's Ollama model and Clea's Claude Code");
    let job;
    await waitFor(async () => (job = (await call(`/api/doc/rules/test/${started.data.id}`)).data).status === "done", { what: "the rule test", timeout: 60000 });
    const byLabel = Object.fromEntries(job.results.map((result) => [result.label, result]));
    assert.deepEqual(Object.keys(byLabel).sort(), ["Claude Code · claude-sonnet-5-5", "Ollama · test-model"]);
    for (const result of job.results) {
      assert.equal(result.status, "done", JSON.stringify(result));
      assert.equal(result.caught, true, "Jev stops the example");
      assert.equal(result.fixed, true, "and lets the rewrite through");
      assert.ok(result.exampleScore >= 0.8 && result.rewriteScore < 0.8);
    }
    assert.equal(byLabel["Claude Code · claude-sonnet-5-5"].example, "Ho chiuso il contratto con ACME stamattina.", "quotes around the example are dropped");
    assert.deepEqual(byLabel["Ollama · test-model"].agents, ["Dora"]);
    assert.equal(byLabel["Ollama · test-model"].retried, true, "an example that broke nothing is asked for once more");
    assert.equal(byLabel["Ollama · test-model"].example, "Il preventivo per ACME è pronto, firmano domani.");
    assert.ok(!byLabel["Claude Code · claude-sonnet-5-5"].retried, "a good first example is kept");
    assert.match(prompts.find((prompt) => /Scrivilo di nuovo/.test(prompt)), /\[Cora\] doc: your last reply breaks the rule "Clienti" \(0\.95\).*Togli il nome del cliente\./s, "the brain gets doc's reason as an agent would");
    assert.deepEqual((await call("/api/doc/rules")).data.added, [], "trying a rule saves nothing");

    const key = app.brain.doc.key;
    app.brain.doc.key = "";
    try {
      assert.equal((await call("/api/doc/rules/test", { method: "POST", body: { rule } })).status, 409, "without the TypeSafe key nothing can be tried");
    } finally { app.brain.doc.key = key; }
  });

  test("the TypeSafe key is set from the panel, and without doc nothing is checked and nothing fails", async () => {
    const previous = app.brain.doc;
    try {
      app.brain.doc.key = "";
      assert.equal((await call("/api/state")).data.keys.typesafe, false);
      assert.equal((await call("/api/providers/typesafe/key", { method: "PUT", body: { key: "ts-from-panel" } })).status, 200);
      assert.equal(hushVault.CORA_TYPESAFE_API_KEY, "ts-from-panel", "it is kept in hush");
      const state = (await call("/api/state")).data;
      assert.equal(state.keys.typesafe, true);
      assert.equal(state.doc.installed, true);
      assert.equal(app.brain.doc.key, "ts-from-panel", "and used from the next check, without a restart");
      // The panel shows what doc did today, and proves on demand that doc answers and Jev judges.
      assert.ok(state.doc.checks >= 4 && state.doc.stopped >= 4, `doc's day is counted: ${JSON.stringify(state.doc)}`);
      assert.ok(Date.parse(state.doc.judgedAt) > Date.now() - 60000, "with the last time Jev judged");
      assert.deepEqual((await call("/api/doc/probe", { method: "POST" })).data, { installed: true, runs: true, jev: true });
      assert.equal((await call("/api/state")).data.doc.checks, state.doc.checks, "the probe stays out of the count");
      app.brain.doc.key = "";
      assert.deepEqual((await call("/api/doc/probe", { method: "POST" })).data, { installed: true, runs: true, jev: false }, "without a key only the exact rules answer");
      app.brain.doc.key = "ts-from-panel";

      app.brain.doc = new Doc({ root: "" });
      assert.equal((await call("/api/state")).data.doc.installed, false);
      assert.deepEqual((await call("/api/doc/probe", { method: "POST" })).data, { installed: false, runs: false, jev: false });
      const before = doc.calls().length;
      let step = 0;
      replies.set("Dora", () => ++step === 1 ? { tool_calls: [{ function: { name: "say", arguments: { text: "Senza doc questo messaggio con STIMA-DI-PROVA esce com'è." } } }] } : { content: "PASS" });
      discord.say({ content: "Dora, prova senza doc" });
      await waitFor(() => posts().includes("Senza doc questo messaggio con STIMA-DI-PROVA esce com'è."), { what: "the unchecked message" });
      await quiet();
      assert.equal(doc.calls().length, before, "nothing ran");
    } finally {
      app.brain.doc = previous;
      previous.key = "ts-test-key";
    }
  });
});
