import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createFolderKeys, encryptDocument } from "../web/encrypted-space.js";
import { googleConnectorFixture } from "./google-connector-fixtures.js";
import { EmailChannel } from "../src/email-channel.js";
import { mailWorld } from "./mail-fixtures.js";
import { knowledgeWorld } from "./knowledge-fixtures.js";
import { invitationWorld } from "./invitation-fixtures.js";
import assert from "node:assert/strict";
import { createECDH, createDecipheriv, createPublicKey, createHmac, createHash, hkdfSync, randomBytes, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { spawnSync } from "node:child_process";
import { after, before, beforeEach, describe, test } from "node:test";
import { startCora } from "../src/main.js";
import { passKeys, signPass } from "../src/pass.js";
import { Discord, LISTENING_INTENTS } from "../src/discord.js";
import { loginLinkToken } from "../src/web.js";
import { SHARED, Store } from "../src/store.js";
import { encodePng, pngSize } from "../src/png.js";
import { panelHarness } from "./panel.js";
import { identityCli } from "./subscription-fixtures.js";
import { subscriptionEnvironment } from "../src/subscriptions.js";
import { SubscriptionUsage, parseSubscriptionUsage, parseSubscriptionBalances } from "../src/subscription-usage.js";
import { readNativeUsage } from "../src/subscription-usage-worker.js";
import { LLM, graphicsCards } from "../src/llm.js";
import { runClaude, runCodex, runHermes } from "../src/cli.js";
import { Doc } from "../src/doc.js";
import { Boxes } from "../src/box.js";
import { Voice } from "../src/voice.js";
import { ExternalBrain, publicKnowledgeAddress } from "../src/knowledge.js";
import { gitLauncherFixture, gitSetupFixture } from "./git-launcher-fixtures.js";
import { executeTool } from "../src/tools.js";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BOT, CHANNEL, GUILD, MAIN_TOKEN, OTHER_CHANNEL, OTHER_GUILD, OWNER, SLACK_CHANNEL, SLACK_DM, SLACK_OTHER_CHANNEL, SLACK_OWNER, SLACK_STRANGER, STRANGER, TG_GROUP, TG_OTHER_GROUP, TG_OWNER, TG_STRANGER, fakeCli, fakeDiscord, fakeDoc, fakeDocker, fakeOllama, fakeSlack, fakeSoniox, fakeTelegram, sleep, tempHome, waitFor } from "./helpers.js";

const PASSWORD = "correct horse battery staple";

describe("subscription usage", () => {
  const reset = "2026-11-16T20:00:00.000Z";
  const gemini = { status: "SUCCESS", command: { data: { groups: [
    { name: "Gemini Models", buckets: [{ id: "weekly", window: "weekly", remaining_fraction: .8, reset_time: reset }, { id: "session", window: "5h", remaining_fraction: .45, reset_time: reset }] },
    { name: "Gemini 4 Argon", buckets: [{ id: "argon", window: "weekly", remaining_fraction: 0, reset_time: reset }] },
  ] } } };
  const claude = { five_hour: { utilization: 15, resets_at: reset }, seven_day: { utilization: 30, resets_at: reset },
    limits: [{ kind: "weekly_scoped", scope: { model: { display_name: "Fable" } }, percent: 60, resets_at: reset }], fable_weekly: { utilization: 20 }, seven_day_fable: { utilization: 25 }, seven_day_opus: { utilization: 10, resets_at: reset } };

  test("preserves model allowances, account windows, resets and unknown values", () => {
    const c = parseSubscriptionUsage("claude", claude);
    assert.deepEqual(c.map((item) => [item.kind, item.group, item.usedPercent]), [["session", "", 15], ["weekly", "", 30], ["weekly", "Fable", 60], ["weekly", "Opus", 10]]);
    assert.equal(c[2].resetsAt, reset);
    assert.deepEqual(parseSubscriptionUsage("gemini", gemini).map((item) => [item.kind, item.group, Math.round(item.usedPercent)]), [["weekly", "", 20], ["session", "", 55], ["weekly", "Gemini 4 Argon", 100]]);
    assert.deepEqual(parseSubscriptionUsage("codex", { rateLimitsByLimitId: { codex: { primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1794859200 }, secondary: { usedPercent: null } }, spark: { limitName: "Spark", primary: { usedPercent: 50, windowDurationMins: 60 } } }, rateLimits: { primary: { usedPercent: 99 } } }).map((item) => [item.kind, item.group, item.usedPercent]), [["session", "", 12], ["custom", "Spark", 50]]);
    assert.equal(parseSubscriptionUsage("muse", { subs_usage: { window: { used_percent: 0, window_duration_mins: 300, resets_at: 1794859200 }, weekly: { used_percent: 23, resets_at: reset } } }).length, 2);
    assert.deepEqual(parseSubscriptionUsage("muse", { schemaVersion: 1, allowance: { window: { usedPercent: 10, resetsAtMs: 1794859200000 }, weekly: { usedPercent: 15, resetsAtMs: 1794859200000 } } }).map((item) => [item.kind, item.usedPercent, item.resetsAt]), [["session", 10, "2026-11-16T20:00:00.000Z"], ["weekly", 15, "2026-11-16T20:00:00.000Z"]]);
    assert.equal(parseSubscriptionUsage("ollama", { Included: { Allowance_USD: 100, Balance_USD: 3, Period: { Until: reset } } })[0].usedPercent, 97);
    assert.deepEqual(parseSubscriptionUsage("ollama", { included: { session: { remaining_percent: 75, resets_at: reset }, weekly: { remaining_percent: 40, resets_at: reset } } }).map((item) => item.usedPercent), [25, 60]);
    assert.deepEqual(parseSubscriptionUsage("ollama", { included: { balance_usd: 3 } }), [], "an absent allowance is not a percentage");
    assert.deepEqual(parseSubscriptionBalances("deepseek", { balance_infos: [{ currency: "USD", total_balance: "12.012345", granted_balance: "0.00", topped_up_balance: "12.012345" }, { currency: "CNY", total_balance: "110.00" }] }), [{ kind: "total", currency: "USD", amount: "12.012345" }, { kind: "granted", currency: "USD", amount: "0.00" }, { kind: "topped-up", currency: "USD", amount: "12.012345" }, { kind: "total", currency: "CNY", amount: "110.00" }]);
    assert.deepEqual(parseSubscriptionBalances("deepseek", { balance_infos: [{ currency: "USD", total_balance: null }] }), []);
    assert.deepEqual(parseSubscriptionUsage("claude", { five_hour: { utilization: null }, seven_day: { utilization: "invalid" } }), []);
    assert.deepEqual(parseSubscriptionUsage("grok", {}), []);
    const weekly = { currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", start: "2026-11-09T20:00:00Z", end: reset }, billingPeriodStart: "2026-11-09T20:00:00Z", billingPeriodEnd: reset };
    assert.equal(parseSubscriptionUsage("grok", weekly)[0].usedPercent, 0);
    assert.deepEqual(parseSubscriptionUsage("grok", { ...weekly, used: { val: 0 } }), [], "an explicit zero amount is insufficient to infer the percentage");
    assert.equal(parseSubscriptionUsage("grok", { monthlyLimit: { val: 100 }, used: { val: 25 } })[0].usedPercent, 25);
  });

  test("reads native account usage without generating model turns or exposing credentials", async (t) => {
    const f = await subscriptionApp(t);
    f.identity.set({ geminiUsage: gemini, codexUsage: { rateLimits: { primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1794859200 } } }, museUsage: { schemaVersion: 1, allowance: { window: { usedPercent: 10, resetsAtMs: 1794859200000 }, weekly: { usedPercent: 15, resetsAtMs: 1794859200000 } } } });
    for (const provider of ["gemini", "codex", "muse"]) {
      const record = f.app.store.createSubscription({ provider, label: provider });
      const directory = f.app.subscriptions.directory(record);
      writeFileSync(join(directory, "fixture-account.json"), JSON.stringify({ type: "chatgpt", email: "fixture@example.test", planType: "pro" }));
      f.app.store.updateSubscription(record.id, { status: "ready" });
      await f.app.subscriptions.usage.refresh(record.id);
      const response = await f.request(`/api/subscriptions/${record.id}/usage`);
      assert.equal(response.status, 200); assert.equal(response.data.state, "ready");
      assert.ok(response.data.windows.length > 0); assert.equal(f.app.store.subscription(record.id).status, "ready");
    }
    assert.equal(f.identity.calls().length, 0, "usage must not call a model");
    const seen = [];
    const server = http.createServer((req, res) => {
      seen.push({ url: req.url, authorization: req.headers.authorization, beta: req.headers["anthropic-beta"] });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(req.url.includes("anthropic") ? { ...claude, privateField: "must-not-escape" } : { config: { creditUsagePercent: 7, currentPeriod: { end: reset, type: "USAGE_PERIOD_TYPE_WEEKLY" } }, key: "must-not-escape" }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    for (const provider of ["claude", "grok"]) {
      const result = await readNativeUsage({ provider, directory: "/synthetic-profile", credentialReader: async () => ({ token: "synthetic-test-token" }), request: (url, options) => fetch(`http://127.0.0.1:${server.address().port}/${url.includes("anthropic") ? "anthropic" : "grok"}`, options) });
      assert.ok(result.windows.length); assert.doesNotMatch(JSON.stringify(result), /must-not-escape|synthetic-test-token/);
    }
    assert.equal(seen.length, 2); assert.ok(seen.every((item) => item.authorization === "Bearer synthetic-test-token"));
    assert.equal(seen[0].beta, "oauth-2025-04-20");
    await assert.rejects(readNativeUsage({ provider: "claude", directory: "/synthetic", credentialReader: async () => ({ token: "synthetic" }), request: async () => new Response("private response", { status: 429, headers: { "Retry-After": "3600" } }) }), (error) => error.code === "RATE_LIMITED" && error.retryAfterMs === 3600000 && !error.message.includes("private"));
  });

  test("isolates owners before reads and cache access, coalesces requests and persists cooldown", async (t) => {
    let reads = 0, result = claude;
    let time = Date.parse("2026-11-09T20:00:00Z");
    const f = await knowledgeWorld({ subscriptionUsageIntervalMs: 0, subscriptionUsageReader: async () => { reads++; await sleep(30); if (result instanceof Error) throw result; return result; } });
    t.after(f.close);
    f.app.subscriptions.usage.now = () => time;
    const record = f.app.store.createSubscription({ provider: "claude", label: "Alice Claude", connectedBy: { id: f.alice.user.id } });
    f.app.store.updateSubscription(record.id, { status: "ready" });
    f.app.store.createAgent({ name: "Alice quota", model: "claude/test", subscriptionId: record.id, brainOwnerId: f.alice.user.id, enabled: false, tools: false });
    const path = `/api/subscriptions/${record.id}/usage`;
    assert.equal((await f.request(f.bob, path)).status, 404);
    assert.equal((await f.request(f.admin, path)).status, 404); assert.equal(reads, 0);
    await Promise.all(Array.from({ length: 8 }, () => f.request(f.alice, path)));
    assert.equal(reads, 0, "page requests must never read providers");
    await Promise.all(Array.from({ length: 8 }, () => f.app.subscriptions.usage.refresh(record.id)));
    const responses = await Promise.all(Array.from({ length: 8 }, () => f.request(f.alice, path)));
    assert.ok(responses.every((response) => response.status === 200 && response.data.windows.length === 4)); assert.equal(reads, 1);
    assert.equal((await f.request(f.bob, path)).status, 404); assert.equal(reads, 1);
    await f.request(f.alice, path); assert.equal(reads, 1);
    time += 300001; result = Object.assign(new Error("private upstream detail"), { code: "RATE_LIMITED", retryAfterMs: 3600000 });
    await f.app.subscriptions.usage.refresh(record.id);
    const limited = (await f.request(f.alice, path)).data;
    assert.equal(limited.state, "cooldown"); assert.equal(limited.stale, true); assert.equal(limited.windows[2].group, "Fable");
    assert.equal(Date.parse(limited.nextCheckAt) - time, 3600000); assert.doesNotMatch(JSON.stringify(limited), /private upstream/);
    await f.app.subscriptions.usage.close();
    f.app.subscriptions.usage = new SubscriptionUsage({ store: f.app.store, subscriptions: f.app.subscriptions, now: () => time, read: async () => { reads++; return claude; } });
    assert.equal((await f.request(f.alice, path)).data.state, "cooldown"); assert.equal(reads, 2);
    time += 3600001;
    await f.app.subscriptions.usage.refresh(record.id);
    assert.equal((await f.request(f.alice, path)).data.state, "ready"); assert.equal(reads, 3);
    assert.equal(f.app.store.subscription(record.id).status, "ready");
  });

  test("private quota and global token APIs include only the viewer's agents, including warm legacy caches", async (t) => {
    const f = await knowledgeWorld({ subscriptionUsageIntervalMs: 0, subscriptionUsageReader: async () => claude });
    t.after(f.close);
    const records = [];
    for (const [actor, tokens] of [[f.alice, 100], [f.bob, 9000]]) {
      const record = f.app.store.createSubscription({ provider: "claude", label: actor.user.name, connectedBy: { id: actor.user.id } });
      f.app.store.updateSubscription(record.id, { status: "ready" });
      const agent = f.app.store.createAgent({ name: actor.user.name, model: "claude/test", subscriptionId: record.id, brainOwnerId: actor.user.id, enabled: false, tools: false });
      const trace = f.app.traces.start({ agentId: agent.id, kind: "chat", channelId: "web", model: agent.model });
      trace.spent({ in: tokens - 10, out: 10 }); trace.finish({ status: "done", output: "PASS" });
      records.push({ record, agent, actor, tokens });
    }
    const legacy = f.app.store.createSubscription({ provider: "claude", label: "Legacy connection", connectedBy: { id: f.alice.user.id } });
    f.app.store.updateSubscription(legacy.id, { status: "ready" });
    f.app.store.createAgent({ name: "Bob legacy", model: "claude/test", subscriptionId: legacy.id, brainOwnerId: f.bob.user.id, enabled: false, tools: false });
    await f.app.subscriptions.usage.refreshAll();
    for (const { actor, record, agent, tokens } of records) {
      const state = (await f.request(actor, "/api/state")).data;
      assert.deepEqual(state.quotaAccounts.map(item => item.id), [record.id]);
      assert.equal(state.quotaAccounts[0].usage.windows.length, 4);
      assert.ok(state.subscriptions.every(item => !Object.hasOwn(item, "usage")), "management metadata cannot bypass the quota scope");
      const usage = (await f.request(actor, "/api/usage")).data.usage;
      assert.deepEqual(usage.map(item => item.agentId), [agent.id]);
      assert.equal(usage[0].tokensIn + usage[0].tokensOut, tokens);
      for (const other of records.filter(item => item.actor !== actor)) assert.equal((await f.request(actor, `/api/subscriptions/${other.record.id}/usage`)).status, 404);
      assert.equal((await f.request(actor, `/api/subscriptions/${legacy.id}/usage`)).status, 404);
    }
    assert.deepEqual((await f.request(f.admin, "/api/usage")).data.usage, []);
    assert.deepEqual((await f.request(f.admin, "/api/state")).data.quotaAccounts, []);
    const metadata = (await f.request(f.alice, `/api/subscriptions/${legacy.id}`)).data;
    assert.equal(Object.hasOwn(metadata, "usage"), false);
    assert.equal(f.app.subscriptions.usage.get(legacy.id).windows.length, 4, "denial holds even with a populated cache");
  });

  test("Agents identifies multiple accounts by email, deduplicates shared assignments and hides unused connections", async (t) => {
    const f = await subscriptionApp(t);
    const accounts = [];
    for (const email of ["first@example.test", "second@example.test", "unused@example.test"]) {
      const record = f.app.store.createSubscription({ provider: "claude", label: "Claude" });
      f.app.store.updateSubscription(record.id, { status: "ready", email }); accounts.push(record);
    }
    for (const [index, name] of [[0, "One"], [0, "Two"], [1, "Three"]]) f.app.store.createAgent({ name, model: "claude/test", subscriptionId: accounts[index].id, enabled: false, tools: false });
    f.app.subscriptions.usage.read = async () => claude;
    await f.app.subscriptions.usage.refreshAll();
    assert.equal(f.app.subscriptions.usage.get(accounts[2].id).fetchedAt, null, "unused accounts are not polled");
    const panel = panelHarness({ hash: "#/agenti", fetch: async (path, options = {}) => {
      const response = await f.request(path, { method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
      return { ok: response.status < 400, status: response.status, json: async () => response.data };
    } });
    panel.run('S.usageView = "quotas"');
    const boot = panel.run("boot()");
    assert.ok(panel.app.querySelector(".sk-quotas"), "the quota preference reserves the compact quota outline");
    await boot;
    const quota = panel.app.querySelector(".subscription-usage");
    assert.equal(quota.querySelector(".quota-tabs").querySelectorAll("button").length, 2);
    assert.match(quota.querySelector(".quota-tabs").textContent, /first@example.test.*second@example.test/);
    assert.doesNotMatch(quota.textContent, /unused@example.test/);
    assert.match(quota.querySelector("article").textContent, /One.*Two/);
    f.app.store.updateSubscription(accounts[1].id, { status: "disconnected" });
    const state = (await f.request("/api/state")).data;
    panel.run(`S.data = ${JSON.stringify(state)}; renderAgents()`);
    assert.equal(panel.app.querySelector(".quota-tabs").querySelectorAll("button").length, 1);
  });

  test("invalidates in-flight reads on reconnect and bounds provider concurrency", async (t) => {
    const f = await subscriptionApp(t);
    const usage = f.app.subscriptions.usage;
    const gate = Promise.withResolvers(); let active = 0, maximum = 0, entered = 0;
    usage.read = async () => { active++; maximum = Math.max(maximum, active); entered++; await gate.promise; active--; return claude; };
    const records = Array.from({ length: 6 }, (_, i) => { const record = f.app.store.createSubscription({ provider: "claude", label: `Claude ${i}` }); f.app.store.updateSubscription(record.id, { status: "ready" }); return record; });
    const work = records.map((record) => usage.refresh(record.id));
    await waitFor(() => entered === 3);
    f.app.subscriptions.changed(records[0].id, { status: "connecting" });
    f.app.store.updateSubscription(records[0].id, { status: "ready", email: "new-account@example.test" });
    gate.resolve();
    await Promise.all(work);
    assert.equal(maximum, 3);
    assert.deepEqual(f.app.store.value(usage.key(records[0].id)).windows, [], "old account must not repopulate the cache");
    assert.equal((await usage.refresh(records[0].id)).windows.length, 4);
  });

  test("keeps last known values on missing data, retains backoff across a service restart and clears removed accounts", async (t) => {
    const f = await subscriptionApp(t);
    let time = Date.parse("2026-11-09T20:00:00Z");
    const record = f.app.store.createSubscription({ provider: "claude", label: "Persistent Claude" });
    f.app.store.updateSubscription(record.id, { status: "ready" });
    const usage = f.app.subscriptions.usage, path = `/api/subscriptions/${record.id}/usage`;
    usage.now = () => time; usage.read = async () => claude;
    const pull = async () => { await usage.refresh(record.id); return (await f.request(path)).data; };
    const first = await pull();
    time += 300001; usage.read = async () => ({});
    const missing = await pull();
    assert.equal(missing.state, "unavailable"); assert.equal(missing.stale, true);
    assert.deepEqual(missing.windows, first.windows); assert.equal(missing.fetchedAt, first.fetchedAt);
    time += 300001; usage.read = async () => { throw Object.assign(new Error("synthetic throttle"), { code: "RATE_LIMITED" }); };
    const throttled = await pull();
    assert.equal(Date.parse(throttled.nextCheckAt) - time, 1800000);
    time += 1800001;
    const again = await pull();
    assert.equal(Date.parse(again.nextCheckAt) - time, 3600000);
    await f.stop();
    const restarted = await subscriptionApp(t, f);
    restarted.app.subscriptions.usage.now = () => time;
    let reads = 0;
    restarted.app.subscriptions.usage.read = async () => { reads++; return claude; };
    assert.deepEqual((await restarted.request(path)).data, again); assert.equal(reads, 0);
    assert.equal((await restarted.request(`/api/subscriptions/${record.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await restarted.request(path)).status, 404);
    assert.equal(restarted.app.store.value(usage.key(record.id)), null);
  });

  test("backend service refreshes independently of browser requests and retains rate-limit waits", async (t) => {
    const f = await subscriptionApp(t);
    const record = f.app.store.createSubscription({ provider: "codex", label: "Background account" });
    f.app.store.updateSubscription(record.id, { status: "ready" });
    f.app.store.createAgent({ name: "Background", model: "codex/test", subscriptionId: record.id, enabled: false, tools: false });
    const usage = f.app.subscriptions.usage; let reads = 0, time = Date.now();
    usage.now = () => time;
    usage.read = async () => { reads++; return { rateLimits: { primary: { usedPercent: 87, windowDurationMins: 10080 } } }; };
    usage.start(20);
    await waitFor(() => reads === 1);
    for (let i = 0; i < 20; i++) {
      const response = await f.request(`/api/subscriptions/${record.id}/usage`);
      assert.equal(response.data.windows[0].usedPercent, 87);
    }
    assert.equal(reads, 1, "multiple tabs and refreshes only read persisted snapshots");
    time += 60001;
    await waitFor(() => reads === 2);
    time += 60001;
    usage.read = async () => { reads++; throw Object.assign(new Error("synthetic throttle"), { code: "RATE_LIMITED", retryAfterMs: 600000 }); };
    await waitFor(() => reads === 3);
    const snapshot = (await f.request(`/api/subscriptions/${record.id}/usage`)).data;
    assert.equal(snapshot.state, "cooldown"); assert.equal(Date.parse(snapshot.nextCheckAt) - time, 600000);
    time += 60001;
    await sleep(80); assert.equal(reads, 3, "minute service honors longer cooldowns");
    await usage.close();
  });

  test("minute service waits for a slow backend cycle before scheduling the next one", async (t) => {
    const f = await subscriptionApp(t), gate = Promise.withResolvers(), completed = Promise.withResolvers();
    const record = f.app.store.createSubscription({ provider: "codex", label: "Slow background account" });
    f.app.store.updateSubscription(record.id, { status: "ready" });
    f.app.store.createAgent({ name: "Background", model: "codex/test", subscriptionId: record.id, enabled: false, tools: false });
    let reads = 0, notifications = 0;
    f.app.subscriptions.usage.read = async () => { reads++; await gate.promise; return { rateLimits: { primary: { usedPercent: 87 } } }; };
    f.app.subscriptions.usage.emit = () => { notifications++; completed.resolve(); };
    f.app.subscriptions.usage.start(20);
    await waitFor(() => reads === 1); await sleep(70);
    gate.resolve(); await completed.promise; await sleep(1);
    assert.equal(reads, 1); assert.equal(notifications, 1, "a slow cycle produces one update without overlapping timers");
    await f.app.subscriptions.usage.close();
  });

  test("backend reads Ollama allowances and DeepSeek balances once, while server finances stay owner-only", async (t) => {
    const calls = [];
    const server = http.createServer((req, res) => {
      calls.push({ path: req.url, authorization: req.headers.authorization });
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/user/balance") return res.end(JSON.stringify({ is_available: true, balance_infos: [{ currency: "USD", total_balance: "12.50", granted_balance: "2.50", topped_up_balance: "10.00" }] }));
      if (req.url === "/api/balance") return res.end(JSON.stringify({ included: { balance_usd: 3, allowance_usd: 100, period: { until: reset } }, purchased: { balance_usd: 25 } }));
      res.end(JSON.stringify({ data: [] }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const f = await knowledgeWorld({ subscriptionUsageIntervalMs: 0, ollamaKey: "synthetic-ollama-key", deepseekKey: "synthetic-deepseek-key", deepseekApi: endpoint, ollamaBalanceApi: endpoint + "/api/balance" });
    t.after(f.close);
    const owner = (await f.request(f.admin, "/api/state")).data.currentUser.id;
    for (const provider of ["ollama", "deepseek"]) {
      f.app.store.createAgent({ name: provider, model: `${provider}/test`, brainOwnerId: owner, enabled: false, tools: false });
      assert.equal((await f.request(f.alice, `/api/providers/${provider}/usage`)).status, 404);
      assert.equal((await f.request(f.admin, `/api/providers/${provider}/usage`)).status, 200);
    }
    assert.equal(calls.length, 0, "cache-only endpoints never call the upstream");
    assert.deepEqual((await f.request(f.alice, "/api/state")).data.providerUsage, []);
    await f.app.subscriptions.usage.refreshAll();
    assert.equal(calls.length, 2);
    const ollama = (await f.request(f.admin, "/api/providers/ollama/usage")).data;
    assert.equal(ollama.state, "ready"); assert.equal(ollama.windows[0].usedPercent, 97);
    assert.deepEqual(ollama.balances.map((item) => item.amount), ["3", "100", "25"]);
    const deepseek = (await f.request(f.admin, "/api/providers/deepseek/usage")).data;
    assert.equal(deepseek.state, "ready"); assert.deepEqual(deepseek.balances.map((item) => item.amount), ["12.50", "2.50", "10.00"]);
    assert.deepEqual(deepseek.windows, [], "API balances must not become invented percentages");
    for (let i = 0; i < 10; i++) await f.request(f.admin, "/api/providers/deepseek/usage");
    assert.equal(calls.length, 2);
    const state = (await f.request(f.admin, "/api/state")).data;
    assert.equal(state.providerUsage.length, 2);
    assert.doesNotMatch(JSON.stringify(state), /synthetic-ollama-key|synthetic-deepseek-key|usageIdentity/);
    f.app.llm.deepseek.key = "synthetic-replacement-key";
    assert.deepEqual((await f.request(f.admin, "/api/providers/deepseek/usage")).data.balances, [], "new credentials cannot expose the previous account's balance");
  });

  test("Agents includes Ollama residual percentage and DeepSeek balances in one selected account", async (t) => {
    const f = await subscriptionApp(t);
    f.app.llm.ollamaKey = "synthetic-ollama-key"; f.app.llm.deepseek.key = "synthetic-deepseek-key";
    for (const provider of ["ollama", "deepseek"]) f.app.store.createAgent({ name: provider, model: `${provider}/test`, enabled: false, tools: false });
    f.app.subscriptions.usage.read = async (record) => record.provider === "ollama"
      ? { included: { balance_usd: 3, allowance_usd: 100, period: { until: reset } }, purchased: { balance_usd: 25 } }
      : { balance_infos: [{ currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" }] };
    await f.app.subscriptions.usage.refreshAll();
    const panel = panelHarness({ hash: "#/agenti", fetch: async (path, options = {}) => {
      const response = await f.request(path, { method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
      return { ok: response.status < 400, status: response.status, json: async () => response.data };
    } });
    await panel.run("boot()");
    const quota = panel.app.querySelector(".subscription-usage"), slots = quota.querySelectorAll("article"), tabs = quota.querySelector(".quota-tabs").querySelectorAll("button");
    assert.equal(tabs.length, 2); assert.equal(slots.filter((slot) => !slot.hidden).length, 1);
    assert.match(slots[0].textContent, /3%disponibile/);
    tabs[1].click();
    assert.equal(slots[1].hidden, false); assert.equal(slots[0].hidden, true);
    assert.equal(slots[1].querySelectorAll("progress").length, 0);
    assert.match(slots[1].textContent, /Saldo disponibile/); assert.match(slots[1].textContent, /110,00.*CNY/);
  });

  test("Agents shows remaining allowance in compact tabs without reloading on live updates", async (t) => {
    const f = await subscriptionApp(t);
    const record = f.app.store.createSubscription({ provider: "gemini", label: "Google personale" });
    const codex = f.app.store.createSubscription({ provider: "codex", label: "ChatGPT personale" });
    for (const item of [record, codex]) {
      f.app.store.updateSubscription(item.id, { status: "ready" });
      f.app.store.createAgent({ name: item.label, model: `${item.provider}/test`, subscriptionId: item.id, enabled: false, tools: false });
    }
    const gate = Promise.withResolvers(); let reads = 0, cacheRequests = 0;
    f.app.subscriptions.usage.read = async (item, signal) => { reads++; await Promise.race([gate.promise, new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }))]); return item.provider === "gemini" ? gemini : { rateLimits: { secondary: { usedPercent: 87, windowDurationMins: 10080, resetsAt: 1794859200 } } }; };
    const background = f.app.subscriptions.usage.refreshAll();
    const panel = panelHarness({ hash: "#/agenti", fetch: async (path, options = {}) => {
      if (/subscriptions.*usage$/.test(path)) cacheRequests++;
      const response = await f.request(path, { method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
      return { ok: response.status < 400, status: response.status, json: async () => response.data };
    } });
    await panel.run("boot()");
    const overview = panel.app.querySelector(".usage-overview");
    assert.equal(overview.querySelectorAll("section").filter(node => !node.hidden).length, 1);
    overview.querySelector(".usage-toggle").click();
    assert.equal(panel.app.querySelector(".subscription-usage").hidden, false);
    assert.match(panel.app.textContent, /Lettura delle quote/); assert.doesNotMatch(panel.app.textContent, /null|undefined/);
    const mounted = panel.app.querySelector(".quota-accounts"), quota = panel.app.querySelector(".subscription-usage");
    const tabs = quota.querySelector(".quota-tabs").querySelectorAll("button");
    assert.equal(tabs.length, 2);
    assert.equal(mounted.querySelectorAll("article").filter((item) => !item.hidden).length, 1);
    gate.resolve(); await background; await quota.refreshQuota();
    assert.deepEqual(mounted.querySelectorAll("article")[0].querySelectorAll("progress").map((item) => Math.round(Number(item.value))), [80, 45, 0]);
    tabs[1].click();
    const selected = mounted.querySelectorAll("article").find((item) => !item.hidden);
    assert.match(selected.textContent, /13%disponibile/);
    assert.equal(Number(selected.querySelector("progress").value), 13);
    assert.equal(tabs[1].getAttribute("aria-selected"), "true");
    const meter = selected.querySelector("progress"), before = cacheRequests;
    quota.querySelector(".usage-toggle").click();
    overview.querySelector(".usage-toggle").click();
    assert.equal(overview.querySelectorAll("section").filter(node => !node.hidden).length, 1);
    assert.equal(selected.querySelector("progress"), meter, "switching views keeps the account and meter mounted");
    for (let i = 0; i < 5; i++) await panel.run("renderAgents()");
    assert.equal(panel.app.querySelector(".quota-accounts"), mounted);
    assert.equal(selected.querySelector("progress"), meter, "identical snapshots never reconstruct the account");
    assert.equal(selected.hidden, false, "selected tab survives unrelated page updates");
    assert.equal(cacheRequests, before); assert.equal(reads, 2, "page refreshes and tab selection do not read providers");
    f.app.subscriptions.usage.now = () => Date.now() + 60001;
    await f.app.subscriptions.usage.refreshAll(); await quota.refreshQuota();
    assert.equal(selected.querySelector("progress"), meter, "a new timestamp alone updates the footer, not the meter");
    tabs[0].click();
    f.app.subscriptions.usage.invalidate(record.id); f.app.subscriptions.usage.read = async () => ({});
    await f.app.subscriptions.usage.refresh(record.id); await quota.refreshQuota();
    const visible = mounted.querySelectorAll("article").find((item) => !item.hidden);
    assert.match(visible.textContent, /non ha restituito/); assert.equal(visible.querySelectorAll("progress").length, 0);
    f.app.subscriptions.usage.invalidate(record.id); f.app.subscriptions.usage.read = async () => gemini;
    await f.app.subscriptions.usage.refresh(record.id); await quota.refreshQuota();
    assert.equal(visible.querySelectorAll("progress").length, 3);
    assert.equal(panel.app.querySelector(".quota-accounts"), mounted);
    assert.doesNotMatch(panel.app.textContent, /null|undefined/);
  });
});
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
let departures;
let cli;
let home;
let orca;
const subscriptionIds = {};
const botTokens = {};
const hushVault = {};

async function subscriptionApp(t, existing) {
  const identity = existing?.identity || identityCli();
  const directory = existing?.home || tempHome();
  const instance = startCora({ subscriptionUsageIntervalMs: 0, home: directory, host: "127.0.0.1", port: 0, insecureCookies: true,
    adminPassword: PASSWORD, sessionKey: "subscription-fixture-session", useResidentSubscriptions: false, discordToken: "", telegramToken: "", ollamaKey: "", orcaKey: "", cloudUrl: "", cloudKey: "", cloudSpace: "",
    claudeBin: identity.claude, codexBin: identity.codex, grokBin: identity.grok, museBin: identity.muse, geminiBin: identity.gemini, hermesBin: "/not-installed/hermes", botTokenFor: () => "",
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
    if (/^Valuti il disingaggio/.test(system)) return { content: JSON.stringify({ leave: departures ? await departures(body) : [] }) };
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
    subscriptionUsageIntervalMs: 0,
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
    deepseekBin: cli.dsh,
    hermesHome: join(home, "hermes-home"),
    hermesBaseUrl: `${ollama.url}/v1`,
    claudeBin: cli.claude,
    codexBin: cli.codex,
    grokBin: cli.grok,
    museBin: cli.muse,
    geminiBin: cli.gemini,
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
  for (const provider of ["claude", "codex", "grok", "muse", "gemini"]) {
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
  departures = null;
  discord.state.webhookPosts.length = 0;
  discord.state.botPosts.length = 0;
});

async function panelMcpWorld(t, overrides = {}) {
  const f = await knowledgeWorld(overrides); t.after(f.close);
  const issue = async (actor, body = {}) => {
    const response = await f.request(actor, "/api/mcp/tokens", { method: "POST", body: { name: "Integration client", ...body } });
    assert.equal(response.status, 201); return response.data;
  };
  const rpc = async (access, method, params = {}, extra = {}) => {
    const response = await fetch(f.base + "/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(access ? { Authorization: `Bearer ${access.token}` } : {}), ...extra.headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), ...extra.options });
    const text = await response.text(); return { status: response.status, data: text ? JSON.parse(text) : null, headers: response.headers };
  };
  const invoke = (access, args) => rpc(access, "tools/call", { name: "cora_request", arguments: args });
  return { ...f, issue, rpc, invoke };
}

test("external configuration MCP uses personal hashed credentials and the current panel identity", async (t) => {
  const f = await panelMcpWorld(t), alice = await f.issue(f.alice), bob = await f.issue(f.bob);
  assert.equal((await f.rpc(null, "initialize")).status, 401);
  const initialize = await f.rpc(alice, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fixture", version: "1" } });
  assert.equal(initialize.status, 200); assert.equal(initialize.data.result.protocolVersion, "2025-11-25");
  assert.equal(initialize.data.result.serverInfo.name, "cora-panel");
  const tools = (await f.rpc(alice, "tools/list")).data.result.tools;
  assert.deepEqual(tools.map(tool => tool.name), ["cora_state", "cora_configurations", "cora_request"]);
  const state = (await f.rpc(alice, "tools/call", { name: "cora_state", arguments: { userId: f.bob.user.id, role: "owner" } }, { headers: f.admin.headers })).data.result;
  assert.equal(state.structuredContent.data.currentUser.id, f.alice.user.id);
  assert.equal(state.structuredContent.data.currentUser.role, "member");
  const stored = JSON.stringify(f.app.store.value("panelMcpTokens"));
  assert.ok(!stored.includes(alice.token) && !stored.includes(bob.token));
  const view = await f.request(f.alice, "/api/mcp/tokens");
  assert.equal(view.data.tokens.length, 1); assert.equal(view.data.tokens[0].id, alice.id);
  assert.ok(!JSON.stringify(view.data).includes(alice.token)); assert.ok(!JSON.stringify(view.data).includes('"hash"'));
  assert.equal((await f.request(f.alice, `/api/mcp/tokens/${bob.id}`, { method: "DELETE" })).status, 404);
  assert.equal((await f.rpc(bob, "ping")).status, 200);
  assert.equal((await f.request(f.alice, `/api/mcp/tokens/${alice.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await f.rpc(alice, "ping")).status, 401);
  assert.equal((await f.rpc({ token: "invalid" }, "ping", {}, { headers: f.admin.headers })).status, 401, "panel cookies cannot replace MCP bearer authentication");
});

test("external configuration MCP preserves private ownership, shared-agent grants and their revocation", async (t) => {
  const f = await panelMcpWorld(t), alice = await f.issue(f.alice), bob = await f.issue(f.bob), admin = await f.issue(f.admin);
  const created = (await f.invoke(alice, { method: "POST", path: "/api/agents", body: { name: "MCP agent", tools: false, enabled: false, brainOwnerId: f.bob.user.id, ownerIds: ["discord:forged"] } })).data.result;
  assert.equal(created.structuredContent.status, 201); const agent = created.structuredContent.data;
  assert.equal(agent.brainOwnerId, f.alice.user.id);
  assert.deepEqual(agent.ownerIds, []);
  for (const access of [bob, admin]) assert.equal((await f.invoke(access, { path: `/api/agents/${agent.id}` })).data.result.structuredContent.status, 403);
  const update = await f.invoke(alice, { method: "PUT", path: `/api/agents/${agent.id}`, body: { personality: "Configured through the actual panel API" } });
  assert.equal(update.data.result.isError, false); assert.equal(f.app.store.agent(agent.id).personality, "Configured through the actual panel API");
  const other = f.app.store.createAgent({ name: "Still private", brainOwnerId: f.alice.user.id, tools: false, enabled: false });
  const ownership = (await f.invoke(alice, { path: `/api/agents/${agent.id}/owners` })).data.result.structuredContent.data;
  assert.equal((await f.invoke(alice, { method: "PUT", path: `/api/agents/${agent.id}/owners`, body: { users: [f.alice.user.id, f.bob.user.id], contacts: [], version: ownership.version } })).data.result.structuredContent.status, 200);
  assert.equal((await f.invoke(bob, { path: `/api/agents/${agent.id}` })).data.result.structuredContent.status, 200);
  assert.equal((await f.invoke(bob, { path: `/api/agents/${other.id}` })).data.result.structuredContent.status, 403);
  assert.equal((await f.invoke(bob, { path: `/api/brain?ownerId=${f.alice.user.id}` })).data.result.structuredContent.status, 200);
  const current = (await f.invoke(alice, { path: `/api/agents/${agent.id}/owners` })).data.result.structuredContent.data;
  assert.equal((await f.invoke(alice, { method: "PUT", path: `/api/agents/${agent.id}/owners`, body: { users: [f.alice.user.id], contacts: [], version: current.version } })).data.result.structuredContent.status, 200);
  assert.equal((await f.invoke(bob, { path: `/api/agents/${agent.id}` })).data.result.structuredContent.status, 403);
  assert.equal((await f.invoke(bob, { path: `/api/brain?ownerId=${f.alice.user.id}` })).data.result.structuredContent.status, 403);
  assert.equal((await f.rpc(bob, "ping")).status, 200, "revoking a resource does not affect another user\'s own MCP identity");
});

test("the space owner connects Slack and Telegram apps for someone else's agent without opening the private agent", async (t) => {
  const f = await panelMcpWorld(t), alice = await f.issue(f.alice), bob = await f.issue(f.bob), admin = await f.issue(f.admin);
  const created = (await f.invoke(alice, { method: "POST", path: "/api/agents", body: { name: "Transport agent", tools: false, enabled: false } })).data.result;
  assert.equal(created.structuredContent.status, 201);
  const agent = created.structuredContent.data;
  assert.equal((await f.invoke(admin, { path: `/api/agents/${agent.id}` })).data.result.structuredContent.status, 403);
  assert.equal((await f.invoke(admin, { method: "PUT", path: `/api/agents/${agent.id}`, body: { personality: "closed" } })).data.result.structuredContent.status, 403);
  const roster = (await f.invoke(admin, { path: "/api/transport-accounts" })).data.result;
  assert.equal(roster.structuredContent.status, 200);
  const row = roster.structuredContent.data.agents.find((item) => item.id === agent.id);
  assert.equal(row.name, "Transport agent");
  assert.equal(row.personality, undefined);
  assert.equal(row.core, undefined);
  assert.equal(row.slackBot.state, "missing-token");
  assert.equal(row.telegramBot.state, "missing-token");
  assert.equal(JSON.stringify(roster.structuredContent.data).includes("xoxb-"), false);
  assert.equal((await f.invoke(bob, { path: "/api/transport-accounts" })).data.result.structuredContent.status, 403);
  const telegram = await f.invoke(admin, { method: "PUT", path: `/api/agents/${agent.id}/telegram-bot`, body: { token: "not-a-token" } });
  assert.equal(telegram.data.result.structuredContent.status, 400);
  assert.match(telegram.data.result.structuredContent.data.error, /BotFather/);
  assert.equal((await f.invoke(bob, { method: "PUT", path: `/api/agents/${agent.id}/telegram-bot`, body: { token: "not-a-token" } })).data.result.structuredContent.status, 403);
  const slack = await f.invoke(admin, { method: "PUT", path: `/api/agents/${agent.id}/slack-bot`, body: { botToken: "nope", appToken: "nope" } });
  assert.equal(slack.data.result.structuredContent.status, 400);
  assert.match(slack.data.result.structuredContent.data.error, /xoxb-/);
  assert.equal((await f.invoke(bob, { method: "PUT", path: `/api/agents/${agent.id}/slack-bot`, body: { botToken: "nope", appToken: "nope" } })).data.result.structuredContent.status, 403);
  const sync = await f.invoke(admin, { method: "POST", path: `/api/agents/${agent.id}/slack-app` });
  assert.equal(sync.data.result.structuredContent.status, 409);
  assert.equal((await f.invoke(alice, { method: "PUT", path: `/api/agents/${agent.id}/telegram-bot`, body: { token: "not-a-token" } })).data.result.structuredContent.status, 400);
});


test("external configuration MCP restricts owner operations, read-only keys, expired keys and revoked admission", async (t) => {
  const f = await panelMcpWorld(t), alice = await f.issue(f.alice), admin = await f.issue(f.admin), reader = await f.issue(f.admin, { readOnly: true });
  const before = JSON.stringify(f.app.store.settings);
  for (const path of ["/api/settings", "/api/providers/soniox/key", "/api/slack/config-token", "/api/subscriptions/resident/check"]) {
    const reply = (await f.invoke(alice, { method: path.includes("check") ? "POST" : "PUT", path, body: { language: "en", key: "fixture-not-a-real-key", role: "owner" } })).data.result;
    assert.equal(reply.isError, true); assert.equal(reply.structuredContent.status, 403, path);
  }
  assert.equal(JSON.stringify(f.app.store.settings), before);
  assert.equal((await f.invoke(reader, { method: "PUT", path: "/api/settings", body: { language: "en" } })).data.result.structuredContent.status, 403);
  assert.deepEqual((await f.rpc(reader, "tools/list")).data.result.tools.find(tool => tool.name === "cora_request").inputSchema.properties.method.enum, ["GET"]);
  assert.equal((await f.invoke(admin, { method: "PUT", path: "/api/settings", body: { language: "en" } })).data.result.structuredContent.status, 200);
  assert.equal(f.app.store.settings.language, "en");
  f.app.store.updateAccessPolicy({ domains: [], emails: ["bob@owner.test"] });
  assert.equal((await f.rpc(alice, "ping")).status, 401);
  f.app.store.updateAccessPolicy({ domains: [], emails: ["alice@owner.test", "bob@owner.test"] });
  assert.equal((await f.rpc(alice, "ping")).status, 200);
  const records = f.app.store.value("panelMcpTokens"); records.find(record => record.id === alice.id).expiresAt = new Date(Date.now() - 1000).toISOString(); f.app.store.setValue("panelMcpTokens", records);
  assert.equal((await f.rpc(alice, "ping")).status, 401);
  assert.equal((await f.rpc(admin, "ping")).status, 200);
});

test("external configuration MCP validates its transport and cannot proxy external, authentication or recursive routes", async (t) => {
  const f = await panelMcpWorld(t), access = await f.issue(f.alice);
  assert.equal((await f.rpc(access, "ping", {}, { headers: { Origin: "https://untrusted.test" } })).status, 403);
  assert.equal((await f.rpc(access, "ping", {}, { headers: { Origin: "null" } })).status, 403);
  assert.equal((await f.rpc(access, "ping", {}, { headers: { "MCP-Protocol-Version": "invalid" } })).status, 400);
  assert.equal((await f.rpc(access, "ping", {}, { headers: { "Content-Type": "text/plain" } })).status, 415);
  assert.equal((await f.rpc(access, "ping", {}, { headers: { Accept: "text/event-stream" } })).status, 406);
  assert.equal((await fetch(f.base + "/mcp", { headers: { Authorization: `Bearer ${access.token}`, Accept: "text/event-stream" } })).status, 405);
  for (const path of ["/api/mcp/tokens", "/api/login", "/api/events", "/api/cloud/access", "/api/agents/../mcp/tokens"]) assert.equal((await f.invoke(access, { path })).data.result.structuredContent.status, 403, path);
  for (const path of ["https://external.test/api/settings", "//external.test/api/settings", "/api/../../outside", "/api/agents\\../settings"]) assert.equal((await f.invoke(access, { path })).data.error.code, -32602, path);
  const notification = await fetch(f.base + "/mcp", { method: "POST", headers: { Authorization: `Bearer ${access.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
  assert.equal(notification.status, 202); assert.equal(await notification.text(), "");
  const guide = (await f.rpc(access, "tools/call", { name: "cora_configurations", arguments: { area: "email" } })).data.result;
  assert.deepEqual(JSON.parse(guide.content[0].text).areas.map(area => area.id), ["email"]);
});

test("external configuration MCP returns a browser handoff for new Google connections without issuing browser cookies", async (t) => {
  const f = await panelMcpWorld(t), access = await f.issue(f.alice), reader = await f.issue(f.alice, { readOnly: true });
  const connector = f.app.googleConnector;
  connector.enabled = false;
  const gated = (await f.invoke(access, { method: "POST", path: "/api/connectors/google" })).data.result;
  assert.equal(gated.structuredContent.status, 409); assert.equal(gated.structuredContent.data.browserAction, undefined);
  connector.enabled = true; connector.broker = "https://fixture-broker.test"; connector.space = "fixture";
  const reply = await f.invoke(access, { method: "POST", path: "/api/connectors/google" });
  const result = reply.data.result;
  assert.equal(result.isError, true); assert.equal(result.structuredContent.status, 409);
  assert.deepEqual(result.structuredContent.data.browserAction, { path: "/#/settings/connettori/google", identity: f.alice.user.id, url: f.base + "/#/settings/connettori/google" });
  assert.equal(reply.headers.get("set-cookie"), null);
  assert.equal(connector.pending.size, 0, "MCP must not leave an unusable browser-bound nonce");
  assert.equal((await f.invoke(reader, { method: "POST", path: "/api/connectors/google" })).data.result.structuredContent.status, 403);
  assert.equal(connector.pending.size, 0);
  const native = await fetch(f.base + "/api/connectors/google", { method: "POST", headers: { ...f.alice.headers, "X-Cora": "1" } });
  assert.equal(native.status, 200); assert.ok(native.headers.get("set-cookie").includes("cora_google="));
  assert.ok((await native.json()).url.startsWith("https://fixture-broker.test/"));
  assert.equal(connector.pending.size, 1, "the browser route retains its own nonce protection");
});

test("external configuration MCP panel keeps personal drafts and one-time masked tokens until saved or revoked", async (t) => {
  const f = await panelMcpWorld(t);
  await f.issue(f.bob, { name: "Bob private client" });
  const panel = panelHarness({ language: "en", hash: "#/settings/mcp", fetch: async (path, options = {}) => {
    const response = await f.request(f.alice, path, { method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
    return { ok: response.status < 400, status: response.status, json: async () => response.data };
  } });
  const pane = panel.run("(() => { const pane = panelMcpPane(); app.append(pane); return pane; })()");
  await pane.readyMcp;
  assert.match(pane.textContent, /The client will act as alice/);
  assert.ok(!pane.textContent.includes("Bob private client"));
  const form = pane.querySelector("form"), name = form.elements.mcpName, days = form.elements.mcpDays;
  name.value = "Personal work client"; days.value = "0";
  form.dispatch("submit");
  await waitFor(() => /Choose a valid MCP lifetime/.test(pane.textContent));
  assert.equal(name.value, "Personal work client", "a refused creation preserves the draft");
  days.value = "30"; form.elements.mcpReadOnly.checked = true; form.dispatch("submit");
  const receipt = pane.querySelector(".mcp-secret"), token = receipt.querySelector("input");
  await waitFor(() => Boolean(token.value) && !name.disabled);
  assert.equal(token.type, "password"); assert.equal(receipt.hidden, false);
  assert.ok(!pane.textContent.includes(token.value), "the token is not a text node");
  const created = f.app.store.value("panelMcpTokens").find(record => record.userId === f.alice.user.id);
  assert.equal(created.readOnly, true);
  name.value = "Next client draft";
  const buttons = () => pane.querySelectorAll("button");
  buttons().find(button => /Reload/.test(button.textContent)).click();
  await waitFor(() => pane.querySelectorAll(".mcp-token-row").length === 1);
  assert.equal(name.value, "Next client draft"); assert.ok(token.value); assert.equal(receipt.hidden, false);
  buttons().find(button => /I saved the token/.test(button.textContent)).click();
  assert.equal(token.value, ""); assert.equal(receipt.hidden, true);
  const row = pane.querySelector(".mcp-token-row"), revoke = row.querySelector("button");
  revoke.click(); assert.match(revoke.textContent, /Confirm revocation/);
  assert.equal((await f.request(f.alice, "/api/mcp/tokens")).data.tokens.length, 1);
  revoke.click(); await waitFor(() => f.app.store.value("panelMcpTokens").length === 1);
  await waitFor(() => /You have no MCP access yet/.test(pane.textContent));
  assert.equal((await f.request(f.bob, "/api/mcp/tokens")).data.tokens.length, 1);
});

test("shared agent owners gain its Brain, memories, conversation and quotas without other private agents, and revocation closes every API", async (t) => {
  const f = await knowledgeWorld({ subscriptionUsageIntervalMs: 0, subscriptionUsageReader: async () => ({ five_hour: { utilization: 20 } }) }); t.after(f.close);
  const record = f.app.store.createSubscription({ provider: "claude", label: "Alice account", connectedBy: { id: f.alice.user.id } });
  f.app.store.updateSubscription(record.id, { status: "ready" });
  const agent = f.app.store.createAgent({ name: "Shared", model: "claude/test", subscriptionId: record.id, brainOwnerId: f.alice.user.id, enabled: false, tools: false });
  const other = f.app.store.createAgent({ name: "Private", model: "ollama/test-model", brainOwnerId: f.alice.user.id, enabled: false, tools: false });
  f.app.store.addMemory(agent.id, "SHARED_OWNER_FACT", "manual", { pinned: true });
  f.app.store.appendArchive(`web-${agent.id}`, { id: "shared-history", kind: "owner", authorId: f.alice.user.id, at: Date.now(), content: "SHARED_CONVERSATION" });
  for (const [item, tokens] of [[agent, 100], [other, 9000]]) {
    const trace = f.app.traces.start({ agentId: item.id, kind: "chat", channelId: `web-${item.id}`, model: item.model }); trace.spent({ in: tokens, out: 0 }); trace.finish({ status: "done" });
  }
  await f.request(f.alice, "/api/brain/pages", { method: "POST", body: { slug: "joint-owner-brain", title: "Shared Brain", body: "SHARED_BRAIN_CONTENT" } });
  const scope = `?ownerId=${encodeURIComponent(f.alice.user.id)}`;
  assert.equal((await f.request(f.bob, "/api/brain" + scope)).status, 403);
  assert.equal((await f.request(f.bob, `/api/agents/${agent.id}/owners`)).status, 403);
  assert.equal((await f.request(f.alice, `/api/agents/${agent.id}/owners`, { method: "PUT", body: { users: [f.alice.user.id, "unknown-person"], contacts: [] } })).status, 400);
  const sharedFile = f.app.orchestrator.saveWebFile({ name: "shared.txt", type: "text/plain", data: Buffer.from("shared file") }, agent);
  const privateFile = f.app.orchestrator.saveWebFile({ name: "private.txt", type: "text/plain", data: Buffer.from("private file") }, other);
  const legacyFile = f.app.orchestrator.saveWebFile({ name: "legacy.txt", type: "text/plain", data: Buffer.from("legacy file") }, agent);
  const legacyMetaPath = join(f.app.orchestrator.filesDir, legacyFile.id + ".json");
  const legacyMeta = JSON.parse(readFileSync(legacyMetaPath, "utf8")); delete legacyMeta.agentId; writeFileSync(legacyMetaPath, JSON.stringify(legacyMeta));
  f.app.store.appendArchive(`web-${agent.id}`, { id: "shared-legacy-file", kind: "agent", agentId: agent.id, at: Date.now(), content: "Legacy attachment", file: legacyFile });
  const oldOwners = (await f.request(f.alice, `/api/agents/${agent.id}/owners`)).data;
  const grant = await f.request(f.alice, `/api/agents/${agent.id}/owners`, { method: "PUT", body: { users: [f.alice.user.id, f.bob.user.id], contacts: [] } });
  assert.equal(grant.status, 200);
  assert.equal((await f.request(f.alice, `/api/agents/${agent.id}/owners`, { method: "PUT", body: { users: [f.alice.user.id], contacts: [], version: oldOwners.version } })).status, 409);
  for (const file of [sharedFile, legacyFile]) assert.equal((await fetch(f.base + "/api/files/" + file.id, { headers: f.bob.headers })).status, 200);
  assert.equal((await fetch(f.base + "/api/files/" + privateFile.id, { headers: f.bob.headers })).status, 404);
  const notifications = [];
  f.app.orchestrator.notifier = { enabled: true, notify: async message => { notifications.push(message.userId); } };
  await f.app.orchestrator.askOwner(f.app.store.agent(agent.id), { question: "Shared question", choices: ["Yes", "No"] }, { channelId: `web-${agent.id}` });
  assert.deepEqual(notifications.sort(), [f.alice.user.id, f.bob.user.id].sort());
  const state = (await f.request(f.bob, "/api/state")).data;
  assert.deepEqual(state.agents.map(item => item.id), [agent.id]);
  assert.equal((await f.request(f.bob, `/api/agents/${other.id}`)).status, 403);
  assert.equal((await f.request(f.bob, `/api/agents/${agent.id}`, { method: "PUT", body: { personality: "Shared personality", subscriptionId: record.id } })).status, 200, "the existing account remains usable without granting credential control");
  assert.match(JSON.stringify((await f.request(f.bob, `/api/agents/${agent.id}/memories`)).data), /SHARED_OWNER_FACT/);
  assert.match(JSON.stringify((await f.request(f.bob, `/api/rooms/web-${agent.id}/messages`)).data), /SHARED_CONVERSATION/);
  const brain = await f.request(f.bob, "/api/brain/pages/joint-owner-brain" + scope);
  assert.equal(brain.status, 200); assert.match(brain.data.body, /SHARED_BRAIN_CONTENT/);
  assert.equal((await f.request(f.bob, "/api/brain/pages/joint-owner-brain" + scope, { method: "PUT", body: { body: "EDITED_BY_COOWNER" } })).status, 200);
  assert.match((await f.app.knowledge.ownerBrain(f.alice.user.id).page("joint-owner-brain")).body, /EDITED_BY_COOWNER/);
  await f.app.subscriptions.usage.refreshAll();
  assert.equal((await f.request(f.bob, `/api/subscriptions/${record.id}/usage`)).status, 200);
  assert.equal((await f.request(f.bob, `/api/subscriptions/${record.id}/check`, { method: "POST" })).status, 404);
  const bobAccount = f.app.store.createSubscription({ provider: "claude", label: "Bob account", connectedBy: { id: f.bob.user.id } });
  f.app.store.updateSubscription(bobAccount.id, { status: "ready" });
  assert.equal((await f.request(f.bob, `/api/agents/${agent.id}`, { method: "PUT", body: { subscriptionId: bobAccount.id } })).status, 200);
  await f.app.subscriptions.usage.refreshAll();
  for (const actor of [f.alice, f.bob]) assert.equal((await f.request(actor, `/api/subscriptions/${bobAccount.id}/usage`)).status, 200, "a co-owner may contribute their own account to the shared agent");
  assert.equal((await f.request(f.alice, `/api/agents/${agent.id}/owners`, { method: "PUT", body: { users: [f.alice.user.id], contacts: [] } })).status, 409, "removing an owner cannot silently retain use of their private account");
  assert.equal((await f.request(f.alice, `/api/agents/${agent.id}`, { method: "PUT", body: { subscriptionId: record.id } })).status, 200);
  const totals = (await f.request(f.bob, "/api/usage")).data.usage;
  assert.deepEqual(totals.map(item => item.agentId), [agent.id]); assert.equal(totals[0].tokensIn, 100);
  assert.equal((await f.request(f.bob, `/api/agents/${agent.id}/owners`, { method: "PUT", body: { users: [f.bob.user.id], contacts: [] } })).status, 400, "the original Brain owner cannot be removed");
  await f.request(f.alice, `/api/agents/${agent.id}/owners`, { method: "PUT", body: { users: [f.alice.user.id], contacts: [] } });
  for (const path of [`/api/agents/${agent.id}`, `/api/agents/${agent.id}/memories`, `/api/rooms/web-${agent.id}/messages`, "/api/brain" + scope]) assert.equal((await f.request(f.bob, path)).status, 403);
  assert.equal((await f.request(f.bob, `/api/subscriptions/${record.id}/usage`)).status, 404);
  assert.deepEqual((await f.request(f.bob, "/api/usage")).data.usage, []);
  for (const file of [sharedFile, legacyFile]) assert.equal((await fetch(f.base + "/api/files/" + file.id, { headers: f.bob.headers })).status, 404);
  notifications.length = 0; f.app.orchestrator.requestsByAgent.set(agent.id, [Date.now() - 60001]);
  await f.app.orchestrator.askOwner(f.app.store.agent(agent.id), { question: "Private again", choices: ["Yes", "No"] }, { channelId: `web-${agent.id}` });
  assert.deepEqual(notifications, [f.alice.user.id]);
  f.app.store.updateAgent(agent.id, { brainSource: "external", coOwnerIds: [f.bob.user.id] });
  assert.equal((await f.request(f.bob, `/api/agents/${agent.id}`)).status, 200);
  assert.equal((await f.request(f.bob, "/api/brain" + scope)).status, 403, "sharing an external Brain cannot open its owner's unrelated internal Brain");
});

test("shared owner controls preserve drafts and the selected shared account, and Brain links keep their owner scope", async (t) => {
  const f = await knowledgeWorld({ subscriptionUsageIntervalMs: 0 }); t.after(f.close);
  const account = f.app.store.createSubscription({ provider: "claude", label: "Alice Claude", connectedBy: { id: f.alice.user.id } });
  f.app.store.updateSubscription(account.id, { status: "ready", email: "alice@owner.test" });
  const agent = f.app.store.createAgent({ name: "Shared UI", model: "claude/test", subscriptionId: account.id, brainOwnerId: f.alice.user.id, enabled: false, tools: false });
  await f.request(f.alice, "/api/brain/pages", { method: "POST", body: { slug: "joint-ui", title: "Joint UI", body: "UI_SHARED_BRAIN" } });
  const fetchAs = actor => async (path, options = {}) => {
    const response = await f.request(actor, path, { method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
    return { ok: response.status < 400, status: response.status, json: async () => response.data };
  };
  const panel = panelHarness({ fetch: fetchAs(f.alice), hash: `#/agent/${agent.id}/settings` });
  panel.run(`S.data = ${JSON.stringify((await f.request(f.alice, "/api/state")).data)}`);
  const owners = panel.run(`(() => {const node = agentOwnerPanel(S.data.agents[0]); app.append(node); return node;})()`);
  await owners.readyOwners;
  const bob = owners.querySelectorAll("input").find(input => input.value === f.bob.user.id);
  assert.ok(bob); bob.checked = true; bob.dispatch("change");
  const save = owners.querySelectorAll("button").find(button => /Salva proprietari/.test(button.textContent)); save.click();
  await waitFor(() => f.app.store.agent(agent.id).coOwnerIds.includes(f.bob.user.id));
  await waitFor(() => /Proprietari aggiornati/.test(owners.textContent));
  bob.checked = false; bob.dispatch("change"); save.click();
  await waitFor(() => !f.app.store.agent(agent.id).coOwnerIds.includes(f.bob.user.id));
  await waitFor(() => /Proprietari aggiornati/.test(owners.textContent));
  bob.checked = true; bob.dispatch("change"); save.click();
  await waitFor(() => f.app.store.agent(agent.id).coOwnerIds.includes(f.bob.user.id));
  await waitFor(() => /Proprietari aggiornati/.test(owners.textContent));
  await owners.refreshOwners();
  assert.equal(owners.querySelectorAll("input").find(input => input.value === f.bob.user.id), bob, "a background ownership event preserves the saved fields");
  assert.match(owners.textContent, /Proprietari aggiornati/);
  bob.checked = false; bob.dispatch("change"); await owners.refreshOwners();
  assert.equal(bob.checked, false, "background refresh preserves unsaved ownership choices");
  owners.querySelectorAll("button").find(button => /Ricarica/.test(button.textContent)).click();
  await waitFor(() => owners.querySelectorAll("input").find(input => input.value === f.bob.user.id)?.checked === true);
  const shared = panelHarness({ fetch: fetchAs(f.bob), hash: `#/brain/p/joint-ui?ownerId=${f.alice.user.id}` });
  shared.run(`S.data = ${JSON.stringify((await f.request(f.bob, "/api/state")).data)}`);
  const picker = shared.run(`(() => {const p = subscriptionPicker(${JSON.stringify(account.id)}); p.setProvider("claude"); return p;})()`);
  assert.equal(picker.value(), account.id); assert.equal(picker.validate(), true);
  assert.ok(!picker.node.querySelectorAll("button").some(button => button.getAttribute("title") === "Verifica collegamento"), "shared use never grants native account controls");
  await shared.run('renderBrainPage("joint-ui")');
  assert.match(shared.app.textContent, /UI_SHARED_BRAIN/);
  assert.ok(shared.app.querySelectorAll("a").filter(link => link.getAttribute("href")?.startsWith("#/brain")).every(link => link.getAttribute("href").includes("ownerId=")));
  f.app.store.updateAgent(agent.id, { coOwnerIds: [] });
  const ownBrain = panelHarness({ fetch: fetchAs(f.bob), hash: "#/brain" });
  ownBrain.run(`S.data = ${JSON.stringify((await f.request(f.bob, "/api/state")).data)}; renderBrain()`);
  await waitFor(() => /Ancora nessuna pagina/.test(ownBrain.app.textContent));
  assert.doesNotMatch(ownBrain.app.textContent, /\bnull\b|undefined/, "the one-scope recovery view must not render a missing selector as text");
});

test("multiple chat owners are authoritative only for their agent and survive an unrelated settings save", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  const agent = f.app.store.createAgent({ name: "Two chat owners", model: "ollama/test-model", brainOwnerId: f.alice.user.id, tools: false, ownerIds: [`discord:${OWNER}`, `discord:${STRANGER}`] });
  const state = f.app.orchestrator.state(CHANNEL);
  for (const id of [OWNER, STRANGER]) {
    assert.equal(f.app.orchestrator.authorized({ kind: "human", authorId: id }, agent, state), true);
    assert.equal(f.app.knowledge.acceptsMessage(agent, { kind: "human", authorId: id }, CHANNEL), true);
    assert.equal(f.app.knowledge.messageOwner({ kind: "human", authorId: id, channelId: CHANNEL }), f.alice.user.id);
  }
  assert.equal(f.app.orchestrator.authorized({ kind: "human", authorId: "123" }, agent, state), false);
  f.app.store.updateAgent(agent.id, { personality: "Updated" });
  assert.deepEqual(f.app.store.agentOwnerChats(f.app.store.agent(agent.id)), [`discord:${OWNER}`, `discord:${STRANGER}`]);
  assert.match(f.app.brain.systemPrompt(f.app.store.agent(agent.id), { place: "", computer: false }), /queste persone/);
  f.app.store.updateAgent(agent.id, { ownerIds: [`discord:${OWNER}`] });
  assert.equal(f.app.orchestrator.authorized({ kind: "human", authorId: STRANGER }, f.app.store.agent(agent.id), state), false);
});

test("owner memory isolates facts, clients, projects, archives and reviews until a page is explicitly shared", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  const create = async (actor, name) => {
    const result = await f.request(actor, "/api/agents", { method: "POST", body: { name, tools: false, core: name + " private core" } });
    assert.equal(result.status, 201); return f.app.store.agent(result.data.id);
  };
  const alice = await create(f.alice, "Alice agent"), sister = await create(f.alice, "Alice colleague"), bob = await create(f.bob, "Bob agent");
  assert.equal(alice.brainOwnerId, f.alice.user.id);
  f.app.store.addMemory(alice.id, "ORBIT_ALICE_PRIVATE", "manual", { pinned: true });
  f.app.store.addMemory(bob.id, "ORBIT_BOB_PRIVATE", "manual", { pinned: true });
  f.app.store.addMemory(SHARED, "ORBIT_LEGACY_SHARED_PRIVATE", "manual", { pinned: true });
  assert.match(f.app.brain.memoryContext(sister, "orbit"), /ORBIT_ALICE_PRIVATE/);
  assert.doesNotMatch(f.app.brain.memoryContext(sister, "orbit"), /ORBIT_BOB|ORBIT_LEGACY/);
  for (const [actor, title, body] of [[f.alice, "Orbit Alice", "ORBIT_ALICE_PAGE_PRIVATE"], [f.bob, "Orbit Bob", "ORBIT_BOB_PAGE_PRIVATE"]]) {
    const result = await f.request(actor, "/api/brain/pages", { method: "POST", body: { slug: "orbit", kind: "client", title, body } });
    assert.equal(result.status, 201);
  }
  const ownAlice = f.app.knowledge.ownerBrain(f.alice.user.id), ownBob = f.app.knowledge.ownerBrain(f.bob.user.id);
  assert.notEqual(ownAlice.schema, ownBob.schema);
  assert.match((await ownAlice.page("orbit")).body, /ALICE/);
  assert.match((await ownBob.page("orbit")).body, /BOB/);
  assert.equal((await f.request(f.bob, "/api/agents/" + alice.id + "/memories")).status, 403);
  assert.equal((await f.request(f.bob, "/api/rooms/web-" + alice.id + "/messages")).status, 403);
  assert.ok((await f.request(f.bob, "/api/state")).data.agents.every((agent) => !agent.core));
  f.app.store.appendArchive("web-" + alice.id, { id: "owner-alice-message", kind: "owner", authorId: f.alice.user.id, authorName: "alice", at: Date.now(), content: "ORBIT_ALICE_CHAT_PRIVATE" });
  f.app.store.appendArchive("web-" + bob.id, { id: "owner-bob-message", kind: "owner", authorId: f.bob.user.id, authorName: "bob", at: Date.now(), content: "ORBIT_BOB_CHAT_PRIVATE" });
  await f.app.librarian.run();
  assert.match(JSON.stringify(await ownAlice.searchArchive("ORBIT")), /ALICE_CHAT/);
  assert.doesNotMatch(JSON.stringify(await ownAlice.searchArchive("ORBIT")), /BOB_CHAT/);
  const ctx = { agent: bob, store: f.app.store, knowledge: f.app.knowledge, companyBrain: f.app.companyBrain, memory: f.app.brain.memory, channelIds: ["web-" + bob.id, "web-" + alice.id], channelLabel: (id) => id, formatWhen: String };
  assert.doesNotMatch((await executeTool({ name: "recall", args: { query: "ORBIT" } }, ctx)).text, /ALICE|LEGACY_SHARED/);
  assert.doesNotMatch((await executeTool({ name: "brain_search", args: { query: "ORBIT" } }, ctx)).text, /Alice/);
  const aliceRevision = await ownAlice.write({ slug: "alice-pending", kind: "project", title: "Alice pending", body: "ORBIT_ALICE_REVIEW_PRIVATE", author: "librarian" });
  await ownBob.write({ slug: "bob-pending", title: "Bob pending", body: "ORBIT_BOB_REVIEW_PRIVATE", author: "librarian" });
  const queue = await f.request(f.bob, "/api/brain/review");
  assert.doesNotMatch(JSON.stringify(queue.data), /ALICE/);
  await f.request(f.bob, "/api/brain/review", { method: "POST", body: { ids: [aliceRevision.revisionId], decision: "approve" } });
  assert.equal((await ownAlice.page("alice-pending")).pending, 1);
  const shared = await f.request(f.alice, "/api/brain/pages/orbit/sharing", { method: "PUT", body: { visibility: "people", users: [f.bob.user.id] } });
  assert.equal(shared.status, 200);
  const pages = (await f.request(f.bob, "/api/brain/pages")).data.pages;
  const alias = pages.find((page) => page.title === "Orbit Alice")?.slug;
  assert.ok(alias?.startsWith("shared-"));
  const visible = (await f.request(f.bob, "/api/brain/pages/" + alias)).data;
  assert.match(visible.body, /ORBIT_ALICE_PAGE_PRIVATE/);
  assert.equal(visible.readonly, true); assert.deepEqual(visible.revisions, []);
  assert.equal((await f.request(f.bob, "/api/brain/pages/" + alias, { method: "PUT", body: { body: "forged write" } })).status, 403);
  assert.equal((await f.request(f.bob, "/api/brain/pages/" + alias + "/sharing", { method: "PUT", body: { visibility: "team" } })).status, 403);
  await f.request(f.alice, "/api/brain/pages/orbit/sharing", { method: "PUT", body: { visibility: "private" } });
  assert.equal((await f.request(f.bob, "/api/brain/pages/" + alias)).status, 404);
  assert.doesNotMatch(JSON.stringify((await f.request(f.bob, "/api/brain/pages?q=ORBIT")).data), /Alice/);
  const prompts = [];
  f.state.answer = (body) => { prompts.push(body); return { content: "La procedura è disponibile.", thinking: "OWNER_PRIVATE_THINKING" }; };
  await f.app.brain.chatTurn({ agent: bob, history: [{ kind: "owner", authorId: f.bob.user.id, authorName: "bob", at: Date.now(), content: "ORBIT?" }], channel: { id: "web-" + bob.id, name: "QA" }, forced: true, computer: false });
  assert.match(JSON.stringify(prompts), /ORBIT_BOB/);
  assert.doesNotMatch(JSON.stringify(prompts), /ORBIT_ALICE|ORBIT_LEGACY/);
  const phones = [await fakePhone(), await fakePhone()];
  t.after(async () => { await Promise.all(phones.map((phone) => phone.close())); });
  await f.request(f.alice, "/api/push/subscribe", { method: "POST", body: { subscription: phones[0].subscription } });
  await f.request(f.bob, "/api/push/subscribe", { method: "POST", body: { subscription: phones[1].subscription } });
  await f.app.librarian.forOwner(f.alice.user.id).digest();
  assert.equal(phones[0].received.length, 1);
  assert.equal(phones[1].received.length, 0, "a review never reaches another owner's device");
  assert.equal((await f.request(f.bob, "/api/push/test", { method: "POST", body: {} })).status, 200);
  assert.equal(phones[0].received.length, 1);
  assert.equal(phones[1].received.length, 1);
  assert.equal((await f.request(f.bob, "/api/push/unsubscribe", { method: "POST", body: { endpoint: phones[0].subscription.endpoint } })).status, 403);
  await executeTool({ name: "remember", args: { fact: "ORBIT_BOB_PERSISTENT" } }, ctx);
  assert.ok(f.app.store.memories(f.app.knowledge.memoryKey(bob)).some((item) => item.text === "ORBIT_BOB_PERSISTENT"));
  await f.request(f.bob, "/api/agents/" + bob.id, { method: "DELETE" });
  const replacement = await create(f.bob, "Bob replacement");
  assert.match(f.app.brain.memoryContext(replacement, "orbit"), /ORBIT_BOB_PERSISTENT/);
});

test("router image messages use the actual JPEG and GIF MIME types for incoming and tool images", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  let sent;
  const endpoint = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    sent = JSON.parse(Buffer.concat(chunks).toString());
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "Image received." } }] }));
  });
  await new Promise((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => endpoint.close(resolve)));
  f.app.llm.routers.orcarouter = { key: "fixture-image-router", url: "http://127.0.0.1:" + endpoint.address().port };
  f.app.llm.capabilities = async () => ({ vision: true, tools: true });
  const jpeg = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDjKKKK+qPHP//Z";
  const gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  await f.app.llm.routerChat("orcarouter", "vision-fixture", "orcarouter/vision-fixture", { tools: [], messages: [
    { role: "user", content: "Describe the photograph", images: [jpeg] },
    { role: "tool", name: "read_attachment", toolCallId: "image-call", content: "Image", image: gif },
  ] });
  assert.equal(sent.messages[0].content[1].image_url.url, "data:image/jpeg;base64," + jpeg);
  assert.equal(sent.messages[2].content[1].image_url.url, "data:image/gif;base64," + gif);
});

test("Gemini quota errors distinguish Argon, shared limits and unknown capacity in delivered chat replies", async (t) => {
  const network = await fakeDiscord(), native = fakeCli();
  const f = await knowledgeWorld({ discordToken: "fixture-discord-quota", discordApi: network.url, geminiBin: native.gemini, timezone: "Europe/Rome" });
  t.after(async () => { await f.close(); await network.close(); });
  f.app.store.updateSettings({ transport: "discord", transports: ["discord"], guildIds: [GUILD], ownerIds: [OWNER] });
  const account = f.app.store.createSubscription({ provider: "gemini", label: "Quota", connectedBy: { id: f.alice.user.id, name: "Alice" } });
  f.app.store.updateSubscription(account.id, { status: "ready" });
  const agent = f.app.store.createAgent({ name: "QuotaAgent", model: "gemini/gemini-4-argon-high", subscriptionId: account.id, tools: false, brainOwnerId: f.alice.user.id, ownerId: "discord:" + OWNER, channelIds: [CHANNEL], chattiness: 0 });
  await waitFor(() => f.app.discord.state === "ready");
  const bucket = (window, remaining_fraction) => ({ window, remaining_fraction, reset_time: "2026-11-16T16:06:40Z" });
  const group = (name, buckets) => ({ name, buckets });
  const usage = groups => ({ status: "SUCCESS", command: { data: { groups } } });
  const separate = usage([group("Gemini Models", [bucket("weekly", 0.974), bucket("5h", 0.935)]), group("Gemini 4 Argon", [bucket("weekly", 0)])]);
  let turn = 0;
  const ask = async (options, language = "it") => {
    f.app.store.updateSettings({ language });
    native.set({ reply: "", error: "Individual quota reached. Resets in 166h32m5s.", ...options });
    const before = network.state.webhookPosts.length;
    const beforeRuns = native.calls().filter(call => call.flavor === "gemini").length;
    network.say({ content: `@QuotaAgent, continua il controllo ${++turn}.` });
    const post = await waitFor(() => network.state.webhookPosts.slice(before).find(post => post.username === agent.name), { what: "a readable quota reply" });
    await waitFor(() => f.app.orchestrator.quiet());
    assert.equal(f.app.store.subscription(account.id).status, "ready", "quota exhaustion does not disconnect the account");
    assert.ok(!f.app.subscriptions.running.has(account.id));
    assert.equal(native.calls().filter(call => call.flavor === "gemini").length - beforeRuns, 1, "quota errors never retry the model, including English messages about capacity");
    assert.doesNotMatch(post.content, /upgrade|Individual quota reached|non riesco a rispondere/i);
    return post.content;
  };
  await t.test("a Pro Argon limit preserves the full reset and the other Gemini quotas", async () => {
    const text = await ask({ geminiUsage: separate });
    assert.match(text, /Gemini 4 Argon.*limite settimanale/);
    assert.match(text, /16 nov 2026.*17:06.*Europe\/Rome/);
    assert.match(text, /altri modelli Gemini.*97% settimanale.*94% su cinque ore/);
    assert.ok(text.length > 180, "the whole explanation survives the ordinary error-message cap");
    const lookup = native.calls().find(call => call.flavor === "gemini-usage");
    const run = native.calls().find(call => call.flavor === "gemini");
    assert.equal(lookup.home, run.env.HOME); assert.equal(lookup.scope, run.scope);
    assert.equal(native.calls().filter(call => call.flavor === "gemini").length, 1, "quota exhaustion never retries the model");
  });
  await t.test("an interrupted task reports the same distinction while resuming", async () => {
    const trace = f.app.store.trace(f.app.store.traces(agent.id).find(trace => trace.status === "error").id);
    const before = network.state.webhookPosts.length;
    await assert.rejects(f.app.orchestrator.resumeTask(agent, trace), /Gemini 4 Argon.*limite settimanale/);
    const text = network.state.webhookPosts.slice(before).find(post => /altri modelli Gemini/.test(post.content))?.content;
    assert.match(text, /97% settimanale.*94% su cinque ore/);
    assert.match(text, /Ripristino:/);
  });
  await t.test("shared Gemini quota is identified without inventing Flash capacity", async () => {
    const text = await ask({ geminiUsage: usage([group("Gemini Models", [bucket("weekly", 0), bucket("5h", 0)])]) }, "en");
    assert.match(text, /Gemini 4 Argon.*weekly usage limit/);
    assert.match(text, /shared Gemini model group/);
    assert.doesNotMatch(text, /Other Gemini models|97%|94%/);
  });
  await t.test("Claude and GPT limits use their own Antigravity pool", async () => {
    for (const [model, label] of [["claude-sonnet-5-5-low", /Claude Sonnet 5.5/], ["gpt-oss-120b-medium", /GPT-OSS 120B/]]) {
      f.app.store.updateAgent(agent.id, { model: `gemini/${model}` });
      const text = await ask({ geminiUsage: usage([group("Gemini Models", [bucket("weekly", .97)]), group("Claude and GPT models", [bucket("5h", 0)])]) });
      assert.match(text, label); assert.match(text, /limite di cinque ore/);
      assert.match(text, /quota condivisa di Claude e GPT in Antigravity/); assert.match(text, /97% settimanale/);
    }
    f.app.store.updateAgent(agent.id, { model: "gemini/gemini-4-argon-high" });
  });
  await t.test("a failed quota lookup reports unknown capacity", async () => {
    const text = await ask({ geminiUsageFailed: true });
    assert.match(text, /Gemini 4 Argon.*limite di utilizzo/);
    assert.match(text, /Non ho potuto verificare la quota residua/);
    assert.doesNotMatch(text, /97%|94%|Ripristino:/);
  });
  await t.test("inconsistent provider counters are stated instead of treating them as exhausted", async () => {
    for (const language of ["it", "en"]) {
      const text = await ask({ geminiUsage: usage([null, group("Gemini Models", [null, bucket("weekly", 0.97), bucket("5h", 0.94)]), group("Gemini 4 Argon", [bucket("weekly", 0.5)])]) }, language);
      assert.match(text, language === "en" ? /quota counters still show capacity/ : /contatori mostrano ancora disponibilità/);
      assert.match(text, /97%.*94%/);
      assert.doesNotMatch(text, /limite settimanale|weekly usage limit|Ripristino:|Resets:/);
    }
  });
});

test("Discord images reach Gemini through Cora attachment tools without a false vision denial", async (t) => {
  const network = await fakeDiscord(), native = fakeCli();
  const f = await knowledgeWorld({ discordToken: "fixture-discord-vision", discordApi: network.url, geminiBin: native.gemini });
  t.after(async () => { await f.close(); await network.close(); });
  f.app.store.updateSettings({ transport: "discord", transports: ["discord"], guildIds: [GUILD], ownerIds: [OWNER] });
  f.app.subscriptions.models = async (provider) => provider === "gemini" ? [{ name: "gemini-4-argon-high", label: "Gemini 4 Argon (High)" }] : [];
  const account = f.app.store.createSubscription({ provider: "gemini", label: "Vision", connectedBy: { id: f.alice.user.id, name: "Alice" } });
  f.app.store.updateSubscription(account.id, { status: "ready" });
  const agent = f.app.store.createAgent({ name: "GeminiPixel", model: "gemini/gemini-4-argon-high", subscriptionId: account.id, tools: false, brainOwnerId: f.alice.user.id, ownerId: "discord:" + OWNER, channelIds: [CHANNEL], chattiness: 0 });
  const caps = await f.app.llm.capabilities(agent.model);
  assert.equal(caps.vision, true, "the discovered Gemini catalog must expose vision");
  const image = encodePng(2, 2, Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]));
  const file = network.attachment("vision.png", image, "image/png");
  native.set({ tool: "read_attachment", args: { attachment_id: "img-1" }, reply: "GEMINI_DISCORD_IMAGE_OK" });
  await waitFor(() => f.app.discord.state === "ready");
  network.say({ content: "@GeminiPixel, descrivi questa immagine.", attachments: [file] });
  const call = await waitFor(() => native.calls().find(entry => entry.flavor === "gemini" && entry.content?.some(part => part.type === "image")), { what: "Gemini receiving Discord pixels over MCP" });
  assert.ok(call.tools.includes("read_attachment"));
  assert.ok(!call.tools.includes("shell"), "vision does not grant desktop or host tools");
  assert.match(call.stdin, /img-1:/);
  assert.doesNotMatch(call.stdin, /modello selezionato non supporta la visione/);
  assert.equal(call.content.find(part => part.type === "image").mimeType, "image/png");
  assert.equal(call.content.find(part => part.type === "image").data, image.toString("base64"));
  await waitFor(() => network.state.webhookPosts.some(post => post.username === agent.name && post.content.includes("GEMINI_DISCORD_IMAGE_OK")));
});

test("Discord thread creation and empty system entries never wake an agent during history recovery", async (t) => {
  const network = await fakeDiscord();
  const f = await knowledgeWorld({ discordToken: "fixture-discord-thread-events", discordApi: network.url });
  t.after(async () => { await f.close(); await network.close(); });
  f.app.store.updateSettings({ transport: "discord", transports: ["discord"], guildIds: [GUILD], ownerIds: [OWNER] });
  const agent = f.app.store.createAgent({ name: "ThreadGuard", model: "ollama/test-model", tools: false, brainOwnerId: f.alice.user.id, ownerId: "discord:" + OWNER, channelIds: [CHANNEL], chattiness: 0 });
  const requests = [];
  f.state.answer = body => { requests.push(body); return { content: JSON.stringify(body).includes("FIRST_THREAD_CONTENT") ? "FIRST_THREAD_OK" : "PARENT_READY" }; };
  await waitFor(() => f.app.discord.state === "ready");
  network.say({ content: "@ThreadGuard, rispondi per confermare che ascolti." });
  await waitFor(() => network.state.webhookPosts.some(post => post.username === agent.name && post.content === "PARENT_READY"));
  await waitFor(() => f.app.orchestrator.quiet());
  const count = requests.length;
  const thread = { id: "800000000000000051", type: 11, parent_id: CHANNEL, guild_id: GUILD, name: "Thread lifecycle QA", thread_metadata: { archived: false } };
  network.state.threads.set(thread.id, thread);
  network.dispatch("THREAD_CREATE", thread);
  const created = network.say({ type: 18, content: "" });
  created.thread = thread;
  created.message_reference = { type: 0, channel_id: thread.id };
  const starter = network.say({ type: 21, content: "", channel: thread.id });
  const empty = network.say({ content: "   " });
  await waitFor(() => f.app.channels.list().some(channel => channel.id === thread.id));
  await f.app.orchestrator.catchUp();
  assert.equal(requests.length, count, "system events must not start a model request");
  for (const event of [created, starter, empty]) {
    assert.equal(f.app.store.hasMessage(event.id), false, "system and empty events never enter the conversation archive");
    assert.ok(!f.app.orchestrator.state(event.channel_id).history.some(item => item.id === event.id));
    assert.equal(f.app.orchestrator.state(event.channel_id).nextRoundAt || 0, 0, "catch-up must not schedule an empty-message reply");
  }
  network.say({ content: "@ThreadGuard, FIRST_THREAD_CONTENT", channel: thread.id });
  await waitFor(() => network.state.webhookPosts.some(post => post.channelId === thread.id && post.content === "FIRST_THREAD_OK"));
  assert.doesNotMatch(JSON.stringify(requests.at(-1)), /messaggio vuoto/);
  await waitFor(() => f.app.orchestrator.quiet());
  const answered = network.state.webhookPosts.length;
  await f.app.orchestrator.catchUp();
  assert.equal(f.app.orchestrator.state(thread.id).nextRoundAt || 0, 0);
  assert.equal(network.state.webhookPosts.length, answered, "the real first message is answered exactly once");
});

test("Telegram photos and image documents reach vision CLIs as scoped MCP image content without desktop access", async (t) => {
  const telegram = await fakeTelegram(), native = fakeCli();
  const token = "fixture-image-main";
  telegram.addBot(token, { id: 89002, username: "fixture_image_bot", first_name: "Cora" });
  const f = await knowledgeWorld({ telegramToken: token, telegramApi: telegram.url, claudeBin: native.claude, codexBin: native.codex });
  t.after(async () => { await f.close(); await telegram.close(); });
  f.app.store.updateSettings({ transport: "telegram", transports: ["telegram"], telegramChatIds: [TG_GROUP, TG_OTHER_GROUP], telegramOwnerIds: [TG_OWNER] });
  const pictures = [encodePng(1, 1, Buffer.from([255, 0, 0, 255])), encodePng(1, 1, Buffer.from([0, 255, 0, 255]))];
  for (const [index, provider] of ["claude", "codex"].entries()) {
    const account = f.app.store.createSubscription({ provider, label: provider, connectedBy: { id: f.alice.user.id, name: "Alice" } });
    f.app.store.updateSubscription(account.id, { status: "ready" });
    const chat = index ? TG_OTHER_GROUP : TG_GROUP;
    const name = index ? "PixelCodex" : "PixelClaude";
    const result = await f.request(f.alice, "/api/agents", { method: "POST", body: { name, tools: false, model: provider + "/" + (index ? "gpt-6-sol" : "claude-sonnet-5-5"), subscriptionId: account.id, channelIds: ["tg:" + chat] } });
    assert.equal(result.status, 201);
    f.app.store.updateAgent(result.data.id, { ownerId: "telegram:" + TG_OWNER });
    const fileId = telegram.file("image-" + provider, pictures[index]);
    native.set({ tool: "read_attachment", args: { attachment_id: "img-1" }, reply: "PIXEL_REPLY_" + provider });
    await f.app.orchestrator.onTelegramMessage({ message_id: 700 + index, date: Math.floor(Date.now() / 1000), from: { id: Number(TG_OWNER), first_name: "Alice" }, chat: { id: Number(chat), type: "group", title: "Images QA" }, caption: "@" + name + ", guarda questa immagine.",
      ...(index ? { document: { file_id: fileId, file_name: "screen.jpg", mime_type: "image/jpeg", file_size: pictures[index].length } } : { photo: [{ file_id: fileId, width: 1, height: 1, file_size: pictures[index].length }] }) });
    const conversation = f.app.orchestrator.state("tg:" + chat);
    assert.ok(f.app.orchestrator.agentsFor(conversation.id).some((entry) => entry.id === result.data.id), "the image's recipient listens to this group");
    assert.equal(conversation.history.at(-1)?.images?.[0], pictures[index].toString("base64"), "the incoming Telegram pixels reach conversation history");
    assert.ok(conversation.history.at(-1)?.addressed?.includes(result.data.id), "the human's message calls the image reader");
    const call = await waitFor(() => native.calls().find((entry) => entry.flavor === provider && entry.content), { timeout: 15000, what: provider + " image tool result" });
    assert.ok(call.tools.includes("read_attachment")); assert.ok(!call.tools.includes("shell"));
    assert.match(call.stdin, /img-1:/);
    assert.equal(call.content.find((part) => part.type === "image").mimeType, "image/png", "the file bytes determine MIME even when the document metadata says JPEG");
    assert.equal(call.content.find((part) => part.type === "image").data, pictures[index].toString("base64"));
    assert.ok(!call.stdin.includes(pictures[index].toString("base64")), "pixels travel as image content rather than prompt text");
    await waitFor(() => telegram.state.sent.some((entry) => entry.method === "sendMessage" && entry.text.includes("PIXEL_REPLY_" + provider)), { timeout: 15000 });
  }
});

test("conversation image references survive text followups and incoming steering but never cross turns", async (t) => {
  const native = fakeCli();
  const f = await knowledgeWorld({ claudeBin: native.claude }); t.after(f.close);
  const account = f.app.store.createSubscription({ provider: "claude", label: "Images", connectedBy: { id: f.alice.user.id, name: "Alice" } });
  f.app.store.updateSubscription(account.id, { status: "ready" });
  const created = (await f.request(f.alice, "/api/agents", { method: "POST", body: { name: "PixelReader", tools: false, model: "claude/claude-sonnet-5-5", subscriptionId: account.id } })).data;
  const agent = f.app.store.agent(created.id), image = encodePng(1, 1, Buffer.from([70, 80, 90, 255])).toString("base64");
  const earlier = { id: "earlier-photo", kind: "owner", authorId: f.alice.user.id, authorName: "Alice", content: "Una foto", images: [image], at: Date.now() };
  const followup = { ...earlier, id: "text-followup", content: "Descrivi la foto precedente", images: undefined };
  native.set({ tool: "read_attachment", args: { attachment_id: "img-1" }, reply: "Lettura completata." });
  const turn = (history, channel, extra = {}) => f.app.brain.chatTurn({ agent, history, channel: { id: channel, name: "Images QA" }, forced: true, computer: false, ...extra });
  await turn([earlier, followup], "web-" + agent.id);
  assert.equal(native.calls().at(-1).content.find((part) => part.type === "image").data, image);
  await turn([followup], "web-unrelated-image-turn");
  assert.ok(!native.calls().at(-1).content.some((part) => part.type === "image"));
  assert.match(native.calls().at(-1).output, /not available in the current conversation turn/);
  let delivered = false;
  await turn([followup], "web-" + agent.id, { inbox: () => delivered ? [] : (delivered = true, [{ ...earlier, id: "incoming-photo", addressed: [agent.id] }]) });
  assert.match(native.calls().at(-1).stdin, /img-1: Alice/);
  assert.equal(native.calls().at(-1).content.find((part) => part.type === "image").data, image);
  delivered = false;
  await turn([followup], "web-" + agent.id, { inbox: () => delivered ? [] : (delivered = true, [{ ...earlier, id: "colleague-photo", addressed: ["ag_999999999999"] }]) });
  assert.ok(!native.calls().at(-1).content.some((part) => part.type === "image"), "an attachment explicitly sent to a colleague is not imported into this worker");
  let prompt;
  f.state.answer = (body) => { prompt = body; return { content: "Questo modello non supporta le immagini." }; };
  await f.app.brain.chatTurn({ agent: { ...agent, model: "ollama/test-model" }, history: [earlier], channel: { id: "web-" + agent.id, name: "Images QA" }, forced: true, computer: false });
  assert.ok(!prompt.tools?.some((tool) => tool.function?.name === "read_attachment"));
  assert.match(JSON.stringify(prompt.messages), /modello selezionato non supporta la visione/);
});

test("Telegram reply photos are downloaded and unavailable or oversized image files are described explicitly", async (t) => {
  const telegram = await fakeTelegram(); telegram.addBot("fixture-image-files", { id: 89003, username: "fixture_files_bot", first_name: "Cora" });
  const f = await knowledgeWorld({ telegramToken: "fixture-image-files", telegramApi: telegram.url });
  t.after(async () => { await f.close(); await telegram.close(); });
  f.app.store.updateSettings({ transport: "telegram", transports: ["telegram"], telegramChatIds: [TG_GROUP], telegramOwnerIds: [TG_OWNER] });
  const received = []; f.app.orchestrator.ingest = async (_state, item) => { received.push(item); };
  const picture = encodePng(1, 1, Buffer.from([0, 0, 255, 255])), fileId = telegram.file("quoted-image", picture);
  const message = { message_id: 800, chat: { id: Number(TG_GROUP), type: "group", title: "Images QA" }, from: { id: Number(TG_OWNER), first_name: "Alice" }, text: "Guarda l'immagine a cui rispondo" };
  await f.app.orchestrator.onTelegramMessage({ ...message, reply_to_message: { message_id: 10, from: message.from, photo: [{ file_id: fileId, file_size: picture.length }] } });
  assert.deepEqual(received[0].images, [picture.toString("base64")]);
  await f.app.orchestrator.onTelegramMessage({ ...message, message_id: 801, document: { file_id: "oversized", file_name: "large.png", mime_type: "image/png", file_size: 6 * 1024 * 1024 } });
  assert.equal(received[1].images, undefined); assert.match(received[1].content, /immagine non disponibile/);
  await f.app.orchestrator.onTelegramMessage({ ...message, message_id: 802, photo: [{ file_id: "missing-image", file_size: 9 }] });
  assert.equal(received[2].images, undefined); assert.match(received[2].content, /Non inventarne il contenuto/);
});

test("agent permissions are managed by each owner, scoped to its contacts and preserve other agents and wildcard grants", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  f.app.store.updateSettings({ transport: "telegram", transports: ["telegram"], telegramChatIds: [TG_GROUP, TG_OTHER_GROUP] });
  const create = async (actor, name) => (await f.request(actor, "/api/agents", { method: "POST", body: { name, tools: false, channelIds: ["tg:" + TG_GROUP] } })).data;
  const nico = await create(f.alice, "Nico"), vera = await create(f.bob, "Vera");
  const contact = "telegram:" + TG_STRANGER;
  const message = { id: "permission-contact", kind: "human", authorId: TG_STRANGER, authorName: "Virginia Test", content: "Nico, ci sei?", at: Date.now() };
  f.app.store.appendArchive("tg:" + TG_GROUP, message);
  f.app.store.appendArchive("tg:" + TG_OTHER_GROUP, { ...message, id: "private-contact", authorId: "987654321", authorName: "PRIVATE_OTHER_CONTACT" });
  f.app.store.appendArchive(`tg:11223344@${nico.id}`, { ...message, id: "own-dm-contact", authorId: "11223344", authorName: "Own DM contact" });
  const path = "/api/agents/" + nico.id + "/permissions";
  const initial = await f.request(f.alice, path);
  assert.equal(initial.status, 200); assert.equal(initial.data.canManage, true);
  assert.ok(initial.data.people.some((person) => person.id === contact && !person.allowed));
  assert.ok(initial.data.people.some((person) => person.name === "Own DM contact"));
  assert.doesNotMatch(JSON.stringify(initial.data), /PRIVATE_OTHER_CONTACT/);
  for (const actor of [f.bob, f.admin]) {
    assert.equal((await f.request(actor, path)).status, 403);
    assert.equal((await f.request(actor, path, { method: "PUT", body: { id: contact, allowed: true } })).status, 403);
  }
  assert.equal((await f.request(f.alice, path, { method: "PUT", body: { id: "telegram:987654321", allowed: true } })).status, 400);
  const enabled = await f.request(f.alice, path, { method: "PUT", body: { id: contact, allowed: true, agentId: vera.id } });
  assert.equal(enabled.status, 200);
  assert.equal(f.app.store.hasAgentPermission(contact, nico.id), true);
  assert.equal(f.app.store.hasAgentPermission(contact, vera.id), false);
  assert.equal(f.app.knowledge.acceptsMessage(f.app.store.agent(nico.id), message, "tg:" + TG_GROUP), true);
  assert.equal((await f.request(f.alice, "/api/agents/" + vera.id + "/memories")).status, 403);
  f.app.store.updateSettings({ permissions: [{ id: contact, name: "Virginia Test", agents: ["*"] }] });
  assert.equal((await f.request(f.alice, path, { method: "PUT", body: { id: contact, allowed: false } })).status, 200);
  assert.equal(f.app.store.hasAgentPermission(contact, nico.id), false);
  assert.equal(f.app.store.hasAgentPermission(contact, vera.id), true);
  const future = await create(f.bob, "Future agent");
  assert.equal(f.app.store.hasAgentPermission(contact, future.id), true, "revoking one agent preserves the original future-agent grant");
  assert.deepEqual(f.app.store.settings.permissions[0].excludedAgents, [nico.id]);
  const reopened = new Store(f.app.store.home);
  try {
    assert.equal(reopened.hasAgentPermission(contact, nico.id), false);
    assert.equal(reopened.hasAgentPermission(contact, future.id), true);
  } finally { reopened.close(); }
  assert.equal(f.app.knowledge.acceptsMessage(f.app.store.agent(nico.id), message, "tg:" + TG_GROUP), false);
  assert.equal((await f.request(f.alice, path, { method: "PUT", body: { id: contact, allowed: true } })).status, 200);
  assert.equal(f.app.store.hasAgentPermission(contact, nico.id), true);
  assert.equal(f.app.store.agent(nico.id).brainOwnerId, f.alice.user.id);
  assert.equal(f.app.store.agent(nico.id).ownerId, "");
});

test("sharing recipients omit the viewer and emergency owner and retain admitted people by their public identities", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  f.app.store.registerPanelUser({ id: "real-space-owner", name: "Space Owner Name", email: "owner@owner.test", role: "owner", source: "cloud" });
  f.app.store.registerPanelUser({ ...f.bob.user, name: "Bob Public Name", emailVerified: true });
  for (const path of ["/api/brain/sharing", "/api/artifacts"]) {
    const result = await f.request(f.alice, path);
    assert.equal(result.status, 200);
    assert.ok(result.data.people.some((person) => person.id === f.bob.user.id && person.name === "Bob Public Name"));
    assert.ok(result.data.people.some((person) => person.id === "real-space-owner" && person.name === "Space Owner Name"));
    assert.ok(result.data.people.every((person) => !["local-owner", f.alice.user.id].includes(person.id)));
  }
  assert.ok(f.app.store.panelUser("local-owner"), "emergency access is preserved");
  f.app.store.blockPanelUser(f.bob.user.id, true);
  assert.ok((await f.request(f.alice, "/api/brain/sharing")).data.people.every((person) => person.id !== f.bob.user.id));
});

test("owner isolation preserves explicit chat permissions without granting private panel access", async (t) => {
  const telegram = await fakeTelegram();
  telegram.addBot("owner-permission-fixture", { id: 89001, username: "fixture_cora_bot", first_name: "Cora" });
  const f = await knowledgeWorld({ telegramToken: "owner-permission-fixture", telegramApi: telegram.url });
  t.after(async () => { await f.close(); await telegram.close(); });
  await f.request(f.admin, "/api/settings", { method: "PUT", body: { transport: "telegram", transports: ["telegram"], telegramChatIds: [TG_GROUP], telegramOwnerIds: [TG_OWNER] } });
  const nico = (await f.request(f.alice, "/api/agents", { method: "POST", body: { name: "Nico", model: "ollama/test-model", tools: false } })).data;
  const vera = (await f.request(f.bob, "/api/agents", { method: "POST", body: { name: "Vera", model: "ollama/test-model", tools: false } })).data;
  const caller = { id: "permission-chat-call", kind: "human", authorId: TG_STRANGER, authorName: "Virginia", content: "Nico, rispondi a questa richiesta autorizzata.", at: Date.now(), addressed: [nico.id] };
  const agent = f.app.store.agent(nico.id), channelId = "tg:" + TG_GROUP;
  assert.equal(f.app.knowledge.acceptsMessage(agent, caller, channelId), false);
  assert.equal(f.app.knowledge.acceptsMessage(agent, { ...caller, authorId: TG_OWNER, kind: "owner" }, channelId), false, "the space owner has no implicit access to another owner's bot");
  f.app.store.updateSettings({ permissions: [{ id: "telegram:" + TG_STRANGER, name: "Virginia", agents: [nico.id] }] });
  const state = f.app.orchestrator.state(channelId);
  assert.equal(f.app.orchestrator.authorized(caller, agent, state), true);
  assert.equal(f.app.knowledge.acceptsMessage(agent, caller, channelId), true);
  assert.equal(f.app.knowledge.acceptsMessage(agent, caller, "sl:C_PERMISSION_FIXTURE"), false, "a Telegram grant does not authorize a different transport identity");
  assert.equal(f.app.knowledge.acceptsMessage(f.app.store.agent(vera.id), caller, channelId), false);
  assert.equal(f.app.knowledge.acceptsMessage(agent, { ...caller, kind: "bot" }, channelId), false);
  const prompts = [];
  f.state.answer = (body) => { prompts.push(body); return { content: "PERMISSION_CHAT_REPLY" }; };
  f.app.orchestrator.push(state, caller);
  state.humanQueue.set(caller.id, caller);
  await f.app.orchestrator.round(state);
  assert.ok(telegram.state.sent.some((item) => item.method === "sendMessage" && item.text.includes("PERMISSION_CHAT_REPLY")));
  assert.match(JSON.stringify(prompts), /richiesta autorizzata/);
  assert.equal((await f.request(f.bob, "/api/agents/" + nico.id + "/memories")).status, 403);
  assert.equal((await f.request(f.admin, "/api/agents/" + nico.id)).status, 403);
  f.app.store.updateSettings({ permissions: [] });
  const count = prompts.length;
  const revoked = { ...caller, id: "permission-chat-revoked", at: Date.now(), handledBy: [] };
  f.app.orchestrator.push(state, revoked);
  state.humanQueue.set(revoked.id, revoked);
  await f.app.orchestrator.round(state);
  assert.equal(prompts.length, count, "revocation prevents a new model turn");
});

test("owner isolation hides private platform resources from other members and the space administrator", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  const created = await f.request(f.alice, "/api/agents", { method: "POST", body: { name: "Alice private assistant", core: "PRIVATE_CORE", tools: false } });
  const agent = f.app.store.agent(created.data.id);
  const routine = f.app.store.createRoutine(agent.id, { name: "PRIVATE_ROUTINE", prompt: "PRIVATE_TASK", schedule: "0 9 * * *", channelId: "web-" + agent.id });
  const subscription = f.app.store.createSubscription({ provider: "claude", label: "PRIVATE_ACCOUNT", connectedBy: { id: f.alice.user.id, name: "alice" } });
  const connection = { id: "gc_1111222233334444", email: "alice@private.test", agents: [agent.id], connectedBy: f.alice.user.id };
  f.app.store.setValue("googleConnectors", [connection]);
  const folder = (await f.request(f.alice, "/api/artifacts/folders", { method: "POST", body: { path: "alice-private", description: "PRIVATE_FOLDER", policy: "direct" } })).data;
  assert.equal(folder.memberAccess.default, "none");
  const uploaded = await fetch(f.base + "/api/artifacts/folders/" + folder.id + "/blobs", { method: "POST", headers: { ...f.alice.headers, "X-Cora": "1" }, body: "PRIVATE_ARTIFACT_CONTENT" });
  assert.equal(uploaded.status, 201); const blob = await uploaded.json();
  const published = await f.request(f.alice, "/api/artifacts/folders/" + folder.id + "/upload", { method: "POST", body: { files: [{ path: "private.md", sha: blob.sha }] } });
  assert.equal(published.status, 201); const commit = published.data.commit;
  const filePath = "/api/artifacts/commits/" + commit.id + "/files/private.md";
  assert.equal(await (await fetch(f.base + filePath, { headers: f.alice.headers })).text(), "PRIVATE_ARTIFACT_CONTENT");
  f.app.artifacts.shareSuffix = "--owner-fixture.usecora.test";
  const link = f.app.artifacts.createShare(folder.id, { label: "alice-document", view: "files", access: { mode: "people", emails: ["guest@external.test"], domains: [], members: false }, createdBy: { kind: "user", id: f.alice.user.id, name: "alice" } });
  const linkPolicy = structuredClone(link.access);
  const linkTarget = { kind: "share", share: link, folder: f.app.store.artifactFolder(folder.id) };
  assert.equal(f.app.artifacts.allows(linkTarget, { email: "guest@external.test", via: "email" }), true);
  const legacy = f.app.artifacts.createFolder({ path: "alice-legacy-private", description: "PRIVATE_LEGACY_FOLDER", createdBy: { kind: "user", id: f.alice.user.id, name: "alice" } });
  delete legacy.ownerId; legacy.memberAccess = { default: "write", users: {} }; f.app.store.writeArtifactFolder(legacy);
  assert.equal((await f.request(f.alice, "/api/artifacts/folders/" + legacy.id)).status, 200);
  const secret = await f.request(f.alice, "/api/secrets", { method: "POST", body: { name: "ALICE_FIXTURE_KEY", value: "fixture-value", description: "PRIVATE_SECRET", agents: ["*"] } });
  assert.equal(secret.status, 201);
  const file = f.app.orchestrator.saveWebFile({ name: "private.txt", type: "text/plain", data: Buffer.from("PRIVATE_FILE") }, agent);
  const trace = f.app.traces.start({ agentId: agent.id, channelId: "web-" + agent.id, kind: "chat", prompt: "PRIVATE_PROMPT", system: "PRIVATE_SYSTEM", model: "ollama/test-model" });
  trace.finish({ status: "done", output: "PRIVATE_OUTPUT" });
  for (const actor of [f.bob, f.admin]) {
    const state = (await f.request(actor, "/api/state")).data;
    assert.ok(!state.agents.some((item) => item.id === agent.id));
    assert.ok(!state.routines.some((item) => item.id === routine.id));
    assert.ok(!state.subscriptions.some((item) => item.id === subscription.id));
    for (const path of ["", "/email", "/mailbox", "/memories", "/traces", "/goals", "/box/access"]) assert.equal((await f.request(actor, "/api/agents/" + agent.id + path)).status, 403, path);
    assert.equal((await f.request(actor, "/api/agents/" + agent.id, { method: "PUT", body: { core: "FORGED" } })).status, 403);
    assert.equal((await f.request(actor, "/api/agents/" + agent.id, { method: "DELETE" })).status, 403);
    assert.equal((await f.request(actor, "/api/traces/" + trace.id)).status, 403);
    assert.equal((await f.request(actor, "/api/routines/" + routine.id, { method: "DELETE" })).status, 404);
    assert.equal((await f.request(actor, "/api/subscriptions/" + subscription.id)).status, 404);
    assert.deepEqual((await f.request(actor, "/api/connectors")).data.connections, []);
    assert.equal((await f.request(actor, "/api/connectors/" + connection.id, { method: "DELETE" })).status, 403);
    assert.deepEqual((await f.request(actor, "/api/artifacts")).data.folders, []);
    assert.equal((await f.request(actor, "/api/artifacts/folders/" + folder.id)).status, 403);
    for (const path of [filePath, filePath + "?download=1", "/api/artifacts/commits/" + commit.id, "/api/artifacts/commits/" + commit.id + "/objects/" + blob.sha, "/api/artifacts/commits/" + commit.id + "/view?path=private.md"]) assert.equal((await fetch(f.base + path, { headers: actor.headers })).status, 403, path);
    assert.deepEqual((await f.request(actor, "/api/secrets")).data.secrets, []);
    assert.equal((await f.request(actor, "/api/secrets/ALICE_FIXTURE_KEY", { method: "DELETE" })).status, 404);
    const denied = await fetch(f.base + "/api/files/" + file.id, { headers: actor.headers });
    assert.equal(denied.status, 404);
    assert.equal((await f.request(actor, "/api/agents/" + agent.id + "/routines", { method: "POST", body: { name: "FORGED" } })).status, 403);
    const desktop = await fetch(f.base + "/box/" + agent.id + "/", { headers: actor.headers });
    assert.equal(desktop.status, 403);
  }
  assert.equal((await f.request(f.alice, "/api/agents/" + agent.id)).status, 200);
  assert.equal((await fetch(f.base + "/api/files/" + file.id, { headers: f.alice.headers })).status, 200);
  const bobAgent = (await f.request(f.bob, "/api/agents", { method: "POST", body: { name: "Bob private assistant", tools: false } })).data;
  assert.ok(!f.app.artifacts.foldersFor(f.app.store.agent(bobAgent.id)).length);
  assert.ok(!f.app.vault.canUse(f.app.store.vaultSecret("ALICE_FIXTURE_KEY"), f.app.store.agent(bobAgent.id)));
  assert.doesNotMatch(f.app.brain.systemPrompt(agent, { computer: false }), /Bob private assistant/);
  assert.equal(f.app.knowledge.acceptsMessage(agent, { authorId: f.bob.user.id, kind: "owner" }, "web"), false);
  assert.equal(f.app.knowledge.acceptsMessage(agent, { agentId: bobAgent.id, kind: "agent" }, "web"), false);
  const abort = new AbortController();
  const stream = await fetch(f.base + "/api/events", { headers: f.bob.headers, signal: abort.signal });
  let events = ""; const reading = (async () => { try { for await (const chunk of stream.body) events += Buffer.from(chunk).toString(); } catch {} })();
  try {
    await f.request(f.alice, "/api/rooms/web/messages", { method: "POST", body: { text: "ALICE_PRIVATE_SALOTTO" } });
    const own = await f.request(f.alice, "/api/rooms/web/messages");
    assert.match(JSON.stringify(own.data), /ALICE_PRIVATE_SALOTTO/);
    assert.doesNotMatch(JSON.stringify((await f.request(f.bob, "/api/rooms/web/messages")).data), /ALICE_PRIVATE_SALOTTO/);
    assert.doesNotMatch(JSON.stringify((await f.request(f.admin, "/api/rooms/web/messages")).data), /ALICE_PRIVATE_SALOTTO/);
    const live = f.app.traces.start({ agentId: agent.id, kind: "chat", channelId: "web-" + agent.id, prompt: "LIVE_PRIVATE", model: "ollama/test-model" });
    live.add({ type: "thinking", text: "LIVE_PRIVATE_THINKING" }); live.finish({ status: "done", output: "LIVE_PRIVATE_OUTPUT" });
    await f.request(f.bob, "/api/rooms/web/messages", { method: "POST", body: { text: "BOB_OWN_SALOTTO" } });
    await waitFor(() => events.includes("BOB_OWN_SALOTTO"));
    assert.doesNotMatch(events, /ALICE_PRIVATE|LIVE_PRIVATE|Alice private assistant/);
  } finally { abort.abort(); await reading; }
  await f.request(f.alice, "/api/artifacts/folders/" + folder.id, { method: "PUT", body: { memberAccess: { default: "none", users: { [f.bob.user.id]: "read" } } } });
  assert.equal((await f.request(f.bob, "/api/artifacts/folders/" + folder.id)).status, 200);
  assert.equal(await (await fetch(f.base + filePath, { headers: f.bob.headers })).text(), "PRIVATE_ARTIFACT_CONTENT");
  assert.deepEqual(f.app.store.artifactShare(link.id).access, linkPolicy, "internal sharing does not alter link permissions");
  assert.equal(f.app.artifacts.allows(linkTarget, { email: f.bob.user.email, via: "email" }), false, "internal access does not grant access through an independently restricted link");
  assert.equal((await f.request(f.admin, "/api/artifacts/folders/" + folder.id)).status, 403);
  await f.request(f.alice, "/api/artifacts/folders/" + folder.id, { method: "PUT", body: { memberAccess: { default: "read", users: {} } } });
  assert.ok(f.app.artifacts.foldersFor(f.app.store.agent(bobAgent.id)).some((item) => item.folder === folder.path));
  assert.equal((await f.request(f.admin, "/api/artifacts/folders/" + folder.id)).status, 200);
  assert.equal((await f.request(f.admin, "/api/artifacts/folders/" + folder.id)).data.canReview, false);
  await f.request(f.alice, "/api/artifacts/folders/" + folder.id, { method: "PUT", body: { memberAccess: { default: "none", users: {} } } });
  assert.equal((await f.request(f.bob, "/api/artifacts/folders/" + folder.id)).status, 403);
  assert.equal((await fetch(f.base + filePath, { headers: f.bob.headers })).status, 403);
  assert.deepEqual(f.app.store.artifactShare(link.id).access, linkPolicy, "internal revocation does not alter link permissions");
});

test("a fresh memory boundary refuses old Slack reconnect history, archive retrieval and prompt context", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  const agent = (await f.request(f.alice, "/api/agents", { method: "POST", body: { name: "Epoch assistant", tools: false } })).data;
  const cutoff = Date.now() - 30000;
  f.app.store.setValue("knowledgeResetAt", new Date(cutoff).toISOString());
  const old = { id: "epoch-old", at: cutoff - 1000, kind: "human", authorId: f.alice.user.id, authorName: "alice", content: "RESET_OLD_CANARY" };
  const fresh = { ...old, id: "epoch-new", at: Date.now(), content: "RESET_NEW_CANARY" };
  const channelId = "sl:C0RESETFIXTURE";
  f.app.channels.list = () => [{ id: channelId, kind: "slack" }];
  f.app.channels.info = (id) => ({ id, kind: "slack", name: "QA", channelId: "C0RESETFIXTURE" });
  f.app.orchestrator.slackHistory = async () => [{ ts: String(old.at / 1000), item: old }, { ts: String(fresh.at / 1000), item: fresh }];
  f.app.orchestrator.slackItem = async (event) => event.item;
  await f.app.orchestrator.catchUpSlack();
  assert.deepEqual(f.app.store.recentMessages(channelId, 20).map((item) => item.id), [fresh.id]);
  assert.deepEqual(f.app.orchestrator.state(channelId).history.map((item) => item.id), [fresh.id]);
  f.app.store.appendArchive("web-" + agent.id, old);
  await f.app.librarian.run();
  const archive = await f.app.knowledge.ownerBrain(f.alice.user.id).searchArchive("CANARY");
  assert.match(JSON.stringify(archive), /RESET_NEW_CANARY/);
  assert.doesNotMatch(JSON.stringify(archive), /RESET_OLD_CANARY/);
  const prompts = []; f.state.answer = (body) => { prompts.push(body); return { content: "Nuova risposta." }; };
  await f.app.brain.chatTurn({ agent: f.app.store.agent(agent.id), forced: true, computer: false, history: [old, fresh], channel: { id: "web-" + agent.id, name: "QA" } });
  assert.match(JSON.stringify(prompts), /RESET_NEW_CANARY/);
  assert.doesNotMatch(JSON.stringify(prompts), /RESET_OLD_CANARY/);
  const recalled = await executeTool({ name: "recall", args: { query: "CANARY" } }, { agent: f.app.store.agent(agent.id), store: f.app.store, knowledge: f.app.knowledge, memory: f.app.brain.memory, channelIds: [channelId, "web-" + agent.id], formatWhen: String, channelLabel: String });
  assert.match(recalled.text, /RESET_NEW_CANARY/); assert.doesNotMatch(recalled.text, /RESET_OLD_CANARY/);
  f.app.knowledge.ownerMemory = false;
  assert.equal(f.app.knowledge.afterReset(old), true, "legacy shared-space behavior is preserved");
});

test("an agent CLI cannot inherit owner Brain links, database access or other agents' GitHub credentials", async (t) => {
  const agent = app.store.createAgent({ name: "Owner env guard", model: "hermes/test-model", tools: false });
  t.after(() => app.store.deleteAgent(agent.id));
  const names = ["CORA_KNOWLEDGE_PRIVATE_FIXTURE", "CORO_KNOWLEDGE_PRIVATE_FIXTURE", "CORA_GH_KEY_PRIVATE_FIXTURE", "BRAIN_DATABASE_URL"];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) process.env[name] = "fixture-private-value";
  cli.set({ reply: "Controllo completato.", tool: "list_routines" });
  try {
    const answer = await app.brain.chatTurn({ agent, forced: true, computer: false, history: [{ kind: "owner", authorId: OWNER, authorName: "Owner", content: "Controlla le tue routine.", at: Date.now() }], channel: { id: "web-" + agent.id, name: "QA" } });
    assert.match(answer.text, /Controllo completato/);
    const run = cli.calls().findLast((item) => item.flavor === "hermes");
    assert.ok(run.tools.includes("list_routines"));
    assert.deepEqual(run.secretEnv, []);
  } finally {
    for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test("a Brain link replacement cannot change the active source when work begins while hush is saving", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  const agent = (await f.request(f.alice, "/api/agents", { method: "POST", body: { name: "Link guard", tools: false } })).data;
  assert.equal((await f.request(f.alice, "/api/agents/" + agent.id + "/knowledge", { method: "PUT", body: { source: "external", url: "https://old.owner.test/brain" } })).status, 200);
  const original = f.app.store.value("agentBrainLink:" + agent.id), oldLink = f.app.knowledge.links.get(agent.id);
  let saving, finish; const began = new Promise((resolve) => { saving = resolve; });
  f.app.knowledge.storeSecret = async () => { saving(); await new Promise((resolve) => { finish = resolve; }); };
  const changing = f.request(f.alice, "/api/agents/" + agent.id + "/knowledge", { method: "PUT", body: { source: "external", url: "https://new.owner.test/brain" } });
  await began;
  assert.throws(() => f.app.knowledge.forAgent(f.app.store.agent(agent.id)), /aggiornamento/);
  f.app.knowledge.isBusy = () => true; finish();
  assert.equal((await changing).status, 409);
  assert.deepEqual(f.app.store.value("agentBrainLink:" + agent.id), original);
  assert.equal(f.app.knowledge.links.get(agent.id), oldLink);
  assert.equal(f.app.store.agent(agent.id).brainSource, "external");
});

test("an external agent Brain is the exclusive read-only source across prompts, tools, APIs and failures", async (t) => {
  const signedIn = await call("/api/login", { method: "POST", body: { password: PASSWORD }, auth: false });
  const headers = { Cookie: signedIn.headers.get("set-cookie").split(";")[0] };
  const requests = [];
  const source = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ pages: [{ slug: "external-nimbus", title: "Nimbus", summary: "EXTERNAL_NIMBUS_CANARY", body: "EXTERNAL_NIMBUS_CANARY: read the external procedure." }] }));
  });
  await new Promise((resolve) => source.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${source.address().port}/brain?access=fixture-link`;
  const previous = { internal: app.knowledge.internal, company: app.brain.companyBrain, allowLocal: app.knowledge.allowLocal };
  let internalCalls = 0;
  const internal = { enabled: true, search: async () => { internalCalls++; return [{ slug: "private", title: "Nimbus", summary: "INTERNAL_COMPANY_CANARY" }]; } };
  app.knowledge.internal = internal; app.brain.companyBrain = internal; app.knowledge.allowLocal = true;
  const created = await call("/api/agents", { method: "POST", headers, body: { name: "Exclusive Source", tools: false, core: "INTERNAL_CORE_CANARY", brainSource: "external" } });
  const id = created.data.id;
  const memory = app.store.addMemory(id, "Nimbus INTERNAL_FACT_CANARY", "manual");
  app.store.addDiary(id, "Nimbus INTERNAL_DIARY_CANARY");
  t.after(async () => {
    app.knowledge.internal = previous.internal; app.brain.companyBrain = previous.company; app.knowledge.allowLocal = previous.allowLocal;
    app.knowledge.external.delete(id); app.knowledge.links.delete(id); delete hushVault[`CORA_KNOWLEDGE_${id.toUpperCase()}`]; app.store.deleteAgent(id);
    await new Promise((resolve) => source.close(resolve));
  });
  assert.equal(created.data.brainSource, "internal", "the generic creation API cannot bypass source configuration");
  const configured = await call(`/api/agents/${id}/knowledge`, { method: "PUT", headers, body: { source: "external", url } });
  assert.equal(configured.status, 200);
  assert.equal(configured.data.readonly, true);
  assert.ok(!JSON.stringify(configured.data).includes("fixture-link"));
  assert.equal(hushVault[`CORA_KNOWLEDGE_${id.toUpperCase()}`], url);
  const agent = app.store.agent(id);
  const ctx = { agent, store: app.store, knowledge: app.knowledge, companyBrain: internal, memory: app.brain.memory, channelId: `web-${id}`, channelLabel: (id) => id };
  for (const call of [{ name: "recall", args: { query: "Nimbus" } }, { name: "brain_search", args: { query: "Nimbus" } }, { name: "brain_page", args: { slug: "external-nimbus" } }]) {
    const result = await executeTool(call, ctx);
    assert.match(result.text, /EXTERNAL_NIMBUS_CANARY|external-nimbus/);
    assert.doesNotMatch(result.text, /INTERNAL_/);
  }
  for (const name of ["remember", "forget", "update_core", "brain_note"]) assert.match((await executeTool({ name, args: { fact: "forged write", text: "forged write", memory_id: memory.id, shared: true } }, ctx)).text, /read-only/);
  const prompts = [];
  replies.set("Exclusive Source", (body) => { prompts.push(body); return { content: "La procedura è nel Brain esterno." }; });
  const result = await app.brain.chatTurn({ agent, forced: true, computer: false, history: [{ kind: "owner", authorId: OWNER, authorName: "Sam", content: "Nimbus?", at: Date.now() }], channel: { id: `web-${id}`, name: "QA", place: "nel pannello" } });
  assert.ok(result.text);
  const serialized = JSON.stringify(prompts);
  assert.match(serialized, /EXTERNAL_NIMBUS_CANARY/);
  assert.doesNotMatch(serialized, /INTERNAL_(?:CORE|FACT|DIARY|COMPANY)_CANARY/);
  const tools = prompts[0].tools.map((tool) => tool.function.name);
  assert.ok(tools.includes("brain_search"));
  assert.ok(!tools.some((name) => ["remember", "forget", "update_core", "brain_note"].includes(name)));
  const visible = await call(`/api/agents/${id}/memories`, { headers });
  assert.equal(visible.data.source, "external");
  assert.doesNotMatch(JSON.stringify(visible.data), /INTERNAL_/);
  for (const [path, method, body] of [["memories", "POST", { text: "forged write" }], ["core", "PUT", { text: "forged write" }], ["sleep", "POST", {}], [`memories/${memory.id}`, "DELETE", {}]]) {
    assert.equal((await call(`/api/agents/${id}/${path}`, { method, headers, body })).status, 409);
  }
  await call(`/api/agents/${id}`, { method: "PUT", headers, body: { core: "forged write", brainSource: "internal", brainOwnerId: "forged" } });
  assert.equal(app.store.agent(id).core, "INTERNAL_CORE_CANARY");
  assert.equal(app.store.agent(id).brainSource, "external");
  assert.equal((await app.brain.sleep(agent, { force: true })).status, "external-readonly");
  const external = app.knowledge.forAgent(agent); external.cache = null;
  await new Promise((resolve) => source.close(resolve));
  assert.match((await executeTool({ name: "recall", args: { query: "Nimbus" } }, ctx)).text, /error:/);
  assert.equal(internalCalls, 0, "an unavailable external source never falls back to internal knowledge");
  assert.ok(requests.every((request) => request.method === "GET"));
  const restored = await call(`/api/agents/${id}/knowledge`, { method: "PUT", headers, body: { source: "internal" } });
  assert.equal(restored.status, 200);
  assert.match((await executeTool({ name: "recall", args: { query: "Nimbus" } }, ctx)).text, /fonte del Brain è cambiata/);
  assert.equal(app.store.memories(id).length, 1);
  assert.equal(app.store.agent(id).core, "INTERNAL_CORE_CANARY");
  for (const address of ["127.0.0.1", "169.254.169.254", "100.64.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(publicKnowledgeAddress(address), false);
  const denied = new ExternalBrain({ url: () => "https://127.0.0.1/brain" });
  await assert.rejects(denied.pages(), /Internet pubblico/);
});

test("voice format decisions require an explicit written medium and exact evidence before publishing text", async (t) => {
  const soniox = await fakeSoniox();
  const previousVoice = app.orchestrator.voice;
  app.orchestrator.voice = new Voice({ key: soniox.key, api: soniox.url, ttsUrl: soniox.ttsUrl });
  const agent = app.store.createAgent({ name: "Vani", model: "ollama/test-model", tools: false });
  t.after(async () => { app.orchestrator.voice = previousVoice; app.store.deleteAgent(agent.id); await soniox.close(); });
  for (const [index, scenario] of [
    { request: "Vani, dammi una checklist delle attività che stavi facendo, di quelle attività che sono su Linear, e mi scrivi la lista.", decision: { mode: "both", evidence: "mi scrivi la lista" }, expected: "voice" },
    { request: "Vani, dimmi come procede.", decision: { mode: "both", evidence: "mandami anche il testo" }, expected: "voice" },
    { request: "Vani, dimmi come procede.", decision: { mode: "text" }, expected: "voice" },
    { request: "Vani, rispondimi per iscritto.", decision: { mode: "text", evidence: "rispondimi per iscritto" }, expected: "text" },
    { request: "Vani, mandami anche il testo.", decision: { mode: "both", evidence: "mandami anche il testo" }, expected: "both" },
  ].entries()) {
    replies.set("*", (body) => /^Decidi come consegnare/.test(body.messages[0].content) ? { content: JSON.stringify(scenario.decision) } : { content: "PASS" });
    let step = 0;
    const progress = `Controllo voce ${index}.`;
    const final = `Risposta voce ${index}.`;
    replies.set("Vani", () => ++step === 1 ? { tool_calls: [{ function: { name: "say", arguments: { text: progress, voice: true } } }] } : { content: final });
    const before = discord.state.webhookPosts.length;
    soniox.state.transcripts.push(scenario.request);
    const message = discord.say({ content: "", flags: 1 << 13, attachments: [discord.attachment(`vani-${index}.ogg`, Buffer.concat([Buffer.from("OggS"), Buffer.alloc(1000)]), "audio/ogg")] });
    await waitFor(() => app.store.recentMessages(CHANNEL).some((item) => item.agentId === agent.id && item.content === final));
    await quiet();
    assert.equal(app.store.recentMessages(CHANNEL).find((item) => item.id === message.id).replyMode, scenario.expected);
    const posts = discord.state.webhookPosts.slice(before).filter((post) => post.username === "Vani");
    assert.deepEqual(posts.filter((post) => post.content).map((post) => post.content), scenario.expected === "voice" ? [] : [progress, final]);
    assert.equal(posts.filter((post) => post.file).length, scenario.expected === "text" ? 0 : 2);
  }
});

test("voice reply delivery sends progress and final audio without text and preserves trace evidence", async (t) => {
  const soniox = await fakeSoniox();
  const previousVoice = app.orchestrator.voice;
  const previousTransport = { transport: app.store.settings.transport, transports: app.store.settings.transports, guildIds: app.store.settings.guildIds };
  app.orchestrator.voice = new Voice({ key: soniox.key, api: soniox.url, ttsUrl: soniox.ttsUrl });
  app.store.updateSettings({ transport: "discord", transports: { discord: true, telegram: false, slack: false }, guildIds: [GUILD] });
  const agent = app.store.createAgent({ name: "Vera", model: "ollama/test-model", tools: false });
  t.after(async () => { app.orchestrator.voice = previousVoice; app.store.updateSettings(previousTransport); app.store.deleteAgent(agent.id); await soniox.close(); });
  let step = 0;
  replies.set("Vera", () => ++step === 1
    ? { tool_calls: [{ function: { name: "say", arguments: { text: "Ti ascolto." } } }] }
    : { content: "Va bene, ci sentiamo domani." });
  soniox.state.transcripts.push("Vera, mi rispondi?");
  discord.say({ content: "", flags: 1 << 13, attachments: [discord.attachment("vera.ogg", Buffer.concat([Buffer.from("OggS"), Buffer.alloc(1000)]), "audio/ogg")] });
  await waitFor(() => app.store.recentMessages(CHANNEL).some((item) => item.agentId === agent.id && item.content === "Va bene, ci sentiamo domani."));
  await quiet();
  const posts = discord.state.webhookPosts.filter((post) => post.username === "Vera");
  assert.equal(posts.length, 2);
  assert.ok(posts.every((post) => post.file && !post.content));
  const archived = app.store.recentMessages(CHANNEL).filter((item) => item.agentId === agent.id);
  assert.ok(archived.every((item) => item.voiceOnly && item.traceId));
  const trace = app.store.trace(archived.at(-1).traceId);
  assert.ok(trace.steps.find((item) => item.type === "tool" && item.name === "say").result.includes(archived[0].id));
  assert.match(trace.prompt, /Cora consegna solo la tua voce/);
});

test("artifact team permissions enforce private, read and upload access for actual member sessions", async (t) => {
  const signedIn = await call("/api/login", { method: "POST", body: { password: PASSWORD }, auth: false });
  const ownerHeaders = { Cookie: signedIn.headers.get("set-cookie").split(";")[0] };
  const previous = app.store.accessPolicy();
  app.store.updateAccessPolicy({ emails: [...previous.emails, "reader@artifact.test", "writer@artifact.test", "later@artifact.test"] });
  const members = ["reader", "writer", "later"].map((name) => {
    const user = app.store.registerPanelUser({ id: `artifact-${name}`, name, email: `${name}@artifact.test`, emailVerified: true, role: "member" });
    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    app.store.createPanelSession(hash, user.id, Date.now() + 3600000);
    const signature = createHmac("sha256", "test-session-key").update(`session.v2.${token}`).digest("base64url");
    return { user, hash, headers: { Cookie: `cora_session=v2.${token}.${signature}` } };
  });
  const [reader, writer, later] = members;
  const agent = app.store.createAgent({ name: "Artifact Test", tools: false });
  let folder;
  t.after(() => {
    if (folder) app.artifacts.deleteFolder(folder.id);
    app.store.deleteAgent(agent.id);
    for (const { user, hash } of members) {
      app.store.deletePanelSession(hash);
      app.store.stmt("DELETE FROM panel_users WHERE id = ?").run(user.id);
    }
    app.store.updateAccessPolicy(previous);
  });
  const owner = (path, options = {}) => call(path, { ...options, headers: ownerHeaders });
  const as = (member, path, options = {}) => call(path, { ...options, headers: member.headers });
  const created = await owner("/api/artifacts/folders", { method: "POST", body: {
    path: "team/permissions-test", policy: "direct", writers: [agent.id], memberAccess: { default: "none", users: { [reader.user.id]: "read", [writer.user.id]: "write" } },
  } });
  assert.equal(created.status, 201);
  folder = created.data;
  const endpoint = `/api/artifacts/folders/${folder.id}`;
  const upload = async (headers, text) => {
    const response = await fetch(`${base}${endpoint}/blobs`, { method: "POST", headers: { ...headers, "X-Cora": "1" }, body: text });
    return { status: response.status, data: await response.json() };
  };
  const blob = await upload(ownerHeaders, "Visible to authorized team members.");
  const published = await owner(`${endpoint}/upload`, { method: "POST", body: { files: [{ path: "readme.md", sha: blob.data.sha }] } });
  assert.equal(published.data.commit.status, "published");
  const commit = published.data.commit;
  assert.equal((await as(reader, endpoint)).data.canUpload, false);
  assert.equal((await as(writer, endpoint)).data.canUpload, true);
  assert.deepEqual((await owner(endpoint)).data.people.map((person) => person.id).filter((id) => id.startsWith("artifact-")).sort(), members.map(({ user }) => user.id).sort());
  assert.equal((await as(reader, `/api/artifacts/commits/${commit.id}/files/readme.md`)).status, 200);
  assert.equal((await upload(reader.headers, "Denied write")).status, 403);
  assert.equal((await as(reader, `${endpoint}/upload`, { method: "POST", body: { files: [{ path: "copy.md", sha: blob.data.sha }] } })).status, 403);
  assert.equal((await as(reader, `${endpoint}/remove`, { method: "POST", body: { paths: ["readme.md"] } })).status, 403);
  assert.equal((await as(writer, endpoint, { method: "PUT", body: { memberAccess: { default: "write", users: {} } } })).status, 403);
  assert.equal((await as(later, "/api/artifacts")).data.folders.some((item) => item.id === folder.id), false);
  const deniedContext = { store: app.store, artifacts: app.artifacts, agent, artifactUserId: later.user.id, requester: { kind: "owner", id: later.user.id } };
  assert.match((await executeTool({ name: "artifact_log", args: { folder: folder.path } }, deniedContext)).text, /non hai accesso/);
  assert.ok(!JSON.parse((await executeTool({ name: "artifact_folders", args: {} }, deniedContext)).text).folders.some((item) => item.folder === folder.path));
  for (const path of [endpoint, `/api/artifacts/commits/${commit.id}`, `/api/artifacts/commits/${commit.id}/files/readme.md`, `/api/artifacts/commits/${commit.id}/objects/${blob.data.sha}`, `/api/artifacts/commits/${commit.id}/view?path=readme.md`]) assert.equal((await as(later, path)).status, 403, path);
  assert.equal(app.artifacts.canWrite(app.store.artifactFolder(folder.id), agent), true, "member rules do not change the assigned agent's permission");
  const priorBrain = app.artifacts.companyBrain;
  const catalog = [];
  app.artifacts.companyBrain = { enabled: true, write: async (page) => catalog.push(page) };
  try { await app.artifacts.syncBrain(); assert.ok(!catalog.at(-1).body.includes(folder.path), "restricted folder metadata does not enter the shared Brain catalog"); }
  finally { app.artifacts.companyBrain = priorBrain; }
  const nextBlob = await upload(writer.headers, "A member's proposed update.");
  const proposal = await as(writer, `${endpoint}/upload`, { method: "POST", body: { files: [{ path: "update.md", sha: nextBlob.data.sha }] } });
  assert.equal(proposal.status, 201);
  assert.equal(proposal.data.commit.status, "proposed", "upload rights do not confer reviewer rights");
  assert.equal((await as(writer, `/api/artifacts/commits/${proposal.data.commit.id}/review`, { method: "POST", body: { decision: "approve" } })).status, 403);
  const access = { default: "read", users: { [writer.user.id]: "none" } };
  assert.equal((await owner(endpoint, { method: "PUT", body: { memberAccess: access, reviewers: [reader.user.id] } })).status, 200);
  assert.equal((await as(later, endpoint)).data.canUpload, false, "default access covers other admitted members");
  assert.equal((await as(writer, endpoint)).status, 403);
  assert.equal((await as(reader, endpoint)).data.canReview, true);
  assert.equal((await as(reader, endpoint, { method: "PUT", body: { memberAccess: { default: "write", users: {} } } })).status, 403, "reviewers cannot grant team access");
  assert.throws(() => app.artifacts.configureFolder(folder.path, { agent, requester: { kind: "owner", id: later.user.id }, policy: "direct" }), /proprietario e i suoi revisori/, "panel members cannot gain owner rights by asking an agent");
  const reopened = new Store(home);
  assert.deepEqual(reopened.artifactFolder(folder.id).memberAccess, access);
  reopened.close();
  const detail = (await as(later, endpoint)).data;
  const panel = panelHarness({ language: "en" });
  panel.run(`S.data={agents:[]};document.getElementById("app").replaceChildren(artifactFiles(${JSON.stringify(detail)},${JSON.stringify(commit)}));`);
  assert.equal(panel.run(`document.getElementById("app").querySelector(".art-drop")`), null);
  assert.match(panel.app.textContent, /read access/);
});

test("artifact upload permissions are rechecked after streaming and while a commit waits for its folder lock", async (t) => {
  const previous = app.store.accessPolicy();
  app.store.updateAccessPolicy({ emails: [...previous.emails, "stream@artifact.test"] });
  const user = app.store.registerPanelUser({ id: "artifact-stream", name: "Stream", email: "stream@artifact.test", emailVerified: true, role: "member" });
  const owner = { id: "local-owner", role: "owner" };
  const folder = app.artifacts.createFolder({ path: "team/stream-permission" });
  let release = () => {};
  t.after(() => { release(); app.artifacts.deleteFolder(folder.id); app.store.stmt("DELETE FROM panel_users WHERE id = ?").run(user.id); app.store.updateAccessPolicy(previous); });
  const deny = () => app.artifacts.updateFolder(folder.id, { memberAccess: { default: "none", users: {} } }, owner);
  async function* chunks() { yield Buffer.from("first"); deny(); yield Buffer.from("second"); }
  await assert.rejects(app.artifacts.receive(folder.id, user, chunks(), 11), /revocato/);
  assert.equal(app.store.artifactUploads(folder.id, `user:${user.id}`, 0).size, 0);
  app.artifacts.updateFolder(folder.id, { memberAccess: { default: "write", users: {} } }, owner);
  const blob = await app.artifacts.receive(folder.id, user, [Buffer.from("A valid upload")], 14);
  const barrier = new Promise((resolve) => { release = resolve; });
  const held = app.artifacts.withLock(folder.id, () => barrier);
  const queued = app.artifacts.commitUpload(folder.id, { user, files: [{ path: "queued.txt", sha: blob.sha }] });
  deny(); release(); await held;
  await assert.rejects(queued, /non puoi caricare/);
  assert.equal(app.store.artifactCommits(folder.id).length, 0);
});

test("a managed default email domain keeps its real provider status and never bypasses verification", async (t) => {
  const f = await mailWorld(t);
  const account = (await f.call("/api/mail/accounts", { method: "POST", body: { name: "Default account", key: f.keyA } })).data;
  const domain = (await f.call("/api/mail/domains", { method: "POST", body: { name: "team-default.test", accountId: account.id } })).data;
  f.app.mailDomains.defaultDomain = domain.name;
  f.app.boxes.mailbox.domain = domain.name;
  const view = (await f.call("/api/mail/domains")).data;
  assert.equal(view.defaultDomain, domain.name);
  assert.equal(view.domains.filter((item) => item.name === domain.name).length, 1);
  assert.equal(view.domains[0].accountName, "Default account");
  assert.equal(view.domains[0].ready, false);
  const agent = f.app.store.createAgent({ name: "Default Domain", tools: true, model: "ollama/test-model" });
  assert.equal((await f.call(`/api/agents/${agent.id}/mailbox`, { method: "PUT", body: { local: "default-agent", domain: domain.name } })).status, 409);
  f.state.dnsReady.add(domain.name);
  assert.equal((await f.call(`/api/mail/domains/${domain.id}/verify`, { method: "POST" })).data.ready, true);
  await f.app.boxes.ensureMailbox(agent);
  assert.match(f.app.store.value(`agentMailbox:${agent.id}`).email, /@team-default\.test$/);
  assert.equal((await f.call(`/api/agents/${agent.id}/mailbox`, { method: "PUT", body: { local: "default-agent", domain: domain.name } })).status, 200);
});

test("Linear workspace panel manages independent grants and keeps legacy connections", async (t) => {
  const fixture = await subscriptionApp(t);
  const firstAgent = fixture.app.store.createAgent({ name: "First workspace agent", tools: false });
  const secondAgent = fixture.app.store.createAgent({ name: "Second workspace agent", tools: false });
  fixture.app.keyConnectors.fetch = async (_url, options) => {
    const second = String(options.headers.Authorization).includes("fixture_second");
    return new Response(JSON.stringify({ data: { viewer: { name: "Fixture owner", organization: { id: second ? "second-org" : "first-org", urlKey: second ? "secondspace" : "firstspace" } } } }), { status: 200 });
  };
  const first = await fixture.request("/api/connectors/keys/linear", { method: "POST", body: { workspace: "firstspace", token: "lin_api_fixture_first" } });
  assert.equal(first.status, 200);
  const legacy = { ...first.data.record }; delete legacy.secretName;
  fixture.app.store.setValue("keyConnectors", [legacy]);
  const second = await fixture.request("/api/connectors/keys/linear", { method: "POST", body: { workspace: "secondspace", token: "lin_api_fixture_second" } });
  assert.equal(second.status, 200);
  const panel = panelHarness({ hash: "#/settings/connettori/linear", fetch: async (path, init = {}) => {
    const response = await fixture.request(path, { method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined });
    return { ok: response.status < 400, status: response.status, json: async () => response.data };
  } });
  await panel.run("boot()");
  const pane = panel.run('document.querySelector(".connectors-pane")'); await pane.readyConnectors;
  const cards = () => pane.querySelector(".connector-detail").querySelectorAll(".panel");
  assert.equal(cards().length, 2);
  assert.match(cards()[0].textContent, /firstspace/); assert.match(cards()[1].textContent, /secondspace/);
  for (const card of cards()) { assert.equal(card.tagName, "details"); assert.equal(card.getAttribute("open"), null); }
  cards()[0].open = true; cards()[0].dispatch("toggle");

  const check = (card, agentName) => card.querySelectorAll("input").find(input => input.getAttribute("aria-label") === `Autorizza ${agentName}`);
  check(cards()[0], firstAgent.name).checked = true; check(cards()[0], firstAgent.name).dispatch("change");
  await waitFor(() => fixture.app.keyConnectors.linearConnections().find(item => item.id === legacy.id).agents.includes(firstAgent.id));
  await sleep(50);
  assert.equal(cards()[0].getAttribute("open"), "");
  assert.equal(cards()[1].getAttribute("open"), null);
  check(cards()[1], secondAgent.name).checked = true; check(cards()[1], secondAgent.name).dispatch("change");
  await waitFor(() => fixture.app.keyConnectors.linearConnections().find(item => item.id === second.data.record.id).agents.includes(secondAgent.id));
  await sleep(50);
  assert.deepEqual(fixture.app.store.vaultSecret("CORA_LINEAR_KEY").agents, [firstAgent.id]);
  assert.deepEqual(fixture.app.store.vaultSecret(second.data.record.secretName).agents, [secondAgent.id]);
  assert.equal(Boolean(check(cards()[0], secondAgent.name).checked), false);
  assert.equal(Boolean(check(cards()[1], firstAgent.name).checked), false);
  pane.querySelectorAll("button").find(button => button.textContent === "Collega un altro workspace").click();
  const draft = pane.querySelector(".connector-detail").querySelectorAll("input").find(input => input.getAttribute("aria-label") === "Workspace di Linear");
  draft.value = "thirdspace";
  await panel.run('document.activeElement=null;document.hidden=false;document.listeners.visibilitychange[0]()');
  assert.equal(draft.isConnected, true); assert.equal(draft.value, "thirdspace");
  pane.querySelectorAll("button").find(button => button.textContent === "Annulla").click();
  const remove = cards()[1].querySelectorAll("button").find(button => button.textContent === "Scollega");
  remove.click(); assert.equal(fixture.app.keyConnectors.linearConnections().length, 2);
  remove.click(); await waitFor(() => fixture.app.keyConnectors.linearConnections().length === 1);
  assert.ok(fixture.app.store.vaultSecret("CORA_LINEAR_KEY"));
  assert.deepEqual(fixture.app.keyConnectors.linearConnections()[0].agents, [firstAgent.id]);
});

test("Linear app editing replaces only the selected card and cancels without writes", async (t) => {
  const fixture = await subscriptionApp(t);
  const apps = [];
  for (const workspace of ["firstspace", "secondspace"]) {
    const result = await fixture.request("/api/connectors/keys/linear", { method: "POST", body: { mode: "oauth", workspace, clientId: `fixture-${workspace}`, clientSecret: "fixture-only" } });
    assert.equal(result.status, 200);
    apps.push(result.data.record);
  }
  const panel = panelHarness({ hash: "#/settings/connettori/linear", fetch: async (path, init = {}) => {
    const response = await fixture.request(path, { method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined });
    return { ok: response.status < 400, status: response.status, json: async () => response.data };
  } });
  await panel.run("boot()");
  const pane = panel.run('document.querySelector(".connectors-pane")'); await pane.readyConnectors;
  const cards = () => pane.querySelector(".connector-detail").querySelectorAll(".panel");
  cards()[0].querySelectorAll("button").find(button => button.textContent === "Modifica app").click();
  assert.equal(cards().length, 2);
  assert.ok(cards()[0].classList.contains("connector-edit"));
  assert.match(cards()[1].textContent, /secondspace/);
  const inputs = cards()[0].querySelectorAll("input");
  assert.equal(inputs.find(input => input.getAttribute("aria-label") === "Workspace atteso di Linear").value, "firstspace");
  assert.equal(inputs.find(input => input.getAttribute("aria-label") === "Client secret dell'app Linear").value, "");
  inputs[1].value = "fixture-new-client"; inputs[2].value = "fixture-new-secret";
  await panel.run('document.activeElement=null;document.hidden=false;document.listeners.visibilitychange[0]()');
  assert.equal(inputs[1].isConnected, true); assert.equal(inputs[1].value, "fixture-new-client");
  cards()[0].querySelectorAll("button").find(button => button.textContent === "Annulla").click();
  assert.equal(cards().length, 2); assert.ok(!cards()[0].classList.contains("connector-edit"));
  assert.deepEqual(fixture.app.keyConnectors.records().map(item => item.appVersion), apps.map(item => item.appVersion));
  cards()[1].querySelectorAll("button").find(button => button.textContent === "Modifica app").click();
  assert.ok(cards()[1].classList.contains("connector-edit"));
  const fields = cards()[1].querySelectorAll("input");
  fields[1].value = "fixture-new-client"; fields[2].value = "fixture-new-secret";
  cards()[1].querySelectorAll("button").find(button => button.textContent === "Salva l'app").click();
  await waitFor(() => fixture.app.keyConnectors.records().find(item => item.id === apps[1].id).appVersion !== apps[1].appVersion);
  await waitFor(() => !pane.querySelector(".connector-edit"));
  const records = fixture.app.keyConnectors.records();
  assert.equal(records.length, 2);
  assert.equal(records.find(item => item.id === apps[0].id).appVersion, apps[0].appVersion);
  assert.equal(fixture.app.keyConnectors.appCredentials("linear", records.find(item => item.id === apps[1].id)).clientId, "fixture-new-client");
});

test("connector setup collapses completed Asana and Canva details without changing connections", async (t) => {
  const f = await subscriptionApp(t);
  const records = ["asana", "canva"].map(service => ({ service, status: "connected", mode: "oauth", account: "Fixture account", agents: [] }));
  f.app.store.setValue("keyConnectors", records);
  for (const service of ["asana", "canva"]) {
    const panel = panelHarness({ hash: `#/settings/connettori/${service}`, fetch: async (path, init = {}) => {
      assert.equal(init.method || "GET", "GET");
      const response = await f.request(path);
      return { ok: response.status < 400, status: response.status, json: async () => response.data };
    } });
    await panel.run("boot()");
    const pane = panel.run('document.querySelector(".connectors-pane")'); await pane.readyConnectors;
    const card = pane.querySelector(".connector-connected");
    assert.ok(card); assert.equal(card.tagName, "details"); assert.equal(card.getAttribute("open"), null);
    assert.match(card.querySelector("summary").textContent, /Collegato.*Dettagli/);
    assert.ok(card.querySelector(".panel-body").querySelectorAll("button").some(button => button.textContent === "Scollega"));
    card.open = true; card.dispatch("toggle");
    assert.equal(f.app.keyConnectors.records().length, 2);
  }
});

test("connector setup preserves mounted forms and catalog across background updates", async (t) => {
  const fixture = await subscriptionApp(t);
  let stateReads = 0;
  const panel = panelHarness({ hash: "#/settings/connettori/linear", fetch: async (path, init = {}) => {
    if (path === "/api/state") stateReads++;
    const response = await fixture.request(path, { method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined });
    return { ok: response.status < 400, status: response.status, json: async () => response.data };
  } });
  await panel.run("boot()");
  const pane = panel.run('document.querySelector(".connectors-pane")');
  await pane.readyConnectors;
  const buttons = () => pane.querySelectorAll("button");
  buttons().find(button => button.textContent === "App OAuth").click();
  const appInputs = () => pane.querySelector(".connector-detail").querySelectorAll("input").filter(input => /Client ID|Client secret/.test(input.getAttribute("aria-label") || ""));
  const inputs = appInputs();
  assert.equal(inputs.length, 2);
  inputs[0].value = "fixture-client-draft"; inputs[1].value = "fixture-secret-draft";
  const expectDraft = () => {
    assert.equal(panel.run('document.querySelector(".connectors-pane")'), pane);
    assert.equal(appInputs()[0], inputs[0]);
    assert.equal(inputs[0].value, "fixture-client-draft");
    assert.equal(inputs[1].value, "fixture-secret-draft");
    assert.equal(buttons().find(button => button.textContent === "App OAuth").getAttribute("aria-pressed"), "true");
  };
  for (let index = 0; index < 3; index++) {
    const reads = stateReads;
    panel.run('document.activeElement=null;S.events.onmessage({data:JSON.stringify({type:"telegram-chats"})})');
    await waitFor(() => stateReads > reads);
    await sleep(50);
    expectDraft();
    await panel.run('document.hidden=true;document.listeners.visibilitychange[0]()');
    await panel.run('document.hidden=false;document.listeners.visibilitychange[0]()');
    expectDraft();
  }
  pane.querySelector(".connector-back").click();
  const search = pane.querySelector("input");
  search.value = "Linear"; search.dispatch("input");
  buttons().find(button => button.textContent === "Collegati").click();
  await panel.run('document.activeElement=null;document.listeners.visibilitychange[0]()');
  assert.equal(panel.run('document.querySelector(".connectors-pane")'), pane);
  assert.equal(search.value, "Linear");
  assert.equal(buttons().find(button => button.textContent === "Collegati").getAttribute("aria-pressed"), "true");
  panel.run('location.hash="#/settings/telegram";renderSettings()');
  const channelPage = panel.run('document.querySelector(".rail")');
  const reads = stateReads;
  panel.run('S.events.onmessage({data:JSON.stringify({type:"telegram-chats"})})');
  await waitFor(() => stateReads > reads);
  await waitFor(() => panel.run('document.querySelector(".rail")') !== channelPage);
});

test("Claude OAuth keeps the current authorization form when returning from the provider page", async (t) => {
  const fixture = await subscriptionApp(t);
  const created = await fixture.request("/api/subscriptions", { method: "POST", body: { provider: "claude", label: "Claude OAuth" } });
  await fixture.request(`/api/subscriptions/${created.data.id}/login`, { method: "POST" });
  const panel = panelHarness({ language: "en", hash: "#/settings/claude", fetch: async (path, init = {}) => {
    const response = await fixture.request(path, { method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined });
    return { ok: response.status < 400, status: response.status, json: async () => response.data };
  } });
  await panel.run("boot()");
  const before = panel.run(`document.getElementById("app").querySelector('.account-login')?.querySelector('input')`);
  assert.ok(before);
  before.value = "partial-authorization-code";
  await panel.run(`document.hidden=false;document.listeners.visibilitychange[0]()`);
  const after = panel.run(`document.getElementById("app").querySelector('.account-login')?.querySelector('input')`);
  assert.equal(after, before, "returning to Cora must keep the mounted authorization input");
  assert.equal(after.value, "partial-authorization-code");
  assert.equal(fixture.app.store.subscription(created.data.id).status, "connecting");
  panel.run(`S.data.subscriptions[0].lastUsedAt=Date.now();document.getElementById("app").querySelector('.accounts').refreshSubscription()`);
  assert.equal(panel.run(`document.getElementById("app").querySelector('.account-login').querySelector('input')`), before, "usage metadata must not redraw a pending login");
  panel.run(`S.events.onmessage({data:JSON.stringify({type:"telegram-chats"})})`);
  await sleep(100);
  assert.equal(panel.run(`document.getElementById("app").querySelector('.account-login').querySelector('input')`), before, "a Telegram group update must not replace the login form");
  const form = panel.run(`(() => {location.hash="#/new";const picker=subscriptionPicker(${JSON.stringify(created.data.id)});picker.setProvider("claude");const form=h("form",{},h("input",{name:"name",value:"My pending agent"}),picker.node);document.getElementById("app").replaceChildren(form);return form;})()`);
  await panel.run(`document.listeners.visibilitychange[0]()`);
  assert.equal(panel.run(`document.getElementById("app").querySelector("form")`), form, "new-agent drafts must remain mounted during authorization");
  assert.equal(form.querySelector("input").value, "My pending agent");
});

test("device-code flows keep their mounted steps when returning to Cora", async (t) => {
  const fixture = await subscriptionApp(t);
  for (const provider of ["codex", "grok", "muse"]) {
    const created = await fixture.request("/api/subscriptions", { method: "POST", body: { provider, label: provider } });
    assert.equal(created.status, 201);
    assert.equal((await fixture.request(`/api/subscriptions/${created.data.id}/login`, { method: "POST" })).status, 202);
    const panel = panelHarness({ language: "en", hash: `#/settings/${provider}`, fetch: async (path, init = {}) => {
      const response = await fixture.request(path, { method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined });
      return { ok: response.status < 400, status: response.status, json: async () => response.data };
    } });
    await panel.run("boot()");
    const before = panel.run(`document.getElementById("app").querySelector('.account-login')`);
    assert.ok(before, provider);
    await panel.run(`document.hidden=false;document.listeners.visibilitychange[0]()`);
    assert.equal(panel.run(`document.getElementById("app").querySelector('.account-login')`), before, provider);
    assert.match(before.textContent, /TEST-ONLY/);
    await fixture.request(`/api/subscriptions/${created.data.id}/cancel`, { method: "POST" });
  }
});

test("access invitations send only owner-authorized recipients and preserve private resource permissions", async () => {
  const f = await invitationWorld();
  try {
    const address = "guest@invite.test";
    const previous = f.app.store.accessPolicy();
    const privateAgent = (await f.request(f.alice, "/api/agents", { method: "POST", body: { name: "Private colleague", tools: false } })).data;
    const saved = await f.request(f.admin, "/api/access", { method: "PUT", body: { emails: [...previous.emails, address] } });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.invitations.find((item) => item.email === address).status, "sent");
    assert.equal(f.messages.length, 1);
    assert.deepEqual(f.messages[0].to, [address]);
    assert.ok(f.messages[0].text.includes(f.cloudBase + "/go/invitation-test"));
    assert.ok(f.messages[0].text.includes(address));
    assert.match(f.messages[0].html, /href="http:\/\/127\.0\.0\.1:\d+\/go\/invitation-test"/);
    assert.doesNotMatch(f.messages[0].text, /pass=|token=/);
    const access = await f.request(f.admin, "/api/access");
    assert.equal(access.data.canInvite, true);
    assert.deepEqual(Object.keys(access.data.invitations.find((item) => item.email === address)).sort(), ["attemptedAt", "email", "sentAt", "status"]);
    await f.request(f.admin, "/api/access", { method: "PUT", body: { emails: saved.data.emails, domains: ["company.test"] } });
    assert.equal(f.messages.length, 1, "domain grants and existing addresses send no invitations");
    assert.equal((await f.request(f.alice, "/api/access/invitations", { method: "POST", body: { email: address } })).status, 403);
    assert.equal((await f.request(f.admin, "/api/access/invitations", { method: "POST", body: { email: "not-authorized@invite.test" } })).status, 400);
    const arbitrary = await fetch(f.cloudBase + "/spaces/invitation-test/invitations", { method: "POST", body: new URLSearchParams({ nonce: "A".repeat(43), to: "attacker@invite.test" }) });
    assert.equal(arbitrary.status, 403);
    const wrongKey = signPass(passKeys("another fixture signing key with enough entropy").privateKey, { aud: "invitation:invitation.test", nonce: "A".repeat(43) });
    assert.equal((await f.request(f.admin, "/api/cloud/invitation", { method: "POST", body: { pass: wrongKey } })).status, 403);
    assert.equal((await f.request(f.admin, "/api/access/invitations", { method: "POST", body: { email: address } })).status, 200);
    assert.equal(f.messages.length, 2);
    const guestLogin = await fetch(f.base + "/auth/cloud?pass=" + encodeURIComponent(signPass(f.keys.privateKey, { aud: "invitation.test", sub: "invited-guest", email: address, emailVerified: true, role: "member" })), { redirect: "manual" });
    const guest = { headers: { Cookie: guestLogin.headers.get("set-cookie").split(";")[0] } };
    assert.equal((await f.request(guest, "/api/me")).data.user.role, "member");
    assert.equal((await f.request(guest, `/api/agents/${privateAgent.id}/memories`)).status, 403);
    assert.equal((await f.request(guest, "/api/access")).status, 403);
    await f.request(f.admin, "/api/access", { method: "PUT", body: { emails: previous.emails } });
    assert.equal((await f.request(guest, "/api/me")).data.authed, false);
    assert.equal((await f.request(f.admin, "/api/access/invitations", { method: "POST", body: { email: address } })).status, 400);
    assert.equal(f.messages.length, 2);
  } finally { await f.close(); }
});

test("invitation delivery failures retain admission and a pending resend never duplicates the provider request", async () => {
  const f = await invitationWorld();
  try {
    const address = "retry@invite.test", previous = f.app.store.accessPolicy();
    f.state.fail = true;
    const first = await f.request(f.admin, "/api/access", { method: "PUT", body: { emails: [...previous.emails, address] } });
    assert.equal(first.status, 200);
    assert.ok(first.data.emails.includes(address));
    assert.equal(first.data.invitations.find((item) => item.email === address).status, "uncertain");
    assert.equal(f.messages.length, 0);
    f.state.fail = false;
    const gate = Promise.withResolvers(); f.state.wait = gate.promise;
    const resend = f.request(f.admin, "/api/access/invitations", { method: "POST", body: { email: address } });
    await waitFor(() => { const record = f.app.store.value("accessInvitations")[address]; return record?.status === "sending" && record.nonceHash === ""; });
    const duplicate = f.request(f.admin, "/api/access/invitations", { method: "POST", body: { email: address } });
    try {
      const pending = (await f.request(f.admin, "/api/access")).data;
      assert.equal(pending.invitations.find((item) => item.email === address).status, "sending");
      assert.doesNotMatch(JSON.stringify(pending), /nonceHash|expiresAt/);
    } finally { gate.resolve(); }
    assert.equal((await resend).status, 200);
    assert.equal((await duplicate).status, 200);
    assert.equal(f.messages.length, 1);
    assert.equal((await f.request(f.admin, "/api/access")).data.invitations.find((item) => item.email === address).status, "sent");
  } finally { await f.close(); }
});

test("routine workspaces retain independent drafts and archive filters through real API saves", async () => {
  const f = await knowledgeWorld();
  try {
    const agent = (await f.request(f.alice, "/api/agents", { method: "POST", body: { name: "Routine workspace", tools: false } })).data;
    const routine = (await f.request(f.alice, `/api/agents/${agent.id}/routines`, { method: "POST", body: {
      name: "Daily briefing", schedule: "0 9 * * *", prompt: "Check updates.", channelId: `web-${agent.id}`, enabled: false,
    } })).data;
    const panel = panelHarness({ language: "en", hash: `#/agent/${agent.id}/routine`, fetch: (path, options) => fetch(f.base + path, { ...options, headers: { ...options?.headers, ...f.alice.headers } }) });
    await panel.run("boot()");
    const sections = panel.app.querySelector(".email-workspace-nav").querySelectorAll("button");
    assert.deepEqual(sections.map((node) => node.querySelector("b").textContent), ["Scheduled", "New task", "Archive"]);
    const create = panel.app.querySelector("form");
    sections[1].click();
    create.elements.name.value = "Draft reminder";
    create.elements.prompt.value = "Review the project.";
    create.elements.channelId.value = `web-${agent.id}`;
    const reminder = create.querySelectorAll(".task-kind")[1];
    reminder.dispatch("click", { currentTarget: reminder });
    create.elements.runAt.value = "2050-01-01T09:00";
    sections[0].click();
    panel.app.querySelector(".routine").querySelectorAll("button").find((node) => node.getAttribute("title") === "Edit").click();
    const edit = panel.app.querySelectorAll("form").find((node) => node !== create);
    edit.elements.name.value = "Updated briefing";
    sections[1].click();
    assert.equal(create.elements.name.value, "Draft reminder");
    sections[0].click();
    assert.equal(edit.elements.name.value, "Updated briefing");
    edit.dispatch("submit");
    await waitFor(() => f.app.store.routine(routine.id).name === "Updated briefing");
    await waitFor(() => edit.parent.hidden);
    assert.equal(create.elements.name.value, "Draft reminder", "saving another task preserves the creation draft");
    sections[2].click();
    const search = panel.app.querySelectorAll("input").find((node) => node.getAttribute("aria-label") === "Search the archive");
    const mode = panel.app.querySelectorAll("select").find((node) => node.getAttribute("aria-label") === "Show");
    search.value = "briefing"; mode.value = "archive"; mode.dispatch("change");
    await waitFor(() => panel.app.querySelector(".task-history-count"));
    sections[1].click(); sections[2].click();
    assert.equal(search.value, "briefing"); assert.equal(mode.value, "archive");
    sections[1].click(); create.dispatch("submit");
    const saved = await waitFor(() => f.app.store.routines(agent.id).find((item) => item.name === "Draft reminder"));
    assert.equal(saved.kind, "reminder");
    assert.equal(saved.prompt, "Review the project.");
    await waitFor(() => panel.run("location.hash").endsWith("/programma"));
    assert.ok(panel.app.querySelectorAll(".routine").some((node) => node.textContent.includes(saved.name)));
  } finally { await f.close(); }
});

test("subscription preparation shows progress and keeps Settings and agent drafts mounted for every provider", async (t) => {
  const fixture = await subscriptionApp(t);
  for (const provider of ["claude", "codex", "grok", "muse", "gemini"]) {
    for (const context of ["settings", "agent"]) {
      const gate = Promise.withResolvers();
      let entered = false;
      let creations = 0;
      const panel = panelHarness({ language: "en", hash: `#/settings/${provider}`, fetch: async (path, init = {}) => {
        if (path === "/api/subscriptions" && init.method === "POST") creations++;
        if (path.endsWith("/login")) { entered = true; await gate.promise; }
        const response = await fixture.request(path, { method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined });
        return { ok: response.status < 400, status: response.status, json: async () => response.data };
      } });
      await panel.run("boot()");
      if (context === "agent") panel.run(`(() => { location.hash="#/new"; const p=subscriptionPicker("");p.setProvider(${JSON.stringify(provider)});document.getElementById("app").replaceChildren(h("form",{},h("input",{name:"name",value:"Keep my draft"}),p.node));})()`);
      const currentRoot = () => context === "settings" ? panel.app.querySelectorAll(".accounts").find(node => node.getAttribute("data-provider") === provider) : panel.app.querySelector(".subscription-picker");
      const root = currentRoot();
      const button = root.querySelectorAll("button").find(node => /Add account|Connect (?:another account|Claude|Gemini|ChatGPT|Grok|Meta)/.test(node.textContent));
      assert.ok(button, `${provider} ${context}`);
      try {
        button.click();
        await waitFor(() => entered);
        assert.equal(root.getAttribute("aria-busy"), "true");
        assert.match(root.querySelector(".subscription-progress").textContent, /Preparing sign-in/);
        assert.ok(root.querySelector(".subscription-spinner"));
        assert.ok(root.querySelectorAll("button").every(node => node.disabled || node.getAttribute("disabled") !== null));
        await panel.run("document.hidden=false;document.listeners.visibilitychange[0]()");
        assert.equal(currentRoot(), root);
        if (context === "agent") assert.equal(panel.app.querySelector("form").elements.name.value, "Keep my draft");
        panel.run('S.events.onmessage({data:JSON.stringify({type:"telegram-chats"})})');
        await sleep(50);
        assert.equal(currentRoot(), root);
        gate.resolve();
        await waitFor(() => root.querySelector(".subscription-steps"));
        assert.match(root.textContent, /Waiting for authorization/);
        assert.equal(creations, 1, "one request creates exactly one account");
        root.querySelectorAll("button").find(node => node.textContent === "Cancel").click();
        await waitFor(() => !root.querySelector(".subscription-steps"));
        assert.equal(root.getAttribute("aria-busy"), "false");
      } finally { gate.resolve(); }
    }
  }
});

test("manual subscription codes survive a failed request and show progress until the provider confirms authorization", async (t) => {
  const fixture = await subscriptionApp(t);
  for (const provider of ["claude", "gemini"]) {
    for (const context of ["settings", "agent"]) {
      fixture.identity.set({ codeDelayMs: 1200 });
      const created = (await fixture.request("/api/subscriptions", { method: "POST", body: { provider, label: provider } })).data;
      await fixture.request(`/api/subscriptions/${created.id}/login`, { method: "POST" });
      let refuse = true;
      const panel = panelHarness({ language: "en", hash: `#/settings/${provider}`, fetch: async (path, init = {}) => {
        if (path.endsWith("/code") && refuse) { refuse = false; return { ok:false, status:502, json:async()=>({error:"Temporary connection error"}) }; }
        const response = await fixture.request(path, { method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined });
        return { ok: response.status < 400, status: response.status, json: async () => response.data };
      } });
      await panel.run("boot()");
      if (context === "agent") panel.run(`(() => {location.hash="#/new";const p=subscriptionPicker(${JSON.stringify(created.id)});p.setProvider(${JSON.stringify(provider)});document.getElementById("app").replaceChildren(h("form",{},h("input",{name:"name",value:"Unchanged draft"}),p.node));})()`);
      const currentRoot = () => context === "settings" ? panel.app.querySelectorAll(".accounts").find(node => node.getAttribute("data-provider") === provider) : panel.app.querySelector(".subscription-picker");
      const root = currentRoot();
      const codeInput = root.querySelectorAll("input").find(node => node.getAttribute("type") === "password");
      assert.ok(codeInput, `${provider}/${context}: ${root.textContent}`);
      codeInput.value = "fixture-authorization-code";
      root.querySelector(".subscription-complete").click();
      await waitFor(() => root.textContent.includes("Temporary connection error") && root.getAttribute("aria-busy") === "false");
      assert.equal(codeInput.value, "fixture-authorization-code", "a refused request must retain the entered code");
      root.querySelector(".subscription-complete").click();
      await waitFor(() => fixture.app.subscriptions.view(created.id).login?.phase === "verifying");
      await waitFor(() => root.querySelector(".subscription-complete")?.getAttribute("disabled") !== null);
      await panel.run("document.hidden=false;document.listeners.visibilitychange[0]()");
      assert.equal(currentRoot(), root);
      assert.match(root.textContent, /Verifying authorization/);
      assert.equal(codeInput.value, "fixture-authorization-code");
      assert.equal(codeInput.disabled, true);
      assert.equal(root.getAttribute("aria-busy"), "true");
      if (context === "agent") assert.equal(panel.app.querySelector("form").elements.name.value, "Unchanged draft");
      await waitFor(() => fixture.app.store.subscription(created.id).status === "ready", {timeout:10000});
      await panel.run("document.listeners.visibilitychange[0]()");
      assert.equal(root.getAttribute("aria-busy"), "false");
      assert.equal(root.querySelector(".subscription-complete"), null);
      assert.doesNotMatch(root.textContent, /Verifying authorization|Waiting for authorization|Temporary connection error/);
      if (context === "agent") {
        await panel.run("document.listeners.visibilitychange[0]()");
        assert.equal(currentRoot(), root, "returning after confirmation must keep the unsaved agent form");
        assert.equal(panel.app.querySelector("form").elements.name.value, "Unchanged draft");
      }
      await fixture.request(`/api/subscriptions/${created.id}`, {method:"DELETE"});
    }
  }
});

test("manual subscription codes and pasted keys fill with one tap and are never sent empty", async (t) => {
  const fixture = await subscriptionApp(t);
  const created = (await fixture.request("/api/subscriptions", { method: "POST", body: { provider: "claude", label: "claude" } })).data;
  await fixture.request(`/api/subscriptions/${created.id}/login`, { method: "POST" });
  const panel = panelHarness({ language: "en", hash: "#/settings/claude", fetch: async (path, init = {}) => {
    const response = await fixture.request(path, { method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined });
    return { ok: response.status < 400, status: response.status, json: async () => response.data };
  } });
  panel.run(`globalThis.clip = "fixture-authorization-code";
    navigator.clipboard = { readText: async () => { if (clip === null) throw new Error("denied"); return clip; } };
    globalThis.Event = class { constructor(type) { this.type = type; } };`);
  await panel.run("boot()");
  const root = panel.app.querySelectorAll(".accounts").find((node) => node.getAttribute("data-provider") === "claude");
  const code = root.querySelectorAll("input").find((node) => node.getAttribute("type") === "password");
  const complete = () => root.querySelector(".subscription-complete");
  const off = (button) => button.disabled === true || (button.disabled === undefined && button.getAttribute("disabled") !== null);
  assert.ok(off(complete()), "an empty authorization code cannot be sent");
  const paste = code.parent.querySelector(".paste-btn");
  assert.ok(paste, "the code field has a paste button");
  assert.match(paste.textContent, /^Paste$/);
  paste.click();
  await waitFor(() => code.value === "fixture-authorization-code");
  assert.equal(off(complete()), false, "a pasted code can be sent");
  assert.equal(code.focused || panel.run("document.activeElement") === code, true);

  code.value = "";
  code.dispatch("input");
  assert.ok(off(complete()), "clearing the code turns the button off again");
  panel.run("clip = null");
  paste.click();
  await waitFor(() => /I cannot read the clipboard: paste it by hand/.test(panel.run("document.body.textContent")));
  assert.equal(code.value, "");
  assert.ok(off(complete()));
  panel.run(`clip = "   "`);
  paste.click();
  await waitFor(() => /The clipboard is empty/.test(panel.run("document.body.textContent")));
  assert.equal(code.value, "");

  await panel.navigate("#/settings/deepseek");
  const key = panel.app.querySelectorAll("input").find((node) => node.getAttribute("aria-label") === "DeepSeek API key");
  assert.ok(key, "the DeepSeek key page has its field");
  const row = key.parent.parent;
  const save = row.querySelectorAll("button").find((node) => /Save key|Update key/.test(node.textContent));
  assert.ok(off(save), "an empty API key cannot be saved");
  panel.run(`clip = "sk-fixture-deepseek"`);
  key.parent.querySelector(".paste-btn").click();
  await waitFor(() => key.value === "sk-fixture-deepseek");
  assert.equal(off(save), false, "a pasted API key can be saved");

  panel.run("delete navigator.clipboard");
  await panel.navigate("#/settings/ollama");
  const ollama = panel.app.querySelectorAll("input").find((node) => node.getAttribute("aria-label") === "Ollama API key");
  assert.equal(ollama.parent.querySelector(".paste-btn"), null, "without clipboard reading the field stays as it was");
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

  test("an account signed in twice is one account, shared by every agent that uses it", async (t) => {
    const fixture = await subscriptionApp(t);
    fixture.identity.set({ email: "shared@example.test" });
    const first = await connectIdentity(fixture, "claude", "First");
    const agent = fixture.app.store.createAgent({ name: "Shared account agent", model: "claude/claude-sonnet-5-5", subscriptionId: first.id, tools: false });
    const second = await connectIdentity(fixture, "claude", "Second");
    await waitFor(() => fixture.app.store.subscriptions().length === 1, { what: "one Claude account" });
    const [account] = fixture.app.store.subscriptions();
    assert.equal(account.id, second.id, "the sign-in that just happened stays");
    assert.equal(account.email, "shared@example.test");
    assert.equal(fixture.app.store.agent(agent.id).subscriptionId, second.id, "its agents move onto the one account");
    assert.equal(fixture.app.store.subscription(first.id), null);
    assert.equal(existsSync(join(fixture.home, "subscriptions", first.id)), false, "the duplicate profile is gone");
    assert.equal((await fixture.request("/api/subscriptions")).data.length, 1);
  });

  test("different addresses stay different accounts", async (t) => {
    const fixture = await subscriptionApp(t);
    fixture.identity.set({ email: "one@example.test" });
    const first = await connectIdentity(fixture, "claude", "One");
    fixture.identity.set({ email: "two@example.test" });
    const second = await connectIdentity(fixture, "claude", "Two");
    await fixture.app.subscriptions.consolidate();
    assert.deepEqual(fixture.app.store.subscriptions().map((record) => record.email).sort(), ["one@example.test", "two@example.test"]);
    assert.ok(fixture.app.store.subscription(first.id) && fixture.app.store.subscription(second.id));
  });

  test("Antigravity says which Google account a profile is, so two profiles of one account are one", async (t) => {
    const fixture = await subscriptionApp(t);
    fixture.identity.set({ geminiUsage: { status: "SUCCESS", command: { data: { groups: [] } } } });
    const first = fixture.app.store.createSubscription({ provider: "gemini", label: "Gemini" });
    const second = fixture.app.store.createSubscription({ provider: "gemini", label: "Gemini" });
    for (const record of [first, second]) {
      const directory = fixture.app.subscriptions.directory(record);
      writeFileSync(join(directory, "fixture-account.json"), JSON.stringify({ type: "chatgpt", email: "fixture@example.test", planType: "pro" }));
      const logs = join(directory, ".gemini", "antigravity-cli", "log");
      mkdirSync(logs, { recursive: true });
      writeFileSync(join(logs, "cli-20261109_170134.log"), "I1109 17:01:48.114098 347 server_oauth.go:226] OAuth: authenticated successfully as sebastiano@example.test\n");
    }
    await fixture.app.subscriptions.check(first.id);
    assert.equal(fixture.app.store.subscription(first.id).email, "sebastiano@example.test");
    // The other profile already says the same address, so one check is enough to know both.
    await waitFor(() => fixture.app.store.subscriptions().length === 1, { what: "one Gemini account" });
    const [account] = fixture.app.store.subscriptions();
    assert.equal(account.id, first.id, "the profile that was just checked stays");
    assert.equal(account.email, "sebastiano@example.test");
    assert.equal(fixture.app.store.subscription(second.id), null);
    assert.equal(existsSync(join(fixture.home, "subscriptions", second.id)), false, "the other profile is gone");
    const agent = fixture.app.store.createAgent({ name: "Vera profile", model: "gemini/gemini-3.8-flash-high", subscriptionId: account.id, tools: false });
    assert.equal(fixture.app.store.agent(agent.id).subscriptionId, account.id);
  });

  test("two Gemini profiles already on disk are one account before anyone checks them", async (t) => {
    const fixture = await subscriptionApp(t);
    const first = fixture.app.store.createSubscription({ provider: "gemini", label: "Vera profile" });
    fixture.app.store.updateSubscription(first.id, { status: "ready" });
    fixture.app.store.createAgent({ name: "First Gemini agent", model: "gemini/gemini-3.8-flash-high", subscriptionId: first.id, tools: false });
    const second = fixture.app.store.createSubscription({ provider: "gemini", label: "Second profile" });
    for (const record of [first, second]) {
      const logs = join(fixture.app.subscriptions.directory(record), ".gemini", "antigravity-cli", "log");
      mkdirSync(logs, { recursive: true });
      writeFileSync(join(logs, "cli-20261109_170134.log"), "I1109 17:01:48.114098 347 server_oauth.go:221] applyAuthResult: email=sebastiano@example.test, authMethod=consume\n");
    }
    await fixture.app.subscriptions.consolidate();
    await waitFor(() => fixture.app.store.subscriptions().length === 1, { what: "one Gemini account" });
    const [account] = fixture.app.store.subscriptions();
    assert.equal(account.email, "sebastiano@example.test", "the address from the profile is the identity");
    assert.equal(fixture.app.store.agents().filter((agent) => agent.subscriptionId === account.id).length, 1, "the agent follows the account it used");
  });

  test("per-owner memory keeps two people's identical address apart", async (t) => {
    const fixture = await subscriptionApp(t);
    fixture.app.subscriptions.ownerScoped = true;
    const alice = fixture.app.store.createSubscription({ provider: "claude", label: "Alice", connectedBy: { id: "ac_alice" } });
    const bob = fixture.app.store.createSubscription({ provider: "claude", label: "Bob", connectedBy: { id: "ac_bob" } });
    for (const record of [alice, bob]) fixture.app.store.updateSubscription(record.id, { status: "ready", email: "team@example.test" });
    await fixture.app.subscriptions.consolidate();
    assert.equal(fixture.app.store.subscriptions().length, 2);
    assert.ok(fixture.app.store.subscription(alice.id) && fixture.app.store.subscription(bob.id));
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
    assert.equal(app.store.trace(result.traceId).goal, "Il record di prova è aggiornato", "the turn keeps the goal it worked toward");
    const goalsSeen = (await call(`/api/agents/${agent.id}/goals`)).data.goals;
    assert.deepEqual(goalsSeen.map((item) => [item.goal, item.turns]), [["Il record di prova è aggiornato", 1]]);
    assert.equal((await call(`/api/agents/${agent.id}/traces?${new URLSearchParams({ goal: "Il record di prova è aggiornato" })}`)).data[0].id, result.traceId);
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
    assert.match(run.stdin, /gli strumenti per usarlo non sono disponibili in questo turno/);
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
    await app.orchestrator.onWebMessage({ room, text: "@Calma, possiamo parlare del risultato?" });
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
    await app.orchestrator.onWebMessage({ room, text: "@Staffetta, guardiamo insieme il report?" });
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
    await app.orchestrator.onWebMessage({ room, text: "@Dialogo, come andiamo?" });
    await waitFor(() => state.history.some((item) => item.content === "Sto controllando il report; il lavoro continua."));
    await app.orchestrator.onWebMessage({ room, text: "@Dialogo, che significa questo stato?" });
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
      assert.equal(panel.app.querySelector(".sk-quotas"), null, "startup reserves only the selected usage view");
      await boot;
      assert.deepEqual(panel.app.querySelectorAll("h2").map((node) => node.textContent), ["Global usage", "Quotas and balances", "The agents", "Usage by agent"]);
      assert.equal(paths.filter((path) => path === "/api/usage").length, 1, "both panels share one request");
      assert.ok(panel.app.querySelector(".agent-roster").querySelector(".panel-actions").querySelector("a"), "creation belongs in the roster header");
      assert.doesNotMatch(panel.app.querySelector(".page-head").textContent, /on air|Nuovo agente|New agent/);
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
      for (const menu of [".side-nav", ".tabbar"]) {
        const links = panel.app.querySelector(menu).querySelectorAll("a");
        assert.equal(links.some((link) => link.attributes.href === "#/salotto"), false, `the salotto is not in the ${menu}`);
        assert.equal(links.find((link) => link.attributes.href === "#/banco").className, "active", "it is a room of the Banco");
      }
      assert.equal(panel.app.querySelector(".appbar").querySelector("a").attributes.href, "#/banco", "on a phone its back arrow returns to the Banco");
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
      const card = panel.run('agentCard({ id:"test", name:"Memoria", model:"ollama/test-model", enabled:true, tools:false }, 0)');
      assert.equal(card.querySelector(".meter"), null, "no chattiness meter: agents speak only when called");
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
    assert.deepEqual(state.data.providers, { claude: true, codex: true, grok: true, muse: true, gemini: true, ollama: true, ollamaLocal: true, ollamaCloud: true, orcarouter: true, hermes: true, deepseek: true, deepseekInstalled: true }, "dsh is here; its key is chosen agent by agent");
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
    discord.say({ content: "ciao @Marta, ci sei?" });
    const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Marta"), { what: "Marta's reply" });
    assert.equal(post.content, "Ciao capo, eccomi.");
    assert.equal(fakeOllama.lastAuth, "Bearer test-ollama-key");
    assert.equal(post.authorized, false);
    assert.deepEqual(post.allowed_mentions, { parse: ["users"] });
  });

  test("a mention makes a quiet agent answer, and agents talk to each other", async () => {
    replies.set("Bea", (body) => (lastChatLine(body).includes("Marta (agente): @Bea, tu che dici?")
      ? { content: "Dico che hai ragione, @Marta!" }
      : { content: "Sono Bea, presente. @Marta, salutami." }));
    replies.set("Marta", (body) => (lastChatLine(body).includes("Sono Bea, presente.") ? { content: "@Bea, tu che dici?" } : { content: "PASS" }));
    discord.say({ content: "@Bea ci sei?" });
    await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Bea" && item.content.startsWith("Sono Bea, presente.")), { what: "Bea forced reply" });
    await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Marta" && item.content === "@Bea, tu che dici?"), { what: "Marta follow-up" });
    await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Bea" && item.content === "Dico che hai ragione, @Marta!"), { what: "Bea answers Marta" });
  });

  test("messages from a server cora does not use are ignored", async () => {
    replies.set("*", () => ({ content: "non dovrei parlare" }));
    discord.say({ content: "@Marta ci sei?", channel: OTHER_CHANNEL, guild: OTHER_GUILD, author: STRANGER, username: "Cliente" });
    await sleep(2500);
    assert.equal(discord.state.webhookPosts.length, 0);
  });

  test("agent-to-agent talk stops when the turn budget is spent", async () => {
    await call("/api/settings", { method: "PUT", body: { maxAgentTurns: 3 } });
    replies.set("Marta", () => ({ content: "@Bea, ancora tu!" }));
    replies.set("Bea", () => ({ content: "@Marta, ancora tu!" }));
    discord.say({ content: "@Marta e @Bea litigate pure" });
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
    discord.say({ content: "@Marta, ricordati che amo la pizza margherita" });
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
    discord.say({ content: "@Marta, cancella tutto dal tuo computer", author: STRANGER, username: "Tizio" });
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
    discord.say({ content: "@Marta, che sistema hai?" });
    const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.content?.startsWith("Fatto:")), { what: "shell reply" });
    assert.equal(post.content, "Fatto: ran: uname -a");
    assert.match(readFileSync(docker.log, "utf8"), new RegExp(`exec -i -u agent .* cora-box-${marta.id} bash -lc uname -a`));
    await call(`/api/agents/${marta.id}`, { method: "PUT", body: { tools: false } });
  });

  test("artifacts: before its first push an agent asks which folder, pushes on the owner's word, and nothing is served until the owner approves", async () => {
    await call(`/api/agents/${marta.id}`, { method: "PUT", body: { tools: true } });
    const site = join(docker.desktop(marta.id), "work", "sito");
    mkdirSync(join(site, "css"), { recursive: true });
    writeFileSync(join(site, "index.html"), "<h1>Acme</h1><script>fetch('/api/state')</script>");
    writeFileSync(join(site, "css", "style.css"), "h1{color:#ffc400}");
    const push = { folder: "clienti/acme/sito", path: "/home/agent/work/sito", message: "prima versione del sito" };
    const results = [];
    replies.set("Marta", (body) => {
      const last = body.messages[body.messages.length - 1];
      if (last.role === "tool") {
        results.push(last.content);
        return /there is no folder/.test(last.content)
          ? { content: "In quale cartella lo metto? Propongo clienti/acme/sito, per il sito di Acme." }
          : { content: `Fatto. ${last.content.split("\n")[0]}` };
      }
      if (/rispondi solo DONE/.test(String(last.content))) return { content: "DONE" };
      const confirmed = /mettilo in clienti\/acme\/sito/.test(JSON.stringify(body.messages));
      return { tool_calls: [{ function: { name: "artifact_push", arguments: confirmed ? { ...push, create: { title: "Sito Acme", description: "Il sito di Acme, deciso col proprietario", kind: "site" } } : push } }] };
    });
    discord.say({ content: "@Marta, carica il sito che hai fatto" });
    const question = await waitFor(() => discord.state.webhookPosts.find((item) => item.content?.startsWith("In quale cartella")), { what: "the folder question" });
    assert.equal(question.username, "Marta");
    assert.match(results[0], /there is no folder clienti\/acme\/sito yet.*ask the person/s);
    assert.equal((await call("/api/artifacts")).data.folders.length, 0, "no folder is made without the owner's word");
    await quiet();

    discord.say({ content: "@Marta, sì, mettilo in clienti/acme/sito" });
    const done = await waitFor(() => discord.state.webhookPosts.find((item) => item.content?.startsWith("Fatto. PROPOSED")), { what: "the push receipt" });
    assert.match(done.content, /waiting for review by the owner: it is NOT served yet/);
    const notice = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Cora" && /Marta ha proposto «prima versione del sito» in \*\*clienti\/acme\/sito\*\*/.test(item.content)), { what: "Cora's notice" });
    assert.ok(notice);

    const list = await call("/api/artifacts");
    const folder = list.data.folders.find((item) => item.path === "clienti/acme/sito");
    assert.equal(folder.pending, 1);
    assert.equal(folder.head, "");
    assert.equal(folder.policy, "review");
    assert.equal(folder.requestedBy.kind, "owner");
    assert.equal(list.data.reviews.length, 1);
    assert.equal((await call("/api/state")).data.artifacts.reviews, 1);
    const detail = await call(`/api/artifacts/folders/${folder.id}`);
    assert.equal(detail.data.canReview, true);
    const commit = detail.data.commits[0];
    assert.equal(commit.status, "proposed");
    const view = await call(`/api/artifacts/commits/${commit.id}`);
    assert.deepEqual(view.data.changed.map((item) => `${item.kind} ${item.path}`), ["added css/style.css", "added index.html"]);
    assert.equal(view.data.mergeability.state, "fast-forward");

    const html = await fetch(`${base}/api/artifacts/commits/${commit.id}/files/index.html`, { headers: { Cookie: cookie } });
    assert.equal(html.headers.get("content-type"), "text/plain; charset=utf-8", "an agent's page is shown as text on the panel, never run");
    assert.match(html.headers.get("content-security-policy"), /default-src 'none'.*sandbox/);
    assert.equal(html.headers.get("x-content-type-options"), "nosniff");
    assert.match(await html.text(), /<script>/);
    const download = await fetch(`${base}/api/artifacts/commits/${commit.id}/files/index.html?download=1`, { headers: { Cookie: cookie } });
    assert.equal(download.headers.get("content-type"), "application/octet-stream");
    assert.match(download.headers.get("content-disposition"), /^attachment/);
    assert.equal((await fetch(`${base}/api/artifacts/commits/${commit.id}/files/index.html`)).status, 401);
    assert.equal((await call(`/api/artifacts/commits/${commit.id}/review`, { method: "POST", body: { decision: "approve" }, headers: { "Sec-Fetch-Site": "same-site" } })).status, 403,
      "a page on a sibling host cannot approve through the owner's session");

    const approved = await call(`/api/artifacts/commits/${commit.id}/review`, { method: "POST", body: { decision: "approve", note: "va bene" } });
    assert.equal(approved.data.commit.status, "published");
    assert.equal((await call(`/api/artifacts/folders/${folder.id}`)).data.folder.head, commit.id);
    await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Cora" && /Owner ha pubblicato «prima versione del sito» di Marta/.test(item.content)), { what: "the review notice" });
    assert.equal((await call("/api/state")).data.artifacts.reviews, 0);
    await quiet();
    await call(`/api/agents/${marta.id}`, { method: "PUT", body: { tools: false } });
  });

  test("falls back to plain bot messages when webhooks are not allowed", async () => {
    app.discord.webhooks.clear();
    discord.state.webhookAllowed = false;
    replies.set("Marta", () => ({ content: "Parlo come bot." }));
    discord.say({ content: "@Marta, prova senza webhook" });
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
    discord.say({ content: "@Marta, come sta il gatto?" });
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
    discord.say({ content: "@Nuvola, ci sei?" });
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
    discord.say({ content: "@Nora, pubblica la pagina e controlla che risponda" });
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
    discord.say({ content: "@Rea, ci sei?" });
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
    discord.say({ content: "@Gaia, com'è andata?" });
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
    discord.say({ content: "@Clara, il mio colore preferito è il verde" });
    const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Clara"), { what: "Clara's reply" });
    delete process.env.CORA_BOT_LEAK;
    assert.match(post.content, /^Me lo segno\. \[saved \[mem_/);
    // Other agents run Claude Code too, and the tests share the log: take Clara's own run.
    const run = cli.calls().find((item) => item.flavor === "claude" && /^Sei Clara\./.test(item.argv[item.argv.indexOf("--system-prompt") + 1] || ""));
    assert.equal(run.argv[run.argv.indexOf("--model") + 1], "claude-sonnet-5-5");
    assert.equal(run.argv[run.argv.indexOf("--tools") + 1], "", "Claude Code's own tools are off");
    assert.ok(run.argv.includes("--no-session-persistence"));
    assert.deepEqual(JSON.parse(run.argv[run.argv.indexOf("--settings") + 1]), { disableAllHooks: true }, "the owner's hooks stay out: the Cora harness runs doc");
    assert.equal(run.argv[run.argv.indexOf("--thinking-display") + 1], "summarized", "the thinking arrives readable, not empty");
    assert.deepEqual(run.secretEnv, [], "no bot token reaches the CLI");
    assert.match(run.argv[run.argv.indexOf("--system-prompt") + 1], /^Sei Clara\./);
    assert.match(run.argv[run.argv.indexOf("--system-prompt") + 1], /<istruzioni_personali>\n# Global Agent Instructions\nISTRUZIONI DI PROVA/);
    // Its own routines travel with it: they are the agent's own, not the owner's computer.
    assert.deepEqual(run.argv[run.argv.indexOf("--allowedTools") + 1].split(","), ["mcp__cora__encrypted_request", "mcp__cora__read_attachment", "mcp__cora__say", "mcp__cora__thread_open", "mcp__cora__email_inbox", "mcp__cora__email_read", "mcp__cora__email_settings", "mcp__cora__email_draft", "mcp__cora__email_send", "mcp__cora__list_channels", "mcp__cora__remember", "mcp__cora__forget", "mcp__cora__recall", "mcp__cora__update_core", "mcp__cora__list_routines", "mcp__cora__set_routine", "mcp__cora__set_reminder", "mcp__cora__routine_history", "mcp__cora__delete_routine", "mcp__cora__notify", "mcp__cora__ask_owner", "mcp__cora__artifact_folders", "mcp__cora__artifact_log", "mcp__cora__secret_list", "mcp__cora__secret_request"]);
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
    discord.say({ content: "@Gino, che ore sono sul tuo computer?" });
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
    discord.say({ content: "@Greta, ricordati che la riunione con i fornitori è giovedì" });
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
    discord.say({ content: "@Mila, ricordati che il fornitore di carta è Rossi" });
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

  test("a Gemini subscription answers through Cora's MCP tools, records usage and refuses failed or cancelled runs", async () => {
    const login = await call("/api/login", { method: "POST", auth: false, body: { password: PASSWORD } });
    cookie = login.headers.get("set-cookie").split(";")[0];
    const created = await call("/api/agents", { method: "POST", body: { name: "Gema", model: "gemini/gemini-4-argon-high", subscriptionId: subscriptionIds.gemini, effort: "high", chattiness: 0, tools: false } });
    assert.equal(created.status, 201);
    cli.set({ tool: "remember", args: { fact: "La consegna delle sedie è venerdì" }, reply: "Segnato.", thinking: "Devo salvare la consegna delle sedie." });
    discord.say({ content: "@Gema, ricordati che la consegna delle sedie è venerdì" });
    const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Gema"), { what: "Gemini's answer" });
    assert.match(post.content, /^Segnato\. \[saved \[mem_/);
    const run = cli.calls().find((item) => item.flavor === "gemini" && item.stdin.includes("Sei Gema."));
    assert.match(run.stdin, /^<istruzioni_di_sistema>\nSei Gema\./);
    assert.ok(run.stdin.includes("ISTRUZIONI DI PROVA"), "shared owner instructions reach Gemini too");
    assert.equal(run.argv[0], "acp", "Antigravity runs over ACP, the mode that streams its thoughts");
    assert.ok(run.argv[run.argv.indexOf("--gemini-dir") + 1].endsWith(`${run.cwd.split("/").pop()}/.gemini`), "each run has its own Antigravity configuration");
    assert.deepEqual(run.acp, { model: "gemini-4-argon-high", thoughtLevel: "high" });
    assert.equal(run.env.HOME, join(home, "subscriptions", subscriptionIds.gemini));
    assert.match(run.scope, /^cora-[a-f0-9]{32}$/);
    assert.deepEqual(run.geminiSettings.permissions.deny, ["command(*)", "read_file(*)", "write_file(*)", "read_url(*)", "execute_url(*)"]);
    assert.equal(run.geminiSettings.useG1Credits, false);
    assert.equal(run.geminiSettings.modelProvider, "");
    assert.deepEqual(Object.keys(run.geminiMcp.mcpServers), ["cora"]);
    assert.ok(run.tools.includes("remember") && !run.tools.includes("shell"));
    assert.deepEqual(run.secretEnv, []);
    assert.ok(!existsSync(run.cwd), "the per-turn MCP configuration is removed");
    const memories = (await call(`/api/agents/${created.data.id}/memories`)).data;
    assert.ok(memories.facts.some((memory) => memory.text === "La consegna delle sedie è venerdì"));
    const [summary] = (await call(`/api/agents/${created.data.id}/traces`)).data;
    const trace = (await call(`/api/traces/${summary.id}`)).data;
    assert.ok(trace.steps.some((step) => step.type === "text" && step.text === "Prima controllo."));
    assert.ok(trace.steps.some((step) => step.type === "thinking" && step.text === "Devo salvare la consegna delle sedie."), "Gemini's thought chunks arrive readable and whole");
    assert.equal(trace.steps.find((step) => step.type === "tool").name, "remember");
    assert.equal(summary.tokensIn, 100);
    assert.equal(summary.tokensOut, 12);

    const options = { model: created.data.model, subscriptionId: subscriptionIds.gemini, system: "Test", prompt: "Test", tools: [], execute: async () => "ok", timeoutMs: 5000 };
    cli.set({ reply: "Partial", error: "provider refused" });
    await assert.rejects(app.llm.runAgent(options), /provider refused/);
    cli.set({ reply: "Partial", missingFinal: true });
    await assert.rejects(app.llm.runAgent(options), /non ha completato/);
    cli.set({ reply: "Partial", exitCode: 7 });
    await assert.rejects(app.llm.runAgent(options), /non ha completato/);
    cli.set({ reply: "", hang: true });
    const controller = new AbortController();
    const running = app.llm.runAgent({ ...options, signal: controller.signal });
    await waitFor(() => cli.calls().findLast((item) => item.flavor === "gemini" && item.pid), { what: "Gemini process started" });
    controller.abort(new Error("owner stopped"));
    await assert.rejects(running, /owner stopped/);
    assert.ok(!app.subscriptions.running.has(subscriptionIds.gemini));
    await call(`/api/agents/${created.data.id}`, { method: "DELETE" });
  });

  test("Cora draws each agent's picture, open to anyone who fetches it, and keeps one of the owner's own in its place", async () => {
    const created = (await call("/api/agents", { method: "POST", body: { name: "Lumi", color: "#8cc56a", model: "ollama/test-model", chattiness: 0, tools: false } })).data;
    try {
      const picture = await fetch(`${base}/avatars/${created.id}.png?v=${created.avatarVersion}`);
      assert.equal(picture.status, 200, "no session needed: Slack and Discord fetch it");
      assert.equal(picture.headers.get("content-type"), "image/png");
      assert.match(picture.headers.get("cache-control"), /immutable/);
      assert.deepEqual(pngSize(Buffer.from(await picture.arrayBuffer())), { width: 512, height: 512 });
      assert.match((await fetch(`${base}/avatars/${created.id}.png?v=old`)).headers.get("cache-control"), /no-cache/, "an old address is not kept for good");
      assert.equal((await fetch(`${base}/avatars/ag_000000000000.png`)).status, 404);
      assert.equal((await call("/api/avatars/preview?seed=x&color=%23ffffff", { auth: false })).status, 401, "drawing on request is for the panel only");
      assert.equal((await call("/api/avatars/preview?seed=x&color=%23ffffff")).headers.get("content-type"), "image/png");

      const png = (size) => `data:image/png;base64,${encodePng(size, size, Buffer.alloc(size * size * 4, 90)).toString("base64")}`;
      assert.match((await call(`/api/agents/${created.id}/avatar`, { method: "PUT", body: { image: "data:image/jpeg;base64,AAAA" } })).data.error, /PNG/);
      assert.match((await call(`/api/agents/${created.id}/avatar`, { method: "PUT", body: { image: png(256) } })).data.error, /tra 512 e 2000/);
      const own = await call(`/api/agents/${created.id}/avatar`, { method: "PUT", body: { image: png(512) } });
      assert.equal(own.status, 200);
      assert.notEqual(own.data.avatarVersion, created.avatarVersion, "a new picture, a new address");
      const served = Buffer.from(await (await fetch(`${base}/avatars/${created.id}.png?v=${own.data.avatarVersion}`)).arrayBuffer());
      assert.equal(served.toString("base64"), png(512).split(",")[1]);
      const back = await call(`/api/agents/${created.id}/avatar`, { method: "DELETE" });
      assert.equal(back.data.avatarVersion, created.avatarVersion, "back to the very same drawing");
    } finally {
      await call(`/api/agents/${created.id}`, { method: "DELETE" });
    }
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
    assert.ok(discord.state.profilePatches.some((patch) => patch.token === "pia-token" && patch.avatar), "with the picture Cora drew for her");
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
    assert.match(delivered.content, /^Receiver, registro consegnato\. <@600000000000000042> controlla/, "only a tag becomes a mention: a name said to someone stays text");
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

    // Agents are told the names a tag works with here, so they do not make one up ("@Seb" for sebnotseb).
    const channel = app.orchestrator.turnChannel(CHANNEL);
    assert.equal(channel.people[0].owner, true, "the owner comes first");
    const names = channel.people.map((person) => person.name);
    assert.ok(names.includes("Lia") && names.includes("Bruno"));
    assert.ok(!names.includes("Anna"), "a name two people share tags nobody, so it is not offered");
    assert.ok(!names.includes("Postina"), "agents are called through their own bots");
    const prompt = app.brain.systemPrompt(postina, { place: "", people: channel.people });
    assert.match(prompt, new RegExp(`## Chi puoi taggare qui\\nPer avvisare una persona scrivi @ seguito dal suo nome esattamente come in questo elenco: @${channel.people[0].name} \\(il proprietario\\)`));
    assert.match(prompt, /resta testo e non avvisa nessuno/);
  });

  test("an agent opens a thread through Cora and writes in it, never through another bot", async (t) => {
    const results = [];
    let threadId = "";
    replies.set("Marta", (body) => {
      const last = body.messages[body.messages.length - 1];
      if (last.role === "tool") {
        results.push(last.content);
        const opened = /opened thread (\d+)/.exec(last.content);
        if (opened) { threadId = opened[1]; return { tool_calls: [{ function: { name: "say", arguments: { text: "Primo aggiornamento su REF-55", channel_id: threadId } } }] }; }
        return { content: "Thread aperto, ci scrivo lì." };
      }
      return { tool_calls: [{ function: { name: "thread_open", arguments: { name: "REF-55 cluster production OOM" } } }] };
    });
    t.after(() => replies.delete("Marta"));
    discord.say({ content: "@Marta, apri un thread per REF-55 e scrivici lì" });
    await waitFor(() => discord.state.webhookPosts.some((post) => post.channelId === threadId && post.content === "Primo aggiornamento su REF-55") || discord.state.botPosts.some((post) => post.channelId === threadId && post.content?.includes("Primo aggiornamento su REF-55")), { what: "the first message in the new thread" });
    await waitFor(() => results.length >= 2, { what: "say's receipt for the thread" });
    const thread = discord.state.threads.get(threadId);
    assert.equal(thread.name, "REF-55 cluster production OOM");
    assert.equal(thread.parent_id, CHANNEL, "under the channel the conversation is in");
    assert.match(results[0], /Write in it with say\(\{text, channel_id: "\d+"\}\)/);
    assert.match(results[1] || "", new RegExp(`posted directly to ${threadId}`), `say takes the thread at once, though it was not there when the turn began: ${results[1]}`);
    await quiet();

    // A thread somebody else opened under an allowed channel is a place it may write in too.
    const elsewhere = await fetch(`${discord.url}/channels/${CHANNEL}/threads`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bot other" }, body: JSON.stringify({ name: "aperto da altri", type: 11 }) }).then((response) => response.json());
    const agent = app.store.agents().find((item) => item.name === "Marta");
    assert.ok(await app.orchestrator.threadFor(agent, elsewhere.id), "a thread under an allowed channel counts");
    assert.equal(await app.orchestrator.threadFor(agent, "123456789012345678"), null, "an unknown one does not");
    assert.match(app.brain.systemPrompt(agent, { place: "" }), /Non usare mai grog né un altro bot/);
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

  test("Discord app binding survives renaming, name reuse, disconnect, restart and replacement", async (t) => {
    const directory = tempHome();
    const token = (tail) => `MTQ2NzEyMzQ1Njc4OTAxMjM0NQ.Gabcde.${tail.padEnd(27, "x")}`;
    const tokens = { CORA_BOT_UNLINK: token("unlink"), CORA_BOT_KEEP: token("keep") };
    for (const [tail, id] of [["unlink", "600000000000000061"], ["keep", "600000000000000062"], ["replacement", "600000000000000063"], ["reused", "600000000000000064"]]) {
      discord.state.botUsers.set(token(tail), { id, username: tail });
    }
    const seed = new Store(directory);
    seed.updateSettings({ guildIds: [GUILD] });
    const agent = seed.createAgent({ name: "Unlink", model: "ollama/test-model", tools: false });
    const other = seed.createAgent({ name: "Keep", model: "ollama/test-model", tools: false });
    seed.close();
    let instance;
    let root;
    let session;
    const start = async () => {
      instance = startCora({ home: directory, host: "127.0.0.1", port: 0, insecureCookies: true,
        adminPassword: PASSWORD, sessionKey: "disconnect-fixture-session", discordToken: "", discordApi: discord.url,
        telegramToken: "", slackToken: "", slackAppToken: "", ollamaUrl: ollama.url, ollamaKey: "", orcaKey: "", brainDatabaseUrl: "",
        cloudUrl: "", cloudKey: "", cloudSpace: "", botTokenFor: (name) => tokens[name] || "",
        storeSecret: async (name, value) => { tokens[name] = value; },
        docker: docker.path, startBoxes: false, schedulerTickMs: 3600000,
        ownerInstructions: "/not-installed/AGENTS.md", sshAuthorizedKeys: "/not-installed/keys",
      });
      await instance.ready;
      root = `http://127.0.0.1:${instance.server.address().port}`;
      const login = await fetch(`${root}/api/login`, { method: "POST", headers: { "X-Cora": "1", "Content-Type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) });
      session = login.headers.get("set-cookie").split(";")[0];
    };
    const request = (path, options = {}) => fetch(`${root}${path}`, { ...options, headers: { Cookie: session, "X-Cora": "1", "Content-Type": "application/json", ...options.headers } });
    t.after(async () => { if (instance) await instance.stop(); });
    await start();
    await waitFor(() => instance.bots.client(agent.id) && instance.bots.client(other.id) && instance.discord.token === token("unlink"), { what: "agent listener" });
    const otherClient = instance.bots.client(other.id);
    const path = `/api/agents/${agent.id}/bot`;
    const originalClient = instance.bots.client(agent.id);
    const rename = await request(`/api/agents/${agent.id}`, { method: "PUT", body: JSON.stringify({ name: "Renamed" }) });
    assert.equal(rename.status, 200);
    assert.equal((await rename.json()).bot.env, "CORA_BOT_UNLINK");
    assert.equal(instance.bots.client(agent.id), originalClient, "renaming keeps the live bot connection");
    await waitFor(() => discord.state.profilePatches.some((patch) => patch.token === token("unlink") && patch.username === "Renamed"));
    replies.set("Renamed", () => ({ content: "Eccomi dopo la rinomina." }));
    discord.say({ content: "<@600000000000000061> ci sei dopo la rinomina?", mentions: [{ id: "600000000000000061", username: "Renamed" }] });
    await waitFor(() => discord.state.botPosts.some((post) => post.token === token("unlink") && post.content === "Eccomi dopo la rinomina."), { what: "channel reply after rename" });

    const reused = await (await request("/api/agents", { method: "POST", body: JSON.stringify({ name: "Unlink", model: "ollama/test-model", tools: false, chattiness: 0 }) })).json();
    assert.equal(reused.bot.configured, false, "reusing the old name cannot borrow the renamed agent's bot");
    assert.notEqual(reused.bot.env, "CORA_BOT_UNLINK");
    assert.equal((await request(`/api/agents/${reused.id}/bot`, { method: "PUT", body: JSON.stringify({ token: token("reused") }) })).status, 200);
    assert.equal(tokens.CORA_BOT_UNLINK, token("unlink"), "a new agent cannot overwrite the renamed agent's credential");
    assert.equal(tokens[reused.bot.env], token("reused"));
    await request(`/api/agents/${reused.id}`, { method: "DELETE" });
    assert.equal((await fetch(`${root}${path}`, { method: "DELETE", headers: { "X-Cora": "1" } })).status, 401);
    assert.equal((await fetch(`${root}${path}`, { method: "DELETE", headers: { Cookie: session } })).status, 403);
    assert.equal((await request("/api/agents/ag_missing/bot", { method: "DELETE" })).status, 404);
    assert.equal(instance.bots.client(agent.id)?.user.id, "600000000000000061", "refusals leave the app connected");

    let deletes = 0;
    const panel = panelHarness({ language: "it", hash: `#/agent/${agent.id}/profilo`, fetch: (url, options) => {
      if (url === path && options?.method === "DELETE") deletes++;
      return request(url, options);
    } });
    await panel.run("boot()");
    const button = await waitFor(() => panel.app.querySelectorAll("button").find((node) => node.textContent === "Scollega app"));
    button.click();
    assert.equal(button.textContent, "Conferma scollegamento");
    assert.equal(deletes, 0, "the first click only asks for confirmation");
    button.click();
    button.click();
    await waitFor(() => !instance.bots.client(agent.id) && !panel.app.querySelectorAll("button").some((node) => node.textContent === "Conferma scollegamento"));
    assert.equal(deletes, 1, "a pending disconnect cannot be submitted twice");
    assert.equal(instance.bots.client(other.id), otherClient, "other agents stay connected");
    assert.equal(instance.discord.token, token("keep"), "shared listening moves to another agent");
    assert.ok(panel.app.querySelectorAll("input").some((node) => node.attributes.placeholder === "Token del bot Discord"), "the setup is available again");
    assert.equal((await request(path, { method: "DELETE" })).status, 200, "disconnecting twice is harmless");
    instance.bots.sync();
    assert.equal(instance.bots.token(instance.store.agent(agent.id)), "", "the injected old token cannot reconnect");
    await instance.stop();
    instance = null;
    await start();
    await waitFor(() => instance.bots.client(other.id));
    const disconnected = await (await request(`/api/agents/${agent.id}`)).json();
    assert.equal(disconnected.bot.configured, false, "disconnect survives restart");
    assert.equal(disconnected.bot.env, "CORA_BOT_UNLINK", "the binding keeps its original secret name after restart");
    const failed = await request(path, { method: "PUT", body: JSON.stringify({ token: "invalid" }) });
    assert.equal(failed.status, 400);
    assert.equal(instance.bots.token(instance.store.agent(agent.id)), "", "a failed reconnect keeps the old app disconnected");
    const connected = await request(path, { method: "PUT", body: JSON.stringify({ token: token("replacement") }) });
    assert.equal(connected.status, 200);
    const result = await connected.json();
    assert.equal(result.bot.user.id, "600000000000000063");
    assert.equal(JSON.stringify(result).includes(token("replacement")), false);
    await waitFor(() => discord.state.profilePatches.some((patch) => patch.token === token("replacement") && patch.username === "Renamed"));
    await instance.stop();
    instance = null;
    await start();
    await waitFor(() => instance.bots.client(agent.id)?.user.id === "600000000000000063", { what: "replacement after restart" });
    await request(`/api/agents/${other.id}/bot`, { method: "DELETE" });
    await request(path, { method: "DELETE" });
    assert.equal(instance.discord.token, "", "disconnecting the last app also stops shared listening");

    const cancelled = await fakeDiscord();
    t.after(() => cancelled.close());
    let release;
    let arrived;
    const delayed = new Promise((resolve) => { release = resolve; });
    const requested = new Promise((resolve) => { arrived = resolve; });
    const gateway = http.createServer(async (_req, res) => {
      arrived();
      await delayed;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ url: `${cancelled.url.replace(/^http/, "ws")}/gateway` }));
    });
    await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
    t.after(() => { release(); return new Promise((resolve) => gateway.close(resolve)); });
    instance.bots.apiBase = `http://127.0.0.1:${gateway.address().port}`;
    const connecting = instance.bots.attach(agent, token("replacement"), 100);
    await requested;
    assert.equal((await request(path, { method: "DELETE" })).status, 200);
    release();
    await connecting;
    await sleep(300);
    assert.equal(cancelled.state.identifies, 0, "a late gateway response cannot reconnect a disconnected app");
  });

  test("Discord app disconnect remains available for an invalid token and recovers from a failed request", async () => {
    let requests = 0;
    const panel = panelHarness({ language: "en", fetch: async () => {
      requests++;
      return new Response(JSON.stringify({ error: "Disconnect failed" }), { status: 503 });
    } });
    panel.run('document.body.append(discordAccount({ id: "ag_broken", name: "Broken", bot: { configured: true, state: "error", error: "Invalid token", env: "CORA_BOT_BROKEN" } }))');
    const button = panel.app.parent.querySelectorAll("button").find((node) => node.textContent === "Disconnect app");
    assert.ok(button, "even an app without a connected Discord user can be disconnected");
    button.click();
    assert.equal(button.textContent, "Confirm disconnect");
    assert.equal(requests, 0);
    button.click();
    await waitFor(() => button.disabled === false);
    assert.equal(requests, 1);
    assert.ok(panel.app.parent.textContent.includes("Disconnect failed"));
    button.click();
    await waitFor(() => requests === 2 && button.disabled === false);
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
    const sent = await call("/api/rooms/web/messages", { method: "POST", body: { text: "@Ugo, ci sei?" } });
    assert.equal(sent.status, 201);
    const reply = await waitFor(async () => (await call("/api/rooms/web/messages")).data.messages.find((item) => item.agentId === created.data.id), { what: "Ugo's reply" });
    assert.equal(reply.content, "Ciao dal salotto!");
    await waitFor(() => events.includes("Ciao dal salotto!"), { what: "the reply on the event stream" });
    const parsed = events.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
    assert.ok(parsed.some((event) => event.type === "web-message" && event.room === "web" && event.item.content === "@Ugo, ci sei?"));
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
    const seccompFile = runs()[0].match(/--security-opt seccomp=(.+) --shm-size /)[1];
    const seccomp = JSON.parse(readFileSync(seccompFile, "utf8"));
    assert.equal(seccomp.defaultAction, "SCMP_ACT_ERRNO");
    for (const name of ["clone", "setns", "unshare"]) {
      assert.ok(seccomp.syscalls.some((rule) => rule.action === "SCMP_ACT_ALLOW" && rule.names.includes(name)), `${name} supports the Chromium namespace sandbox`);
    }
    assert.doesNotMatch(runs()[0], /--privileged|--cap-add/);
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
    const login = await call("/api/login", { method: "POST", body: { password: PASSWORD }, auth: false });
    cookie = login.headers.get("set-cookie").split(";")[0];
    olga = (await call("/api/agents", { method: "POST", body: { name: "Olga", model: "ollama/test-model", chattiness: 1, tools: true, channelIds: [CHANNEL] } })).data;
    pino = (await call("/api/agents", { method: "POST", body: { name: "Pino", model: "ollama/test-model", chattiness: 1, tools: false, channelIds: [CHANNEL] } })).data;
    for (const agent of app.store.agents()) {
      if (![olga.id, pino.id].includes(agent.id) && agent.enabled) await call(`/api/agents/${agent.id}`, { method: "PUT", body: { enabled: false } });
    }
  });

  test("in a channel too an agent speaks only when called: a message that calls nobody gets no answer, a bot naming an agent in passing calls nobody", async () => {
    replies.set("Olga", () => ({ content: "Dico la mia." }));
    replies.set("Pino", () => ({ content: "Dico la mia anche io." }));
    const before = posts("Olga").length + posts("Pino").length;
    // Both are in the channel and as chatty as they were ever allowed to be: still nobody was called.
    for (let round = 0; round < 3; round += 1) {
      discord.say({ content: `ragazzi, che si fa oggi? (${round})` });
      await sleep(1800);
      await quiet();
    }
    discord.say({ content: "Ho girato a Olga e Pino il riepilogo di ieri.", author: "700000000000000077", username: "Reporter", bot: true });
    await sleep(2500);
    await quiet();
    assert.equal(posts("Olga").length + posts("Pino").length - before, 0, "nobody called, nobody speaks");
    // Called directly by another bot, the agent answers.
    discord.say({ content: "@Pino, mi confermi il riepilogo?", author: "700000000000000077", username: "Reporter", bot: true });
    await waitFor(() => posts("Pino").length === 1, { what: "Pino called by the bot" });
    await quiet();
    assert.equal(posts("Olga").length, 0);
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
    discord.say({ content: "@Olga, ci pensi tu?", channel: THREAD });
    const post = await waitFor(() => discord.state.webhookPosts.find((item) => item.username === "Olga" && item.content === "Nel thread ci sono."), { what: "Olga summoned in the thread" });
    assert.equal(post.channelId, THREAD, "the answer lands in the thread");
    await quiet();
    assert.deepEqual(posts("Pino"), []);
  });

  test("a thread named after an issue keeps its topic: another thread's work is stopped and sent there, a question about it passes", async () => {
    const HANDOVER = "1599000000000000731";
    const PAGES = "1599000000000000732";
    discord.dispatch("THREAD_CREATE", { id: HANDOVER, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "REF-23 handover" });
    discord.dispatch("THREAD_CREATE", { id: PAGES, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "REF-62 — razionalizzazione pagine Admin" });
    await sleep(150);
    const inThread = (thread) => discord.state.webhookPosts.filter((item) => item.username === "Olga" && item.channelId === thread).map((item) => item.content);

    replies.set("Olga", () => ({ content: "REF-62: Dashboard fatta, prossima Briefings." }));
    discord.say({ content: "@Olga, lavora su REF-62", channel: PAGES });
    await waitFor(() => inThread(PAGES).length === 1, { what: "Olga in the REF-62 thread" });
    await quiet();

    // The incident of 10/11: "procedi" in the handover thread, and the agent carries on REF-62 there.
    const prompts = [];
    let refusals = [];
    replies.set("Olga", (body) => {
      prompts.push(lastUserText(body));
      const last = body.messages.at(-1);
      if (last.role === "tool") refusals.push(String(last.content));
      if (prompts.length === 1) return { tool_calls: [{ function: { name: "say", arguments: { text: "Passo a Source Health di REF-62." } } }] };
      return { content: "Briefings chiusa su REF-62, ora Source Health." };
    });
    discord.say({ content: "@Olga, ok, procedi allora qui", channel: HANDOVER });
    await waitFor(() => inThread(HANDOVER).length === 1, { what: "Olga's answer in the handover thread" });
    await quiet();
    assert.match(prompts[0], /Tema di questo thread: REF-23\. Qui lavori solo su questo\./);
    assert.match(prompts[0], new RegExp(`REF-62 → «REF-62 — razionalizzazione pagine Admin» https://discord.com/channels/${GUILD}/${PAGES}`));
    assert.match(prompts[0], /<altrove dove="[^"]*" tema="REF-62">altro thread, altro tema \(REF-62\)/);
    assert.doesNotMatch(prompts[0], /Dashboard fatta/, "the other thread's work is a pointer, not a transcript to continue");
    assert.match(refusals[0], /^error: not sent\. Questo thread è dedicato a REF-23; REF-62 ha il suo thread/);
    assert.deepEqual(inThread(HANDOVER), [`Questo riguarda REF-62: ne parlo nel suo thread, https://discord.com/channels/${GUILD}/${PAGES}`], "after two rewrites a pointer goes out, never the work");
    assert.ok(!discord.state.webhookPosts.some((item) => item.channelId === HANDOVER && /Source Health/.test(item.content)));

    // Sent to its own thread, the same work goes through.
    replies.set("Olga", (body) => body.messages.at(-1).role === "tool" ? { content: "PASS" } : { tool_calls: [{ function: { name: "say", arguments: { text: "Passo a Source Health di REF-62.", channel_id: PAGES } } }] });
    discord.say({ content: "@Olga, scrivilo nel thread giusto", channel: HANDOVER });
    await waitFor(() => inThread(PAGES).includes("Passo a Source Health di REF-62."), { what: "the work in its own thread" });
    await quiet();

    // The owner asks here about the other issue: answering is allowed.
    replies.set("Olga", () => ({ content: "REF-62 è In Progress, mancano Sources e Cycles." }));
    discord.say({ content: "@Olga, a che punto è REF-62?", channel: HANDOVER });
    await waitFor(() => inThread(HANDOVER).includes("REF-62 è In Progress, mancano Sources e Cycles."), { what: "an answer to a question" });
    await quiet();
  });

  test("threads without issue keys isolate Refracto from Cora and preserve their own current request", async () => {
    const HANDOVER = "1599000000000000831";
    const SECRETS = "1599000000000000832";
    discord.dispatch("THREAD_CREATE", { id: HANDOVER, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "Refracto autogestito" });
    discord.dispatch("THREAD_CREATE", { id: SECRETS, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "Ricerca nella pagina segreti" });
    await sleep(150);
    const inThread = (id) => discord.state.webhookPosts.filter((item) => item.username === "Olga" && item.channelId === id);
    replies.set("Olga", () => ({ content: "Sto aggiungendo la sidebar Segreti / Registro. CORA_FOREIGN_TASK." }));
    discord.say({ content: "@Olga, aggiungi la ricerca segreti. CORA_FOREIGN_REQUEST.", channel: SECRETS });
    await waitFor(() => inThread(SECRETS).length === 1);
    await quiet();
    let prompt;
    replies.set("Olga", (body) => { prompt = lastUserText(body); return { content: "Su Refracto attendo i test capabilities." }; });
    discord.say({ content: "@Olga, a che punto sei qui? REFRACTO_CURRENT_REQUEST.", channel: HANDOVER });
    await waitFor(() => inThread(HANDOVER).length === 1);
    await quiet();
    assert.doesNotMatch(prompt, /CORA_FOREIGN_TASK|CORA_FOREIGN_REQUEST|Sto aggiungendo la sidebar/);
    assert.match(prompt, /REFRACTO_CURRENT_REQUEST/);
    assert.match(prompt, /Tema di questo thread: «Refracto autogestito»/);
    assert.match(prompt, new RegExp(`discord.com/channels/${GUILD}/${SECRETS}`), "other work remains discoverable by its thread link");

    replies.set("Olga", (body) => { prompt = lastUserText(body); return { content: "Resto sul tema di questo canale." }; });
    discord.say({ content: "@Olga, rispondi qui nel canale." });
    await waitFor(() => posts("Olga").includes("Resto sul tema di questo canale."));
    await quiet();
    assert.doesNotMatch(prompt, /CORA_FOREIGN_TASK|CORA_FOREIGN_REQUEST|REFRACTO_CURRENT_REQUEST/, "thread transcripts do not leak into a parent channel either");

    const resumed = await app.brain.resumeTurn({ agent: { ...olga, tools: false }, channel: app.channels.info(HANDOVER),
      trace: { kind: "chat", startedAt: new Date().toISOString(), steps: [],
        prompt: '<altrove dove="Ricerca segreti">CORA_LEGACY_WORK</altrove>\n<chat>\nSam ★: verifica Refracto REFRACTO_RESUMED_WORK\n</chat>' } });
    assert.equal(resumed.text, "Resto sul tema di questo canale.");
    assert.doesNotMatch(prompt, /CORA_LEGACY_WORK/);
    assert.match(prompt, /REFRACTO_RESUMED_WORK/);
    assert.match(prompt, /Tema di questo thread: «Refracto autogestito»/);
  });

  test("progress reports do not spend the colleague turn budget, and real handoffs remain bounded", async () => {
    const THREAD = "1599000000000000833";
    discord.dispatch("THREAD_CREATE", { id: THREAD, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "Refracto QA handoff" });
    await sleep(150);
    await call("/api/settings", { method: "PUT", body: { maxAgentTurns: 3 } });
    let progress = 0;
    const beforeSessions = app.store.threadSessions().filter((item) => item.channelId === THREAD).length;
    replies.set("Olga", () => progress < 10
      ? { tool_calls: [{ function: { name: "say", arguments: { text: `Verifica Refracto ${++progress}: lavoro ancora in corso.` } } }] }
      : { content: "@Pino candidato pronto, verifica il pacchetto." });
    replies.set("Pino", () => ({ content: "@Olga pacchetto verificato, conferma." }));
    try {
      discord.say({ content: "@Olga, prepara il candidato e fallo verificare al collega.", channel: THREAD });
      await waitFor(() => discord.state.webhookPosts.some((item) => item.channelId === THREAD && item.username === "Pino"), { what: "Pino receives a handoff after ten progress updates" });
      await quiet();
      const messages = discord.state.webhookPosts.filter((item) => item.channelId === THREAD);
      assert.equal(messages.filter((item) => item.username === "Pino").length, 1, "a colleague is not restarted in a loop");
      assert.equal(messages.filter((item) => /^Verifica Refracto/.test(item.content)).length, 10);
      assert.equal(app.store.threadSessions().filter((item) => item.channelId === THREAD).length - beforeSessions, 3, "three actual turns, regardless of progress posts");
      assert.equal(app.orchestrator.state(THREAD).budget, 0, "the third turn exhausts the real turn budget");
    } finally {
      await call("/api/settings", { method: "PUT", body: { maxAgentTurns: 8 } });
    }
  });

  test("a delegated final result returns to its requester without a tag, once and in its own thread", async () => {
    const THREAD = "1599000000000000835";
    discord.dispatch("THREAD_CREATE", { id: THREAD, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "Delegated result continuation" });
    await sleep(150);
    let calls = 0, checks = 0, continuationPrompt = "";
    replies.set("Olga", (body) => {
      if (calls) continuationPrompt = lastUserText(body);
      return { content: ++calls === 1 ? "@Pino verifica il candidato, poi riprendo il lavoro." : "Esito ricevuto, candidato integrato." };
    });
    replies.set("Pino", () => ++checks === 1
      ? { tool_calls: [{ function: { name: "say", arguments: { text: "Verifica in corso." } } }] }
      : { content: "Candidato verificato. Nessun blocco." });
    discord.say({ content: "@Olga, prepara il candidato e fallo verificare.", channel: THREAD });
    await waitFor(() => discord.state.webhookPosts.some((item) => item.channelId === THREAD && item.content === "Candidato verificato. Nessun blocco."));
    await quiet();
    const messages = discord.state.webhookPosts.filter((item) => item.channelId === THREAD);
    assert.equal(calls, 2, "the requester continues when the final report has no mention");
    assert.match(continuationPrompt, /\[Cora: risultato del collega\]/);
    assert.match(continuationPrompt, /Riprendi il lavoro ancora aperto sulla richiesta della persona/);
    assert.equal(messages.filter((item) => item.username === "Pino").length, 2, "one progress post and one final report, with no return loop");
    assert.equal(app.store.threadSessions().filter((item) => item.channelId === THREAD).length, 3);
    assert.equal(messages.filter((item) => item.content === "Esito ricevuto, candidato integrato.").length, 1);
  });

  test("a final result delivered with say returns once after PASS, without reposting it", async () => {
    const THREAD = "1599000000000000836";
    discord.dispatch("THREAD_CREATE", { id: THREAD, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "Tool-only delegated result" });
    await sleep(150);
    let calls = 0, checks = 0;
    replies.set("Olga", () => ({ content: ++calls === 1 ? "@Pino verifica questo candidato." : "Ricevuta verifica tool-only." }));
    replies.set("Pino", () => ++checks === 1
      ? { tool_calls: [{ function: { name: "say", arguments: { text: "Verifica tool-only conclusa." } } }] }
      : { content: "PASS" });
    discord.say({ content: "@Olga, delega il controllo e riprendi al risultato.", channel: THREAD });
    await waitFor(() => discord.state.webhookPosts.some((item) => item.channelId === THREAD && item.content === "Verifica tool-only conclusa."));
    await quiet();
    assert.equal(calls, 2);
    assert.equal(discord.state.webhookPosts.filter((item) => item.channelId === THREAD && item.content === "Verifica tool-only conclusa.").length, 1);
    assert.equal(app.store.threadSessions().filter((item) => item.channelId === THREAD).length, 3);
  });

  test("a returned result cannot reengage a requester who left the conversation", async () => {
    const THREAD = "1599000000000000837";
    discord.dispatch("THREAD_CREATE", { id: THREAD, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "Departed requester" });
    await sleep(150);
    let calls = 0, checking = false, finish;
    const gate = new Promise((resolve) => { finish = resolve; });
    replies.set("Olga", () => ({ content: ++calls === 1 ? "@Pino verifica il candidato." : "UNEXPECTED_RESTART" }));
    replies.set("Pino", async () => { checking = true; await gate; return { content: "Verifica conclusa dopo uscita." }; });
    discord.say({ content: "@Olga, delega la verifica.", channel: THREAD });
    await waitFor(() => checking);
    app.orchestrator.endListening(app.orchestrator.state(THREAD), olga.id);
    finish();
    await quiet();
    assert.equal(calls, 1);
    assert.ok(!app.orchestrator.state(THREAD).focus.ids.includes(olga.id));
    assert.ok(!discord.state.webhookPosts.some((item) => item.content === "UNEXPECTED_RESTART"));
  });

  test("a late colleague result cannot restart a requester stopped from the panel", async () => {
    const THREAD = "1599000000000000838";
    discord.dispatch("THREAD_CREATE", { id: THREAD, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "Stopped requester" });
    await sleep(150);
    let calls = 0, checking = false, finish;
    const gate = new Promise((resolve) => { finish = resolve; });
    replies.set("Olga", () => ({ content: ++calls === 1 ? "@Pino verifica il candidato." : "UNEXPECTED_STOP_RESTART" }));
    replies.set("Pino", async () => { checking = true; await gate; return { content: "Verifica conclusa dopo stop." }; });
    discord.say({ content: "@Olga, delega la verifica.", channel: THREAD });
    await waitFor(() => checking);
    app.orchestrator.stopThread(THREAD, olga.id);
    assert.ok(app.orchestrator.state(THREAD).focus.ids.includes(olga.id), "stopping a task does not end listening");
    finish();
    await quiet();
    assert.equal(calls, 1);
    assert.ok(!discord.state.webhookPosts.some((item) => item.content === "UNEXPECTED_STOP_RESTART"));
  });

  test("colleague fanout rechecks the remaining turn budget before starting each session", async () => {
    const THREAD = "1599000000000000834";
    discord.dispatch("THREAD_CREATE", { id: THREAD, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "Bounded colleague fanout" });
    const rita = (await call("/api/agents", { method: "POST", body: { name: "Rita", model: "ollama/test-model", tools: false, channelIds: [CHANNEL] } })).data;
    await call("/api/settings", { method: "PUT", body: { maxAgentTurns: 2 } });
    replies.set("Olga", () => ({ content: "@Pino e @Rita, verificate il candidato." }));
    replies.set("Pino", () => ({ content: "Verificato da Pino." }));
    replies.set("Rita", () => ({ content: "Verificato da Rita." }));
    try {
      discord.say({ content: "@Olga, prepara il candidato.", channel: THREAD });
      await waitFor(() => discord.state.webhookPosts.some((item) => item.channelId === THREAD && /Verificato da/.test(item.content)));
      await quiet();
      assert.equal(app.store.threadSessions().filter((item) => item.channelId === THREAD).length, 2);
      assert.equal(discord.state.webhookPosts.filter((item) => item.channelId === THREAD).length, 2);
    } finally {
      await call(`/api/agents/${rita.id}`, { method: "PUT", body: { enabled: false } });
      await call("/api/settings", { method: "PUT", body: { maxAgentTurns: 8 } });
    }
  });

  test("only the agent you name answers, a follow-up without names goes to it again, and a mention of someone else keeps them quiet", async () => {
    replies.set("Olga", () => ({ content: "Sono Olga, dimmi." }));
    replies.set("Pino", () => ({ content: "Anche io!" }));
    discord.say({ content: "@Olga, ci sei?" });
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

  test("Regia saves its own decision model, account and backups without changing the librarian", async (t) => {
    const before = { ...app.store.settings };
    t.after(() => app.store.updateSettings(before));
    const response = await call("/api/settings", { method: "PUT", body: { brainModel: "ollama/library", brainBackups: [{ model: "ollama/library-backup" }], decisionModel: "ollama/small", decisionBackups: [] } });
    assert.equal(response.status, 200);
    const panel = panelHarness({ hash: "#/settings/regia", fetch: async (path, init = {}) => {
      const result = await call(path, { method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined });
      return { ok: result.status < 400, status: result.status, json: async () => result.data };
    } });
    await panel.run("boot()");
    const primary = panel.app.querySelectorAll("select").find((field) => field.attributes.name === "decisionModel");
    assert.ok(primary);
    primary.value = "gemini/test-model";
    primary.parent.dispatch("change");
    await waitFor(() => app.store.settings.decisionModel === "gemini/test-model");
    const account = panel.app.querySelectorAll("select").find((field) => field.attributes["aria-label"] === "Account del decisore");
    assert.ok(account);
    account.value = subscriptionIds.gemini;
    account.dispatch("change");
    await waitFor(() => app.store.settings.decisionSubscriptionId === subscriptionIds.gemini);
    const add = panel.app.querySelectorAll("button").find((button) => button.textContent === "Aggiungi riserva");
    add.click();
    await waitFor(() => app.store.settings.decisionBackups.length === 1);
    const backup = panel.app.querySelectorAll("select").find((field) => field.attributes.name === "decisionBackup0");
    backup.value = "ollama/small-backup";
    backup.parent.dispatch("change");
    await waitFor(() => app.store.settings.decisionBackups[0].model === "ollama/small-backup");
    const saved = new Store(home);
    assert.equal(saved.settings.decisionModel, "gemini/test-model");
    assert.equal(saved.settings.decisionSubscriptionId, subscriptionIds.gemini);
    assert.deepEqual(saved.settings.brainBackups, [{ model: "ollama/library-backup", subscriptionId: "", credentialId: "" }]);
    assert.equal(saved.settings.brainModel, "ollama/library");
    saved.close();
    panel.app.querySelectorAll("button").find((button) => button.attributes.title === "Togli questa riserva").click();
    await waitFor(() => app.store.settings.decisionBackups.length === 0);
  });

  test("thread engagement survives silence and a fresh state; only an explicit disengagement ends it", async () => {
    const THREAD = "1599000000000000791";
    discord.dispatch("THREAD_CREATE", { id: THREAD, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "persistent listening" });
    await sleep(100);
    replies.set("Olga", () => ({ content: "Ti ascolto." }));
    discord.say({ content: "@Olga, rimani in ascolto", channel: THREAD });
    await waitFor(() => posts("Olga").length === 1);
    await quiet();
    const stored = app.store.value("conversationEngagements")[THREAD];
    assert.deepEqual(stored.ids, [olga.id]);
    stored.at -= 2 * 3600 * 1000;
    app.orchestrator.engagements[THREAD] = stored;
    app.orchestrator.states.delete(THREAD);
    discord.say({ content: "Ho un’altra modifica", channel: THREAD });
    await waitFor(() => posts("Olga").length === 2, { what: "unmentioned follow-up after a long silence and restart" });
    await quiet();
    discord.say({ content: "Ok grazie, il lavoro è finito", channel: THREAD });
    await waitFor(() => posts("Olga").length === 3);
    await quiet();
    assert.deepEqual(app.orchestrator.state(THREAD).focus.ids, [olga.id], "completion and gratitude never disconnect");
    departures = (body) => {
      assert.match(body.messages[0].content, /Fermare un compito non termina l’ascolto/);
      return [olga.id];
    };
    discord.say({ content: "Puoi smettere di ascoltare questa conversazione", channel: THREAD });
    await waitFor(() => posts("Olga").includes("Ho smesso di ascoltare questa conversazione."));
    await quiet();
    assert.equal(app.store.value("conversationEngagements")[THREAD], null);
    app.orchestrator.states.delete(THREAD);
    const before = posts("Olga").length;
    discord.say({ content: "messaggio senza chiamata", channel: THREAD });
    await sleep(1600);
    await quiet();
    assert.equal(posts("Olga").length, before, "disengagement survives a fresh state");
  });

  test("an explicit detach ends listening before a model farewell and stays detached after restart", async () => {
    const THREAD = "1599000000000000799";
    discord.dispatch("THREAD_CREATE", { id: THREAD, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "explicit detach regression" });
    await sleep(100);
    const said = () => discord.state.webhookPosts.filter((item) => item.channelId === THREAD && item.username === "Olga").map((item) => item.content);
    replies.set("Olga", () => ({ content: "Ricevuto, mi stacco. A posto 👍" }));
    discord.say({ content: "@Olga, controlla questo", channel: THREAD });
    await waitFor(() => said().length === 1);
    await quiet();
    assert.deepEqual(app.store.value("conversationEngagements")[THREAD].ids, [olga.id]);
    departures = (body) => {
      const input = JSON.parse(body.messages[1].content);
      assert.equal(input.message, "ok, staccati dal thread a posto");
      assert.deepEqual(input.agents.map((agent) => agent.id), [olga.id]);
      return [olga.id];
    };
    discord.say({ content: "ok, staccati dal thread a posto", channel: THREAD });
    await waitFor(() => said().length === 2);
    await quiet();
    assert.equal(said()[1], "Ho smesso di ascoltare questa conversazione.", "the structural exit replaces an unsupported model farewell");
    assert.equal(app.store.value("conversationEngagements")[THREAD], null);
    assert.equal(app.orchestrator.state(THREAD).humanQueue.size, 0);
    const restored = new app.orchestrator.constructor(app.orchestrator);
    assert.equal(restored.state(THREAD).focus, null, "a fresh orchestrator restores the persisted exit");
    await restored.checkEngagements(Date.now() + 90 * 60000);
    assert.equal(said().length, 2, "restart cannot send another thirty-minute question");
    app.orchestrator.states.delete(THREAD);
    discord.say({ content: "messaggio senza chiamata", channel: THREAD });
    await sleep(1600);
    await quiet();
    assert.equal(said().length, 2, "an ordinary message cannot re-engage the departed agent");
    departures = () => [];
    discord.say({ content: "@Olga, torna qui", channel: THREAD });
    await waitFor(() => said().length === 3);
    await quiet();
    assert.deepEqual(app.store.value("conversationEngagements")[THREAD].ids, [olga.id], "an explicit new call can re-engage the agent");
  });

  test("an agent atomically ends its own listening with its farewell when the classifier is unavailable", async () => {
    const THREAD = "1599000000000000802";
    discord.dispatch("THREAD_CREATE", { id: THREAD, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "atomic farewell" });
    await sleep(100);
    departures = () => null;
    const said = (name) => discord.state.webhookPosts.filter((item) => item.channelId === THREAD && item.username === name).map((item) => item.content);
    replies.set("Olga", () => ({ content: "Olga qui." }));
    replies.set("Pino", () => ({ content: "Pino qui." }));
    discord.say({ content: "@Olga, resta qui", channel: THREAD });
    await waitFor(() => said("Olga").length === 1);
    await quiet();
    discord.say({ content: "@Pino, resta anche tu", channel: THREAD });
    await waitFor(() => said("Pino").length === 1);
    await quiet();
    let calls = 0;
    replies.set("Olga", () => {
      calls++;
      return { tool_calls: [{ function: { name: "say", arguments: { text: "Ok, alla prossima!", end_conversation: true } } }, { function: { name: "shell", arguments: { command: "must-not-run-after-farewell" } } }] };
    });
    const shell = app.boxes.shell;
    let commands = 0;
    app.boxes.shell = async () => { commands++; return { code: 0, output: "unexpected" }; };
    try {
      discord.say({ content: "@Olga puoi congedarti, qui abbiamo finito", channel: THREAD });
      await waitFor(() => said("Olga").includes("Ok, alla prossima!"));
      await quiet();
      assert.equal(commands, 0, "the closing tool stops later work in the same response");
      assert.equal(calls, 1);
      assert.deepEqual(app.store.value("conversationEngagements")[THREAD].ids, [pino.id], "a farewell only disconnects its own speaker");
      const trace = app.store.traces(olga.id, 1)[0];
      assert.ok(app.store.trace(trace.id).steps.some((step) => step.name === "say" && /"conversation_closed":true/.test(step.result)));
      const restored = new app.orchestrator.constructor(app.orchestrator);
      assert.deepEqual(restored.state(THREAD).focus.ids, [pino.id]);
      await restored.checkEngagements(Date.now() + 90 * 60000);
      assert.equal(said("Olga").filter((text) => /30 minuti/.test(text)).length, 0);
      app.orchestrator.states.delete(THREAD);
      discord.say({ content: "altra nota senza chiamata", channel: THREAD });
      await waitFor(() => said("Pino").length > 1);
      await quiet();
      assert.equal(calls, 1, "ordinary followups do not wake the departed agent");
    } finally { app.boxes.shell = shell; }
  });

  test("semantic departures apply unfamiliar wording, preserve other listeners and ignore unrelated ids", async () => {
    const THREAD = "1599000000000000801";
    discord.dispatch("THREAD_CREATE", { id: THREAD, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "semantic departures" });
    await sleep(100);
    const said = (name) => discord.state.webhookPosts.filter((item) => item.channelId === THREAD && item.username === name).map((item) => item.content);
    replies.set("Olga", () => ({ content: "Olga qui." }));
    replies.set("Pino", () => ({ content: "Pino qui." }));
    for (const wording of ["per oggi puoi congedarti da questa conversazione", "la tua presenza qui non serve più, ti libero", "you can bow out of this conversation now"]) {
      departures = () => [];
      const before = said("Olga").length;
      discord.say({ content: "@Olga, torna qui", channel: THREAD });
      await waitFor(() => said("Olga").length > before);
      await quiet();
      departures = (body) => {
        assert.equal(JSON.parse(body.messages[1].content).message, wording);
        return [olga.id, "unrelated-agent"];
      };
      discord.say({ content: wording, channel: THREAD });
      await waitFor(() => app.store.value("conversationEngagements")[THREAD] === null);
      await quiet();
      assert.equal(said("Olga").at(-1), "Ho smesso di ascoltare questa conversazione.");
    }
    departures = () => [];
    discord.say({ content: "@Olga, rimani qui", channel: THREAD });
    await waitFor(() => app.orchestrator.engagements[THREAD]?.ids.includes(olga.id));
    await quiet();
    discord.say({ content: "@Pino, partecipa anche tu", channel: THREAD });
    await waitFor(() => app.orchestrator.engagements[THREAD]?.ids.includes(pino.id));
    await quiet();
    departures = (body) => {
      const input = JSON.parse(body.messages[1].content);
      assert.deepEqual(input.agents.map((agent) => agent.id), [olga.id]);
      return [olga.id, pino.id, "unrelated-agent"];
    };
    discord.say({ content: "@Olga puoi congedarti da qui", channel: THREAD });
    await waitFor(() => app.orchestrator.engagements[THREAD]?.ids.length === 1);
    await quiet();
    assert.deepEqual(app.store.value("conversationEngagements")[THREAD].ids, [pino.id]);
    assert.equal(said("Pino").includes("Ho smesso di ascoltare questa conversazione."), false);
  });

  test("a stop names one agent, a continue keeps the other, and an untagged line does not wake every listener", async () => {
    const THREAD = "1599000000000000793";
    discord.dispatch("THREAD_CREATE", { id: THREAD, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "listen routing" });
    await sleep(100);
    const said = (name) => discord.state.webhookPosts.filter((item) => item.channelId === THREAD && item.username === name).map((item) => item.content);
    replies.set("Olga", () => ({ content: "Olga qui." }));
    replies.set("Pino", () => ({ content: "Pino qui." }));
    departures = (body) => JSON.parse(body.messages[1].content).message === "@Olga, smetti di ascoltare" ? [olga.id, pino.id] : [];
    try {
      discord.say({ content: "@Olga, resta su questo", channel: THREAD });
      await waitFor(() => said("Olga").includes("Olga qui."));
      discord.say({ content: "@Pino, resta anche tu", channel: THREAD });
      await waitFor(() => said("Pino").includes("Pino qui."));
      await quiet();
      assert.deepEqual(new Set(app.orchestrator.state(THREAD).focus.ids), new Set([olga.id, pino.id]));
      const olgaAt = said("Olga").length;
      discord.say({ content: "Olga si è fermata quando avevo detto a quell'agent di fermarsi", channel: THREAD });
      await waitFor(() => said("Pino").filter((text) => text === "Pino qui.").length === 2);
      await quiet();
      assert.equal(said("Olga").length, olgaAt, "the other listener does not answer an untagged line");
      assert.equal(said("Olga").includes("Ho smesso di ascoltare questa conversazione."), false);
      assert.equal(said("Pino").includes("Ho smesso di ascoltare questa conversazione."), false);
      discord.say({ content: "@Olga, fermati", channel: THREAD });
      await waitFor(() => said("Olga").filter((text) => text === "Olga qui.").length === 2);
      await quiet();
      assert.equal(said("Olga").includes("Ho smesso di ascoltare questa conversazione."), false, "stopping a task does not end listening");
      assert.deepEqual(new Set(app.orchestrator.state(THREAD).focus.ids), new Set([olga.id, pino.id]));
      discord.say({ content: "@Olga, smetti di ascoltare", channel: THREAD });
      await waitFor(() => said("Olga").includes("Ho smesso di ascoltare questa conversazione."));
      await quiet();
      assert.deepEqual(app.orchestrator.state(THREAD).focus.ids, [pino.id], "the model cannot disconnect the agent who was not told to leave");
      const stopped = said("Pino").filter((text) => text === "Ho smesso di ascoltare questa conversazione.").length;
      discord.say({ content: "@Pino procedi solo tu", channel: THREAD });
      await waitFor(() => said("Pino").filter((text) => text === "Pino qui.").length === 3);
      await quiet();
      assert.equal(said("Pino").filter((text) => text === "Ho smesso di ascoltare questa conversazione.").length, stopped);
      assert.deepEqual(app.orchestrator.state(THREAD).focus.ids, [pino.id]);
    } finally {
      departures = null;
    }
  });

  test("after 30 minutes without messages the reminder asks once, stays connected, survives restart and restarts when anyone writes", async () => {
    const THREAD = "1599000000000000792";
    discord.dispatch("THREAD_CREATE", { id: THREAD, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "idle reminder" });
    await sleep(100);
    replies.set("Olga", () => ({ content: "Resto qui." }));
    discord.say({ content: "@Olga, ascolta qui", channel: THREAD });
    await waitFor(() => posts("Olga").length === 1);
    await quiet();
    const focus = app.orchestrator.engagements[THREAD];
    const reminders = () => discord.state.webhookPosts.filter((item) => item.channelId === THREAD && /30 minuti/.test(item.content));
    await app.orchestrator.checkEngagements(focus.at + 30 * 60000 - 1);
    assert.equal(reminders().length, 0);
    await Promise.all([app.orchestrator.checkEngagements(focus.at + 30 * 60000), app.orchestrator.checkEngagements(focus.at + 30 * 60000)]);
    assert.equal(reminders().length, 1);
    assert.ok(app.orchestrator.state(THREAD).history.at(-1).passive, "the question cannot trigger another agent");
    assert.deepEqual(app.orchestrator.state(THREAD).focus.ids, [olga.id]);
    app.orchestrator.engagements = app.store.value("conversationEngagements");
    app.orchestrator.states.delete(THREAD);
    await app.orchestrator.checkEngagements(focus.at + 90 * 60000);
    assert.equal(reminders().length, 1, "silence and a restart do not repeat the reminder");
    discord.say({ content: "Sì resta, grazie", channel: THREAD });
    await waitFor(() => posts("Olga").filter((text) => text === "Resto qui.").length === 2);
    await quiet();
    const renewed = app.orchestrator.engagements[THREAD];
    const renewedAt = renewed.at;
    assert.equal(renewed.remindedAt, 0);
    await sleep(20);
    await app.orchestrator.postAs(olga, app.orchestrator.state(THREAD), "Aggiornamento del bot.", undefined, undefined, { passive: true });
    const afterBot = app.orchestrator.engagements[THREAD].at;
    assert.ok(afterBot > renewedAt, "the agent's own message restarts the thirty minutes");
    await app.orchestrator.checkEngagements(renewedAt + 30 * 60000);
    assert.equal(reminders().length, 1, "the count runs from the last message, whoever wrote it");
    await app.orchestrator.checkEngagements(afterBot + 30 * 60000);
    assert.equal(reminders().length, 2);
  });

  test("a thirty-minute question that cannot be delivered is not retried every minute", async () => {
    const THREAD = "1599000000000000797";
    discord.dispatch("THREAD_CREATE", { id: THREAD, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "idle undeliverable" });
    await sleep(100);
    replies.set("Olga", () => ({ content: "Resto qui." }));
    discord.say({ content: "@Olga, ascolta qui", channel: THREAD });
    await waitFor(() => posts("Olga").filter((text) => text === "Resto qui.").length >= 1);
    await quiet();
    const focus = app.orchestrator.engagements[THREAD];
    const original = app.orchestrator.postAs;
    let attempts = 0;
    app.orchestrator.postAs = async (...args) => { if (args[1]?.id === THREAD) { attempts += 1; throw new Error("Slack chat.postMessage -> channel_not_found"); } return original.apply(app.orchestrator, args); };
    try {
      await app.orchestrator.checkEngagements(focus.at + 30 * 60000);
      await app.orchestrator.checkEngagements(focus.at + 31 * 60000);
      await app.orchestrator.checkEngagements(focus.at + 32 * 60000);
    } finally {
      app.orchestrator.postAs = original;
    }
    assert.equal(attempts, 1, "one failed delivery, then it waits");
    assert.ok(app.store.value("conversationEngagements")[THREAD].remindedAt > 0, "the failed question is saved as asked");
  });

  test("a no or a goodbye to the thirty-minute question ends the listening, and the farewell does not restart the count", async () => {
    const THREAD = "1599000000000000796";
    discord.dispatch("THREAD_CREATE", { id: THREAD, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "idle goodbye" });
    await sleep(100);
    replies.set("Olga", () => ({ content: "Resto qui." }));
    const reminders = () => discord.state.webhookPosts.filter((item) => item.channelId === THREAD && /30 minuti/.test(item.content));
    const said = () => discord.state.webhookPosts.filter((item) => item.channelId === THREAD && item.username === "Olga").map((item) => item.content);
    discord.say({ content: "@Olga, ascolta qui", channel: THREAD });
    await waitFor(() => said().length === 1);
    await quiet();
    discord.say({ content: "no grazie, ho capito", channel: THREAD });
    await waitFor(() => said().length === 2);
    await quiet();
    assert.deepEqual(app.orchestrator.engagements[THREAD]?.ids, [olga.id], "a no without the question does not end the listening");
    const focus = app.orchestrator.engagements[THREAD];
    await app.orchestrator.checkEngagements(focus.at + 30 * 60000);
    assert.equal(reminders().length, 1);
    departures = (body) => JSON.parse(body.messages[1].content).reminded ? [olga.id] : [];
    discord.say({ content: "no ciao a dopo", channel: THREAD });
    await waitFor(() => said().includes("Ho smesso di ascoltare questa conversazione."), { what: "Olga leaving" });
    await quiet();
    assert.equal(said().filter((text) => text === "Resto qui.").length, 2, "the goodbye gets no other answer");
    assert.equal(app.orchestrator.engagements[THREAD] || null, null);
    await app.orchestrator.checkEngagements(Date.now() + 90 * 60000);
    assert.equal(reminders().length, 1, "nobody asks again after the goodbye");
  });

  test("closing answers to the idle question persist departure, survive restart and reopen only when called", async () => {
    const THREAD = "1599000000000000803";
    discord.dispatch("THREAD_CREATE", { id: THREAD, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "idle closing answer" });
    await sleep(100);
    const said = () => discord.state.webhookPosts.filter((item) => item.channelId === THREAD && item.username === "Olga").map((item) => item.content);
    replies.set("Olga", () => ({ content: "Ricevuto." }));
    try {
      for (const message of ["si certo ciao", "@Olga ok tutto a posto"]) {
        departures = () => [];
        const before = said().length;
        discord.say({ content: "@Olga controlla questa review", channel: THREAD });
        await waitFor(() => said().length > before);
        await quiet();
        // Outside the idle question, completion acknowledgements keep listening.
        discord.say({ content: "@Olga ok tutto a posto", channel: THREAD });
        await waitFor(() => said().length > before + 1);
        await quiet();
        assert.deepEqual(app.orchestrator.engagements[THREAD]?.ids, [olga.id]);
        await app.orchestrator.checkEngagements(app.orchestrator.engagements[THREAD].at + 30 * 60000);
        const reminders = said().filter((text) => /30 minuti/.test(text)).length;
        const answers = said().filter((text) => text === "Ricevuto.").length;
        departures = (body) => {
          const input = JSON.parse(body.messages[1].content);
          assert.equal(input.reminded, true);
          assert.equal(input.message, message);
          assert.match(input.history.at(-1).content, /Devo rimanere in ascolto/);
          return [olga.id];
        };
        discord.say({ content: message, channel: THREAD });
        await waitFor(() => app.store.value("conversationEngagements")[THREAD] === null);
        await quiet();
        assert.equal(said().at(-1), "Ho smesso di ascoltare questa conversazione.");
        assert.equal(said().filter((text) => text === "Ricevuto.").length, answers, "a closing answer cannot start another model turn");
        app.orchestrator.states.delete(THREAD);
        app.orchestrator.engagements = app.store.value("conversationEngagements");
        await app.orchestrator.checkEngagements(Date.now() + 90 * 60000);
        assert.equal(said().filter((text) => /30 minuti/.test(text)).length, reminders);
        departures = () => [];
        discord.say({ content: "altra nota senza chiamata", channel: THREAD });
        await sleep(1500);
        await quiet();
        assert.equal(app.store.value("conversationEngagements")[THREAD], null);
        assert.equal(said().filter((text) => text === "Ricevuto.").length, answers, "an untagged note cannot reengage the departed listener");
      }
    } finally { departures = null; }
  });

  test("an agent at work is never asked whether it still wants to listen, and its own answers restart the count", async () => {
    const THREAD = "1599000000000000794";
    discord.dispatch("THREAD_CREATE", { id: THREAD, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "idle at work" });
    await sleep(100);
    const reminders = () => discord.state.webhookPosts.filter((item) => item.channelId === THREAD && /30 minuti/.test(item.content));
    let release;
    const working = new Promise((resolve) => { release = resolve; });
    replies.set("Olga", async () => { await working; return { content: "Fatto, ecco il risultato." }; });
    discord.say({ content: "@Olga, guarda la cosa con calma", channel: THREAD });
    await waitFor(() => app.orchestrator.state(THREAD).working?.has(olga.id), { what: "Olga at work" });
    const start = app.orchestrator.engagements[THREAD].at;
    await app.orchestrator.checkEngagements(start + 30 * 60000);
    assert.equal(reminders().length, 0, "a working agent is not asked whether it still listens");
    release();
    await waitFor(() => posts("Olga").filter((text) => text === "Fatto, ecco il risultato.").length === 1, { what: "Olga's result" });
    await quiet();
    const after = app.orchestrator.engagements[THREAD].at;
    assert.ok(after > start, "her own answer restarts the thirty minutes");
    await app.orchestrator.checkEngagements(start + 30 * 60000);
    assert.equal(reminders().length, 0);
    await app.orchestrator.checkEngagements(after + 30 * 60000);
    assert.equal(reminders().length, 1);
  });

  test("work in another conversation does not postpone the thirty-minute question", async () => {
    const IDLE = "1599000000000000797";
    const BUSY = "1599000000000000798";
    discord.dispatch("THREAD_CREATE", { id: IDLE, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "idle elsewhere" });
    discord.dispatch("THREAD_CREATE", { id: BUSY, guild_id: GUILD, parent_id: CHANNEL, type: 11, name: "busy elsewhere" });
    await sleep(100);
    const reminders = () => discord.state.webhookPosts.filter((item) => item.channelId === IDLE && /30 minuti/.test(item.content));
    replies.set("Olga", () => ({ content: "Resto qui." }));
    discord.say({ content: "@Olga, ascolta qui", channel: IDLE });
    await waitFor(() => discord.state.webhookPosts.some((item) => item.channelId === IDLE && item.content === "Resto qui."), { what: "Olga in the idle thread" });
    await quiet();
    const start = app.orchestrator.engagements[IDLE].at;
    let release;
    const working = new Promise((resolve) => { release = resolve; });
    replies.set("Olga", async () => { await working; return { content: "Fatto altrove." }; });
    discord.say({ content: "@Olga, lavora qui con calma", channel: BUSY });
    await waitFor(() => app.orchestrator.state(BUSY).working?.has(olga.id), { what: "Olga at work elsewhere" });
    await app.orchestrator.checkEngagements(start + 30 * 60000);
    assert.equal(reminders().length, 1, "the idle conversation is asked on time even while she works in another one");
    release();
    await waitFor(() => discord.state.webhookPosts.some((item) => item.channelId === BUSY && item.content === "Fatto altrove."), { what: "Olga's result elsewhere" });
    await quiet();
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
    discord.say({ content: "@Olga, ci sei?" });
    await waitFor(() => posts("Olga").includes("Eccomi, dimmi."), { what: "Olga's quick answer" });
    await quiet();
    const afterQuick = discord.state.typing;
    assert.ok(afterQuick > before, "she is shown as typing while she thinks");

    discord.say({ content: "@Olga, allora guarda quella cosa" });
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
        discord.say({ content: "@Olga, anzi controlla anche la cucina" });
        await sleep(1600);
        return { tool_calls: [{ function: { name: "recall", arguments: { query: "cucina" } } }] };
      }
      steered = last.content;
      return { content: "Fatto: ho controllato anche la cucina." };
    });
    discord.say({ content: "@Olga, controlla il salotto" });
    await waitFor(() => posts("Olga").includes("Fatto: ho controllato anche la cucina."), { what: "the steered answer", timeout: 20000 });
    assert.match(steered, /\[Nel frattempo nella chat\][\s\S]*controlla anche la cucina/);
    await quiet();

    let asked = 0;
    replies.set("Pino", (body) => {
      asked += 1;
      return /Hai risposto PASS/.test(lastUserText(body)) ? { content: "Scusa, eccomi." } : { content: "PASS" };
    });
    discord.say({ content: "@Pino, ci sei?" });
    await waitFor(() => posts("Pino").includes("Scusa, eccomi."), { what: "Pino after the retry" });
    assert.equal(asked, 2);
    await quiet();
  });

  test("an agent belongs to a real person of the chats: it asks them, and their word counts as the owner's for it", async (t) => {
    // Who they are comes from what they wrote: the name they last wrote with.
    app.store.appendArchive("owner-seed", { id: "owner-seed-1", at: Date.now(), authorId: STRANGER, authorName: "Sara", kind: "human", agentId: null, content: "ciao" });
    const sara = (await call("/api/agents", { method: "POST", body: { name: "Saretta", model: "ollama/test-model", chattiness: 1, tools: true, channelIds: [CHANNEL], ownerId: `discord:${STRANGER}` } })).data;
    t.after(() => app.store.deleteAgent(sara.id));
    assert.deepEqual(sara.owner, { id: `discord:${STRANGER}`, transport: "discord", userId: STRANGER, name: "Sara" }, "the owner of the space names whose agent it is");
    const panelPerson = (await call("/api/agents", { method: "POST", body: { name: "Nessuna", model: "ollama/test-model", ownerId: "ac_sara0000000001" } })).data;
    t.after(() => app.store.deleteAgent(panelPerson.id));
    assert.equal(panelPerson.ownerId, "", "only a real person of the chats can own an agent");
    assert.equal(panelPerson.owner, null);
    const agent = app.store.agent(sara.id);
    const state = app.orchestrator.state(CHANNEL);
    assert.equal(app.orchestrator.authorized({ kind: "human", authorId: STRANGER }, agent, state), true, "the person it belongs to may put it to work, nobody asked");
    assert.equal(app.orchestrator.authorized({ kind: "human", authorId: "123" }, agent, state), false);
    const olgaAgent = app.store.agent(olga.id);
    assert.equal(app.orchestrator.authorized({ kind: "human", authorId: STRANGER }, olgaAgent, state), false, "but not someone else's agent");
    assert.match(app.brain.systemPrompt(agent, { place: "", computer: true }), /## A chi appartieni\nAppartieni a Sara \(su Discord\)/);
    const before = discord.state.webhookPosts.length;
    await app.orchestrator.askOwner(agent, { question: "Posso usare il desktop per la landing?", choices: ["Sì", "No"] }, { channelId: CHANNEL });
    const asked = discord.state.webhookPosts.slice(before).find((item) => item.username === "Saretta");
    assert.match(asked.content, new RegExp(`^<@${STRANGER}> Posso usare il desktop`), "the question goes to the person it belongs to, not to the owner of the space");
    assert.doesNotMatch(asked.content, new RegExp(`<@${OWNER}>`));
    await quiet();
  });

  test("an agent called where it does not listen: Cora says so, and the owner's button puts it to listen and has it answer", async (t) => {
    const zara = (await call("/api/agents", { method: "POST", body: { name: "Zara", model: "ollama/test-model", chattiness: 1, tools: false, channelIds: [OTHER_CHANNEL] } })).data;
    t.after(() => app.store.deleteAgent(zara.id));
    replies.set("Zara", () => ({ content: "Eccomi, ora vi sento." }));
    const before = discord.state.botPosts.length;
    const asking = discord.say({ content: "@Zara, ci sei?" });
    await waitFor(() => discord.state.botPosts.slice(before).some((item) => item.components), { what: "Cora's offer" });
    const offer = discord.state.botPosts.slice(before).find((item) => item.components);
    assert.equal(offer.channelId, CHANNEL);
    assert.match(offer.content, /\*\*Zara\*\* non è in ascolto in questo canale/);
    const button = offer.components[0].components[0];
    assert.equal(button.label, "Metti Zara in ascolto qui");
    assert.equal(button.custom_id, `cora:listen:${zara.id}:${asking.id}`);
    assert.ok(!posts("Zara").length, "she did not answer: she could not hear");

    discord.say({ content: "@Zara, ci sei?" });
    await sleep(300);
    assert.equal(discord.state.botPosts.slice(before).filter((item) => item.components).length, 1, "asked again soon, Cora does not repeat itself");

    const press = (user) => discord.dispatch("INTERACTION_CREATE", { id: String(Date.now()), token: `tok${user}`, type: 3, channel_id: CHANNEL, guild_id: GUILD, member: { user: { id: user, username: user === OWNER ? "Sam" : "Mallory" } }, data: { custom_id: button.custom_id } });
    press(STRANGER);
    await waitFor(() => discord.state.interactionAnswers.some((answer) => answer.token === `tok${STRANGER}`), { what: "the refusal" });
    const refusal = discord.state.interactionAnswers.find((answer) => answer.token === `tok${STRANGER}`);
    assert.deepEqual([refusal.type, refusal.data.flags], [4, 64], "someone else is told privately that only the owner can");
    assert.deepEqual(app.store.agent(zara.id).channelIds, [OTHER_CHANNEL]);

    press(OWNER);
    await waitFor(() => posts("Zara").includes("Eccomi, ora vi sento."), { what: "Zara answering the message that called her" });
    const done = discord.state.interactionAnswers.find((answer) => answer.token === `tok${OWNER}`);
    assert.equal(done.type, 7, "the offer becomes the outcome");
    assert.match(done.data.content, /Zara\*\* ora è in ascolto qui/);
    assert.deepEqual(done.data.components, []);
    assert.deepEqual(app.store.agent(zara.id).channelIds, [OTHER_CHANNEL, CHANNEL]);
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
    discord.say({ content: "@Olga, fammi una routine di buongiorno nei giorni feriali alle 9" });
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
    discord.say({ content: "@Olga, qual è il codice del cancello?" });
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
    discord.say({ content: "@Olga, controlla le routine finché non è tutto a posto" });
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
    discord.say({ content: "@Pino, mettiti un promemoria ogni mattina", author: STRANGER, username: "Ospite" });
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
        discord.say({ content: "@Olga, fermati" });
        return { tool_calls: [{ function: { name: "list_routines", arguments: { pass: 1 } } }] };
      }
      if (calls === 2) return { tool_calls: [{ function: { name: "list_routines", arguments: { pass: 2 } } }] };
      return { content: "Ero a metà: controllati 2 file su 10." };
    });
    discord.say({ content: "@Olga, controlla tutti i file" });
    await waitFor(() => posts("Olga").includes("Mi fermo qui."), { what: "Olga stopping", timeout: 25000 });
    await quiet();
    assert.ok(calls <= 2 || refusals.length >= 1, "the turn is aborted or its subsequent tools are refused");
    assert.equal(checked, 0, "the goal never sends it back once it has been told to stop");
    assert.ok(calls < 6, `it stopped instead of going on (${calls} calls)`);
  });

  test("the owner's next words preserve the full revised goal without publishing it as completed work", async (t) => {
    await call("/api/settings", { method: "PUT", body: { goalMode: true } });
    t.after(() => call("/api/settings", { method: "PUT", body: { goalMode: false } }));
    const revisedGoal = "Il report è su Telegram per tutti i destinatari già autorizzati, con gli allegati approvati, i dati aggiornati e verificati, i collegamenti pubblici funzionanti e il riepilogo delle modifiche richieste. Gli invii già riusciti non sono ripetuti, gli accessi privati restano riservati e ogni eventuale errore viene recuperato prima della chiusura, con la conferma finale di ricezione da tutti i destinatari.";
    const asked = [];
    goals = (body) => {
      const text = String(body.messages[1].content);
      asked.push(text);
      return /Poi il proprietario ha detto/.test(text) ? revisedGoal : "il report è via email";
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
        discord.say({ content: "@Olga, anzi mandalo su Telegram non via email" });
        return { tool_calls: [{ function: { name: "list_routines", arguments: {} } }] };
      }
      return { content: "Mandato su Telegram." };
    });
    discord.say({ content: "@Olga, manda il report" });
    await waitFor(() => posts("Olga").includes("Mandato su Telegram."), { what: "Olga's answer", timeout: 25000 });
    await quiet();
    assert.ok(asked.some((text) => /Poi il proprietario ha detto[\s\S]*Telegram/.test(text)), "the goal is rewritten from what they said next");
    assert.ok(posts("Olga").includes("Ricevuto, aggiorno il compito con le nuove indicazioni e proseguo."), "the acknowledgement is complete and does not claim the revised goal is already met");
    assert.ok(!posts("Olga").some((text) => text.startsWith("Cambio obiettivo:") || text.includes(revisedGoal)), "internal completion criteria are not published as progress");
    assert.ok(judged.some((text) => text.includes(revisedGoal)), "the verifier retains the entire goal, including requirements after character 300");
  });

  test("with goal mode off nobody writes a goal and nobody checks one", async () => {
    let asked = false;
    goals = () => { asked = true; return "una condizione qualsiasi"; };
    checks = () => { asked = true; return JSON.stringify({ met: false, reason: "no" }); };
    replies.set("Olga", () => ({ content: "Fatto e basta." }));
    discord.say({ content: "@Olga, guarda una cosa" });
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
    discord.say({ content: "@Olga, fai il deploy e verificalo" });
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
    discord.say({ content: "@Olga, guarda le routine" });
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
    discord.say({ content: "@Olga, controlla di nuovo le routine" });
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
    discord.say({ content: "@Olga, fai il lavoro lungo" });
    await waitFor(() => calls === 1, { what: "Olga starting her task" });
    await sleep(500);
    discord.say({ content: "@Pino, ci sei?" });
    await waitFor(() => posts("Pino").includes("Ci sono io."), { what: "Pino answering while Olga works" });
    assert.ok(!posts("Olga").includes("Lavoro lungo finito, con la nota sulla cucina."), "Olga is still on her task");
    discord.say({ content: "@Olga, aggiungi anche la cucina" });
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
    discord.say({ content: "@Olga, controlla le routine" });
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
    cli.set({ reply: "Routine controllate con Hermes.", tool: "list_routines", thinking: "Guardo le routine di Olga.", hermesFinalThought: "Le routine ci sono: rispondo." });
    discord.say({ content: "@Olga, controlla le routine con Hermes" });
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
    assert.ok(run.argv.includes("--usage-file"), "Hermes reports the session it recorded");
    const [summary] = (await call(`/api/agents/${olga.id}/traces`)).data;
    const steps = (await call(`/api/traces/${summary.id}`)).data.steps;
    const first = steps.slice(0, steps.findIndex((step) => step.type === "note"));
    assert.deepEqual(first.map((step) => [step.type, step.name || step.text]), [
      ["thinking", "Guardo le routine di Olga."], ["text", "Prima controllo."], ["tool", "list_routines"], ["thinking", "Le routine ci sono: rispondo."],
    ], "Hermes' thoughts arrive readable from the session it records, each before the tool it led to");
    assert.ok(steps.some((step) => step.type === "text" && step.text === "Prima controllo."), "the text between tool calls is a step");
    assert.ok(!steps.some((step) => step.type === "text" && step.text.startsWith("Routine controllate con Hermes.")), "the answer is not repeated as a step");
    assert.equal(steps.find((step) => step.type === "tool").name, "list_routines");

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
    discord.say({ content: "@Olga, ricordati che la riunione con i fornitori è giovedì" });
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
    discord.say({ content: "@Olga, prepara il report sul desktop" });
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
    discord.say({ content: "@Olga, salva un riepilogo delle routine sul desktop" });
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
    discord.say({ content: "@Olga, ciao!" });
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
    discord.say({ content: "@Olga, che routine ho?" });
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
    discord.say({ content: "@Olga, prova il router" });
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

  test("when a provider refuses Hermes and Hermes still exits 0, the refusal is a failed turn and never the agent's words", async (t) => {
    await call("/api/state");
    assert.equal((await call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "hermes/test-model" } })).status, 200);
    t.after(() => call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "ollama/test-model" } }));
    cli.set({ reply: "Mai detto.", hermesRefusal: "Billing or credits exhausted: HTTP 429: you have reached your monthly usage limit" });
    discord.say({ content: "@Olga, ci sei?" });
    await waitFor(() => posts("Olga").some((text) => text.includes("non riesco a rispondere")), { what: "Olga reporting the failure" });
    await quiet();
    assert.ok(posts("Olga").filter((text) => /Billing or credits/i.test(text)).every((text) => text.startsWith("(non riesco a rispondere")),
      "the provider's refusal only appears as Cora's failure notice, never as the agent's own words");
    const trace = (await call(`/api/agents/${olga.id}/traces`)).data.find((item) => item.status === "error");
    assert.match(trace.error, /Billing or credits exhausted/);
  });

  test("when Hermes answers that the model gave it no content, the agent fails openly instead of saying that banner", async (t) => {
    await call("/api/state");
    assert.equal((await call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "hermes/test-model" } })).status, 200);
    t.after(() => call(`/api/agents/${olga.id}`, { method: "PUT", body: { model: "ollama/test-model" } }));
    cli.set({ reply: "⚠️ No reply: the model returned empty content after retries and any fallback providers. Try `continue`, switch model/provider, or inspect the tool output above." });
    discord.say({ content: "@Olga, a che punto sei?" });
    await waitFor(() => posts("Olga").some((text) => text.includes("non riesco a rispondere")), { what: "Olga reporting the failure" });
    await quiet();
    assert.ok(!posts("Olga").some((text) => /No reply/i.test(text)), "Hermes' banner is never posted as the agent's own words");
    const trace = (await call(`/api/agents/${olga.id}/traces`)).data.find((item) => item.status === "error");
    assert.equal(trace.status, "error");
    assert.match(trace.error, /test-model returned no content/);
  });

  test("an agent without its computer is told to ask the owner instead of passing when someone else wants work done", async () => {
    let system = "";
    let request = "";
    replies.set("Olga", (body) => {
      system = String(body.messages[0].content);
      request = lastUserText(body);
      assert.ok(!body.tools.some(tool => tool.function.name === "shell"));
      return { content: "Serve il via libera di Sam: glielo chiedo." };
    });
    discord.say({ content: "@Olga, mi sistemi il sito?", author: STRANGER, username: "Ospite" });
    await waitFor(() => posts("Olga").includes("Serve il via libera di Sam: glielo chiedo."), { what: "Olga answering a guest" });
    assert.match(system, /gli strumenti per usarlo non sono disponibili in questo turno[\s\S]*ask_owner/);
    assert.match(system, /Non esiste un interruttore del computer per il singolo gruppo/);
    assert.match(request, new RegExp(`Cora non ha autorizzato l'account discord:${STRANGER}`));
    assert.match(request, /non lo stato acceso\/spento del desktop/);
    await quiet();
  });

  test("an agent speaks of itself in its own gender, and an unknown gender is none", async () => {
    let system = "";
    replies.set("Olga", (body) => {
      system = String(body.messages[0].content);
      return { content: `Eccomi (${/genere femminile/.test(system) ? "lei" : /Non hai un genere/.test(system) ? "neutro" : "?"}).` };
    });
    await call(`/api/agents/${olga.id}`, { method: "PUT", body: { gender: "female" } });
    discord.say({ content: "@Olga, sei pronta?" });
    await waitFor(() => posts("Olga").includes("Eccomi (lei)."), { what: "Olga answering as herself" });
    assert.match(system, /non sei legata a nessuna piattaforma[\s\S]*Sei sempre accesa/);
    await quiet();
    await call(`/api/agents/${olga.id}`, { method: "PUT", body: { gender: "neutral" } });
    discord.say({ content: "@Olga, ci sei?" });
    await waitFor(() => posts("Olga").includes("Eccomi (neutro)."), { what: "Olga answering with no gender" });
    assert.match(system, /Sei sempre in ascolto/);
    assert.doesNotMatch(system, /Sei sempre acces[oa]/);
    await quiet();
    assert.equal((await call(`/api/agents/${olga.id}`, { method: "PUT", body: { gender: "robot" } })).data.gender, "", "an unknown gender is no gender");
  });

  test("after a restart the first message is answered, messages written while down are picked up, and a bot can call an agent by name", async () => {
    replies.set("Olga", (body) => ({ content: `Ok: ${lastChatLine(body).split(": ").pop()}` }));
    replies.set("Pino", () => ({ content: "Pino qui." }));
    app.orchestrator.states.delete(CHANNEL);
    discord.say({ content: "@Olga, primo messaggio dopo il riavvio" });
    await waitFor(() => posts("Olga").includes("Ok: @Olga, primo messaggio dopo il riavvio"), { what: "the first message after a restart" });
    await quiet();

    discord.offline = true;
    discord.say({ content: "@Olga, ti scrivo mentre sei spenta" });
    discord.offline = false;
    await app.orchestrator.catchUp();
    await waitFor(() => posts("Olga").includes("Ok: @Olga, ti scrivo mentre sei spenta"), { what: "the message written while down" });
    await quiet();
    const before = posts("Olga").length;
    await app.orchestrator.catchUp();
    await sleep(1500);
    assert.equal(posts("Olga").length, before, "a message already answered is not answered twice");

    discord.say({ content: "@Olga, qui GROG, mi senti?", bot: true, author: "700000000000000009", username: "GROG" });
    await waitFor(() => posts("Olga").includes("Ok: @Olga, qui GROG, mi senti?"), { what: "Olga answering a bot" });
    await quiet();
    discord.offline = true;
    discord.say({ content: "@Olga, qui GROG di nuovo, mentre eri spenta", bot: true, author: "700000000000000009", username: "GROG" });
    discord.offline = false;
    await app.orchestrator.catchUp();
    await waitFor(() => posts("Olga").includes("Ok: @Olga, qui GROG di nuovo, mentre eri spenta"), { what: "a bot's call picked up after a restart" });
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
    discord.say({ content: "@Ugo2, pensaci bene" });
    await waitFor(() => posts("Ugo2").length, { what: "Ugo2" });
    const claude = cli.calls().reverse().find((item) => item.flavor === "claude");
    assert.equal(claude.argv[claude.argv.indexOf("--effort") + 1], "high");
    await quiet();
    await call(`/api/agents/${created.data.id}`, { method: "PUT", body: { model: "codex/gpt-6-sol", subscriptionId: subscriptionIds.codex, effort: "low" } });
    discord.say({ content: "@Ugo2, e adesso?" });
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
    fake.say({ content: "@Zeno, mi senti?" });
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
    fake.sayTo({ botUserId: VALE, channel: PRIVATE, content: "@Vale, ci sei?" });
    const post = await waitFor(() => fake.state.botPosts.find((item) => item.content === "Ci sono, nel canale privato."), { what: "Vale answering in the private channel" });
    assert.equal(post.channelId, PRIVATE);
    assert.equal(post.token, "vale-token", "she answers with her own bot");
    await sleep(800);
    assert.equal(fake.state.botPosts.filter((item) => item.content === "Ci sono, nel canale privato.").length, 1);

    // A public channel every bot hears: the same message must still get a single answer.
    fake.say({ content: "@Vale, e qui?", channel: CHANNEL });
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
    // Both named, but only Pia's bot can read the channel: Vale, called as she is, stays out.
    fake.say({ channel: SHARED, content: "@Pia e @Vale, analizziamo questo documento" });
    await waitFor(() => fake.state.botPosts.some((item) => item.channelId === SHARED && item.content === "Leggo io il documento nel mio canale."), { what: "only the agent able to read the listener's channel responding" });
    assert.equal(unexpected, 0, "the main listener's access never admits an absent colleague");
    assert.ok(!fake.state.webhookPosts.some((item) => item.channelId === SHARED && item.username === "Vale"));
  });
  test("a thread only an agent's bot can see is still a thread: nobody called, nobody answers, a bot naming the agent in passing calls nobody, and its people get real tags", async (t) => {
    const fake = await fakeDiscord();
    const PIA = "600000000000000040";
    const VALE = "600000000000000041";
    const GROG = "600000000000000049";
    fake.state.botUsers.set("pia-token", { id: PIA, username: "Pia", appFlags: 1 << 19 });
    fake.state.botUsers.set("vale-token", { id: VALE, username: "Vale", appFlags: 1 << 19 });
    const PRIVATE = "1599000000000000910";
    const THREAD = "1599000000000000911";
    fake.state.privateTo.set(PRIVATE, "vale-token");
    fake.state.privateTo.set(THREAD, "vale-token");
    const otherHome = tempHome();
    const seed = new Store(otherHome);
    seed.updateSettings({ guildIds: [GUILD] });
    const pia = seed.createAgent({ name: "Pia", model: "ollama/test-model", chattiness: 1, tools: false });
    const vale = seed.createAgent({ name: "Vale", model: "ollama/test-model", chattiness: 1, tools: false });
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
    // The thread opens under a channel only Vale's bot is in: only her connection hears about it.
    fake.dispatchTo(VALE, "THREAD_CREATE", { id: THREAD, guild_id: GUILD, parent_id: PRIVATE, type: 11, name: "REF-9" });
    await waitFor(() => other.channels.info(THREAD).parentId === PRIVATE, { what: "the thread known through the bot that is in it" });
    assert.equal(other.channels.info(THREAD).name, "REF-9");

    let spoke = 0;
    replies.set("Vale", () => { spoke += 1; return { content: "Mi intrometto." }; });
    replies.set("Pia", () => { spoke += 1; return { content: "Anche io." }; });
    // The owner talks to someone else in the thread, then another bot names Vale in passing.
    fake.sayTo({ botUserId: VALE, channel: THREAD, content: "ok, fai un controllo preciso del codice e vedi se ci siamo scordati altro" });
    await sleep(2500);
    fake.sayTo({ botUserId: VALE, channel: THREAD, author: GROG, username: "GROG", bot: true, content: "Ho letto lo stop rivolto a Vale e la sua conferma: proseguo io." });
    await sleep(2500);
    await waitFor(() => other.orchestrator.quiet(), { what: "nobody working", timeout: 30000 });
    assert.equal(spoke, 0, "nobody called directly, nobody speaks, chatty as they are");
    assert.ok(!fake.state.botPosts.some((item) => item.channelId === THREAD));

    // Called directly she answers in the thread with her own bot, and her @GROG and @Sam are real tags.
    replies.set("Vale", () => ({ content: "Ok @GROG, ci sono. @Sam, dimmi tu da dove parto." }));
    fake.sayTo({ botUserId: VALE, channel: THREAD, content: "@Vale, ci sei?" });
    const post = await waitFor(() => fake.state.botPosts.find((item) => item.channelId === THREAD), { what: "Vale answering in the thread", timeout: 30000 });
    assert.equal(post.token, "vale-token");
    assert.equal(post.content, `Ok <@${GROG}>, ci sono. <@${OWNER}>, dimmi tu da dove parto.`);
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
    fake.dm({ botUserId: DINA, content: "Ciao @Dina, ci sei?" });
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

describe("harness recovery", () => {
  async function fixture(t, { restart = true, twice = false, startup = false, pendingDecision = null, delegated = false } = {}) {
    const settings = app.store.settings;
    app.store.updateSettings({ goalMode: true, decisionModel: "ollama/test-model", decisionBackups: [] });
    goals = () => "Il record di prova è aggiornato e verificato.";
    const agent = app.store.createAgent({ name: "Recovery fixture", model: "codex/test-model", subscriptionId: subscriptionIds.codex, tools: true, chattiness: 0 });
    const channelId = `web-${agent.id}`;
    const original = app.boxes.shell;
    let writes = 0, decisions = 0, decisionInput;
    app.boxes.shell = async (id, command) => {
      assert.equal(id, agent.id);
      if (command === "fixture-write") { writes += 1; return { code: 0, output: "WRITE_RECEIPT_123" }; }
      return { code: 0, output: "READ_RECEIPT_123" };
    };
    const from = cli.calls().filter((item) => item.flavor === "codex").length;
    cli.set({ from, runs: [
      { tool: startup ? null : "shell", args: { command: "fixture-write" }, killAfterTool: !startup, exitBeforeReply: startup ? 1 : 0, reply: "" },
      { tool: twice ? null : "shell", args: { command: "fixture-read" }, killAfterTool: twice, reply: "Verifica completata." },
    ] });
    replies.set("*", async (body) => {
      if (!body.messages[0].content.startsWith("Decidi se sostituire un harness")) return { content: "PASS" };
      decisions += 1;
      decisionInput = JSON.parse(body.messages[1].content);
      if (pendingDecision) await pendingDecision();
      return { content: typeof restart === "boolean" ? JSON.stringify({ restart, reason: restart ? "Processo interrotto, lavoro ancora aperto." : "Serve un intervento del proprietario." }) : restart };
    });
    t.after(() => {
      app.boxes.shell = original; app.store.deleteAgent(agent.id); cli.set({ reply: "ok" });
      app.store.updateSettings({ goalMode: settings.goalMode, decisionModel: settings.decisionModel, decisionBackups: settings.decisionBackups });
    });
    const history = [{ id: "recovery-owner", at: Date.now(), kind: "owner", authorId: OWNER, authorName: "Seb", content: "Aggiorna il record di prova e verifica.",
      ...(delegated ? { kind: "agent", authorId: null, authorName: "Requester", agentId: "ag_requester", delegated: true } : {}),
    }];
    const notices = [];
    const run = () => app.orchestrator.withSession(agent, channelId, "chat", () => app.brain.chatTurn({ agent, channel: { id: channelId, name: "Recovery" }, history, replyTo: history[0], computer: true, forced: true, say: async (text) => notices.push(text) }));
    return { agent, channelId, run, notices, calls: () => cli.calls().filter((item) => item.flavor === "codex").slice(from), evidence: () => ({ writes, decisions, decisionInput }) };
  }

  test("a real CLI signal after a successful write reaches the decider and resumes with the receipt", async (t) => {
    const f = await fixture(t);
    const result = await f.run();
    assert.match(result.value.text, /Verifica completata/);
    const { writes, decisions, decisionInput } = f.evidence();
    assert.equal(writes, 1); assert.equal(decisions, 1);
    assert.equal(decisionInput.failure.exitCode, null); assert.equal(decisionInput.failure.signal, "SIGTERM");
    assert.ok(decisionInput.steps.some((step) => step.name === "shell" && step.result.includes("WRITE_RECEIPT_123")));
    assert.equal(f.calls().length, 2);
    assert.match(f.calls()[1].stdin, /WRITE_RECEIPT_123/);
    assert.match(f.calls()[1].stdin, /senza ripetere invii o modifiche già riusciti/);
    const rows = app.store.threadSessions().filter((row) => row.channelId === f.channelId);
    const first = rows.find((row) => row.status === "error"), next = rows.find((row) => row.status === "done");
    assert.ok(first); assert.ok(next); assert.equal(next.replaces, first.id);
    assert.equal(first.traceId, result.value.traceId); assert.equal(next.traceId, result.value.traceId);
    assert.equal(app.store.activeThreadSession(f.agent.id, f.channelId), null);
    assert.equal(f.notices.length, 1);
    assert.equal(app.store.trace(result.value.traceId).steps.find((step) => step.harnessFailure)?.harnessFailure.signal, "SIGTERM");
  });

  test("a recovered delegation retains its requester in the persisted resume instructions", async (t) => {
    const f = await fixture(t, { delegated: true });
    const result = await f.run();
    const saved = app.store.trace(result.value.traceId).steps.findLast((step) => step.replyTo)?.replyTo;
    assert.equal(saved.kind, "agent");
    assert.equal(saved.agentId, "ag_requester");
    assert.equal(saved.delegated, true);
    assert.equal(saved.handoffResult, false);
    assert.equal(saved.content, "Aggiorna il record di prova e verifica.");
    assert.equal(f.evidence().writes, 1);
    assert.equal(f.calls().length, 2);
  });

  test("a numeric startup exit reaches the decider without hidden CLI retries", async (t) => {
    const f = await fixture(t, { startup: true });
    await f.run();
    assert.equal(f.calls().length, 2);
    assert.equal(f.evidence().decisions, 1);
    assert.equal(f.evidence().writes, 0);
    assert.equal(f.evidence().decisionInput.failure.exitCode, 1);
  });

  test("the decider can refuse replacement", async (t) => {
    const f = await fixture(t, { restart: false });
    await assert.rejects(f.run, /exited with null/);
    assert.equal(f.calls().length, 1); assert.equal(f.evidence().decisions, 1);
    assert.equal(app.store.threadSessions().filter((row) => row.channelId === f.channelId).length, 1);
    const row = app.store.threadSessions().find((row) => row.channelId === f.channelId);
    assert.ok(row.traceId); assert.equal(row.status, "error");
  });

  test("an invalid decision fails closed", async (t) => {
    const f = await fixture(t, { restart: "not JSON" });
    await assert.rejects(f.run, /exited with null/);
    assert.equal(f.calls().length, 1); assert.equal(f.evidence().decisions, 1);
  });

  test("a second harness failure cannot create a third instance", async (t) => {
    const f = await fixture(t, { twice: true });
    await assert.rejects(f.run, /exited with null/);
    assert.equal(f.calls().length, 2); assert.equal(f.evidence().decisions, 1);
    assert.equal(app.store.threadSessions().filter((row) => row.channelId === f.channelId).length, 2);
    assert.equal(app.store.activeThreadSession(f.agent.id, f.channelId), null);
  });

  test("panel stop while the decider is answering prevents the replacement", async (t) => {
    let release, entered;
    const started = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const f = await fixture(t, { pendingDecision: async () => { entered(); await gate; } });
    const running = f.run();
    await started;
    app.orchestrator.stopThread(f.channelId, f.agent.id);
    release(); const result = await running;
    assert.equal(result.value.stopped, true);
    assert.equal(f.calls().length, 1);
    const rows = app.store.threadSessions().filter((row) => row.channelId === f.channelId);
    assert.equal(rows.length, 1); assert.equal(rows[0].status, "stopped");
  });
});

test("thread privacy enforces ownership for live traces, full history and a revoked co-owner", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  const agent = f.app.store.createAgent({ name: "Private history", brainOwnerId: f.bob.user.id, coOwnerIds: [f.alice.user.id] });
  const id = "155500000000000711";
  const trace = f.app.brain.traces.start({ agentId: agent.id, kind: "chat", channelId: id });
  trace.add({ type: "thinking", text: "PRIVATE_REASONING_SENTINEL" });
  const session = f.app.orchestrator.sessions.begin({ agentId: agent.id, channelId: id, kind: "chat" });
  assert.equal((await f.request(f.alice, `/api/threads/${id}`)).data.traces[0].steps[0].text, "PRIVATE_REASONING_SENTINEL");
  f.app.store.updateAgent(agent.id, { coOwnerIds: [] });
  for (const actor of [f.alice, f.admin]) {
    assert.equal((await f.request(actor, `/api/threads/${id}`)).status, 404);
    assert.doesNotMatch(JSON.stringify((await f.request(actor, "/api/threads")).data), /Private history|PRIVATE_REASONING_SENTINEL/);
  }
  trace.finish({ status: "done", output: "PRIVATE_RESULT_SENTINEL" });
  f.app.orchestrator.sessions.finish(session);
  assert.equal((await f.request(f.bob, `/api/threads/${id}`)).data.traces[0].output, "PRIVATE_RESULT_SENTINEL");
  assert.equal((await f.request(f.alice, `/api/threads/${id}`)).status, 404);
});

test("Hermes automatically restarts a failed argument launch through stdin before any tool runs", async () => {
  const native = fakeCli(), root = tempHome(), notes = [];
  native.set({ reply: "Ripresa riuscita." });
  const original = childProcess.spawn;
  childProcess.spawn = (...args) => {
    childProcess.spawn = original;
    syncBuiltinESMExports();
    throw Object.assign(new Error("spawn E2BIG"), { code: "E2BIG" });
  };
  syncBuiltinESMExports();
  try {
    const result = await runHermes({ bin: native.hermes, model: "fixture", system: "Owner instructions", prompt: "Continue the current task.",
      toolNames: [], workDir: join(root, "work"), home: join(root, "hermes"),
      baseUrl: "http://127.0.0.1:1/v1", timeoutMs: 10000, onStep: (step) => notes.push(step) });
    assert.equal(result.text, "Ripresa riuscita.");
    assert.equal(native.calls().length, 1, "the failed launch never started the CLI or a tool");
    assert.ok(native.calls()[0].argv.includes("--query-file"));
    assert.ok(notes.some((step) => step.type === "note" && /riparto/.test(step.text)));
  } finally {
    childProcess.spawn = original;
    syncBuiltinESMExports();
  }
});

test("Hermes carries oversized Unicode context intact without placing it in argv", async () => {
  const native = fakeCli(), root = tempHome();
  native.set({ reply: "Contesto ricevuto.", thinking: "Controllo il contesto completo.", hermesWarning: "Runtime warning that is not the assistant answer." });
  const system = "Owner instructions: keep every character.\n";
  const prompt = "à雪🙂\n".repeat(100000) + "FINAL_CONTEXT_MARKER";
  const steps = [];
  const result = await runHermes({ bin: native.hermes, model: "fixture", system, prompt,
    toolNames: [], workDir: join(root, "work"), home: join(root, "hermes"),
    baseUrl: "http://127.0.0.1:1/v1", timeoutMs: 10000, onStep: (step) => steps.push(step) });
  assert.equal(result.text, "Contesto ricevuto.");
  const run = native.calls().find((item) => item.flavor === "hermes");
  assert.ok(run.stdin === system + "\n\n---\n\n" + prompt, "the full Unicode prompt arrives unchanged");
  assert.ok(run.argv.every((arg) => Buffer.byteLength(arg) < 65536));
  assert.ok(steps.some((step) => step.type === "thinking" && step.text === "Controllo il contesto completo."));
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

  test("creating an agent skips initial Brain setup and keeps configuration in the saved agent tab", async (t) => {
    const signedIn = await call("/api/login", { method: "POST", body: { password: PASSWORD }, auth: false });
    const session = signedIn.headers.get("set-cookie").split(";")[0];
    const panel = panelHarness({ language: "en", fetch: (path, options) => fetch(`${base}${path}`, { ...options, headers: { ...options?.headers, Cookie: session } }) });
    panel.run('globalThis.crypto = { randomUUID: () => "fixture-new-agent" }');
    await panel.run("boot()");
    await panel.navigate("#/new");
    const form = panel.app.querySelector("form");
    assert.ok(form);
    assert.equal(form.elements.model, undefined);
    assert.equal(form.elements.subscriptionId, undefined);
    assert.doesNotMatch(form.textContent, /Connect an account|Harness|Reasoning/);
    form.elements.name.value = "No Brain Setup";
    form.dispatch("submit");
    const agent = await waitFor(() => app.store.agents().find((item) => item.name === "No Brain Setup"));
    t.after(() => app.store.deleteAgent(agent.id));
    assert.equal(agent.model, "");
    assert.equal(agent.tools, true);
    await waitFor(() => panel.run(`S.data.agents.some((item) => item.id === "${agent.id}")`));
    await panel.navigate(`#/agent/${agent.id}/cervello`);
    await waitFor(() => panel.app.querySelector(".brain-harness"));
    assert.ok(panel.app.textContent.includes("Claude Code"));
  });

  test("the brain workspace saves model choices across reasoning and computer sections", async () => {
    const signedIn = await call("/api/login", { method: "POST", body: { password: PASSWORD }, auth: false });
    const session = signedIn.headers.get("set-cookie").split(";")[0];
    // It starts in the cloud, so a save that changed nothing could not pass for one that did.
    const agent = app.store.createAgent({ name: "Cervellone", model: "ollama/test-model-big:cloud", tools: false, chattiness: 0 });
    const panel = panelHarness({ language: "en", fetch: (path, options) => fetch(`${base}${path}`, { ...options, headers: { ...options?.headers, Cookie: session } }) });
    await panel.run("boot()");
    await panel.navigate(`#/agent/${agent.id}/cervello`);
    await waitFor(() => panel.app.querySelector(".brain-harness"));
    assert.deepEqual(panel.app.querySelector(".brain-harness").querySelectorAll("option").map((node) => node.textContent),
      ["Cora's harness", "Claude Code", "Codex", "Grok Build", "Muse Code", "Antigravity CLI", "Hermes", "DeepSeek Harness"]);
    const sections = panel.app.querySelector(".email-workspace-nav").querySelectorAll("button");
    assert.deepEqual(sections.map((node) => node.querySelector("b").textContent), ["Model and account", "Reasoning", "Computer"]);
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
    sections[1].click();
    panel.app.querySelector("form").elements.effort.value = "high";
    sections[2].click();
    panel.app.querySelector("form").elements.tools.checked = true;
    sections[0].click();
    assert.equal(panel.app.querySelector("form").elements.model.value, "ollama/test-model");
    const saveForm = panel.app.querySelector("form");
    saveForm.dispatch("submit");
    await waitFor(() => app.store.agent(agent.id).model === "ollama/test-model");
    assert.equal(app.store.agent(agent.id).effort, "high");
    assert.equal(app.store.agent(agent.id).tools, true);
    assert.equal(app.store.agent(agent.id).name, "Cervellone", "the profile is a different tab and a different save");
    await waitFor(() => panel.app.querySelector("form") !== saveForm);
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
    await waitFor(() => panel.app.querySelector(".brain-harness"));
    const side = () => panel.app.querySelector(".brain-side");
    const harness = panel.app.querySelector(".brain-harness").querySelector("select");
    const row = (name) => harness.querySelectorAll("option").find((node) => node.textContent.startsWith(name));
    const choose = (key) => { harness.value = key; harness.dispatch("change"); };
    assert.equal(row("Cora's harness").textContent, "Cora's harness", "a missing router does not make Cora's harness missing");
    for (const name of ["Codex", "Grok Build", "Antigravity CLI", "DeepSeek Harness"]) assert.match(row(name).textContent, /not installed/);

    // Its own cloud: listed, but not choosable, and the default that points there neither.
    panel.app.querySelector(".segmented").children[1].click();
    assert.match(side().querySelector(".notice").textContent, /Ollama Cloud is not connected/);
    assert.ok(side().querySelectorAll(".model-row").every((node) => "disabled" in node.attributes));
    const fallback = side().querySelectorAll(".model-row").find((node) => node.textContent.startsWith("The instance default"));
    assert.equal(fallback.attributes.title, "is not among this machine's models", "a default that is not here is said to be not here");

    // Claude Code opens on one of its own models, never on Cora's default.
    choose("claude");
    const chosen = side().querySelectorAll(".model-row").find((node) => node.className.split(" ").includes("on"));
    assert.equal(chosen.querySelector(".row-title").textContent.replace("chosen", ""), "Sonnet 5.5");

    // Codex is not here: what it needs, no list to pick from, and no save.
    choose("codex");
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
    telegram.push(group(seb, "@Tina, ci sei?"));
    await waitFor(() => app.telegram.chats.has(TG_GROUP), { what: "the chat to be seen" });
    await sleep(1500);
    assert.equal(telegram.state.sent.length, 0, "a chat that is not allowed is ignored");
    assert.equal((await call("/api/state")).data.telegram.chats.find((chat) => chat.id === TG_GROUP).title, "La banda");

    await call("/api/settings", { method: "PUT", body: { telegramChatIds: [TG_GROUP] } });
    const channels = (await call("/api/state")).data.channels;
    assert.deepEqual(channels.map((channel) => [channel.id, channel.name, channel.kind]), [[`tg:${TG_GROUP}`, "La banda", "telegram"]]);
    telegram.push(group(seb, "@Tina, ci sei?"));
    const sent = await waitFor(() => telegram.state.sent.find((item) => item.method === "sendMessage"), { what: "Tina's reply" });
    assert.equal(sent.token, MAIN_TG);
    assert.equal(sent.chat_id, TG_GROUP);
    assert.equal(sent.parse_mode, "HTML");
    assert.equal(sent.text, "<b>Tina</b>\nCiao da Telegram! &lt;3");
    assert.deepEqual(app.store.settings.telegramOwnerIds, [TG_OWNER]);
    assert.match(tgPrompt, /Ultimi messaggi nella chat Telegram "La banda"/);
    assert.match(tgPrompt, /Seb ★: @Tina, ci sei\?/);
    const [summary] = (await call(`/api/agents/${tina.id}/traces`)).data;
    const trace = (await call(`/api/traces/${summary.id}`)).data;
    assert.match(trace.system, /In questo momento parlate su Telegram, nel gruppo "La banda"\./);
    assert.doesNotMatch(trace.system, /server Discord/);
    await quiet();

    telegram.push({ chat: { id: Number(TG_OTHER_GROUP), type: "group", title: "Altro" }, from: seb, text: "@Tina?" });
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

  test("Telegram group setup checks live privacy, membership and listening, then requires a human probe and its delivered reply", async () => {
    const path = `/api/agents/${tina.id}/telegram-setup`;
    const groupPath = `${path}?chatId=${TG_GROUP}`;
    const user = telegram.state.bots.get(TINA_TG);
    const memberKey = `${TG_GROUP}:2222222`;
    const original = { ...app.store.agent(tina.id) };
    let release;
    const replyGate = new Promise((resolve) => { release = resolve; });
    try {
      assert.equal((await call(groupPath, { auth: false })).status, 401);
      assert.equal((await call("/api/agents/ag_missing/telegram-setup")).status, 404);
      assert.equal((await call(`${path}?chatId=-987654321`)).status, 400, "unknown chats cannot be inspected through the bot");
      assert.equal((await call(groupPath, { method: "POST" })).status, 405, "checking never writes or sends a message");
      const unselected = (await call(path)).data;
      assert.ok(unselected.groups.some((chat) => chat.id === TG_GROUP));
      assert.equal(unselected.group, null);
      assert.equal(unselected.probe.state, "not-started");

      let checked = (await call(groupPath)).data;
      assert.equal(checked.bot.state, "ready");
      assert.equal(checked.bot.privacyDisabled, false);
      assert.equal(checked.group.member, true);
      assert.ok(Object.values(checked.listening).every(Boolean));
      assert.doesNotMatch(JSON.stringify(checked), new RegExp(TINA_TG));

      telegram.state.bots.set(TINA_TG, { ...user, can_read_all_group_messages: true });
      assert.equal((await call(groupPath)).data.bot.privacyDisabled, true, "a BotFather change is read live, not from the ready event or membership cache");
      telegram.state.memberStates.set(memberKey, { status: "administrator" });
      assert.equal((await call(groupPath)).data.group.role, "administrator", "administrators are identified for the privacy alternative");
      telegram.state.memberStates.set(memberKey, { status: "restricted", is_member: true, can_send_messages: false });
      assert.equal((await call(groupPath)).data.group.canSend, false);
      telegram.state.memberStates.set(memberKey, { status: "left" });
      assert.equal((await call(groupPath)).data.group.member, false);
      telegram.state.memberStates.delete(memberKey);

      telegram.state.errors.set(`${TINA_TG}:getChatMember`, { status: 400, description: `provider body ${TINA_TG}` });
      checked = (await call(groupPath)).data;
      assert.equal(checked.group.member, null, "an unavailable check is not a successful membership check");
      assert.doesNotMatch(JSON.stringify(checked), /provider body|AAtinatinatina/);
      telegram.state.errors.delete(`${TINA_TG}:getChatMember`);
      telegram.state.errors.set(`${TINA_TG}:getMe`, { status: 401, description: `provider body ${TINA_TG}` });
      checked = (await call(groupPath)).data;
      assert.equal(checked.bot.state, "invalid-token");
      assert.equal(checked.bot.privacyDisabled, null);
      assert.doesNotMatch(JSON.stringify(checked), /provider body|AAtinatinatina/);
      telegram.state.errors.delete(`${TINA_TG}:getMe`);

      const allowed = app.store.settings.telegramChatIds;
      app.store.updateSettings({ telegramChatIds: [] });
      assert.equal((await call(groupPath)).data.listening.chat, false);
      app.store.updateSettings({ telegramChatIds: allowed });
      app.store.updateAgent(tina.id, { platformsOff: ["telegram"] });
      assert.equal((await call(groupPath)).data.listening.agent, false);
      app.store.updateAgent(tina.id, { platformsOff: [], channelIds: [`tg:${TG_OTHER_GROUP}`] });
      assert.equal((await call(groupPath)).data.listening.assigned, false);
      app.store.updateAgent(tina.id, { platformsOff: original.platformsOff, channelIds: original.channelIds });

      const probe = "cora-ab12cd34";
      const since = Date.now() - 1000;
      const probePath = `${groupPath}&probe=${probe}&since=${since}`;
      app.store.appendArchive(`tg:${TG_GROUP}`, { id: "setup-bot-probe", at: Date.now(), authorName: "Grog", kind: "bot", content: `@Tina ${probe}` });
      assert.equal((await call(probePath)).data.probe.state, "waiting-message", "a bot's test is not a human delivery test");
      assert.equal((await call(`${groupPath}&probe=invalid&since=${since}`)).status, 400);
      assert.equal((await call(`${groupPath}&probe=${probe}&since=${since - 3600000}`)).status, 400);

      replies.set("Tina", async () => { await replyGate; return { content: "Prova ricevuta nel gruppo." }; });
      telegram.push(group(seb, `@tina_cora_bot prova ${probe}`, { entities: [{ type: "mention", offset: 0, length: 14 }] }), { to: [TINA_TG] });
      await waitFor(async () => (await call(probePath)).data.probe.state === "waiting-reply", { what: "the human probe received" });
      const olderTrace = app.store.traces(tina.id).find((trace) => trace.status === "done");
      app.store.appendArchive(`tg:${TG_GROUP}`, { id: "setup-unrelated-reply", at: Date.now(), authorName: "Tina", kind: "agent", agentId: tina.id, traceId: olderTrace.id, content: "Una risposta a un'altra richiesta." });
      app.store.appendArchive(`tg:${TG_GROUP}`, { id: "setup-passive-reply", at: Date.now(), authorName: "Tina", kind: "agent", agentId: tina.id, passive: true, content: "Rapporto di routine." });
      assert.equal((await call(probePath)).data.probe.state, "waiting-reply", "unrelated and passive posts cannot complete the test");
      release();
      const complete = await waitFor(async () => {
        const state = (await call(probePath)).data;
        return state.probe.state === "complete" && state;
      }, { what: "Tina's correlated reply delivered to the group" });
      assert.ok(complete.probe.replyAt >= complete.probe.messageAt);
      assert.ok(telegram.state.sent.some((item) => item.token === TINA_TG && item.text === "Prova ricevuta nel gruppo." && item.chat_id === TG_GROUP));
      await quiet();
      const sayProbe = "cora-cd34ef56";
      const saySince = Date.now() - 1000;
      let said = false;
      replies.set("Tina", () => {
        if (said) return { content: "PASS" };
        said = true;
        return { tool_calls: [{ function: { name: "say", arguments: { text: "Risposta con say.", channel_id: `tg:${TG_GROUP}` } } }] };
      });
      telegram.push(group(seb, `@tina_cora_bot prova ${sayProbe}`, { entities: [{ type: "mention", offset: 0, length: 14 }] }), { to: [TINA_TG] });
      await waitFor(async () => (await call(`${groupPath}&probe=${sayProbe}&since=${saySince}`)).data.probe.state === "complete", { what: "a tool-delivered reply confirmed by its exact Telegram message receipt" });
      const toolReply = app.store.recentMessages(`tg:${TG_GROUP}`).find((item) => item.content === "Risposta con say.");
      assert.ok(toolReply && !toolReply.traceId, "say delivery is correlated through its receipt even without an attached trace id");
    } finally {
      release();
      telegram.state.bots.set(TINA_TG, user);
      telegram.state.memberStates.delete(memberKey);
      for (const method of ["getMe", "getChatMember"]) telegram.state.errors.delete(`${TINA_TG}:${method}`);
      app.store.updateAgent(tina.id, { platformsOff: original.platformsOff, channelIds: original.channelIds });
    }
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

  test("Discord and Telegram at once: each agent is on the platforms chosen for it, and its own bot holds its private chats", async () => {
    const LEA_TG = "3333333:AAlealealealealealealealealealealealea";
    const dino = (await call("/api/agents", { method: "POST", body: { name: "Dino", model: "ollama/test-model", chattiness: 0, tools: false } })).data;
    const lea = (await call("/api/agents", { method: "POST", body: { name: "Lea", model: "ollama/test-model", chattiness: 0, tools: false } })).data;
    assert.ok(dino.id && lea.id, "both agents are created");
    try {
      const both = await call("/api/settings", { method: "PUT", body: { transports: ["discord", "telegram"] } });
      assert.deepEqual([both.data.transport, both.data.transports], ["discord", ["discord", "telegram"]]);
      await waitFor(() => app.telegram.state === "ready", { what: "Telegram polling next to Discord" });
      assert.equal(app.discord.state, "ready", "Discord stays on");
      const state = (await call("/api/state")).data;
      assert.deepEqual(state.transports, ["discord", "telegram"]);
      assert.deepEqual([...new Set(state.channels.map((channel) => channel.kind))].sort(), ["discord", "telegram"], "the channels of both platforms are listed");
      for (const agent of [dino, lea]) assert.deepEqual(app.store.agent(agent.id).platformsOff, ["telegram"], "agents start off on a platform switched on next to others");

      await call(`/api/agents/${lea.id}`, { method: "PUT", body: { platformsOff: [] } });
      telegram.addBot(LEA_TG, { id: 3333333, username: "lea_cora_bot", first_name: "Lea" });
      const bot = await call(`/api/agents/${lea.id}/telegram-bot`, { method: "PUT", body: { token: LEA_TG } });
      assert.equal(bot.data.telegramBot.user.username, "lea_cora_bot");
      assert.deepEqual(app.channels.listFor(app.store.agent(dino.id)).map((channel) => channel.kind).filter((kind) => kind === "telegram"), [], "Dino is not on Telegram");
      assert.ok(app.channels.listFor(app.store.agent(lea.id)).some((channel) => channel.kind === "telegram"), "Lea is");

      telegram.state.sent.length = 0;
      replies.set("Lea", (body) => ({ content: /Ciao Lea/.test(lastUserText(body)) ? "Ciao Seb, sono Lea su Telegram." : "Lea qui." }));
      replies.set("Dino", () => ({ content: "Dino da Discord." }));
      telegram.push({ chat: { id: Number(TG_OWNER), type: "private", first_name: "Seb" }, from: seb, text: "Ciao Lea, ci sei?" }, { to: [LEA_TG] });
      const sent = await waitFor(() => telegram.state.sent.find((item) => item.text === "Ciao Seb, sono Lea su Telegram."), { what: "Lea's private reply" });
      assert.deepEqual([sent.token, String(sent.chat_id)], [LEA_TG, TG_OWNER], "answered by Lea's own bot, in the private chat, without being called");
      assert.equal(app.orchestrator.dmAgentId(`tg:${TG_OWNER}@${lea.id}`), lea.id);

      // Anyone can write to an agent's bot: without a Telegram owner set, that does not make them one.
      app.store.updateSettings({ telegramOwnerIds: [] });
      let strangerPrompt = "";
      replies.set("Lea", (body) => {
        strangerPrompt = lastUserText(body);
        return { content: "Chi sei?" };
      });
      telegram.push({ chat: { id: Number(TG_STRANGER), type: "private", first_name: "Ospite" }, from: { id: Number(TG_STRANGER), first_name: "Ospite", is_bot: false }, text: "Ciao Lea" }, { to: [LEA_TG] });
      await waitFor(() => telegram.state.sent.some((item) => item.text === "Chi sei?" && String(item.chat_id) === TG_STRANGER), { what: "Lea answering a stranger" });
      assert.match(strangerPrompt, /Ospite: Ciao Lea/);
      assert.doesNotMatch(strangerPrompt, /Ospite ★/, "not the owner");
      assert.deepEqual(app.store.settings.telegramOwnerIds, [], "and not made the owner");
      app.store.updateSettings({ telegramOwnerIds: [TG_OWNER] });

      telegram.push(group(seb, "@Dino, ci sei?"));
      discord.say({ content: "@Dino, ci sei?" });
      await waitFor(() => discord.state.webhookPosts.some((item) => item.username === "Dino" && item.content === "Dino da Discord."), { what: "Dino on Discord" });
      const notice = await waitFor(() => telegram.state.sent.find((item) => /Dino/.test(item.text || "")), { what: "Cora's word about Dino on Telegram" });
      assert.match(notice.text, /Dino\W{0,6} non è su Telegram\. Per farlo rispondere qui .*accendi Telegram in Ascolto/s, "Cora says Dino is not on Telegram at all");
      assert.equal(notice.token, MAIN_TG);
      await quiet();
      assert.ok(!telegram.state.sent.some((item) => /Dino da Discord/.test(item.text || "")), "Dino, off on Telegram, does not answer there");

      const primary = await call("/api/settings", { method: "PUT", body: { transport: "telegram" } });
      assert.deepEqual([primary.data.transport, primary.data.transports], ["telegram", ["discord", "telegram"]], "a new primary keeps the other platforms on");
    } finally {
      // Discord alone again, whatever happened above: the Slack tests start from there.
      await call("/api/settings", { method: "PUT", body: { transports: ["discord"], transport: "discord" } });
      for (const agent of [dino, lea]) await call(`/api/agents/${agent.id}`, { method: "DELETE" });
    }
    await waitFor(() => app.telegram.state === "stopped", { what: "Telegram off" });
    assert.equal(app.discord.state, "ready");
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
    await waitFor(async () => ((await call("/api/state")).data.slack.channels.some((channel) => channel.id === SLACK_CHANNEL && channel.name === "generale")), { what: "the channel the app is already in" });
    const state = (await call("/api/state")).data;
    assert.equal(state.slack.user.username, "cora");
    assert.equal(state.slack.team.name, "Dopamina");
    assert.ok(state.slack.channels.some((channel) => channel.id === SLACK_CHANNEL && channel.name === "generale"));
    await waitFor(async () => ((await call("/api/state")).data.channels.some((channel) => channel.id === `sl:${SLACK_CHANNEL}`)), { what: "the channel the app is in, on by itself" });
    assert.deepEqual(app.store.settings.slackChannelIds, [SLACK_CHANNEL]);
    assert.deepEqual(app.store.settings.slackMutedChannelIds, []);
    assert.equal(app.store.settings.slackTeamId, "T0000000001");
  });

  test("a channel the apps are in is heard on its own, the workspace owner becomes the owner, and the agent answers with its own app", async () => {
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
    const channels = (await call("/api/state")).data.channels;
    assert.deepEqual(channels.map((channel) => [channel.id, channel.name, channel.kind]), [[`sl:${SLACK_CHANNEL}`, "generale", "slack"]]);

    slack.say({ text: "@Silvia, ci sei?" });
    const post = await waitFor(() => slack.postsIn(SLACK_CHANNEL)[0], { what: "Silvia's answer" });
    assert.equal(post.app, "silvia", "posted by her own app");
    assert.equal(post.username, undefined, "her own app needs no name on the message");
    assert.equal(post.text, "Ci sono, dimmi pure.");
    assert.deepEqual(app.store.settings.slackOwnerIds, [SLACK_OWNER]);
    assert.match(prompt, /Ultimi messaggi nel canale #generale di Slack/);
    assert.match(prompt, /Sam ★: @Silvia, ci sei\?/);
    const [summary] = (await call(`/api/agents/${silvia.id}/traces`)).data;
    const trace = (await call(`/api/traces/${summary.id}`)).data;
    assert.match(trace.system, /In questo momento parlate su Slack, nello spazio "Dopamina"\./);
    await quiet();
  });

  test("a private channel only an agent's app is in shows up on its own and is heard, and stays off once switched off", async () => {
    const PRIVATE = "C0PRIVATE01";
    slack.state.channels.set(PRIVATE, { id: PRIVATE, name: "refracto-dev", is_private: true });
    slack.invite(SILVIA_BOT, PRIVATE);
    await waitFor(async () => {
      const state = (await call("/api/state")).data;
      return state.slack.channels.some((channel) => channel.id === PRIVATE && channel.private && channel.name === "refracto-dev")
        && state.channels.some((channel) => channel.id === `sl:${PRIVATE}`);
    }, { what: "the private channel in the panel, on by itself" });

    replies.set("Silvia", () => ({ content: "Ci sono, nel canale privato." }));
    slack.say({ text: "@Silvia, ci sei nel privato?", channel: PRIVATE });
    const post = await waitFor(() => slack.postsIn(PRIVATE)[0], { what: "Silvia in the private channel" });
    assert.equal(post.app, "silvia");
    assert.equal(post.text, "Ci sono, nel canale privato.");

    await call("/api/settings", { method: "PUT", body: { slackChannelIds: [SLACK_CHANNEL] } });
    assert.deepEqual(app.store.settings.slackMutedChannelIds, [PRIVATE], "the channel switched off is remembered");
    slack.state.posts.length = 0;
    slack.say({ text: "@Silvia, ancora?", channel: PRIVATE });
    await sleep(800);
    assert.equal(slack.postsIn(PRIVATE).length, 0, "switching the channel off keeps it off");
    const listed = await call("/api/slack/channels");
    const again = (await call("/api/state")).data;
    assert.deepEqual(listed.data.map((channel) => channel.id).sort(), again.slack.channels.map((channel) => channel.id).sort(), "refresh and the panel read the same list");
    assert.ok(listed.data.some((channel) => channel.id === PRIVATE && channel.private));
    assert.ok(!again.channels.some((channel) => channel.id === `sl:${PRIVATE}`), "a refresh does not turn a switched-off channel back on");

    slack.join(SILVIA_BOT, SLACK_OTHER_CHANNEL);
    const refreshed = await call("/api/slack/channels");
    assert.ok(refreshed.data.some((channel) => channel.id === SLACK_OTHER_CHANNEL && channel.name === "clienti"), "refresh sees a channel whose join event was missed");
    const found = (await call("/api/state")).data;
    assert.deepEqual(refreshed.data.map((channel) => channel.id).sort(), found.slack.channels.map((channel) => channel.id).sort());
    assert.ok(found.channels.some((channel) => channel.id === `sl:${SLACK_OTHER_CHANNEL}`), "a channel found by a refresh starts on");

    slack.state.apps.get(SILVIA_BOT).channels.delete(SLACK_OTHER_CHANNEL);
    slack.leave(SILVIA_BOT, PRIVATE);
    await waitFor(async () => !((await call("/api/state")).data.slack.channels.some((channel) => channel.id === PRIVATE)), { what: "leaving drops the channel without a manual refresh" });
    const afterLeave = await call("/api/slack/channels");
    assert.ok(!afterLeave.data.some((channel) => channel.id === PRIVATE || channel.id === SLACK_OTHER_CHANNEL), "refresh drops a channel whose leave event was missed");

    slack.invite(SILVIA_BOT, PRIVATE);
    await waitFor(async () => (await call("/api/state")).data.slack.channels.some((channel) => channel.id === PRIVATE), { what: "the channel back in the list" });
    assert.ok(!(await call("/api/state")).data.channels.some((channel) => channel.id === `sl:${PRIVATE}`), "a channel switched off stays off when the app is back in it");
    await call("/api/settings", { method: "PUT", body: { slackChannelIds: [SLACK_CHANNEL, PRIVATE] } });
    assert.deepEqual(app.store.settings.slackMutedChannelIds, [], "switching it on forgets the mute");
    assert.ok((await call("/api/state")).data.channels.some((channel) => channel.id === `sl:${PRIVATE}`));
    slack.leave(SILVIA_BOT, PRIVATE);
    await waitFor(async () => !((await call("/api/state")).data.slack.channels.some((channel) => channel.id === PRIVATE)), { what: "the channel gone again" });
    await call("/api/settings", { method: "PUT", body: { slackChannelIds: [SLACK_CHANNEL] } });
    assert.deepEqual([app.store.settings.slackChannelIds, app.store.settings.slackMutedChannelIds], [[SLACK_CHANNEL], []], "a channel no app is in drops off the list without being muted");
    await quiet();
  });

  test("with Slack's configuration token every app follows the panel, name, description and image, with no trip to Slack", async () => {
    const silviaApp = "A0000000101";
    const mainApp = "A0000000100";
    slack.configToken("xoxe-1-first-0000");
    assert.match((await call("/api/slack/config-token", { method: "PUT", body: { token: "nope" } })).data.error, /xoxe-/);
    assert.match((await call("/api/slack/config-token", { method: "PUT", body: { token: "xoxe-1-unknown-000" } })).data.error, /non accetta/);
    const saved = await call("/api/slack/config-token", { method: "PUT", body: { token: "xoxe-1-first-0000" } });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.apps.configured, true);
    assert.equal(hushVault.CORA_SLACK_CONFIG_TOKEN, "xoxe-1-refresh-1", "the spent refresh token is replaced in hush by the one Slack gave back");

    await waitFor(() => slack.state.manifests.get(silviaApp) && slack.state.manifests.get(mainApp), { what: "both manifests updated" });
    assert.deepEqual([slack.state.manifests.get(silviaApp).display_information.name, slack.state.manifests.get(silviaApp).features.bot_user.display_name], ["Silvia", "Silvia"]);
    assert.equal(slack.state.manifests.get(silviaApp).display_information.description, "Silvia, agente di Cora");
    assert.equal(slack.state.manifests.get(silviaApp).settings.socket_mode_enabled, true, "the rest of the manifest stays as it was");
    assert.equal(slack.state.manifests.get(mainApp).display_information.name, "Cora");
    assert.equal(slack.state.manifests.get(mainApp).display_information.description, "creata a mano", "Cora's own description is left alone");

    // A new face and a new personality in the panel reach Slack on their own, the picture from this space's public address.
    app.store.setAvatarBase("https://cora.test");
    const face = (await call(`/api/agents/${silvia.id}`, { method: "PUT", body: { avatarSeed: "nuova", personality: "Segue i clienti di Dopamina.\nAltro." } })).data;
    assert.equal(face.avatarUrl, `https://cora.test/avatars/${silvia.id}.png?v=${face.avatarVersion}`);
    await waitFor(() => slack.state.icons.get(silviaApp) === face.avatarUrl, { what: "Silvia's icon" });
    await waitFor(() => slack.state.manifests.get(silviaApp).display_information.description === "Segue i clienti di Dopamina.", { what: "Silvia's description" });
    const synced = (await call(`/api/agents/${silvia.id}`)).data.slackBot.appSync;
    assert.deepEqual([synced.appId, synced.error], [silviaApp, ""]);
    assert.equal((await call("/api/state")).data.slack.appSync.appId, mainApp);

    // Nothing new, nothing sent.
    const calls = slack.state.configCalls.length;
    app.skBots.sync();
    await sleep(800);
    assert.equal(slack.state.configCalls.length, calls, "an app already in line costs no call");

    // An image Slack refuses is said in the agent's panel.
    slack.state.iconError = "invalid_icon_size";
    await call(`/api/agents/${silvia.id}`, { method: "PUT", body: { avatarSeed: "rifiutata" } });
    const refused = await waitFor(async () => (await call(`/api/agents/${silvia.id}`)).data.slackBot.appSync?.error, { what: "the refusal" });
    assert.match(refused, /tra 512 e 2000 pixel/);
    slack.state.iconError = "";
    const forced = await call(`/api/agents/${silvia.id}/slack-app`, { method: "POST" });
    assert.equal(forced.status, 200);
    assert.equal(slack.state.icons.get(silviaApp), app.store.agent(silvia.id).avatarUrl, "forced, the refused picture goes through once Slack takes it");
    app.store.setAvatarBase("");
    await call(`/api/agents/${silvia.id}`, { method: "PUT", body: { avatarSeed: "", personality: "" } });
    await waitFor(() => slack.state.manifests.get(silviaApp).display_information.description === "Silvia, agente di Cora", { what: "Silvia back as she was" });
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
    slack.say({ text: "@Silvia, rispondi a Kim" });
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

    slack.say({ text: "@Nadia, ci pensi tu?", threadTs: asked.ts });
    const reply = await waitFor(() => slack.state.posts[0], { what: "Nadia in the thread" });
    assert.equal(reply.app, "nadia");
    assert.equal(reply.thread_ts, asked.ts, "the answer stays in the thread");
    await quiet();
  });

  test("a reply written in a Slack thread while Cora was away is picked up on reconnect and answered in that thread", async () => {
    slack.state.posts.length = 0;
    replies.set("*", () => ({ content: "Rispondo io." }));
    const asked = slack.say({ text: "apro un thread per voi" });
    await waitFor(() => slack.postsIn(SLACK_CHANNEL).length, { what: "the answer in the channel" });
    await quiet();
    slack.state.posts.length = 0;
    const missed = slack.archive({ text: "@Nadia, ci sei?", threadTs: asked.ts });
    await app.orchestrator.catchUpSlack();
    const thread = `sl:${SLACK_CHANNEL}:${asked.ts}`;
    assert.ok(app.store.hasMessage(`sl_${SLACK_CHANNEL}_${missed.ts}`), "the missed reply is archived");
    assert.ok(app.orchestrator.state(thread).history.some((item) => item.content.includes("ci sei?")), "it lands in the thread, not in the channel");
    assert.ok(!app.orchestrator.state(`sl:${SLACK_CHANNEL}`).history.some((item) => item.id === `sl_${SLACK_CHANNEL}_${missed.ts}`));
    const reply = await waitFor(() => slack.state.posts[0], { what: "Nadia in the thread" });
    assert.equal(reply.app, "nadia");
    assert.equal(reply.thread_ts, asked.ts, "the answer stays in the thread");
    await quiet();
    slack.state.posts.length = 0;
    await app.orchestrator.catchUpSlack();
    await sleep(1500);
    assert.equal(slack.state.posts.length, 0, "a second reconnect does not answer again");
  });

  test("in a channel only an agent's app is in, a thread opened from the panel and Cora's own words go through that app", async () => {
    const ALONE = "C0ALONE0001";
    slack.state.channels.set(ALONE, { id: ALONE, name: "testnew", is_private: true });
    slack.invite(SILVIA_BOT, ALONE);
    await waitFor(async () => (await call("/api/state")).data.channels.some((channel) => channel.id === `sl:${ALONE}`), { what: "the channel only Silvia's app is in, on" });
    slack.state.posts.length = 0;
    const opened = await call("/api/threads", { method: "POST", body: { parentId: `sl:${ALONE}`, name: "Debug dei thread" } });
    assert.equal(opened.status, 201, JSON.stringify(opened.data));
    const parent = slack.postsIn(ALONE)[0];
    assert.equal(parent.app, "silvia", "the main app is not in the channel: Silvia's app opens the thread");
    assert.equal(parent.username, "Cora");
    assert.equal(opened.data.id, `sl:${ALONE}:${parent.ts}`);
    assert.ok((await call("/api/threads")).data.threads.some((thread) => thread.id === opened.data.id && thread.name === "Debug dei thread" && thread.thread));

    slack.state.posts.length = 0;
    replies.set("Silvia", () => ({ content: "Ci sono, nel thread." }));
    slack.say({ text: "@Silvia, ci sei?", channel: ALONE, threadTs: parent.ts });
    const reply = await waitFor(() => slack.postsIn(ALONE)[0], { what: "Silvia in the thread" });
    assert.equal(reply.app, "silvia");
    assert.equal(reply.thread_ts, parent.ts, "the answer stays in the thread");
    await quiet();

    slack.state.posts.length = 0;
    await app.orchestrator.notice(opened.data.id, "Artefatto proposto.");
    const notice = slack.postsIn(ALONE)[0];
    assert.equal(notice?.app, "silvia");
    assert.equal(notice.thread_ts, parent.ts);
    slack.leave(SILVIA_BOT, ALONE);
    await waitFor(async () => !((await call("/api/state")).data.slack.channels.some((channel) => channel.id === ALONE)), { what: "the channel gone" });
    await call("/api/settings", { method: "PUT", body: { slackChannelIds: [SLACK_CHANNEL] } });
    await quiet();
  });

  test("while it works it marks the message, and takes the mark back when it answers", async () => {
    slack.state.reactions.length = 0;
    slack.state.posts.length = 0;
    replies.set("Silvia", async () => {
      await sleep(1200);
      return { content: "Ecco fatto." };
    });
    const asked = slack.say({ text: "@Silvia, guarda una cosa" });
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
    app.brain.channelGoals.set(CHANNEL, iris.id, "OBSOLETE: goal di un altro agente");
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
    const report = { id: "collaboration", at, kind: "agent", agentId: ivo.id, authorName: "Ivo", passive: true, content: "@Iris, mi serve il registro aggiornato /work/cases.csv; puoi rendermelo disponibile?" };
    const request = { id: "summon", at: at + 1000, kind: "owner", authorName: "Sam", content: "@Iris" };
    const later = { id: "later-passive", at: at + 2000, kind: "agent", agentId: ivo.id, authorName: "Ivo", passive: true, content: "UNRELATED_LATER_REPORT" };
    const result = await app.brain.chatTurn({ agent: iris, history: [closed, report, request, later], channel: { id: CHANNEL, name: "test" }, forced: true, computer: true, replyTo: request });
    assert.equal(inputs.length, 1);
    const context = inputs[0].messages[1].content;
    assert.match(context, /Ivo \(agente\) \[contesto passivo\]: @Iris, mi serve il registro aggiornato/);
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

  test("one agent keeps a single session in a thread and a colleague keeps another", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let irisEntered = false;
    let ivoEntered = false;
    goals = () => "il controllo corrente è completo";
    replies.set("Iris", async () => { irisEntered = true; await gate; return { content: "PASS" }; });
    replies.set("Ivo", async () => {
      ivoEntered = true;
      assert.equal(app.orchestrator.threadWork.has(CHANNEL, iris.id), true);
      assert.equal(app.orchestrator.threadWork.has(CHANNEL, ivo.id), true);
      return { content: "PASS" };
    });
    const first = routine(iris, "Primo controllo");
    const second = routine(iris, "Secondo controllo");
    const colleague = routine(ivo, "Controllo del collega");
    const pending = app.orchestrator.runRoutine(first);
    try {
      await waitFor(() => irisEntered);
      const overlap = await app.orchestrator.runRoutine(second);
      assert.equal(overlap.status, "busy");
      assert.equal(app.store.routine(second.id).lastStatus, "skipped");
      const other = app.orchestrator.runRoutine(colleague);
      await waitFor(() => ivoEntered);
      assert.equal(app.orchestrator.threadWork.has(CHANNEL, iris.id), true);
      release();
      await Promise.all([pending, other]);
    } finally { release(); await pending; }
    assert.equal(app.orchestrator.threadWork.size, 0);
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
    app.store.appendArchive(CHANNEL, { id: "stop-probe", at: at + 1, authorId: OWNER, authorName: "Sam", kind: "owner", content: "@Iris, stoppa tutto" });
    app.store.appendArchive(CHANNEL, { id: "other-probe", at: at + 2, authorId: OWNER, authorName: "Sam", kind: "owner", content: "@Ivo, come va?" });
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

  test("calling a colleague adds an authorized worker without stopping the first agent or replacing its goal", async () => {
    const releaseAfter = app.orchestrator.releaseAfterMs;
    const shell = app.boxes.shell;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let firstCalls = 0, secondCalls = 0, evaluated = 0;
    app.orchestrator.releaseAfterMs = 10;
    goals = (body) => /Ivo/.test(body.messages[1].content) ? "il controllo di Ivo è completo" : "il documento di Iris è completo";
    checks = () => JSON.stringify({ met: true });
    intentions = () => { evaluated++; return JSON.stringify({ intent: "update", reply: "" }); };
    replies.set("Iris", async () => { firstCalls++; await gate; return { content: "Prima attività conclusa." }; });
    replies.set("Ivo", (body) => {
      secondCalls++;
      assert.ok(body.tools.some((tool) => tool.function.name === "shell"), "the colleague has the authorized computer");
      return secondCalls === 1 ? { tool_calls: [{ function: { name: "shell", arguments: { command: "read-authorized-document" } } }] } : { content: "Seconda attività conclusa." };
    });
    app.boxes.shell = async () => {
      assert.ok(app.orchestrator.threadWork.has(CHANNEL, iris.id));
      assert.ok(app.orchestrator.threadWork.has(CHANNEL, ivo.id));
      assert.ok(app.brain.activeTurns.has(CHANNEL, iris.id));
      assert.ok(app.brain.activeTurns.has(CHANNEL, ivo.id));
      return { code: 0, output: "Document read." };
    };
    try {
      discord.say({ content: "@Iris, analizza il documento" });
      await waitFor(() => firstCalls === 1);
      const firstGoal = app.brain.channelGoals.get(CHANNEL, iris.id);
      discord.say({ content: "@Ivo, controlla anche tu il documento" });
      await waitFor(() => secondCalls >= 2, { what: "both authorized workers in the same conversation" });
      await waitFor(() => evaluated > 0);
      assert.equal(app.store.traces(iris.id, 1)[0].status, "running");
      assert.equal(app.brain.channelGoals.get(CHANNEL, iris.id), firstGoal);
      assert.equal(app.orchestrator.threadWork.has(CHANNEL, iris.id), true, "the second worker's cleanup preserves the first lock");
      assert.deepEqual(new Set(app.orchestrator.state(CHANNEL).focus.ids), new Set([iris.id, ivo.id]));
      release();
      await quiet();
      assert.equal(app.store.traces(iris.id, 1)[0].status, "done");
      assert.equal(firstCalls, 1);
    } finally { release(); app.boxes.shell = shell; app.orchestrator.releaseAfterMs = releaseAfter; await quiet(); }
  });

  test("a colleague's name in a question never turns a later requirement into a handoff", async () => {
    const releaseAfter = app.orchestrator.releaseAfterMs;
    const state = app.orchestrator.state(CHANNEL);
    state.focus = null;
    app.orchestrator.engagements[CHANNEL] = null;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let calls = 0, evaluated = 0;
    app.orchestrator.releaseAfterMs = 10;
    goals = () => "il preventivo mensile è completo";
    checks = () => JSON.stringify({ met: true });
    intentions = () => { evaluated++; return JSON.stringify({ intent: "update", reply: "" }); };
    replies.set("Iris", async () => { calls++; await gate; return { content: "Preventivo concluso." }; });
    replies.set("Ivo", () => ({ content: "Resto disponibile." }));
    try {
      discord.say({ content: "@Iris, prepara il preventivo" });
      await waitFor(() => calls === 1);
      discord.say({ content: "Allora perché deleghi a Ivo" });
      await waitFor(() => evaluated >= 1);
      discord.say({ content: "Ivo nemmeno c’è nei thread che stai cercando" });
      await waitFor(() => evaluated >= 2);
      discord.say({ content: "Devi farlo tu" });
      await waitFor(() => evaluated >= 3);
      discord.say({ content: "Sì metti una cifra mensile più che totale" });
      await waitFor(() => evaluated >= 4);
      assert.equal(calls, 1);
      assert.equal(app.store.traces(iris.id, 1)[0].status, "running");
      assert.ok(app.orchestrator.threadWork.has(CHANNEL, iris.id));
      assert.ok(state.focus.ids.includes(iris.id));
      release();
      await quiet();
      assert.ok(!app.store.trace(app.store.traces(iris.id, 1)[0].id).steps.some((step) => /Passaggio del compito/.test(step.text || "")));
    } finally { release(); app.orchestrator.releaseAfterMs = releaseAfter; await quiet(); }
  });

  test("tools wait for a pending disengagement decision and a released listener executes no later work", async () => {
    const shell = app.boxes.shell;
    const state = app.orchestrator.state(CHANNEL);
    state.focus = null;
    app.orchestrator.engagements[CHANNEL] = null;
    let releaseActor, releaseRouting;
    const actor = new Promise((resolve) => { releaseActor = resolve; });
    const routing = new Promise((resolve) => { releaseRouting = resolve; });
    let entered = false, deciding = false, commands = 0;
    goals = () => "il documento è completo";
    departures = async (body) => { if (!JSON.parse(body.messages[1].content).message.includes("esci")) return []; deciding = true; await routing; return [iris.id]; };
    replies.set("Iris", async () => { entered = true; await actor; return { tool_calls: [{ function: { name: "shell", arguments: { command: "must-not-run-after-disengagement" } } }] }; });
    app.boxes.shell = async () => { commands++; return { code: 0, output: "unexpected" }; };
    try {
      discord.say({ content: "@Iris, prepara il documento" });
      await waitFor(() => entered);
      discord.say({ content: "@Iris, esci dalla conversazione e smetti di ascoltare" });
      await waitFor(() => deciding);
      releaseActor();
      await sleep(200);
      assert.equal(commands, 0, "tools cannot overtake incoming-message routing");
      releaseRouting();
      await quiet();
      assert.equal(commands, 0);
      assert.equal(state.focus, null);
      assert.equal(app.store.traces(iris.id, 1)[0].status, "stopped");
    } finally { releaseActor(); releaseRouting(); app.boxes.shell = shell; await quiet(); }
  });

  test("an engaged agent can summon an authorized colleague without losing its own worker", async () => {
    const shell = app.boxes.shell;
    const releaseAfter = app.orchestrator.releaseAfterMs;
    const state = app.orchestrator.state(CHANNEL);
    state.focus = null;
    app.orchestrator.engagements[CHANNEL] = null;
    app.orchestrator.releaseAfterMs = 10;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let first = 0, second = 0, commands = 0;
    goals = () => "il controllo assegnato è completo";
    checks = () => JSON.stringify({ met: true });
    replies.set("Iris", async () => {
      if (++first === 1) return { tool_calls: [{ function: { name: "say", arguments: { text: "@Ivo, controlla il documento anche dal tuo computer." } } }] };
      await gate;
      return { content: "Attività di Iris conclusa." };
    });
    replies.set("Ivo", (body) => {
      assert.ok(body.tools.some((tool) => tool.function.name === "shell"), "trusted delegation keeps the owner's computer authorization");
      return ++second === 1 ? { tool_calls: [{ function: { name: "shell", arguments: { command: "colleague-check" } } }] } : { content: "Attività di Ivo conclusa." };
    });
    app.boxes.shell = async () => { commands++; return { code: 0, output: "checked" }; };
    try {
      discord.say({ content: "@Iris, controlla il documento e collabora se serve" });
      await waitFor(() => commands === 1, { what: "the summoned colleague receiving its authorized tools" });
      assert.ok(app.orchestrator.threadWork.has(CHANNEL, iris.id));
      assert.equal(app.store.traces(iris.id, 1)[0].status, "running");
      assert.deepEqual(new Set(state.focus.ids), new Set([iris.id, ivo.id]));
      release();
      await quiet();
      assert.equal(commands, 1);
    } finally { release(); app.boxes.shell = shell; app.orchestrator.releaseAfterMs = releaseAfter; await quiet(); }
  });

  test("a stranger cannot borrow an earlier owner's authorization by asking an engaged agent to call a colleague", async () => {
    const state = app.orchestrator.state(CHANNEL);
    state.focus = { ids: [iris.id], at: Date.now(), remindedAt: 0, owner: true };
    app.orchestrator.engagements[CHANNEL] = state.focus;
    let first = 0, second = 0;
    replies.set("Iris", (body) => {
      assert.ok(!body.tools.some((tool) => tool.function.name === "shell"));
      return ++first === 1 ? { tool_calls: [{ function: { name: "say", arguments: { text: "@Ivo, controlla questa richiesta." } } }] } : { content: "Richiesta riferita." };
    });
    replies.set("Ivo", (body) => {
      second++;
      assert.ok(!body.tools.some((tool) => tool.function.name === "shell"), "a colleague cannot gain the owner's tools from an untrusted caller");
      return { content: "Posso parlarne." };
    });
    discord.say({ content: "@Iris, chiedi a un collega di intervenire", author: STRANGER, username: "Ospite" });
    await waitFor(() => second > 0, { what: "untrusted delegation staying chat-only" });
    await quiet();
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
      discord.say({ content: "@Iris, abbandona quello che stai facendo, lo riprendiamo un altro giorno" });
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
    const evidence = routine(iris, "Verifica attuale");
    const before = cli.calls().length;
    goals = (body) => /Poi il proprietario ha detto/.test(body.messages[1].content) ? "il report è su Telegram" : "il report è via email";
    let judged = 0;
    checks = () => {
      judged += 1;
      if (judged === 1) {
        app.orchestrator.ingest(app.orchestrator.state(CHANNEL), { id: "retarget-" + Date.now(), at: Date.now(), authorId: OWNER, authorName: "Sam", kind: "owner", content: "@Iris, mandalo su Telegram invece che via email" });
      }
      return JSON.stringify({ met: judged >= 3, reason: "manca la consegna" });
    };
    cli.set({ reply: "Report preparato.", tool: "list_routines" });
    try {
      discord.say({ content: "@Iris, manda il report via email" });
      await waitFor(() => cli.calls().slice(before).filter((item) => item.flavor === "codex").length >= 2, { timeout: 20000 });
      await quiet();
      const runs = cli.calls().slice(before).filter((item) => item.flavor === "codex");
      assert.match(runs[1].stdin, /Azioni già eseguite[\s\S]*list_routines[\s\S]*Verifica attuale/);
      assert.match(runs[1].stdin, /unica condizione attuale[^\n]*il report è su Telegram/);
      assert.match(runs[1].stdin, /Messaggi successivi del proprietario[\s\S]*Telegram/);
    } finally { app.store.deleteRoutine(evidence.id); app.store.updateAgent(iris.id, { model: "ollama/test-model", subscriptionId: "" }); }
  });

  test("stoppa tutto terminates a running CLI and never invokes the goal verifier", async () => {
    app.store.updateAgent(iris.id, { model: "codex/gpt-6-sol", subscriptionId: subscriptionIds.codex });
    goals = () => "tutti i post sono pubblicati";
    let judged = 0;
    checks = () => { judged += 1; return JSON.stringify({ met: false }); };
    cli.set({ reply: "Non dovrebbe arrivare", hang: true });
    const before = cli.calls().length;
    try {
      discord.say({ content: "@Iris, controlla i post" });
      const run = await waitFor(() => cli.calls().slice(before).find((item) => item.pid), { timeout: 15000 });
      discord.say({ content: "@Iris, stoppa tutto" });
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
    discord.say({ content: "@Dora, come colleghiamo GitHub?" });
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
    discord.say({ content: "@Dora, a che punto è il report?" });
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
      discord.say({ content: "@Dora, commenta la PR 7" });
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
    discord.say({ content: "@Dora, aggiornami sul preventivo" });
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
      discord.say({ content: "@Dora, prova senza doc" });
      await waitFor(() => posts().includes("Senza doc questo messaggio con STIMA-DI-PROVA esce com'è."), { what: "the unchecked message" });
      await quiet();
      assert.equal(doc.calls().length, before, "nothing ran");
    } finally {
      app.brain.doc = previous;
      previous.key = "ts-test-key";
    }
  });
});


describe("agent mailboxes", () => {
  const fixture = async (t, name) => {
    const directory = mkdtempSync(join(tmpdir(), "cora-mail-client-"));
    const calls = [];
    const state = { status: 200 };
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      calls.push({ path: req.url, authorization: req.headers.authorization, body });
      res.writeHead(state.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(state.status === 200 ? { agent_id: `${body.agent_id}@${body.domain}`, email: `${body.agent_id}@${body.domain}`, api_key: "fixture-mailbox-private-api-key" } : { error: "fixture-provider-secret-that-must-not-leak" }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const dockerBin = join(directory, "docker.cjs");
    writeFileSync(dockerBin, `#!${process.execPath}\nconst { spawnSync } = require('node:child_process');\nconst { readFileSync } = require('node:fs');\nconst args = process.argv.slice(2);\nconst index = args.indexOf('node');\nif (args[0] !== 'exec' || index < 0) process.exit(99);\nconst result = spawnSync(${JSON.stringify(process.execPath)}, args.slice(index + 1), { input: readFileSync(0), env: { HOME: ${JSON.stringify(directory)}, PATH: process.env.PATH } });\nprocess.stdout.write(result.stdout || '');\nprocess.stderr.write(result.stderr || '');\nprocess.exit(result.status ?? 1);\n`);
    chmodSync(dockerBin, 0o755);
    const agent = app.store.createAgent({ name, tools: true, model: "ollama/test-model" });
    const makeBoxes = () => {
      const boxes = new Boxes({ docker: dockerBin, image: "unused", timezone: "UTC", mailbox: {
        endpoint: `http://127.0.0.1:${server.address().port}`, domain: "usecora.space", namespace: "team", token: "fixture-domain-registration-token",
        identity: (item) => app.store.value(`agentMailbox:${item.id}`, null),
        changed: (item, value) => app.store.setValue(`agentMailbox:${item.id}`, { ...app.store.value(`agentMailbox:${item.id}`, {}), ...value }),
      } });
      boxes.ensureNow = async () => ({ exists: true, running: true });
      return boxes;
    };
    t.after(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); app.store.deleteAgent(agent.id); });
    return { directory, calls, state, agent, makeBoxes, boxes: makeBoxes() };
  };

  test("a desktop receives its own custom-domain mailbox and system instructions without exposing credentials", async (t) => {
    const f = await fixture(t, "MailboxAlpha");
    assert.equal((await f.boxes.ensure(f.agent)).running, true);
    const identity = app.store.value(`agentMailbox:${f.agent.id}`);
    assert.equal(identity.email, "mailboxalpha-team@usecora.space");
    assert.equal(identity.status, "ready");
    assert.equal(f.calls[0].path, "/v1/domains/register");
    assert.equal(f.calls[0].authorization, "Bearer fixture-domain-registration-token");
    assert.match(f.calls[0].body.public_key_pem, /BEGIN PUBLIC KEY/);
    assert.equal(f.calls[0].body.recover, true);
    const client = join(f.directory, ".ambox", "agents", identity.email);
    assert.equal(statSync(join(client, "private.pem")).mode & 0o777, 0o600);
    assert.equal(statSync(join(client, "config.json")).mode & 0o777, 0o600);
    const config = JSON.parse(readFileSync(join(client, "config.json"), "utf8"));
    assert.equal(config.apiKey, "fixture-mailbox-private-api-key");
    assert.equal(readFileSync(join(f.directory, ".ambox", "default"), "utf8"), identity.agentId);
    const response = await call(`/api/agents/${f.agent.id}`);
    assert.equal(response.status, 200);
    assert.equal(response.data.mailbox.email, identity.email);
    const system = app.brain.systemPrompt(f.agent, { place: "private room", computer: true });
    assert.ok(system.includes(identity.email));
    assert.match(system, /ambox inbox/);
    assert.match(system, /ambox send/);
    assert.doesNotMatch(JSON.stringify(identity) + JSON.stringify(response.data) + system, /fixture-domain-registration-token|fixture-mailbox-private-api-key|BEGIN PRIVATE KEY/);
  });

  test("creating an agent through the owner API starts mailbox setup with its desktop", async (t) => {
    const f = await fixture(t, "MailboxTemplate");
    const ensure = app.boxes.ensure;
    app.boxes.ensure = f.boxes.ensure.bind(f.boxes);
    let createdId;
    t.after(() => { app.boxes.ensure = ensure; if (createdId) app.store.deleteAgent(createdId); });
    const created = await call("/api/agents", { method: "POST", body: { name: "MailboxCreated", tools: true, model: "ollama/test-model" } });
    assert.equal(created.status, 201);
    createdId = created.data.id;
    await waitFor(() => app.store.value(`agentMailbox:${createdId}`, null)?.status === "ready", { timeout: 20000, what: "new agent mailbox ready" });
    const response = await call(`/api/agents/${createdId}`);
    assert.equal(response.data.mailbox.email, "mailboxcreated-team@usecora.space");
    assert.equal(f.calls.length, 1);
  });

  test("restart and rename preserve the mailbox and its private key without registering again", async (t) => {
    const f = await fixture(t, "MailboxBeta");
    await f.boxes.ensure(f.agent);
    const identity = app.store.value(`agentMailbox:${f.agent.id}`);
    const keyPath = join(f.directory, ".ambox", "agents", identity.email, "private.pem");
    const key = readFileSync(keyPath, "utf8");
    await f.boxes.ensure(f.agent);
    await f.makeBoxes().ensure({ ...f.agent, name: "Renamed mailbox agent" });
    assert.equal(f.calls.length, 1);
    assert.equal(app.store.value(`agentMailbox:${f.agent.id}`).email, identity.email);
    assert.equal(readFileSync(keyPath, "utf8"), key);
  });

  test("the agent email API customizes its real address while preserving the old mailbox and restart identity", async (t) => {
    const f = await fixture(t, "MailboxPersonal");
    await f.boxes.ensure(f.agent);
    const before = app.store.value(`agentMailbox:${f.agent.id}`);
    const previous = { boxes: app.mailDomains.boxes, token: app.mailDomains.token, namespace: app.mailDomains.namespace, defaultDomain: app.mailDomains.defaultDomain };
    Object.assign(app.mailDomains, { boxes: f.boxes, token: "fixture-domain-registration-token", namespace: "team", defaultDomain: "usecora.space" });
    t.after(() => Object.assign(app.mailDomains, previous));
    const metadata = await call(`/api/agents/${f.agent.id}/mailbox`);
    assert.equal(metadata.status, 200);
    assert.equal(metadata.data.mailbox.email, before.email);
    assert.equal(metadata.data.domains[0].name, "usecora.space");
    const changed = await call(`/api/agents/${f.agent.id}/mailbox`, { method: "PUT", body: { local: "nico-personal", domain: "usecora.space" } });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    assert.equal(changed.data.email, "nico-personal@usecora.space");
    assert.deepEqual(changed.data.previousEmails, [before.email]);
    assert.ok(existsSync(join(f.directory, ".ambox", "agents", before.email, "private.pem")));
    assert.equal(readFileSync(join(f.directory, ".ambox", "default"), "utf8"), changed.data.email);
    await f.makeBoxes().ensure({ ...f.agent, name: "New display name" });
    assert.equal(f.calls.length, 2, "restart does not create or revert an address");
    assert.equal(app.store.value(`agentMailbox:${f.agent.id}`).email, changed.data.email);
    assert.ok(app.brain.systemPrompt(f.agent, { computer: true }).includes(before.email));
    f.state.status = 409;
    const refused = await call(`/api/agents/${f.agent.id}/mailbox`, { method: "PUT", body: { local: "already-taken", domain: "usecora.space" } });
    assert.equal(refused.status, 409);
    assert.equal(app.store.value(`agentMailbox:${f.agent.id}`).email, changed.data.email);
    assert.equal(readFileSync(join(f.directory, ".ambox", "default"), "utf8"), changed.data.email);
    assert.equal((await call(`/api/agents/${f.agent.id}/mailbox`, { method: "PUT", body: { local: "../../bad", domain: "usecora.space" } })).status, 400);
  });

  test("a refused registration leaves the desktop available, hides provider data and retries with the same encryption key", async (t) => {
    const f = await fixture(t, "MailboxGamma");
    f.state.status = 403;
    assert.equal((await f.boxes.ensure(f.agent)).running, true);
    const blocked = app.store.value(`agentMailbox:${f.agent.id}`);
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.error, /HTTP 403/);
    assert.doesNotMatch(JSON.stringify(blocked), /fixture-provider-secret|fixture-domain-registration-token/);
    assert.doesNotMatch(app.brain.systemPrompt(f.agent, { place: "private room", computer: true }), /La tua casella è/);
    await f.boxes.ensure(f.agent);
    assert.equal(f.calls.length, 1, "failed provisioning backs off");
    f.state.status = 200;
    f.boxes.mailboxChecks.delete(f.agent.id);
    await f.boxes.ensure(f.agent);
    assert.equal(app.store.value(`agentMailbox:${f.agent.id}`).status, "ready");
    assert.equal(f.calls[1].body.public_key_pem, f.calls[0].body.public_key_pem);
  });

  test("provisioning is opt-in and agents without an enabled computer receive no mailbox", async (t) => {
    const f = await fixture(t, "MailboxDelta");
    await f.boxes.ensure({ ...f.agent, tools: false });
    await f.boxes.ensure({ ...f.agent, enabled: false });
    f.boxes.mailbox.token = "";
    await f.boxes.ensure(f.agent);
    assert.equal(f.calls.length, 0);
    assert.equal(app.store.value(`agentMailbox:${f.agent.id}`, null), null);
  });
});

describe("Cora commit attribution", () => {
  let agent;
  const git = (directory, args, input) => {
    const result = spawnSync("/usr/bin/git", ["-C", directory, ...args], { input, encoding: "utf8", env: { PATH: process.env.PATH, HOME: directory, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C", LANG: "C" } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  before(() => {
    agent = app.store.createAgent({ name: "Committer", model: "ollama/test-model", tools: true, channelIds: [CHANNEL] });
  });
  const repository = () => {
    const directory = mkdtempSync(join(tmpdir(), "cora-git-owner-"));
    git(directory, ["init", "--quiet"]);
    git(directory, ["config", "user.name", "Repository Owner"]);
    git(directory, ["config", "user.email", "owner@example.test"]);
    git(directory, ["config", "commit.gpgsign", "false"]);
    writeFileSync(join(directory, "change.txt"), "Owner-approved code\n");
    git(directory, ["add", "change.txt"]);
    const hook = join(directory, ".git", "hooks", "pre-commit");
    writeFileSync(hook, `#!${process.execPath}\nrequire('node:fs').writeFileSync('.git/owner-hook-ran', 'yes');\n`);
    chmodSync(hook, 0o755);
    const dockerBin = join(directory, "docker");
    writeFileSync(dockerBin, `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const args = process.argv.slice(2);
const index = args.indexOf('git');
if (args[0] !== 'exec' || index < 0 || args[index + 1] !== '-C' || args[index + 2] !== ${JSON.stringify(directory)}) process.exit(99);
const result = spawnSync('/usr/bin/git', args.slice(index + 1), { input: readFileSync(0), env: { PATH: process.env.PATH, HOME: ${JSON.stringify(directory)}, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C', LANG: 'C' } });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
process.exit(result.status ?? 1);
`);
    chmodSync(dockerBin, 0o755);
    return { directory, boxes: new Boxes({ docker: dockerBin, image: "unused", timezone: "UTC" }) };
  };
  const commit = async (fixture, message, attribution = { enabled: true, email: "cora@example.test" }) => {
    const previous = app.brain.gitAttribution;
    const implementation = app.boxes.gitCommit;
    app.brain.gitAttribution = attribution;
    app.boxes.gitCommit = fixture.boxes.gitCommit.bind(fixture.boxes);
    let calls = 0, receipt = "";
    replies.set("Committer", (body) => {
      if (++calls === 1) {
        assert.ok(body.tools.some((tool) => tool.function.name === "git_commit"));
        return { tool_calls: [{ function: { name: "git_commit", arguments: { directory: fixture.directory, message } } }] };
      }
      if (body.messages.at(-1).role !== "tool") return { content: "DONE" };
      receipt = String(body.messages.at(-1).content);
      return { content: receipt.includes("[exit 0]") ? "Commit completato." : "Commit non eseguito." };
    });
    try {
      const result = await app.brain.chatTurn({ agent, history: [{ id: `commit-${Date.now()}`, at: Date.now(), kind: "owner", authorName: "Owner", content: "Crea il commit delle sole modifiche approvate già in stage." }], channel: { id: `web-${agent.id}`, name: "commit integration" }, forced: true, computer: true });
      assert.ok(app.store.trace(result.traceId).steps.some((step) => step.name === "git_commit"));
      return receipt;
    } finally { app.brain.gitAttribution = previous; app.boxes.gitCommit = implementation; }
  };

  test("an authorized commit preserves the owner and hooks, adds Cora once, and carries text literally", async () => {
    const fixture = repository();
    const untouched = git(fixture.directory, ["config", "--local", "--list"]);
    const marker = join(fixture.directory, "must-not-exist");
    const message = `feat: owner-approved change\n\nLiteral shell text: $(touch '${marker}')\n\nCo-authored-by: Cora <cora@example.test>\nCo-authored-by: Human Teammate <teammate@example.test>\nReviewed-by: Reviewer <reviewer@example.test>\n`;
    assert.match(await commit(fixture, message), /\[exit 0\]/);
    assert.equal(git(fixture.directory, ["log", "-1", "--format=%an <%ae>"]), "Repository Owner <owner@example.test>");
    const actual = git(fixture.directory, ["log", "-1", "--format=%B"]);
    assert.equal((actual.match(/Co-authored-by: Cora <cora@example.test>/g) || []).length, 1);
    assert.match(actual, /Human Teammate <teammate@example.test>/);
    assert.ok(actual.includes(`$(touch '${marker}')`));
    assert.equal(existsSync(marker), false, "message text never becomes shell code");
    assert.equal(readFileSync(join(fixture.directory, ".git", "owner-hook-ran"), "utf8"), "yes");
    assert.equal(git(fixture.directory, ["config", "--local", "--list"]), untouched);
  });

  test("the instance can disable Cora attribution while keeping normal commits available", async () => {
    const fixture = repository();
    assert.match(await commit(fixture, "fix: approved change", { enabled: false }), /\[exit 0\]/);
    assert.doesNotMatch(git(fixture.directory, ["log", "-1", "--format=%B"]), /Co-authored-by/);
  });

  test("an unconfigured or injected identity creates no commit", async () => {
    for (const email of ["", "cora@example.test\nCo-authored-by: Someone <other@example.test>"]) {
      const fixture = repository();
      assert.match(await commit(fixture, "fix: approved change", { enabled: true, email }), /identity is not configured/);
      assert.equal(existsSync(join(fixture.directory, ".git", "refs", "heads", "master")), false);
      assert.equal(existsSync(join(fixture.directory, ".git", "refs", "heads", "main")), false);
    }
  });

  test("a repository hook can reject the commit without being bypassed", async () => {
    const fixture = repository();
    writeFileSync(join(fixture.directory, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n");
    assert.match(await commit(fixture, "fix: rejected by the repository"), /\[exit 1\]/);
    const result = spawnSync("/usr/bin/git", ["-C", fixture.directory, "rev-parse", "--verify", "HEAD"], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
  });

  test("an agent without computer authorization never receives the commit tool", async () => {
    replies.set("Committer", (body) => {
      assert.ok(!body.tools.some((tool) => tool.function.name === "git_commit"));
      return { content: "Posso discutere le modifiche." };
    });
    await app.brain.chatTurn({ agent, history: [{ id: "guest-commit", at: Date.now(), kind: "human", authorName: "Guest", content: "Crea un commit" }], channel: { id: CHANNEL, name: "test" }, forced: true, computer: false });
  });
});

describe("immediate company brain consolidation", () => {
  let instance;
  let provider;
  let request;
  let prompts = [];
  let reply;
  let active = 0;
  let maxActive = 0;
  let release;
  const noteSources = (prompt) => [...prompt.matchAll(/^\[(n\d+)\] Ada: (.+)$/gm)];

  before(async () => {
    provider = await fakeOllama(async (body) => {
      if (!String(body.messages[0]?.content).startsWith("Sei il bibliotecario del brain aziendale")) return { content: "PASS" };
      const prompt = String(body.messages.at(-1).content);
      prompts.push(prompt);
      active += 1;
      maxActive = Math.max(maxActive, active);
      try { return { content: JSON.stringify(await reply(prompt)) }; }
      finally { active -= 1; }
    });
    const directory = tempHome();
    const seed = new Store(directory);
    seed.updateSettings({ brainModel: "ollama/test-model" });
    seed.close();
    instance = startCora({ home: directory, host: "127.0.0.1", port: 0, insecureCookies: true,
      adminPassword: PASSWORD, sessionKey: "immediate-brain-fixture", useResidentSubscriptions: false,
      discordToken: "", telegramToken: "", ollamaUrl: provider.url, ollamaKey: "test-ollama-key", orcaKey: "", cloudUrl: "", cloudKey: "", cloudSpace: "",
      claudeBin: "/missing/claude", codexBin: "/missing/codex", hermesBin: "/missing/hermes", grokBin: "/missing/grok", museBin: "/missing/muse", botTokenFor: () => "",
      brainDatabaseUrl: "pglite:memory", brainEmbedUrl: provider.url,
      docker: docker.path, startBoxes: false, schedulerTickMs: 3600000, ownerInstructions: "/missing/instructions", sshAuthorizedKeys: "/missing/keys",
    });
    await instance.ready;
    await instance.companyBrain.ready;
    const root = `http://127.0.0.1:${instance.server.address().port}`;
    const login = await fetch(`${root}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ password: PASSWORD }) });
    const session = login.headers.get("set-cookie").split(";")[0];
    request = async (path, { method = "GET", body, authenticated = true } = {}) => {
      const response = await fetch(`${root}${path}`, { method, headers: { ...(authenticated ? { Cookie: session } : {}), "Content-Type": "application/json", "X-Cora": "1" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
  });
  after(async () => {
    release?.();
    await instance?.stop();
    await provider?.close();
  });
  beforeEach(async () => {
    await waitFor(() => !instance.librarian.running && !instance.librarian.pending);
    prompts = [];
    reply = async () => ({ pages: [] });
  });

  test("brain_note and shared remember drain immediately and serialize notes arriving during a run", async () => {
    const gate = new Promise((resolve) => { release = resolve; });
    const facts = new Set();
    reply = async (prompt) => {
      const sources = noteSources(prompt);
      for (const [, , text] of sources) facts.add(text);
      if (prompts.length === 1) await gate;
      return { pages: [{ slug: "studio", kind: "topic", title: "Studio", body: [...facts].map((fact) => `- ${fact}`).join("\n"), sources: sources.map(([, id]) => id) }] };
    };
    const context = { agent: { id: "ada-fixture", name: "Ada" }, store: instance.store, companyBrain: instance.companyBrain, channelId: "web" };
    const first = await executeTool({ name: "brain_note", args: { text: "Lo studio chiude venerdì. password: abcd1234efgh" } }, context);
    assert.match(first.text, /immediate.*queued/);
    await waitFor(() => prompts.length === 1, { what: "immediate librarian call" });
    const shared = await executeTool({ name: "remember", args: { fact: "Il referente è Giulia.", shared: true } }, context);
    assert.match(shared.text, /immediate.*queued/);
    await instance.companyBrain.note({ text: "La riunione è lunedì.", author: "Ada" });
    assert.equal((await request("/api/brain")).data.running, true);
    assert.equal(prompts.length, 1, "new arrivals wait behind the running model call");
    release();
    await waitFor(() => prompts.length === 2 && !instance.librarian.running && !instance.librarian.pending, { what: "queued notes consolidated" });
    assert.equal(maxActive, 1);
    assert.deepEqual(await instance.companyBrain.notes(), []);
    assert.doesNotMatch(prompts.join("\n"), /abcd1234efgh/);
    assert.match(prompts[0], /\[segreto omesso\]/);
    assert.match(prompts[1], /Il referente è Giulia/);
    assert.match(prompts[1], /La riunione è lunedì/);
    assert.doesNotMatch(prompts[1].split("## Note degli agenti")[1], /Lo studio chiude/);
    const page = (await request("/api/brain/pages/studio")).data;
    assert.match(page.body, /Lo studio chiude/);
    assert.match(page.body, /Il referente è Giulia/);
    assert.equal(page.revisions.length, 2);
    assert.equal(page.revisions[0].sources.length, 2);
    assert.equal(page.pending, 2);
  });

  test("manual additions accept every kind, stay approved, and mutations queue consolidation", async () => {
    for (const kind of ["client", "project", "person", "decision", "procedure", "topic"]) {
      const created = await request("/api/brain/pages", { method: "POST", body: { title: `Manual ${kind}`, kind, summary: "Owner knowledge", body: "- Available immediately." } });
      assert.equal(created.status, 201);
      assert.equal(created.data.kind, kind);
      const page = (await request(`/api/brain/pages/${created.data.slug}`)).data;
      assert.equal(page.pending, 0);
      assert.equal(page.revisions[0].review, "approved");
    }
    await waitFor(async () => !instance.librarian.running && !instance.librarian.pending && (await instance.companyBrain.state("lastRun"))?.reason === "pagina aggiunta");
    const duplicate = await request("/api/brain/pages", { method: "POST", body: { title: "Manual client" } });
    assert.equal(duplicate.status, 409);
    const edit = await request("/api/brain/pages/manual-client", { method: "PUT", body: { summary: "Updated by owner" } });
    assert.equal(edit.status, 200);
    await waitFor(async () => !instance.librarian.running && !instance.librarian.pending && (await instance.companyBrain.state("lastRun"))?.reason === "pagina aggiornata");
    const reviewed = await request("/api/brain/review", { method: "POST", body: { all: true, decision: "approve" } });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.data.approved, 2);
    await waitFor(async () => !instance.librarian.running && !instance.librarian.pending && (await instance.companyBrain.state("lastRun"))?.reason === "revisione");
    assert.deepEqual((await request("/api/brain/review")).data.queue, []);
    assert.equal((await request("/api/brain/pages", { method: "POST", authenticated: false, body: { title: "Denied page" } })).status, 401);
    assert.equal((await request("/api/brain/pages/denied-page")).status, 404);
  });

  test("a failed batch keeps its note for the next request, without an automatic retry loop", async () => {
    reply = async () => "fixture invalid librarian response";
    await instance.companyBrain.note({ text: "Da riprovare dopo un errore.", author: "Ada" });
    await waitFor(async () => !instance.librarian.running && prompts.length > 0 && (await instance.companyBrain.state("lastRun"))?.errors.length);
    assert.equal((await instance.companyBrain.notes()).length, 1);
    const attempts = prompts.length;
    await sleep(100);
    assert.equal(prompts.length, attempts);
    reply = async () => ({ pages: [] });
    await request("/api/brain/review", { method: "POST", body: { all: true, decision: "approve" } });
    await waitFor(async () => !instance.librarian.running && (await instance.companyBrain.notes()).length === 0);
    assert.equal((await instance.companyBrain.state("lastRun")).errors.length, 0);
  });

  test("stopping cancels queued work and waits for the current consolidation", async () => {
    const gate = new Promise((resolve) => { release = resolve; });
    reply = async () => { await gate; return { pages: [] }; };
    await instance.companyBrain.note({ text: "Nota prima dello stop.", author: "Ada" });
    await waitFor(() => prompts.length === 1);
    await instance.companyBrain.note({ text: "Nota da riprendere dopo il riavvio.", author: "Ada" });
    let stopped = false;
    const stopping = instance.librarian.stop().then(() => { stopped = true; });
    await sleep(30);
    assert.equal(stopped, false);
    release();
    await stopping;
    assert.equal(prompts.length, 1);
    assert.equal((await instance.companyBrain.notes()).length, 1);
    assert.equal(instance.librarian.requestRun(), false);
  });
});

describe("automatic attribution for ordinary Git and SSH", () => {
  test("plain Git preserves author, custom hooks, other coauthors and pathspecs", () => {
    const fixture = gitLauncherFixture();
    const hooks = join(fixture.directory, "owner hooks"); mkdirSync(hooks);
    fixture.raw(["config", "core.hooksPath", hooks]);
    writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\nprintf yes > .git/owner-pre-commit\n", { mode: 0o755 });
    writeFileSync(join(hooks, "commit-msg"), "#!/bin/sh\ngrep -q 'Co-authored-by: Cora' \"$1\" || exit 31\nprintf yes > .git/owner-commit-msg\n", { mode: 0o755 });
    writeFileSync(join(fixture.directory, "other.txt"), "Not part of this commit\n"); fixture.raw(["add", "other.txt"]);
    const result = fixture.git(["-c", "trailer.ifExists=replace", "commit", "-m", "Approved change\n\nCo-authored-by: Teammate <teammate@example.test>", "--", "change.txt"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fixture.raw(["log", "-1", "--format=%an <%ae>"]), "Repository Owner <owner@example.test>");
    assert.match(fixture.raw(["log", "-1", "--format=%B"]), /Co-authored-by: Teammate <teammate@example.test>/);
    assert.equal(fixture.raw(["log", "-1", "--format=%B"]).split("Co-authored-by: Cora <git@usecora.space>").length - 1, 1);
    assert.equal(readFileSync(join(fixture.directory, ".git", "owner-pre-commit"), "utf8"), "yes");
    assert.equal(readFileSync(join(fixture.directory, ".git", "owner-commit-msg"), "utf8"), "yes");
    assert.match(fixture.raw(["status", "--porcelain"]), /A  other.txt/);
    assert.equal(fixture.raw(["config", "core.hooksPath"]), hooks);
  });

  test("repeated trailers are deduplicated and commit messages remain literal", () => {
    const fixture = gitLauncherFixture();
    const message = "Approved $(touch unexpected) `touch unexpected-too`\n\nCo-authored-by: Cora <git@usecora.space>";
    const result = fixture.git(["-c", "trailer.ifExists=addIfDifferent", "commit", "--file=-", "--trailer", "Co-authored-by: Cora <git@usecora.space>"], { input: message });
    assert.equal(result.status, 0, result.stderr);
    const saved = fixture.raw(["log", "-1", "--format=%B"]);
    assert.match(saved, /\$\(touch unexpected\)/);
    assert.equal(saved.split("Co-authored-by: Cora <git@usecora.space>").length - 1, 1);
    assert.equal(existsSync(join(fixture.directory, "unexpected")), false);
  });

  test("instance, command and repository opt-outs produce ordinary commits", () => {
    for (const choice of ["instance", "command", "repository"]) {
      const fixture = gitLauncherFixture({ enabled: choice !== "instance" });
      if (choice === "repository") fixture.raw(["config", "cora.attribution", "false"]);
      const result = fixture.git(["commit", "-m", "Owner opted out"], { extraEnv: choice === "command" ? { CORA_GIT_ATTRIBUTION: "0" } : {} });
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(fixture.raw(["log", "-1", "--format=%B"]), /Co-authored-by/);
    }
  });

  test("hook rejection and signing failures are preserved, and dry-run creates no commit", () => {
    const fixture = gitLauncherFixture();
    assert.equal(fixture.git(["commit", "--dry-run"]).status, 0);
    assert.equal(existsSync(join(fixture.directory, ".git", "HEAD")), true);
    assert.equal(fixture.run("/usr/bin/git", ["-C", fixture.directory, "rev-parse", "--verify", "HEAD"]).status, 128);
    const hook = join(fixture.directory, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 42\n", { mode: 0o755 });
    assert.notEqual(fixture.git(["commit", "-m", "Rejected by hook"]).status, 0);
    rmSync(hook);
    const signer = join(fixture.directory, "owner signer");
    writeFileSync(signer, "#!/bin/sh\nprintf yes > .git/owner-signer\nexit 19\n", { mode: 0o755 });
    fixture.raw(["config", "gpg.program", signer]); fixture.raw(["config", "commit.gpgsign", "true"]);
    assert.notEqual(fixture.git(["commit", "-m", "Must be signed"]).status, 0);
    assert.equal(readFileSync(join(fixture.directory, ".git", "owner-signer"), "utf8"), "yes");
    assert.equal(fixture.raw(["config", "commit.gpgsign"]), "true");
  });

  test("SSH commits receive attribution with options, quotes, stdin and login shells intact", () => {
    for (const login of [false, true]) {
      const fixture = gitLauncherFixture();
      const environment = join(fixture.directory, "owner bash env");
      writeFileSync(environment, "export CORA_TEST_MARK=preserved\n");
      const command = `test \"$CORA_TEST_MARK\" = preserved && git -C ${fixture.quote(fixture.directory)} commit -m ${fixture.quote("Remote owner's approved change")}`;
      const result = fixture.ssh(["-vv", "-o", "BatchMode=yes", "-p2222", "owner@host", login ? "bash" : "bash", login ? "-lc" : "-s", ...(login ? [fixture.quote(command)] : [])], { input: login ? undefined : command, extraEnv: { BASH_ENV: environment } });
      assert.equal(result.status, 0, result.stderr);
      const args = JSON.parse(readFileSync(join(fixture.directory, "ssh-args.json"), "utf8"));
      assert.deepEqual(args.slice(0, 5), ["-vv", "-o", "BatchMode=yes", "-p2222", "owner@host"]);
      assert.ok(args[5].startsWith("sh -c "));
      assert.match(fixture.raw(["log", "-1", "--format=%B"]), /Co-authored-by: Cora <git@usecora.space>/);
      assert.equal(fixture.raw(["log", "-1", "--format=%an <%ae>"]), "Repository Owner <owner@example.test>");
      assert.deepEqual(readdirSync(fixture.remoteTmp), [], "only its own temporary launcher was removed");
    }
  });

  test("SSH transport, subsystem and control commands pass through unchanged", () => {
    const fixture = gitLauncherFixture();
    for (const args of [["-G", "host"], ["-O", "check", "host"], ["-s", "host", "sftp"], ["host", "git-upload-pack '/repo'"], ["host", "git-receive-pack '/repo'"], ["host", "/usr/bin/git-upload-pack '/repo'"], ["host", "scp -t /target"], ["host", "rsync --server /target"]]) {
      assert.equal(fixture.ssh(args).status, 0);
      assert.deepEqual(JSON.parse(readFileSync(join(fixture.directory, "ssh-args.json"), "utf8")), args);
    }
    assert.equal(fixture.ssh(["host", "exit 23"]).status, 23);
    assert.deepEqual(readdirSync(fixture.remoteTmp), []);
  });

  test("SSH respects command disable and remote repository opt-out", () => {
    for (const choice of ["command", "repository"]) {
      const fixture = gitLauncherFixture();
      if (choice === "repository") fixture.raw(["config", "cora.attribution", "false"]);
      const command = `git -C ${fixture.quote(fixture.directory)} commit -m 'Remote opt-out'`;
      const result = fixture.ssh(["host", command], { extraEnv: choice === "command" ? { CORA_GIT_ATTRIBUTION: "0" } : {} });
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(fixture.raw(["log", "-1", "--format=%B"]), /Co-authored-by/);
    }
  });
});

describe("desktop Git attribution provisioning", () => {
  test("existing desktops receive idempotent launchers as root without an image build", async () => {
    const fixture = gitSetupFixture();
    const boxes = new Boxes({ docker: fixture.docker, timezone: "UTC", gitAttribution: { enabled: true, email: "cora@example.test" } });
    const agent = { id: "provisioned", tools: true };
    await boxes.ensureGitAttribution(agent, { startedAt: "first-start" });
    await boxes.ensureGitAttribution(agent, { startedAt: "first-start" });
    assert.equal(readFileSync(fixture.calls, "utf8").trim().split("\n").length, 1);
    const installed = spawnSync(join(fixture.bin, "git"), ["--version"], { encoding: "utf8" });
    assert.equal(installed.status, 0, installed.stderr);
    assert.match(installed.stdout, /git version/);
    assert.equal(JSON.parse(readFileSync(join(fixture.root, "policy.json"), "utf8")).email, "cora@example.test");
    await boxes.ensureGitAttribution(agent, { startedAt: "second-start" });
    assert.equal(readFileSync(fixture.calls, "utf8").trim().split("\n").length, 2);
    assert.equal(readFileSync(fixture.calls, "utf8").includes('"build"'), false);
  });

  test("a conflicting owner launcher is refused without replacement", async () => {
    const fixture = gitSetupFixture();
    const owner = "#!/bin/sh\nexit 37\n";
    writeFileSync(join(fixture.bin, "git"), owner, { mode: 0o755 });
    const boxes = new Boxes({ docker: fixture.docker, timezone: "UTC", gitAttribution: { enabled: true, email: "cora@example.test" } });
    await assert.rejects(boxes.ensureGitAttribution({ id: "conflict", tools: true }, { startedAt: "first-start" }), /refusing to replace an existing git launcher/);
    assert.equal(readFileSync(join(fixture.bin, "git"), "utf8"), owner);
    assert.equal(existsSync(fixture.root), false);
  });

  test("instance policy can be disabled on an already provisioned desktop", async () => {
    const fixture = gitSetupFixture();
    const boxes = new Boxes({ docker: fixture.docker, timezone: "UTC", gitAttribution: { enabled: true, email: "cora@example.test" } });
    await boxes.ensureGitAttribution({ id: "policy", tools: true }, { startedAt: "same-start" });
    boxes.gitAttribution = { enabled: false, email: "cora@example.test" };
    await boxes.ensureGitAttribution({ id: "policy", tools: true }, { startedAt: "same-start" });
    assert.equal(JSON.parse(readFileSync(join(fixture.root, "policy.json"), "utf8")).enabled, false);
    assert.match(readFileSync(join(fixture.root, "git"), "utf8"), /default_enabled=0/);
  });
});

test("git_commit uses the managed launcher and honors its repository and task policy", async () => {
  for (const choice of ["enabled", "repository", "task"]) {
    const fixture = gitLauncherFixture();
    if (choice === "repository") fixture.raw(["config", "cora.attribution", "false"]);
    const dockerBin = join(fixture.directory, "tool-docker");
    writeFileSync(dockerBin, `#!${process.execPath}
const {spawnSync}=require('node:child_process');const {readFileSync}=require('node:fs');const args=process.argv.slice(2);const at=args.indexOf('git');if(at<0)process.exit(99);
const extra={};const envAt=args.indexOf('env');if(envAt>=0)for(const item of args.slice(envAt+1,at)){const at=item.indexOf('=');extra[item.slice(0,at)]=item.slice(at+1)};
const result=spawnSync(${JSON.stringify(join(fixture.bin, "git"))},args.slice(at+1),{input:readFileSync(0),env:{PATH:process.env.PATH,HOME:${JSON.stringify(fixture.directory)},GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',...extra}});process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');process.exit(result.status??1);
`, { mode: 0o755 });
    const boxes = new Boxes({ docker: dockerBin, timezone: "UTC", gitAttribution: { enabled: true, email: "git@usecora.space" } });
    boxes.gitChecks.set("managed", "ready");
    const result = await boxes.gitCommit("managed", fixture.directory, "Managed tool policy", choice === "task" ? "" : "Co-authored-by: Cora <custom@example.test>");
    assert.equal(result.code, 0, result.output);
    const message = fixture.raw(["log", "-1", "--format=%B"]);
    if (choice === "enabled") assert.match(message, /Co-authored-by: Cora <custom@example.test>/);
    else assert.doesNotMatch(message, /Co-authored-by/);
  }
});

describe("email channel", () => {
  async function emailWorld(t) {
    const f = await mailWorld(t);
    clearInterval(f.app.email.timer); clearTimeout(f.app.email.initial);
    const created = await f.call("/api/agents", { method: "POST", body: { name: "Email agent", tools: true, model: "ollama/test-model" } });
    const agent = f.app.store.agent(created.data.id);
    await waitFor(() => f.app.store.value(`agentMailbox:${agent.id}`, null)?.status === "ready", { timeout: 20000 });
    const mailbox = f.app.store.value(`agentMailbox:${agent.id}`).email;
    const channels = [{ id: CHANNEL, name: "general", kind: "discord", guildId: GUILD }, { id: OTHER_CHANNEL, name: "email-reports", kind: "discord", guildId: GUILD }];
    f.app.channels.list = () => channels;
    f.app.channels.listFor = () => channels;
    f.app.orchestrator.bots.canRead = async () => true;
    f.app.email.instanceUrl = f.base;
    const posts = [];
    f.app.orchestrator.postDirect = async (who, state, target, text, options) => { posts.push({ agentId: who.id, target, text, options }); return [{ id: `post-${posts.length}` }]; };
    f.app.orchestrator.postAs = async (who, state, text, file, trace, options) => { posts.push({ agentId: who.id, target: state.id, text, options }); return [{ id: `post-${posts.length}` }]; };
    return { ...f, agent, mailbox, posts };
  }

  test("automatic configuration, sender rules, encrypted reads, recap and duplicate delivery", async (t) => {
    const f = await emailWorld(t), { app, agent, mailbox } = f;
    assert.equal((await f.call("/api/mail/channel", { auth: false })).status, 401);
    assert.equal((await f.call("/api/mail/channel", { method: "PUT", asMember: true, body: { enabled: true } })).status, 403);
    assert.equal((await f.call("/api/mail/channel", { method: "PUT", body: { enabled: true, senders: ["@ambox.dev"] } })).status, 200);
    f.deliver(mailbox, { at: new Date(Date.now() - 86400000).toISOString(), subject: "Old email" });
    const email = f.deliver(mailbox, { subject: "Please review", body: "Encrypted fixture message" });
    f.deliver(mailbox, { subject: "Spam", folder: "spam" });
    f.deliver(mailbox, { from: "noreply@ambox.dev", subject: "Automatic" });
    f.deliver(mailbox, { from: "person@other.test", subject: "Filtered out" });
    await app.email.poll(agent); await app.email.processing.get(agent.id);
    assert.equal(f.posts.length, 1);
    assert.match(f.posts[0].text, /Please review/);
    assert.equal(f.posts[0].target, CHANNEL);
    assert.equal(f.posts[0].options.passive, true);
    assert.match(f.state.webhooks.get(mailbox).url, new RegExp(`/mail/events/${agent.id}/`));
    await app.email.poll(agent); await app.email.processing.get(agent.id);
    assert.equal(f.posts.length, 1);
    const recap = await f.call(`/api/agents/${agent.id}/email`);
    assert.equal(recap.data.summary.received, 5);
    assert.equal(recap.data.recent.find((item) => item.id === email.id).status, "notified");
    assert.doesNotMatch(JSON.stringify(recap.data), /fixture-mailbox-client-key|BEGIN PRIVATE|Encrypted fixture message/);
    assert.match((await executeTool({ name: "email_read", args: { id: email.id } }, { agent, email: app.email })).text, /authorized user/);
    const read = await executeTool({ name: "email_read", args: { id: email.id } }, { agent, email: app.email, requester: { kind: "owner" } });
    assert.match(read.text, /Encrypted fixture message/);
    assert.equal((await f.call(`/api/agents/${agent.id}/email`, { method: "PUT", asMember: true, body: { mode: "auto" } })).status, 403);
    const refused = await executeTool({ name: "email_read", args: { id: email.id } }, { agent: { ...agent, id: "ag_other" }, email: app.email });
    assert.match(refused.text, /error:/);
    await f.call("/api/mail/channel", { method: "PUT", body: { enabled: false } });
    f.deliver(mailbox, { subject: "While disabled" });
    await app.email.poll(agent); await app.email.processing.get(agent.id);
    assert.equal(f.posts.length, 1);
    assert.equal(f.state.webhooks.get(mailbox).url, "");
  });

  test("signed push wakes the correct mailbox and rejects forged events", async (t) => {
    const f = await emailWorld(t);
    await f.call("/api/mail/channel", { method: "PUT", body: { enabled: true } });
    await f.app.email.poll(f.agent); await f.app.email.processing.get(f.agent.id);
    const hook = f.state.webhooks.get(f.mailbox);
    const email = f.deliver(f.mailbox, { subject: "Push notification" });
    const body = JSON.stringify({ type: "email.received", email_id: email.id, from: email.from, folder: "inbox", received_at: email.received_at });
    const bad = await fetch(hook.url, { method: "POST", body, headers: { "Content-Type": "application/json", "X-Ambox-Signature": "sha256=invalid" } });
    assert.equal(bad.status, 401);
    assert.equal(f.posts.length, 0);
    const signature = `sha256=${createHmac("sha256", hook.secret).update(body).digest("hex")}`;
    assert.equal((await fetch(hook.url, { method: "POST", body, headers: { "Content-Type": "application/json", "X-Ambox-Signature": signature } })).status, 200);
    await waitFor(() => f.posts.length === 1, { timeout: 20000 });
    await f.app.email.poll(f.agent); await f.app.email.processing.get(f.agent.id);
    assert.match(f.posts[0].text, /Push notification/);
    assert.equal((await fetch(hook.url, { method: "POST", body, headers: { "X-Ambox-Signature": signature } })).status, 200);
    await f.app.email.poll(f.agent); await f.app.email.processing.get(f.agent.id);
    assert.equal(f.posts.length, 1);
  });

  test("an authorized agent persists its report destination and cannot choose an inaccessible channel", async (t) => {
    const f = await emailWorld(t);
    const ctx = { agent: f.agent, email: f.app.email, postingChannels: f.app.channels.listFor(f.agent) };
    const call = { name: "email_settings", args: { channel_id: OTHER_CHANNEL } };
    assert.match((await executeTool(call, ctx)).text, /error:/);
    assert.match((await executeTool(call, { ...ctx, requester: { kind: "owner" }, emailInvocation: { id: "untrusted" } })).text, /error:/);
    assert.equal(JSON.parse((await executeTool(call, { ...ctx, requester: { kind: "authorized" } })).text).saved, true);
    assert.equal(f.app.email.destination(f.agent).id, OTHER_CHANNEL);
    f.app.orchestrator.bots.canRead = async () => false;
    assert.match((await executeTool({ name: "email_settings", args: { channel_id: CHANNEL } }, { ...ctx, requester: { kind: "owner" } })).text, /error:/);
    assert.equal(f.app.email.destination(f.agent).id, OTHER_CHANNEL);
    assert.equal((await f.call(`/api/agents/${f.agent.id}/email`, { method: "PUT", body: { reportChannelId: "not-listed" } })).status, 400);
    assert.equal(f.app.email.destination({ ...f.agent, name: "Renamed" }).id, OTHER_CHANNEL);
  });

  test("automatic handling reads and drafts with the actual tool loop without granting desktop access", async (t) => {
    const f = await emailWorld(t);
    await f.call("/api/mail/channel", { method: "PUT", body: { enabled: true, mode: "auto", reportChannelId: OTHER_CHANNEL } });
    const email = f.deliver(f.mailbox, { subject: "Question", body: "Can you prepare a response?" });
    let failure;
    const actualTurn = f.app.brain.emailTurn.bind(f.app.brain);
    f.app.brain.emailTurn = async (options) => { try { return await actualTurn(options); } catch (error) { failure = error; throw error; } };
    let step = 0;
    f.app.llm.capabilities = async () => ({ tools: true });
    f.app.llm.chat = async ({ tools, messages }) => {
      if (tools?.length) {
        assert.equal(tools.some((tool) => tool.name === "shell"), false);
        if (step++ === 0) return { text: "", toolCalls: [{ id: "read", name: "email_read", args: { id: email.id } }] };
        if (step === 2) {
          assert.match(messages.at(-1).content, /Can you prepare a response/);
          return { text: "", toolCalls: [{ id: "draft", name: "email_draft", args: { to: ["robin+sender@ambox.dev"], subject: "Re: Question", body_text: "Here is a draft." } }] };
        }
      }
      return { text: "Ho preparato una bozza per la nuova email.", toolCalls: [] };
    };
    await f.app.email.poll(f.agent); await f.app.email.processing.get(f.agent.id);
    assert.ifError(failure);
    assert.equal(f.state.sent.length, 0);
    assert.equal(f.app.email.summary(f.agent).draft, 1);
    assert.equal(f.posts.at(-1).target, OTHER_CHANNEL);
    assert.equal(f.posts.at(-1).options.passive, true);
    assert.equal(f.app.email.recent(f.agent).find((item) => item.id === email.id).status, "processed");
    const draft = f.app.email.recent(f.agent).find((item) => item.direction === "draft");
    assert.match(JSON.stringify(await f.app.email.read(f.agent, draft.id)), /Here is a draft/);
    assert.equal(f.app.orchestrator.threadWork.has(OTHER_CHANNEL), false);
    assert.match((await executeTool({ name: "email_send", args: { to: ["robin+sender@ambox.dev"], subject: "No", body_text: "Not authorized" } }, { agent: f.agent, email: f.app.email, emailInvocation: { id: email.id } })).text, /error:/);
  });

  test("authorized chat retains email controls when the agent desktop is disabled", async (t) => {
    const f = await emailWorld(t), google = await googleConnectorFixture(t, f);
    await google.connect();
    const connection = (await f.call("/api/connectors")).data.connections[0];
    await f.call(`/api/connectors/${connection.id}`, { method: "PUT", body: { agents: [f.agent.id] } });
    const agent = f.app.store.updateAgent(f.agent.id, { tools: false });
    const results = [];
    let step = 0;
    f.app.llm.capabilities = async () => ({ tools: true });
    f.app.llm.chat = async ({ tools, messages }) => {
      if (!tools?.length) return { text: "DONE", toolCalls: [] };
      assert.equal(tools.some((tool) => tool.name === "shell"), false);
      if (step++ === 0) return { text: "", toolCalls: [{ id: "senders", name: "email_inbox", args: {} }] };
      results.push(messages.at(-1).content);
      if (step === 2) return { text: "", toolCalls: [{ id: "destination", name: "email_settings", args: { channel_id: OTHER_CHANNEL } }] };
      return { text: "Email controls checked.", toolCalls: [] };
    };
    await f.app.orchestrator.onWebMessage({ room: `web-${agent.id}`, text: "Check my sending address and set the email report destination.", user: f.app.store.panelUser("local-owner") });
    await waitFor(() => step >= 3 && f.posts.some((post) => post.text === "Email controls checked."), { timeout: 20000 });
    assert.match(results[0], /robin\+google@ambox.dev/);
    assert.match(results[1], /"saved":true/);
    assert.equal(f.app.email.destination(agent).id, OTHER_CHANNEL);
    await waitFor(() => !f.app.orchestrator.state(`web-${agent.id}`).working?.has(agent.id));
    const state = f.app.orchestrator.state(CHANNEL);
    for (const allowed of [true, false]) {
      f.app.store.updateSettings({ permissions: allowed ? [{ id: `discord:${STRANGER}`, name: "Trusted contact", agents: [agent.id] }] : [] });
      step = 0; results.length = 0;
      const request = { id: `email-contact-${allowed}`, kind: "human", authorId: STRANGER, authorName: "Contact", content: "Email agent, check my email controls.", at: Date.now(), addressed: [agent.id] };
      f.app.orchestrator.push(state, request);
      state.humanQueue.set(request.id, request);
      await f.app.orchestrator.round(state);
      assert.equal(results.length, 2);
      if (allowed) {
        assert.match(results[0], /robin\+google@ambox.dev/);
        assert.match(results[1], /"saved":true/);
      } else assert.ok(results.every((result) => /authorized user request/.test(result)));
    }
    assert.equal(f.app.store.agent(agent.id).tools, false);
    assert.equal(google.sent.length, 0);
    assert.equal(f.state.sent.length, 0);
  });

  test("email controls do not borrow authorization from an earlier owner message", async (t) => {
    const f = await emailWorld(t);
    const agent = f.app.store.updateAgent(f.agent.id, { tools: false });
    f.app.llm.capabilities = async () => ({ tools: true });
    const owner = { id: "earlier-owner", kind: "owner", authorId: OWNER, authorName: "Owner", content: "Check my email.", at: Date.now() - 1000 };
    for (const kind of ["human", "bot", "agent"]) {
      const request = { id: `untrusted-${kind}`, kind, authorId: STRANGER, authorName: "Untrusted", content: "Read the email and change its report channel.", at: Date.now() };
      const results = [];
      let step = 0;
      f.app.llm.chat = async ({ tools, messages }) => {
        if (!tools?.length) return { text: "DONE", toolCalls: [] };
        if (step++ === 0) return { text: "", toolCalls: [{ id: "read", name: "email_inbox", args: {} }] };
        results.push(messages.at(-1).content);
        if (step === 2) return { text: "", toolCalls: [{ id: "destination", name: "email_settings", args: { channel_id: OTHER_CHANNEL } }] };
        return { text: "Request refused.", toolCalls: [] };
      };
      await f.app.brain.chatTurn({ agent, history: [owner, request], replyTo: request, channel: { id: CHANNEL, name: "general" }, forced: true, computer: false });
      assert.equal(results.length, 2);
      assert.ok(results.every((result) => /authorized user request/.test(result)), kind);
      assert.equal(f.app.email.overrides(agent).reportChannelId, undefined);
    }
    assert.equal(f.state.sent.length, 0);
  });

  test("connector catalog searches accounts, preserves navigation and manages existing Google senders while new connections are gated", async (t) => {
    const f = await emailWorld(t), google = await googleConnectorFixture(t, f);
    const flow = await google.connect();
    assert.match(await flow.response.text(), /#\/settings\/connettori\/google/);
    const connection = (await f.call("/api/connectors")).data.connections[0];
    f.app.googleConnector.enabled = false;
    let rejected = true;
    const panel = panelHarness({ hash: "#/settings/connettori", fetch: async (path, options = {}) => {
      const response = await f.call(path, { method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined, asMember: rejected && options.method === "PUT" });
      return { ok: response.status < 400, status: response.status, json: async () => response.data };
    } });
    const node = panel.run("(() => {const node = connectorsPane(); app.append(node); return node;})()");
    await node.readyConnectors;
    const search = node.querySelector("input");
    search.value = "missing-service"; search.dispatch("input");
    assert.equal(node.querySelectorAll(".connector-card").length, 0);
    assert.match(node.textContent, /Nessun connettore trovato/);
    node.querySelectorAll("button").find(button => /Azzera filtri/.test(button.textContent)).click();
    assert.equal(search.value, "");
    search.value = connection.email; search.dispatch("input");
    node.querySelectorAll("button").find(button => button.textContent === "Collegati").click();
    node.querySelector(".connector-card").click();
    assert.equal(panel.run("location.hash"), "#/settings/connettori/google");
    assert.equal(node.querySelector(".connector-catalog").hidden, true);
    assert.equal(node.querySelectorAll("button").find(button => /Collega un altro/.test(button.textContent)).getAttribute("disabled"), "");
    const connected = node.querySelectorAll(".connector-connected");
    assert.equal(connected.length, 2);
    for (const card of connected) assert.equal(card.getAttribute("open"), null);
    connected[1].open = true; connected[1].dispatch("toggle");
    const input = node.querySelectorAll("input").find(input => input.getAttribute("type") === "checkbox");
    input.checked = true; input.dispatch("change");
    assert.equal(input.disabled, true);
    await waitFor(() => /Connettore privato/.test(node.textContent));
    assert.equal(input.checked, false); assert.equal(input.disabled, false);
    assert.deepEqual(f.app.googleConnector.records()[0].agents, []);
    rejected = false; input.checked = true; input.dispatch("change");
    await waitFor(() => /Agenti autorizzati aggiornati/.test(node.textContent));
    assert.deepEqual(f.app.googleConnector.records()[0].agents, [f.agent.id]);
    assert.ok(node.querySelectorAll("a").some(link => link.getAttribute("href") === `#/agent/${f.agent.id}/email/invio`));
    assert.equal((await f.call(`/api/agents/${f.agent.id}/email`, { method: "PUT", body: { senderId: connection.id } })).status, 200);
    node.querySelector(".connector-back").click();
    assert.equal(search.value, connection.email);
    assert.equal(node.querySelectorAll("button").find(button => button.textContent === "Collegati").getAttribute("aria-pressed"), "true");
    node.querySelector(".connector-card").click();
    const disconnect = node.querySelectorAll("button").find(button => button.textContent === "Scollega");
    disconnect.click();
    assert.equal(f.app.googleConnector.records()[0].disconnected, false);
    disconnect.click();
    await waitFor(() => f.app.googleConnector.records()[0].disconnected);
    await waitFor(() => !node.querySelector(".connector-detail").textContent.includes(connection.email));
    node.querySelector(".connector-back").click();
    assert.match(node.querySelector(".connector-catalog").textContent, /Nessun connettore trovato/);
  });

  test("connector catalog recovers a failed load, filters empty connections and keeps member controls read-only", async (t) => {
    const f = await emailWorld(t);
    let fail = true;
    const panel = panelHarness({ hash: "#/settings/connettori/google", language: "en", fetch: async (path, options = {}) => {
      if (fail) { fail = false; return { ok: false, status: 503, json: async () => ({ error: "Fixture connector load failed" }) }; }
      const response = await f.call(path, { method: options.method || "GET", asMember: true });
      return { ok: response.status < 400, status: response.status, json: async () => response.data };
    } });
    const node = panel.run("(() => {const node = connectorsPane(); app.append(node); return node;})()");
    await node.readyConnectors;
    assert.match(node.textContent, /Fixture connector load failed/);
    node.querySelectorAll("button").find(button => button.textContent === "Try again").click();
    await waitFor(() => /1. Connect your account/.test(node.textContent));
    assert.equal(node.querySelector(".connector-catalog").hidden, true);
    assert.equal(node.querySelectorAll("button").find(button => button.textContent === "Connect Google account").getAttribute("disabled"), "");
    assert.match(node.textContent, /Only the owner can change connectors/);
    node.querySelector(".connector-back").click();
    node.querySelectorAll("button").find(button => button.textContent === "Connected").click();
    assert.match(node.querySelector(".connector-catalog").textContent, /No connected services/);
    node.querySelectorAll("button").find(button => button.textContent === "Reset filters").click();
    assert.deepEqual(node.querySelectorAll(".connector-card").map(card => card.querySelector(".connector-card-name").textContent), ["Google", "Linear", "Asana", "Canva"]);
    assert.equal((await f.call("/api/connectors/google", { method: "POST", asMember: true })).status, 403);
  });

  test("Google review gate blocks new connections while existing authorized senders keep working", async (t) => {
    const f = await emailWorld(t);
    assert.equal(f.app.googleConnector.enabled, false);
    const google = await googleConnectorFixture(t, f);
    assert.equal((await google.connect()).response.status, 200);
    const connection = (await f.call("/api/connectors")).data.connections[0];
    await f.call(`/api/connectors/${connection.id}`, { method: "PUT", body: { agents: [f.agent.id] } });
    await f.call(`/api/agents/${f.agent.id}/email`, { method: "PUT", body: { senderId: connection.id } });
    f.app.googleConnector.enabled = false;

    const view = await f.call("/api/connectors");
    assert.equal(view.data.available, false);
    assert.deepEqual(view.data.connections[0].agents, [f.agent.id]);
    const pending = f.app.googleConnector.pending.size;
    assert.equal((await f.call("/api/connectors/google", { method: "POST" })).status, 409);
    assert.equal(f.app.googleConnector.pending.size, pending);
    assert.equal((await f.call(`/api/agents/${f.agent.id}/email`)).data.overrides.senderId, connection.id);

    f.app.googleConnector.access.clear();
    const sent = await f.app.email.send(f.agent, { to: ["robin+google-recipient@ambox.dev"], subject: "Existing authorized sender", body_text: "Previously connected account" }, { requester: { kind: "owner" } });
    assert.equal(sent.status, "sent");
    assert.equal(google.sent.length, 1);
    assert.ok(google.requests.some((request) => request.path === "/token" && new URLSearchParams(request.body).get("grant_type") === "refresh_token"));
    assert.equal(f.state.sent.length, 0);
  });

  test("Google OAuth uses Fluxkit through the broker and restricts external sending to assigned agents", async (t) => {
    const f = await emailWorld(t), google = await googleConnectorFixture(t, f);
    assert.equal((await f.call("/api/connectors/google", { method: "POST", asMember: true })).status, 403);
    const flow = await google.connect();
    assert.equal(flow.response.status, 200);
    assert.equal(flow.authorize.searchParams.get("scope"), "openid email https://www.googleapis.com/auth/gmail.send");
    assert.equal(flow.authorize.searchParams.get("include_granted_scopes"), null);
    assert.equal(flow.authorize.searchParams.get("code_challenge_method"), "S256");
    assert.equal(flow.target.origin, "https://fixture.usecora.test");
    const view = await f.call("/api/connectors"), connection = view.data.connections[0];
    assert.equal(connection.email, "robin+google@ambox.dev");
    assert.deepEqual(connection.agents, []);
    assert.doesNotMatch(JSON.stringify(view.data), /fixture-google-refresh|fixture-google-access|fixture-google-client-secret|\"grant\"/);
    assert.equal([...f.vault.keys()].some((name) => name.startsWith("CORA_GOOGLE_GC_")), true);
    const replay = await fetch(`${f.base}${flow.target.pathname}${flow.target.search}`, { headers: { Cookie: flow.cookie } });
    assert.equal(replay.status, 400);
    assert.equal((await f.call(`/api/agents/${f.agent.id}/email`, { method: "PUT", body: { senderId: connection.id } })).status, 403);
    assert.equal((await f.call(`/api/connectors/${connection.id}`, { method: "PUT", body: { agents: [f.agent.id] } })).status, 200);
    assert.equal((await f.call(`/api/agents/${f.agent.id}/email`, { method: "PUT", body: { senderId: connection.id } })).status, 200);
    const result = await f.app.email.send(f.agent, { to: ["robin+google-recipient@ambox.dev"], subject: "External sender", body_text: "Google fixture email", body_html: "<p>Google fixture email</p>" }, { requester: { kind: "owner" } });
    assert.equal(result.status, "sent");
    assert.equal(google.sent.length, 1);
    assert.match(google.sent[0], /From: .*<robin\+google@ambox.dev>/);
    assert.match(google.sent[0], /multipart\/alternative/);
    assert.equal(f.state.sent.length, 0);
    assert.equal(f.app.email.summary(f.agent).sent, 1);
    assert.equal(f.app.email.recent(f.agent)[0].mailbox, "robin+google@ambox.dev");
    assert.equal((await f.call(`/api/connectors/${connection.id}`, { method: "DELETE", asMember: true })).status, 403);
    assert.equal((await f.call(`/api/connectors/${connection.id}`, { method: "DELETE" })).status, 200);
    await assert.rejects(() => f.app.email.send(f.agent, { to: ["robin+google-recipient@ambox.dev"], subject: "No", body_text: "No" }, { requester: { kind: "owner" } }), /autorizzato/);
    assert.equal(google.sent.length, 1);
  });

  test("backlogs paginate without duplicates and persisted work is not blindly repeated after a restart", async (t) => {
    const f = await emailWorld(t);
    await f.call("/api/mail/channel", { method: "PUT", body: { enabled: true } });
    for (let i = 0; i < 61; i++) f.deliver(f.mailbox, { subject: `Backlog ${i}` });
    await f.app.email.poll(f.agent); await f.app.email.processing.get(f.agent.id);
    assert.equal(f.app.email.summary(f.agent).received, 61);
    assert.equal(f.posts.length, 10);
    await f.app.email.poll(f.agent); await f.app.email.processing.get(f.agent.id);
    assert.equal(f.app.email.summary(f.agent).received, 61);
    assert.equal(f.posts.length, 20);
    const email = f.app.email.recent(f.agent).find((item) => item.status === "pending");
    f.app.email.status(f.agent, email, "working", CHANNEL);
    const store = new Store(f.home);
    t.after(() => store.close());
    const restarted = new EmailChannel({ store, boxes: f.app.boxes, channels: f.app.channels, orchestrator: f.app.orchestrator, instanceUrl: f.base, key: "fixture-key" });
    assert.equal(restarted.recent(f.agent).find((item) => item.id === email.id).status, "interrupted");
    assert.equal(restarted.summary(f.agent).received, 61);
  });

  test("the agent email page separates its sections and keeps drafts while switching tabs", async (t) => {
    const f = await emailWorld(t);
    const state = (await f.call("/api/state")).data;
    const panel = panelHarness({ language: "en", fetch: async (path, init = {}) => {
      const response = await f.call(path, { method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined });
      return { ok: response.status < 400, status: response.status, json: async () => response.data };
    } });
    panel.run(`S.data=${JSON.stringify(state)}; location.hash=${JSON.stringify(`#/agent/${f.agent.id}/email`)}; globalThis.history={replaceState(_a,_b,path){location.hash=path;}}; document.getElementById("app").replaceChildren(agentEmailWorkspace(S.data.agents[0],[h("p",{},"Mailbox identity")]));`);
    await waitFor(() => panel.run(`Boolean(document.getElementById("app").querySelector('textarea'))`));
    const result = panel.run(`(() => {
      const root=document.getElementById("app");
      const tabs=root.querySelectorAll(".rail-item");
      const panes=()=>root.querySelectorAll(".email-section").filter(item=>!item.hidden).map(item=>item.attributes.id.split("-").at(-1));
      const first=panes();
      tabs[1].click();
      const rules=root.querySelectorAll("textarea")[0];rules.value="Keep this draft";
      tabs[2].click();const sending=panes();
      tabs[1].click();const kept=rules.value;
      tabs[3].click();
      return {first,sending,kept,last:panes(),hash:location.hash,tabCount:tabs.length};
    })()`);
    assert.deepEqual(result.first,["casella"]);
    assert.deepEqual(result.sending,["invio"]);
    assert.equal(result.kept,"Keep this draft");
    assert.deepEqual(result.last,["recap"]);
    assert.equal(result.hash,`#/agent/${f.agent.id}/email/recap`);
    assert.equal(result.tabCount,4);
  });

  test("an older mail service shows the recent recap and keeps its recovery boundary for a later upgrade", async (t) => {
    const f = await emailWorld(t);
    f.state.legacy = true;
    for (let i = 0; i < 61; i++) f.deliver(f.mailbox, { subject: `Older service ${i}` });
    await f.app.email.poll(f.agent); await f.app.email.processing.get(f.agent.id);
    assert.equal(f.app.email.summary(f.agent).received, 50);
    assert.equal(f.app.email.view(f.agent).status.state, "ready");
    assert.equal(f.app.email.view(f.agent).status.partial, true);
    f.state.legacy = false;
    await f.app.email.poll(f.agent); await f.app.email.processing.get(f.agent.id);
    assert.equal(f.app.email.summary(f.agent).received, 61);
    assert.equal(f.app.email.view(f.agent).status.partial, false);
  });

  test("Milo HTML, image signatures and open tracking distinguish preview from external fetch", async (t) => {
    const f = await emailWorld(t);
    await f.call(`/api/agents/${f.agent.id}/email`, { method: "PUT", body: { signature: "Nico\nCora team\nhttps://github.com/turinglabsorg" } });
    const message = { to: ["robin+email-channel@ambox.dev"], subject: "HTML example", body_text: "Hello\n\nSecond line", body_html: "<p><b>Hello</b></p>" };
    const sent = await f.app.email.send(f.agent, message, { requester: { kind: "owner" } });
    assert.equal(sent.status, "sent");
    assert.match(f.state.sent[0].body_html, /<b>Hello<\/b>/);
    assert.match(f.state.sent[0].body_html, /width="\d+" height="\d+" alt="Nico · Cora team"/);
    assert.match(f.state.sent[0].body_html, /github.com\/turinglabsorg/);
    assert.match(f.state.sent[0].body_text, /Nico\nCora team/);
    const image = f.state.sent[0].body_html.match(/src="([^"]+\.png)"/)[1];
    assert.equal(f.app.email.recent(f.agent)[0].opened, null);
    const preview = await fetch(`${f.base}/api/agents/${f.agent.id}/email/signature`, { headers: { Cookie: (await fetch(`${f.base}/api/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Cora": "1" }, body: JSON.stringify({ password: "fixture-password" }) })).headers.get("set-cookie").split(";")[0] } });
    assert.equal(preview.status, 200);
    assert.deepEqual([...Buffer.from(await preview.arrayBuffer()).subarray(0,4)], [137,80,78,71]);
    assert.equal(f.app.email.recent(f.agent)[0].opens, 0);
    await fetch(image, { method: "HEAD" });
    assert.equal(f.app.email.recent(f.agent)[0].opens, 0);
    const opened = await fetch(image);
    assert.equal(opened.status, 200);
    assert.equal(opened.headers.get("cache-control"), "no-store");
    assert.equal(f.app.email.recent(f.agent)[0].opens, 1);
    const first = f.app.email.recent(f.agent)[0].opened;
    await fetch(image);
    assert.equal(f.app.email.recent(f.agent)[0].opened, first);
    assert.equal(f.app.email.recent(f.agent)[0].opens, 2);
    await f.app.email.send(f.agent, { ...message, track: false }, { requester: { kind: "authorized" } });
    const untracked = f.state.sent[1].body_html.match(/src="([^"]+\.png)"/)[1];
    await fetch(untracked);
    assert.equal(f.app.email.recent(f.agent).find((item) => item.id !== sent.id).opens, 0);
    const template = '<html><body><p>Branded template</p></body></html>';
    await f.app.email.send(f.agent, { ...message, body_html: template }, { requester: { kind: "owner" } });
    assert.match(f.state.sent[2].body_html, /\.gif"[^>]+><\/body>/);
    assert.doesNotMatch(f.state.sent[2].body_html, /\.png/);
    await f.app.email.poll(f.agent); await f.app.email.processing.get(f.agent.id);
    assert.equal(f.app.email.summary(f.agent).sent, 3);
  });
});

describe("agent character sheet", () => {
  test("the generated character is in the system prompt, and the others list names its type", async (t) => {
    const analyst = app.store.createAgent({ name: "Carattere A", model: "ollama/test-model", enabled: true, tools: false, personality: "Ha lavorato con Seb.", character: { enabled: true, scores: { initiative: 8, speed: 12, endurance: 10, analysis: 18, prudence: 14, warmth: 12 }, method: 18, focus: 16 } });
    const connector = app.store.createAgent({ name: "Carattere B", model: "ollama/test-model", enabled: true, tools: false, character: { enabled: true, scores: { initiative: 10, speed: 14, endurance: 10, analysis: 10, prudence: 10, warmth: 18 }, method: 4, focus: 6 } });
    t.after(() => { app.store.deleteAgent(analyst.id); app.store.deleteAgent(connector.id); });
    const prompt = app.brain.systemPrompt(app.store.agent(analyst.id), { place: "", computer: false });
    assert.match(prompt, /### Scheda del carattere/);
    assert.match(prompt, /Tipo: \*\*Analista\*\* · Stile: \*\*Strutturato · Persone\*\*/);
    assert.match(prompt, /Analisi 18/);
    assert.doesNotMatch(prompt, /Ha lavorato con Seb/);
    assert.match(prompt, /- Carattere B: Connettore · Istintivo · Risultato/);
    const otherPrompt = app.brain.systemPrompt(app.store.agent(connector.id), { place: "", computer: false });
    assert.match(otherPrompt, /- Carattere A: Analista · Strutturato · Persone/);
  });

  test("the profile shows the character sliders for an agent saved before the sheet, with no free-text field", async (t) => {
    const login = await call("/api/login", { method: "POST", body: { password: PASSWORD }, auth: false });
    cookie = login.headers.get("set-cookie").split(";")[0];
    const agent = app.store.createAgent({ name: "Cursori", model: "ollama/test-model", enabled: false, tools: false, personality: "Nota libera." });
    t.after(() => app.store.deleteAgent(agent.id));
    const panel = panelHarness({ language: "en", fetch: (path, options) => fetch(`${base}${path}`, { ...options, headers: { ...options?.headers, Cookie: cookie } }) });
    await panel.run("boot()");
    await panel.navigate(`#/agent/${agent.id}/impostazioni/carattere`);
    const fieldNamed = (tag, name) => panel.app.querySelectorAll(tag).find((node) => node.attributes.name === name);
    await waitFor(() => fieldNamed("input", "char-analysis"), { what: "the character sliders" });
    assert.equal(fieldNamed("input", "characterOn"), undefined, "there is no sheet switch: the sliders are always there");
    assert.equal(fieldNamed("textarea", "personality"), undefined, "the old free-text personality field is gone");
    const preview = panel.app.querySelector(".character-preview");
    assert.match(preview.textContent, /Tipo: \*\*Versatile\*\* · Stile: \*\*Adattivo · Bilanciato\*\*/);
    assert.doesNotMatch(preview.textContent, /Nota libera/);
    assert.match(panel.app.querySelector(".character-legacy")?.textContent || "", /still the/);
    const analysis = fieldNamed("input", "char-analysis");
    analysis.value = "18";
    analysis.dispatch("input");
    assert.match(preview.textContent, /Tipo: \*\*Analista\*\* · Stile: \*\*Adattivo · Bilanciato\*\*/);
    assert.match(preview.textContent, /Analisi 18/);
    assert.match(preview.textContent, /\*\*Il tuo limite\.\*\* Analizzo troppo/);
    const form = panel.app.querySelectorAll("form").find((node) => node.attributes.id === `agent-settings-${agent.id}`);
    assert.ok(form, "the settings form is the one the sliders belong to");
    form.dispatch("submit");
    await waitFor(() => app.store.agent(agent.id).character?.enabled === true, { what: "the character saved" });
    assert.equal(app.store.agent(agent.id).character.scores.analysis, 18);
    assert.equal(app.store.agent(agent.id).character.method, 10);
    assert.equal(app.store.agent(agent.id).personality, "Nota libera.", "removing the field from the panel keeps the story the agent had");
    const savedPrompt = app.brain.systemPrompt(app.store.agent(agent.id), { place: "", computer: false });
    assert.match(savedPrompt, /### Scheda del carattere/);
    assert.match(savedPrompt, /Analisi 18/);
    assert.doesNotMatch(savedPrompt, /Nota libera/);
    await waitFor(() => panel.app.querySelectorAll("form").every((node) => node !== form), { what: "the panel to redraw after the save" });
    assert.match(panel.app.querySelector(".character-legacy")?.textContent || "", /kept and does not enter the prompt/);
    const clear = panel.app.querySelectorAll("button").find((node) => /Remove the story/.test(node.textContent));
    clear.click();
    await waitFor(() => app.store.agent(agent.id).personality === "" && panel.app.querySelector(".character-legacy") == null, { what: "the old story cleared" });
  });

  test("saving identity does not turn the character on", async () => {
    const login = await call("/api/login", { method: "POST", body: { password: PASSWORD }, auth: false });
    cookie = login.headers.get("set-cookie").split(";")[0];
    const agent = app.store.createAgent({ name: "Identita", model: "ollama/test-model", enabled: false, tools: false, personality: "Solo storia." });
    const panel = panelHarness({ language: "en", fetch: (path, options) => fetch(`${base}${path}`, { ...options, headers: { ...options?.headers, Cookie: cookie } }) });
    await panel.run("boot()");
    await panel.navigate(`#/agent/${agent.id}/impostazioni/identita`);
    const form = panel.app.querySelectorAll("form").find((node) => node.attributes.id === `agent-settings-${agent.id}`);
    const name = form.fields.find((field) => field.attributes.name === "name");
    name.value = "Identita due";
    form.dispatch("submit");
    await waitFor(() => app.store.agent(agent.id)?.name === "Identita due", { what: "the identity save" });
    await waitFor(() => panel.app.querySelectorAll("form").every((node) => node !== form), { what: "the panel to redraw after the save" });
    assert.equal(app.store.agent(agent.id).character, null);
    assert.equal(app.store.agent(agent.id).personality, "Solo storia.");
    const prompt = app.brain.systemPrompt(app.store.agent(agent.id), { place: "", computer: false });
    assert.match(prompt, /Solo storia/);
    assert.doesNotMatch(prompt, /Scheda del carattere/);
    app.store.deleteAgent(agent.id);
  });
});


test("agent remote access is in Security and sealed agents never load tailnet controls", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  f.app.boxes.inspect = async () => ({ exists: true, running: false, outdated: false });
  const created = await f.request(f.alice, "/api/agents", { method: "POST", body: { name: "Remote access fixture", tools: false, enabled: false } });
  const agent = f.app.store.agent(created.data.id);
  const calls = [];
  const fetchAs = async (path, options = {}) => {
    calls.push(path);
    const response = await f.request(f.alice, path, { method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
    return { ok: response.status < 400, status: response.status, json: async () => response.data };
  };
  const panel = panelHarness({ fetch: fetchAs, hash: `#/agent/${agent.id}/impostazioni/sicurezza` });
  panel.run(`S.data = ${JSON.stringify((await f.request(f.alice, "/api/state")).data)}`);
  panel.run(`globalThis.fixtureAgent = S.data.agents.find(a => a.id === ${JSON.stringify(agent.id)})`);
  const sealed = await panel.run("accessPanel({...fixtureAgent, sealed: true})");
  assert.match(sealed.textContent, /Questo agente è sigillato, non può attivare la tailnet/);
  assert.equal(sealed.querySelectorAll("button, a").length, 0);
  assert.equal(calls.length, 0, "sealed agents do not request connection status or stale authorization URLs");
  const open = await panel.run("accessPanel(fixtureAgent)");
  assert.match(open.textContent, /Accendi il desktop/);
  assert.ok(calls.includes(`/api/agents/${agent.id}/box/access`));
  calls.length = 0;
  const desktop = await panel.run("desktopTab(fixtureAgent)");
  assert.equal(desktop.length, 1);
  assert.doesNotMatch(desktop[0].textContent, /Accesso remoto|Collega a Tailscale/);
  assert.ok(!calls.some(path => path.endsWith("/access")));
  const settings = panel.run('agentForm(fixtureAgent, {only: "profile", knowledge: {sealed: false, canManage: true}})');
  await Promise.all(settings.querySelectorAll("div").map(node => node.readyAccess));
  assert.doesNotMatch(settings.textContent, /Salva sicurezza/);
  assert.match(settings.textContent, /Accesso remoto/);
  panel.run("fixtureAgent.sealed = true");
  const sealedSettings = panel.run('agentForm(fixtureAgent, {only: "profile", knowledge: {sealed: true, canManage: true}})');
  await Promise.all(sealedSettings.querySelectorAll("div").map(node => node.readyAccess));
  assert.match(sealedSettings.textContent, /Questo agente è sigillato, non può attivare la tailnet/);
  assert.doesNotMatch(sealedSettings.textContent, /Collega a Tailscale|Passando dalla macchina host/);
});


test("security seal autosaves, restores rejected changes and survives reload", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  f.app.boxes.inspect = async () => ({ exists: true, running: false, outdated: false });
  f.app.knowledge.onSealChanged = async () => {};
  const created = await f.request(f.alice, "/api/agents", { method: "POST", body: { name: "Autosave fixture", tools: false, enabled: false, sealed: true } });
  const id = created.data.id;
  let reject = true, writes = 0;
  const panel = panelHarness({ hash: `#/agent/${id}/impostazioni/sicurezza`, fetch: async (path, options = {}) => {
    if (path === `/api/agents/${id}/knowledge` && options.method === "PUT") {
      writes++;
      if (reject) return { ok: false, status: 503, json: async () => ({ error: "Expected save refusal" }) };
    }
    const response = await f.request(f.alice, path, { method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
    return { ok: response.status < 400, status: response.status, json: async () => response.data };
  } });
  await panel.run("loadState()");
  await panel.navigate(`#/agent/${id}/impostazioni/sicurezza`);
  const seal = () => panel.app.querySelectorAll("input").find(node => node.getAttribute("name") === "sealed");
  let input = seal();
  assert.equal(input.checked, true);
  assert.doesNotMatch(panel.app.textContent, /Salva sicurezza/);
  input.checked = false; input.dispatch("change");
  assert.equal(input.disabled, true);
  await waitFor(() => panel.app.textContent.includes("Expected save refusal"));
  assert.equal(input.checked, true);
  assert.equal(input.disabled, false);
  assert.equal(f.app.store.agent(id).sealed, true);
  reject = false;
  input.checked = false; input.dispatch("change");
  await waitFor(() => f.app.store.agent(id).sealed === false);
  await waitFor(() => seal() !== input && panel.app.textContent.includes("Accendi il desktop per collegarlo alla tailnet."));
  await panel.navigate(`#/agent/${id}/impostazioni/sicurezza`);
  assert.equal(Boolean(seal().checked), false);
  input = seal(); input.checked = true; input.dispatch("change");
  await waitFor(() => f.app.store.agent(id).sealed === true);
  await waitFor(() => seal() !== input && panel.app.textContent.includes("Questo agente è sigillato, non può attivare la tailnet"));
  assert.equal(writes, 3);
  const readonly = panel.run(`agentSecurityPane(S.data.agents.find(a => a.id === ${JSON.stringify(id)}), {sealed: true, canManage: false})`);
  assert.equal(readonly.querySelector("input").disabled, true);
});

test("encrypted access tools return only a scoped panel link and reject unverified or foreign callers", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  await f.request(f.admin, "/api/encrypted/settings", { method: "PUT", body: { enabled: true } });
  const folder = (await f.request(f.alice, "/api/artifacts/folders", { method: "POST", body: { path: "synthetic/tool-handoff", title: "Private archive" } })).data;
  const keys = await createFolderKeys(folder.id, "password", "synthetic verification password");
  const configured = await f.request(f.alice, `/api/encrypted/folders/${folder.id}/configure`, { method: "POST", body: keys });
  assert.equal(configured.status, 201);
  const document = "ed_" + randomBytes(12).toString("hex"), plaintext = "PRIVATE_HANDOFF_NEVER_IN_TOOL_OUTPUT";
  const envelope = await encryptDocument(keys.publicKey, plaintext, `cora:${folder.id}:${document}:1`);
  f.app.store.db.prepare("INSERT INTO encrypted_documents(id, folder, version, data) VALUES (?, ?, ?, ?)").run(document, folder.id, 1, JSON.stringify({ id: document, folder: folder.id, version: 1, kind: "artifact", envelope }));
  const agent = f.app.store.createAgent({ name: "Private handoff", model: "ollama/fixture", brainOwnerId: f.alice.user.id, enabled: false, tools: false });
  const ctx = { agent, store: f.app.store, knowledge: f.app.knowledge, requester: { kind: "owner", id: f.alice.user.id } };
  const call = { name: "encrypted_request", args: { folder: folder.id, document, version: 1, operation: "read" } };
  const result = await executeTool(call, ctx);
  assert.match(result.text, /NOT UNLOCKED/);
  assert.match(result.text, new RegExp(`/#/artefatti/${folder.id}/accessi`));
  assert.doesNotMatch(result.text, /PRIVATE_HANDOFF|ciphertext|privateKey|signingKey/);
  assert.equal(f.app.store.db.prepare("SELECT COUNT(*) AS n FROM encrypted_requests WHERE state = 'pending'").get().n, 1);
  for (const requester of [{ kind: "human", id: f.alice.user.id }, { kind: "owner", id: f.bob.user.id }]) {
    assert.match((await executeTool(call, { ...ctx, requester })).text, /error:/);
  }
  assert.equal(f.app.store.db.prepare("SELECT COUNT(*) AS n FROM encrypted_requests").get().n, 1);
  assert.doesNotMatch(f.app.brain.systemPrompt(agent, {}), /PRIVATE_HANDOFF_NEVER_IN_TOOL_OUTPUT/);
});


test("general encryption enforcement overrides agent opt-out and preserves optional personal encryption", async (t) => {
  const f = await knowledgeWorld(); t.after(f.close);
  const agent = f.app.store.createAgent({ name: "Encryption policy fixture", model: "ollama/fixture", brainOwnerId: f.alice.user.id, enabled: false, tools: true });
  const agentPath = `/api/encrypted/agents/${agent.id}`;
  assert.equal((await f.request(f.alice, agentPath, { method: "PUT", body: { encryptedOnly: true } })).status, 200);
  assert.equal((await f.request(f.alice, agentPath)).data.requiredBySpace, false);
  assert.equal((await f.request(f.alice, agentPath, { method: "PUT", body: { encryptedOnly: false } })).status, 200);
  const folder = (await f.request(f.alice, "/api/artifacts/folders", { method: "POST", body: { path: "fixture/enforcement" } })).data;
  const policy = await f.request(f.admin, "/api/encrypted/settings", { method: "PUT", body: { enabled: true } });
  assert.equal(policy.status, 200); assert.equal(policy.data.required, true);
  const effective = (await f.request(f.alice, agentPath)).data;
  assert.equal(effective.encryptedOnly, true); assert.equal(effective.personalEncryptedOnly, false); assert.equal(effective.requiredBySpace, true);
  assert.equal((await f.request(f.alice, agentPath, { method: "PUT", body: { encryptedOnly: false } })).status, 409);
  for (const name of ["shell", "artifact_push", "artifact_pull", "share_file", "brain_search", "email_send"]) {
    assert.match((await executeTool({ name, args: {} }, { agent, store: f.app.store })).text, /encrypted-only mode/);
  }
  const before = f.app.store.db.prepare("SELECT COUNT(*) AS n FROM artifact_objects").get().n;
  assert.throws(() => f.app.artifacts.putBytes(Buffer.from("SYNTHETIC_PLAINTEXT_MUST_BE_REFUSED")), (e) => e.status === 409);
  await assert.rejects(f.app.artifacts.push({ agent, folder: folder.path, path: "/home/agent/work" }), (e) => e.status === 409);
  await assert.rejects(f.app.artifacts.pull({ agent, folder: folder.path }), (e) => e.status === 409);
  assert.equal((await f.request(f.alice, `/api/artifacts/folders/${folder.id}/upload`, { method: "POST", body: { files: [] } })).status, 409);
  assert.equal(f.app.store.db.prepare("SELECT COUNT(*) AS n FROM artifact_objects").get().n, before);
  const keys = await createFolderKeys(folder.id, "password", "synthetic optional cipher password");
  assert.equal((await f.request(f.alice, `/api/encrypted/folders/${folder.id}/configure`, { method: "POST", body: keys })).status, 201);
  assert.equal((await f.request(f.admin, "/api/encrypted/settings", { method: "PUT", body: { enabled: false } })).status, 200);
  const restored = (await f.request(f.alice, agentPath)).data;
  assert.equal(restored.encryptedOnly, false); assert.equal(restored.requiredBySpace, false);
  assert.equal((await f.request(f.alice, `/api/encrypted/folders/${folder.id}`)).status, 200);
});
